/* ============================================================
   Katsuyō 活用 — Japanese conjugation trainer
   Vanilla JS, no build step, no framework. Everything renders
   into #app as HTML strings with delegated click handling.
   ============================================================ */

/* ---------------- curriculum tiers ----------------
   New (word, form) pairs are only introduced once every pair
   in the tier before it has been introduced at least once.
   Tier 1 = the handful of forms that carry most conversational
   weight; later tiers add nuance. */
const VERB_TIERS = [
  ['dictionary', 'polite present', 'negative plain', 'past plain', 'te-form'],
  ['negative polite', 'past negative plain', 'potential', 'conditional (ba form)'],
  ['past polite', 'past negative polite', 'volitional', 'conditional (tara form)', 'progressive'],
  ['desire (tai form)', 'imperative', 'prohibition', 'must / obligation'],
  ['passive', 'causative', 'causative-passive']
];
const ADJ_TIERS = [
  ['dictionary', 'polite present', 'negative plain', 'past plain', 'te-form'],
  ['negative polite', 'past negative plain', 'adverbial', 'conditional'],
  ['past polite', 'past negative polite', 'hypothetical past', 'noun modification'],
  ['nominalization', 'seeming', 'degree'],
  ['wanting something to be a certain way', 'conjunctive (literary)', 'negative implication']
];

const BOX_INTERVAL_DAYS = { 1: 0, 2: 1, 3: 3, 4: 7, 5: 14, 6: 30 };
const MAX_BOX = 6;
const NEW_PER_MORNING = 3;
const DUE_PER_MORNING = 6;
const DUE_PER_EVENING = 8;
const MEANING_CARDS_PER_EVENING = 2;
// Caps how many distinct words can be "in progress" (started but not yet
// fully expanded through every form) at once. Without this, a large word
// list means every word gets its tier-1 forms before any word advances to
// tier 2 — with 100+ words that's months before you see anything past the
// basics. Instead we finish deepening a manageable working set before
// pulling in new words.
const ACTIVE_WORD_POOL = 15;

/* ---------------- state ---------------- */
const STATE = {
  verbData: null,
  adjData: null,
  particleData: null,
  directionsData: null,
  demonstrativesData: null,
  allWords: [],
  srs: {},        // key -> {box, due, introduced, reps, lapses}
  meaningSrs: {},  // wordId -> {box, due}
  progress: { streak: 0, lastActiveDate: null, totalReviews: 0, totalCorrect: 0, today: { date: null, morning: false, evening: false } },
  view: 'loading',
  viewParams: {},
  session: null,
  libraryTab: 'all',
  particleTab: 'all',
  directionsTab: 'all',
  demoTab: 'all'
};

/* ---------------- utils ---------------- */
function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function daysBetween(a, b) {
  return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
}
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function sample(arr, n) { return shuffle(arr).slice(0, n); }
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function srsKey(wordId, formName) { return wordId + '::' + formName; }

/* ---------------- storage ---------------- */
const LS_SRS = 'katsuyo_srs_v1';
const LS_MEANING = 'katsuyo_meaning_srs_v1';
const LS_PROGRESS = 'katsuyo_progress_v1';

function loadStorage() {
  try { STATE.srs = JSON.parse(localStorage.getItem(LS_SRS)) || {}; } catch (e) { STATE.srs = {}; }
  try { STATE.meaningSrs = JSON.parse(localStorage.getItem(LS_MEANING)) || {}; } catch (e) { STATE.meaningSrs = {}; }
  try {
    const p = JSON.parse(localStorage.getItem(LS_PROGRESS));
    if (p) STATE.progress = Object.assign(STATE.progress, p);
  } catch (e) { /* keep defaults */ }
  if (!STATE.progress.today || STATE.progress.today.date !== todayStr()) {
    STATE.progress.today = { date: todayStr(), morning: false, evening: false };
  }
}
function saveSrs() { localStorage.setItem(LS_SRS, JSON.stringify(STATE.srs)); }
function saveMeaningSrs() { localStorage.setItem(LS_MEANING, JSON.stringify(STATE.meaningSrs)); }
function saveProgress() { localStorage.setItem(LS_PROGRESS, JSON.stringify(STATE.progress)); }

/* ---------------- data loading ---------------- */
async function loadData() {
  const [verbData, adjData, verbWords, adjWords, particleData, directionsData, demonstrativesData] = await Promise.all([
    fetch('data/conjugation_verb.json').then(r => r.json()),
    fetch('data/conjugation_adj.json').then(r => r.json()),
    fetch('data/verbs.json').then(r => r.json()),
    fetch('data/adjectives.json').then(r => r.json()),
    fetch('data/particles.json').then(r => r.json()),
    fetch('data/directions.json').then(r => r.json()),
    fetch('data/demonstratives.json').then(r => r.json())
  ]);
  STATE.verbData = verbData;
  STATE.adjData = adjData;
  STATE.particleData = particleData;
  STATE.directionsData = directionsData;
  STATE.demonstrativesData = demonstrativesData;
  STATE.allWords = [...verbWords.words, ...adjWords.words];
}

function isVerb(word) { return word.type === 'verb'; }
function getFormsList(word) { return isVerb(word) ? STATE.verbData.tenses : STATE.adjData.forms; }
function getTiers(word) { return isVerb(word) ? VERB_TIERS : ADJ_TIERS; }
function findWord(id) { return STATE.allWords.find(w => w.id === id); }
function findFormDef(word, formName) {
  return getFormsList(word).find(f => f.name_en === formName);
}

/* ---------------- conjugation engine ----------------
   Verified against every word/form combination in data/*.json
   before this file was written (see build notes). */
