#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

usage() {
  cat <<'EOF'
ExitPanel v1.0.9 固定版本一键入口
  curl -fsSL https://raw.githubusercontent.com/shangxin913/shangxin-Proxy-Platform/v1.0.9/vps/deploy-v1.0.9.sh \
    | sudo bash -s --
默认自动检测当前 VPS 公网 IP，安装面板 + loopback worker，安全同步 HMAC。
参数：--host IP、--domain NAME、--email EMAIL、--dir PATH、--port PORT、
--listen ADDR、--skip-worker、--replace-worker、--repo URL、--branch NAME。
默认 tag v1.0.9，不跟随 main。--branch 显式选择其他版本时下载该版本部署器。
自动安装 Xray/REALITY；面板可生成并应用 VLESS/REALITY 节点。
--help / -h 无需 root。
EOF
}
for argument in "$@"; do
  case "$argument" in --help|-h) usage; exit 0 ;; esac
done
[[ "$(id -u)" == 0 ]] || { echo '请使用 root：sudo bash deploy-v1.0.9.sh ...' >&2; exit 1; }
command -v curl >/dev/null || { echo '缺少 curl，请先安装。' >&2; exit 1; }
TMP_DIR="$(mktemp -d -t exitpanel-v1.0.9.XXXXXX)"
trap 'rm -rf "$TMP_DIR"' EXIT
ENTRY="$TMP_DIR/one-click-deploy.sh"
curl -fLsS --proto '=https' --proto-redir '=https' --connect-timeout 10 --max-time 60 \
  https://raw.githubusercontent.com/shangxin913/shangxin-Proxy-Platform/v1.0.9/vps/one-click-deploy.sh -o "$ENTRY"
[[ -s "$ENTRY" ]] && grep -q 'DEFAULT_REPO_URL=' "$ENTRY" || { echo '未下载到预期一键部署脚本。' >&2; exit 1; }
bash -n "$ENTRY"
chmod 0700 "$ENTRY"
# Fix this entry's default even if the invoking shell has EXITPANEL_BRANCH=main.
bash "$ENTRY" --branch v1.0.9 "$@"
