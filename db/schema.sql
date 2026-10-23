PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('Administrator','DocumentOwner','Viewer')),
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  disabled INTEGER NOT NULL DEFAULT 0 CHECK (disabled IN (0,1)),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL DEFAULT 0
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
  size INTEGER NOT NULL CHECK(size >= 0),
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
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
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
