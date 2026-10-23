# TrustVault API Reference

All API routes are same-origin. Except login, health, and read-only GET routes, requests require an authenticated session and the `x-csrf-token` header returned by `POST /api/auth/login` or `GET /api/auth/me`. Browser sessions use an HttpOnly cookie. Production state-changing requests also require an Origin present in `TRUSTED_ORIGINS`.

Errors return JSON shaped like `{ "error": "message" }`. Document access denied or nonexistent documents generally return 404 to avoid exposing their existence.

## Authentication

- `GET /api/health`: basic process health check.
- `POST /api/auth/login`: JSON `{ "email": "...", "password": "..." }`; returns user and CSRF token and sets session cookie.
- `GET /api/auth/me`: current user and CSRF token.
- `POST /api/auth/logout`: invalidates the current session.

## Documents

- `GET /api/documents`: list documents owned by the user, granted to them, or marked Public. Public means discoverable metadata, not permission to read file content.
- `POST /api/documents`: multipart upload with `file`, `category`, and `visibility` (`Private` or `Public`). DocumentOwner role required. Accepted types are PDF, TXT, PNG, JPG/JPEG, up to `MAX_UPLOAD_BYTES`.
- `GET /api/documents/:id`: metadata; requires Read access or better.
- `GET /api/documents/:id/content`: inline content; requires Read access or better.
- `GET /api/documents/:id/download`: attachment download; requires Download, Edit, or owner access.
- `PATCH /api/documents/:id`: update name/category; requires Edit or owner access.
- `DELETE /api/documents/:id`: soft-delete; owner only.
- `GET /api/documents/:id/permissions`: list grants; owner only.
- `POST /api/documents/:id/permissions`: JSON `{ "email": "registered-user@example.test", "permission": "Read|Download|Edit" }`; owner only. Optional `expiresAt` accepts a future ISO date/time; omit it or pass null for no expiry.
- `DELETE /api/documents/:id/permissions?userId=...`: revoke a grant; owner only.
- `GET /api/documents/:id/audit`: recent document audit metadata; owner only.

## Access requests

- `POST /api/documents/:id/requests`: JSON `{ "permission": "Read|Download" }`; signed-in non-owner may request access to a Public document. Duplicate pending requests for the same permission are rejected.
- `GET /api/access-requests`: list pending requests for the signed-in owner's documents.
- `PATCH /api/access-requests/:id`: JSON `{ "status": "Approved|Rejected", "expiresAt": "optional ISO timestamp" }`; owner only. Approval creates the requested grant.

## Administration and audit

- `GET /api/users`: Administrator only; lists account metadata.
- `PATCH /api/users/:id`: Administrator only; JSON `{ "disabled": true|false }`. Disabling an account revokes its sessions.
- `GET /api/audit`: Administrator only; returns recent audit metadata.
- `POST /api/audit/verify`: Administrator only; verifies the local audit chain.

No endpoint provides public unauthenticated file access. This API reference describes the current code and is not a claim of independent security certification.
