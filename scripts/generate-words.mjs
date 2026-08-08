import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import englishWords from 'an-array-of-english-words' with { type: 'json' }

// an-array-of-english-words is a general dictionary, not Wordle's curated
// answer set, so it carries slurs and profanity. Left in they surface
// unprompted: constrain the board a little and the suggestion column fills
// with them. blocklist.txt is the only copy of the list -- the iOS port copies
// this file rather than keeping its own.
const blocklistPath = fileURLToPath(new URL('./blocklist.txt', import.meta.url))
const blocked = new Set(
  readFileSync(blocklistPath, 'utf8')
    .split('\n')
    .map((line) => line.split('#')[0].trim().toLowerCase())
    .filter(Boolean)
)

const fiveLetter = englishWords.filter((word) => word.length === 5)
const words = fiveLetter
  .filter((word) => !blocked.has(word.toLowerCase()))
  .map((word) => word.toUpperCase())

const outPath = fileURLToPath(new URL('../src/words.json', import.meta.url))
writeFileSync(outPath, JSON.stringify(words))

console.log(
  `Wrote ${words.length} five-letter words to src/words.json ` +
    `(${fiveLetter.length - words.length} blocked)`
)

// An entry that matches nothing is a typo, or a word the dictionary never had.
// Either way it is claiming cover it does not provide.
const present = new Set(fiveLetter.map((word) => word.toLowerCase()))
const unused = [...blocked].filter((word) => !present.has(word)).sort()
if (unused.length > 0) {
  console.warn(`Warning: ${unused.length} blocklist entries matched no word: ${unused.join(' ')}`)
}
