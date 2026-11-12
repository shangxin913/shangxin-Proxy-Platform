#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
[[ "$(id -u)" == 0 ]] || { echo 'install-xray.sh 必须由 root 执行' >&2; exit 1; }
command -v curl >/dev/null || { echo '缺少 curl' >&2; exit 1; }
command -v systemctl >/dev/null || { echo '需要 systemd' >&2; exit 1; }
CONFIG_DIR=/usr/local/etc/xray
CONFIG="$CONFIG_DIR/config.json"
ENV_FILE=/etc/exitpanel/agent.env
INSTALLER_SHA=1bce9c3a9630d72521643159080017d1c001bc71
TMP=$(mktemp -d -t exitpanel-xray.XXXXXX); trap 'rm -rf "$TMP"' EXIT
curl -fLsS --proto '=https' --proto-redir '=https' --connect-timeout 10 --max-time 60 "https://raw.githubusercontent.com/XTLS/Xray-install/$INSTALLER_SHA/install-release.sh" -o "$TMP/install-release.sh"
[[ -s "$TMP/install-release.sh" ]] || { echo 'Xray官方安装脚本下载为空' >&2; exit 1; }
chmod 700 "$TMP/install-release.sh"
bash -n "$TMP/install-release.sh"
bash "$TMP/install-release.sh" install --without-geodata
XRAY=/usr/local/bin/xray
[[ -x "$XRAY" ]] || { echo 'Xray安装后未找到 /usr/local/bin/xray' >&2; exit 1; }
install -d -o root -g xray -m 0750 "$CONFIG_DIR"
if [[ -s "$CONFIG" && ! -f /etc/exitpanel/xray-managed ]]; then
  cp -a "$CONFIG" "$CONFIG.exitpanel-preexisting.$(date +%s)"
  echo '检测到未由 ExitPanel 管理的 Xray 配置，已备份并停止；请人工核对后删除旧配置标记再重试。' >&2
  exit 1
fi
if [[ ! -s "$CONFIG" || ! -f /etc/exitpanel/xray-managed ]]; then
  KEY_OUTPUT="$($XRAY x25519 2>&1 | tr -d '\r')"
  PRIVATE="$(printf '%s\n' "$KEY_OUTPUT" | sed -nE 's/^[[:space:]]*(Private key|PrivateKey)[[:space:]]*:[[:space:]]*([^[:space:]]+).*$/\2/p' | head -n 1)"
  # Xray v26 renamed the public-key field to Password; it is still the
  # client-facing REALITY public key. Older releases print Public key.
  PUBLIC="$(printf '%s\n' "$KEY_OUTPUT" | sed -nE 's/^[[:space:]]*(Public key|PublicKey|Password)[[:space:]]*:[[:space:]]*([^[:space:]]+).*$/\2/p' | head -n 1)"
  if [[ -z "$PUBLIC" && -n "$PRIVATE" ]]; then
    DERIVED_OUTPUT="$($XRAY x25519 -i "$PRIVATE" 2>&1 | tr -d '\r')"
    PUBLIC="$(printf '%s\n' "$DERIVED_OUTPUT" | sed -nE 's/^[[:space:]]*(Public key|PublicKey|Password)[[:space:]]*:[[:space:]]*([^[:space:]]+).*$/\2/p' | head -n 1)"
  fi
  if [[ ! "$PRIVATE" =~ ^[A-Za-z0-9_-]+$ || ! "$PUBLIC" =~ ^[A-Za-z0-9_-]+$ ]]; then
    printf 'REALITY密钥生成失败：xray输出未识别（private长度=%s，public长度=%s）\n' "${#PRIVATE}" "${#PUBLIC}" >&2
    exit 1
  fi
  SHORT_ID="$(openssl rand -hex 8)"
  python3 - "$ENV_FILE" "$PRIVATE" "$PUBLIC" "$SHORT_ID" <<'PY'
import os, re, sys, tempfile
path, private, public, short_id = sys.argv[1:]
lines = open(path, encoding='utf-8').read().splitlines() if os.path.exists(path) else []
values = {}
for line in lines:
    m = re.fullmatch(r'([A-Za-z_][A-Za-z0-9_]*)=(.*)', line)
    if m: values[m[1]] = m[2].strip().strip("'").strip('"')
def setv(name, value):
    global lines
    rendered = name + "='" + value.replace("'", "\\'") + "'"
    for i, line in enumerate(lines):
        if re.match(r'^' + re.escape(name) + r'=', line): lines[i] = rendered; return
    lines.append(rendered)
setv('REALITY_PRIVATE_KEY', private); setv('REALITY_PUBLIC_KEY', public); setv('REALITY_SHORT_ID', short_id)
setv('REALITY_SERVER_NAME', values.get('REALITY_SERVER_NAME') or 'www.microsoft.com')
setv('REALITY_DEST', values.get('REALITY_DEST') or 'www.microsoft.com:443')
fd, tmp = tempfile.mkstemp(prefix='.agent.env.', dir=os.path.dirname(path))
with os.fdopen(fd, 'w') as out: out.write('\n'.join(lines) + '\n')
os.chmod(tmp, 0o600); os.chown(tmp, 0, 0); os.replace(tmp, path)
PY
if [[ -n "${EXITPANEL_INSTALL_DIR:-}" && -f "$EXITPANEL_INSTALL_DIR/.env.production" ]]; then
  PUBLIC="$PUBLIC" SHORT_ID="$SHORT_ID" SERVER_NAME="${REALITY_SERVER_NAME:-www.microsoft.com}" python3 - "$EXITPANEL_INSTALL_DIR/.env.production" <<'PY2'
import os, re, sys, tempfile
path = sys.argv[1]
lines = open(path, encoding="utf-8").read().splitlines()
for name, value in (("EXITPANEL_REALITY_PUBLIC_KEY", os.environ["PUBLIC"]), ("EXITPANEL_REALITY_SHORT_ID", os.environ["SHORT_ID"]), ("EXITPANEL_REALITY_SERVER_NAME", os.environ["SERVER_NAME"])):
    rendered = name + "='" + value.replace("'", "\\'") + "'"
    for i, line in enumerate(lines):
        if re.match(r"^" + re.escape(name) + r"=", line):
            lines[i] = rendered
            break
    else: lines.append(rendered)
fd, tmp = tempfile.mkstemp(prefix=".env.production.", dir=os.path.dirname(path))
with os.fdopen(fd, "w") as out: out.write("\n".join(lines) + "\n")
os.chmod(tmp, 0o600); os.chown(tmp, 0, 0); os.replace(tmp, path)
PY2
fi
cat > "$CONFIG" <<'JSON'
{"log":{"loglevel":"warning"},"inbounds":[],"outbounds":[{"tag":"direct","protocol":"freedom","settings":{}},{"tag":"block","protocol":"blackhole","settings":{}}],"routing":{"rules":[{"type":"field","network":"udp","outboundTag":"block"},{"type":"field","ip":["geoip:private"],"outboundTag":"block"}]}}
JSON
printf '%s\n' managed > /etc/exitpanel/xray-managed
fi
chown root:xray "$CONFIG"; chmod 0640 "$CONFIG"
"$XRAY" run -test -config "$CONFIG"
systemctl enable --now xray.service
systemctl restart xray.service
systemctl is-active --quiet xray.service || { journalctl -u xray -n 30 --no-pager >&2 || true; exit 1; }
echo "Xray 已安装并启动；REALITY 公钥和 shortId 已写入受限配置。"
