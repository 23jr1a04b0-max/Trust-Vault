# Deployment notes (Vercel + Render)

TrustVault's UI is hosted by Vercel. Its Node.js API, SQLite database, and private uploads run on Render. Keep the API and data storage on the backend; do not move SQLite or private uploads into Vercel Functions.

## Free demo deployment

This repository supports an explicit limited demo mode for a no-cost demonstration where no independent audit-sink receiver is configured. This mode does **not** provide independent audit anchoring. The app still maintains its local audit log, but Render free services use ephemeral storage: the database, local audit key/checkpoints, and uploaded files can be lost on restart, redeploy, or spin-down.

Do not use real, confidential, or important documents. Use synthetic demo accounts and test files only. Do not present this as a production secure document service.

### Render backend

Create a **Web Service** from the `security-hardening-followup` branch. Choose Docker and `./Dockerfile`; do not apply the paid `render.yaml` Blueprint.

Set these environment variables in Render:

- `NODE_ENV` = `production`
- `PORT` = `3000`
- `TRUSTVAULT_DEMO_MODE` = `true`
- `TRUSTED_ORIGINS` = the exact Vercel frontend origin, e.g. `https://your-project.vercel.app` (no trailing slash; update it if the URL changes)
- `AUDIT_HMAC_KEY` = a random secret of at least 32 bytes
- `MFA_ENCRYPTION_KEY` = exactly 64 hexadecimal characters (32 bytes)
- `DATA_DIR` = `/tmp/trustvault-data`
- `PRIVATE_FILES_DIR` = `/tmp/trustvault-private-files`

Generate secrets locally or with a password manager. Never commit them to Git or share them in chat.

The application requires ClamAV to scan production uploads and fails closed if the scanner is unavailable. This free demo configuration does not provision a ClamAV service, so uploads will return a scanner-unavailable response until a scanner is configured. Do not disable the scan or upload confidential files to work around this limitation. Login, authorization, local audit logging, and other routes can be tested once the service is configured and starts successfully.

Set Render's health check path to `/api/health`. Confirm the response indicates `demoMode: true` and `independentAuditAnchoring: false`.

## Vercel frontend

The `vercel.json` rewrite proxies `/api/*` to `https://trustvault-backend.onrender.com/api/*`. If Render assigns a different backend URL, update this destination in `vercel.json` on the same branch and redeploy Vercel.

Import the same GitHub repository into Vercel and use the `security-hardening-followup` branch for a preview. No build command is required; the frontend is static HTML/CSS/JS at the repository root.

## Validation

- Open the Vercel preview and confirm the page loads.
- Open `/api/health` on the frontend domain and confirm the health JSON response.
- Test sign-up/sign-in with synthetic accounts.
- Treat upload attempts that return scanner-unavailable as an expected limitation until ClamAV is provided.
- Do not upload real or confidential documents.

## Full deployment requirements

A full production deployment needs persistent storage for the SQLite database and private files, a reachable ClamAV scanner, and a compatible external audit-sink receiver/token. The free Render demo does not provide those pieces. Do not invent a sink URL or bypass security checks to make the service appear fully operational.
