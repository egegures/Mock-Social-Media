const oracledb = require('oracledb');
const loadEnvFile = require('./utils/envUtil');
const bcrypt = require('bcrypt');
let fs;
try {
    fs = require('node:fs/promises');
} catch {
    // Accomodate the ancient version of Node used by UBC servers
    fs = require('fs').promises;
}
const mimeTypes = require('mime-types');
const { query } = require('express');

const envVariables = loadEnvFile('./.env');

// Database configuration setup. Ensure your .env file has the required database credentials.
const dbConfig = {
    user: envVariables.ORACLE_USER,
    password: envVariables.ORACLE_PASS,
    connectString: `${envVariables.ORACLE_HOST}:${envVariables.ORACLE_PORT}/${envVariables.ORACLE_DBNAME}`,
    poolMax: 1,
};

let pool;
async function setupPool() {
    pool = await oracledb.createPool(dbConfig);
}

// ----------------------------------------------------------
// Wrapper to manage OracleDB actions, simplifying connection handling.
async function withOracleDB(action) {
    let connection;
    try {
        connection = await pool.getConnection();
        return await action(connection);
    } catch (err) {
        console.error(err);
        throw err;
    } finally {
        if (connection) {
            try {
                await connection.close();
            } catch (err) {
                console.error(err);
            }
        }
    }
}


// ----------------------------------------------------------
// Core functions for database operations
// Modify these functions, especially the SQL queries, based on your project's requirements and design.
async function testOracleConnection() {
    return await withOracleDB(async (connection) => {
        return true;
    }).catch(() => {
        return false;
    });
}

async function fetchDemotableFromDb() {
    return await withOracleDB(async (connection) => {
        const result = await connection.execute('SELECT * FROM DEMOTABLE');
        return result.rows;
    }).catch(() => {
        return [];
    });
}

async function initiateDemotable() {
    return await withOracleDB(async (connection) => {
        try {
            await connection.execute(`DROP TABLE DEMOTABLE`);
        } catch (err) {
            console.log('Table might not exist, proceeding to create...');
        }

        const result = await connection.execute(`
            CREATE TABLE DEMOTABLE (
                id NUMBER PRIMARY KEY,
                name VARCHAR2(20)
            )
        `);
        return true;
    }).catch(() => {
        return false;
    });
}

async function insertDemotable(id, name) {
    return await withOracleDB(async (connection) => {
        const result = await connection.execute(
            `INSERT INTO DEMOTABLE (id, name) VALUES (:id, :name)`,
            [id, name],
            { autoCommit: true }
        );

        return result.rowsAffected && result.rowsAffected > 0;
    }).catch(() => {
        return false;
    });
}

async function updateNameDemotable(oldName, newName) {
    return await withOracleDB(async (connection) => {
        const result = await connection.execute(
            `UPDATE DEMOTABLE SET name=:newName where name=:oldName`,
            [newName, oldName],
            { autoCommit: true }
        );

        return result.rowsAffected && result.rowsAffected > 0;
    }).catch(() => {
        return false;
    });
}

async function countDemotable() {
    return await withOracleDB(async (connection) => {
        const result = await connection.execute('SELECT Count(*) FROM DEMOTABLE');
        return result.rows[0][0];
    }).catch(() => {
        return -1;
    });
}

async function userExists(username) {
    return await withOracleDB(async (connection) => {
        let queryResult = await connection.execute('SELECT DISTINCT Username FROM Users WHERE Username=:username', [username]);
        return queryResult.rows.length > 0;
    })
}

async function passwordCorrect(username, password) {
    return await userExists(username) && await withOracleDB(async (connection) => {
        const queryResult = await connection.execute('SELECT DISTINCT PasswordHash FROM Users WHERE Username=:username', [username]);
        return await bcrypt.compare(password, queryResult.rows[0][0]);
    })
}

async function getUserId(username) {
    return await withOracleDB(async (connection) => {
        return (await connection.execute('SELECT DISTINCT UserID FROM Users WHERE Username=:username', [username])).rows[0][0];
    });
}

function generateId() {
    const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < 16; i++)
        result += CHARS[Math.floor(Math.random() * CHARS.length)];
    return result;
}

async function createUser(username, password) {
    return await bcrypt.hash(password, 12).then(hash => {
        return withOracleDB(async (connection) => {
            let userCount = (await connection.execute('SELECT Count(*) FROM Users')).rows[0][0];
            return [hash, userCount];
        })
    }).then(([hash, userCount]) => {
        let id = generateId();
        let isAdmin = (userCount === 0) ? 1 : 0; // If we are creating the first user, that user is an admin
        return withOracleDB(async (connection) => {
            await connection.execute('INSERT INTO Users (UserID, Username, PasswordHash, IsAdmin) VALUES (:id, :username, :hash, :isAdmin)', [id, username, hash, isAdmin], { autoCommit: true });
            return id;
        });
    });
}

async function getUserHash(userID) {
    return await withOracleDB(async (connection) => {
        return (await connection.execute('SELECT DISTINCT PasswordHash FROM Users WHERE UserID=:id', [userID])).rows;
    });
}

/**
 * Given an array of objects, remove all duplicates and merge one key into a list.
 *
 * Whether two objects are a "duplicate" is determined by looking at the value of the key specified in key. Even though other values aren't checked, they are still expected to be the same if the key is the same, except for the key specified in merge, which is expected to be different between duplicates. In the returned object, the value of the key specified in merge will be an array of all individual values encountered for that key.
 *
 * Example:
 * objects = [
 *   {a: 1, b: 2, c: 3},
 *   {a: 2, b: 2, c: 3},
 *   {a: 3, b: 3, c: 4}
 * ]
 * dedupeAndMerge(objects, 'b', 'a')
 *
 * Returns:
 * [
 *   {a: [1, 2], b: 2, c: 3},
 *   {a: [3], b: 3, c: 4}
 * ]
 *
 * @param objects - The array of objects
 * @param key - Identify duplicates
 * @param merge - The key to merge
 * @returns the deduplicated object
 */
