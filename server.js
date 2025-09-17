// Fortuny backend — Daily AI fortune + Spotify-like share card
// GPT-5 default + fallback, force JSON, fallback-regeneration, dev force, diag, lazy-canvas
// --------------------------------------------------------------------------------------------

import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import cookieParser from 'cookie-parser';
import fetch from 'node-fetch';
import fs from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

const PORT = process.env.PORT || 3000;

// ==== Model ayarları: gpt-5 varsayılan, gpt-4.1-mini fallback
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5';
const FALLBACK_MODEL = process.env.OPENAI_MODEL_FALLBACK || 'gpt-4.1-mini';

const PRIMARY_KEY = process.env.OPENAI_API_KEY || '';
const BACKUP_KEY  = process.env.OPENAI_API_KEY_BACKUP || '';

const DEV_ALLOW_FORCE = process.env.DEV_ALLOW_FORCE === '1';

// Fallback metin sabitleri (algılama için)
const FALLBACK_EN = 'Make room. New things are arriving.';
const FALLBACK_TR = 'Yer aç. Yeni şeyler geliyor.';

app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// Statik dosyalar
app.use(express.static(path.join(__dirname, 'public'), {
  extensions: ['html'],
  maxAge: '1h'
}));

// Basit log
app.use((req, _res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/share-card')) {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  }
  next();
});

// ------------------------------ Yardımcılar ------------------------------
const DAY_MS = 24 * 60 * 60 * 1000;
const nowISO = () => new Date().toISOString();
const plus24hISO = () => new Date(Date.now() + DAY_MS).toISOString();

function getDeviceId(req, res) {
  let id = req.cookies?.fc_device;
  if (!id) {
    id = crypto.randomUUID();
    res.cookie('fc_device', id, { httpOnly: false, sameSite: 'Lax', maxAge: 400*24*60*60*1000 });
  }
  return id;
}

const safeJsonParse = (s, fallback = null) => { try { return JSON.parse(s); } catch { return fallback; } };

function stripCodeFences(s='') {
  let t = String(s).trim();
  t = t.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim(); // ```json ... ```
  return t;
}
function extractJsonBlock(text) {
  if (!text) return null;
  const t = stripCodeFences(text);
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  return safeJsonParse(t.slice(start, end + 1), null);
}
function pickOutputText(respJson) {
  if (respJson?.output_text) return String(respJson.output_text);
  const o = respJson?.output?.[0]?.content?.[0]?.text?.value;
  if (o) return String(o);
  if (Array.isArray(respJson?.output)) {
    const first = respJson.output.find(x => x?.content)?.content;
    if (Array.isArray(first) && first[0]?.text?.value) return String(first[0].text.value);
  }
  return '';
}
function isFallbackFortune(f){ 
  if (!f) return false; 
  const en = String(f.en||'').trim();
  const tr = String(f.tr||'').trim();
  return (en === FALLBACK_EN) || (tr === FALLBACK_TR);
}
function clampFortunes(data) {
  const clean = s => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  return { en: clean(data.en), tr: clean(data.tr) };
}

// ----------------------------- Hafıza / Store -----------------------------
// value: { fortune:{en,tr}, mood, createdAt, refreshAt, source:'ai'|'fallback', tries:number }
const store = new Map();

// ----------------------------- OpenAI Çağrısı -----------------------------
async function callOpenAI(model, prompt, apiKey) {
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      input: prompt,
      temperature: 0.8,
      // 🔒 JSON’u zorla (Responses API): artık 'response_format' değil, 'text.format'
      text: { format: 'json' },
      max_output_tokens: 200
    })
  });
  if (!res.ok) {
    const errText = await res.text().catch(()=> '');
    throw new Error(`${res.status} ${res.statusText} — ${errText.slice(0,200)}`);
  }
  const json = await res.json();
  return pickOutputText(json);
}

async function askOpenAIWithFallbacks(prompt) {
  // 1) gpt-5 + primary
  try { return await callOpenAI(OPENAI_MODEL, prompt, PRIMARY_KEY); }
  catch (e1) { console.warn('[openai] primary failed on', OPENAI_MODEL, e1.message); }
  // 2) gpt-5 + backup
  if (BACKUP_KEY) {
    try { return await callOpenAI(OPENAI_MODEL, prompt, BACKUP_KEY); }
    catch (e2) { console.warn('[openai] backup failed on', OPENAI_MODEL, e2.message); }
  }
  // 3) fallback + primary
  try { return await callOpenAI(FALLBACK_MODEL, prompt, PRIMARY_KEY); }
  catch (e3) { console.warn('[openai] primary failed on', FALLBACK_MODEL, e3.message); }
  // 4) fallback + backup
  if (BACKUP_KEY) return await callOpenAI(FALLBACK_MODEL, prompt, BACKUP_KEY);
  throw new Error('all_openai_attempts_failed');
}

