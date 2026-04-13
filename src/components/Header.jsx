import { useState, useEffect } from 'react'
import { TbLayoutSidebarLeftExpand } from 'react-icons/tb'
import { IoGameControllerOutline } from 'react-icons/io5'
import TicTacToe from './TicTacToe.jsx'

export default function Header({ isRunning, sidebarOpen, onOpenSidebar }) {
  const [gameOpen, setGameOpen] = useState(false)

  useEffect(() => {
    if (!isRunning) setGameOpen(false)
  }, [isRunning])

  useEffect(() => {
    if (!gameOpen) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape') setGameOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [gameOpen])

  return (
    <header className="tron-header">
      <div className="tron-header__center">
        {!sidebarOpen ? (
          <button
            type="button"
            className="tron-header__sidebar-open"
            onClick={onOpenSidebar}
            aria-label="Open sidebar"
            title="Open sidebar — URL, run controls, and settings"
          >
            <TbLayoutSidebarLeftExpand className="tron-header__sidebar-open-icon" aria-hidden />
          </button>
        ) : null}
        <span className="tron-header__subtitle">Automated Quality Verification Software</span>
      </div>
      <div className="tron-header__right">
        {isRunning ? (
          <div className="tron-header__game-wrap">
            <button
              type="button"
              className="tron-header__game-pill"
              onClick={() => setGameOpen((o) => !o)}
              aria-expanded={gameOpen}
              aria-haspopup="dialog"
              title="Play tic-tac-toe while the suite runs"
            >
              <IoGameControllerOutline className="tron-header__game-pill-icon-svg" aria-hidden />
              <span className="tron-header__game-pill-text">Want to play?</span>
            </button>
            {gameOpen ? (
              <>
                <button
                  type="button"
                  className="tron-header__game-scrim"
                  aria-label="Close game"
                  onClick={() => setGameOpen(false)}
                />
                <div
                  className="tron-header__game-popover"
                  role="dialog"
                  aria-label="Tic tac toe"
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <div className="tron-header__game-popover-head">
                    <span className="tron-header__game-popover-title">Tic-tac-toe</span>
                    <button
                      type="button"
                      className="tron-header__game-popover-close"
                      onClick={() => setGameOpen(false)}
                      aria-label="Close"
                    >
                      ×
                    </button>
                  </div>
                  <p className="tron-header__game-popover-hint">
                    You are ✕ (first). Computer is ○ — strong but not perfect AI.
                  </p>
                  <TicTacToe />
                </div>
              </>
            ) : null}
          </div>
        ) : null}
        <span className="tron-header__build-label">Development Build – Verify Independently</span>
      </div>
    </header>
  )
}
