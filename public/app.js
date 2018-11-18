const state = {}
const messageContainer = document.getElementById("message-container");
const pager = document.getElementById("pager");
const sidebar = document.getElementById("sidebar");
const threadViewer = document.getElementById("thread-viewer");

const md = window.markdownit({
    html: true,
    linkify: false,
    typeographer: false,
    breaks: true,
}).use(window.markdownitEmoji);

async function apiGet(resource) {
    const path = `/api${resource}`
    let response = await fetch(path);
    let data = await response.json();
    return data;
}

function htmlFromString(string) {
    var t = document.createElement('template');
    t.innerHTML = string;
    return t.content.cloneNode(true).firstChild;
}

function processMessageText(text) {
    text = text.replace(/<[^>]+>/g, (val) => {
        const inner = val.substring(1, val.length - 1);
        if (inner.startsWith('@')) {
            const user = state.userById.get(inner.substring(1));
            const name = user ? user.name : 'unkown-user';
            return `@${name}`
        }
        if (inner.startsWith('#')) {
            const id = inner.substring(1).split("|")[0];
            let channel = state.channelById.get(id);
            return `<a href="/channel/${channel.id}">#${channel.name}</a>`
        }
        if (inner.startsWith("http")) {
            const parts = inner.split("|")
            const url = parts[0];
            let name = parts[1];
            if (!name) name = url;
            return `<a target="_blank" href="${url}">${name}</a>`
        }
        return val;
    })
    text = md.render(text);

    return text;
}

function buildPager(channel, currentPage, maxPage) {
    const els = [];

    if (currentPage != 1) {
        let el = document.createElement('a');
        el.href = `/channel/${channel}/${currentPage - 1}`
        el.innerText = '▲';
        els.push(el);

        el = document.createElement('a');
        el.href = `/channel/${channel}/1`
        el.innerText = '1';
        els.push(el);
    }

    const el = document.createElement('a');
    el.href = `/channel/${channel}/${currentPage}`
    el.innerText = currentPage;
    els.push(el);

    if (currentPage != maxPage) {
        let el = document.createElement('a');
        el.href = `/channel/${channel}/${maxPage}`
        el.innerText = maxPage;
        els.push(el);

        el = document.createElement('a');
        el.href = `/channel/${channel}/${currentPage + 1}`
        el.innerText = '▼';
        els.push(el);
    }

    return els;
}

function usersIdsToNames(userIds) {
    let res = [];
    for (const id of userIds) {
        const user = state.userById.get(id);
        if (state.options.useRealName) {
            res.push(user.real_name);
        } else {
            res.push(user.name);
        }
    }
    return res;
}

async function pivotTsToPage() {
    const obj = this.parentElement.obj;
    const {channel, ts} = obj;

    let path = `/ts/${channel}/${ts}`
    const page = await apiGet(path);
    await routeChannel(channel, page, true);
    for (let el of messageContainer.children) {
        if (el.obj.ts == ts) {
            el.scrollIntoView()
            return
        }
    }
}

function renderMessage(obj, shouldLinkTs) {
    const div = document.createElement('div');
    div.className = 'msg';
    div.obj = obj;

    const user = state.userById.get(obj.user)
    let userName = "";
    if (!user) {
        userName = "unkown-user";
    } else if (state.options.useRealName) {
        userName = user.real_name;
    } else {
        userName = user.name;
    }
    const userNameEl = document.createElement('p');
    userNameEl.className = 'msg-username';
    userNameEl.innerText = userName;
    div.appendChild(userNameEl);

    const messageDate = new Date(obj.ts * 1000);
    const dateStr = messageDate.toLocaleString("en-US");
    const ts = document.createElement('p');
    ts.className = 'msg-date';
    ts.innerText = dateStr;
    div.appendChild(ts);

    if (shouldLinkTs) {
        ts.onclick = pivotTsToPage;
    }

    const text = document.createElement('p');
    div.appendChild(text);
    try {
        text.outerHTML = processMessageText(obj.text);
    } catch {
        text.outerHTML = "!!! Parse failed !!!"
    }
    text.className = 'msg-text';

    if (obj.replies) {
        const replyLink = document.createElement('p');
        replyLink.className = 'tlink';
        replyLink.innerText = `${obj.replies.length} replies`;
        replyLink.onclick = () => viewThread(obj);
        div.appendChild(replyLink);
    }

    if (obj.reactions) {
        const reactionsContainer = document.createElement('div');
        reactionsContainer.className = 'msg-react';
        for (const reaction of obj.reactions) {
            const res = md.render(`:${reaction.name}: ${reaction.count}`)
            const el = htmlFromString(res);
            const reactors = usersIdsToNames(reaction.users);
            el.title = reactors.join(', ');
            reactionsContainer.appendChild(el);
        }
        div.appendChild(reactionsContainer);
    }

    return div;
}

