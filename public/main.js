// Pastel UI + Streak + Share/Copy + Skip-cookie-if-already-opened

const LS = {
  lang: 'fc_lang_pref',
  fortune: 'fc_fortune_texts',
  refreshAt: 'fc_refresh_at',
  createdAt: 'fc_created_at',
  streakCount: 'fc_streak_count',
  streakDay: 'fc_streak_last_day'
};
const TZ = 'Europe/Istanbul';

let currentLang =
  localStorage.getItem(LS.lang) ||
  ((navigator.language || 'en').toLowerCase().startsWith('tr') ? 'tr' : 'en');

let revealed = false;
let countdownTimer = null;
let currentData = null; // holds latest server/local data

// ---------- i18n helpers ----------
function t(key){
  const tr = {
    tap: 'çatlatmak için dokun',
    refresh_in: 'YENİLEMEYE KALAN',
    hint: 'Her cihaz için 24 saatte bir fal.',
    unlocked: 'Yeni kurabiye açıldı ✨ Sayfayı yenileyin.',
    copy: 'Kopyala',
    copied: 'Kopyalandı!',
    share: 'Paylaş',
    shared: 'Paylaşıldı!',
    streak: (n)=> `${n} günlük seri`
  };
  const en = {
    tap: 'tap to crack',
    refresh_in: 'REFRESH IN',
    hint: 'One fortune per device per 24 hours.',
    unlocked: 'New cookie unlocked ✨ Refresh the page.',
    copy: 'Copy',
    copied: 'Copied!',
    share: 'Share',
    shared: 'Shared!',
    streak: (n)=> `${n}-day streak`
  };
  const dict = currentLang === 'tr' ? tr : en;
  return typeof dict[key] === 'function' ? dict[key] : dict[key];
}

function setLangUI(lang) {
  currentLang = lang;
  localStorage.setItem(LS.lang, lang);
  document.getElementById('btnTR')?.setAttribute('aria-pressed', String(lang === 'tr'));
  document.getElementById('btnEN')?.setAttribute('aria-pressed', String(lang === 'en'));
  const tapText = document.getElementById('tapText');
  if (tapText) tapText.textContent = t('tap');
  applyLanguageToUI();
}

function applyLanguageToUI() {
  const ft = document.getElementById('fortuneText');
  if (ft && currentData?.fortune) {
    ft.textContent =
      currentData.fortune?.[currentLang] ||
      currentData.fortune?.en ||
      currentData.fortune?.tr || '…';
  }
  const labelRefresh = document.getElementById('labelRefresh');
  if (labelRefresh) labelRefresh.textContent = t('refresh_in');

  const hintEl = document.getElementById('hint');
  if (hintEl && currentData) hintEl.textContent = t('hint');

  const copyBtn = document.getElementById('btnCopy');
  const shareBtn = document.getElementById('btnShare');
  if (copyBtn) copyBtn.textContent = t('copy');
  if (shareBtn) shareBtn.textContent = t('share');

  // streak badge text (keeps number)
  const streakBadge = document.getElementById('streakBadge');
  if (streakBadge && streakBadge.dataset.count) {
    const n = Number(streakBadge.dataset.count);
    streakBadge.textContent = `🔥 ${t('streak')(n)}`;
    streakBadge.dataset.count = String(n);
  }
}

// ---------- time & streak ----------
function dayKey(iso, tz = TZ){
  const d = new Date(iso);
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year:'numeric', month:'2-digit', day:'2-digit' });
  return fmt.format(d); // YYYY-MM-DD
}
function daysBetween(dayA, dayB){
  // treat day strings as UTC dates to compute delta
  const a = new Date(dayA+'T00:00:00Z').getTime();
  const b = new Date(dayB+'T00:00:00Z').getTime();
  return Math.round((b - a)/(24*3600*1000));
}
function updateStreak(serverNowISO){
  const today = dayKey(serverNowISO);
  const last = localStorage.getItem(LS.streakDay);
  let count = parseInt(localStorage.getItem(LS.streakCount) || '0', 10);

  if (!last) {
    count = 1;
  } else if (today === last) {
    // same day, keep
  } else {
    const delta = daysBetween(last, today);
    count = (delta === 1) ? Math.max(1, count + 1) : 1;
  }

  localStorage.setItem(LS.streakDay, today);
  localStorage.setItem(LS.streakCount, String(count));
  return count;
}

