# Production Readiness Gate

**Status: NOT READY for confidential or regulated documents.** This document tracks evidence, not intentions. A checklist item is complete only when an operator has performed it in the target environment and recorded dated evidence.

## Verified in repository CI

- [x] Automated checks and regression tests passed on commit `be8bd94d6a72fe69fab189d5d2e39ba93aa2fbed`: [GitHub Actions run](https://github.com/23jr1a04b0-max/Trust-Vault/actions/runs/39944927977).
- [x] CI builds and smoke-tests the production container.
- [x] Workflow permissions are read-only for repository contents; concurrency cancels superseded runs.
- [x] Dependabot is configured to propose weekly npm and GitHub Actions updates.
- [x] Document authorization checks, session controls, CSRF/production Origin checks, upload size/type/signature checks, private file storage, audit-chain verification, and local checkpoint detection have repository tests or implementation coverage. This is not an independent penetration test.
- [x] Backup/restore procedure is documented in [BACKUP_RESTORE.md](BACKUP_RESTORE.md).

## Required before accepting real confidential files

### Infrastructure and identity

- [ ] Deploy behind a maintained TLS reverse proxy; verify TLS externally and confirm the application port is not reachable from the public internet.
- [ ] Configure a shared edge rate limiter for login and sign-up routes. The built-in limiter is process-local and is not sufficient for multiple replicas or coordinated distributed attacks. Do not trust client-supplied forwarding headers unless the proxy boundary is configured to overwrite them.
- [ ] Establish administrator MFA and a secure, tested account recovery process. Current application sign-in is password-based.
- [ ] Set and verify exact `TRUSTED_ORIGINS`, production `AUDIT_HMAC_KEY`, persistent volumes, file permissions, secret rotation and access controls. Never enable demo seeding in production.
- [ ] Verify the production hostname and deployment configuration using an authorized external test. No production URL was available during this review.

### Upload and malware controls

- [ ] Add malware scanning and quarantine before uploaded files become downloadable. Signature/extension checks are not malware detection and do not safely parse every file format.
- [ ] Run scanning in a restricted process/container with bounded CPU, memory, time, and file size. Fail closed if the configured scanner is unavailable; retain a clear quarantined/rejected state and audit event.
- [ ] Test malformed, oversized, polyglot, encrypted, and scanner-evasion samples in an isolated environment. Do not use real malware on a production host.

### Audit integrity

- [ ] Forward audit events or signed checkpoints to a separately administered append-only/immutable system (for example, object storage with retention lock or an independent logging service). Keep credentials and administration separate from the application host.
- [ ] Alert on checkpoint mismatch, audit verification failure, missing log delivery, and audit write failure.
- [ ] Perform a controlled tampering test in staging and verify the external copy detects database and same-host checkpoint tampering.
- [ ] Define retention, access review, clock synchronization, export, and incident-response procedures.

The local HMAC chain and local checkpoint are useful tamper-evidence controls, but an administrator or attacker able to alter the database, checkpoint, and local key may defeat them. They are not a substitute for independent anchoring.

### Operations and recovery

- [ ] Configure encrypted automated off-host backups of both the database/audit checkpoint and private files. Store the HMAC key separately in an approved secret manager.
- [ ] Complete a restore drill in isolated staging, including audit verification, document integrity, owner/grant checks, and a measured recovery time.
- [ ] Configure centralized logs, uptime/health monitoring, alert delivery, disk-capacity alerts, and an incident response owner.
- [ ] Set and test retention/deletion policy, backup expiry, key rotation/recovery, and recovery point/time objectives.
- [ ] Run dependency and container vulnerability scans; review and remediate results.
- [ ] Obtain an independent security review / penetration test and close all critical/high findings.

## Deployment evidence log

For every completed item, record: date/time, operator, environment, exact commit/image digest, test command or external tool, outcome, and evidence location. Do not place secrets, personal data, or document contents in the evidence log.

| Date | Environment / commit | Check | Result | Evidence / operator |
|---|---|---|---|---|
| 2026-10-23 | GitHub Actions, `be8bd94d6a72fe69fab189d5d2e39ba93aa2fbed` | Repository CI and container smoke test | Pass | [Run 39944927977](https://github.com/23jr1a04b0-max/Trust-Vault/actions/runs/39944927977) |
| Not run | Production hostname not supplied | External TLS/proxy, rate-limit, backup restore, malware scan, independent audit anchor | Not verified | Requires target infrastructure and credentials |

## Release rule

Do not call TrustVault production-ready until all required items above are checked with evidence, critical/high independent review findings are closed, and a responsible operator approves the release. A green CI run alone is not a production security sign-off.
