#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

# The selected release controls BOTH installer download and application source.
DEFAULT_REPO_URL="https://github.com/shangxin913/shangxin-Proxy-Platform.git"
REPO_URL="${EXITPANEL_REPO_URL:-$DEFAULT_REPO_URL}"
BRANCH="${EXITPANEL_BRANCH:-v1.0.8}"
INSTALLER_URL="${EXITPANEL_INSTALLER_URL:-}"
usage() {
  cat <<'EOF'
ExitPanel v1.0.8 VPS 一键部署（自动安装 Xray/REALITY 与本机真实检测 worker）
直接 HTTP 默认 8899，自动检测 VPS 公网 IP，随机管理路径和强密码：
  curl -fsSL https://raw.githubusercontent.com/shangxin913/shangxin-Proxy-Platform/v1.0.8/vps/one-click-deploy.sh \
    | sudo bash -s --
可选域名 HTTPS（域名不作为客户端入口 IP）：
  ... | sudo bash -s -- --domain panel.example.com --email admin@example.com
NAT / IPv6：
  ... | sudo bash -s -- --host VPS公网IP

选项透传给所选版本的 vps/deploy-panel.sh：
  --repo URL       仓库，默认 shangxin913/shangxin-Proxy-Platform
  --branch NAME    tag/分支，默认固定 v1.0.8，不跟随 main
  --dir PATH       面板目录，默认 /opt/exitpanel；仅支持本机一个面板
  --port PORT      首次管理端口，默认 8899
  --listen ADDR    首次监听 IP，默认 0.0.0.0
  --host IP        显式公网 IP（NAT/IPv6），不接受管理域名
  --domain NAME    Nginx 80/443 经 Unix socket 代理管理面板
  --email EMAIL    可选 Let's Encrypt 邮箱
  --skip-worker    跳过本机 worker；未另配真实 worker 时检测不可用，不会 mock
  --replace-worker 明确允许替换已配置的远程 worker
  --help, -h      显示帮助，无需 root

EXITPANEL_BRANCH / EXITPANEL_REPO_URL 可显式覆盖；EXITPANEL_INSTALLER_URL
可指定可信 HTTPS 部署器。GitHub 仓库自动使用同仓库/版本 raw 地址，其他
仓库须同时设置 EXITPANEL_INSTALLER_URL。网络 root 脚本应先审阅。
重复安装保留数据库、管理密码和密钥。worker 仅 loopback，不公开 18443。
自动安装 Xray、生成 REALITY 密钥并启动服务；实际 VLESS 端口仍需在系统防火墙和云安全组放行。
EOF
}
FORWARDED_ARGS=()
for arg in "$@"; do
  case "$arg" in --help|-h) usage; exit 0 ;; esac
  [[ "$arg" == "\\" ]] || FORWARDED_ARGS+=("$arg")
done
for ((i=0; i<${#FORWARDED_ARGS[@]}; i++)); do
  case "${FORWARDED_ARGS[$i]}" in
    --branch|--repo)
      ((i + 1 < ${#FORWARDED_ARGS[@]})) && [[ -n "${FORWARDED_ARGS[$((i + 1))]}" && "${FORWARDED_ARGS[$((i + 1))]}" != --* ]] || { echo "${FORWARDED_ARGS[$i]} 缺少值" >&2; exit 1; }
      if [[ "${FORWARDED_ARGS[$i]}" == --branch ]]; then
        BRANCH="${FORWARDED_ARGS[$((i + 1))]}"
      else
        REPO_URL="${FORWARDED_ARGS[$((i + 1))]}"
      fi
      i=$((i + 1))
      ;;
  esac
done
[[ "$BRANCH" =~ ^[A-Za-z0-9_./-]+$ && "$BRANCH" != -* && "$BRANCH" != *..* ]] || { echo '版本名称无效。' >&2; exit 1; }
if [[ -z "$INSTALLER_URL" ]]; then
  if [[ "$REPO_URL" =~ ^https://github\.com/([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+)$ ]]; then
    OWNER="${BASH_REMATCH[1]}"
    REPO_NAME="${BASH_REMATCH[2]%.git}"
    INSTALLER_URL="https://raw.githubusercontent.com/$OWNER/$REPO_NAME/$BRANCH/vps/deploy-panel.sh"
  else
    echo '非 GitHub HTTPS 仓库必须提供可信 HTTPS EXITPANEL_INSTALLER_URL。' >&2
    exit 1
  fi
fi
[[ "$(id -u)" == 0 ]] || { echo '请使用 root 执行，例如：sudo bash -s -- ...' >&2; exit 1; }
command -v curl >/dev/null || { echo '缺少 curl，请先安装。' >&2; exit 1; }
[[ "$INSTALLER_URL" == https://* ]] || { echo '部署器下载地址必须使用 HTTPS。' >&2; exit 1; }
TMP_DIR="$(mktemp -d -t exitpanel-deploy.XXXXXX)"
trap 'rm -rf "$TMP_DIR"' EXIT
INSTALLER="$TMP_DIR/deploy-panel.sh"
echo "[ExitPanel] 下载选定版本的部署器：$INSTALLER_URL"
curl -fLsS --proto '=https' --proto-redir '=https' --connect-timeout 10 --max-time 60 "$INSTALLER_URL" -o "$INSTALLER"
[[ -s "$INSTALLER" ]] && grep -q 'APP_NAME="exitpanel"' "$INSTALLER" || { echo '下载内容不是预期的 ExitPanel 部署器。' >&2; exit 1; }
bash -n "$INSTALLER"
chmod 0700 "$INSTALLER"
echo "[ExitPanel] 部署版本 $BRANCH；无需 Manus 项目 ID/OAuth。"
# Do not exec: keep the EXIT cleanup when invoked as curl | sudo bash.
bash "$INSTALLER" --repo "$REPO_URL" --branch "$BRANCH" "${FORWARDED_ARGS[@]}"
