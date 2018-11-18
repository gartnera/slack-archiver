const SlackDatabase = require('./db');
const SlackMessageBot = require('./bot');

const express = require('express')
const morgan = require('morgan')
const app = express()
const process = require('process')

const db = new SlackDatabase();

const cspDirectives = [
    "default-src 'self' cdnjs.cloudflare.com fonts.googleapis.com fonts.gstatic.com",
    "img-src http: https: data:",
]
const cspString = cspDirectives.join('; ')

app.use(morgan('combined'));

app.use((req,res,next) => {
    res.append('Access-Control-Allow-Methods', 'GET');
    res.append('Content-Security-Policy', cspString);
    next();
})

const api = express.Router();
api.use('/api', api);

api.get('/users', async (req, res) => {
    const users = await db.getUsers();
    res.append('Cache-Control', 'public, max-age=600')
    res.json(users);
});

api.get('/channels', async (req, res) => {
    const channels = await db.getChannels();
    res.append('Cache-Control', 'public, max-age=600')
    res.json(channels);
});

api.get('/channel/:channel/:page', async (req, res) => {
    let {channel, page} = req.params;
    page = parseInt(page);
    const [messages, isFullPage] = await db.getPageMessages(channel, page);
    if (isFullPage) {
        res.append('Cache-Control', 'public, max-age=3600')
    }
    res.json(messages);
});

api.get('/search/', async (req, res) => {
    let {q} = req.query;
    const messages = await db.searchForMessages(q);
    res.append('Cache-Control', 'public, max-age=600')
    res.json(messages);
});

api.get('/ts/:channel/:ts', async (req, res) => {
    let {channel, ts} = req.params;
    ts = parseFloat(ts);
    const page = await db.tsToPage(channel, ts);
    res.json(page);
});

app.use('/api', api);

app.use(express.static('public', {
    maxage: '1d',
}))
app.get('/*', (req, res) => {
    res.append('Cache-Control', 'public, max-age=86400');
    res.sendFile(__dirname + '/public/index.html');
});

(async function () {
    await db.connect();
    const botToken = process.env.SLACK_BOT_TOKEN;
    if (botToken) {
        const bot = new SlackMessageBot(db, botToken);
        bot.start();
    }
    app.listen(3000, () => console.log('Listening on port 3000'));
})();