import type { Config } from "../config.js";
import type { SessionRepository } from "../db/sessions.js";
import type { NotificationManager } from "../notifications/manager.js";
import type { RouterConfig } from "../types/ixpManager.js";

export class ServerMonitor {
  private config: Config;
  private sessionRepo: SessionRepository;
  private notificationManager: NotificationManager;

  constructor(
    config: Config,
    sessionRepo: SessionRepository,
    notificationManager: NotificationManager
  ) {
    this.config = config;
    this.sessionRepo = sessionRepo;
    this.notificationManager = notificationManager;
  }

  /**
   * Handle a server that was unreachable during polling.
   * Sends notification to NOC only (not members).
   */
  async handleServerDown(
    router: RouterConfig,
    error: string
  ): Promise<void> {
    const now = new Date().toISOString();
    const existing = this.sessionRepo.getServerState(router.id);

    if (!existing) {
      // First time seeing this server - it's down on first contact
      this.sessionRepo.upsertServerState({
        routerId: router.id,
        routerName: router.name,
        mgmtHost: router.host,
        reachable: false,
        lastCheckedAt: now,
        lastNotifiedAt: now,
      });

      const { subject, body } = this.notificationManager.buildServerDownMessage(
        router.name,
        router.host,
        error,
        false
      );

      await this.notificationManager.send({
        type: "server_down",
        routerId: router.id,
        routerName: router.name,
        recipients: [this.config.nocEmail],
        subject,
        body,
      });

      console.log(
        `[server-monitor] Server unreachable (first seen): ${router.name} (${router.host})`
      );
      return;
    }

    if (existing.reachable) {
      // Was reachable, now down -> transition
      this.sessionRepo.upsertServerState({
        routerId: router.id,
        routerName: router.name,
        mgmtHost: router.host,
        reachable: false,
        lastCheckedAt: now,
        lastNotifiedAt: now,
      });

      const { subject, body } = this.notificationManager.buildServerDownMessage(
        router.name,
        router.host,
        error,
        false
      );

      await this.notificationManager.send({
        type: "server_down",
        routerId: router.id,
        routerName: router.name,
        recipients: [this.config.nocEmail],
        subject,
        body,
      });

      console.log(
        `[server-monitor] Server went unreachable: ${router.name} (${router.host})`
      );
      return;
    }

    // Already down - check renotify
    this.sessionRepo.upsertServerState({
      ...existing,
      lastCheckedAt: now,
    });

    if (this.shouldRenotify(existing.lastNotifiedAt)) {
      this.sessionRepo.upsertServerState({
        routerId: router.id,
        routerName: router.name,
        mgmtHost: router.host,
        reachable: false,
        lastCheckedAt: now,
        lastNotifiedAt: now,
      });

      const { subject, body } = this.notificationManager.buildServerDownMessage(
        router.name,
        router.host,
        error,
        true
      );

      await this.notificationManager.send({
        type: "server_down",
        routerId: router.id,
        routerName: router.name,
        recipients: [this.config.nocEmail],
        subject,
        body,
      });

      console.log(
        `[server-monitor] Renotify for unreachable server: ${router.name} (${router.host})`
      );
    }
  }

  /**
   * Handle a server that is reachable.
   * If it was previously down, send a "back up" notification.
   */
  async handleServerUp(router: RouterConfig): Promise<void> {
    const now = new Date().toISOString();
    const existing = this.sessionRepo.getServerState(router.id);

    if (!existing) {
      // First time seeing this server, it's reachable, just record it
      this.sessionRepo.upsertServerState({
        routerId: router.id,
        routerName: router.name,
        mgmtHost: router.host,
        reachable: true,
        lastCheckedAt: now,
        lastNotifiedAt: null,
      });
      return;
    }

    if (!existing.reachable) {
      // Was down, now back up -> send notification
      this.sessionRepo.upsertServerState({
        routerId: router.id,
        routerName: router.name,
        mgmtHost: router.host,
        reachable: true,
        lastCheckedAt: now,
        lastNotifiedAt: now,
      });

      const { subject, body } = this.notificationManager.buildServerUpMessage(
        router.name,
        router.host
      );

      await this.notificationManager.send({
        type: "server_up",
        routerId: router.id,
        routerName: router.name,
        recipients: [this.config.nocEmail],
        subject,
        body,
      });

      console.log(
        `[server-monitor] Server back online: ${router.name} (${router.host})`
      );
      return;
    }

    // Still reachable, just update timestamp
    this.sessionRepo.upsertServerState({
      ...existing,
      lastCheckedAt: now,
    });
  }

  private shouldRenotify(lastNotifiedAt: string | null): boolean {
    if (!lastNotifiedAt) return true;

    const lastNotified = new Date(lastNotifiedAt).getTime();
    const renotifyMs = this.config.downRenotifyHours * 60 * 60 * 1000;
    return Date.now() - lastNotified >= renotifyMs;
  }
}
