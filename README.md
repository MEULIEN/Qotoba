# JapApp — Katsuyō 活用

A small, offline-first PWA for daily Japanese verb and adjective conjugation practice. Vanilla JS, no build step, no framework, no server — all data lives in this folder and all progress stays on your device.

## Run it

Any static file server works:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

## What's inside

- **Daily SRS sessions** — a morning session (teach + recognition of new forms) and an evening session (recall by typing, plus bidirectional meaning cards). Cards move through 6 spaced-repetition boxes.
- **Word library** — 422 verbs (N5–N3) and 8 adjectives (N5), with the full conjugation table for every word.
- **Rules reference** — every verb tense and adjective form, applied live to the whole word list.
- **Particles, Directions, Kosoado, Radicals** — browseable reference decks (radicals added in the settings/radicals update).
- **Settings** — pick which JLPT levels and which topics are in your study scope; the library and daily sessions respect the filter, existing progress is kept.

## Files

- `app.js` — the whole app. Organized around a small set of classes: `DataRegistry` (owns every data file), `Settings` (study scope), `SrsEngine` (spaced repetition + progress), `Session` (a single study run).
- `index.html`, `style.css` — shell and styling.
- `sw.js`, `manifest.json` — offline cache (bump `CACHE_NAME` when data changes) and PWA manifest.
- `data/` — `verbs.json`, `adjectives.json`, `conjugation_verb.json`, `conjugation_adj.json`, `particles.json`, `directions.json`, `demonstratives.json`, `radicals.json`.

## Data conventions

- Words carry `tags`: a JLPT level tag (`n5`…`n1`) plus topic tags (`daily`, `food`, …). The settings screen filters on these.
- Verbs have a `group` (`group1` godan / `group2` ichidan / `group3` irregular), `kana`, `romaji`, and optional `irregular_overrides` and per-form example translations under `example.form_en`.
- Conjugation is generated at runtime from `conjugation_verb.json` / `conjugation_adj.json`; exceptions are listed in their `meta.known_exceptions`.

## Tests

Logic tests live outside the repo (run with Deno): `deno run --allow-read --allow-write /tmp/opencode/test.js` and `test_oop.js` via the harness at `/tmp/opencode/harness.js`, which stubs the DOM and localStorage and runs `app.js` unmodified.
