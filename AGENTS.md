# AGENTS.md - Coding Agent Guidelines for bgpNotifier

## Project Overview

BGP session monitoring tool for an IXP (Internet Exchange Point) running Bird v2.
Built with TypeScript + Bun. Polls Bird servers via SSH, tracks session state in
SQLite, sends email notifications via SMTP. Member data fetched from IXP Manager
IX-F Member Export API.

## Build / Run / Typecheck Commands

```bash
bun run start          # Run the application (bun run src/index.ts)
bun run dev            # Run with file watching (bun --watch run src/index.ts)
bun run typecheck      # Type-check only, no emit (tsc --noEmit)
```

Bun runs TypeScript directly -- there is no build/compile step.
No test framework is configured. No linter or formatter is configured.
The only automated check is `bun run typecheck`.

### Docker

```bash
docker compose up -d --build   # Build and start
docker compose logs            # View logs
docker compose down            # Stop
```

## Code Style

### Formatting

- **2 spaces** indentation, no tabs
- **Double quotes** for all strings and imports
- **Semicolons** always
- **Trailing commas** in multi-line parameter lists and object literals
- Opening brace on same line (K&R style)

### Imports

Strict ordering:
1. External packages (`await-to-js`, `zod`, `ssh2`, `nodemailer`)
2. Node built-ins with `node:` prefix (`node:fs`, `node:path`)
3. Internal modules (config -> db -> services -> types)

Use `import type` for type-only imports, separate from value imports:

```typescript
import to from "await-to-js";
import type { Config } from "../config.js";
import type { BirdProtocol, BgpSession, RouterPollResult } from "../types/bird.js";
import { BGP_PROTOCOL_REGEX } from "../types/bird.js";
```

All local imports use `.js` extensions (ESM requirement even though source is `.ts`).

### Naming Conventions

| Element           | Convention        | Example                          |
|-------------------|-------------------|----------------------------------|
| Files             | camelCase         | `sessionMonitor.ts`              |
| Directories       | lowercase         | `services/`, `monitor/`          |
| Classes           | PascalCase        | `SessionMonitor`, `SshService`   |
| Functions/methods | camelCase         | `pollRouter`, `handleServerDown` |
| Variables/params  | camelCase         | `routerId`, `pollInProgress`     |
| Constants         | UPPER_SNAKE_CASE  | `SSH_CONNECT_TIMEOUT_MS`         |
| Interfaces        | PascalCase        | `BgpSession`, `RouterConfig`     |
| Type aliases      | PascalCase        | `NotificationType`               |

- Private class members use the `private` keyword, no underscore prefix
- Large numeric literals use underscore separators: `15_000`, `30_000`

### Types

- **`interface`** for all data shapes (DTOs, params, config, API responses)
- **`type`** only for unions (`type NotificationType = "session_down" | ...`)
  and Zod-inferred types (`type Config = z.infer<typeof configSchema>`)
- Types live in `src/types/` organized by domain (`bird.ts`, `ixpManager.ts`, `session.ts`)
- Notification-specific types live in `src/notifications/types.ts`
- Use `Omit<T, "id">` for insert signatures (exclude auto-increment fields)

### Error Handling

**Async errors**: Use `await-to-js` (imported as `to`) for Go-style `[err, result]` destructuring.
This is the primary error handling pattern throughout the codebase:

```typescript
import to from "await-to-js";

// When only error matters:
const [err] = await to(this.serverMonitor.handleServerDown(router, error));
if (err) {
  console.error(`[scheduler] Error: ${err.message}`);
}

// When both error and result matter:
const [err, output] = await to(ssh.exec(host, command));
if (err) {
  return { success: false, error: err.message };
}
```

**Sync errors**: Use `try/catch` only for synchronous operations (file reads, JSON parsing).
Bare `catch` (without binding) is acceptable when the error details aren't needed.

**Thrown errors**: Use `new Error()` with descriptive messages. For validation errors,
format multi-line messages with field details.

**Non-fatal errors**: Log with `console.error` and continue execution. The system is
designed to be resilient -- individual failures should not crash the process.

### Logging

Use `console.log` / `console.warn` / `console.error` with a **bracketed module prefix**:

