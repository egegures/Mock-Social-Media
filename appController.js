const express = require('express');
const appService = require('./appService');
const bcrypt = require('bcrypt');
const { dataUriToBuffer } = require('data-uri-to-buffer');

const router = express.Router();

// ----------------------------------------------------------
// API endpoints
// Modify or extend these routes based on your project's needs.
router.get('/check-db-connection', async (req, res) => {
    const isConnect = await appService.testOracleConnection();
    if (isConnect) {
        res.send('connected');
    } else {
        res.send('unable to connect');
    }
});

router.get('/demotable', async (req, res) => {
    const tableContent = await appService.fetchDemotableFromDb();
    res.json({ data: tableContent });
});

router.post("/initiate-demotable", async (req, res) => {
    const initiateResult = await appService.initiateDemotable();
    if (initiateResult) {
        res.json({ success: true });
    } else {
        res.status(500).json({ success: false });
    }
});

router.post("/insert-demotable", async (req, res) => {
    const { id, name } = req.body;
    const insertResult = await appService.insertDemotable(id, name);
    if (insertResult) {
        res.json({ success: true });
    } else {
        res.status(500).json({ success: false });
    }
});

router.post("/update-name-demotable", async (req, res) => {
    const { oldName, newName } = req.body;
    const updateResult = await appService.updateNameDemotable(oldName, newName);
    if (updateResult) {
        res.json({ success: true });
    } else {
        res.status(500).json({ success: false });
    }
});

router.get('/count-demotable', async (req, res) => {
    const tableCount = await appService.countDemotable();
    if (tableCount >= 0) {
        res.json({
            success: true,
            count: tableCount
        });
    } else {
        res.status(500).json({
            success: false,
            count: tableCount
        });
    }
});

const COOKIE_MAX_AGE = 2592000000; // 30 days

router.post('/login', async (req, res) => {

    // If the frontend didn't provide username and password strings
    if (!(
        'username' in req.body &&
        typeof req.body.username === 'string' &&
        'password' in req.body &&
        typeof req.body.password === 'string'
    )) {
        res.status(400).end('400 Bad request');
    }

    // If the user authenticates successfully
    else if (await appService.passwordCorrect(req.body.username, req.body.password)) {
        res.cookie('user', await appService.getUserId(req.body.username), { maxAge: COOKIE_MAX_AGE })
            .cookie('password', req.body.password, { maxAge: COOKIE_MAX_AGE, httpOnly: true })
            .redirect(302, '/feed.html');
    }

    // If authentication fails
    else {
        res.clearCookie('user')
            .clearCookie('password', { httpOnly: true })
            .redirect(302, '/index.html?incorrectPassword');
    }
});

router.post('/newUser', async (req, res) => {
    function fail(reason) {
        res.clearCookie('user')
            .clearCookie('password', { httpOnly: true });

        if ('javascript' in req.body)
            res.status(200).json({
                success: false,
                reason: reason
            });
        else
            res.redirect(302, `/newUser.html?${reason}`);
    }

    if (!(
        'username' in req.body &&
        typeof req.body.username === 'string' &&
        'password' in req.body &&
        typeof req.body.password === 'string'
    ))
        res.status(400).end('400 Bad request');

    // If the username is empty or longer than 32 characters
    else if (req.body.username.length === 0 || req.body.username.length > 32)
        fail('invalidUsername');

    // If the user tries to use a username that is already taken
    else if (await appService.userExists(req.body.username))
        fail('userExists');

    // If the user tries to have an empty password
    else if (req.body.password.length === 0)
        fail('invalidPassword');

    else {
        userId = await appService.createUser(req.body.username, req.body.password);

        res.cookie('user', userId, { maxAge: COOKIE_MAX_AGE })
            .cookie('password', req.body.password, { maxAge: COOKIE_MAX_AGE, httpOnly: true });

        if ('javascript' in req.body)
            res.status(200).json({ success: true });
        else
            res.redirect(302, '/feed.html');
    }

});

