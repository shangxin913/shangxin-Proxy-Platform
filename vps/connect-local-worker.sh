#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="${EXITPANEL_INSTALL_DIR:-}"
PUBLIC_HOST="${EXITPANEL_PUBLIC_HOST:-}"
REPLACE_WORKER=0
CONFIGURE_ONLY=0
usage() {
  cat <<'EOF'
ExitPanel 同机 worker 接入/快修（root，Debian/Ubuntu + systemd）
用法：sudo bash vps/connect-local-worker.sh [选项]
  --dir PATH         面板安装目录；默认读取 /etc/exitpanel/install-dir，否则 /opt/exitpanel
  --host IP          显式客户端公网 IP（支持 NAT / IPv6，不接受域名）
  --replace-worker   明确允许替换已配置的非 loopback / 远程 worker
  --configure-only   安装并检查 worker、同步配置，不启动/重建 app（主部署器使用）
  --help, -h         显示帮助，无需 root

从本脚本同目录使用 install.sh / install-xray.sh / agent.py / xray_config.py / exitpanel-apply。
保留数据库、管理密码、旧 AGENT_SHARED_SECRET 及其它环境变量；不 source dotenv。
默认重建 app 并等待本机 Unix socket 和 worker 健康；不会公开 worker 端口。
接入成功会同时安装/启动 Xray；VLESS 入站在面板点击“生成并应用节点”后写入。
EOF
}
die() { printf '[ExitPanel][ERROR] %s\n' "$*" >&2; exit 1; }
need_value() { [[ $# -ge 2 && -n "$2" && "$2" != --* ]] || die "$1 缺少值"; }
while (($#)); do
  case "$1" in
    --dir) need_value "$@"; INSTALL_DIR="$2"; shift 2 ;;
    --host) need_value "$@"; PUBLIC_HOST="$2"; shift 2 ;;
    --replace-worker) REPLACE_WORKER=1; shift ;;
    --configure-only) CONFIGURE_ONLY=1; shift ;;
    --help|-h) usage; exit 0 ;;
    *) die "未知参数：$1" ;;
  esac
done
[[ "$(id -u)" == 0 ]] || die '请以 root 执行。'
if [[ -z "$INSTALL_DIR" ]]; then
  if [[ -f /etc/exitpanel/install-dir ]]; then
    IFS= read -r INSTALL_DIR </etc/exitpanel/install-dir || true
  else
    INSTALL_DIR=/opt/exitpanel
  fi
fi
[[ "$INSTALL_DIR" =~ ^/[A-Za-z0-9_./-]+$ && "$INSTALL_DIR" != / ]] || die '--dir 必须是安全的绝对目录'
INSTALL_DIR="$(realpath -m "$INSTALL_DIR")"
[[ "$INSTALL_DIR" != / ]] || die '不能使用根目录'
for file in install.sh agent.py xray_config.py exitpanel-apply install-xray.sh; do
  [[ -f "$SCRIPT_DIR/$file" ]] || die "缺少同版本文件：$SCRIPT_DIR/$file；请下载整个 v1.0.6 的 vps 目录，不能只下载本脚本"
done
for dependency in python3 curl systemctl; do
  command -v "$dependency" >/dev/null || die "缺少 $dependency；请先安装该依赖"
done
[[ -f "$INSTALL_DIR/.env.production" && ! -L "$INSTALL_DIR/.env.production" ]] || die '未找到普通生产环境文件；请先部署面板/恢复旧配置'
[[ "$CONFIGURE_ONLY" == 1 || -f "$INSTALL_DIR/docker-compose.prod.yml" ]] || die '缺少生产 Compose 文件'
if [[ "$CONFIGURE_ONLY" != 1 ]]; then
  command -v docker >/dev/null || die '缺少 Docker'
  unset DOCKER_CONTEXT
  export DOCKER_HOST=unix:///var/run/docker.sock
  docker compose version >/dev/null || die '需要 Docker Compose v2'
