const {
  app,
  BrowserWindow,
  Menu,
  ipcMain,
  dialog,
  shell,
  nativeImage
} = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { spawn } = require('child_process');

const db = require('./db');
const { exportToPDF, exportToDocx } = require('./exportReport');

if (process.platform === 'win32') {
  app.setAppUserModelId('com.tron.qasuite');
}
app.setName('TRON QA Suite');

const isDev = !app.isPackaged;

let mainWindow = null;
let qaProcess = null;
let qaOutBuffer = '';
let qaErrBuffer = '';
let lastSuiteUrl = null;
let lastSuiteEventSender = null;
let lastCompletedSuiteUrl = '';
let lastRunHeadless = 1;
let lastReportSnapshot = null;
/** True once after DB wipe from new `.tron_install_uid` (renderer clears localStorage URL). */
let installResetNotifyOnce = false;

function getProjectRoot() {
  return path.join(__dirname, '..');
}

function getResultsPath() {
  if (app.isPackaged) {
    return path.join(app.getPath('userData'), 'results.json');
  }
  return path.join(getProjectRoot(), 'pyengine', 'results.json');
}

/** PNG path for BrowserWindow / taskbar / exports (nativeImage, not default Electron icon). */
function getIconPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'tron-app.png');
  }
  return path.join(__dirname, '../src/assets/tron-app.png');
}

function getLogoPath() {
  const packagedFallback = path.join(process.resourcesPath, 'assets', 'tron-app.png');
  if (app.isPackaged) {
    const primary = getIconPath();
    if (fs.existsSync(primary)) return primary;
    if (fs.existsSync(packagedFallback)) return packagedFallback;
    return primary;
  }
  return getIconPath();
}

function loadNativeIconFromPath(iconPath) {
  try {
    if (!iconPath || !fs.existsSync(iconPath)) return undefined;
    const img = nativeImage.createFromPath(iconPath);
    return img.isEmpty() ? undefined : img;
  } catch (_) {
    return undefined;
  }
}

function readResultsSafe() {
  try {
    const raw = fs.readFileSync(getResultsPath(), 'utf8');
    return JSON.parse(raw);
  } catch {
    return { tests: [] };
  }
}

/** New installer build → exe dir `.tron_install_uid` changes; wipe stale Roaming data. */
function syncBundledInstallIdentity() {
  if (!app.isPackaged) return;
  const idFile = path.join(path.dirname(app.getPath('exe')), '.tron_install_uid');
  if (!fs.existsSync(idFile)) return;
  let current = '';
  try {
    current = fs.readFileSync(idFile, 'utf8').trim();
  } catch {
    return;
  }
  if (!current) return;
  const ud = app.getPath('userData');
  const seenFile = path.join(ud, 'tron_seen_install.uid');
  let prev = '';
  try {
    prev = fs.readFileSync(seenFile, 'utf8').trim();
  } catch {
    /* first run or missing */
  }
  if (prev === current) return;
  installResetNotifyOnce = true;
  try {
    db.clearAllReports();
    db.clearAllUrls();
  } catch (e) {
    console.error('[tron] install-identity wipe db:', e);
  }
  for (const f of ['results.json', 'pytest-json-report.json']) {
    try {
      fs.unlinkSync(path.join(ud, f));
    } catch {
      /* ignore */
    }
  }
  try {
    fs.mkdirSync(ud, { recursive: true });
    fs.writeFileSync(seenFile, current, 'utf8');
  } catch (e) {
    console.error('[tron] install-identity write seen:', e);
  }
}

function buildReportPayload(url, data, opts = {}) {
  const tests = data.tests || [];
  const passed = tests.filter((t) => t.status === 'PASSED').length;
  const failed = tests.filter((t) => t.status === 'FAILED').length;
  const warned = tests.filter((t) => t.status === 'WARNING').length;
  const total = tests.length;
  const score = total ? Math.round((passed / total) * 100) : 0;
  const durationSeconds = tests.reduce((a, t) => a + (Number(t.duration) || 0), 0);
  const hl = opts.headless;
  const headlessBool = hl === 0 || hl === false ? false : true;
  return {
    url: url || '',
    runDate: opts.runDate || new Date().toISOString(),
    headless: headlessBool,
    modeLabel: headlessBool ? 'Headless' : 'Browser',
    score,
    totalTests: total,
    passed,
    failed,
    warned,
    durationSeconds,
    tests
  };
}

