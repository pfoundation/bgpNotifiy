import { Database } from "bun:sqlite";
import type { SessionState, ServerState } from "../types/session.js";

export class SessionRepository {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  /** Get session state for a specific router + protocol */
  getSession(routerId: number, protocolName: string): SessionState | null {
    const row = this.db
      .query(
        `SELECT id, router_id, router_name, protocol_name, asn, infra_id,
                state, first_seen_at, state_changed_at, last_notified_at
         FROM session_states
         WHERE router_id = ? AND protocol_name = ?`
      )
      .get(routerId, protocolName) as Record<string, unknown> | null;

    if (!row) return null;

    return this.mapSessionRow(row);
  }

  /** Get all sessions for a router */
  getSessionsByRouter(routerId: number): SessionState[] {
    const rows = this.db
      .query(
        `SELECT id, router_id, router_name, protocol_name, asn, infra_id,
                state, first_seen_at, state_changed_at, last_notified_at
         FROM session_states
         WHERE router_id = ?`
      )
      .all(routerId) as Record<string, unknown>[];

    return rows.map((r) => this.mapSessionRow(r));
  }

  /** Get all sessions currently in "down" state */
  getDownSessions(): SessionState[] {
    const rows = this.db
      .query(
        `SELECT id, router_id, router_name, protocol_name, asn, infra_id,
                state, first_seen_at, state_changed_at, last_notified_at
         FROM session_states
         WHERE state = 'down'`
      )
      .all() as Record<string, unknown>[];

    return rows.map((r) => this.mapSessionRow(r));
  }

  /** Insert or update a session state */
  upsertSession(session: Omit<SessionState, "id">): void {
    this.db
      .query(
        `INSERT INTO session_states
           (router_id, router_name, protocol_name, asn, infra_id,
            state, first_seen_at, state_changed_at, last_notified_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(router_id, protocol_name) DO UPDATE SET
           router_name = excluded.router_name,
           asn = excluded.asn,
           infra_id = excluded.infra_id,
           state = excluded.state,
           state_changed_at = excluded.state_changed_at,
           last_notified_at = excluded.last_notified_at`
      )
      .run(
        session.routerId,
        session.routerName,
        session.protocolName,
        session.asn,
        session.infraId,
        session.state,
        session.firstSeenAt,
        session.stateChangedAt,
        session.lastNotifiedAt
      );
  }

  /** Update the last_notified_at timestamp for a session */
  updateLastNotified(
    routerId: number,
    protocolName: string,
    notifiedAt: string
  ): void {
    this.db
      .query(
        `UPDATE session_states
         SET last_notified_at = ?
         WHERE router_id = ? AND protocol_name = ?`
      )
      .run(notifiedAt, routerId, protocolName);
  }

  /** Mark a session as up (state transition from down to up) */
  markSessionUp(routerId: number, protocolName: string): void {
    const now = new Date().toISOString();
    this.db
      .query(
        `UPDATE session_states
         SET state = 'up', state_changed_at = ?, last_notified_at = NULL
         WHERE router_id = ? AND protocol_name = ?`
      )
      .run(now, routerId, protocolName);
  }

  /** Mark a session as down (state transition from up to down) */
  markSessionDown(routerId: number, protocolName: string): void {
    const now = new Date().toISOString();
    this.db
      .query(
        `UPDATE session_states
         SET state = 'down', state_changed_at = ?
         WHERE router_id = ? AND protocol_name = ?`
      )
      .run(now, routerId, protocolName);
  }

  // --- Server state methods ---

  /** Get server state by router ID */
  getServerState(routerId: number): ServerState | null {
    const row = this.db
      .query(
        `SELECT router_id, router_name, mgmt_host, reachable,
                fail_count, success_count,
                last_checked_at, last_notified_at
         FROM server_states
         WHERE router_id = ?`
      )
      .get(routerId) as Record<string, unknown> | null;

    if (!row) return null;

    return {
      routerId: row.router_id as number,
      routerName: row.router_name as string,
      mgmtHost: row.mgmt_host as string,
      reachable: (row.reachable as number) === 1,
      failCount: (row.fail_count as number) || 0,
      successCount: (row.success_count as number) || 0,
      lastCheckedAt: row.last_checked_at as string,
      lastNotifiedAt: (row.last_notified_at as string) || null,
    };
  }

  /** Insert or update server reachability state */
  upsertServerState(server: ServerState): void {
    this.db
      .query(
        `INSERT INTO server_states
           (router_id, router_name, mgmt_host, reachable,
            fail_count, success_count,
            last_checked_at, last_notified_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(router_id) DO UPDATE SET
           router_name = excluded.router_name,
           mgmt_host = excluded.mgmt_host,
           reachable = excluded.reachable,
           fail_count = excluded.fail_count,
           success_count = excluded.success_count,
           last_checked_at = excluded.last_checked_at,
           last_notified_at = excluded.last_notified_at`
      )
      .run(
        server.routerId,
        server.routerName,
        server.mgmtHost,
        server.reachable ? 1 : 0,
        server.failCount,
        server.successCount,
        server.lastCheckedAt,
        server.lastNotifiedAt
      );
  }

  private mapSessionRow(row: Record<string, unknown>): SessionState {
    return {
      id: row.id as number,
      routerId: row.router_id as number,
      routerName: row.router_name as string,
      protocolName: row.protocol_name as string,
      asn: row.asn as number,
      infraId: row.infra_id as number,
      state: row.state as "up" | "down",
      firstSeenAt: row.first_seen_at as string,
      stateChangedAt: row.state_changed_at as string,
      lastNotifiedAt: (row.last_notified_at as string) || null,
    };
  }
}
