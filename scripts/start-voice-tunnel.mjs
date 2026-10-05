import { accessSync, appendFileSync, closeSync, constants, fchmodSync, lstatSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { delimiter, dirname, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

// Run from any working directory. --check is local, read-only, and never starts ngrok.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const localDir = resolve(root, ".local");
const paths = Object.fromEntries(["config", "policy", "state", "log", "lock"].map((name, index) => [name,
  resolve(localDir, ["ngrok-voice.yml", "ngrok-voice-policy.yml", "ngrok-voice-state.json", "ngrok-voice.log", "ngrok-voice.lock"][index]),
]));
const target = "http://127.0.0.1:3003";
const allowedPaths = ["/api/voice/llm/chat/completions", "/api/voice/webhook"];
const config = `version: 3
agent:
  inspect_db_size: -1
  web_addr: false
  remote_management: false
  update_check: false
  console_ui: false
  log_level: info
  log_format: json
  log: stdout
`;
const policy = `on_http_request:
  - expressions:
      - "req.method != 'POST' || !(req.url.path in ['${allowedPaths.join("', '")}'])"
    actions:
      - type: custom-response
        config:
          status_code: 404
          body: Not found
          headers:
            content-type: text/plain
            cache-control: no-store
`;

class SetupError extends Error {}

function existing(path) {
  try { return lstatSync(path); }
  catch (error) {
    if (error.code === "ENOENT") return null;
    throw new SetupError("Cannot read the local tunnel configuration paths.");
  }
}

function checkPaths() {
  const directory = existing(localDir);
  if (directory && !directory.isDirectory()) throw new SetupError(".local must be a real directory, not a symbolic link.");
  for (const path of Object.values(paths)) {
    const file = existing(path);
    if (file && !file.isFile()) throw new SetupError("Tunnel configuration, state, log, and lock paths must be regular files, not symbolic links.");
  }
  try { accessSync(directory ? localDir : root, constants.W_OK | constants.X_OK); }
  catch { throw new SetupError("The local tunnel configuration directory is not writable."); }
}

function executable(path) {
  try { accessSync(path, constants.X_OK); return statSync(path).isFile(); }
  catch { return false; }
}

function findBinary() {
  const bundled = resolve(localDir, "bin/ngrok");
  if (executable(bundled)) return bundled;
  for (const directory of (process.env.PATH ?? "").split(delimiter).filter(Boolean)) {
    const candidate = resolve(directory, "ngrok");
    if (executable(candidate)) return candidate;
  }
  throw new SetupError("Install the ngrok CLI at .local/bin/ngrok or on PATH.");
}

function getToken() {
  let token;
  try { token = parseEnv(readFileSync(resolve(root, ".env.local"), "utf8")).NGROK_AUTHTOKEN?.trim(); }
  catch { throw new SetupError("Cannot read NGROK_AUTHTOKEN from .env.local; its value is never printed."); }
  if (!token || token.length > 2048 || /\s/.test(token)) throw new SetupError("Save a valid NGROK_AUTHTOKEN in .env.local; its value is never printed.");
  return token;
}

function isRunning(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 1) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) {
    if (error.code === "ESRCH") return false;
    if (error.code === "EPERM") return true;
    throw new SetupError("Cannot verify whether the recorded tunnel process is running.");
  }
}

function alreadyRunning() {
  const stateFile = existing(paths.state);
  if (stateFile) {
    let previous;
    try { previous = JSON.parse(readFileSync(paths.state, "utf8")); }
    catch { throw new SetupError("The ignored .local/ngrok-voice-state.json is unreadable. Check it before starting another tunnel."); }
    if ((previous?.status === "online" || previous?.status === "starting") && (isRunning(previous.pid) || isRunning(previous.wrapperPid))) return true;
  }
  if (existing(paths.lock)) {
    let pid;
    try { pid = Number(readFileSync(paths.lock, "utf8").trim()); }
    catch { throw new SetupError("Cannot read the local tunnel process lock."); }
    if (isRunning(pid)) return true;
    // Never race another starter by automatically removing its lock.
    throw new SetupError("A stale .local/ngrok-voice.lock remains. Verify the old tunnel has stopped, then remove that lock before starting again.");
  }
  return false;
}

function privateWrite(path, contents, exclusive = false) {
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW | (exclusive ? constants.O_EXCL : constants.O_TRUNC), 0o600);
  try { fchmodSync(fd, 0o600); writeFileSync(fd, contents); }
  finally { closeSync(fd); }
}

