-- Durable adapter for the existing JACO Link rooms; no second mission executor.
CREATE TABLE IF NOT EXISTS jaco_link_kv (
 namespace text NOT NULL, key text NOT NULL, ciphertext text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz,
 PRIMARY KEY(namespace,key)
);
CREATE INDEX IF NOT EXISTS jaco_link_kv_expiry ON jaco_link_kv(expires_at) WHERE expires_at IS NOT NULL;
CREATE TABLE IF NOT EXISTS jaco_link_rpc_admission (
 account_id text NOT NULL, device_id text NOT NULL, request_id text NOT NULL,
 state text NOT NULL CHECK(state IN ('UNKNOWN','RESPONDED')),
 response_status int CHECK(response_status BETWEEN 100 AND 599),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(account_id,device_id,request_id)
);
