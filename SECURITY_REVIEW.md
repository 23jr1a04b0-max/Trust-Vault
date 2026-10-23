# TrustVault implementation and security review

Review date: 2026-10-23

## Scope and branch

This review describes the GitHub working branch `security-hardening-followup`. Changes have been committed to this branch; `main` has not been changed by this work. This is an implementation review, not an independent security assessment.

## Automated checks verified on GitHub Actions

- `npm run check` passed, including JavaScript syntax checks, HTTP integration tests, source/schema checks, and the authorization mutation test.
- HTTP integration tests exercise private-document metadata isolation, owner-only permission and document-audit endpoints, global audit role boundaries, administrator content boundaries, Read versus Download and Edit permissions, grant expiry and revocation, access-request approval and repeat requests, owner-only deletion, public/private request boundaries, upload rejection cases including malformed multipart, duplicate fields, multiple files, MIME mismatch, and size limits, plus CSRF, login throttling, idle and absolute session expiry, account disablement, logout, and audit-chain consistency and database-only audit-event tampering detection.
- The production-mode HTTP test passed for missing/wrong/trusted Origin handling and Secure, HttpOnly, SameSite=Strict session cookies.
- The mutation test removes the download authorization guard in a temporary copy and verifies that the integration test fails on the expected Read-versus-Download assertion.
- GitHub Actions built the Docker image and started it with production configuration; the health endpoint smoke test passed.

Passing these checks does not establish that every route is secure, that the application has been penetration-tested, or that a live deployment is correct.

## Current implementation

- Node.js HTTP server with SQLite-backed users, sessions, documents, grants, access requests, and audit events.
- Password hashes use scrypt; sessions use random tokens stored as hashes, HttpOnly/SameSite cookies, CSRF tokens, idle and absolute expiry, and session invalidation on logout or account disablement.
- Production state-changing API requests require an exact configured Origin. Production session cookies include Secure.
- Public documents are discoverable to authenticated users, but visibility alone does not grant content access. Private document metadata is filtered by current access.
- Read grants permit inline viewing but not downloading or editing metadata. Download grants permit download; Edit grants also permit metadata updates. Owners can share, revoke, expire grants, and soft-delete their own documents.
- Uploads are size, extension, declared-MIME, and basic signature checked; generated storage names are kept outside the public static directory. Multipart parsing has basic malformed-input checks.
- Audit records use an HMAC-SHA-256 chain for new events with a separately configured production key. Administrators can inspect activity and request chain verification without automatically receiving document-content access.
- Docker image runs as a non-root user. Compose uses persistent volumes, loopback-only port binding, a read-only container root, dropped capabilities, and health checks.

## Remaining material risks

- No live deployment URL, verified production domain/reverse proxy, live role credentials, or recorded demo exists yet.
- Node's built-in SQLite API is experimental in the Node 22 runtime used by CI. A production database and migration/concurrency strategy need review.
- The custom multipart parser and basic file-signature checks need independent review/fuzzing. Production uploads are scanned through ClamAV and fail closed on scanner errors, but ClamAV is not a guarantee against all malicious files and there is no independent quarantine/parser sandbox.
- Login rate limiting is process-local; the repository includes a single-Nginx-instance rate-limit sample. Multi-instance or multi-edge hosting needs a shared limiter.
- Audit events and the persistent external-delivery outbox are now inserted atomically. A signed HTTPS sink client uses redirect refusal and retry/backoff. Audit HMAC does not protect against compromise of the application host/key; independently administered immutable receiver storage and its alerts must still be provisioned and tested.
- Production Origin checks have been tested in the application process, but behavior behind the actual TLS reverse proxy and deployed domain remains unverified.
- The Restic backup script and systemd timer template exist, but remote repository setup and restore drills remain outstanding. Administrator TOTP MFA is now implemented with encrypted secret storage, production enrollment enforcement, password reauthentication, and replay rejection; it still needs staging verification. Secure account recovery, monitoring/alerting, retention enforcement, and an independent security review remain outstanding.
- The current automated suite is focused, not exhaustive; broad route authorization, malformed image/PDF parser cases, audit truncation, and concurrent-stream revocation need more runtime coverage.

## Decision

TrustVault is a working review build with a passing CI and container smoke test. It is **not production-ready and not independently security-certified**. Do not use it for real confidential documents or represent it as a secure production service until the remaining risks are addressed and the deployed application is independently verified.


