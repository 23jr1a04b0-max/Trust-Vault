-- PostgreSQL schema for TrustVault's isolated PostgreSQL backend migration.
-- Kept separate from schema.sql so existing SQLite deployments are unaffected.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('Administrator','DocumentOwner','Viewer')),
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  disabled INTEGER NOT NULL DEFAULT 0 CHECK (disabled IN (0,1)),
  approval_status TEXT NOT NULL DEFAULT 'Approved' CHECK (approval_status IN ('Pending','Approved','Rejected')),
  created_at TEXT NOT NULL,
  mfa_secret_enc TEXT,
  mfa_enabled INTEGER NOT NULL DEFAULT 0 CHECK (mfa_enabled IN (0,1)),
  mfa_last_step BIGINT NOT NULL DEFAULT -1
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower ON users (lower(email));

CREATE TABLE IF NOT EXISTS sessions (
  id_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf TEXT NOT NULL,
  expires_at BIGINT NOT NULL,
  last_seen_at BIGINT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at,last_seen_at);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'General',
  visibility TEXT NOT NULL DEFAULT 'Private' CHECK (visibility IN ('Private','Public')),
  storage_key TEXT NOT NULL UNIQUE,
  size BIGINT NOT NULL CHECK(size >= 0),
  mime TEXT NOT NULL,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_documents_owner ON documents(owner_id,created_at);
CREATE INDEX IF NOT EXISTS idx_documents_active ON documents(deleted_at,created_at);

CREATE TABLE IF NOT EXISTS grants (
  document_id TEXT NOT NULL REFERENCES documents(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  permission TEXT NOT NULL CHECK(permission IN ('Read','Download','Edit')),
  granted_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  expires_at TEXT,
  PRIMARY KEY(document_id,user_id)
);
CREATE INDEX IF NOT EXISTS idx_grants_user_active ON grants(user_id,revoked_at);

CREATE TABLE IF NOT EXISTS audit (
  seq BIGSERIAL PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  at TEXT NOT NULL,
  actor_id TEXT REFERENCES users(id),
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  outcome TEXT NOT NULL,
  reason TEXT,
  request_id TEXT,
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL,
  hash_version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_audit_target ON audit(target_id,seq);
CREATE INDEX IF NOT EXISTS idx_audit_outcome ON audit(outcome,seq);

CREATE TABLE IF NOT EXISTS access_requests (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id),
  requester_id TEXT NOT NULL REFERENCES users(id),
  permission TEXT NOT NULL CHECK(permission IN ('Read','Download')),
  status TEXT NOT NULL DEFAULT 'Pending' CHECK(status IN ('Pending','Approved','Rejected','Cancelled')),
  created_at TEXT NOT NULL,
  decided_at TEXT,
  decided_by TEXT REFERENCES users(id),
  expires_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_access_requests_owner_status ON access_requests(document_id,status,created_at);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL,
  read_at TEXT
);

CREATE TABLE IF NOT EXISTS audit_outbox (
  id TEXT PRIMARY KEY,
  seq BIGINT NOT NULL UNIQUE,
  payload TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at BIGINT NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  last_error TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_outbox_delivery ON audit_outbox(next_attempt_at,seq);
