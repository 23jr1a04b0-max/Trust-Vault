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

Automated tests need to exercise the real HTTP server and authorization boundaries. A source-pattern check alone is not a meaningful mutation test. A successful CI run does not replace manual UI testing, a production deployment check, or an independent security assessment.
