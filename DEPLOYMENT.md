# Deployment notes (Vercel + Render)

TrustVault's UI is hosted by Vercel. Its Node.js API, SQLite database, uploaded files, and ClamAV scanning run on Render. Keep the API and data storage on the backend; do not move SQLite or private uploads into Vercel Functions.

## 1. Render backend

1. In Render, create a Blueprint from this repository and choose the `security-hardening-followup` branch.
2. Review the services before applying. The blueprint defines a private ClamAV image service and a Docker web service.
3. Configure these backend environment variables:
   - `TRUSTED_ORIGINS`: the exact Vercel frontend origin, e.g. `https://your-project.vercel.app` (no trailing slash). Update it if the Vercel project URL changes.
   - `AUDIT_SINK_URL` and `AUDIT_SINK_TOKEN`: a reachable, compatible TrustVault audit-sink receiver and its token. The production server intentionally refuses to start without these.
4. Keep the persistent disk mounted at `/app/data`. SQLite, audit checkpoints, and the audit key must survive restarts. Uploaded documents live in `/app/private-files`; configure persistent storage for that directory too before using persistent uploads.
5. Confirm `/api/health` returns `{"ok":true}` before connecting the frontend.

The audit sink is a separate integration and is not included in this repository's current deployment blueprint. Do not invent a sink URL or disable the production checks just to make the service start.

## 2. Vercel frontend

The `vercel.json` rewrite proxies `/api/*` to the Render backend, so browser requests and session cookies stay on the Vercel origin. After Render assigns the actual backend URL, update the rewrite destination in `vercel.json` if it differs from `https://trustvault-backend.onrender.com`.

Import the same GitHub repository into Vercel and use the `security-hardening-followup` branch for a preview. No build command is required; the frontend is static HTML/CSS/JS at the repository root.

## 3. Validation

- Open the Vercel preview and confirm the page loads.
- Open `/api/health` on the frontend domain and confirm the JSON health response.
- Test sign-up/sign-in and the document flows with synthetic files only.
- Do not upload real or confidential documents to a demo deployment.

## Important limitations

This deployment needs the audit-sink receiver to be fully runnable in production. The current blueprint also persists the database under `/app/data`; configure an additional persistent disk for `/app/private-files` before expecting uploaded documents to survive service restarts or redeploys. Never put credentials in Git.
