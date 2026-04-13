"""
TRON full QA test suite — run with: python tron_engine.py --url https://example.com
Or: pytest tron_engine.py --url=https://example.com --timeout=10
"""

from __future__ import annotations

import http.client
import os
import re
import ssl
import socket
import sys
import time

import certifi
import urllib3

if os.environ.get("TRON_QA_INSECURE_SSL", "").lower() in ("1", "true", "yes"):
    urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
from datetime import datetime, timezone
from html.parser import HTMLParser
from urllib.parse import urljoin, urlparse

import pytest
import requests
from bs4 import BeautifulSoup

TIMEOUT = 10
HEADERS = {"User-Agent": "TronQA/2.0"}

TEST_NAMES = {
    "test_page_load_time": "Page Load Time",
    "test_time_to_first_byte": "Time to First Byte (TTFB)",
    "test_response_size": "Response Size Check",
    "test_compression_enabled": "Compression Enabled (gzip/brotli)",
    "test_cache_headers": "Cache-Control Headers",
    "test_https_enforced": "HTTPS Enforcement",
    "test_ssl_certificate_valid": "SSL Certificate Validity",
    "test_ssl_certificate_expiry": "SSL Certificate Expiry (30d)",
    "test_security_headers": "Security Headers (X-Frame, CSP)",
    "test_hsts_header": "HSTS Header Present",
    "test_cors_policy": "CORS Policy Check",
    "test_sensitive_files_exposed": "Sensitive Files Exposure",
    "test_directory_listing": "Directory Listing Disabled",
    "test_cookie_security": "Cookie Security Flags",
    "test_mixed_content": "Mixed Content (HTTP on HTTPS)",
    "test_meta_title": "Meta Title Tag",
    "test_meta_description": "Meta Description Tag",
    "test_meta_viewport": "Meta Viewport Tag",
    "test_canonical_url": "Canonical URL Tag",
    "test_robots_txt": "robots.txt Present",
    "test_sitemap_xml": "sitemap.xml Present",
    "test_open_graph_tags": "Open Graph Tags",
    "test_heading_structure": "Heading Structure (H1)",
    "test_image_alt_tags": "Image Alt Attributes",
    "test_structured_data": "Structured Data (JSON-LD)",
    "test_lang_attribute": "HTML Lang Attribute",
    "test_form_labels": "Form Input Labels",
    "test_button_text": "Button Accessible Text",
    "test_link_text": "Link Descriptive Text",
    "test_color_contrast_basic": "Color Contrast Basic Check",
    "test_skip_navigation": "Skip Navigation Link",
    "test_aria_landmarks": "ARIA Landmarks (main/nav/header)",
    "test_internal_links": "Internal Links Reachable",
    "test_external_links_sample": "External Links Sample Check",
    "test_image_sources": "Image Sources Reachable",
    "test_css_sources": "CSS Files Reachable",
    "test_js_sources": "JavaScript Files Reachable",
    "test_favicon_exists": "Favicon Present",
    "test_no_lorem_ipsum": "No Placeholder Text",
    "test_no_broken_html": "Well-Formed HTML",
    "test_404_page_exists": "Custom 404 Page",
    "test_page_encoding": "UTF-8 Charset Declared",
    "test_no_console_errors": "No JavaScript Console Errors",
    "test_viewport_meta": "Viewport Meta Tag",
    "test_touch_icons": "Apple Touch Icon",
    "test_mobile_rendering": "Mobile Rendering (375px)",
    "test_dns_resolves": "DNS Resolution",
    "test_www_redirect": "WWW Redirect Behavior",
    "test_server_header_info": "Server Header Info Exposure",
    "test_x_powered_by_hidden": "X-Powered-By Header Hidden",
    "test_content_type_header": "Content-Type Header",
}
# Set TRON_QA_INSECURE_SSL=1 only if your environment cannot verify TLS (e.g. custom MITM CA).
_VERIFY_SSL = os.environ.get("TRON_QA_INSECURE_SSL", "").lower() not in ("1", "true", "yes")


def _ssl_context():
    if _VERIFY_SSL:
        return ssl.create_default_context(cafile=certifi.where())
    return ssl._create_unverified_context()


