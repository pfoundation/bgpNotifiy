import { Database } from "bun:sqlite";
import type { NotificationRecord, NotificationType } from "../types/session.js";

export class NotificationRepository {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  /** Log a sent notification */
  logNotification(record: Omit<NotificationRecord, "id">): void {
    this.db
      .query(
        `INSERT INTO notification_log
           (type, router_id, router_name, protocol_name, asn,
            recipients, subject, body, sent_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.type,
        record.routerId,
        record.routerName,
        record.protocolName,
        record.asn,
        record.recipients,
        record.subject,
        record.body,
        record.sentAt
      );
  }

  /** Get recent notifications, optionally filtered by type */
  getRecentNotifications(
    limit: number = 50,
    type?: NotificationType
  ): NotificationRecord[] {
    if (type) {
      const rows = this.db
        .query(
          `SELECT id, type, router_id, router_name, protocol_name, asn,
                  recipients, subject, body, sent_at
           FROM notification_log
           WHERE type = ?
           ORDER BY sent_at DESC LIMIT ?`
        )
        .all(type, limit) as Record<string, unknown>[];

      return rows.map((row) => this.mapRow(row));
    }

    const rows = this.db
      .query(
        `SELECT id, type, router_id, router_name, protocol_name, asn,
                recipients, subject, body, sent_at
         FROM notification_log
         ORDER BY sent_at DESC LIMIT ?`
      )
      .all(limit) as Record<string, unknown>[];

    return rows.map((row) => this.mapRow(row));
  }

  private mapRow(row: Record<string, unknown>): NotificationRecord {
    return {
      id: row.id as number,
      type: row.type as NotificationType,
      routerId: row.router_id as number,
      routerName: row.router_name as string,
      protocolName: (row.protocol_name as string) || null,
      asn: (row.asn as number) || null,
      recipients: row.recipients as string,
      subject: row.subject as string,
      body: row.body as string,
      sentAt: row.sent_at as string,
    };
  }
}
