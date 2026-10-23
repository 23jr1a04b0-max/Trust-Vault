# Production Readiness Gate

**Release status: NOT READY until every required external control is configured and evidenced.** Repository CI is not production deployment evidence.

## Implemented in the repository

- Server-side document authorization, grant expiry/revocation checks, session expiry, CSRF and production Origin checks.
- HMAC-chained audit events, local checkpoint, checkpoint initialization marker, tamper/truncation regression tests.
- Signed HTTPS audit delivery with a persistent outbox, retry/backoff, idempotency key and administrator status endpoint. Production startup now requires an HTTPS audit receiver configuration.
- Production upload scanning through an internal ClamAV service. Malware findings and scanner failures fail closed before storage.
- Nginx reverse-proxy sample with TLS settings, request limits, trusted forwarding headers, and per-client login/sign-up rate limits.
- One-time audited production Administrator bootstrap script with a regression test that refuses a second Administrator.
- CI test suite and production-container smoke test; Dependabot update proposals.
- Backup/restore procedure in [BACKUP_RESTORE.md](BACKUP_RESTORE.md), plus a Restic backup script and daily systemd timer template. The timer still has to be installed and configured on the host.

## Required evidence before real confidential files

### External audit receiver

- [ ] Configure `AUDIT_SINK_URL` and `AUDIT_SINK_TOKEN` in the host secret manager and deploy a receiver administered separately from the TrustVault host.
- [ ] Receiver must verify `X-TrustVault-Signature` as HMAC-SHA256 of the exact raw request body using the separately shared audit key, enforce authentication, deduplicate `Idempotency-Key`, and append to immutable/retention-locked storage.
- [ ] Verify delivery, retry after temporary outage, backlog recovery, signature rejection, duplicate suppression, and alerting. Confirm receiver retention and access logs.
- [ ] Check authenticated `GET /api/audit/sink-status` as Administrator; pending backlog should return to zero after receiver recovery.
- [ ] Configure alerts for delivery failures, oldest pending event age, growing outbox, audit verification failure, and missing event delivery. The application currently logs delivery failures but does not itself deliver alert notifications.

The local outbox and signed webhook are not an immutable audit store. Without a separate receiver and verified immutable retention, audit anchoring is not complete.

### Malware scanning

- [ ] Start Compose and verify ClamAV reports healthy; ensure port 3310 is not published to host/internet.
- [ ] Upload a synthetic clean test file, and verify a harmless EICAR test file is rejected in an isolated staging environment.
- [ ] Stop ClamAV in staging and verify uploads return a temporary failure without storing the file.
- [ ] Verify ClamAV signatures update and monitor freshness, memory, CPU, disk, and service health.
- [ ] Test malformed/polyglot files and parser behavior in an isolated test environment. ClamAV does not guarantee detection of every threat.

### Rate limiting and HTTPS

- [ ] Install the Nginx configuration in `deploy/nginx/`, configure real certificates and the actual hostname, validate with `nginx -t`, then test externally.
- [ ] Confirm app port 3000 is reachable only from loopback/proxy; scanner port 3310 is not public.
- [ ] Verify login/sign-up limits from separate clients and confirm trusted forwarding headers cannot be spoofed.
- [ ] For multiple edge proxies, replace local Nginx zones with a shared rate-limiting service.

### Backups, monitoring, identity and review

- [ ] Install/configure `scripts/backup.sh` and `deploy/systemd/trustvault-backup.timer`; set up an encrypted off-host Restic repository, root-only password file, and separate HMAC/sink secret recovery. Run it successfully on the target host.
- [ ] Complete an isolated restore drill and verify audit chain, external audit receiver continuity, document bytes, and access grants.
- [ ] Configure central logs, uptime/health checks, disk-capacity monitoring, alert routing, retention, and incident response.
- [ ] Create the initial Administrator with `scripts/create-admin.mjs`, confirm the bootstrap audit event is delivered, test TOTP MFA with a real authenticator in staging, securely back up `MFA_ENCRYPTION_KEY`, and implement an audited emergency MFA reset plus secure account-recovery workflow.
- [ ] Complete an independent security assessment; remediate critical/high findings.
- [ ] Record exact commit/image digest, date, operator, commands, results, and evidence for every verification.

## Environment verification log

| Check | Status | Evidence |
|---|---|---|
| Repository tests and production image smoke test | Must pass for current head | [GitHub Actions](https://github.com/23jr1a04b0-max/Trust-Vault/actions) |
| Actual TLS hostname and reverse proxy | Not verified; no production hostname available | Operator evidence required |
| Independent append-only audit receiver | Adapter implemented; receiver not provisioned or tested | External service required |
| ClamAV production service | Compose integration implemented; full Compose runtime not verified here | Run staging verification |
| Automated off-host backup and restore | Script and systemd timer template implemented; remote repository, timer installation, and restore drill not verified | Operator evidence required |
| Initial Administrator bootstrap | Script and automated test implemented; run once on the actual host | Operator evidence required |
| Administrator TOTP MFA | Implemented and CI-tested; real authenticator staging verification, key recovery plan, and emergency reset workflow outstanding | Operator evidence required |
| Monitoring, secure account recovery, independent security review | Outstanding | Implementation/third-party work required |

**Release rule:** Do not deploy confidential or regulated documents until the required items have dated evidence and a responsible operator approves the release.