//TODO try to eliminate with database queries
function dedupeAndMerge(objects, key, merge) {
    let result = [];
    let keysAdded = {};  // Track the keys separately to make checking whether they are there a little less annoying. Also track the index they were added into the result at

    for (let object of objects) {
        let keyValue = object[key];
        // If we have already added this object to the result, add the new value of the merge key to the existing object
        if (keyValue in keysAdded)
            result[keysAdded[keyValue]][merge].push(object[merge]);

        // Otherwise, add (a shallow copy of) the object to the result, and replace the merge key with an array containing only the current value.
        else {
            let toAdd = { ...object };
            toAdd[merge] = [toAdd[merge]];
            keysAdded[keyValue] = result.push(toAdd) - 1;
        }
    }

    return result;
}

async function getFeedStories(userID) {
    let postsQueryResult = (await withOracleDB(async (connection) => {
        return await connection.execute(
            `SELECT DISTINCT UserID, PostID, "Time", Expires
            FROM (UserPosts NATURAL JOIN Posts) NATURAL LEFT JOIN Listings
            WHERE PostID IN (
                SELECT PostID
                FROM UserPosts
                WHERE UserID IN (
                    SELECT "Following"
                    FROM Follows
                    WHERE Follower=:id
                )
                AND Expires IS NOT NULL
                AND :now < Expires
                AND ("Role"=1 OR "Role"=2)
            )
            AND ("Role"=1 OR "Role"=2)
            ORDER BY "Time" DESC`,
            [userID, (new Date())]
        );
    }));

    return dedupeAndMerge(postsQueryResult.rows.map(row => {
        return {
            userID: row[0],
            postID: row[1],
            time: row[2],
            expires: row[3]
        };
    }), 'postID', 'userID');
}


async function getBannerAd(userID) {
    return await withOracleDB(async (connection) => {
        let adQueryResult = await connection.execute(
            'SELECT AdID, ImageURL, ClickURL ' +
            'FROM Advertisements ' +
            'WHERE RemainingViews > 0 ' +
            'ORDER BY DBMS_RANDOM.VALUE ' +
            'FETCH FIRST 1 ROWS ONLY'
        );
        if (adQueryResult.rows.length === 0) return undefined;

        let adID = adQueryResult.rows[0][0];
        connection.execute(
            'UPDATE Advertisements ' +
            'SET RemainingViews = RemainingViews - 1 ' +
            'WHERE AdID=:id',
            [adID]
        );
        let showingID = generateId();
        connection.execute(
            'INSERT INTO AdShowing (AdShowingId, "Time", Clicked, AdID, UserID) ' +
            'VALUES (:showingID, :time, 0, :adID, :userID)',
            [showingID, new Date(), adID, userID],
            { autoCommit: true }
        );

        // The JSON to send to the client
        return {
            imageURL: adQueryResult.rows[0][1],
            clickURL: adQueryResult.rows[0][2],
            showingID: showingID
        };
    });
}

async function getFeedPosts(userID) {
    let postsQueryResult = (await withOracleDB(async (connection) => {
        return await connection.execute(
            // 1. Find all users who we follow
            // 2. Find all posts that they are either the creator or a collaborator
            // 3. Select the relevant info
            // Yes, the two role checks are necessary. The first one insures we only get posts where a follower is a collaborator. The second one makes sure that we only get collaborators that have accepted.
            //               0       1       2       3        4             5
            `SELECT DISTINCT UserID, PostID, "Time", Caption, ListingTitle, Price
            FROM (UserPosts NATURAL JOIN Posts) NATURAL LEFT JOIN Listings
            WHERE PostID IN (
                SELECT PostID
                FROM UserPosts
                WHERE UserID IN (
                    SELECT "Following"
                    FROM Follows
                    WHERE Follower=:id
                )
                AND Expires IS NULL
                AND ("Role"=1 OR "Role"=2)
            )
            AND ("Role"=1 OR "Role"=2)
            ORDER BY "Time" DESC`,
            [userID]
        );
    }));

    // Each post gets listed one time for each collaborator, so we merge them for the client
    return dedupeAndMerge(postsQueryResult.rows.map(row => {
        let result = {
            userID: row[0],
            postID: row[1],
            time: row[2],
            caption: row[3],
        };
        if (row[4] !== null) {
            result.title = row[4]
            result.price = row[5]
        }
        return result;
    }), 'postID', 'userID');
}

async function adShowingExists(showingID) {
    return await withOracleDB(async (connection) => {
        let queryResult = await connection.execute('SELECT DISTINCT Count(*) FROM AdShowing WHERE AdShowingID=:id', [showingID]);
        return queryResult.rows[0][0] > 0;
    });
}

async function clickAd(showingID) {
    await withOracleDB(async (connection) => {
        await connection.execute('UPDATE AdShowing SET Clicked = 1 WHERE AdShowingID=:id', [showingID], { autoCommit: true });
    });
}

async function getUsername(userID) {
    return await withOracleDB(async (connection) => {
        let queryResult = (await connection.execute('SELECT DISTINCT Username FROM Users WHERE UserID=:id', [userID])).rows;
        if (queryResult.length === 0) return undefined;
        else return queryResult[0][0];
    });

}

async function getDisplayName(userID) {
    let result = await withOracleDB(async (connection) => {
        let queryResult = (await connection.execute('SELECT DISTINCT DisplayName FROM Users WHERE UserID=:id', [userID])).rows;
        if (queryResult.length === 0) return undefined;
        else return queryResult[0][0];
    });

    if (result === undefined || result === null) return await getUsername(userID);
    else return result;
}

