# ExitPanel VPS 部署、Xray/REALITY 与本机 worker（v1.0.8）

默认在执行安装命令的 **同一台 Debian/Ubuntu VPS** 上部署面板、API、MySQL 和真实检测 worker。客户端入口使用该 VPS 的实际公网 IP，不使用面板域名或第三方 SOCKS5 的落地 IP。VPS 使用独立管理员密码登录，不需要 Manus 项目 ID、账号或 OAuth。

> v1.0.8 安装器会自动安装 Xray、生成并保护 REALITY 密钥。面板“订阅与入口”中的“生成并应用节点”会创建 VLESS/REALITY 入站和 SOCKS5/direct 出站；实际客户端端口仍需管理员放行并测试。

## 一键部署：固定 v1.0.8

需要 root、systemd、amd64/arm64 架构和可访问 GitHub/Docker 官方仓库的网络。运行网络 root 脚本前建议先下载审阅。

```bash
curl -fsSL https://raw.githubusercontent.com/shangxin913/shangxin-Proxy-Platform/v1.0.8/vps/deploy-v1.0.8.sh \
  | sudo bash -s --
```

也可以使用同标签的常规一键入口：

```bash
curl -fsSL https://raw.githubusercontent.com/shangxin913/shangxin-Proxy-Platform/v1.0.8/vps/one-click-deploy.sh \
  | sudo bash -s --
```

默认仓库固定为 `https://github.com/shangxin913/shangxin-Proxy-Platform.git`，默认版本为 **tag `v1.0.8`**，不隐式跟随 `main`。主部署器从 tag 解析完整 Git SHA，校验克隆/拉取结果，并将公开的仓库、ref、SHA 记录在安装目录的 `source-version.tsv`；重复部署同标签若发现 tag 被移动会停止。tag 尚未发布、SHA 校验失败或源码有本地修改时不会回退 `main` 或强行覆盖。

默认安装目录 `/opt/exitpanel`；使用 Docker 官方 apt 仓库与 Compose v2，保留已有 Docker 引擎，不自动卸载可能影响其他服务的冲突包。部署顺序为：安全更新源码、保存/迁移生产配置、安装并检查本机 worker、同步 URL/HMAC、启动 Compose，最后检查应用 Unix socket 与 worker 健康。

### 公网 IP 与管理入口

未显式提供 IP 时，主部署器优先用 ipify 查询当前 VPS 的实际公网 IPv4，再尝试 IPv6；无法查询时仅可沿用已有合法 IP，否则停止并要求提供 `--host`。NAT、IPv6、多 IP 或需要固定某个入口的 VPS 请显式指定：

```bash
# NAT / 多 IP
sudo bash vps/deploy-panel.sh --host 203.0.113.10

# IPv6 管理直连
sudo bash vps/deploy-panel.sh --listen :: --host 2001:db8::10
```

示例地址须替换为自己的实际公网地址。`--host` 只接受 IP，不接受域名、协议、端口或路径；可接受带方括号的 IPv6，保存时规范化。显式 IP 始终优先。实际 IP 同步到 `.env.production` 的 `EXITPANEL_ENTRY_HOST` 和 `EXITPANEL_PUBLIC_HOST`；面板域名仅用于 HTTPS 管理 URL，不会充当客户端 `entryHost`。

无域名时不安装/启用 Nginx，app 用宿主网络，初始管理监听 `0.0.0.0:8899`。首次生成随机管理路径（24 位十六进制）与强密码（48 位十六进制）；URL 形如 `http://公网IP:8899/<随机路径>`，不是固定公开 `/admin`。安装成功后 root 终端显示数据库中的当前 URL 和密码。

HTTP 不加密管理通信。随机路径不能代替 TLS；生产环境请用域名 HTTPS、可信 VPN/SSH 隧道或限制可信源 IP。

### 可选域名 HTTPS

先将 DNS 指向本机，在现有防火墙和安全组核对 80/443：

