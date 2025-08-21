const LS_LANG = 'fc_lang_pref';
let currentLang = localStorage.getItem(LS_LANG) ||
  ((navigator.language || 'en').toLowerCase().startsWith('tr') ? 'tr' : 'en');

function setLangUI(lang) {
  currentLang = lang;
  localStorage.setItem(LS_LANG, lang);
  document.getElementById('btnTR')?.setAttribute('aria-pressed', String(lang === 'tr'));
  document.getElementById('btnEN')?.setAttribute('aria-pressed', String(lang === 'en'));
  const tapText = document.getElementById('tapText');
  if (tapText) tapText.textContent = (lang === 'tr') ? 'çatlatmak için dokun' : 'tap to crack';
}

let revealed = false;
let countdownTimer = null;

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

async function getPeek() {
  try {
    const r = await fetch('/api/fortune');
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

async function crackAndReveal() {
  if (revealed) return; revealed = true;
  const cookieEl = document.getElementById('cookie');
  const cookieStage = document.getElementById('cookieStage');
  cookieEl.classList.add('crack');

  const proceed = async () => {
    try {
      const data = await postFortune();
      cookieStage?.remove();
      injectReveal();
      document.getElementById('fortuneText').textContent =
        data.fortune[currentLang] || data.fortune.en || data.fortune.tr || '…';
      startCountdown(data.serverNow, data.refreshAt);
      const hintEl = document.getElementById('hint');
      hintEl.textContent = (currentLang === 'tr')
        ? 'Her cihaz için 24 saatte bir fal.'
        : 'One fortune per device per 24 hours.';
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
setLangUI(currentLang);
getPeek();
