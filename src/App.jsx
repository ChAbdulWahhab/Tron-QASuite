import { useState, useCallback, useRef, useEffect } from 'react'
import Sidebar from './components/Sidebar.jsx'
import MainContent from './components/MainContent.jsx'
import SplashScreen from './components/SplashScreen.jsx'
import './index.css'

const INITIAL_INSIGHTS = {
  security: 'Security: —',
  seo: 'SEO: —',
  vitals: 'Vitals: —'
}

function computeInsights(tests) {
  const line = (cat, prefix) => {
    const fails = tests.filter((t) => t.category === cat && t.status === 'FAILED').length
    return fails === 0 ? `${prefix}: OK` : `${prefix}: ${fails} issue(s)`
  }
  return {
    security: line('security', 'Security'),
    seo: line('seo', 'SEO'),
    vitals: line('performance', 'Vitals')
  }
}

function computeStats(tests) {
  const pass = tests.filter((t) => t.status === 'PASSED').length
  const fail = tests.filter((t) => t.status === 'FAILED').length
  const warn = tests.filter((t) => t.status === 'WARNING').length
  const total = tests.length
  const scorePct = total ? Math.round((pass / total) * 100) : 0
  const timeSec = tests.reduce((a, t) => a + (Number(t.duration) || 0), 0)
  return { pass, fail, warn, total, scorePct, timeSec }
}

