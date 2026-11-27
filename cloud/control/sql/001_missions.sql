-- JACO Cloud mission handoff store v1. Execute via an operator-reviewed DB migration.
-- This is a customer control-plane table, NOT Aura's local mission ledger.
CREATE TABLE IF NOT EXISTS jaco_cloud_missions (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL CHECK (length(tenant_id) BETWEEN 1 AND 256),
  device_id varchar(100) NOT NULL,
  goal text NOT NULL CHECK (length(goal) BETWEEN 2 AND 8000),
  request_hash char(64) NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  idempotency_key varchar(100) NOT NULL,
  state varchar(32) NOT NULL CHECK (state IN (
    'ACCEPTED', 'DELIVERY_UNKNOWN', 'RECEIVED', 'RUNNING', 'VERIFIED', 'FAILED'
  )),
  dispatch_state varchar(32) NOT NULL CHECK (dispatch_state IN (
    'NOT_DISPATCHED', 'UNKNOWN', 'DELIVERED'
  )),
  receipt_id varchar(160),
  evidence_ref varchar(160),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (tenant_id, idempotency_key),
  CONSTRAINT jaco_terminal_evidence CHECK (
    state <> 'VERIFIED' OR (receipt_id IS NOT NULL AND evidence_ref IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS jaco_cloud_missions_tenant_device_time
  ON jaco_cloud_missions (tenant_id, device_id, created_at DESC);
