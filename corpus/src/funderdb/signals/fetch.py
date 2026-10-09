"""HTTP fetching, feed parsing and article extraction for funder signals.

Everything here is pure I/O + parsing; nothing touches the database. The
publisher's page is copyrighted expression: callers keep the HTML only in the
sha256-staged snapshot file (licence publisher_website) and keep verbatim
excerpts only in raw_source. Only facts leave this module.
"""

from __future__ import annotations

import json
import re
import time
import urllib.robotparser
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from urllib.parse import parse_qsl, urlencode, urljoin, urlsplit, urlunsplit

import httpx
from lxml import etree, html as lxml_html

MAX_BYTES = 2 * 1024 * 1024          # a press release is kilobytes; 2 MiB is a hard cap
TEXT_CAP = 20_000                    # characters of article text kept for the classifier
_TRACKING_PARAMS = re.compile(r"^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$|ref$|source$)", re.I)
_WS = re.compile(r"\s+")


# ---------------------------------------------------------------------------
# URLs
# ---------------------------------------------------------------------------
def canonical_url(url: str) -> str:
    """Drop the fragment and tracking parameters, lower-case the host, keep the rest.

    Two links to the same release (one copied from LinkedIn with utm_ tags, one
    from the newsroom) must collide on uq_funder_signals_url.
    """
    parts = urlsplit(url.strip())
    scheme = (parts.scheme or "https").lower()
    host = parts.netloc.lower()
    if host.startswith("www.") is False and host.count(".") == 1:
        host = host  # never add www.: the publisher decides its own host
    query = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True)
             if not _TRACKING_PARAMS.match(k)]
    path = parts.path or "/"
    if len(path) > 1 and path.endswith("/"):
        path = path[:-1]
    return urlunsplit((scheme, host, path, urlencode(query), ""))


def same_host(a: str, b: str) -> bool:
    ha, hb = urlsplit(a).netloc.lower(), urlsplit(b).netloc.lower()
    strip = lambda h: h[4:] if h.startswith("www.") else h  # noqa: E731
    return strip(ha) == strip(hb)


# ---------------------------------------------------------------------------
# robots.txt
# ---------------------------------------------------------------------------
_robots_cache: dict[str, urllib.robotparser.RobotFileParser | None] = {}


def robots_allowed(url: str, user_agent: str, *, client: httpx.Client) -> bool:
    """True when robots.txt permits fetching ``url`` (or no robots.txt exists)."""
    parts = urlsplit(url)
    origin = f"{parts.scheme}://{parts.netloc}"
    if origin not in _robots_cache:
        rp = urllib.robotparser.RobotFileParser()
        try:
            resp = client.get(f"{origin}/robots.txt", timeout=10.0)
            if resp.status_code == 200:
                rp.parse(resp.text.splitlines())
                _robots_cache[origin] = rp
            else:
                _robots_cache[origin] = None   # no robots.txt: allowed
        except httpx.HTTPError:
            _robots_cache[origin] = None
    rp = _robots_cache[origin]
    if rp is None:
        return True
    return rp.can_fetch(user_agent, url) or rp.can_fetch("*", url)


# ---------------------------------------------------------------------------
# Fetching
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class FetchResult:
    url: str
    final_url: str
    status_code: int
    content_type: str | None
    body: bytes
    headers: dict[str, str]
    fetched_at: datetime

    @property
    def text(self) -> str:
        enc = "utf-8"
        if self.content_type and "charset=" in self.content_type:
            enc = self.content_type.split("charset=", 1)[1].split(";")[0].strip() or "utf-8"
        try:
            return self.body.decode(enc, errors="replace")
        except LookupError:
            return self.body.decode("utf-8", errors="replace")


def make_client(user_agent: str) -> httpx.Client:
    return httpx.Client(
        headers={"User-Agent": user_agent, "Accept": "text/html,application/xhtml+xml,"
                 "application/rss+xml,application/atom+xml,application/xml;q=0.9,*/*;q=0.5"},
        timeout=httpx.Timeout(connect=10.0, read=20.0, write=10.0, pool=10.0),
        follow_redirects=True,
    )