def _get(url: str, **kwargs) -> requests.Response:
    kwargs.setdefault("timeout", TIMEOUT)
    kwargs.setdefault("headers", HEADERS)
    kwargs.setdefault("allow_redirects", True)
    kwargs.setdefault("verify", certifi.where() if _VERIFY_SSL else False)
    return requests.get(url, **kwargs)


def _head(url: str, **kwargs) -> requests.Response:
    kwargs.setdefault("timeout", TIMEOUT)
    kwargs.setdefault("headers", HEADERS)
    kwargs.setdefault("allow_redirects", True)
    kwargs.setdefault("verify", certifi.where() if _VERIFY_SSL else False)
    return requests.head(url, **kwargs)


def _soup_from_response(r: requests.Response) -> BeautifulSoup:
    return BeautifulSoup(r.content, "lxml")


def _host(base_url: str) -> str:
    return urlparse(base_url).netloc.split("@")[-1]


def _scheme(base_url: str) -> str:
    return urlparse(base_url).scheme.lower()


def _absolute(base_url: str, href: str) -> str | None:
    if not href or href.startswith(("#", "javascript:", "mailto:", "tel:")):
        return None
    return urljoin(base_url + "/", href)


# --- PERFORMANCE ---


@pytest.mark.performance
def test_page_load_time(base_url: str):
    t0 = time.perf_counter()
    r = _get(base_url)
    elapsed = time.perf_counter() - t0
    assert r.status_code < 500, f"HTTP {r.status_code}"
    assert elapsed < 3.0, f"FAIL: load took {elapsed:.2f}s (max 3s)"


@pytest.mark.performance
def test_time_to_first_byte(base_url: str):
    t0 = time.perf_counter()
    r = _get(base_url, stream=True)
    next(r.iter_content(1))
    r.close()
    ttfb = time.perf_counter() - t0
    assert ttfb < 0.6, f"FAIL: TTFB {ttfb*1000:.0f}ms (max 600ms)"


@pytest.mark.performance
def test_response_size(base_url: str):
    r = _get(base_url)
    n = len(r.content)
    assert n < 5 * 1024 * 1024, f"FAIL: body {n} bytes (max 5MB)"


@pytest.mark.performance
def test_compression_enabled(base_url: str):
    p = urlparse(base_url)
    path = p.path or "/"
    if p.query:
        path += "?" + p.query
    if p.scheme == "https":
        conn = http.client.HTTPSConnection(p.netloc, timeout=TIMEOUT, context=_ssl_context())
    else:
        conn = http.client.HTTPConnection(p.netloc, timeout=TIMEOUT)
    try:
        conn.request(
            "GET",
            path,
            headers={
                "Host": p.netloc,
                "User-Agent": HEADERS["User-Agent"],
                "Accept-Encoding": "gzip, deflate, br",
            },
        )
        resp = conn.getresponse()
        resp.read(1024)
        ce = (resp.getheader("Content-Encoding") or "").lower()
    finally:
        conn.close()
    ok = "gzip" in ce or "br" in ce or "deflate" in ce
    assert ok, "FAIL: gzip/brotli/deflate not indicated in Content-Encoding"


@pytest.mark.performance
def test_cache_headers(base_url: str):
    r = _get(base_url)
    cc = r.headers.get("Cache-Control") or r.headers.get("Expires")
    assert cc, "FAIL: no Cache-Control or Expires header"


# --- SECURITY ---


@pytest.mark.security
def test_https_enforced(base_url: str):
    if not base_url.lower().startswith("https://"):
        pytest.skip("Base URL is not HTTPS")
    p = urlparse(base_url)
    http_url = f"http://{p.netloc}{p.path or '/'}"
    if p.query:
        http_url += "?" + p.query
    try:
        r = _get(http_url, allow_redirects=False)
    except requests.RequestException:
        pytest.skip("HTTP endpoint not reachable")
    loc = (r.headers.get("Location") or "").lower()
    assert r.status_code in (301, 302, 307, 308) and loc.startswith("https://"), (
        "FAIL: HTTP does not redirect to HTTPS"
    )


