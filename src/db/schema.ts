import { Database } from "bun:sqlite";
import path from "node:path";
import fs from "node:fs";

export function initDatabase(dbPath: string): Database {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(dbPath, { create: true });

  // Enable WAL mode for better concurrent read performance
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA foreign_keys = ON");

  db.run(`
    CREATE TABLE IF NOT EXISTS session_states (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      router_id       INTEGER NOT NULL,
      router_name     TEXT NOT NULL,
      protocol_name   TEXT NOT NULL,
      asn             INTEGER NOT NULL,
      infra_id        INTEGER NOT NULL,
      state           TEXT NOT NULL CHECK (state IN ('up', 'down')),
      first_seen_at   TEXT NOT NULL,
      state_changed_at TEXT NOT NULL,
      last_notified_at TEXT,
      UNIQUE(router_id, protocol_name)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS server_states (
      router_id        INTEGER PRIMARY KEY,
      router_name      TEXT NOT NULL,
      mgmt_host        TEXT NOT NULL,
      reachable        INTEGER NOT NULL DEFAULT 1,
      last_checked_at  TEXT NOT NULL,
      last_notified_at TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS notification_log (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      type           TEXT NOT NULL,
      router_id      INTEGER NOT NULL,
      router_name    TEXT NOT NULL,
      protocol_name  TEXT,
      asn            INTEGER,
      recipients     TEXT NOT NULL,
      subject        TEXT NOT NULL,
      body           TEXT NOT NULL,
      sent_at        TEXT NOT NULL
    )
  `);

  // Indexes for common queries
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_session_states_router
    ON session_states(router_id)
  `);
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_session_states_asn
    ON session_states(asn)
  `);
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_notification_log_sent
    ON notification_log(sent_at)
  `);

  return db;
}
