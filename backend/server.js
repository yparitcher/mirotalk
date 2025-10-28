'use strict';

/**
 * MiroTalk C2C - Server component
 *
 * @link    GitHub: https://github.com/miroslavpejic85/mirotalkc2c
 * @link    Live demo: https://c2c.mirotalk.com
 * @license For open source under AGPL-3.0
 * @license For private project or commercial purposes contact us at: license.mirotalk@gmail.com or purchase it directly via Code Canyon:
 * @license https://codecanyon.net/item/mirotalk-c2c-webrtc-real-time-cam-2-cam-video-conferences-and-screen-sharing/43383005
 * @author  Miroslav Pejic - miroslav.pejic.85@gmail.com
 * @version 1.2.62
 */

require('dotenv').config();

const { Server } = require('socket.io');
const compression = require('compression');
const express = require('express');
const cors = require('cors');
const checkXSS = require('./xss.js');
const path = require('path');
const helmet = require('helmet');
const logs = require('./logs');
const packageJson = require('../package.json');
const { createServer } = require('node:http');

const { env } = require('process');
const log = new logs('server');

const app = express();
const server = createServer(app);

const listen_pid = parseInt(process.env.LISTEN_PID);
const listen_fds = parseInt(process.env.LISTEN_FDS);
const SD_LISTEN_FDS_START = 3;

if (listen_pid !== 0 && listen_pid !== process.pid) {
	throw new Error(`received LISTEN_PID ${listen_pid} but current process id is ${process.pid}`);
}
if (listen_fds > 1) {
	throw new Error(
		`only one socket is allowed for socket activation, but LISTEN_FDS was set to ${listen_fds}`
	);
}

const host = process.env.HOST || `http://localhost`;
const fileDescriptor = SD_LISTEN_FDS_START;

const trustProxy = !!getEnvBoolean(process.env.TRUST_PROXY);


// Cors
const cors_origin = process.env.CORS_ORIGIN;
const cors_methods = process.env.CORS_METHODS;

let corsOrigin = '*';
let corsMethods = ['GET', 'POST'];

if (cors_origin && cors_origin !== '*') {
    try {
        corsOrigin = JSON.parse(cors_origin);
    } catch (error) {
        log.error('Error parsing CORS_ORIGIN', error.message);
    }
}

if (cors_methods && cors_methods !== '') {
    try {
        corsMethods = JSON.parse(cors_methods);
    } catch (error) {
        log.error('Error parsing CORS_METHODS', error.message);
    }
}

const corsOptions = {
    origin: corsOrigin,
    methods: corsMethods,
};

const io = new Server({
    maxHttpBufferSize: 1e7,
    transports: ['websocket'],
    cors: corsOptions,
}).listen(server);


const iceServers = [];
const stunServerUrl = process.env.STUN_SERVER_URL;
const turnServerUrl = process.env.TURN_SERVER_URL;
const turnServerUsername = process.env.TURN_SERVER_USERNAME;
const turnServerCredential = process.env.TURN_SERVER_CREDENTIAL;
const stunServerEnabled = getEnvBoolean(process.env.STUN_SERVER_ENABLED);
const turnServerEnabled = getEnvBoolean(process.env.TURN_SERVER_ENABLED);
if (stunServerEnabled && stunServerUrl) iceServers.push({ urls: stunServerUrl });
if (turnServerEnabled && turnServerUrl && turnServerUsername && turnServerCredential) {
    iceServers.push({ urls: turnServerUrl, username: turnServerUsername, credential: turnServerCredential });
}

const surveyURL = process.env.SURVEY_URL || false;
const redirectURL = process.env.REDIRECT_URL || false;





const frontendDir = path.join(__dirname, '../', 'frontend');
const htmlClient = path.join(__dirname, '../', 'frontend/html/client.html');
const htmlHome = path.join(__dirname, '../', 'frontend/html/home.html');

const channels = {};
const sockets = {};
const peers = {};

app.set('trust proxy', trustProxy); // Enables trust for proxy headers (e.g., X-Forwarded-For) based on the trustProxy setting
app.use(helmet.noSniff()); // Enable content type sniffing prevention
app.use(express.static(frontendDir));
app.use(cors(corsOptions));
app.use(compression());
// app.use(express.json()); // Api parse body data as json
// app.use(express.urlencoded({ extended: false })); // Mattermost

