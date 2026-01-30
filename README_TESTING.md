# Testing Guide

This document outlines how to verify that the Backend API and Security "Moat" are working correctly.

## 1. Automated Testing (Recommended)

We have created an automated script that tests the entire flow:
1.  Registers a new user.
2.  Logs in to get a JWT.
3.  Creates a video (Admin).
4.  Grants permission to the user.
5.  Generates a Signed URL (Nginx format).
6.  Retrieves the Decryption Key (requires Auth).

### Run the test:
Make sure your server is running in one terminal:
```bash
npm start
```

Then run the test script in another terminal:
```bash
node test-api-flow.js
```

## 2. Phase A Security Verification

To specifically test the "Moat" logic (Nginx signatures and expiration) without a full API call:

```bash
node verifyPhaseA.js
```

This verifies:
*   **Link Integrity**: Tampered links are rejected.
*   **Expiration**: Old links are rejected.
*   **Signature Logic**: Matches standard Nginx `secure_link_md5`.

## 3. Manual Testing with curl / Postman

If you prefer manual testing, here are the steps:

### A. Register & Login
**Register:**
```bash
curl -X POST http://localhost:3000/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com", "password": "password123"}'
```

**Login:**
```bash
curl -X POST http://localhost:3000/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com", "password": "password123"}'
```
*Copy the `token` from the response.*

### B. Admin Setup (Add Video)
```bash
curl -X POST http://localhost:3000/v1/admin/videos \
  -H "Authorization: Bearer <YOUR_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"title": "Lesson 1", "storage_path": "/videos/course1/lesson1"}'
```
*Copy the `id` (video_id) from the response.*

### C. Grant Permission
```bash
curl -X POST http://localhost:3000/v1/admin/permissions \
  -H "Authorization: Bearer <YOUR_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"user_id": "<YOUR_USER_ID>", "video_id": "<VIDEO_ID>"}'
```

### D. Get Signed URL
```bash
curl -X GET http://localhost:3000/v1/video/<VIDEO_ID>/sign \
  -H "Authorization: Bearer <YOUR_TOKEN>"
```
*Response will contain the full URL with `?md5=...&expires=...`*

### E. Get Decryption Key
```bash
curl -X GET "http://localhost:3000/v1/video/get-key?vid=<VIDEO_ID>" \
  -H "Authorization: Bearer <YOUR_TOKEN>"
```
*This should return the binary key file content.*
