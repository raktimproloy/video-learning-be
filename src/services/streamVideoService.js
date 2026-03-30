const { StreamChat } = require('stream-chat');

const STREAM_API_KEY = process.env.STREAM_API_KEY || '';
const STREAM_API_SECRET = process.env.STREAM_API_SECRET || '';

let streamServerClient = null;

function isConfigured() {
    return !!(STREAM_API_KEY && STREAM_API_SECRET);
}

function getClient() {
    if (!streamServerClient) {
        streamServerClient = StreamChat.getInstance(STREAM_API_KEY, STREAM_API_SECRET);
    }
    return streamServerClient;
}

async function getCredentials(channelName, uid, role) {
    if (!isConfigured()) return null;
    try {
        const serverClient = getClient();
        const userId = `${role === 'publisher' ? 'teacher' : 'student'}-${uid}`;
        const token = serverClient.createToken(userId);
        return {
            apiKey: STREAM_API_KEY,
            token,
            userId,
            role: role === 'publisher' ? 'host' : 'viewer',
            callType: 'default',
            callId: `lesson-${channelName}`,
        };
    } catch (error) {
        console.error('Stream getCredentials error:', error);
        return null;
    }
}

module.exports = { isConfigured, getCredentials };