/**
 * Validate that the user is authenticated, and get the user ID
 *
 * Returns an object with two properties:
 *  - isAuthenticated is true if the user is properly authenticated
 *  - user is a string that represents the user, whether they are properly authenticated or not. If it is undefined, the request either specifies a nonexistent user or does not specify a user
 *
 * @param req the request from the user
 * @returns {isAuthenticated: bool, user: string|undefined}
 */
async function getAuthenticatedUser(req) {
    // If there is a cookie indicating the user, continue with the authentication. Otherwise, fail.
    if ('user' in req.cookies) {
        let queryResult = await appService.getUserHash(req.cookies.user);

        // If we do not find the user in the table at all, fail
        if (queryResult.length == 0) return {
            isAuthenticated: false,
            user: undefined
        };

        // If a password is provided and is correct, succeed
        else if (
            'password' in req.cookies &&
            (await bcrypt.compare(req.cookies.password, queryResult[0][0]))
        ) return {
            isAuthenticated: true,
            user: req.cookies.user
        }

        // Otherwise fail
        else return {
            isAuthenticated: false,
            user: req.cookies.user
        };
    } else return {
        isAuthenticated: false,
        user: undefined
    };
}

/**
 * Return a 401 unauthorized response and clear cookies
 *
 * @param res the response object to send the 401 unauthorized response to
 */
function fail401(res) {
    res.clearCookie('user')
        .clearCookie('password', { httpOnly: true })
        .status(401)
        .end('401 Unauthorized');
}

router.get('/getFeedStories', async (req, res) => {
    let auth = await getAuthenticatedUser(req);
    if (auth.isAuthenticated)
        res.status(200).type('application/json').end(JSON.stringify(await appService.getFeedStories(auth.user)));
    else fail401(res);
});

router.get('/getBannerAd', async (req, res) => {
    let auth = await getAuthenticatedUser(req);
    if (auth.isAuthenticated) {
        let ad = await appService.getBannerAd(auth.user);
        if (ad === undefined)
            res.status(404).end('404 Not Found');
        else
            res.status(200).type('application/json').end(JSON.stringify(ad));
    }
    else fail401(res);
});

router.get('/getFeedPosts', async (req, res) => {
    let auth = await getAuthenticatedUser(req);
    if (auth.isAuthenticated)
        res.status(200).type('application/json').end(JSON.stringify(await appService.getFeedPosts(auth.user)));
    else fail401(res);
});

router.post('/clickAd', async (req, res) => {
    let auth = await getAuthenticatedUser(req);

    if (!auth.isAuthenticated) fail401(res);
    else if (!(
        'showingId' in req.body &&
        typeof req.body.showingId === 'string'
    )) res.status(400).end('400 Bad Request');
    else if (!appService.adShowingExists(req.body.showingId)) res.status(404).end('404 Not Found');
    else {
        await appService.clickAd(req.body.showingId);
        res.status(200).end('200 OK');
    }
});

router.get('/logout', async (req, res) => {
    res.clearCookie('user')
        .clearCookie('password', { httpOnly: true })
        .redirect(302, '/index.html');
});

router.post('/getUsername', async (req, res) => {

    if (!('userID' in req.body && typeof req.body.userID === 'string'))
        res.status(400).end('400 Bad Request');
    else {
        queryResult = await appService.getUsername(req.body.userID);
        if (queryResult === undefined)
            res.status(404).end('404 Not Found');
        else
            res.status(200).end(queryResult);
    }
});
router.post('/getDisplayName', async (req, res) => {

    if (!('userID' in req.body && typeof req.body.userID === 'string'))
        res.status(400).end('400 Bad Request');
    else {
        queryResult = await appService.getDisplayName(req.body.userID);
        if (queryResult === undefined)
            res.status(404).end('404 Not Found');
        else
            res.status(200).end(queryResult);
    }
});

router.get('/getUserFeedInfo', async (req, res) => {
    let auth = await getAuthenticatedUser(req);

    if (!auth.isAuthenticated) fail401(res);
    else {
        //TODO get presence of unread messages
        res.status(200).type('application/json').end(JSON.stringify({
            admin: await appService.getAdminStatusByUserID(auth.user),
            postColabs: await appService.getPostCollaborationRequests(auth.user),
            adColabs: await appService.getAdCollaborationRequests(auth.user)
        }));
    }
});

