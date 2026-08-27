import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

function getKey(): Buffer {
  const secret = process.env["STUDENT_SESSION_SECRET"];
  if (!secret) throw new Error("STUDENT_SESSION_SECRET is not set");
  // Derive a fixed 32-byte key from whatever the secret is (hex or not).
  return createHash("sha256").update(secret, "utf8").digest();
}

/** Encrypt a plaintext password; returns a base64 string. */
export function encryptPassword(plain: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString("base64");
}

/** Decrypt a base64 ciphertext back to the plaintext password. */
export function decryptPassword(cipherText: string): string {
  const key = getKey();
  const payload = Buffer.from(cipherText, "base64");
  const iv = payload.subarray(0, IV_LENGTH);
  const authTag = payload.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = payload.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}
