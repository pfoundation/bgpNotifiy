import to from "await-to-js";
import type { Config } from "../config.js";
import type { SessionRepository } from "../db/sessions.js";
import type { IxpManagerClient } from "../services/ixpManager.js";
import type { NotificationManager } from "../notifications/manager.js";
import type { BgpSession } from "../types/bird.js";

export class SessionMonitor {
  private config: Config;
  private sessionRepo: SessionRepository;
  private ixpManager: IxpManagerClient;
  private notificationManager: NotificationManager;

  constructor(
    config: Config,
    sessionRepo: SessionRepository,
    ixpManager: IxpManagerClient,
    notificationManager: NotificationManager
  ) {
    this.config = config;
    this.sessionRepo = sessionRepo;
    this.ixpManager = ixpManager;
    this.notificationManager = notificationManager;
  }

  /**
   * Process BGP sessions from a single router poll.
   *
   * State machine logic:
   * 1. Established + no history        -> store as "up", skip (no noise)
   * 2. Established + was down           -> mark up, send "back up" notification
   * 3. Not Established + no history     -> store as "down", send "down" notification
   * 4. Not Established + already down   -> if last notified > renotify interval, re-notify
   */
  async processSessions(
    routerId: number,
    routerName: string,
    sessions: BgpSession[]
  ): Promise<void> {
    for (const session of sessions) {
      const [err] = await to(
        this.processSession(routerId, routerName, session)
      );
      if (err) {
        console.error(
          `[session-monitor] Error processing ${session.protocolName} on ${routerName}: ${err.message}`
        );
      }
    }
  }

  private async processSession(
    routerId: number,
    routerName: string,
    session: BgpSession
  ): Promise<void> {
    const existing = this.sessionRepo.getSession(
      routerId,
      session.protocolName
    );
    const now = new Date().toISOString();

    if (session.isEstablished) {
      await this.handleEstablished(routerId, routerName, session, existing, now);
    } else {
      await this.handleNotEstablished(routerId, routerName, session, existing, now);
    }
  }

  private async handleEstablished(
    routerId: number,
    routerName: string,
    session: BgpSession,
    existing: Awaited<ReturnType<SessionRepository["getSession"]>>,
    now: string
  ): Promise<void> {
    if (!existing) {
      // Case 1: Established + no history -> store as up, skip notification
      this.sessionRepo.upsertSession({
        routerId,
        routerName,
        protocolName: session.protocolName,
        asn: session.asn,
        infraId: session.infraId,
        state: "up",
        firstSeenAt: now,
        stateChangedAt: now,
        lastNotifiedAt: null,
      });
      console.log(
        `[session-monitor] New session discovered as up: ${session.protocolName} on ${routerName} (AS${session.asn})`
      );
      return;
    }

    if (existing.state === "down") {
      // Case 2: Established + was down -> mark up, send notification
      this.sessionRepo.upsertSession({
        routerId,
        routerName,
        protocolName: session.protocolName,
        asn: session.asn,
        infraId: session.infraId,
        state: "up",
        firstSeenAt: existing.firstSeenAt,
        stateChangedAt: now,
        lastNotifiedAt: now,
      });

      const [custErr, memberName] = await to(
        this.ixpManager.getMemberNameByAsn(session.asn)
      );
      if (custErr) {
        console.warn(
          `[session-monitor] Could not fetch member name for AS${session.asn}: ${custErr.message}`
        );
      }

      const recipients = await this.getRecipients(session.asn);
      const { subject, body } = this.notificationManager.buildSessionUpMessage(
        routerName,
        session.protocolName,
        session.asn,
        (memberName as string) ?? null
      );

      await this.notificationManager.send({
        type: "session_up",
        routerId,
        routerName,
        protocolName: session.protocolName,
        asn: session.asn,
        recipients,
        subject,
        body,
      });

      console.log(
        `[session-monitor] Session back up: ${session.protocolName} on ${routerName} (AS${session.asn})`
      );
    }
    // If already up, nothing to do
  }