@pytest.mark.security
def test_ssl_certificate_valid(base_url: str):
    if _scheme(base_url) != "https":
        pytest.skip("Not HTTPS")
    if not _VERIFY_SSL:
        pytest.skip("Peer cert dict requires verified TLS (unset TRON_QA_INSECURE_SSL)")
    host = _host(base_url)
    port = 443
    ctx = _ssl_context()
    with socket.create_connection((host, port), timeout=TIMEOUT) as sock:
        with ctx.wrap_socket(sock, server_hostname=host) as ssock:
            cert = ssock.getpeercert()
    assert cert, "FAIL: no peer certificate"


@pytest.mark.security
def test_ssl_certificate_expiry(base_url: str):
    if _scheme(base_url) != "https":
        pytest.skip("Not HTTPS")
    if not _VERIFY_SSL:
        pytest.skip("Cert expiry requires verified TLS (unset TRON_QA_INSECURE_SSL)")
    host = _host(base_url)
    ctx = _ssl_context()
    with socket.create_connection((host, 443), timeout=TIMEOUT) as sock:
        with ctx.wrap_socket(sock, server_hostname=host) as ssock:
            cert = ssock.getpeercert()
    not_after = cert.get("notAfter")
    assert not_after, "FAIL: missing notAfter"
    exp_ts = ssl.cert_time_to_seconds(not_after)
    exp = datetime.fromtimestamp(exp_ts, tz=timezone.utc)
    days = (exp - datetime.now(timezone.utc)).days
    assert days > 30, f"FAIL: cert expires in {days} days (need >30)"


@pytest.mark.security
def test_security_headers(base_url: str):
    r = _get(base_url)
    h = {k.lower(): v for k, v in r.headers.items()}
    assert "x-frame-options" in h, "FAIL: missing X-Frame-Options"
    assert "x-content-type-options" in h, "FAIL: missing X-Content-Type-Options"
    csp = h.get("content-security-policy") or h.get("content-security-policy-report-only")
    assert csp, "FAIL: missing Content-Security-Policy"


@pytest.mark.security
def test_hsts_header(base_url: str):
    if _scheme(base_url) != "https":
        pytest.skip("Not HTTPS")
    r = _get(base_url)
    assert r.headers.get("Strict-Transport-Security"), "FAIL: missing HSTS"


@pytest.mark.security
def test_cors_policy(base_url: str):
    r = _get(base_url)
    aco = r.headers.get("Access-Control-Allow-Origin")
    if not aco:
        return
    assert aco.strip() != "*", "FAIL: CORS wildcard on main document"


@pytest.mark.security
def test_sensitive_files_exposed(base_url: str):
    paths = ["/.env", "/config.php", "/.git/config"]
    for p in paths:
        url = base_url.rstrip("/") + p
        try:
            r = _get(url, allow_redirects=False)
        except requests.RequestException:
            continue
        assert r.status_code not in (200, 301, 302), f"FAIL: {p} reachable ({r.status_code})"


@pytest.mark.security
def test_directory_listing(base_url: str):
    r = _get(base_url)
    text = r.text.lower()
    assert "index of /" not in text and "<title>index of" not in text, "FAIL: directory listing detected"


@pytest.mark.security
def test_cookie_security(base_url: str):
    r = _get(base_url)
    raw = r.headers.get("Set-Cookie")
    if not raw:
        return
    rl = raw.lower()
    assert "secure" in rl and "httponly" in rl, "FAIL: cookies should use Secure and HttpOnly"


@pytest.mark.security
def test_mixed_content(base_url: str):
    if _scheme(base_url) != "https":
        pytest.skip("Not HTTPS")
    r = _get(base_url)
    soup = _soup_from_response(r)
    for tag in soup.find_all(["script", "img", "link", "iframe"]):
        u = tag.get("src") or tag.get("href")
        if u and u.startswith("http://"):
            pytest.fail(f"FAIL: mixed content resource {u}")


# --- SEO ---


