# BGP Notifier

BGP session monitoring and notification tool for IXP Bird v2 servers.

Polls Bird v2 route servers and route collectors via SSH, tracks BGP session
state changes in SQLite, and sends email notifications when sessions go down
or recover. Member contact details are fetched from IXP Manager's IX-F Member
Export API.

## Prerequisites

- **Docker** and **Docker Compose**
- **SSH access** to each Bird v2 server (the monitoring user needs read access
  to the `birdc` socket)
- **IXP Manager v7+** with the IX-F Member Export API enabled
- **SMTP credentials** for sending email (e.g. Mailgun, SES, Postfix)

## Quick Start

### 1. Clone the repository

```bash
git clone <repo-url> bgpNotifier
cd bgpNotifier
```

### 2. Generate an SSH key

```bash
mkdir -p ssh
ssh-keygen -t ed25519 -f ssh/id_ed25519 -N "" -C "bgp-notifier"
```

### 3. Add the public key to each Bird server

On every Bird server, authorize the key for the monitoring user (e.g. `monitor`):

```bash
# Create the user if it doesn't exist
sudo useradd -m -s /bin/bash monitor

# Authorize the key
sudo mkdir -p /home/monitor/.ssh
cat ssh/id_ed25519.pub | sudo tee -a /home/monitor/.ssh/authorized_keys
sudo chmod 700 /home/monitor/.ssh
sudo chmod 600 /home/monitor/.ssh/authorized_keys
sudo chown -R monitor:monitor /home/monitor/.ssh
```

The user must be able to run `birdc`. By default the `birdc` socket is at
`/run/bird/bird.ctl` and is owned by the `bird` group. Either:

- Add the user to the `bird` group: `sudo usermod -aG bird monitor`
- Or adjust the socket permissions in `/etc/bird/bird.conf`:
  ```
  log syslog all;
  debug protocols all;
  ...
  ```

Verify manually: `ssh monitor@<router-ip> birdc show protocols`

### 4. Configure the environment

```bash
cp .env.example .env
```

Edit `.env` and fill in:

