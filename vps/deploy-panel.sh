#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

APP_NAME="exitpanel"
INSTALL_DIR="${EXITPANEL_INSTALL_DIR:-/opt/exitpanel}"
REPO_URL="https://github.com/shangxin913/shangxin-Proxy-Platform.git"
BRANCH="v1.0.6"
# Resolve the selected Git tag to its own commit, never track main implicitly.
SKIP_WORKER=0
REPLACE_WORKER=0
WORKER_URL=""
DOMAIN="${EXITPANEL_DOMAIN:-}"
ADMIN_EMAIL="${EXITPANEL_ADMIN_EMAIL:-}"
ADMIN_PORT="${EXITPANEL_ADMIN_PORT:-8899}"
ADMIN_LISTEN="${EXITPANEL_ADMIN_LISTEN:-0.0.0.0}"
PUBLIC_HOST="${EXITPANEL_PUBLIC_HOST:-}"
DOMAIN_GIVEN=0
[[ -z "$DOMAIN" ]] || DOMAIN_GIVEN=1

log() { printf '[ExitPanel] %s\n' "$*"; }
warn() { printf '[ExitPanel][WARN] %s\n' "$*" >&2; }
die() { printf '[ExitPanel][ERROR] %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
ExitPanel v1.0.6 生产部署（默认安装并接入本机真实检测 worker）
用法：sudo bash deploy-panel.sh [选项]

  --repo URL       Git 仓库，默认 https://github.com/shangxin913/shangxin-Proxy-Platform.git
  --branch NAME    Git tag/分支，默认固定 tag v1.0.6（不会跟随 main）
  --skip-worker    不安装/接入本机 worker；未另配真实 worker 时检测不可用，不会 mock
  --replace-worker 明确允许用本机 worker 替换已有远程 worker
  --dir PATH       安装目录，默认 /opt/exitpanel
  --port PORT      首次初始化管理端口，默认 8899
  --listen ADDR    首次初始化监听 IP，默认 0.0.0.0
  --host IP        显式公网 IP（支持 NAT/IPv6）；默认 ipify 检测，不取管理域名
  --domain NAME    可选：Nginx 80/443 经 Unix socket 代理管理面板
  --email EMAIL    可选：Let's Encrypt 邮箱；提供域名和邮箱才自动申请 HTTPS
  --help, -h      显示帮助（无需 root）

默认从 v1.0.6 tag 解析并校验完整 Git SHA，后续拒绝该 tag 被移动。
默认在 app 启动前安装健康的 loopback worker 并安全同步 HMAC；不公开 18443。
本机固定 worker/Compose 服务只支持一个面板；不同 --dir 冲突时停止。
无需 MANUS_PROJECT_ID 或 Manus OAuth。首次随机生成管理路径和强密码。
重复安装保留 .env.production 的密钥、MySQL 密码及数据库管理设置。
后续 port/listen/path/password 请在管理面板修改，而非重复安装参数。
EXITPANEL_PUBLIC_ORIGIN 可指定完整 origin（例如 https://panel.example.com）。
防火墙与服务商安全组只给出提示，不自动修改/启用 UFW。
EOF
}

need_value() { [[ $# -ge 2 && -n "$2" && "$2" != --* ]] || die "$1 缺少值"; }
while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo) need_value "$@"; REPO_URL="$2"; shift 2 ;;
    --branch) need_value "$@"; BRANCH="$2"; shift 2 ;;
    --skip-worker) SKIP_WORKER=1; shift ;;
    --replace-worker) REPLACE_WORKER=1; shift ;;
    --domain) need_value "$@"; DOMAIN="$2"; DOMAIN_GIVEN=1; shift 2 ;;
    --email) need_value "$@"; ADMIN_EMAIL="$2"; shift 2 ;;
    --dir) need_value "$@"; INSTALL_DIR="$2"; shift 2 ;;
    --port) need_value "$@"; ADMIN_PORT="$2"; shift 2 ;;
    --listen) need_value "$@"; ADMIN_LISTEN="$2"; shift 2 ;;
    --host) need_value "$@"; PUBLIC_HOST="$2"; shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) die "未知参数：$1" ;;
  esac
done

