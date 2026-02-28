import to from "await-to-js";
import type { Config } from "./config.js";
import type { SshService } from "./services/ssh.js";
import type { SessionMonitor } from "./monitor/sessionMonitor.js";
import type { ServerMonitor } from "./monitor/serverMonitor.js";
import type { RouterConfig } from "./types/ixpManager.js";
import { pollRouter } from "./services/bird.js";

export class Scheduler {
  private config: Config;
  private routers: RouterConfig[];
  private ssh: SshService;
  private sessionMonitor: SessionMonitor;
  private serverMonitor: ServerMonitor;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private pollInProgress = false;

  constructor(
    config: Config,
    routers: RouterConfig[],
    ssh: SshService,
    sessionMonitor: SessionMonitor,
    serverMonitor: ServerMonitor
  ) {
    this.config = config;
    this.routers = routers;
    this.ssh = ssh;
    this.sessionMonitor = sessionMonitor;
    this.serverMonitor = serverMonitor;
  }

  /** Start the polling scheduler */
  start(): void {
    if (this.running) return;

    this.running = true;
    const intervalMs = this.config.pollIntervalMinutes * 60 * 1000;

    console.log(
      `[scheduler] Starting polling every ${this.config.pollIntervalMinutes} minutes`
    );

    // Run immediately on start
    this.poll();

    // Then set up the interval
    this.timer = setInterval(() => this.poll(), intervalMs);
  }

  /** Stop the polling scheduler */
  stop(): void {
    if (!this.running) return;

    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    console.log("[scheduler] Stopped");
  }

  /** Execute a single poll cycle across all routers */
  private async poll(): Promise<void> {
    if (this.pollInProgress) {
      console.warn("[scheduler] Previous poll still in progress, skipping");
      return;
    }

    this.pollInProgress = true;
    const startTime = Date.now();

    console.log(`[scheduler] Poll cycle starting - ${this.routers.length} routers`);

    // Process routers sequentially to avoid SSH connection storms
    for (const router of this.routers) {
      if (!this.running) break;

      const result = await pollRouter(this.ssh, router);

      if (!result.success) {
        // Server is unreachable
        const [err] = await to(
          this.serverMonitor.handleServerDown(router, result.error || "Unknown error")
        );
        if (err) {
          console.error(
            `[scheduler] Error handling server down for ${router.name}: ${err.message}`
          );
        }
        continue;
      }

      // Server is reachable
      const [serverErr] = await to(this.serverMonitor.handleServerUp(router));
      if (serverErr) {
        console.error(
          `[scheduler] Error handling server up for ${router.name}: ${serverErr.message}`
        );
      }

      // Process BGP sessions
      const [sessionErr] = await to(
        this.sessionMonitor.processSessions(
          result.routerId,
          result.routerName,
          result.sessions
        )
      );
      if (sessionErr) {
        console.error(
          `[scheduler] Error processing sessions for ${router.name}: ${sessionErr.message}`
        );
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[scheduler] Poll cycle completed in ${elapsed}s`);

    this.pollInProgress = false;
  }
}
