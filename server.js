// Get dependencies
const express = require('express');
const path = require('path');
const http = require('http');
const bodyParser = require('body-parser');

const cookieParser = require('cookie-parser');

// Get our API routes
const api = require('./server/routes/api');

const app = express();

/**
 * Get port from environment and store in Express.
 */
const port = process.env.PORT || '3000';
app.set('port', port);
console.log("Node server running on port " + port);

// Point static path to 'static' folder
app.use(express.static(path.join(__dirname, 'static'))).use(cookieParser());
console.log("Serving static from 'static' folder");

app.use(function (error, req, res, next) {
    console.log(req.originalUrl, ':', error.stack);
    res.render('500', {
        status: 500,
        url: req.url,
        title: 'Something broke :(',
        user: req.user,
        stateMessage: '',
        pageState: ''
    });
});

console.log("Using error logging");

// Parsers for POST data
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: false}));

console.log("Using body parser");

// Set our api routes
app.use('/api', api);

console.log("Setting api routes");

// Catch all other routes and return the index file
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'static/index.html'));
});

console.log("Catching all other routes and returning the index file");

/**
 * Create HTTP server.
 */
const server = http.createServer(app);

console.log("Created Server");
/**
 * Listen on provided port, on all network interfaces.
 */
server.listen(port, () => console.log(`Server running on port: ${port}`));
