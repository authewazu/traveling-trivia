import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';

// GET /api/explain?id=<question id>  →  { "correct": "<one sentence>" }
//
// Runs server-side so ANTHROPIC_API_KEY never reaches the browser. The kiosk
// sends only a question id; the question itself comes from our own
// data/questions.json (bundled via vercel.json "includeFiles"), so this
// endpoint can only ever explain questions in the bank.
//
// Caching, keyed by question: successful answers are served with a long
// CDN cache header, so Vercel's edge answers repeat ids without re-running
// this function (or re-paying for the call). A warm function instance also
// keeps a small in-memory copy. Failures are never cached.

const MODEL = process.env.CLAUDE_MODEL || 'claude-haiku-4-5-20251001';
// Low ceiling: the answer is ~20 words of JSON. Fast > eloquent.
const MAX_TOKENS = 100;
// The kiosk gives up at 5s; stop a bit earlier and never retry.
const client = new Anthropic({ timeout: 4500, maxRetries: 0 });

const SYSTEM = `You are a quick, upbeat trivia host at a bus stop kiosk.
Given a question, its four options, and the correct one, respond
with ONLY this JSON shape, nothing else:
{"correct": "<one sentence, under 20 words, on why the correct answer is right>"}`;

// Structured output: the API constrains the reply to exactly this shape.
const OUTPUT_FORMAT = {
  type: 'json_schema',
  schema: {
    type: 'object',
    properties: { correct: { type: 'string' } },
    required: ['correct'],
    additionalProperties: false,
  },
};

const MAX_WORDS = 40; // hard ceiling the kiosk layout is tested against

let bank = null;
function questionById(id) {
  if (!bank) {
    const { questions } = JSON.parse(readFileSync(join(process.cwd(), 'data', 'questions.json'), 'utf8'));
    bank = new Map(questions.map((q) => [q.id, q]));
  }
  return bank.get(id);
}

const memo = new Map(); // warm-instance cache: id -> sentence

function userMessage(q) {
  // Alphabetical option order keeps the prompt identical for a given question.
  const options = [q.correct, ...q.incorrect].sort((a, b) => a.localeCompare(b));
  return [
    `Category: ${q.category}`,
    `Question: ${q.question}`,
    `Options: ${options.map((o, i) => `${'ABCD'[i]}) ${o}`).join('  ')}`,
    `Correct answer: ${q.correct}`,
  ].join('\n');
}

export default async function handler(req, res) {
  // `reason` is a short, non-secret diagnostic (the kiosk ignores it) so a
  // failure can be read straight from the browser: /api/explain?id=...
  const fail = (status, reason, detail) => {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(status).json({ correct: null, reason, ...(detail ? { detail } : {}) });
  };
  if (req.method !== 'GET') return fail(405, 'method_not_allowed');

  const id = typeof req.query.id === 'string' ? req.query.id : '';
  const q = /^[0-9a-f]{10}$/.test(id) ? questionById(id) : null;
  if (!q) return fail(404, 'unknown_question_id');
  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    // Set it in Vercel → Settings → Environment Variables, then redeploy.
    return fail(500, 'missing_api_key');
  }

  const ok = (sentence) => {
    // Cache at Vercel's CDN for 30 days (a redeploy clears it).
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=2592000');
    return res.status(200).json({ correct: sentence });
  };
  if (memo.has(id)) return ok(memo.get(id));

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM,
      messages: [{ role: 'user', content: userMessage(q) }],
      output_config: { format: OUTPUT_FORMAT },
    });
    // Refusals or a cut-off reply may not match the schema: don't parse or cache them.
    if (response.stop_reason !== 'end_turn') {
      console.warn(`[api/explain] ${id}: stop_reason ${response.stop_reason}`);
      return fail(502, `stop_${response.stop_reason}`);
    }
    const text = response.content.find((b) => b.type === 'text')?.text ?? '';
    let sentence;
    try {
      sentence = String(JSON.parse(text).correct ?? '').replace(/\s+/g, ' ').trim();
    } catch {
      console.error(`[api/explain] ${id}: reply was not JSON:`, text.slice(0, 200));
      return fail(502, 'bad_json');
    }
    if (!sentence) return fail(502, 'empty');
    if (sentence.split(' ').length > MAX_WORDS) return fail(502, 'too_long');

    memo.set(id, sentence);
    return ok(sentence);
  } catch (error) {
    if (error instanceof Anthropic.APIConnectionTimeoutError) {
      console.warn(`[api/explain] ${id}: timed out`);
      return fail(504, 'timeout');
    }
    if (error instanceof Anthropic.APIError) {
      // e.g. 401 authentication_error (bad key), 400 invalid_request_error
      // (billing/credit, bad parameter), 404 not_found_error (model id), 429.
      const type = error.error?.error?.type ?? 'api_error';
      console.error(`[api/explain] ${id}: API error ${error.status} ${type}:`, error.message);
      return fail(502, `anthropic_${error.status ?? 'network'}_${type}`, String(error.message).slice(0, 200));
    }
    console.error(`[api/explain] ${id}:`, error);
    return fail(502, 'server_error', String(error?.message ?? error).slice(0, 200));
  }
}
