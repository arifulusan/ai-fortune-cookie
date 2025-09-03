// public/main.js — skip cookie if user already has today's fortune
// and allow live language switching after reveal.

const LS = {
  lang: 'fc_lang_pref',
  fortune: 'fc_fortune_texts',
  refreshAt: 'fc_refresh_at',
  createdAt: 'fc_created_at'
};

let currentLang =
  localStorage.getItem(LS.lang) ||
  ((navigator.language || 'en').toLowerCase().startsWith('tr') ? 'tr' : 'en');

let revealed = false;
let countdownTimer = null;
let currentData = null; // <- keep the currently shown fortune/times here

function setLangUI(lang) {
  currentLang = lang;
  localStorage.setItem(LS.lang, lang);
  document.getElementById('btnTR')?.setAttribute('aria-pressed', String(lang === 'tr'));
  document.getElementById('btnEN')?.setAttribute('aria-pressed', String(lang === 'en'));
  const tapText = document.getElementById('tapText');
  if (tapText) tapText.textContent = (lang === 'tr') ? 'çatlatmak için dokun' : 'tap to crack';
  applyLanguageToUI(); // <- update visible texts immediately
}

function applyLanguageToUI() {
  // update revealed fortune text if present
  const ft = document.getElementById('fortuneText');
  if (ft && currentData?.fortune) {
    ft.textContent =
      currentData.fortune?.[currentLang] ||
      currentData.fortune?.en ||
      currentData.fortune?.tr ||
      '…';
  }
  // update "REFRESH IN" label
  const labelRefresh = document.getElementById('labelRefresh');
  if (labelRefresh) labelRefresh.textContent = (currentLang === 'tr') ? 'YENİLEMEYE KALAN' : 'REFRESH IN';

  // update hint under the countdown (only if we already revealed)
  const hintEl = document.getElementById('hint');
  if (hintEl && currentData) {
    hintEl.textContent = (currentLang === 'tr')
      ? 'Her cihaz için 24 saatte bir fal.'
      : 'One fortune per device per 24 hours.';
  }
}

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
      hintEl.textContent = (currentLang === 'tr')
        ? 'Yeni kurabiye açıldı ✨ Sayfayı yenileyin.'
        : 'New cookie unlocked ✨ Refresh the page.';
    }
  }
  tick();
  countdownTimer = setInterval(tick, 1000);
}

function injectReveal() {
  let section = document.getElementById('revealStage');
  if (!section) {
    const wrap = document.querySelector('main.wrap') || document.querySelector('main');
    section = document.createElement('section');
    section.className = 'stage';
    section.id = 'revealStage';
    section.innerHTML = `
      <article class="card">
        <div class="paper"><div id="fortuneText" class="fortune"></div></div>
        <div class="countdown-wrap">
          <span id="labelRefresh" class="label">${currentLang === 'tr' ? 'YENİLEMEYE KALAN' : 'REFRESH IN'}</span>
          <span id="countdown" class="countdown">--:--:--</span>
        </div>
        <div id="hint" class="hint"></div>
      </article>`;
    wrap.appendChild(section);
  }
  return section;
}

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
    return {
      ok: true,
      fortune: texts,
      createdAt,
      refreshAt,
      serverNow: new Date().toISOString()
    };
  } catch { return null; }
}

function revealFromData(data) {
  currentData = data; // <- remember it so we can switch languages later
  const cookieStage = document.getElementById('cookieStage');
  cookieStage?.remove();
  injectReveal();

  // render with current language
  applyLanguageToUI();

  // start countdown & hint
  startCountdown(data.serverNow, data.refreshAt);
  const hintEl = document.getElementById('hint');
  if (hintEl) {
    hintEl.textContent = (currentLang === 'tr')
      ? 'Her cihaz için 24 saatte bir fal.'
      : 'One fortune per device per 24 hours.';
  }

  saveLocal(data);
}

async function getPeek() {
  try {
    const r = await fetch('/api/fortune', { cache: 'no-store' });
    if (!r.ok) return null;
    const j = await r.json();
    return j?.fortune ? j : null;
  } catch {
    return null;
  }
}

async function postFortune() {
  const r = await fetch('/api/fortune', { method: 'POST' });
  if (!r.ok) throw new Error('network');
  const j = await r.json();
  if (!j.ok) throw new Error('server');
  return j;
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
    }
  };

  const onAnimEnd = () => { cookieEl.removeEventListener('animationend', onAnimEnd, true); proceed(); };
  cookieEl.addEventListener('animationend', onAnimEnd, true);
  setTimeout(() => { cookieEl.removeEventListener('animationend', onAnimEnd, true); proceed(); }, 1200);
}

// events
document.getElementById('btnTR')?.addEventListener('click', () => setLangUI('tr'));
document.getElementById('btnEN')?.addEventListener('click', () => setLangUI('en'));
document.getElementById('cookie')?.addEventListener('click', crackAndReveal);
document.getElementById('cookie')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') crackAndReveal();
});

// init
(async () => {
  setLangUI(currentLang);

  // Hide cookie until we decide which view to show (prevents flash)
  const cookieStage = document.getElementById('cookieStage');
  if (cookieStage) cookieStage.style.display = 'none';

  // Prefer server cache
  const server = await getPeek();
  if (server) {
    revealFromData(server);
    return;
  }

  // Fallback to local cache if still valid
  const local = loadLocal();
  if (local && new Date(local.refreshAt).getTime() > Date.now()) {
    revealFromData(local);
    return;
  }

  // Else show cookie
  if (cookieStage) cookieStage.style.display = '';
})();
