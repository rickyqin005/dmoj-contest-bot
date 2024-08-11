require('dotenv').config();

// Discord
const { Client, Intents } = require('discord.js');
const client = new Client({ intents: [Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MESSAGES] });

const DMOJ_RATING = [
  [999, 'white'],
  [1299, 'green'],
  [1599, 'blue'],
  [1899, 'purple'],
  [2399, 'yellow'],
  [2999, 'red'],
  [999999999, 'target']
];

function setW(string, alignment, width) {
  if (string.length < width) {
    if (alignment == 'left') return string + ' '.repeat(width - string.length);
    else if (alignment == 'right') return ' '.repeat(width - string.length) + string;
    else if (alignment == 'center') return ' '.repeat(Math.floor((width - string.length) / 2)) +
      string + ' '.repeat(Math.ceil((width - string.length) / 2));
  }
  return string;
}
function apostrophePlural(string) {
  return (string.charAt(string.length - 1) == 's' ? '\'' : '\'s');
}
function getUserColour(user) {
  if (user.old_rating == null) return 'black';
  for (let i = 0; i < DMOJ_RATING.length; i++) {
    if (user.old_rating <= DMOJ_RATING[i][0]) return DMOJ_RATING[i][1];
  }
}
function userFormatRating(user) {
  let ratingStr = (user.old_rating == null ? '' : user.old_rating.toString());
  let colour = getUserColour(user);
  if (colour == 'target') return `:dart: \`${setW(ratingStr, 'left', 4)}\`   ${user.user}`;
  return `:${colour}_circle: \`${setW(ratingStr, 'left', 4)}\`   ${user.user}`;
}
function getProblemScore(solution) {
  return (solution == null ? 0 : solution.points);
}
function participantStr(user, rank) {
  let ans = '';
  ans += setW(rank.toString() + '.', 'left', 5) + setW(user.user, 'left', 21);
  for (let j = 0; j < user.solutions.length; j++) {
    if (user.solutions[j] == null) {
      ans += setW('-', 'left', 5);
    } else {
      ans += setW((user.solutions[j].points).toString(), 'left', 5);
    }
  }
  ans += user.score.toString() + '\n';
  return ans;
}

let Contest = {};
let lastCheck = Date.now();
let userParticipations = new Map(); // username -> ranking[i] object
let userParticipationsTracked = new Map();// username -> latest submission id
let userWindowFinished = new Map(); // username -> ranking[i] object

// HTTP requests
const axios = require('axios');
const fs = require('fs');

function getDMOJContestAPI() {
  return axios.get(`https://dmoj.ca/api/v2/contest/${process.env.CONTEST_KEY}`, {
    'headers': {
      'Authorization': `Bearer ${process.env.DMOJ_API_TOKEN}`
    }
  });
}

async function getLastUserSubmission(user) {
  return (await axios.get(`https://dmoj.ca/api/v2/submissions?user=${user}&page=last`, {
    'headers': {
      'Authorization': `Bearer ${process.env.DMOJ_API_TOKEN}`
    }
  })).data.data.objects.slice(-1)[0];
}

function getSubmissionDetailed(id) {
  return axios.get(`https://dmoj.ca/api/v2/submission/${id}`, {
    'headers': {
      'Authorization': `Bearer ${process.env.DMOJ_API_TOKEN}`
    }
  });
}

async function initializeContest() {
  try {
    let res = await getDMOJContestAPI();
    fs.writeFile("contest.json", JSON.stringify(res.data), () => { });
    Contest = res.data.data.object;// update the contest object
    userParticipations = new Map();
    userWindowFinished = new Map();
    let ranking = Contest.rankings;
    for (let i = 0; i < ranking.length; i++) {
      userParticipations.set(ranking[i].user, ranking[i]);

      if (Date.parse(ranking[i].end_time) <= Date.now()) {
        userWindowFinished.set(ranking[i].user, ranking[i]);
      }
    }

  } catch (error) {
    console.log(error);
    console.log('Will try again in 15 seconds...');
    setTimeout(initializeContest, 15000);
  }
}


