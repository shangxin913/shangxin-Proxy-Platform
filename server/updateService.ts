import http from "node:http";

const REPO = "shangxin913/shangxin-Proxy-Platform";
const CURRENT = "v1.0.9";
const VERSION = /^v\d+\.\d+\.\d+$/;
function versionValue(value: string) { return value.replace(/^v/, "").split(".").map(Number); }
function newer(a: string, b: string) { const x = versionValue(a), y = versionValue(b); return x.some((n, i) => n !== y[i] && n > y[i]); }

export type UpdateInfo = { current: string; latest: string; updateAvailable: boolean; releaseUrl: string; publishedAt?: string; body?: string; installAvailable: boolean; status?: string; message?: string };

export async function checkForUpdate(): Promise<UpdateInfo> {
  const response = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { accept: "application/vnd.github+json", "user-agent": "ExitPanel-update-check" }, signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`GitHub release 检查失败（${response.status}）`);
  const release = await response.json() as { tag_name?: string; html_url?: string; published_at?: string; body?: string };
  const latest = release.tag_name || CURRENT;
  if (!VERSION.test(latest)) throw new Error("GitHub 返回的版本标签无效");
  return { current: CURRENT, latest, updateAvailable: newer(latest, CURRENT), releaseUrl: release.html_url || `https://github.com/${REPO}/releases`, publishedAt: release.published_at, body: release.body, installAvailable: process.env.EXITPANEL_RUNTIME === "vps" && process.env.EXITPANEL_UPDATE_SOCKET !== "disabled" };
}

function localRequest(method: string, path: string, body?: unknown): Promise<any> {
  return new Promise((resolve, reject) => {
    const socketPath = process.env.EXITPANEL_UPDATE_SOCKET || "/run/exitpanel/update.sock";
    const payload = body === undefined ? "" : JSON.stringify(body);
    const request = http.request({ socketPath, path, method, headers: { "content-type": "application/json", "content-length": Buffer.byteLength(payload) }, timeout: 5000 }, response => { let data = ""; response.on("data", chunk => { data += chunk; }); response.on("end", () => { try { const parsed = JSON.parse(data); if ((response.statusCode || 500) >= 400) reject(new Error(parsed.error || `更新服务错误（${response.statusCode}）`)); else resolve(parsed); } catch { reject(new Error("更新服务返回无效数据")); } }); }); request.on("timeout", () => request.destroy(new Error("更新服务响应超时"))); request.on("error", reject); if (payload) request.write(payload); request.end(); });
}

export async function startUpdate(version: string) { if (!VERSION.test(version)) throw new Error("版本标签无效"); return localRequest("POST", "/update", { version }); }
export async function updateStatus() { return localRequest("GET", "/status"); }
