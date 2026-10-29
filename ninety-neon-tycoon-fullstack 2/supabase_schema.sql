-- Run once in Supabase's SQL Editor before publishing the Vercel app.
-- Only login and account metadata are stored here. Photos live in Storage.
CREATE TABLE IF NOT EXISTS accounts (
  id VARCHAR(36) PRIMARY KEY,
  email VARCHAR(254) NOT NULL UNIQUE,
  display_name VARCHAR(32) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  avatar_ref VARCHAR(500),
  avatar_version INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until BIGINT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_accounts_email ON accounts (email);
CREATE TABLE IF NOT EXISTS login_sessions (
  id VARCHAR(64) PRIMARY KEY,
  account_id VARCHAR(36) NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  expires_at BIGINT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_login_sessions_account_id ON login_sessions (account_id);

-- Supabase exposes public-schema tables through PostgREST by default.
-- Never let anonymous/authenticated browser clients read password hashes or tokens.
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE login_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON accounts FROM anon, authenticated;
REVOKE ALL ON login_sessions FROM anon, authenticated;
-- No public RLS policies are created. The trusted backend connects using Postgres.
