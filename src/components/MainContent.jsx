import { useRef, useEffect, useState, useCallback } from 'react'
import Header from './Header.jsx'
import { formatLocalDateTime } from '../utils/parseUtcDate.js'

function statusBadgeClass(status) {
  const s = String(status || '').toUpperCase()
  if (s === 'PASSED') return 'tron-badge tron-badge--passed'
  if (s === 'FAILED') return 'tron-badge tron-badge--failed'
  if (s === 'WARNING') return 'tron-badge tron-badge--warn'
  if (s === 'RUNNING') return 'tron-badge tron-badge--running'
  return 'tron-badge tron-badge--muted'
}

function formatRunDate(iso) {
  return formatLocalDateTime(iso)
}

function LogLine({ raw }) {
  let ts = ''
  let body = raw
  if (raw.startsWith('[')) {
    const end = raw.indexOf(']')
    if (end !== -1) {
      ts = raw.slice(0, end + 1)
      body = raw.slice(end + 1).trimStart()
    }
  } else {
    const m = raw.match(/^(\S+\s+\S+)\s+(.*)$/)
    if (m) {
      ts = m[1]
      body = m[2]
    }
  }

  const parts = body.split(/(\bPASSED\b|\bFAILED\b|\bWARNING\b)/g)

  return (
    <div className="tron-log-line">
      {ts ? <span className="tron-log-line__ts">{ts}</span> : null}
      {parts.map((part, i) => {
        if (part === 'PASSED') {
          return (
            <span key={i} className="tron-log-line__kw tron-log-line__kw--pass">
              {part}
            </span>
          )
        }
        if (part === 'FAILED') {
          return (
            <span key={i} className="tron-log-line__kw tron-log-line__kw--fail">
              {part}
            </span>
          )
        }
        if (part === 'WARNING') {
          return (
            <span key={i} className="tron-log-line__kw tron-log-line__kw--warn">
              {part}
            </span>
          )
        }
        return (
          <span key={i} className="tron-log-line__msg">
            {part}
          </span>
        )
      })}
    </div>
  )
}

