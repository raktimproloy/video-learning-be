const http = require('http');
const app = require('./src/app');
const { initSocket } = require('./src/socket');

const port = process.env.PORT || 3000;
const server = http.createServer(app);

// Initialize Socket.io
initSocket(server);

// Start the video processing worker
require('./src/worker/index');

server.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