async function getAdminStatusByUserID(userID) {
    let queryResult = (await withOracleDB(async (connection) => {
        return await connection.execute('SELECT DISTINCT IsAdmin FROM Users WHERE UserID=:id', [userID]);
    })).rows;
    if (queryResult.length === 0) return false; // A nonexistent user is not an admin
    else return queryResult[0][0] === 1;
}

async function getPostCollaborationRequests(userID) {
    let queryResults = await withOracleDB(async (connection) => {
        return await connection.execute(
            `SELECT DISTINCT UserID, PostID, Caption
             FROM UserPosts NATURAL JOIN Posts
             WHERE PostID IN (
                SELECT DISTINCT PostID
                FROM UserPosts
                WHERE UserID=:id
                AND "Role"=0
            ) AND "Role"=2`, [userID]
        );
    });

    return await Promise.all(queryResults.rows.map(async row => {
        return {
            userID: row[0],
            postID: row[1],
            username: await getUsername(row[0]),
            caption: row[2]
        };
    }));
}

async function getAdCollaborationRequests(userID) {
    let queryResults = await withOracleDB(async (connection) => {
        return await connection.execute(
            `SELECT DISTINCT UserID, AdID, ClickURL
             FROM AdRoles NATURAL JOIN Advertisements
             WHERE AdID IN (
                SELECT DISTINCT AdID
                FROM AdRoles
                WHERE UserID=:id
                AND "Role"=0
            ) AND "Role"=2`, [userID]
        );
    });

    return await Promise.all(queryResults.rows.map(async row => {
        return {
            userID: row[0],
            adID: row[1],
            username: await getUsername(row[0]),
            clickURL: row[2]
        };
    }));
}

async function acceptColab(table, idColName, id, userID) {
    await withOracleDB(async (connection) => {
        await connection.execute(
            // Regular formatting being used because Oracle doesn't like using bindvars for table and column names.
            // This shouldn't be vulnerable to sql injection because table and idColName can only be one of a few hardcoded values. The only values coming from the client are id and userID, and those are properly sanitized.
            `UPDATE ${table} SET "Role"=1 WHERE ${idColName} = :id AND UserID = :userID`,
            [id, userID],
            { autoCommit: true });
    });
}

async function rejectColab(table, idColName, id, userID) {
    await withOracleDB(async (connection) => {
        await connection.execute(
            `DELETE FROM ${table} WHERE ${idColName} = :id AND UserID = :userID`,
            [id, userID],
            { autoCommit: true });
    });
}

async function getLocations(requestedItems) {
    let queryColumnNames = [];
    let resultKeyNames = [];

    if (requestedItems['id']) {
        queryColumnNames.push('LocationID');
        resultKeyNames.push('id');
    } if (requestedItems['name']) {
        queryColumnNames.push('LocationName');
        resultKeyNames.push('name');
    } if (requestedItems['latitude']) {
        queryColumnNames.push('Latitude');
        resultKeyNames.push('latitude');
    } if (requestedItems['longitude']) {
        queryColumnNames.push('Longitude');
        resultKeyNames.push('longitude');
    } if (requestedItems['altitude']) {
        queryColumnNames.push('Altitude');
        resultKeyNames.push('altitude');
    } if (requestedItems['city']) {
        queryColumnNames.push('City');
        resultKeyNames.push('city');
    } if (requestedItems['country']) {
        queryColumnNames.push('Country');
        resultKeyNames.push('country');
    }

    let queryResult = await withOracleDB(async (connection) => {
        return (await connection.execute(
            `SELECT DISTINCT ${queryColumnNames.join(', ')}
            FROM Locations NATURAL JOIN Regions`
        )).rows;
    });

    return queryResult.map(row => {
        let location = {}
        for (let i = 0; i < row.length; i++)
            location[resultKeyNames[i]] = row[i];
        return location;
    })
}

async function getProductCategories() {
    return (await withOracleDB(async (connection) => {
        return await (connection.execute('SELECT DISTINCT ProductCategoryID, ProductCategoryName FROM ProductCategories'));
    })).rows.map(row => { return { id: row[0], name: row[1] } });
}

async function getSongs() {
    return (await withOracleDB(async (connection) => {
        return await (connection.execute('SELECT DISTINCT SongID, SongTitle, Artist, URL FROM Songs'));
    })).rows.map(row => { return { id: row[0], title: row[1], artist: row[2], url: row[3] } });
}

async function locationIDExists(locationID) {
    return await withOracleDB(async connection => {
        return (await connection.execute('SELECT Count(*) FROM Locations WHERE LocationID=:id', [locationID])).rows[0][0] > 0;
    });
}

async function productCategoryIDExists(productCategoryID) {
    return await withOracleDB(async connection => {
        return (await connection.execute('SELECT Count(*) FROM ProductCategories WHERE ProductCategoryID=:id', [productCategoryID])).rows[0][0] > 0;
    });
}

async function songIDExists(songID) {
    return await withOracleDB(async connection => {
        return (await connection.execute('SELECT Count(*) FROM Songs WHERE SongID=:id', [songID])).rows[0][0] > 0;
    });
}

