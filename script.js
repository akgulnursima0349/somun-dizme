/* ============================================================
   SOMUN SIRALAMA OYUNU – script.js
   ============================================================ */

// ── Ses Sistemi ─────────────────────────────────────────────
const SFX = (() => {
  const files = {
    pick:    'sounds/nut-pick.mp3',
    place:   'sounds/nut-place.mp3',
    cap:     'sounds/peg-cap.mp3',
    win:     'sounds/level-win.mp3',
    unlock:  'sounds/building-unlock.mp3',
  };

  const pool = {};
  Object.entries(files).forEach(([key, src]) => {
    const audio = new Audio(src);
    audio.preload = 'auto';
    pool[key] = audio;
  });

  let muted = localStorage.getItem('somun-sfx-muted') === '1';

  return {
    play(key) {
      if (muted) return;
      const audio = pool[key];
      if (!audio) return;
      const clone = audio.cloneNode();
      clone.volume = audio.volume;
      clone.play().catch(() => {});
    },
    setVolume(key, vol) {
      if (pool[key]) pool[key].volume = vol;
    },
    toggleMute() {
      muted = !muted;
      localStorage.setItem('somun-sfx-muted', muted ? '1' : '0');
      return muted;
    },
    isMuted() { return muted; },
  };
})();

// ── Arka Plan Müziği ────────────────────────────────────────
const BGM = (() => {
  const audio = new Audio('sounds/sounds-bgm.mp3');
  audio.loop   = true;
  audio.volume = 0.35;

  let muted = localStorage.getItem('somun-bgm-muted') === '1';

  return {
    play() {
      if (muted) return;
      audio.play().catch(() => {});
    },
    pause()      { audio.pause(); },
    setVolume(v) {
      if (!muted) audio.volume = Math.max(0, Math.min(1, v));
    },
    toggleMute() {
      muted = !muted;
      localStorage.setItem('somun-bgm-muted', muted ? '1' : '0');
      if (muted) audio.pause();
      else audio.play().catch(() => {});
      return muted;
    },
    isMuted() { return muted; },
  };
})();

// ── Sabitler ────────────────────────────────────────────────
const COLORS = ['red', 'blue', 'green', 'yellow', 'cyan', 'purple', 'orange', 'pink'];

const CAPACITY = 5; // her çubukta max somun sayısı

// ── Puan sayacı animasyonu ───────────────────────────────────
let displayedScore  = 0;
let scoreAnimTimer  = null;

function animateScoreDisplay(target) {
  if (scoreAnimTimer) clearInterval(scoreAnimTimer);
  const el    = document.getElementById('score-display');
  const start = displayedScore;
  const diff  = target - start;
  if (diff <= 0) { displayedScore = target; if (el) el.textContent = target; return; }

  const stepMs     = 30;
  const totalSteps = Math.ceil(500 / stepMs); // ~500ms toplam süre
  let step = 0;

  if (el) el.classList.add('score-ticking');
  scoreAnimTimer = setInterval(() => {
    step++;
    const t = Math.min(step / totalSteps, 1);
    displayedScore = Math.round(start + diff * (1 - Math.pow(1 - t, 2)));
    if (el) el.textContent = displayedScore;
    if (step >= totalSteps) {
      displayedScore = target;
      if (el) { el.textContent = target; el.classList.remove('score-ticking'); }
      clearInterval(scoreAnimTimer);
      scoreAnimTimer = null;
    }
  }, stepMs);
}

function resetScoreDisplay() {
  if (scoreAnimTimer) { clearInterval(scoreAnimTimer); scoreAnimTimer = null; }
  displayedScore = 0;
  const el = document.getElementById('score-display');
  if (el) { el.textContent = 0; el.classList.remove('score-ticking'); }
}

