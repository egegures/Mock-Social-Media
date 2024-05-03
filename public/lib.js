// TODO Get the database to return this with the main request, or at least use browser local storage for this
let usernameCache = {};

async function getUsername(userID) {
    if (userID in usernameCache)
        return usernameCache[userID];
    else {
        let username = await fetch('/api/getUsername', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                userID: userID
            })
        }).then(async response => {
            return await response.text();
        });
        usernameCache[userID] = username;
        return username;
    }
}

let displayNameCache = {};

async function getDisplayName(userID) {
    if (userID in displayNameCache)
        return displayNameCache[userID];
    else {
        let displayName = await fetch('/api/getDisplayName', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                userID: userID
            })
        }).then(async response => {
            return await response.text();
        });
        displayNameCache[userID] = displayName;
        return displayName;
    }
}

function getOwnUserID() {
    for (let cookie of document.cookie.split('; ')) {
        let [name, value] = cookie.split('=');
        if (name === 'user') return value;
    }
    return undefined;
}

// Send the user.html link to the current user
document.addEventListener('DOMContentLoaded', () => {
    let navbar = document.getElementById('navbar');
    for (let link of navbar.children)
        if (link.href.endsWith('/user.html'))
            link.href = `/user.html?id=${getOwnUserID()}`;
});