async function createPost(post, user, files) {
    // Prepare columns
    let postID = generateId();
    let time = new Date();
    let expires;
    let songID;
    if (post.type === 'story') {
        expires = new Date(time);
        expires.setDate(time.getDate() + 1);
        songID = post.song;
    } else {
        expires = null;
        songID = null;
    }

    // Write all of the files to the filesystem
    async function storeFile(file) {
        let id = generateId();
        let extension = mimeTypes.extension(file.type);

        await fs.open(`public/media/${id}.${extension}`, 'w').then(async handle => {
            await handle.write(Buffer.from(file.buffer));
            handle.close();
        });

        return { id: id, url: `/media/${id}.${extension}`, type: file.type };
    }
    let fileInfo = await Promise.all(files.map(storeFile));

    await withOracleDB(async connection => {
        // Create the post itself
        await connection.execute(
            `INSERT INTO Posts(PostID, "Time", Caption, LocationID, Expires, SongID)
            Values (:postID, :time, :caption, :locationID, :expires, :songID)`, [
            postID,
            time,
            ('caption' in post) ? post.caption : null,
            ('location' in post) ? post.location : null,
            expires,
            songID
        ]);

        // If necessary, create the listing
        if (post.type === 'listing') {
            await connection.execute(
                `INSERT INTO Listings(PostID, ListingTitle, Price, ProductCategoryID)
                VALUES (:id, :title, :price, :category)`,
                [postID, post.title, post.price, post.category]
            );
        }

        // Register the media into the database
        await Promise.all(fileInfo.map((file, index) => connection.execute(
            `INSERT INTO Media(MediaID, "URL", PostID, UserID, "Index", "Type")
            VALUES (:id, :mediaUrl, :postID, :userID, :idx, :ftype)`,
            [file.id, file.url, postID, user, index, file.type]
        )));

        // Associate the post with the user
        await connection.execute(
            `INSERT INTO UserPosts(UserID, PostID, "Role")
            VALUES (:userID, :postID, 2)`,
            [user, postID],
            { autoCommit: true }
        );
    });

    return postID;
}

async function getPost(postID, userID) {
    let json = await withOracleDB(async connection => {
        // Get the basic post from the table
        let postQueryResult = (await connection.execute(
            //      0       1        2           3             4        5       6          7       8      9             10     11                 12
            `SELECT "Time", Caption, LocationID, LocationName, Expires, SongID, SongTitle, Artist, "URL", ListingTitle, Price, ProductCategoryID, ProductCategoryName
            FROM Posts
                NATURAL LEFT JOIN Locations
                NATURAL LEFT JOIN Songs
                NATURAL LEFT JOIN Listings
                NATURAL LEFT JOIN ProductCategories
            WHERE PostID=:postid`, [postID]
        )).rows;

        // If no post matches, return undefined
        if (postQueryResult.length === 0) return undefined;

        // Populate the json to be returned to the frontend
        let json = {
            time: postQueryResult[0][0],
            likeCount: (await connection.execute('SELECT Count(*) FROM Likes WHERE PostID=:postid', [postID])).rows[0][0]
        }
        if (postQueryResult[0][1] !== null) json.caption = postQueryResult[0][1];
        if (postQueryResult[0][2] !== null) json.location = {
            id: postQueryResult[0][2],
            name: postQueryResult[0][3]
        }
        if (postQueryResult[0][4] !== null) {
            json.expires = postQueryResult[0][3];
            json.type = 'story';    // If the post expires, it is a story
        }
        if (postQueryResult[0][5] !== null) {
            json.song = {
                id: postQueryResult[0][5],
                title: postQueryResult[0][6],
                artist: postQueryResult[0][7],
                url: postQueryResult[0][8]
            }
        }
        if (postQueryResult[0][9] !== null) {
            json.title = postQueryResult[0][9];
            json.price = postQueryResult[0][10];
            json.productCategory = {
                id: postQueryResult[0][11],
                name: postQueryResult[0][12]
            }
            json.type = 'listing' // If the post shows up in the listing table, it is a listing. Validation and eventually assertions will prevent a post from being both a listing and a story.
        }
        if (!('type' in json)) json.type = 'normal' // If this isn't a special type of post, mark it as a normal post

        // Get the media for this post
        let mediaQueryResult = (await connection.execute(
            `SELECT MediaID, "URL", "Type"
            FROM Media
            WHERE PostID=:postid
            ORDER BY "Index" ASC`,
            [postID]
        )).rows;
        json.media = mediaQueryResult.map(row => {
            return {
                id: row[0],
                url: row[1],
                type: row[2]
            }
        });

        // Get the users for this post
        let userQueryResult = (await connection.execute(
            // Select the user ID and display name of all users who are a collaborator or creator of this post
            `SELECT UserID, DisplayName
            FROM Users
            WHERE UserID IN (
                SELECT UserID
                FROM UserPosts
                WHERE PostID=:postid AND ("Role"=1 OR "Role"=2)
            )`,
            [postID]
        )).rows;
        json.users = userQueryResult.map(row => {
            return {
                id: row[0],
                displayName: row[1]
            }
        });

        // Tell the frontend which buttons to show
        if (userID === undefined) {
            // If the user is not logged in, they are neither the creator nor a collaborator
            json.isCreator = false;
            json.isCollaborator = false;
        } else {
            let ourRoleQueryResult = (await connection.execute(
                `SELECT "Role"
                FROM UserPosts
                WHERE UserID=:userid AND PostID=:postid`,
                [userID, postID]
            )).rows;
            if (ourRoleQueryResult.length === 0) {
                json.isCreator = false;
                json.isCollaborator = false;
            } else {
                json.isCreator = (ourRoleQueryResult[0][0] === 2);
                json.isCollaborator = (ourRoleQueryResult[0][0] === 1);
            }
        }
        return json;
    });

    if (json === undefined) return json;
    else {
        json.isAdmin = ((userID === undefined) ? false : getAdminStatusByUserID(userID));  // Do this outside the withOracleDB to avoid deadlock when at the connection limit
        return json;
    }
}