@pytest.mark.seo
def test_meta_title(base_url: str):
    r = _get(base_url)
    soup = _soup_from_response(r)
    t = soup.find("title")
    assert t and t.string, "FAIL: missing <title>"
    s = t.get_text(strip=True)
    assert 10 <= len(s) <= 60, f"FAIL: title length {len(s)} (want 10–60 chars)"


@pytest.mark.seo
def test_meta_description(base_url: str):
    r = _get(base_url)
    soup = _soup_from_response(r)
    m = soup.find("meta", attrs={"name": re.compile("^description$", re.I)})
    content = (m.get("content") or "").strip() if m else ""
    assert m and 50 <= len(content) <= 160, "FAIL: meta description 50–160 chars expected"


@pytest.mark.seo
def test_meta_viewport(base_url: str):
    r = _get(base_url)
    soup = _soup_from_response(r)
    m = soup.find("meta", attrs={"name": re.compile("^viewport$", re.I)})
    assert m, "FAIL: missing viewport meta"


@pytest.mark.seo
def test_canonical_url(base_url: str):
    r = _get(base_url)
    soup = _soup_from_response(r)
    c = soup.find("link", rel=lambda x: x and "canonical" in x.lower())
    assert c and c.get("href"), "FAIL: missing canonical link"


@pytest.mark.seo
def test_robots_txt(base_url: str):
    p = urlparse(base_url)
    url = f"{p.scheme}://{p.netloc}/robots.txt"
    r = _get(url)
    assert r.status_code == 200 and len(r.text) > 0, "FAIL: robots.txt missing or empty"


@pytest.mark.seo
def test_sitemap_xml(base_url: str):
    p = urlparse(base_url)
    url = f"{p.scheme}://{p.netloc}/sitemap.xml"
    r = _get(url)
    assert r.status_code == 200 and ("<urlset" in r.text.lower() or "<sitemapindex" in r.text.lower()), (
        "FAIL: sitemap.xml invalid"
    )


@pytest.mark.seo
def test_open_graph_tags(base_url: str):
    r = _get(base_url)
    soup = _soup_from_response(r)
    og = {m.get("property", "").lower(): m.get("content", "") for m in soup.find_all("meta", property=True)}
    assert og.get("og:title"), "FAIL: og:title"
    assert og.get("og:description"), "FAIL: og:description"
    assert og.get("og:image"), "FAIL: og:image"


@pytest.mark.seo
def test_heading_structure(base_url: str):
    r = _get(base_url)
    soup = _soup_from_response(r)
    h1s = soup.find_all("h1")
    assert len(h1s) == 1, f"FAIL: expected 1 H1, found {len(h1s)}"


@pytest.mark.seo
def test_image_alt_tags(base_url: str):
    r = _get(base_url)
    soup = _soup_from_response(r)
    for img in soup.find_all("img"):
        if img.has_attr("alt"):
            continue
        pytest.fail(f"FAIL: img missing alt: {img.get('src','')[:80]}")


@pytest.mark.seo
def test_structured_data(base_url: str):
    r = _get(base_url)
    text = r.text
    has_ld = "application/ld+json" in text
    has_micro = 'itemscope' in text.lower()
    assert has_ld or has_micro, "FAIL: no JSON-LD or microdata"


# --- ACCESSIBILITY ---


@pytest.mark.accessibility
def test_lang_attribute(base_url: str):
    r = _get(base_url)
    soup = _soup_from_response(r)
    html = soup.find("html")
    assert html and html.get("lang"), "FAIL: <html lang> missing"


@pytest.mark.accessibility
def test_form_labels(base_url: str):
    r = _get(base_url)
    soup = _soup_from_response(r)
    for inp in soup.find_all(["input", "select", "textarea"]):
        t = inp.get("type", "").lower()
        if t in ("hidden", "submit", "button", "image"):
            continue
        iid = inp.get("id")
        aria = inp.get("aria-label") or inp.get("aria-labelledby")
        if aria:
            continue
        if iid and soup.find("label", attrs={"for": iid}):
            continue
        if inp.find_parent("label"):
            continue
        pytest.fail("FAIL: form control without label/aria")


