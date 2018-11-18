const { MongoClient } = require('mongodb');
const process = require('process');

class SlackDatabase {
    constructor(teamId) {
        let mongoUrl = process.env.MONGO_URL;
        if (!mongoUrl) {
            mongoUrl = 'mongodb://localhost:27017';
        }
        this.mongo = new MongoClient(mongoUrl, { useNewUrlParser: true });
        this.teamId = teamId;
    }

    async connect() {
        await this.mongo.connect();

        this.db = this.mongo.db('slack');

        // if teamId not provided, assume we're using the first team
        let { teamId } = this;
        if (!teamId) {
            const team = await this.db.collection('teams').findOne();
            teamId = team.id;
            this.teamId = teamId;
        }

        this.userCollection = this.db.collection(`${teamId}_users`)
        this.channelCollection = this.db.collection(`${teamId}_channels`)
        this.messageCollection = this.db.collection(`${teamId}_messages`)
        this.pageCollection = this.db.collection(`${teamId}_pages`)

        const { messageCollection, pageCollection } = this;
        await messageCollection.createIndex('user')
        await messageCollection.createIndex({ channel: 1, ts: 1, "replies.ts": 1 }, { unique: true })
        await messageCollection.createIndex({ text: 'text', 'replies.text': 'text' })
        await pageCollection.createIndex({'page': 1,'start_ts': 1, 'end_ts': 1 })
    }

    async close() {
        await this.mongo.close();
    }

    async insertUsers(users) {
        await this.userCollection.insertMany(users);
    }

    async getUsers() {
        return await this.userCollection.find().toArray();
    }

    async insertChannels(channels) {
        await this.channelCollection.insertMany(channels);
    }

    async getChannels() {
        return await this.channelCollection.find().sort({
            is_archived: 1,
        }).toArray();
    }

    async insertMessages(messages, channel) {
        const [plainMessages, replies] = this._processNewMessages(messages, channel)

        const collection = this.messageCollection

        if (plainMessages.length) {
            await collection.insertMany(plainMessages)
        }

        if (Object.keys(replies).length) {
            for (const key in replies) {
                const messages = replies[key];

                let res = await collection.updateOne(
                    { ts: parseFloat(key) },
                    { $push: { replies: { $each: messages } } },
                );
            }
        }
    }

    async updateMessage(newMessage, channel) {
        this._cleanMessage(newMessage, channel);
        let message = await this.messageCollection.findOne({channel, ts: newMessage.ts})
        if (message) {
            const {ts, text} = newMessage;
            await this.messageCollection.updateOne({channel, ts}, {$set: {text}})
            return;
        }
        message = await this.messageCollection.findOne({channel, 'replies.ts': newMessage.ts})
        if (message) {
            const {ts, text} = newMessage;
            const update = {
                $set: {
                    'replies.$.text': text,
                }
            }
            await this.messageCollection.updateOne({channel, 'replies.ts': ts}, update);
            return;
        }
        console.log('Unable to update');
        console.log(newMessage);
    }

    async processReaction(info) {
        const {type, user, reaction, item} = info;
        let {channel, ts} = item;
        ts = parseFloat(ts);
        const shouldAdd = type === 'reaction_added';

        let message = await this.messageCollection.findOne({channel, ts})
        if (message) {
            let {reactions} = message;
            if (!reactions) {
                reactions = [];
            }
            this._updateReactionArray(reactions, reaction, user, shouldAdd);
            await this.messageCollection.updateOne({channel, ts}, {$set: {reactions}})
            return;
        }

        message = await this.messageCollection.findOne({channel, 'replies.ts': ts})
        if (message) {
            let reply = message.replies.find((el) => el.ts == ts);
            let {reactions} = reply;
            if (!reactions) {
                reactions = [];
            }
            this._updateReactionArray(reactions, reaction, user, shouldAdd);
            const update = {
                $set: {
                    'replies.$.reactions': reactions,
                }
            }
            await this.messageCollection.updateOne({channel, 'replies.ts': ts}, update);
            return;
        }

    }

