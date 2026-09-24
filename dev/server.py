"""Local preview server (no Node required).

    python dev/server.py            -> http://localhost:8000
    http://localhost:8000/?debug&speed=6

Serves the static site and stands in for the Vercel functions:
  GET  /api/bus      real SEPTA data, decoded like api/_lib/gtfsrt.js
  GET  /api/explain  mock {"correct": ...} for a bank question id (the real
                     Claude call needs ANTHROPIC_API_KEY on Vercel)
  GET  /dev/septa.pb raw SEPTA feed, for testing the JS decoder in a browser
"""
import json, os, time, urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FEED_URL = 'https://www3.septa.org/gtfsrt/septa-pa-us/Trip/rtTripUpdates.pb'
STOP_ID, ROUTES = '6064', {'21', '42'}


def varint(b, i):
    r = s = 0
    while True:
        c = b[i]; i += 1
        r |= (c & 0x7f) << s; s += 7
        if c < 0x80:
            return r, i


def fields(b):
    i = 0
    while i < len(b):
        k, i = varint(b, i)
        f, w = k >> 3, k & 7
        if w == 0:
            v, i = varint(b, i)
        elif w == 2:
            n, i = varint(b, i); v = b[i:i + n]; i += n
        elif w == 1:
            i += 8; continue
        elif w == 5:
            i += 4; continue
        else:
            raise ValueError('wire type %d' % w)
        yield f, v


def event_time(b):
    return next((v for f, v in fields(b) if f == 2), None)


def extract(data):
    ts, out = None, []
    for f, v in fields(data):
        if f == 1:
            ts = next((hv for hf, hv in fields(v) if hf == 3), ts)
        if f != 2:
            continue
        for ef, tu in fields(v):
            if ef != 3:
                continue
            route = trip = vehicle = None; updates = []
            for tf, tv in fields(tu):
                if tf == 1:
                    for df, dv in fields(tv):
                        if df == 1: trip = dv.decode()
                        if df == 5: route = dv.decode()
                elif tf == 3:
                    for vf, vv in fields(tv):
                        if vf == 1: vehicle = vv.decode()
                elif tf == 2:
                    updates.append(tv)
            if route not in ROUTES:
                continue
            for stu in updates:
                stop = arr = dep = None; rel = 0
                for sf, sv in fields(stu):
                    if sf == 4: stop = sv.decode()
                    elif sf == 2: arr = event_time(sv)
                    elif sf == 3: dep = event_time(sv)
                    elif sf == 5: rel = sv
                t = arr or dep
                if stop == STOP_ID and rel != 1 and t:
                    out.append({'route': route, 'trip': trip, 'vehicle': vehicle, 'arrival': t})
    out.sort(key=lambda a: a['arrival'])
    return ts, out


_bank = None


def question_by_id(qid):
    global _bank
    if _bank is None:
        with open(os.path.join(ROOT, 'data', 'questions.json'), encoding='utf-8') as f:
            _bank = {q['id']: q for q in json.load(f)['questions']}
    return _bank.get(qid)


def fetch_feed():
    with urllib.request.urlopen(FEED_URL, timeout=6) as r:
        return r.read()


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def send_json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def end_headers(self):
        if not self.path.startswith('/api/'):
            self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def do_GET(self):
        if self.path.startswith('/api/bus'):
            try:
                ts, arrivals = extract(fetch_feed())
                now = int(time.time())
                self.send_json(200, {'ok': True, 'now': now, 'feedTimestamp': ts, 'stop': STOP_ID,
                                     'arrivals': [a for a in arrivals if a['arrival'] > now - 60]})
            except Exception as e:
                self.send_json(502, {'ok': False, 'error': str(e)})
            return
        if self.path.startswith('/dev/septa.pb'):
            data = fetch_feed()
            self.send_response(200)
            self.send_header('Content-Type', 'application/octet-stream')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        if self.path.startswith('/api/explain'):
            # Same contract as api/explain.js: id in, {"correct": sentence} out.
            qid = parse_qs(urlparse(self.path).query).get('id', [''])[0]
            q = question_by_id(qid)
            if not q:
                self.send_json(404, {'correct': None})
                return
            time.sleep(1.2)  # simulate generation latency
            self.send_json(200, {'correct': f'[Local mock] Why "{q["correct"]}" is right appears here once deployed.'})
            return
        super().do_GET()


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8000))
    print(f'Traveling Trivia dev server on http://localhost:{port}')
    ThreadingHTTPServer(('127.0.0.1', port), Handler).serve_forever()
