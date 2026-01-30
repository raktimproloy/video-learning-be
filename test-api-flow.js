const axios = require('axios');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const API_URL = `http://localhost:${process.env.PORT || 3000}`;

// Helper to generate random string
const randomString = () => Math.random().toString(36).substring(7);

async function runTest() {
    console.log('--- Starting API Flow Test ---\n');

    try {
        // 1. Register User
        const email = `test_${randomString()}@example.com`;
        const password = 'password123';
        console.log(`1. Registering user: ${email}`);
        
        const registerRes = await axios.post(`${API_URL}/v1/auth/register`, {
            email,
            password
        });
        const user = registerRes.data.user;
        console.log('   ✅ User registered:', user.id);

        // 2. Login
        console.log('\n2. Logging in...');
        const loginRes = await axios.post(`${API_URL}/v1/auth/login`, {
            email,
            password
        });
        const token = loginRes.data.token;
        console.log('   ✅ Login successful. Token received.');

        const authHeaders = { headers: { Authorization: `Bearer ${token}` } };

        // 3. Add Video (Admin Action)
        console.log('\n3. Adding a new video (as Admin)...');
        const videoTitle = `Test Video ${randomString()}`;
        const videoPath = `/videos/course_${randomString()}/lesson_1`;
        
        const videoRes = await axios.post(`${API_URL}/v1/admin/videos`, {
            title: videoTitle,
            storage_path: videoPath
        }, authHeaders);
        const video = videoRes.data;
        console.log('   ✅ Video created:', video.id);

        // 4. Grant Permission
        console.log('\n4. Granting permission to user for video...');
        await axios.post(`${API_URL}/v1/admin/permissions`, {
            user_id: user.id,
            video_id: video.id,
            duration_seconds: 3600
        }, authHeaders);
        console.log('   ✅ Permission granted.');

        // 5. Get Signed URL
        console.log('\n5. Requesting Signed URL...');
        const signRes = await axios.get(`${API_URL}/v1/video/${video.id}/sign`, authHeaders);
        const signedUrl = signRes.data.url;
        console.log('   ✅ Signed URL received:', signedUrl);

        if (signedUrl.includes('?md5=') && signedUrl.includes('&expires=')) {
             console.log('   ✅ Signed URL format is correct.');
        } else {
             console.warn('   ⚠️ Signed URL format might be incorrect.');
        }

        // 6. Simulate Key Retrieval
        // The Admin Service should have already generated a key at KEYS_ROOT_DIR/<videoId>/enc.key
        console.log('\n6. Requesting Decryption Key...');
        
        // Read the actual key from disk to compare
        const keysDir = process.env.KEYS_ROOT_DIR || path.join(__dirname, 'keys');
        const keyFile = path.join(keysDir, video.id, 'enc.key');
        
        let originalKeyHex = '';
        if (fs.existsSync(keyFile)) {
             const keyBuffer = fs.readFileSync(keyFile);
             originalKeyHex = keyBuffer.toString('hex');
             console.log(`   ℹ️  Found key file on disk. Length: ${keyBuffer.length} bytes`);
        } else {
             console.error('   ❌ Key file NOT found on disk. AdminService should have created it.');
        }

        const keyRes = await axios.get(`${API_URL}/v1/video/get-key`, {
            ...authHeaders,
            params: { vid: video.id },
            responseType: 'arraybuffer' // Important for binary data
        });
        
        const receivedKeyHex = Buffer.from(keyRes.data).toString('hex');
        console.log('   ✅ Key received from API. Length:', keyRes.data.length);

        if (receivedKeyHex === originalKeyHex) {
            console.log('\n🎉 SUCCESS: Full flow verified successfully! Key matches.');
        } else {
            console.error('\n❌ FAILURE: Key content mismatch.');
            console.error('Expected:', originalKeyHex);
            console.error('Received:', receivedKeyHex);
        }

    } catch (error) {
        console.error('\n❌ Test Failed:', error.response ? error.response.data : error.message);
    }
}

runTest();
