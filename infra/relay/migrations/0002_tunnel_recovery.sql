-- When the host last registered recovery: it can replace a deleted tunnel, so idle reclaim may
-- delete this allocation's tunnel. Null means it can't, and its tunnel is never reclaimed.
ALTER TABLE allocations ADD COLUMN recovery_registered_at TEXT;
-- Set while the allocation's tunnel is reclaimed. The hostname and DNS record stay for the host's
-- replacement.
ALTER TABLE allocations ADD COLUMN tunnel_released_at TEXT;
CREATE INDEX allocations_by_tunnel ON allocations (tunnel_id);
