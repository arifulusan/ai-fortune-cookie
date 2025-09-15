// Fortuny — solid Fredoka hero; 24h lock; EN/TR; streak; copy/share; countdown

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

// i18n
function t(key){
  const tr = {
    tap:'çatlatmak için dokun',
    refresh_in:'YENİLEMEYE KALAN',
    hint:'Her cihaz için 24 saatte bir fal.',
    unlocked:'Yeni kurabiye açıldı ✨ Sayfayı yenileyin.',
    copy:'Kopyala', copied:'Kopyalandı!',
    share:'Paylaş', shared:'Paylaşıldı!',
    streak:(n)=>`${n} günlük seri`,
    today:"Bugünün Modu"
  };
  const en = {
    tap:'tap to crack',
    refresh_in:'REFRESH IN',
    hint:'One fortune per device per 24 hours.',
    unlocked:'New cookie unlocked ✨ Refresh the page.',
    copy:'Copy', copied:'Copied!',
    share:'Share', shared:'Shared!',
    streak:(n)=>`${n}-day streak`,
    today:"Today’s Mood"
  };
  const dict = currentLang === 'tr' ? tr : en;
  return typeof dict[key] === 'function' ? dict[key] : dict[key];
}

function announce(msg){
  const sr=document.getElementById('sr-status'); if(!sr) return;
  sr.textContent=''; requestAnimationFrame(()=> sr.textContent=msg);
}

function setLangUI(lang, push=true){
  currentLang = lang;
  localStorage.setItem(LS.lang, lang);
  document.getElementById('btnTR')?.setAttribute('aria-pressed', String(lang==='tr'));
  document.getElementById('btnEN')?.setAttribute('aria-pressed', String(lang==='en'));
  document.getElementById('tapText').textContent = t('tap');
  document.getElementById('todayLabel').textContent = t('today');

  if (currentData?.fortune) {
    const ft = document.getElementById('fortuneText');
    ft.textContent = currentData.fortune[lang] || currentData.fortune.en || currentData.fortune.tr || '…';
  }

  document.getElementById('labelRefresh').textContent = t('refresh_in');
  document.getElementById('hint').textContent = t('hint');
  document.getElementById('btnCopy').textContent = t('copy');
  document.getElementById('btnShare').textContent = t('share');

  if (push) {
    const url = new URL(location.href);
    url.searchParams.set('lang', lang);
    history.replaceState({}, '', url);
  }
}

