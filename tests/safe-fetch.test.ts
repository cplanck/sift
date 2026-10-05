import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Test-only network adapters. Production always uses DNS and a real pinned socket.
const network = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: network.lookup }));
vi.mock("node:http", () => ({ request: network.request }));
vi.mock("node:https", () => ({ request: network.request }));

import { fetchRecipeUrl, isPublicAddress, validateImportUrl } from "@/lib/safe-fetch";

type Address = { address: string; family: number };
type RequestOptions = {
  family: number;
  headers: Record<string, string>;
  lookup: (host: string, options: { all?: boolean }, callback: (error: null, address: Address[] | string, family?: number) => void) => void;
};
type Scenario = { status?: number; headers?: Record<string, string>; body?: string };

function serve(...scenarios: Scenario[]) {
  for (const scenario of scenarios) network.request.mockImplementationOnce((_url: URL, _options: RequestOptions, onResponse: (response: PassThrough) => void) => {
    const request = Object.assign(new EventEmitter(), {
      end() {
        const response = Object.assign(new PassThrough(), { statusCode: scenario.status ?? 200, headers: { "content-type": "text/html", ...scenario.headers } });
        response.once("close", () => request.emit("close"));
        response.once("end", () => request.emit("close"));
        onResponse(response);
        response.end(scenario.body ?? "<main>Recipe</main>");
      },
      destroy(error?: Error) { if (error) request.emit("error", error); request.emit("close"); return request; },
    });
    return request;
  });
}

beforeEach(() => { vi.resetAllMocks(); network.lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]); });

describe("recipe URL SSRF boundary", () => {
  it("rejects non-public IPv4, IPv6, and IPv4-mapped IPv6 addresses", () => {
    for (const address of ["127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255", "192.0.2.1", "198.51.100.1", "203.0.113.1", "::", "::1", "fe80::1", "fc00::1", "ff02::1", "2001:db8::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "not-an-address"]) {
      expect(isPublicAddress(address), address).toBe(false);
    }
    for (const address of ["1.1.1.1", "93.184.216.34", "2606:4700:4700::1111", "::ffff:1.1.1.1"]) expect(isPublicAddress(address), address).toBe(true);
  });

  it("normalizes encoded IPv4 forms before rejecting private URLs", () => {
    for (const input of ["http://127.1/", "http://2130706433/", "http://0x7f000001/", "http://0177.0.0.1/", "http://[::1]/", "http://[::ffff:127.0.0.1]/", "http://localhost/", "http://app.localhost/", "http://device.local/", "file:///etc/passwd", "ftp://example.com/recipe", "https://user:password@example.com/", "https://example.com:8443/", "invalid"]) {
      expect(() => validateImportUrl(input), input).toThrow();
    }
    expect(validateImportUrl("HTTPS://EXAMPLE.COM:443/recipe").href).toBe("https://example.com/recipe");
  });

  it("rejects a hostname if any resolved address is private, before opening a socket", async () => {
    network.lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }, { address: "::ffff:169.254.169.254", family: 6 }]);
    await expect(fetchRecipeUrl("https://example.com/recipe")).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(network.request).not.toHaveBeenCalled();
    network.lookup.mockResolvedValue([]);
    await expect(fetchRecipeUrl("https://empty.example/recipe")).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("pins the vetted DNS result on the real request lookup contract", async () => {
    serve({ body: "<main>Safe recipe</main>" });
    expect(await fetchRecipeUrl("https://example.com/recipe")).toEqual({ html: "<main>Safe recipe</main>", url: "https://example.com/recipe" });
    const options = network.request.mock.calls[0][1] as RequestOptions;
    expect(options.headers["Accept-Encoding"]).toBe("identity");
    const callback = vi.fn();
    options.lookup("example.com", {}, callback);
    expect(callback).toHaveBeenLastCalledWith(null, "93.184.216.34", 4);
    options.lookup("example.com", { all: true }, callback);
    expect(callback).toHaveBeenLastCalledWith(null, [{ address: "93.184.216.34", family: 4 }]);
    expect(network.lookup).toHaveBeenCalledTimes(1);
  });

  it("revalidates redirect targets and never requests internal redirect destinations", async () => {
    serve({ status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" } });
    await expect(fetchRecipeUrl("https://example.com/recipe")).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(network.request).toHaveBeenCalledTimes(1);
  });

  it("resolves relative public redirects and bounds redirect chains", async () => {
    serve({ status: 301, headers: { location: "/recipe" } }, { body: "Final recipe" });
    expect(await fetchRecipeUrl("https://example.com/start")).toEqual({ html: "Final recipe", url: "https://example.com/recipe" });
    network.request.mockClear();
    serve(...Array.from({ length: 4 }, () => ({ status: 302, headers: { location: "/again" } })));
    await expect(fetchRecipeUrl("https://example.com/start")).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(network.request).toHaveBeenCalledTimes(4);
  });

  it("rejects compressed, non-HTML, failed, and oversized source responses", async () => {
    const scenarios: Scenario[] = [{ headers: { "content-encoding": "gzip" } }, { headers: { "content-type": "application/json" } }, { status: 500 }, { body: "x".repeat(2_000_001) }];
    for (const scenario of scenarios) {
      serve(scenario);
      await expect(fetchRecipeUrl("https://example.com/recipe")).rejects.toMatchObject({ code: "INVALID_INPUT" });
    }
  });

  it("bounds a stalled DNS lookup within the overall fetch deadline", async () => {
    vi.useFakeTimers();
    try {
      network.lookup.mockImplementation(() => new Promise(() => {}));
      const rejected = expect(fetchRecipeUrl("https://example.com/recipe")).rejects.toMatchObject({ code: "INVALID_INPUT" });
      await vi.advanceTimersByTimeAsync(12001);
      await rejected;
      expect(network.request).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
});
