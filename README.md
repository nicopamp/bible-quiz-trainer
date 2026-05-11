# Bible Quiz Scripture Study Tool

A local-first web app for memorizing Acts 1-9 in the King James Version, one chapter at a time.

## Features

- Bundled public-domain KJV text for Acts 1-9
- Chapter-by-chapter study controls
- Learn, reference recall, verse-to-reference, and chapter review modes
- Quiz Prep mode with 20-question rounds, 5-second buzz window, 30-second answer window, and rulebook-style scoring
- Browser-local progress with optional Supabase account sync across devices
- Confidence, attempts, streaks, selected study state, and review history persistence
- Dashboard showing weak, learning, and mastered verse counts

## Development

```bash
npm install
npm run dev
```

## Publishing

This app is configured for GitHub Pages as the `bible-quiz-trainer` project site.
Pushing to `main` runs the deploy workflow and publishes the built `dist` output.

## Supabase Sync

The app works locally without any backend. To enable user accounts and multi-device progress sync:

1. Create a Supabase project.
2. Run `supabase/schema.sql` in the Supabase SQL editor.
3. Copy `.env.example` to `.env.local` and fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
4. For GitHub Pages, add the same values as repository secrets or variables and expose them during the build.

Only progress and study state are stored per user. The scripture text remains bundled in the app.

## Validation

```bash
npm run lint
npm run build
npm run validate:scripture
```

The app bundles Acts 1-9 locally for offline study. The King James Version text is public domain in the United States.
