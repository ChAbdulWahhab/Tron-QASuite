import { useState, useCallback, useEffect, useRef } from 'react'

const LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6]
]

function lineWinner(cells) {
  for (const [a, b, c] of LINES) {
    if (cells[a] && cells[a] === cells[b] && cells[a] === cells[c]) {
      return { w: cells[a], line: [a, b, c] }
    }
  }
  return null
}

function boardFull(cells) {
  return cells.every(Boolean)
}

function minimax(cells, depth, isMax) {
  const hit = lineWinner(cells)
  if (hit) {
    if (hit.w === 'O') return 10 - depth
    return depth - 10
  }
  if (boardFull(cells)) return 0

  if (isMax) {
    let best = -Infinity
    for (let i = 0; i < 9; i++) {
      if (cells[i]) continue
      const next = [...cells]
      next[i] = 'O'
      best = Math.max(best, minimax(next, depth + 1, false))
    }
    return best
  }
  let best = Infinity
  for (let i = 0; i < 9; i++) {
    if (cells[i]) continue
    const next = [...cells]
    next[i] = 'X'
    best = Math.min(best, minimax(next, depth + 1, true))
  }
  return best
}

function rankedMovesO(cells) {
  const moves = []
  for (let i = 0; i < 9; i++) {
    if (cells[i]) continue
    const next = [...cells]
    next[i] = 'O'
    moves.push({ i, score: minimax(next, 0, false) })
  }
  moves.sort((a, b) => b.score - a.score)
  return moves
}

/** Strong play: usually best move; ~22% pick among top two scored moves (beatable but tough). */
function pickHarderOMove(cells) {
  const ranked = rankedMovesO(cells)
  if (!ranked.length) return -1
  if (ranked.length === 1) return ranked[0].i
  if (Math.random() < 0.22) {
    const topTwo = ranked.slice(0, 2)
    return topTwo[Math.floor(Math.random() * topTwo.length)].i
  }
  return ranked[0].i
}

export default function TicTacToe() {
  const [cells, setCells] = useState(() => Array(9).fill(null))
  const [status, setStatus] = useState('You are ✕, computer is ○. You move first.')
  const turnRef = useRef(0)

  const hit = lineWinner(cells)
  const done = Boolean(hit || boardFull(cells))
  const winLine = hit?.line || []

  useEffect(() => {
    const win = lineWinner(cells)
    const over = Boolean(win || boardFull(cells))
    if (over) {
      if (win) {
        if (win.w === 'X') setStatus('You win!')
        else setStatus('Computer wins.')
      } else setStatus('Draw.')
      return undefined
    }
    const xCount = cells.filter((c) => c === 'X').length
    const oCount = cells.filter((c) => c === 'O').length
    if (xCount === oCount) {
      setStatus('Your turn — tap an empty cell.')
      return undefined
    }
    setStatus('Computer is thinking…')
    const myTurn = ++turnRef.current
    const delayMs = 480 + Math.floor(Math.random() * 520)
    const id = window.setTimeout(() => {
      if (turnRef.current !== myTurn) return
      setCells((prev) => {
        if (lineWinner(prev) || boardFull(prev)) return prev
        const xc = prev.filter((c) => c === 'X').length
        const oc = prev.filter((c) => c === 'O').length
        if (xc === oc) return prev
        const m = pickHarderOMove(prev)
        if (m < 0) return prev
        const n = [...prev]
        n[m] = 'O'
        return n
      })
    }, delayMs)
    return () => {
      turnRef.current += 1
      window.clearTimeout(id)
    }
  }, [cells])

  const usersTurn =
    cells.filter((c) => c === 'X').length === cells.filter((c) => c === 'O').length

  const onCell = useCallback(
    (i) => {
      if (done || cells[i]) return
      if (!usersTurn) return
      setCells((prev) => {
        if (prev[i] || lineWinner(prev) || boardFull(prev)) return prev
        const xc = prev.filter((c) => c === 'X').length
        const oc = prev.filter((c) => c === 'O').length
        if (xc !== oc) return prev
        const n = [...prev]
        n[i] = 'X'
        return n
      })
    },
    [cells, done, usersTurn]
  )

  const reset = useCallback(() => {
    turnRef.current += 1
    setCells(Array(9).fill(null))
    setStatus('You are ✕, computer is ○. You move first.')
  }, [])

  return (
    <div className="tron-ttt">
      <p className="tron-ttt__status">{status}</p>
      <div className="tron-ttt__grid" role="grid" aria-label="Tic tac toe board">
        {cells.map((v, i) => (
          <button
            key={i}
            type="button"
            className={`tron-ttt__cell ${winLine.includes(i) ? 'tron-ttt__cell--win' : ''}`}
            onClick={() => onCell(i)}
            disabled={Boolean(v) || done || !usersTurn}
            aria-label={`Cell ${i + 1}`}
          >
            {v === 'X' ? <span className="tron-ttt__x">✕</span> : null}
            {v === 'O' ? <span className="tron-ttt__o">○</span> : null}
          </button>
        ))}
      </div>
      <button type="button" className="tron-ttt__reset" onClick={reset}>
        New game
      </button>
    </div>
  )
}
