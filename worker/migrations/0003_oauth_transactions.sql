CREATE TABLE oauth_transactions (
  state_hash TEXT PRIMARY KEY NOT NULL
    CHECK (length(state_hash) = 64),
  browser_binding_hash TEXT NOT NULL
    CHECK (length(browser_binding_hash) = 64),
  provider TEXT NOT NULL
    CHECK (provider IN ('google', 'github')),
  pkce_verifier_ciphertext TEXT NOT NULL
    CHECK (length(pkce_verifier_ciphertext) BETWEEN 80 AND 256),
  nonce_hash TEXT,
  redirect_uri TEXT NOT NULL
    CHECK (length(trim(redirect_uri)) > 0),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (
    (provider = 'google' AND nonce_hash IS NOT NULL AND length(nonce_hash) = 64)
    OR (provider = 'github' AND nonce_hash IS NULL)
  )
);

CREATE INDEX oauth_transactions_expires_at_idx
  ON oauth_transactions (expires_at);
