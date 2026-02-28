import { z } from "zod";

const configSchema = z.object({
  // Polling
  pollIntervalMinutes: z.coerce.number().positive().default(3),
  downRenotifyHours: z.coerce.number().positive().default(12),

  // IXP Manager
  ixfExportUrl: z.string().url(),
  ixpManagerApiKey: z.string().min(1),

  // Routers
  routersConfigPath: z.string().default("/app/config/routers.json"),

  // NOC
  nocEmail: z.string().email().default("noc@openix.ong"),

  // SMTP
  smtpHost: z.string().min(1),
  smtpPort: z.coerce.number().positive().default(587),
  smtpUser: z.string().min(1),
  smtpPass: z.string().min(1),
  smtpFrom: z.string().min(1),
  smtpReplyTo: z.string().min(1).optional(),
  smtpCc: z.string().min(1).optional(),

  // SSH
  sshUser: z.string().min(1),
  sshKeyPath: z.string().min(1),
  sshPort: z.coerce.number().positive().default(22),

  // Database
  dbPath: z.string().default("/app/data/bgpnotifier.db"),

  // Cache
  ixpCacheTtlMinutes: z.coerce.number().positive().default(15),
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(): Config {
  const result = configSchema.safeParse({
    pollIntervalMinutes: process.env.POLL_INTERVAL_MINUTES,
    downRenotifyHours: process.env.DOWN_RENOTIFY_HOURS,
    ixfExportUrl: process.env.IXF_EXPORT_URL,
    ixpManagerApiKey: process.env.IXP_MANAGER_API_KEY,
    routersConfigPath: process.env.ROUTERS_CONFIG_PATH,
    nocEmail: process.env.NOC_EMAIL,
    smtpHost: process.env.SMTP_HOST,
    smtpPort: process.env.SMTP_PORT,
    smtpUser: process.env.SMTP_USER,
    smtpPass: process.env.SMTP_PASS,
    smtpFrom: process.env.SMTP_FROM,
    smtpReplyTo: process.env.SMTP_REPLY_TO || undefined,
    smtpCc: process.env.SMTP_CC || undefined,
    sshUser: process.env.SSH_USER,
    sshKeyPath: process.env.SSH_KEY_PATH,
    sshPort: process.env.SSH_PORT,
    dbPath: process.env.DB_PATH,
    ixpCacheTtlMinutes: process.env.IXP_CACHE_TTL_MINUTES,
  });

  if (!result.success) {
    const errors = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid configuration:\n${errors}`);
  }

  return result.data;
}
