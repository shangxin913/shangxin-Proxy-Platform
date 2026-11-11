#!/usr/bin/env python3
import json, os, re, socket, subprocess, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SOCKET = os.environ.get('UPDATE_SOCKET', '/run/exitpanel/update.sock')
STATUS = os.environ.get('UPDATE_STATUS', '/var/lib/exitpanel-agent/update-status.json')
UPDATE_CMD = '/usr/local/sbin/exitpanel-update'
VERSION_RE = re.compile(r'^v[0-9]+\.[0-9]+\.[0-9]+$')
lock = threading.Lock()

def write_status(status, version=None, message=''):
    os.makedirs(os.path.dirname(STATUS), mode=0o700, exist_ok=True)
    data = {'status': status, 'version': version, 'message': message}
    tmp = STATUS + '.tmp'
    with open(tmp, 'w') as f: json.dump(data, f, ensure_ascii=False)
    os.chmod(tmp, 0o600); os.replace(tmp, STATUS)
    return data

def read_status():
    try:
        with open(STATUS) as f: return json.load(f)
    except Exception: return {'status': 'idle', 'version': None, 'message': ''}

def run_update(version):
    if not VERSION_RE.fullmatch(version): return
    with lock:
        write_status('installing', version, '正在下载并校验固定版本')
        try:
            result = subprocess.run([UPDATE_CMD, version], capture_output=True, text=True, timeout=1800, check=False)
            message = (result.stdout or result.stderr or '').strip()[-1200:]
            write_status('succeeded' if result.returncode == 0 else 'failed', version, message)
        except Exception as exc: write_status('failed', version, str(exc)[:500])

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_): pass
    def send_json(self, code, data):
        body = json.dumps(data, ensure_ascii=False).encode(); self.send_response(code); self.send_header('Content-Type','application/json'); self.send_header('Content-Length',str(len(body))); self.end_headers(); self.wfile.write(body)
    def do_GET(self):
        if self.path == '/status': self.send_json(200, read_status())
        else: self.send_json(404, {'error':'not_found'})
    def do_POST(self):
        if self.path != '/update': self.send_json(404, {'error':'not_found'}); return
        try:
            length = int(self.headers.get('Content-Length','0'))
            data = json.loads(self.rfile.read(length))
            version = data.get('version','')
            if not VERSION_RE.fullmatch(version): raise ValueError('invalid_version')
            current = read_status()
            if current.get('status') == 'installing': self.send_json(409, current); return
            threading.Thread(target=run_update, args=(version,), daemon=True).start()
            self.send_json(202, {'status':'installing','version':version})
        except Exception as exc: self.send_json(400, {'error':str(exc)})

class UnixServer(ThreadingHTTPServer): address_family = socket.AF_UNIX
if os.path.exists(SOCKET): os.unlink(SOCKET)
os.makedirs(os.path.dirname(SOCKET), mode=0o755, exist_ok=True)
server = UnixServer(SOCKET, Handler); os.chmod(SOCKET, 0o660)
write_status('idle')
server.serve_forever()