async function generateFortune() {
  const basePrompt = `
You are a careful, warm fortune writer.

Goal:
Write ONE short, street-savvy, gossip-flavored relationship fortune that feels human-written: grounded, a tad messy in rhythm, specific, never generic.

Human vibe (do these):
- Use 1 small concrete detail (e.g., late-night status, blue tick, screenshot, playlist). No names or brands.
- Mix sentence lengths (1–2 sentences), natural punctuation, mild hedges (looks like / maybe / sanki / galiba).
- TR uses light “sokak ağzı” (e.g., “bakarsın”, “valla”); EN uses casual contractions (“don’t”, “won’t”).
- EN & TR should be cousins, not mirror translations—same idea, different natural phrasing.

Avoid AI tells:
- No clichés (“the universe”, “manifest”, “journey”, “energy alignment”).
- No lists, no templates, no symmetry between languages, no “as an AI”.
- No certainty; hint instead of declare.

Safety:
- Family-friendly. No emojis. No medical/legal/financial advice.
- No spying/harassing/stalking directives; no slurs or profanity.

Output rules:
- Return ONLY a single one-line JSON object, no code fences, no extra text.
- Keys: "en" and "tr". Max 30 words each.
- Do NOT mix languages in one value.

Format EXACTLY:
{"en":"<english>","tr":"<turkish>"}
`.trim();

  // 1) İlk deneme
  let out = await askOpenAIWithFallbacks(basePrompt);
  console.log('[openai] raw out (first 200):', (out || '').slice(0,200));
  let data = extractJsonBlock(out) || safeJsonParse(out);

  // 2) JSON çıkmadıysa: STRICT retry (tek sefer)
  if (!data || typeof data.en !== 'string' || typeof data.tr !== 'string') {
    const strictPrompt = basePrompt + '\n\nSTRICT MODE: Output ONLY raw JSON exactly as specified. No prose, no backticks.';
    try {
      out = await askOpenAIWithFallbacks(strictPrompt);
      console.log('[openai][strict] raw out (first 200):', (out || '').slice(0,200));
      data = extractJsonBlock(out) || safeJsonParse(out);
    } catch (e) {
      console.warn('[openai] strict retry failed:', e.message);
    }
  }

  let source = 'ai';
  if (!data || !data.en || !data.tr) {
    console.warn('[openai] parse failed, using local fallback');
    data = { en: FALLBACK_EN, tr: FALLBACK_TR };
    source = 'fallback';
  }

  const { en, tr } = clampFortunes(data);
  const createdAt = nowISO();
  const refreshAt = plus24hISO();

  return {
    ok: true,
    fortune: { en, tr },
    mood: 'light',
    createdAt,
    refreshAt,
    serverNow: createdAt,
    source
  };
}

// ------------------------------- API: Fortune ------------------------------
app.get('/api/fortune', (req, res) => {
  const deviceId = getDeviceId(req, res);
  const existing = store.get(deviceId);
  const now = Date.now();
  if (existing && new Date(existing.refreshAt).getTime() > now) {
    return res.json({ ok: true, ...existing, serverNow: nowISO() });
  }
  return res.status(204).end();
});

app.post('/api/fortune', async (req, res) => {
  const deviceId = getDeviceId(req, res);
  const existing = store.get(deviceId);
  const nowMs = Date.now();

  const force = DEV_ALLOW_FORCE && String(req.query.force) === '1';
  const refreshMs = existing ? new Date(existing.refreshAt).getTime() : 0;
  const cachedIsFallback = existing ? (existing.source === 'fallback' || isFallbackFortune(existing.fortune)) : false;
  const cachedTries = existing?.tries ?? 0;

  // ❗ Fallback saklıysa: 24h dolmasa bile max 3 denemeye kadar yeniden üret
  if (!force && existing && refreshMs > nowMs && !cachedIsFallback) {
    return res.json({ ok: true, ...existing, serverNow: nowISO() });
  }
  if (!force && existing && refreshMs > nowMs && cachedIsFallback && cachedTries >= 3) {
    return res.json({ ok: true, ...existing, serverNow: nowISO() });
  }

  try {
    const fresh = await generateFortune();
    const tries = (cachedIsFallback ? cachedTries : 0) + (fresh.source === 'fallback' ? 1 : 0);

    store.set(deviceId, {
      fortune: fresh.fortune,
      mood: fresh.mood,
      createdAt: fresh.createdAt,
      refreshAt: fresh.refreshAt,
      source: fresh.source,
      tries
    });
    res.json({ ...fresh, tries });
  } catch (err) {
    console.error('fortune error:', err.message);
    // Hata olduysa var olanı döndür (kullanıcı boş kalmasın)
    if (existing) return res.json({ ok: true, ...existing, serverNow: nowISO(), note: 'returned_cached_due_error' });
    res.status(429).json({ ok: false, error: 'rate_limited', message: 'Too many requests today. Try again later.' });
  }
});

