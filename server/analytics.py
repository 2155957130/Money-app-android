"""Local website server with anonymous page and APK request counts."""
import base64
import binascii
import hmac
import html
import os
import sqlite3
from contextlib import closing
from datetime import datetime, timedelta, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"
DATA = Path(os.environ.get("MONEY_STATS_DB", ROOT / "server" / "data" / "stats.sqlite3"))
CN_TIME = timezone(timedelta(hours=8))
MIMES = {".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
         ".svg": "image/svg+xml", ".apk": "application/vnd.android.package-archive"}


def connect():
    DATA.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DATA, timeout=10)
    con.execute("PRAGMA busy_timeout=10000")
    con.execute("CREATE TABLE IF NOT EXISTS daily (day TEXT, kind TEXT, item TEXT, count INTEGER NOT NULL, PRIMARY KEY(day,kind,item))")
    return con


def record(kind, item):
    day = datetime.now(CN_TIME).date().isoformat()
    with closing(connect()) as con:
        with con:
            con.execute("INSERT INTO daily VALUES(?,?,?,1) ON CONFLICT(day,kind,item) DO UPDATE SET count=count+1", (day, kind, item))


def report():
    day = datetime.now(CN_TIME).date()
    with closing(connect()) as con:
        totals = dict(con.execute("SELECT kind,SUM(count) FROM daily GROUP BY kind"))
        today = dict(con.execute("SELECT kind,SUM(count) FROM daily WHERE day=? GROUP BY kind", (day.isoformat(),)))
        week = dict(con.execute("SELECT kind,SUM(count) FROM daily WHERE day>=? GROUP BY kind", ((day-timedelta(days=6)).isoformat(),)))
        daily = con.execute("SELECT day,SUM(CASE WHEN kind='view' THEN count ELSE 0 END),SUM(CASE WHEN kind='download' THEN count ELSE 0 END) FROM daily GROUP BY day ORDER BY day DESC LIMIT 30").fetchall()
        files = con.execute("SELECT item,SUM(count) FROM daily WHERE kind='download' GROUP BY item ORDER BY SUM(count) DESC").fetchall()
    return totals, today, week, daily, files