function buildReportFromRow(row) {
  let data;
  try {
    data = JSON.parse(row.results_json || '{}');
  } catch {
    data = { tests: [] };
  }
  return buildReportPayload(row.url, data, {
    runDate: row.run_date,
    headless: row.headless != null ? row.headless : 1
  });
}

function sendToRenderer(channel, ...args) {
  const w = BrowserWindow.getFocusedWindow() || mainWindow;
  if (w && !w.isDestroyed()) w.webContents.send(channel, ...args);
}

function flushProcessLineBuffers(event, isErr) {
  let full = isErr ? qaErrBuffer : qaOutBuffer;
  const parts = full.split(/\r?\n/);
  const rest = parts.pop() || '';
  if (isErr) qaErrBuffer = rest;
  else qaOutBuffer = rest;
  for (const line of parts) {
    if (!line) continue;
    event.sender.send('log-output', (isErr ? '[stderr] ' : '') + line);
    try {
      const data = readResultsSafe();
      event.sender.send('test-results', data);
    } catch {
      /* ignore */
    }
  }
}

async function saveReportToDisk(report, format, win) {
  const isPdf = format === 'pdf';
  const ext = isPdf ? 'pdf' : 'docx';
  const filters = isPdf ? [{ name: 'PDF', extensions: ['pdf'] }] : [{ name: 'Word', extensions: ['docx'] }];
  const { filePath, canceled } = await dialog.showSaveDialog(win || null, {
    title: 'Save report',
    defaultPath: path.join(app.getPath('desktop'), `tron-qa-report-${Date.now()}.${ext}`),
    filters
  });
  if (canceled || !filePath) {
    return { ok: false, cancelled: true };
  }
  const logoPath = getLogoPath();
  if (isPdf) {
    await exportToPDF(report, filePath);
  } else {
    await exportToDocx(report, filePath, logoPath);
  }
  await shell.openPath(filePath);
  return { ok: true, path: filePath };
}

async function checkForUpdates() {
  try {
    const currentVersion = app.getVersion();
    const versionData = await new Promise((resolve, reject) => {
      https
        .get(
          'https://tronq.vercel.app/version.json',
          { headers: { 'User-Agent': 'TRON-QA-Suite/3' } },
          (res) => {
            let data = '';
            res.on('data', (chunk) => {
              data += chunk;
            });
            res.on('end', () => {
              if (res.statusCode !== 200) {
                reject(new Error(`HTTP ${res.statusCode}`));
                return;
              }
              try {
                resolve(JSON.parse(data));
              } catch (e) {
                reject(e);
              }
            });
          }
        )
        .on('error', reject);
    });

    const latestVersion = String(versionData.version || '');
    const isNewer =
      latestVersion.localeCompare(currentVersion, undefined, {
        numeric: true,
        sensitivity: 'base'
      }) > 0;

    sendToRenderer('update-available', {
      version: isNewer ? latestVersion : null,
      releaseNotes: versionData.releaseNotes || '',
      downloadUrl: versionData.downloadUrl || 'https://tronq.vercel.app/docs'
    });
  } catch (e) {
    console.error('[tron] update check failed:', e.message);
    sendToRenderer('update-available', { version: null });
  }
}