function conjugate(word, formName) {
  const overrides = word.irregular_overrides || {};
  if (Object.prototype.hasOwnProperty.call(overrides, formName)) return overrides[formName];

  const formDef = findFormDef(word, formName);
  if (!formDef) return '?';
  const struct = formDef.structure;

  if (isVerb(word)) {
    if (word.group === 'group3') {
      const direct = struct.group3.find(e => e.verb === word.dictionary);
      if (direct) return direct.result;
      if (word.dictionary.endsWith('する')) {
        const suru = struct.group3.find(e => e.verb === 'する');
        return word.dictionary.slice(0, -2) + suru.result;
      }
      return '?';
    }
    const lastChar = word.dictionary.slice(-1);
    const rows = struct[word.group];
    const entry = rows.find(e => e.ending === lastChar);
    if (!entry) return '?';
    return word.dictionary.slice(0, -1) + entry.result;
  }

  if (word.type === 'i-adjective') {
    return word.dictionary.slice(0, -1) + struct['i-adjective'].result;
  }
  return word.dictionary + struct['na-adjective'].result;
}

/* ---------------- SRS engine ---------------- */
function tierIndexOf(word, formName) {
  const tiers = getTiers(word);
  for (let i = 0; i < tiers.length; i++) if (tiers[i].includes(formName)) return i;
  return tiers.length;
}
function getNewCandidates(limit) {
  const introducedCount = {};
  for (const key in STATE.srs) {
    const wordId = key.split('::')[0];
    introducedCount[wordId] = (introducedCount[wordId] || 0) + 1;
  }
  const totalForWord = {};
  for (const word of STATE.allWords) totalForWord[word.id] = getFormsList(word).length;

  const inProgressCount = Object.keys(introducedCount)
    .filter(id => introducedCount[id] < (totalForWord[id] || Infinity)).length;
  let poolHasRoom = inProgressCount < ACTIVE_WORD_POOL;

  const candidates = [];
  for (const word of STATE.allWords) {
    const introduced = introducedCount[word.id] || 0;
    const started = introduced > 0;
    if (!started && !poolHasRoom) continue; // don't start new words until a pool slot frees up
    const forms = getFormsList(word).map(f => f.name_en);
    for (const formName of forms) {
      const key = srsKey(word.id, formName);
      if (!STATE.srs[key]) candidates.push({ word, formName, tier: tierIndexOf(word, formName), started });
    }
  }
  // breadth first within the active pool (lowest tier wins), started-ness
  // only breaks ties so the pool actually fills before any one word is
  // deepened all the way through
  candidates.sort((a, b) => (a.tier - b.tier) || (b.started - a.started) || (Math.random() - 0.5));
  return candidates.slice(0, limit);
}
function getDueItems(limit) {
  const today = todayStr();
  const due = [];
  for (const key in STATE.srs) {
    const item = STATE.srs[key];
    if (item.introduced && item.due <= today) {
      const [wordId, formName] = key.split('::');
      const word = findWord(wordId);
      if (word) due.push({ word, formName, srsItem: item });
    }
  }
  due.sort((a, b) => a.srsItem.due.localeCompare(b.srsItem.due));
  return shuffle(due.slice(0, Math.max(limit * 2, limit))).slice(0, limit);
}
function introduceCard(word, formName) {
  const key = srsKey(word.id, formName);
  STATE.srs[key] = { box: 1, due: todayStr(), introduced: true, reps: 0, lapses: 0 };
}
function gradeCard(word, formName, grade) {
  const key = srsKey(word.id, formName);
  const item = STATE.srs[key] || { box: 1, due: todayStr(), introduced: true, reps: 0, lapses: 0 };
  item.reps += 1;
  let correct = true;
  if (grade === 'again') {
    item.box = 1;
    item.due = todayStr();
    item.lapses += 1;
    correct = false;
  } else if (grade === 'good') {
    item.box = Math.min(item.box + 1, MAX_BOX);
    item.due = addDays(todayStr(), BOX_INTERVAL_DAYS[item.box]);
  } else if (grade === 'easy') {
    item.box = Math.min(item.box + 2, MAX_BOX);
    item.due = addDays(todayStr(), BOX_INTERVAL_DAYS[item.box]);
  }
  STATE.srs[key] = item;
  saveSrs();
  STATE.progress.totalReviews += 1;
  if (correct) STATE.progress.totalCorrect += 1;
  saveProgress();
  return correct;
}
function gradeMeaning(wordId, grade) {
  const item = STATE.meaningSrs[wordId] || { box: 1, due: todayStr() };
  if (grade === 'again') { item.box = 1; item.due = todayStr(); }
  else { item.box = Math.min(item.box + 1, MAX_BOX); item.due = addDays(todayStr(), BOX_INTERVAL_DAYS[item.box]); }
  STATE.meaningSrs[wordId] = item;
  saveMeaningSrs();
}
function masteryStats() {
  let introduced = 0, mastered = 0, total = 0;
  for (const word of STATE.allWords) total += getFormsList(word).length;
  for (const key in STATE.srs) {
    const item = STATE.srs[key];
    if (item.introduced) { introduced++; if (item.box >= MAX_BOX) mastered++; }
  }
  return { introduced, mastered, total };
}

/* ---------------- distractor generation (for recognition quiz) ---------------- */
function buildChoices(word, formName) {
  const correct = conjugate(word, formName);
  const forms = getFormsList(word).map(f => f.name_en).filter(f => f !== formName);
  const otherResults = shuffle(forms).map(f => conjugate(word, f)).filter(r => r && r !== correct && r !== '?');
  const uniqueDistractors = [...new Set(otherResults)].slice(0, 3);
  // pad with conjugations of other same-type words if this word doesn't have enough forms
  if (uniqueDistractors.length < 3) {
    const pool = STATE.allWords.filter(w => w.id !== word.id && isVerb(w) === isVerb(word));
    for (const w of shuffle(pool)) {
      if (uniqueDistractors.length >= 3) break;
      const r = conjugate(w, formName);
      if (r && r !== correct && !uniqueDistractors.includes(r)) uniqueDistractors.push(r);
    }
  }
  return shuffle([correct, ...uniqueDistractors.slice(0, 3)]);
}

