const process = require('process');
const fs = require('fs');
const path = require('path');

const unzipper = require('unzipper');
const { WebClient } = require('@slack/client');

const SlackDatabase = require('./db');

process.on('unhandledRejection', up => { throw up });

const SLACK_API_TOKEN = process.env.SLACK_API_TOKEN;
const slackApi = new WebClient(SLACK_API_TOKEN);

let db = null;

const channelNameMap = {};

async function handleMessages(p, messages) {
  const channelId = channelNameMap[p.dir];
  if (!channelId) {
    console.debug(`WARN: unable to find channelId for ${p.dir}`);
    return;
  }
  await db.insertMessages(messages, channelId);
}

async function handleZipEntry(entry) {
  const p = path.parse(entry.path);
  if (!p.dir) {
    entry.autodrain();
    return
  }
  const buffer = await entry.buffer();
  const string = buffer.toString('utf8');
  const obj = JSON.parse(string);
  await handleMessages(p, obj);
}

(async function () {
  const zipName = process.argv[2];
  if (!zipName) {
    console.log("Error: you must provide the exported zip file as an argument")
    process.exit(-1);
  }
  let { team } = await slackApi.team.info();
  let { channels } = await slackApi.conversations.list();
  let { members } = await slackApi.users.list();

  db = new SlackDatabase(team.id);
  await db.connect();
  await db.insertChannels(channels);
  await db.insertUsers(members);

  await db.db.collection('teams').insertOne(team);

  for (const channel of channels) {
    channelNameMap[channel.name] = channel.id;
  }

  fs.createReadStream(zipName)
    .pipe(unzipper.Parse())
    .on('entry', async (entry) => {
      if (!entry.path.endsWith(".json")) {
        entry.autodrain();
        return;
      }
      await handleZipEntry(entry)
    })
    .on('finish', async () => {
      await db.paginateAllChannels();
      await db.close();
    });
})();