// ---------- countdown ----------
function fmt(ms) {
  if (ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}
function startCountdown(serverNowISO, refreshAtISO) {
  if (countdownTimer) clearInterval(countdownTimer);
  const serverNow = new Date(serverNowISO).getTime();
  const clientNow = Date.now();
  const drift = serverNow - clientNow;

  const countdownEl = document.getElementById('countdown');
  const hintEl = document.getElementById('hint');

  function tick() {
    const left = new Date(refreshAtISO).getTime() - (Date.now() + drift);
    countdownEl.textContent = fmt(left);
    if (left <= 0) {
      clearInterval(countdownTimer);
      hintEl.textContent = t('unlocked');
    }
  }
  tick();
  countdownTimer = setInterval(tick, 1000);
}

// ---------- DOM builders ----------
function injectReveal() {
  let section = document.getElementById('revealStage');
  if (!section) {
    const wrap = document.querySelector('main.wrap') || document.querySelector('main');
    section = document.createElement('section');
    section.className = 'stage';
    section.id = 'revealStage';
    section.innerHTML = `
      <article class="card">
        <div class="topline">
          <span id="streakBadge" class="streak" data-count="1">🔥 ${t('streak')(1)}</span>
        </div>
        <div class="paper"><div id="fortuneText" class="fortune"></div></div>
        <div class="actions">
          <button id="btnCopy" class="btn">${t('copy')}</button>
          <button id="btnShare" class="btn primary">${t('share')}</button>
        </div>
        <div class="countdown-wrap">
          <span id="labelRefresh" class="label">${t('refresh_in')}</span>
          <span id="countdown" class="countdown">--:--:--</span>
        </div>
        <div id="hint" class="hint"></div>
      </article>`;
    wrap.appendChild(section);
  }
  return section;
}

// ---------- network ----------
async function getPeek() {
  try {
    const r = await fetch('/api/fortune', { cache: 'no-store' });
    if (!r.ok) return null;
    const j = await r.json();
    return j?.fortune ? j : null;
  } catch { return null; }
}
async function postFortune() {
  const r = await fetch('/api/fortune', { method: 'POST' });
  if (!r.ok) throw new Error('network');
  const j = await r.json();
  if (!j.ok) throw new Error('server');
  return j;
}

// ---------- reveal flow ----------
function saveLocal(data) {
  try {
    if (data?.fortune && data?.refreshAt) {
      localStorage.setItem(LS.fortune, JSON.stringify(data.fortune));
      localStorage.setItem(LS.refreshAt, data.refreshAt);
      localStorage.setItem(LS.createdAt, data.createdAt || data.serverNow || new Date().toISOString());
    }
  } catch {}
}
function loadLocal() {
  try {
    const texts = JSON.parse(localStorage.getItem(LS.fortune) || 'null');
    const refreshAt = localStorage.getItem(LS.refreshAt);
    const createdAt = localStorage.getItem(LS.createdAt);
    if (!texts || !refreshAt) return null;
    return { ok:true, fortune:texts, createdAt, refreshAt, serverNow:new Date().toISOString() };
  } catch { return null; }
}

function wireActions(){
  const copyBtn = document.getElementById('btnCopy');
  const shareBtn = document.getElementById('btnShare');

  copyBtn?.addEventListener('click', async () => {
    const text = document.getElementById('fortuneText')?.textContent || '';
    try {
      await navigator.clipboard.writeText(text);
      const old = copyBtn.textContent;
      copyBtn.textContent = t('copied');
      setTimeout(()=> copyBtn.textContent = old, 1200);
    } catch {
      // fallback: select & copy
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch {}
      document.body.removeChild(ta);
      const old = copyBtn.textContent;
      copyBtn.textContent = t('copied');
      setTimeout(()=> copyBtn.textContent = old, 1200);
    }
  });

  shareBtn?.addEventListener('click', async () => {
    const text = document.getElementById('fortuneText')?.textContent || '';
    const shareData = {
      title: 'Daily Fortune',
      text,
      url: location.origin
    };
    if (navigator.share) {
      try {
        await navigator.share(shareData);
        const old = shareBtn.textContent;
        shareBtn.textContent = t('shared');
        setTimeout(()=> shareBtn.textContent = t('share'), 1200);
      } catch {
        // ignore cancel
      }
    } else {
      // fallback to copy
      try { await navigator.clipboard.writeText(`${text}\n${location.origin}`); } catch {}
      const old = shareBtn.textContent;
      shareBtn.textContent = t('copied');
      setTimeout(()=> shareBtn.textContent = t('share'), 1200);
    }
  });
}

function revealFromData(data) {
  currentData = data;
  // compute and show streak
  const count = updateStreak(data.serverNow);
  injectReveal();
  const badge = document.getElementById('streakBadge');
  if (badge) { badge.dataset.count = String(count); badge.textContent = `🔥 ${t('streak')(count)}`; }

  // remove cookie screen
  document.getElementById('cookieStage')?.remove();

  // render texts
  applyLanguageToUI();
  // countdown & hint
  startCountdown(data.serverNow, data.refreshAt);
  const hintEl = document.getElementById('hint');
  if (hintEl) hintEl.textContent = t('hint');

  // actions
  wireActions();
  // persist
  saveLocal(data);
}

async function crackAndReveal() {
  if (revealed) return; revealed = true;

  const cookieEl = document.getElementById('cookie');
  const cookieStage = document.getElementById('cookieStage');
  cookieEl.classList.add('crack');

  const proceed = async () => {
    try {
      const data = await postFortune();
      revealFromData(data);
    } catch {
      cookieStage?.remove();
      injectReveal();
      document.getElementById('fortuneText').textContent =
        (currentLang === 'tr') ? 'Şu an açılamadı. Tekrar deneyin.' : 'Couldn’t open the fortune. Try again.';
      wireActions();
    }
  };

  const onAnimEnd = () => { cookieEl.removeEventListener('animationend', onAnimEnd, true); proceed(); };
  cookieEl.addEventListener('animationend', onAnimEnd, true);
  setTimeout(() => { cookieEl.removeEventListener('animationend', onAnimEnd, true); proceed(); }, 1200);
}

// ---------- events ----------
document.getElementById('btnTR')?.addEventListener('click', () => setLangUI('tr'));
document.getElementById('btnEN')?.addEventListener('click', () => setLangUI('en'));
document.getElementById('cookie')?.addEventListener('click', crackAndReveal);
document.getElementById('cookie')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') crackAndReveal();
});

// ---------- init ----------
(async () => {
  setLangUI(currentLang);

  // Prevent cookie flash while we decide
  const cookieStage = document.getElementById('cookieStage');
  if (cookieStage) cookieStage.style.display = 'none';

  // Prefer server cache
  const server = await getPeek();
  if (server) { revealFromData(server); return; }

  // Local fallback (if server cache was lost)
  const local = loadLocal();
  if (local && new Date(local.refreshAt).getTime() > Date.now()) {
    revealFromData(local); return;
  }

  // Else show cookie
  if (cookieStage) cookieStage.style.display = '';
})();
