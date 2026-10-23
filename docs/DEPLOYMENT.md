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