// ── Oyun Durumu ─────────────────────────────────────────────
const state = {
  level:          1,
  moves:          0,
  score:          0,
  pegs:           [],   // string[][] – her çubuk renk listesi (0=alt, son=üst)
  selected:       null, // seçili çubuk indexi veya null
  savedPegs:      [],   // yeniden başlatma için yedek
  lastPlaced:     null, // { peg, nutIdx } – nut-placing animasyonu için
  animating:      false,// grup taşıma animasyonu sırasında girdi kilidi
  completedPegs:  new Set(), // puanı verilmiş tamamlanmış vida indexleri
  newlyCompleted: new Set(), // bu hamle yeni tamamlananlar (animasyon için)
  mysteryNuts:    [],        // mysteryNuts[pegIdx] = gizli indekslerin Set'i
  justRevealed:   new Set(), // bu render'da açılan 'pegIdx,nutIdx' çiftleri
  lastSnapshot:   null,      // geri alma için önceki durum
};

// ── Yardımcı: Üstteki ardışık aynı renk somun sayısı ────────
// Mystery somunlara çarpınca sayma durur (rengi bilinmez)
function countTopGroup(peg, pegIdx) {
  if (peg.length === 0) return 0;
  const topColor = peg[peg.length - 1];
  let count = 0;
  for (let i = peg.length - 1; i >= 0 && peg[i] === topColor; i--) {
    if (state.mysteryNuts[pegIdx] && state.mysteryNuts[pegIdx].has(i)) break;
    count++;
  }
  return count;
}

// ── Yardımcı: Diziyi karıştır ───────────────────────────────
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ── Gizli Somon Sistemi ─────────────────────────────────────
function mysteryCountForLevel(level) {
  if (level <  10) return 0; // Bölüm 1-9:  gizli somon yok
  if (level <  20) return 1; // Bölüm 10-19: 1 gizli somon
  if (level <  30) return 2; // Bölüm 20-29: 2 gizli somon
  return 3;                  // Bölüm 30+:   3 gizli somon
}

function initMysteryNuts() {
  const count = mysteryCountForLevel(state.level);
  state.mysteryNuts = state.pegs.map(peg => {
    const s = new Set();
    // En üstteki somon hiçbir zaman gizli olmaz (seçilebilmesi için)
    const n = Math.min(count, peg.length - 1);
    for (let i = 0; i < n; i++) s.add(i);
    return s;
  });
}

// Bir peg'in yeni tepesi gizliyse açıkla
function revealMysteryNuts(pegIdx) {
  const peg = state.pegs[pegIdx];
  if (peg.length === 0) return;
  const topIdx = peg.length - 1;
  if (state.mysteryNuts[pegIdx].has(topIdx)) {
    state.mysteryNuts[pegIdx].delete(topIdx);
    state.justRevealed.add(`${pegIdx},${topIdx}`);
  }
}

// ── Seviye üretimi ──────────────────────────────────────────
// Her 5 bölümde bir zorluk artar: renk sayısı veya boş vida azalır
// Bölüm  1-4 : 2→5 renk, 2 boş (ısınma)
// Bölüm  5-9 : 6 renk, 2 boş
// Bölüm 10-14: 6 renk, 1 boş
// Bölüm 15-19: 7 renk, 2 boş
// Bölüm 20-24: 7 renk, 1 boş
// Bölüm 25-29: 8 renk, 2 boş
// Bölüm 30+  : 8 renk, 1 boş
function getConfig(level) {
  if (level <= 4) return { colors: level + 1, empties: 2 };

  // tier: 0=5-9, 1=10-14, 2=15-19, 3=20-24, 4=25-29, 5=30+
  const tier    = Math.min(Math.floor((level - 5) / 5), 5);
  const colors  = Math.min(6 + Math.floor(tier / 2), 8); // 6,6,7,7,8,8
  const empties = tier % 2 === 0 ? 2 : 1;                // 2,1,2,1,2,1
  return { colors, empties };
}

function generatePegs(colorCount, emptyCount) {
  const colors = COLORS.slice(0, colorCount);

  // Her renk için CAPACITY adet somun ekle ve karıştır
  const pool = shuffle(colors.flatMap(c => Array(CAPACITY).fill(c)));

  const pegs = [];
  for (let i = 0; i < colorCount; i++) {
    pegs.push(pool.splice(0, CAPACITY));
  }
  for (let i = 0; i < emptyCount; i++) {
    pegs.push([]);
  }
  return pegs;
}

