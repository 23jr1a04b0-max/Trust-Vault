# Deployment Checklist

TrustVault is not yet production-ready. Do not deploy it for confidential documents until the limitations in [Security Operations](SECURITY.md) are addressed.

## Local run

Requirements: Node.js 22.5 or later.

1. Clone the repository and check out the working branch.
2. Run `npm run setup`.
3. Copy `.env.example` to `.env` and configure local values.
4. For local synthetic demo accounts only, set `NODE_ENV=development`, `SEED_DEMO_USERS=true`, and `DEMO_SEED_PASSWORD` to a unique password of at least 14 characters.
5. Run `node --env-file=.env server.mjs`.
6. Open `http://localhost:3000`.
7. Run `npm run check` and review the GitHub Actions result.

Demo accounts, when explicitly seeded, are `admin@trustvault.test`, `owner@trustvault.test`, and `viewer@trustvault.test`. All use the configured local demo password. Never use these accounts on a public deployment.

## Docker Compose deployment

The repository includes a non-root production image, persistent volumes for the SQLite database/audit key and private uploads, and an internal ClamAV service. Production uploads fail closed if malware scanning is unavailable or reports malware. The published application port binds to host loopback only, so place a TLS reverse proxy in front of it rather than exposing port 3000 directly.

1. Install Docker Engine and the Docker Compose plugin on a host with persistent disk.
2. Copy `.env.example` to `.env`. Keep `.env` out of Git.
3. Generate a fresh audit key with `openssl rand -hex 32` and place it in `AUDIT_HMAC_KEY`.
4. Generate a **different** MFA encryption key with `openssl rand -hex 32` and place it in `MFA_ENCRYPTION_KEY`. Do not reuse the audit HMAC key. Losing this key makes enrolled administrator TOTP secrets unrecoverable.
5. Set `TRUSTED_ORIGINS` to the exact public HTTPS origin, such as `https://vault.example.com`. Do not leave the example origin. Configure the independently administered HTTPS audit receiver URL/token.
6. Keep `SEED_DEMO_USERS=false`; Compose forces it off.
7. Build and start with `docker compose up --build -d`.
8. Check `docker compose ps` and `docker compose logs --tail=100 trustvault`. Test the health endpoint locally with `curl http://127.0.0.1:3000/api/health`.
9. Create the initial Administrator exactly once after the application container is healthy. The script refuses to create another Administrator and records the bootstrap event in the audit chain/outbox. In a Bash shell, use:
   ```bash
   read -r -p "Administrator email: " ADMIN_EMAIL
   read -r -p "Administrator display name: " ADMIN_NAME
   read -r -s -p "Administrator password (16+ characters): " ADMIN_PASSWORD
   printf '\n'
   docker compose exec -e ADMIN_EMAIL="$ADMIN_EMAIL" -e ADMIN_NAME="$ADMIN_NAME" -e ADMIN_PASSWORD="$ADMIN_PASSWORD" trustvault node scripts/create-admin.mjs
   unset ADMIN_PASSWORD
   ```
   Use a unique password from a password manager. Do not paste the password into the command text or commit it. Confirm the script reports success, then sign in and verify audit delivery.
10. Configure a TLS reverse proxy to forward to `127.0.0.1:3000`. The sample in `deploy/nginx/` provides TLS, request-size limits, trusted forwarding headers, and per-client login/sign-up rate limits. Install the proxy-header snippet in the configured Nginx snippets directory and include `trustvault-limits.conf` inside the Nginx `http {}` context. Replace the example hostname/certificate paths and run `nginx -t` before reload. The sample rate zones are local to one Nginx instance; multi-edge deployments need a shared rate-limit service.
11. On the first Administrator sign-in, set up an authenticator app in the MFA panel and verify a six-digit TOTP code. Subsequent Administrator sign-ins require a fresh code.
12. Verify login, Origin checks, uploads with a clean test file, malware rejection using the EICAR test file in an isolated non-production test, scanner-outage fail-closed behavior, grants, revocation, and audit verification through the real HTTPS domain.
13. Configure the [automated Restic backup script](../scripts/backup.sh) and [systemd timer](../deploy/systemd/trustvault-backup.timer). Install Restic on the host, create an encrypted remote repository with `restic init`, configure `/etc/trustvault/backup.env` with `RESTIC_REPOSITORY` and `RESTIC_PASSWORD_FILE`, restrict it to root (`chmod 600`), then install/enable the service and timer. Run one backup manually and verify a restore before relying on the schedule.
14. Follow the [Backup and Restore Runbook](BACKUP_RESTORE.md) to protect the HMAC key separately, verify backups, and test restoration in isolated staging before storing any important data.

The CI workflow builds the image and starts it briefly to smoke-test the health endpoint. This is a container smoke test, not proof of a secure production deployment. Use a persistent host and independent backups; do not deploy confidential files until the known limitations below are addressed.

## Production configuration

- Set `NODE_ENV=production`.
- Set `AUDIT_HMAC_KEY` to a randomly generated secret of at least 32 bytes using the hosting platform's secret manager.
- Set `TRUSTED_ORIGINS` to the exact HTTPS origin(s), for example `https://vault.example.com`; do not include paths.
- Keep `SEED_DEMO_USERS` unset or false.
- Set `PORT` as required by the host.
- Persist and restrict `data/` and `private-files/`; keep them outside any static web root.
- Use HTTPS and a host with persistent storage. Verify backups and restore procedures.
- Keep ClamAV's TCP port private to the Compose network. Do not publish port 3310 to the host or internet. Keep the scanner signatures updated and monitor scanner health.
- Install and test the sample Nginx rate-limit configuration or an equivalent shared edge limiter before public access.
- Verify health endpoint, cookies, Origin enforcement, uploads, grants, revocation, audit verification, and logs in the target environment.

No live deployment URL or production credentials are currently supplied by this repository. Do not claim deployment is complete until a real URL has been tested.
