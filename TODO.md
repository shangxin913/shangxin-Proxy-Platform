# ExitPanel 交付清单

## 控制面与 VPS 数据面
- [x] React/Express/tRPC/Drizzle/MySQL 控制面迁入托管工作区并完成健康检查、数据库迁移和固定 HTTPS 发布。
- [x] 管理员登录使用真实会话、管理员角色和独立密码会话；禁止任意首个登录用户自动提权。
- [x] VPS worker 使用时间戳 HMAC 请求，支持真实 SOCKS5 检测、本机直出检测、能力协商、Xray 配置校验、原子替换、重载和失败回滚。
- [x] 入口主机从执行部署命令的 VPS 公网 IP读取；远程节点配置不会被同机入口覆盖。
- [x] 订阅实时排除未启用、过期和未通过检测的出口；不生成模拟通过记录。
- [x] 系统状态显示面板、worker、VPS 管理地址和连通状态；不开放 worker 18443 或数据库端口。

## 管理入口与版本
- [x] VPS 安装后生成随机管理路径和强密码，默认管理端口 8899；支持查看、重置密码、修改端口/监听地址/管理路径。
- [x] 设置页检查 GitHub 固定 Release，并在 VPS 安装更新代理后支持管理员确认一键安装固定版本；升级保留数据库、密码、密钥、worker 和出口配置。
- [x] v1.0.6、v1.0.7 已创建不可覆盖的 GitHub 标签与 Release，旧版本保持不变。

## v1.0.8 Xray/REALITY 数据面
- [x] VPS 一键安装器通过固定官方 Xray 安装器提交自动安装 Xray，并创建受限 systemd 服务和初始配置；发现未知既有 Xray 配置时先备份并停止，不覆盖。
- [x] 首次安装生成并保存 REALITY 私钥、公钥、shortId、serverName 和 target；私钥仅留在 VPS worker 环境，面板只使用公开客户端参数。
- [x] 面板订阅生成带 `pbk`、`sid`、`sni`、`fp`、`flow` 的 VLESS/REALITY 链接，以及 Clash/Mihomo REALITY 参数。
- [x] “订阅与入口”提供“生成并应用节点”，将通过检测的出口计划下发到 VPS Xray，支持 direct 或 SOCKS5 出站。
- [x] VLESS 入站使用 XTLS Vision flow；REALITY 和 SOCKS5 凭据由 VPS 端配置生成，客户端链接不包含上游 SOCKS5 密码。
- [x] 部署文档和终端提示要求管理员放行实际 VLESS 入站端口；不自动开放 worker、数据库或 SSH 端口。
- [ ] 在目标 VPS 实测一个通过生成链接导入 v2rayN/v2rayNG 的公网连接，并根据实际云厂商安全组确认入站端口。

## v1.0.9 修复
- [x] 兼容 Xray v26 的 `PrivateKey` / `Password` / `Hash32` x25519 输出格式；其中 `Password` 作为 REALITY 客户端公钥使用。
- [x] v1.0.8 保持不变，发布 v1.0.9 固定部署入口修复已部署失败问题。