```bash
curl -fsSL https://raw.githubusercontent.com/shangxin913/shangxin-Proxy-Platform/v1.0.8/vps/deploy-v1.0.8.sh \
  | sudo bash -s -- --domain panel.example.com --email admin@example.com
```

提供 `--domain` 才配置 Nginx，提供 `--email` 才申请 Let's Encrypt。证书申请失败会明确警告，没有证书时仍是 HTTP；升级会沿用已有证书。Nginx upstream 始终为 `/run/exitpanel/app.sock`，不依赖可变管理端口，也不转发 worker 接口。socket 目录 root 所有、`0755`，Node 创建 socket 并设为 `0666`，tmpfiles/systemd 在重启后恢复目录。

域名管理 URL 形如 `https://panel.example.com/<随机路径>`。面板内可将管理监听改为 `127.0.0.1`，关闭公网直连而保留 Unix socket 域名访问。`EXITPANEL_PUBLIC_ORIGIN=https://panel.example.com` 可描述已有可信外部 TLS 代理，必须为不含路径的完整 origin；不会自动申请外部证书或修改 DNS。即使使用域名，客户端入口仍写入真实 VPS IP。

### 参数与可选跳过 worker

```bash
bash vps/deploy-panel.sh --help
bash vps/one-click-deploy.sh --help
bash vps/deploy-v1.0.8.sh --help
```

主部署器支持 `--repo`、`--branch`（默认 tag `v1.0.8`）、`--dir`、`--port`、`--listen`、`--host`、`--domain`、`--email`、`--skip-worker`、`--replace-worker`。`--port`/`--listen` 只作为首次数据库初始化值；已有管理端口、监听、路径、密码以数据库为准，重复部署不会覆盖。

`--branch` 显式选择其他版本时，一键入口同时下载该版本的部署器并选择该版本源码；版本形如 `v1.0.6` 时主部署器要求它是真正的 tag。`--repo` 使用其他 GitHub HTTPS 仓库时，下载地址自动对应同仓库和版本；其他仓库需提供可信 HTTPS `EXITPANEL_INSTALLER_URL`。常规一键入口也支持显式 `EXITPANEL_BRANCH`/`EXITPANEL_REPO_URL`；固定 `deploy-v1.0.8.sh` 入口始终以 v1.0.8 为默认，除非命令行显式 `--branch`。

`--skip-worker` 只跳过本机安装/接入，不清空已有远程 worker 配置。**未另配可用的真实 worker 时，真实检测不可用，不会模拟成功。** 选择缺少同机接入工具的旧版本时需显式跳过。已有非 loopback/远程 worker 配置时，默认接入流程报冲突停止；只有明确 `--replace-worker` 才允许改成本机 worker。

## 已有 v1.0.4 VPS：root 快修接入 worker

快修不重装数据库、不运行数据库迁移，不更换管理密码，只安装/修复 worker 并同步配置、重建 app，适合旧面板提示“尚未接入 worker”的情况。v1.0.4 已有真实 SOCKS5 检测调用契约；自动入口表单与本机直出等新应用能力仍需完整升级 v1.0.6。

```bash
curl -fsSL https://raw.githubusercontent.com/shangxin913/shangxin-Proxy-Platform/v1.0.6/vps/repair-worker-v1.0.6.sh \
  | sudo bash -s --

# 自定义目录 / NAT 地址
# ... | sudo bash -s -- --dir /opt/exitpanel --host 203.0.113.10
```

若已完整下载 v1.0.6 源码，也可直接：

```bash
sudo bash vps/connect-local-worker.sh
sudo bash vps/connect-local-worker.sh --dir /opt/exitpanel --host 203.0.113.10
bash vps/connect-local-worker.sh --help

# 只有确认不再使用远程 worker 后才显式替换：
sudo bash vps/connect-local-worker.sh --replace-worker
```