/* ---------------- session builders ---------------- */
function buildMorningSession() {
  const newCards = getNewCandidates(NEW_PER_MORNING);
  const dueCards = getDueItems(DUE_PER_MORNING);
  const queue = [];
  for (const c of newCards) {
    queue.push({ step: 'teach', word: c.word, formName: c.formName });
    queue.push({ step: 'quiz-recognition', word: c.word, formName: c.formName, isNew: true });
  }
  const mixed = shuffle([
    ...newCards.map(c => ({ step: 'quiz-recognition', word: c.word, formName: c.formName, isNew: false })),
    ...dueCards.map(c => ({ step: 'quiz-recognition', word: c.word, formName: c.formName, isNew: false }))
  ]);
  queue.push(...mixed);
  return { kind: 'morning', queue, index: 0, stats: { correct: 0, total: 0, newCount: newCards.length } };
}
function buildEveningSession() {
  let dueCards = getDueItems(DUE_PER_EVENING);
  if (dueCards.length === 0) {
    // nothing due yet today — fall back to light overlearning review
    const pool = [];
    for (const key in STATE.srs) {
      const item = STATE.srs[key];
      if (item.introduced) {
        const [wordId, formName] = key.split('::');
        const word = findWord(wordId);
        if (word) pool.push({ word, formName, srsItem: item });
      }
    }
    dueCards = sample(pool, 5);
  }
  const queue = shuffle(dueCards.map(c => ({ step: 'quiz-recall', word: c.word, formName: c.formName })));

  // sprinkle in bidirectional meaning-recall cards from already-introduced words
  const introducedWordIds = [...new Set(Object.keys(STATE.srs).filter(k => STATE.srs[k].introduced).map(k => k.split('::')[0]))];
  const meaningWords = sample(introducedWordIds.map(findWord).filter(Boolean), MEANING_CARDS_PER_EVENING);
  const meaningCards = meaningWords.map(w => ({ step: 'quiz-meaning', word: w, direction: Math.random() < 0.5 ? 'jp2en' : 'en2jp' }));

  const finalQueue = shuffle([...queue, ...meaningCards]);
  return { kind: 'evening', queue: finalQueue, index: 0, stats: { correct: 0, total: 0, newCount: 0 } };
}

/* ---------------- progress bookkeeping ---------------- */
function markSessionDone(kind) {
  const today = todayStr();
  if (STATE.progress.today.date !== today) STATE.progress.today = { date: today, morning: false, evening: false };
  STATE.progress.today[kind] = true;

  if (STATE.progress.lastActiveDate !== today) {
    if (STATE.progress.lastActiveDate && daysBetween(STATE.progress.lastActiveDate, today) === 1) {
      STATE.progress.streak += 1;
    } else {
      STATE.progress.streak = 1;
    }
    STATE.progress.lastActiveDate = today;
  }
  saveProgress();
}

/* ============================================================
   RENDERING
   ============================================================ */
const app = document.getElementById('app');

function render() {
  let html = '';
  switch (STATE.view) {
    case 'home': html = renderHome(); break;
    case 'library': html = renderLibrary(); break;
    case 'wordDetail': html = renderWordDetail(); break;
    case 'rules': html = renderRules(); break;
    case 'ruleDetail': html = renderRuleDetail(); break;
    case 'particles': html = renderParticles(); break;
    case 'particleDetail': html = renderParticleDetail(); break;
    case 'directions': html = renderDirections(); break;
    case 'directionDetail': html = renderDirectionDetail(); break;
    case 'demonstratives': html = renderDemonstratives(); break;
    case 'demonstrativeDetail': html = renderDemonstrativeDetail(); break;
    case 'session': html = renderSession(); break;
    case 'summary': html = renderSummary(); break;
    default: html = '<div class="screen"><p>Loading…</p></div>';
  }
  app.innerHTML = html;
  window.scrollTo(0, 0);
}

function topbar(title, backView) {
  return `<div class="topbar">
    ${backView ? `<button class="back" data-action="go" data-view="${backView}">‹ Back</button>` : '<span class="spacer"></span>'}
    <span class="title">${escapeHtml(title)}</span>
    <span class="spacer"></span>
  </div>`;
}

function greetingText() {
  const h = new Date().getHours();
  if (h < 11) return 'おはよう';
  if (h < 17) return 'こんにちは';
  return 'こんばんは';
}

function renderHome() {
  const m = masteryStats();
  const t = STATE.progress.today;
  const streak = STATE.progress.streak;
  const dots = Array.from({ length: 7 }, (_, i) => `<span class="dot ${i < Math.min(streak, 7) ? 'filled' : ''}"></span>`).join('');
  return `<div class="screen">
    <div class="hero">
      <div class="eyebrow">活用 · Katsuyō</div>
      <h1 class="greeting">${greetingText()}</h1>
      <p class="sub">Two short sessions a day beats one long one. Let's keep the streak going.</p>
    </div>

    <div class="streak-row">
      <span class="streak-flame">🔥</span>
      <div>
        <div class="num">${streak} day${streak === 1 ? '' : 's'}</div>
        <div class="label">current streak</div>
      </div>
      <div class="dots">${dots}</div>
    </div>

    <div class="session-cards">
      <button class="session-card morning ${t.morning ? 'done' : ''}" data-action="start-session" data-kind="morning">
        <span class="icon">🌅</span>
        <span class="body">
          <div class="name">Morning session</div>
          <div class="desc">Learn new forms &amp; recognize them</div>
        </span>
        ${t.morning ? '<span class="check">✓ Done</span>' : '<span class="chev">›</span>'}
      </button>
      <button class="session-card evening ${t.evening ? 'done' : ''}" data-action="start-session" data-kind="evening">
        <span class="icon">🌙</span>
        <span class="body">
          <div class="name">Evening session</div>
          <div class="desc">Recall &amp; produce from memory</div>
        </span>
        ${t.evening ? '<span class="check">✓ Done</span>' : '<span class="chev">›</span>'}
      </button>
    </div>

    <div class="stat-grid">
      <div class="stat-box"><div class="n">${m.introduced}/${m.total}</div><div class="l">forms in study</div></div>
      <div class="stat-box"><div class="n">${m.mastered}</div><div class="l">mastered</div></div>
    </div>

    <div class="link-row">
      <button class="link-btn" data-action="go" data-view="library">📖 Words</button>
      <button class="link-btn ghost" data-action="go" data-view="rules">📐 Rules</button>
      <button class="link-btn ghost" data-action="go" data-view="particles">🔤 Particles</button>
      <button class="link-btn ghost" data-action="go" data-view="directions">🧭 Directions</button>
      <button class="link-btn ghost" data-action="go" data-view="demonstratives">👉 Kosoado</button>
    </div>
    <p class="footer-note">All data stays on this device. No account, no server.</p>
  </div>`;
}