@pytest.mark.accessibility
def test_button_text(base_url: str):
    r = _get(base_url)
    soup = _soup_from_response(r)
    for b in soup.find_all("button"):
        if b.get("aria-label") or b.get("title"):
            continue
        if b.get_text(strip=True):
            continue
        pytest.fail("FAIL: button without accessible text")


@pytest.mark.accessibility
def test_link_text(base_url: str):
    r = _get(base_url)
    soup = _soup_from_response(r)
    bad = re.compile(r"^(click here|read more)\s*$", re.I)
    for a in soup.find_all("a", href=True):
        t = a.get_text(strip=True)
        if bad.match(t):
            pytest.fail(f"FAIL: non-descriptive link: {t}")


@pytest.mark.accessibility
def test_color_contrast_basic(base_url: str):
    r = _get(base_url)
    soup = _soup_from_response(r)
    for el in soup.find_all(style=True):
        st = el.get("style", "").lower()
        if "color:#fff" in st.replace(" ", "") or "color:white" in st:
            if "background" not in st:
                pytest.fail("FAIL: light text without background in inline style (basic check)")


@pytest.mark.accessibility
def test_skip_navigation(base_url: str):
    r = _get(base_url)
    soup = _soup_from_response(r)
    for a in soup.find_all("a", href=True):
        h = (a.get("href") or "").lower()
        txt = a.get_text(strip=True).lower()
        if "skip" in txt and ("#" in h or "main" in h):
            return
    pytest.fail("FAIL: no skip-to-content link")


@pytest.mark.accessibility
def test_aria_landmarks(base_url: str):
    r = _get(base_url)
    soup = _soup_from_response(r)
    has_main = soup.find(["main"]) or soup.find(attrs={"role": "main"})
    has_nav = soup.find("nav") or soup.find(attrs={"role": "navigation"})
    has_header = soup.find("header") or soup.find(attrs={"role": "banner"})
    assert has_main and has_nav and has_header, "FAIL: need main, nav, header landmarks"


# --- LINKS ---


@pytest.mark.links
def test_internal_links(base_url: str):
    r = _get(base_url)
    soup = _soup_from_response(r)
    p = urlparse(base_url)
    origin = f"{p.scheme}://{p.netloc}"
    checked = 0
    for a in soup.find_all("a", href=True):
        if checked >= 25:
            break
        absu = _absolute(base_url, a["href"])
        if not absu or not absu.startswith(origin):
            continue
        try:
            rr = _head(absu, allow_redirects=True)
            if rr.status_code == 405:
                rr = _get(absu)
            assert rr.status_code < 400, f"FAIL: {absu} -> {rr.status_code}"
        except requests.RequestException as e:
            pytest.fail(f"FAIL: {absu} {e}")
        checked += 1
    assert checked > 0, "FAIL: no internal links to verify"


@pytest.mark.links
def test_external_links_sample(base_url: str):
    r = _get(base_url)
    soup = _soup_from_response(r)
    p = urlparse(base_url)
    origin = f"{p.scheme}://{p.netloc}"
    outs = []
    for a in soup.find_all("a", href=True):
        absu = _absolute(base_url, a["href"])
        if absu and not absu.startswith(origin) and absu.startswith("http"):
            outs.append(absu)
    outs = list(dict.fromkeys(outs))[:5]
    if not outs:
        return
    for u in outs:
        try:
            rr = _head(u, allow_redirects=True, timeout=8)
            if rr.status_code == 405:
                rr = _get(u, timeout=8)
            assert rr.status_code != 404, f"FAIL: external 404 {u}"
        except requests.RequestException:
            pass


@pytest.mark.links
def test_image_sources(base_url: str):
    r = _get(base_url)
    soup = _soup_from_response(r)
    for img in soup.find_all("img", src=True):
        u = _absolute(base_url, img["src"])
        if not u:
            continue
        rr = _get(u)
        assert rr.status_code < 400, f"FAIL: image {u}"


@pytest.mark.links
def test_css_sources(base_url: str):
    r = _get(base_url)
    soup = _soup_from_response(r)
    for link in soup.find_all("link", rel=lambda x: x and "stylesheet" in str(x).lower()):
        href = link.get("href")
        if not href:
            continue
        u = _absolute(base_url, href)
        if u:
            rr = _get(u)
            assert rr.status_code < 400, f"FAIL: css {u}"


