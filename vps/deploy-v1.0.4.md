# ExitPanel v1.0.4 生产 VPS 一键部署

此安装包固定应用版本 `v1.0.4` 与 Git 提交 `7aa50047e4ee94fd31eb4e5e47455b7dc57e68f5`，不会跟随 `main` 拉取未发布应用。它是完整安装器，不是把参数转交给最新版脚本的下载器。应用包含 React 管理页面、Express/tRPC API 后端、MySQL 8.4 数据库；首次部署随机生成管理路径和密码，无需 Manus 项目 ID 或 Manus 登录。

## 运行要求

需要 root/sudo、systemd、原生 Debian/Ubuntu，以及访问 GitHub、Docker 官方软件源、镜像仓库和系统软件源的网络。推荐 Ubuntu 22.04/24.04 LTS 或 Debian 12/13，64 位 amd64/arm64。不是针对 CentOS、Alpine、普通 Docker 容器或无 systemd 系统的安装器。首次安装 Docker 按官方 apt 仓库方法进行；已有 Docker 引擎不会被自动卸载或强制升级，发现与其他服务可能冲突的包会停止。[1] [2] [3]

预留足够内存和磁盘用于 MySQL 与 Node 构建。已有生产实例升级前，先备份数据库及 `/opt/exitpanel/.env.production`；脚本不承诺自动数据库回滚，也不承诺零停机升级。不要更改原安装目录重装来代替升级。

## 直接使用下载文件

将同目录的 `deploy-v1.0.4.sh` 上传到 VPS，再执行。把示例 IP 替换成真实公网 IP；`--host` 不含协议、端口或路径。

```bash
sudo bash deploy-v1.0.4.sh --host 你的VPS公网IP
```

如未指定 `--host`，脚本尝试自动检测 IPv4，失败回退本机地址并警告；NAT 或多 IP VPS 建议显式指定。IPv6 示例：

```bash
sudo bash deploy-v1.0.4.sh --host 你的IPv6地址 --listen ::
```

直接访问默认监听 `0.0.0.0:8899`，管理地址是 `http://公网IP:8899/随机路径`。安装结束后显示数据库中当前管理地址及密码。随机路径不是 HTTPS 的替代；公网生产优先使用下面的 HTTPS 方式，或限制可信源 IP并通过 VPN/SSH 隧道访问。

## 从 GitHub 下载固定安装器

脚本发布记录为仓库 `v1.0.5`；这个版本只增加部署交付，不把待部署应用从 `v1.0.4` 升级到新代码。下载时使用固定安装器标签，不使用 `main`。

```bash
curl -fLsS --proto '=https' --proto-redir '=https' https://raw.githubusercontent.com/shangxin913/shangxin-Proxy-Platform/v1.0.5/vps/deploy-v1.0.4.sh -o deploy-v1.0.4.sh
sudo bash deploy-v1.0.4.sh --host 你的VPS公网IP
```

如果 VPS 没有 curl，先安装：

```bash
sudo apt-get update && sudo apt-get install -y ca-certificates curl
```

如果下载本安装包，先解压并审阅脚本，可用下面命令核对压缩包内文件是否损坏。校验文件本身也必须来自可信来源。

```bash
sha256sum -c SHA256SUMS
bash -n deploy-v1.0.4.sh
bash deploy-v1.0.4.sh --help
```

不要把换行示例中的反斜杠拼进同一行参数，也不要将 `http//` 当成合法网址。

## 域名 HTTPS

先把自己的域名 DNS 指向 VPS，检查系统防火墙和云安全组允许 80/443。运行下面一行命令，把域名与邮箱替换成真实值：

```bash
sudo bash deploy-v1.0.4.sh --domain panel.example.com --email admin@example.com
```

脚本配置 Nginx，并尝试通过 Certbot 申请/沿用 Let's Encrypt 证书；证书失败会明确警告，没有证书时仍为 HTTP，不能认为 HTTPS 已成功。域名代理通过固定 Unix socket 连接 API，因此在面板更改直连管理端口后不会失去 Nginx 上游。

