const app = require('./src/app');
const port = process.env.PORT || 3000;

// Start the video processing worker
require('./src/worker/index');

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
