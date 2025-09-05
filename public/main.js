// Fresh reveal design + daily fallback fortunes (EN/TR)

const LS = {
  lang: 'fc_lang_pref',
  fortune: 'fc_fortune_texts',
  refreshAt: 'fc_refresh_at',
  createdAt: 'fc_created_at',
  streakCount: 'fc_streak_count',
  streakDay: 'fc_streak_last_day'
};
const TZ = 'Europe/Istanbul';

const hero = document.getElementById('heroCard');
const reveal = document.getElementById('revealStage');

let currentLang =
  new URLSearchParams(location.search).get('lang') ||
  localStorage.getItem(LS.lang) ||
  ((navigator.language || 'en').toLowerCase().startsWith('tr') ? 'tr' : 'en');

let revealed = false;
let countdownTimer = null;
let currentData = null;

// --- i18n text ---
function t(key){
  const tr = {
    tap: 'çatlatmak için dokun',
    refresh_in: 'YENİLEMEYE KALAN',
    hint: 'Her cihaz için 24 saatte bir fal.',
    unlocked: 'Yeni kurabiye açıldı ✨ Sayfayı yenileyin.',
    copy: 'Kopyala', copied: 'Kopyalandı!',
    share: 'Paylaş', shared: 'Paylaşıldı!',
    streak: (n)=> `${n} günlük seri`,
    mood_default: 'bugünün tonu'
  };
  const en = {
    tap: 'tap to crack',
    refresh_in: 'REFRESH IN',
    hint: 'One fortune per device per 24 hours.',
    unlocked: 'New cookie unlocked ✨ Refresh the page.',
    copy: 'Copy', copied: 'Copied!',
    share: 'Share', shared: 'Shared!',
    streak: (n)=> `${n}-day streak`,
    mood_default: 'today’s mood'
  };
  const dict = currentLang === 'tr' ? tr : en;
  return typeof dict[key] === 'function' ? dict[key] : dict[key];
}

// --- Daily fallback fortunes so initial view looks great, even offline ---
const SEED = {
  en: [
    { text: "Take one brave step, then another.", mood: "courage" },
    { text: "Your focus is a lighthouse. Aim it.", mood: "clarity" },
    { text: "A gentle yes will open a sturdy door.", mood: "opportunity" },
    { text: "Quiet work, loud results.", mood: "discipline" },
    { text: "Make room. New things are arriving.", mood: "renewal" },
    { text: "You already know the next right move.", mood: "intuition" },
    { text: "Small kindness, big orbit.", mood: "kindness" },
    { text: "Patience grows diamonds out of dust.", mood: "patience" },
    { text: "Let today be light and precise.", mood: "lightness" },
    { text: "Chaos clears right before the turn.", mood: "change" },
    { text: "Begin where your feet are.", mood: "presence" },
    { text: "Trade worry for one tiny action.", mood: "momentum" }
  ],
  tr: [
    { text: "Önce bir cesur adım, sonra bir tane daha.", mood: "cesaret" },
    { text: "Dikkatin bir deniz feneri. Ona yön ver.", mood: "netlik" },
    { text: "Nazik bir evet sağlam bir kapıyı açar.", mood: "fırsat" },
    { text: "Sessiz emek, yüksek sonuç.", mood: "disiplin" },
    { text: "Yer aç. Yeni şeyler geliyor.", mood: "yenilenme" },
    { text: "Bir sonraki doğru adımı zaten biliyorsun.", mood: "sezgi" },
    { text: "Küçük bir nezaket, büyük bir çevrim.", mood: "nezaket" },
    { text: "Sabır, tozdan elmas büyütür.", mood: "sabır" },
    { text: "Bugün hafif ve dikkatli olsun.", mood: "hafiflik" },
    { text: "Dönüşten hemen önce kaos durulur.", mood: "değişim" },
    { text: "Ayaklarının bastığı yerden başla.", mood: "farkındalık" },
    { text: "Endişeyi tek bir küçük eylemle değiştir.", mood: "ivme" }
  ]
};
function dayOfYear(d=new Date()){
  const start = new Date(Date.UTC(d.getUTCFullYear(),0,1));
  return Math.floor((d - start) / 86400000);
}
function seedFortune(lang){
  const set = SEED[lang] ?? SEED.en;
  const idx = dayOfYear(new Date()) % set.length;
  return set[idx];
}

