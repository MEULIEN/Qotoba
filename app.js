/* ============================================================
   Qotoba 言葉 — Japanese conjugation trainer
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

/* ---------------- study modes & customization ---------------- */
const SESSION_MODE_QUICK = 'quick';
const SESSION_MODE_EXTENSIVE = 'extensive';
const EXTENSIVE_FORMS_PER_WORD = 4; // distinct forms drilled per word in an extensive session
const TEST_QUESTIONS = 10;           // questions drawn per test from previously seen items
const THEME_LIGHT = 'light';
const THEME_DARK = 'dark';
// Color choices always follow the theme: light backgrounds in light theme,
// dark backgrounds in dark theme — never a mismatch.
const BG_PRESETS_LIGHT = ['#FAF8F2', '#FFFDF6', '#F4E9D8', '#E8EDF2', '#F7EFE8'];
const BG_PRESETS_DARK = ['#191C20', '#232A2F', '#2B2326', '#1F3352', '#3A2E1E'];
function bgPresetsFor(theme) { return theme === THEME_DARK ? BG_PRESETS_DARK : BG_PRESETS_LIGHT; }

/* ---------------- exam ---------------- */
const EXAM_QUESTIONS = 10;           // questions per exam
const EXAM_SECONDS_PER_QUESTION = 20; // used for the estimated-duration notice

/* ---------------- word categories ----------------
   Coarse word types shown at the top of the Topics selector; topic tags
   (daily, animals, business, …) refine within them. */
const CATEGORY_IDS = ['verb', 'adverb', 'i-adjective', 'na-adjective', 'noun', 'particle', 'direction', 'kosoado', 'radical'];
const CATEGORY_LABELS = {
  verb: 'Verbs',
  adverb: 'Adverbs',
  'i-adjective': 'い-adjectives',
  'na-adjective': 'な-adjectives',
  noun: 'Nouns',
  particle: 'Particles',
  direction: 'Directions',
  kosoado: 'Kosoado',
  radical: 'Radicals'
};

/* ---------------- state ---------------- */
const STATE = {
  verbData: null,
  adjData: null,
  particleData: null,
  directionsData: null,
  demonstrativesData: null,
  radicalData: null,
  allWords: [],
  srs: {},        // key -> {box, due, introduced, reps, lapses}
  meaningSrs: {},  // wordId -> {box, due}
  progress: { streak: 0, lastActiveDate: null, totalReviews: 0, totalCorrect: 0, today: { date: null, morning: false, evening: false } },
  testStats: { total: 0, correct: 0, sessions: 0, history: [] },
  view: 'loading',
  viewParams: {},
  session: null,
  sessionOrigin: null,
  examLevel: null,
  libraryTab: 'all',
  particleTab: 'all',
  directionsTab: 'all',
  demoTab: 'all',
  radicalTab: 'all'
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

/* ---------------- storage keys ---------------- */
// Renamed prefix (katsuyo -> qotoba). migrateStorage() copies any existing
// katsuyo_* data across on first run, so streaks/vocabulary are never lost.
const LS_SRS = 'qotoba_srs_v1';
const LS_MEANING = 'qotoba_meaning_srs_v1';
const LS_PROGRESS = 'qotoba_progress_v1';
const LS_SETTINGS = 'qotoba_settings_v1';
const LS_TEST = 'qotoba_test_v1';
const OLD_KEYS = [
  ['katsuyo_srs_v1', LS_SRS],
  ['katsuyo_meaning_srs_v1', LS_MEANING],
  ['katsuyo_progress_v1', LS_PROGRESS],
  ['katsuyo_settings_v1', LS_SETTINGS]
];

function migrateStorage() {
  try {
    for (const [oldKey, newKey] of OLD_KEYS) {
      if (localStorage.getItem(newKey) === null && localStorage.getItem(oldKey) !== null) {
        localStorage.setItem(newKey, localStorage.getItem(oldKey));
      }
    }
  } catch (e) { /* storage unavailable; keep going with defaults */ }
}

/* ============================================================
   DataRegistry — single source of truth for every data file.
   Word sources (verbs, adjectives) feed the SRS and library;
   reference sources (particles, directions, demonstratives,
   radicals) only feed their browse views.
   ============================================================ */
class DataRegistry {
  constructor() {
    this.sources = {};     // name -> { words: [...] }
    this.references = {};  // name -> reference payload
    this.conj = {};        // name -> conjugation rule payload
  }

  registerWordSource(name, data) { this.sources[name] = data; }
  registerReference(name, data) { this.references[name] = data; }
  registerConjugation(name, data) { this.conj[name] = data; }

  get verbWords() { return (this.sources.verb && this.sources.verb.words) || []; }
  get adjWords() { return (this.sources.adjective && this.sources.adjective.words) || []; }
  get adverbWords() { return (this.sources.adverb && this.sources.adverb.words) || []; }
  get nounWords() { return (this.sources.noun && this.sources.noun.words) || []; }
  get particleWords() { return (this.sources.particle && this.sources.particle.words) || []; }
  get directionWords() { return (this.sources.direction && this.sources.direction.words) || []; }
  get kosoadoWords() { return (this.sources.kosoado && this.sources.kosoado.words) || []; }
  get radicalWords() { return (this.sources.radical && this.sources.radical.words) || []; }
  get allWords() {
    return [...this.verbWords, ...this.adjWords, ...this.adverbWords, ...this.nounWords,
      ...this.particleWords, ...this.directionWords, ...this.kosoadoWords, ...this.radicalWords];
  }

  isVerb(word) { return word.type === 'verb'; }
  isAdjective(word) { return word.type === 'i-adjective' || word.type === 'na-adjective'; }
  formsFor(word) {
    if (this.isVerb(word)) return this.conj.verb.tenses;
    if (this.isAdjective(word)) return this.conj.adj.forms;
    return [{ name_en: 'dictionary', name_jp: 'じしょけい', usage_en: 'The basic plain (dictionary) form.' }];
  }
  tiersFor(word) { return this.isVerb(word) ? VERB_TIERS : ADJ_TIERS; }
  formDef(word, formName) { return this.formsFor(word).find(f => f.name_en === formName); }
  findWord(id) { return this.allWords.find(w => w.id === id); }

  levelOf(word) {
    const tag = (word.tags || []).find(t => /^n[1-5]$/.test(t));
    return tag || null;
  }
  topicsOf(word) { return (word.tags || []).filter(t => !/^n[1-5]$/.test(t)); }
  get availableLevels() {
    const have = new Set(this.allWords.map(w => this.levelOf(w)).filter(Boolean));
    return ['n5', 'n4', 'n3', 'n2', 'n1'].filter(l => have.has(l));
  }
  get availableTopics() {
    const set = new Set();
    for (const w of this.allWords) for (const t of this.topicsOf(w)) set.add(t);
    return [...set].sort();
  }
  enabledWords() { return this.allWords.filter(w => settings.wordEnabled(w)); }
  enabledIdSet() { return new Set(this.enabledWords().map(w => w.id)); }
}

/* ---------------- theme & background helpers ----------------
   Background colors are user-customizable. The palette is derived
   from the chosen background: light backgrounds get dark ink, dark
   (soft, never pure black) backgrounds get light ink. Card surfaces,
   divider lines and dim tints are recomputed so every theme stays
   readable without changing the rest of the design. */
function defaultAnchorFor(theme) { return theme === THEME_DARK ? '#191C20' : '#FAF8F2'; }
// Allowed background lightness window per theme, so a light color can never
// be picked under dark theme (or vice versa).
function themeRange(theme) { return theme === THEME_DARK ? { min: 0, max: 45 } : { min: 55, max: 100 }; }
// Clamp a hex color's lightness into the window allowed by the theme.
function coerceThemeColor(hex, theme) {
  const c = hexToRgb(hex);
  const hsl = rgbToHsl(c.r, c.g, c.b);
  const range = themeRange(theme);
  const l = Math.min(range.max / 100, Math.max(range.min / 100, hsl.l));
  if (l === hsl.l) return hex;
  return hslToHex(hsl.h, hsl.s, l);
}
function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}
function rgbToHex(r, g, b) {
  const c = v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return '#' + c(r) + c(g) + c(b);
}
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return { h, s, l };
}
function hslToHex(h, s, l) {
  h = (h % 1 + 1) % 1;
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  if (s === 0) { const v = Math.round(l * 255); return rgbToHex(v, v, v); }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const rr = hue2rgb(p, q, h + 1 / 3);
  const gg = hue2rgb(p, q, h);
  const bb = hue2rgb(p, q, h - 1 / 3);
  return rgbToHex(rr * 255, gg * 255, bb * 255);
}
function luminance(rgb) {
  const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(rgb.r) + 0.7152 * f(rgb.g) + 0.0722 * f(rgb.b);
}
function mixRgb(a, b, t) {
  return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t };
}
function shadeHex(hex, t) {
  const base = hexToRgb(hex);
  const target = t >= 0 ? { r: 255, g: 255, b: 255 } : { r: 0, g: 0, b: 0 };
  const m = mixRgb(base, target, Math.abs(t));
  return rgbToHex(m.r, m.g, m.b);
}
function rgbaStr(hex, alpha) {
  const c = hexToRgb(hex);
  return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + alpha + ')';
}
function effectiveBackground(value) {
  const theme = value.theme === THEME_DARK ? THEME_DARK : THEME_LIGHT;
  const anchor = value.background || defaultAnchorFor(theme);
  const base = hexToRgb(anchor);
  const hsl = rgbToHsl(base.r, base.g, base.b);
  const shade = value.shade == null ? Math.round(hsl.l * 100) : value.shade;
  return hslToHex(hsl.h, hsl.s, shade / 100);
}
function derivePalette(bg) {
  const base = hexToRgb(bg);
  const dark = luminance(base) < 0.4;
  const ink = dark ? '#ECE8DF' : '#1F3352';
  const inkDeep = dark ? '#F6F3EC' : '#142238';
  return {
    paper: bg,
    ink,
    inkDeep,
    card: dark ? shadeHex(bg, 0.06) : '#FFFFFF',
    paperDim: shadeHex(bg, dark ? -0.05 : -0.02),
    paperLine: dark ? rgbaStr('#ECE8DF', 0.18) : 'rgba(31,51,82,0.12)'
  };
}
function applyThemeSettings(value) {
  if (typeof document === 'undefined' || !document.documentElement || !document.documentElement.style) return;
  const dark = value.theme === THEME_DARK;
  const bg = effectiveBackground(value);
  const pal = derivePalette(bg);
  const root = document.documentElement;
  root.setAttribute('data-theme', dark ? 'dark' : 'light');
  root.style.setProperty('--paper', pal.paper);
  root.style.setProperty('--ink', pal.ink);
  root.style.setProperty('--ink-deep', pal.inkDeep);
  root.style.setProperty('--paper-dim', pal.paperDim);
  root.style.setProperty('--paper-line', pal.paperLine);
  root.style.setProperty('--card', pal.card);
  if (document.body && document.body.style) document.body.style.background = pal.paper;
  const meta = document.querySelector && document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', pal.paper);
}

