import { isIP } from "node:net";
import { isVps } from "./adminSecurity";

export function deploymentInfo() {
  const host = (process.env.EXITPANEL_ENTRY_HOST || process.env.EXITPANEL_PUBLIC_HOST || "").replace(/^\[|\]$/g, "");
  const localVps = isVps();
  return {
    runtime: localVps ? "vps" as const : "managed" as const,
    entryHost: localVps && isIP(host) ? host : null,
    entryHostLocked: localVps,
    workerTransport: localVps ? "本机 loopback 或已配置远程 HTTPS" : "外部 VPS HTTPS",
  };
}

export function resolveEntryHost(input: string | undefined, nodeId?: string | null) {
  const deployment = deploymentInfo();
  if (deployment.runtime === "vps" && !nodeId) {
    if (!deployment.entryHost) throw new Error("未配置部署 VPS 的公网 IP，请使用安装命令 --host 公网IP 后重试");
    return deployment.entryHost;
  }
  if (!input || !input.trim()) throw new Error("请填写执行代理服务的 VPS IP 或域名");
  return input.trim();
}
