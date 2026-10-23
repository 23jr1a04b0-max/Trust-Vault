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

The repository includes a non-root production image and a Compose file with persistent volumes for the SQLite database/audit key and private uploads. The published port binds to host loopback only, so place a TLS reverse proxy in front of it rather than exposing port 3000 directly.

1. Install Docker Engine and the Docker Compose plugin on a host with persistent disk.
2. Copy `.env.example` to `.env`. Keep `.env` out of Git.
3. Generate an audit key with `openssl rand -hex 32` and place it in `AUDIT_HMAC_KEY`.
4. Set `TRUSTED_ORIGINS` to the exact public HTTPS origin, such as `https://vault.example.com`. Do not leave the example origin.
5. Keep `SEED_DEMO_USERS=false`; Compose forces it off.
6. Build and start with `docker compose up --build -d`.
7. Check `docker compose ps` and `docker compose logs --tail=100 trustvault`. Test the health endpoint locally with `curl http://127.0.0.1:3000/api/health`.
8. Configure the TLS reverse proxy to forward to `127.0.0.1:3000`, then verify login, Origin checks, uploads, grants, revocation, and audit verification through the real HTTPS domain.
9. Back up the named volumes consistently and test restoration before storing any important data.

The CI workflow builds the image and starts it briefly to smoke-test the health endpoint. This is a container smoke test, not proof of a secure production deployment. Use a persistent host and independent backups; do not deploy confidential files until the known limitations below are addressed.

## Production configuration

- Set `NODE_ENV=production`.
- Set `AUDIT_HMAC_KEY` to a randomly generated secret of at least 32 bytes using the hosting platform's secret manager.
- Set `TRUSTED_ORIGINS` to the exact HTTPS origin(s), for example `https://vault.example.com`; do not include paths.
- Keep `SEED_DEMO_USERS` unset or false.
- Set `PORT` as required by the host.
- Persist and restrict `data/` and `private-files/`; keep them outside any static web root.
- Use HTTPS and a host with persistent storage. Verify backups and restore procedures.
- Verify health endpoint, cookies, Origin enforcement, uploads, grants, revocation, audit verification, and logs in the target environment.

No live deployment URL or production credentials are currently supplied by this repository. Do not claim deployment is complete until a real URL has been tested.
