// Reads a Wordle screenshot and recovers the guessed rows.
//
// The colours are the easy half: Wordle fills its tiles with flat, unshaded
// colours, so classifying a tile is a nearest-palette lookup. The letters are
// the hard half, and are handled by matching each glyph against rendered
// references and then snapping the row to a real word -- see pickWord.

const TILE_SIZE = 16 // glyph feature grid, TILE_SIZE^2 dimensions
const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

// Every tile colour the supported games ship, since the palette is the only
// thing that tells a present letter from a correct one. NYT Wordle's high
// contrast theme swaps the hues entirely: orange means correct and blue means
// present. The "Wordle!" app (Lion Studios, Android/iOS) draws the same board
// in its own colours, so it gets its own entries. Two entries may share a
// theme and a mark -- they are then the same colour class from different
// games, and everything downstream treats them as interchangeable.
const PALETTES = [
  // NYT Wordle.
  { theme: 'light', mark: 'grey', rgb: [120, 124, 126] },
  { theme: 'light', mark: 'yellow', rgb: [201, 180, 88] },
  { theme: 'light', mark: 'green', rgb: [106, 170, 100] },
  { theme: 'dark', mark: 'grey', rgb: [58, 58, 60] },
  { theme: 'dark', mark: 'yellow', rgb: [181, 159, 59] },
  { theme: 'dark', mark: 'green', rgb: [83, 141, 78] },
  { theme: 'highContrast', mark: 'yellow', rgb: [133, 192, 249] },
  { theme: 'highContrast', mark: 'green', rgb: [245, 121, 58] },
  // "Wordle!" app, light theme. Grey and yellow are sampled from the fixture
  // screenshot; green is sampled from gameplay footage and is approximate,
  // pending a fixture with a correct letter in it. The app's dark themes use
  // other colours again and are not supported yet.
  { theme: 'light', mark: 'grey', rgb: [128, 126, 137] },
  { theme: 'light', mark: 'yellow', rgb: [245, 205, 71] },
  { theme: 'light', mark: 'green', rgb: [167, 215, 110] }
]

const COLOUR_TOLERANCE = 30 // per-channel euclidean distance

function distance(a, b) {
  const dr = a[0] - b[0]
  const dg = a[1] - b[1]
  const db = a[2] - b[2]
  return Math.sqrt(dr * dr + dg * dg + db * db)
}

function classify(rgb) {
  let best = null
  let bestDist = Infinity
  for (const entry of PALETTES) {
    const d = distance(rgb, entry.rgb)
    if (d < bestDist) {
      bestDist = d
      best = entry
    }
  }
  return bestDist <= COLOUR_TOLERANCE ? best : null
}

// Connected components of same-mark pixels, at half resolution for speed.
function findTiles(image) {
  const { width, height, data } = image
  const step = 2
  const w = Math.floor(width / step)
  const h = Math.floor(height / step)

  const labels = new Int32Array(w * h).fill(-1)
  const marks = new Array(w * h).fill(null)

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = ((y * step) * width + x * step) * 4
      const entry = classify([data[i], data[i + 1], data[i + 2]])
      if (entry) marks[y * w + x] = entry
    }
  }

  const tiles = []
  const stack = []

  for (let start = 0; start < marks.length; start++) {
    if (!marks[start] || labels[start] !== -1) continue

    const id = tiles.length
    const entry = marks[start]
    let minX = w
    let maxX = 0
    let minY = h
    let maxY = 0
    let area = 0

    labels[start] = id
    stack.push(start)

    while (stack.length) {
      const p = stack.pop()
      const px = p % w
      const py = (p - px) / w
      area++
      if (px < minX) minX = px
      if (px > maxX) maxX = px
      if (py < minY) minY = py
      if (py > maxY) maxY = py

      const neighbours = [
        px > 0 ? p - 1 : -1,
        px < w - 1 ? p + 1 : -1,
        py > 0 ? p - w : -1,
        py < h - 1 ? p + w : -1
      ]
      for (const n of neighbours) {
        if (n < 0 || labels[n] !== -1) continue
        const m = marks[n]
        if (!m || m.mark !== entry.mark || m.theme !== entry.theme) continue
        labels[n] = id
        stack.push(n)
      }
    }

    const boxW = (maxX - minX + 1) * step
    const boxH = (maxY - minY + 1) * step
    tiles.push({
      mark: entry.mark,
      theme: entry.theme,
      rgb: entry.rgb,
      x: minX * step,
      y: minY * step,
      w: boxW,
      h: boxH,
      fill: (area * step * step) / (boxW * boxH)
    })
  }

  return tiles
}

