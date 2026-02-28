import to from "await-to-js";
import type { SshService } from "./ssh.js";
import type { BirdProtocol, BgpSession, RouterPollResult } from "../types/bird.js";
import { BGP_PROTOCOL_REGEX } from "../types/bird.js";
import type { RouterConfig } from "../types/ixpManager.js";

/**
 * Parse the tabular output of `birdc show protocols`.
 *
 * Example output:
 * ```
 * BIRD 2.14 ready.
 * Name       Proto      Table      State  Since         Info
 * device1    Device     ---        up     2026-01-20 16:13:18
 * pp_0016_as31126 Pipe  ---        up     2026-02-17 09:14:16  master4 <=> t_0016_as31126
 * pb_0016_as31126 BGP   ---        up     2026-02-24 15:17:06  Established
 * pb_0016_as13335 BGP   ---        start  2026-02-24 14:33:51  Active        Socket: Connection refused
 * ```
 */
export function parseBirdProtocols(output: string): BirdProtocol[] {
  const lines = output.split("\n");
  const protocols: BirdProtocol[] = [];

  for (const line of lines) {
    // Skip header, BIRD ready line, and empty lines
    const trimmed = line.trim();
    if (
      !trimmed ||
      trimmed.startsWith("BIRD") ||
      trimmed.startsWith("Name")
    ) {
      continue;
    }

    // Bird's show protocols output is whitespace-delimited with these columns:
    // Name  Proto  Table  State  Since  Info
    // The "Since" field can be a date+time (2 tokens) or just a date
    // "Info" may be empty or contain text like "Established", "Active", etc.
    const parts = trimmed.split(/\s+/);
    if (parts.length < 5) continue;

    const name = parts[0];
    const proto = parts[1];
    const table = parts[2];
    const state = parts[3];
    // Since is typically date+time like "2024-01-01 12:00:00" (2 parts)
    // or just a date "2024-01-01" (1 part)
    // Info comes after the since field
    const since = parts[4];
    // Everything after the date/time fields is info
    // The since field format in bird is typically "YYYY-MM-DD HH:MM:SS"
    // so parts[4] = date, parts[5] = time, parts[6+] = info
    // But sometimes it's just the date
    let info = "";
    if (parts.length > 5) {
      // Check if parts[5] looks like a time (HH:MM:SS)
      if (/^\d{2}:\d{2}:\d{2}$/.test(parts[5])) {
        info = parts.slice(6).join(" ");
      } else {
        info = parts.slice(5).join(" ");
      }
    }

    protocols.push({ name, proto, table, state, since, info });
  }

  return protocols;
}

/** Extract BGP sessions from parsed Bird protocols (only pb_ prefixed) */
export function extractBgpSessions(protocols: BirdProtocol[]): BgpSession[] {
  const sessions: BgpSession[] = [];

  for (const proto of protocols) {
    const match = proto.name.match(BGP_PROTOCOL_REGEX);
    if (!match) continue;

    const infraId = parseInt(match[1], 10);
    const asn = parseInt(match[2], 10);

    sessions.push({
      protocolName: proto.name,
      asn,
      infraId,
      isEstablished: proto.info.toLowerCase() === "established",
      rawInfo: proto.info,
      rawState: proto.state,
    });
  }

  return sessions;
}

/** Poll a single router for its BGP sessions */
export async function pollRouter(
  ssh: SshService,
  router: RouterConfig
): Promise<RouterPollResult> {
  const [err, output] = await to(
    ssh.exec(router.host, "birdc show protocols")
  );

  if (err) {
    return {
      routerId: router.id,
      routerName: router.name,
      success: false,
      sessions: [],
      error: err.message,
    };
  }

  const protocols = parseBirdProtocols(output);
  const sessions = extractBgpSessions(protocols);

  return {
    routerId: router.id,
    routerName: router.name,
    success: true,
    sessions,
  };
}
