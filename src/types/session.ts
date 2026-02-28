/** Tracked session state stored in SQLite */
export interface SessionState {
  id: number;
  routerId: number;
  routerName: string;
  protocolName: string;
  asn: number;
  infraId: number;
  /** "up" or "down" */
  state: "up" | "down";
  /** ISO timestamp when first seen in this state */
  firstSeenAt: string;
  /** ISO timestamp when state last changed */
  stateChangedAt: string;
  /** ISO timestamp of last notification sent, null if none */
  lastNotifiedAt: string | null;
}

/** Tracked server reachability state */
export interface ServerState {
  routerId: number;
  routerName: string;
  mgmtHost: string;
  reachable: boolean;
  /** Consecutive failed poll count */
  failCount: number;
  /** Consecutive successful poll count (while in down state) */
  successCount: number;
  lastCheckedAt: string;
  lastNotifiedAt: string | null;
}

/** Types of notifications the system can send */
export type NotificationType =
  | "session_down"
  | "session_up"
  | "server_down"
  | "server_up";

/** Record of a sent notification */
export interface NotificationRecord {
  id: number;
  type: NotificationType;
  routerId: number;
  routerName: string;
  protocolName: string | null;
  asn: number | null;
  recipients: string;
  subject: string;
  body: string;
  sentAt: string;
}
