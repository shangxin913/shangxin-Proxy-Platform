import { describe, expect, it } from "vitest";
import { checkForUpdate } from "./updateService";

describe("release update policy", () => {
  it("has a fixed current release and never follows a branch", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({ tag_name: "v1.0.12", html_url: "https://github.com/shangxin913/shangxin-Proxy-Platform/releases/tag/v1.0.12" }), { status: 200 })) as typeof fetch;
    const result = await checkForUpdate();
    expect(result.current).toBe("v1.0.11");
    expect(result.latest).toBe("v1.0.12");
    expect(result.updateAvailable).toBe(true);
    expect(result.releaseUrl).toContain("/releases/tag/v1.0.12");
    globalThis.fetch = original;
  });
});
