import to from "await-to-js";
import type { NotificationChannel } from "./types.js";
import type { TemplateRenderer } from "./templateRenderer.js";
import type { NotificationRepository } from "../db/notifications.js";
import type { NotificationType } from "../types/session.js";

export interface SendNotificationParams {
  type: NotificationType;
  routerId: number;
  routerName: string;
  protocolName?: string;
  asn?: number;
  recipients: string[];
  subject: string;
  body: string;
}

export class NotificationManager {
  private channels: NotificationChannel[];
  private notificationRepo: NotificationRepository;
  private renderer: TemplateRenderer;

  constructor(
    channels: NotificationChannel[],
    notificationRepo: NotificationRepository,
    renderer: TemplateRenderer
  ) {
    this.channels = channels;
    this.notificationRepo = notificationRepo;
    this.renderer = renderer;
  }

  /** Send a notification through all registered channels and log it */
  async send(params: SendNotificationParams): Promise<void> {
    const {
      type,
      routerId,
      routerName,
      protocolName,
      asn,
      recipients,
      subject,
      body,
    } = params;

    if (recipients.length === 0) {
      console.warn(
        `[notification] No recipients for ${type} on ${routerName}/${protocolName ?? "server"}, skipping`
      );
      return;
    }

    for (const channel of this.channels) {
      const [err] = await to(channel.send({ to: recipients, subject, body }));

      if (err) {
        console.error(
          `[notification] Failed to send via ${channel.name}: ${err.message}`
        );
        continue;
      }

      console.log(
        `[notification] Sent ${type} via ${channel.name} to ${recipients.join(", ")}`
      );
    }

    // Log to database regardless of send success
    this.notificationRepo.logNotification({
      type,
      routerId,
      routerName,
      protocolName: protocolName ?? null,
      asn: asn ?? null,
      recipients: JSON.stringify(recipients),
      subject,
      body,
      sentAt: new Date().toISOString(),
    });
  }

  /** Build a session-down notification from template */
  buildSessionDownMessage(
    routerName: string,
    protocolName: string,
    asn: number,
    customerName: string | null,
    rawInfo: string,
    isReminder: boolean
  ): { subject: string; body: string } {
    const label = customerName ? `${customerName} (AS${asn})` : `AS${asn}`;

    return this.renderer.render("session-down", {
      routerName,
      protocolName,
      label,
      status: rawInfo || "Not Established",
      timestamp: new Date().toISOString(),
      isReminder,
    });
  }

  /** Build a session-up notification from template */
  buildSessionUpMessage(
    routerName: string,
    protocolName: string,
    asn: number,
    customerName: string | null
  ): { subject: string; body: string } {
    const label = customerName ? `${customerName} (AS${asn})` : `AS${asn}`;

    return this.renderer.render("session-up", {
      routerName,
      protocolName,
      label,
      timestamp: new Date().toISOString(),
    });
  }

  /** Build a server-down notification from template */
  buildServerDownMessage(
    routerName: string,
    mgmtHost: string,
    error: string,
    isReminder: boolean
  ): { subject: string; body: string } {
    return this.renderer.render("server-down", {
      routerName,
      mgmtHost,
      error,
      timestamp: new Date().toISOString(),
      isReminder,
    });
  }

  /** Build a server-up notification from template */
  buildServerUpMessage(
    routerName: string,
    mgmtHost: string
  ): { subject: string; body: string } {
    return this.renderer.render("server-up", {
      routerName,
      mgmtHost,
      timestamp: new Date().toISOString(),
    });
  }
}