def fetch(url: str, *, client: httpx.Client, etag: str | None = None,
          last_modified: str | None = None, retries: int = 2) -> FetchResult:
    """GET with a byte cap and small retry; 304 is returned, not raised."""
    headers: dict[str, str] = {}
    if etag:
        headers["If-None-Match"] = etag
    if last_modified:
        headers["If-Modified-Since"] = last_modified
    attempt = 0
    while True:
        try:
            with client.stream("GET", url, headers=headers) as resp:
                chunks: list[bytes] = []
                size = 0
                if resp.status_code != 304:
                    for chunk in resp.iter_bytes(65536):
                        size += len(chunk)
                        if size > MAX_BYTES:
                            raise ValueError(f"response exceeds {MAX_BYTES} bytes: {url}")
                        chunks.append(chunk)
                keep = {k: v for k, v in resp.headers.items()
                        if k.lower() in ("etag", "last-modified", "content-type", "date")}
                return FetchResult(
                    url=url, final_url=str(resp.url), status_code=resp.status_code,
                    content_type=resp.headers.get("content-type"), body=b"".join(chunks),
                    headers=keep, fetched_at=datetime.now(timezone.utc),
                )
        except httpx.TransportError:
            attempt += 1
            if attempt > retries:
                raise
            time.sleep(2 * attempt)


# ---------------------------------------------------------------------------
# Feeds and index pages
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class FeedItem:
    url: str
    title: str | None
    published: date | None


def _text(el) -> str | None:
    if el is None:
        return None
    t = "".join(el.itertext()) if hasattr(el, "itertext") else str(el)
    t = _WS.sub(" ", t).strip()
    return t or None


def parse_feed(body: bytes) -> list[FeedItem]:
    """RSS 2.0 and Atom, namespace-tolerant. Unknown shapes return []."""
    try:
        root = etree.fromstring(body, parser=etree.XMLParser(recover=True, huge_tree=False))
    except etree.XMLSyntaxError:
        return []
    if root is None:
        return []
    items: list[FeedItem] = []
    tag = etree.QName(root).localname.lower()
    if tag == "rss" or root.find(".//item") is not None:
        for item in root.iter():
            if etree.QName(item).localname.lower() != "item":
                continue
            link = _text(item.find("link")) or _text(item.find("guid"))
            if not link or not link.startswith("http"):
                continue
            items.append(FeedItem(link, _text(item.find("title")),
                                  parse_date(_text(item.find("pubDate")))
                                  or parse_date(_text(item.find("{http://purl.org/dc/elements/1.1/}date")))))
    elif tag == "feed":
        for entry in root.iter():
            if etree.QName(entry).localname.lower() != "entry":
                continue
            href = None
            for link in entry:
                if etree.QName(link).localname.lower() == "link":
                    rel = link.get("rel", "alternate")
                    if rel == "alternate" and link.get("href"):
                        href = link.get("href")
                        break
            if not href:
                continue
            title = published = None
            for child in entry:
                name = etree.QName(child).localname.lower()
                if name == "title":
                    title = _text(child)
                elif name in ("published", "updated") and published is None:
                    published = parse_date(_text(child))
            items.append(FeedItem(href, title, published))
    return items


def discover_links(page_html: str, base_url: str, pattern: str | None) -> list[str]:
    """Absolute, same-host links on an index page, filtered by ``pattern``, in page order."""
    try:
        doc = lxml_html.fromstring(page_html)
    except (etree.ParserError, ValueError):
        return []
    rx = re.compile(pattern) if pattern else None
    seen: set[str] = set()
    out: list[str] = []
    for a in doc.iter("a"):
        href = a.get("href")
        if not href or href.startswith(("#", "mailto:", "javascript:")):
            continue
        absolute = canonical_url(urljoin(base_url, href))
        if not same_host(absolute, base_url):
            continue
        if absolute == canonical_url(base_url):
            continue
        if rx and not rx.search(absolute):
            continue
        if absolute in seen:
            continue
        seen.add(absolute)
        out.append(absolute)
    return out


# ---------------------------------------------------------------------------
# Article extraction
# ---------------------------------------------------------------------------
@dataclass
class Article:
    url: str
    title: str | None
    published_at: date | None
    text: str
    date_evidence: str | None = None      # which element the date came from
    meta: dict[str, str] = field(default_factory=dict)


