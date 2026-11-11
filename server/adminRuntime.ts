import { createServer, type Server } from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import type { Express } from "express";
import { setNetworkPreparer } from "./adminSettings";

type Network = { adminPort: number; listenAddress: string };
const bind = (server: Server, settings: Network) => new Promise<void>((resolve, reject) => {
  const onError = (error: Error) => { server.removeListener("listening", onListening); reject(error); };
  const onListening = () => { server.removeListener("error", onError); resolve(); };
  server.once("error", onError);
  server.once("listening", onListening);
  server.listen(settings.adminPort, settings.listenAddress);
});
const close = (server: Server) => new Promise<void>(resolve => {
  server.close(() => resolve());
  server.closeIdleConnections();
  // Do not wait indefinitely for unrelated keepalive connections.
  setTimeout(() => server.closeAllConnections(), 1500).unref();
});

export async function startVpsListeners(app: Express, initial: Network) {
  let current = createServer(app);
  let network = initial;
  await bind(current, initial);
  setNetworkPreparer(async next => {
    const old = current;
    const oldNetwork = network;
    const samePort = next.adminPort === oldNetwork.adminPort;
    // Same-port address changes cannot bind while a wildcard listener is open.
    // server.close stops new accepts but lets the settings POST finish.
    if (samePort) { old.close(); old.closeIdleConnections(); }
    const candidate = createServer(app);
    try { await bind(candidate, next); } catch {
      if (samePort) { const restored = createServer(app); await bind(restored, oldNetwork); current = restored; }
      throw Object.assign(new Error("无法绑定新管理端口或监听地址，旧设置已保留"), { status: 400 });
    }
    return {
      commit: () => {
        current = candidate; network = next;
        setTimeout(() => { old.close(); old.closeIdleConnections(); old.closeAllConnections(); }, 2000).unref();
      },
      rollback: async () => {
        await close(candidate);
        if (samePort) { const restored = createServer(app); await bind(restored, oldNetwork); current = restored; }
      },
    };
  });
  const socketPath = process.env.EXITPANEL_ADMIN_SOCKET;
  if (socketPath) {
    await fs.mkdir(path.dirname(socketPath), { recursive: true, mode: 0o755 });
    await fs.rm(socketPath, { force: true });
    const proxy = createServer(app);
    await new Promise<void>((resolve, reject) => { proxy.once("error", reject); proxy.listen(socketPath, resolve); });
    await fs.chmod(socketPath, 0o666);
  }
  console.log(`VPS administrator listener ready on ${initial.listenAddress}:${initial.adminPort}`);
}