function renderLibrary() {
  const tab = STATE.libraryTab;
  const filtered = STATE.allWords.filter(w => {
    if (tab === 'all') return true;
    if (tab === 'verb') return w.type === 'verb';
    return w.type === tab;
  });
  const rows = filtered.map(w => {
    const introducedForms = getFormsList(w).filter(f => {
      const s = STATE.srs[srsKey(w.id, f.name_en)];
      return s && s.introduced;
    }).length;
    const totalForms = getFormsList(w).length;
    return `<div class="word-row" data-action="go" data-view="wordDetail" data-id="${w.id}">
      <span class="kanji">${escapeHtml(w.dictionary)}</span>
      <span class="info">
        <div class="kana">${escapeHtml(w.kana)} · ${escapeHtml(w.romaji)}</div>
        <div class="meaning">${escapeHtml(w.meaning)}</div>
      </span>
      <span class="mastery">${introducedForms}/${totalForms}</span>
    </div>`;
  }).join('');
  return `<div class="screen">
    ${topbar('Word Library', 'home')}
    <div class="tab-row">
      <button class="tab ${tab === 'all' ? 'active' : ''}" data-action="tab" data-tab="all">All</button>
      <button class="tab ${tab === 'verb' ? 'active' : ''}" data-action="tab" data-tab="verb">Verbs</button>
      <button class="tab ${tab === 'i-adjective' ? 'active' : ''}" data-action="tab" data-tab="i-adjective">い-adj</button>
      <button class="tab ${tab === 'na-adjective' ? 'active' : ''}" data-action="tab" data-tab="na-adjective">な-adj</button>
    </div>
    <div class="word-list">${rows || '<div class="empty-state">No words in this category yet.</div>'}</div>
  </div>`;
}

function renderWordDetail() {
  const word = findWord(STATE.viewParams.id);
  if (!word) return `<div class="screen">${topbar('Not found', 'library')}</div>`;
  const forms = getFormsList(word);
  const badgeClass = isVerb(word) ? 'verb' : word.type;
  const badgeLabel = isVerb(word) ? (word.group === 'group1' ? 'Godan' : word.group === 'group2' ? 'Ichidan' : 'Irregular') : (word.type === 'i-adjective' ? 'い-adjective' : 'な-adjective');
  const rowsHtml = forms.map(f => {
    const key = srsKey(word.id, f.name_en);
    const s = STATE.srs[key];
    const boxColor = !s ? 'var(--paper-line)' : s.box >= MAX_BOX ? 'var(--good)' : s.box >= 3 ? 'var(--gold)' : 'var(--bad)';
    return `<div class="form-row">
      <div class="top">
        <span class="name">${escapeHtml(f.name_en)}<span class="jp">${escapeHtml(f.name_jp)}</span></span>
        <span class="mbox" style="background:${boxColor}"></span>
      </div>
      <div class="result">${escapeHtml(conjugate(word, f.name_en))}</div>
      <div class="usage">${escapeHtml(f.usage_en)}</div>
    </div>`;
  }).join('');
  const noteHtml = word.note ? `<div class="detail-head" style="margin-top:-4px;background:var(--gold-soft);color:var(--ink-deep)"><span class="eyebrow" style="color:#7A5E1A">Heads up</span><p style="margin-top:6px;font-size:13px;line-height:1.6">${escapeHtml(word.note)}</p></div>` : '';
  return `<div class="screen">
    ${topbar(word.dictionary, 'library')}
    <div class="detail-head">
      <span class="badge ${badgeClass}">${badgeLabel}</span>
      <div class="kanji" style="margin-top:10px">${escapeHtml(word.dictionary)}</div>
      <div class="kana">${escapeHtml(word.kana)} · ${escapeHtml(word.romaji)}</div>
      <div class="meaning">${escapeHtml(word.meaning)}</div>
      <div class="example">
        <div class="jp">${escapeHtml(word.example.jp)}</div>
        <div class="en">${escapeHtml(word.example.en)}</div>
      </div>
    </div>
    ${noteHtml}
    <div class="form-table">${rowsHtml}</div>
  </div>`;
}

function renderRules() {
  const verbRules = STATE.verbData.tenses.map(f =>
    `<div class="rule-item" data-action="go" data-view="ruleDetail" data-kind="verb" data-form="${escapeHtml(f.name_en)}">
      <div class="name">${escapeHtml(f.name_en)}<span class="jp">${escapeHtml(f.name_jp)}</span></div>
      <div class="usage">${escapeHtml(f.usage_en)}</div>
    </div>`).join('');
  const adjRules = STATE.adjData.forms.map(f =>
    `<div class="rule-item" data-action="go" data-view="ruleDetail" data-kind="adj" data-form="${escapeHtml(f.name_en)}">
      <div class="name">${escapeHtml(f.name_en)}<span class="jp">${escapeHtml(f.name_jp)}</span></div>
      <div class="usage">${escapeHtml(f.usage_en)}</div>
    </div>`).join('');
  return `<div class="screen">
    ${topbar('Rules Reference', 'home')}
    <div class="eyebrow">Verb forms</div>
    <div class="rule-nav">${verbRules}</div>
    <div class="eyebrow" style="margin-top:6px">Adjective forms</div>
    <div class="rule-nav">${adjRules}</div>
  </div>`;
}

