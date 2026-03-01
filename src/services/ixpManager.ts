import to from "await-to-js";
import type { Config } from "../config.js";
import type { IxfExport, IxfMember } from "../types/ixpManager.js";
import { TtlCache } from "./cache.js";

export class IxpManagerClient {
  private config: Config;
  private memberCache: TtlCache<Map<number, IxfMember>>;

  constructor(config: Config) {
    this.config = config;
    this.memberCache = new TtlCache<Map<number, IxfMember>>(
      config.ixpCacheTtlMinutes
    );
  }

  /** Get a member by ASN, using cache */
  async getMemberByAsn(asn: number): Promise<IxfMember | null> {
    const memberMap = await this.getMemberMap();
    return memberMap.get(asn) || null;
  }

  /** Get the first NOC email for a given ASN */
  async getNocEmailForAsn(asn: number): Promise<string | null> {
    const member = await this.getMemberByAsn(asn);
    if (!member) return null;
    if (!member.contact_email || member.contact_email.length === 0) return null;
    return member.contact_email[0];
  }

  /** Get the member name for a given ASN */
  async getMemberNameByAsn(asn: number): Promise<string | null> {
    const member = await this.getMemberByAsn(asn);
    if (!member) return null;
    return member.name;
  }

  /** Get the member's IPv4 peering address for a given ASN */
  async getMemberIpByAsn(asn: number): Promise<string | null> {
    const member = await this.getMemberByAsn(asn);
    if (!member) return null;

    const connection = member.connection_list?.[0];
    if (!connection) return null;

    const vlan = connection.vlan_list?.[0];
    if (!vlan) return null;

    return vlan.ipv4?.address ?? null;
  }

  /** Force refresh all cached data */
  invalidateCache(): void {
    this.memberCache.invalidate();
  }

  /** Verify connectivity to IXP Manager by fetching the member export */
  async verifyConnection(): Promise<{ ok: boolean; memberCount: number }> {
    const [err, members] = await to(this.fetchMembers());
    if (err) {
      return { ok: false, memberCount: 0 };
    }
    return { ok: true, memberCount: members.length };
  }

  private async getMemberMap(): Promise<Map<number, IxfMember>> {
    const cached = this.memberCache.get();
    if (cached) return cached;

    const [err, members] = await to(this.fetchMembers());
    if (err) {
      throw new Error(
        `Failed to fetch members from IXP Manager: ${err.message}`
      );
    }

    // Build ASN -> Member map (last entry wins for duplicate ASNs)
    const memberMap = new Map<number, IxfMember>();
    for (const member of members) {
      memberMap.set(member.asnum, member);
    }

    this.memberCache.set(memberMap);
    return memberMap;
  }

  private async fetchMembers(): Promise<IxfMember[]> {
    const url = this.config.ixfExportUrl;
    const response = await fetch(url, {
      headers: {
        "X-IXP-Manager-API-Key": this.config.ixpManagerApiKey,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(
        `IXP Manager IX-F export error: ${response.status} ${response.statusText}`
      );
    }

    const data = (await response.json()) as IxfExport;

    if (!data.member_list || !Array.isArray(data.member_list)) {
      throw new Error("IXP Manager IX-F export: missing or invalid member_list");
    }

    return data.member_list;
  }
}