`connect-local-worker.sh` 从自身 `SCRIPT_DIR` 使用同版本的 `install.sh`、`agent.py`、`xray_config.py`、`exitpanel-apply`，不能只下载 connect 单文件再混用旧安装器。远程快修入口下载这五个同标签文件后调用 connect。

默认路径从 root 配置 `/etc/exitpanel/install-dir` 读取，记录不存在则用 `/opt/exitpanel`；`--dir` 可指定路径，但本机固定 worker、全局 CLI 与 Compose 服务**只允许一个面板**。已有目录归属与指定目录冲突时停止，不会夺取另一个面板的 worker。

快修先进行远程 worker/目录/IP 冲突检查，再调用同目录安装器并确认 worker 健康；安全地将 `/etc/exitpanel/agent.env` 的旧 HMAC 同步到目标 `.env.production`，保留其他变量、数据库密码与旧密钥，不 `source` 任何 dotenv，也不在终端输出 secret。已有有效 `EXITPANEL_PUBLIC_HOST` IP 会保留；旧值是域名或 IP 缺失时自动查询实际 IP，找不到则停止。显式 `--host` 始终优先，同时写入 `EXITPANEL_ENTRY_HOST`。

默认运行 `docker compose ... up -d app`，等待 `/run/exitpanel/app.sock` 的 `/api/health` 和 worker `/health` 都成功。`--configure-only` 是主部署器使用的模式：只安装/检查 worker 和同步配置，**不重启 app**，应用健康检查留给主部署器。

## worker 安装、健康与服务保护

只安装 worker（不会自动配置现有面板）：

```bash
sudo bash vps/install.sh
sudo systemctl status exitpanel-agent
curl --noproxy '*' http://127.0.0.1:18443/health
```

安装器需要 Linux、root、systemd、Python 3、curl、ca-certificates、openssl 和 sudo/visudo；缺失时从 apt 补装，包括 `sudo`。创建无交互 shell 的 `exitpanel-agent` 系统用户，文件安装到 `/opt/exitpanel-agent`，root 配置为 `/etc/exitpanel/agent.env`（root:root `0600`），保留旧 `AGENT_SHARED_SECRET` 和 REALITY 配置；旧密钥为空时停止，不会无声换一把。

默认监听 `127.0.0.1:18443`。`AGENT_HOST` **只允许** `localhost`、`127.0.0.1` 或 `::1`，其他值会拒绝安装；`AGENT_PORT` 可为 1–65535。健康检查和同步 URL 使用实际 host/port，IPv6 URL 正确加方括号，不固定假定 18443，也不经过代理变量。

重装执行 daemon-reload、enable 与 **restart**，确保新 worker 代码生效。systemd 的 `ReadWritePaths` 允许 `/run/exitpanel-agent` 临时文件、`/var/lib/exitpanel-agent` 持久计划以及 root helper 的 Xray配置目录，其余文件系统维持严格保护。helper 使用 root 所有的脚本及窄范围 NOPASSWD sudoers，先经 visudo 校验；为允许该受限 sudo helper 提权，服务不设置 `NoNewPrivileges=yes`。不把安装目录或 worker API 暴露给 Nginx。

worker API 使用带时间戳的 HMAC-SHA256：签名内容为 `timestamp + 换行 + 原始 JSON body`，请求头 `X-ExitPanel-Timestamp` 和 `X-ExitPanel-Signature`。真实 SOCKS5 检测为 `POST /v1/check`，配置应用为 `POST /v1/config/apply`；密钥只由面板服务端使用，不发送给客户端。面板 app 已是 `network_mode: host`，所以 loopback worker 可从容器直接访问，不需要公开 18443 或额外端口映射。

## root 查看入口、恢复密码与保留数据

```bash
sudo exitpanel credentials
sudo exitpanel reset-password
sudo exitpanel --help
```