function renderRuleDetail() {
  const { kind, form } = STATE.viewParams;
  const isVerbKind = kind === 'verb';
  const formDef = (isVerbKind ? STATE.verbData.tenses : STATE.adjData.forms).find(f => f.name_en === form);
  if (!formDef) return `<div class="screen">${topbar('Not found', 'rules')}</div>`;
  const words = STATE.allWords.filter(w => isVerbKind ? isVerb(w) : !isVerb(w));
  const rows = words.map(w => `<div class="word-row" data-action="go" data-view="wordDetail" data-id="${w.id}">
      <span class="kanji">${escapeHtml(w.dictionary)}</span>
      <span class="info"><div class="kana">${escapeHtml(w.meaning)}</div></span>
      <span class="mastery" style="font-family:var(--font-jp-display);font-size:15px;opacity:1">${escapeHtml(conjugate(w, form))}</span>
    </div>`).join('');
  const exceptionsBlock = (isVerbKind ? STATE.verbData.meta.known_exceptions : STATE.adjData.meta.known_exceptions) || [];
  const excHtml = exceptionsBlock.length ? `<div class="detail-head" style="background:var(--gold-soft);color:var(--ink-deep)">
      <span class="eyebrow" style="color:#7A5E1A">Known exception${exceptionsBlock.length>1?'s':''}</span>
      ${exceptionsBlock.map(e => `<p style="margin-top:8px;font-size:13px;line-height:1.6">${escapeHtml(e.note)}</p>`).join('')}
    </div>` : '';
  return `<div class="screen">
    ${topbar(formDef.name_en, 'rules')}
    <div class="detail-head">
      <div class="kanji" style="font-size:24px">${escapeHtml(formDef.name_jp)}</div>
      <div class="meaning" style="margin-top:8px">${escapeHtml(formDef.usage_en)}</div>
    </div>
    ${excHtml}
    <div class="eyebrow">Applied to every word</div>
    <div class="word-list">${rows}</div>
  </div>`;
}

/* ---------- particle reference ---------- */
const PARTICLE_LEVELS = ['all', 'N5', 'N4', 'N3', 'N2', 'N1'];
const CATEGORY_LABEL = {
  case: 'Case particle',
  binding: 'Binding particle',
  conjunctive: 'Conjunctive particle',
  'sentence-final': 'Sentence-final',
  'compound-case': 'Compound expression'
};

function renderParticles() {
  const tab = STATE.particleTab;
  const list = STATE.particleData.particles.filter(p => tab === 'all' || p.level === tab);
  const tabs = PARTICLE_LEVELS.map(lv =>
    `<button class="tab ${tab === lv ? 'active' : ''}" data-action="particle-tab" data-tab="${lv}">${lv === 'all' ? 'All' : lv}</button>`
  ).join('');
  const rows = list.map((p, i) => {
    const idx = STATE.particleData.particles.indexOf(p);
    return `<div class="word-row" data-action="go" data-view="particleDetail" data-id="${idx}">
      <span class="kanji" style="min-width:64px">${escapeHtml(p.particle)}</span>
      <span class="info">
        <div class="kana">${escapeHtml(p.level)} · ${escapeHtml(CATEGORY_LABEL[p.category] || p.category)}</div>
        <div class="meaning">${escapeHtml(p.meaning_en)}</div>
      </span>
    </div>`;
  }).join('');
  return `<div class="screen">
    ${topbar('Particles', 'home')}
    <div class="tab-row">${tabs}</div>
    <div class="word-list">${rows || '<div class="empty-state">No particles at this level.</div>'}</div>
  </div>`;
}

function renderParticleDetail() {
  const p = STATE.particleData.particles[Number(STATE.viewParams.id)];
  if (!p) return `<div class="screen">${topbar('Not found', 'particles')}</div>`;
  const exHtml = p.examples.map(ex => `
    <div class="cloze-line" style="margin-top:8px">
      ${escapeHtml(ex.jp)}
      <div class="cloze-en">${escapeHtml(ex.en)}</div>
    </div>`).join('');
  return `<div class="screen">
    ${topbar(p.level, 'particles')}
    <div class="detail-head">
      <span class="badge naadj">${escapeHtml(CATEGORY_LABEL[p.category] || p.category)}</span>
      <div class="kanji" style="margin-top:10px;font-size:30px">${escapeHtml(p.particle)}</div>
      <div class="meaning" style="margin-top:8px">${escapeHtml(p.meaning_en)}</div>
    </div>
    <div class="form-row">
      <div class="usage" style="font-size:13px;opacity:.8;line-height:1.6">${escapeHtml(p.usage_note)}</div>
    </div>
    <div class="eyebrow">Examples</div>
    ${exHtml}
  </div>`;
}

/* ---------- directions & position reference ---------- */
const DIRECTION_CATEGORIES = ['all', 'compass', 'position', 'range', 'directions-vocab'];
const DIRECTION_CATEGORY_LABEL = {
  all: 'All', compass: 'Compass', position: 'Position', range: 'Range (以)', 'directions-vocab': 'Giving directions'
};

function renderDirections() {
  const tab = STATE.directionsTab;
  const list = STATE.directionsData.words.filter(w => tab === 'all' || w.category === tab);
  const tabs = DIRECTION_CATEGORIES.map(cat =>
    `<button class="tab ${tab === cat ? 'active' : ''}" data-action="direction-tab" data-tab="${cat}">${DIRECTION_CATEGORY_LABEL[cat]}</button>`
  ).join('');
  const rows = list.map(w => {
    const idx = STATE.directionsData.words.indexOf(w);
    return `<div class="word-row" data-action="go" data-view="directionDetail" data-id="${idx}">
      <span class="kanji">${escapeHtml(w.word)}</span>
      <span class="info">
        <div class="kana">${escapeHtml(w.kana)} · ${escapeHtml(w.romaji)}</div>
        <div class="meaning">${escapeHtml(w.meaning_en)}</div>
      </span>
    </div>`;
  }).join('');
  return `<div class="screen">
    ${topbar('Directions', 'home')}
    <div class="tab-row">${tabs}</div>
    <div class="word-list">${rows || '<div class="empty-state">Nothing in this category.</div>'}</div>
  </div>`;
}