@pytest.mark.links
def test_js_sources(base_url: str):
    r = _get(base_url)
    soup = _soup_from_response(r)
    for sc in soup.find_all("script", src=True):
        u = _absolute(base_url, sc["src"])
        if not u:
            continue
        rr = _get(u)
        assert rr.status_code < 400, f"FAIL: script {u}"


@pytest.mark.links
def test_favicon_exists(base_url: str):
    p = urlparse(base_url)
    url = f"{p.scheme}://{p.netloc}/favicon.ico"
    r = _get(url)
    assert r.status_code == 200 and len(r.content) > 0, "FAIL: favicon.ico"


# --- CONTENT ---


@pytest.mark.content
def test_no_lorem_ipsum(base_url: str):
    r = _get(base_url)
    assert "lorem ipsum" not in r.text.lower(), "FAIL: placeholder Lorem ipsum"


@pytest.mark.content
class _TagBalanceParser(HTMLParser):
    void = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}

    def __init__(self):
        super().__init__()
        self.stack: list[str] = []
        self.errors: list[str] = []

    def handle_starttag(self, tag, attrs):
        t = tag.lower()
        if t in self.void:
            return
        self.stack.append(t)

    def handle_endtag(self, tag):
        t = tag.lower()
        if t in self.void:
            return
        if not self.stack:
            self.errors.append(f"unexpected </{t}>")
            return
        if self.stack[-1] != t:
            self.errors.append(f"mismatch </{t}> expected </{self.stack[-1]}>")
        else:
            self.stack.pop()


@pytest.mark.content
def test_no_broken_html(base_url: str):
    r = _get(base_url)
    p = _TagBalanceParser()
    try:
        p.feed(r.text[:500000])
    except Exception as e:
        pytest.fail(f"FAIL: HTML parse error {e}")
    if p.errors[:3]:
        pytest.fail("FAIL: " + "; ".join(p.errors[:3]))


@pytest.mark.content
def test_404_page_exists(base_url: str):
    p = urlparse(base_url)
    url = f"{p.scheme}://{p.netloc}/tron-qa-nonexistent-404-check-xyz"
    r = _get(url, allow_redirects=False)
    assert r.status_code == 404, f"FAIL: expected 404 got {r.status_code}"
    assert len(r.text) > 20, "FAIL: 404 body too small"


@pytest.mark.content
def test_page_encoding(base_url: str):
    r = _get(base_url)
    ct = (r.headers.get("Content-Type") or "").lower()
    soup = _soup_from_response(r)
    m = soup.find("meta", attrs={"charset": True}) or soup.find(
        "meta", attrs={"http-equiv": re.compile("^content-type$", re.I)}
    )
    ok = "utf-8" in ct or (m and "utf-8" in str(m).lower())
    assert ok, "FAIL: UTF-8 not declared"


@pytest.mark.content
@pytest.mark.timeout(120)
def test_no_console_errors(base_url: str, selenium_driver):
    selenium_driver.set_window_size(1280, 800)
    selenium_driver.set_page_load_timeout(TIMEOUT)
    selenium_driver.get(base_url)
    time.sleep(1)
    severe = [
        e
        for e in selenium_driver.get_log("browser")
        if e.get("level") == "SEVERE" and e.get("source") not in ("network",)
    ]
    assert not severe, f"FAIL: JS console SEVERE: {severe[:5]}"


# --- MOBILE ---


@pytest.mark.mobile
def test_viewport_meta(base_url: str):
    r = _get(base_url)
    soup = _soup_from_response(r)
    m = soup.find("meta", attrs={"name": re.compile("^viewport$", re.I)})
    assert m, "FAIL: viewport meta"
    c = (m.get("content") or "").lower()
    assert "width" in c, "FAIL: viewport should include width"