// ------------------------ Paylaşım Kartı (lazy canvas) ---------------------
let createCanvas, registerFont;
let __hasCanvas = false;
let __fontsReady = false;

async function loadCanvas() {
  if (__hasCanvas) return true;
  try {
    ({ createCanvas, registerFont } = await import('canvas'));
    __hasCanvas = true;
    return true;
  } catch (e) {
    console.warn('[share-card] canvas module not found:', e.message);
    return false;
  }
}
function ensureFonts() {
  if (!__hasCanvas || __fontsReady === true) return;
  try {
    const fontDir = path.resolve('server/fonts');
    if (fs.existsSync(fontDir)) {
      const fredoka = path.join(fontDir, 'Fredoka-Bold.ttf');
      const pjsBold = path.join(fontDir, 'PlusJakartaSans-Bold.ttf');
      if (fs.existsSync(fredoka)) registerFont(fredoka, { family: 'Fredoka', weight: '700' });
      if (fs.existsSync(pjsBold)) registerFont(pjsBold, { family: 'Plus Jakarta Sans', weight: '800' });
    }
    __fontsReady = true;
  } catch {}
}
function fromB64Url(b64 = '') {
  let s = String(b64).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  try { return Buffer.from(s, 'base64').toString('utf8'); } catch { return ''; }
}
function paintBg(ctx, W, H) {
  ctx.fillStyle = '#FFFDF8'; ctx.fillRect(0, 0, W, H);
  const blob = (x, y, r, c, a=0.6) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, c); g.addColorStop(1, `rgba(255,255,255,0)`);
    ctx.globalAlpha = a; ctx.fillStyle = g; ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI*2); ctx.fill(); ctx.globalAlpha = 1;
  };
  blob(W*0.12, H*0.18, Math.max(W,H)*0.45, '#FFD1B3', .9);
  blob(W*0.86, H*0.16, Math.max(W,H)*0.42, '#F5B0E0', .9);
  blob(W*0.16, H*0.84, Math.max(W,H)*0.48, '#AEDDFF', .9);
  blob(W*0.84, H*0.82, Math.max(W,H)*0.46, '#BFF2D9', .9);
  const g2 = ctx.createRadialGradient(W/2, H*0.4, 0, W/2, H*0.4, Math.max(W,H)*0.8);
  g2.addColorStop(0, 'rgba(0,0,0,0.05)'); g2.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g2; ctx.fillRect(0,0,W,H);
}
function wrapLines(ctx, text, maxWidth, maxLines = 6) {
  const words = String(text || '').replace(/\s+/g, ' ').trim().split(' ');
  const lines = []; let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width <= maxWidth) line = test;
    else { if (line) lines.push(line); line = w; if (lines.length >= maxLines - 1) break; }
  }
  if (line && lines.length < maxLines) lines.push(line);
  return lines;
}
function drawShareCard({ text, lang='en', mode='story' }) {
  const W = mode === 'card' ? 1200 : 1080;
  const H = mode === 'card' ? 630  : 1920;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  paintBg(ctx, W, H);

  // brand
  ctx.save();
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(17,24,39,.85)';
  ctx.font = `${mode==='card'?'900 44px':'900 64px'} "Fredoka", "Arial Black", Arial, sans-serif`;
  ctx.fillText('FORTUNY', W/2, mode==='card' ? 56 : 96);
  ctx.restore();

  // chip
  const chip = lang === 'tr' ? 'Bugünün Modu' : "Today’s Mood";
  ctx.font = `${mode==='card'?'800 24px':'800 34px'} "Plus Jakarta Sans", Arial, sans-serif`;
  const chipPadX = mode==='card' ? 18 : 22;
  const chipY    = mode==='card' ? 108 : 168;
  const chipW = Math.ceil(ctx.measureText(chip).width) + chipPadX*2;
  const chipH = (mode==='card' ? 34 : 44);
  const chipX = Math.round(W/2 - chipW/2);

  ctx.fillStyle = '#F7F2FF';
  ctx.strokeStyle = '#E6DAFF';
  ctx.lineWidth = 2;
  const r = chipH/2;
  ctx.beginPath();
  ctx.moveTo(chipX+r, chipY);
  ctx.lineTo(chipX+chipW-r, chipY);
  ctx.arc(chipX+chipW-r, chipY+r, r, -Math.PI/2, Math.PI/2);
  ctx.lineTo(chipX+r, chipY+chipH);
  ctx.arc(chipX+r, chipY+r, r, Math.PI/2, -Math.PI/2);
  ctx.closePath();
  ctx.fill(); ctx.stroke();

  ctx.fillStyle = '#5A3FB3';
  ctx.textBaseline = 'middle';
  ctx.fillText(chip, W/2, chipY + chipH/2);

  // paper
  const pad = mode==='card' ? 40 : 64;
  const paperTop = chipY + chipH + (mode==='card' ? 22 : 28);
  const paper = { x: pad, y: paperTop, w: W - pad*2, h: mode==='card' ? (H - paperTop - pad) : (H - paperTop - pad*1.2) };
  // shadow
  ctx.fillStyle = 'rgba(17,24,39,0.12)';
  ctx.filter = 'blur(20px)';
  ctx.fillRect(paper.x, paper.y+12, paper.w, paper.h);
  ctx.filter = 'none';
  // body
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = 'rgba(17,24,39,.08)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(paper.x, paper.y, paper.w, paper.h, 18);
  else ctx.rect(paper.x, paper.y, paper.w, paper.h);
  ctx.fill(); ctx.stroke();

  // fortune text
  const margin = mode==='card' ? 40 : 56;
  const textMax = paper.w - margin*2;
  let size = mode==='card' ? 44 : 64;
  const min = 28;
  ctx.textAlign = 'center';
  ctx.fillStyle = '#0d1320';
  ctx.textBaseline = 'alphabetic';

  let lines = [];
  while (size >= min) {
    ctx.font = `800 ${size}px "Plus Jakarta Sans", Arial, sans-serif`;
    lines = wrapLines(ctx, text, textMax, mode==='card' ? 5 : 8);
    const block = lines.length * (size * 1.2);
    const room = paper.h - margin*2;
    if (block <= room) break;
    size -= 2;
  }
  let y = paper.y + (paper.h/2) - ((lines.length-1) * size * 0.6);
  for (const ln of lines) { ctx.fillText(ln, W/2, y); y += size * 1.2; }

  // footer
  ctx.font = `${mode==='card'?'700 20px':'700 26px'} "Plus Jakarta Sans", Arial, sans-serif`;
  ctx.fillStyle = 'rgba(17,24,39,.7)';
  ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  ctx.fillText(lang === 'tr' ? 'günde bir fal • fortuny' : 'one fortune a day • fortuny', W/2, H - (mode==='card'?20:28));

  return canvas.toBuffer('image/png');
}

