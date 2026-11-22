/* Provider adapter: Gemini through the Google AI Studio API (the one with a free tier).
   run() is an async generator: it yields text deltas and returns {model, in, out, stop}.

   GEMINI_MODELS is a comma-separated list tried in order. On a quota error (429) the next model
   is tried, so a free project can lean on a Flash model and fall back to Flash-Lite, which has a
   much larger free daily allowance. */

import { GoogleGenAI, ApiError } from '@google/genai';
import { Reject } from './common.js';

export const DEFAULT_MODELS = 'gemini-3.8-flash,gemini-3.5-flash-lite';

function mapError(e) {
  if (e instanceof ApiError) {
    if (e.status === 429) return new Reject('rate_limited', "Gemini's free quota is used up for now. Try again in a minute, or later today.", 429);
    if (e.status === 401 || e.status === 403) return new Reject('auth', 'The AI server is not configured with a valid key.', 502);
    if (e.status === 400) return new Reject('bad_request', 'The AI server rejected the request.', 502);
    return new Reject('upstream_error', 'Gemini returned an error. Try again.', 502);
  }
  if (e && /fetch|network|ECONN|timeout/i.test(String(e.message))) return new Reject('upstream_error', 'The connection to Gemini dropped. Try again.', 502);
  return new Reject('upstream_error', 'Something went wrong. Try again.', 500);
}

function config(spec) {
  const c = { systemInstruction: spec.system, maxOutputTokens: spec.max_tokens };
  if (spec.schema) { c.responseMimeType = 'application/json'; c.responseJsonSchema = spec.schema; }
  return c;
}

async function* once(ai, model, spec) {
  const res = await ai.models.generateContentStream({ model, contents: spec.user, config: config(spec) });
  let last = null;
  for await (const chunk of res) {
    const t = chunk.text;
    if (t) yield t;
    last = chunk;
  }
  const u = (last && last.usageMetadata) || {};
  const fr = last && last.candidates && last.candidates[0] && last.candidates[0].finishReason;
  const stop = fr === 'MAX_TOKENS' ? 'truncated' : (fr === 'SAFETY' || fr === 'PROHIBITED_CONTENT' || fr === 'BLOCKLIST') ? 'refusal' : 'end';
  return { model, in: u.promptTokenCount || 0, out: u.candidatesTokenCount || 0, stop };
}

export async function* run(spec, env) {
  const models = String(env.GEMINI_MODELS || env.GEMINI_MODEL || DEFAULT_MODELS).split(',').map(s => s.trim()).filter(Boolean);
  const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  let lastErr = null;
  for (let i = 0; i < models.length; i++) {
    let started = false;
    try {
      const gen = once(ai, models[i], spec);
      let r;
      while (!(r = await gen.next()).done) { started = true; yield r.value; }
      return r.value;
    } catch (e) {
      lastErr = e;
      /* Only a quota error before any text was streamed moves on to the next model. */
      const quota = e instanceof ApiError && e.status === 429;
      if (!quota || started || i === models.length - 1) throw mapError(e);
    }
  }
  throw mapError(lastErr);
}