@pytest.mark.mobile
def test_touch_icons(base_url: str):
    r = _get(base_url)
    soup = _soup_from_response(r)
    found = soup.find("link", rel=lambda x: x and "apple-touch-icon" in str(x).lower())
    assert found, "FAIL: apple-touch-icon link missing"


@pytest.mark.mobile
@pytest.mark.timeout(120)
def test_mobile_rendering(base_url: str, selenium_driver):
    selenium_driver.set_window_size(375, 812)
    selenium_driver.set_page_load_timeout(TIMEOUT)
    selenium_driver.get(base_url)
    w = selenium_driver.execute_script(
        "return Math.max(document.body.scrollWidth, document.documentElement.scrollWidth)"
    )
    assert w <= 375 + 20, f"FAIL: horizontal overflow width={w}"


# --- INFRASTRUCTURE ---


@pytest.mark.infrastructure
def test_dns_resolves(base_url: str):
    host = _host(base_url)
    socket.getaddrinfo(host, None)


@pytest.mark.infrastructure
def test_www_redirect(base_url: str):
    p = urlparse(base_url)
    host = p.netloc.lower()
    if host.startswith("www."):
        other = host[4:]
    else:
        other = "www." + host
    url_a = f"{p.scheme}://{host}{p.path or '/'}"
    url_b = f"{p.scheme}://{other}{p.path or '/'}"
    try:
        ra = _get(url_a, allow_redirects=False)
        rb = _get(url_b, allow_redirects=False)
    except requests.RequestException:
        pytest.skip("Could not compare hosts")
    if ra.status_code in (301, 302, 307, 308) or rb.status_code in (301, 302, 307, 308):
        return
    pytest.fail("FAIL: www and apex should redirect one way")


@pytest.mark.infrastructure
def test_server_header_info(base_url: str):
    r = _get(base_url)
    srv = r.headers.get("Server", "")
    if not srv:
        return
    assert not re.search(r"\d+\.\d+", srv), "FAIL: Server exposes version"


@pytest.mark.infrastructure
def test_x_powered_by_hidden(base_url: str):
    r = _get(base_url)
    assert "X-Powered-By" not in r.headers, "FAIL: X-Powered-By present"


@pytest.mark.infrastructure
def test_content_type_header(base_url: str):
    r = _get(base_url)
    ct = r.headers.get("Content-Type", "")
    assert "text/html" in ct.lower(), f"FAIL: Content-Type not HTML: {ct}"


if __name__ == "__main__":
    # PyInstaller: entry points often missing — import plugins so --timeout / --json-report work.
    try:
        import pytest_timeout  # noqa: F401
    except ImportError:
        pass
    try:
        import pytest_jsonreport.plugin  # noqa: F401
    except ImportError:
        pass

    if getattr(sys, "frozen", False):
        # Onedir: never pass _internal/__file__ to pytest — it is not a real on-disk test file.
        _root = os.path.dirname(sys.executable)
        os.chdir(_root)
        _candidates = [
            os.path.join(_root, "tron_engine.py"),
            os.path.join(_root, "pyengine", "tron_engine.py"),
        ]
        _meipass = getattr(sys, "_MEIPASS", None)
        if _meipass:
            _candidates.append(os.path.join(_meipass, "tron_engine.py"))
        _test_entry = None
        for c in _candidates:
            if os.path.isfile(c):
                _test_entry = c
                break
        if _test_entry is None:
            sys.stderr.write(
                "TRON FATAL: tron_engine.py missing next to tron_engine.exe. "
                "Rebuild engine (tron.spec datas must copy .py beside exe).\n"
            )
            raise SystemExit(2)
    else:
        _root = os.path.dirname(os.path.abspath(__file__))
        os.chdir(_root)
        _test_entry = os.path.abspath(__file__)

    args = [
        _test_entry,
        "-v",
        "--tb=short",
        "--timeout=10",
        f"--rootdir={_root}",
    ]
    _cache = (os.environ.get("PYTEST_CACHE_DIR") or os.environ.get("TRON_PYTEST_CACHE_DIR") or "").strip()
    if _cache:
        args.extend(["-o", f"cache_dir={_cache}"])
    args.extend(sys.argv[1:])
    raise SystemExit(pytest.main(args))
