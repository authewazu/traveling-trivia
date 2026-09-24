"""Snapshot the sanctioned OpenTDB categories into data/questions.json.

    python dev/fetch_questions.py

Fetches every question in each category x difficulty, keeps multiple-choice
only (the game shows four answers), decodes HTML entities, and removes
duplicates. Takes ~5 minutes: OpenTDB allows one request per IP every
5 seconds. Re-run any time to refresh the snapshot; hand-edit the JSON
afterwards to curate (delete or fix questions).
"""
import hashlib
import html
import json
import os
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

# OpenTDB category IDs sanctioned for the kiosk (any difficulty).
CATEGORIES = [9, 17, 18, 19, 22, 23, 24, 27, 30]
DIFFICULTIES = ['easy', 'medium', 'hard']

BASE = 'https://opentdb.com'
SPACING_SEC = 5.2  # OpenTDB rate limit: 1 request / 5s per IP
MAX_PER_REQUEST = 50  # OpenTDB cap on `amount`
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'questions.json')

_last_request = 0.0


def get(path):
    """GET an OpenTDB endpoint as JSON, never faster than the rate limit."""
    global _last_request
    wait = _last_request + SPACING_SEC - time.time()
    if wait > 0:
        time.sleep(wait)
    _last_request = time.time()
    req = urllib.request.Request(BASE + path, headers={'User-Agent': 'TravelingTrivia/1.0 (IPD534 class project)'})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        if e.code == 429:
            return {'response_code': 5}
        raise


def new_token():
    data = get('/api_token.php?command=request')
    if data.get('response_code') != 0:
        raise RuntimeError(f'Could not get a session token: {data}')
    return data['token']


def clean(q, category_id, difficulty):
    question = html.unescape(q['question']).strip()
    correct = html.unescape(q['correct_answer']).strip()
    return {
        # Stable id so the kiosk can remember which questions it has shown.
        # Based on the question text alone: OpenTDB has a few near-duplicate
        # entries (same wording, differently phrased answer), which should
        # count as one question.
        'id': hashlib.sha1(' '.join(question.lower().split()).encode()).hexdigest()[:10],
        'categoryId': category_id,
        'category': html.unescape(q['category']),
        'difficulty': difficulty,
        'question': question,
        'correct': correct,
        'incorrect': [html.unescape(a).strip() for a in q['incorrect_answers']],
    }


def fetch_combo(category_id, difficulty, expected, token):
    """Pull every question for one category x difficulty. Returns (questions, token)."""
    out, remaining = [], expected
    amount = min(MAX_PER_REQUEST, remaining)
    retries = 0
    while remaining > 0 and amount > 0:
        data = get(f'/api.php?amount={amount}&category={category_id}&difficulty={difficulty}&token={token}')
        code = data.get('response_code')
        if code == 0:
            results = data['results']
            out += [clean(q, category_id, difficulty) for q in results if q['type'] == 'multiple']
            remaining -= len(results)
            amount = min(MAX_PER_REQUEST, remaining)
            retries = 0
        elif code in (1, 4):
            # Fewer left than the count endpoint claimed: ask for less, stop at 1.
            if amount == 1:
                break
            amount = max(1, amount // 2)
        elif code == 3:
            token = new_token()
        elif code == 5 and retries < 5:
            retries += 1  # rate-limited anyway; get() waits before retrying
        else:
            raise RuntimeError(f'OpenTDB error {data} for category {category_id} / {difficulty}')
    return out, token


def main():
    names = {c['id']: c['name'] for c in get('/api_category.php')['trivia_categories']}
    token = new_token()
    questions, seen = [], set()
    summary = []

    for cat in CATEGORIES:
        counts = get(f'/api_count.php?category={cat}')['category_question_count']
        row = [f'{cat:>3} {names.get(cat, "?"):<24}']
        for d in DIFFICULTIES:
            batch, token = fetch_combo(cat, d, counts[f'total_{d}_question_count'], token)
            # Duplicates can occur even within one batch, so dedupe item by item.
            fresh = []
            for q in batch:
                if q['id'] not in seen:
                    seen.add(q['id'])
                    fresh.append(q)
            questions += fresh
            row.append(f'{d}={len(fresh):>3}')
            print(f'  {names.get(cat, cat)} / {d}: {len(fresh)} multiple-choice', flush=True)
        summary.append('  '.join(row))

    by_difficulty = {d: sum(q['difficulty'] == d for q in questions) for d in DIFFICULTIES}
    snapshot = {
        'source': 'Open Trivia Database — https://opentdb.com',
        'license': 'CC BY-SA 4.0 — https://creativecommons.org/licenses/by-sa/4.0/',
        'fetchedAt': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'categories': {str(c): names.get(c) for c in CATEGORIES},
        'counts': {**by_difficulty, 'total': len(questions)},
        'questions': questions,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(snapshot, f, ensure_ascii=False, indent=1)

    print('\n'.join(['', 'Multiple-choice questions saved:'] + summary))
    print(f'Total {len(questions)} ({by_difficulty}) -> {os.path.relpath(OUT, ROOT)}')


if __name__ == '__main__':
    main()
