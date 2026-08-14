// Runs the extractor against the screenshot fixtures and reports accuracy.
// Node has no canvas, so this drives a headless Chromium and evaluates the
// real module inside the page -- the same environment the app uses.
//
//   node test/extract.test.mjs

import { chromium } from 'playwright-core'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const FIXTURES = join(HERE, 'fixtures')

const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' }

// Compact spelling of an expected board: "WORD:marks" with one mark letter per
// column -- g)rey, y)ellow, G)reen.
const MARKS = { g: 'grey', y: 'yellow', G: 'green' }
const board = (...rows) =>
  rows.map((row) => {
    const [word, marks] = row.split(':')
    return [...word].map((letter, i) => ({ letter, mark: MARKS[marks[i]] }))
  })

// What each fixture should decode to.
const EXPECTED = {
  'wordle-nyt-light.png': board('GRAIN:gGgyg', 'CHOKE:ggggg'),

  'wordle-nyt-dark-ipad.jpeg': board(
    'CHIPS:ggygg',
    'MINTY:gyyyg',
    'INERT:GGygG',
    'INLET:GGGGG'
  ),

  'wordle-android-dark.webp': board(
    'AMPLE:ggggg',
    'FURRY:Ggygg',
    'FRIAR:GGggg',
    'FROST:GGGgg',
    'FROND:GGGGG'
  ),

  // The "Wordle!" app rather than NYT Wordle.
  'android-wordle-light.jpg': board('PALED:gyyyg', 'LATER:yygyy')
}

const CHROME =
  process.env.CHROME_PATH ??
  '/Users/daniel/Library/Caches/ms-playwright/chromium-1234/chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'

const words = JSON.parse(readFileSync(join(ROOT, 'src/words.json'), 'utf8'))
const source = readFileSync(join(ROOT, 'src/extract.js'), 'utf8')

const browser = await chromium.launch({ executablePath: CHROME })
const page = await browser.newPage()
await page.setContent('<!doctype html><meta charset="utf-8">')
page.on('console', (m) => { if (m.type() === 'error') console.error('  page:', m.text()) })

let failures = 0
let letterTotal = 0
let letterHits = 0
let markTotal = 0
let markHits = 0

const files = readdirSync(FIXTURES).filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
if (!files.length) {
  console.error('no fixtures found in test/fixtures')
  process.exit(1)
}

for (const file of files) {
  const b64 = readFileSync(join(FIXTURES, file)).toString('base64')
  const mime = MIME[file.split('.').pop().toLowerCase()]
  const started = Date.now()

  const result = await page.evaluate(
    async ({ src, b64, mime, words }) => {
      const blob = new Blob([src], { type: 'text/javascript' })
      const mod = await import(URL.createObjectURL(blob))

      const img = new Image()
      await new Promise((res, rej) => {
        img.onload = res
        img.onerror = rej
        img.src = `data:${mime};base64,` + b64
      })

      const canvas = document.createElement('canvas')
      canvas.width = img.width
      canvas.height = img.height
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      ctx.drawImage(img, 0, 0)
      const image = ctx.getImageData(0, 0, img.width, img.height)

      const createCanvas = (w, h) => {
        const c = document.createElement('canvas')
        c.width = w
        c.height = h
        return c
      }

      return {
        size: [img.width, img.height],
        ...mod.extractGuesses(image, words, createCanvas)
      }
    },
    { src: source, b64, mime, words }
  )

  const ms = Date.now() - started
  const expected = EXPECTED[file]
  console.log(`\n${file}  ${result.size.join('x')}  theme=${result.theme}  ${ms}ms`)

  for (const row of result.rows) {
    console.log(`  ${row.map((c) => c.letter).join('')}  [${row.map((c) => c.mark).join(' ')}]`)
  }
  if (result.corrected) console.log(`  (${result.corrected} row(s) fixed via the word list)`)

  if (!expected) {
    console.log('  no expectation recorded -- skipping assertions')
    continue
  }

  if (result.rows.length !== expected.length) {
    console.error(`  FAIL expected ${expected.length} rows, got ${result.rows.length}`)
    failures++
    continue
  }

  expected.forEach((expRow, r) => {
    expRow.forEach((exp, c) => {
      const got = result.rows[r][c]
      letterTotal++
      markTotal++
      if (got.letter === exp.letter) letterHits++
      else console.error(`  FAIL row ${r + 1} col ${c + 1}: letter ${got.letter} != ${exp.letter}`)
      if (got.mark === exp.mark) markHits++
      else console.error(`  FAIL row ${r + 1} col ${c + 1}: mark ${got.mark} != ${exp.mark}`)
    })
  })
}

await browser.close()

console.log(
  `\nletters ${letterHits}/${letterTotal}  marks ${markHits}/${markTotal}`
)
const bad = failures || letterHits !== letterTotal || markHits !== markTotal
console.log(bad ? 'FAILED' : 'PASSED')
process.exit(bad ? 1 : 0)
