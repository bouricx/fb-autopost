export function bangkokDay(now = Date.now()): string { return new Date(now + 7 * 3600000).toISOString().slice(0, 10); }
export function scheduleInstant(day: string, time: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error("วันหรือเวลาไม่ถูกต้อง");
  const date = new Date(`${day}T${time}:00+07:00`);
  if (!Number.isFinite(date.getTime()) || bangkokDay(date.getTime()) !== day) throw new Error("วันที่ไม่ถูกต้อง");
  return date.toISOString();
}
