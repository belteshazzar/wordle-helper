import './style.css'
import WORDS from './words.json'
import { extractGuesses } from './extract.js'

const MAX_ROWS = 6
const MAX_COLS = 5
const MAX_CELLS = MAX_ROWS * MAX_COLS
const MARK_CYCLE = ['grey', 'yellow', 'green']
const KEYBOARD_ROWS = [
  ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
  ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
  ['Z', 'X', 'C', 'V', 'B', 'N', 'M', 'DEL']
]

const state = {
  cells: Array.from({ length: MAX_CELLS }, () => ({ letter: '', mark: null })),
  cursor: 0,
  helpOpen: false
}

const app = document.querySelector('#app')

app.innerHTML = `
  <header class="app-header">
    <button id="load-shot" class="header-button load-toggle" type="button"
      aria-label="Load a Wordle screenshot" title="Load a Wordle screenshot">+</button>
    <input id="shot-input" class="visually-hidden" type="file" accept="image/*" />
    <h1>Wordle Helper</h1>
    <button id="help-toggle" class="header-button help-toggle" type="button" aria-expanded="false"
      aria-controls="help" aria-label="Show help">?</button>
  </header>
  <div class="content">
    <div id="board" class="board"></div>
    <aside class="words-panel">
      <div class="word-list-header">
        <span id="word-count"></span>
      </div>
      <ul id="word-list" class="word-list"></ul>
    </aside>
  </div>
  <section id="help" class="help" hidden>
    <h2>How to use</h2>
    <p>
      Type the word you guessed in Wordle using the keyboard, then click each
      letter to tell the helper how Wordle marked it.
    </p>
    <ul class="help-marks">
      <li>
        <span class="cell grey" aria-hidden="true">N</span>
        <span>The letter is <b>not</b> in the word.</span>
      </li>
      <li>
        <span class="cell yellow" aria-hidden="true">M</span>
        <span>The letter is in the word, but <b>not in that position</b>.</span>
      </li>
      <li>
        <span class="cell green" aria-hidden="true">Y</span>
        <span>The letter is in the word, <b>in that position</b>.</span>
      </li>
    </ul>
    <p>
      Clicking a letter cycles it grey → yellow → green. The list on the right
      shows every word still possible, and narrows as you mark more letters.
      Enter your next guess on the following row.
    </p>
    <h2>Loading a screenshot</h2>
    <p>
      Press <b>+</b> to pick a screenshot of your Wordle board, or just paste or
      drag one onto the page. The guessed rows and their colours are read
      straight off the picture, so you do not have to type them in.
    </p>
  </section>
  <div id="keyboard" class="keyboard"></div>
  <p id="toast" class="toast" role="status" hidden></p>
`

const boardEl = document.querySelector('#board')
const keyboardEl = document.querySelector('#keyboard')
const wordListEl = document.querySelector('#word-list')
const wordCountEl = document.querySelector('#word-count')
const helpEl = document.querySelector('#help')
const helpToggleEl = document.querySelector('#help-toggle')
const loadShotEl = document.querySelector('#load-shot')
const shotInputEl = document.querySelector('#shot-input')
const toastEl = document.querySelector('#toast')

function renderBoard() {
  boardEl.innerHTML = ''

  for (let rowIndex = 0; rowIndex < MAX_ROWS; rowIndex++) {
    const rowEl = document.createElement('div')
    rowEl.className = 'board-row'

    for (let colIndex = 0; colIndex < MAX_COLS; colIndex++) {
      const cellIndex = rowIndex * MAX_COLS + colIndex
      const cell = state.cells[cellIndex]
      const cellEl = document.createElement('div')
      cellEl.className = 'cell'

      if (cell.letter) {
        cellEl.classList.add('filled')
        if (cell.mark) {
          cellEl.classList.add(cell.mark)
        }
        cellEl.addEventListener('click', () => cycleMark(cellIndex))
      }

      if (cellIndex === state.cursor && state.cursor < MAX_CELLS) {
        cellEl.classList.add('active')
      }

      cellEl.textContent = cell.letter
      rowEl.appendChild(cellEl)
    }

    boardEl.appendChild(rowEl)
  }
}

function renderKeyboard() {
  keyboardEl.innerHTML = ''

  KEYBOARD_ROWS.forEach((row, rowIndex) => {
    const rowEl = document.createElement('div')
    rowEl.className = `keyboard-row keyboard-row-${rowIndex}`

    row.forEach((key) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'key'

      if (key === 'DEL') {
        button.classList.add('key-wide')
        button.textContent = '⌫'
        button.setAttribute('aria-label', 'Delete')
        button.addEventListener('click', handleBackspace)
      } else {
        button.textContent = key
        button.addEventListener('click', () => handleLetter(key))
      }

      rowEl.appendChild(button)
    })

    keyboardEl.appendChild(rowEl)
  })
}

function markedRows() {
  const rows = []

  for (let rowIndex = 0; rowIndex < MAX_ROWS; rowIndex++) {
    const marked = []

    for (let colIndex = 0; colIndex < MAX_COLS; colIndex++) {
      const cell = state.cells[rowIndex * MAX_COLS + colIndex]
      if (cell.letter && cell.mark) {
        marked.push({ letter: cell.letter, mark: cell.mark, col: colIndex })
      }
    }

    if (marked.length) {
      rows.push(marked)
    }
  }

  return rows
}

