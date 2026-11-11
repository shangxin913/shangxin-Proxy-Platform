import { afterEach, describe, expect, it, vi } from "vitest";
import { checkDirectWorker, checkWorker, validateWorkerUrl } from "./workerClient";

const config = { baseUrl: "https://worker.example.test", secret: "unit-test-shared-secret-not-a-production-secret" };

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("production worker transport", () => {
  it("rejects public HTTP worker endpoints", () => {
    expect(() => validateWorkerUrl("http://worker.example.test:18443")).toThrow("HTTPS");
  });
  it("allows HTTPS and same-host loopback HTTP", () => {
    expect(validateWorkerUrl(config.baseUrl)).toBe(config.baseUrl);
    expect(validateWorkerUrl("http://127.0.0.1:18443")).toBe("http://127.0.0.1:18443");
  });
  it("does not fabricate a passed result when worker is missing", async () => {
    vi.stubEnv("EXITPANEL_WORKER_URL", "");
    vi.stubEnv("EXITPANEL_WORKER_SHARED_SECRET", "");
    await expect(checkWorker({ host: "proxy.example.test", port: 1080 })).rejects.toThrow("尚未接入");
  });
  it("accepts real valid worker data and forbids redirecting credentials", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: "passed", observedIp: "203.0.113.10", latencyMs: 25 }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    await expect(checkWorker({ host: "proxy.example.test", port: 1080 }, config)).resolves.toMatchObject({ status: "passed", observedIp: "203.0.113.10" });
    expect(fetch.mock.calls[0][1]).toMatchObject({ redirect: "error", method: "POST" });
    expect(fetch.mock.calls[0][1].headers["x-exitpanel-signature"]).toBeTruthy();
  });
  it("rejects passed responses with no real IP address", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: "passed", observedIp: "not-an-ip" }), { status: 200 })));
    await expect(checkWorker({ host: "proxy.example.test", port: 1080 }, config)).rejects.toThrow("无效");
  });
  it("negotiates direct-check capability before executing a signed probe", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, capabilities: ["direct-check"] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "passed", observedIp: "203.0.113.20" })));
    vi.stubGlobal("fetch", fetch);
    await expect(checkDirectWorker(config)).resolves.toMatchObject({ status: "passed", observedIp: "203.0.113.20" });
    expect(fetch.mock.calls[1][1].body).toBe('{"type":"direct"}');
  });
  it("does not treat old SOCKS5-only workers as supporting direct checks", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, capabilities: ["socks5-check"] })));
    vi.stubGlobal("fetch", fetch);
    await expect(checkDirectWorker(config)).rejects.toThrow("升级");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
