import "server-only";

// Change this revision whenever the generated artwork changes, including Apple
// touch icons and installed-app icons which browsers cache independently.
const iconRevision = "sift-bowl-2";

export function appIconUrl(filename: string) {
  return `${appIconDirectory()}/${filename}?v=${iconRevision}`;
}

export function appIconDirectory() {
  const deployment = process.env.VERCEL_ENV;
  if (deployment) return deployment === "production" ? "/icons" : "/icons/dev";
  let local = false;
  try { local = ["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.BETTER_AUTH_URL ?? "").hostname); } catch { /* An unconfigured production build uses the production icons. */ }
  return process.env.NODE_ENV === "development" || local ? "/icons/dev" : "/icons";
}