// Zaten çözülmüş durum oluşturma ihtimaline karşı kontrol
function isAlreadySolved(pegs) {
  return pegs.every(
    p => p.length === 0 || (p.length === CAPACITY && new Set(p).size === 1)
  );
}

// ── Geri Alma (Undo) ────────────────────────────────────────
function saveSnapshot() {
  state.lastSnapshot = {
    pegs:          state.pegs.map(p => [...p]),
    moves:         state.moves,
    score:         state.score,
    completedPegs: new Set(state.completedPegs),
    mysteryNuts:   state.mysteryNuts.map(s => new Set(s)),
  };
  document.getElementById('undo-btn').disabled = false;
}

function applyUndo() {
  if (!state.lastSnapshot || state.animating) return;
  const snap = state.lastSnapshot;
  state.pegs          = snap.pegs;
  state.moves         = snap.moves;
  state.score         = snap.score;
  state.completedPegs = snap.completedPegs;
  state.mysteryNuts   = snap.mysteryNuts;
  state.selected      = null;
  state.lastSnapshot  = null;
  state.newlyCompleted = new Set();
  state.justRevealed   = new Set();
  // Puan sayacını anlık güncelle
  displayedScore = snap.score;
  const scoreEl = document.getElementById('score-display');
  if (scoreEl) { scoreEl.textContent = snap.score; scoreEl.classList.remove('score-ticking'); }
  document.getElementById('undo-btn').disabled = true;
  SFX.play('pick');
  render();
}

// ── Oyunu başlat ────────────────────────────────────────────
function initLevel(level) {
  const cfg = getConfig(level);
  state.level         = level;
  // Bölümü kaydet (restart etse bile kayıp olmaz, next'e basınca ilerler)
  cityState.lastLevel = level;
  saveCityState();
  state.moves         = 0;
  state.score         = 0;
  state.selected      = null;
  state.completedPegs  = new Set();
  state.newlyCompleted = new Set();
  state.justRevealed   = new Set();
  state.lastSnapshot   = null;
  resetScoreDisplay();
  const undoBtn = document.getElementById('undo-btn');
  if (undoBtn) undoBtn.disabled = true;

  // Çözülmemiş rastgele durum üret
  do {
    state.pegs = generatePegs(cfg.colors, cfg.empties);
  } while (isAlreadySolved(state.pegs));

  // Gizli somun sistemini başlat
  initMysteryNuts();

  // Yeniden başlatma için derin kopya
  state.savedPegs = state.pegs.map(p => [...p]);

  document.getElementById('win-overlay').classList.add('hidden');
  render();
}

// ── Oyun Mantığı ────────────────────────────────────────────
function canMove(fromIdx, toIdx) {
  if (fromIdx === toIdx) return false;
  const src = state.pegs[fromIdx];
  const dst = state.pegs[toIdx];
  if (src.length === 0) return false;
  if (dst.length >= CAPACITY) return false;
  // Tepe somon gizliyse (teorik güvenlik kontrolü) sadece boş vidaya gidebilir
  const srcTopMystery = state.mysteryNuts[fromIdx] &&
                        state.mysteryNuts[fromIdx].has(src.length - 1);
  if (srcTopMystery) return dst.length === 0;
  if (dst.length === 0) return true;
  return src[src.length - 1] === dst[dst.length - 1];
}

function doMove(fromIdx, toIdx) {
  state.pegs[toIdx].push(state.pegs[fromIdx].pop());
  // Kaynak vidasının yeni tepesi gizliyse açıkla
  revealMysteryNuts(fromIdx);
}

function checkWin() {
  return state.pegs.every(
    p => p.length === 0 || (p.length === CAPACITY && new Set(p).size === 1)
  );
}

function isPegComplete(peg) {
  return peg.length === CAPACITY && new Set(peg).size === 1;
}

