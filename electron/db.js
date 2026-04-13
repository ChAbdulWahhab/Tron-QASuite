const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { app } = require('electron');

const ENCRYPTION_KEY = 'tron-qa-2026-systemset-secure-key-32b';

let db = null;
let useFallback = false;
let fallbackPath = '';
let dbFilePath = '';
let backupPath = '';

function key32() {
  return Buffer.from(String(ENCRYPTION_KEY).padEnd(32, ' ').slice(0, 32), 'utf8');
}

function encrypt(text) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key32(), iv);
  const enc = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}:${enc.toString('hex')}`;
}

function decryptStored(str) {
  if (str == null || str === '') return '{}';
  const s = String(str).trim();
  if (s.startsWith('{') || s.startsWith('[')) {
    return s;
  }
  const parts = s.split(':');
  if (parts.length < 2) return s;
  try {
    const iv = Buffer.from(parts[0], 'hex');
    const data = Buffer.from(parts.slice(1).join(':'), 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', key32(), iv);
    const dec = Buffer.concat([decipher.update(data), decipher.final()]);
    return dec.toString('utf8');
  } catch {
    return s;
  }
}

/** Public alias: AES column values + legacy plain JSON. */
const decrypt = decryptStored;

/** SQLite stores CURRENT_TIMESTAMP as UTC "YYYY-MM-DD HH:MM:SS" without Z — normalize for JS Date. */
function sqliteUtcToIso(value) {
  if (value == null) return value;
  const s = String(value).trim();
  if (!s) return value;
  if (/^\d{4}-\d{2}-\d{2}T/.test(s) && (/Z$/i.test(s) || /[+-]\d{2}:?\d{2}$/.test(s))) {
    return s;
  }
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(\.\d{1,3})?$/);
  if (m) return `${m[1]}T${m[2]}${m[3] || ''}Z`;
  return s;
}

const SCHEMA = `
    CREATE TABLE IF NOT EXISTS urls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT UNIQUE NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL,
      run_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      score INTEGER,
      total_tests INTEGER,
      passed INTEGER,
      failed INTEGER,
      warned INTEGER,
      duration_seconds REAL,
      results_json TEXT,
      headless INTEGER DEFAULT 1
    );
  `;

function migrateSqlite() {
  if (!db) return;
  try {
    db.pragma('key = "tron2026systemset"');
  } catch {
    /* ignored without SQLCipher */
  }
  const cols = db.prepare('PRAGMA table_info(reports)').all();
  const names = cols.map((c) => c.name);
  if (!names.includes('headless')) {
    db.exec('ALTER TABLE reports ADD COLUMN headless INTEGER DEFAULT 1');
  }
}

function readFallback() {
  try {
    const raw = fs.readFileSync(fallbackPath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return { urls: [], reports: [] };
  }
}

function writeFallback(data) {
  fs.mkdirSync(path.dirname(fallbackPath), { recursive: true });
  fs.writeFileSync(fallbackPath, JSON.stringify(data, null, 2), 'utf8');
}

function writeEncryptedBackup() {
  try {
    let payload;
    if (useFallback) {
      payload = readFallback();
    } else if (db) {
      const reports = db.prepare('SELECT * FROM reports ORDER BY run_date DESC').all();
      const urls = db.prepare('SELECT * FROM urls ORDER BY created_at DESC').all();
      payload = { reports, urls };
    } else {
      return;
    }
    fs.mkdirSync(path.dirname(backupPath), { recursive: true });
    fs.writeFileSync(backupPath, encrypt(JSON.stringify(payload)), 'utf8');
  } catch (e) {
    console.warn('[tron db] backup write failed:', e.message);
  }
}

function initFallback() {
  fallbackPath = path.join(app.getPath('userData'), 'tron_qa_fallback.json');
}

function initDb() {
  const userData = app.getPath('userData');
  const legacyDb = path.join(userData, 'tron_qa.db');
  dbFilePath = path.join(userData, 'tron_qa.dat');
  backupPath = path.join(userData, 'tron_qa_backup.enc');

  try {
    if (fs.existsSync(legacyDb) && !fs.existsSync(dbFilePath)) {
      fs.renameSync(legacyDb, dbFilePath);
    }
  } catch (e) {
    console.warn('[tron db] migrate .db → .dat:', e.message);
  }

  try {
    const Database = require('better-sqlite3');
    db = new Database(dbFilePath);
    db.pragma('journal_mode = WAL');
    db.exec(SCHEMA);
    migrateSqlite();
    useFallback = false;
  } catch (err) {
    console.warn('[tron db] better-sqlite3 failed, using JSON fallback:', err.message);
    db = null;
    useFallback = true;
    initFallback();
    if (!fs.existsSync(fallbackPath)) {
      writeFallback({ urls: [], reports: [] });
    }
  }
}

function saveUrl(url) {
  if (!url || !String(url).trim()) return getUrls();
  const u = String(url).trim();
  if (useFallback) {
    const data = readFallback();
    if (!data.urls.some((x) => x.url === u)) {
      data.urls.unshift({
        id: data.urls.length ? Math.max(...data.urls.map((x) => x.id)) + 1 : 1,
        url: u,
        created_at: new Date().toISOString()
      });
    }
    writeFallback(data);
    writeEncryptedBackup();
    return getUrls();
  }
  db.prepare('INSERT OR IGNORE INTO urls (url) VALUES (?)').run(u);
  writeEncryptedBackup();
  return getUrls();
}

function getUrls() {
  if (useFallback) {
    const data = readFallback();
    return [...data.urls].sort(
      (a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)
    );
  }
  if (!db) return [];
  return db
    .prepare('SELECT id, url, created_at FROM urls ORDER BY created_at DESC')
    .all()
    .map((row) => ({ ...row, created_at: sqliteUtcToIso(row.created_at) }));
}

function saveReport(data) {
  if (!data) return { ok: false };
  const rawJson =
    typeof data.results_json === 'string'
      ? data.results_json
      : JSON.stringify(data.results_json ?? {});
  const resultsJson = encrypt(rawJson);
  const headlessVal = data.headless === false || data.headless === 0 ? 0 : 1;

  if (useFallback) {
    const store = readFallback();
    const id = store.reports.length ? Math.max(...store.reports.map((r) => r.id)) + 1 : 1;
    store.reports.unshift({
      id,
      url: data.url,
      run_date: new Date().toISOString(),
      score: data.score ?? 0,
      total_tests: data.total_tests ?? 0,
      passed: data.passed ?? 0,
      failed: data.failed ?? 0,
      warned: data.warned ?? 0,
      duration_seconds: data.duration_seconds ?? 0,
      results_json: resultsJson,
      headless: headlessVal
    });
    writeFallback(store);
    writeEncryptedBackup();
    return { ok: true };
  }
  if (!db) return { ok: false };
  db.prepare(
    `INSERT INTO reports (url, score, total_tests, passed, failed, warned, duration_seconds, results_json, headless)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    data.url,
    data.score ?? 0,
    data.total_tests ?? 0,
    data.passed ?? 0,
    data.failed ?? 0,
    data.warned ?? 0,
    data.duration_seconds ?? 0,
    resultsJson,
    headlessVal
  );
  writeEncryptedBackup();
  return { ok: true };
}

