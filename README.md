# TrustVault: Secure Document Sharing

TrustVault is a security-first document workspace. Document owners upload files, choose Public or Private visibility, and grant named people document-specific Read, Download, or Edit permissions with optional expiry. Every protected document request is authorized on the server. Revoking a grant blocks the next protected request. Administrators can inspect account status and audit metadata, but administrator role alone does not grant document-content access.

**Status: review build, not production-ready.** The working implementation uses Node.js, the built-in HTTP server, the built-in SQLite module, and plain JavaScript. Node's built-in SQLite API is experimental in the tested runtime. The repository still needs a verified public deployment, a production database and migration strategy, independent audit anchoring, operational hardening, and an external security review.

## In-app notifications

TrustVault stores notifications per recipient. Administrators are notified about new Document Owner registrations; owners are notified about requests for their public documents; viewers are notified when an owner approves or rejects an access request; and owners receive an in-app message when their account is approved or rejected. The bell beside the profile in the dashboard header shows the unread count. Opening the notification panel marks existing notifications as read and clears the count to zero; newly received notifications increment it again. The dashboard refreshes the count periodically. Notifications are in-app only; no email delivery is configured.

## Sign-in and account registration

The initial screen asks users to choose Document Owner, Viewer, or Administrator before opening the corresponding sign-in form. Public self-registration is available only for Document Owner and Viewer accounts, requires a name, email, and password of at least 12 characters, and rejects duplicate email addresses. Viewer accounts are immediately active. New Document Owner accounts are created with `approval_status=Pending` and cannot sign in until an administrator approves them. Administrators can approve or reject owner requests from the account-management panel; decisions are audited. Existing accounts are migrated as `Approved` to avoid unexpectedly locking out existing owners. Public registration cannot create administrator accounts. The server validates the selected sign-in role against the role stored on the account; the selection is only a navigation and account-type hint, never a permission grant. Email ownership verification and password reset are not implemented yet, so this build should not be exposed as a public production service.

## Roles and permission model

| Role | Allowed actions | Explicitly not allowed |
|---|---|---|
| Administrator | Review recent audit metadata and integrity status; list accounts; disable or re-enable other accounts | Does not automatically read, download, edit, delete, or grant access to documents |
| Document owner | Upload, search, read, download, edit details, soft-delete, grant and revoke permissions for owned documents | Cannot administer accounts or see documents they do not own or have been granted |
| Viewer | View content with an active Read, Download, or Edit grant; Download and Edit grants permit downloading; Edit grants also permit changing the document name and category | Cannot upload, delete, grant access, inspect owner-only document history, or access ungranted documents |

Access is per document, not inherited from folders. The server checks the current grant state on each protected request. Revocation cannot recall a copy already downloaded or a transfer already in progress.

## Requirements

- Node.js 22.5 or later. Use a supported Node.js LTS version for deployment and review the SQLite runtime status.
- No third-party npm packages are required.

## Clean setup

```bash
npm run setup
```

The setup command creates the local database from `db/schema.sql` and creates the private upload directory. The server applies the same schema at startup and migrates the current session and audit schema when needed.

Copy `.env.example` to `.env`, then edit the values for your local setup. On Windows PowerShell, use `Copy-Item .env.example .env`. Start the server with:

```powershell
node --env-file=.env server.mjs
```

Open `http://localhost:3000`.

## Run with Docker Compose

Docker and the Docker Compose plugin are required. For a production-style container, copy the example environment file and set the real trusted HTTPS origin, a fresh audit key, a separate MFA encryption key, and an independently administered HTTPS append-only audit receiver URL/token. The receiver is mandatory in production; a placeholder URL is only for CI tests. Do not commit the resulting .env file.

```bash
cp .env.example .env
openssl rand -hex 32
# Paste the generated value into AUDIT_HMAC_KEY in .env.
# Set TRUSTED_ORIGINS to your exact HTTPS origin.
# Set AUDIT_SINK_URL and AUDIT_SINK_TOKEN for a separately administered
# HTTPS receiver that verifies signatures and writes to append-only storage.
docker compose up --build -d
docker compose ps
docker compose logs --tail=100 trustvault
```

Compose binds the app to host loopback at port 3000 and stores database/audit state and uploaded files in persistent named volumes. Configure the sample TLS/rate-limiting reverse proxy before using a public domain. Compose also runs an internal ClamAV scanner; production uploads fail closed if scanning is unavailable. See the [deployment guide](docs/DEPLOYMENT.md), [backup/restore runbook](docs/BACKUP_RESTORE.md), and [production readiness gate](docs/PRODUCTION_READINESS.md) for operational requirements.

## Initial production administrator

