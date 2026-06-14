#!/usr/bin/env python3
"""Tiny static server that disables caching — for local demo testing only.

`python -m http.server` sends no cache headers, so Chrome heuristically caches
JS/SVG and serves stale files on reload (you change a file, reload, see the old
one). This serves everything with `Cache-Control: no-store` so every reload
fetches fresh. Usage: python scripts/nocache_server.py [port]
"""
import http.server
import socketserver
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8753


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(("", PORT), NoCacheHandler) as httpd:
    print(f"no-cache server on http://localhost:{PORT}")
    httpd.serve_forever()