function start(binary, token) {
  process.umask(0o077);
  mkdirSync(localDir, { recursive: true, mode: 0o700 });
  try { privateWrite(paths.lock, `${process.pid}\n`, true); }
  catch { throw new SetupError("Another tunnel startup owns .local/ngrok-voice.lock. No second tunnel was started."); }
  process.once("exit", () => { try { unlinkSync(paths.lock); } catch { /* Preserve the exit status. */ } });
  privateWrite(paths.config, config);
  privateWrite(paths.policy, policy);
  privateWrite(paths.log, "");
  const args = ["http", target, "--config", paths.config, "--traffic-policy-file", paths.policy, "--inspect=false", "--name", "sift-voice-dev"];
  // Other app/provider credentials must not enter the child environment.
  const childEnv = Object.fromEntries(["PATH", "HOME", "TMPDIR"].filter((key) => process.env[key]).map((key) => [key, process.env[key]]));
  childEnv.NGROK_AUTHTOKEN = token;
  const child = spawn(binary, args, { cwd: root, env: childEnv, stdio: ["ignore", "pipe", "pipe"] });
  const state = { pid: child.pid, wrapperPid: process.pid, status: "starting", origin: null, target, startedAt: new Date().toISOString(), localInspection: false, allowedPaths };
  const save = () => privateWrite(paths.state, `${JSON.stringify(state, null, 2)}\n`);
  const record = (data) => appendFileSync(paths.log, `${JSON.stringify({ at: new Date().toISOString(), ...data })}\n`);
  save();

  function line(text) {
    // Never retain raw CLI output: even an authentication error can contain a
    // credential. Keep only provider error codes and validated lifecycle data.
    const codes = [...new Set(text.match(/ERR_NGROK_\d{1,8}\b/g) ?? [])];
    if (codes.length) record({ event: "ngrok.error", codes });
    let message;
    try { message = JSON.parse(text); } catch { return; }
    if (message?.msg !== "started tunnel" || typeof message.url !== "string") return;
    let url;
    try { url = new URL(message.url); } catch { /* Rejected below. */ }
    if (!url || url.protocol !== "https:" || url.username || url.password || url.port || url.pathname !== "/" || url.search || url.hash || !/^[a-z0-9-]+\.ngrok-free\.(app|dev)$/.test(url.hostname)) {
      console.error("Expected the free assigned HTTPS development domain. Stopping this new tunnel.");
      process.exitCode = 1;
      child.kill("SIGINT");
      return;
    }
    state.origin = url.origin;
    state.status = "online";
    save();
    const ready = { event: "sift.voice_tunnel_ready", origin: state.origin, localInspection: false, callbackPathsOnly: true };
    record(ready);
    console.log(JSON.stringify(ready));
  }

  for (const stream of [child.stdout, child.stderr]) createInterface({ input: stream }).on("line", line);
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { child.kill(signal); });
  child.on("error", () => {
    state.status = "failed";
    save();
    console.error("Could not start the ngrok CLI.");
    process.exitCode = 1;
  });
  child.on("exit", (code, signal) => {
    state.status = "stopped";
    Object.assign(state, { exitCode: code, signal, stoppedAt: new Date().toISOString() });
    save();
    const stopped = { event: "sift.voice_tunnel_stopped", code, signal };
    record(stopped);
    console.log(JSON.stringify(stopped));
    if (code) {
      console.error("See ignored .local/ngrok-voice.log for safe ngrok error codes.");
      process.exitCode = code;
    }
  });
}

try {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 1 || args[0] !== "--check")) throw new SetupError("Usage: node scripts/start-voice-tunnel.mjs [--check]. The upstream port is fixed at 3003.");
  checkPaths();
  const token = getToken();
  const binary = findBinary();
  const running = alreadyRunning();
  if (args[0] === "--check") {
    console.log(JSON.stringify({ event: "sift.voice_tunnel_check_ready", target, alreadyRunning: running, networkChecked: false }));
  } else {
    if (running) throw new SetupError("The recorded Sift ngrok process is already running. No second tunnel was started.");
    start(binary, token);
  }
} catch (error) {
  // Filesystem and parser exceptions can include sensitive data; emit only our
  // controlled setup messages, never the original exception or its stack.
  console.error(error instanceof SetupError ? error.message : "Could not prepare the local voice tunnel. Check access to its ignored .local files.");
  process.exitCode = 1;
}