router.post('/updateColab', async (req, res) => {
    let auth = await getAuthenticatedUser(req);

    if (!auth.isAuthenticated) fail401(res);
    else if (!(
        'type' in req.body &&
        ['ad', 'post'].includes(req.body.type) &&
        'id' in req.body &&
        typeof req.body.id === 'string' &&
        'accepted' in req.body &&
        typeof req.body.accepted === 'boolean'
    )) {
        res.status(400).end('400 Bad Request');
    } else {
        let table = (req.body.type === 'ad') ? 'AdRoles' : 'UserPosts';
        let idColName = (req.body.type === 'ad') ? 'AdID' : 'PostID';
        if (req.body.accepted)
            appService.acceptColab(table, idColName, req.body.id, auth.user);
        else
            appService.rejectColab(table, idColName, req.body.id, auth.user);
        res.status(204).end('204 No Content');
    }
});

router.post('/getLocations', async (req, res) => {
    if (!(
        // An attribute appearing implies that it is boolean
        (!('id' in req.body) || (typeof req.body.id === 'boolean')) &&
        (!('name' in req.body) || (typeof req.body.name === 'boolean')) &&
        (!('latitude' in req.body) || (typeof req.body.latitude === 'boolean')) &&
        (!('longitude' in req.body) || (typeof req.body.longitude === 'boolean')) &&
        (!('altitude' in req.body) || (typeof req.body.altitude === 'boolean')) &&
        (!('city' in req.body) || (typeof req.body.city === 'boolean')) &&
        (!('country' in req.body) || (typeof req.body.country === 'boolean'))
    )) res.status(400).end('400 Bad Request');
    else res.status(200).type('application/json').end(JSON.stringify(await appService.getLocations(req.body)));
});

router.get('/getProductCategories', async (req, res) => {
    res.status(200).type('application/json').end(JSON.stringify(await appService.getProductCategories()));
});

router.get('/getSongs', async (req, res) => {
    res.status(200).type('application/json').end(JSON.stringify(await appService.getSongs()));
});

router.post('/newPost', async (req, res) => {
    async function validate() {
        // If a caption is present, but it is either not a string or too long, reject it
        if (
            ('caption' in req.body) &&
            ((typeof req.body.caption !== 'string') || (req.body.caption.length > 4000))
        ) return { valid: false, reason: 'Caption' };

        // If a location is specified, but is not a string or not in the database, reject it
        else if (
            ('location' in req.body) &&
            ((typeof req.body.location !== 'string') || !(await appService.locationIDExists(req.body.location)))
        ) return { valid: false, reason: 'Location' };

        // If the type is excluded, or is not one of the allowed values, reject it
        else if (
            !('type' in req.body) ||
            !(['normal', 'listing', 'story'].includes(req.body.type))
        ) return { valid: false, reason: 'Type' };

        switch (req.body.type) {
            case 'listing':
                // If the title is excluded, is not a string, or is too long, reject
                if (
                    !('title' in req.body) ||
                    (typeof req.body.title !== 'string') ||
                    (req.body.title.length > 32)
                ) return { valid: false, reason: 'Title' };

                // If the price is excluded, is not a number, or is negative, reject
                else if (
                    !('price' in req.body) ||
                    (typeof req.body.price !== 'number') ||
                    (req.body.price < 0)
                ) return { valid: false, reason: 'Price' };

                // If the product category is excluded, is not a string, or does not exist in the database, reject
                else if (
                    !('category' in req.body) ||
                    (typeof req.body.category !== 'string') ||
                    !(await appService.productCategoryIDExists(req.body.category))
                ) return { valid: false, reason: 'Categorry' };
                break;

            case 'story':
                // If a song is included, but is not a string or does not exist in the database, reject
                if (
                    ('song' in req.body) && (
                        (typeof req.body.song !== 'string') ||
                        !(await appService.songIDExists(req.body.song))
                    )
                ) return { valid: false, reason: 'Song' };
                break;
        }

        // Attempt to parse all of the files, and check that they are an appropriate type
        let parsedFiles;
        try {
            parsedFiles = req.body.files.map(file => dataUriToBuffer(file));
            parsedFiles.forEach((file, index) => {
                if (!(file.type.startsWith('image/') || file.type.startsWith('video/'))) {
                    throw new Error(`Invalid file type ${file.type} of file ${index}`);
                }
            });
        } catch (error) {
            console.log(error);
            return { valid: false, reason: 'Files' };
        }

        // If we found no reason to reject this post, accept it
        return { valid: true, parsedFiles: parsedFiles };
    }

    let auth = await getAuthenticatedUser(req);
    if (!auth.isAuthenticated) fail401(res);
    else {
        let validation = await validate();
        if (validation.valid) {
            res.status(200).end(JSON.stringify({
                id: (await appService.createPost(req.body, auth.user, validation.parsedFiles))
            }));
        } else res.status(400).end(`400 Bad Request: ${validation.reason}`);
    }
});

