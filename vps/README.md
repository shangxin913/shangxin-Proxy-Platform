# ExitPanel VPS root worker

这个目录提供 VPS 数据面 worker。它不会把第三方 SOCKS5 的落地 IP 伪装成客户端入口；它负责在 VPS 上通过上游 SOCKS5 做真实 HTTPS 探测，并在配置好 Xray 后用 systemd 安全应用 VLESS/REALITY + SOCKS5 路由配置。

## 一键部署管理面板和后端

管理面板安装器面向 Debian/Ubuntu VPS，需要 root、systemd 和可访问 GitHub 的网络。默认从 `shangxin913/shangxin-Proxy-Platform` 的 `main` 分支部署。**VPS 使用独立的管理员密码登录，不需要 Manus 项目 ID、账号或 OAuth 配置。**

### 默认：直接 HTTP 8899

```bash
curl -fsSL https://raw.githubusercontent.com/shangxin913/shangxin-Proxy-Platform/main/vps/one-click-deploy.sh \
  | sudo bash -s -- --host 你的VPS公网IP
```

没有域名时不安装/启用 Nginx，Node 直接以宿主网络监听 `0.0.0.0:8899`。首次安装生成不可预测的管理路径（24 位十六进制随机值）和强密码（48 位十六进制随机值），例如管理 URL 为 `http://公网IP:8899/<随机路径>`；不是公开的固定 `/admin`。安装成功后 root 终端显示当前 URL 和密码。

`--host` 只接收 IP/域名，不含 `http://`、端口或路径。未提供时首次安装尝试自动检测公网 IPv4，失败回退本机地址并警告；NAT、IPv6 或多 IP VPS 推荐显式提供。默认初始监听为 `0.0.0.0`；IPv6 可使用 `--listen :: --host 你的IPv6地址`。

HTTP 不加密密码和管理通信，随机路径不能代替 TLS。公网生产建议使用下面的域名 HTTPS，或限制可信源 IP、通过可信 VPN/SSH 隧道访问。

### 可选：域名 HTTPS

先将域名 DNS 指向 VPS，并按下文自行放行 80/443：

```bash
curl -fsSL https://raw.githubusercontent.com/shangxin913/shangxin-Proxy-Platform/main/vps/one-click-deploy.sh \
  | sudo bash -s -- \
  --domain panel.example.com \
  --email admin@example.com
```

提供 `--domain` 才配置 Nginx。提供 `--email` 才非交互申请 Let's Encrypt；失败时打印警告，没有证书则仍为 HTTP，不能认为已启用 HTTPS。升级会沿用已有域名证书。Nginx 的 upstream 固定为 `/run/exitpanel/app.sock`，宿主与容器共享同一路径；Node 创建 socket 并设置为 `0666`，目录为 root 所有、`0755`，并通过 tmpfiles/systemd 在重启后恢复。这样修改管理端口或监听地址无需修改 Nginx。

域名访问为 `https://panel.example.com/<随机路径>`；直连的管理端口仍会按面板设置监听。使用域名时可在面板把管理监听改为 `127.0.0.1`，或者在防火墙限制直连端口。`EXITPANEL_PUBLIC_ORIGIN=https://panel.example.com` 可用于已有外部 TLS 代理，必须是不含路径的完整 origin；`EXITPANEL_PUBLIC_HOST` 用于直连 URL。两者只用于描述公网入口，不会自动修改 DNS 或申请外部代理证书。

### 本地脚本与参数

安装器安装 Docker、Compose v2、MySQL 8.4、openssl、Python 3，以 `exitpanel-compose.service` 管理容器；仅域名模式安装 Nginx/可选 Certbot。可以先下载审阅脚本再运行：

```bash
sudo bash vps/deploy-panel.sh \
  --repo https://github.com/your-org/exitpanel.git \
  --host 203.0.113.10 --port 8899 --listen 0.0.0.0

bash vps/deploy-panel.sh --help
bash vps/one-click-deploy.sh --help
```

支持 `--repo`、`--branch`（默认 `main`）、`--dir`（默认 `/opt/exitpanel`）、`--port`、`--listen`、`--host`、`--domain`、`--email`。`--port`/`--listen` 仅作为首次数据库初始化值；已有数据库不会被重复安装参数覆盖。后续应在面板修改设置。

使用自定义仓库的一键入口时，同时设置该仓库的 HTTPS `EXITPANEL_INSTALLER_URL`；只修改 `--repo` 不会自动改变引导脚本的下载来源。`--branch` 会同时选择默认下载地址的分支和源码分支。不要使用 Manus Sandbox 内部 Git URL；生产 VPS 无法访问它。运行来自网络的 root 脚本前应审阅并固定可信版本。

