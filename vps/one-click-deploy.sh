#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

# Download the versioned installer instead of duplicating deployment logic.
DEFAULT_REPO_URL="https://github.com/shangxin913/shangxin-Proxy-Platform.git"
REPO_URL="${EXITPANEL_REPO_URL:-$DEFAULT_REPO_URL}"
BRANCH="${EXITPANEL_BRANCH:-main}"
INSTALLER_URL="${EXITPANEL_INSTALLER_URL:-}"

usage() {
  cat <<'EOF'
ExitPanel VPS 一键生产部署（无需 Manus 项目 ID / OAuth）

直接 HTTP 默认 8899，随机管理路径和强密码：
  curl -fsSL https://raw.githubusercontent.com/shangxin913/shangxin-Proxy-Platform/main/vps/one-click-deploy.sh \
    | sudo bash -s -- --host VPS公网IP

可选域名 HTTPS：
  ... | sudo bash -s -- --domain panel.example.com --email admin@example.com

选项透传给 vps/deploy-panel.sh：
  --repo URL       代码仓库（默认 shangxin913/shangxin-Proxy-Platform）
  --branch NAME    代码分支，默认 main
  --dir PATH       安装目录，默认 /opt/exitpanel
  --port PORT      首次管理端口，默认 8899
  --listen ADDR    首次监听 IP，默认 0.0.0.0
  --host HOST      公网 IP/域名，生成 root 查看时的管理 URL
  --domain NAME    可选 Nginx 80/443 域名代理，使用稳定 Unix socket
  --email EMAIL    可选 Let's Encrypt 邮箱
  --help, -h      显示帮助（无需 root）

环境变量：EXITPANEL_REPO_URL、EXITPANEL_BRANCH、EXITPANEL_INSTALLER_URL。
自定义仓库须同时设置其 HTTPS EXITPANEL_INSTALLER_URL；安装前请审阅脚本。
重复安装不会覆盖数据库里的 port/listen/path/password，不会自动启用 UFW。
部署成功后 sudo exitpanel credentials 查看当前 URL/密码；reset-password 重置。
EOF
}

FORWARDED_ARGS=()
for arg in "$@"; do
  case "$arg" in --help|-h) usage; exit 0 ;; esac
  # Tolerate a standalone backslash accidentally pasted from shell examples.
  [[ "$arg" == "\\" ]] || FORWARDED_ARGS+=("$arg")
done
# The selected branch must control the downloaded installer as well as source.
for (( i=0; i<${#FORWARDED_ARGS[@]}; i++ )); do
  case "${FORWARDED_ARGS[$i]}" in
    --branch|--repo)
      (( i + 1 < ${#FORWARDED_ARGS[@]} )) || { echo "${FORWARDED_ARGS[$i]} 缺少值" >&2; exit 1; }
      if [[ "${FORWARDED_ARGS[$i]}" == --branch ]]; then
        BRANCH="${FORWARDED_ARGS[$((i + 1))]}"
      else
        REPO_URL="${FORWARDED_ARGS[$((i + 1))]}"
      fi
      i=$((i + 1))
      ;;
  esac
done
[[ "$BRANCH" =~ ^[A-Za-z0-9_./-]+$ && "$BRANCH" != -* ]] || { echo '分支名称无效。' >&2; exit 1; }
if [[ -z "$INSTALLER_URL" ]]; then
  INSTALLER_URL="https://raw.githubusercontent.com/shangxin913/shangxin-Proxy-Platform/$BRANCH/vps/deploy-panel.sh"
fi
[[ "$(id -u)" == "0" ]] || { echo '请使用 root 执行，例如：sudo bash -s -- ...' >&2; exit 1; }
command -v curl >/dev/null 2>&1 || { echo '缺少 curl，请先安装 curl。' >&2; exit 1; }
case "$INSTALLER_URL" in
  https://*) ;;
  *) echo '部署器下载地址必须使用 HTTPS。' >&2; exit 1 ;;
esac

TMP_DIR="$(mktemp -d -t exitpanel-deploy.XXXXXX)"
cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT
INSTALLER="$TMP_DIR/deploy-panel.sh"
echo "[ExitPanel] 下载生产部署器：$INSTALLER_URL"
curl -fLsS --proto '=https' --proto-redir '=https' --connect-timeout 10 --max-time 60 "$INSTALLER_URL" -o "$INSTALLER"
[[ -s "$INSTALLER" ]] || { echo '部署器下载为空。' >&2; exit 1; }
grep -q 'APP_NAME="exitpanel"' "$INSTALLER" || { echo '下载文件不是预期的 ExitPanel 部署器。' >&2; exit 1; }
chmod 0700 "$INSTALLER"
echo '[ExitPanel] 开始部署；无需交互式输入 Manus 项目 ID 或管理员密码。'
# Do not exec: preserve the EXIT trap so downloaded secrets-free files are
# cleaned on success/failure. No /dev/tty is needed with curl | sudo bash.
bash "$INSTALLER" --repo "$REPO_URL" --branch "$BRANCH" "${FORWARDED_ARGS[@]}"
