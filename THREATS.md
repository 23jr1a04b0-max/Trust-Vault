# TrustVault threat register

This is a working threat register. Verification status reflects the automated tests currently in the repository; it is not a claim of independent security certification.

| Threat | Current mitigation | Verification status | Remaining work |
|---|---|---|---|
| Guessing a document ID (IDOR) | Metadata, content, download, and owner actions check current owner/grant state | HTTP tests cover private metadata isolation, owner-only permission/audit endpoints, admin content denial, Read-only content, denied download, post-revocation denial, and cross-owner attempts to read/download, inspect grants/audit, edit, and delete another owner's document | Continue adding route-by-route tests for every method and role |
| Read permission used to download or edit | Content, download, and metadata update have separate checks | HTTP tests confirm Read can view but cannot download or edit; mutation test removes download guard and expects the authorization assertion to fail | Extend to every route and permission combination |
| Private metadata leakage | Listing filters to owned/granted documents; Public is explicit metadata discovery | HTTP test checks ungranted viewer and administrator do not see private document metadata | Test deleted docs, disabled accounts, and list-query edge cases |
| Expired/revoked grants | Every protected content request checks expiry and revocation | HTTP tests verify expired grants disappear from private listing and content is denied, and revoked grants block next requests | Test timezone edge cases, concurrent streams, and expiry during transfer |
| Unauthorized access requests | Requests limited to Public docs and non-owners; duplicate pending requests rejected | HTTP test covers public discovery, duplicate pending rejection, approval, and a later request after decision | Add self-request, private request, rejection and cross-owner request tests |
| Upload abuse | Size cap, extension/MIME/signature checks, generated storage keys outside public directory; multipart parser rejects malformed boundaries and duplicate fields | HTTP tests exercise valid TXT upload, malformed multipart, duplicate fields, multiple files, MIME mismatch, configured size limits, and NUL-containing TXT rejection | Added path-bearing filename, invalid UTF-8 text, incomplete-PDF, MIME mismatch, malformed multipart and size-limit rejection tests. Production upload scanning now fails closed through ClamAV, but basic signatures and ClamAV are not equivalent to full format parsing or a sandbox; fuzzing and independent parser review remain needed |
| Session theft/fixation and CSRF | Random session token stored as hash, HttpOnly/SameSite cookie, session rotation, CSRF token on mutations, idle and absolute expiry | HTTP tests cover CSRF denial, logout, idle and absolute session expiry, and invalidation after account disable | Idle and absolute expiry plus production Secure-cookie tests now pass; add more cookie, rotation, and proxy deployment tests |
| Login brute force | Generic login errors and in-process IP/account rate limiter | HTTP test confirms repeated failed attempts result in 429 | Bound stale in-process limiter entries to reduce memory growth; a shared edge rate limiter is still required for multi-instance deployment and proxy IP handling needs review |
| Audit modification | HMAC-SHA256 chained events; production key configured separately; local checkpoint initialization marker prevents silent re-anchoring after checkpoint deletion on restart | HTTP tests verify chain consistency after normal and denied operations, detect a modified stored event and tail deletion, and now test checkpoint deletion across restart | A same-host attacker can still alter database, checkpoint, marker and key together; the signed HTTPS audit outbox now retries delivery, but an independently administered immutable receiver and alerting remain required |
| Administrator privilege escalation | Admin account endpoints check Administrator role; admin role alone does not grant document-content access; owner registration decisions require Administrator role | HTTP test checks administrator cannot access private document content without a grant; new integration test checks a Viewer cannot approve owner registration | Continue testing all admin endpoints and approval-state transitions and denied-event assertions |
| SQL injection and stored XSS | Prepared statements for user input and DOM textContent for displayed data | Code review only | Add payload tests, security scanning, and dependency/runtime review |
| Production Origin bypass | Mutating requests require exact configured Origin in production | Production-mode HTTP test confirms missing and wrong Origin are rejected, trusted Origin reaches authentication, and the session cookie is Secure/HttpOnly/SameSite=Strict | Exact HTTPS origin values are validated at startup, including rejection of path-bearing origins; verify behavior behind the actual production proxy and configured domain |

## Deployment blockers

Do not use this review build for confidential production documents until production Origin behavior is verified behind the real proxy, upload handling receives independent review, ClamAV is runtime-tested, backups/restores and monitoring are configured, audit evidence is independently anchored, administrator MFA/account recovery are addressed, and an external security review is complete.

**Owner registration approval:** New owner accounts are Pending by default and are denied sign-in until an Administrator approves them. Current-session resolution also checks the stored approval status on each request, so an existing owner session is invalidated if approval is changed to Pending or Rejected. The integration suite includes checks for this transition; confirm the latest GitHub Actions run before treating the new regression checks as passing.


## Security hardening follow-up (2026-10-23)

- Added exact HTTPS-origin configuration validation at startup, request/header/keep-alive timeouts, and consistent CSP, frame, referrer, and permissions-policy headers on static responses.
- Restricted document access requests to Viewer accounts, rejected upload filenames containing path separators, strengthened basic PDF/PNG/JPEG/TXT signature checks, rejected invalid UTF-8 text and PDFs missing an EOF marker, and bounded persistent notifications to the newest 500 per user.
- Added integration checks for malformed production-origin configuration, static security headers, path-bearing upload filenames, non-Viewer access requests, invalid UTF-8 text, and incomplete PDFs. GitHub Actions status must be checked for the latest commit before describing these newest tests as passing.
- These controls reduce common input and configuration risks but do not replace format parsers, malware scanning, independent penetration testing, external audit checkpoints, or production operations.


## Audit checkpoint restart hardening (2026-10-23)

- Added a local initialization marker for the audit checkpoint. Once initialized, deleting or corrupting the checkpoint no longer causes the next process startup to silently anchor the current database tail.
- Added an integration regression that deletes the checkpoint, restarts the server, and verifies that the mismatch remains visible.
- This is defense in depth against accidental or database-only tampering. The marker is stored on the same host and is not a substitute for an independently administered append-only audit destination.


## Follow-up implementation status (2026-10-23)

- Production upload scanning now calls the internal ClamAV service and fails closed when scanning fails or malware is detected. Staging tests of the real service and signature updates are still required.
- Signed HTTPS audit events are persisted in an outbox atomically with local audit rows, retried with backoff, and sent without following redirects. The remote receiver and immutable retention must be provisioned separately.
- Nginx reverse-proxy/rate-limit templates and encrypted Restic backup/systemd timer templates are present; deployment and restore evidence are outstanding.
- Download and inline streaming re-check the active session as well as the grant/document on each chunk. A transfer may still deliver bytes before a revocation is processed.
- CI status is commit-specific; see [Actions](https://github.com/23jr1a04b0-max/Trust-Vault/actions). These changes do not imply a production deployment or independent security certification.
