import fs from 'node:fs/promises'
import path from 'node:path'

const expectedCounts = { 1: 26, 2: 47, 3: 26, 4: 37, 5: 42, 6: 15, 7: 60, 8: 40, 9: 43 }
const cacheDir = '/private/tmp/bible-quiz-bg-cache'

function decodeHtml(input) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (_, entity) => {
    if (entity[0] === '#') {
      const isHex = entity[1]?.toLowerCase() === 'x'
      const code = Number.parseInt(entity.slice(isHex ? 2 : 1), isHex ? 16 : 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : `&${entity};`
    }
    return named[entity] ?? `&${entity};`
  })
}

function normalizeText(value) {
  return value
    .replace(/\u00a0/g, ' ')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
}

function stripVerseMarkup(html) {
  return normalizeText(
    decodeHtml(
      html
        .replace(/<sup[^>]*class="versenum"[^>]*>[\s\S]*?<\/sup>/g, '')
        .replace(/<span[^>]*class="chapternum"[^>]*>[\s\S]*?<\/span>/g, '')
        .replace(/<[^>]+>/g, ''),
    ),
  )
}

function passageRegion(html) {
  const start = html.indexOf("<div class='passage-content passage-class-0'>")
  const end = html.indexOf('<div class="publisher-info-bottom">', start)
  if (start < 0 || end < 0) {
    throw new Error('Could not isolate Bible Gateway passage region')
  }
  return html.slice(start, end)
}

async function getBibleGatewayHtml(chapter) {
  await fs.mkdir(cacheDir, { recursive: true })
  const cachePath = path.join(cacheDir, `acts-${chapter}.html`)
  const url = `https://www.biblegateway.com/passage/?search=Acts%20${chapter}&version=KJV`
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Bible Quiz Trainer scripture validation',
    },
  })
  if (!response.ok) {
    throw new Error(`Bible Gateway fetch failed for Acts ${chapter}: ${response.status}`)
  }
  const html = await response.text()
  await fs.writeFile(cachePath, html)
  return html
}

function extractBibleGatewayChapter(html, chapter) {
  const rows = []
  const passage = passageRegion(html)
  const paragraphRegex = /<p[^>]*>([\s\S]*?)<\/p>/g
  let paragraph
  while ((paragraph = paragraphRegex.exec(passage))) {
    const block = paragraph[1]
    const match = block.match(new RegExp(`class="text Acts-${chapter}-(\\d+)"`))
    if (!match) continue
    const verse = Number(match[1])
    rows.push({
      id: `acts-${chapter}-${verse}`,
      reference: `Acts ${chapter}:${verse}`,
      text: stripVerseMarkup(block),
    })
  }
  return rows
}

function extractBundled(source) {
  const json = source.match(
    /export const actsKjv: ScriptureVerse\[\] = ([\s\S]*?)\n\nexport const chapterVerseCounts/,
  )?.[1]
  if (!json) throw new Error('Could not find actsKjv export in src/data/actsKjv.ts')
  return JSON.parse(json).map((row) => ({
    id: row.id,
    reference: row.reference,
    text: normalizeText(row.text),
  }))
}

const gatewayRows = []
for (let chapter = 1; chapter <= 9; chapter += 1) {
  const html = await getBibleGatewayHtml(chapter)
  gatewayRows.push(...extractBibleGatewayChapter(html, chapter))
}

const bundledRows = extractBundled(await fs.readFile('src/data/actsKjv.ts', 'utf8'))
const errors = []

for (const [chapter, expected] of Object.entries(expectedCounts)) {
  const count = gatewayRows.filter((row) => row.id.startsWith(`acts-${chapter}-`)).length
  if (count !== expected) {
    errors.push(`Bible Gateway Acts ${chapter}: expected ${expected}, extracted ${count}`)
  }
}

if (gatewayRows.length !== bundledRows.length) {
  errors.push(`Total verse count mismatch: Bible Gateway ${gatewayRows.length}, bundled ${bundledRows.length}`)
}

const gatewayById = new Map(gatewayRows.map((row) => [row.id, row]))
for (const row of bundledRows) {
  const source = gatewayById.get(row.id)
  if (!source) {
    errors.push(`Missing Bible Gateway verse ${row.id}`)
    continue
  }
  if (source.reference !== row.reference) {
    errors.push(`${row.id} reference mismatch: ${source.reference} !== ${row.reference}`)
  }
  if (source.text !== row.text) {
    errors.push(`${row.reference}\n  Bible Gateway: ${source.text}\n  Bundled:       ${row.text}`)
  }
}

if (errors.length > 0) {
  console.error(`FAILED with ${errors.length} mismatch(es):`)
  console.error(errors.join('\n'))
  process.exit(1)
}

console.log(
  `PASS: ${bundledRows.length} bundled Acts 1-9 KJV verses exactly match Bible Gateway after stripping verse-number markup and HTML entities.`,
)
for (const [chapter, count] of Object.entries(expectedCounts)) {
  console.log(`Acts ${chapter}: ${count} verses verified`)
}
