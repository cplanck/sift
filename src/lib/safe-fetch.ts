import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";
import { DomainError } from "@/domain/errors";

export function isPublicAddress(address: string) {
  try { return ipaddr.process(address).range() === "unicast"; } catch { return false; }
}
export function validateImportUrl(input: string) {
  let url: URL;
  try { url = new URL(input); } catch { throw new DomainError("INVALID_INPUT", "Enter a valid recipe URL."); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.port || url.hostname === "localhost" || url.hostname.endsWith(".localhost") || url.hostname.endsWith(".local")) throw new DomainError("INVALID_INPUT", "Use a public HTTP or HTTPS recipe URL on its standard port.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) && !isPublicAddress(host)) throw new DomainError("INVALID_INPUT", "Private network URLs cannot be imported.");
  return url;
}

export async function fetchRecipeUrl(input: string, redirects = 0, deadline = Date.now() + 12000): Promise<{ html: string; url: string }> {
  if (redirects > 3) throw new DomainError("INVALID_INPUT", "This URL redirects too many times. Paste the recipe instead.");
  const url = validateImportUrl(input);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  let dnsTimer: ReturnType<typeof setTimeout> | undefined;
  const addresses = await Promise.race([
    isIP(host) ? Promise.resolve([{ address: host, family: isIP(host) }]) : lookup(host, { all: true }),
    new Promise<never>((_, reject) => { dnsTimer = setTimeout(() => reject(new DomainError("INVALID_INPUT", "This website took too long to respond. Paste its recipe text instead.")), Math.max(1, deadline - Date.now())); }),
  ]).finally(() => clearTimeout(dnsTimer));
  if (!addresses.length || addresses.some((item) => !isPublicAddress(item.address))) throw new DomainError("INVALID_INPUT", "Private network URLs cannot be imported.");
  const address = addresses[0];
  // Pin the vetted address for the actual socket: re-resolving here would allow DNS rebinding.
  const response = await new Promise<{ body: string; location?: string }>((resolve, reject) => {
    const send = url.protocol === "https:" ? httpsRequest : httpRequest;
    const request = send(url, {
      headers: { "User-Agent": "SiftRecipeImporter/1.0", Accept: "text/html,application/xhtml+xml", "Accept-Encoding": "identity" },
      family: address.family,
      lookup: (_hostname, options, callback) => {
        if (typeof options === "object" && options.all) callback(null, [address]);
        else callback(null, address.address, address.family);
      },
    }, (response) => {
      if (response.statusCode && [301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) { response.destroy(); resolve({ body: "", location: response.headers.location }); return; }
      if (response.statusCode !== 200 || !/text\/html|application\/xhtml\+xml/i.test(response.headers["content-type"] ?? "") || (response.headers["content-encoding"] && response.headers["content-encoding"] !== "identity")) {
        response.destroy(); reject(new DomainError("INVALID_INPUT", "This page could not be read. Paste its recipe text instead.")); return;
      }
      const chunks: Buffer[] = []; let size = 0;
      response.on("data", (chunk: Buffer) => { size += chunk.length; if (size > 2_000_000) { request.destroy(); reject(new DomainError("INVALID_INPUT", "This page is too large. Paste the recipe text instead.")); } else chunks.push(chunk); });
      response.on("end", () => resolve({ body: Buffer.concat(chunks).toString("utf8") }));
      response.on("error", reject);
    });
    const timeout = setTimeout(() => request.destroy(new DomainError("INVALID_INPUT", "This website took too long to respond. Paste its recipe text instead.")), Math.max(1, deadline - Date.now()));
    request.on("close", () => clearTimeout(timeout));
    request.on("error", reject); request.end();
  });
  if (response.location) return fetchRecipeUrl(new URL(response.location, url).href, redirects + 1, deadline);
  return { html: response.body, url: url.href };
}