### root 查看当前入口和恢复密码

```bash
sudo exitpanel credentials
sudo exitpanel reset-password
sudo exitpanel --help
```

`exitpanel` 安装到 `/usr/local/bin/exitpanel`，除帮助外仅允许 root 执行。它通过 `docker exec ... node dist/adminCli.js` 使用正在运行的应用容器和数据库：`credentials` 显示**数据库中当前**管理 URL 和可恢复密码，`reset-password` 随机生成新密码并作废旧会话，`bootstrap` 仅幂等初始化缺失管理设置。忘记随机路径或在浏览器中修改密码后，仍可在 root SSH 终端重新查看。不要分享/录制凭据输出。

默认安装目录记录于 `/etc/exitpanel/install-dir`（root `0600`），可用 `sudo exitpanel --dir /自定义目录 credentials` 覆盖。应用容器需正常运行，数据库需可用；CLI 不会绕过损坏数据库直接读取旧环境密码。

面板内可修改 `port`、`listen`、`path`、`password`；修改监听时应用在宿主网络重新绑定，数据库保存并在重启后沿用。改路径后使用新 URL，改端口后同步防火墙和服务商安全组；监听到 `127.0.0.1` 会关闭公网直连，但域名 Unix socket 代理不受影响。路径/密码以数据库为准，`.env.production` 中初始密码可能已过期，不能当作当前凭据。

### 保存密钥、升级与备份

安装目录从创建时就是 root `0700`；`.env.production` 从首次写入就是 root:root `0600`，不输出整份环境文件。随机值在依赖安装完成、openssl 可用后生成。`MANUS_JWT_SECRET` 仍作为本地会话签名密钥随机生成，但不代表需要 Manus 登录；`CREDENTIAL_ENCRYPTION_KEY` 必须稳定保存，数据库中的管理密码和其他敏感凭据依赖它恢复。

重复执行安装器只 fast-forward 更新干净源码，不会使用 `git reset --hard` 或删除源码目录。有本地修改、未跟踪文件、分支不同或本地提交分叉会停止，并要求先自行备份/处理。**不会执行 Git 提交或推送。** 旧安装缺少 `.env.production` 或必要旧密钥/数据库密码时也会停止，避免破坏已有 MySQL 卷。

已有 `.env.production` 的所有密钥、MySQL 密码和其他自定义变量保留；旧版若没有 `CREDENTIAL_ENCRYPTION_KEY`，会沿用旧 `MANUS_JWT_SECRET` 的有效加密密钥，不能另生成一把，否则历史凭据将无法解密。环境更新只迁移运行方式、数据库地址和所需公网 URL；数据库中的管理配置始终优先。管理环境值要求单行，重复变量会被拒绝，需先自行消除歧义。

MySQL 保留原 `exitpanel_mysql` 卷及 Compose 项目归属，不能执行 `docker compose down -v`、删除卷或改变旧 `MYSQL_PASSWORD`/`MYSQL_ROOT_PASSWORD`。升级 app 从桥接网络改为 `network_mode: host` 时 Compose 自动重建 app；数据库新映射为 `127.0.0.1:${DB_PORT:-13306}:3306`，`DATABASE_URL` 同步使用宿主 `127.0.0.1`，不再依赖 `db` DNS。管理端口不能与 `DB_PORT` 冲突；主机已有其他服务占用端口时也应调整。不要换安装目录直接重装，否则 Compose 的项目名可能变化，无法复用原数据库卷。

升级前同时备份 MySQL 数据和 `.env.production`，将备份放在受保护位置；不要把真实密钥、环境文件或凭据输出加入 Git。迁移旧 Nginx 时会备份本站配置到安装目录，默认尝试沿用既有域名；有自定义 Nginx 配置请先备份并显式提供 `--domain`。

```bash
sudo systemctl status exitpanel-compose
sudo systemctl restart exitpanel-compose
# 日志可能有敏感诊断信息，向他人发送前先遮蔽：
cd /opt/exitpanel
sudo docker compose --env-file .env.production -f docker-compose.prod.yml logs -f app
```

### 防火墙与访问边界

安装器**不自动修改规则、不启用 UFW、不自动放行 SSH**，避免误锁 SSH。安装前应确保现有 SSH 访问；在主机防火墙和云厂商安全组中，按实际需要允许：

- 无域名直连：当前管理端口，初始默认 `8899/tcp`，建议限制可信源 IP。
- 域名：`80/tcp` 用于 HTTP/证书申请，启用 TLS 后 `443/tcp`；不必向公网开放本机数据库。
- Xray/VLESS、worker 或隧道：仅开放实际接入配置需要的端口，不要整段放行。

