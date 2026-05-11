# Bible Quiz Scripture Study Tool

A local-first web app for memorizing Acts 1-9 in the King James Version, one chapter at a time.

## Features

- Bundled public-domain KJV text for Acts 1-9
- Chapter-by-chapter study controls
- Learn, reference recall, verse-to-reference, and chapter review modes
- Quiz Prep mode with 20-question rounds, 5-second buzz window, 30-second answer window, and rulebook-style scoring
- Browser-local progress with confidence, attempts, streaks, and review history
- Dashboard showing weak, learning, and mastered verse counts

## Development

```bash
npm install
npm run dev
```

## Publishing

This app is configured for GitHub Pages as the `bible-quiz-trainer` project site.
Pushing to `main` runs the deploy workflow and publishes the built `dist` output.

## Validation

```bash
npm run lint
npm run build
npm run validate:scripture
```

The app bundles Acts 1-9 locally for offline study. The King James Version text is public domain in the United States.