fi
TMP_DIR="$(mktemp -d -t exitpanel-worker-connect.XXXXXX)"
trap 'rm -rf "$TMP_DIR"' EXIT
export INSTALL_DIR PUBLIC_HOST REPLACE_WORKER EXITPANEL_INSTALL_DIR="$INSTALL_DIR"
# A temporary helper keeps the same strict data-only parser for preflight/sync.
cat >"$TMP_DIR/config.py" <<'PY'
import ipaddress, os, re, sys, tempfile
from urllib.parse import urlsplit
root = '/etc/exitpanel'
path = os.path.join(os.environ['INSTALL_DIR'], '.env.production')
def fail(message): raise SystemExit(message)
def parse(filename, systemd=False):
    lines = open(filename, encoding='utf-8').read().splitlines()
    values, indices = {}, {}
    for i, line in enumerate(lines):
        if not line.strip() or line.lstrip().startswith(('#', ';')): continue
        match = re.fullmatch(r'\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)', line)
        if not match: fail('环境文件必须是单行 KEY=VALUE 格式；不会作为 shell 执行')
        name, raw = match[1], match[2].strip()
        if name in values: fail('环境文件存在重复变量：' + name)
        if raw.startswith(("'", '"')):
            if len(raw) < 2 or raw[-1] != raw[0]: fail('环境文件不支持多行或不完整引号')
            quote, raw = raw[0], raw[1:-1]
            if quote == "'" and not systemd: raw = raw.replace("\\'", "'")
            elif quote == '"':
                if systemd: raw = re.sub(r'\\([\\"`$])', r'\1', raw)
                else: raw = re.sub(r'\\([nrt\\"])', lambda m: {'n':'\n','r':'\r','t':'\t','\\':'\\','"':'"'}[m[1]], raw)
        elif not systemd: raw = re.split(r'\s+#', raw, maxsplit=1)[0].strip()
        if any(c in raw for c in '\n\r\0'): fail('环境变量必须是单行')
        values[name], indices[name] = raw, i
    return lines, values, indices
def ip(value):
    try: return str(ipaddress.ip_address(value.strip('[]')))
    except ValueError: return ''
for record in ('install-dir', 'local-worker-panel-dir'):
    filename = os.path.join(root, record)
    if os.path.exists(filename):
        recorded = open(filename, encoding='utf-8').read().strip()
        if not recorded.startswith('/') or os.path.realpath(recorded) != os.path.realpath(os.environ['INSTALL_DIR']):
            fail('本机固定 worker/面板服务已属于另一个安装目录；仅支持一台 VPS 一个面板，拒绝覆盖')
lines, values, indices = parse(path)
old_url = values.get('EXITPANEL_WORKER_URL', '')
if old_url:
    try:
        parsed = urlsplit(old_url)
        local = parsed.scheme in ('http', 'https') and parsed.hostname in ('localhost', '127.0.0.1', '::1') and not parsed.username and not parsed.password
        _ = parsed.port
    except ValueError: local = False
    if not local and os.environ['REPLACE_WORKER'] != '1':
        fail('已配置非 loopback/远程 worker；未作任何服务安装，请确认后使用 --replace-worker 明确替换')
explicit = os.environ.get('PUBLIC_HOST', '')
if explicit and not ip(explicit): fail('--host / EXITPANEL_PUBLIC_HOST 必须是 IP，不能使用管理域名')
if sys.argv[1] == 'preflight':
    print(ip(explicit))
    sys.exit(0)
if sys.argv[1] == 'fallback':
    print(ip(values.get('EXITPANEL_PUBLIC_HOST', '')) or ip(values.get('EXITPANEL_ENTRY_HOST', '')))
    sys.exit(0)
agent_path = os.path.join(root, 'agent.env')
if os.path.islink(agent_path): fail('agent.env 不能是符号链接')
_, agent, _ = parse(agent_path, systemd=True)
host = agent.get('AGENT_HOST', '127.0.0.1')
if host not in ('localhost', '127.0.0.1', '::1'): fail('AGENT_HOST 必须为 loopback；拒绝开放 worker')
port = agent.get('AGENT_PORT', '18443')
if not port.isascii() or not port.isdigit() or not 1 <= int(port) <= 65535: fail('AGENT_PORT 必须为 1-65535')
secret = agent.get('AGENT_SHARED_SECRET', '')
if not secret: fail('AGENT_SHARED_SECRET 缺失；不会同步空密钥')
url = 'http://' + ('[' + host + ']' if ':' in host else host) + ':' + str(int(port))
if sys.argv[1] == 'url':
    print(url)
    sys.exit(0)
public_host = ip(explicit)
if not public_host: fail('无法检测公网 IP；请使用 --host VPS公网IP，不能将管理域名当客户端入口')
def set_value(name, value):
    rendered = name + "='" + value.replace("'", "\\'") + "'"
    if name in indices: lines[indices[name]] = rendered
    else: indices[name] = len(lines); lines.append(rendered)