function App() {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [sidebarWidth, setSidebarWidth] = useState(248)
  const [logsHeight, setLogsHeight] = useState(200)
  const [mainTab, setMainTab] = useState('live')
  const [isHeadless, setIsHeadless] = useState(true)
  const [isRunning, setIsRunning] = useState(false)
  const [targetUrl, setTargetUrl] = useState(() => {
    try {
      return localStorage.getItem('tronTargetUrl') || ''
    } catch {
      return ''
    }
  })
  const [logs, setLogs] = useState([])
  const [testRows, setTestRows] = useState([])
  const [resultMeta, setResultMeta] = useState({ total: null, completed: 0 })
  const [insights, setInsights] = useState(INITIAL_INSIGHTS)
  const [updateBanner, setUpdateBanner] = useState(null)
  const [appVersion, setAppVersion] = useState('v3')
  const [showSplash, setShowSplash] = useState(true)
  const testsRef = useRef([])

  const stats = computeStats(testRows)
  const progressDen = resultMeta.total || stats.total || 0
  const progressDone = Math.max(resultMeta.completed || 0, stats.total)
  const progressPct =
    progressDen > 0 ? Math.min(100, Math.round((progressDone / progressDen) * 100)) : 0

  useEffect(() => {
    let cancelled = false
    let timeoutId = null
    const start = performance.now()
    const minShowMs = 950
    const rafId = window.requestAnimationFrame(() => {
      const elapsed = performance.now() - start
      const wait = Math.max(0, minShowMs - elapsed)
      timeoutId = window.setTimeout(() => {
        if (!cancelled) setShowSplash(false)
      }, wait)
    })
    return () => {
      cancelled = true
      window.cancelAnimationFrame(rafId)
      if (timeoutId != null) window.clearTimeout(timeoutId)
    }
  }, [])

  useEffect(() => {
    const api = typeof window !== 'undefined' ? window.electronAPI : null
    if (!api?.getAppVersion) return
    api.getAppVersion().then((r) => {
      if (r?.version) setAppVersion(`v${r.version}`)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (showSplash) return
    const api = typeof window !== 'undefined' ? window.electronAPI : null
    if (!api?.checkForUpdates) return
    const timer = setTimeout(() => {
      api.checkForUpdates()
    }, 1000)
    return () => clearTimeout(timer)
  }, [showSplash])

  useEffect(() => {
    const api = typeof window !== 'undefined' ? window.electronAPI : null
    if (!api?.onUpdateAvailable) return undefined
    const unsub = api.onUpdateAvailable((payload) => {
      setUpdateBanner(payload?.version ? payload : null)
    })
    return () => {
      if (typeof unsub === 'function') unsub()
    }
  }, [])

  useEffect(() => {
    const api = typeof window !== 'undefined' ? window.electronAPI : null
    if (!api) return undefined

    if (api.getInstallResetOnce) {
      api.getInstallResetOnce().then((r) => {
        if (r?.reset) {
          try {
            localStorage.removeItem('tronTargetUrl')
          } catch {
            /* ignore */
          }
          setTargetUrl('')
        }
      })
    }

    api.onLogOutput((line) => {
      setLogs((prev) => [...prev, line])
    })

    api.onTestResults((data) => {
      const tests = data.tests || []
      testsRef.current = tests
      setTestRows(tests)
      setResultMeta({
        total: data.total != null ? data.total : null,
        completed: data.completed != null ? data.completed : tests.length
      })
    })

    api.onSuiteComplete(() => {
      setIsRunning(false)
      setInsights(computeInsights(testsRef.current))
      setResultMeta((m) => {
        const fromMeta = m.total != null && m.total > 0 ? m.total : 0
        const t = Math.max(fromMeta, testsRef.current.length)
        return { total: t, completed: t }
      })
    })

    return () => {
      api.removeAllListeners?.()
    }
  }, [])

  const applyReportPayload = useCallback((payload) => {
    const tests = payload?.tests || []
    setTestRows(tests)
    testsRef.current = tests
    setResultMeta({
      total: payload?.total ?? tests.length,
      completed: payload?.completed ?? tests.length
    })
    if (typeof payload?.url === 'string' && payload.url.trim()) {
      setTargetUrl(payload.url.trim())
    }
    setInsights(computeInsights(tests))
  }, [])

  const applyArchivedReport = useCallback(
    (row) => {
      let data = {}
      try {
        data = JSON.parse(row.results_json || '{}')
      } catch {
        data = {}
      }
      applyReportPayload({
        tests: data.tests || [],
        url: row.url,
        total: row.total_tests,
        completed: row.total_tests
      })
    },
    [applyReportPayload]
  )

  useEffect(() => {
    const api = window.electronAPI
    if (!api?.subscribeMenu) return undefined
    const subs = [
      api.subscribeMenu('menu-toggle-sidebar', () => setSidebarOpen((o) => !o)),
      api.subscribeMenu('menu-new-run', () => {
        setSidebarOpen(true)
        setLogs([])
        setTestRows([])
        setInsights(INITIAL_INSIGHTS)
        setResultMeta({ total: null, completed: 0 })
        testsRef.current = []
        setMainTab('live')
      }),
      api.subscribeMenu('menu-open-report', async () => {
        const res = await api.openReportJsonFile?.()
        if (res?.ok && res.data) {
          applyReportPayload(res.data)
          setMainTab('live')
          setSidebarOpen(true)
        } else if (res && !res.cancelled && res.error) {
          setLogs((p) => [...p, `[ui] Open report: ${res.error}`])
        }
      }),
      api.subscribeMenu('menu-open-archives', () => setMainTab('archives')),
      api.subscribeMenu('menu-export-pdf', async () => {
        const res = await api.exportLastReport?.('pdf')
        if (res?.ok) setLogs((p) => [...p, `[ui] Report saved: ${res.path}`])
        else if (res && !res.cancelled) setLogs((p) => [...p, `[ui] Export: ${res.error || 'failed'}`])
      }),
      api.subscribeMenu('menu-export-docx', async () => {
        const res = await api.exportLastReport?.('docx')
        if (res?.ok) setLogs((p) => [...p, `[ui] Report saved: ${res.path}`])
        else if (res && !res.cancelled) setLogs((p) => [...p, `[ui] Export: ${res.error || 'failed'}`])
      }),
      api.subscribeMenu('menu-clear-reports', async () => {
        const res = await api.deleteReports?.({ deleteAll: true })
        if (res?.ok) setLogs((p) => [...p, '[ui] All reports cleared.'])
        else if (res?.cancelled) {
          /* user dismissed confirm */
        } else setLogs((p) => [...p, `[ui] Clear reports failed: ${res?.error || 'unknown'}`])
      }),
      api.subscribeMenu('menu-install-py', async () => {
        setLogs((p) => [...p, '[ui] Installing Python dependencies…'])
        const res = await api.installPythonDeps?.()
        if (res?.ok) setLogs((p) => [...p, '[ui] pip install finished OK.'])
        else setLogs((p) => [...p, `[ui] pip install: ${res?.error || res?.err || 'failed'}`])
      }),
      api.subscribeMenu('menu-preferences', () => {
        setSidebarOpen(true)
        setMainTab('live')
        setLogs((p) => [...p, '[ui] Preferences: set URL and Headless in the sidebar.'])
      })
    ]
    return () => subs.forEach((u) => typeof u === 'function' && u())
  }, [applyReportPayload])

  const sidebarRef = useRef(null)

  const handleSidebarResize = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startWidth = sidebarWidth
    const onMouseMove = (moveE) => {
      const newWidth = startWidth + (moveE.clientX - startX)
      setSidebarWidth(Math.max(220, Math.min(340, newWidth)))
    }
    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [sidebarWidth])

  const handleLogsResize = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    const startY = e.clientY
    const startHeight = logsHeight
    const onMouseMove = (moveE) => {
      const newHeight = startHeight + (startY - moveE.clientY)
      setLogsHeight(Math.max(80, Math.min(500, newHeight)))
    }
    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [logsHeight])

  const runSuite = useCallback(async () => {
    const api = window.electronAPI
    if (!api?.runQASuite) {
      setLogs((p) => [...p, '[ui] Electron API not available (open via npm run dev)'])
      return
    }
    setLogs([])
    setTestRows([])
    setInsights(INITIAL_INSIGHTS)
    setResultMeta({ total: null, completed: 0 })
    testsRef.current = []
    setIsRunning(true)
    const res = await api.runQASuite(targetUrl, isHeadless)
    if (!res?.ok) {
      setIsRunning(false)
      setLogs((p) => [...p, `[ui] ${res?.error || 'Could not start suite'}`])
    }
  }, [targetUrl, isHeadless])

  const stopSuite = useCallback(async () => {
    const api = window.electronAPI
    if (!api?.stopSuite) return
    await api.stopSuite()
  }, [])

  const openTronSite = () => {
    window.electronAPI?.openExternal?.('https://tronq.vercel.app/')
  }

  return (
    <div className="tron-app tron-app--column">
      <SplashScreen visible={showSplash} />
      <div className="tron-app__body">
        {sidebarOpen ? (
          <div ref={sidebarRef} className="relative tron-app__sidebar" style={{ width: `${sidebarWidth}px` }}>
            <Sidebar
              sidebarWidth={sidebarWidth}
              targetUrl={targetUrl}
              onTargetUrlChange={setTargetUrl}
              insights={insights}
              isHeadless={isHeadless}
              onHeadlessChange={setIsHeadless}
              isRunning={isRunning}
              onRunSuite={runSuite}
              onStopSuite={stopSuite}
              onToggleSidebar={() => setSidebarOpen(false)}
            />
            <div className="tron-resize-gutter" onMouseDown={handleSidebarResize} />
          </div>
        ) : null}
        <div className="tron-main-shell">
          <MainContent
            logsHeight={logsHeight}
            onLogsResize={handleLogsResize}
            logs={logs}
            testRows={testRows}
            stats={stats}
            progressPct={progressPct}
            onApplyArchivedReport={applyArchivedReport}
            activeTab={mainTab}
            onTabChange={setMainTab}
            isRunning={isRunning}
            sidebarOpen={sidebarOpen}
            onOpenSidebar={() => setSidebarOpen(true)}
            updateVersion={updateBanner?.version}
            appVersion={appVersion}
          />
        </div>
      </div>
      <div className="tron-statusbar">
        <span className="tron-statusbar__brand">TRON</span>
        <span className="tron-statusbar__muted">QA Suite {appVersion}</span>
        <span className="tron-statusbar__dot" aria-hidden />
        <span className="tron-statusbar__muted">Systemset Co.</span>
        <div className="tron-statusbar__spacer" />
        <span className="tron-statusbar__url" title={targetUrl || undefined}>
          {targetUrl ? targetUrl : '—'}
        </span>
        <span className="tron-statusbar__dot" aria-hidden />
        <span className={isRunning ? 'tron-statusbar__run tron-statusbar__run--on' : 'tron-statusbar__run'}>
          {isRunning ? 'Running' : 'Ready'}
        </span>
        <span className="tron-statusbar__dot" aria-hidden />
        <button type="button" className="tron-statusbar__link" onClick={openTronSite}>
          Website
        </button>
      </div>
    </div>
  )
}

export default App
