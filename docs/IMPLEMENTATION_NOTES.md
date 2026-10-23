# Implementation Notes

## Current scope

Implemented in the current branch: account login, role checks, session and CSRF controls, private file upload, visibility metadata, document grants, public-document access requests, owner approvals/rejections, expiry on approved requests, grant revocation, admin audit view, local audit-chain verification, and a basic browser interface.

## Important behavior

- Public means discoverable metadata to authenticated users; it does not grant content access.
- Read grants allow inline content viewing but not the download endpoint.
- Download and Edit grants permit download; Edit also permits document metadata updates.
- Revocation affects subsequent protected requests. It cannot recall content already viewed, copied, or downloaded.
- Demo users are created only when explicitly enabled in development.

## Verification gaps

The HTTP integration suite exercises real requests against a disposable local server and includes a mutation check that removes the download authorization guard and expects the Read-versus-Download assertion to fail. CI also runs production-mode Origin/cookie tests and builds/smoke-tests the Docker image. Remaining coverage gaps include exhaustive route/role combinations, malformed image/PDF parser cases, audit-chain tail truncation, concurrent-stream revocation, manual UI testing, verification behind the target production reverse proxy, and independent security assessment.
