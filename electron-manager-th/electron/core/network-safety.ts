/** DNS failures are machine/network failures, not group-specific failures. */
export class NetworkUnavailableError extends Error {
  constructor(readonly host: "Facebook" | "Discord", readonly code: string) {
    super(`${host} ติดต่อไม่ได้ (${code}) กรุณาตรวจ DNS/เครือข่าย แล้วตรวจ Session ก่อนเริ่มคิวใหม่`);
    this.name = "NetworkUnavailableError";
  }
}

export function dnsFailureCode(error: unknown): string | null {
  const detail = error instanceof Error ? error.message : String(error);
  return /net::(ERR_NAME_NOT_RESOLVED|ERR_DNS_PROBE_FINISHED_NXDOMAIN|ERR_DNS_PROBE_FINISHED_BAD_CONFIG|ERR_INTERNET_DISCONNECTED)/i.exec(detail)?.[1]?.toUpperCase() || null;
}
