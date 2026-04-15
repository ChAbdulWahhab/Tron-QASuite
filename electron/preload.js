const { contextBridge, ipcRenderer } = require('electron');

const MENU_CHANNELS = [
  'menu-new-run',
  'menu-open-report',
  'menu-open-archives',
  'menu-export-pdf',
  'menu-export-docx',
  'menu-toggle-sidebar',
  'menu-preferences',
  'menu-clear-reports',
  'menu-install-py'
];

contextBridge.exposeInMainWorld('electronAPI', {
  runQASuite: (url, headless) =>
    ipcRenderer.invoke('run-qa-suite', {
      url,
      ...(typeof headless === 'boolean' ? { headless } : {})
    }),
  stopSuite: () => ipcRenderer.invoke('stop-qa-suite'),
  exportReport: () => ipcRenderer.invoke('export-report'),
  exportLastReport: (format) => ipcRenderer.invoke('export-last-report', format),
  exportArchivedReport: (id, format) => ipcRenderer.invoke('export-archived-report', { id, format }),
  clearAllReports: () => ipcRenderer.invoke('clear-all-reports'),
  deleteReports: (payload) => ipcRenderer.invoke('delete-reports', payload),
  installPythonDeps: () => ipcRenderer.invoke('install-python-deps'),
  saveUrl: (url) => ipcRenderer.invoke('save-url', url),
  getUrls: () => ipcRenderer.invoke('get-urls'),
  getReports: () => ipcRenderer.invoke('get-reports'),
  getReport: (id) => ipcRenderer.invoke('get-report', id),
  openReportJsonFile: () => ipcRenderer.invoke('open-report-json-file'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  onLogOutput: (cb) => {
    ipcRenderer.on('log-output', (_event, line) => cb(line));
  },
  onTestResults: (cb) => {
    ipcRenderer.on('test-results', (_event, data) => cb(data));
  },
  onSuiteComplete: (cb) => {
    ipcRenderer.on('suite-complete', (_event, code) => cb(code));
  },
  checkForUpdates: () => ipcRenderer.invoke('check-updates'),
  getInstallResetOnce: () => ipcRenderer.invoke('get-install-reset-once'),
  subscribeMenu: (channel, cb) => {
    if (!MENU_CHANNELS.includes(channel)) return () => {};
    const fn = () => cb();
    ipcRenderer.on(channel, fn);
    return () => ipcRenderer.removeListener(channel, fn);
  },
  removeAllListeners: () => {
    ipcRenderer.removeAllListeners('log-output');
    ipcRenderer.removeAllListeners('test-results');
    ipcRenderer.removeAllListeners('suite-complete');
    for (const ch of MENU_CHANNELS) {
      ipcRenderer.removeAllListeners(ch);
    }
  }
});
