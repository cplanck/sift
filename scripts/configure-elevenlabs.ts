import { createHash, randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { config } from "dotenv";
import { z } from "zod";
import { buildElevenAgentConfig, elevenVoiceConfiguration } from "../src/voice/config";
import { requireConfig } from "../src/lib/env";

// Explicit invocation only. Never run during install/build or log provider bodies.
// pnpm exec tsx scripts/configure-elevenlabs.ts --origin https://sift-roan.vercel.app --voice-id <licensed-voice-id> --apply
const stateSchema = z.object({
  origin: z.url(), voiceId: z.string(), llmSecret: z.string().min(32),
  secretId: z.string().optional(), webhookId: z.string().optional(), webhookSecret: z.string().min(32).optional(),
  agentId: z.string().optional(), pending: z.enum(["secret", "webhook", "agent"]).optional(),
});

async function run() {
  const { values } = parseArgs({ options: { origin: { type: "string" }, "voice-id": { type: "string" }, "config-file": { type: "string" }, apply: { type: "boolean", default: false } } });
  const envPath = resolve(values["config-file"] ?? ".env.local");
  // Separate development agents use a separate ignored file. Never write
  // credentials into an arbitrary (possibly tracked) destination.
  if (dirname(envPath) !== resolve(".") || !/^\.env\.[A-Za-z0-9_-]+$/.test(basename(envPath)) || basename(envPath) === ".env.example") {
    throw new Error("Use a private repository-root .env.<name> file, excluding .env.example.");
  }
  config({ path: envPath, quiet: true, override: !!values["config-file"] });
  if (!values.origin || !values["voice-id"]) throw new Error("Pass --origin https://your-sift-host and --voice-id for an available, licensed voice. Add --apply to provision.");
  const origin = new URL(values.origin).origin;
  const draft = buildElevenAgentConfig({ origin: values.origin, voiceId: values["voice-id"], secretId: "pending", webhookId: "pending" });
  if (!values.apply) {
    console.log(`Ready to configure ${draft.name}: private WebRTC, Sift callback, and usage webhook. No changes made. Pass --apply to continue.`);
    return;
  }
  let contents: string;
  try { contents = await readFile(envPath, "utf8"); }
  catch { throw new Error("Create the selected private environment file with ELEVENLABS_API_KEY before provisioning."); }
  await chmod(envPath, 0o600);
  const { ELEVENLABS_API_KEY } = requireConfig(["ELEVENLABS_API_KEY"]);
  const request = async (path: string, method = "GET", body?: unknown): Promise<unknown> => {
    let response: Response;
    try {
      response = await fetch(`${elevenVoiceConfiguration.apiOrigin}${path}`, {
        method, headers: { "xi-api-key": ELEVENLABS_API_KEY, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body), redirect: "error", signal: AbortSignal.timeout(20_000),
      });
    } catch { throw new Error("ElevenLabs did not respond. Check connectivity before retrying; no mutation is automatically retried."); }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`ElevenLabs returned HTTP ${response.status}. Check Agents read/write, Voices read, Webhooks write, and account credits. Provider response omitted.`); }
    try { return await response.json(); }
    catch { throw new Error("ElevenLabs returned an invalid response. Check the setup recovery file before retrying."); }
  };

  // Read and validate the selected voice before creating anything. Selecting a
  // licensed voice does not create, clone, or imitate a person's voice.
  const voice = z.object({ voice_id: z.string(), name: z.string() }).parse(await request(`/v1/voices/${encodeURIComponent(values["voice-id"])}`));
  if (voice.voice_id !== values["voice-id"]) throw new Error("The selected voice could not be verified.");
  const directory = resolve(".local");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const statePath = resolve(directory, `elevenlabs-${createHash("sha256").update(origin).digest("hex").slice(0,16)}.json`);
  let state: z.infer<typeof stateSchema>;
  try { state = stateSchema.parse(JSON.parse(await readFile(statePath, "utf8"))); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("The local ElevenLabs recovery file is invalid; inspect it privately before proceeding.");
    state = { origin, voiceId: voice.voice_id, llmSecret: process.env.ELEVENLABS_LLM_SECRET || randomBytes(32).toString("base64url") };
  }
  if (state.origin !== origin || state.voiceId !== voice.voice_id) throw new Error("This setup has a different origin or voice. Review the existing Sift agent before changing it.");
  if (state.pending) throw new Error(`A previous ${state.pending} creation may have reached ElevenLabs. Reconcile the private recovery file with the provider before retrying to avoid duplicate resources.`);
  if (process.env.ELEVENLABS_AGENT_ID && process.env.ELEVENLABS_AGENT_ID !== state.agentId) throw new Error("An agent is already configured outside this setup. Refusing to edit or replace it.");
  if (process.env.ELEVENLABS_LLM_SECRET && process.env.ELEVENLABS_LLM_SECRET !== state.llmSecret) throw new Error("The local callback secret differs from setup state. Refusing to rotate it implicitly.");
  const save = async () => {
    const temp = `${statePath}.tmp`;
    await writeFile(temp, JSON.stringify(state, null, 2) + "\n", { mode: 0o600 });
    await chmod(temp, 0o600); await rename(temp, statePath);
  };
  await save();

  if (!state.agentId) {
    // Never adopt or overwrite another agent merely because its name matches.
    let cursor: string | undefined;
    for (let page = 0; page < 20; page++) {
      const query = new URLSearchParams({ page_size: "100", ...(cursor ? { cursor } : {}) });
      const list = z.object({ agents: z.array(z.object({ name: z.string() })), has_more: z.boolean(), next_cursor: z.string().nullish() }).parse(await request(`/v1/convai/agents?${query}`));
      if (list.agents.some((agent) => agent.name === draft.name)) throw new Error("A Sift agent with this name already exists. Reconcile its ID with the private recovery file; it will not be modified by name alone.");
      if (!list.has_more) break;
      if (!list.next_cursor || page === 19) throw new Error("Could not finish checking existing agents. No resources were created.");
      cursor = list.next_cursor;
    }
  }
  if (!state.secretId) {
    state.pending = "secret"; await save();
    const result = z.object({ secret_id: z.string().min(1) }).parse(await request("/v1/convai/secrets", "POST", { type: "new", name: `${draft.name} callback`, value: state.llmSecret }));
    state.secretId = result.secret_id; delete state.pending; await save();
  }
  if (!state.webhookId) {
    state.pending = "webhook"; await save();
    const result = z.object({ webhook_id: z.string().min(1), webhook_secret: z.string().min(32) }).parse(await request("/v1/workspace/webhooks", "POST", {
      settings: { auth_type: "hmac", name: `${draft.name} usage`, webhook_url: `${origin}${elevenVoiceConfiguration.webhookPath}` },
    }));
    state.webhookId = result.webhook_id; state.webhookSecret = result.webhook_secret; delete state.pending; await save();
  }
  // This resource ID was created by this setup, never selected from another
  // product. The idempotent update leaves workspace event subscriptions alone.
  await request(`/v1/workspace/webhooks/${encodeURIComponent(state.webhookId)}`, "PATCH", {
    is_disabled: false, name: `${draft.name} usage`, retry_enabled: true,
  });
  const desired = buildElevenAgentConfig({ origin, voiceId: state.voiceId, secretId: state.secretId, webhookId: state.webhookId });
  if (!state.agentId) {
    state.pending = "agent"; await save();
    const result = z.object({ agent_id: z.string().min(1) }).parse(await request("/v1/convai/agents/create", "POST", desired));
    state.agentId = result.agent_id; delete state.pending; await save();
  }
  // Existing resources are verified read-only, never silently reconfigured.
  const agent = z.object({ name: z.string(), conversation_config: z.unknown(), platform_settings: z.unknown() }).parse(await request(`/v1/convai/agents/${encodeURIComponent(state.agentId)}`));
  const contains = (actual: unknown, expected: unknown): boolean => {
    if (Array.isArray(expected)) return Array.isArray(actual) && expected.length === actual.length && expected.every((item, i) => contains(actual[i], item));
    if (expected && typeof expected === "object") return !!actual && typeof actual === "object" && Object.entries(expected).every(([key, value]) => contains((actual as Record<string, unknown>)[key], value));
    return actual === expected;
  };
  if (agent.name !== desired.name || !contains(agent.conversation_config, desired.conversation_config) || !contains(agent.platform_settings, desired.platform_settings)) {
    throw new Error("The Sift agent does not match the required private callback configuration. Review provider defaults/configuration before enabling voice.");
  }
  if (!state.webhookSecret) throw new Error("The webhook signing secret is missing from setup state; recover it before enabling voice.");
  if (await readFile(envPath, "utf8") !== contents) {
    throw new Error("The selected environment file changed during setup. Provider resources were saved in recovery state; rerun to verify before updating configuration.");
  }
  for (const [key, value] of Object.entries({ ELEVENLABS_AGENT_ID: state.agentId, ELEVENLABS_LLM_SECRET: state.llmSecret, ELEVENLABS_WEBHOOK_SECRET: state.webhookSecret,
    ...(values["config-file"] ? { ELEVENLABS_CALLBACK_ORIGIN: origin } : {}),
  })) {
    const line = `${key}=${JSON.stringify(value)}`;
    const pattern = new RegExp(`^${key}=.*$`, "m");
    contents = pattern.test(contents) ? contents.replace(pattern, () => line) : `${contents.trimEnd()}\n${line}\n`;
  }
  const tempEnv = `${envPath}.elevenlabs.tmp`;
  await writeFile(tempEnv, contents, { mode: 0o600 }); await chmod(tempEnv, 0o600); await rename(tempEnv, envPath);
  console.log(`Private Sift voice agent and usage webhook verified. Configuration saved in ${basename(envPath)} and .local with private permissions. Use these credentials only with the app/database behind this callback origin. No credentials were printed.`);
}

try { await run(); }
catch (error) {
  // Zod and native network errors can contain response/credential details.
  console.error(error instanceof Error && !(error instanceof z.ZodError) && error.name === "Error" ? error.message : "ElevenLabs setup could not be verified. Inspect configuration privately; no provider payload was logged.");
  process.exitCode = 1;
}
