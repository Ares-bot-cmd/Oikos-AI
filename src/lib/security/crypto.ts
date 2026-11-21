import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

function secretKey(): Buffer {
  const raw = process.env.SECRET_KEY;
  if (!raw) {
    if (process.env.NODE_ENV === "production") throw new Error("SECRET_KEY must be set in production.");
    return createHash("sha256").update("oikos-dev-only-secret").digest();
  }
  return createHash("sha256").update(raw).digest();
}

/** AES-256-GCM. Output: base64url(iv).base64url(tag).base64url(ciphertext) */
export function encryptJson(value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secretKey(), iv);
  const enc = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), enc].map((b) => b.toString("base64url")).join(".");
}

export function decryptJson<T = Record<string, string>>(payload: string | null | undefined): T | null {
  if (!payload) return null;
  try {
    const [iv, tag, enc] = payload.split(".").map((p) => Buffer.from(p, "base64url"));
    const decipher = createDecipheriv("aes-256-gcm", secretKey(), iv);
    decipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8")) as T;
  } catch {
    return null;
  }
}

/** Verifies Meta's X-Hub-Signature-256 header ("sha256=<hex>") over the raw request body. */
export function verifyMetaSignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = "sha256=" + createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  return safeEqual(expected, header);
}
