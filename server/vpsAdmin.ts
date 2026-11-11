export type VpsAdminStatus = {
  configured: boolean;
  url: string | null;
  port: number;
  status: "online" | "offline" | "not_configured";
  detail: string;
};

function getConfiguredUrl() {
  const raw = process.env.EXITPANEL_VPS_ADMIN_URL?.trim();
  if (!raw) return null;
  const url = new URL(raw);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("EXITPANEL_VPS_ADMIN_URL 必须是无凭据的 HTTP(S) 地址");
  }
  return url.toString().replace(/\/$/, "");
}

export async function getVpsAdminStatus(): Promise<VpsAdminStatus> {
  const port = Number(process.env.EXITPANEL_VPS_ADMIN_PORT || "8899");
  const url = getConfiguredUrl();
  if (!url) {
    return { configured: false, url: null, port: Number.isInteger(port) ? port : 8899, status: "not_configured", detail: "尚未配置 EXITPANEL_VPS_ADMIN_URL" };
  }
  try {
    const response = await fetch(url, { method: "GET", redirect: "error", signal: AbortSignal.timeout(5000) });
    return { configured: true, url, port: Number.isInteger(port) ? port : 8899, status: response.ok ? "online" : "offline", detail: response.ok ? "管理面板可访问" : `HTTP ${response.status}` };
  } catch (error) {
    return { configured: true, url, port: Number.isInteger(port) ? port : 8899, status: "offline", detail: error instanceof Error ? "无法连接管理面板" : "管理面板不可达" };
  }
}