```typescript
console.log(`[session-monitor] Session back up: ${protocolName} on ${routerName}`);
console.warn(`[bgp-notifier] SMTP connection could not be verified`);
console.error(`[scheduler] Error processing sessions for ${router.name}: ${err.message}`);
```

Prefixes by module: `[bgp-notifier]`, `[scheduler]`, `[session-monitor]`,
`[server-monitor]`, `[notification]`.

No logging library -- plain `console.*` only.

### Architecture Patterns

**Classes** for stateful services with constructor dependency injection:

```typescript
export class SessionMonitor {
  private config: Config;
  private sessionRepo: SessionRepository;
  constructor(config: Config, sessionRepo: SessionRepository, ...) {
    this.config = config;
    this.sessionRepo = sessionRepo;
  }
}
```

**Free functions** for stateless/pure operations: `parseBirdProtocols()`,
`extractBgpSessions()`, `loadConfig()`, `loadRouterConfig()`.

**Static methods** for pure message builders on `NotificationManager`.

**Sequential processing**: Use `for...of` with `await` inside (not `Promise.all`)
to avoid overloading SSH connections.

### Configuration

- **Environment variables** validated with a Zod schema in `src/config.ts`
- Uses `z.coerce.number()` to parse string env vars as numbers
- Optional env vars: use `.optional()` in Zod and `process.env.X || undefined` in mapping
- The `Config` type is inferred: `type Config = z.infer<typeof configSchema>`
- Router list is a separate `routers.json` file validated by its own Zod schema

### Database (SQLite)

- Uses `bun:sqlite` (Bun's built-in SQLite bindings)
- **Repository pattern**: `SessionRepository`, `NotificationRepository`
- Raw SQL with `?` placeholders -- no ORM
- Query API: `db.query(sql).get(...)` / `.all(...)` / `.run(...)`
- Results typed as `Record<string, unknown>` then mapped via private `mapRow()` methods
  (snake_case DB columns -> camelCase TypeScript properties)
- Upserts via `INSERT ... ON CONFLICT(...) DO UPDATE SET`
- WAL mode enabled for concurrent reads

### Notification System

- `NotificationChannel` interface for extensibility (email now, Slack/webhook later)
- `NotificationManager` orchestrates delivery across channels and logs to DB
- `EmailChannel` implements `NotificationChannel` using `nodemailer`
- Recipients determined per-event: member NOC email (from IX-F export) + our NOC email

### Important Restrictions

- **Do NOT modify database file permissions** (ownership, chmod, etc.) without explicit user approval. The SQLite database at `/app/data/bgpnotifier.db` relies on bind-mount permissions matching the host `ubuntu` user (UID 1000) and the container `bun` user (UID 1000). Changing permissions can break the volume mount or cause data loss.
- **Do NOT alter the database schema or wipe the database** without explicit user approval. This includes adding/removing/renaming columns, changing table definitions, dropping tables, or deleting the `.db` file. Schema migrations must be discussed and approved before implementation. The database contains live session state and notification history that cannot be recovered once lost.

### Key File Locations

```
src/index.ts                    # Entry point, bootstraps all services
src/config.ts                   # Zod config schema + loadConfig()
src/scheduler.ts                # Poll loop with interval timer
src/services/ssh.ts             # SSH connections (ssh2 library)
src/services/bird.ts            # birdc output parser + pollRouter()
src/services/ixpManager.ts      # IX-F Member Export API client
src/services/routerConfig.ts    # routers.json loader
src/services/cache.ts           # Generic TTL cache
src/monitor/sessionMonitor.ts   # BGP session state machine (core logic)
src/monitor/serverMonitor.ts    # Server reachability tracking
src/notifications/manager.ts    # Notification orchestration + message builders
src/notifications/email.ts      # SMTP channel via nodemailer
src/notifications/types.ts      # NotificationChannel interface
src/db/schema.ts                # SQLite init + table creation
src/db/sessions.ts              # Session + server state repository
src/db/notifications.ts         # Notification log repository
src/types/bird.ts               # Bird protocol types + BGP_PROTOCOL_REGEX
src/types/ixpManager.ts         # RouterConfig, IxfMember, IX-F types
src/types/session.ts            # SessionState, ServerState, NotificationType
routers.json                    # Router config (id, name, host)
```
