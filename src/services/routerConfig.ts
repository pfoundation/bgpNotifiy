import fs from "node:fs";
import { z } from "zod";
import type { RouterConfig } from "../types/ixpManager.js";

const routerSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  host: z.string().min(1),
  peeringIp: z.string().min(1),
  asn: z.coerce.number().positive(),
});

const routersFileSchema = z.object({
  routers: z.array(routerSchema).min(1),
});

/** Load and validate the routers config file */
export function loadRouterConfig(configPath: string): RouterConfig[] {
  if (!fs.existsSync(configPath)) {
    throw new Error(
      `Routers config file not found: ${configPath}\n` +
        `Copy routers.json.example to routers.json and configure your routers.`
    );
  }

  const raw = fs.readFileSync(configPath, "utf-8");

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Failed to parse routers config as JSON: ${configPath}`);
  }

  const result = routersFileSchema.safeParse(parsed);
  if (!result.success) {
    const errors = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid routers config (${configPath}):\n${errors}`);
  }

  // Check for duplicate IDs
  const ids = new Set<number>();
  for (const router of result.data.routers) {
    if (ids.has(router.id)) {
      throw new Error(
        `Duplicate router ID ${router.id} in ${configPath}. Each router must have a unique ID.`
      );
    }
    ids.add(router.id);
  }

  return result.data.routers;
}