function renderDirectionDetail() {
  const w = STATE.directionsData.words[Number(STATE.viewParams.id)];
  if (!w) return `<div class="screen">${topbar('Not found', 'directions')}</div>`;
  const exHtml = w.examples.map(ex => `
    <div class="cloze-line" style="margin-top:8px">
      ${escapeHtml(ex.jp)}
      <div class="cloze-en">${escapeHtml(ex.en)}</div>
    </div>`).join('');
  const noteHtml = w.usage_note ? `<div class="form-row"><div class="usage" style="font-size:13px;opacity:.8;line-height:1.6">${escapeHtml(w.usage_note)}</div></div>` : '';
  return `<div class="screen">
    ${topbar(DIRECTION_CATEGORY_LABEL[w.category], 'directions')}
    <div class="detail-head">
      <span class="badge naadj">${escapeHtml(DIRECTION_CATEGORY_LABEL[w.category])}</span>
      <div class="kanji" style="margin-top:10px">${escapeHtml(w.word)}</div>
      <div class="kana">${escapeHtml(w.kana)} · ${escapeHtml(w.romaji)}</div>
      <div class="meaning">${escapeHtml(w.meaning_en)}</div>
    </div>
    ${noteHtml}
    <div class="eyebrow">Examples</div>
    ${exHtml}
  </div>`;
}

/* ---------- ko-so-a-do demonstrative reference ---------- */
const DEMO_TABS = ['all', 'pronoun', 'determiner', 'place', 'direction-polite', 'direction-casual', 'manner', 'kind', 'interrogative'];
const DEMO_CATEGORY_LABEL = {
  all: 'All', pronoun: 'Pronoun', determiner: 'Determiner', place: 'Place',
  'direction-polite': 'Direction (polite)', 'direction-casual': 'Direction (casual)',
  manner: 'Manner', kind: 'Kind', interrogative: 'Question words'
};
const DEMO_GRID_ROWS = ['pronoun', 'determiner', 'place', 'direction-polite', 'direction-casual', 'manner', 'kind'];
const DEMO_SERIES = ['ko', 'so', 'a', 'do'];

function demoGridTable() {
  const words = STATE.demonstrativesData.words;
  const find = (cat, series) => words.find(w => w.category === cat && w.series === series);
  const rows = DEMO_GRID_ROWS.map(cat => {
    const cells = DEMO_SERIES.map(s => {
      const w = find(cat, s);
      return `<span style="flex:1;text-align:center">${w ? escapeHtml(w.word) : '—'}</span>`;
    }).join('');
    return `<div style="display:flex;align-items:center;padding:6px 0;border-bottom:1px solid var(--paper-line)">
      <span style="width:84px;font-size:11px;opacity:.55;flex-shrink:0">${escapeHtml(DEMO_CATEGORY_LABEL[cat])}</span>
      <span style="display:flex;flex:1;font-family:var(--font-jp-display);font-size:16px">${cells}</span>
    </div>`;
  }).join('');
  const header = `<div style="display:flex;align-items:center;padding-bottom:6px">
    <span style="width:84px;flex-shrink:0"></span>
    <span style="display:flex;flex:1">
      ${DEMO_SERIES.map(s => `<span style="flex:1;text-align:center;font-size:11px;font-weight:700;color:var(--gold)">${s}-</span>`).join('')}
    </span>
  </div>`;
  return `<div class="form-row">${header}${rows}</div>`;
}

function renderDemonstratives() {
  const tab = STATE.demoTab;
  const list = STATE.demonstrativesData.words.filter(w => tab === 'all' || w.category === tab);
  const tabs = DEMO_TABS.map(cat =>
    `<button class="tab ${tab === cat ? 'active' : ''}" data-action="demo-tab" data-tab="${cat}">${DEMO_CATEGORY_LABEL[cat]}</button>`
  ).join('');
  const rows = list.map(w => {
    const idx = STATE.demonstrativesData.words.indexOf(w);
    return `<div class="word-row" data-action="go" data-view="demonstrativeDetail" data-id="${idx}">
      <span class="kanji">${escapeHtml(w.word)}</span>
      <span class="info">
        <div class="kana">${escapeHtml(w.romaji)}</div>
        <div class="meaning">${escapeHtml(w.meaning_en)}</div>
      </span>
    </div>`;
  }).join('');
  return `<div class="screen">
    ${topbar('Kosoado', 'home')}
    ${demoGridTable()}
    <div class="tab-row" style="flex-wrap:wrap">${tabs}</div>
    <div class="word-list">${rows || '<div class="empty-state">Nothing in this category.</div>'}</div>
  </div>`;
}

function renderDemonstrativeDetail() {
  const w = STATE.demonstrativesData.words[Number(STATE.viewParams.id)];
  if (!w) return `<div class="screen">${topbar('Not found', 'demonstratives')}</div>`;
  const exHtml = w.examples.map(ex => `
    <div class="cloze-line" style="margin-top:8px">
      ${escapeHtml(ex.jp)}
      <div class="cloze-en">${escapeHtml(ex.en)}</div>
    </div>`).join('');
  const noteHtml = w.usage_note ? `<div class="form-row"><div class="usage" style="font-size:13px;opacity:.8;line-height:1.6">${escapeHtml(w.usage_note)}</div></div>` : '';
  const seriesLabel = w.series ? (STATE.demonstrativesData.meta.series_info[w.series] || w.series) : null;
  return `<div class="screen">
    ${topbar(DEMO_CATEGORY_LABEL[w.category], 'demonstratives')}
    <div class="detail-head">
      <span class="badge naadj">${escapeHtml(DEMO_CATEGORY_LABEL[w.category])}</span>
      <div class="kanji" style="margin-top:10px">${escapeHtml(w.word)}</div>
      <div class="kana">${escapeHtml(w.romaji)}</div>
      <div class="meaning">${escapeHtml(w.meaning_en)}</div>
      ${seriesLabel ? `<div class="example" style="border-top:none;margin-top:8px;padding-top:0;opacity:.75;font-size:12.5px">${escapeHtml(seriesLabel)}</div>` : ''}
    </div>
    ${noteHtml}
    <div class="eyebrow">Examples</div>
    ${exHtml}
  </div>`;
}

