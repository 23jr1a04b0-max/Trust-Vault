# TrustVault threat register

This is a working threat register. The "verification status" column reflects the current repository's actual automated coverage, not a claim that all protections are complete.

| Threat | Current mitigation | Verification status | Remaining work |
|---|---|---|---|
| Guessing a document ID (IDOR) | Metadata/content/download routes check current owner or grant access | HTTP tests cover private metadata isolation, Read content, Read-denied download, and post-revocation content denial | Add route-by-route tests for every method and role |
| Read permission used to download | Content and download use separate authorization checks | HTTP integration test confirms Read can view but cannot download; mutation test removes the download guard and expects that assertion to fail | Extend test matrix to expiring grants and all permission types |
| Private document metadata leakage | Listing filters to owned/granted documents; public visibility is the explicit discovery exception | HTTP integration test checks a private document is absent from an ungranted viewer's list | Test disabled users, deleted docs, and list-query edge cases |
| Unauthorized access requests | Requests are allowed only for Public docs and cannot be made by the owner | HTTP test checks public discovery, duplicate pending request rejection, and owner approval | Add explicit tests for self-request, private request, rejection, expiry, and request-owner boundaries |
| Revoked access reuse | Active grant state is checked for each content/download request | HTTP integration test confirms content is denied after revocation | Test concurrent/in-progress streams and expiry boundaries |
| Upload abuse | Extension, declared MIME, size, and basic signature validation; random storage key outside public directory | Upload path is exercised by integration tests with a valid TXT upload | Add malformed multipart, traversal names, MIME mismatch, oversize, and malware-scanning tests |
| Session theft/fixation and CSRF | Random session token stored as a hash, HttpOnly/SameSite cookie, session rotation, CSRF header on state changes | Source/configuration test only; complete runtime coverage is not yet present | Add HTTP tests for CSRF, logout, idle/absolute expiry, disabled-account invalidation, and production Secure cookie |
| Login brute force | Generic error and in-process IP/account rate limiting | Not currently exercised by integration tests | Add deterministic rate-limit tests and shared edge limiter for multi-instance deployment |
| Audit modification | HMAC-SHA256 chained audit events; production key configured separately | The current HTTP integration test does not exercise tamper verification | Add runtime tests for tampering, truncation, audit write failure, and external immutable checkpoints |
| Administrator content access | Administrator role does not automatically grant document access in the content helper | Not currently covered by the new HTTP integration test | Add explicit admin-denied content/download tests and audit checks |
| SQL injection and stored XSS | Prepared statements and DOM textContent usage in the interface | Code review only | Add security scanning, payload tests, and a maintained dependency/runtime review |
| Production Origin bypass | State-changing requests require configured Origin in production | Current production-origin test checks source configuration patterns, not full behavior | Add runtime tests for missing, wrong, and allowed origins behind the actual proxy |

## Deployment blockers

Do not use this review build for confidential production documents until runtime authorization coverage is expanded, the custom multipart parser is reviewed or replaced, malware scanning and operational monitoring are considered, database/file backups are tested, audit evidence is independently anchored, and an external security review is complete.
