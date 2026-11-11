import { afterEach, describe, expect, it, vi } from "vitest";
import { deploymentInfo, resolveEntryHost } from "./deploymentInfo";

afterEach(() => vi.unstubAllEnvs());
describe("deployment VPS entry host", () => {
  it("uses the executing VPS address rather than upstream or browser address", () => {
    vi.stubEnv("EXITPANEL_RUNTIME", "vps");
    vi.stubEnv("EXITPANEL_PUBLIC_HOST", "192.220.46.24");
    expect(deploymentInfo()).toMatchObject({ runtime: "vps", entryHost: "192.220.46.24", entryHostLocked: true });
    expect(resolveEntryHost("proxy.example.test")).toBe("192.220.46.24");
  });
  it("does not override explicitly bound remote nodes", () => {
    vi.stubEnv("EXITPANEL_RUNTIME", "vps");
    vi.stubEnv("EXITPANEL_PUBLIC_HOST", "192.220.46.24");
    expect(resolveEntryHost("remote-vps.example.test", "node_remote")).toBe("remote-vps.example.test");
  });
  it("supports IPv6 deployment host", () => {
    vi.stubEnv("EXITPANEL_RUNTIME", "vps");
    vi.stubEnv("EXITPANEL_PUBLIC_HOST", "[2001:db8::1]");
    expect(resolveEntryHost("")).toBe("2001:db8::1");
  });
  it("does not invent a VPS address for managed hosting", () => {
    vi.stubEnv("EXITPANEL_RUNTIME", "managed");
    vi.stubEnv("EXITPANEL_PUBLIC_HOST", "192.220.46.24");
    expect(deploymentInfo().entryHost).toBeNull();
    expect(() => resolveEntryHost("")).toThrow("填写");
  });
  it("rejects unconfigured or non-IP local entry host", () => {
    vi.stubEnv("EXITPANEL_RUNTIME", "vps");
    vi.stubEnv("EXITPANEL_PUBLIC_HOST", "panel.example.test");
    vi.stubEnv("EXITPANEL_ENTRY_HOST", "");
    expect(() => resolveEntryHost("upstream.test")).toThrow("公网 IP");
  });
});