function matchesRow(word, cells) {
  for (const { letter, mark, col } of cells) {
    if (mark === 'green' && word[col] !== letter) {
      return false
    }

    if (mark === 'yellow' && word[col] === letter) {
      return false
    }
  }

  // Count constraints handle repeated letters: greens and yellows set a
  // minimum count, and a grey on the same letter caps it at exactly that.
  const minCount = {}
  const capped = new Set()

  for (const { letter, mark } of cells) {
    if (mark === 'grey') {
      capped.add(letter)
    } else {
      minCount[letter] = (minCount[letter] || 0) + 1
    }
  }

  for (const letter of new Set(cells.map((cell) => cell.letter))) {
    const count = word.split('').filter((char) => char === letter).length
    const min = minCount[letter] || 0

    if (count < min) {
      return false
    }

    if (capped.has(letter) && count > min) {
      return false
    }
  }

  return true
}

function renderWordList() {
  const rows = markedRows()
  const matches = WORDS.filter((word) => rows.every((cells) => matchesRow(word, cells)))

  const MAX_VISIBLE = 300
  wordCountEl.textContent = matches.length
  wordListEl.innerHTML = matches
    .slice(0, MAX_VISIBLE)
    .map((word) => `<li>${word}</li>`)
    .join('')

  if (matches.length > MAX_VISIBLE) {
    wordListEl.innerHTML += `<li class="word-list-more">…and ${matches.length - MAX_VISIBLE} more</li>`
  }
}

function cycleMark(cellIndex) {
  const cell = state.cells[cellIndex]
  const next = (MARK_CYCLE.indexOf(cell.mark) + 1) % MARK_CYCLE.length
  const mark = MARK_CYCLE[next]
  const col = cellIndex % MAX_COLS

  // The same letter in the same column always gets the same verdict,
  // so keep every matching cell in that column in sync.
  state.cells.forEach((other, index) => {
    if (other.letter === cell.letter && index % MAX_COLS === col) {
      other.mark = mark
    }
  })

  renderBoard()
  renderWordList()
}

function handleLetter(letter) {
  if (state.cursor >= MAX_CELLS) {
    return
  }

  const col = state.cursor % MAX_COLS
  const twin = state.cells.find(
    (other, index) => other.letter === letter && index % MAX_COLS === col && other.mark
  )
  state.cells[state.cursor] = { letter, mark: twin ? twin.mark : 'grey' }
  state.cursor += 1
  renderBoard()
  renderWordList()
}

function handleBackspace() {
  if (state.cursor === 0) {
    return
  }

  state.cursor -= 1
  state.cells[state.cursor] = { letter: '', mark: null }
  renderBoard()
  renderWordList()
}

let toastTimer = null

function showToast(message) {
  toastEl.textContent = message
  toastEl.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    toastEl.hidden = true
  }, 4000)
}

function createCanvas(width, height) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(source)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('could not decode image'))
    }
    image.src = url
  })
}

function applyGuesses(rows) {
  state.cells = Array.from({ length: MAX_CELLS }, () => ({ letter: '', mark: null }))

  rows.slice(0, MAX_ROWS).forEach((row, rowIndex) => {
    row.forEach((cell, colIndex) => {
      state.cells[rowIndex * MAX_COLS + colIndex] = { letter: cell.letter, mark: cell.mark }
    })
  })

  state.cursor = Math.min(rows.length, MAX_ROWS) * MAX_COLS
  renderBoard()
  renderWordList()
}

async function loadScreenshot(source) {
  if (!source) return

  try {
    const image = await loadImage(source)
    const canvas = createCanvas(image.width, image.height)
    const context = canvas.getContext('2d', { willReadFrequently: true })
    context.drawImage(image, 0, 0)

    const pixels = context.getImageData(0, 0, image.width, image.height)
    const { rows } = extractGuesses(pixels, WORDS, createCanvas)

    if (!rows.length) {
      showToast('No Wordle board found in that image.')
      return
    }

    setHelpOpen(false)
    applyGuesses(rows)
    showToast(`Loaded ${rows.length} guess${rows.length === 1 ? '' : 'es'}.`)
  } catch {
    showToast('Could not read that image.')
  }
}

// Help replaces the board, word list and keyboard rather than floating over
// them, so there is only ever one scene on screen.
function setHelpOpen(open) {
  state.helpOpen = open
  app.classList.toggle('help-open', open)
  helpEl.hidden = !open
  helpToggleEl.textContent = open ? '✕' : '?'
  helpToggleEl.setAttribute('aria-expanded', String(open))
  helpToggleEl.setAttribute('aria-label', open ? 'Close help' : 'Show help')
}

function handleKeydown(event) {
  if (event.key === 'Escape' && state.helpOpen) {
    event.preventDefault()
    setHelpOpen(false)
    return
  }

  // Keystrokes would otherwise edit the hidden board while help is up.
  if (state.helpOpen) {
    return
  }

  const key = event.key.toUpperCase()

  if (/^[A-Z]$/.test(key)) {
    event.preventDefault()
    handleLetter(key)
    return
  }

  if (event.key === 'Backspace') {
    event.preventDefault()
    handleBackspace()
  }
}

helpToggleEl.addEventListener('click', () => setHelpOpen(!state.helpOpen))
document.addEventListener('keydown', handleKeydown)

loadShotEl.addEventListener('click', () => shotInputEl.click())
shotInputEl.addEventListener('change', () => {
  loadScreenshot(shotInputEl.files[0])
  // Reset so picking the same file twice still fires a change event.
  shotInputEl.value = ''
})

document.addEventListener('paste', (event) => {
  const item = [...(event.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'))
  if (!item) return
  event.preventDefault()
  loadScreenshot(item.getAsFile())
})

document.addEventListener('dragover', (event) => event.preventDefault())
document.addEventListener('drop', (event) => {
  const file = event.dataTransfer?.files?.[0]
  if (!file?.type.startsWith('image/')) return
  event.preventDefault()
  loadScreenshot(file)
})

renderBoard()
renderKeyboard()
renderWordList()