function buildApplicationMenu() {
  const iconPath = getLogoPath();
  const aboutIcon = loadNativeIconFromPath(iconPath);
  const menuTemplate = [
    {
      label: 'File',
      submenu: [
        {
          label: 'New Test Run',
          accelerator: 'CmdOrCtrl+N',
          click: () => sendToRenderer('menu-new-run')
        },
        {
          label: 'Open Report...',
          accelerator: 'CmdOrCtrl+O',
          click: () => sendToRenderer('menu-open-report')
        },
        { type: 'separator' },
        {
          label: 'Export Last Report as PDF',
          accelerator: 'CmdOrCtrl+E',
          click: () => sendToRenderer('menu-export-pdf')
        },
        {
          label: 'Export Last Report as DOCX',
          click: () => sendToRenderer('menu-export-docx')
        },
        { type: 'separator' },
        { label: 'Exit', accelerator: 'CmdOrCtrl+Q', role: 'quit' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+Plus', role: 'zoomIn' },
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', role: 'zoomOut' },
        { label: 'Reset Zoom', accelerator: 'CmdOrCtrl+0', role: 'resetZoom' },
        { type: 'separator' },
        {
          label: 'Toggle Sidebar',
          accelerator: 'CmdOrCtrl+B',
          click: () => sendToRenderer('menu-toggle-sidebar')
        },
        {
          label: 'Archives / History',
          click: () => sendToRenderer('menu-open-archives')
        },
        {
          label: 'Toggle Developer Tools',
          accelerator: 'F12',
          click: () => {
            const w = BrowserWindow.getFocusedWindow() || mainWindow;
            if (w) w.webContents.toggleDevTools();
          }
        },
        { type: 'separator' },
        { label: 'Full Screen', accelerator: 'F11', role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Tools',
      submenu: [
        {
          label: 'Preferences',
          accelerator: 'CmdOrCtrl+,',
          click: () => sendToRenderer('menu-preferences')
        },
        {
          label: 'Clear All Reports',
          click: () => sendToRenderer('menu-clear-reports')
        },
        {
          label: 'Open Logs Folder',
          click: () => shell.openPath(app.getPath('userData'))
        },
        { type: 'separator' },
        {
          label: 'Install Python Dependencies',
          click: () => sendToRenderer('menu-install-py')
        }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Check for Updates...',
          click: () => {
            checkForUpdates().catch(() => {});
          }
        },
        {
          label: 'Documentation',
          click: () => shell.openExternal('https://tronq.vercel.app/docs')
        },
        {
          label: 'Report a Bug',
          click: () =>
            shell.openExternal('mailto:ch.abdul.wahhab@proton.me?subject=TRON Bug Report')
        },
        { type: 'separator' },
        {
          label: 'About TRON',
          click: () => {
            const w = BrowserWindow.getFocusedWindow() || mainWindow;
            if (!w) return;
            dialog.showMessageBox(w, {
              type: 'info',
              title: 'About TRON',
              message: 'TRON QA Suite v3-x64',
              detail:
                'Automated Quality Verification Software\n\nAn open-source testing tool by Systemset Co\n\nhttps://tronq.vercel.app/',
              icon: aboutIcon && !aboutIcon.isEmpty() ? aboutIcon : undefined
            });
          }
        }
      ]
    }
  ];
  return Menu.buildFromTemplate(menuTemplate);
}

function createWindow() {
  const iconPath = getIconPath();
  const appIcon = loadNativeIconFromPath(iconPath);
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 1000,
    minHeight: 700,
    title: 'TRON Automated QA Suite (v3-x64)',
    icon: appIcon,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    backgroundColor: '#F4F8FF',
    show: false
  });

  Menu.setApplicationMenu(buildApplicationMenu());

  if (isDev) {
    const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:5173';
    mainWindow.loadURL(devUrl);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.webContents.once('did-finish-load', () => {
    if (appIcon && !appIcon.isEmpty()) {
      try {
        mainWindow.setIcon(appIcon);
      } catch (_) {
        /* ignore */
      }
    }
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (appIcon && !appIcon.isEmpty()) {
      try {
        mainWindow.setIcon(appIcon);
      } catch (_) {
        /* ignore */
      }
    }
  });

  return mainWindow;
}

function statIsDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function statIsFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

ipcMain.handle('run-qa-suite', async (event, payload) => {
  if (qaProcess) {
    return { ok: false, error: 'Suite already running' };
  }
  const url = typeof payload === 'string' ? payload : payload?.url;
  const headlessArg =
    typeof payload === 'object' && payload && typeof payload.headless === 'boolean'
      ? payload.headless
      : true;
  if (!url || typeof url !== 'string' || !url.trim()) {
    return { ok: false, error: 'Invalid URL' };
  }

  lastSuiteUrl = url.trim();
  lastSuiteEventSender = event.sender;
  lastRunHeadless = headlessArg ? 1 : 0;

  const writableDir = app.isPackaged
    ? app.getPath('userData')
    : path.join(getProjectRoot(), 'pyengine');

  let pythonScript;
  let pyEnginePath;

  if (app.isPackaged) {
    pyEnginePath = path.join(process.resourcesPath, 'pyengine');
    pythonScript = path.join(pyEnginePath, 'tron_engine.exe');
  } else {
    pyEnginePath = path.join(getProjectRoot(), 'pyengine');
    pythonScript = path.join(pyEnginePath, 'tron_engine.py');
  }

  const resultsJson = path.join(writableDir, 'results.json');
  const jsonReportFile = path.join(writableDir, 'pytest-json-report.json');

  const log = (msg) => {
    try {
      event.sender.send('log-output', msg);
    } catch {
      /* renderer gone */
    }
  };

  log(`[TRON] isPackaged: ${app.isPackaged}`);
  log(`[TRON] resourcesPath: ${process.resourcesPath}`);
  log(`[TRON] pyEnginePath: ${pyEnginePath}`);
  log(`[TRON] pythonScript: ${pythonScript}`);
  log(`[TRON] resultsJson: ${resultsJson}`);
  log(`[TRON] writableDir: ${writableDir}`);
  log(`[TRON] cwd is directory: ${statIsDir(pyEnginePath)}`);
  log(`[TRON] script exists (file): ${statIsFile(pythonScript)}`);

  try {
    fs.mkdirSync(writableDir, { recursive: true });
  } catch (e) {
    log(`ERROR: cannot create writable dir: ${e.message}`);
    event.sender.send('suite-complete', 1);
    return { ok: false, error: e.message };
  }

  fs.writeFileSync(resultsJson, JSON.stringify({ tests: [], updated_at: new Date().toISOString() }, null, 2));

  const engineOk = statIsDir(pyEnginePath) && statIsFile(pythonScript);
  if (!engineOk) {
    log(
      `ERROR: Engine not found — pyEnginePath dir=${statIsDir(pyEnginePath)}, script=${pythonScript}`
    );
    event.sender.send('suite-complete', 1);
    return { ok: false, error: 'Engine not found' };
  }

  qaOutBuffer = '';
  qaErrBuffer = '';

  const spawnCmd = app.isPackaged ? pythonScript : process.platform === 'win32' ? 'python' : 'python3';
  const spawnArgs = app.isPackaged
    ? ['--json-report', `--json-report-file=${jsonReportFile}`]
    : [pythonScript, '--json-report', `--json-report-file=${jsonReportFile}`];

  const pytestCacheDir = path.join(writableDir, '.tron-pytest-cache');
  const childEnv = {
    ...process.env,
    TRON_HEADLESS: headlessArg ? '1' : '0',
    TRON_RESULTS_PATH: writableDir,
    TRON_RESULTS_JSON: resultsJson,
    TRON_SUITE_URL: lastSuiteUrl,
    PYTEST_CACHE_DIR: pytestCacheDir,
    TRON_PYTEST_CACHE_DIR: pytestCacheDir
  };
  if (app.isPackaged) {
    /* Frozen: setuptools entry points missing — keep json-report + timeout plugins */
    childEnv.PYTEST_PLUGINS = 'pytest_timeout,pytest_jsonreport.plugin';
  }

  qaProcess = spawn(spawnCmd, spawnArgs, {
    cwd: pyEnginePath,
    shell: false,
    env: childEnv
  });

  const sendExit = (code) => {
    qaProcess = null;
    qaOutBuffer = '';
    qaErrBuffer = '';
    const sender = lastSuiteEventSender || event.sender;
    let data = { tests: [] };
    try {
      data = readResultsSafe();
      sender.send('test-results', data);
    } catch {
      /* ignore */
    }

    const finishedUrl = lastSuiteUrl;
    if (finishedUrl) {
      lastCompletedSuiteUrl = finishedUrl;
    }

    if (finishedUrl) {
      try {
        const tests = data.tests || [];
        const ranAny = tests.length > 0;
        if (!ranAny) {
          /* Pytest crash / bad args — empty results; do not write history row */
        } else {
          const passed = tests.filter((t) => t.status === 'PASSED').length;
          const failed = tests.filter((t) => t.status === 'FAILED').length;
          const warned = tests.filter((t) => t.status === 'WARNING').length;
          const total = tests.length;
          const score = total ? Math.round((passed / total) * 100) : 0;
          const durationSeconds = tests.reduce((a, t) => a + (Number(t.duration) || 0), 0);
          db.saveReport({
            url: finishedUrl,
            score,
            total_tests: total,
            passed,
            failed,
            warned,
            duration_seconds: durationSeconds,
            results_json: JSON.stringify(data),
            headless: lastRunHeadless
          });
          lastReportSnapshot = buildReportPayload(finishedUrl, data, {
            runDate: new Date().toISOString(),
            headless: lastRunHeadless
          });
        }
      } catch (e) {
        console.error('saveReport', e);
      }
    }

    sender.send('suite-complete', code);
    lastSuiteUrl = null;
    lastSuiteEventSender = null;
  };

  qaProcess.stdout.on('data', (chunk) => {
    qaOutBuffer += chunk.toString();
    flushProcessLineBuffers(event, false);
  });
  qaProcess.stderr.on('data', (chunk) => {
    qaErrBuffer += chunk.toString();
    flushProcessLineBuffers(event, true);
  });
  qaProcess.on('close', (code) => {
    flushProcessLineBuffers(event, false);
    flushProcessLineBuffers(event, true);
    sendExit(code ?? 0);
  });
  qaProcess.on('error', (err) => {
    event.sender.send('log-output', `[spawn error] ${err.message}`);
    sendExit(1);
  });

  return { ok: true };
});

ipcMain.handle('stop-qa-suite', async () => {
  if (!qaProcess || !qaProcess.pid) {
    return { ok: false, error: 'No suite running' };
  }
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(qaProcess.pid), '/T', '/F'], { shell: true });
    } else {
      qaProcess.kill('SIGTERM');
    }
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
  qaProcess = null;
  qaOutBuffer = '';
  qaErrBuffer = '';
  return { ok: true };
});