app.get('/share-card.png', async (req, res) => {
  if (!(await loadCanvas())) {
    return res.status(503).json({
      ok: false,
      error: 'canvas_missing',
      message: 'Share card temporarily unavailable (canvas not installed).'
    });
  }
  ensureFonts();

  const lang = (req.query.lang === 'tr') ? 'tr' : 'en';
  const mode = (req.query.mode === 'card') ? 'card' : 'story';
  const text = fromB64Url(req.query.t || '');
  const safe = String(text || '').replace(/\s+/g,' ').trim().slice(0, 260) ||
              (lang==='tr' ? 'Bugünün modu: hafif ve net.' : 'Today’s mood: light and clear.');
  const png = drawShareCard({ text: safe, lang, mode });
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'no-store');
  res.send(png);
});

// ------------------------------- Teşhis -----------------------------------
app.get('/api/diag', async (_req, res) => {
  const probe = `Return ONLY: {"ok":true} (no backticks, no prose)`;
  try {
    const out = await askOpenAIWithFallbacks(probe);
    const j = safeJsonParse(out) || extractJsonBlock(out);
    res.json({ ok: !!(j && j.ok === true), modelPrimary: OPENAI_MODEL, modelFallback: FALLBACK_MODEL, raw: (out||'').slice(0,180) });
  } catch (e) {
    res.status(500).json({ ok:false, error: e.message });
  }
});

// ------------------------------- Health -----------------------------------
app.get('/health', (_req, res) => res.json({ ok: true, time: nowISO() }));

// -------------------------------- Start -----------------------------------
app.listen(PORT, () => {
  console.log(`Fortuny server on http://localhost:${PORT}`);
});