/* ============================================================
   Settings — which levels and topics are in the study scope,
   the daily session mode (quick vs extensive), and appearance.
   A word is included only when its JLPT level tag (if any) is
   selected and, when any topics are selected, it carries at
   least one of those topic tags.
   ============================================================ */
class Settings {
  constructor() {
    this.key = LS_SETTINGS;
    this.DEFAULTS = {
      levels: ['n5', 'n4', 'n3', 'n2', 'n1'],
      topics: [],
      categories: [...CATEGORY_IDS],
      sessionMode: SESSION_MODE_QUICK,
      theme: THEME_LIGHT,
      background: null,
      shade: null
    };
    this.value = {
      levels: [...this.DEFAULTS.levels],
      topics: [],
      categories: [...this.DEFAULTS.categories],
      sessionMode: this.DEFAULTS.sessionMode,
      theme: this.DEFAULTS.theme,
      background: null,
      shade: null
    };
  }
  load() {
    try {
      const raw = JSON.parse(localStorage.getItem(this.key));
      if (raw) {
        if (Array.isArray(raw.levels)) this.value.levels = raw.levels;
        if (Array.isArray(raw.topics)) this.value.topics = raw.topics;
        if (Array.isArray(raw.categories)) {
          this.value.categories = raw.categories.filter(c => CATEGORY_IDS.includes(c));
          if (this.value.categories.length === 0) this.value.categories = [...CATEGORY_IDS];
        }
        if (raw.sessionMode === SESSION_MODE_EXTENSIVE || raw.sessionMode === SESSION_MODE_QUICK) this.value.sessionMode = raw.sessionMode;
        if (raw.theme === THEME_DARK || raw.theme === THEME_LIGHT) this.value.theme = raw.theme;
        if (typeof raw.background === 'string' && /^#[0-9a-fA-F]{6}$/.test(raw.background)) {
          this.value.background = coerceThemeColor(raw.background, this.value.theme);
        }
        if (typeof raw.shade === 'number' && raw.shade >= 0 && raw.shade <= 100) this.value.shade = raw.shade;
      }
    } catch (e) { /* keep defaults */ }
  }
  save() { localStorage.setItem(this.key, JSON.stringify(this.value)); }
  reset() {
    this.value = {
      levels: [...this.DEFAULTS.levels],
      topics: [],
      categories: [...this.DEFAULTS.categories],
      sessionMode: this.DEFAULTS.sessionMode,
      theme: this.DEFAULTS.theme,
      background: null,
      shade: null
    };
    this.save();
    this.applyTheme();
  }
  applyTheme() { applyThemeSettings(this.value); }
  currentBackground() { return effectiveBackground(this.value); }
  setSessionMode(mode) {
    if (mode === SESSION_MODE_QUICK || mode === SESSION_MODE_EXTENSIVE) {
      this.value.sessionMode = mode;
      this.save();
    }
  }
  setTheme(theme) {
    if (theme === THEME_LIGHT || theme === THEME_DARK) {
      this.value.theme = theme;
      this.value.background = null;
      this.value.shade = null;
      this.save();
      this.applyTheme();
    }
  }
  setBackground(hex) {
    if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return;
    this.value.background = coerceThemeColor(hex, this.value.theme);
    this.value.shade = null;
    this.save();
    this.applyTheme();
  }
  setShade(shade) {
    if (this.value.background == null) this.value.background = defaultAnchorFor(this.value.theme);
    const range = themeRange(this.value.theme);
    this.value.shade = Math.max(range.min, Math.min(range.max, Math.round(Number(shade) || 50)));
    this.save();
    this.applyTheme();
  }
  resetBackground() {
    this.value.background = null;
    this.value.shade = null;
    this.save();
    this.applyTheme();
  }
  toggleLevel(level) {
    const i = this.value.levels.indexOf(level);
    if (i >= 0) this.value.levels.splice(i, 1);
    else this.value.levels.push(level);
    this.save();
  }
  toggleCategory(cat) {
    if (!CATEGORY_IDS.includes(cat)) return;
    if (!Array.isArray(this.value.categories)) this.value.categories = [...CATEGORY_IDS];
    const i = this.value.categories.indexOf(cat);
    if (i >= 0) this.value.categories.splice(i, 1);
    else this.value.categories.push(cat);
    this.save();
  }
  wordEnabled(word) {
    const level = registry.levelOf(word);
    if (level && !this.value.levels.includes(level)) return false;
    const cats = this.value.categories || CATEGORY_IDS;
    if (cats.length && !cats.includes(word.type)) return false;
    if (this.value.topics.length === 0) return true;
    return registry.topicsOf(word).some(t => this.value.topics.includes(t));
  }
}

/* ============================================================
   SrsEngine — all spaced-repetition state lives here (keys,
   meaning cards, daily progress) and persists to localStorage.
   ============================================================ */
