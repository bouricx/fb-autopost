import { randomBytes, scrypt, createCipheriv, createDecipheriv } from "node:crypto";
import { promisify } from "node:util";

const derive = promisify(scrypt);
interface Envelope { version: 1; algorithm: "aes-256-gcm"; kdf: "scrypt"; salt: string; iv: string; tag: string; ciphertext: string }
const aad = Buffer.from("veltshop-facebook-session-v1");

function passwordCheck(password: string) {
  if (password.length < 12 || password.length > 1024) throw new Error("รหัสผ่านสำรองต้องมีความยาว 12–1024 ตัวอักษร");
}

export async function encryptBackup(plaintext: string, password: string): Promise<string> {
  passwordCheck(password);
  if (Buffer.byteLength(plaintext) > 2_000_000) throw new Error("ข้อมูลสำรองใหญ่เกินกำหนด");
  const salt = randomBytes(16), iv = randomBytes(12);
  const key = await derive(password, salt, 32) as Buffer;
  try {
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const envelope: Envelope = { version: 1, algorithm: "aes-256-gcm", kdf: "scrypt", salt: salt.toString("base64"),
      iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") };
    return JSON.stringify(envelope);
  } finally { key.fill(0); }
}

export async function decryptBackup(serialized: string, password: string): Promise<string> {
  passwordCheck(password);
  if (serialized.length > 3_000_000) throw new Error("ไฟล์สำรองใหญ่เกินกำหนด");
  let key: Buffer | undefined;
  try {
    const data = JSON.parse(serialized) as Envelope;
    if (data.version !== 1 || data.algorithm !== "aes-256-gcm" || data.kdf !== "scrypt") throw new Error();
    const decode = (value: string, length?: number) => {
      if (typeof value !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new Error();
      const buffer = Buffer.from(value, "base64");
      if (buffer.toString("base64") !== value || (length && buffer.length !== length)) throw new Error();
      return buffer;
    };
    const salt = decode(data.salt, 16), iv = decode(data.iv, 12), tag = decode(data.tag, 16);
    key = await derive(password, salt, 32) as Buffer;
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(decode(data.ciphertext)), decipher.final()]).toString("utf8");
  } catch { throw new Error("รหัสผ่านไม่ถูกต้อง หรือไฟล์สำรองเสียหาย/ไม่รองรับ"); }
  finally { key?.fill(0); }
}
