// server.js
// ESM + Responses API compatible. Generates EN/TR fortunes with 24h lock.

import 'dotenv/config';
import crypto from 'crypto';
import express from 'express';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import OpenAI from 'openai';
import Redis from 'ioredis';

const app = express();
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const FORTUNE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const COOKIE_NAME = 'fcid';
const isProd = process.env.NODE_ENV === 'production';

// ---------- storage (Redis -> memory fallback) ----------
const hasRedis = !!process.env.REDIS_URL;
let redis = null;
if (hasRedis) {
  redis = new Redis(process.env.REDIS_URL);
  redis.on('error', (e) => console.error('[redis] error', e?.message));
}
const memory = new Map(); // userId -> { texts, createdAt, refreshAt }

async function readRecord(userId) {
  const now = Date.now();
  if (redis) {
    const key = `fc:${userId}`;
    const raw = await redis.get(key);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj.refreshAt) {
      const ttl = await redis.ttl(key); // seconds
      obj.refreshAt = now + Math.max(ttl, 0) * 1000;
    }
    if (obj.refreshAt <= now) return null;
    return obj;
  }
  const rec = memory.get(userId);
  if (!rec) return null;
  if (rec.refreshAt <= now) { memory.delete(userId); return null; }
  return rec;
}

async function writeRecord(userId, record) {
  if (redis) {
    await redis.set(`fc:${userId}`, JSON.stringify(record), 'EX', Math.floor(FORTUNE_TTL_MS / 1000));
  } else {
    memory.set(userId, record);
  }
}

function getUserId(req, res) {
  if (req.cookies?.[COOKIE_NAME]) return req.cookies[COOKIE_NAME];
  const id = crypto.randomBytes(16).toString('hex');
  res.cookie(COOKIE_NAME, id, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    maxAge: 365 * 24 * 3600 * 1000
  });
  return id;
}

// ===== OpenAI fortune generator (TR + EN) — robust, no text.format =====
async function generateDualFortune() {
  // Local backups so the UI always shows something if OpenAI fails
  const SAMPLES = [
    { en: 'A small risk opens a big door.', tr: 'Küçük bir risk, büyük bir kapı açar.' },
    { en: 'Your patience today buys you time tomorrow.', tr: 'Bugünkü sabrın, yarına zaman kazandırır.' },
    { en: 'Start a list; end a worry.', tr: 'Bir liste başlat; bir endişeyi bitir.' },
    { en: 'Consistency outshines bursts of brilliance.', tr: 'Tutarlılık, parlamalardan daha çok parlar.' },
    { en: 'Own the first step, not the whole staircase.', tr: 'Tüm merdiveni değil, ilk basamağı sahiplen.' },
    { en: 'A walk will answer what the chair cannot.', tr: 'Bir yürüyüş, sandalyenin veremediği cevabı verir.' },
    { en: 'Gratitude magnifies the ordinary.', tr: 'Şükran, sıradanı büyütür.' },
    { en: 'Your best work needs fewer tabs.', tr: 'En iyi işin daha az sekme ister.' }
  ];
  const pickLocal = () => SAMPLES[Math.floor(Math.random() * SAMPLES.length)];

  // If no API key, just use local fallback (helps in dev)
  if (!process.env.OPENAI_API_KEY) return pickLocal();

  const modelPrimary = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const modelBackup  = 'gpt-4.1-mini';

  const prompt = `
You are a careful, warm fortune writer.

Rules:
- Return ONLY a single JSON object.
- Keys: "en" and "tr".
- Keep each fortune ≤ 22 words.
- Family-friendly. No emojis, dates, medical/legal/financial advice, or risky directives.

Task:
Create ONE concise fortune and return BOTH languages exactly as:
{"en":"<english fortune>","tr":"<turkish fortune>"}
`.trim();

  const parseMaybeJson = (raw) => {
    if (!raw) return null;
    const cleaned = raw.trim()
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```$/i, '')
      .trim();
    try { return JSON.parse(cleaned); } catch { return null; }
  };

  async function tryModel(modelName) {
    const resp = await client.responses.create({
      model: modelName,
      input: prompt,          // single-string input works across SDKs
      temperature: 0.8,
      max_output_tokens: 120
    });

    const text =
      resp.output_text ??
      (Array.isArray(resp.output)
        ? resp.output.flatMap(o => o.content || []).map(c => c.text || '').join('')
        : '');

    const obj = parseMaybeJson(text);
    const en = (obj?.en || '').trim();
    const tr = (obj?.tr || '').trim();
    if (!en || !tr) throw new Error('bad_json');
    return { en, tr };
  }

  try {
    return await tryModel(modelPrimary);
  } catch (e1) {
    console.warn('[openai] primary failed:', e1?.status, e1?.code, e1?.message || e1);
  }
  try {
    return await tryModel(modelBackup);
  } catch (e2) {
    console.warn('[openai] backup failed:', e2?.status, e2?.code, e2?.message || e2);
  }
  return pickLocal();
}

// ---------- app ----------
app.use(cookieParser());
app.use(express.json());
app.use(express.static('public', { extensions: ['html'] }));

// Rate-limit POST /api/fortune (soft guard; off in dev)
const realLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  max: 10,
  standardHeaders: false,
  legacyHeaders: false,
  handler: (_req, res) =>
    res.status(429).json({ ok: false, error: 'rate_limited', message: 'Too many requests today. Try again later.' })
});
const fortuneLimiter = isProd ? realLimiter : (req, res, next) => next();

// health
app.get('/api/health', async (_req, res) => {
  res.json({
    ok: true,
    serverTime: new Date().toISOString(),
    modelConfigured: !!process.env.OPENAI_API_KEY,
    redis: redis ? redis.status : 'disabled'
  });
});

// peek (no generation)
app.get('/api/fortune', async (req, res) => {
  const userId = getUserId(req, res);
  const now = Date.now();
  const rec = await readRecord(userId);
  if (!rec) {
    return res.json({
      ok: true,
      fortune: null,
      createdAt: null,
      refreshAt: null,
      serverNow: new Date(now).toISOString()
    });
  }
  res.json({
    ok: true,
    fortune: rec.texts,
    createdAt: new Date(rec.createdAt).toISOString(),
    refreshAt: new Date(rec.refreshAt).toISOString(),
    serverNow: new Date(now).toISOString()
  });
});

// generate-or-return (main)
app.post('/api/fortune', fortuneLimiter, async (req, res) => {
  try {
    const userId = getUserId(req, res);
    const now = Date.now();

    const cached = await readRecord(userId);
    if (cached && cached.refreshAt > now) {
      return res.json({
        ok: true,
        fortune: cached.texts,
        createdAt: new Date(cached.createdAt).toISOString(),
        refreshAt: new Date(cached.refreshAt).toISOString(),
        serverNow: new Date(now).toISOString()
      });
    }

    const texts = await generateDualFortune();
    const createdAt = now;
    const refreshAt = now + FORTUNE_TTL_MS;
    const record = { texts, createdAt, refreshAt };
    await writeRecord(userId, record);

    res.json({
      ok: true,
      fortune: texts,
      createdAt: new Date(createdAt).toISOString(),
      refreshAt: new Date(refreshAt).toISOString(),
      serverNow: new Date(now).toISOString()
    });
  } catch (err) {
    console.error('[fortune]', err?.message || err);
    res.status(500).json({ ok: false, error: 'fortune_generation_failed' });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Fortune server on http://localhost:${port}`));