- `IXF_EXPORT_URL` -- full URL to your IXP Manager IX-F export endpoint
- `IXP_MANAGER_API_KEY` -- your IXP Manager API key
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` -- SMTP credentials
- `SSH_USER` -- the SSH user created above (e.g. `monitor`)
- `NOC_EMAIL` -- your NOC email address

### 5. Configure routers

```bash
cp routers.json.example routers.json
```

Edit `routers.json` with your Bird servers:

```json
{
  "routers": [
    { "id": 1, "name": "Route Server 1", "host": "10.0.0.1" },
    { "id": 2, "name": "Route Server 1 IPv6", "host": "10.0.0.2" },
    { "id": 3, "name": "Route Collector 1", "host": "10.0.0.3" }
  ]
}
```

Each router needs:

| Field  | Description |
|--------|-------------|
| `id`   | Stable integer identifier. Used as the database key for session history -- do not change or reorder once running. |
| `name` | Human-readable name shown in notifications. |
| `host` | Management IP or hostname the tool will SSH into. |

### 6. Create the data directory and start

```bash
mkdir -p data
docker compose up -d --build
docker compose logs -f
```

You should see output like:

```
[bgp-notifier] Starting BGP Notifier...
[bgp-notifier] Configuration loaded
[bgp-notifier] Loaded 3 routers from /app/config/routers.json
[bgp-notifier] Database initialized
[bgp-notifier] SMTP connection verified
[bgp-notifier] IXP Manager IX-F export connected - 22 members
[scheduler] Starting polling every 3 minutes
[bgp-notifier] BGP Notifier is running
```

## Notification Logic

### Session notifications (sent to member NOC + your NOC)

| Event | Action |
|-------|--------|
| Session goes down | Marked down internally; notification deferred by `DOWN_COOLDOWN_MINUTES` (default: 30m) |
| Session recovers within cooldown | Silent recovery -- no down or up notification sent |
| Session still down after cooldown | Initial down notification sent |
| Session stays down | Re-notification every `DOWN_RENOTIFY_HOURS` (default: 12h) |
| Session comes back up after being notified | One "back up" notification |
| Session already up, no prior history | Silently recorded, no notification (avoids noise on first run) |

### Server notifications (sent to your NOC only)

| Event | Action |
|-------|--------|
| Server unreachable via SSH | Immediate notification, re-notify every `DOWN_RENOTIFY_HOURS` |
| Server comes back online | One notification |

Members are not notified about server outages -- they cannot fix your infrastructure.

## Bird Protocol Naming

The tool only monitors `pb_*` protocols (actual BGP peer sessions) and ignores
`pp_*` protocols (pipe protocols connecting peer tables to the master table).

The ASN is extracted from the protocol name to look up member details:

```
pb_0016_as31126  -->  ASN 31126  -->  "SODETEL S.A.L." (noc@sodetel.net.lb)
```

## Configuration Reference

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `POLL_INTERVAL_MINUTES` | How often to poll BGP sessions | `3` | No |
| `DOWN_RENOTIFY_HOURS` | Re-notification interval for down sessions/servers | `12` | No |
| `DOWN_COOLDOWN_MINUTES` | Cooldown before sending session-down notification (suppresses transient flaps). Set `0` to disable | `30` | No |
| `IXF_EXPORT_URL` | Full URL to IX-F Member Export v1.0 endpoint | -- | Yes |
| `IXP_MANAGER_API_KEY` | IXP Manager API key | -- | Yes |
| `NOC_EMAIL` | Your NOC email (receives all alerts) | `noc@openix.ong` | No |
| `SMTP_HOST` | SMTP server hostname | -- | Yes |
| `SMTP_PORT` | SMTP server port | `587` | No |
| `SMTP_USER` | SMTP username | -- | Yes |
| `SMTP_PASS` | SMTP password | -- | Yes |
| `SMTP_FROM` | From address on outgoing emails | -- | Yes |
| `SMTP_REPLY_TO` | Reply-To header (omitted if not set) | -- | No |
| `SMTP_CC` | Always CC this address on every notification | -- | No |
| `SSH_USER` | SSH username for Bird servers | -- | Yes |
| `SSH_KEY_PATH` | Path to SSH private key (container path) | `/app/ssh/id_ed25519` | No |
| `SSH_PORT` | SSH port | `22` | No |
| `DB_PATH` | SQLite database path (container path) | `/app/data/bgpnotifier.db` | No |
| `ROUTERS_CONFIG_PATH` | Router config file path (container path) | `/app/config/routers.json` | No |
| `IXP_CACHE_TTL_MINUTES` | How long to cache IX-F member data | `15` | No |

## Development

Run locally without Docker (requires [Bun](https://bun.sh)):

```bash
bun install
bun run dev          # run with file watching
bun run typecheck    # type-check only (no emit)
```

## Project Structure

```
src/
  index.ts                    Entry point, bootstraps all services
  config.ts                   Zod-validated env config
  scheduler.ts                Poll loop with interval timer
  services/
    ssh.ts                    SSH connections (ssh2)
    bird.ts                   birdc output parser
    ixpManager.ts             IX-F Member Export API client
    routerConfig.ts           routers.json loader + validator
    cache.ts                  Generic TTL cache
  monitor/
    sessionMonitor.ts         BGP session state machine (core logic)
    serverMonitor.ts          Server reachability tracking
  notifications/
    manager.ts                Notification orchestration + message builders
    email.ts                  SMTP channel (nodemailer)
    types.ts                  NotificationChannel interface
  db/
    schema.ts                 SQLite table creation
    sessions.ts               Session + server state repository
    notifications.ts          Notification log repository
  types/
    bird.ts                   Bird protocol types
    ixpManager.ts             RouterConfig, IxfMember types
    session.ts                SessionState, ServerState types
routers.json                  Router configuration
Dockerfile                    Bun-based container image
docker-compose.yml            Container orchestration
```

## License

MIT
