# Google OAuth: Fix "redirect_uri_mismatch" (Error 400)

Google returns this when the **redirect URI** your app sends does not **exactly** match one of the URIs configured in Google Cloud Console.

## What your app sends

The frontend uses two redirect URIs:

1. **Sign-in:** `{origin}/auth/callback`  
2. **Link Gmail (for teachers):** `{origin}/auth/link-callback`

So for each origin you use, add both:
- `http://localhost:3000` → `http://localhost:3000/auth/callback` and `http://localhost:3000/auth/link-callback`
- `http://127.0.0.1:3000` → same with `/auth/callback` and `/auth/link-callback`
- Production: `https://yourdomain.com/auth/callback` and `https://yourdomain.com/auth/link-callback`

No trailing slash.

## What to add in Google Cloud Console

1. Open [Google Cloud Console](https://console.cloud.google.com/) → your project.
2. Go to **APIs & Services** → **Credentials**.
3. Open your **OAuth 2.0 Client ID** (Web application).
4. Under **Authorized redirect URIs**, add **each** URI you use (exact string):
   - Local (if you use `localhost`):  
     `http://localhost:3000/auth/callback`  
     (Change `3000` if your dev server uses another port.)
   - Local (if you use `127.0.0.1`):  
     `http://127.0.0.1:3000/auth/callback` and `http://127.0.0.1:3000/auth/link-callback`
   - Production:  
     `https://your-production-domain.com/auth/callback` and `https://your-production-domain.com/auth/link-callback`
5. **Save**.

## Checklist

- No typo in path (`/auth/callback`).
- Same scheme: `http` for local, `https` for production (unless you have a valid HTTPS local setup).
- Same host: `localhost` and `127.0.0.1` are different — add both if you use both.
- Same port (e.g. `3000`).
- No trailing slash on the URI in the console.

## See what your app is sending

- If the address bar shows `http://localhost:3000/...` → add `http://localhost:3000/auth/callback`.
- If it shows `http://127.0.0.1:3000/...` → add `http://127.0.0.1:3000/auth/callback`.

After changing redirect URIs in Google Cloud Console, wait a minute and try sign-in again.