// The on-screen keyboard is colour-coded too, so shape is what separates a
// board tile from a key: board tiles are solid squares, keys are taller than
// they are wide and have rounded corners.
function boardTiles(tiles, imageWidth) {
  const candidates = tiles.filter(
    (t) =>
      t.fill > 0.85 &&
      t.w >= imageWidth * 0.03 &&
      Math.abs(t.w - t.h) / Math.max(t.w, t.h) < 0.12
  )
  if (candidates.length < 5) return []

  // Board tiles are all the same size; take the dominant size cluster.
  const sizes = candidates.map((t) => t.w).sort((a, b) => a - b)
  const median = sizes[Math.floor(sizes.length / 2)]
  return candidates.filter((t) => Math.abs(t.w - median) / median < 0.15)
}

function groupRows(tiles) {
  const sorted = [...tiles].sort((a, b) => a.y - b.y)
  const rows = []
  for (const tile of sorted) {
    const row = rows.find((r) => Math.abs(r[0].y - tile.y) < tile.h * 0.5)
    if (row) row.push(tile)
    else rows.push([tile])
  }
  // A submitted Wordle row is always exactly five coloured tiles; anything
  // else is a partial row or a stray match.
  return rows.filter((r) => r.length === 5).map((r) => r.sort((a, b) => a.x - b.x))
}

// Reduce a boolean glyph mask to a fixed-size coverage grid, so glyphs of
// different pixel sizes become comparable.
function featurise(mask, mw, mh) {
  let minX = mw
  let maxX = -1
  let minY = mh
  let maxY = -1
  for (let y = 0; y < mh; y++) {
    for (let x = 0; x < mw; x++) {
      if (!mask[y * mw + x]) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  if (maxX < 0) return null

  const bw = maxX - minX + 1
  const bh = maxY - minY + 1
  const out = new Float32Array(TILE_SIZE * TILE_SIZE)

  for (let cy = 0; cy < TILE_SIZE; cy++) {
    for (let cx = 0; cx < TILE_SIZE; cx++) {
      const x0 = minX + Math.floor((cx * bw) / TILE_SIZE)
      const x1 = minX + Math.max(Math.floor(((cx + 1) * bw) / TILE_SIZE), Math.floor((cx * bw) / TILE_SIZE) + 1)
      const y0 = minY + Math.floor((cy * bh) / TILE_SIZE)
      const y1 = minY + Math.max(Math.floor(((cy + 1) * bh) / TILE_SIZE), Math.floor((cy * bh) / TILE_SIZE) + 1)
      let on = 0
      let total = 0
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          total++
          if (mask[y * mw + x]) on++
        }
      }
      out[cy * TILE_SIZE + cx] = total ? on / total : 0
    }
  }

  // Normalise so stroke weight differences matter less than shape.
  let norm = 0
  for (const v of out) norm += v * v
  norm = Math.sqrt(norm) || 1
  for (let i = 0; i < out.length; i++) out[i] /= norm
  return out
}

