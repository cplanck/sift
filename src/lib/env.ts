import { z } from "zod";

const optional = <T extends z.ZodType>(schema: T) => z.preprocess(
  (value) => value === "" ? undefined : value,
  schema.optional(),
);

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  BETTER_AUTH_URL: z.url().default("http://localhost:3003"),
  BETTER_AUTH_SECRET: optional(z.string().min(32)),
  DATABASE_URL: optional(z.url().refine((value) => /^postgres(ql)?:/.test(value))),
  AI_GATEWAY_API_KEY: optional(z.string().min(1)),
  AI_MODEL: optional(z.string().regex(/^anthropic\/[a-z0-9._-]+$/)),
  CREDENTIAL_ENCRYPTION_KEY: optional(z.string().regex(/^[A-Za-z0-9+/]{43}=$/)),
  R2_ACCOUNT_ID: optional(z.string().min(1)),
  R2_ACCESS_KEY_ID: optional(z.string().min(1)),
  R2_SECRET_ACCESS_KEY: optional(z.string().min(1)),
  R2_BUCKET: optional(z.string().min(1)),
  INNGEST_EVENT_KEY: optional(z.string().min(1)),
  INNGEST_SIGNING_KEY: optional(z.string().min(1)),
  INNGEST_DEV: optional(z.enum(["0", "1"])),
  ELEVENLABS_API_KEY: optional(z.string().min(1)),
  ELEVENLABS_AGENT_ID: optional(z.string().min(1)),
});

export class ConfigurationError extends Error {
  constructor(public readonly keys: string[]) {
    super(`Sift needs server configuration: ${keys.join(", ")}. See IMPLEMENTATION.md.`);
    this.name = "ConfigurationError";
  }
}

export function parseEnv(input: Record<string, string | undefined>) {
  const result = envSchema.safeParse(input);
  // Never include values or Zod's full error in logs/responses.
  if (!result.success) throw new ConfigurationError([...new Set(result.error.issues.map((issue) => String(issue.path[0])))]);
  return result.data;
}

export function env() { return parseEnv(process.env); }

export function requireConfig<K extends keyof ReturnType<typeof env>>(keys: K[]) {
  const config = env();
  const missing = keys.filter((key) => !config[key]);
  if (missing.length) throw new ConfigurationError(missing);
  return config as ReturnType<typeof env> & { [P in K]: NonNullable<ReturnType<typeof env>[P]> };
}
