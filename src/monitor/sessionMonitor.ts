import to from "await-to-js";
import type { Config } from "../config.js";
import type { SessionRepository } from "../db/sessions.js";
import type { IxpManagerClient } from "../services/ixpManager.js";
import type { NotificationManager } from "../notifications/manager.js";
import type { BgpSession } from "../types/bird.js";
import type { RouterConfig } from "../types/ixpManager.js";

export class SessionMonitor {
  private config: Config;
  private sessionRepo: SessionRepository;
  private ixpManager: IxpManagerClient;
  private notificationManager: NotificationManager;

  constructor(
    config: Config,
    sessionRepo: SessionRepository,
    ixpManager: IxpManagerClient,
    notificationManager: NotificationManager,
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
   * 1. Established + no history                                -> store as "up", skip (no noise)
   * 2. Established + was down + was notified                   -> mark up, send "back up" notification
   * 3. Established + was down + not yet notified (in cooldown) -> silent recovery, no notification
   * 4. Not Established + no history                            -> store as "down", start cooldown
   * 5. Not Established + was up                                -> mark down, start cooldown
   * 6. Not Established + already down + cooldown elapsed +
   *    not yet notified                                        -> send initial "down" notification
   * 7. Not Established + already down + already notified +
   *    renotify interval elapsed                               -> re-notify with downSince
   *
   * Cooldown semantics: when a session is marked "down", last_notified_at is set
   * to NULL. The session-down email is only sent once cooldown_minutes has
   * elapsed since state_changed_at. If the session recovers during the cooldown
   * window (last_notified_at still NULL), no down or up notification is sent
   * (silent recovery).
   */
  async processSessions(
    router: RouterConfig,
    sessions: BgpSession[],
  ): Promise<void> {
    for (const session of sessions) {
      const [err] = await to(this.processSession(router, session));
      if (err) {
        console.error(
          `[session-monitor] Error processing ${session.protocolName} on ${router.name}: ${err.message}`,
        );
      }
    }
  }

  private async processSession(
    router: RouterConfig,
    session: BgpSession,
  ): Promise<void> {
    const existing = this.sessionRepo.getSession(
      router.id,
      session.protocolName,
    );
    const now = new Date().toISOString();

    if (session.isEstablished) {
      await this.handleEstablished(router, session, existing, now);
    } else {
      await this.handleNotEstablished(router, session, existing, now);
    }
  }

  private async handleEstablished(
    router: RouterConfig,
    session: BgpSession,
    existing: Awaited<ReturnType<SessionRepository["getSession"]>>,
    now: string,
  ): Promise<void> {
    if (!existing) {
      // Case 1: Established + no history -> store as up, skip notification
      this.sessionRepo.upsertSession({
        routerId: router.id,
        routerName: router.name,
        protocolName: session.protocolName,
        asn: session.asn,
        infraId: session.infraId,
        state: "up",
        firstSeenAt: now,
        stateChangedAt: now,
        lastNotifiedAt: null,
      });
      console.log(
        `[session-monitor] New session discovered as up: ${session.protocolName} on ${router.name} (AS${session.asn})`,
      );
      return;
    }

    if (existing.state === "down") {
      if (existing.lastNotifiedAt === null) {
        // Case 3: Established + was down but never notified (recovered within
        // cooldown window) -> silent recovery, no email
        this.sessionRepo.upsertSession({
          routerId: router.id,
          routerName: router.name,
          protocolName: session.protocolName,
          asn: session.asn,
          infraId: session.infraId,
          state: "up",
          firstSeenAt: existing.firstSeenAt,
          stateChangedAt: now,
          lastNotifiedAt: null,
        });

        console.log(
          `[session-monitor] Silent recovery (within cooldown): ${session.protocolName} on ${router.name} (AS${session.asn})`,
        );
        return;
      }

      // Case 2: Established + was down + was notified -> mark up, send notification
      this.sessionRepo.upsertSession({
        routerId: router.id,
        routerName: router.name,
        protocolName: session.protocolName,
        asn: session.asn,
        infraId: session.infraId,
        state: "up",
        firstSeenAt: existing.firstSeenAt,
        stateChangedAt: now,
        lastNotifiedAt: now,
      });

      const memberInfo = await this.getMemberInfo(session.asn);
      const recipients = await this.getRecipients(session.asn);
      const { subject, body } = this.notificationManager.buildSessionUpMessage(
        router.name,
        session.protocolName,
        session.asn,
        memberInfo.name,
        memberInfo.ip,
        router.peeringIp,
        router.asn,
      );

      await this.notificationManager.send({
        type: "session_up",
        routerId: router.id,
        routerName: router.name,
        protocolName: session.protocolName,
        asn: session.asn,
        recipients,
        subject,
        body,
      });

      console.log(
        `[session-monitor] Session back up: ${session.protocolName} on ${router.name} (AS${session.asn})`,
      );
    }
    // If already up, nothing to do
  }

  private async handleNotEstablished(
    router: RouterConfig,
    session: BgpSession,
    existing: Awaited<ReturnType<SessionRepository["getSession"]>>,
    now: string,
  ): Promise<void> {
    if (!existing) {
      // Case 4: Not Established + no history -> store as down, start cooldown
      this.sessionRepo.upsertSession({
        routerId: router.id,
        routerName: router.name,
        protocolName: session.protocolName,
        asn: session.asn,
        infraId: session.infraId,
        state: "down",
        firstSeenAt: now,
        stateChangedAt: now,
        lastNotifiedAt: null,
      });

      console.log(
        `[session-monitor] New session discovered as down (cooldown started): ${session.protocolName} on ${router.name} (AS${session.asn})`,
      );
      return;
    }

    if (existing.state === "down") {
      if (existing.lastNotifiedAt === null) {
        // Case 6: still down, never notified -> if cooldown elapsed, send initial
        // down notification; otherwise stay silent.
        if (!this.cooldownElapsed(existing.stateChangedAt)) {
          return;
        }

        this.sessionRepo.updateLastNotified(
          router.id,
          session.protocolName,
          now,
        );

        const memberInfo = await this.getMemberInfo(session.asn);
        const recipients = await this.getRecipients(session.asn);
        const { subject, body } =
          this.notificationManager.buildSessionDownMessage(
            router.name,
            session.protocolName,
            session.asn,
            memberInfo.name,
            session.rawInfo,
            false,
            memberInfo.ip,
            router.peeringIp,
            router.asn,
            null,
          );

        await this.notificationManager.send({
          type: "session_down",
          routerId: router.id,
          routerName: router.name,
          protocolName: session.protocolName,
          asn: session.asn,
          recipients,
          subject,
          body,
        });

        console.log(
          `[session-monitor] Session down (cooldown elapsed, sending initial notification): ${session.protocolName} on ${router.name} (AS${session.asn})`,
        );
        return;
      }

      // Case 7: Not Established + already down + already notified -> renotify check
      if (this.shouldRenotify(existing.lastNotifiedAt)) {
        this.sessionRepo.updateLastNotified(
          router.id,
          session.protocolName,
          now,
        );

        const memberInfo = await this.getMemberInfo(session.asn);
        const recipients = await this.getRecipients(session.asn);
        const { subject, body } =
          this.notificationManager.buildSessionDownMessage(
            router.name,
            session.protocolName,
            session.asn,
            memberInfo.name,
            session.rawInfo,
            true,
            memberInfo.ip,
            router.peeringIp,
            router.asn,
            this.formatDownSince(existing.stateChangedAt),
          );

        await this.notificationManager.send({
          type: "session_down",
          routerId: router.id,
          routerName: router.name,
          protocolName: session.protocolName,
          asn: session.asn,
          recipients,
          subject,
          body,
        });

        console.log(
          `[session-monitor] Renotify for down session: ${session.protocolName} on ${router.name} (AS${session.asn})`,
        );
      }
      return;
    }

    // Case 5: Was up, now down -> transition to down, start cooldown (no email)
    this.sessionRepo.upsertSession({
      routerId: router.id,
      routerName: router.name,
      protocolName: session.protocolName,
      asn: session.asn,
      infraId: session.infraId,
      state: "down",
      firstSeenAt: existing.firstSeenAt,
      stateChangedAt: now,
      lastNotifiedAt: null,
    });

    console.log(
      `[session-monitor] Session went down (cooldown started): ${session.protocolName} on ${router.name} (AS${session.asn})`,
    );
  }

  /** Fetch member name and peering IP in a single call */
  private async getMemberInfo(
    asn: number,
  ): Promise<{ name: string | null; ip: string | null }> {
    const [nameErr, memberName] = await to(
      this.ixpManager.getMemberNameByAsn(asn),
    );
    if (nameErr) {
      console.warn(
        `[session-monitor] Could not fetch member name for AS${asn}: ${nameErr.message}`,
      );
    }

    const [ipErr, memberIp] = await to(this.ixpManager.getMemberIpByAsn(asn));
    if (ipErr) {
      console.warn(
        `[session-monitor] Could not fetch member IP for AS${asn}: ${ipErr.message}`,
      );
    }

    return {
      name: (memberName as string) ?? null,
      ip: (memberIp as string) ?? null,
    };
  }

  /** Format an ISO timestamp as "2026-02-28 00:47 UTC (2d 4h ago)" */
  private formatDownSince(sinceIso: string): string {
    const dt = new Date(sinceIso);
    const utc = dt.toISOString().replace("T", " ").slice(0, 16) + " UTC";
    const ms = Date.now() - dt.getTime();
    const minutes = Math.floor(ms / 60_000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    let relative: string;
    if (days > 0) {
      relative = `${days}d ${hours % 24}h ago`;
    } else if (hours > 0) {
      relative = `${hours}h ${minutes % 60}m ago`;
    } else {
      relative = `${minutes}m ago`;
    }

    return `${utc} (${relative})`;
  }

  private shouldRenotify(lastNotifiedAt: string | null): boolean {
    if (!lastNotifiedAt) return true;

    const lastNotified = new Date(lastNotifiedAt).getTime();
    const renotifyMs = this.config.downRenotifyHours * 60 * 60 * 1000;
    return Date.now() - lastNotified >= renotifyMs;
  }

  /**
   * Returns true once the configured cooldown has elapsed since the session
   * went down. If cooldown is set to 0, always returns true (cooldown disabled).
   */
  private cooldownElapsed(stateChangedAt: string): boolean {
    const cooldownMs = this.config.downCooldownMinutes * 60 * 1000;
    if (cooldownMs === 0) return true;
    return Date.now() - new Date(stateChangedAt).getTime() >= cooldownMs;
  }

  private async getRecipients(asn: number): Promise<string[]> {
    const [err, memberEmail] = await to(this.ixpManager.getNocEmailForAsn(asn));
    if (err) {
      console.warn(
        `[session-monitor] Could not fetch NOC email for AS${asn}: ${err.message}`,
      );
    }

    if (memberEmail) {
      return [memberEmail];
    }

    // Fallback: no member email found, send directly to our NOC
    console.warn(
      `[session-monitor] No member email for AS${asn}, falling back to NOC email`,
    );
    return [this.config.nocEmail];
  }
}