Production disables demo seeding and public administrator registration. After starting the healthy Compose stack, create the first Administrator once using the audited bootstrap script. Follow [the deployment instructions](docs/DEPLOYMENT.md) to enter the email, display name, and password as shell variables and run `docker compose exec ... node scripts/create-admin.mjs`. The script refuses to add a second Administrator, requires the production audit configuration, stores only a password hash, and records the bootstrap in the audit chain/outbox. Use a unique password manager-generated password of at least 16 characters. Administrator TOTP MFA is enforced for production administrator tools and sign-ins after enrollment. Generate a separate `MFA_ENCRYPTION_KEY` with `openssl rand -hex 32`; losing it makes enrolled TOTP secrets unrecoverable. Secure account recovery is still outstanding.

## Local demo accounts

No accounts are created unless development seeding is explicitly enabled. For synthetic local testing only, edit `.env` and set `NODE_ENV=development`, `SEED_DEMO_USERS=true`, and `DEMO_SEED_PASSWORD` to a unique password of at least 14 characters. Then run `node --env-file=.env server.mjs`. In PowerShell, use `npm.cmd run setup` and `npm.cmd run check` if the `npm` command is blocked by script execution policy.

This creates these accounts with the configured `DEMO_SEED_PASSWORD`:

- Administrator: `admin@trustvault.test`
- Document owner: `owner@trustvault.test`
- Viewer: `viewer@trustvault.test`

Do not use this seeding mode on a public service. Do not use real confidential files in the demo.

## Tests

```bash
npm test
npm run check
```

The HTTP integration test uses a disposable local server and verifies private-document metadata isolation, administrator content boundaries, Read-versus-Download and Read-versus-Edit separation, grant expiry, revocation, public metadata discovery, duplicate pending-request rejection, repeated requests after decisions, owner approval, upload parser rejection cases, CSRF enforcement, login rate limiting, account disable/session invalidation, logout, and audit-chain consistency, self-disable protection, and runtime detection of audit-event tampering. The mutation check removes the download authorization guard in a temporary copy and requires the integration test to fail specifically because Read-only access can download. Audit tampering, tail truncation, checkpoint deletion across restart, production Origin enforcement, scanner protocol behavior, signed audit-sink delivery, and download authorization mutation are covered by automated tests. This still does not replace a full route-by-route penetration test. Production Origin enforcement and Secure-cookie behavior are covered by a separate production-mode HTTP test.

GitHub Actions also builds the production Docker image and starts it briefly to smoke-test the health endpoint. Passing these tests is not a penetration test or a production certification.

## Important environment settings

- `NODE_ENV=production` requires `AUDIT_HMAC_KEY` to contain at least 32 bytes. Supply it through your hosting platform's secret manager. Never commit the production value.
- `TRUSTED_ORIGINS` must contain exact trusted origins, including scheme and optional port, separated by commas. Production state-changing API requests fail closed if the Origin is missing or not allowed.
- `MAX_UPLOAD_BYTES` defaults to 10 MiB.
- `SEED_DEMO_USERS` must remain false in production.
- Production startup requires `AUDIT_SINK_URL` and `AUDIT_SINK_TOKEN`; the receiver must be independently administered, verify `X-TrustVault-Signature`, deduplicate `Idempotency-Key`, and retain events immutably. Inspect `/api/audit/sink-status` as an Administrator.
- `CLAMAV_HOST` and `CLAMAV_PORT` identify the internal scanner; Compose configures these automatically.

The audit HMAC key must be protected independently of the database. HMAC makes database-only edits detectable when the key remains secret. It does not protect against an attacker who controls the application host and the key. Production still needs independently controlled immutable audit checkpoints.

## API, threats, deployment, and demo

- [API reference](docs/API.md)
- [Architecture and schema](docs/ARCHITECTURE.md)
- [Security operations](docs/SECURITY.md)
- [Implementation and security review](SECURITY_REVIEW.md)
- [Threat register](THREATS.md)
- [Deployment checklist](docs/DEPLOYMENT.md)
- [Evidence-based production readiness gate](docs/PRODUCTION_READINESS.md)
- [Backup and restore runbook](docs/BACKUP_RESTORE.md)
- [Five-minute demo script](docs/DEMO_SCRIPT.md)
- [Challenge write-up](docs/CHALLENGE_WRITEUP.md)
- [AI prompt journal](PROMPTS.md)
- [Implementation notes](docs/IMPLEMENTATION_NOTES.md)

## Submission status

The live URL, live role credentials, recorded demo video, multi-day commit history, and external security assessment are not yet complete. The GitHub branch has automated checks, but this is not a production certification. Do not present any of these as finished. Keep `PROMPTS.md` accurate and add entries when real follow-up work and commits occur.
