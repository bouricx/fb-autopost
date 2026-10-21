export interface SessionCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: "Strict" | "Lax" | "None";
  expires: number;
}
export interface CookieCandidate { userId: string; format: "json" | "netscape" | "raw"; cookies: SessionCookie[] }

function normalize(input: Record<string, unknown>): SessionCookie {
  const domain = String(input.domain || ".facebook.com").toLowerCase();
  if (!/^(\.)?([a-z0-9-]+\.)*facebook\.com$/.test(domain)) throw new Error("รองรับเฉพาะ Cookie ของ Facebook");
  const same = String(input.sameSite || "lax").toLowerCase();
  const expiration = Number(input.expirationDate ?? input.expires ?? -1);
  const name = String(input.name || "");
  if (!name || /[;\s=]/.test(name) || typeof input.value !== "string") throw new Error("รูปแบบ Cookie ไม่ถูกต้อง");
  return { name, value: input.value, domain, path: String(input.path || "/"),
    secure: same === "none" || same === "no_restriction" || input.secure !== false,
    httpOnly: input.httpOnly === true, sameSite: same === "strict" ? "Strict" : ["none", "no_restriction"].includes(same) ? "None" : "Lax",
    expires: Number.isFinite(expiration) && expiration > 0 ? expiration : -1 };
}

/** Never include raw input or cookie values in errors. */
export function parseCookies(input: string): CookieCandidate[] {
  if (!input.trim() || input.length > 2_000_000) throw new Error("กรุณาวาง Cookie ขนาดไม่เกิน 2 MB");
  const output: CookieCandidate[] = [];
  const append = (rows: Record<string, unknown>[], format: CookieCandidate["format"]) => {
    const cookies = rows.map(normalize);
    const identities = [...new Set(cookies.filter(c => c.name === "c_user").map(c => c.value))];
    if (identities.length !== 1 || !/^\d+$/.test(identities[0])) throw new Error("แต่ละชุดต้องมี c_user ของบัญชีเดียว ใช้ ---ACCOUNT--- คั่นบัญชี");
    if (!cookies.some(c => c.name === "xs" && c.value)) throw new Error("ไม่พบ xs สำหรับ Session");
    output.push({ userId: identities[0], cookies, format });
  };
  for (const block of input.trim().split(/\r?\n\s*---ACCOUNT---\s*\r?\n/)) {
    const text = block.trim();
    if (!text) continue;
    if (/^[\[{]/.test(text)) {
      let parsed: unknown;
      try { parsed = JSON.parse(text); } catch { throw new Error("JSON Cookie ไม่ถูกต้อง"); }
      const rows = Array.isArray(parsed) ? parsed : (parsed as { cookies?: unknown })?.cookies;
      if (!Array.isArray(rows)) throw new Error("JSON ต้องเป็นรายการ Cookie");
      if (rows.every(Array.isArray)) for (const batch of rows) append(batch, "json");
      else append(rows, "json");
    } else if (text.includes("\t")) {
      const rows = text.split(/\r?\n/).filter(line => line.trim() && (!line.startsWith("#") || line.startsWith("#HttpOnly_"))).map(line => {
        const [domain, , path, secure, expires, name, ...value] = line.replace(/^#HttpOnly_/, "").split("\t");
        return { domain, path, secure: secure === "TRUE", expires: Number(expires), name, value: value.join("\t"), httpOnly: line.startsWith("#HttpOnly_") };
      });
      append(rows, "netscape");
    } else {
      const lines = text.split(/\r?\n/).filter(Boolean);
      const batches = lines.length > 1 && lines.every(line => /(?:^|;)\s*c_user=/.test(line)) ? lines : [text];
      for (const batch of batches) append(batch.replace(/^Cookie:\s*/i, "").split(";").filter(part => part.trim()).map(part => {
        const at = part.indexOf("=");
        if (at < 1) throw new Error("Raw Cookie ไม่ถูกต้อง");
        return { name: part.slice(0, at).trim(), value: part.slice(at + 1).trim() };
      }), "raw");
    }
  }
  if (new Set(output.map(item => item.userId)).size !== output.length) throw new Error("มีบัญชี c_user ซ้ำในรายการ");
  return output;
}