class SrsEngine {
  load() {
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
  saveSrs() { localStorage.setItem(LS_SRS, JSON.stringify(STATE.srs)); }
  saveMeaningSrs() { localStorage.setItem(LS_MEANING, JSON.stringify(STATE.meaningSrs)); }
  saveProgress() { localStorage.setItem(LS_PROGRESS, JSON.stringify(STATE.progress)); }

  tierIndexOf(word, formName) {
    const tiers = registry.tiersFor(word);
    for (let i = 0; i < tiers.length; i++) if (tiers[i].includes(formName)) return i;
    return tiers.length;
  }
  getNewCandidates(limit) {
    const enabledIds = registry.enabledIdSet();
    const introducedCount = {};
    for (const key in STATE.srs) {
      if (!enabledIds.has(key.split('::')[0])) continue;
      const wordId = key.split('::')[0];
      introducedCount[wordId] = (introducedCount[wordId] || 0) + 1;
    }
    const totalForWord = {};
    for (const word of registry.enabledWords()) totalForWord[word.id] = registry.formsFor(word).length;

    const inProgressCount = Object.keys(introducedCount)
      .filter(id => introducedCount[id] < (totalForWord[id] || Infinity)).length;
    let poolHasRoom = inProgressCount < ACTIVE_WORD_POOL;

    const candidates = [];
    for (const word of registry.enabledWords()) {
      const introduced = introducedCount[word.id] || 0;
      const started = introduced > 0;
      if (!started && !poolHasRoom) continue;
      const forms = registry.formsFor(word).map(f => f.name_en);
      for (const formName of forms) {
        const key = srsKey(word.id, formName);
        if (!STATE.srs[key]) candidates.push({ word, formName, tier: this.tierIndexOf(word, formName), started });
      }
    }
    candidates.sort((a, b) => (a.tier - b.tier) || (b.started - a.started) || (Math.random() - 0.5));
    return candidates.slice(0, limit);
  }
  getDueItems(limit) {
    const enabledIds = registry.enabledIdSet();
    const today = todayStr();
    const due = [];
    for (const key in STATE.srs) {
      const item = STATE.srs[key];
      if (item.introduced && item.due <= today) {
        const [wordId, formName] = key.split('::');
        if (!enabledIds.has(wordId)) continue;
        const word = registry.findWord(wordId);
        if (word) due.push({ word, formName, srsItem: item });
      }
    }
    due.sort((a, b) => a.srsItem.due.localeCompare(b.srsItem.due));
    return shuffle(due.slice(0, Math.max(limit * 2, limit))).slice(0, limit);
  }
  introduceCard(word, formName) {
    const key = srsKey(word.id, formName);
    STATE.srs[key] = { box: 1, due: todayStr(), introduced: true, reps: 0, lapses: 0 };
  }
  gradeCard(word, formName, grade) {
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
    this.saveSrs();
    STATE.progress.totalReviews += 1;
    if (correct) STATE.progress.totalCorrect += 1;
    this.saveProgress();
    return correct;
  }
  gradeMeaning(wordId, grade) {
    const item = STATE.meaningSrs[wordId] || { box: 1, due: todayStr() };
    if (grade === 'again') { item.box = 1; item.due = todayStr(); }
    else { item.box = Math.min(item.box + 1, MAX_BOX); item.due = addDays(todayStr(), BOX_INTERVAL_DAYS[item.box]); }
    STATE.meaningSrs[wordId] = item;
    this.saveMeaningSrs();
  }
  masteryStats() {
    let introduced = 0, mastered = 0, total = 0;
    const enabledIds = registry.enabledIdSet();
    for (const word of registry.enabledWords()) total += registry.formsFor(word).length;
    for (const key in STATE.srs) {
      if (!enabledIds.has(key.split('::')[0])) continue;
      const item = STATE.srs[key];
      if (item.introduced) { introduced++; if (item.box >= MAX_BOX) mastered++; }
    }
    return { introduced, mastered, total };
  }
  markSessionDone(kind) {
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
    this.saveProgress();
  }
}

/* ============================================================
   Conjugation engine — runs on word + rule data from the
   registry. conjugate() returns the kanji form; conjugateKana()
   reruns the engine on the kana reading so hiragana answers
   are accepted (e.g. 指さない → ささない).
   ============================================================ */
function conjugate(word, formName) {
  const overrides = word.irregular_overrides || {};
  if (Object.prototype.hasOwnProperty.call(overrides, formName)) return overrides[formName];

  if (word.type !== 'verb' && word.type !== 'i-adjective' && word.type !== 'na-adjective') {
    return formName === 'dictionary' ? word.dictionary : '?';
  }

  const formDef = registry.formDef(word, formName);
  if (!formDef) return '?';
  const struct = formDef.structure;

  if (registry.isVerb(word)) {
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

function conjugateKana(word, formName) {
  return conjugate({ ...word, dictionary: word.kana }, formName);
}

function normalizeAnswer(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, '');
}
function answerAccepted(word, formName, typed) {
  const normalized = normalizeAnswer(typed);
  if (!normalized) return false;
  const candidates = [
    conjugate(word, formName),
    conjugateKana(word, formName),
    word.dictionary,
    word.kana,
    (word.romaji || '').toLowerCase()
  ].filter(Boolean);
  return candidates.some(c => normalizeAnswer(c) === normalized);
}

function meaningAccepted(word, direction, typed) {
  const normalized = normalizeAnswer(typed);
  if (!normalized) return false;
  if (direction === 'en2jp') {
    return [word.dictionary, word.kana, (word.romaji || '').toLowerCase()]
      .filter(Boolean)
      .some(c => normalizeAnswer(c) === normalized);
  }
  const chunks = String(word.meaning || '').split(/[;,，、]/).map(c => normalizeAnswer(c)).filter(Boolean);
  return chunks.some(c => c === normalized || (normalized.length >= 3 && (c.includes(normalized) || normalized.includes(c))));
}

function exampleForForm(word, formName) {
  const ex = word.example || {};
  // When the example japanese never contains the dictionary form, the cloze
  // never fires, so the sentence (and its translation) does not change —
  // the base English is accurate for every form.
  if (!ex.jp || !ex.jp.includes(word.dictionary)) return ex.en || '';
  // English has no plain/polite distinction — base gloss is accurate.
  if (formName === 'dictionary' || formName === 'polite present') return ex.en || '';
  return (ex.form_en && ex.form_en[formName]) || '';
}

/* ---------------- distractor generation (for recognition quiz) ---------------- */
function buildChoices(word, formName) {
  const correct = conjugate(word, formName);
  const forms = registry.formsFor(word).map(f => f.name_en).filter(f => f !== formName);
  const otherResults = shuffle(forms).map(f => conjugate(word, f)).filter(r => r && r !== correct && r !== '?');
  const uniqueDistractors = [...new Set(otherResults)].slice(0, 3);
  if (uniqueDistractors.length < 3) {
    const pool = registry.enabledWords().filter(w => w.id !== word.id && registry.isVerb(w) === registry.isVerb(word));
    for (const w of shuffle(pool)) {
      if (uniqueDistractors.length >= 3) break;
      const r = conjugate(w, formName);
      if (r && r !== correct && !uniqueDistractors.includes(r)) uniqueDistractors.push(r);
    }
  }
  return shuffle([correct, ...uniqueDistractors.slice(0, 3)]);
}

/* ============================================================
   Session — one study run (morning teach+recognize, evening
   recall+meaning) built from the SRS engine.
   ============================================================ */
class Session {
  constructor(kind, mode) {
    this.kind = kind;
    this.mode = mode || SESSION_MODE_QUICK;
    this.queue = [];
    this.index = 0;
    this.stats = { correct: 0, total: 0, newCount: 0 };
    this._answered = null;
    this._revealed = false;
    this._choicesCache = {};
    if (kind === 'morning') this.buildMorning();
    else this.buildEvening();
    if (this.mode === SESSION_MODE_EXTENSIVE) this.expandForExtensive();
  }
  tierIndexOf(word, formName) {
    const tiers = registry.tiersFor(word);
    for (let i = 0; i < tiers.length; i++) if (tiers[i].includes(formName)) return i;
    return tiers.length;
  }
  expandForExtensive() {
    // Keep the exact same vocabulary set as the quick session, but drill
    // each word up to EXTENSIVE_FORMS_PER_WORD different forms so the same
    // item is presented several times testing different tenses.
    const perWord = {};
    for (const card of this.queue) {
      if (!card || !card.word) continue;
      const id = card.word.id;
      if (!perWord[id]) perWord[id] = new Set();
      if (card.formName) perWord[id].add(card.formName);
    }
    const extras = [];
    for (const word of registry.enabledWords()) {
      const formsSeen = perWord[word.id];
      if (!formsSeen) continue;
      const want = EXTENSIVE_FORMS_PER_WORD - formsSeen.size;
      if (want <= 0) continue;
      const introduced = [];
      const fresh = [];
      for (const f of registry.formsFor(word)) {
        const fn = f.name_en;
        if (formsSeen.has(fn)) continue;
        const item = STATE.srs[srsKey(word.id, fn)];
        if (item && item.introduced) introduced.push(fn);
        else if (!item && this.tierIndexOf(word, fn) === 0) fresh.push(fn);
      }
      for (const fn of shuffle([...introduced, ...fresh]).slice(0, want)) {
        const item = STATE.srs[srsKey(word.id, fn)];
        const isNew = !(item && item.introduced);
        if (isNew) {
          extras.push({ step: 'teach', word, formName: fn, isNew: true, extensive: true });
          extras.push({ step: 'quiz-recognition', word, formName: fn, isNew: true, extensive: true });
        } else {
          const step = this.kind === 'morning' ? 'quiz-recognition' : 'quiz-recall';
          extras.push({ step, word, formName: fn, isNew: false, extensive: true });
        }
      }
    }
    this.queue = this.queue.concat(shuffle(extras));
  }
  buildMorning() {
    const newCards = srs.getNewCandidates(NEW_PER_MORNING);
    const dueCards = srs.getDueItems(DUE_PER_MORNING);
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
    this.queue = queue;
    this.stats.newCount = newCards.length;
  }
  buildEvening() {
    let dueCards = srs.getDueItems(DUE_PER_EVENING);
    if (dueCards.length === 0) {
      const pool = [];
      const enabledIds = registry.enabledIdSet();
      for (const key in STATE.srs) {
        const item = STATE.srs[key];
        if (item.introduced) {
          const [wordId, formName] = key.split('::');
          if (!enabledIds.has(wordId)) continue;
          const word = registry.findWord(wordId);
          if (word) pool.push({ word, formName, srsItem: item });
        }
      }
      dueCards = sample(pool, 5);
    }
    const queue = shuffle(dueCards.map(c => ({ step: 'quiz-recall', word: c.word, formName: c.formName })));

    const enabledIds = registry.enabledIdSet();
    const introducedWordIds = [...new Set(Object.keys(STATE.srs)
      .filter(k => STATE.srs[k].introduced)
      .map(k => k.split('::')[0])
      .filter(id => enabledIds.has(id)))];
    const meaningWords = sample(introducedWordIds.map(id => registry.findWord(id)).filter(Boolean), MEANING_CARDS_PER_EVENING);
    const meaningCards = meaningWords.map(w => ({ step: 'quiz-meaning', word: w, direction: Math.random() < 0.5 ? 'jp2en' : 'en2jp' }));

    this.queue = shuffle([...queue, ...meaningCards]);
  }
  currentCard() { return this.queue[this.index]; }
  advance() {
    this.index += 1;
    this._answered = null;
    this._revealed = false;
  }
  finish() { srs.markSessionDone(this.kind); }
}

/* ============================================================
   TestSession — a self-check drawn ONLY from previously seen
   items. Unlike daily sessions it never touches the SRS boxes,
   the streak, or the daily "done" flags — pure evaluation, with
   results accumulated into the scoreboard.
   ============================================================ */
class TestSession {
  constructor(queue) {
    this.kind = 'test';
    this.mode = SESSION_MODE_QUICK;
    this.queue = queue;
    this.index = 0;
    this.stats = { correct: 0, total: 0, newCount: 0 };
    this._answered = null;
    this._revealed = false;
    this._choicesCache = {};
  }
  currentCard() { return this.queue[this.index]; }
  advance() {
    this.index += 1;
    this._answered = null;
    this._revealed = false;
  }
  finish() { /* scoreboard is recorded separately in finishSession */ }
}

/* ============================================================
   ExamSession — a timed, JLPT-style, unskippable exam. Like a
   test it never touches the SRS boxes, streak, or daily flags;
   unlike a test there is no reveal/skip and no back button, so
   once started it runs to the end. Results are recorded into
   the same scoreboard, tagged as exams.
   ============================================================ */
class ExamSession {
  constructor(queue, level) {
    this.kind = 'exam';
    this.level = level || null;
    this.queue = queue;
    this.index = 0;
    this.stats = { correct: 0, total: 0, newCount: 0 };
    this._answered = null;
    this._revealed = false;
    this._choicesCache = {};
  }
  currentCard() { return this.queue[this.index]; }
  advance() {
    this.index += 1;
    this._answered = null;
    this._revealed = false;
  }
  finish() { /* scoreboard is recorded separately in finishSession */ }
}

function buildMeaningChoices(word) {
  const correct = String(word.meaning || '');
  const seen = new Set([correct]);
  const distractors = [];
  for (const w of shuffle(registry.allWords)) {
    const m = String(w.meaning || '');
    if (w.id === word.id || seen.has(m)) continue;
    seen.add(m);
    distractors.push(m);
    if (distractors.length >= 3) break;
  }
  return shuffle([correct, ...distractors]);
}

function buildExamSession(level) {
  const pool = registry.enabledWords().filter(w => registry.levelOf(w) === level);
  if (pool.length === 0) return null;
  const conjugable = pool.filter(w => registry.isVerb(w) || registry.isAdjective(w));
  const nRec = Math.min(5, conjugable.length);
  const nMean = Math.min(EXAM_QUESTIONS - nRec, pool.length);
  const queue = [];
  for (const word of sample(conjugable, nRec)) {
    const forms = registry.formsFor(word).map(f => f.name_en);
    const formName = forms.find(f => f !== 'dictionary') || 'dictionary';
    queue.push({ step: 'quiz-recognition', word, formName, correct: conjugate(word, formName), isExam: true });
  }
  for (const word of sample(pool, nMean)) {
    queue.push({ step: 'quiz-meaning', word, direction: 'jp2en', correct: String(word.meaning || ''), isExam: true });
  }
  if (queue.length === 0) return null;
  return new ExamSession(shuffle(queue), level);
}

function countSeenItems() {
  const enabledIds = registry.enabledIdSet();
  let n = 0;
  for (const key in STATE.srs) {
    const item = STATE.srs[key];
    if (item && item.introduced && enabledIds.has(key.split('::')[0])) n += 1;
  }
  return n;
}

function buildTestSession(limit) {
  const enabledIds = registry.enabledIdSet();
  const seen = [];
  for (const key in STATE.srs) {
    const item = STATE.srs[key];
    if (!item || !item.introduced) continue;
    const [wordId, formName] = key.split('::');
    if (!enabledIds.has(wordId)) continue;
    const word = registry.findWord(wordId);
    if (word) seen.push({ word, formName });
  }
  if (seen.length === 0) return null;
  const n = Math.min(limit || TEST_QUESTIONS, seen.length);
  const queue = sample(seen, n).map(({ word, formName }) => {
    const roll = Math.random();
    let step = 'quiz-recall';
    if (roll < 0.35) step = 'quiz-recognition';
    else if (roll < 0.5) step = 'quiz-meaning';
    const card = { step, word, formName, isTest: true };
    if (step === 'quiz-meaning') card.direction = Math.random() < 0.5 ? 'jp2en' : 'en2jp';
    return card;
  });
  return new TestSession(queue);
}

/* ============================================================
   FreeStudySession — an untimed practice run for anyone who wants
   to drill more than the daily sessions allow. It draws from the
   full enabled scope (any word, any form), never writes to the
   SRS boxes, never records into the scoreboard, and never touches
   the streak or the daily "done" flags. Purely a practice
   playground — close it or finish it any time.
   ============================================================ */
class FreeStudySession {
  constructor(queue) {
    this.kind = 'free';
    this.mode = SESSION_MODE_QUICK;
    this.queue = queue;
    this.index = 0;
    this.stats = { correct: 0, total: 0, newCount: 0 };
    this._answered = null;
    this._revealed = false;
    this._choicesCache = {};
  }
  currentCard() { return this.queue[this.index]; }
  advance() {
    this.index += 1;
    this._answered = null;
    this._revealed = false;
  }
  finish() { /* free study never writes SRS boxes or scoreboard */ }
}

function buildFreeStudySession() {
  const pool = registry.enabledWords();
  if (pool.length === 0) return null;
  const words = pool.length <= 12 ? pool : sample(pool, 12);
  const queue = [];
  for (const word of words) {
    if (registry.isVerb(word) || registry.isAdjective(word)) {
      const forms = registry.formsFor(word).map(f => f.name_en);
      const formName = forms.length ? sample(forms, 1)[0] : 'dictionary';
      queue.push({ step: Math.random() < 0.5 ? 'quiz-recognition' : 'quiz-recall', word, formName, isFree: true });
    } else {
      queue.push({ step: 'quiz-meaning', word, direction: Math.random() < 0.5 ? 'jp2en' : 'en2jp', isFree: true });
    }
  }
  if (queue.length === 0) return null;
  return new FreeStudySession(shuffle(queue));
}

function recordTestAnswer(correct) {
  const s = STATE.session;
  s.stats.total += 1;
  if (correct) s.stats.correct += 1;
}

function recordTestSession() {
  const s = STATE.session;
  const acc = s.stats.total ? Math.round((s.stats.correct / s.stats.total) * 100) : 100;
  STATE.testStats.total += s.stats.total;
  STATE.testStats.correct += s.stats.correct;
  STATE.testStats.sessions += 1;
  STATE.testStats.history.unshift({
    date: todayStr(),
    questions: s.stats.total,
    correct: s.stats.correct,
    accuracy: acc,
    type: s.kind === 'exam' ? 'exam' : 'test',
    level: s.level || null
  });
  STATE.testStats.history = STATE.testStats.history.slice(0, 20);
  localStorage.setItem(LS_TEST, JSON.stringify(STATE.testStats));
}

function resetScoreboard() {
  STATE.testStats = { total: 0, correct: 0, sessions: 0, history: [] };
  localStorage.setItem(LS_TEST, JSON.stringify(STATE.testStats));
}

/* ============================================================
   App singletons — the registry owns data, settings own the
   study scope, the SRS engine owns spaced-repetition state.
   ============================================================ */
const registry = new DataRegistry();
const settings = new Settings();
const srs = new SrsEngine();

/* ---------------- compatibility facades ----------------
   Thin module-level functions so callers (and the integration
   test harness) keep a stable API while the logic lives in
   the classes above. */
function findWord(id) { return registry.findWord(id); }
function gradeCard(word, formName, grade) { return srs.gradeCard(word, formName, grade); }
function gradeMeaning(wordId, grade) { srs.gradeMeaning(wordId, grade); }
function introduceCard(word, formName) { srs.introduceCard(word, formName); }
function getNewCandidates(limit) { return srs.getNewCandidates(limit); }
function getDueItems(limit) { return srs.getDueItems(limit); }
function masteryStats() { return srs.masteryStats(); }
function markSessionDone(kind) { srs.markSessionDone(kind); }
function buildMorningSession() { return new Session('morning'); }
function buildEveningSession() { return new Session('evening'); }
function currentCard() { return STATE.session ? STATE.session.currentCard() : null; }

/* ---------------- storage ---------------- */
function loadStorage() {
  migrateStorage();
  settings.load();
  srs.load();
  try {
    const raw = JSON.parse(localStorage.getItem(LS_TEST));
    STATE.testStats = Object.assign({ total: 0, correct: 0, sessions: 0, history: [] }, raw || {});
    if (!Array.isArray(STATE.testStats.history)) STATE.testStats.history = [];
  } catch (e) {
    STATE.testStats = { total: 0, correct: 0, sessions: 0, history: [] };
  }
  settings.applyTheme();
}

/* ---------------- data loading ---------------- */
/* Reference decks (particles, directions, kosoado, radicals) are not just
   browsable — they are normalized into the word pool so they are drilled in
   daily sessions, tests, and exams like any other vocabulary. Each entry gets
   the standard word schema (id, dictionary, kana, romaji, meaning, type,
   tags); conjugation stays dictionary-only via formsFor(). */
function referenceWord(id, dictionary, kana, romaji, meaning, type, tags, extra) {
  return Object.assign({
    id, dictionary, kana, romaji, meaning, type, tags: tags || [], example: {}
  }, extra || {});
}
function firstExample(ex) {
  if (ex && Array.isArray(ex) && ex[0] && ex[0].jp) return { jp: ex[0].jp, en: ex[0].en || '' };
  return {};
}
function registerReferenceWords() {
  if (registry.sources.particle) return;
  const particles = (registry.references.particles && registry.references.particles.particles) || [];
  registry.registerWordSource('particle', { words: particles.map(p => referenceWord(
    'p_' + p.particle, p.particle, p.particle, '', p.meaning_en, 'particle',
    [String(p.level || '').toLowerCase(), p.category].filter(Boolean),
    { category: p.category, usage_note: p.usage_note, example: firstExample(p.examples) }
  ))});
  const directions = (registry.references.directions && registry.references.directions.words) || [];
  registry.registerWordSource('direction', { words: directions.map(w => referenceWord(
    'dir_' + w.word, w.word, w.kana, w.romaji || '', w.meaning_en, 'direction',
    [w.category].filter(Boolean),
    { category: w.category, usage_note: w.usage_note, example: firstExample(w.examples) }
  ))});
  const demos = (registry.references.demonstratives && registry.references.demonstratives.words) || [];
  registry.registerWordSource('kosoado', { words: demos.map(w => referenceWord(
    'dem_' + w.word, w.word, w.kana, w.romaji || '', w.meaning_en, 'kosoado',
    [w.series, w.category].filter(Boolean),
    { series: w.series, category: w.category, usage_note: w.usage_note, example: firstExample(w.examples) }
  ))});
  const radicals = (registry.references.radicals && registry.references.radicals.words) || [];
  registry.registerWordSource('radical', { words: radicals.map(w => referenceWord(
    w.id, w.radical, w.kana, w.romaji || '', w.meaning_en, 'radical',
    [w.category].filter(Boolean),
    { category: w.category, note: w.note, example: {} }
  ))});
}

async function loadData() {
  const [verbConj, adjConj, verbs, adjectives, adverbs, nouns, particles, directions, demonstratives, radicals] = await Promise.all([
    fetch('data/conjugation_verb.json').then(r => r.json()),
    fetch('data/conjugation_adj.json').then(r => r.json()),
    fetch('data/verbs.json').then(r => r.json()),
    fetch('data/adjectives.json').then(r => r.json()),
    fetch('data/adverbs.json').then(r => r.json()),
    fetch('data/nouns.json').then(r => r.json()),
    fetch('data/particles.json').then(r => r.json()),
    fetch('data/directions.json').then(r => r.json()),
    fetch('data/demonstratives.json').then(r => r.json()),
    fetch('data/radicals.json').then(r => r.json())
  ]);
  registry.registerConjugation('verb', verbConj);
  registry.registerConjugation('adj', adjConj);
  registry.registerWordSource('verb', verbs);
  registry.registerWordSource('adjective', adjectives);
  registry.registerWordSource('adverb', adverbs);
  registry.registerWordSource('noun', nouns);
  registry.registerReference('particles', particles);
  registry.registerReference('directions', directions);
  registry.registerReference('demonstratives', demonstratives);
  registry.registerReference('radicals', radicals);
  registerReferenceWords();
  STATE.verbData = verbConj;
  STATE.adjData = adjConj;
  STATE.particleData = particles;
  STATE.directionsData = directions;
  STATE.demonstrativesData = demonstratives;
  STATE.radicalData = radicals;
  STATE.allWords = registry.allWords;
}

/* ============================================================
   RENDERING
   ============================================================ */
const app = document.getElementById('app');

/* ---------------- rendering shell ---------------- */
const TAB_VIEWS = ['home', 'library', 'test', 'scoreboard', 'settings'];
const TAB_ICONS = { home: '🏠', library: '📖', test: '✏️', scoreboard: '📊', settings: '⚙️' };
const TAB_LABELS = { home: 'Home', library: 'Words', test: 'Test', scoreboard: 'Stats', settings: 'Settings' };

function tabbar() {
  return `<nav class="tabbar">` + TAB_VIEWS.map(v =>
    `<button class="tabbar-btn ${STATE.view === v ? 'active' : ''}" data-action="tab-nav" data-view="${v}" aria-label="${TAB_LABELS[v]}">
      <span class="t-glyph">${TAB_ICONS[v]}</span>
      <span class="t-label">${TAB_LABELS[v]}</span>
    </button>`).join('') + `</nav>`;
}

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
    case 'radicals': html = renderRadicals(); break;
    case 'radicalDetail': html = renderRadicalDetail(); break;
    case 'settings': html = renderSettings(); break;
    case 'session': html = renderSession(); break;
    case 'summary': html = renderSummary(); break;
    case 'test': html = renderTest(); break;
    case 'examSetup': html = renderExamSetup(); break;
    case 'exam': html = renderExam(); break;
    case 'scoreboard': html = renderScoreboard(); break;
    default: html = '<div class="screen"><p>Loading…</p></div>';
  }
  app.innerHTML = html + (TAB_VIEWS.includes(STATE.view) ? tabbar() : '');
  window.scrollTo(0, 0);
}