async function getComments(postID) {
    let commentsQueryResult = (await withOracleDB(async connection => {
        return await connection.execute(
            //      0       1       2       3
            `SELECT "Time", "Text", UserID, DisplayName
            FROM Comments NATURAL LEFT JOIN Users
            WHERE PostID=:postid`,
            [postID]
        );
    })).rows;
    return commentsQueryResult.map(row => {
        return {
            user: {
                id: row[2],
                displayName: row[3]
            },
            time: row[0],
            text: row[1]
        }
    });
}

async function postIDExists(postID) {
    return (await withOracleDB(async connection => {
        return await connection.execute(`SELECT Count(*) FROM Posts WHERE PostID=:postid`, [postID])
    })).rows[0][0] > 0;
}

async function userIsCreator(userID, postID) {
    return (await withOracleDB(async connection => {
        return await connection.execute(`SELECT Count(*) FROM UserPosts WHERE UserID=:userid AND PostID=:postid AND "Role"=2`, [userID, postID])
    })).rows[0][0] > 0;
}

async function deletePost(postID) {
    await withOracleDB(async connection => {
        connection.execute(`DELETE FROM Posts WHERE PostID=:postid`, [postID], { autoCommit: true });
    });
}

async function getUserBio(userID) {
    let result = await withOracleDB(async (connection) => {
        let queryResult = (await connection.execute('SELECT DISTINCT Bio FROM Users WHERE UserID=:id', [userID]));
        if (queryResult.length === 0) return undefined;
        else return queryResult[0];
    });
    return doesExist(result);
}

async function getLocationName(userID) {
    let result = await withOracleDB(async (connection) => {
        let queryResult = (await connection.execute('SELECT Locations.LocationName FROM Users JOIN Locations ON Users.LocationID = Locations.LocationID WHERE Users.userID=:id', [userID]));
        if (queryResult.length === 0) return undefined;
        else return queryResult[0];
    })
    return doesExist(result);
}

async function getZodiacSign(userID) {
    let result = await withOracleDB(async (connection) => {
        let queryResult = await connection.execute('SELECT Z.Zodiac FROM Users U JOIN Zodiac Z ON U.Birthday = Z.Birthday WHERE U.userID = :id', [userID]);
        if (queryResult.length === 0) return undefined;
        else return queryResult[0];
    });
    return doesExist(result);
}

async function chatExists(sender, receiver) {

    let queryResult = (await withOracleDB(async connection => {
        return await connection.execute(`SELECT MessageGroupID
        FROM MessageGroups
        WHERE MessageGroupID IN (
            SELECT mg.MessageGroupID
            FROM MessageGroups mg
            JOIN MessageGroupMembers m1 ON mg.MessageGroupID = m1.MessageGroup
            JOIN MessageGroupMembers m2 ON mg.MessageGroupID = m2.MessageGroup
            WHERE m1.UserID = '${sender}' AND m2.UserID = '${receiver}'
        )`)
    }))
    if (!queryResult.rows || queryResult.rows.length === 0 || !queryResult.rows[0][0]) {
        return 0;
    }

    return queryResult.rows[0][0];
}

// creates a new chat with only two people
async function createNewChat(sender, receiver) {
    let groupID = generateId();
    let groupName = await getUsername(sender) + " " + await getUsername(receiver);

    try {
        await withOracleDB(async connection => {
            await connection.execute(`INSERT INTO MessageGroups (MessageGroupID, MessageGroupName)
        VALUES (:id, :name)`, [groupID, groupName], { autoCommit: true });
            await connection.execute(`INSERT INTO MessageGroupMembers (MessageGroup, UserID)
            VALUES (:id, :user1)`, [groupID, sender], { autoCommit: true });
            await connection.execute(`INSERT INTO MessageGroupMembers (MessageGroup, UserID)
            VALUES (:id, :user2)`, [groupID, receiver], { autoCommit: true });
        })
    } catch (error) {
        console.error("error:" + error.message);

    }
    return groupID;
}

async function createNewGroup(usersID, groupName) {
    let groupID = generateId();

    let queryResult = await withOracleDB(async connection => {
        await connection.execute(`INSERT INTO MessageGroups (MessageGroupID, MessageGroupName)
        VALUES (:id, :name)`, [groupID, groupName], { autoCommit: true });
        for (let id of usersID) {
            await connection.execute(`INSERT INTO MessageGroupMembers (MessageGroup, UserID)
            VALUES (:id, :userid)`, [groupID, id], { autoCommit: true });
        }
    })

    return groupID;
}

async function getMessageGroups(userID) {
    let queryResult = (await withOracleDB(async connection => {
        return await connection.execute(`SELECT mg.MessageGroupID, mg.MessageGroupName FROM MessageGroups mg
        JOIN MessageGroupMembers mgm ON mg.MessageGroupID = mgm.MessageGroup
        WHERE mgm.UserID=:id`, [userID]
        );
    })).rows;
    return queryResult.map(row => {
        return {
            groupID: row[0],
            groupName: row[1]
        }
    });
}


async function getGroupNameFromID(groupID) {
    let queryResult = (await withOracleDB(async connection => {
        return await connection.execute(`SELECT MessageGroupName FROM MessageGroups WHERE MessageGroupID=:id`, [groupID]);
    })).rows;

    if (queryResult.length === 0) return undefined;

    return queryResult[0];
}

async function sendMessage(groupID, senderID, message) {
    let messageID = generateId();
    let time = (await withOracleDB(async connection => {
        return await connection.execute(`SELECT TO_TIMESTAMP_TZ(TO_CHAR(SYSTIMESTAMP AT TIME ZONE 'PST',
        'YYYY-MM-DD HH24:MI:SS'), 'YYYY-MM-DD HH24:MI:SS TZR') AS formatted_datetime
        FROM DUAL`)
    })).rows[0][0];

    let queryResult = (await withOracleDB(async connection => {
        return await connection.execute(`INSERT INTO Messages (MessageID, "Time", "Text", MessageGroup, Sender)
        VALUES (:messageID, :time, :message, :groupID, :senderID)`, [messageID, time, message, groupID, senderID], { autoCommit: true })
    })).rows;

    if (queryResult === 0) return undefined;
    return time;

}

