# Bible Quiz Scripture Study Tool

A local-first web app for memorizing Acts 1-9 in the King James Version, one chapter at a time.

## Features

- Bundled public-domain KJV text for Acts 1-9, validated against the KJV version available on Bible Gateway
- Chapter-by-chapter study controls
- Learn, reference recall, verse-to-reference, and chapter review modes
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

Bible Gateway lists the King James Version as public domain in the United States and notes that its KJV text matches the 1987 printing. The app bundles Acts 1-9 locally for offline study, links each active verse back to its Bible Gateway KJV passage page, and includes `npm run validate:scripture` to compare every bundled verse against live Bible Gateway KJV passage pages.