// Yeni tamamlanan vidaları bul, puan ver
function checkPegCompletions() {
  state.pegs.forEach((peg, idx) => {
    if (isPegComplete(peg) && !state.completedPegs.has(idx)) {
      // Tamamlanan vidada kalan mystery somonları aç (tıpa kapanmadan önce)
      if (state.mysteryNuts[idx] && state.mysteryNuts[idx].size > 0) {
        state.mysteryNuts[idx].forEach(nutIdx => state.justRevealed.add(`${idx},${nutIdx}`));
        state.mysteryNuts[idx].clear();
      }
      state.completedPegs.add(idx);
      state.newlyCompleted.add(idx);
      state.score += 50;
      animateScoreDisplay(state.score);
      SFX.play('cap');
    }
  });
}

// ── Tıklama İşleyicisi ──────────────────────────────────────
function handleClick(idx) {
  if (state.animating) return;
  const { selected, pegs } = state;

  if (selected === null) {
    if (pegs[idx].length > 0) {
      state.selected = idx;
      SFX.play('pick');
    }
  } else if (selected === idx) {
    state.selected = null;
    SFX.play('place');
  } else if (canMove(selected, idx)) {
    const fromIdx   = selected;
    const toIdx     = idx;
    const groupSize = countTopGroup(pegs[fromIdx], fromIdx);
    state.selected  = null;
    state.animating = true;
    let moved = 0;

    function moveNext() {
      if (moved === 0) saveSnapshot();
      doMove(fromIdx, toIdx);
      SFX.play('place');
      if (moved === 0) state.moves++; // tüm grup = 1 hamle
      moved++;
      checkPegCompletions();
      state.lastPlaced = { peg: toIdx, nutIdx: state.pegs[toIdx].length - 1 };
      const won = checkWin();
      render();
      state.lastPlaced = null;
      if (won) {
        state.animating = false;
        setTimeout(showWin, 420);
        return;
      }
      if (moved < groupSize && canMove(fromIdx, toIdx)) {
        setTimeout(moveNext, 180);
      } else {
        state.animating = false;
      }
    }
    moveNext();
    return;
  } else {
    state.selected = pegs[idx].length > 0 ? idx : null;
  }

  render();
}

// ── Kazan ekranı ─────────────────────────────────────────────
function showWin() {
  const earned = 10 + state.level * 5;
  addCoins(earned);
  document.getElementById('win-message').textContent =
    `${state.moves} hamlede tamamladınız! +${earned} 🪙 kazandınız!`;
  document.getElementById('win-overlay').classList.remove('hidden');
  SFX.play('win');
}

// ── Ekran boyutuna göre peg/nut boyutları ───────────────────
// CSS media query'leriyle birebir eşleşen değerler.
// Floating nut konumu bu değerlere göre JS tarafından hesaplanır.
function getPegDimensions() {
  const W = window.innerWidth;
  const isLandscapeMobile =
    window.matchMedia('(orientation: landscape) and (max-height: 500px)').matches;

  if (isLandscapeMobile) return { PEG_H: 195, NUT_H: 27, NUT_EFF: 21, NUTS_BOT:  9, FLOAT_TOP: 10 };
  if (W <= 380)          return { PEG_H: 250, NUT_H: 31, NUT_EFF: 24, NUTS_BOT: 10, FLOAT_TOP: 12 };
  if (W <= 600)          return { PEG_H: 280, NUT_H: 36, NUT_EFF: 29, NUTS_BOT: 12, FLOAT_TOP: 15 };
  if (W <= 1024)         return { PEG_H: 310, NUT_H: 42, NUT_EFF: 24, NUTS_BOT: 14, FLOAT_TOP: 20 };
  return                        { PEG_H: 380, NUT_H: 54, NUT_EFF: 26, NUTS_BOT: 18, FLOAT_TOP: 25 };
}

// ── Render ──────────────────────────────────────────────────
function render() {
  document.getElementById('level-display').textContent = state.level;
  document.getElementById('moves-display').textContent = state.moves;
  // score-display animasyonla güncellenir (animateScoreDisplay)

  const container = document.getElementById('pegs-container');
  container.innerHTML = '';

  state.pegs.forEach((peg, idx) => {
    container.appendChild(buildPegEl(peg, idx));
  });

  // Animasyonlar sadece bir render'da geçerli; sonrakinde sabit göster
  state.newlyCompleted.clear();
  state.justRevealed.clear();
}