async function isInMessageGroup(userID, groupID) {
    try {
        const queryResult = await withOracleDB(async connection => {
            return await connection.execute(
                `SELECT COUNT(*)
                 FROM MessageGroupMembers
                 WHERE UserID = :userID
                 AND MessageGroup = :groupID`,
                [userID, groupID]
            );
        });

        // Check if the user is in the group by looking at the count
        return queryResult.rows.length > 0;
    } catch (error) {
        console.error(error);
        return false; // Return false in case of an error
    }
}
async function getMessages(groupID) {
    let queryResult = await withOracleDB(async connection => {
        return await connection.execute(`SELECT "Time", "Text", Sender FROM Messages WHERE MessageGroup =:groupID ORDER BY "Time"`, [groupID]);
    });
    return queryResult.rows.map((row) => {
        return {
            time: row[0],
            text: row[1],
            sender: row[2]
        }
    })
}


async function getLocations() {
    return await withOracleDB(async (connection) => {
        const result = await connection.execute('SELECT LocationID, LocationName, Latitude, Longitude FROM Locations');
        return result.rows.map(row => {
            return { id: row[0], name: row[1], latitude: row[2], longitude: row[3] };
        });
    }).catch(err => {
        console.error('Error fetching locations:', err);
        throw err;
    });
}

async function updateLocation(locationId, locationData) {
    return await withOracleDB(async (connection) => {
        const result = await connection.execute(
            `UPDATE Locations
             SET LocationName = :name,
                 Latitude = :latitude,
                 Longitude = :longitude,
             WHERE LocationID = :locationId`,
            [locationData.locationName, locationData.latitude, locationData.longitude, locationId],
            { autoCommit: true }
        );
        return result.rowsAffected > 0;
    });
}


async function createLocation(locationName, latitude, longitude, altitude = null) {
    const locationId = generateId();

    return withOracleDB(async (connection) => {
        await connection.execute(
            `INSERT INTO Locations (LocationID, LocationName, Latitude, Longitude, Altitude)
            VALUES (:locationId, :locationName, :latitude, :longitude, :altitude)`,
            [locationId, locationName, latitude, longitude, altitude],
            { autoCommit: true }
        );

        return locationId;
    });
}

async function deleteLocation(locationId) {
    return await withOracleDB(async (connection) => {
        const result = await connection.execute(
            `DELETE FROM Locations WHERE LocationID = :locationId`,
            [locationId],
            { autoCommit: true }
        );
        return result.rowsAffected > 0;
    });
}

async function getSongs() {
    return await withOracleDB(async (connection) => {
        const result = await connection.execute('SELECT SongID, SongTitle, Artist, URL FROM Songs');
        return result.rows.map(row => {
            return { id: row[0], title: row[1], artist: row[2], url: row[3] };
        });
    }).catch(err => {
        console.error('Error fetching songs:', err);
        throw err;
    });
}

async function updateSong(songId, songData) {
    try {
        return await withOracleDB(async (connection) => {
            const result = await connection.execute(
                `UPDATE Songs
                 SET SongTitle = :title,
                     Artist = :artist,
                     URL = :url
                 WHERE SongID = :songId`,
                [songData.title, songData.artist, songData.url, songId],
                { autoCommit: true }
            );
            return result.rowsAffected > 0;
        });
    } catch (err) {
        console.error('Error updating song:', err);
        throw new Error('Failed to update song.');
    }
}

// SETTINGS
async function updateUserSettings(userId, settings) {
    return await withOracleDB(async (connection) => {
        let fieldsToUpdate = [];
        let values = [];

        // Check each field and update only if provided
        if (settings.username) {
            fieldsToUpdate.push('Username = :username');
            values.push(settings.username);
        }
        if (settings.password) {
            const passwordHash = await bcrypt.hash(settings.password, 12);
            fieldsToUpdate.push('PasswordHash = :passwordHash');
            values.push(passwordHash);
        }
        // Add similar checks for other fields: birthday, displayName, bio, location

        if (fieldsToUpdate.length === 0) {
            return false; // No update if no fields provided
        }

        const sql = `UPDATE Users SET ${fieldsToUpdate.join(', ')} WHERE UserID = :userId`;
        values.push(userId);

        const result = await connection.execute(sql, values, { autoCommit: true });
        return result.rowsAffected > 0;
    });
}

async function getBlockedUsers(userId) {
    return await withOracleDB(async (connection) => {
        const result = await connection.execute(
            `SELECT u.UserID, u.Username, u.DisplayName
             FROM Blocks b
             JOIN Users u ON b.Blocked = u.UserID
             WHERE b.Blocker = :userId`,
            [userId]
        );
        return result.rows.map(row => ({
            userId: row[0],
            username: row[1],
            displayName: row[2]
        }));
    }).catch(err => {
        console.error('Error fetching blocked users:', err);
        throw err;
    });
}

// PRODUCT CATEGORIES
async function addProductCategory(name) {
    return await withOracleDB(async (connection) => {
        const categoryId = generateId(); // Generate a unique ID for the category
        const result = await connection.execute(
            `INSERT INTO ProductCategories (ProductCategoryID, ProductCategoryName) VALUES (:categoryId, :name)`,
            [categoryId, name],
            { autoCommit: true }
        );
        return result.rowsAffected > 0;
    }).catch(error => {
        console.error('Error adding product category:', error);
        throw error;
    });
}