// Logs requests
app.use((req, res, next) => {
    log.debug('New request:', {
        body: req.body,
        method: req.method,
        path: req.originalUrl,
    });
    next();
});



app.use((err, req, res, next) => {
    if (err instanceof SyntaxError || err.status === 400 || 'body' in err) {
        log.error('Request Error', {
            header: req.headers,
            body: req.body,
            error: err.message,
        });
        return res.status(400).send({ status: 404, message: err.message }); // Bad request
    }
    if (req.path.substr(-1) === '/' && req.path.length > 1) {
        let query = req.url.slice(req.path.length);
        res.redirect(301, req.path.slice(0, -1) + query);
    } else {
        next();
    }
});


app.get('/', (req, res) => {
    req.query.room = ".";
    req.query.name = "."
    return res.sendFile(htmlClient);
    // return res.sendFile(htmlHome);
});

app.get('/room/', (req, res) => {
    return res.sendFile(htmlHome);
});

app.get('/join/', (req, res) => {
    if (Object.keys(req.query).length > 0) {
        //http://localhost:3000/join?room=test&name=test
        log.debug('[' + req.headers.host + ']' + ' request query', req.query);
        const { room, name } = checkXSS(req.query);
        if (room && name) {
            return res.sendFile(htmlClient);
        }
        return notFound(res);
    }
    return notFound(res);
});

app.use((req, res) => {
    return notFound(res);
});

function notFound(res) {
    res.json({ data: '404 not found' });
}

function getEnvBoolean(key, force_true_if_undefined = false) {
    if (key == undefined && force_true_if_undefined) return true;
    return key == 'true' ? true : false;
}

function getServerConfig(tunnelHttps = false) {
    // configurations
    const server = {
        home: host,
    };

    return {
        server: server,
        trustProxy: trustProxy,
        iceServers: iceServers,
        cors: corsOptions,
        redirectURL: redirectURL,
        environment: process.env.NODE_ENV || 'development',
        app_version: packageJson.version,
        nodeVersion: process.versions.node,
    };
}



server.listen({ fd: fileDescriptor }, null, () => {
    log.debug('settings', getServerConfig());
});

io.on('error', (error) => {
    log.error('Socket.IO error:', error);
});