class Handler(BaseHTTPRequestHandler):
    server_version = "MoneySite/1.0"

    def log_message(self, format, *args):
        # Do not write visitor addresses to application logs.
        pass

    def respond(self, status, data, mime="text/html; charset=utf-8", extra=None):
        body = data.encode("utf-8") if isinstance(data, str) else data
        self.send_response(status)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "no-store" if self.path.startswith("/admin") or mime.startswith("text/html") else "public, max-age=3600")
        for key, value in (extra or {}).items():
            self.send_header(key, value)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def authorized(self):
        try:
            scheme, encoded = self.headers.get("Authorization", "").split(" ", 1)
            supplied = base64.b64decode(encoded, validate=True).decode("utf-8")
            expected = self.server.admin_user + ":" + self.server.admin_password
            return scheme.lower() == "basic" and hmac.compare_digest(supplied, expected)
        except (ValueError, UnicodeError, binascii.Error):
            return False

    def do_HEAD(self):
        self.route(head=True)

    def do_GET(self):
        self.route(head=False)

    def route(self, head):
        path = urlsplit(self.path).path
        if path in ("/admin", "/admin/"):
            if not self.authorized():
                self.respond(HTTPStatus.UNAUTHORIZED, "需要管理员账号", extra={"WWW-Authenticate": 'Basic realm="Money Dashboard", charset="UTF-8"'})
            else:
                self.dashboard()
            return
        if path not in ("/", "/index.html", "/style.css", "/favicon.svg") and not path.startswith("/downloads/"):
            self.respond(HTTPStatus.NOT_FOUND, "未找到页面")
            return
        relative = "index.html" if path == "/" else unquote(path.lstrip("/"))
        target = (DOCS / relative).resolve()
        if not target.is_relative_to(DOCS.resolve()) or not target.is_file() or target.suffix not in MIMES:
            self.respond(HTTPStatus.NOT_FOUND, "未找到文件")
            return
        if not head and target.suffix == ".html":
            record("view", "homepage")
        if not head and target.suffix == ".apk":
            record("download", target.name)
        extra = {"Content-Disposition": f'attachment; filename="{target.name}"'} if target.suffix == ".apk" else None
        self.respond(HTTPStatus.OK, target.read_bytes(), MIMES[target.suffix], extra)

    def dashboard(self):
        totals, today, week, daily, files = report()
        def card(title, kind):
            return f'<div class="card"><span>{title}</span><strong>{totals.get(kind,0):,}</strong><small>今日 {today.get(kind,0):,} · 近 7 天 {week.get(kind,0):,}</small></div>'
        rows = ''.join(f'<tr><td>{html.escape(day)}</td><td>{views:,}</td><td>{downloads:,}</td></tr>' for day, views, downloads in daily)
        file_rows = ''.join(f'<tr><td>{html.escape(name)}</td><td>{amount:,}</td></tr>' for name, amount in files)
        ratio = totals.get("download", 0) / max(totals.get("view", 0), 1) * 100
        style = """<style>*{box-sizing:border-box}body{margin:0;background:#f7f8f2;color:#233c31;font:15px/1.6 system-ui,'Microsoft YaHei',sans-serif}main{max-width:1040px;margin:auto;padding:38px 22px}h1{font-size:30px;margin:0}h2{font-size:19px;margin:30px 0 12px}p,small{color:#6e7d70}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin:26px 0}.card,.panel{background:#fff;border:1px solid #e4eadd;border-radius:20px;padding:22px}.card span,.card small{display:block}.card strong{display:block;font-size:34px;margin:6px 0}.panels{display:grid;grid-template-columns:1.5fr 1fr;gap:15px}table{width:100%;border-collapse:collapse}th,td{text-align:left;border-bottom:1px solid #e9eee5;padding:10px 5px;font-size:13px}th{color:#738375}td:not(:first-child),th:not(:first-child){text-align:right}@media(max-width:700px){.grid,.panels{grid-template-columns:1fr}}</style>"""
        page = '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Money 管理后台</title>'+style+'<main><h1>Money · 数据概览</h1><p>北京时间统计；仅统计由本服务器提供的网站和安装包。</p><div class="grid">'+card('总浏览量','view')+card('总下载量','download')+f'<div class="card"><span>下载 / 浏览</span><strong>{ratio:.1f}%</strong><small>仅供参考</small></div></div><div class="panels"><section class="panel"><h2>最近 30 天</h2><table><tr><th>日期</th><th>浏览</th><th>下载</th></tr>'+(rows or '<tr><td colspan="3">暂无数据</td></tr>')+'</table></section><section class="panel"><h2>安装包下载</h2><table><tr><th>文件</th><th>次数</th></tr>'+(file_rows or '<tr><td colspan="2">暂无数据</td></tr>')+'</table></section></div><p>浏览量是首页请求数，下载量是 APK 请求数；不代表独立访客或安装人数。旧站点及其他下载渠道的数据不会自动汇入。</p></main></html>'
        self.respond(HTTPStatus.OK, page, extra={"X-Frame-Options": "DENY"})


def main():
    user = os.environ.get("MONEY_ADMIN_USER", "admin")
    password = os.environ.get("MONEY_ADMIN_PASSWORD", "")
    if not user or len(password) < 12:
        raise SystemExit("Set MONEY_ADMIN_PASSWORD to a strong 12+ character password")
    host = os.environ.get("MONEY_HOST", "127.0.0.1")
    port = int(os.environ.get("MONEY_PORT", "8080"))
    with closing(connect()):
        pass
    server = ThreadingHTTPServer((host, port), Handler)
    server.admin_user = user
    server.admin_password = password
    print(f"Money website listening on http://{host}:{port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