function MainContent({
  logsHeight,
  onLogsResize,
  logs,
  testRows,
  stats,
  progressPct,
  onApplyArchivedReport,
  activeTab: controlledTab,
  onTabChange,
  isRunning,
  sidebarOpen,
  onOpenSidebar
}) {
  const logsContainerRef = useRef(null)
  const testTableScrollRef = useRef(null)
  const [autoScroll, setAutoScroll] = useState(true)
  const [followTestTable, setFollowTestTable] = useState(true)
  const [internalTab, setInternalTab] = useState('live')
  const [archives, setArchives] = useState([])
  const [archivesLoading, setArchivesLoading] = useState(false)
  const [selectedArchiveIds, setSelectedArchiveIds] = useState(() => new Set())
  const [logsOpen, setLogsOpen] = useState(true)

  const isControlled = controlledTab != null && typeof onTabChange === 'function'
  const activeTab = isControlled ? controlledTab : internalTab
  const setActiveTab = isControlled ? onTabChange : setInternalTab

  useEffect(() => {
    if (!autoScroll || !logsOpen || !logsContainerRef.current) return
    const el = logsContainerRef.current
    el.scrollTop = el.scrollHeight
  }, [logs, autoScroll, logsOpen])

  useEffect(() => {
    if (!followTestTable || activeTab !== 'live') return
    const el = testTableScrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [testRows, followTestTable, activeTab, isRunning])

  const loadArchives = useCallback(async () => {
    const api = window.electronAPI
    if (!api?.getReports) {
      setArchives([])
      return
    }
    setArchivesLoading(true)
    try {
      const res = await api.getReports()
      const list = res?.reports || []
      setArchives(list)
      setSelectedArchiveIds((prev) => {
        const ids = new Set(list.map((r) => r.id))
        const next = new Set()
        prev.forEach((id) => {
          if (ids.has(id)) next.add(id)
        })
        return next
      })
    } finally {
      setArchivesLoading(false)
    }
  }, [])

  useEffect(() => {
    if (activeTab === 'archives') {
      loadArchives()
    }
  }, [activeTab, loadArchives])

  const handleViewReport = async (id) => {
    const api = window.electronAPI
    if (!api?.getReport || !onApplyArchivedReport) return
    const row = await api.getReport(id)
    if (row) {
      onApplyArchivedReport(row)
      setActiveTab('live')
    }
  }

  const allArchivesSelected =
    archives.length > 0 && archives.every((r) => selectedArchiveIds.has(r.id))

  const toggleArchiveSelect = (id) => {
    setSelectedArchiveIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAllArchives = () => {
    if (allArchivesSelected) {
      setSelectedArchiveIds(new Set())
    } else {
      setSelectedArchiveIds(new Set(archives.map((r) => r.id)))
    }
  }

  const handleDeleteSelectedArchives = async () => {
    const api = window.electronAPI
    if (!api?.deleteReports) return
    const ids = [...selectedArchiveIds]
    if (!ids.length) return
    const res = await api.deleteReports({ ids })
    if (res?.ok) await loadArchives()
    else if (!res?.cancelled) window.alert(res?.error || 'Delete failed')
  }

  const handleDeleteAllArchives = async () => {
    const api = window.electronAPI
    if (!api?.deleteReports) return
    const res = await api.deleteReports({ deleteAll: true })
    if (res?.ok) await loadArchives()
    else if (!res?.cancelled) window.alert(res?.error || 'Delete failed')
  }

  const handleExportArchived = async (id, format) => {
    const api = window.electronAPI
    if (!api?.exportArchivedReport) return
    const res = await api.exportArchivedReport(id, format)
    if (res?.ok) {
      /* shell opens file in main */
    } else if (res && !res.cancelled) {
      window.alert(res.error || 'Export failed')
    }
  }

  const fmtTime = (s) => {
    const n = Number(s)
    if (!Number.isFinite(n)) return '—'
    if (n >= 60) return `${(n / 60).toFixed(1)}m`
    return `${n.toFixed(2)}s`
  }

  const displayTestName = (row) => row.display_name || row.displayName || row.name

  return (
    <div className="tron-main">
      <Header
        isRunning={Boolean(isRunning)}
        sidebarOpen={Boolean(sidebarOpen)}
        onOpenSidebar={onOpenSidebar}
      />

      <div className="tron-tabs">
        <button
          type="button"
          className={`tron-tabs__btn ${activeTab === 'live' ? 'tron-tabs__btn--active' : ''}`}
          onClick={() => setActiveTab('live')}
        >
          Live Report
        </button>
        <button
          type="button"
          className={`tron-tabs__btn ${activeTab === 'archives' ? 'tron-tabs__btn--active' : ''}`}
          onClick={() => setActiveTab('archives')}
        >
          Archives / History
        </button>
      </div>

      {activeTab === 'live' ? (
        <>
          <div className="tron-live-scroll">
            <div className="tron-stats">
              <div className="tron-stat-card">
                <div className="tron-stat-card__value">{stats.scorePct}%</div>
                <div className="tron-stat-card__label">Score</div>
              </div>
              <div className="tron-stat-card">
                <div className="tron-stat-card__value tron-stat-card__value--success">{stats.pass}</div>
                <div className="tron-stat-card__label">Pass</div>
              </div>
              <div className="tron-stat-card">
                <div className="tron-stat-card__value tron-stat-card__value--danger">{stats.fail}</div>
                <div className="tron-stat-card__label">Fail</div>
              </div>
              <div className="tron-stat-card">
                <div className="tron-stat-card__value tron-stat-card__value--warning">{stats.warn}</div>
                <div className="tron-stat-card__label">Warn</div>
              </div>
              <div className="tron-stat-card">
                <div className="tron-stat-card__value">{fmtTime(stats.timeSec)}</div>
                <div className="tron-stat-card__label">Time</div>
              </div>
            </div>

            <div className="tron-progress">
              <span className="tron-progress__label">Complete</span>
              <div className="tron-progress__track">
                <div className="tron-progress__fill" style={{ width: `${progressPct}%` }} />
              </div>
              <span className="tron-progress__pct">{progressPct}%</span>
              <label className="tron-progress__follow">
                <input
                  type="checkbox"
                  checked={followTestTable}
                  onChange={(e) => setFollowTestTable(e.target.checked)}
                />
                Table scroll
              </label>
            </div>

            <div className="tron-table-wrap">
              <div
                ref={testTableScrollRef}
                className="test-table-wrapper"
                style={{ maxHeight: 'calc(100vh - 380px)' }}
              >
                <div className="tron-table-scroll">
                  <table className="tron-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Test Name</th>
                        <th>Category</th>
                        <th>Status</th>
                        <th>Time</th>
                        <th>Details</th>
                      </tr>
                    </thead>
                    <tbody>
                      {testRows.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="tron-table__empty">
                            Run a suite to see results
                          </td>
                        </tr>
                      ) : (
                        testRows.map((row, idx) => (
                          <tr key={`${row.name}-${idx}`}>
                            <td style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>{idx + 1}</td>
                            <td style={{ fontWeight: 500 }}>{displayTestName(row)}</td>
                            <td style={{ color: 'var(--text-secondary)', textTransform: 'capitalize' }}>
                              {row.category || '—'}
                            </td>
                            <td>
                              <span className={statusBadgeClass(row.status)}>{row.status}</span>
                            </td>
                            <td style={{ color: 'var(--text-secondary)' }}>
                              {row.duration != null ? `${Number(row.duration).toFixed(3)}s` : '—'}
                            </td>
                            <td
                              style={{
                                color: 'var(--text-secondary)',
                                maxWidth: 200,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap'
                              }}
                              title={row.message || ''}
                            >
                              {row.message || '—'}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>

          <div className="tron-logs">
            <div className="tron-logs__resize" onMouseDown={onLogsResize} role="separator" aria-orientation="horizontal" />
            <div className="tron-logs__head">
              <div className="tron-logs__head-left">
                <button
                  type="button"
                  className={`tron-logs__chevron ${logsOpen ? '' : 'tron-logs__chevron--collapsed'}`}
                  onClick={() => setLogsOpen((o) => !o)}
                  aria-expanded={logsOpen}
                  aria-label={logsOpen ? 'Collapse logs' : 'Expand logs'}
                >
                  ▼
                </button>
                <span className="tron-logs__title">Logs</span>
              </div>
              <div className="tron-logs__head-right">
                <select className="tron-logs__select" aria-label="Log filter">
                  <option>All</option>
                </select>
                <label className="tron-logs__check">
                  <input
                    type="checkbox"
                    checked={autoScroll}
                    onChange={(e) => setAutoScroll(e.target.checked)}
                  />
                  Auto-scroll
                </label>
              </div>
            </div>
            {logsOpen ? (
              <div ref={logsContainerRef} className="tron-logs__body" style={{ height: logsHeight }}>
                {logs.length === 0 ? (
                  <div className="tron-log-line tron-log-line--muted">Waiting for log output…</div>
                ) : (
                  logs.map((line, index) => <LogLine key={index} raw={line} />)
                )}
              </div>
            ) : null}
          </div>
        </>
      ) : (
        <div className="tron-archives">
          <div className="tron-table-wrap" style={{ margin: 0, flex: 1, display: 'flex', flexDirection: 'column' }}>
            <div className="tron-archives__toolbar">
              <h2 className="tron-archives__title">Past runs</h2>
              <div className="tron-archives__toolbar-right">
                <button type="button" className="tron-archives__refresh" onClick={loadArchives}>
                  Refresh
                </button>
                <button
                  type="button"
                  className="tron-archives__btn-danger"
                  disabled={!selectedArchiveIds.size}
                  onClick={handleDeleteSelectedArchives}
                >
                  Delete selected
                </button>
                <button
                  type="button"
                  className="tron-archives__btn-danger"
                  disabled={!archives.length}
                  onClick={handleDeleteAllArchives}
                >
                  Delete all
                </button>
              </div>
            </div>
            {archivesLoading ? (
              <p className="tron-table__empty">Loading…</p>
            ) : archives.length === 0 ? (
              <p className="tron-table__empty">No saved reports yet. Run a suite to create one.</p>
            ) : (
              <div className="tron-table-scroll">
                <table className="tron-table">
                  <thead>
                    <tr>
                      <th style={{ width: 40 }} title="Select">
                        <input
                          type="checkbox"
                          className="tron-archives__chk"
                          checked={allArchivesSelected}
                          onChange={toggleSelectAllArchives}
                          aria-label="Select all runs"
                        />
                      </th>
                      <th>Date / Time</th>
                      <th>URL</th>
                      <th>Score %</th>
                      <th>Passed</th>
                      <th>Failed</th>
                      <th>Duration</th>
                      <th>Export</th>
                      <th>View</th>
                    </tr>
                  </thead>
                  <tbody>
                    {archives.map((row) => (
                      <tr key={row.id}>
                        <td>
                          <input
                            type="checkbox"
                            className="tron-archives__chk"
                            checked={selectedArchiveIds.has(row.id)}
                            onChange={() => toggleArchiveSelect(row.id)}
                            aria-label={`Select run ${row.id}`}
                          />
                        </td>
                        <td style={{ whiteSpace: 'nowrap' }}>{formatRunDate(row.run_date)}</td>
                        <td
                          style={{
                            maxWidth: 220,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            color: 'var(--text-secondary)'
                          }}
                          title={row.url}
                        >
                          <span>{row.url}</span>
                          {row.headless === 1 || row.headless === undefined ? (
                            <span className="tron-archives__badge-headless">Headless</span>
                          ) : null}
                        </td>
                        <td style={{ fontWeight: 600 }}>{row.score ?? 0}%</td>
                        <td style={{ color: 'var(--success)', fontWeight: 500 }}>{row.passed ?? 0}</td>
                        <td style={{ color: 'var(--danger)', fontWeight: 500 }}>{row.failed ?? 0}</td>
                        <td style={{ color: 'var(--text-secondary)' }}>
                          {row.duration_seconds != null ? `${Number(row.duration_seconds).toFixed(2)}s` : '—'}
                        </td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          <button
                            type="button"
                            className="tron-archives__btn-pdf"
                            onClick={() => handleExportArchived(row.id, 'pdf')}
                          >
                            PDF
                          </button>
                          <button
                            type="button"
                            className="tron-archives__btn-docx"
                            onClick={() => handleExportArchived(row.id, 'docx')}
                          >
                            DOCX
                          </button>
                        </td>
                        <td>
                          <button type="button" className="tron-archives__btn-view" onClick={() => handleViewReport(row.id)}>
                            View
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default MainContent
