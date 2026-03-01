/** Router configuration from routers.json config file */
export interface RouterConfig {
  id: number;
  name: string;
  host: string;
  /** Peering IP address on the IXP fabric */
  peeringIp: string;
  /** Route server ASN */
  asn: number;
}

/** IX-F Member Export v1.0 root response */
export interface IxfExport {
  version: string;
  timestamp: string;
  member_list: IxfMember[];
}

/** Member from IX-F Member Export v1.0 */
export interface IxfMember {
  asnum: number;
  name: string;
  url: string | null;
  member_since: string;
  peering_policy: string | null;
  contact_email?: string[];
  contact_phone?: string[];
  contact_hours?: string[];
  peering_policy_url?: string;
  connection_list: IxfConnection[];
}

/** Connection entry in IX-F Member Export */
export interface IxfConnection {
  ixp_id: number;
  state: string;
  if_list: { switch_id: number; if_speed: number }[];
  vlan_list: IxfVlan[];
}

/** VLAN entry in an IX-F connection */
export interface IxfVlan {
  vlan_id: number;
  ipv4?: IxfVlanAddress;
  ipv6?: IxfVlanAddress;
}

/** Address details within a VLAN */
export interface IxfVlanAddress {
  address: string;
  as_macro?: string;
  routeserver: boolean;
  mac_addresses: string[];
  max_prefix?: number;
  services?: IxfService[];
}

/** Service descriptor (route server, route collector, etc.) */
export interface IxfService {
  type: string;
  daemon: string;
  daemon_version: string;
  os: string;
  os_version: string;
}