function topbar(title, backView) {
  return `<div class="topbar">
    ${backView ? `<button class="back" data-action="back" data-back-view="${backView}">‹ Back</button>` : '<span class="spacer"></span>'}
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
  const modeLabel = settings.value.sessionMode === SESSION_MODE_EXTENSIVE ? 'Extensive' : 'Quick';
  const refButtons = [
    ['library', '📕', 'Verbs', 'verb'],
    ['library', '📘', 'Adjectives', 'adjective'],
    ['library', '📗', 'Adverbs', 'adverb'],
    ['rules', '📐', 'Rules'],
    ['particles', '🔤', 'Particles'],
    ['directions', '🧭', 'Directions'],
    ['demonstratives', '👉', 'Kosoado'],
    ['radicals', '🌱', 'Radicals']
  ].map(([view, icon, label, cat]) =>
    `<button class="link-btn ghost" data-action="go" data-view="${view}" ${cat ? `data-cat="${cat}"` : ''}>${icon} ${label}</button>`).join('');
  return `<div class="screen">
    <div class="hero">
      <div class="eyebrow">Qotoba · 言葉</div>
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
        <span class="mode-badge">${modeLabel}</span>
        ${t.morning ? '<span class="check">✓ Done</span>' : '<span class="chev">›</span>'}
      </button>
      <button class="session-card evening ${t.evening ? 'done' : ''}" data-action="start-session" data-kind="evening">
        <span class="icon">🌙</span>
        <span class="body">
          <div class="name">Evening session</div>
          <div class="desc">Recall &amp; produce from memory</div>
        </span>
        <span class="mode-badge">${modeLabel}</span>
        ${t.evening ? '<span class="check">✓ Done</span>' : '<span class="chev">›</span>'}
      </button>
      <button class="session-card free" data-action="start-free-study">
        <span class="icon">🧘</span>
        <span class="body">
          <div class="name">Free study</div>
          <div class="desc">Practice any word, any form — untimed, as much as you like</div>
        </span>
        <span class="chev">›</span>
      </button>
    </div>

    <div class="stat-grid">
      <div class="stat-box"><div class="n">${m.introduced}/${m.total}</div><div class="l">forms in study</div></div>
      <div class="stat-box"><div class="n">${m.mastered}</div><div class="l">mastered</div></div>
    </div>

    <div class="eyebrow" style="margin-top:6px">References</div>
    <div class="link-row">${refButtons}</div>
    <p class="footer-note">All data stays on this device. No account, no server.</p>
  </div>`;
}

function renderLibrary() {
  const tab = STATE.libraryTab;
  const enabled = registry.enabledWords();
  const filtered = enabled.filter(w => {
    if (tab === 'all') return true;
    if (tab === 'verb') return w.type === 'verb';
    if (tab === 'adjective') return w.type === 'i-adjective' || w.type === 'na-adjective';
    return w.type === tab;
  });
  const rows = filtered.map(w => {
    const introducedForms = registry.formsFor(w).filter(f => {
      const s = STATE.srs[srsKey(w.id, f.name_en)];
      return s && s.introduced;
    }).length;
    const totalForms = registry.formsFor(w).length;
    return `<div class="word-row" data-action="go" data-view="wordDetail" data-id="${w.id}">
      <span class="kanji">${escapeHtml(w.dictionary)}</span>
      <span class="info">
        <div class="kana">${escapeHtml(kanaRomaji(w))}</div>
        <div class="meaning">${escapeHtml(w.meaning)}</div>
      </span>
      <span class="mastery">${introducedForms}/${totalForms}</span>
    </div>`;
  }).join('');
  const scopeNote = enabled.length < registry.allWords.length
    ? `<div class="detail-head" style="background:var(--gold-soft);color:var(--ink-deep);margin-top:10px">
        <span class="eyebrow" style="color:#7A5E1A">Filtered by settings</span>
        <p style="margin-top:6px;font-size:13px;line-height:1.6">Showing ${enabled.length} of ${registry.allWords.length} words. Adjust the scope in <button class="inline-link" data-action="go" data-view="settings">Settings</button>.</p>
      </div>` : '';
  return `<div class="screen">
    ${topbar('Word Library', 'home')}
    <div class="tab-row">
      <button class="tab ${tab === 'all' ? 'active' : ''}" data-action="tab" data-tab="all">All</button>
      <button class="tab ${tab === 'verb' ? 'active' : ''}" data-action="tab" data-tab="verb">Verbs</button>
      <button class="tab ${tab === 'adjective' ? 'active' : ''}" data-action="tab" data-tab="adjective">Adjectives</button>
      <button class="tab ${tab === 'i-adjective' ? 'active' : ''}" data-action="tab" data-tab="i-adjective">い-adj</button>
      <button class="tab ${tab === 'na-adjective' ? 'active' : ''}" data-action="tab" data-tab="na-adjective">な-adj</button>
      <button class="tab ${tab === 'adverb' ? 'active' : ''}" data-action="tab" data-tab="adverb">Adverbs</button>
      <button class="tab ${tab === 'noun' ? 'active' : ''}" data-action="tab" data-tab="noun">Nouns</button>
      <button class="tab ${tab === 'particle' ? 'active' : ''}" data-action="tab" data-tab="particle">Particles</button>
      <button class="tab ${tab === 'direction' ? 'active' : ''}" data-action="tab" data-tab="direction">Directions</button>
      <button class="tab ${tab === 'kosoado' ? 'active' : ''}" data-action="tab" data-tab="kosoado">Kosoado</button>
      <button class="tab ${tab === 'radical' ? 'active' : ''}" data-action="tab" data-tab="radical">Radicals</button>
    </div>
    ${scopeNote}
    <div class="word-list">${rows || '<div class="empty-state">No words in this category yet.</div>'}</div>
  </div>`;
}

function renderWordDetail() {
  const word = findWord(STATE.viewParams.id);
  if (!word) return `<div class="screen">${topbar('Not found', 'library')}</div>`;
  const forms = registry.formsFor(word);
  const badgeClass = registry.isVerb(word) ? 'verb' : word.type;
  const badgeLabel = registry.isVerb(word) ? (word.group === 'group1' ? 'Godan' : word.group === 'group2' ? 'Ichidan' : 'Irregular') : ({ 'i-adjective': 'い-adjective', 'na-adjective': 'な-adjective', adverb: 'Adverb', noun: 'Noun', particle: 'Particle', direction: 'Direction', kosoado: 'Kosoado', radical: 'Radical' })[word.type] || word.type;
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
      <div class="kana">${escapeHtml(kanaRomaji(word))}</div>
      <div class="meaning">${escapeHtml(word.meaning)}</div>
      ${(word.example && word.example.jp) ? `
      <div class="example">
        <div class="jp">${escapeHtml(word.example.jp)}</div>
        <div class="en">${escapeHtml(word.example.en)}</div>
      </div>` : ''}
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
  const words = registry.enabledWords().filter(w => isVerbKind ? registry.isVerb(w) : !registry.isVerb(w));
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

/* ---------- radical reference ---------- */
const RADICAL_CATEGORIES = ['all', 'single', 'water', 'person', 'tree', 'plant', 'mouth', 'hand', 'heart', 'sun', 'moon', 'fire', 'earth', 'metal', 'animal', 'body', 'tool', 'building', 'food', 'cloth', 'nature', 'misc'];
const RADICAL_CATEGORY_LABEL = {
  all: 'All', single: 'Single', water: 'Water', person: 'Person', tree: 'Tree', plant: 'Plant',
  mouth: 'Mouth', hand: 'Hand', heart: 'Heart', sun: 'Sun', moon: 'Moon', fire: 'Fire',
  earth: 'Earth', metal: 'Metal', animal: 'Animal', body: 'Body', tool: 'Tool',
  building: 'Building', food: 'Food', cloth: 'Cloth', nature: 'Nature', misc: 'Misc'
};

function renderRadicals() {
  const tab = STATE.radicalTab;
  const list = (STATE.radicalData.words || []).filter(r => tab === 'all' || r.category === tab);
  const tabs = RADICAL_CATEGORIES.map(cat =>
    `<button class="tab ${tab === cat ? 'active' : ''}" data-action="radical-tab" data-tab="${cat}">${RADICAL_CATEGORY_LABEL[cat]}</button>`
  ).join('');
  const tiles = list.map(r => {
    const idx = STATE.radicalData.words.indexOf(r);
    return `<button class="radical-tile" data-action="go" data-view="radicalDetail" data-id="${idx}">
      <span class="radical-glyph">${escapeHtml(r.radical)}</span>
      <span class="radical-name">${escapeHtml(r.kana)}</span>
      <span class="radical-meaning">${escapeHtml(r.meaning_en)}</span>
    </button>`;
  }).join('');
  return `<div class="screen">
    ${topbar('Radicals', 'home')}
    <div class="tab-row" style="flex-wrap:wrap">${tabs}</div>
    <div class="radical-grid">${tiles || '<div class="empty-state">Nothing in this category.</div>'}</div>
  </div>`;
}

function renderRadicalDetail() {
  const r = STATE.radicalData.words[Number(STATE.viewParams.id)];
  if (!r) return `<div class="screen">${topbar('Not found', 'radicals')}</div>`;
  const examples = (r.examples || []).map(k => `<span class="example-kanji">${escapeHtml(k)}</span>`).join('');
  return `<div class="screen">
    ${topbar(RADICAL_CATEGORY_LABEL[r.category], 'radicals')}
    <div class="detail-head">
      <span class="badge naadj">${escapeHtml(RADICAL_CATEGORY_LABEL[r.category])}</span>
      <div class="kanji" style="margin-top:10px;font-size:46px">${escapeHtml(r.radical)}</div>
      <div class="kana">${escapeHtml(r.kana)} · ${escapeHtml(r.romaji)}</div>
      <div class="meaning" style="margin-top:8px">${escapeHtml(r.meaning_en)}</div>
    </div>
    <div class="form-row"><div class="usage" style="font-size:13px;opacity:.8;line-height:1.6">${escapeHtml(r.note || '')}</div></div>
    <div class="eyebrow">Kanji that use it</div>
    <div class="row-strip">${examples}</div>
  </div>`;
}

/* ---------- settings ---------- */
function renderSettings() {
  const levels = ['n5', 'n4', 'n3', 'n2', 'n1'];
  const counts = {};
  for (const w of registry.allWords) {
    const l = registry.levelOf(w);
    if (l) counts[l] = (counts[l] || 0) + 1;
  }
  const levelChips = levels.map(lv => {
    const on = settings.value.levels.includes(lv);
    return `<button class="chip ${on ? 'on' : ''}" data-action="toggle-level" data-level="${lv}">
      <span class="chip-label">${lv.toUpperCase()}</span>
      <span class="chip-count">${counts[lv] || 0}</span>
    </button>`;
  }).join('');

  const topics = registry.availableTopics;
  const topicOptions = topics.map(tp =>
    `<option value="${escapeHtml(tp)}" ${settings.value.topics.includes(tp) ? 'selected' : ''}>${escapeHtml(tp)}</option>`
  ).join('');
  const topicSelect = `<select multiple class="topic-select" size="${Math.min(Math.max(topics.length, 1), 8)}">
    ${topicOptions}
  </select>`;

  const categories = settings.value.categories || CATEGORY_IDS;
  const categoryChips = CATEGORY_IDS.map(cat =>
    `<button class="chip ${categories.includes(cat) ? 'on' : ''}" data-action="toggle-category" data-cat="${cat}">
      <span class="chip-label">${CATEGORY_LABELS[cat]}</span>
    </button>`).join('');

  const enabledCount = registry.enabledWords().length;
  const totalCount = registry.allWords.length;

  const mode = settings.value.sessionMode;
  const theme = settings.value.theme;
  const bg = settings.currentBackground();
  const anchor = settings.value.background || defaultAnchorFor(theme);
  const naturalL = Math.round(rgbToHsl(hexToRgb(anchor).r, hexToRgb(anchor).g, hexToRgb(anchor).b).l * 100);
  const shade = settings.value.shade == null ? naturalL : settings.value.shade;
  const range = themeRange(theme);
  const swatches = bgPresetsFor(theme).map(c =>
    `<button class="swatch ${bg.toLowerCase() === c.toLowerCase() ? 'on' : ''}" data-action="set-background" data-color="${c}" style="background:${c}" title="${c}" aria-label="${c}"></button>`
  ).join('');

  return `<div class="screen">
    ${topbar('Settings', null)}
    <div class="detail-head">
      <div class="kanji" style="font-size:22px">Study scope</div>
      <div class="meaning" style="margin-top:6px">Choose which words appear in the library and in daily sessions. Progress already earned is kept.</div>
    </div>
    <div class="eyebrow">Levels</div>
    <div class="chip-row">${levelChips}</div>
    <div class="eyebrow" style="margin-top:14px">Categories</div>
    <p class="settings-hint">Pick which word types are in scope.</p>
    <div class="chip-row">${categoryChips}</div>
    <div class="eyebrow" style="margin-top:14px">Word topics</div>
    <p class="settings-hint">Select one or more topics (hold Ctrl/Cmd and click). Leave empty to include every topic.</p>
    ${topicSelect}

    <div class="settings-section">
      <div class="eyebrow">Session mode</div>
      <p class="settings-hint">Quick runs each item once. Extensive drills the same words 3–4 times across different tenses — same vocabulary, denser session.</p>
      <div class="chip-row">
        <button class="chip ${mode === SESSION_MODE_QUICK ? 'on' : ''}" data-action="set-session-mode" data-mode="${SESSION_MODE_QUICK}">Quick</button>
        <button class="chip ${mode === SESSION_MODE_EXTENSIVE ? 'on' : ''}" data-action="set-session-mode" data-mode="${SESSION_MODE_EXTENSIVE}">Extensive</button>
      </div>
    </div>

    <div class="settings-section">
      <div class="eyebrow">Appearance</div>
      <p class="settings-hint">Background colors follow the theme — light colors in light theme, dark colors in dark theme. Dark defaults to a soft charcoal, never harsh pure black.</p>
      <div class="chip-row">
        <button class="chip ${theme === THEME_LIGHT ? 'on' : ''}" data-action="set-theme" data-theme="${THEME_LIGHT}">Light</button>
        <button class="chip ${theme === THEME_DARK ? 'on' : ''}" data-action="set-theme" data-theme="${THEME_DARK}">Dark</button>
      </div>
      <p class="settings-hint" style="margin-top:12px">Background</p>
      <div class="swatch-row">${swatches}</div>
      <div class="bg-control">
        <input type="color" id="bg-color" value="${bg}" aria-label="Custom background color">
        <span class="bg-hex" id="bg-hex">${bg}</span>
      </div>
      <div class="shade-control">
        <span class="shade-label">Fine-tune brightness</span>
        <input type="range" id="bg-shade" min="${range.min}" max="${range.max}" value="${shade}" aria-label="Background brightness">
      </div>
      <div class="action-row" style="margin-top:12px">
        <button class="btn ghost" data-action="reset-background">Reset colors</button>
      </div>
    </div>

    <div class="action-row">
      <button class="btn primary" data-action="go" data-view="home">Done</button>
      <button class="btn ghost" data-action="reset-settings">Reset all</button>
    </div>
    <p class="settings-hint" style="margin-top:12px">${enabledCount} of ${totalCount} words are in scope right now.</p>
  </div>`;
}

/* ---------- session screens ---------- */
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
  const card = s.currentCard();
  const kindLabel = s.kind === 'test' ? 'Test' : (s.kind === 'free' ? 'Free study' : s.kind === 'morning' ? 'Morning' : 'Evening');
  const modeLabel = s.kind === 'test' ? 'Self-check' : (s.kind === 'free' ? 'Untimed practice' : s.mode === SESSION_MODE_EXTENSIVE ? 'Extensive' : 'Quick');
  const title = kindLabel + ' · ' + modeLabel;
  let body = '';
  if (card.step === 'teach') body = renderTeachCard(card);
  else if (card.step === 'quiz-recognition') body = renderRecognitionCard(card);
  else if (card.step === 'quiz-recall') body = renderRecallCard(card);
  else if (card.step === 'quiz-meaning') body = renderMeaningCard(card);

  return `<div class="screen">
    ${topbar(title, STATE.sessionOrigin || 'home')}
    <div class="progress-track"><div class="progress-fill" style="width:${sessionProgressPct()}%"></div></div>
    <div class="card-stage">${body}</div>
  </div>`;
}

function wordBadges(word) {
  const cls = registry.isVerb(word) ? 'verb' : word.type;
  const label = registry.isVerb(word) ? 'verb' : (word.type === 'i-adjective' ? 'い-adj' : 'な-adj');
  return `<div class="badges"><span class="badge ${cls}">${label}</span></div>`;
}

// Some words (particles, radicals) have no romaji; render kana alone then.
function kanaRomaji(word) {
  return word.kana + (word.romaji ? ' · ' + word.romaji : '');
}
// Dictionary-only words (particles, directions, kosoado, radicals, adverbs,
// nouns) have a single "dictionary" form — for them the form-name row shows
// the deck + category instead of the meaningless "dictionary form" label.
function isDictionaryOnly(word) { return registry.formsFor(word).length === 1; }
function formAskName(word, formName) {
  if (isDictionaryOnly(word)) {
    const deck = { particle: 'Particle', direction: 'Direction', kosoado: 'Kosoado', radical: 'Radical', adverb: 'Adverb', noun: 'Noun' }[word.type];
    if (deck) return deck + (word.category ? ' · ' + (CATEGORY_LABEL[word.category] || word.category) : '');
  }
  return formName;
}
function formAskUsage(word, formName, formDef) {
  if (isDictionaryOnly(word)) return word.usage_note || word.note || formDef.usage_en;
  return formDef.usage_en;
}

function renderTeachCard(card) {
  const { word, formName } = card;
  const formDef = registry.formDef(word, formName);
  const result = conjugate(word, formName);
  return `<div class="prompt-card">
    ${wordBadges(word)}
    <div class="kanji">${escapeHtml(word.dictionary)}</div>
    <div class="kana">${escapeHtml(kanaRomaji(word))}</div>
    <div class="meaning">${escapeHtml(word.meaning)}</div>
    <div class="ask">
      <div class="form-name">${escapeHtml(formAskName(word, formName))}${isDictionaryOnly(word) ? '' : `<span class="jp">${escapeHtml(formDef.name_jp)}</span>`}</div>
      <div class="usage">${escapeHtml(formAskUsage(word, formName, formDef))}</div>
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
  const formDef = registry.formDef(word, formName);
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
    <div class="kana">${escapeHtml(kanaRomaji(word))}</div>
    <div class="meaning">${escapeHtml(word.meaning)}</div>
    <div class="ask">
      <div class="form-name">${escapeHtml(formAskName(word, formName))}${isDictionaryOnly(word) ? '' : `<span class="jp">${escapeHtml(formDef.name_jp)}</span>`}</div>
      <div class="usage">${escapeHtml(formAskUsage(word, formName, formDef))}</div>
    </div>
  </div>
  <div class="choice-grid">${btns}</div>
  ${feedback}`;
}

function renderRecallCard(card) {
  const { word, formName } = card;
  const formDef = registry.formDef(word, formName);
  const result = conjugate(word, formName);
  const isTest = STATE.session.kind === 'test';
  const answered = STATE.session._answered;
  const revealed = STATE.session._revealed;
  const exJp = (word.example && word.example.jp) ? word.example.jp : '';
  const clozeJp = exJp ? exJp.replace(word.dictionary, revealed || answered ? `<b>${escapeHtml(result)}</b>` : '<span class="blank">&nbsp;</span>') : '';
  const enForForm = exampleForForm(word, formName);

  const inputHtml = (revealed || answered) ? '' : `
    <input type="text" class="recall-input" id="recall-input" placeholder="Type it, or just think it through" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false">
    <div class="action-row" style="margin-top:12px">
      <button class="btn primary" data-action="check">Check</button>
      <button class="btn ghost" data-action="reveal">Show answer</button>
    </div>`;

  let feedbackHtml = '';
  if (revealed && !answered) {
    feedbackHtml = isTest ? `
    <div class="answer-reveal">
      <div class="label">Answer</div>
      <div class="result">${escapeHtml(result)}</div>
      <div class="rule">${escapeHtml(formAskUsage(word, formName, formDef))}</div>
    </div>
    <div class="action-row"><button class="btn primary" data-action="advance">Next →</button></div>` : `
    <div class="answer-reveal">
      <div class="label">Answer</div>
      <div class="result">${escapeHtml(result)}</div>
      <div class="rule">${escapeHtml(formAskUsage(word, formName, formDef))}</div>
    </div>
    <p style="font-size:12.5px;opacity:.6;text-align:center;margin-top:2px">How did that go?</p>
    <div class="action-row">
      <button class="btn again" data-action="grade" data-grade="again">Again</button>
      <button class="btn good" data-action="grade" data-grade="good">Good</button>
      <button class="btn easy" data-action="grade" data-grade="easy">Easy</button>
    </div>`;
  } else if (answered) {
    feedbackHtml = `
    <div class="answer-reveal">
      <div class="label ${answered.correct ? '' : 'wrong'}">${answered.correct ? 'Correct' : 'Not quite'}</div>
      <div class="result">${escapeHtml(result)}</div>
      <div class="rule">${escapeHtml(formAskUsage(word, formName, formDef))}</div>
    </div>
    <div class="action-row"><button class="btn primary" data-action="advance">Next →</button></div>`;
  }

  return `<div class="prompt-card">
    ${wordBadges(word)}
    <div class="kanji">${escapeHtml(word.dictionary)}</div>
    <div class="kana">${escapeHtml(kanaRomaji(word))}</div>
    <div class="meaning">${escapeHtml(word.meaning)}</div>
    <div class="ask">
      <div class="form-name">${escapeHtml(formAskName(word, formName))}${isDictionaryOnly(word) ? '' : `<span class="jp">${escapeHtml(formDef.name_jp)}</span>`}</div>
      <div class="usage">${escapeHtml(formAskUsage(word, formName, formDef))}</div>
    </div>
    ${clozeJp ? `<div class="cloze-line">${clozeJp}</div>` : ''}
    ${(exJp && enForForm) ? `<div class="cloze-en">${escapeHtml(enForForm)}</div>` : ''}
  </div>
  ${inputHtml}
  ${feedbackHtml}`;
}

function renderMeaningCard(card) {
  const { word, direction } = card;
  const revealed = STATE.session._revealed;
  const answered = STATE.session._answered;
  const isTest = STATE.session.kind === 'test';
  const promptIsJp = direction === 'jp2en';

  const inputHtml = (revealed || answered) ? '' : `
    <input type="text" class="recall-input" id="meaning-input" placeholder="${promptIsJp ? 'Type the English meaning' : 'Type the Japanese word'}" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false">
    <div class="action-row" style="margin-top:12px">
      <button class="btn primary" data-action="check-meaning">Check</button>
      <button class="btn ghost" data-action="reveal">Show answer</button>
    </div>`;

  let feedbackHtml = '';
  if (revealed && !answered) {
    feedbackHtml = isTest ? `
      <div class="answer-reveal">
        <div class="label">Answer</div>
        <div class="result">${promptIsJp ? escapeHtml(word.meaning) : escapeHtml(word.dictionary) + ' — ' + escapeHtml(word.kana)}</div>
      </div>
      <div class="action-row"><button class="btn primary" data-action="advance">Next →</button></div>` : `
      <div class="answer-reveal">
        <div class="label">Answer</div>
        <div class="result">${promptIsJp ? escapeHtml(word.meaning) : escapeHtml(word.dictionary) + ' — ' + escapeHtml(word.kana)}</div>
      </div>
      <div class="action-row">
        <button class="btn again" data-action="grade-meaning" data-grade="again">Missed it</button>
        <button class="btn good" data-action="grade-meaning" data-grade="good">Got it</button>
      </div>`;
  } else if (answered) {
    feedbackHtml = `
      <div class="answer-reveal">
        <div class="label ${answered.correct ? '' : 'wrong'}">${answered.correct ? 'Correct' : 'Not quite'}</div>
        <div class="result">${promptIsJp ? escapeHtml(word.meaning) : escapeHtml(word.dictionary) + ' — ' + escapeHtml(word.kana)}</div>
      </div>
      <div class="action-row"><button class="btn primary" data-action="advance">Next →</button></div>`;
  }

  return `<div class="prompt-card">
    ${wordBadges(word)}
    <div class="ask" style="border:none;margin-top:0;padding-top:0">
      <div class="form-name">${promptIsJp ? 'What does this mean?' : 'How do you say this in Japanese?'}</div>
    </div>
    <div class="kanji" style="margin-top:14px">${promptIsJp ? escapeHtml(word.dictionary) : escapeHtml(word.meaning)}</div>
    ${promptIsJp ? `<div class="kana">${escapeHtml(word.kana)}</div>` : ''}
  </div>
  ${inputHtml}
  ${feedbackHtml}`;
}

function renderSummary() {
  const s = STATE.session;
  const acc = s.stats.total ? Math.round((s.stats.correct / s.stats.total) * 100) : 100;
  if (s.kind === 'free') {
    return `<div class="screen">
    <div class="summary-hero">
      <div class="big">${acc}%</div>
      <div class="cap">Free study complete — ${s.stats.correct}/${s.stats.total} correct</div>
    </div>
    <div class="summary-grid">
      <div class="box"><div class="n">${s.stats.total}</div><div class="l">asked</div></div>
      <div class="box"><div class="n">${s.stats.correct}</div><div class="l">correct</div></div>
      <div class="box"><div class="n">${s.stats.total - s.stats.correct}</div><div class="l">missed</div></div>
    </div>
    <p class="settings-hint" style="text-align:center">Nothing here was added to your schedule, SRS boxes, or scoreboard — practice stays practice.</p>
    <div class="action-row"><button class="btn primary" data-action="go" data-view="home">Home</button></div>
  </div>`;
  }
  if (s.kind === 'test' || s.kind === 'exam') {
    const cap = s.kind === 'exam'
      ? `Exam complete${s.level ? ' · JLPT ' + s.level.toUpperCase() : ''} — ${s.stats.correct}/${s.stats.total} correct`
      : `Test complete — ${s.stats.correct}/${s.stats.total} correct`;
    return `<div class="screen">
    <div class="summary-hero">
      <div class="big">${acc}%</div>
      <div class="cap">${cap}</div>
    </div>
    <div class="summary-grid">
      <div class="box"><div class="n">${s.stats.total}</div><div class="l">asked</div></div>
      <div class="box"><div class="n">${s.stats.correct}</div><div class="l">correct</div></div>
      <div class="box"><div class="n">${s.stats.total - s.stats.correct}</div><div class="l">missed</div></div>
    </div>
    <div class="action-row">
      <button class="btn primary" data-action="go" data-view="scoreboard">View scoreboard</button>
      <button class="btn ghost" data-action="go" data-view="home">Home</button>
    </div>
  </div>`;
  }
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

/* ---------- test & scoreboard ---------- */
function renderTest() {
  if (STATE.session && STATE.session.kind === 'test') return renderSession();
  const seen = countSeenItems();
  return `<div class="screen">
    ${topbar('Test', null)}
    <div class="hero">
      <div class="eyebrow">自己評価 · Self check</div>
      <h1 class="greeting">Test yourself</h1>
      <p class="sub">Random questions drawn only from forms you have already studied — no new material, and it never touches your streak or schedule.</p>
    </div>
    <div class="detail-head">
      <div class="kanji" style="font-size:22px">${seen} item${seen === 1 ? '' : 's'} in your pool</div>
      <div class="meaning" style="margin-top:6px">Each test asks ${TEST_QUESTIONS} questions (recall, recognition &amp; meaning) pulled from your previously seen cards.</div>
    </div>
    <div class="action-row">
      <button class="btn primary" data-action="start-test" ${seen === 0 ? 'disabled' : ''}>Start test →</button>
      <button class="btn ghost" data-action="go" data-view="scoreboard">📊 Scoreboard</button>
    </div>
    <p class="settings-hint">Daily sessions grow the pool this test draws from.</p>

    <div class="settings-section">
      <div class="eyebrow">Exam</div>
      <p class="settings-hint">A timed, unskippable JLPT-style exam on the conjugation and vocabulary this app covers. Pick a level, then run it to the end — no going back once started.</p>
      <button class="btn primary" data-action="go" data-view="examSetup">📝 Start an exam →</button>
    </div>
  </div>`;
}

/* ---------- exam ---------- */
function renderExamSetup() {
  const levels = registry.availableLevels;
  const counts = {};
  for (const w of registry.enabledWords()) {
    const l = registry.levelOf(w);
    if (l) counts[l] = (counts[l] || 0) + 1;
  }
  let selected = STATE.examLevel;
  if (!levels.includes(selected)) selected = levels[0] || null;
  STATE.examLevel = selected;
  const levelChips = levels.map(lv =>
    `<button class="chip ${lv === selected ? 'on' : ''}" data-action="exam-level" data-level="${lv}">
      <span class="chip-label">${lv.toUpperCase()}</span>
      <span class="chip-count">${counts[lv] || 0}</span>
    </button>`).join('');
  const totalSec = EXAM_QUESTIONS * EXAM_SECONDS_PER_QUESTION;
  const dur = totalSec < 60 ? 'under a minute' : `~${Math.ceil(totalSec / 60)} minutes`;
  return `<div class="screen">
    ${topbar('Exam', 'test')}
    <div class="hero">
      <div class="eyebrow">JLPT-style check</div>
      <h1 class="greeting">Exam</h1>
      <p class="sub">A timed, unskippable test on the conjugation and vocabulary this app covers.</p>
    </div>
    <div class="detail-head" style="background:var(--gold-soft);color:var(--ink-deep)">
      <span class="eyebrow" style="color:#C0392B">⚠️ Read this first</span>
      <p style="margin-top:6px;font-size:13px;line-height:1.6">Once you start, you <b>cannot go back or leave</b> until the exam finishes. Estimated duration: <b>${dur}</b>. No skips, no hints — every question must be answered.</p>
    </div>
    <div class="eyebrow" style="margin-top:14px">JLPT level</div>
    <p class="settings-hint">Questions are drawn only from words tagged at this level, within your study scope.</p>
    <div class="chip-row">${levelChips || '<div class="empty-state">No levels available.</div>'}</div>
    <div class="action-row">
      <button class="btn primary" data-action="start-exam" data-level="${escapeHtml(selected || '')}" ${!selected || !counts[selected] ? 'disabled' : ''}>Start exam →</button>
      <button class="btn ghost" data-action="back" data-back-view="test">Not now</button>
    </div>
    <p class="settings-hint">Results are added to the scoreboard alongside your tests.</p>
  </div>`;
}

function renderExam() {
  const s = STATE.session;
  if (!s) return '<div class="screen"><div class="empty-state">No active exam.</div></div>';
  if (s.index >= s.queue.length) {
    finishSession();
    return renderSummary();
  }
  const card = s.currentCard();
  const cache = s._choicesCache = s._choicesCache || {};
  if (!cache[s.index]) {
    cache[s.index] = card.step === 'quiz-recognition'
      ? buildChoices(card.word, card.formName)
      : buildMeaningChoices(card.word);
  }
  const opts = cache[s.index];
  const answered = s._answered;
  const btns = opts.map(opt => {
    let cls = 'choice-btn';
    if (answered) {
      if (opt === card.correct) cls += ' correct';
      else if (opt === answered.picked && opt !== card.correct) cls += ' incorrect';
    }
    return `<button class="${cls}" ${answered ? 'disabled' : ''} data-action="choice" data-value="${escapeHtml(opt)}">${escapeHtml(opt)}</button>`;
  }).join('');
  const feedback = answered ? `<div class="action-row"><button class="btn primary" data-action="advance">Next →</button></div>` : '';

  let prompt = '';
  if (card.step === 'quiz-recognition') {
    const formDef = registry.formDef(card.word, card.formName);
    prompt = `${wordBadges(card.word)}
      <div class="kanji">${escapeHtml(card.word.dictionary)}</div>
      <div class="kana">${escapeHtml(kanaRomaji(card.word))}</div>
      <div class="ask">
        <div class="form-name">${escapeHtml(card.formName)}<span class="jp">${escapeHtml(formDef.name_jp)}</span></div>
        <div class="usage">${escapeHtml(formDef.usage_en)}</div>
      </div>`;
  } else {
    prompt = `${wordBadges(card.word)}
      <div class="kanji">${escapeHtml(card.word.dictionary)}</div>
      <div class="kana">${escapeHtml(card.word.kana)}</div>
      <div class="ask" style="border:none;margin-top:0;padding-top:0">
        <div class="form-name">What does this mean?</div>
      </div>`;
  }

  return `<div class="screen">
    ${topbar('Exam · JLPT ' + (s.level || '').toUpperCase(), null)}
    <div class="progress-track"><div class="progress-fill" style="width:${Math.round((s.index / s.queue.length) * 100)}%"></div></div>
    <div class="card-stage"><div class="prompt-card">${prompt}</div>
    <div class="choice-grid">${btns}</div>
    ${feedback}
    </div>
  </div>`;
}

function renderScoreboard() {
  const ts = STATE.testStats;
  const total = ts.total;
  const correct = ts.correct;
  const missed = total - correct;
  const acc = total ? Math.round((correct / total) * 100) : 0;
  const practiceAcc = STATE.progress.totalReviews ? Math.round((STATE.progress.totalCorrect / STATE.progress.totalReviews) * 100) : 0;
  const historyRows = ts.history.length ? ts.history.map(h => {
    const pct = h.questions ? Math.round((h.correct / h.questions) * 100) : 0;
    const tag = h.type === 'exam' ? `<span class="s-tag">exam${h.level ? ' · ' + h.level.toUpperCase() : ''}</span>` : '';
    return `<div class="score-row">
      <span class="s-date">${escapeHtml(h.date)}</span>
      <span class="s-bar"><span class="s-fill" style="width:${pct}%"></span></span>
      <span class="s-num">${h.correct}/${h.questions} · ${pct}%${tag}</span>
    </div>`;
  }).join('') : '<div class="empty-state">No tests yet. Take one from the Test tab to start tracking.</div>';
  return `<div class="screen">
    ${topbar('Scoreboard', null)}
    <div class="summary-grid">
      <div class="box"><div class="n">${total}</div><div class="l">questions</div></div>
      <div class="box"><div class="n">${correct}</div><div class="l">correct</div></div>
      <div class="box"><div class="n">${missed}</div><div class="l">missed</div></div>
    </div>
    <div class="stat-grid">
      <div class="stat-box"><div class="n">${acc}%</div><div class="l">test accuracy</div></div>
      <div class="stat-box"><div class="n">${practiceAcc}%</div><div class="l">practice accuracy</div></div>
      <div class="stat-box"><div class="n">${ts.sessions}</div><div class="l">tests taken</div></div>
      <div class="stat-box"><div class="n">${STATE.progress.streak}</div><div class="l">day streak</div></div>
    </div>
    <div class="eyebrow" style="margin-top:6px">Recent tests</div>
    ${historyRows}
    <div class="action-row">
      <button class="btn primary" data-action="go" data-view="test">Take a test</button>
      <button class="btn ghost" data-action="reset-scoreboard">Reset scoreboard</button>
    </div>
  </div>`;
}

/* ============================================================
   SESSION INTERACTION HANDLERS
   ============================================================ */
function finishSession() {
  const s = STATE.session;
  if (!s || s._finished) return;
  s._finished = true;
  if (s.kind === 'test' || s.kind === 'exam') recordTestSession();
  else if (s.kind !== 'free') s.finish();
}

function handleChoice(picked) {
  const card = STATE.session.currentCard();
  const correct = conjugate(card.word, card.formName);
  const isCorrect = picked === correct;
  if (STATE.session.kind === 'free') {
    recordTestAnswer(isCorrect);
  } else if (STATE.session.kind !== 'test') {
    const key = srsKey(card.word.id, card.formName);
    if (!STATE.srs[key]) srs.introduceCard(card.word, card.formName);
    srs.gradeCard(card.word, card.formName, isCorrect ? 'good' : 'again');
    STATE.session.stats.total += 1;
    if (isCorrect) STATE.session.stats.correct += 1;
  } else {
    recordTestAnswer(isCorrect);
  }
  STATE.session._answered = { picked, correct: isCorrect };
  render();
}

function handleCheck() {
  if (STATE.session._answered || STATE.session._revealed) return;
  const card = STATE.session.currentCard();
  const input = document.getElementById('recall-input');
  const typed = input ? input.value : '';
  const isCorrect = answerAccepted(card.word, card.formName, typed);
  if (STATE.session.kind === 'free') {
    recordTestAnswer(isCorrect);
  } else if (STATE.session.kind !== 'test') {
    const key = srsKey(card.word.id, card.formName);
    if (!STATE.srs[key]) srs.introduceCard(card.word, card.formName);
    srs.gradeCard(card.word, card.formName, isCorrect ? 'good' : 'again');
    STATE.session.stats.total += 1;
    if (isCorrect) STATE.session.stats.correct += 1;
  } else {
    recordTestAnswer(isCorrect);
  }
  STATE.session._answered = { typed, correct: isCorrect };
  render();
}

function handleMeaningCheck() {
  if (STATE.session._answered || STATE.session._revealed) return;
  const card = STATE.session.currentCard();
  const input = document.getElementById('meaning-input');
  const typed = input ? input.value : '';
  const isCorrect = meaningAccepted(card.word, card.direction, typed);
  if (STATE.session.kind === 'test' || STATE.session.kind === 'exam' || STATE.session.kind === 'free') {
    recordTestAnswer(isCorrect);
  } else {
    srs.gradeMeaning(card.word.id, isCorrect ? 'good' : 'again');
    STATE.session.stats.total += 1;
    if (isCorrect) STATE.session.stats.correct += 1;
  }
  STATE.session._answered = { typed, correct: isCorrect };
  render();
}

function handleExamChoice(picked) {
  const card = STATE.session.currentCard();
  const isCorrect = picked === card.correct;
  recordTestAnswer(isCorrect);
  STATE.session._answered = { picked, correct: isCorrect };
  render();
}

function advanceQueue() {
  STATE.session.advance();
  render();
}

function handleReveal() {
  if (STATE.session._answered) return;
  if (STATE.session.kind === 'test') {
    // In a test, revealing the answer counts as a miss for that question.
    if (!STATE.session._revealed) recordTestAnswer(false);
    STATE.session._revealed = true;
  } else {
    STATE.session._revealed = true;
  }
  render();
}

function handleGrade(grade) {
  const card = STATE.session.currentCard();
  if (STATE.session.kind === 'free') {
    STATE.session.stats.total += 1;
    if (grade !== 'again') STATE.session.stats.correct += 1;
    advanceQueue();
    return;
  }
  const key = srsKey(card.word.id, card.formName);
  if (!STATE.srs[key]) srs.introduceCard(card.word, card.formName);
  const correct = srs.gradeCard(card.word, card.formName, grade);
  STATE.session.stats.total += 1;
  if (correct) STATE.session.stats.correct += 1;
  advanceQueue();
}

function handleGradeMeaning(grade) {
  const card = STATE.session.currentCard();
  if (STATE.session.kind === 'test' || STATE.session.kind === 'free') {
    recordTestAnswer(grade !== 'again');
    advanceQueue();
    return;
  }
  srs.gradeMeaning(card.word.id, grade);
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

function handleBack(backView) {
  // Back during a session/test/exam just closes it and returns to the page
  // it was started from (which may not be home).
  if (STATE.session && !STATE.session._finished) STATE.session = null;
  goView(backView);
}

function startSession(kind) {
  STATE.session = new Session(kind, settings.value.sessionMode);
  if (STATE.session.queue.length === 0) {
    const first = registry.enabledWords()[0];
    if (first) STATE.session.queue.push({ step: 'teach', word: first, formName: 'dictionary' });
  }
  STATE.sessionOrigin = STATE.view;
  goView('session');
}

function startTest() {
  const session = buildTestSession();
  if (!session || session.queue.length === 0) return;
  STATE.session = session;
  STATE.sessionOrigin = STATE.view;
  goView('test');
}

function startFreeStudy() {
  const session = buildFreeStudySession();
  if (!session || session.queue.length === 0) return;
  STATE.session = session;
  STATE.sessionOrigin = STATE.view;
  goView('session');
}

function startExam(level) {
  const session = buildExamSession(level || STATE.examLevel);
  if (!session || session.queue.length === 0) return;
  STATE.session = session;
  STATE.sessionOrigin = 'test';
  goView('exam');
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
    if (el.dataset.cat) STATE.libraryTab = el.dataset.cat;
    goView(view, params);
  } else if (action === 'back') {
    handleBack(el.dataset.backView);
  } else if (action === 'tab-nav') {
    goView(el.dataset.view);
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
  } else if (action === 'radical-tab') {
    STATE.radicalTab = el.dataset.tab;
    render();
  } else if (action === 'toggle-level') {
    settings.toggleLevel(el.dataset.level);
    render();
  } else if (action === 'toggle-category') {
    settings.toggleCategory(el.dataset.cat);
    render();
  } else if (action === 'reset-settings') {
    settings.reset();
    render();
  } else if (action === 'set-session-mode') {
    settings.setSessionMode(el.dataset.mode);
    render();
  } else if (action === 'set-theme') {
    settings.setTheme(el.dataset.theme);
    render();
  } else if (action === 'set-background') {
    settings.setBackground(el.dataset.color);
    render();
  } else if (action === 'reset-background') {
    settings.resetBackground();
    render();
  } else if (action === 'start-session') {
    startSession(el.dataset.kind);
  } else if (action === 'start-test') {
    startTest();
  } else if (action === 'start-free-study') {
    startFreeStudy();
  } else if (action === 'exam-level') {
    STATE.examLevel = el.dataset.level;
    render();
  } else if (action === 'start-exam') {
    startExam(el.dataset.level);
  } else if (action === 'reset-scoreboard') {
    resetScoreboard();
    render();
  } else if (action === 'choice') {
    if (STATE.session._answered) return;
    if (STATE.session.kind === 'exam') handleExamChoice(el.dataset.value);
    else handleChoice(el.dataset.value);
  } else if (action === 'check') {
    handleCheck();
  } else if (action === 'check-meaning') {
    handleMeaningCheck();
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

document.addEventListener('input', (e) => {
  const t = e.target;
  if (!t || !t.id) return;
  if (t.id === 'bg-color') {
    settings.setBackground(t.value);
    const hexEl = document.getElementById('bg-hex');
    if (hexEl) hexEl.textContent = settings.currentBackground();
  } else if (t.id === 'bg-shade') {
    settings.setShade(t.value);
    const hexEl = document.getElementById('bg-hex');
    if (hexEl) hexEl.textContent = settings.currentBackground();
  }
});

document.addEventListener('change', (e) => {
  if (!e.target) return;
  if (e.target.classList && e.target.classList.contains('topic-select')) {
    settings.value.topics = [...e.target.selectedOptions].map(o => o.value);
    settings.save();
    render();
  } else if (e.target.id === 'bg-color') {
    settings.setBackground(e.target.value);
    render();
  } else if (e.target.id === 'bg-shade') {
    settings.setShade(e.target.value);
    render();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  if (STATE.view !== 'session' && STATE.view !== 'test' && STATE.view !== 'exam') return;
  if (!STATE.session) return;
  const active = document.activeElement;
  if (active && active.id === 'recall-input') {
    e.preventDefault();
    handleCheck();
  } else if (active && active.id === 'meaning-input') {
    e.preventDefault();
    handleMeaningCheck();
  } else {
    const advance = document.querySelector('[data-action="advance"]');
    if (advance) { e.preventDefault(); advanceQueue(); }
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

// Service-worker registration lives in index.html (runs before this bundle,
// uses updateViaCache:'none' and reloads once on controllerchange so a push
// to GitHub instantly reaches web and home-screen users).

boot();
