import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { ConfigurationError, requireConfig } from "./env";

const provider = "vercel-ai-gateway";
const associatedData = (userId: string) => Buffer.from(`sift:${provider}:${userId}:v1`);
function encryptionKey() {
  const key = Buffer.from(requireConfig(["CREDENTIAL_ENCRYPTION_KEY"]).CREDENTIAL_ENCRYPTION_KEY, "base64");
  if (key.length !== 32) throw new ConfigurationError(["CREDENTIAL_ENCRYPTION_KEY"]);
  return key;
}
export function encryptCredential(userId: string, secret: string) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(associatedData(userId));
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), ciphertext.toString("base64")].join(".");
}
export function decryptCredential(userId: string, encrypted: string) {
  const key = encryptionKey();
  try {
    const [version, iv, tag, ciphertext, extra] = encrypted.split(".");
    if (version !== "v1" || extra || !iv || !tag || !ciphertext) throw new Error("Invalid encrypted format");
    const nonce = Buffer.from(iv, "base64"), authTag = Buffer.from(tag, "base64");
    if (nonce.length !== 12 || authTag.length !== 16) throw new Error("Invalid encrypted format");
    const decipher = createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAAD(associatedData(userId)); decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64")), decipher.final()]).toString("utf8");
  } catch {
    // Never propagate cryptographic details, input, or secret material.
    throw new ConfigurationError(["CREDENTIAL_ENCRYPTION_KEY"]);
  }
}