function buildPegEl(peg, idx) {
  const wrapper = document.createElement('div');
  wrapper.className = 'peg' + (state.selected === idx ? ' peg-selected' : '');
  wrapper.addEventListener('click', () => handleClick(idx));

  // ── Somunlar ──
  const nutsDiv = document.createElement('div');
  nutsDiv.className = 'peg-nuts';

  const pegIsSelected = state.selected === idx;

  // Floating hesabı: sadece en üstteki tek somun havaya kalkar
  let floatDy = 0;
  if (pegIsSelected && peg.length > 0) {
    const { PEG_H, NUT_H, NUT_EFF, NUTS_BOT, FLOAT_TOP } = getPegDimensions();
    const curBottom = NUTS_BOT + (peg.length - 1) * NUT_EFF;
    const tgtBottom = PEG_H - FLOAT_TOP - NUT_H;
    floatDy = tgtBottom - curBottom;
  }

  peg.forEach((color, nutIdx) => {
    const nut = document.createElement('div');

    const isTopNut      = nutIdx === peg.length - 1;
    const isFloating    = isTopNut && pegIsSelected;
    const isJustPlaced  = state.lastPlaced !== null
                          && state.lastPlaced.peg === idx
                          && state.lastPlaced.nutIdx === nutIdx;
    const isMystery     = state.mysteryNuts[idx] && state.mysteryNuts[idx].has(nutIdx);
    const isJustRevealed = state.justRevealed.has(`${idx},${nutIdx}`);

    nut.className = 'nut ' + (isMystery ? 'nut-mystery' : 'nut-' + color)
      + (isFloating    ? ' nut-floating'  : '')
      + (isJustPlaced  ? ' nut-placing'   : '')
      + (isJustRevealed ? ' nut-revealed' : '');

    if (isFloating) {
      nut.style.transform = `translateY(${-floatDy}px) scale(1.15)`;
    }

    const img = document.createElement('img');
    img.src       = isFloating ? 'images/somon.png' : 'images/somon-2.png';
    img.alt       = isMystery ? '?' : color;
    img.draggable = false;
    nut.appendChild(img);

    if (isMystery) {
      const mark = document.createElement('span');
      mark.className   = 'mystery-mark';
      mark.textContent = '?';
      nut.appendChild(mark);
    }

    nutsDiv.appendChild(nut);
  });

  // ── Tıpa: vida tamamen dolduğunda üstünü kapat ──
  if (isPegComplete(peg) && !pegIsSelected) {
    const cap = document.createElement('div');
    // Yeni tamamlandıysa animasyonlu, önceden tamamlandıysa sabit
    cap.className = state.newlyCompleted.has(idx) ? 'peg-cap' : 'peg-cap peg-cap--settled';
    const capImg = document.createElement('img');
    capImg.src = 'images/tıpa.png';
    capImg.draggable = false;
    cap.appendChild(capImg);
    wrapper.appendChild(cap);
  }

  // ── Vida direği ──
  const pole = document.createElement('div');
  pole.className = 'peg-pole';

  wrapper.appendChild(nutsDiv);
  wrapper.appendChild(pole);

  return wrapper;
}

// ── Buton Olayları ──────────────────────────────────────────
document.getElementById('restart-btn').addEventListener('click', () => {
  state.moves         = 0;
  state.score         = 0;
  state.selected      = null;
  state.lastPlaced    = null;
  resetScoreDisplay();
  state.animating      = false;
  state.completedPegs  = new Set();
  state.newlyCompleted = new Set();
  state.justRevealed   = new Set();
  state.lastSnapshot   = null;
  state.pegs           = state.savedPegs.map(p => [...p]);
  initMysteryNuts();
  document.getElementById('undo-btn').disabled = true;
  document.getElementById('win-overlay').classList.add('hidden');
  render();
});

document.getElementById('next-btn').addEventListener('click', () => {
  initLevel(state.level + 1);
});

document.getElementById('undo-btn').addEventListener('click', applyUndo);

