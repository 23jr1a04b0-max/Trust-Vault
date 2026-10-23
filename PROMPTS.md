# AI development prompt journal

This journal records actual requests and corrections from the current development session. All entries are dated 2026-10-22 because the work recorded here happened on that date. This does not satisfy the challenge's requirement for genuine commit history spanning the week. Do not backdate entries or invent commit URLs. Add real follow-up entries and commit links as work continues.

## Entry 1: 2026-10-22, inspect the repository and align with the brief

- **Prompt or faithful summary:** Review the full TrustVault challenge brief and ensure implementation addresses per-document authorization, revocation, audit evidence, tests, threat documentation, and the submission requirements.
- **Generated result:** A Node.js/SQLite/plain-JavaScript MVP was available in the supplied working package, while the connected GitHub repository contained only a minimal README at the time of inspection.
- **Specific defect or limitation found:** The working package and connected repository were different states. Assuming the GitHub repository already contained the application would have been wrong. The existing docs also overclaimed or described features that were not yet in the UI.
- **What I did instead:** Kept work in a separate local review copy, inspected the actual routes and tests, and documented that repository publication and live deployment are not complete.
- **Code checked:** `server.mjs`, `tests/security.test.mjs`, `README.md`, `docs/API.md`.
- **Commit link:** Not yet available. The local review copy has not been pushed as a commit.

## Entry 2: 2026-10-22, redesign the interface under explicit style constraints

- **Prompt or faithful summary:** Use a professional light dashboard, but do not use emojis, Lucide icons, liquid glass, bento grids, hover animations, or em dashes.
- **Generated result:** Replaced the main interface with text-first controls, simple panels, a compact summary strip, responsive stacked layouts, and explicit labels.
- **Specific defect found:** The previous stylesheet and markup used SVG eye icons, decorative glyphs, hover transitions, blur styling on dialogs, and a dashboard grid layout. That contradicted the stated design constraints.
- **What I did instead:** Rewrote `public/index.html` and `public/app.css`, replaced password visibility icons with a Show/Hide text button, and added static checks that reject SVG markup, hover rules, transitions, blur filters, and grid-template layouts in the main UI.
- **Verification:** `tests/security.test.mjs` checks the returned HTML/CSS for these constraints.
- **Commit link:** Not yet available. The local review copy has not been pushed as a commit.

## Entry 3: 2026-10-22, verify document authorization and Edit semantics

- **Prompt or faithful summary:** Ensure unauthorized users cannot reach documents by direct route and that revocation blocks future requests, not merely hides UI buttons.
- **Generated result:** Reviewed route-local authorization and added a metadata PATCH route for owner or active Edit grant. Read grants remain read/download only; deletion and permission management remain owner-only.
- **Specific defect found:** The existing code accepted an Edit grant in the data model but did not provide an actual metadata editing route. The UI also did not offer name, owner, category, and date filters as requested.
- **What I did instead:** Added `PATCH /api/documents/{id}`, exposed owner/access metadata only for the already-authorized document collection, implemented the filters in the browser, and added tests for Read-denied/Edit-allowed metadata changes.
- **Verification:** `tests/security.test.mjs` uses HTTP requests with real sessions and asserts Read update denial and Edit update success, plus revocation denial.
- **Commit link:** Not yet available. The local review copy has not been pushed as a commit.

## Entry 4: 2026-10-22, review audit integrity instead of trusting a plain hash chain

- **Prompt or faithful summary:** Treat the audit trail as evidence, include refused attempts, and be honest about whether it can be quietly altered.
- **Generated result:** The previous implementation used an unkeyed hash chain, which detects some modifications but can be recomputed by an attacker who can rewrite the database.
- **Specific defect found:** Calling an unkeyed hash chain tamper-proof would be misleading. It did not authenticate each record against a secret independent of the database.
- **What I did instead:** New audit events use HMAC-SHA256 with a production key supplied through `AUDIT_HMAC_KEY`, separate from the database. The verifier retains support for legacy SHA-chain rows. Added audit events for several denied route paths and tests that modify a stored event and expect verification to fail.
- **Remaining risk:** A host attacker who obtains the HMAC key can forge records. Independent immutable checkpoint storage and transactional audit writes remain unfinished.
- **Commit link:** Not yet available. The local review copy has not been pushed as a commit.

## Entry 5: 2026-10-22, run security checks and catch stale documentation

- **Prompt or faithful summary:** Check that the code satisfies the challenge conditions, not only that the UI looks finished, and verify the code before delivery.
- **Generated result:** The first check run passed the original integration suite, but source inspection found stale documentation saying the grant dialog and filters were missing, and tests still expected the old icon-heavy UI.
- **Specific defect found:** A passing old test suite can preserve incorrect assumptions. Static tests expected a favicon, old CSS variables, and the previous layout, so they would not enforce the newly agreed UI constraints.
- **What I did instead:** Updated static UI assertions, expanded the security integration test for Read/Edit behavior and denied audit events, and began aligning the schema, API, threat, deployment, and demo documents with the current implementation.
- **Verification:** `npm run check` passed after the implementation changes in the local working copy. It includes syntax checks, HTTP integration tests, production Origin checks, and the download-authorization mutation test.
- **Commit link:** Not yet available. The local review copy has not been pushed as a commit.

## Reused project context

- The user's TrustVault brief is the primary product and security requirement source.
- The agreed UI constraints are part of the implementation requirements: no emojis, Lucide icons, liquid glass, bento grids, hover animations, or em dashes.
- OTP was explicitly cancelled. Login remains password-based in this plan.
- Security decisions are checked against `THREATS.md`, `docs/API.md`, and the automated HTTP tests.

## Submission follow-up required

This file is intentionally honest about the missing public commit links and single-session history. To satisfy the full brief, continue the project over the actual work week, add entries after real prompt-driven changes, commit those changes, and replace each pending commit reference with its real repository URL. Do not fabricate dates, fixes, or commit links.

## Entry 6: 2026-10-23, connect the UI to read-only viewing and add HTTP authorization tests

- **Prompt or faithful summary:** Continue implementation in the connected feature branch without waiting for another confirmation; make TrustVault usable and verify real server behavior.
- **Generated result:** Added a separately authorized inline content endpoint, a View action for users with Read access, HTTP integration tests for private metadata isolation, Read-versus-Download, revocation, public discovery, duplicate pending requests, and owner approval.
- **Specific defects found:** The upload form had malformed JavaScript; access-request schema prevented later requests after earlier decisions; the previous mutation check only inspected source text rather than running the application.
- **What I did instead:** Fixed the upload flow and access-request migration, added a disposable-server integration test, and changed the mutation check to remove the download guard in a temporary copy and require the HTTP authorization assertion to fail.
- **Documentation:** Added API, architecture, security operations, deployment, demo, challenge write-up, and implementation notes. Live deployment and independent security review remain incomplete.
- **Commit links:** [HTTP integration tests](https://github.com/23jr1a04b0-max/Trust-Vault/commit/40c09f727e91aef95ead37c9b179da9efce61bf1), [inline content endpoint](https://github.com/23jr1a04b0-max/Trust-Vault/commit/00cc66b30b585047a8e97a31bc1b27f63a002200), [mutation test](https://github.com/23jr1a04b0-max/Trust-Vault/commit/3d6fb02527e565ebaae9055dae777591934ec902).
