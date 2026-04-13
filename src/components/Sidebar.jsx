import { useEffect, useState } from 'react'
import { TbLayoutSidebarLeftCollapse } from 'react-icons/tb'
import tronWindow from '../assets/tron-window.png'

function parseInsight(text) {
  if (!text || typeof text !== 'string') return { label: '', badge: '—', ok: false, muted: true }
  const idx = text.indexOf(': ')
  if (idx === -1) return { label: text, badge: '—', ok: false, muted: true }
  const label = text.slice(0, idx).trim()
  const rest = text.slice(idx + 2).trim()
  if (rest === '—' || rest === '-') return { label, badge: '—', ok: false, muted: true }
  const ok = /^ok$/i.test(rest)
  const badge = ok ? 'OK' : rest.replace(/\s*issue\(s\)\s*$/i, '').trim() || '!'
  return { label, badge, ok, muted: false }
}

function InsightRow({ text }) {
  const { label, badge, ok, muted } = parseInsight(text)
  const badgeClass = muted
    ? 'tron-sidebar__insight-badge tron-sidebar__insight-badge--muted'
    : ok
      ? 'tron-sidebar__insight-badge'
      : 'tron-sidebar__insight-badge tron-sidebar__insight-badge--warn'
  return (
    <div className="tron-sidebar__insight-row">
      <span className="tron-sidebar__insight-dot" aria-hidden />
      <span className="tron-sidebar__insight-label">{label}</span>
      <span className={badgeClass}>{badge}</span>
    </div>
  )
}

function isValidUrl(str) {
  try {
    const url = new URL(str)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function Sidebar({
  sidebarWidth,
  targetUrl,
  onTargetUrlChange,
  insights,
  isHeadless,
  onHeadlessChange,
  isRunning,
  onRunSuite,
  onStopSuite,
  onToggleSidebar
}) {
  const [savedUrls, setSavedUrls] = useState([])
  const urlOk = isValidUrl(targetUrl?.trim?.() || '')

  const refreshUrls = async () => {
    const api = typeof window !== 'undefined' ? window.electronAPI : null
    if (!api?.getUrls) return
    const res = await api.getUrls()
    if (res?.ok && Array.isArray(res.urls)) {
      setSavedUrls(res.urls)
    }
  }

  useEffect(() => {
    refreshUrls()
  }, [])

  const handleSave = async () => {
    if (!urlOk) return
    try {
      localStorage.setItem('tronTargetUrl', targetUrl)
    } catch {
      /* ignore */
    }
    const api = window.electronAPI
    if (api?.saveUrl) {
      await api.saveUrl(targetUrl)
      await refreshUrls()
    }
  }

  const handleHistoryChange = (e) => {
    const v = e.target.value
    if (!v) return
    onTargetUrlChange(v)
  }

  const openBugReport = () => {
    const mail =
      'mailto:ch.abdul.wahhab@proton.me?subject=TRON Bug Report&body=Version: v3-x64%0AOS: Windows%0A%0ADescribe the bug: '
    window.electronAPI?.openExternal ? window.electronAPI.openExternal(mail) : window.open(mail, '_blank')
  }

  const openAbout = () => {
    const url = 'https://tronq.vercel.app/'
    window.electronAPI?.openExternal ? window.electronAPI.openExternal(url) : window.open(url, '_blank')
  }

  const runDisabled = isRunning || !urlOk
  const historyValue = savedUrls.some((u) => u.url === targetUrl) ? targetUrl : ''

  return (
    <aside className="tron-sidebar" style={{ width: sidebarWidth }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 12px',
          borderBottom: '1px solid #E2E2DE'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <img src={tronWindow} alt="" style={{ width: '36px', height: '36px', objectFit: 'contain' }} />
          <div>
            <div style={{ fontSize: '14px', fontWeight: 600, color: '#199998', lineHeight: 1.2 }}>TRON</div>
            <div style={{ fontSize: '11px', color: '#9F9F9B' }}>(v3-x64)</div>
          </div>
        </div>
        <button
          type="button"
          className="tron-sidebar__collapse-btn"
          aria-label="Collapse sidebar"
          title="Collapse sidebar"
          onClick={onToggleSidebar}
        >
          <TbLayoutSidebarLeftCollapse size={16} aria-hidden />
        </button>
      </div>

      <div className="tron-sidebar__section">
        <div className="tron-sidebar__label">Target URL</div>
        <div className="tron-sidebar__input-wrap">
          <input
            type="text"
            className="tron-sidebar__input"
            value={targetUrl}
            onChange={(e) => onTargetUrlChange(e.target.value)}
            placeholder="https://example.com"
          />
          {!urlOk && targetUrl?.trim() ? (
            <p style={{ color: '#DC2626', fontSize: '11px', marginTop: '4px' }}>
              Please enter a valid URL (e.g. https://example.com)
            </p>
          ) : null}
          <div className="tron-sidebar__save-row">
            <button type="button" className="tron-sidebar__save" onClick={handleSave} disabled={!urlOk}>
              Save
            </button>
          </div>
        </div>
      </div>

      <div className="tron-sidebar__section">
        <div className="tron-sidebar__label">Recent History</div>
        <select className="tron-sidebar__select" value={historyValue} onChange={handleHistoryChange}>
          {savedUrls.length === 0 ? (
            <option value="" disabled>
              No history yet
            </option>
          ) : (
            <>
              <option value="">Select saved URL…</option>
              {savedUrls.map((u) => (
                <option key={u.id} value={u.url}>
                  {u.url}
                </option>
              ))}
            </>
          )}
        </select>
      </div>

      <label className="tron-sidebar__check">
        <input type="checkbox" checked={isHeadless} onChange={(e) => onHeadlessChange(e.target.checked)} />
        <span className="tron-sidebar__check-box" aria-hidden />
        <span className="tron-sidebar__check-label">Headless Mode (Run in Background)</span>
      </label>

      <div className="tron-sidebar__divider" />

      <div className="tron-sidebar__actions">
        <button
          type="button"
          className="tron-sidebar__btn-primary"
          onClick={onRunSuite}
          disabled={runDisabled}
          style={runDisabled ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
        >
          Run QA Suite
        </button>
        {isRunning ? (
          <button type="button" className="tron-sidebar__btn-ghost" onClick={onStopSuite}>
            Stop Suite
          </button>
        ) : null}
      </div>

      <div className="tron-sidebar__divider" />

      <div className="tron-sidebar__insights">
        <div className="tron-sidebar__label" style={{ marginBottom: 0 }}>
          Scan Insights
        </div>
        <InsightRow text={insights.security} />
        <InsightRow text={insights.seo} />
        <InsightRow text={insights.vitals} />
      </div>

      <footer className="tron-sidebar__footer">
        <button type="button" onClick={openBugReport}>
          Bug Report
        </button>
        <span className="tron-sidebar__footer-sep" aria-hidden>
          ·
        </span>
        <button type="button" onClick={openAbout}>
          About
        </button>
      </footer>
    </aside>
  )
}

export default Sidebar