[[ "$(id -u)" == "0" ]] || die "请使用 root 执行：sudo bash deploy-panel.sh ..."
[[ "$ADMIN_PORT" =~ ^[0-9]{1,5}$ ]] && (( 10#$ADMIN_PORT >= 1024 && 10#$ADMIN_PORT <= 65535 )) || die "--port 必须是 1024-65535"
ADMIN_PORT="$((10#$ADMIN_PORT))"
[[ -n "$REPO_URL" ]] || die "必须提供 --repo；VPS 不能访问 Manus Sandbox 内部 Git 远端"
[[ "$REPO_URL" != -* && "$BRANCH" =~ ^[A-Za-z0-9_./-]+$ && "$BRANCH" != -* ]] || die "仓库或分支参数无效"
[[ "$INSTALL_DIR" =~ ^/[A-Za-z0-9_./-]+$ && "$INSTALL_DIR" != / ]] || die "--dir 须为不含空格的绝对路径，且不能为 /"
INSTALL_DIR="$(realpath -m "$INSTALL_DIR")"
[[ "$INSTALL_DIR" != / ]] || die "不能安装到 /"
# A different directory would overwrite global systemd/CLI and local worker.
for RECORD in /etc/exitpanel/install-dir /etc/exitpanel/local-worker-panel-dir; do
  if [[ -f "$RECORD" ]]; then
    IFS= read -r RECORDED_DIR <"$RECORD" || true
    [[ "$RECORDED_DIR" == /* && "$(realpath -m "$RECORDED_DIR")" == "$INSTALL_DIR" ]] || die "本机面板/worker 已属于另一目录；仅支持单台一个面板，拒绝覆盖 $RECORD"
  fi
done
command -v apt-get >/dev/null || die "当前脚本只支持 Debian/Ubuntu 系统"
ARCH="$(dpkg --print-architecture)"
[[ "$ARCH" == amd64 || "$ARCH" == arm64 ]] || die "本部署栈仅支持 amd64/arm64"
[[ -d /run/systemd/system ]] || die "需要使用 systemd 的 VPS；不支持普通 Docker 容器或无 systemd 系统"
command -v flock >/dev/null || die "缺少 flock，请先安装 util-linux"
exec 9>/run/lock/exitpanel-production-deploy.lock
flock -n 9 || die "已有 ExitPanel 部署在进行中，请勿重复运行"
trap 'printf "[ExitPanel][ERROR] 部署在第 %s 行停止，请检查错误，不要删除数据卷或密钥后重试。\n" "$LINENO" >&2' ERR
log "选择应用版本：$BRANCH（默认固定 tag，不会自动使用 main）"
if [[ -n "$DOMAIN" ]]; then
  [[ "$DOMAIN" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ && "$DOMAIN" == *.* ]] || die "--domain 不是有效域名"
fi
SRC_DIR="$INSTALL_DIR/src"
# Stop before dependencies or Git fetch if local source files would be lost.
if [[ -d "$SRC_DIR/.git" ]]; then
  SOURCE_STATUS="$(git -C "$SRC_DIR" status --porcelain --untracked-files=all)" || die "无法读取源码 Git 状态；请检查权限和 Git safe.directory"
  [[ -z "$SOURCE_STATUS" ]] || die "源码目录有本地修改/未跟踪文件：$SRC_DIR；请先备份并自行处理，安装器不会 reset --hard"
elif [[ -e "$SRC_DIR" ]]; then
  die "源码目录已存在但不是 Git 仓库：$SRC_DIR；请自行检查/备份，不会删除"
fi
if [[ ! -f "$INSTALL_DIR/.env.production" && ( -e "$INSTALL_DIR/docker-compose.prod.yml" || -d "$SRC_DIR/.git" ) ]]; then
  die "检测到旧安装但缺少 .env.production；请恢复原密钥/数据库密码，禁止为已有数据库自动换密码"
fi

log "安装系统依赖和 Docker（所有随机密钥在 openssl 安装后生成）"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y --no-install-recommends ca-certificates curl git openssl python3
# Always target this VPS's rootful daemon, never a caller's remote Docker host.
unset DOCKER_CONTEXT
export DOCKER_HOST=unix:///var/run/docker.sock
if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
  . /etc/os-release
  [[ "$ID" == ubuntu || "$ID" == debian ]] || die "只支持原生 Debian/Ubuntu，请先安装适合本系统的 Docker 和 Compose 插件"
  CODENAME="${UBUNTU_CODENAME:-${VERSION_CODENAME:-}}"
  [[ "$CODENAME" =~ ^[a-z]+$ ]] || die "无法确定发行版代号"
  # Compose's official apt package is not in every distribution's default repo.
  # Reuse existing Docker repo declarations rather than creating duplicates.
  if ! grep -Rsq "https://download.docker.com/linux/$ID" /etc/apt/sources.list /etc/apt/sources.list.d 2>/dev/null; then
    install -d -m 0755 /etc/apt/keyrings
    curl -fLsS --proto '=https' --proto-redir '=https' --connect-timeout 10 --max-time 60 "https://download.docker.com/linux/$ID/gpg" -o /etc/apt/keyrings/exitpanel-docker.asc
    chmod 0644 /etc/apt/keyrings/exitpanel-docker.asc
    cat >/etc/apt/sources.list.d/exitpanel-docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/$ID
Suites: $CODENAME
Components: stable
Architectures: $ARCH
Signed-By: /etc/apt/keyrings/exitpanel-docker.asc
EOF
    chmod 0644 /etc/apt/sources.list.d/exitpanel-docker.sources
  fi
  apt-get update -y
  if command -v docker >/dev/null; then
    log "保留已有 Docker 引擎，只补装 Compose/Buildx 插件"
    apt-get install -y --no-install-recommends docker-compose-plugin docker-buildx-plugin || die "插件安装失败；请先人工处理 Docker 包冲突，不会自动卸载旧引擎"
  else
    for PACKAGE in podman-docker containerd runc docker.io; do
      if [[ "$(dpkg-query -W -f='${Status}' "$PACKAGE" 2>/dev/null || true)" == 'install ok installed' ]]; then
        die "已有可能冲突的 $PACKAGE；请先人工评估，安装器不会卸载其他服务依赖"
      fi
    done
    apt-get install -y --no-install-recommends docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  fi
fi
systemctl enable --now docker
docker info >/dev/null || die "本机 Docker 引擎不可用"
docker compose version >/dev/null || die "Docker Compose 插件安装失败"

install -d -o root -g root -m 0700 "$INSTALL_DIR"
# Prefer exact tags; a version-looking ref MUST be a tag. Other branches are
# accepted only when explicitly selected via --branch.
REMOTE_REFS="$(git ls-remote "$REPO_URL" "refs/tags/$BRANCH" "refs/tags/$BRANCH^{}" "refs/heads/$BRANCH")" || die "无法读取指定仓库版本"
TAG_COMMIT="$(awk -v ref="refs/tags/$BRANCH^{}" '$2 == ref {print $1}' <<<"$REMOTE_REFS")"
TAG_OBJECT="$(awk -v ref="refs/tags/$BRANCH" '$2 == ref {print $1}' <<<"$REMOTE_REFS")"
HEAD_COMMIT="$(awk -v ref="refs/heads/$BRANCH" '$2 == ref {print $1}' <<<"$REMOTE_REFS")"
IS_TAG=0
if [[ -n "$TAG_OBJECT" ]]; then
  IS_TAG=1
  SOURCE_REF="refs/tags/$BRANCH"
  EXPECTED_COMMIT="${TAG_COMMIT:-$TAG_OBJECT}"
else
  [[ ! "$BRANCH" =~ ^v[0-9]+\.[0-9]+ ]] || die "固定版本 tag $BRANCH 尚未发布/不存在，拒绝回退 main 或同名分支"
  SOURCE_REF="refs/heads/$BRANCH"
  EXPECTED_COMMIT="$HEAD_COMMIT"
fi
[[ "$EXPECTED_COMMIT" =~ ^[0-9a-f]{40}$ ]] || die "所选版本不能解析为完整 Git SHA"
# Tags are immutable per installation. Store public source identity, not secrets.
PIN_FILE="$INSTALL_DIR/source-version.tsv"
if [[ "$IS_TAG" == 1 && -f "$PIN_FILE" ]]; then
  IFS=$'\t' read -r PIN_REPO PIN_REF PIN_SHA <"$PIN_FILE" || true
  if [[ "$PIN_REPO" == "$REPO_URL" && "$PIN_REF" == "$SOURCE_REF" ]]; then
    [[ "$PIN_SHA" == "$EXPECTED_COMMIT" ]] || die "远端 tag 被移动，与本安装已绑定 SHA 不同；拒绝部署"
  fi
fi
log "绑定版本：$SOURCE_REF @ $EXPECTED_COMMIT"
if [[ -d "$SRC_DIR/.git" ]]; then
  log "安全拉取选定版本并保留已有历史、数据库和密钥"
  [[ "$(git -C "$SRC_DIR" remote get-url origin)" == "$REPO_URL" ]] || die "已有 origin 与 --repo 不同；请人工核对，不会无声更换仓库"
  SOURCE_STATUS="$(git -C "$SRC_DIR" status --porcelain --untracked-files=all)" || die "无法读取源码状态"
  [[ -z "$SOURCE_STATUS" ]] || die "源码变为 dirty，停止升级"
  if [[ "$(git -C "$SRC_DIR" rev-parse --is-shallow-repository)" == true ]]; then
    git -C "$SRC_DIR" fetch --unshallow origin "$SOURCE_REF"
  else
    git -C "$SRC_DIR" fetch origin "$SOURCE_REF"
  fi
  FETCHED_COMMIT="$(git -C "$SRC_DIR" rev-parse 'FETCH_HEAD^{commit}')"
  [[ "$FETCHED_COMMIT" == "$EXPECTED_COMMIT" ]] || die "拉取期间远端版本改变，拒绝继续"
  CURRENT_COMMIT="$(git -C "$SRC_DIR" rev-parse HEAD)"
  if [[ "$CURRENT_COMMIT" != "$EXPECTED_COMMIT" ]]; then
    git -C "$SRC_DIR" merge-base --is-ancestor HEAD "$EXPECTED_COMMIT" || die "当前源码包含较新版本或分叉提交，拒绝降级/覆盖"
    git -C "$SRC_DIR" merge --ff-only "$EXPECTED_COMMIT" || die "不能安全 fast-forward，旧源码保留"
  fi
else
  log "克隆选定版本 $BRANCH（浅克隆）"
  git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$SRC_DIR"
fi
[[ "$(git -C "$SRC_DIR" rev-parse HEAD)" == "$EXPECTED_COMMIT" ]] || die "源码 SHA 校验失败；不启动应用"
printf '%s\t%s\t%s\n' "$REPO_URL" "$SOURCE_REF" "$EXPECTED_COMMIT" >"$PIN_FILE"
chmod 0600 "$PIN_FILE"

[[ -f "$SRC_DIR/Dockerfile" && -d "$SRC_DIR/drizzle" ]] || die "仓库缺少 Dockerfile 或 drizzle 迁移目录"
[[ -f "$SRC_DIR/vps/exitpanel" ]] || die "仓库缺少 vps/exitpanel CLI 包装，请使用支持 VPS 密码登录的版本"

# Recover an old deployment's domain so an upgrade does not leave its Nginx
# upstream pointing to a removed Docker port mapping. Never inspect secrets.
if [[ "$DOMAIN_GIVEN" == 0 && -f /etc/nginx/sites-available/exitpanel ]]; then
  OLD_DOMAIN="$(awk '$1 == "server_name" {gsub(/;/, "", $2); print $2; exit}' /etc/nginx/sites-available/exitpanel)"
  if [[ "$OLD_DOMAIN" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ && "$OLD_DOMAIN" == *.* ]]; then
    DOMAIN="$OLD_DOMAIN"
  fi
fi
PUBLIC_HOST_FALLBACK=""
if [[ -z "$PUBLIC_HOST" ]]; then
  PUBLIC_HOST_FALLBACK="$(curl --noproxy '*' -4fsS --proto '=https' --connect-timeout 3 --max-time 8 https://api.ipify.org 2>/dev/null || true)"
  if [[ -z "$PUBLIC_HOST_FALLBACK" ]]; then
    PUBLIC_HOST_FALLBACK="$(curl --noproxy '*' -6fsS --proto '=https' --connect-timeout 3 --max-time 8 https://api6.ipify.org 2>/dev/null || true)"
  fi
  [[ -n "$PUBLIC_HOST_FALLBACK" ]] || warn "公网 IP 检测失败；仅可沿用已保存的有效 IP，否则请使用 --host。不会回退管理域名。"
fi

export INSTALL_DIR DOMAIN ADMIN_PORT ADMIN_LISTEN PUBLIC_HOST PUBLIC_HOST_FALLBACK
# Safely parse dotenv as data, never source it as root shell code. Preserve all
# existing lines except runtime/routing values deliberately migrated below.
# This helper only prints PUBLIC routing fields, never credentials or .env.
PUBLIC_INFO="$(python3 - <<'PY'
import ipaddress
import os
import re
import subprocess
import tempfile
from urllib.parse import quote, urlsplit

path = os.path.join(os.environ['INSTALL_DIR'], '.env.production')
exists = os.path.isfile(path)
lines = open(path, encoding='utf-8').read().splitlines() if exists else []
values = {}
indices = {}
def decode(raw):
    raw = raw.strip()
    if raw.startswith("'"):
        if not raw.endswith("'"):
            raise ValueError('不支持多行 dotenv 值；请保留凭据并改为单行配置')
        return raw[1:-1].replace("\\'", "'")
    if raw.startswith('"'):
        if not raw.endswith('"'):
            raise ValueError('不支持多行 dotenv 值；请保留凭据并改为单行配置')
        return re.sub(r'\\([nrt\\"])', lambda m: {'n':'\n','r':'\r','t':'\t','\\':'\\','"':'"'}[m[1]], raw[1:-1])
    return re.split(r'\s+#', raw, maxsplit=1)[0].strip()
def encode(value):
    if any(c in value for c in '\n\r\0'):
        raise ValueError('生产环境值必须是单行，不能包含换行或 NUL')
    return "'" + value.replace("'", "\\'") + "'"
for i, line in enumerate(lines):
    match = re.match(r'^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$', line)
    if match:
        name = match[1]
        if name in indices:
            raise SystemExit('dotenv 存在重复变量：' + name + '；请先自行合并，避免凭据歧义')
        indices[name] = i
        values[name] = decode(match[2])
def set_value(name, value, only_missing=False):
    if only_missing and values.get(name):
        return
    rendered = name + '=' + encode(value)
    if name in indices:
        lines[indices[name]] = rendered
    else:
        indices[name] = len(lines)
        lines.append(rendered)
    values[name] = value
def default(name, fallback):
    set_value(name, os.environ.get(name) or fallback, only_missing=True)
def random_hex(size):
    return subprocess.check_output(['openssl', 'rand', '-hex', str(size)], text=True).strip()

try:
    if exists:
        for name in ('MYSQL_PASSWORD', 'MYSQL_ROOT_PASSWORD', 'MANUS_JWT_SECRET'):
            if not values.get(name):
                raise ValueError('旧配置缺少 ' + name + '；请恢复原值，不能为现有数据库重新生成')
        # Old encryptSecret used MANUS_JWT_SECRET when no dedicated key existed.
        set_value('CREDENTIAL_ENCRYPTION_KEY', values['MANUS_JWT_SECRET'], only_missing=True)
    else:
        default('MANUS_JWT_SECRET', random_hex(32))
        default('CREDENTIAL_ENCRYPTION_KEY', random_hex(32))
        default('MYSQL_PASSWORD', random_hex(24))
        default('MYSQL_ROOT_PASSWORD', random_hex(32))
    default('MYSQL_DATABASE', 'exitpanel')
    default('MYSQL_USER', 'exitpanel')
    default('DB_PORT', '13306')
    if not values['DB_PORT'].isdigit() or not 1 <= int(values['DB_PORT']) <= 65535:
        raise ValueError('DB_PORT 必须是 1-65535')
    for name in ('MYSQL_DATABASE', 'MYSQL_USER'):
        if not re.fullmatch(r'[A-Za-z0-9_]+', values[name]):
            raise ValueError(name + ' 仅支持字母、数字、下划线')
    set_value('EXITPANEL_ADMIN_PORT', os.environ['ADMIN_PORT'], only_missing=True)
    set_value('EXITPANEL_ADMIN_LISTEN', os.environ['ADMIN_LISTEN'], only_missing=True)
    if not values['EXITPANEL_ADMIN_PORT'].isdigit() or not 1024 <= int(values['EXITPANEL_ADMIN_PORT']) <= 65535:
        raise ValueError('EXITPANEL_ADMIN_PORT 必须是 1024-65535')
    if values['EXITPANEL_ADMIN_LISTEN'] != 'localhost':
        ipaddress.ip_address(values['EXITPANEL_ADMIN_LISTEN'])
    if int(values['EXITPANEL_ADMIN_PORT']) == int(values['DB_PORT']):
        raise ValueError('管理端口不能与本机 MySQL DB_PORT 相同')
    if not values.get('EXITPANEL_ADMIN_PATH'):
        set_value('EXITPANEL_ADMIN_PATH', '/' + random_hex(12))
    if not values.get('EXITPANEL_INITIAL_PASSWORD'):
        set_value('EXITPANEL_INITIAL_PASSWORD', random_hex(24))
    # The DB remains authoritative; initial_* values only bootstrap missing rows.
    set_value('NODE_ENV', 'production')
    set_value('EXITPANEL_RUNTIME', 'vps')
    set_value('EXITPANEL_ADMIN_SOCKET', '/run/exitpanel/app.sock')
    set_value('DATABASE_URL', 'mysql://' + quote(values['MYSQL_USER'], safe='') + ':' + quote(values['MYSQL_PASSWORD'], safe='') + '@127.0.0.1:' + values['DB_PORT'] + '/' + quote(values['MYSQL_DATABASE'], safe=''))
    domain = os.environ['DOMAIN'] or values.get('EXITPANEL_DOMAIN', '')
    if domain and not re.fullmatch(r'[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?', domain):
        raise ValueError('EXITPANEL_DOMAIN 无效')
    if domain:
        set_value('EXITPANEL_DOMAIN', domain)
    host = os.environ['PUBLIC_HOST'] or os.environ.get('PUBLIC_HOST_FALLBACK', '') or values.get('EXITPANEL_PUBLIC_HOST', '')
    if not host:
        raise ValueError('请提供 --host VPS公网IP，不能使用管理域名')
    try:
        host = str(ipaddress.ip_address(host.strip('[]')))
    except ValueError:
        raise ValueError('--host / EXITPANEL_PUBLIC_HOST 必须是 IP，不含协议、端口、路径或管理域名')
    set_value('EXITPANEL_PUBLIC_HOST', host)
    set_value('EXITPANEL_ENTRY_HOST', host)
    origin = os.environ.get('EXITPANEL_PUBLIC_ORIGIN') or values.get('EXITPANEL_PUBLIC_ORIGIN', '')
    if not origin and domain:
        tls = all(os.path.isfile('/etc/letsencrypt/live/' + domain + '/' + f) for f in ('fullchain.pem', 'privkey.pem'))
        origin = ('https://' if tls else 'http://') + domain
    if origin:
        parsed = urlsplit(origin)
        if parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.username or parsed.password or parsed.path not in ('', '/') or parsed.query or parsed.fragment:
            raise ValueError('EXITPANEL_PUBLIC_ORIGIN 必须为完整 HTTP(S) origin，不含路径/用户/查询')
        _ = parsed.port
        origin = origin.rstrip('/')
    set_value('EXITPANEL_PUBLIC_ORIGIN', origin)
    for name in ('EXITPANEL_WORKER_URL', 'EXITPANEL_WORKER_SHARED_SECRET'):
        default(name, '')
    fd, temporary = tempfile.mkstemp(prefix='.env.production.', dir=os.environ['INSTALL_DIR'])
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as output:
            output.write('\n'.join(lines) + '\n')
        os.chmod(temporary, 0o600)
        os.chown(temporary, 0, 0)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    print(domain)
    print(host)
    print(origin)
except (ValueError, OSError, subprocess.CalledProcessError) as error:
    # Avoid exception data that could contain a credential value.
    if isinstance(error, ValueError):
        raise SystemExit('生产配置校验失败：' + str(error))
    raise SystemExit('写入生产配置失败；原配置未被替换，请检查文件权限和 openssl')
PY
)" || die "无法安全生成/迁移生产配置"
mapfile -t PUBLIC_FIELDS <<<"$PUBLIC_INFO"
DOMAIN="${PUBLIC_FIELDS[0]:-}"
PUBLIC_HOST="${PUBLIC_FIELDS[1]:-}"
PUBLIC_ORIGIN="${PUBLIC_FIELDS[2]:-}"
chmod 0600 "$INSTALL_DIR/.env.production"
chown root:root "$INSTALL_DIR/.env.production"

if [[ "$SKIP_WORKER" == 0 ]]; then
  [[ -f "$SRC_DIR/vps/connect-local-worker.sh" ]] || die "所选版本没有同机 worker 接入工具；请使用 v1.0.6 或显式 --skip-worker"
  WORKER_ARGS=(--dir "$INSTALL_DIR" --host "$PUBLIC_HOST" --configure-only)
  [[ "$REPLACE_WORKER" == 0 ]] || WORKER_ARGS+=(--replace-worker)
  log "在 app 启动前安装/检查 loopback worker 并同步 HMAC"
  bash "$SRC_DIR/vps/connect-local-worker.sh" "${WORKER_ARGS[@]}"
  # Read public endpoint only; never print or source shared secrets.
  WORKER_URL="$(INSTALL_DIR="$INSTALL_DIR" python3 - <<'PY'
import os, re
text = open(os.path.join(os.environ['INSTALL_DIR'], '.env.production'), encoding='utf-8').read()
match = re.search(r"^EXITPANEL_WORKER_URL='([^']+)'$", text, re.M)
if not match: raise SystemExit('缺少接入工具生成的本机 worker URL')
print(match[1])
PY
)"
else
  warn "--skip-worker：未安装/接入本机 worker。未另配可用的真实 worker 时真实检测不可用，不会模拟成功。"
fi

cp "$SRC_DIR/vps/docker-compose.prod.yml" "$INSTALL_DIR/docker-compose.prod.yml"
install -m 0755 "$SRC_DIR/vps/exitpanel" /usr/local/bin/exitpanel
install -d -o root -g root -m 0700 /etc/exitpanel
printf '%s\n' "$INSTALL_DIR" >/etc/exitpanel/install-dir
chmod 0600 /etc/exitpanel/install-dir
# /run is tmpfs. Keep the shared directory traversable by Nginx after reboot;
# the Node app creates/chmods the stable app.sock to 0666.
install -d -o root -g root -m 0755 /run/exitpanel
printf 'd /run/exitpanel 0755 root root -\n' >/etc/tmpfiles.d/exitpanel.conf
cat >"$INSTALL_DIR/exitpanel-compose.service" <<EOF
[Unit]
Description=ExitPanel production stack
Requires=docker.service
After=docker.service network-online.target systemd-tmpfiles-setup.service
Wants=network-online.target

[Service]
Type=oneshot
WorkingDirectory=$INSTALL_DIR
RemainAfterExit=yes
ExecStartPre=/usr/bin/install -d -o root -g root -m 0755 /run/exitpanel
ExecStart=/usr/bin/docker compose --env-file .env.production -f docker-compose.prod.yml up -d
ExecStop=/usr/bin/docker compose --env-file .env.production -f docker-compose.prod.yml down
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
EOF
install -m 0644 "$INSTALL_DIR/exitpanel-compose.service" /etc/systemd/system/exitpanel-compose.service
systemctl daemon-reload

log "校验 Compose 并启动 MySQL / 面板；旧 app 网络模式将自动重建"
cd "$INSTALL_DIR"
# --quiet prevents dumping interpolated secrets, including on routine checks.
docker compose --env-file .env.production -f docker-compose.prod.yml config --quiet
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
systemctl enable --now exitpanel-compose.service

log "等待 Unix socket 健康检查（不依赖已被管理员修改的管理端口）"
HEALTHY=0
for (( attempt=1; attempt<=90; attempt++ )); do
  if curl --noproxy '*' -fsS --max-time 3 --unix-socket /run/exitpanel/app.sock http://localhost/api/health >/dev/null 2>&1; then
    HEALTHY=1
    break
  fi
  sleep 2
done
if [[ "$HEALTHY" != 1 ]]; then
  docker compose --env-file .env.production -f docker-compose.prod.yml ps
  die "应用健康检查失败；请执行 sudo journalctl -u exitpanel-compose 或在安装目录手动查看 app 日志（注意遮蔽凭据）"
fi

if [[ -n "$DOMAIN" ]]; then
  log "配置 Nginx 域名代理（稳定 Unix socket，不随管理端口变化）"
  apt-get install -y --no-install-recommends nginx
  install -d -m 0755 /etc/nginx/sites-available /etc/nginx/sites-enabled
  if [[ -f /etc/nginx/sites-available/exitpanel ]]; then
    cp -p /etc/nginx/sites-available/exitpanel "$INSTALL_DIR/nginx-exitpanel.previous"
  fi
  # Reuse existing certificate on upgrades instead of overwriting TLS with HTTP.
  if [[ -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" && -f "/etc/letsencrypt/live/$DOMAIN/privkey.pem" ]]; then
    NGINX_LISTEN="listen 443 ssl;
    listen [::]:443 ssl;"
    TLS_CONFIG="ssl_certificate /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;"
    cat >/etc/nginx/sites-available/exitpanel <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;
    return 301 https://\$host\$request_uri;
}
EOF
  else
    NGINX_LISTEN="listen 80;
    listen [::]:80;"
    TLS_CONFIG=""
    : >/etc/nginx/sites-available/exitpanel
  fi
  cat >>/etc/nginx/sites-available/exitpanel <<EOF
server {
    $NGINX_LISTEN
    server_name $DOMAIN;
    $TLS_CONFIG
    client_max_body_size 10m;
    location / {
        proxy_pass http://unix:/run/exitpanel/app.sock:;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 90s;
    }
}
EOF
  chmod 0644 /etc/nginx/sites-available/exitpanel
  ln -sfn /etc/nginx/sites-available/exitpanel /etc/nginx/sites-enabled/exitpanel
  nginx -t
  systemctl enable --now nginx
  systemctl reload nginx
  if [[ -n "$ADMIN_EMAIL" ]]; then
    log "尝试申请/沿用 Let's Encrypt 证书（DNS 须指向本机）"
    apt-get install -y --no-install-recommends certbot python3-certbot-nginx
    if certbot --nginx --non-interactive --agree-tos --redirect -m "$ADMIN_EMAIL" -d "$DOMAIN"; then
      # Update an automatically selected HTTP origin after successful TLS setup;
      # an explicitly configured external/reverse-proxy origin is left intact.
      if [[ "$PUBLIC_ORIGIN" == "http://$DOMAIN" && -z "${EXITPANEL_PUBLIC_ORIGIN:-}" ]]; then
        DOMAIN="$DOMAIN" python3 - <<'PY'
import os
import re
import tempfile
path = os.path.join(os.environ['INSTALL_DIR'], '.env.production')
text = open(path, encoding='utf-8').read()
text = re.sub(r'^EXITPANEL_PUBLIC_ORIGIN=.*$', "EXITPANEL_PUBLIC_ORIGIN='https://" + os.environ['DOMAIN'] + "'", text, flags=re.M)
fd, temporary = tempfile.mkstemp(prefix='.env.production.', dir=os.environ['INSTALL_DIR'])
with os.fdopen(fd, 'w', encoding='utf-8') as output:
    output.write(text)
os.chmod(temporary, 0o600)
os.chown(temporary, 0, 0)
os.replace(temporary, path)
PY
        PUBLIC_ORIGIN="https://$DOMAIN"
        docker compose --env-file .env.production -f docker-compose.prod.yml up -d app
      fi
    else
      warn "证书申请失败；请检查 DNS、80/443、防火墙及服务商安全组。未有证书时仍为 HTTP。"
    fi
  elif [[ "$PUBLIC_ORIGIN" != https://* ]]; then
    warn "未提供 --email，当前域名仅 HTTP；公网管理建议配置 HTTPS。"
  fi
else
  # Remove only this app's obsolete no-domain proxy when migrating the old
  # installer; do not enable/install Nginx or touch other sites on direct HTTP.
  if [[ -L /etc/nginx/sites-enabled/exitpanel ]]; then
    rm /etc/nginx/sites-enabled/exitpanel
    if command -v nginx >/dev/null && systemctl is-active --quiet nginx; then
      nginx -t && systemctl reload nginx
    fi
  fi
  warn "无域名模式直接使用 HTTP 管理端口。请限制可信源 IP，或配置域名 HTTPS/可信反向代理。"
fi

log "等待应用就绪并读取数据库中当前管理凭据"
READY=0
for (( attempt=1; attempt<=30; attempt++ )); do
  if curl --noproxy '*' -fsS --max-time 3 --unix-socket /run/exitpanel/app.sock http://localhost/api/health >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 2
done
[[ "$READY" == 1 ]] || die "应用未就绪；修复后使用 sudo exitpanel credentials 查看当前入口与密码"
# This explicitly requested root-only output is the DB password, not a dump of
# .env.production (which may still contain an obsolete bootstrap password).
if [[ "$SKIP_WORKER" == 0 ]]; then
  curl --noproxy '*' -fsS --max-time 5 "$WORKER_URL/health" >/dev/null || die "本机 worker 最终健康检查失败"
  log "app socket 与本机 worker 健康通过，已接入真实检测 worker（非模拟）"
  log "Xray 已安装并启动；请在面板订阅与入口页点击“生成并应用节点”写入 VLESS/REALITY 入站。"
fi
/usr/local/bin/exitpanel credentials
log "v1.0.12 部署完成；请保存上方随机入口和密码。以后 root 可再次查看/重置："
printf '  sudo exitpanel credentials\n  sudo exitpanel reset-password\n'
printf '安装目录：%s（0700）；生产配置 .env.production（root:root 0600）\n' "$INSTALL_DIR"
printf '状态：sudo systemctl status exitpanel-compose\n'
printf '日志：cd %s && sudo docker compose --env-file .env.production -f docker-compose.prod.yml logs -f app\n' "$INSTALL_DIR"
warn "不会自动修改/启用 UFW，也不会自动放行 SSH。请在现有防火墙和服务商安全组核对规则。"
if [[ -n "$DOMAIN" ]]; then
  warn "域名访问端口为 80/tcp（HTTP/证书申请）及 443/tcp（启用 HTTPS 时）；管理直连端口以 credentials 显示的 DB 当前值为准，初始默认 8899。"
else
  warn "直接接入端口是 credentials 显示的当前管理端口（初始默认 8899）；修改端口后需自行同步防火墙/服务商安全组。"
fi
warn "数据库只映射 127.0.0.1 的 DB_PORT（默认 13306），不要向公网开放。Xray/VLESS 等实际接入端口需按实际配置单独放行。"
warn "port/listen/path/password 在管理面板修改并持久化；重复安装不会覆盖。请备份数据库和 .env.production，切勿将密钥或密码提交到 Git。"