async function updateProductCategory(categoryId, newName) {
    return await withOracleDB(async (connection) => {
        const result = await connection.execute(
            `UPDATE ProductCategories SET ProductCategoryName = :newName WHERE ProductCategoryID = :categoryId`,
            [newName, categoryId],
            { autoCommit: true }
        );
        return result.rowsAffected > 0;
    });
}

async function deleteProductCategory(categoryId) {
    return await withOracleDB(async (connection) => {
        const result = await connection.execute(
            `DELETE FROM ProductCategories WHERE ProductCategoryID = :categoryId`,
            [categoryId],
            { autoCommit: true }
        );
        return result.rowsAffected > 0;
    }).catch(error => {
        console.error('Error deleting product category:', error);
        throw error;
    });
}


// LOCATION
async function getPostsByLocation(locationId) {
    return await withOracleDB(async (connection) => {
        const locationResult = await connection.execute(
            `SELECT LocationName FROM Locations WHERE LocationID = :locationId`,
            [locationId]
        );

        if (locationResult.rows.length === 0) {
            return null; // Location not found
        }

        const locationName = locationResult.rows[0][0];

        const postsResult = await connection.execute(
            `SELECT PostID, Caption FROM Posts WHERE LocationID = :locationId`,
            [locationId]
        );

        const posts = postsResult.rows.map(row => {
            return { id: row[0], title: row[1] };
        });

        return { locationName, posts };
    });
}

async function addUserToGroup(userID, groupID) {
    let exists = await withOracleDB(async connection => {
        return await connection.execute(`SELECT COUNT(*) FROM MessageGroupMembers WHERE MessageGroup=:groupID AND userID=:userID`, [groupID, userID]);
    })
    if (exists) return false;
    let queryResult = await withOracleDB(async connection => {
        return await connection.execute(`INSERT INTO MessageGroupMembers (MessageGroup, userID) VALUES (:groupID, :userID)`, [groupID, userID], { autoCommit: true });
    })
    return true;
}

function doesExist(value) {
    if (value === undefined || value[0] === undefined) return "Not set yet";
    return value;
}

async function getLocationIDFromName(name) {
    let queryResult = await withOracleDB(async connection => {
        return await connection.execute(`SELECT LocationID FROM Locations WHERE LocationName=:name`, [name]);
    })
    if (queryResult.rows[0] === undefined || queryResult.rows[0][0] === undefined) return false;
    else return queryResult.rows[0][0];
}

async function getFollowers(userID) {
    let queryResult = await withOracleDB(async connection => {
        return await connection.execute(`SELECT Follower FROM Follows WHERE "Following"=:id`, [userID]);
    })
    return queryResult.rows[0];
}

async function getFollowing(userID) {
    let queryResult = await withOracleDB(async connection => {
        return await connection.execute(`SELECT "Following" FROM Follows WHERE Follower=:id`, [userID]);
    })
    return queryResult.rows[0];
}

async function getAdminStatus(userID) {
    let queryResult = await withOracleDB(async connection => {
        return await connection.execute(`SELECT IsAdmin FROM Users WHERE UserID=:id`, [userID])
    });
    return queryResult.rows[0][0];
}

async function makeAdmin(userID) {
    let status = await getAdminStatus(userID);
    if (status) {
        return false;
    } else {
        await withOracleDB(async connection => {
            return await connection.execute(`UPDATE Users SET IsAdmin=:status WHERE UserID=:userID`, [1, userID], { autoCommit: true });
        })
        return true;
    }
}

async function removeAdmin(userID) {
    let status = await getAdminStatus(userID);
    if (!status) {
        return false;
    } else {
        await withOracleDB(async connection => {
            return await connection.execute(`UPDATE Users SET IsAdmin=:status WHERE UserID=:userID`, [0, userID], { autoCommit: true });
        })
        return true;
    }
}

async function deleteUser(userID) {
    let doesExist = await withOracleDB(async connection => {
        return await connection.execute(`SELECT COUNT(*) FROM Users WHERE UserID=:id`, [userID]);
    });
    if (doesExist.rows[0] === undefined) return false;

    doesExist = doesExist.rows[0][0];

    if (!doesExist) return false;

    let queryResult = await withOracleDB(async connection => {
        return await connection.execute(`DELETE FROM Users WHERE UserID=:id`, [userID], { autoCommit: true });
    })
    return true;
}

async function followUser(followerID, followingID) {
    const doesExist = await withOracleDB(async (connection) => {
        const result = await connection.execute(
            `SELECT COUNT(*) FROM Follows WHERE Follower = :followerID AND "Following" = :followingID`,
            [followerID, followingID]
        );
        return result.rows[0][0] > 0;
    });
    if (doesExist) {
        return false;
    }

    const queryResult = await withOracleDB(async (connection) => {
        return await connection.execute(
            `INSERT INTO Follows (Follower, "Following") VALUES (:followerID, :followingID)`,
            [followerID, followingID],
            { autoCommit: true }
        );
    });
    return queryResult.rowsAffected > 0;
}

async function followUser(followerID, followingID) {
    const doesExist = await withOracleDB(async (connection) => {
        const result = await connection.execute(
            `SELECT COUNT(*) FROM Follows WHERE Follower = :followerID AND "Following" = :followingID`,
            [followerID, followingID]
        );
        return result.rows[0][0] > 0;
    });
    if (doesExist) {
        return false;
    }

    const queryResult = await withOracleDB(async (connection) => {
        return await connection.execute(
            `INSERT INTO Follows (Follower, "Following") VALUES (:followerID, :followingID)`,
            [followerID, followingID],
            { autoCommit: true }
        );
    });
    return queryResult.rowsAffected > 0;
}

async function unfollowUser(followerID, followingID) {

}


