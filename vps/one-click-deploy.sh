#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

# This bootstrap downloads the versioned production installer from GitHub and
# executes it locally. It intentionally keeps the actual deployment logic in
# deploy-panel.sh so local and remote execution use the same implementation.
DEFAULT_REPO_URL="https://github.com/shangxin913/shangxin-Proxy-Platform.git"
DEFAULT_BRANCH="main"
REPO_URL="${EXITPANEL_REPO_URL:-$DEFAULT_REPO_URL}"
BRANCH="${EXITPANEL_BRANCH:-$DEFAULT_BRANCH}"
INSTALLER_URL="${EXITPANEL_INSTALLER_URL:-https://raw.githubusercontent.com/shangxin913/shangxin-Proxy-Platform/${DEFAULT_BRANCH}/vps/deploy-panel.sh}"

usage() {
  cat <<'EOF'
ExitPanel 一键生产部署

用法：
  curl -fsSL https://raw.githubusercontent.com/shangxin913/shangxin-Proxy-Platform/main/vps/one-click-deploy.sh \
    | sudo bash -s -- --domain panel.example.com --email admin@example.com

选项会透传给 vps/deploy-panel.sh：
  --repo URL       代码仓库地址（默认使用 shangxin913 的 fork）
  --branch NAME    代码分支（默认 main）
  --domain NAME    生产域名；不填则只启用 HTTP
  --email EMAIL    Let's Encrypt 邮箱
  --dir PATH       安装目录，默认 /opt/exitpanel
  --help           显示帮助

环境变量：
  EXITPANEL_REPO_URL       覆盖默认代码仓库
  EXITPANEL_BRANCH         覆盖默认代码分支
  EXITPANEL_INSTALLER_URL  覆盖部署器下载地址
EOF
}

for arg in "$@"; do
  [[ "$arg" != "--help" && "$arg" != "-h" ]] || { usage; exit 0; }
done

[[ "$(id -u)" == "0" ]] || { echo "请使用 root 执行，例如：sudo bash -s -- ..." >&2; exit 1; }

command -v curl >/dev/null 2>&1 || { echo "缺少 curl，请先安装 curl" >&2; exit 1; }

# Read the required project ID before handing control to the downloaded
# installer. This avoids depending on the stdin state of `curl | sudo bash`.
if [[ -z "${MANUS_PROJECT_ID:-}" ]]; then
  if [[ -r /dev/tty ]]; then
    read -r -p "MANUS_PROJECT_ID（项目 ID）: " MANUS_PROJECT_ID </dev/tty
  else
    echo "缺少 MANUS_PROJECT_ID，且当前没有可交互终端。请使用：sudo env MANUS_PROJECT_ID=你的项目ID bash ..." >&2
    exit 1
  fi
fi
[[ -n "$MANUS_PROJECT_ID" ]] || { echo "MANUS_PROJECT_ID 不能为空" >&2; exit 1; }
export MANUS_PROJECT_ID

TMP_DIR="$(mktemp -d -t exitpanel-deploy.XXXXXX)"
cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT

INSTALLER="$TMP_DIR/deploy-panel.sh"
echo "[ExitPanel] 下载生产部署器：$INSTALLER_URL"
# Keep the URL HTTPS by construction while avoiding newer curl-only options;
# older VPS images commonly ship curl versions without --proto support.
case "$INSTALLER_URL" in
  https://*) ;;
  *) echo "部署器地址必须使用 HTTPS：$INSTALLER_URL" >&2; exit 1 ;;
esac
curl -fLsS --location --max-time 30 "$INSTALLER_URL" -o "$INSTALLER"

[[ -s "$INSTALLER" ]] || { echo "部署器下载为空" >&2; exit 1; }
grep -q 'APP_NAME="exitpanel"' "$INSTALLER" || { echo "下载的文件不是预期的 ExitPanel 部署器" >&2; exit 1; }
chmod 700 "$INSTALLER"

echo "[ExitPanel] 开始部署，后续参数将透传给生产部署器"
FORWARDED_ARGS=()
for arg in "$@"; do
  # Tolerate a standalone backslash accidentally pasted from a multi-line
  # shell example; it is not a meaningful deploy option.
  [[ "$arg" == "\\" ]] || FORWARDED_ARGS+=("$arg")
done
if [[ -r /dev/tty ]]; then
  # curl | sudo bash consumes stdin while reading this bootstrap. Reattach
  # the real terminal so the installer can ask for MANUS_PROJECT_ID/passwords.
  exec "$INSTALLER" --repo "$REPO_URL" --branch "$BRANCH" "${FORWARDED_ARGS[@]}" </dev/tty
else
  exec "$INSTALLER" --repo "$REPO_URL" --branch "$BRANCH" "${FORWARDED_ARGS[@]}"
fi
