let fs = require('fs');
const express = require('express');
const request = require('request');
const bodyParser = require('body-parser');
const querystring = require('querystring');
const firebase = require('firebase');

console.log('Running api.js');

spotifyCredentials = JSON.parse(fs.readFileSync('spotify-credentials.json'));
firebaseCredentials = JSON.parse(fs.readFileSync('firebase-credentials.json'));
const firebaseApp = firebase.initializeApp(firebaseCredentials);
const database = firebaseApp.database();

const spotify_client_id = spotifyCredentials['clientId']; // Your client id
const spotify_client_secret = spotifyCredentials['clientSecret']; // Your secret
const spotify_redirect_uri = spotifyCredentials['redirectUri']; // Your redirect uri

const router = express.Router();

/**
 * Generates a random string containing numbers and letters
 * @param  {number} length The length of the string
 * @return {string} The generated string
 */
let generateRandomString = function (length) {
    let text = '';
    let possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

    for (let i = 0; i < length; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
};

let stateKey = 'spotify_auth_state';

// var app = express();

// app.use(express.static(__dirname + '/public'))
//     .use(cookieParser());

// login logic

router.get('/login', function (req, res) {

    const state = generateRandomString(16);
    res.cookie(stateKey, state);

    // your application requests authorization
    let scope = 'user-read-private user-read-email playlist-read-private playlist-read-collaborative' +
        ' playlist-modify-public playlist-modify-private';
    res.redirect('https://accounts.spotify.com/authorize?' +
        querystring.stringify({
            response_type: 'code',
            client_id: spotify_client_id,
            scope: scope,
            redirect_uri: spotify_redirect_uri,
            state: state
        }));
});

router.get('/auth-callback', function (req, res) {

    // your application requests refresh and access tokens
    // after checking the state parameter

    const code = req.query.code || null;
    const state = req.query.state || null;
    const storedState = req.cookies ? req.cookies[stateKey] : null;

    if (state === null || state !== storedState) {
        res.redirect('/#' +
            querystring.stringify({
                error: 'state_mismatch'
            }));
    } else {
        res.clearCookie(stateKey);
        const authOptions = {
            url: 'https://accounts.spotify.com/api/token',
            form: {
                code: code,
                redirect_uri: spotify_redirect_uri,
                grant_type: 'authorization_code'
            },
            headers: {
                'Authorization': 'Basic ' + (new Buffer(spotify_client_id + ':' + spotify_client_secret).toString('base64'))
            },
            json: true
        };

        request.post(authOptions, function (error, response, body) {
            if (!error && response.statusCode === 200) {

                const access_token = body.access_token,
                    refresh_token = body.refresh_token;

                const options = {
                    url: 'https://api.spotify.com/v1/me',
                    headers: {'Authorization': 'Bearer ' + access_token},
                    json: true
                };

                // use the access token to access the Spotify Web API
                request.get(options, function (error, response, body) {
                    // console.log(body);
                });

                // we can also pass the token to the browser to make requests from there
                res.redirect('/#' +
                    querystring.stringify({
                        access_token: access_token,
                        refresh_token: refresh_token
                    }));
            } else {
                console.log(error);
                res.redirect('/#' +
                    querystring.stringify({
                        error: 'invalid_token'
                    }));
            }
        });
    }
});

router.get('/refresh_token', function (req, res) {

    // requesting access token from refresh token
    const refresh_token = req.query.refresh_token;
    const authOptions = {
        url: 'https://accounts.spotify.com/api/token',
        headers: {'Authorization': 'Basic ' + (new Buffer(spotify_client_id + ':' + spotify_client_secret).toString('base64'))},
        form: {
            grant_type: 'refresh_token',
            refresh_token: refresh_token
        },
        json: true
    };

    request.post(authOptions, function (error, response, body) {
        if (!error && response.statusCode === 200) {
            const access_token = body.access_token;
            res.send({
                'access_token': access_token
            });
        }
    });
});

shuffle = function (a) {
    let j, x, i;
    for (i = a.length - 1; i > 0; i--) {
        j = Math.floor(Math.random() * (i + 1));
        x = a[i];
        a[i] = a[j];
        a[j] = x;
    }
    return a; // Note: This is an in place shuffle, so a return statement is not necessary
};

function getRandomSubarray(arr, size) {
    let shuffled = arr.slice(0), i = arr.length, temp, index;
    while (i--) {
        index = Math.floor((i + 1) * Math.random());
        temp = shuffled[index];
        shuffled[index] = shuffled[i];
        shuffled[i] = temp;
    }
    return shuffled.slice(0, size);
}

function upThenDown(arr, upRatio) {
    let start = 0;
    let end = arr.length - 1;
    let result = [];
    for (let i = 0; i < arr.length; i++) {
        result.push(i);
    }
    for (let i = 0; i < arr.length; i++) {
        if (i % upRatio === 0) {
            result[end--] = arr[i];
        } else {
            result[start++] = arr[i];
        }
    }
    return result;
}

router.get('/stored-user-info/:id', function (req, res) {
    const id = req.params.id;
    database.ref('/user-profiles/' + id).once('value').then(function (snapshot) {
        const userInfo = snapshot.val();
        res.send(userInfo);
    });
});

router.post('/stored-user-info/:id', function (req, res) {
    const id = req.params.id;
    database.ref('/user-profiles/' + id).set(req.body).then(function () {
        res.send(true);
    });
});

router.get('/playlist-list/:userID', function (req, res) {
    const userId = req.params.userID;
    const accessToken = req.query.accessToken;

    const requestURL = 'https://api.spotify.com/v1/users/' + userId + '/playlists';

    request({
        url: requestURL,
        method: 'GET',
        auth: {
            'bearer': accessToken
        }
    }, function (error, response, body) {
        if (!error && response.statusCode === 200) {
            const items = JSON.parse(body).items;
            let result = [];

            for (let i = 0; i < items.length; i++) {
                const playlist = items[i];
                if (playlist.public) {
                    let playlistObject = {
                        'name': playlist.name,
                        'id': playlist.id,
                        'ownerId': playlist.owner.id
                    };
                    if (playlist.images && playlist.images.length > 1) {
                        playlistObject.thumbnailURL = playlist.images[1].url;
                    }
                    result.push(playlistObject)
                }
            }

            res.send(result);

        } else {
            console.log(error);
            console.log(response);
        }
    });
});

router.post('/refresh-playlist-info/', function (req, res) {
    const accessToken = req.body.accessToken;
    const playlistID = req.body.playlistID;
    const userID = req.body.userId;
    refreshPlaylist(playlistID, userID, accessToken, res)
});

refreshPlaylist = function (playlistID, userID, accessToken, finalRes) {
    const songMap = {};
    processSongList(0, songMap, userID, playlistID, accessToken, finalRes, null);
};

// Updates the song map with the necessary information and uploads it to firebase once all songs have been processed
processSongList = function (index, songMap, userID, playlistID, accessToken, finalRes, callback) {
    const requestURL = 'https://api.spotify.com/v1/users/' + userID + '/playlists/' + playlistID + '/tracks?offset=' + index;
    request({
        url: requestURL,
        method: 'GET',
        auth: {
            'bearer': accessToken
        }
    }, function (error, response, body) {
        if (!error && response.statusCode === 200) {
            let responseObject = JSON.parse(body);

            if (responseObject.total === index) {
                delete songMap[null];
                database.ref('user-playlists/' + userID + '/' + playlistID).set(songMap);
                database.ref('user-songs').update(songMap);
                if (callback) {
                    callback()
                } else {
                    finalRes.send(true);
                }
            } else {

                const items = responseObject.items;
                songList = [];

                for (let i = 0; i < items.length; i++) {
                    const song = items[i].track;
                    songList.push(song.id);
                    const artists = [];
                    for (let j = 0; j < song.artists.length; j++) {
                        artists.push(song.artists[j].name)
                    }
                    songMap[song.id] = {
                        'id': song.id,
                        'name': song.name,
                        'popularity': song.popularity,
                        'artists': artists,
                        'duration-ms': song.duration_ms
                    };
                }

                const requestURL = 'https://api.spotify.com/v1/audio-features?ids=' + songList.join(',');

                request({
                    url: requestURL,
                    method: 'GET',
                    auth: {
                        'bearer': accessToken
                    }
                }, function (error, response, body) {
                    if (!error && response.statusCode === 200) {
                        const songDataList = JSON.parse(body).audio_features;
                        for (let i = 0; i < songDataList.length; i++) {
                            const songData = songDataList[i];
                            if (songData) {
                                const id = songData.id;
                                songMap[id].index = i + index;
                                songMap[id].valence = songData.valence;
                                songMap[id].tempo = songData.tempo;
                                songMap[id].energy = songData.energy;
                                songMap[id].instrumentalness = songData.instrumentalness;
                                songMap[id].loudness = songData.loudness;
                                songMap[id].time_signature = songData.time_signature;
                                songMap[id].danceability = songData.danceability;

                                songMap[id]['exercise-suitability'] = 80 * songData.valence + (1 - songData.liveness) * 20;
                                songMap[id]['exercise-intensity'] = 40 * songData.danceability + 30 * songData.valence + 30 * songData.energy;

                                // Fix possible range issues
                                songMap[id]['exercise-suitability'] = Math.min(songMap[id]['exercise-suitability'], 100);
                                songMap[id]['exercise-suitability'] = Math.max(songMap[id]['exercise-suitability'], 0);
                                songMap[id]['exercise-intensity'] = Math.min(songMap[id]['exercise-intensity'], 100);
                                songMap[id]['exercise-intensity'] = Math.max(songMap[id]['exercise-intensity'], 0);

                                songMap[id]['exercise-intensity'] = songMap[id]['exercise-intensity'] * 2;
                            }
                        }

                        processSongList(index + items.length, songMap, userID, playlistID, accessToken, finalRes, callback);

                    } else {
                        if (finalRes) {
                            finalRes.send(error);
                        }
                        console.log(error);
                        console.log(response);
                    }
                });
            }
        } else {
            if (finalRes) {
                finalRes.send(error);
            }
            console.log(error);
            console.log(response);
        }
    });
};

router.get('/playlist-info/:userID/:playlistID', function (req, res) {
    const userID = req.params.userID;
    const playlistID = req.params.playlistID;
    const accessToken = req.query.accessToken;
    database.ref('/user-playlists/' + userID + '/' + playlistID).once('value').then(function (snapshot) {
        if (!snapshot.exists()) {
            const songMap = {};
            processSongList(0, songMap, userID, playlistID, accessToken, null, function () {
                database.ref('/user-playlists/' + userID + '/' + playlistID).once('value').then(function (snapshot) {
                    res.send(getSongList(snapshot.val()));
                });
            });
        } else {
            res.send(getSongList(snapshot.val()));
        }
    });
});

getSongList = function (songMap) {
    if (!songMap) {
        return false;
    }
    let songList = Object.values(songMap);
    songList = songList.sort(function (a, b) {
        return a.index - b.index;
    });
    songList = upThenDown(songList, 7);

    for (var i = 0; i < songList.length; i++) {
        var exType = "";
        var intensity = songList[i]['exercise-intensity'];
        if (intensity >= 150) {
            exType = "Strength"
        } else if (intensity >= 75) {
            exType = 'Cardio'
        } else {
            exType = 'Yoga'
        }
        songList[i]['exercise-type'] = exType
    }

    return songList;
};

router.post('/create-playlist', function (req, finalRes) {
    const accessToken = req.body.accessToken;
    const userId = req.body.userId;
    const playlistName = req.body.playlistName;
    const maxSongs = Number(req.body.maxSongs);
    const targetExerciseType = req.body.exerciseType;

    const suitabilityThreshold = 0.3;

    let startIntensity = 150;
    let endIntensity = 200;

    if (targetExerciseType === 'Cardio') {
        startIntensity = 75;
        endIntensity = 149;
    } else if (targetExerciseType === 'Yoga') {
        startIntensity = 0;
        endIntensity = 74;
    }

    database.ref('user-songs')
        .orderByChild('exercise-intensity')
        // .startAt(suitabilityThreshold, 'exercise-suitability')
        .startAt(startIntensity, 'exercise-intensity')
        .endAt(endIntensity, 'exercise-intensity')
        .limitToFirst(maxSongs * 10)
        .once('value')
        .then(function (snapshot) {
            const songs = snapshot.val();
            let songObjects = Object.values(songs);
            songObjects = getRandomSubarray(songObjects, maxSongs);
            songObjects = songObjects.sort(function (a, b) {
                return (a['exercise-intensity'] * 0.85 + a['tempo'] * 0.15) - (b['exercise-intensity'] * 0.85 + b['tempo'] * 0.15);
                // return (a['exercise-intensity'] + a['tempo']) - (b['exercise-intensity'] + b['tempo']);
                // return (a['exercise-intensity']) - (b['exercise-intensity']);
            });
            const songIds = [];
            for (let j = 0; j < songObjects.length; j++) {
                songIds.push(songObjects[j].id);
            }

            const createPlaylistOptions = {
                url: 'https://api.spotify.com/v1/users/' + userId + '/playlists',
                body: JSON.stringify({
                    'name': playlistName,
                    'public': true
                }),
                dataType: 'json',
                headers: {
                    'Authorization': 'Bearer ' + accessToken,
                    'Content-Type': 'application/json',
                }
            };

            request.post(createPlaylistOptions, function (error, response, body) {
                if (!error) {
                    const playlistId = JSON.parse(body).id;
                    finalRes.send(playlistId);
                    addSongsToPlaylist(songIds, 0, userId, playlistId, accessToken)
                } else {
                    console.log(error);
                    finalRes.send(-1);
                }
            });
        });
});


function addSongsToPlaylist(allSongIDs, index, userID, playlistID, accessToken, callback) {
    if (index >= allSongIDs.length) {
        if (callback) {
            callback();
        }
        return;
    }
    let requestSongIDs = [];
    const limit = index + 99;
    while (index < Math.min(limit, allSongIDs.length)) {
        requestSongIDs.push('spotify:track:' + allSongIDs[index]);
        index += 1;
    }

    let populatePlaylistOptions = {
        url: 'https://api.spotify.com/v1/users/' + userID + '/playlists/' + playlistID + '/tracks',
        body: JSON.stringify(requestSongIDs),
        dataType: 'json',
        headers: {
            'Authorization': 'Bearer ' + accessToken,
            'Content-Type': 'application/json',
        }
    };
    request.post(populatePlaylistOptions, function (error, response, body) {
        if (!error) {
            addSongsToPlaylist(allSongIDs, index, userID, playlistID, accessToken);
        } else {
            console.log(error);
        }
    });
}

console.log('Set express router');

console.log('Using body parser');

router.use(bodyParser.json());       // to support JSON-encoded bodies
router.use(bodyParser.urlencoded({     // to support URL-encoded bodies
    extended: true
}));

console.log('Defining Functions');

console.log('Exporting router');
module.exports = router;