async function getTables() {
    let queryResult = await withOracleDB(async connection => {
        return await connection.execute(`SELECT table_name FROM user_tables`)
    })
    return queryResult.rows;
}

async function getAttributes(value) {
    let queryResult = await withOracleDB(async connection => {
        return await connection.execute(`SELECT column_name from user_tab_columns WHERE table_name =:val ORDER by column_id`, [value])
    })
    return queryResult.rows;
}

async function getSelectedAttributes(selectedTable, selectedAttributes) {
    let queryResult = await withOracleDB(async connection => {
        quotedAttributes = selectedAttributes.map(attr => `"${attr}"`);
        return await connection.execute(`SELECT ${quotedAttributes.join(', ')} FROM ${selectedTable}`)
    })
    if (queryResult.rows.length === 0 || queryResult.rows[0].length === undefined) return false;

    return queryResult.rows.map(row => {
        let mappedRow = {};
        selectedAttributes.forEach((attr, index) => {
            mappedRow[attr] = row[index];
        });
        return mappedRow;
    });
}


async function getAdClicks(){
    let queryResult = await withOracleDB(async connection => {
        return await connection.execute(`SELECT AdID, COUNT(Clicked) AS Clicks FROM AdShowing WHERE Clicked = 1 GROUP BY adID`)
    })
    if(queryResult.rows.length === 0 || queryResult.rows[0] === undefined) return false;
    return queryResult.rows;
}

async function getSuccessfulAds(clickRate) {
    let queryResult = await withOracleDB(async connection => {
        return await connection.execute(`SELECT AdID, COUNT(*) AS totalShows, SUM(Clicked) as totalClicks
        FROM AdShowing
        GROUP BY AdID
        HAVING (SUM(Clicked) / COUNT(*)) > :clickRate`, [clickRate]);
    })
    if(queryResult.rows.length === 0 || queryResult.rows[0] === undefined) return false;
    return queryResult.rows;
}

async function getActiveUsers(time) {
    let queryResult = await withOracleDB(async connection => {
        return await connection.execute(`WITH UserPostCounts AS (
            SELECT
                u.UserID,
                COUNT(p.PostID) AS NumPosts,
                MAX(p."Time") AS MostRecentPostTime
            FROM
                Users u
            LEFT JOIN
                UserPosts up ON u.UserID = up.UserID
            LEFT JOIN
                Posts p ON up.PostID = p.PostID
            GROUP BY
                u.UserID
        ),
        UserAverages AS (
            SELECT
                AVG(NumPosts) AS AvgNumPosts
            FROM
                UserPostCounts
        )
        SELECT
            UPC.UserID,
            UPC.NumPosts,
            UPC.MostRecentPostTime
        FROM
            UserPostCounts UPC
        JOIN
            UserAverages UA ON 1=1
        WHERE
            UPC.NumPosts >= UA.AvgNumPosts
            AND UPC.MostRecentPostTime > TO_DATE(:time, 'YYYY-MM-DD')
        `, [time])
    })
    if(queryResult.rows.length === 0 || queryResult.rows[0] === undefined) return false;
    return queryResult.rows;
}

async function getViewedAds(){ 
    let queryResult = await withOracleDB(async connection => {
        return await connection.execute(`SELECT AdID
        FROM Advertisements a
        WHERE NOT EXISTS (
            SELECT UserID
            FROM Users u
            WHERE NOT EXISTS (
                SELECT 1
                FROM AdShowing s
                WHERE s.AdID = a.AdID AND s.UserID = u.UserID
            )
        )`)
    })
    if(queryResult.rows.length === 0 || queryResult.rows[0] === undefined) return false;
    return queryResult.rows[0];
}

async function search(query, parameters) {
    let queryResult = await withOracleDB(async connection => {
        return await connection.execute(`SELECT Username, userID FROM Users WHERE ${query}`, parameters);
    })
    if(queryResult.rows.length === 0 || queryResult.rows[0] === undefined) return false;
    return queryResult.rows;
}
module.exports = {
    setupPool,
    testOracleConnection,
    fetchDemotableFromDb,
    initiateDemotable,
    insertDemotable,
    updateNameDemotable,
    countDemotable,
    userExists,
    passwordCorrect,
    getUserId,
    createUser,
    getUserHash,
    getFeedStories,
    getZodiacSign,
    getBannerAd,
    getFeedPosts,
    adShowingExists,
    clickAd,
    getUsername,
    getDisplayName,
    getAdminStatusByUserID,
    getPostCollaborationRequests,
    getAdCollaborationRequests,
    acceptColab,
    rejectColab,
    getLocations,
    getProductCategories,
    getSongs,
    locationIDExists,
    productCategoryIDExists,
    songIDExists,
    createPost,
    getPost,
    getComments,
    postIDExists,
    userIsCreator,
    deletePost,
    getLocationName,
    getUserBio,
    getComments,
    getUserBio,
    getLocationName,
    chatExists,
    createNewChat,
    createNewGroup,
    getMessageGroups,
    getGroupNameFromID,
    sendMessage,
    isInMessageGroup,
    getMessages,
    getLocations,
    createLocation,
    updateLocation,
    deleteLocation,
    getSongs,
    updateSong,
    updateUserSettings,
    getBlockedUsers,
    addProductCategory,
    updateProductCategory,
    deleteProductCategory,
    getPostsByLocation,
    addUserToGroup,
    getLocationIDFromName,
    getFollowers,
    getFollowing,
    getAdminStatus,
    makeAdmin,
    removeAdmin,
    deleteUser,
    followUser,
    getTables,
    getAttributes,
    getSelectedAttributes,
    getAdClicks,
    getSuccessfulAds,
    getActiveUsers,
    getViewedAds,
    search
};