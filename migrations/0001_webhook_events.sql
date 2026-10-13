CREATE TABLE webhook_events (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('pending', 'delivered')),
  lease_until INTEGER NOT NULL,
  lease_token TEXT NOT NULL
);