// --- Helpers ---
function announce(msg){
  const sr = document.getElementById('sr-status');
  if(!sr) return; sr.textContent = ''; requestAnimationFrame(()=> sr.textContent = msg);
}
function setLangUI(lang, push=true){
  currentLang = lang;
  localStorage.setItem(LS.lang, lang);
  document.getElementById('btnTR')?.setAttribute('aria-pressed', String(lang === 'tr'));
  document.getElementById('btnEN')?.setAttribute('aria-pressed', String(lang === 'en'));
  document.getElementById('tapText').textContent = t('tap');
  applyLanguageToUI();
  if(push){
    const url = new URL(location.href);
    url.searchParams.set('lang', lang);
    history.replaceState({}, '', url);
  }
}
function formatDate(iso){
  try{
    return new Intl.DateTimeFormat(currentLang === 'tr' ? 'tr-TR':'en-US',
      { dateStyle:'long', timeZone: TZ }).format(new Date(iso));
  }catch{ return new Date(iso).toDateString(); }
}
function applyLanguageToUI(){
  const ft = document.getElementById('fortuneText');
  const moodEl = document.getElementById('fortuneMood');
  const dateEl = document.getElementById('fortuneDate');
  if (ft && currentData?.fortune) {
    ft.textContent =
      currentData.fortune?.[currentLang] ||
      currentData.fortune?.en ||
      currentData.fortune?.tr || '…';
  }
  if (moodEl) moodEl.textContent = currentData?.mood || t('mood_default');
  if (dateEl && currentData?.createdAt) dateEl.textContent = formatDate(currentData.createdAt);

  const labelRefresh = document.getElementById('labelRefresh');
  if (labelRefresh) labelRefresh.textContent = t('refresh_in');
  const hintEl = document.getElementById('hint');
  if (hintEl) hintEl.textContent = t('hint');

  const copyBtn = document.getElementById('btnCopy');
  const shareBtn = document.getElementById('btnShare');
  if (copyBtn) copyBtn.textContent = t('copy');
  if (shareBtn) shareBtn.textContent = t('share');

  const badge = document.getElementById('streakBadge');
  if (badge && badge.dataset.count) {
    const n = Number(badge.dataset.count);
    badge.textContent = `🔥 ${t('streak')(n)}`;
  }
}

// streak
function dayKey(iso, tz = TZ){
  const d = new Date(iso);
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year:'numeric', month:'2-digit', day:'2-digit' });
  return fmt.format(d);
}
function daysBetween(dayA, dayB){
  const a = new Date(dayA+'T00:00:00Z').getTime();
  const b = new Date(dayB+'T00:00:00Z').getTime();
  return Math.round((b - a)/86400000);
}
function updateStreak(serverNowISO){
  const today = dayKey(serverNowISO);
  const last = localStorage.getItem(LS.streakDay);
  let count = parseInt(localStorage.getItem(LS.streakCount) || '0', 10);
  let increased = false;
  if (!last) { count = 1; increased = true; }
  else if (today !== last) {
    const delta = daysBetween(last, today);
    count = (delta === 1) ? Math.max(1, count + 1) : 1;
    increased = true;
  }
  localStorage.setItem(LS.streakDay, today);
  localStorage.setItem(LS.streakCount, String(count));
  return { count, increased };
}

// countdown
function fmt(ms){ if(ms<0) ms=0; const s=Math.floor(ms/1000);
  const hh=String(Math.floor(s/3600)).padStart(2,'0');
  const mm=String(Math.floor((s%3600)/60)).padStart(2,'0');
  const ss=String(s%60).padStart(2,'0'); return `${hh}:${mm}:${ss}`; }
