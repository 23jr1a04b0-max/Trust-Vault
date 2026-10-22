# TrustVault threat register

This register is a working security document, not a claim that every mitigation is production-complete. Tests reference the current implementation. Accepted risks must be reviewed before a public deployment.

| Threat / attack path | Mitigation in this build | Verification | Residual risk and next action |
|---|---|---|---|
| IDOR by guessing a document UUID | Every metadata, download, update, delete, permission, and document-audit route checks current owner/grant state | `tests/security.test.mjs` direct-ID, download, edit, delete, and owner-only checks | Add fuzzing and a route-by-route authorization matrix for future endpoints |
| UI-only authorization | Server applies the permission check even when a user calls an endpoint directly | HTTP integration tests call routes without using the UI | Add automated tests for every new route before release |
| Administrator bypass | Administrator role does not imply document-content access | Test asserts administrator download returns 404 | Review every future administrative feature for content access side effects |
| Cross-tenant or cross-user list leakage | Document list query only returns owned or actively granted documents | Viewer list is empty before grant; direct document request denied | Add pagination and query-level tests as list/search APIs evolve |
| Read grant used to modify metadata | PATCH requires owner or active Edit grant | Read grant PATCH attempt returns 404; Edit grant PATCH succeeds | Expand to any future document content editing and version endpoints |
| Edit grant used to delete or grant access | Delete and permission routes require owner identity, not Edit permission | Viewer grant/delete attempts are tested | Add tests for every new write endpoint |
| Revoked grant reuse | Current grant state is queried for each protected request | Download after revocation returns 404 | In-progress streams and copies already downloaded cannot be recalled; test concurrency and transaction semantics |
| Session fixation or theft | Random session token, only hash stored, token rotated on login, HttpOnly cookie, SameSite=Strict, Secure in production | Login, logout, session invalidation tests | Add forced logout across devices, session inventory, secure recovery, and deployment proxy checks |
| Idle or expired session reuse | Eight-hour absolute expiry and thirty-minute idle timeout | Session logic reviewed; add time-controlled expiry tests | No dedicated expiry clock test yet; consider short-lived reauthentication for sensitive actions |
| CSRF | CSRF token header required on state-changing authenticated API calls; production Origin allow-list | Missing-CSRF and untrusted-Origin integration tests | SameSite and Origin are defense in depth; validate the deployed proxy and browser behavior |
| Cross-site request with absent Origin | Production state-changing requests fail closed unless Origin matches configured list | Production test rejects missing Origin on login | Some non-browser clients may need a carefully controlled service-to-service policy |
| Brute force and account enumeration | Generic login error, dummy password hash for unknown accounts, IP and account/IP in-process throttling | Invalid login and rate-limit test | Process-local limit resets on restart and is not shared; add edge/WAF and shared rate limiting |
| Account disabled but session remains active | Session lookup checks disabled flag; disabling deletes current sessions | Test disables viewer and verifies existing session is rejected | Add tests for concurrent requests and privileged account recovery |
| Malicious or oversized upload | Size limit, extension/MIME allow-list, basename handling, signature checks, random storage key | Tests reject unsupported extension, MIME mismatch, and invalid signature | Custom multipart parser is minimal; replace or fuzz it and add malware scanning/quarantine |
| Path traversal in upload name or storage key | Basename sanitization; random server-generated storage key; client filename never used as a path | Upload integration test; code review | Add adversarial filename corpus and fuzzing |
| MIME spoofing | Claimed MIME must match extension mapping and basic file signature must match | Test with invalid and mismatched PDF payloads | Signatures do not prove content is safe; malware scanning and content parsing remain missing |
| SQL injection | Prepared statements are used for values; user input is not interpolated into SQL identifiers | Code review and integration suite | Add static analysis and review all future SQL changes |
| Stored XSS in filename/category/account fields | UI uses `textContent` for dynamic values and builds DOM nodes rather than interpolating untrusted text into HTML | Integration suite checks UI markup and XSS-sensitive construction was reviewed | Add browser-based payload tests and a CSP report/monitoring policy |
| Audit event modified in database | New events use HMAC-SHA256 with a key separate from the production database, linked to prior hash | Tamper test edits a stored event and verification fails | Database-only attacker is detected only while key remains secret; host/key compromise can forge events |
| Audit chain deletion, truncation, or full rewrite | HMAC and previous-hash chain detect DB-only changes when the secret remains separate | Tamper verification test covers modified event | External immutable checkpoints are not implemented; a full database and key compromise remains accepted for this MVP |
| Audit write failure or process crash between action and log | Important actions are audited and request IDs are recorded | Tests verify denied and successful actions appear | Writes are not transactionally coupled to every state mutation; audit failure is not yet fail-closed. Add transaction/outbox design |
| Denied request not visible to investigator | Direct document denials, role denials, invalid grants, Origin failures, CSRF errors, and unknown API routes are recorded | Audit feed test checks denied document download | Some failures can occur before route logic or when audit storage itself fails; add centralized monitoring and alerting |
| Sensitive information in audit | Events store IDs, action metadata, outcome, reason, and request ID, not document bytes or passwords | Schema and route review | Review metadata retention and access logging before production |
| Public file exposure | Uploads are stored in `private-files/`, not `public/`; downloads require a protected route | HTTP tests download only through API | Host mount configuration and backups must be reviewed on deployment |
| Admin account compromise | Admin can disable accounts and view audit metadata, but has no automatic document content access | Admin direct-download test | MFA and alerts are not implemented; add a privileged-account hardening plan |
| Unbounded list/query or DoS | JSON and upload body limits exist; document upload limit is configurable | Upload size and login throttling tests | No shared concurrency control, pagination, request timeouts, or load test; add edge protections |
| Database or private file backup leak | Runtime data directories are ignored by Git | `.gitignore` and deployment docs reviewed | Backup encryption, access separation, retention, and restore tests are not automated |
| Soft-delete recovery or data retention | Documents receive a soft-delete timestamp and are excluded from access | Delete behavior covered by integration suite | No restore UI, retention enforcement, or physical cleanup policy yet |
| Previously downloaded copy after revocation | Server denies the next protected request after revocation | Revoke-next-download test | Cannot erase files already downloaded to a user's device; document this in sharing policy |
| Dependency/runtime vulnerability | No third-party npm runtime dependencies | `npm run check` | Node's SQLite module is experimental in the tested runtime; choose supported production runtime and run vulnerability scanning |
| Production Origin misconfiguration | Production fails closed if trusted origins are not configured | Production-origin test | Live proxy/HTTPS behavior has not been verified |
| Audit key loss or rotation | Production key is supplied outside the DB; development key is local and ignored by Git | Startup checks key length | Key rotation, key versioning, secure backup, and recovery runbook are not implemented |
| Public deployment falsely assumed safe | Documentation states local tests are not production certification | README and deployment checklist | No public URL, live credentials, independent review, or recorded demo exists yet |

## Explicitly accepted for this MVP

- A local SQLite database and local private file storage are used for development simplicity. This is not the final production architecture.
- Rate limiting is process-local. It is not enough for a multi-instance public deployment.
- HMAC detects database-only audit tampering while the secret remains protected, but there is no independent immutable checkpoint service yet.
- Revocation prevents future protected requests but cannot recall already downloaded copies or in-progress transfers.
- Malware scanning, password reset, MFA, document versioning, retention enforcement, external audit anchoring, automated backup recovery, and external security review are not implemented.
- The custom multipart parser and synchronous SQLite operations need further review before public exposure.

## Test requirement

When a threat mitigation changes, update the relevant automated test in the same change. `npm run check` runs the HTTP security tests and `tests/mutation-check.mjs`, which removes the download authorization check in a temporary copy and expects the test suite to fail. That mutation test is a minimum check, not complete authorization coverage.