client.on('ready', () => {
  console.log(`Logged in as ${client.user.tag}!`);
});
client.on('debug', console.log);

async function run() {
  console.log("version 1.2.4");
  await initializeContest();
  await client.login(process.env.DISCORD_TOKEN);
  setTimeout(refreshContest, 0);
}
run();


async function refreshContest() {
  async function sendMessage(channel, message, pingsUser = false, numPings = 1) {
    if (pingsUser) {
      let finalMessage = '';
      for (let i = 0; i < numPings; i++) finalMessage += `<@&${process.env['CONTEST_NOTIF']}>`;
      finalMessage += '\n' + message;
      channel.send(finalMessage);
    } else {
      channel.send(message);
    }
    console.log(message);
  }

  try {
    let res = await getDMOJContestAPI();
    fs.writeFile("contest.json", JSON.stringify(res.data), () => { });
    Contest = res.data.data.object;// update the contest object
    const ranking = Contest.rankings;
    const problems = Contest.problems.map((x) => x.code);
    const numProblems = Contest.problems.length;
    const channelBotFeed = await client.channels.fetch(process.env['CONTEST_FEED_CHANNEL_ID']);

    let maxScore = 0;
    for (let i = 0; i < numProblems; i++) {
      maxScore += Contest.problems[i].points;
    }

    // track changes
    for (let i = 0; i < ranking.length; i++) {
      let messageStr = '';
      let pingsUser = false;

      // check change in scoreboard
      if (userParticipations.get(ranking[i].user) == undefined) {
        messageStr = `${userFormatRating(ranking[i])} has joined the contest!`;
        pingsUser = (ranking[i].old_rating >= 2400);

      } else {
        let oldInfo = userParticipations.get(ranking[i].user);

        for (let j = 0; j < numProblems; j++) {
          let oldScore = getProblemScore(oldInfo.solutions[j]);
          let newScore = getProblemScore(ranking[i].solutions[j]);
          if (newScore - oldScore > 0) {
            if (newScore == Contest.problems[j].points) {
              messageStr = `${userFormatRating(ranking[i])} has solved P${j + 1}!`;
              pingsUser = ((ranking[i].old_rating >= 2600) || (j + 1 >= 4));
            } else {
              messageStr = `${userFormatRating(ranking[i])} has solved P${j + 1} partials`;
              if (userParticipationsTracked.get(ranking[i].user) == undefined) {
                messageStr += ` (${newScore}/${Contest.problems[j].points} points)`;
              }
              messageStr += '!';
              pingsUser = (ranking[i].old_rating >= 2600);
            }

            if (newScore == maxScore) {
              messageStr = `${userFormatRating(ranking[i])} has AKed the contest!`;
              pingsUser = true;
            }

          } else if (newScore == 0) {
            if (oldInfo.solutions[j] == null && ranking[i].solutions[j] != null) {// new attempt
              if ((j + 1) >= 4) {// send message for Px-Py
                messageStr = `${userFormatRating(ranking[i])} has attempted P${j + 1}!`;
              }
            }
          }
        }
      }

      // track users in tracker, adds submission info if applicable
      if (userParticipationsTracked.get(ranking[i].user) != undefined) {
        let lastid = userParticipationsTracked.get(ranking[i].user);
        latestsub = await getLastUserSubmission(ranking[i].user);

        // check if new submission was made to a contest problem
        if (latestsub.id != lastid && problems.includes(latestsub.problem) &&
          !(['CE', 'IE', 'AB'].includes(latestsub.result))) {
          latestsub = (await getSubmissionDetailed(latestsub.id)).data.data.object;

          // new submission must be finished grading
          if (latestsub.status == 'D') {
            userParticipationsTracked.set(ranking[i].user, latestsub.id);

            if (messageStr == '') {
              messageStr += `${userFormatRating(ranking[i])} has submitted to `;
              messageStr += `${latestsub.problem.slice(-2).toUpperCase()}:`;
            }
            messageStr += '\n';
            if (latestsub.result == 'AC') messageStr += `:white_check_mark: **AC**`;
            else {
              for (let j = 0; j < latestsub.cases.length; j++) {
                let batch = latestsub.cases[j];
                let flag = false;
                for (let k = 0; k < batch.cases.length; k++) {
                  let curr = batch.cases[k];
                  if (curr.status != 'AC') {
                    messageStr += `:x: **${curr.status}** on `;
                    messageStr += `Batch ${j + 1}, Case ${k + 1}`;
                    flag = true; break;
                  }
                }
                if (flag) break;
              }
            }
            messageStr += `, received ${latestsub.case_points}/${latestsub.case_total} points`;
          }
        }
      }

      // send message if applicable
      if (messageStr != '') {
        await sendMessage(channelBotFeed, messageStr, pingsUser, 1);
        messageStr = '';
      }
      pingsUser = false;

      // check time left
      if (userParticipations.get(ranking[i].user) == undefined) {
        userParticipations.set(ranking[i].user, ranking[i]);
      } else {
        let oldInfo = userParticipations.get(ranking[i].user);

        // send message for every hour that passes
        let oldtimeLeft = (Date.parse(ranking[i].end_time) - lastCheck) / 1000;
        let newtimeLeft = (Date.parse(ranking[i].end_time) - Date.now()) / 1000;
        let intervals = [7200, 3600, 1800, 900, 300];
        if (newtimeLeft > 0 && oldtimeLeft < Contest.time_limit &&
          (ranking[i].old_rating >= 2400 || userParticipationsTracked.get(ranking[i].user) != undefined)) {
          for (let j = 0; j < intervals.length; j++) {
            if (newtimeLeft < intervals[j] && intervals[j] < oldtimeLeft) {
              let hours = Math.floor(intervals[j] / 3600);
              let minutes = Math.floor((intervals[j] % 3600) / 60);
              messageStr += `${userFormatRating(ranking[i])} has`;
              if (hours > 0) messageStr += ` ${hours} hour${hours == 1 ? '' : 's'}`;
              if (minutes > 0) messageStr += ` ${minutes} minute${minutes == 1 ? '' : 's'}`;
              messageStr += ' left!\n';
              messageStr += '```' + participantStr(ranking[i], i + 1) + '```';
              await sendMessage(channelBotFeed, messageStr, ranking[i].old_rating >= 2600, 1);
            }
          }
        }

        // check for DQs
        if (ranking[i].is_disqualified && !oldInfo.is_disqualified) {
          messageStr = `${userFormatRating(ranking[i])} has been disqualified!`;
          await sendMessage(channelBotFeed, messageStr, true, 1);
        } else if (!ranking[i].is_disqualified && oldInfo.is_disqualified) {
          messageStr = `${userFormatRating(ranking[i])} has been un-disqualified!`;
          await sendMessage(channelBotFeed, messageStr, true, 1);
        }

        userParticipations.set(ranking[i].user, ranking[i]);
      }

      // check window
      if (Date.parse(ranking[i].end_time) <= Date.now()) {
        if (userWindowFinished.get(ranking[i].user) == undefined) {
          userWindowFinished.set(ranking[i].user, ranking[i]);
          messageStr = `${userFormatRating(ranking[i])}${apostrophePlural(ranking[i].user)} window is over.\n`;
          messageStr += '```' + participantStr(ranking[i], i + 1) + '```';
          await sendMessage(channelBotFeed, messageStr, ranking[i].old_rating >= 2600, 1);
        }
        userParticipationsTracked.delete(ranking[i].user);
      }
    }

    lastCheck = Date.now();
    console.log(new Date(lastCheck).toTimeString().slice(0, 17));
  } catch (error) {
    console.log(error);
  }
  setTimeout(refreshContest, 10000);
}


