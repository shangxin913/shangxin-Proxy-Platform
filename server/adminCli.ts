import "dotenv/config";
import { getAdminSettings, getLocalAdminUser, managementUrl, resetAdminPassword, rootVisiblePassword } from "./adminSettings";
import { isVps } from "./adminSecurity";

async function main() {
  if (!isVps()) throw new Error("此命令仅用于 VPS 安装；托管网站请通过管理员设置初始化密码");
  const command = process.argv[2] || "credentials";
  if (!["bootstrap", "credentials", "reset-password"].includes(command)) throw new Error("用法：exitpanel credentials | reset-password");
  const row = await getAdminSettings();
  await getLocalAdminUser();
  if (command === "bootstrap") { console.log("Administrator initialization complete; existing settings preserved."); return; }
  const password = command === "reset-password" ? await resetAdminPassword() : rootVisiblePassword(row);
  console.log(`管理地址：${managementUrl(await getAdminSettings())}`);
  console.log(`管理端口：${row.adminPort}`);
  console.log(`监听地址：${row.listenAddress}`);
  console.log(`管理密码：${password ?? "无法恢复，请运行 exitpanel reset-password"}`);
  if (["127.0.0.1", "::1", "localhost"].includes(row.listenAddress)) console.log("提示：当前仅本机可访问，请使用 SSH 隧道。");
}
main().then(() => process.exit(0)).catch(error => { console.error(error instanceof Error ? error.message : "Administrator command failed"); process.exit(1); });
