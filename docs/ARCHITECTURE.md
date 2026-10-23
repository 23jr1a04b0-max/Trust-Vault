# TrustVault Architecture

## Components

- `server.mjs`: Node.js HTTP server, session handling, API routing, upload validation, authorization, audit records, and static file serving.
- `db/schema.sql`: SQLite schema for users, sessions, documents, grants, access requests, and audit events.
- `public/`: static browser interface.
- `private-files/`: generated-name document storage, outside the public static directory.
- `data/`: local SQLite database and development audit HMAC key. Neither directory should be committed or served publicly.

The application currently uses Node.js built-in `node:sqlite`, which is experimental in Node 22. The current local implementation is a review build, not a recommended multi-instance production architecture.

## Authorization model

- Administrator: account administration and audit metadata; no automatic access to document contents.
- DocumentOwner: upload and manage documents they own.
- Viewer: access only to documents with active grants.
- Read: view content inline, but not use the download endpoint.
- Download: view and download content.
- Edit: view, download, and update document metadata.
- Owner: view, download, update metadata, manage grants, and soft-delete owned documents.

Public documents are discoverable to authenticated users. Public visibility does not bypass content authorization. Every protected content request checks current grants and expiry/revocation state.

## Audit model

Audit events are chained using the previous event hash. New events use an HMAC-SHA-256 with a local or configured key. A database-only edit should be detectable if the HMAC key remains secret. The key and database must be protected independently. This local chain is not an independently anchored immutable log and cannot withstand full compromise of the application host and key.
