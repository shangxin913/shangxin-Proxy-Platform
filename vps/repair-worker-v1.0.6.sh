#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
VERSION="v1.0.6"
BASE_URL="https://raw.githubusercontent.com/shangxin913/shangxin-Proxy-Platform/$VERSION/vps"
usage() {
  cat <<'EOF'
ExitPanel v1.0.6 本机 worker 接入修复（保留现有面板数据库与密码）
用法：sudo bash repair-worker-v1.0.6.sh [--dir /opt/exitpanel] [--host VPS公网IP]
      sudo bash repair-worker-v1.0.6.sh --replace-worker

此工具下载安装同版本的 worker，仅监听本机 loopback，并连接现有 VPS 面板。
默认不覆盖已配置远程 worker。--replace-worker 表示明确替换现有 worker。
完整升级面板请使用 deploy-v1.0.6.sh；此修复入口本身不升级现有面板代码。
EOF
}
for arg in "$@"; do
  case "$arg" in --help|-h) usage; exit 0 ;; esac
done
[[ "$(id -u)" == 0 ]] || { echo '请使用 root/sudo 执行。' >&2; exit 1; }
command -v curl >/dev/null || { echo '缺少 curl，请先安装 ca-certificates curl。' >&2; exit 1; }
TMP_DIR="$(mktemp -d -t exitpanel-worker-v106.XXXXXX)"
trap 'rm -rf "$TMP_DIR"' EXIT
for file in connect-local-worker.sh install.sh agent.py xray_config.py exitpanel-apply; do
  echo "[ExitPanel] 下载 $VERSION/$file"
  curl -fLsS --proto '=https' --proto-redir '=https' --connect-timeout 10 --max-time 60 "$BASE_URL/$file" -o "$TMP_DIR/$file"
  [[ -s "$TMP_DIR/$file" ]] || { echo "下载文件为空：$file" >&2; exit 1; }
done
bash -n "$TMP_DIR/install.sh"
bash -n "$TMP_DIR/connect-local-worker.sh"
chmod 0700 "$TMP_DIR/install.sh" "$TMP_DIR/connect-local-worker.sh" "$TMP_DIR/exitpanel-apply"
bash "$TMP_DIR/connect-local-worker.sh" "$@"
