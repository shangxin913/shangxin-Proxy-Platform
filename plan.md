
## 设置页版本更新
设置页通过服务端请求 GitHub Releases API，当前版本与最新固定标签使用严格 semver比较；不会让浏览器自行执行远程脚本。VPS安装器额外部署 root-owned update-agent Unix socket 与固定版本更新命令，应用容器仅经共享 `/run/exitpanel/update.sock` 请求指定 vX.Y.Z。代理拒绝 main、任意分支和非法标签，下载对应标签的部署器并复用现有安全升级流程，保留 `.env.production`、数据库卷、密码、密钥、worker和源版本绑定。状态文件仅保存在 VPS，升级进程独立于当前 app，app重启不影响后台状态。
托管环境仍可检查并查看 Release，但安装按钮不可用并说明需 VPS先完成 v1.0.6 的更新代理安装；更新过程中要求管理员二次确认，安装前重新检查最新标签，避免过时页面触发降级或覆盖。
