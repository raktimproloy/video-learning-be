/**
 * Docker HEALTHCHECK — hits /health on the app port inside the container.
 */
const http = require('http');

const port = parseInt(process.env.PORT || '3000', 10);
const path = process.env.HEALTH_PATH || '/health';

const req = http.get(
    { hostname: '127.0.0.1', port, path, timeout: 8000 },
    (res) => {
        res.resume();
        process.exit(res.statusCode === 200 ? 0 : 1);
    },
);

req.on('timeout', () => {
    req.destroy();
    process.exit(1);
});

req.on('error', () => process.exit(1));