默认管理 TCP 端口仍会监听。启用 HTTPS 后，可在设置页面将监听地址改为 `127.0.0.1`，使公网只能通过 HTTPS 域名进入；本机 Unix socket 代理仍可访问应用。

## 常用参数与实际部署行为

`--dir /opt/exitpanel` 指定安装目录，`--port 8899`、`--listen 0.0.0.0` 指定首次初始化网络值，`--host` 指定公网 IP或域名，`--domain`/`--email` 启用可选域名与证书。已有数据库的管理设置不会被重复安装参数覆盖，后续请在管理页面的“设置”修改。

安装器安装或复用 Docker 与 Compose 插件，校验固定 Git 提交，安装并构建应用镜像，启动 MySQL、执行增量数据库迁移、初始化管理员、启动前后端服务，注册 `exitpanel-compose` 开机启动并等待真实数据库健康检查。不会自动安装 Xray/sing-box、REALITY 数据面或 VPS worker；它们属于独立接入服务，本安装器不把管理后端部署成功误报为代理节点已可用。

生产环境文件创建为 root:root `0600`，安装目录为 `0700`。重复安装保留数据库和加密密钥，不会执行 `git reset --hard`、删除数据卷或覆盖旧版本标签。源码有本地修改、独立提交、版本高于 v1.0.4、缺少旧环境密钥，或固定标签与预期提交不符时会停止；先备份并人工确认，不要删除旧环境文件来强行继续。

## 登录与查看凭据

```bash
sudo exitpanel credentials
sudo exitpanel reset-password
sudo systemctl status exitpanel-compose
```

`credentials` 显示数据库中当前路径和密码，而不是环境文件里可能已过期的初始密码。`reset-password` 随机生成新密码并作废旧会话。管理端口、监听地址、路径和密码都可在设置页修改；新密码留空则保留旧密码，敏感修改需验证当前密码。

查看日志：

```bash
cd /opt/exitpanel
sudo docker compose --env-file .env.production -f docker-compose.prod.yml ps
sudo docker compose --env-file .env.production -f docker-compose.prod.yml logs --tail=100 app
```

健康检查不依赖管理员改过的管理端口：

```bash
sudo curl -fsS --unix-socket /run/exitpanel/app.sock http://localhost/api/health
```

日志和凭据输出可能含敏感信息，分享前先遮蔽。

## 防火墙及数据保护

脚本不启用 UFW，不修改 SSH 放行规则，不自动开放整段端口。主机防火墙和服务商安全组都需检查：直连管理端口初始为 `8899/tcp`，HTTPS 域名使用 `80/tcp` 与 `443/tcp`，实际代理接入端口另行按配置开放。建议将直连管理端口限制为管理员可信 IP。

MySQL 只映射本机 `127.0.0.1:13306`，不需要公网开放。Docker 映射端口与防火墙的交互需遵循官方说明；不能只凭 UFW 状态判断 Docker 端口是否被阻断。[1] [3]

保留原 `.env.production` 与 MySQL 数据卷，禁止 `docker compose down -v` 或删除 `/var/lib/docker` 来解决安装问题。安装停止后，根据原始错误修复，再使用同一目录重试。

## 验证范围

完成 Bash 语法、无需 root 的帮助、非 root安装拒绝、固定 Git版本的首次获取/安全升级/重复执行/拒绝降级与拒绝错误提交测试。基础应用 v1.0.4 已成功构建并发布网站。当前环境没有 Docker，且未提供 VPS 连接信息，因此未在目标 VPS 实际执行 apt安装、Docker镜像构建、证书申请和服务启动；最终运行结果以 VPS 健康检查为准。

## References

[1]: https://docs.docker.com/engine/install/debian/ "Docker Engine on Debian"
[2]: https://docs.docker.com/compose/install/linux/ "Docker Compose plugin on Linux"
[3]: https://docs.docker.com/engine/install/ubuntu/ "Docker Engine on Ubuntu"