  private async handleNotEstablished(
    routerId: number,
    routerName: string,
    session: BgpSession,
    existing: Awaited<ReturnType<SessionRepository["getSession"]>>,
    now: string
  ): Promise<void> {
    if (!existing) {
      // Case 3: Not Established + no history -> store as down, send notification
      this.sessionRepo.upsertSession({
        routerId,
        routerName,
        protocolName: session.protocolName,
        asn: session.asn,
        infraId: session.infraId,
        state: "down",
        firstSeenAt: now,
        stateChangedAt: now,
        lastNotifiedAt: now,
      });

      const [custErr, memberName2] = await to(
        this.ixpManager.getMemberNameByAsn(session.asn)
      );
      if (custErr) {
        console.warn(
          `[session-monitor] Could not fetch member name for AS${session.asn}: ${custErr.message}`
        );
      }

      const recipients = await this.getRecipients(session.asn);
      const { subject, body } = this.notificationManager.buildSessionDownMessage(
        routerName,
        session.protocolName,
        session.asn,
        (memberName2 as string) ?? null,
        session.rawInfo,
        false
      );

      await this.notificationManager.send({
        type: "session_down",
        routerId,
        routerName,
        protocolName: session.protocolName,
        asn: session.asn,
        recipients,
        subject,
        body,
      });

      console.log(
        `[session-monitor] New session discovered as down: ${session.protocolName} on ${routerName} (AS${session.asn})`
      );
      return;
    }

    if (existing.state === "down") {
      // Case 4: Not Established + already down -> check renotify interval
      if (this.shouldRenotify(existing.lastNotifiedAt)) {
        this.sessionRepo.updateLastNotified(
          routerId,
          session.protocolName,
          now
        );

        const [custErr2, memberName3] = await to(
          this.ixpManager.getMemberNameByAsn(session.asn)
        );
        if (custErr2) {
          console.warn(
            `[session-monitor] Could not fetch member name for AS${session.asn}: ${custErr2.message}`
          );
        }

        const recipients = await this.getRecipients(session.asn);
        const { subject, body } = this.notificationManager.buildSessionDownMessage(
          routerName,
          session.protocolName,
          session.asn,
          (memberName3 as string) ?? null,
          session.rawInfo,
          true
        );

        await this.notificationManager.send({
          type: "session_down",
          routerId,
          routerName,
          protocolName: session.protocolName,
          asn: session.asn,
          recipients,
          subject,
          body,
        });

        console.log(
          `[session-monitor] Renotify for down session: ${session.protocolName} on ${routerName} (AS${session.asn})`
        );
      }
      return;
    }

    // Was up, now down -> transition to down
    this.sessionRepo.upsertSession({
      routerId,
      routerName,
      protocolName: session.protocolName,
      asn: session.asn,
      infraId: session.infraId,
      state: "down",
      firstSeenAt: existing.firstSeenAt,
      stateChangedAt: now,
      lastNotifiedAt: now,
    });

    const [custErr, memberName] = await to(
      this.ixpManager.getMemberNameByAsn(session.asn)
    );
    if (custErr) {
      console.warn(
        `[session-monitor] Could not fetch member name for AS${session.asn}: ${custErr.message}`
      );
    }

    const recipients = await this.getRecipients(session.asn);
    const { subject, body } = this.notificationManager.buildSessionDownMessage(
      routerName,
      session.protocolName,
      session.asn,
      (memberName as string) ?? null,
      session.rawInfo,
      false
    );

    await this.notificationManager.send({
      type: "session_down",
      routerId,
      routerName,
      protocolName: session.protocolName,
      asn: session.asn,
      recipients,
      subject,
      body,
    });

    console.log(
      `[session-monitor] Session went down: ${session.protocolName} on ${routerName} (AS${session.asn})`
    );
  }

  private shouldRenotify(lastNotifiedAt: string | null): boolean {
    if (!lastNotifiedAt) return true;

    const lastNotified = new Date(lastNotifiedAt).getTime();
    const renotifyMs = this.config.downRenotifyHours * 60 * 60 * 1000;
    return Date.now() - lastNotified >= renotifyMs;
  }

  private async getRecipients(asn: number): Promise<string[]> {
    const [err, memberEmail] = await to(
      this.ixpManager.getNocEmailForAsn(asn)
    );
    if (err) {
      console.warn(
        `[session-monitor] Could not fetch NOC email for AS${asn}: ${err.message}`
      );
    }

    if (memberEmail) {
      return [memberEmail];
    }

    // Fallback: no member email found, send directly to our NOC
    console.warn(
      `[session-monitor] No member email for AS${asn}, falling back to NOC email`
    );
    return [this.config.nocEmail];
  }
}
