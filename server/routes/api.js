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

router.get('/stored-user-info/:id', function (req, res) {
    const id = req.params.id;
    database.ref('/user-profiles/' + id).once('value').then(function (snapshot) {
        const userInfo = snapshot.val();
        res.send(userInfo);
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
                            const id = songData.id;
                            songMap[id].index = i + index;
                            songMap[id].valence = songData.valence;
                            songMap[id].tempo = songData.tempo;
                            songMap[id].energy = songData.energy;
                            songMap[id].instrumentalness = songData.instrumentalness;
                            songMap[id].loudness = songData.loudness;
                            songMap[id].time_signature = songData.time_signature;
                            songMap[id].danceability = songData.danceability;
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

getSongList = function(songMap) {
    if (!songMap) {
        return false;
    }
    let songList = Object.values(songMap);
    songList = songList.sort(function(a, b){
        return a.index - b.index;
    });
    return songList;
};

console.log('Set express router');

console.log('Using body parser');

router.use(bodyParser.json());       // to support JSON-encoded bodies
router.use(bodyParser.urlencoded({     // to support URL-encoded bodies
    extended: true
}));

console.log('Defining Functions');

console.log('Exporting router');
module.exports = router;
