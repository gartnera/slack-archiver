# slack-archiver

This tool is designed to store, index, and display slack messages. You can use it to import and view the slack export as well as import new messages in real time. We use it because of the message limit on our free slack team.

## Slack API/Bot User

1. You'll need to create a new slack app
2. Enable the bot user and give it a name
3. Give it the following permissions:
    - `team:read`
    - `users:read`
    - `channels:read`
    - `bot`
4. `SLACK_API_TOKEN` is the "OAuth Access Token" and `SLACK_BOT_TOKEN` is the "Bot User OAuth Access Token"

## Install with Docker

After installing docker and docker-compose, follow these steps:

1. Edit `docker-compose.yml`
    - set `SLACK_API_TOKEN`
    - (optional) uncomment and set `SLACK_BOT_TOKEN`
    - replace `/your_zip` with the path to your exported zip file
2. Run `docker-compose up import` and wait for it to exit
3. (optional) Run `docker rm slackarchiver_import_1`
4. Run `docker-compose up -d web`
5. The web app will be running on `0.0.0.0:3000` by default

## Usage

When searching, click on the date/time to pivot to the message in it's original channel.

If you provided the `SLACK_BOT_TOKEN`, new messages can be imported in real time. In order to do this, the bot user must be a member of the target channel. This is only designed to work with public channels that originally existed in the export.