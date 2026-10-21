import { describe, expect, it } from "vitest";
import { encryptBackup, decryptBackup } from "../electron/accounts/portable-backup";

describe("portable encrypted session backup", () => {
  const password = "test-password-ย้ายเครื่อง";
  it("round trips without DPAPI and hides the original payload", async () => {
    const payload = '[{"name":"xs","value":"private-cookie-value"}]';
    const encrypted = await encryptBackup(payload, password);
    expect(encrypted).not.toContain("private-cookie-value");
    expect(await decryptBackup(encrypted, password)).toBe(payload);
    expect(await encryptBackup(payload, password)).not.toBe(encrypted);
  });
  it("rejects wrong passwords, tampering and unknown versions", async () => {
    const encrypted = await encryptBackup("secret", password);
    await expect(decryptBackup(encrypted, "wrong-password-123")).rejects.toThrow();
    const data = JSON.parse(encrypted);
    data.tag = Buffer.alloc(16).toString("base64");
    await expect(decryptBackup(JSON.stringify(data), password)).rejects.toThrow();
    await expect(decryptBackup('{"version":2}', password)).rejects.toThrow();
  });
  it("rejects weak passwords", async () => {
    await expect(encryptBackup("secret", "short")).rejects.toThrow();
  });
});
