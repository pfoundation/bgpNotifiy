/** Raw protocol entry parsed from birdc output */
export interface BirdProtocol {
  /** Full protocol name, e.g. "pp_0016_as31126" */
  name: string;
  /** Protocol type, e.g. "BGP" */
  proto: string;
  /** Routing table name */
  table: string;
  /** Protocol state, e.g. "up", "start", "down" */
  state: string;
  /** Timestamp since current state */
  since: string;
  /** Info/detail column, e.g. "Established", "Active", "Idle" */
  info: string;
}

/** Parsed BGP session from a pp_ protocol */
export interface BgpSession {
  /** Full protocol name */
  protocolName: string;
  /** ASN extracted from protocol name */
  asn: number;
  /** VLAN/Infrastructure ID extracted from protocol name */
  infraId: number;
  /** Whether the BGP session is established */
  isEstablished: boolean;
  /** Raw Bird info string */
  rawInfo: string;
  /** Raw Bird state string */
  rawState: string;
}

/** Result of polling a single router */
export interface RouterPollResult {
  routerId: number;
  routerName: string;
  success: boolean;
  sessions: BgpSession[];
  error?: string;
}

/**
 * Regex to parse pb_ (BGP) protocol names.
 * In Bird v2 route server configs, pb_ = BGP sessions, pp_ = Pipe protocols.
 * Captures: infraId, asn
 * Example: pb_0016_as31126 -> infraId=16, asn=31126
 */
export const BGP_PROTOCOL_REGEX = /^pb_(\d+)_as(\d+)$/;