// ── Şehir Sistemi ────────────────────────────────────────────
const CITY_DATA = [
  {
    id: 'istanbul', name: 'İSTANBUL', cost: 20,
    buildings: [
      { name: 'Ayasofya',         img: 'game/istanbul/Ayasofya-removebg-preview.png' },
      { name: 'Sultan Ahmet',     img: 'game/istanbul/Sultan-Ahmet-removebg-preview.png' },
      { name: 'Galata Kulesi',    img: 'game/istanbul/Galata-Kulesi-removebg-preview.png' },
      { name: 'Kız Kulesi',       img: 'game/istanbul/Kız-Kulesi-removebg-preview.png' },
      { name: 'Dolmabahçe',       img: 'game/istanbul/Dolmabahçe-Sarayı-removebg-preview.png' },
    ],
  },
  {
    id: 'londra', name: 'LONDRA', cost: 35,
    buildings: [
      { name: 'Big Ben',          img: 'game/londra/Big-Ben-Elizabeth-Tower-removebg-preview.png' },
      { name: 'Buckingham',       img: 'game/londra/Buckingham-Palace-removebg-preview.png' },
      { name: 'London Eye',       img: 'game/londra/London-Eye-removebg-preview.png' },
      { name: 'Tower Bridge',     img: 'game/londra/Tower-Bridge-removebg-preview.png' },
      { name: 'Westminster',      img: 'game/londra/Westminster-Abbey-removebg-preview.png' },
    ],
  },
  {
    id: 'paris', name: 'PARİS', cost: 50,
    buildings: [
      { name: 'Eyfel Kulesi',     img: 'game/paris/Eyfel-Kulesi-removebg-preview.png' },
      { name: 'Louvre',           img: 'game/paris/Louvre-Müzesi-removebg-preview.png' },
      { name: 'Notre Dame',       img: 'game/paris/Notre-Dame-Cathedral-removebg-preview.png' },
      { name: 'Arc de Triomphe',  img: 'game/paris/Arc-de-Triomphe-removebg-preview.png' },
      { name: 'Sacré-Cœur',       img: 'game/paris/Sacré-Cœur-Bazilikası-removebg-preview.png' },
    ],
  },
];

const cityState = {
  coins:      0,
  activeCity: 0,       // görüntülenen şehir indexi
  progress:   [0,0,0], // her şehirde kaç bina açıldı
  lastLevel:  1,       // en son oynanan bölüm
};

function saveCityState() {
  localStorage.setItem('somun-city', JSON.stringify(cityState));
}

function loadCityState() {
  try {
    const s = localStorage.getItem('somun-city');
    if (s) Object.assign(cityState, JSON.parse(s));
  } catch(e) {}
}

function addCoins(n) {
  cityState.coins += n;
  saveCityState();
}

// Bina pozisyonları: üst üste binmeyi önleyecek aralık
const BLDG_POSITIONS = ['13%', '34%', '50%', '66%', '87%'];

