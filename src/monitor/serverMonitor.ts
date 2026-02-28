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
   *
   * Increments failCount and resets successCount. Only sends a notification
   * when failCount reaches serverDownThreshold. After that, renotify logic
   * applies based on downRenotifyHours.
   */
  async handleServerDown(
    router: RouterConfig,
    error: string
  ): Promise<void> {
    const now = new Date().toISOString();
    const existing = this.sessionRepo.getServerState(router.id);
    const threshold = this.config.serverDownThreshold;

    if (!existing) {
      // First time seeing this server — record failure #1
      const failCount = 1;
      const crossedThreshold = failCount >= threshold;

      this.sessionRepo.upsertServerState({
        routerId: router.id,
        routerName: router.name,
        mgmtHost: router.host,
        reachable: !crossedThreshold,
        failCount,
        successCount: 0,
        lastCheckedAt: now,
        lastNotifiedAt: crossedThreshold ? now : null,
      });

      if (crossedThreshold) {
        await this.sendServerDown(router, error, false);
        console.log(
          `[server-monitor] Server unreachable (first seen): ${router.name} (${router.host})`
        );
      } else {
        console.warn(
          `[server-monitor] Server poll failed (${failCount}/${threshold}): ${router.name} (${router.host})`
        );
      }
      return;
    }

    // Increment fail count, reset success count
    const failCount = existing.failCount + 1;

    if (existing.reachable) {
      // Was reachable — accumulate failures toward threshold
      this.sessionRepo.upsertServerState({
        routerId: router.id,
        routerName: router.name,
        mgmtHost: router.host,
        reachable: failCount < threshold,
        failCount,
        successCount: 0,
        lastCheckedAt: now,
        lastNotifiedAt: failCount >= threshold ? now : existing.lastNotifiedAt,
      });

      if (failCount >= threshold) {
        await this.sendServerDown(router, error, false);
        console.log(
          `[server-monitor] Server went unreachable (after ${failCount} failures): ${router.name} (${router.host})`
        );
      } else {
        console.warn(
          `[server-monitor] Server poll failed (${failCount}/${threshold}): ${router.name} (${router.host})`
        );
      }
      return;
    }

    // Already marked unreachable — update counters and check renotify
    this.sessionRepo.upsertServerState({
      ...existing,
      failCount,
      successCount: 0,
      lastCheckedAt: now,
    });

    if (this.shouldRenotify(existing.lastNotifiedAt)) {
      this.sessionRepo.upsertServerState({
        routerId: router.id,
        routerName: router.name,
        mgmtHost: router.host,
        reachable: false,
        failCount,
        successCount: 0,
        lastCheckedAt: now,
        lastNotifiedAt: now,
      });

      await this.sendServerDown(router, error, true);
      console.log(
        `[server-monitor] Renotify for unreachable server: ${router.name} (${router.host})`
      );
    }
  }

  /**
   * Handle a server that is reachable.
   *
   * Increments successCount and resets failCount. If the server was previously
   * marked unreachable, only sends a "back up" notification when successCount
   * reaches serverUpThreshold.
   */
  async handleServerUp(router: RouterConfig): Promise<void> {
    const now = new Date().toISOString();
    const existing = this.sessionRepo.getServerState(router.id);
    const threshold = this.config.serverUpThreshold;

    if (!existing) {
      // First time seeing this server — it's reachable, just record it
      this.sessionRepo.upsertServerState({
        routerId: router.id,
        routerName: router.name,
        mgmtHost: router.host,
        reachable: true,
        failCount: 0,
        successCount: 0,
        lastCheckedAt: now,
        lastNotifiedAt: null,
      });
      return;
    }

    // Reset fail count, increment success count
    const successCount = existing.reachable ? 0 : existing.successCount + 1;

    if (existing.reachable) {
      // Still reachable — just update timestamp
      this.sessionRepo.upsertServerState({
        ...existing,
        failCount: 0,
        successCount: 0,
        lastCheckedAt: now,
      });
      return;
    }

    // Was unreachable — accumulate successes toward threshold
    if (successCount >= threshold) {
      // Threshold reached — mark as back up
      this.sessionRepo.upsertServerState({
        routerId: router.id,
        routerName: router.name,
        mgmtHost: router.host,
        reachable: true,
        failCount: 0,
        successCount: 0,
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
        `[server-monitor] Server back online (after ${successCount} successes): ${router.name} (${router.host})`
      );
    } else {
      // Not yet at threshold — record success but keep marked unreachable
      this.sessionRepo.upsertServerState({
        ...existing,
        failCount: 0,
        successCount,
        lastCheckedAt: now,
      });

      console.warn(
        `[server-monitor] Server poll succeeded (${successCount}/${threshold}), still confirming: ${router.name} (${router.host})`
      );
    }
  }

  private async sendServerDown(
    router: RouterConfig,
    error: string,
    isReminder: boolean
  ): Promise<void> {
    const { subject, body } = this.notificationManager.buildServerDownMessage(
      router.name,
      router.host,
      error,
      isReminder
    );

    await this.notificationManager.send({
      type: "server_down",
      routerId: router.id,
      routerName: router.name,
      recipients: [this.config.nocEmail],
      subject,
      body,
    });
  }

  private shouldRenotify(lastNotifiedAt: string | null): boolean {
    if (!lastNotifiedAt) return true;

    const lastNotified = new Date(lastNotifiedAt).getTime();
    const renotifyMs = this.config.downRenotifyHours * 60 * 60 * 1000;
    return Date.now() - lastNotified >= renotifyMs;
  }
}
