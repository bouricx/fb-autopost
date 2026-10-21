import { safeStorage } from "electron";

export class SecretVault {
  /** Retains compatibility with existing DPAPI secrets. */
  encryptCookies(value: string): string {
    const encrypted = this.encrypt(value);
    if (!encrypted) throw new Error("ไม่พบ Cookie สำหรับเข้ารหัส");
    return encrypted;
  }

  encryptProxy(value: string | undefined): string | null {
    return this.encrypt(value);
  }
  encrypt(value: string | undefined): string | null {
    const clean = value?.trim();
    if (!clean) return null;
    if (!safeStorage.isEncryptionAvailable()) throw new Error("Windows ไม่พร้อมเข้ารหัสข้อมูลลับ");
    return safeStorage.encryptString(clean).toString("base64");
  }

  decrypt(value: string | null): string | null {
    if (!value) return null;
    if (!safeStorage.isEncryptionAvailable()) throw new Error("ไม่สามารถถอดรหัสข้อมูลลับบนเครื่องนี้");
    return safeStorage.decryptString(Buffer.from(value, "base64"));
  }
}