router.post('/getPost', async (req, res) => {
    let auth = await getAuthenticatedUser(req);

    if (!('postID' in req.body && (typeof req.body.postID === 'string'))) {
        res.status(400).end('400 Bad Request');
    } else {
        let post = await appService.getPost(req.body.postID, auth.user);
        if (post === undefined)
            res.status(404).end('404 Not Found');
        else
            res.status(200).type('application/json').end(JSON.stringify(post));
    }
});

router.post('/getComments', async (req, res) => {
    if (!('postID' in req.body && (typeof req.body.postID === 'string'))) {
        res.status(400).end('400 Bad Request');
    } else {
        res.status(200).type('application/json').end(JSON.stringify(await appService.getComments(req.body.postID)));
    }
});

router.post('/deletePost', async (req, res) => {
    let auth = await getAuthenticatedUser(req);

    if (!auth.isAuthenticated) fail401(res);
    else if (!('postID' in req.body && (typeof req.body.postID === 'string')))
        res.status(400).end('400 Bad Request');
    else if (!(await appService.postIDExists(req.body.postID)))
        res.status(404).end('404 Not Found');
    else if (!(
        (await appService.userIsCreator(auth.user, req.body.postID)) ||
        (await appService.getAdminStatusByUserID(auth.user))
    ))
        res.status(403).end('403 Forbidden');
    else {
        await appService.deletePost(req.body.postID);
        res.status(204).end('204 No Content');
    }
})

router.post('/user', async (req, res) => {
    const { js, userID } = req.body;
    let username = await appService.getUsername(userID);
    let displayName = await appService.getDisplayName(userID);
    let zodiac = await appService.getZodiacSign(userID);
    let bio = await appService.getUserBio(userID);
    let location = await appService.getLocationName(userID);
    let adminStatus = await appService.getAdminStatusByUserID(userID);
    let followers = await appService.getFollowers(userID);
    let following = await appService.getFollowing(userID);
    res.status(200).json({
        username: username,
        displayName: displayName,
        zodiac: zodiac,
        bio: bio,
        location: location,
        adminStatus: adminStatus,
        followers: followers,
        following: following,
    });
});


router.post('/getChat', async (req, res) => {
    let auth = await getAuthenticatedUser(req);
    let senderID = auth.user;
    let { js, searchedUser } = req.body;
    let receiverID = "0";
    if (await appService.userExists(searchedUser)) {
        receiverID = await appService.getUserId(searchedUser);
    } else {
        res.status(404).end(JSON.stringify({
            userExists: false // user with that name does not exist, so can't create a message group
        }))
        return;
    }

    let groupID = await appService.chatExists(senderID, receiverID) // groupID if group exists, 0 if not
    if (groupID === 0) {
        groupID = await appService.createNewChat(senderID, receiverID);
    }

    res.status(200).end(JSON.stringify({
        sender: senderID,
        receiver: receiverID,
        userExists: true,
        groupID: groupID,
    }))
}
)