_DATE_FORMATS = ("%Y-%m-%d", "%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%S.%f%z", "%Y-%m-%dT%H:%M:%SZ",
                 "%B %d, %Y", "%b %d, %Y", "%d %B %Y", "%m/%d/%Y", "%Y/%m/%d",
                 "%a, %d %b %Y %H:%M:%S %z", "%a, %d %b %Y %H:%M:%S %Z")


def parse_date(value: str | None) -> date | None:
    """Lenient date parsing for feed/meta values. Returns None rather than guessing."""
    if not value:
        return None
    v = value.strip()
    v = re.sub(r"(\d)(st|nd|rd|th)\b", r"\1", v)
    if v.endswith("Z"):
        v = v[:-1] + "+0000"
    v = re.sub(r"([+-]\d{2}):(\d{2})$", r"\1\2", v)
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(v, fmt).date()
        except ValueError:
            continue
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})", v)
    if m:
        try:
            return date(int(m[1]), int(m[2]), int(m[3]))
        except ValueError:
            return None
    return None


def _jsonld_date(doc) -> str | None:
    for script in doc.iter("script"):
        if (script.get("type") or "").lower() != "application/ld+json":
            continue
        try:
            data = json.loads(script.text or "")
        except ValueError:
            continue
        stack = [data]
        while stack:
            node = stack.pop()
            if isinstance(node, dict):
                for key in ("datePublished", "dateCreated", "uploadDate"):
                    if isinstance(node.get(key), str):
                        return node[key]
                stack.extend(node.values())
            elif isinstance(node, list):
                stack.extend(node)
    return None


def extract_article(page_html: str, url: str) -> Article:
    """Title, publication date and readable text from a press-release page.

    Deliberately simple and deterministic: meta tags first, then the obvious
    containers. A page we cannot date gets published_at=None and the model is
    told so; it must not invent a date either.
    """
    try:
        doc = lxml_html.fromstring(page_html)
    except (etree.ParserError, ValueError):
        return Article(url=url, title=None, published_at=None, text="")
    for bad in doc.xpath("//script|//style|//noscript|//nav|//footer|//header|//form|//svg"):
        bad.getparent().remove(bad)

    meta: dict[str, str] = {}
    for m in doc.iter("meta"):
        key = m.get("property") or m.get("name")
        if key and m.get("content"):
            meta[key.lower()] = m.get("content").strip()

    title = (meta.get("og:title") or meta.get("twitter:title") or _text(doc.find(".//h1"))
             or _text(doc.find(".//title")))

    published_raw, evidence = None, None
    for key in ("article:published_time", "datepublished", "date", "pubdate", "dc.date",
                "dc.date.issued", "sailthru.date", "parsely-pub-date"):
        if meta.get(key):
            published_raw, evidence = meta[key], f"meta:{key}"
            break
    if not published_raw:
        ld = _jsonld_date(doc)
        if ld:
            published_raw, evidence = ld, "json-ld:datePublished"
    if not published_raw:
        for t in doc.iter("time"):
            if t.get("datetime"):
                published_raw, evidence = t.get("datetime"), "time[datetime]"
                break
    published = parse_date(published_raw)
    if published is None:
        m = re.search(r"/(20\d{2})/(\d{1,2})(?:/(\d{1,2}))?/", url)
        if m:
            try:
                published = date(int(m[1]), int(m[2]), int(m[3] or 1))
                evidence = "url-path"
            except ValueError:
                published = None

    container = None
    for xp in ("//article", "//main", "//*[@role='main']", "//*[contains(@class,'press-release')]",
               "//*[contains(@class,'content')]", "//body"):
        found = doc.xpath(xp)
        if found:
            container = found[0]
            break
    paragraphs: list[str] = []
    if container is not None:
        for p in container.xpath(".//p|.//h2|.//h3|.//li"):
            t = _text(p)
            if t and len(t) > 30:
                paragraphs.append(t)
    text = "\n".join(paragraphs)[:TEXT_CAP]
    return Article(url=url, title=title, published_at=published, text=text,
                   date_evidence=evidence, meta={k: v for k, v in meta.items()
                                                 if k.startswith(("og:", "article:", "description"))})