ipcMain.handle('save-url', async (_e, url) => {
  try {
    const list = db.saveUrl(String(url || ''));
    return { ok: true, urls: list };
  } catch (err) {
    return { ok: false, error: String(err.message || err), urls: db.getUrls() };
  }
});

ipcMain.handle('get-urls', async () => {
  try {
    return { ok: true, urls: db.getUrls() };
  } catch (err) {
    return { ok: false, error: String(err.message || err), urls: [] };
  }
});

ipcMain.handle('save-report', async (_e, payload) => {
  try {
    db.saveReport(payload);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});

ipcMain.handle('get-reports', async () => {
  try {
    return { ok: true, reports: db.getReports() };
  } catch (err) {
    return { ok: false, error: String(err.message || err), reports: [] };
  }
});

ipcMain.handle('get-report', async (_e, id) => {
  try {
    const row = db.getReportById(Number(id));
    return row || null;
  } catch (err) {
    return null;
  }
});

ipcMain.handle('open-report-json-file', async () => {
  const win = BrowserWindow.getFocusedWindow() || mainWindow;
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Open TRON report (JSON)',
    filters: [{ name: 'JSON report', extensions: ['json'] }],
    properties: ['openFile']
  });
  if (canceled || !filePaths?.[0]) {
    return { ok: false, cancelled: true };
  }
  try {
    const raw = fs.readFileSync(filePaths[0], 'utf8');
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') {
      return { ok: false, error: 'Invalid JSON file' };
    }
    const tests = Array.isArray(data.tests) ? data.tests : null;
    if (!tests) {
      return { ok: false, error: 'File must contain a "tests" array (TRON / pytest export).' };
    }
    return {
      ok: true,
      data: {
        tests,
        url: typeof data.url === 'string' ? data.url : '',
        total: data.total != null ? data.total : tests.length,
        completed: data.completed != null ? data.completed : tests.length
      }
    };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});

