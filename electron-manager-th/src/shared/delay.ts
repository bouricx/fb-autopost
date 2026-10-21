export function validateDelay(minimum: number, maximum: number): string | null {
  if (!Number.isInteger(minimum) || !Number.isInteger(maximum) || minimum < 0 || maximum < 0 || maximum > 86400) return "ระบุจำนวนวินาทีเต็ม ตั้งแต่ 0 ถึง 86400";
  return maximum < minimum ? "ดีเลย์สูงสุดต้องไม่น้อยกว่าต่ำสุด" : null;
}
export function delayMilliseconds(minimum: number, maximum: number, random = Math.random): number {
  const error = validateDelay(minimum, maximum);
  if (error) throw new Error(error);
  return (minimum + Math.floor(random() * (maximum - minimum + 1))) * 1000;
}