/* ---------- session screens ---------- */
function currentCard() {
  const s = STATE.session;
  return s.queue[s.index];
}
function sessionProgressPct() {
  const s = STATE.session;
  return Math.round((s.index / s.queue.length) * 100);
}
function renderSession() {
  const s = STATE.session;
  if (!s) return '<div class="screen"><div class="empty-state">No active session.</div></div>';
  if (s.index >= s.queue.length) {
    finishSession();
    return renderSummary();
  }
  const card = currentCard();
  const title = s.kind === 'morning' ? 'Morning · Learn' : 'Evening · Recall';
  let body = '';
  if (card.step === 'teach') body = renderTeachCard(card);
  else if (card.step === 'quiz-recognition') body = renderRecognitionCard(card);
  else if (card.step === 'quiz-recall') body = renderRecallCard(card);
  else if (card.step === 'quiz-meaning') body = renderMeaningCard(card);

  return `<div class="screen">
    ${topbar(title, 'home')}
    <div class="progress-track"><div class="progress-fill" style="width:${sessionProgressPct()}%"></div></div>
    <div class="card-stage">${body}</div>
  </div>`;
}

function wordBadges(word) {
  const cls = isVerb(word) ? 'verb' : word.type;
  const label = isVerb(word) ? 'verb' : (word.type === 'i-adjective' ? 'い-adj' : 'な-adj');
  return `<div class="badges"><span class="badge ${cls}">${label}</span></div>`;
}

function renderTeachCard(card) {
  const { word, formName } = card;
  const formDef = findFormDef(word, formName);
  const result = conjugate(word, formName);
  return `<div class="prompt-card">
    ${wordBadges(word)}
    <div class="kanji">${escapeHtml(word.dictionary)}</div>
    <div class="kana">${escapeHtml(word.kana)} · ${escapeHtml(word.romaji)}</div>
    <div class="meaning">${escapeHtml(word.meaning)}</div>
    <div class="ask">
      <div class="form-name">${escapeHtml(formName)}<span class="jp">${escapeHtml(formDef.name_jp)}</span></div>
      <div class="usage">${escapeHtml(formDef.usage_en)}</div>
    </div>
    <div class="cloze-line">
      ${escapeHtml(result)}
    </div>
  </div>
  <div class="action-row">
    <button class="btn primary" data-action="advance">Got it, next →</button>
  </div>`;
}

function renderRecognitionCard(card) {
  const { word, formName } = card;
  const formDef = findFormDef(word, formName);
  const choices = STATE.session._choicesCache = STATE.session._choicesCache || {};
  const cacheKey = STATE.session.index;
  if (!choices[cacheKey]) choices[cacheKey] = buildChoices(word, formName);
  const opts = choices[cacheKey];
  const correct = conjugate(word, formName);
  const answered = STATE.session._answered;

  const btns = opts.map(opt => {
    let cls = 'choice-btn';
    if (answered) {
      if (opt === correct) cls += ' correct';
      else if (opt === answered.picked && opt !== correct) cls += ' incorrect';
    }
    return `<button class="${cls}" ${answered ? 'disabled' : ''} data-action="choice" data-value="${escapeHtml(opt)}">${escapeHtml(opt)}</button>`;
  }).join('');

  const feedback = answered ? `<div class="action-row"><button class="btn primary" data-action="advance">Next →</button></div>` :
    '';

  return `<div class="prompt-card">
    ${wordBadges(word)}
    <div class="kanji">${escapeHtml(word.dictionary)}</div>
    <div class="kana">${escapeHtml(word.kana)} · ${escapeHtml(word.romaji)}</div>
    <div class="meaning">${escapeHtml(word.meaning)}</div>
    <div class="ask">
      <div class="form-name">${escapeHtml(formName)}<span class="jp">${escapeHtml(formDef.name_jp)}</span></div>
      <div class="usage">${escapeHtml(formDef.usage_en)}</div>
    </div>
  </div>
  <div class="choice-grid">${btns}</div>
  ${feedback}`;
}

function renderRecallCard(card) {
  const { word, formName } = card;
  const formDef = findFormDef(word, formName);
  const result = conjugate(word, formName);
  const revealed = STATE.session._revealed;
  const exJp = word.example.jp;
  const clozeJp = exJp.replace(word.dictionary, revealed ? `<b>${escapeHtml(result)}</b>` : '<span class="blank">&nbsp;</span>');

  const inputHtml = revealed ? '' : `
    <input type="text" class="recall-input" id="recall-input" placeholder="Type it, or just think it through" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false">
    <div class="action-row" style="margin-top:12px">
      <button class="btn primary" data-action="reveal">Show answer</button>
    </div>`;

  const revealHtml = revealed ? `
    <div class="answer-reveal">
      <div class="label">Answer</div>
      <div class="result">${escapeHtml(result)}</div>
      <div class="rule">${escapeHtml(formDef.usage_en)}</div>
    </div>
    <p style="font-size:12.5px;opacity:.6;text-align:center;margin-top:2px">How did that go?</p>
    <div class="action-row">
      <button class="btn again" data-action="grade" data-grade="again">Again</button>
      <button class="btn good" data-action="grade" data-grade="good">Good</button>
      <button class="btn easy" data-action="grade" data-grade="easy">Easy</button>
    </div>` : '';

  return `<div class="prompt-card">
    ${wordBadges(word)}
    <div class="kanji">${escapeHtml(word.dictionary)}</div>
    <div class="kana">${escapeHtml(word.kana)} · ${escapeHtml(word.romaji)}</div>
    <div class="meaning">${escapeHtml(word.meaning)}</div>
    <div class="ask">
      <div class="form-name">${escapeHtml(formName)}<span class="jp">${escapeHtml(formDef.name_jp)}</span></div>
      <div class="usage">${escapeHtml(formDef.usage_en)}</div>
    </div>
    <div class="cloze-line">${clozeJp}</div>
    <div class="cloze-en">${escapeHtml(word.example.en)}</div>
  </div>
  ${inputHtml}
  ${revealHtml}`;
}

