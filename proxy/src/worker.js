/* Afterink AI server: a small Cloudflare Worker that holds an API key so the static page on
   GitHub Pages can run its AI steps live for every viewer.

   Design rules, in step with the page and APPROACH.md:
   - The page sends data. The prompts live here (tasks.js), one per named task. There is no
     free-form endpoint, so the key cannot be used as a general chatbot.
   - The model reads and drafts. It never does arithmetic: the page's code computes dates,
     compares prices and checks every quote against the document.
   - Either provider works: Gemini (Google AI Studio, which has a free tier) or Claude
     (Anthropic). Set PROVIDER, or just set one key and the server picks that provider.
   - Every call is streamed back as server-sent events so the viewer watches the reading happen.
   - Caps: input size per task, a per-visitor rate limit, and an optional daily token budget.
     When a cap trips, the page falls back to its saved results and says so. */

import { Reject, modelName } from './common.js';
import { TASKS } from './tasks.js';
import * as anthropic from './anthropic.js';
import * as gemini from './gemini.js';

const DEFAULT_ORIGINS = ['https://akshatj28.github.io', 'https://kavyaagarwal2001.github.io', 'http://localhost:8765', 'http://127.0.0.1:8765'];

/* ---------- helpers ---------- */
function cors(origin, env) {
  const allowed = env.ALLOWED_ORIGINS ? String(env.ALLOWED_ORIGINS).split(',').map(s => s.trim()).filter(Boolean) : DEFAULT_ORIGINS;
  const ok = !origin || allowed.includes('*') || allowed.includes(origin);
  return { ok, headers: { 'access-control-allow-origin': ok && origin ? origin : allowed[0], 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400', 'vary': 'origin' } };
}
const json = (obj, status, extra) => new Response(JSON.stringify(obj), { status: status || 200, headers: Object.assign({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, extra || {}) });

function provider(env) {
  const want = String(env.PROVIDER || '').toLowerCase();
  if (want === 'anthropic' || want === 'claude') return env.ANTHROPIC_API_KEY ? { name: 'anthropic', mod: anthropic, model: env.ANTHROPIC_MODEL || anthropic.DEFAULT_MODEL } : null;
  if (want === 'gemini' || want === 'google') return env.GEMINI_API_KEY ? { name: 'gemini', mod: gemini, model: String(env.GEMINI_MODELS || env.GEMINI_MODEL || gemini.DEFAULT_MODELS).split(',')[0].trim() } : null;
  if (env.GEMINI_API_KEY) return { name: 'gemini', mod: gemini, model: String(env.GEMINI_MODELS || env.GEMINI_MODEL || gemini.DEFAULT_MODELS).split(',')[0].trim() };
  if (env.ANTHROPIC_API_KEY) return { name: 'anthropic', mod: anthropic, model: env.ANTHROPIC_MODEL || anthropic.DEFAULT_MODEL };
  return null;
}

/* ---------- caps ---------- */
async function rateLimit(env, ip) {
  if (!env.RL || typeof env.RL.limit !== 'function') return;
  const { success } = await env.RL.limit({ key: ip || 'unknown' });
  if (!success) throw new Reject('rate_limited', 'Too many requests from this address. Try again in a minute.', 429);
}
const dayKey = () => 'budget:' + new Date().toISOString().slice(0, 10);
async function checkBudget(env) {
  if (!env.BUDGET) return;
  const cap = Number(env.DAILY_OUTPUT_TOKENS || 400000);
  const used = Number(await env.BUDGET.get(dayKey())) || 0;
  if (used >= cap) throw new Reject('budget', "Today's AI budget for this demo is used up. Saved results are shown instead.", 429);
}
async function addBudget(env, tokens) {
  if (!env.BUDGET || !tokens) return;
  const k = dayKey(); const used = Number(await env.BUDGET.get(k)) || 0;
  await env.BUDGET.put(k, String(used + tokens), { expirationTtl: 3 * 86400 });
}

/* ---------- the model call, streamed back as SSE ---------- */
const errOf = e => (e instanceof Reject ? [e.code, e.message, e.status] : ['upstream_error', 'Something went wrong. Try again.', 500]);

function stream(pv, spec, env, ctx, headers) {
  const enc = new TextEncoder();
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const send = obj => writer.write(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
  const t0 = Date.now();
  ctx.waitUntil((async () => {
    try {
      const gen = pv.mod.run(spec, env);
      let r;
      while (!(r = await gen.next()).done) await send({ t: r.value });
      const fin = r.value || {};
      await addBudget(env, fin.out);
      if (fin.stop === 'refusal') await send({ error: 'refused', message: 'The model declined this input.' });
      else await send({ done: true, ms: Date.now() - t0, in: fin.in || 0, out: fin.out || 0, provider: pv.name, model: fin.model || pv.model, modelName: modelName(fin.model || pv.model), truncated: fin.stop === 'truncated' });
    } catch (e) {
      const [code, message] = errOf(e);
      try { await send({ error: code, message }); } catch (e2) { /* client went away */ }
    } finally { try { await writer.close(); } catch (e) { /* already closed */ } }
  })());
  return new Response(readable, { headers: Object.assign({ 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' }, headers) });
}

/* ---------- routing ---------- */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url), origin = request.headers.get('origin') || '';
    const c = cors(origin, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: c.headers });
    if (!c.ok) return json({ error: 'forbidden', message: 'This origin may not use the AI server.' }, 403, c.headers);
    const m = /^\/v1\/([a-z]+)$/.exec(url.pathname);
    if (!m) return json({ error: 'not_found', message: 'Unknown route.' }, 404, c.headers);
    const task = m[1], pv = provider(env);
    if (task === 'health') return json({ ok: !!pv, provider: pv ? pv.name : null, model: pv ? pv.model : null, modelName: pv ? modelName(pv.model) : null, tasks: Object.keys(TASKS), budget: !!env.BUDGET, rateLimit: !!env.RL }, 200, c.headers);
    if (!TASKS[task]) return json({ error: 'not_found', message: 'Unknown task.' }, 404, c.headers);
    if (request.method !== 'POST') return json({ error: 'bad_request', message: 'POST a JSON body.' }, 405, c.headers);
    if (!pv) return json({ error: 'auth', message: 'The AI server has no key configured.' }, 503, c.headers);
    try {
      await rateLimit(env, request.headers.get('cf-connecting-ip') || '');
      await checkBudget(env);
      const raw = await request.text();
      if (raw.length > 400000) throw new Reject('prompt_too_large', 'That text is too long. Paste a shorter document.', 413);
      let body; try { body = JSON.parse(raw || '{}'); } catch (e) { throw new Reject('bad_request', 'The request body is not JSON.'); }
      const spec = TASKS[task](body || {});
      return stream(pv, spec, env, ctx, c.headers);
    } catch (e) {
      const [code, message, status] = errOf(e);
      return json({ error: code, message }, status, c.headers);
    }
  }
};
