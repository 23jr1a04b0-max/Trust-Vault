# TrustVault

TrustVault is a project I built to make sharing sensitive documents safer. Instead of giving someone access to an entire folder, the owner can decide exactly what another person is allowed to do with each document. The app also keeps an audit trail so document activity can be reviewed later.

**Current status: working project / review build — not ready for real confidential files.** The main flows and security checks are implemented and covered by automated tests, but a few important production steps still need to be completed and verified on real infrastructure.

## What the app does

- **Upload and manage documents:** owners can upload, search, view, update details, and soft-delete their own documents.
- **Share with specific people:** owners can give a user Read, Download, or Edit access to an individual document, set an expiry, and revoke access.
- **Request access:** viewers can request access to public documents. Owners can approve or reject requests.
- **Separate user roles:** Document Owner, Viewer, and Administrator have different permissions. Choosing a role on the sign-in screen does not grant permissions by itself.
- **Owner account approval:** new owner accounts stay pending until an administrator approves them. Viewer accounts can register and use the app without that approval.
- **Notifications:** the app shows in-app notifications for owner approval decisions and document access requests. It does not currently send email notifications.
- **Audit history:** security-related activity is recorded and administrators can review audit metadata and check the integrity of the local audit chain.

## How access works

Permissions are checked by the server, not just by the website interface. A Read grant allows viewing but not downloading or editing. A Download grant allows downloading, and an Edit grant also allows changing document details. Access can expire or be revoked, and protected requests check the current permission.

An Administrator can manage accounts and review audit information, but the role does **not** automatically allow them to read or download users' documents. Public visibility makes a document discoverable to signed-in users; it does not by itself give them access to its contents.

Revoking access prevents the next protected request, but it cannot take back a file someone already downloaded or bytes already delivered during a transfer.

## Security work included

The repository includes several security controls and tests:

- Password hashing and server-side role and document-permission checks.
- Session tokens stored as hashes, secure cookie settings in production, CSRF protection, session expiry, and login rate limiting.
- Checks for trusted request origins in production.
- Upload size/type checks and private file storage outside the public web folder.
- ClamAV scanning for production uploads; uploads fail closed if the scanner is unavailable.
- HMAC-chained audit records, checkpoint checks, and a signed HTTPS audit-delivery client with retries.
- TOTP multi-factor authentication for production Administrator access.
- Docker and reverse-proxy examples, plus backup and restore scripts.

These are implemented controls, not a claim that the app is impossible to break. The audit receiver, TLS/domain setup, remote backups, monitoring, and restore process still need to be configured and verified for the target environment.

## Tech stack

- **Backend:** Node.js and its built-in HTTP server
- **Database:** SQLite using Node's built-in SQLite API
- **Frontend:** HTML, CSS, and JavaScript
- **Security and deployment:** Docker Compose, ClamAV, Nginx configuration examples, and GitHub Actions tests

The project requires **Node.js 22.5 or later**. Node's built-in SQLite API is experimental in the Node 22 runtime used by CI, so the database choice and migration/concurrency plan need review before production use. No third-party npm packages are required for the local setup.

## Run it locally

1. Install Node.js 22.5 or later.
2. Clone this repository and open a terminal in the project folder.
3. Create the local database and upload folder:

   ```bash
   npm run setup
   ```

4. Copy `.env.example` to `.env` and adjust the values for your local environment. On Windows PowerShell:

   ```powershell
   Copy-Item .env.example .env
   ```

5. Start the server:

   ```powershell
   node --env-file=.env server.mjs
   ```

6. Open [http://localhost:3000](http://localhost:3000).

### Optional demo accounts

Demo accounts are **not** created by default. For local testing only, set these values in `.env`:

- `NODE_ENV=development`
- `SEED_DEMO_USERS=true`
- `DEMO_SEED_PASSWORD=` a unique password of at least 14 characters

Then start the server again. The seeded accounts are:

- Administrator: `admin@trustvault.test`
- Document Owner: `owner@trustvault.test`
- Viewer: `viewer@trustvault.test`

Use the password you set for all three accounts. Do not enable demo seeding on a public deployment or use real documents with these accounts.

## Run the tests

```bash
npm test
npm run check
```

The test suite covers role and document permissions, grant expiry and revocation, upload validation, access requests, CSRF and login limits, session invalidation, audit integrity, production origin/cookie behavior, audit delivery, Administrator setup, and other security-related checks. The check command also runs an authorization mutation test to confirm that a missing download guard is caught.

GitHub Actions also builds the production Docker image and performs a health-endpoint smoke test. Passing CI is useful evidence, but it is not an independent penetration test or a guarantee that a deployed service is secure.

## Deployment status and known gaps

The repository contains deployment examples for a Vercel frontend and a Node.js backend, as well as a Docker Compose setup. A configured URL or successful CI run should not be taken as proof that the full service is live and production-ready.

Before using real confidential documents, the deployment still needs:

- Persistent, protected storage for the database and uploaded files.
- A working ClamAV service tested with clean files, test malware, and scanner-failure cases.
- A separately administered append-only audit receiver, with signature verification, retention, and alerting configured.
- A real HTTPS domain/reverse proxy and checks of the deployed setup.
- Encrypted off-host backups and a successful restore drill.
- Monitoring, alerting, secure account recovery, and an independent security review.

Email ownership verification and password reset are not implemented. Administrator MFA is implemented in the code, but production enrollment and recovery procedures still need proper operational testing. A free hosting demo may use temporary storage and may not have a scanner or independent audit receiver, so it must use synthetic test data only.

**Please treat TrustVault as a review/demo build until the production readiness checklist has been completed. Do not upload real confidential documents yet.**

## More details

- [API reference](docs/API.md)
- [Architecture and database schema](docs/ARCHITECTURE.md)
- [Security notes](docs/SECURITY.md)
- [Implementation and security review](SECURITY_REVIEW.md)
- [Threat register](THREATS.md)
- [Deployment guide](docs/DEPLOYMENT.md)
- [Production readiness checklist](docs/PRODUCTION_READINESS.md)
- [Backup and restore guide](docs/BACKUP_RESTORE.md)
- [Demo walkthrough](docs/DEMO_SCRIPT.md)
- [Project challenge write-up](docs/CHALLENGE_WRITEUP.md)
- [Implementation notes](docs/IMPLEMENTATION_NOTES.md)
- [AI prompt journal](PROMPTS.md)

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE).
