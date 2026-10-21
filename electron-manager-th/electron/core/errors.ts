export class RateLimitError extends Error {
  constructor(message: string, readonly retryAfterMs: number) {
    super(message);
    this.name = "RateLimitError";
  }
}

export class AuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthenticationError";
  }
}

export class ProfileBusyError extends Error {
  constructor() {
    super("Chrome ของบัญชีนี้ถูกใช้อยู่ กรุณาปิดหน้าล็อกอินหรือออกจาก AutoPost เวอร์ชันเก่าผ่าน System Tray แล้วเริ่มงานใหม่ ไม่ต้องนำเข้า Cookie ใหม่");
    this.name = "ProfileBusyError";
  }
}

export function isProfileBusy(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /opening in existing browser session|profile.*(?:already.*use|in use)|processsingleton|singletonlock|user data directory.*(?:in use|already)/i.test(message);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
