# Qotoba — 言葉

A small, offline-first PWA for daily Japanese verb and adjective conjugation practice. Vanilla JS, no build step, no framework, no server — all data lives in this folder and all progress stays on your device.

## Run it

Any static file server works:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

Deploys as a static site on GitHub Pages; the service worker makes the whole app work offline.

## What's inside

- **Daily SRS sessions** — a morning session (teach + recognition of new forms) and an evening session (recall by typing, plus bidirectional meaning cards). Cards move through 6 spaced-repetition boxes.
- **Two session modes** — Quick (each word in one form) or **Extensive** (each word drilled in up to 4 different forms). Pick one in Settings.
- **Test tab** — a 10-question self-check drawn *only* from words you've already studied (recall, recognition, and meaning). It never touches your SRS boxes, streak, or daily flags.
- **Scoreboard** — cumulative accuracy, sessions, and recent history (last 20 tests), resettable from the tab.
- **Word library** — 660 verbs, 216 adjectives, 614 adverbs, and 492 nouns with the full conjugation table for every word.
- **Rules reference** — every verb tense and adjective form, applied live to the whole word list.
- **Particles, Directions, Kosoado, Radicals** — browseable reference decks.
- **Settings** — pick which JLPT levels and which topics are in your study scope; the library and daily sessions respect the filter, existing progress is kept.
- **Appearance** — light/dark theme, plus a custom background color and shade slider; the whole palette (ink, cards, dividers) is derived from your choice.

## Files

- `app.js` — the whole app. Organized around a small set of classes: `DataRegistry` (owns every data file), `Settings` (study scope + session mode + appearance), `SrsEngine` (spaced repetition + progress), `Session` / `TestSession` (a single study run).
- `index.html`, `style.css` — shell and styling.
- `sw.js`, `manifest.json` — service worker and PWA manifest. `sw.js` carries a `BUILD_ID` stamp; versioned asset URLs (`?v=N`) bust the cache on deploy.
- `scripts/bump-version.sh` — bumps `BUILD_ID` and every `?v=` cache-buster in `index.html`/`manifest.json` before you commit a new deploy.
- `data/` — `verbs.json`, `adjectives.json`, `adverbs.json`, `nouns.json`, `conjugation_verb.json`, `conjugation_adj.json`, `particles.json`, `directions.json`, `demonstratives.json`, `radicals.json`.

## Data conventions

- Words carry `tags`: a JLPT level tag (`n5`…`n1`) plus topic tags (`daily`, `food`, …). The settings screen filters on these.
- Verbs have a `group` (`group1` godan / `group2` ichidan / `group3` irregular), `kana`, `romaji`, and optional `irregular_overrides` and per-form example translations under `example.form_en`.
- Conjugation is generated at runtime from `conjugation_verb.json` / `conjugation_adj.json`; exceptions are listed in their `meta.known_exceptions`.

## Storage

Progress is stored locally under `qotoba_*` keys (`qotoba_srs_v1`, `qotoba_meaning_srs_v1`, `qotoba_progress_v1`, `qotoba_settings_v1`, `qotoba_test_v1`). On first run after the rename, any legacy `katsuyo_*` data is migrated automatically, so streaks and studied words are never lost.

## License

MIT Non-Commercial — see `LICENSE`. Free for personal, educational, and non-profit use; no profit or resale without prior written permission.

## Tests

Logic tests live outside the repo (run with Deno): `deno run --allow-read --allow-write /tmp/opencode/test.js`, `test_oop.js`, and `test_features.js` via the harness at `/tmp/opencode/harness.js`, which stubs the DOM and localStorage and runs `app.js` unmodified.