function renderCityScreen() {
  const city     = CITY_DATA[cityState.activeCity];
  const unlocked = cityState.progress[cityState.activeCity];
  const allDone  = unlocked >= city.buildings.length;

  // Bu şehir kilitli mi? (önceki şehir tamamlanmamış)
  const isCityLocked = cityState.activeCity > 0
    && cityState.progress[cityState.activeCity - 1] < CITY_DATA[cityState.activeCity - 1].buildings.length;

  document.getElementById('city-name').textContent = city.name;
  document.getElementById('city-coins-display').textContent = cityState.coins;

  // Şehir noktaları
  const dotsEl = document.getElementById('city-dots');
  dotsEl.innerHTML = '';
  CITY_DATA.forEach((_c, i) => {
    const dot = document.createElement('span');
    const lockedDot = i > 0 && cityState.progress[i-1] < CITY_DATA[i-1].buildings.length;
    dot.className = 'city-dot'
      + (i === cityState.activeCity ? ' active' : '')
      + (lockedDot ? ' locked-dot' : '');
    dotsEl.appendChild(dot);
  });

  // Binalar
  const island = document.getElementById('city-island');
  island.innerHTML = '';

  if (isCityLocked) {
    // Kilitli şehir: büyük kilit rozeti göster
    const lockBadge = document.createElement('div');
    lockBadge.className = 'city-lock-badge';
    lockBadge.innerHTML = '<span class="lock-icon">🔒</span><span>Önceki şehri tamamla!</span>';
    island.appendChild(lockBadge);
  }

  city.buildings.forEach((bldg, i) => {
    const card = document.createElement('div');
    const isUnlocked = !isCityLocked && i < unlocked;
    card.className = 'city-building ' + (isUnlocked ? 'unlocked' : 'locked');
    card.style.left = BLDG_POSITIONS[i];

    const img = document.createElement('img');
    img.src = bldg.img;
    img.alt = bldg.name;
    img.draggable = false;

    card.appendChild(img);
    island.appendChild(card);
  });

  // İlerleme yazısı
  document.getElementById('city-progress-text').textContent = isCityLocked
    ? '🔒 Bu şehir kilitli'
    : `${unlocked} / ${city.buildings.length} bina açıldı`;

  // Yükle butonu
  const unlockBtn = document.getElementById('unlock-btn');
  if (isCityLocked) {
    unlockBtn.innerHTML = '🔒 Kilitli';
    unlockBtn.disabled = true;
    unlockBtn.classList.remove('done');
  } else if (allDone) {
    unlockBtn.textContent = '✅ Tamamlandı!';
    unlockBtn.disabled = true;
    unlockBtn.classList.add('done');
  } else {
    unlockBtn.innerHTML = `🔓 YÜKLE <span id="unlock-cost-span">${city.cost} 🪙</span>`;
    unlockBtn.disabled  = cityState.coins < city.cost;
    unlockBtn.classList.remove('done');
  }

  // OYNA butonu: kilitli şehirde pasif
  const playBtn = document.getElementById('city-play-btn');
  playBtn.disabled    = isCityLocked;
  playBtn.textContent = isCityLocked ? '🔒 Kilitli' : '▶ OYNA';

  // Navigasyon okları — tüm şehirler gezilabilir
  document.getElementById('city-prev').disabled = cityState.activeCity === 0;
  document.getElementById('city-next').disabled = cityState.activeCity >= CITY_DATA.length - 1;
}

function showCityScreen() {
  document.getElementById('city-overlay').classList.remove('hidden');
  document.getElementById('app').style.display = 'none';
  renderCityScreen();
}

function hideCityScreen() {
  document.getElementById('city-overlay').classList.add('hidden');
  document.getElementById('app').style.display = '';
}

// ── Bina açılma animasyonu ───────────────────────────────────
function animateBuildingUnlock(newIdx) {
  renderCityScreen();

  const cards  = document.querySelectorAll('.city-building');
  const card   = cards[newIdx];
  if (!card) return;

  // Bina hâlâ gri görünsün — removing this class will trigger CSS transition
  card.classList.add('revealing');

  const coinsEl = document.getElementById('city-coins-display');
  const fromRect = coinsEl.getBoundingClientRect();
  const toRect   = card.getBoundingClientRect();
  const fromX    = fromRect.left + fromRect.width  / 2;
  const fromY    = fromRect.top  + fromRect.height / 2;

  const COUNT = 9;
  let done = 0;
  BGM.setVolume(0.1);

  // Coin'leri oluştur, başlangıç pozisyonuna yerleştir
  const items = Array.from({ length: COUNT }, (_, i) => {
    const el = document.createElement('div');
    el.className  = 'coin-particle';
    el.textContent = '🪙';
    el.style.left = fromX + 'px';
    el.style.top  = fromY + 'px';
    document.body.appendChild(el);
    return {
      el,
      tx:    toRect.left + toRect.width  * (0.15 + Math.random() * 0.7),
      ty:    toRect.top  + toRect.height * (0.15 + Math.random() * 0.7),
      delay: i * 65,
    };
  });

  // İki frame bekle — ilk pozisyon render edilsin, sonra uçuş başlasın
  requestAnimationFrame(() => requestAnimationFrame(() => {
    items.forEach(({ el, tx, ty, delay }) => {
      el.style.transitionDelay = delay + 'ms';
      el.style.left      = tx + 'px';
      el.style.top       = ty + 'px';
      el.style.opacity   = '0';
      el.style.transform = 'translate(-50%,-50%) scale(0.3)';

      setTimeout(() => {
        el.remove();
        done++;
        if (done === COUNT) {
          // Tüm coin'ler bitti → bina renkli açılsın
          card.classList.remove('revealing');
          BGM.setVolume(0.35);
        }
      }, delay + 720);
    });
  }));
}

