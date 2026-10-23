"""Runs Cutroom on http://localhost:5180.

It serves the app's files and makes thumbnails for the page, free and with no account:
- /api/horde/...  AI Horde (best quality, a free shared line, usually 1 to 4 minutes)
- /api/thumb      Pollinations (fast, one picture every 45 seconds)
Asking from here, not from the web page, is what lets both work without a key or sign-in.
"""
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 5180
ROOT = os.path.dirname(os.path.abspath(__file__))
UA = 'Cutroom/1.0 (local video editor)'
HORDE = 'https://aihorde.net/api/v2'
HORDE_HEADERS = {'apikey': '0000000000', 'Client-Agent': 'Cutroom:1.0:local', 'User-Agent': UA, 'Content-Type': 'application/json'}
# family-safe models only, with the adult filter on
HORDE_MODELS = ['Juggernaut XL', 'AlbedoBase XL 3.1', 'AlbedoBase XL (SDXL)']
NEGATIVE = 'text, words, letters, watermark, logo, signature, blurry, deformed, ugly, extra fingers, nsfw, nude'
JOB_ID = re.compile(r'^[0-9a-f-]{36}$')


def fetch(url, data=None, headers=None, timeout=60):
    req = urllib.request.Request(url, data=data, headers=headers or {'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return res.read(), res.headers.get('Content-Type', '')


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def do_GET(self):
        url = urllib.parse.urlparse(self.path)
        q = urllib.parse.parse_qs(url.query)
        try:
            if url.path == '/api/thumb':
                return self.pollinations(q)
            if url.path.startswith('/api/horde/check/'):
                return self.horde_check(url.path.rsplit('/', 1)[1])
            if url.path.startswith('/api/horde/result/'):
                return self.horde_result(url.path.rsplit('/', 1)[1], int((q.get('i') or ['0'])[0]))
        except urllib.error.HTTPError as err:
            return self.reply(err.code, 'application/json', err.read() or b'{}')
        except Exception as err:
            return self.json(502, {'error': str(err)})
        return super().do_GET()

    def do_POST(self):
        if self.path != '/api/horde/submit':
            return self.json(404, {'error': 'not found'})
        try:
            body = json.loads(self.rfile.read(int(self.headers.get('Content-Length') or 0)) or b'{}')
            prompt = str(body.get('prompt', '')).strip()[:1500]
            if not prompt:
                return self.json(400, {'error': 'empty prompt'})
            job = {
                'prompt': f'{prompt} ### {NEGATIVE}',
                'params': {'width': 1024, 'height': 576, 'steps': 25, 'cfg_scale': 6, 'sampler_name': 'k_euler_a',
                           'n': max(1, min(4, int(body.get('n', 1)))), 'seed': str(body.get('seed', ''))},
                'nsfw': False, 'censor_nsfw': True, 'models': HORDE_MODELS, 'r2': True, 'shared': False,
            }
            data, _ = fetch(f'{HORDE}/generate/async', json.dumps(job).encode(), HORDE_HEADERS, 30)
            self.reply(200, 'application/json', data)
        except urllib.error.HTTPError as err:
            self.reply(err.code, 'application/json', err.read() or b'{}')
        except Exception as err:
            self.json(502, {'error': str(err)})

    def horde_check(self, job):
        if not JOB_ID.match(job):
            return self.json(400, {'error': 'bad id'})
        data, _ = fetch(f'{HORDE}/generate/check/{job}', headers=HORDE_HEADERS, timeout=20)
        self.reply(200, 'application/json', data)

    def horde_result(self, job, i):
        if not JOB_ID.match(job):
            return self.json(400, {'error': 'bad id'})
        data, _ = fetch(f'{HORDE}/generate/status/{job}', headers=HORDE_HEADERS, timeout=30)
        gens = json.loads(data).get('generations') or []
        if i >= len(gens):
            return self.json(404, {'error': 'not ready'})
        g = gens[i]
        if g.get('censored'):
            return self.json(451, {'error': 'censored'})
        img, ctype = fetch(g['img'], timeout=60)
        self.reply(200, ctype or 'image/webp', img)

    def pollinations(self, q):
        prompt = (q.get('prompt') or [''])[0].strip()[:1500]
        if not prompt:
            return self.json(400, {'error': 'empty prompt'})
        params = urllib.parse.urlencode({'width': 1280, 'height': 720, 'seed': (q.get('seed') or ['1'])[0], 'nologo': 'true'})
        img, ctype = fetch(f'https://image.pollinations.ai/prompt/{urllib.parse.quote(prompt)}?{params}', timeout=150)
        self.reply(200, ctype or 'image/jpeg', img)

    def json(self, code, obj):
        self.reply(code, 'application/json', json.dumps(obj).encode())

    def reply(self, code, ctype, body):
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def end_headers(self):
        # always send the newest files, so updates show up without clearing the browser
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, *args):
        pass


if __name__ == '__main__':
    print(f'Cutroom is running at http://localhost:{PORT}')
    ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