`DB_PORT` 默认 `13306`，只映射 `127.0.0.1`，无需也不应公网放行。部署器只安装面板、API、数据库与可选 Nginx，不会安装/开放 Xray/VLESS；数据面 worker 仍按下面步骤单独安装。

## 安装

在项目目录执行：

```bash
sudo bash vps/install.sh
```

安装器需要 Linux、root、systemd、Python 3、curl、ca-certificates 和 openssl。它会创建 `exitpanel-agent` 系统用户，安装到 `/opt/exitpanel-agent`，并创建受 systemd 保护的服务。

worker 默认只监听 `127.0.0.1:18443`，不会把检测 API 暴露到公网。token 保存在：

```text
/etc/exitpanel/agent.env
```

## 接口

健康检查：

```bash
curl http://127.0.0.1:18443/health
```

面板与 worker 使用带时间戳的 HMAC-SHA256 签名，不再使用把 token 放在普通 Header 里的静态认证。签名内容为 `timestamp + 换行 + 原始 JSON body`，请求头为 `X-ExitPanel-Timestamp` 和 `X-ExitPanel-Signature`。

真实 SOCKS5 检测：

```bash
SECRET=$(sudo awk -F= '$1=="AGENT_SHARED_SECRET"{print $2}' /etc/exitpanel/agent.env)
BODY='{"host":"proxy.example.com","port":9188,"username":"user","password":"pass"}'
TS=$(date +%s)
SIG=$(printf '%s\n%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -hex | sed 's/^.* //')
curl -sS http://127.0.0.1:18443/v1/check \
  -H "Content-Type: application/json" \
  -H "X-ExitPanel-Timestamp: $TS" \
  -H "X-ExitPanel-Signature: $SIG" \
  -d "$BODY"
```

成功返回的结构类似：

```json
{
  "status": "passed",
  "observedIp": "203.0.113.10",
  "country": "MX",
  "city": "Mexico City",
  "latencyMs": 531
}
```

## Xray 配置应用

安装器会部署 `/usr/local/sbin/exitpanel-apply`。worker 收到 `/v1/config/apply` 后先在 `/run/exitpanel-agent/xray-next.json` 写入临时配置，再由 root helper 做 JSON/Xray 校验、备份当前配置、原子替换、systemd reload；校验或 reload 失败会恢复 `.bak` 并重启旧配置。有效计划会保存到 `/var/lib/exitpanel-agent/plan.json`，worker 每 30 秒本地清理已到期入口并重新应用配置，因此面板暂时不可用时也能阻断已经下发的过期入口。安装器不会自动下载 Xray 二进制，也不会自动生成 REALITY 私钥，需先安装并配置：

```text
/usr/local/bin/xray
/etc/exitpanel/agent.env
REALITY_PRIVATE_KEY=...
REALITY_SERVER_NAME=www.example.com
REALITY_DEST=www.example.com:443
```

Xray 配置生成器会为每个出口建立独立 VLESS 入站端口和对应 SOCKS5/direct 出站，已过期或不在订阅范围的出口不会进入新的配置计划。真实公网监听前仍应配置 DNS、TLS/REALITY 参数和防火墙策略。

## 多 VPS 与落地节点

面板的 `nodes` 数据模型支持多个 VPS/落地节点，每个节点保存 endpoint、worker 端口、HMAC 共享密钥、`direct`/`reverse` 隧道模式和公开入口地址。出口通过 `nodeId` 绑定到节点，管理员下发时，面板只把该节点的有效出口计划发送到对应 worker；密码在服务端解密后只通过签名 HTTPS/内网请求传输，worker 不会把它返回给面板。

如果需要让落地节点的公网 IP 作为客户端入口，可在落地节点上建立反向 SSH 隧道，把落地节点的公网端口转发到 VPS 上的 Xray 入站端口。仓库提供了 [reverse-tunnel.service.example](./reverse-tunnel.service.example) 模板。正式使用前必须固定 SSH host key、使用专用无 shell 密钥、限制 relay 的 `authorized_keys` 转发目标，并在 relay 防火墙只开放需要的端口；不要直接复制模板后开放任意 `GatewayPorts`。

## 说明

首版 worker 不安装 Xray/sing-box，不改 iptables，不创建公网 VLESS 入口，也不执行任何端口转发。面板端的模拟检测接口和这个 worker 的真实检测接口使用同一套结果字段，后续可以把调用目标替换为该服务。
