import { Inngest } from "inngest";
import { env, requireConfig } from "@/lib/env";

const config = env();
export const inngest = new Inngest({ id: "sift", eventKey: config.INNGEST_EVENT_KEY, signingKey: config.INNGEST_SIGNING_KEY, isDev: config.NODE_ENV !== "production" && config.INNGEST_DEV === "1", checkpointing: { maxRuntime: "110s" }, aiMetadata: false });
export function requireJobs() {
  const config = env();
  if (config.NODE_ENV !== "production" && config.INNGEST_DEV === "1") return;
  requireConfig(["INNGEST_EVENT_KEY", "INNGEST_SIGNING_KEY"]);
}