    _updateReactionArray(reactions, reaction, user, shouldAdd) {
        let target = null;
        let idx = -1;
        for (const [i, obj] of reactions.entries()) {
            if (obj.name == reaction) {
                idx = i;
                target = obj;
                break;
            }
        }
        if (shouldAdd) {
            if (target) {
                target.users.push(user);
                target.count++;
            } else {
                const obj = {
                    name: reaction,
                    users: [user],
                    count: 1,
                }
                reactions.push(obj);
            }
        } else {
            if (target) {
                if (target.count > 1) {
                    target.users = target.users.filter((val) => val != user);
                    target.count--;
                } else {
                    reactions.splice(idx, 1);
                }
                
            }
        }
    }

    async searchForMessages(query) {
        return await this.messageCollection
            .find({ $text: { $search: query}})
            .sort({ts: 1})
            .limit(100)
            .toArray();
    }

    async countPages(channel) {
        return await this.pageCollection.find().count({channel})
    }

    async getPageMessages(channel, page) {
        const pageObj = await this.pageCollection.find({channel, page}).next();
        const query = {channel, ts: {$gte: pageObj.start_ts}};
        if (pageObj.end_ts) {
            query.ts.$lte = pageObj.end_ts;
        }
        const messages = await this.messageCollection.find(query).toArray();
        return [messages, !!pageObj.end_ts];
    }

    async tsToPage(channel, ts) {
        let pages = await this.pageCollection.find({channel}).toArray();
        for (const [i, page] of pages.entries()) {
            if (ts < page.start_ts) {
                continue
            }
            if (page.end_ts && ts > page.end_ts) {
                continue
            }
            return i + 1; // we index pages off 1
        }
        return -1;
    }

    async paginateAllChannels() {
        const channels = await this.channelCollection.find().toArray()

        for (const channel of channels) {
            while(await this.paginateChannel(channel.id)){};
        }
    }

    async paginateChannel(channel) {
        let lastPage = await this.pageCollection.findOne({channel, end_ts: {$exists: false}});
            
        if (!lastPage) {
            lastPage = {
                channel,
                page: 1,
                start_ts: 0,
            }
        }
        const currentPage = lastPage.page;
        const latestMessages = await this.messageCollection.find({channel, ts: {$gt: lastPage.start_ts} }).limit(101).toArray();

        const lmLength = latestMessages.length;
        if (lmLength > 0 && lastPage.start_ts === 0) {
            lastPage.start_ts = latestMessages[0].ts;
        }
        if (lmLength > 100) {
            // 0 - 99 => 100 messages; [100] is the beginning of the next page
            const ts = latestMessages[99].ts;
            lastPage.end_ts = ts;
        }
        if (lastPage._id) {
            await this.pageCollection.updateOne({_id: lastPage._id}, {$set: lastPage})
        } else {
            await this.pageCollection.insertOne(lastPage)
        }

        // make next page (if last page was full)
        if (lastPage.end_ts) {
            await this.pageCollection.insertOne({channel, page: currentPage + 1, start_ts: latestMessages[100].ts})
            return true;
        }

        await this.channelCollection.updateOne({id: channel}, {$set: {pages: currentPage}})
        return false;
    }

    _processNewMessages(messages, channel) {
        const plainMessages = [];

        // ts -> message[]
        const replies = {};

        for (const message of messages) {
            this._cleanMessage(message, channel);
            const threadTs = message.thread_ts;
            if (threadTs && message.ts !== threadTs) {
                if (!replies[threadTs]) {
                    replies[threadTs] = [];
                }
                replies[threadTs].push(message)
            } else {
                plainMessages.push(message);
            }
        }

        return [plainMessages, replies];
    }

    _cleanMessage(message, channel) {
        if (!channel && !message.channel) {
            throw 'channel undefined';
        }

        if (!message.channel)
            message.channel = channel;

        this._deleteFields(message, ['replies', 'unread_count', 'client_msg_id', 'edited', 'parent_user_id'])
        message.ts = parseFloat(message.ts);
        if (message.thread_ts) {
            message.thread_ts = parseFloat(message.thread_ts);
        }
    }

    _deleteFields(obj, fields) {
        for (const field of fields) {
            delete obj[field];
        }
    }
}

module.exports = SlackDatabase