router.post("/createMessageGroup", async (req, res) => {
    let auth = await getAuthenticatedUser(req);
    let senderID = auth.user;
    let { js, users, groupName } = req.body;
    let usersID = await Promise.all(users.map(async user => await appService.getUserId(user)));
    usersID.push(senderID);
    let groupID = await appService.createNewGroup(usersID, groupName);
    res.status(200).end(JSON.stringify({
        groupID: groupID,
    }))
})

router.post("/getMessageGroups", async (req, res) => {
    let auth = await getAuthenticatedUser(req);
    let senderID = auth.user;
    let group;
    group = await appService.getMessageGroups(senderID);
    let groupsID = [];
    let groupsName = [];
    for (let g of group) {
        groupsID.push(g.groupID);
        groupsName.push(g.groupName);
    }

    res.status(200).end(JSON.stringify({
        groupsID: groupsID,
        groupsName: groupsName,
    }))
}
)


// also checks if the requested user is authenticated to see the group (i.e. in the group)
router.post("/getGroupName", async (req, res) => {
    let { js, groupID } = req.body;
    let groupName = await appService.getGroupNameFromID(groupID);
    let auth = await getAuthenticatedUser(req);
    let userID = auth.user;
    let isInGroup = await appService.isInMessageGroup(userID, groupID)
    res.status(200).end(JSON.stringify({
        groupName: groupName,
        isInGroup: isInGroup,
    }))
})

router.post("/sendMessage", async (req, res) => {
    let { js, groupID, message } = req.body;
    let auth = await getAuthenticatedUser(req);
    if (auth.isAuthenticated === false) {
        res.status(401);
        return;
    }
    let senderID = auth.user;
    let senderName = await appService.getUsername(senderID);
    let time = await appService.sendMessage(groupID, senderID, message);
    time = time.toString().substring(0, 25)
    res.status(200).end(JSON.stringify({
        sender: senderName,
        time: time,
    }))
})

router.post("/getMessages", async (req, res) => {
    let { js, groupID } = req.body;
    let messages = await appService.getMessages(groupID);
    let timeArray = [];
    let textArray = [];
    let senderArray = [];
    messages.forEach(message => {
        timeArray.push(message.time);
        textArray.push(message.text);
        senderArray.push(message.sender);
    });
    let senderNames = await Promise.all(senderArray.map(async senderID => {
        return await appService.getUsername(senderID);
    }))
    timeArray = timeArray.map(time => {
        return time.toString().substring(0, 25);
    })
    res.status(200).end(JSON.stringify({
        timeArray: timeArray,
        textArray: textArray,
        senderNames: senderNames,
        senderID: senderArray,
    }))
})