## Security hardening follow-up (2026-10-23)

Additional changes on the same feature branch validate exact HTTPS origins at startup, bound HTTP header/request/keep-alive timing, apply CSP and related security headers to static responses, limit access requests to Viewer accounts, reject path-bearing upload filenames, strengthen basic format-signature checks, reject invalid UTF-8 text and incomplete PDFs, bound notification retention per user, and clean stale sign-up rate-limit entries. Integration tests were added for these cases. Check the workflow run for the latest commit before relying on its result.

These changes do not close the deployment blockers above. No live domain/proxy verification, malware scanning/quarantine, shared multi-instance rate limiter, external immutable audit checkpoint, backup/restore drill, monitoring/alerting, MFA/password recovery, or independent security assessment has been completed in this work.


## Security hardening follow-up (2026-10-23, automated branch changes)

- Download streaming now rechecks current document and grant authorization as chunks are emitted, reducing the window in which a revocation or deletion can go unnoticed during a large transfer. This cannot retract bytes already delivered to a client.
- A local audit checkpoint records the latest sequence/hash and is checked during verification. The checkpoint is deliberately not reset when its anchored database event disappears, so database-only tail deletion remains detectable. This checkpoint is stored on the same host and is **not** an external immutable anchor; host/key compromise can defeat it.
- Added an integration regression test that deletes the latest audit event and expects verification to report a checkpoint mismatch.
- The changes are on `security-hardening-followup`; no changes have been made to `main`. Automated CI must pass before these changes should be considered validated.


## Additional review notes (2026-10-23)

- Both inline content and download streams now recheck current authorization as chunks pass through the response pipeline. If a grant is revoked or a document is deleted during transfer, the stream is aborted and a denied event is attempted. Bytes already sent cannot be recalled, and a timing window remains between checks and delivery.
- Local audit checkpoint files are excluded from Git. The checkpoint detects database-only tail deletion when the checkpoint itself remains intact, but it is on the same host and does not protect against host-level compromise or coordinated deletion of both database and checkpoint.
- Denied access-request expiry events now target the actual access-request ID rather than a request-correlation ID.
- Latest commit: `ea01bd79354766bf89ce43f97de2994f9f357349`. The workflow runs for this revision were still in progress at the time of this note. Do not treat the latest revision as validated until both the full check and container smoke test finish successfully.


## Latest verification update (2026-10-23)

- Latest recorded commit under review: `2c4e4f7a2b69df3f3f1a00586a37600546368825`.
- [GitHub Actions run for this exact commit](https://github.com/23jr1a04b0-max/Trust-Vault/actions/runs/39951811278) completed successfully, including JavaScript syntax checks, automated tests, TOTP enrollment/login/replay tests, authorization mutation test, proxy configuration tests, bootstrap test, backup script syntax, production container build, and health smoke test.
- Audit row/outbox writes are transactional, audit receiver requests cannot follow redirects, and streaming guards re-check session validity in addition to document/grant authorization.
- A one-time audited initial Administrator bootstrap command and regression test are included. Production administrator access now requires TOTP enrollment and a valid non-replayed code after enrollment; TOTP secrets are encrypted with a separate `MFA_ENCRYPTION_KEY` and setup requires password reauthentication. The application code and CI still cannot provision an external append-only audit receiver, real TLS domain, remote backup repository, or external alerting, and cannot replace an independent penetration test. Secure password recovery and an MFA recovery procedure remain outstanding.


## Current-head verification update (2026-10-23)

- Current reviewed branch: `security-hardening-followup`.
- Current head at the time of this update: `b7610e9880c25f6b60e93500d541a86adbd48d49`.
- [GitHub Actions for this head](https://github.com/23jr1a04b0-max/Trust-Vault/actions/runs/39952536998) completed successfully. The workflow reports success for `npm run check`, backup-script syntax validation, production container build, and production health smoke test.
- This validates repository CI only. It does not validate a real authenticator, production secrets, a live HTTPS proxy/domain, a separately administered immutable audit receiver, off-host backup restoration, monitoring/alerting, emergency account recovery, or independent penetration testing.
- Release status remains **NOT READY for confidential production data** until the external checklist in `docs/PRODUCTION_READINESS.md` has evidence.
