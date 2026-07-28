import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import englishWords from 'an-array-of-english-words' with { type: 'json' }

const words = englishWords
  .filter((word) => word.length === 5)
  .map((word) => word.toUpperCase())

const outPath = fileURLToPath(new URL('../src/words.json', import.meta.url))
writeFileSync(outPath, JSON.stringify(words))
console.log(`Wrote ${words.length} five-letter words to src/words.json`)