// LOCATIONS
router.get('/getLocations', async (req, res) => {
    try {
        const locations = await appService.getLocations();
        res.json({ success: true, locations });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
router.post('/updateLocation', async (req, res) => {
    const { locationId, ...locationData } = req.body;
    try {
        const success = await appService.updateLocation(locationId, locationData);
        if (success) {
            res.json({ success: true });
        } else {
            res.status(400).json({ success: false, message: "Failed to update location" });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
router.post('/createLocation', async (req, res) => {
    const locationData = req.body;
    try {
        const success = await appService.createLocation(locationData);
        if (success) {
            res.json({ success: true });
        } else {
            res.status(400).json({ success: false, message: "Failed to create location" });
        }
    } catch (error) {
        console.error(error);
        res.status(500).send('Error creating location');
    }
});
router.post('/deleteLocation', async (req, res) => {
    try {
        const locationId = req.body.locationId;
        const success = await appService.deleteLocation(locationId);
        if (success) {
            res.json({ success: true });
        } else {
            res.status(404).json({ success: false, message: 'Location not found' });
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Error deleting location' });
    }
});
// SONGS
router.get('/getSongs', async (req, res) => {
    try {
        const songs = await appService.getSongs();
        res.json({ success: true, songs });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/updateSong', async (req, res) => {
    const { songId, ...songData } = req.body;
    try {
        const success = await appService.updateSong(songId, songData);
        if (success) {
            res.json({ success: true });
        } else {
            res.status(400).json({ success: false, message: "Failed to update song" });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
// SETTINGS
router.post('/settings', async (req, res) => {
    let auth = await getAuthenticatedUser(req);
    if (!auth.isAuthenticated) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    const { username, password, birthday, displayName, bio, location } = req.body;
    const settings = {};
    if (username) settings.username = username;
    if (password) settings.password = password;
    try {
        const success = await appService.updateUserSettings(auth.user, settings);
        if (success) {
            res.json({ success: true, message: 'Settings updated successfully.' });
        } else {
            res.status(400).json({ success: false, message: 'Failed to update settings.' });
        }
    } catch (error) {
        console.error('Error updating settings:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});
router.get('/blocked-users', async (req, res) => {
    let auth = await getAuthenticatedUser(req);
    if (!auth.isAuthenticated) {
        return res.status(401).send('Unauthorized');
    }
    try {
        const blockedUsers = await appService.getBlockedUsers(auth.user);
        res.json({ success: true, blockedUsers });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: error.message });
    }
});
router.get('/getProductCategories', async (req, res) => {
    try {
        const categories = await appService.getProductCategories();
        res.json({ success: true, categories });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
// PRODUCT CATEGORIES
router.get('/getProductCategories', async (req, res) => {
    try {
        const categories = await appService.getProductCategories();
        res.json({ success: true, categories });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/checkCategoryExists', async (req, res) => {
    const { name } = req.body;
    try {
        const exists = await appService.checkCategoryExists(name);
        res.json({ exists });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
router.post('/addCategory', async (req, res) => {
    const { name } = req.body;

    try {
        const success = await appService.addProductCategory(name);
        if (success) {
            res.json({ success: true, message: 'Category added successfully.' });
            return;
        } else {
            res.status(400).json({ success: false, message: 'Failed to add category.' });
            return;
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
        return;
    }
});

router.post('/deleteCategory', async (req, res) => {
    const { categoryId } = req.body;
    try {
        const success = await appService.deleteProductCategory(categoryId);
        if (success) {
            res.json({ success: true, message: 'Category deleted successfully.' });
        } else {
            res.status(404).json({ success: false, message: 'Category not found or already deleted.' });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
// LOCATION
router.get('/get-posts-by-location', async (req, res) => {
    const { locationId } = req.query;
    if (!locationId) {
        return res.status(400).json({ error: 'Location ID is required' });
    }
    try {
        const posts = await appService.getPostsByLocation(locationId);
        if (posts) {
            res.json({ locationName: posts.locationName, posts: posts.posts });
        } else {
            res.status(404).json({ error: 'Location not found' });
        }
    } catch (error) {
        console.error('Error fetching posts by location:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.post("/addMember", async (req, res) => {
    let { js, groupID, username } = req.body;
    let exists = await appService.userExists(username);
    if (!exists) {
        res.status(401).end(JSON.stringify({
            userExists: exists,
            userAdded: false,
        }))
        return;
    }
    let userID = await appService.getUserId(username);
    let added = await appService.addUserToGroup(userID, groupID);
    res.status(200).end(JSON.stringify({
        userExists: exists,
        userAdded: added,
    }))
})

router.post("/getUserLocationID", async (req, res) => {
    let { js, locationName } = req.body;
    return await appService.getLocationIDFromName(locationName);
})

router.post("/getAdminStatus", async (req, res) => {
    let auth = await getAuthenticatedUser(req);
    if (!auth.isAuthenticated) {
        res.status(200).end(JSON.stringify({
            adminStatus: false,
        }))
        return;
    }
    let user = auth.user;
    let adminStatus = await appService.getAdminStatus(user);
    if (adminStatus) {
        res.status(200).end(JSON.stringify({
            adminStatus: true,
        }))
        return;
    } else {
        res.status(200).end(JSON.stringify({
            adminStatus: false,
        }))
        return;
    }
})
router.post("/makeAdmin", async (req, res) => {
    let { js, userID } = req.body;
    let result = await appService.makeAdmin(userID);
    if (result) {
        res.status(200).end(JSON.stringify({
            successful: true,
        }))
        return;
    } else {
        res.status(200).end(JSON.stringify({
            successful: false,
        }))
        return;
    }
})

router.post("/removeAdmin", async (req, res) => {
    let { js, userID } = req.body;
    let result = await appService.makeAdmin(userID);
    if (result) {
        res.status(200).end(JSON.stringify({
            successful: true,
        }))
        return;
    } else {
        res.status(200).end(JSON.stringify({
            successful: false,
        }))
        return;
    }
})

router.post("/deleteUser", async (req, res) => {
    let { js, userID } = req.body;
    let result = await appService.deleteUser(userID);
    if (result) {
        res.status(200).end(JSON.stringify({
            successful: true,
        }))
        return;
    } else {
        res.status(200).end(JSON.stringify({
            successful: false,
        }))
        return;
    }
})

router.post("/followUser", async (req, res) => {
    let { js, userID } = req.body;
    let auth = await getAuthenticatedUser(req);
    let user = auth.user;
    if (user === undefined) { // Not logged in
        res.status(200).end(JSON.stringify({
            successful: false,
            authenticated: false,
            sameUser: false
        }))
        return;
    }
    if (userID === user) { // User trying to follow themselves
        res.status(200).end(JSON.stringify({
            successful: false,
            authenticated: true,
            sameUser: true
        }))
        return;
    }
    let result = await appService.followUser(user, userID);
    if (result) {
        res.status(200).end(JSON.stringify({
            successful: true,
            authenticated: true,
            sameUser: false
        }))
        return;
    } else {
        res.status(200).end(JSON.stringify({
            successful: false,
            authenticated: true,
            sameUser: false
        }))
        return;
    }
})


router.post("/unfollowUser", async (req, res) => {
    let { js, userID } = req.body;
    let auth = await getAuthenticatedUser(req);
    let user = auth.user;
    if (user === undefined) { // Not logged in
        res.status(200).end(JSON.stringify({
            successful: false,
            authenticated: false,
            sameUser: false
        }))
        return;
    }
    if (userID === user) { // User trying to unfollow themselves
        res.status(200).end(JSON.stringify({
            successful: false,
            authenticated: true,
            sameUser: true
        }))
        return;
    }
    let result = await appService.unfollowUser(user, userID);
    if (result) {
        res.status(200).end(JSON.stringify({
            successful: true,
            authenticated: true,
            sameUser: false
        }))
        return;
    } else {
        res.status(200).end(JSON.stringify({
            successful: false,
            authenticated: true,
            sameUser: false
        }))
        return;
    }
})

router.post("/getTables", async (req, res) => {
    let result = await appService.getTables();
    res.status(200).end(JSON.stringify({
        table: result,
    }))
})

router.post("/getAttributes", async (req, res) => {
    let { js, value } = req.body;
    // Protect against SQL injection by enforcing that the table actually exists
    let tables = (await appService.getTables()).map(row => row[0])
    if (!(tables.includes(value))) {
        res.status(400).end();
        return;
    }

    let attributes = await appService.getAttributes(value);
    res.status(200).end(JSON.stringify({
        attributes: attributes,
    }))
})

router.post("/getSelectedAttributes", async (req, res) => {
    let { js, selectedTable, selectedAttributes } = req.body;
    let result = await appService.getSelectedAttributes(selectedTable, selectedAttributes);
    // Protect against SQL injection by enforcing that the table and attributes actually exist
    let tables = (await appService.getTables()).map(row => row[0])
    if (!(tables.includes(selectedTable))) {
        res.status(400).end();
        return;
    }

    let allAttributes = (await appService.getAttributes(selectedTable)).map(row => row[0]);
    for (let selectedAttribute of selectedAttributes) {
        if (!allAttributes.includes(selectedAttribute)) {
            res.status(400).end();
            return;
        }
    }

    if (!result) {
        res.status(404).end();
        return;
    }
    res.status(200).end(JSON.stringify({
        data: result,
    }))

})


router.post("/getAdClicks", async(req, res) => {
    let result = await appService.getAdClicks();
    if (!result)  {
        res.status(401).end(); 
        return;}

    const adIDs = result.map(([adID, _]) => adID);
    const clickCounts = result.map(([_, clickCount]) => clickCount);

    res.status(200).end(JSON.stringify({
        adID: adIDs,
        clicks: clickCounts
    }))

})

router.post("/getSuccessfulAds", async(req,res) => {
    let {js, clickRate} = req.body;
    let result = await appService.getSuccessfulAds(clickRate);
    if (!result)  {
        res.status(401).end(); 
        return;}

    const adIDs = result.map(([adID, _, _x]) => adID);
    const  totalShows = result.map(([_x, totalShows, _]) => totalShows);
    const  totalClicks = result.map(([_x,_, totalClicks]) => totalClicks);
    res.status(200).end(JSON.stringify({
        adID: adIDs,
        totalShows: totalShows,
        totalClicks: totalClicks
    }))
})

router.post("/getActiveUsers", async(req, res) => {
    let {js, time} = req.body;
    result = await appService.getActiveUsers(time);
    if(!result) {
        res.status(401).end();
        return;
    }
    const userIDs = result.map(([userID, _, _x]) => userID);
    const  totalPosts = result.map(([_x, totalPost, _]) => totalPost);
    const  latestPost = result.map(([_x,_, latestPost]) => latestPost);
    res.status(200).end(JSON.stringify({
        userID: userIDs,
        totalPosts: totalPosts,
        latestPost: latestPost,
    }))
})

router.post("/getUsernames", async(req, res) => {
    let {js, userID} = req.body;
    let usernames = [];
    await Promise.all(userID.map(async (id) => {
        usernames.push(await appService.getUsername(id));
    }));

    res.status(200).end(JSON.stringify({
        usernames: usernames
    }));
})

router.post("/getViewedAds" , async(req, res) => {
    let result = await appService.getViewedAds();
    if (!result) {
        res.status(404).end();
        return;
    }
    res.status(200).end(JSON.stringify({
        ads:result,
    }))
})

router.post("/search", async(req, res) => {
    let {js, inputs, inputNames, options} = req.body;
    inputArray = Object.values(inputs);
    options = Object.values(options);
    var filteredInputs = inputArray.filter(value => value !== "");
    var filteredOptions = options.filter((value, index) => inputArray[index+1] !== "" && inputArray[index+1] !== undefined);
    var filteredInputNames = inputNames.filter((value, index) => inputArray[index] !== "" && inputArray[index] !== undefined);
    if(filteredInputNames.includes('locationID')) {
        let index = filteredInputNames.indexOf('locationID');
        let location = await appService.getLocationIDFromName(filteredInputs[index]);
        if(!location) {
            filteredInputs[index] = null;
        } else  filteredInputs[index] = location; 
    }

    if(filteredInputNames.includes('birthday')) {
        let index = filteredInputNames.indexOf('birthday');
        filteredInputs[index] = new Date(filteredInputs[index]);
        filteredInputs[index] = filteredInputs[index].toISOString();
    }
    let query = "";
    let parameters = {};

    for (let i = 0; i < filteredInputNames.length; i++) {
        if(filteredInputNames.length === 1 ) {
            query += filteredInputNames[i] + "= :" + filteredInputNames[i] + " ";
            parameters[filteredInputNames[i]] = filteredInputs[i];
        break;
        }
        query += filteredInputNames[i] + "= :" + filteredInputNames[i] + " " + filteredOptions[i] + " ";
        parameters[filteredInputNames[i]] = filteredInputs[i];
}
    query = query.replace(/undefined/g,'');

    let result = await appService.search(query, parameters);
    if(!result) {
        res.status(404).end();
    }

    let names = [];
    let ids = [];
    for (let i = 0; i < result.length; i++) {
    let [name, id] = result[i];
    names.push(name);
    ids.push(id);
}

    res.status(200).end(JSON.stringify({
        names: names,
        ids: ids,
    }))
})


module.exports = router;
module.exports.setupPool = appService.setupPool;