set_value('EXITPANEL_WORKER_URL', url)
set_value('EXITPANEL_WORKER_SHARED_SECRET', secret)
set_value('EXITPANEL_PUBLIC_HOST', public_host)
set_value('EXITPANEL_ENTRY_HOST', public_host)
fd, temporary = tempfile.mkstemp(prefix='.env.production.', dir=os.path.dirname(path))
try:
    with os.fdopen(fd, 'w', encoding='utf-8') as output: output.write('\n'.join(lines) + '\n')
    os.chmod(temporary, 0o600)
    os.chown(temporary, 0, 0)
    os.replace(temporary, path)
finally:
    if os.path.exists(temporary): os.unlink(temporary)
print(url)
PY
PUBLIC_HOST="$(python3 "$TMP_DIR/config.py" preflight)" || die '接入预检查失败，未安装/替换 worker'
if [[ -z "$PUBLIC_HOST" ]]; then
  PUBLIC_HOST="$(curl --noproxy '*' -4fsS --proto '=https' --connect-timeout 3 --max-time 8 https://api.ipify.org 2>/dev/null || true)"
  [[ -n "$PUBLIC_HOST" ]] || PUBLIC_HOST="$(curl --noproxy '*' -6fsS --proto '=https' --connect-timeout 3 --max-time 8 https://api6.ipify.org 2>/dev/null || true)"
  if [[ -z "$PUBLIC_HOST" ]]; then
    PUBLIC_HOST="$(python3 "$TMP_DIR/config.py" fallback)" || die '无法读取旧入口 IP'
    [[ -z "$PUBLIC_HOST" ]] || printf '[ExitPanel][WARN] 当前公网 IP 检测失败，暂用旧 IP %s；请确认或显式指定 --host 公网IP。\n' "$PUBLIC_HOST" >&2
  fi
fi
export PUBLIC_HOST
# Validate detected IP before installing services; never fall back to a domain.
python3 "$TMP_DIR/config.py" preflight >/dev/null || die '无法取得有效公网 IP；请使用 --host'
[[ -n "$PUBLIC_HOST" ]] || die '公网 IP 检测失败；请使用 --host VPS公网IP'
bash "$SCRIPT_DIR/install.sh"
WORKER_URL="$(python3 "$TMP_DIR/config.py" url)" || die 'worker 配置校验失败'
curl --noproxy '*' -fsS --max-time 5 "$WORKER_URL/health" >/dev/null || die 'worker 健康检查失败，未同步面板配置'
WORKER_URL="$(python3 "$TMP_DIR/config.py" sync)" || die '同步失败；未输出任何密钥'
printf '%s\n' "$INSTALL_DIR" >/etc/exitpanel/local-worker-panel-dir
chmod 0600 /etc/exitpanel/local-worker-panel-dir
chown root:root /etc/exitpanel/local-worker-panel-dir
printf '[ExitPanel] 已安全同步本机 worker URL/HMAC；客户端入口 IP：%s\n' "$PUBLIC_HOST"
if [[ "$CONFIGURE_ONLY" == 1 ]]; then
  echo '[ExitPanel] worker 健康通过；--configure-only 未启动 app，主部署器仍需等待应用健康。'
  exit 0
fi
cd "$INSTALL_DIR"
docker compose --env-file .env.production -f docker-compose.prod.yml config --quiet
docker compose --env-file .env.production -f docker-compose.prod.yml up -d app
HEALTHY=0
for ((attempt=1; attempt<=90; attempt++)); do
  if curl --noproxy '*' -fsS --max-time 3 --unix-socket /run/exitpanel/app.sock http://localhost/api/health >/dev/null 2>&1 && curl --noproxy '*' -fsS --max-time 3 "$WORKER_URL/health" >/dev/null 2>&1; then
    HEALTHY=1; break
  fi
  sleep 2
done
[[ "$HEALTHY" == 1 ]] || die 'app/worker 健康检查未通过；请检查 app 日志和 journalctl -u exitpanel-agent（分享前遮蔽凭据）'
echo '[ExitPanel] app 和本机 worker 健康通过，已接入真实检测 worker；不是模拟检测。'
echo '[ExitPanel] Xray/REALITY 已初始化；请在面板“订阅与入口”点击“生成并应用节点”，再放行实际 VLESS 端口。'
