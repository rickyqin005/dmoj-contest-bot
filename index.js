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
  [999999999, 'red']
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
  return `:${getUserColour(user)}_circle: \`${setW(ratingStr, 'left', 4)}\`   ${user.user}`;
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
let lastCheck = '';
let userParticipations = new Map(); // username -> ranking[i] object
let userWindowFinished = new Map(); // username -> ranking[i] object

// HTTP requests
const axios = require('axios');
const fs = require('fs');
const httpHeader = {
  'headers': {
    'Authorization': `Bearer ${process.env.DMOJ_API_TOKEN}`
  }
};
function getDMOJAPIUrl() {
  return `https://dmoj.ca/api/v2/contest/${process.env.CONTEST_KEY}`;
}

async function initializeContest() {
  try {
    let res = await axios.get(getDMOJAPIUrl(), httpHeader);
    await fs.writeFile("contest.json", JSON.stringify(res.data), () => { });
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
    setTimeout(initializeContest, 6000);
  }
}

client.on('ready', () => {
  console.log(`Logged in as ${client.user.tag}!`);
});
client.on('debug', console.log);

async function run() {
  await initializeContest();
  await client.login(process.env.DISCORD_TOKEN);
  setTimeout(refreshContest, 0);
}
run();


async function refreshContest() {
  async function sendMessage(channel, message, pingsUser = false, numPings = 1) {
    // if(pingsUser) {
    //     let finalMessage = `<@&${process.env['CONTEST_NOTIF']}>`;
    //     finalMessage += '\n' + message;
    //     channel.send(finalMessage);
    // } else {
    channel.send(message);
    // }
    console.log(message);
  }

  try {
    let res = await axios.get(getDMOJAPIUrl(), httpHeader);
    await fs.writeFile("contest.json", JSON.stringify(res.data), () => { });
    Contest = res.data.data.object;// update the contest object
    const ranking = Contest.rankings;
    const numProblems = Contest.problems.length;
    const channelBotFeed = await client.channels.fetch(process.env['CONTEST_FEED_CHANNEL_ID']);

    let maxScore = 0;
    for (let i = 0; i < numProblems; i++) {
      maxScore += Contest.problems[i].points;
    }

    for (let i = 0; i < ranking.length; i++) {
      if (userParticipations.get(ranking[i].user) == undefined) {
        userParticipations.set(ranking[i].user, ranking[i]);
        let messageStr = `${userFormatRating(ranking[i])} has joined the contest!`;
        await sendMessage(channelBotFeed, messageStr, ranking[i].old_rating >= 2400, 1);
      } else {
        let oldInfo = userParticipations.get(ranking[i].user);
        for (let j = 0; j < numProblems; j++) {
          let oldScore = getProblemScore(oldInfo.solutions[j]);
          let newScore = getProblemScore(ranking[i].solutions[j]);
          if (newScore - oldScore > 0) {
            let messageStr = '';
            if (newScore == Contest.problems[j].points) {
              messageStr = `${userFormatRating(ranking[i])} has solved P${j + 1}!`;
              await sendMessage(channelBotFeed, messageStr, (ranking[i].old_rating >= 2400) || (j + 1 >= 5), 1);
            } else {
              messageStr = `${userFormatRating(ranking[i])} has solved P${j + 1} partials (${newScore} points)!`;
              await sendMessage(channelBotFeed, messageStr, (ranking[i].old_rating >= 2400 && (j + 1 >= 5)), 1);
            }

            if (newScore == maxScore) {
              messageStr = `${userFormatRating(ranking[i])} has AKed the contest!`;
              await sendMessage(channelBotFeed, messageStr, true, 5);
            }

          } else if (newScore == 0) {
            if (oldInfo.solutions[j] == null && ranking[i].solutions[j] != null) {// new attempt
              if ((j + 1) >= 3) {// send message for Px-Py
                messageStr = `${userFormatRating(ranking[i])} has attempted P${j + 1}!`;
                await sendMessage(channelBotFeed, messageStr, false, 1);
              }
            }
          }
        }
        userParticipations.set(ranking[i].user, ranking[i]);
      }
      if (Date.parse(ranking[i].end_time) <= Date.now()) {
        if (userWindowFinished.get(ranking[i].user) == undefined) {
          userWindowFinished.set(ranking[i].user, ranking[i]);
          let messageStr = `${userFormatRating(ranking[i])}${apostrophePlural(ranking[i].user)} window is over.\n`;
          messageStr += '```' + participantStr(ranking[i], i + 1) + '```';
          await sendMessage(channelBotFeed, messageStr, ranking[i].old_rating >= 2400, 1);
        }
      }
    }
    lastCheck = (new Date(Date.now()).toString());
    console.log(new Date(Date.now()).toTimeString().slice(0, 17));
  } catch (error) {
    console.log(error);
  }
  setTimeout(refreshContest, 8000);
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
      msg.channel.send('Last update at ' + lastCheck);
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
        messageStr += `\`${setW('P' + (i + 1).toString(), 'left', 4)}\``;
        let numFull = 0;
        let numPartial = 0;
        for (let j = 0; j < ranking.length; j++) {
          if (ranking[j].solutions[i] != null) {
            if (ranking[j].solutions[i].points == Contest.problems[i].points) numFull++;
            else if (ranking[j].solutions[i].points > 0) numPartial++;
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
        '!participants     Returns The total number of contest participants' + '\n' +
        '!scoreboard       Displays the contest scoreboard' + '\n' +
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
      msg.channel.send(messageStr);
    } else if (userInput[0] == '!participants') {
      let ranking = Contest.rankings;
      if (userInput[1] != undefined) {
        if (userInput[1] == '-active') {
          let numActive = 0;
          for (let i = 0; i < ranking.length; i++) {
            if (Date.now() < Date.parse(ranking[i].end_time)) {
              numActive++;
            }
          }
          msg.channel.send(`There are ${numActive} active participants.`);
        }
      } else {
        msg.channel.send(`There are ${ranking.length} participants.`);
      }
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