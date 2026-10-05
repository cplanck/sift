import "server-only";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "@/db/connection";
import { gatewayCredentials, users } from "@/db/schema";
import { DomainError } from "@/domain/errors";
import { decryptCredential, encryptCredential } from "@/lib/credential-crypto";
import { env } from "@/lib/env";

const provider = "vercel-ai-gateway";
const scope = (userId: string) => and(eq(gatewayCredentials.userId, userId), eq(gatewayCredentials.provider, provider));
async function assertUser(db: Database, userId: string) {
  if (!z.uuid().safeParse(userId).success) throw new DomainError("UNAUTHENTICATED", "Please sign in.");
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId));
  if (!user) throw new DomainError("UNAUTHENTICATED", "Please sign in.");
}
export async function getGatewayCredentialStatus(db: Database, userId: string) {
  await assertUser(db, userId);
  const [credential] = await db.select({ hint: gatewayCredentials.hint, updatedAt: gatewayCredentials.updatedAt }).from(gatewayCredentials).where(scope(userId));
  const config = env();
  return { configured: !!credential, hint: credential?.hint ?? null, updatedAt: credential?.updatedAt ?? null, appConfigured: !!config.AI_GATEWAY_API_KEY, encryptionConfigured: !!config.CREDENTIAL_ENCRYPTION_KEY };
}
export async function saveGatewayCredential(db: Database, userId: string, input: unknown) {
  await assertUser(db, userId);
  const { key } = z.object({ key: z.string().trim().min(12).max(1000) }).strict().parse(input);
  const encryptedSecret = encryptCredential(userId, key), hint = `•••• ${key.slice(-4)}`;
  await db.insert(gatewayCredentials).values({ userId, provider, encryptedSecret, hint }).onConflictDoUpdate({ target: [gatewayCredentials.userId, gatewayCredentials.provider], set: { encryptedSecret, hint, updatedAt: new Date() } });
  return getGatewayCredentialStatus(db, userId);
}
export async function deleteGatewayCredential(db: Database, userId: string) {
  await assertUser(db, userId);
  await db.delete(gatewayCredentials).where(scope(userId));
  return getGatewayCredentialStatus(db, userId);
}
// Only the server runtime consumes this value. It is never a DTO or tool result.
export async function resolveGatewayCredential(db: Database, userId: string) {
  await assertUser(db, userId);
  const [credential] = await db.select({ encryptedSecret: gatewayCredentials.encryptedSecret }).from(gatewayCredentials).where(scope(userId));
  return credential ? decryptCredential(userId, credential.encryptedSecret) : undefined;
}
