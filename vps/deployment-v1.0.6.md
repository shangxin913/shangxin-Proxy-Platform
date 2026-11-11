# v1.0.6：部署 VPS 入口 IP与本机真实检测

本版本修复同机部署的两处问题：入口主机从执行安装命令的 VPS 公网 IP读取；安装默认接入仅监听 loopback 的真实 worker。旧版面板/API 安装器没有安装 worker，所以点击检测会显示“尚未接入 VPS worker，无法执行真实检测”，这不是上游 SOCKS5 已失败的检测结果。

## 完整安装或升级

在需要作为客户端入口的那台 VPS 执行下面完整单行命令：

```bash
curl -fsSL https://raw.githubusercontent.com/shangxin913/shangxin-Proxy-Platform/v1.0.6/vps/deploy-v1.0.6.sh -o deploy-v1.0.6.sh && sudo bash deploy-v1.0.6.sh
```

脚本尝试检测实际公网 IP。NAT、多网卡或 IPv6 VPS 建议显式指定；以下示例 IP应换成执行命令的那台服务器的公网 IP：

```bash
curl -fsSL https://raw.githubusercontent.com/shangxin913/shangxin-Proxy-Platform/v1.0.6/vps/deploy-v1.0.6.sh -o deploy-v1.0.6.sh && sudo bash deploy-v1.0.6.sh --host YOUR_VPS_PUBLIC_IP
```

第一次安装仍使用随机管理路径、随机密码和默认管理端口8899。已有部署在原目录安全升级，保留 MySQL、密码和密钥；升级前先备份数据库与 `.env.production`。本机出口表单自动使用部署 IP，不能误填上游代理地址；已明确绑定远程节点的资源不覆盖。管理域名是管理访问入口，不作为默认客户端 VPS IP。

## 仅修复旧版面板的 SOCKS5 检测

如果已有 v1.0.4 面板可以登录，仅需接入检测 worker，可以在同一 VPS执行：

```bash
curl -fsSL https://raw.githubusercontent.com/shangxin913/shangxin-Proxy-Platform/v1.0.6/vps/repair-worker-v1.0.6.sh -o repair-worker-v1.0.6.sh && sudo bash repair-worker-v1.0.6.sh
```

此命令下载同版本所需 worker文件，安装本机服务、保留 HMAC 密钥、安全写入已有生产配置并重建 app 容器，使旧版 API也能调用 worker。它不升级旧面板源码，因此自动入口表单和新本机直出能力需完整升级到 v1.0.6。

默认安装目录从 `/etc/exitpanel/install-dir` 读取，缺失时使用 `/opt/exitpanel`。可加 `--dir /你的原安装目录` 和 `--host YOUR_VPS_PUBLIC_IP`。如果已配置远程 worker，工具默认停止，不会偷偷替换；确实要改为本机时，明确添加 `--replace-worker`。

## 验证检测服务

```bash
sudo systemctl status exitpanel-agent --no-pager
curl -fsS http://127.0.0.1:18443/health
```

默认端口的健康结果应为 `ok: true` 并包含 `socks5-check` 和 `direct-check` 能力。若 worker配置采用自定义 loopback IP或端口，检查对应地址；安装器会按实际配置进行健康检查。刷新面板“系统状态”，worker应显示在线，再点击出口检测。

worker仅本机监听，不需要也不应在服务商安全组开放18443。管理容器使用宿主网络才能访问本机 loopback；此接入工具不适用于普通桥接容器或远程 Manus托管控制面。远程控制面需单独配置实际 VPS的 HTTPS worker地址和共享密钥，不能将它的127.0.0.1视为 VPS。

## 真实检测与代理监听的区别

SOCKS5检测通过指定上游代理访问 HTTPS IP服务，返回实际出网IP；本机直出探测显式禁用代理环境变量，返回 VPS实际直出IP。缺少worker、能力不支持、连接失败或IP格式不正确时，不生成模拟通过记录。连接worker成功不保证你填写的第三方代理可用，账号、密码、端口与网络仍需正确。

检测通过只是出网验证，不代表Xray/VLESS/REALITY客户端入站已安装、监听或可连接；数据面仍需单独配置。系统和服务商防火墙应放行实际使用的管理/客户端端口，而不是盲目开放worker或数据库端口。

本版本安装命令、修复命令和原始脚本保存到对应Release，旧版本标签不覆盖。脚本与回归测试会检查安装连接逻辑，但尚未获得目标VPS SSH访问；真正的公网检测结果须在你的VPS执行命令后确认。