io.sockets.on('connect', (socket) => {
    log.debug('[' + socket.id + '] connection accepted');
    socket.channels = {};
    sockets[socket.id] = socket;

    socket.on('join', (cfg) => {
        const config = checkXSS(cfg);

        log.debug('[' + socket.id + '] join ', config);

        const channel = config.channel;

        if (channel in socket.channels) {
            return log.debug('[' + socket.id + '] [Warning] already joined', channel);
        }
        if (!(channel in channels)) channels[channel] = {};
        if (!(channel in peers)) peers[channel] = {};

        peers[channel][socket.id] = config.peerInfo;

        const activeRooms = getActiveRooms();

        log.info('[Join] - active rooms and peers count', activeRooms);

        log.debug('[Join] - connected peers grp by roomId', peers);

        addPeerTo(channel);

        channels[channel][socket.id] = socket;
        socket.channels[channel] = channel;

        const peerCounts = Object.keys(peers[channel]).length;

        sendToPeer(socket.id, sockets, 'serverInfo', {
            roomPeersCount: peerCounts,
            redirectURL: redirectURL,
            surveyURL: surveyURL,
        });
    });

    socket.on('relaySDP', (config) => {
        const { peerId, sessionDescription } = config;

        sendToPeer(peerId, sockets, 'sessionDescription', {
            peerId: socket.id,
            sessionDescription: sessionDescription,
        });
        log.debug('[' + socket.id + '] relay SessionDescription to [' + peerId + '] ', {
            type: sessionDescription.type,
        });
    });

    socket.on('relayICE', (config) => {
        const { peerId, iceCandidate } = config;

        sendToPeer(peerId, sockets, 'iceCandidate', {
            peerId: socket.id,
            iceCandidate: iceCandidate,
        });
    });

    socket.on('disconnect', (reason) => {
        for (let channel in socket.channels) {
            removePeerFrom(channel);
        }
        log.debug('[' + socket.id + '] disconnected', { reason: reason });

        // Extra cleanup: ensure socket is removed from all channels and peers
        for (let channel in channels) {
            if (channels[channel] && channels[channel][socket.id]) {
                delete channels[channel][socket.id];
                log.debug('[' + socket.id + '] cleaned up from channel [' + channel + ']');
            }
        }

        for (let channel in peers) {
            if (peers[channel] && peers[channel][socket.id]) {
                delete peers[channel][socket.id];
                log.debug('[' + socket.id + '] cleaned up from peers [' + channel + ']');
            }
        }

        delete sockets[socket.id];
    });

    socket.on('peerStatus', (cfg) => {
        const config = checkXSS(cfg);

        const { roomId, peerName, element, active } = config;

        if (peers[roomId]) {
            for (let peerId in peers[roomId]) {
                if (peers[roomId][peerId] && peers[roomId][peerId]['peerName'] == peerName) {
                    switch (element) {
                        case 'video':
                            peers[roomId][peerId]['peerVideo'] = active;
                            break;
                        case 'audio':
                            peers[roomId][peerId]['peerAudio'] = active;
                            break;
                        case 'screen':
                            peers[roomId][peerId]['peerScreen'] = active;
                            break;
                    }
                }
            }
        }

        const data = {
            peerId: socket.id,
            peerName: peerName,
            element: element,
            active: active,
        };
        sendToRoom(roomId, socket.id, 'peerStatus', data);

        log.debug('[' + socket.id + '] emit peerStatus to [roomId: ' + roomId + ']', data);
    });

    async function addPeerTo(channel) {
        try {
            for (let id in channels[channel]) {
                await channels[channel][id].emit('addPeer', {
                    peerId: socket.id,
                    peers: peers[channel],
                    shouldCreateOffer: false,
                    iceServers: iceServers,
                });
                socket.emit('addPeer', {
                    peerId: id,
                    peers: peers[channel],
                    shouldCreateOffer: true,
                    iceServers: iceServers,
                });
                log.debug('[' + socket.id + '] emit addPeer [' + id + ']');
            }
        } catch (error) {
            log.error('[' + socket.id + '] Error in addPeerTo', error);
        }
    }

    async function removePeerFrom(channel) {
        if (!(channel in socket.channels)) {
            log.debug('[' + socket.id + '] [Warning] not in ', channel);
            return;
        }

        try {
            delete socket.channels[channel];
            delete channels[channel][socket.id];
            delete peers[channel][socket.id];

            // Clean up empty channel to prevent memory leak
            if (Object.keys(peers[channel]).length == 0) {
                delete peers[channel];
                delete channels[channel];
                log.debug('[' + socket.id + '] Channel [' + channel + '] is now empty and removed');
            }

            const activeRooms = getActiveRooms();

            log.info('[RemovePeer] - active rooms and peers count', activeRooms);

            log.debug('[RemovePeer] - connected peers grp by roomId', peers);

            for (let id in channels[channel]) {
                await channels[channel][id].emit('removePeer', { peerId: socket.id });
                socket.emit('removePeer', { peerId: id });
                log.debug('[' + socket.id + '] emit removePeer [' + id + ']');
            }
        } catch (error) {
            log.error('[' + socket.id + '] Error in removePeerFrom', error);
        }
    }

    async function sendToRoom(roomId, socketId, msg, config = {}) {
        for (let peerId in channels[roomId]) {
            if (peerId != socketId) {
                await channels[roomId][peerId].emit(msg, config);
            }
        }
    }

    async function sendToPeer(peerId, sockets, msg, config = {}) {
        if (peerId in sockets) {
            await sockets[peerId].emit(msg, config);
        }
    }

    function getActiveRooms() {
        const roomPeersArray = [];
        for (const roomId in peers) {
            if (peers.hasOwnProperty(roomId)) {
                const peersCount = Object.keys(peers[roomId]).length;
                roomPeersArray.push({
                    roomId: roomId,
                    peersCount: peersCount,
                });
            }
        }
        return roomPeersArray;
    }
});

setTimeout(() => {
server.close();
}, 1000 * 60 * 10);