client.on('messageCreate', msg => {
  try {
    let userInput = msg.content.split(' ');// [command, param1, param2, ...]
    function getUserIndex(user) {// user->string, returns index of user in scoreboard array
      for (let i = 0; i < Contest.rankings.length; i++) {
        if (Contest.rankings[i].user == user) return i;
      }
      return -1;
    }
    if (userInput[0] == '!check') {
      msg.channel.send('Last update at ' + lastCheck.toString());
    } else if (userInput[0] == '!distribution') {
      let ranking = Contest.rankings;
      let numProblems = Contest.problems.length;
      let messageStr = '';

      let rowMaxLen = 0;
      for (let i = 0; i < numProblems; i++) {
        let currLen = 0;
        for (let j = 0; j < ranking.length; j++) {
          if (ranking[j].solutions[i] != null) {
            if (ranking[j].solutions[i].points > 0) currLen++;
          }
        }
        rowMaxLen = Math.max(rowMaxLen, currLen);
      }
      let chartScale = Math.max(rowMaxLen / 25, 1);
      for (let i = 0; i < numProblems; i++) {
        messageStr += `\`${setW('P' + (i + 1).toString(), 'left', 3)}\``;
        let numFull = 0;
        let numPartial = 0;
        let numAttempt = 0;
        for (let j = 0; j < ranking.length; j++) {
          if (ranking[j].solutions[i] != null) {
            if (ranking[j].solutions[i].points == Contest.problems[i].points) numFull++;
            else if (ranking[j].solutions[i].points > 0) numPartial++;
            else if (ranking[j].solutions[i].points == 0) numAttempt++;
          }
        }
        messageStr += ':green_square:'.repeat(Math.ceil(numFull / chartScale));
        messageStr += ':yellow_square:'.repeat(Math.ceil(numPartial / chartScale));
        messageStr += '\n';
      }
      msg.channel.send(messageStr);
    } else if (userInput[0] == '!help') {
      let messageStr =
        '```' + '\n' +
        '!check            Check the status of the bot' + '\n' +
        '!distribution     Displays the problem solve distribution of the contest' + '\n' +
        '!help             Self explanatory' + '\n' +
        '!info             General contest info' + '\n' +
        '!scoreboard       Displays the contest scoreboard' + '\n' +
        '!track            Tracks a user' + '\n' +
        '!tracking         Displays list of tracked users' + '\n' +
        '!untrack          Untracks a user' + '\n' +
        '!user             Displays relevant contest info about a user' + '\n' +
        '```';
      msg.channel.send(messageStr);
    } else if (userInput[0] == '!info') {
      let messageStr = '';
      messageStr += `Name: ${Contest.name}\n`;
      messageStr += `Contest key: ${Contest.key}\n`;
      messageStr += `Number of problems: ${Contest.problems.length}\n`;
      messageStr += `Window length: ${(Contest.time_limit / 3600)} hours\n`;
      messageStr += `Is rated: ${(Contest.is_rated == true ? 'Yes' : 'No')}\n`;
      messageStr += `Number of participants: ${Contest.rankings.length}\n`;
      let numActive = 0;
      for (let i = 0; i < Contest.rankings.length; i++) {
        if (Date.now() < Date.parse(Contest.rankings[i].end_time)) {
          numActive++;
        }
      }
      messageStr += `Number of active participants: ${numActive}\n`;
      msg.channel.send(messageStr);
    } else if (userInput[0] == '!scoreboard') {
      let ranking = Contest.rankings;
      let problem = Contest.problems;
      let filteredIdx = [];

      if (userInput[userInput.length - 1] == '-active') {
        for (let i = 0; i < ranking.length; i++) {
          if (Date.now() < Date.parse(ranking[i].end_time)) {
            filteredIdx.push(i);
          }
        }
      } else {
        let rankRange = [1, 25];// 1-indexed
        if (userInput[1] != undefined) {
          rankRange = userInput[1].split('-');
          if (rankRange.length == 1) {
            rankRange = [1, rankRange[0]];
          }
        }
        rankRange[0] = Math.max(rankRange[0], 1);
        rankRange[1] = Math.min(rankRange[1], ranking.length);
        rankRange[0]--; rankRange[1]--;// convert to 0-indexed
        for (let i = rankRange[0]; i <= rankRange[1]; i++) {
          filteredIdx.push(i);
        }
      }
      let scoreboardStr = '';

      // Header row
      scoreboardStr += setW('Rank', 'left', 5);
      scoreboardStr += setW('Username', 'left', 21);
      for (let i = 0; i < problem.length; i++) {
        scoreboardStr += setW(problem[i].label, 'left', 5);
      }
      scoreboardStr += 'Points' + '\n';

      // One row for each user
      // scoreboard is split into groups of 25
      for (let i = 0; i < filteredIdx.length; i += 25) {
        let L = i, R = Math.min(i + 25 - 1, filteredIdx.length - 1);// [L, R]

        for (let j = L; j <= R; j++) {
          scoreboardStr += participantStr(ranking[filteredIdx[j]], filteredIdx[j] + 1);
        }
        if (scoreboardStr != '') {
          msg.channel.send('```' + scoreboardStr + '```');
        }
        scoreboardStr = '';
      }
    } else if (userInput[0] == '!track') {
      if (userInput[1] != undefined) {
        let username = userInput[1];
        if (userParticipationsTracked.get(username) == undefined) {
          getLastUserSubmission(username).then((lastsub) => {
            try {
              userParticipationsTracked.set(username, lastsub.id);
              msg.channel.send(`Now tracking ${username}.`);
            } catch {
              msg.channel.send(`${username} is not a user.`);
            }
          });
        } else {
          msg.channel.send(`${username} is already being tracked.`);
        }
      }
    } else if (userInput[0] == '!tracking') {
      let messageStr = `Currently tracking ${userParticipationsTracked.size} users:`;
      for (let [key, value] of userParticipationsTracked) {

        messageStr += `\n${userFormatRating(userParticipations.get(key))}`;
      }
      msg.channel.send(messageStr);
    } else if (userInput[0] == '!untrack') {
      if (userInput[1] != undefined) {
        let username = userInput[1];
        if (userParticipationsTracked.get(username) == undefined) {
          msg.channel.send(`${username} has not been tracked.`);
        } else {
          userParticipationsTracked.delete(username);
          msg.channel.send(`${username} is no longer being tracked.`);
        }
      }
    } else if (userInput[0] == '!user') {
      if (userInput[1] != undefined) {
        let username = userInput[1];
        if (userParticipations.get(username) == undefined) {
          msg.channel.send(`${username} has not joined the contest.`);
        } else {
          userIdx = getUserIndex(username);
          user = Contest.rankings[userIdx];
          if (userWindowFinished.get(username) != undefined) {
            let messageStr = `${userFormatRating(user)}${apostrophePlural(user.user)} window is over.\n`;
            messageStr += '```' + participantStr(user, userIdx + 1) + '```';
            msg.channel.send(messageStr);
          } else {
            let timeLeft = Math.floor((Date.parse(userParticipations.get(username).end_time) - Date.now()) / 1000);
            let hour = Math.floor(timeLeft / 3600);
            let minute = Math.floor((timeLeft / 60) % 60);
            let second = Math.floor(timeLeft % 60);
            let messageStr = `${userFormatRating(user)} has ${hour} hour(s), ${minute} minute(s) and ${second} second(s) remaining.\n`;
            messageStr += '```' + participantStr(user, userIdx + 1) + '```';
            msg.channel.send(messageStr);
          }
        }
      }
    }
  } catch (error) {
    console.error(error);
    msg.channel.send('Request was unsuccessful.');
  }
});