// streak helpers
function dayKey(iso, tz = TZ){
  const d = new Date(iso);
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year:'numeric', month:'2-digit', day:'2-digit' });
  return fmt.format(d);
}
function daysBetween(dayA, dayB){
  const a = new Date(dayA+'T00:00:00Z').getTime();
  const b = new Date(dayB+'T00:00:00Z').getTime();
  return Math.round((b-a)/86400000);
}
function updateStreak(serverNowISO){
  const today = dayKey(serverNowISO);
  const last = localStorage.getItem(LS.streakDay);
  let count = parseInt(localStorage.getItem(LS.streakCount) || '0', 10);
  let increased = false;
  if (!last) { count = 1; increased = true; }
  else if (today !== last) {
    const delta = daysBetween(last, today);
    count = (delta === 1) ? Math.max(1, count+1) : 1;
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
  function tick(){
    const left = new Date(refreshAtISO).getTime() - (Date.now() + drift);
    document.getElementById('countdown').textContent = fmt(left);
    if (left <= 0) { clearInterval(countdownTimer); document.getElementById('hint').textContent = t('unlocked'); announce(t('unlocked')); }
  }
  tick(); countdownTimer = setInterval(tick, 1000);
}

// API
async function getPeek(){ try{ const r=await fetch('/api/fortune',{cache:'no-store'}); if(!r.ok) return null; const j=await r.json(); return j?.fortune?j:null; }catch{return null;} }
async function postFortune(){ const r=await fetch('/api/fortune',{method:'POST'}); if(!r.ok) throw new Error('net'); const j=await r.json(); if(!j.ok) throw new Error('srv'); return j; }

// Local cache
function saveLocal(data){ try{ if(data?.fortune&&data?.refreshAt){ localStorage.setItem(LS.fortune, JSON.stringify(data.fortune)); localStorage.setItem(LS.refreshAt, data.refreshAt); localStorage.setItem(LS.createdAt, data.createdAt||data.serverNow||new Date().toISOString()); } }catch{} }
function loadLocal(){ try{ const texts=JSON.parse(localStorage.getItem(LS.fortune)||'null'); const refreshAt=localStorage.getItem(LS.refreshAt); const createdAt=localStorage.getItem(LS.createdAt); if(!texts||!refreshAt) return null; return {ok:true, fortune:texts, createdAt, refreshAt, serverNow:new Date().toISOString()}; }catch{return null;} }

// Actions
function wireActions(){
  const copyBtn=document.getElementById('btnCopy');
  const shareBtn=document.getElementById('btnShare');

  copyBtn?.addEventListener('click', async ()=>{
    const text=document.getElementById('fortuneText')?.textContent||'';
    try{await navigator.clipboard.writeText(text);}catch{
      const ta=document.createElement('textarea'); ta.value=text; document.body.appendChild(ta); ta.select(); try{document.execCommand('copy');}catch{} ta.remove();
    }
    const old=copyBtn.textContent; copyBtn.textContent=t('copied'); announce(t('copied')); setTimeout(()=>copyBtn.textContent=old,1200);
  });

  // base64url helper
  const b64url = s => btoa(unescape(encodeURIComponent(s))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');

  shareBtn?.addEventListener('click', async ()=>{
    const text=document.getElementById('fortuneText')?.textContent||'';
    const imgUrl = `/share-card.png?lang=${currentLang}&mode=story&t=${encodeURIComponent(b64url(text))}`;

    try {
      const resp = await fetch(imgUrl, { cache: 'no-store' });
      if (!resp.ok) throw new Error('card');
      const blob = await resp.blob();
      const file = new File([blob], 'fortuny.png', { type: 'image/png' });

      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Fortuny', text });
        const old=shareBtn.textContent; shareBtn.textContent=t('shared'); setTimeout(()=>shareBtn.textContent=t('share'),1200);
        return;
      }
      // fallback: yeni sekmede aç
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(()=> URL.revokeObjectURL(url), 30000);
      const old=shareBtn.textContent; shareBtn.textContent=t('copied'); setTimeout(()=>shareBtn.textContent=t('share'),1200);
    } catch {
      // son fallback: metin+link kopyala
      try{ await navigator.clipboard.writeText(`${text}\n${location.href}`); }catch{}
      const old=shareBtn.textContent; shareBtn.textContent=t('copied'); setTimeout(()=>shareBtn.textContent=t('share'),1200);
    }
  });
}

// Confetti
function confetti(x=innerWidth/2, y=innerHeight/2){
  const n=24; for(let i=0;i<n;i++){
    const p=document.createElement('i');
    Object.assign(p.style,{position:'fixed',left:`${x}px`,top:`${y}px`,width:'6px',height:'10px',
      background:`hsl(${(i*13)%360} 90% 60%)`,transform:`translate(-50%,-50%) rotate(${Math.random()*360}deg)`,
      borderRadius:'2px',pointerEvents:'none',zIndex:9999,transition:'transform 700ms ease-out, opacity 700ms ease-out',opacity:1});
    document.body.appendChild(p);
    requestAnimationFrame(()=>{ p.style.transform+=` translate(${(Math.random()-0.5)*240}px, ${80+Math.random()*140}px)`; p.style.opacity=0; });
    setTimeout(()=>p.remove(),800);
  }
}

// Swap hero/reveal
function swapPanels(showReveal){
  const doSwap=()=>{ hero.classList.toggle('hidden', showReveal); reveal.classList.toggle('hidden', !showReveal); reveal.toggleAttribute('inert', !showReveal); };
  if (document.startViewTransition) document.startViewTransition(doSwap); else doSwap();
}

function showReveal(data){
  currentData = data;

  const {count,increased}=updateStreak(data.serverNow || new Date().toISOString());
  const badge=document.getElementById('streakBadge'); if(badge){ badge.dataset.count=String(count); badge.textContent=`🔥 ${currentLang==='tr'?`${count} günlük seri`:`${count}-day streak`}`; }
  if (increased) confetti();

  setLangUI(currentLang, false);

  swapPanels(true);

  if (data.refreshAt) startCountdown(data.serverNow || new Date().toISOString(), data.refreshAt);

  wireActions();
  saveLocal(data);
  document.getElementById('btnCopy')?.focus();
}

async function crackAndReveal(){
  if (revealed) return; revealed = true;
  document.querySelector('.word')?.classList.add('force-crack');
  setTimeout(async ()=>{
    try{ const data=await postFortune(); showReveal(data); }
    catch{
      const fallback = {
        ok:true,
        fortune:{ en:"Make room. New things are arriving.", tr:"Yer aç. Yeni şeyler geliyor." },
        createdAt:new Date().toISOString(),
        refreshAt:new Date(Date.now()+24*3600*1000).toISOString(),
        serverNow:new Date().toISOString()
      };
      showReveal(fallback);
    }
  }, 640);
}

// Events
document.getElementById('btnTR')?.addEventListener('click',()=>setLangUI('tr'));
document.getElementById('btnEN')?.addEventListener('click',()=>setLangUI('en'));
const wordEl=document.querySelector('.word');
wordEl?.addEventListener('click',crackAndReveal);
wordEl?.addEventListener('keydown',e=>{ if(e.key==='Enter'||e.key===' ') crackAndReveal(); });

// Init
(async()=>{
  setLangUI(currentLang, false);
  document.getElementById('tapText').textContent=t('tap');

  const server=await getPeek();
  if (server) { showReveal(server); return; }

  const local=loadLocal();
  if (local && new Date(local.refreshAt).getTime()>Date.now()) { showReveal(local); return; }

  hero.classList.remove('hidden'); reveal.classList.add('hidden');
})();