function renderMeaningCard(card) {
  const { word, direction } = card;
  const revealed = STATE.session._revealed;
  const promptIsJp = direction === 'jp2en';
  return `<div class="prompt-card">
    ${wordBadges(word)}
    <div class="ask" style="border:none;margin-top:0;padding-top:0">
      <div class="form-name">${promptIsJp ? 'What does this mean?' : 'How do you say this in Japanese?'}</div>
    </div>
    <div class="kanji" style="margin-top:14px">${promptIsJp ? escapeHtml(word.dictionary) : escapeHtml(word.meaning)}</div>
    ${promptIsJp ? `<div class="kana">${escapeHtml(word.kana)}</div>` : ''}
  </div>
  ${revealed ? `
    <div class="answer-reveal">
      <div class="label">Answer</div>
      <div class="result">${promptIsJp ? escapeHtml(word.meaning) : escapeHtml(word.dictionary) + ' — ' + escapeHtml(word.kana)}</div>
    </div>
    <div class="action-row">
      <button class="btn again" data-action="grade-meaning" data-grade="again">Missed it</button>
      <button class="btn good" data-action="grade-meaning" data-grade="good">Got it</button>
    </div>` : `
    <div class="action-row">
      <button class="btn primary" data-action="reveal">Show answer</button>
    </div>`}`;
}

function renderSummary() {
  const s = STATE.session;
  const acc = s.stats.total ? Math.round((s.stats.correct / s.stats.total) * 100) : 100;
  return `<div class="screen">
    <div class="summary-hero">
      <div class="big">${s.kind === 'morning' ? 'よくできました' : 'お疲れ様'}</div>
      <div class="cap">${s.kind === 'morning' ? 'Nicely done' : 'Great work today'}</div>
    </div>
    <div class="summary-grid">
      <div class="box"><div class="n">${s.stats.newCount}</div><div class="l">new</div></div>
      <div class="box"><div class="n">${s.stats.total}</div><div class="l">reviewed</div></div>
      <div class="box"><div class="n">${acc}%</div><div class="l">accuracy</div></div>
    </div>
    <button class="btn primary" data-action="go" data-view="home">Back to home</button>
  </div>`;
}

/* ---------------- session interaction handlers ---------------- */
function finishSession() {
  markSessionDone(STATE.session.kind);
}

function handleChoice(picked) {
  const card = currentCard();
  const correct = conjugate(card.word, card.formName);
  const isCorrect = picked === correct;
  const key = srsKey(card.word.id, card.formName);
  if (!STATE.srs[key]) introduceCard(card.word, card.formName);
  gradeCard(card.word, card.formName, isCorrect ? 'good' : 'again');
  STATE.session.stats.total += 1;
  if (isCorrect) STATE.session.stats.correct += 1;
  STATE.session._answered = { picked, correct: isCorrect };
  render();
}

function advanceQueue() {
  STATE.session.index += 1;
  STATE.session._answered = null;
  STATE.session._revealed = false;
  render();
}

function handleReveal() {
  STATE.session._revealed = true;
  render();
}

function handleGrade(grade) {
  const card = currentCard();
  const key = srsKey(card.word.id, card.formName);
  if (!STATE.srs[key]) introduceCard(card.word, card.formName);
  const correct = gradeCard(card.word, card.formName, grade);
  STATE.session.stats.total += 1;
  if (correct) STATE.session.stats.correct += 1;
  advanceQueue();
}

function handleGradeMeaning(grade) {
  const card = currentCard();
  gradeMeaning(card.word.id, grade);
  STATE.session.stats.total += 1;
  if (grade !== 'again') STATE.session.stats.correct += 1;
  advanceQueue();
}

/* ---------------- routing / event delegation ---------------- */
function goView(view, params) {
  STATE.view = view;
  STATE.viewParams = params || {};
  render();
}

function startSession(kind) {
  STATE.session = kind === 'morning' ? buildMorningSession() : buildEveningSession();
  if (STATE.session.queue.length === 0) {
    // absolute fallback: nothing exists to review or learn
    STATE.session.queue.push({ step: 'teach', word: STATE.allWords[0], formName: 'dictionary' });
  }
  goView('session');
}

app.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action;

  if (action === 'go') {
    const view = el.dataset.view;
    const params = {};
    if (el.dataset.id) params.id = el.dataset.id;
    if (el.dataset.kind) params.kind = el.dataset.kind;
    if (el.dataset.form) params.form = el.dataset.form;
    goView(view, params);
  } else if (action === 'tab') {
    STATE.libraryTab = el.dataset.tab;
    render();
  } else if (action === 'particle-tab') {
    STATE.particleTab = el.dataset.tab;
    render();
  } else if (action === 'direction-tab') {
    STATE.directionsTab = el.dataset.tab;
    render();
  } else if (action === 'demo-tab') {
    STATE.demoTab = el.dataset.tab;
    render();
  } else if (action === 'start-session') {
    startSession(el.dataset.kind);
  } else if (action === 'choice') {
    if (!STATE.session._answered) handleChoice(el.dataset.value);
  } else if (action === 'advance') {
    advanceQueue();
  } else if (action === 'reveal') {
    handleReveal();
  } else if (action === 'grade') {
    handleGrade(el.dataset.grade);
  } else if (action === 'grade-meaning') {
    handleGradeMeaning(el.dataset.grade);
  }
});

/* ---------------- boot ---------------- */
async function boot() {
  loadStorage();
  try {
    await loadData();
  } catch (err) {
    app.innerHTML = `<div class="screen"><div class="empty-state"><div class="glyph">⚠️</div>Could not load word data.<br><small>${escapeHtml(String(err))}</small></div></div>`;
    return;
  }
  goView('home');
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

boot();