// Glyph references, rendered once from a font in the same grotesque family as
// Wordle's. Shapes will not match exactly, which is why callers lean on the
// word list to fix the residual errors.
export function buildReferences(createCanvas) {
  const size = 200
  const canvas = createCanvas(size, size)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  const refs = []

  for (const letter of GLYPHS) {
    ctx.fillStyle = '#000000'
    ctx.fillRect(0, 0, size, size)
    ctx.fillStyle = '#ffffff'
    ctx.font = `bold 140px "Helvetica Neue", Helvetica, Arial, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(letter, size / 2, size / 2)

    const { data } = ctx.getImageData(0, 0, size, size)
    const mask = new Uint8Array(size * size)
    for (let i = 0; i < mask.length; i++) mask[i] = data[i * 4] > 128 ? 1 : 0
    refs.push({ letter, feature: featurise(mask, size, size) })
  }

  return refs
}

// Rank the letters a tile could hold, best first.
function readGlyph(image, tile, refs) {
  const inset = Math.round(tile.w * 0.18)
  const x0 = tile.x + inset
  const y0 = tile.y + inset
  const mw = tile.w - inset * 2
  const mh = tile.h - inset * 2
  if (mw <= 0 || mh <= 0) return []

  const mask = new Uint8Array(mw * mh)
  for (let y = 0; y < mh; y++) {
    for (let x = 0; x < mw; x++) {
      const i = ((y0 + y) * image.width + (x0 + x)) * 4
      const px = [image.data[i], image.data[i + 1], image.data[i + 2]]
      // The letter is whatever is not the tile's own colour.
      mask[y * mw + x] = distance(px, tile.rgb) > 60 ? 1 : 0
    }
  }

  const feature = featurise(mask, mw, mh)
  if (!feature) return []

  return refs
    .map((ref) => {
      let sum = 0
      for (let i = 0; i < feature.length; i++) {
        const d = feature[i] - ref.feature[i]
        sum += d * d
      }
      return { letter: ref.letter, distance: Math.sqrt(sum) }
    })
    .sort((a, b) => a.distance - b.distance)
}

// Every submitted row is a real word, so search the top candidates per
// position for the cheapest combination that the word list accepts. This is
// what turns imperfect glyph matching into reliable rows.
function pickWord(candidates, wordSet, beam = 5) {
  const best = candidates.map((c) => c[0]?.letter ?? '?').join('')
  if (wordSet.has(best)) return { word: best, corrected: false }

  const options = candidates.map((c) => c.slice(0, beam))
  let found = null
  let foundCost = Infinity
  const letters = new Array(candidates.length)

  const walk = (i, cost) => {
    if (cost >= foundCost) return
    if (i === options.length) {
      const word = letters.join('')
      if (wordSet.has(word)) {
        found = word
        foundCost = cost
      }
      return
    }
    for (const option of options[i]) {
      letters[i] = option.letter
      walk(i + 1, cost + option.distance)
    }
  }
  walk(0, 0)

  return found ? { word: found, corrected: true } : { word: best, corrected: false }
}

/**
 * Extract the guessed rows from a Wordle screenshot.
 *
 * @param {ImageData} image        pixels of the whole screenshot
 * @param {string[]} words         uppercase word list used to correct rows
 * @param {Function} createCanvas  (w, h) => canvas, for rendering references
 * @returns {{rows: Array<Array<{letter: string, mark: string}>>, theme: string|null, corrected: number}}
 */
export function extractGuesses(image, words, createCanvas) {
  const tiles = boardTiles(findTiles(image), image.width)
  const rows = groupRows(tiles)
  if (!rows.length) return { rows: [], theme: null, corrected: 0 }

  const refs = buildReferences(createCanvas)
  const wordSet = new Set(words)
  let corrected = 0

  const out = rows.map((row) => {
    const candidates = row.map((tile) => readGlyph(image, tile, refs))
    const { word, corrected: wasCorrected } = pickWord(candidates, wordSet)
    if (wasCorrected) corrected++
    return row.map((tile, i) => ({ letter: word[i] ?? '?', mark: tile.mark }))
  })

  return { rows: out, theme: rows[0][0].theme, corrected }
}
