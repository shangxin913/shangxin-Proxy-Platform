#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

APP_NAME="exitpanel-agent"
INSTALL_DIR="/opt/exitpanel-agent"
CONFIG_DIR="/etc/exitpanel"
ENV_FILE="$CONFIG_DIR/agent.env"
SERVICE_FILE="/etc/systemd/system/$APP_NAME.service"
SUDOERS_FILE="/etc/sudoers.d/$APP_NAME"
APPLY_HELPER="/usr/local/sbin/exitpanel-apply"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "${1:-}" == --help || "${1:-}" == -h ]]; then
  echo '用法：sudo bash vps/install.sh；安装/修复仅监听 loopback 的本机 worker，保留已有 HMAC/REALITY 配置。'
  exit 0
fi
[[ $# == 0 ]] || { echo 'install.sh 不接受其他参数；面板路径请使用 connect-local-worker.sh --dir。' >&2; exit 1; }
[[ "$(id -u)" == 0 ]] || { echo '请以 root 执行：sudo bash vps/install.sh' >&2; exit 1; }
[[ "$(uname -s)" == Linux ]] || { echo '仅支持 Linux' >&2; exit 1; }
command -v systemctl >/dev/null || { echo '需要 systemd' >&2; exit 1; }
for file in agent.py xray_config.py exitpanel-apply; do
  [[ -f "$SCRIPT_DIR/$file" ]] || { echo "缺少同版本文件：$SCRIPT_DIR/$file" >&2; exit 1; }
done
missing=()
for dependency in python3 curl openssl sudo visudo; do
  command -v "$dependency" >/dev/null || missing+=("$dependency")
done
if ((${#missing[@]})); then
  if command -v apt-get >/dev/null; then
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends python3 curl ca-certificates openssl sudo
  else
    echo "缺少依赖：${missing[*]}；请先安装 python3、curl、ca-certificates、openssl 和 sudo（含 visudo）" >&2
    exit 1
  fi
fi
for dependency in python3 curl openssl sudo visudo; do
  command -v "$dependency" >/dev/null || { echo "依赖安装失败：$dependency" >&2; exit 1; }
done

install -d -o root -g root -m 0700 "$CONFIG_DIR"
# EnvironmentFile is data, not executable shell. Do not rotate an existing key.
WORKER_URL="$(ENV_FILE="$ENV_FILE" python3 - <<'PY'
import os, re, secrets, tempfile
path = os.environ['ENV_FILE']
if os.path.islink(path):
    raise SystemExit('agent.env 不能是符号链接')
lines = open(path, encoding='utf-8').read().splitlines() if os.path.exists(path) else []
values = {}
for line in lines:
    if not line.strip() or line.lstrip().startswith(('#', ';')):
        continue
    match = re.fullmatch(r'\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)', line)
    if not match:
        raise SystemExit('agent.env 必须使用单行 KEY=VALUE 格式')
    name, raw = match[1], match[2].strip()
    if name in values:
        raise SystemExit('agent.env 有重复变量：' + name)
    if raw.startswith(("'", '"')):
        if len(raw) < 2 or raw[-1] != raw[0]:
            raise SystemExit('agent.env 不支持多行值或不完整引号')
        quote = raw[0]
        raw = raw[1:-1]
        if quote == '"':
            raw = re.sub(r'\\([\\"`$])', r'\1', raw)
    if any(c in raw for c in '\n\r\0'):
        raise SystemExit('agent.env 值必须是单行')
    values[name] = raw
host = values.get('AGENT_HOST', '127.0.0.1')
if host not in ('localhost', '127.0.0.1', '::1'):
    raise SystemExit('拒绝公开 worker：AGENT_HOST 只能是 localhost / 127.0.0.1 / ::1；请先人工修正配置')
port = values.get('AGENT_PORT', '18443')
if not port.isascii() or not port.isdigit() or not 1 <= int(port) <= 65535:
    raise SystemExit('AGENT_PORT 必须为 1-65535')
if 'AGENT_SHARED_SECRET' in values and not values['AGENT_SHARED_SECRET']:
    raise SystemExit('旧 AGENT_SHARED_SECRET 为空；请恢复原密钥，不会自动覆盖')
def default(name, value):
    if name not in values:
        lines.append(name + '=' + value)
        values[name] = value
default('AGENT_HOST', host)
default('AGENT_PORT', port)
default('AGENT_SHARED_SECRET', secrets.token_hex(32))
default('AGENT_RUN_DIR', '/run/exitpanel-agent')
default('AGENT_PLAN_FILE', '/var/lib/exitpanel-agent/plan.json')
default('REALITY_SERVER_NAME', 'www.microsoft.com')
default('REALITY_DEST', 'www.microsoft.com:443')
default('REALITY_PRIVATE_KEY', '')
fd, temporary = tempfile.mkstemp(prefix='.agent.env.', dir=os.path.dirname(path))
try:
    with os.fdopen(fd, 'w', encoding='utf-8') as output:
        output.write('\n'.join(lines) + '\n')
    os.chmod(temporary, 0o600)
    os.chown(temporary, 0, 0)
    os.replace(temporary, path)
finally:
    if os.path.exists(temporary): os.unlink(temporary)
print('http://' + ('[' + host + ']' if ':' in host else host) + ':' + str(int(port)))
PY
)" || { echo 'worker 配置校验失败，服务未被重装。' >&2; exit 1; }

id -u "$APP_NAME" >/dev/null 2>&1 || useradd --system --home-dir "$INSTALL_DIR" --create-home --shell /usr/sbin/nologin "$APP_NAME"
install -d -o root -g root -m 0755 "$INSTALL_DIR"
install -d -o "$APP_NAME" -g "$APP_NAME" -m 0700 /run/exitpanel-agent /var/lib/exitpanel-agent
install -o root -g root -m 0755 "$SCRIPT_DIR/agent.py" "$INSTALL_DIR/agent.py"
install -o root -g root -m 0644 "$SCRIPT_DIR/xray_config.py" "$INSTALL_DIR/xray_config.py"
install -o root -g root -m 0700 "$SCRIPT_DIR/exitpanel-apply" "$APPLY_HELPER"
install -d -o root -g root -m 0700 "$CONFIG_DIR/xray"
install -d -o root -g root -m 0750 /etc/sudoers.d
SUDOERS_TEMP="$(mktemp /etc/sudoers.d/.exitpanel-agent.XXXXXX)"
trap 'rm -f "${SUDOERS_TEMP:-}"' EXIT
printf '%s ALL=(root) NOPASSWD: %s\n' "$APP_NAME" "$APPLY_HELPER" >"$SUDOERS_TEMP"
chmod 0440 "$SUDOERS_TEMP"
visudo -cf "$SUDOERS_TEMP" >/dev/null
mv "$SUDOERS_TEMP" "$SUDOERS_FILE"

cat >"$SERVICE_FILE" <<EOF
[Unit]
Description=ExitPanel local SOCKS5 check worker
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$APP_NAME
Group=$APP_NAME
EnvironmentFile=$ENV_FILE
WorkingDirectory=$INSTALL_DIR
ExecStart=/usr/bin/python3 $INSTALL_DIR/agent.py
RuntimeDirectory=exitpanel-agent
RuntimeDirectoryMode=0700
Restart=on-failure
RestartSec=3
NoNewPrivileges=no
PrivateTmp=yes
ProtectHome=yes
ProtectSystem=strict
ReadWritePaths=/run/exitpanel-agent /var/lib/exitpanel-agent /etc/exitpanel/xray
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6

[Install]
WantedBy=multi-user.target
EOF
# sudo's narrow root helper needs privilege elevation; NoNewPrivileges=yes
# would make sudo unusable. Keep the root-owned helper and strict sudoers rule.
systemctl daemon-reload
systemctl enable "$APP_NAME.service"
systemctl restart "$APP_NAME.service"
HEALTHY=0
for ((attempt=1; attempt<=30; attempt++)); do
  if systemctl is-active --quiet "$APP_NAME.service" && curl --noproxy '*' -fsS --max-time 3 "$WORKER_URL/health" >/dev/null 2>&1; then
    HEALTHY=1; break
  fi
  sleep 1
done
[[ "$HEALTHY" == 1 ]] || { echo "worker 健康检查失败：journalctl -u $APP_NAME -n 80 --no-pager" >&2; exit 1; }
echo "ExitPanel 检测 worker 已启动：$WORKER_URL（仅 loopback）"
echo "检测接口：POST $WORKER_URL/v1/check"
echo "配置接口：POST $WORKER_URL/v1/config/apply"
echo "共享密钥保存在 $ENV_FILE；已保留现有密钥，不在终端输出。"
echo 'worker 健康不代表 Xray 代理已可用；Xray 二进制、REALITY 密钥及入站端口需另行配置。'
