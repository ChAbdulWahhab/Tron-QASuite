# TRON QA Suite — working model & developer guide

**Full documentation (MkDocs, English):** folder `documentation/` — run `pip install -r documentation/requirements.txt`, then `npm run docs` or `mkdocs serve -f documentation/mkdocs.yml`. Hosting: [documentation/docs/developer/deployment.md](documentation/docs/developer/deployment.md).

TRON is a desktop app that runs automated checks against a **URL** you provide: performance, security headers, SEO, accessibility, links, mobile signals, and infrastructure. This README summarizes **end-to-end flow**, **result semantics**, and **common failure patterns** so you can tell whether the **target site** or the **tool/environment** is at fault.

---

## 1. High-level architecture

| Layer | Role |
|--------|------|
| **Electron (main)** | `electron/main.js` — window, IPC, SQLite (`electron/db.js`), spawns the Python engine, PDF/DOCX export (`electron/exportReport.js`). |
| **Preload** | Secure bridge between the React UI and Node APIs. |
| **React + Vite** | `src/` — URL input, live logs, test grid, archives, export. |
| **Python / pytest** | `pyengine/tron_engine.py` — HTTP/HTML checks; `pyengine/conftest.py` — `base_url` fixture + **streaming `results.json`**. |

**Packaged build:** Vite output in `dist/` plus Electron resources; the engine is built with **PyInstaller** into `dist/tron_engine/` and copied via `extraResources` to `resources/pyengine/`. At runtime the app spawns `tron_engine.exe` (Windows) with the env vars below.

**Dev:** the main process runs `python` / `python3` with `pyengine/tron_engine.py`.

---

## 2. Run flow (A → Z)

1. The user enters a URL and starts the suite.
2. On **`run-qa-suite`** IPC, the main process:
   - Chooses a writable directory: dev → `pyengine/`; packaged → app **userData** (e.g. `%AppData%\TRON QA Suite`).
   - **Seeds** `results.json` with an empty structure.
   - **Spawns:**
     - **Packaged:** `resources/pyengine/tron_engine.exe` with `--json-report` and `--json-report-file=...`
     - **Dev:** `python` / `python3` + `pyengine/tron_engine.py` + same args
3. **Environment** (important):
   - `TRON_SUITE_URL` — target URL (also resolved from CLI `--url` in `conftest`; env wins — see `conftest.py`).
   - `TRON_RESULTS_PATH` — directory for `results.json`.
   - `TRON_HEADLESS` — `1` = headless Chrome (Selenium), `0` = visible browser.
   - `PYTEST_CACHE_DIR` / `TRON_PYTEST_CACHE_DIR` — isolated pytest cache under userData or `pyengine/`.
   - `TRON_QA_INSECURE_SSL` — `1`/`true` relaxes TLS verification and urllib3 warnings; **cert validity/expiry tests skip** when verify is off (see engine).
4. **pytest** collects tests; after each **call**, `conftest` updates `results.json` (atomic replace via `.tmp`).
5. Main forwards stdout/stderr as `log-output`; after each full line it may re-read `results.json` and send `test-results` for **live** UI updates.
6. On process **exit:**
   - Final `test-results` + `suite-complete` (exit code).
   - If any test ran, a row may be saved to **SQLite** (`db.saveReport`) and shown under **Archives**.
7. **PDF/DOCX** export uses `exportReport.js` from the last snapshot or saved row.

**Fresh install identity:** if `.tron_install_uid` next to the exe changes, old userData (reports, URLs, results files) may be wiped so a new build does not show stale history (`syncBundledInstallIdentity` in `main.js`).

---

## 3. Status labels

Mapping `pyengine/conftest.py` → UI:

| Pytest outcome | UI `status` | Meaning |
|----------------|-------------|---------|
| `passed` | **PASSED** | Assertion passed. |
| `failed` | **FAILED** | Assertion or `pytest.fail` — usually **site/config** or content. |
| `skipped` | **WARNING** | Test **not run** — preconditions failed. **Not** a pass. |
| `error` (setup/teardown) | **ERROR** | Fixture/import/environment — usually the **machine**. |

**Note:** pytest “skipped” is shown as **WARNING** in the UI.

**Suite exit code:** non-zero when tests fail is normal. **Empty results** (crash, no tests collected) may skip history save.

---

## 4. Site vs tool (quick triage)

**Most FAILED = site / deployment**

- Slow TTFB / load (thresholds in `tron_engine.py`).
- Missing security headers (XFO, XCTO, CSP), HSTS on HTTPS.
- SEO, mixed content, broken assets, a11y heuristics, etc.

**WARNING = often N/A**

- HTTP URL → HTTPS-only tests skip.
- `TRON_QA_INSECURE_SSL=1` → some SSL tests skip.
- Missing Chrome → Selenium tests skip (**WARNING** + message).

**ERROR = environment**

- Missing Python deps, bad engine path, cannot write userData.

---

## 5. Categories

Markers: `performance`, `security`, `seo`, `accessibility`, `links`, `content`, `mobile`, `infrastructure`.

**Source of truth:** `pyengine/tron_engine.py` — `TEST_NAMES` + each `test_*`.

---

## 6. Security / SSL

- Default TLS uses the **certifi** bundle when verification is on.
- **`TRON_QA_INSECURE_SSL`:** lab-only; avoid for production-style QA.

---

## 7. Local development

**Prerequisites:** Node.js, Python 3, pip.

```bash
npm install
npm run install-py    # pip install -r pyengine/requirements.txt
npm run dev           # Vite + Electron
```

**Web assets only:** `npm run build`

**Frozen engine:**

```bash
npm run build
npm run build:engine   # pyinstaller tron.spec → dist/tron_engine/
```

Then `electron-builder` (`package.json` scripts). Icons and installer art live in `branding/`.

---

## 8. Documentation expansion (MkDocs)

The MkDocs site under `documentation/docs/` already covers install, user guide, reference, FAQ, and **hosting**. Optional next steps: screenshots, video, per-release changelog pages.

---

## 9. Repo layout

- `electron/` — main process, DB, export, preload  
- `src/` — React UI, assets  
- `pyengine/` — pytest suite, `conftest.py`, `requirements.txt`  
- `branding/` — icons, installer artwork  
- `documentation/` — MkDocs sources and config  
- `scripts/` — e.g. `afterPack.js`

---

## License

See `LICENSE.txt` in the repository root.