function getReports() {
  if (useFallback) {
    return readFallback().reports.map((r) => ({
      id: r.id,
      url: r.url,
      run_date: r.run_date,
      score: r.score,
      total_tests: r.total_tests,
      passed: r.passed,
      failed: r.failed,
      warned: r.warned,
      duration_seconds: r.duration_seconds,
      headless: r.headless != null ? r.headless : 1
    }));
  }
  if (!db) return [];
  return db
    .prepare(
      `SELECT id, url, run_date, score, total_tests, passed, failed, warned, duration_seconds, headless
       FROM reports ORDER BY run_date DESC`
    )
    .all()
    .map((row) => ({ ...row, run_date: sqliteUtcToIso(row.run_date) }));
}

function getReportById(id) {
  if (useFallback) {
    const r = readFallback().reports.find((x) => x.id === Number(id));
    if (!r) return null;
    const plain = decrypt(r.results_json);
    return { ...r, results_json: plain };
  }
  if (!db) return null;
  const row = db.prepare('SELECT * FROM reports WHERE id = ?').get(id);
  if (!row) return null;
  const plain = decrypt(row.results_json);
  return { ...row, run_date: sqliteUtcToIso(row.run_date), results_json: plain };
}

function clearAllReports() {
  if (useFallback) {
    const data = readFallback();
    data.reports = [];
    writeFallback(data);
    writeEncryptedBackup();
    return { ok: true };
  }
  if (!db) return { ok: false };
  db.exec('DELETE FROM reports');
  writeEncryptedBackup();
  return { ok: true };
}

function clearAllUrls() {
  if (useFallback) {
    const data = readFallback();
    data.urls = [];
    writeFallback(data);
    writeEncryptedBackup();
    return { ok: true };
  }
  if (!db) return { ok: false };
  db.exec('DELETE FROM urls');
  writeEncryptedBackup();
  return { ok: true };
}

function deleteReportsByIds(ids) {
  const list = Array.isArray(ids)
    ? ids.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0)
    : [];
  if (!list.length) return { ok: false, error: 'No ids' };
  if (useFallback) {
    const data = readFallback();
    const set = new Set(list);
    data.reports = data.reports.filter((r) => !set.has(Number(r.id)));
    writeFallback(data);
    writeEncryptedBackup();
    return { ok: true, deleted: list.length };
  }
  if (!db) return { ok: false };
  const placeholders = list.map(() => '?').join(',');
  const info = db.prepare(`DELETE FROM reports WHERE id IN (${placeholders})`).run(...list);
  writeEncryptedBackup();
  return { ok: true, deleted: Number(info.changes || 0) };
}

module.exports = {
  initDb,
  saveUrl,
  getUrls,
  saveReport,
  getReports,
  getReportById,
  clearAllReports,
  clearAllUrls,
  deleteReportsByIds,
  decrypt,
  decryptStored
};
