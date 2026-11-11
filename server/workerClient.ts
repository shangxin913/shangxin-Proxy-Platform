import { isIP } from "node:net";
import { signWorkerRequest } from "./workerAuth";

export type WorkerConfig = { baseUrl: string; secret: string };
export type WorkerCheckResult = {
  status: "passed" | "failed";
  observedIp?: string;
  country?: string;
  city?: string;
  latencyMs?: number;
  errorCode?: string;
  errorMessage?: string;
};

export function validateWorkerUrl(baseUrl: string) {
  const url = new URL(baseUrl);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && local)) || url.username || url.password || url.search || url.hash) {
    throw new Error("外部 VPS worker 必须使用有效的 HTTPS 地址；HTTP 仅允许本机 loopback");
  }
  return url.toString().replace(/\/$/, "");
}

function envWorkerConfig(): WorkerConfig {
  const baseUrl = process.env.EXITPANEL_WORKER_URL;
  const secret = process.env.EXITPANEL_WORKER_SHARED_SECRET;
  if (!baseUrl || !secret) throw new Error("尚未接入 VPS worker，请配置 HTTPS 地址和共享密钥");
  return { baseUrl: validateWorkerUrl(baseUrl), secret };
}

async function workerPost<T>(config: WorkerConfig, path: string, payload: unknown): Promise<T> {
  const baseUrl = validateWorkerUrl(config.baseUrl);
  const body = JSON.stringify(payload);
  const { timestamp, signature } = signWorkerRequest(config.secret, body);
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-exitpanel-timestamp": timestamp, "x-exitpanel-signature": signature },
    body,
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`worker_http_${response.status}`);
  return data as T;
}

export async function checkWorker(payload: { host: string; port: number; username?: string; password?: string }, config?: WorkerConfig): Promise<WorkerCheckResult> {
  const result = await workerPost<WorkerCheckResult>(config ?? envWorkerConfig(), "/v1/check", payload);
  if (!["passed", "failed"].includes(result.status) || (result.status === "passed" && (!result.observedIp || !isIP(result.observedIp)))) {
    throw new Error("worker 返回了无效的真实检测结果");
  }
  return result;
}

export function applyWorkerXray(config: WorkerConfig, entries: unknown[]) {
  return workerPost<{ status: string; sha256?: string; errorMessage?: string }>(config, "/v1/config/apply", { entries });
}

export function applyConfiguredWorkerXray(entries: unknown[]) {
  return applyWorkerXray(envWorkerConfig(), entries);
}

export async function workerHealth() {
  const config = envWorkerConfig();
  const response = await fetch(`${config.baseUrl}/health`, { redirect: "error", signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error(`worker_http_${response.status}`);
  return response.json() as Promise<{ ok: boolean; service: string; capabilities?: string[] }>;
}