ipcMain.handle('clear-all-reports', async () => {
  try {
    return db.clearAllReports();
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});

ipcMain.handle('delete-reports', async (e, payload) => {
  const win = BrowserWindow.getFocusedWindow() || mainWindow;
  const dialogIcon = loadNativeIconFromPath(getIconPath());
  try {
    const deleteAll = Boolean(payload && payload.deleteAll);
    const ids = Array.isArray(payload?.ids)
      ? payload.ids.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0)
      : [];
    if (!deleteAll && !ids.length) {
      return { ok: false, error: 'Nothing selected' };
    }
    const message = deleteAll
      ? 'Delete all saved reports from history?'
      : `Delete ${ids.length} selected report(s)?`;
    const detail = deleteAll
      ? 'This cannot be undone. URL history in the sidebar is not removed.'
      : 'This cannot be undone.';
    const choice = await dialog.showMessageBox(win || null, {
      type: 'warning',
      title: 'TRON QA Suite',
      message,
      detail,
      buttons: ['Delete', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      icon: dialogIcon && !dialogIcon.isEmpty() ? dialogIcon : undefined
    });
    if (choice.response !== 0) {
      return { ok: false, cancelled: true };
    }
    if (deleteAll) {
      return db.clearAllReports();
    }
    return db.deleteReportsByIds(ids);
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});

ipcMain.handle('export-last-report', async (e, format) => {
  const win = BrowserWindow.getFocusedWindow();
  if (!lastReportSnapshot || !(lastReportSnapshot.tests || []).length) {
    return { ok: false, error: 'No completed run to export yet.' };
  }
  const fmt = format === 'docx' ? 'docx' : 'pdf';
  try {
    return await saveReportToDisk(lastReportSnapshot, fmt, win);
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});

ipcMain.handle('export-archived-report', async (e, { id, format }) => {
  const win = BrowserWindow.getFocusedWindow();
  const row = db.getReportById(Number(id));
  if (!row) {
    return { ok: false, error: 'Report not found.' };
  }
  const report = buildReportFromRow(row);
  if (!(report.tests || []).length) {
    return { ok: false, error: 'No test results in this report.' };
  }
  const fmt = format === 'docx' ? 'docx' : 'pdf';
  try {
    return await saveReportToDisk(report, fmt, win);
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});

ipcMain.handle('export-report', async () => {
  const win = BrowserWindow.getFocusedWindow();
  const resultsPath = getResultsPath();
  let data;
  try {
    data = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
  } catch {
    return { ok: false, error: 'No results.json found. Run a suite first.' };
  }
  const tests = data.tests || [];
  if (!tests.length) {
    return { ok: false, error: 'No test results to export.' };
  }

  const urlGuess = lastCompletedSuiteUrl || '';
  const report = buildReportPayload(urlGuess, data, {
    runDate: new Date().toISOString(),
    headless: lastRunHeadless
  });

  const choice = await dialog.showMessageBox(win || null, {
    type: 'question',
    message: 'Export as PDF or DOCX?',
    buttons: ['PDF', 'DOCX', 'Cancel'],
    defaultId: 0,
    cancelId: 2
  });
  if (choice.response === 2) {
    return { ok: false, cancelled: true };
  }

  const isPdf = choice.response === 0;
  const fmt = isPdf ? 'pdf' : 'docx';
  try {
    return await saveReportToDisk(report, fmt, win);
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});

ipcMain.handle('install-python-deps', async () => {
  const root = getProjectRoot();
  const req = path.join(root, 'pyengine', 'requirements.txt');
  if (!fs.existsSync(req)) {
    return { ok: false, error: 'requirements.txt missing' };
  }
  return new Promise((resolve) => {
    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
    const child = spawn(pythonCmd, ['-m', 'pip', 'install', '-r', req], {
      cwd: root,
      shell: process.platform === 'win32',
      env: { ...process.env }
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (c) => {
      out += c.toString();
    });
    child.stderr.on('data', (c) => {
      err += c.toString();
    });
    child.on('close', (code) => {
      resolve({ ok: code === 0, code, out: out.slice(-4000), err: err.slice(-4000) });
    });
    child.on('error', (e) => {
      resolve({ ok: false, error: String(e.message || e) });
    });
  });
});

ipcMain.handle('open-external', async (_e, url) => {
  if (url && typeof url === 'string') {
    await shell.openExternal(url);
  }
  return { ok: true };
});

ipcMain.handle('check-updates', async () => {
  await checkForUpdates();
  return { ok: true };
});

ipcMain.handle('get-app-version', async () => {
  return { version: app.getVersion() };
});

ipcMain.handle('get-install-reset-once', async () => {
  const reset = installResetNotifyOnce;
  installResetNotifyOnce = false;
  return { reset };
});

app.whenReady().then(() => {
  try {
    db.initDb();
    syncBundledInstallIdentity();
  } catch (e) {
    console.error('Database init failed', e);
  }
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