function viewThread(obj) {
    threadViewer.innerHTML = '';
    threadViewer.style.display = 'block';
    const dismiss = document.createElement('a');
    dismiss.className = 'tlink';
    dismiss.innerText = 'dismiss';
    dismiss.onclick = () => threadViewer.style.display = '';
    threadViewer.appendChild(dismiss);
    threadViewer.appendChild(renderMessage(obj));
    for (const reply of obj.replies) {
        threadViewer.appendChild(renderMessage(reply))
    }
}

async function search(query, updateHistory) {
    query = encodeURIComponent(query);
    const path = `/search/?q=${query}`
    if (updateHistory) {
        window.history.pushState(null, null, path)
    }

    const messages = await apiGet(path)
    messageContainer.innerHTML = "";
    for (const message of messages) {
        const el = renderMessage(message, true);
        messageContainer.appendChild(el);
    }

    messageContainer.lastChild.scrollIntoView()
    pager.innerHTML = "";
}

async function routeSearch(url, updateHistory) {
    await search(url.searchParams.get("q"), updateHistory);
}

async function routeChannel(channel, page, updateHistory) {
    const channelInfo = state.channelById.get(channel);
    if (!page) {
        page = channelInfo.pages;
    }
    page = parseInt(page);

    const path = `/channel/${channel}/${page}`
    if (updateHistory) {
        window.history.pushState(null, null, path)
    }

    const messages = await apiGet(path)

    messageContainer.innerHTML = "";
    for (const message of messages) {
        const el = renderMessage(message);
        messageContainer.appendChild(el);
    }

    pager.innerHTML = "";
    const pages = buildPager(channel, page, channelInfo.pages);
    for (const page of pages) {
        pager.appendChild(page);
    }
    if (!state.currentPage || state.currentPage > page) {
        messageContainer.lastChild.scrollIntoView()
    } else {
        messageContainer.firstChild.scrollIntoView()
    }

    state.currentPage = page;
}

function routeUrl(url, updateHistory) {
    const components = url.pathname.split('/');
    const route = components[1];
    const args = components.slice(2);
    if (route === 'channel') {
        routeChannel(args[0], args[1], updateHistory);
    } else if (route === 'search') {
        routeSearch(url, updateHistory);
    }
}

//route all clicks on page
document.addEventListener('click', (e) => {
    const t = e.target;

    if (t.id === "search-icon") {
        search(prompt("Query:"), true)
        return;
    }

    if (t.nodeName !== 'A' || !t.href) {
        return;
    }

    const url = new URL(t.href);
    if (url.origin === window.location.origin) {
        routeUrl(url, true);
        e.preventDefault();
    }
});

window.addEventListener('popstate', (ev) => {
    const url = new URL(window.location);
    routeUrl(url, false);
});

(async function () {
    let options = JSON.parse(localStorage.getItem('options'));
    if (!options) {
        options = {};
    }
    state.options = options;

    const channels = await apiGet('/channels');
    state.channelById = new Map();
    state.channelByName = new Map();
    for (const channel of channels) {
        state.channelById.set(channel.id, channel);
        state.channelByName.set(channel.name, channel);

        const a = document.createElement('a');
        a.href = `/channel/${channel.id}`
        a.innerText = `#${channel.name}`;
        sidebar.appendChild(a);
    }

    const users = await apiGet('/users');
    state.userById = new Map();
    for (const user of users) {
        state.userById.set(user.id, user);
    }

    routeUrl(new URL(window.location), false);
})();