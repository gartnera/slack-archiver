const { RTMClient } = require('@slack/client');

class SlackMessageBot {
    constructor(db, botToken) {
        this.rtm = new RTMClient(botToken);
        this.db = db;
        this.subtypesToIgnore = ['message_deleted', 'message_replied'];
    }

    async start() {
        await this.rtm.start()
        this.rtm.on('message', (message) => this._handleMessage(message));
        this.rtm.on('reaction_added', (message) => this._handleReaction(message));
        this.rtm.on('reaction_removed', (message) => this._handleReaction(message));
        this.rtm.on('team_join', (message) => this._handleJoin(message))
    }

    async _handleMessage(message) {
        const {subtype} = message;
        if (this.subtypesToIgnore.includes(subtype)) {
            return;
        }
        if (subtype === 'message_changed') {
            await this.db.updateMessage(message.message, message.channel);
        } else {
            await this.db.insertMessages([message])
            await this.db.paginateChannel(message.channel);
        }
    }

    async _handleReaction(info) {
        if (info.item.type !== 'message') {
            return;
        }
        await this.db.processReaction(info);
    }

    async _handleJoin(message) {
        await this.db.insertUsers([message.user])
    }
}

module.exports = SlackMessageBot;