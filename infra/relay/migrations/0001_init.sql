-- A user's link to an environment, pinned to the environment's public key.
CREATE TABLE links (
  user_id TEXT NOT NULL,
  environment_id TEXT NOT NULL,
  label TEXT NOT NULL,
  environment_public_key TEXT NOT NULL,
  http_base_url TEXT NOT NULL,
  linked_at TEXT NOT NULL,
  PRIMARY KEY (user_id, environment_id)
);

-- One managed tunnel and hostname per user and environment. `generation` changes on every write,
-- and teardown claims it first, so a cleanup can't delete what a newer link just set up.
CREATE TABLE allocations (
  user_id TEXT NOT NULL,
  environment_id TEXT NOT NULL,
  hostname TEXT NOT NULL,
  http_base_url TEXT NOT NULL,
  tunnel_id TEXT,
  dns_record_id TEXT,
  origin_host TEXT NOT NULL,
  origin_port INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('provisioning', 'ready', 'deleting')),
  generation INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, environment_id)
);

-- Proof and challenge IDs already used, kept until they would have expired anyway.
CREATE TABLE used_nonces (
  key TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
