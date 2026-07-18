# Google OAuth: Fix "redirect_uri_mismatch" (Error 400)

Google returns this when the **redirect URI** your app sends does not **exactly** match one of the URIs configured in Google Cloud Console.

## Root cause on shikkhabhumi.com (common)

Production redirects apex → www:

- `https://shikkhabhumi.com` → `https://www.shikkhabhumi.com`

So the browser origin during login is **www**, and the app sends:

- `https://www.shikkhabhumi.com/auth/callback`
- `https://www.shikkhabhumi.com/auth/link-callback` (teacher Gmail link)

If Google Console only has the **non-www** URIs, you get **Error 400: redirect_uri_mismatch**.

## What your app sends

Frontend uses:

1. **Sign-in:** `{origin}/auth/callback`
2. **Link Gmail (teachers):** `{origin}/auth/link-callback`

`origin` = `window.location.origin` (whatever host the user is on).

## What to add in Google Cloud Console (required)

1. Open [Google Cloud Console](https://console.cloud.google.com/) → your project.
2. **APIs & Services** → **Credentials**.
3. Open the **OAuth 2.0 Client ID** (Web application) that matches Client ID  
   `825968727890-chms9mslche7pjr1tnpo9aqid3nj8s3i.apps.googleusercontent.com`.
4. Under **Authorized redirect URIs**, add these **exact** strings (no trailing slash):

### Production (shikkhabhumi) — add ALL of these

```
https://www.shikkhabhumi.com/auth/callback
https://www.shikkhabhumi.com/auth/link-callback
https://shikkhabhumi.com/auth/callback
https://shikkhabhumi.com/auth/link-callback
```

### Local (optional)

```
http://localhost:3000/auth/callback
http://localhost:3000/auth/link-callback
http://127.0.0.1:3000/auth/callback
http://127.0.0.1:3000/auth/link-callback
```

5. **Save**, wait ~1–2 minutes, try Google login again on  
   `https://www.shikkhabhumi.com/auth`.

## Checklist

- [ ] `www` URIs are present (this is the usual fix after apex→www redirect)
- [ ] Path is exactly `/auth/callback` (not `/auth/callback/` or `/api/...`)
- [ ] Scheme is `https` for production
- [ ] Same OAuth Client ID as in frontend `NEXT_PUBLIC_GOOGLE_CLIENT_ID` and backend `GOOGLE_CLIENT_ID`
- [ ] Under **Authorized JavaScript origins**, also have:
  - `https://www.shikkhabhumi.com`
  - `https://shikkhabhumi.com`
  - `http://localhost:3000` (for local)

## How to confirm what the app is sending

1. Open `https://www.shikkhabhumi.com/auth`
2. Click Google login
3. Look at the Google URL bar for `redirect_uri=` — decode it
4. That exact value must be listed in Authorized redirect URIs
