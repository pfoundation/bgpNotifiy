import { loadConfig } from "./config.js";
import { initDatabase } from "./db/schema.js";
import { SessionRepository } from "./db/sessions.js";
import { NotificationRepository } from "./db/notifications.js";
import { IxpManagerClient } from "./services/ixpManager.js";
import { loadRouterConfig } from "./services/routerConfig.js";
import { SshService } from "./services/ssh.js";
import { EmailChannel } from "./notifications/email.js";
import { NotificationManager } from "./notifications/manager.js";
import { TemplateRenderer } from "./notifications/templateRenderer.js";
import { SessionMonitor } from "./monitor/sessionMonitor.js";
import { ServerMonitor } from "./monitor/serverMonitor.js";
import { Scheduler } from "./scheduler.js";

async function main(): Promise<void> {
  console.log("[bgp-notifier] Starting BGP Notifier...");

  // Load and validate configuration
  const config = loadConfig();
  console.log("[bgp-notifier] Configuration loaded");
  console.log(
    `[bgp-notifier]   Poll interval: ${config.pollIntervalMinutes} minutes`,
  );
  console.log(
    `[bgp-notifier]   Renotify interval: ${config.downRenotifyHours} hours`,
  );
  console.log(
    `[bgp-notifier]   Down cooldown: ${config.downCooldownMinutes} minutes`,
  );
  console.log(`[bgp-notifier]   NOC email: ${config.nocEmail}`);
  console.log(`[bgp-notifier]   IX-F export: ${config.ixfExportUrl}`);
  console.log(`[bgp-notifier]   Database: ${config.dbPath}`);

  // Load router configuration
  const routers = loadRouterConfig(config.routersConfigPath);
  console.log(
    `[bgp-notifier] Loaded ${routers.length} routers from ${config.routersConfigPath}`,
  );
  for (const router of routers) {
    console.log(
      `[bgp-notifier]   [${router.id}] ${router.name} (${router.host})`,
    );
  }

  // Initialize database
  const db = initDatabase(config.dbPath);
  const sessionRepo = new SessionRepository(db);
  const notificationRepo = new NotificationRepository(db);
  console.log("[bgp-notifier] Database initialized");

  // Initialize services
  const ixpManager = new IxpManagerClient(config);
  const ssh = new SshService(config);

  // Initialize notification channels
  const emailChannel = new EmailChannel(config);
  const emailOk = await emailChannel.verify();
  if (emailOk) {
    console.log("[bgp-notifier] SMTP connection verified");
  } else {
    console.warn(
      "[bgp-notifier] SMTP connection could not be verified - emails may fail",
    );
  }

  const templatesDir = new URL("./templates", import.meta.url).pathname;
  const renderer = new TemplateRenderer(templatesDir);

  const notificationManager = new NotificationManager(
    [emailChannel],
    notificationRepo,
    renderer,
  );

  // Initialize monitors
  const sessionMonitor = new SessionMonitor(
    config,
    sessionRepo,
    ixpManager,
    notificationManager,
  );
  const serverMonitor = new ServerMonitor(
    config,
    sessionRepo,
    notificationManager,
  );

  // Initialize and start scheduler
  const scheduler = new Scheduler(
    config,
    routers,
    ssh,
    sessionMonitor,
    serverMonitor,
  );

  // Graceful shutdown
  const shutdown = () => {
    console.log("\n[bgp-notifier] Shutting down...");
    scheduler.stop();
    db.close();
    console.log("[bgp-notifier] Goodbye");
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Verify IXP Manager connectivity
  const { ok, memberCount } = await ixpManager.verifyConnection();
  if (ok) {
    console.log(
      `[bgp-notifier] IXP Manager IX-F export connected - ${memberCount} members`,
    );
  } else {
    console.warn(
      "[bgp-notifier] Could not reach IXP Manager IX-F export - member lookups may fail",
    );
  }

  // Start polling
  scheduler.start();
  console.log("[bgp-notifier] BGP Notifier is running");
}

main().catch((err) => {
  console.error("[bgp-notifier] Fatal error:", err);
  process.exit(1);
});