function startCountdown(serverNowISO, refreshAtISO){
  if (countdownTimer) clearInterval(countdownTimer);
  const drift = new Date(serverNowISO).getTime() - Date.now();
  const el = document.getElementById('countdown');
  const hint = document.getElementById('hint');
  function tick(){
    const left = new Date(refreshAtISO).getTime() - (Date.now() + drift);
    el.textContent = fmt(left);
    if (left <= 0) { clearInterval(countdownTimer); hint.textContent = t('unlocked'); announce(t('unlocked')); }
  }
  tick(); countdownTimer = setInterval(tick, 1000);
}

// network
async function getPeek(){
  try{ const r = await fetch('/api/fortune', { cache:'no-store' }); if(!r.ok) return null;
       const j = await r.json(); return j?.fortune ? j : null; }catch{ return null; }
}
async function postFortune(){
  const r = await fetch('/api/fortune', { method:'POST' });
  if(!r.ok) throw new Error('network');
  const j = await r.json(); if(!j.ok) throw new Error('server');
  return j;
}

// local cache
function saveLocal(data){
  try{
    if (data?.fortune && data?.refreshAt) {
      localStorage.setItem(LS.fortune, JSON.stringify(data.fortune));
      localStorage.setItem(LS.refreshAt, data.refreshAt);
      localStorage.setItem(LS.createdAt, data.createdAt || data.serverNow || new Date().toISOString());
    }
  }catch{}
}
function loadLocal(){
  try{
    const texts = JSON.parse(localStorage.getItem(LS.fortune) || 'null');
    const refreshAt = localStorage.getItem(LS.refreshAt);
    const createdAt = localStorage.getItem(LS.createdAt);
    if (!texts || !refreshAt) return null;
    return { ok:true, fortune:texts, createdAt, refreshAt, serverNow:new Date().toISOString() };
  }catch{ return null; }
}