// Yükle
document.getElementById('unlock-btn').addEventListener('click', () => {
  const city     = CITY_DATA[cityState.activeCity];
  const unlocked = cityState.progress[cityState.activeCity];
  if (unlocked >= city.buildings.length || cityState.coins < city.cost) return;

  const newIdx = unlocked;
  cityState.coins -= city.cost;
  cityState.progress[cityState.activeCity]++;
  saveCityState();
  SFX.play('unlock');
  animateBuildingUnlock(newIdx);
});

// Şehir OYNA
document.getElementById('city-play-btn').addEventListener('click', () => {
  hideCityScreen();
  if (state.pegs.length === 0) initLevel(cityState.lastLevel || 1);
});

// Şehir navigasyonu
document.getElementById('city-prev').addEventListener('click', () => {
  if (cityState.activeCity > 0) { cityState.activeCity--; renderCityScreen(); }
});
document.getElementById('city-next').addEventListener('click', () => {
  const next = cityState.activeCity + 1;
  if (next < CITY_DATA.length) { cityState.activeCity = next; renderCityScreen(); }
});

// Oyun içi ana sayfa butonu
document.getElementById('home-btn').addEventListener('click', () => {
  showCityScreen();
});

// ── Giriş Ekranı ─────────────────────────────────────────────
function createBgNuts() {
  const bg     = document.getElementById('intro-bg');
  const colors = ['red', 'blue', 'green', 'yellow', 'cyan', 'purple'];
  for (let i = 0; i < 16; i++) {
    const wrap  = document.createElement('div');
    const color = colors[i % colors.length];
    const size  = 28 + Math.random() * 52;
    wrap.className            = `bg-nut nut-${color}`;
    wrap.style.left           = Math.random() * 100 + '%';
    wrap.style.width          = size + 'px';
    wrap.style.height         = size + 'px';
    wrap.style.animationDuration = (7 + Math.random() * 10) + 's';
    wrap.style.animationDelay    = -(Math.random() * 14) + 's'; // negatif → anında hareket
    const img = document.createElement('img');
    img.src = 'images/somon.png';
    img.draggable = false;
    wrap.appendChild(img);
    bg.appendChild(wrap);
  }
}

document.getElementById('play-btn').addEventListener('click', () => {
  const overlay = document.getElementById('intro-overlay');
  overlay.classList.add('intro-fading');
  setTimeout(() => {
    overlay.classList.add('hidden');
    showCityScreen();
  }, 450);
});

loadCityState();
createBgNuts();

// ── Ses butonları ────────────────────────────────────────────
function syncMuteButtons() {
  const bgmBtn = document.getElementById('bgm-btn');
  const sfxBtn = document.getElementById('sfx-btn');
  if (bgmBtn) {
    bgmBtn.textContent = BGM.isMuted() ? '🔇' : '🎵';
    bgmBtn.classList.toggle('mute-btn--off', BGM.isMuted());
  }
  if (sfxBtn) {
    sfxBtn.textContent = SFX.isMuted() ? '🔕' : '🔊';
    sfxBtn.classList.toggle('mute-btn--off', SFX.isMuted());
  }
}

document.getElementById('bgm-btn').addEventListener('click', () => {
  BGM.toggleMute();
  syncMuteButtons();
});

document.getElementById('sfx-btn').addEventListener('click', () => {
  SFX.toggleMute();
  syncMuteButtons();
});

// Kaydedilmiş durumu yükle
syncMuteButtons();

// Müziği hemen başlatmayı dene; tarayıcı engellerse ilk tıklamada başlat
BGM.play();
document.addEventListener('click', () => BGM.play(), { once: true });
