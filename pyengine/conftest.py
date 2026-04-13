"""Pytest configuration: --url fixture, real-time results.json writer, JSON report compatibility."""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone

import pytest

_RESULTS_DIR = os.environ.get("TRON_RESULTS_PATH")
if _RESULTS_DIR:
    RESULTS_PATH = os.path.join(_RESULTS_DIR, "results.json")
else:
    RESULTS_PATH = os.environ.get("TRON_RESULTS_JSON") or os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "results.json"
    )


def _display_name_for_test(test_fn_name: str) -> str:
    try:
        from tron_engine import TEST_NAMES

        return TEST_NAMES.get(test_fn_name, test_fn_name)
    except Exception:
        return test_fn_name


def pytest_addoption(parser):
    parser.addoption(
        "--url",
        action="store",
        default="https://example.com",
        help="Base URL to run QA tests against",
    )


@pytest.fixture(scope="session")
def base_url(request) -> str:
    for key in ("TRON_SUITE_URL", "TRON_TARGET_URL"):
        env_u = os.environ.get(key, "").strip()
        if env_u:
            u = env_u.rstrip("/")
            if not u.startswith(("http://", "https://")):
                u = "https://" + u
            return u
    raw = request.config.getoption("--url") or "https://example.com"
    u = str(raw).strip().rstrip("/")
    if not u.startswith(("http://", "https://")):
        u = "https://" + u
    return u


def _status_display(outcome: str) -> str:
    if outcome == "passed":
        return "PASSED"
    if outcome == "failed":
        return "FAILED"
    if outcome == "skipped":
        return "WARNING"
    if outcome == "error":
        return "ERROR"
    return outcome.upper()


_CATEGORIES = (
    "performance",
    "security",
    "seo",
    "accessibility",
    "links",
    "content",
    "mobile",
    "infrastructure",
)


def _test_category(item: pytest.Item) -> str:
    for cat in _CATEGORIES:
        if item.get_closest_marker(cat):
            return cat
    return "general"


def _append_result(config: pytest.Config, item: pytest.Item, report: pytest.TestReport) -> None:
    if not hasattr(config, "_tron_tests"):
        config._tron_tests = []
    name = item.nodeid.split("::")[-1]
    duration = float(getattr(report, "duration", 0) or 0)
    msg = ""
    if report.longrepr:
        try:
            msg = str(report.longreprtext).strip()[:4000]
        except Exception:
            msg = str(report.longrepr)[:4000]
    if not msg:
        msg = _status_display(report.outcome)
    entry = {
        "name": name,
        "display_name": _display_name_for_test(name),
        "status": _status_display(report.outcome),
        "duration": round(duration, 4),
        "message": msg,
        "category": _test_category(item),
    }
    tests = config._tron_tests
    for i, t in enumerate(tests):
        if t.get("name") == name:
            tests[i] = entry
            break
    else:
        tests.append(entry)
    _flush_results(config)


def _flush_results(config: pytest.Config) -> None:
    tests = list(getattr(config, "_tron_tests", []))
    total = getattr(config, "_tron_total_tests", None)
    payload = {
        "tests": tests,
        "completed": len(tests),
        "total": total,
        "updated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }
    tmp = RESULTS_PATH + ".tmp"
    text = json.dumps(payload, indent=2)
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            f.write(text)
        os.replace(tmp, RESULTS_PATH)
    except OSError:
        try:
            with open(RESULTS_PATH, "w", encoding="utf-8") as f:
                f.write(text)
        except OSError:
            pass
        try:
            os.unlink(tmp)
        except OSError:
            pass


@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_makereport(item: pytest.Item, call: pytest.CallInfo):
    outcome = yield
    rep = outcome.get_result()
    if rep.when == "call":
        _append_result(item.config, item, rep)
    elif rep.when == "setup" and rep.outcome in ("failed", "error"):
        # Fixture/setup errors never reach "call" — still count toward completed/total.
        _append_result(item.config, item, rep)


def pytest_collection_modifyitems(config: pytest.Config, items: list) -> None:
    config._tron_total_tests = len(items)


def pytest_sessionstart(session: pytest.Session) -> None:
    session.config._tron_tests = []
    _flush_results(session.config)


def pytest_sessionfinish(session: pytest.Session, exitstatus: int) -> None:
    _flush_results(session.config)


@pytest.fixture(scope="session")
def selenium_driver(request):
    """Single Chrome session; headless controlled by TRON_HEADLESS (1=headless, 0=visible)."""
    from selenium import webdriver
    from selenium.webdriver.chrome.options import Options
    from selenium.webdriver.chrome.service import Service

    headless = os.environ.get("TRON_HEADLESS", "1") == "1"
    options = Options()
    if headless:
        options.add_argument("--headless=new")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--disable-gpu")
    options.add_argument("--window-size=1920,1080")
    if os.environ.get("TRON_QA_INSECURE_SSL", "").lower() in ("1", "true", "yes"):
        options.add_argument("--ignore-certificate-errors")
        options.add_argument("--allow-insecure-localhost")
    options.set_capability("goog:loggingPrefs", {"browser": "ALL"})

    try:
        from webdriver_manager.chrome import ChromeDriverManager

        service = Service(ChromeDriverManager().install())
        driver = webdriver.Chrome(service=service, options=options)
    except Exception as e:
        pytest.skip(f"Chrome/ChromeDriver not available: {e}")

    yield driver
    try:
        driver.quit()
    except Exception:
        pass


def pytest_configure(config: pytest.Config) -> None:
    config.addinivalue_line("markers", "performance: performance checks")
    config.addinivalue_line("markers", "security: security checks")
    config.addinivalue_line("markers", "seo: SEO checks")
    config.addinivalue_line("markers", "accessibility: a11y checks")
    config.addinivalue_line("markers", "links: link and asset checks")
    config.addinivalue_line("markers", "content: content quality")
    config.addinivalue_line("markers", "mobile: mobile / responsive")
    config.addinivalue_line("markers", "infrastructure: DNS / headers")
