import { Buffer } from "node:buffer";
import type { Exit } from "../drizzle/schema";

type SubscriptionExit = Omit<Exit, "passwordEncrypted">;
const realityServerName = () => process.env.EXITPANEL_REALITY_SERVER_NAME || "www.microsoft.com";

function nodeName(exit: SubscriptionExit) {
  const area = exit.observedCountry || exit.expectedCountry || "地区待验证";
  const city = exit.observedCity || exit.expectedCity;
  return city ? `${area} · ${city} · ${exit.displayName}` : `${area} · ${exit.displayName}`;
}

function vlessLink(exit: SubscriptionExit) {
  const publicKey = process.env.EXITPANEL_REALITY_PUBLIC_KEY || "";
  const shortId = process.env.EXITPANEL_REALITY_SHORT_ID || "";
  const serverName = realityServerName();
  const params = new URLSearchParams({
    encryption: "none",
    security: exit.entrySecurity.toLowerCase(),
    type: "tcp",
    sni: serverName,
    fp: "chrome",
    flow: "xtls-rprx-vision",
  });
  if (publicKey) params.set("pbk", publicKey);
  if (shortId) params.set("sid", shortId);
  params.set("spx", "/");
  return `vless://${exit.entryUuid}@${exit.entryHost}:${exit.entryPort}?${params.toString()}#${encodeURIComponent(nodeName(exit))}`;
}

export function makeSubscription(exits: SubscriptionExit[]) {
  const now = Date.now();
  const active = exits.filter((exit) => exit.enabled && exit.subscribeEnabled && exit.status === "passed" && (!exit.expiresAt || exit.expiresAt.getTime() > now));
  const vless = active.map(vlessLink);
  const base64 = Buffer.from(vless.join("\n"), "utf8").toString("base64");
  const clash = {
    proxies: active.map((exit) => ({
      name: nodeName(exit),
      type: "vless",
      server: exit.entryHost,
      port: exit.entryPort,
      uuid: exit.entryUuid,
      tls: true,
      servername: realityServerName(),
      "reality-opts": { "public-key": process.env.EXITPANEL_REALITY_PUBLIC_KEY || "", "short-id": process.env.EXITPANEL_REALITY_SHORT_ID || "" },
      flow: "xtls-rprx-vision",
      network: "tcp",
      udp: false,
      "skip-cert-verify": false,
    })),
    "proxy-groups": [{ name: "ExitPanel", type: "select", proxies: active.map(nodeName) }],
    rules: ["MATCH,ExitPanel"],
  };
  return { activeCount: active.length, vless, base64, clash };
}
