import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

const PREFIX = "enc:v1:";

function encryptionKey() {
  const secret = process.env.META_CREDENTIAL_ENCRYPTION_KEY;
  if (!secret) throw new Error("Falta META_CREDENTIAL_ENCRYPTION_KEY en el servidor");
  return createHash("sha256").update(secret, "utf8").digest();
}

export function encryptCredential(value: string) {
  const plain = value.trim();
  if (!plain) throw new Error("La credencial está vacía");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

export function decryptCredential(value: string) {
  if (!value.startsWith(PREFIX)) return value;
  const [ivValue, tagValue, encryptedValue] = value.slice(PREFIX.length).split(":");
  if (!ivValue || !tagValue || !encryptedValue) throw new Error("La credencial cifrada tiene un formato inválido");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivValue, "base64"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(encryptedValue, "base64")), decipher.final()]).toString("utf8");
}

export function isEncryptedCredential(value: string) {
  return value.startsWith(PREFIX);
}
