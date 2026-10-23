# Security Operations

## Before running

- Use Node.js 22.5 or later; review the runtime status of the built-in SQLite API.
- Keep `.env`, `data/`, `private-files/`, database files, and audit keys out of version control and web roots.
- Use a unique development seed password of at least 14 characters only for local synthetic accounts.
- Never seed demo accounts on a public service.
- In production, set `AUDIT_HMAC_KEY` to a secret of at least 32 bytes and `TRUSTED_ORIGINS` to exact trusted origins (scheme and port included).
- Terminate TLS at a trusted host/proxy and set the production environment correctly so session cookies use Secure.
- Use a persistent, backed-up private storage volume with restrictive file permissions.

## Current protections in code

- Password hashing uses Node.js scrypt with per-user salt.
- Sessions use random tokens stored as hashes, HttpOnly cookies, SameSite=Strict, idle timeout and absolute expiry.
- Mutating requests require CSRF tokens; production also rejects untrusted/missing Origin values.
- Login attempts are rate-limited in process. The sample Nginx reverse proxy adds per-client login/sign-up rate limits for a single edge instance; multiple edge instances need a shared rate limiter.
- SQL uses prepared statements for user input.
- Uploads have size, extension, declared MIME, and basic file-signature checks; files receive random storage keys and are stored outside `public/`.
- In production, uploads are scanned through the internal ClamAV service before storage; scanner outages and malware findings fail closed.
- Authorization is checked on document content and download routes.
- Audit entries are chained and locally verified.

## Known limitations / pre-production requirements

- File signature checks are basic validation, not full parser validation. ClamAV is signature-based malware detection and does not guarantee detection of every malicious file.
- Read versus Download is an application-level distinction, not DRM; a viewer can still copy content they can see.
- The in-process login limiter is not shared across instances.
- SQLite and local file storage need a reviewed backup, restore, concurrency, and deployment strategy.
- The audit chain can queue signed events for an HTTPS audit receiver using `AUDIT_SINK_URL` and `AUDIT_SINK_TOKEN`. Until an independently administered append-only receiver is configured and tested, the chain is not independently anchored. Check `/api/audit/sink-status` as an Administrator.
- Add independent security review, real production monitoring, automated backups, retention policy, and incident response before handling sensitive real documents.