// actions
function wireActions(){
  const copyBtn = document.getElementById('btnCopy');
  const shareBtn = document.getElementById('btnShare');

  copyBtn?.addEventListener('click', async () => {
    const text = document.getElementById('fortuneText')?.textContent || '';
    try { await navigator.clipboard.writeText(text); } catch {
      const ta=document.createElement('textarea'); ta.value=text; document.body.appendChild(ta); ta.select();
      try{document.execCommand('copy');}catch{} ta.remove();
    }
    const old=copyBtn.textContent; copyBtn.textContent = t('copied'); announce(t('copied'));
    setTimeout(()=> copyBtn.textContent = old, 1200);
  });

  // share (keeps your existing /s + /og.png setup if present; else shares page URL)
  shareBtn?.addEventListener('click', async () => {
    const text = document.getElementById('fortuneText')?.textContent || '';
    let shareUrl = location.origin;
    try{
      const b64 = btoa(unescape(encodeURIComponent(text))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
      const u = new URL('/s', location.origin); u.searchParams.set('t', b64); u.searchParams.set('lang', currentLang);
      shareUrl = u.toString();
    }catch{}
    if (navigator.share) {
      try { await navigator.share({ title:'Fortuny', text, url:shareUrl }); const old=shareBtn.textContent; shareBtn.textContent=t('shared'); setTimeout(()=> shareBtn.textContent=t('share'),1200);} catch{}
    } else {
      try { await navigator.clipboard.writeText(`${text}\n${shareUrl}`);} catch{}
      const old=shareBtn.textContent; shareBtn.textContent=t('copied'); setTimeout(()=> shareBtn.textContent=t('share'),1200);
    }
  });
}

// confetti on new streak
function confetti(x=innerWidth/2, y=innerHeight/2){
  const n=24; for(let i=0;i<n;i++){
    const p=document.createElement('i');
    Object.assign(p.style,{
      position:'fixed',left:`${x}px`,top:`${y}px`,width:'6px',height:'10px',
      background:`hsl(${(i*13)%360} 90% 60%)`,transform:`translate(-50%,-50%) rotate(${Math.random()*360}deg)`,
      borderRadius:'2px',pointerEvents:'none',zIndex:9999,transition:'transform 700ms ease-out, opacity 700ms ease-out',opacity:1
    });
    document.body.appendChild(p);
    requestAnimationFrame(()=>{
      p.style.transform += ` translate(${(Math.random()-0.5)*240}px, ${80+Math.random()*140}px)`; p.style.opacity = 0;
    });
    setTimeout(()=>p.remove(), 800);
  }
}

// panel swap (uses native View Transitions if available)
function swapPanels(showReveal){
  const doSwap = ()=>{
    hero.classList.toggle('hidden', showReveal);
    reveal.classList.toggle('hidden', !showReveal);
    reveal.toggleAttribute('inert', !showReveal);
  };
  if (document.startViewTransition) document.startViewTransition(doSwap); else doSwap();
}

// reveal using the new design
function showReveal(data){
  currentData = data;

  // fill meta (date + mood)
  const createdISO = data.createdAt || data.serverNow || new Date().toISOString();
  data.createdAt = createdISO;
  const dateEl = document.getElementById('fortuneDate');
  if (dateEl) dateEl.textContent = formatDate(createdISO);
  const moodEl = document.getElementById('fortuneMood');
  if (moodEl && !data.mood) moodEl.textContent = t('mood_default');

  // streak
  const { count, increased } = updateStreak(data.serverNow || createdISO);
  const badge = document.getElementById('streakBadge');
  if (badge){ badge.dataset.count = String(count); badge.textContent = `🔥 ${t('streak')(count)}`; }
  if (increased) confetti();

  // localize text
  applyLanguageToUI();

  // show
  swapPanels(true);

  // countdown
  if (data.refreshAt) startCountdown(data.serverNow || createdISO, data.refreshAt);

  // actions + persist
  wireActions();
  saveLocal(data);
  document.getElementById('btnCopy')?.focus();
}

async function crackAndReveal(){
  if (revealed) return; revealed = true;
  document.querySelector('.word')?.classList.add('force-crack');

  setTimeout(async () => {
    try{
      const data = await postFortune();
      showReveal(data);
    }catch{
      // graceful fallback: seed fortune with 24h timer from now
      const seed = seedFortune(currentLang);
      const now = new Date();
      const refreshAt = new Date(now.getTime() + 24*3600*1000).toISOString();
      const fallback = {
        ok:true,
        fortune:{ en: SEED.en.find(f=>f.text===seed.text)?.text || seed.text,
                  tr: SEED.tr.find(f=>f.text===seed.text)?.text || seed.text },
        mood: seed.mood,
        createdAt: now.toISOString(),
        refreshAt,
        serverNow: now.toISOString()
      };
      showReveal(fallback);
      document.getElementById('hint').textContent = t('hint');
      wireActions();
    }
  }, 640);
}

// events
document.getElementById('btnTR')?.addEventListener('click', () => setLangUI('tr'));
document.getElementById('btnEN')?.addEventListener('click', () => setLangUI('en'));
const wordEl = document.querySelector('.word');
wordEl?.addEventListener('click', crackAndReveal);
wordEl?.addEventListener('keydown', (e)=>{ if(e.key==='Enter'||e.key===' ') crackAndReveal(); });

// init
(async()=>{
  setLangUI(currentLang, false);
  document.getElementById('tapText').textContent = t('tap');

  // Try server cache first
  const server = await getPeek();
  if (server) { showReveal(server); return; }

  // Local cache with new skin
  const local = loadLocal();
  if (local && new Date(local.refreshAt).getTime() > Date.now()) {
    // enrich with date/mood defaults for the new design
    local.mood = local.mood || t('mood_default');
    showReveal(local); return;
  }

  // Else show hero
  hero.classList.remove('hidden');
  reveal.classList.add('hidden');
})();
