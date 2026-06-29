/**
 * Docker HEALTHCHECK — node index.js (no curl required)
 */
const http = require('http');
const port = process.env.PORT || 3000;
const path = process.env.HEALTH_PATH || '/health';

http.get({ hostname: '127.0.0.1', port, path, timeout: 5000 }, (res) => {
  process.exit(res.statusCode === 200 ? 0 : 1);
}).on('error', () => process.exit(1));
