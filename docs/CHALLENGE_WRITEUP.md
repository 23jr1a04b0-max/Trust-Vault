# TrustVault Challenge Write-up

## Problem

Document sharing needs more than a public link. Owners need clear control over who can view, download, or modify a document, while administrators need audit visibility without automatically receiving document-content access.

## Proposed approach

TrustVault is a Node.js and SQLite review implementation with role-aware sessions, private file storage, document-specific grants, public metadata discovery, access requests, owner decisions, revocation, and a chained audit log.

## Security choices

- Passwords are hashed with scrypt and per-user salt.
- Session tokens are random, stored as hashes, and delivered in HttpOnly SameSite cookies.
- Mutating API calls require CSRF validation; production also checks Origin.
- Uploads are size/type/signature checked and stored under random names outside the static directory.
- Content and download endpoints perform separate authorization checks.
- The audit chain uses HMAC for new entries.

## Validation status

The repository includes syntax checks and lightweight tests, with HTTP integration tests being added for private-document isolation, Read-versus-Download enforcement, access-request approval, and revocation. A passing automated run is necessary but not sufficient for security certification.

## Remaining work

Production deployment, independent security review, malware scanning, external immutable audit anchoring, production storage/database review, operational monitoring, and a verified demo are not complete. This document intentionally does not claim they are complete.
