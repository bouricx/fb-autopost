/** Keep webhook tokens and URLs out of logs, renderer responses and error text. */
export function webhookFailureReason(response: { status: number } | null, error?: unknown): string {
  if (response) {
    if (response.status === 401 || response.status === 403 || response.status === 404) return `HTTP ${response.status}: ตรวจสอบ Webhook/สิทธิ์ช่อง`;
    if (response.status === 429) return "HTTP 429: Discord จำกัดความถี่ กรุณารอ";
    return `HTTP ${response.status}: ปลายทางไม่รับข้อความ`;
  }
  const detail = error instanceof Error ? `${error.message} ${(error as Error & { cause?: { code?: string } }).cause?.code || ""}` : "";
  if (/ENOTFOUND|EAI_AGAIN|ERR_NAME_NOT_RESOLVED|DNS/i.test(detail)) return "DNS ของ Discord ใช้งานไม่ได้";
  if (/ETIMEDOUT|Timeout|UND_ERR_CONNECT_TIMEOUT/i.test(detail)) return "เชื่อมต่อ Discord หมดเวลา";
  if (/ECONNRESET|ECONNREFUSED/i.test(detail)) return "การเชื่อมต่อ Discord ถูกตัด";
  return "เชื่อมต่อ Discord ไม่สำเร็จ";
}