`/usr/local/bin/exitpanel` 除帮助外仅 root 可执行。CLI 通过当前 app 与数据库读取当前管理入口、可恢复密码；reset-password 生成新密码并作废旧会话，bootstrap 仅初始化缺失设置。不要分享凭据输出。

管理端口、监听、路径、密码在数据库持久保存，以数据库为准，`.env.production` 的初始密码可能已经过期。修改管理端口后同步防火墙/安全组；监听改为 loopback 不影响 Nginx Unix socket。

安装目录从创建时就是 root `0700`，生产配置 root:root `0600`。旧环境缺失必要 MySQL 密码或会话密钥时停止，避免为旧数据库换密码。保留 `MANUS_JWT_SECRET`、`CREDENTIAL_ENCRYPTION_KEY` 和其他敏感凭据；旧版没有独立加密密钥时沿用有效的 `MANUS_JWT_SECRET`，不得另生成导致历史凭据无法解密。dotenv 重复变量、多行值或歧义配置被拒绝，不作为 shell 执行。

源码仅允许干净状态的安全 fast-forward；浅克隆先补全历史，拒绝分叉/降级，不 `reset --hard` 或删除源码。重复使用相同安装目录和 Compose 项目，保留 `exitpanel_mysql` 卷；**不要执行 `docker compose down -v`、删除卷或更换旧数据库密码**。升级前同时备份 MySQL、`.env.production`、`agent.env` 与自定义 Nginx 配置，放在受保护位置，不加入 Git。

```bash
sudo systemctl status exitpanel-compose
sudo systemctl status exitpanel-agent
cd /opt/exitpanel
# 分享日志前遮蔽凭据：
sudo docker compose --env-file .env.production -f docker-compose.prod.yml logs -f app
sudo journalctl -u exitpanel-agent -n 80 --no-pager
```

## Xray、真实代理与多 VPS

worker 将临时 Xray 配置写到 `/run/exitpanel-agent/xray-next.json`，再由 `/usr/local/sbin/exitpanel-apply` 做 JSON/Xray 校验、备份、原子替换与 reload；失败恢复旧配置。有效计划保存在 `/var/lib/exitpanel-agent/plan.json`，每 30 秒清理到期入口并重新应用。

v1.0.8 会通过固定提交的官方 Xray 安装器安装 `/usr/local/bin/xray`，在 `/usr/local/etc/xray/config.json` 建立受限配置，并生成 REALITY_PRIVATE_KEY、REALITY_PUBLIC_KEY、REALITY_SHORT_ID、REALITY_SERVER_NAME 和 REALITY_DEST。检测通过后，在面板“订阅与入口”点击“生成并应用节点”，生成器按每个出口建立 VLESS/REALITY 入站和 SOCKS5/direct 出站；订阅会携带 pbk、sid、sni、fp 和 Vision flow。

多 VPS 节点可保存 endpoint、worker 端口、HMAC、direct/reverse 隧道模式和公开入口地址，出口用 nodeId 绑定节点；远程节点入口不强制改为面板本机 IP。跨机 worker 应用可信内网/隧道，不将本机安装器的 worker 监听改成公网。反向隧道模板见 [reverse-tunnel.service.example](./reverse-tunnel.service.example)，使用前固定 SSH host key、专用密钥、限制转发目标与防火墙，不开放任意 GatewayPorts。

## 防火墙边界

安装器 **不修改/启用 UFW，不自动放行 SSH**，避免锁定现有管理连接。在主机防火墙与服务商安全组按真实需求配置：无域名管理端口初始 8899/tcp（建议限制可信来源），域名 HTTP/证书申请 80/tcp、HTTPS 443/tcp。Xray/VLESS 入站仅开放实际使用端口，不整段放行。

MySQL 仅映射 `127.0.0.1:${DB_PORT:-13306}`，worker 仅 loopback（默认 18443）；**两者都不要向公网开放**。部署和快修不公开 worker、不代理其 API、不开放 Nginx root 安装目录，也不自动配置公网数据面。
