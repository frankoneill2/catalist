# API Key Exposure Notice

## Summary
Google flagged a publicly available API key associated with this project. We confirmed the key appears in the client bundle and source because this is a public Firebase web app. The key is embedded in the Firebase config in `script.js`, and it is also present in the built output under `dist/assets/`.

This is expected for Firebase web apps, but it still requires proper restrictions to prevent abuse.

## What Happened
- The Firebase web config contains an API key.
- That config is shipped to browsers, so the key is visible in the deployed JavaScript.
- A Google alert was triggered because the key is public and likely unrestricted.

## How We Fixed It (Lockdown Only)
We did not remove the key from the client (it must remain for the app to work). Instead, we locked it down in Google Cloud Console:

1. Rotated the existing API key.
2. Restricted the new key by HTTP referrers (only allow our production domain(s)).
3. Restricted the key by API (only the Firebase / Firestore / Auth APIs used by this app).

## Notes
- The key will still be visible in the client bundle, which is normal for Firebase web apps.
- Restrictions are the critical safety control.
- If we later want to reduce visibility in the repo, we can stop committing `dist/` and move the config into build-time environment variables.
