"""Bounded public-web acquisition. Bodies stay in private, hashed snapshots.

Sockets connect to a validated public IP, with TLS SNI/certificate validation
against the original hostname. Redirects repeat both address and robots checks.
No cookies, credentials, browser automation, forms, or private endpoints.
"""
from __future__ import annotations

import hashlib
import http.client
import ipaddress
import json
import re
import socket
import ssl
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote, urljoin, urlsplit, urlunsplit

from lxml import etree, html

AGENT_TOKEN = "FunderResearch"
MAX_BYTES = 2 * 1024 * 1024
MAX_ROBOTS_BYTES = 512 * 1024
LINK_TOPICS = {
    "application": re.compile(r"apply|application|eligib|guideline|deadline|funding.opportun|request.for|\brfp\b", re.I),
    "program": re.compile(r"program|research|science|priorit|strategy", re.I),
    "grants": re.compile(r"grantee|grant.database|awarded|funded.project|portfolio", re.I),
    "news": re.compile(r"news|press|announcement|insight", re.I),
    "identity": re.compile(r"about|mission|annual.report|financial", re.I),
    "people": re.compile(r"team|staff|leadership|contact", re.I),
}


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def canonical(url: str) -> str:
    p = urlsplit(url.strip())
    if p.scheme not in ("https", "http") or not p.hostname or p.username or p.password:
        raise ValueError("only public HTTP(S) URLs without credentials are supported")
    if p.port not in (None, 80 if p.scheme == "http" else 443):
        raise ValueError("nonstandard ports require manual review")
    host = p.hostname.encode("idna").decode("ascii").lower().rstrip(".")
    if ":" in host:
        host = f"[{host}]"
    return urlunsplit((p.scheme, host, quote(p.path or "/", safe="/%:@!$&'()*+,;=-._~"), p.query, ""))


def origin(url: str) -> str:
    p = urlsplit(url)
    return f"{p.scheme}://{p.netloc}"


def site(url: str) -> str:
    return (urlsplit(url).hostname or "").lower().removeprefix("www.")


def robots_path(value: str) -> str:
    """RFC 9309 comparison: encode Unicode, decode only unreserved octets."""
    value = quote(value, safe="/%:@!$&'()*+,;=-._~?")
    def octet(match):
        char = chr(int(match[0][1:], 16))
        return char if re.fullmatch(r"[A-Za-z0-9._~-]", char) else match[0].upper()
    return re.sub(r"%[0-9a-fA-F]{2}", octet, value)


def snapshot(root: Path, payload: dict) -> dict:
    data = (json.dumps(payload, sort_keys=True, ensure_ascii=False) + "\n").encode()
    digest = hashlib.sha256(data).hexdigest()
    root.mkdir(parents=True, exist_ok=True)
    path = root / f"{digest}.json"
    if not path.exists():
        path.write_bytes(data)
    return {"path": str(path), "sha256": digest, "bytes": len(data),
            "license_code": "publisher_website", "republishable": False}


class Deferred(Exception):
    """The site must be tried later or manually reviewed; never a closed funder."""


class PublicWeb:
    def __init__(self, root: Path, user_agent: str, delay: float = 1.1):
        self.root = root
        self.user_agent = f"{AGENT_TOKEN}/1.0 {user_agent}"
        self.delay = max(1.1, delay)
        self.last: dict[str, float] = {}
        self.policies: dict[str, dict] = {}

    def request(self, url: str, cap: int = MAX_BYTES) -> dict:
        url = canonical(url)
        p = urlsplit(url)
        host = p.hostname
        port = 443 if p.scheme == "https" else 80
        addresses = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
        ips = list(dict.fromkeys(a[4][0] for a in addresses))
        if not ips or any(not ipaddress.ip_address(ip).is_global for ip in ips):
            raise Deferred("host resolves to a non-public address")
        wait = self.delay - (time.monotonic() - self.last.get(host, 0))
        if wait > 0:
            time.sleep(wait)
        self.last[host] = time.monotonic()
        # Connect to the checked address; a second DNS answer cannot rebind it.
        conn = http.client.HTTPConnection(host, port, timeout=12)
        try:
            sock = socket.create_connection((ips[0], port), timeout=12)
            if p.scheme == "https":
                try:
                    sock = ssl.create_default_context().wrap_socket(sock, server_hostname=host)
                except Exception:
                    sock.close()
                    raise
            conn.sock = sock
            conn.request("GET", urlunsplit(("", "", p.path or "/", p.query, "")), headers={
                "Host": p.netloc, "User-Agent": self.user_agent,
                "Accept": "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1",
                "Accept-Encoding": "identity",
            })
            response = conn.getresponse()
            body = response.read(cap + 1)
            if len(body) > cap:
                raise Deferred(f"response exceeds {cap} byte cap")
            if response.getheader("Content-Encoding", "identity") != "identity":
                raise Deferred("server ignored identity content encoding")
            content_type = response.getheader("Content-Type", "")
            charset = re.search(r"charset=[\"']?([^;\s\"']+)", content_type, re.I)
            try:
                text = body.decode(charset[1] if charset else "utf-8", errors="replace")
            except LookupError:
                text = body.decode("utf-8", errors="replace")
            return {"url": url, "http_status": response.status, "fetched_at": now(),
                    "content_type": content_type, "body_bytes": len(body),
                    "body_sha256": hashlib.sha256(body).hexdigest(), "text": text,
                    "location": response.getheader("Location"),
                    "retry_after": response.getheader("Retry-After"),
                    "etag": response.getheader("ETag"),
                    "last_modified": response.getheader("Last-Modified")}
        finally:
            conn.close()

    def robots(self, url: str) -> dict:
        key = origin(url)
        if key in self.policies and time.monotonic() - self.policies[key]["cached_at"] < 86400:
            return self.policies[key]
        robot_url = key + "/robots.txt"
        for _ in range(6):
            response = self.request(robot_url, MAX_ROBOTS_BYTES)
            ref = snapshot(self.root, {"kind": "robots", **response})
            if response["http_status"] in (301, 302, 303, 307, 308) and response["location"]:
                robot_url = canonical(urljoin(robot_url, response["location"]))
                continue
            status = response["http_status"]
            if status in (404, 410):
                policy = {"groups": [], "snapshot": ref}
            elif 200 <= status < 300:
                if "text/html" in response["content_type"].lower():
                    raise Deferred("robots returned HTML rather than a policy; manual check needed")
                groups, agents, rules, started = [], [], [], False
                delay = self.delay
                for line in response["text"].splitlines():
                    line = line.split("#", 1)[0].strip()
                    if ":" not in line:
                        continue
                    field, value = (part.strip() for part in line.split(":", 1))
                    field = field.lower()
                    if field == "user-agent":
                        if started:
                            groups.append((agents, rules, delay))
                            agents, rules, started, delay = [], [], False, self.delay
                        agents.append(value.lower())
                    elif agents and field in ("allow", "disallow", "crawl-delay"):
                        started = True
                        if field in ("allow", "disallow") and value:
                            rules.append((field, value))
                        elif field == "crawl-delay":
                            try:
                                delay = max(delay, float(value))
                            except ValueError:
                                pass
                if agents:
                    groups.append((agents, rules, delay))
                specific = [g for g in groups if AGENT_TOKEN.lower() in g[0]]
                policy = {"groups": specific or [g for g in groups if "*" in g[0]], "snapshot": ref}
            else:
                raise Deferred(f"robots HTTP {status}; retry-after={response['retry_after']}")
            policy["cached_at"] = time.monotonic()
            self.policies[key] = policy
            return policy
        raise Deferred("robots redirect limit")

    def allowed(self, url: str) -> dict:
        policy = self.robots(url)
        p = urlsplit(url)
        target = robots_path(p.path + ("?" + p.query if p.query else ""))
        matches = []
        delay = self.delay
        for _, rules, group_delay in policy["groups"]:
            delay = max(delay, group_delay)
            for kind, pattern in rules:
                end = pattern.endswith("$")
                pattern = robots_path(pattern[:-1] if end else pattern)
                rx = "^" + ".*".join(re.escape(x) for x in pattern.split("*")) + ("$" if end else "")
                if re.search(rx, target):
                    matches.append((len(pattern.replace("*", "").encode()), kind == "allow"))
        if matches and not max(matches)[1]:
            raise Deferred("robots disallows this path")
        # Long server delays are a deferred outcome, not a worker-blocking sleep.
        if delay > 30:
            raise Deferred(f"crawl-delay {delay:g}s requires a later scheduled pass")
        wait = delay - (time.monotonic() - self.last.get(p.hostname, 0))
        if wait > 0:
            time.sleep(wait)
        return policy["snapshot"]

    def page(self, url: str) -> tuple[dict, dict]:
        requested, redirects = canonical(url), []
        url = requested
        for _ in range(6):
            policy = self.allowed(url)
            response = self.request(url)
            ref = snapshot(self.root, {"kind": "page", "requested_url": requested,
                                      "redirects": redirects, "robots": policy, **response})
            if response["http_status"] in (301, 302, 303, 307, 308) and response["location"]:
                redirects.append({"url": url, "snapshot": ref})
                url = canonical(urljoin(url, response["location"]))
                continue
            if response["http_status"] != 200:
                raise Deferred(f"HTTP {response['http_status']}; snapshot={ref['sha256']}; retry-after={response['retry_after']}")
            if not any(t in response["content_type"].lower() for t in ("text/html", "application/xhtml+xml")):
                raise Deferred(f"non-HTML resource needs separate review: {response['content_type']}")
            return response, ref
        raise Deferred("page redirect limit")


def extract(page: dict, ref: dict) -> dict:
    """Observed page structure, not inferred eligibility or an AI confidence score."""
    doc = html.fromstring(page["text"])
    links, feeds, structured = [], [], []
    for script in doc.xpath('//script[@type="application/ld+json"]'):
        try:
            structured.append(json.loads(script.text or ""))
        except ValueError:
            pass
    for link in doc.xpath('//link[@rel="alternate"][@href]'):
        if any(x in (link.get("type") or "") for x in ("rss", "atom")):
            try:
                feeds.append(canonical(urljoin(page["url"], link.get("href"))))
            except ValueError:
                pass
    for a in doc.xpath("//a[@href]"):
        label = " ".join(a.itertext()).strip()
        try:
            url = canonical(urljoin(page["url"], a.get("href")))
        except ValueError:
            continue
        topics = [key for key, rx in LINK_TOPICS.items() if rx.search(label + " " + urlsplit(url).path)]
        if topics:
            links.append({"url": url, "label": re.sub(r"\s+", " ", label)[:180], "topics": topics,
                          "same_site": site(url) == site(page["url"]), "source_url": page["url"]})
    for bad in doc.xpath("//script|//style|//nav|//footer|//header|//form|//noscript|//svg"):
        if bad.getparent() is not None:
            bad.getparent().remove(bad)
    title = " ".join(doc.xpath("//title/text()")) or " ".join(doc.xpath("//h1/text()"))
    text = re.sub(r"\s+", " ", doc.text_content()).strip()
    # These are research leads only. No amount, date, posture, or contact is promoted.
    signals = []
    for sentence in re.split(r"(?<=[.!?])\s+", text):
        topics = [key for key, rx in LINK_TOPICS.items() if rx.search(sentence)]
        if topics and 30 <= len(sentence) <= 1200:
            signals.append({"topics": topics, "excerpt": sentence[:600], "source_url": page["url"]})
            if len(signals) == 15:
                break
    return {"url": page["url"], "title": title[:300], "fetched_at": page["fetched_at"],
            "snapshot": ref, "links": links[:250], "feeds": feeds[:20],
            "structured_data": structured[:20], "evidence_leads": signals,
            "text_characters": len(text)}


def crawl_org(target: dict, web: PublicWeb, max_pages: int) -> dict:
    pending = list(dict.fromkeys([target["website"], *target.get("research_urls", [])]))
    visited, pages, errors, links = set(), [], [], {}
    attempted = 0
    # Curated URLs may be external application portals. Discovered off-site links
    # are recorded for review but never followed automatically.
    while pending and attempted < max_pages:
        url = pending.pop(0)
        try:
            url = canonical(url)
            if url in visited:
                continue
            visited.add(url)
            attempted += 1
            page, ref = web.page(url)
            visited.add(page["url"])
            parsed = extract(page, ref)
            pages.append(parsed)
            for link in parsed["links"]:
                links[link["url"]] = link
            candidates = [l for l in links.values() if l["same_site"] and l["url"] not in visited
                          and not re.search(r"\.(pdf|zip|docx?|xlsx?)(?:[?#]|$)", l["url"], re.I)
                          and not re.search(r"login|sign.?in|logout", l["url"], re.I)]
            # Coverage by topic before a second link from the same topic.
            for topic in LINK_TOPICS:
                candidate = next((l for l in candidates if topic in l["topics"] and l["url"] not in pending), None)
                if candidate:
                    pending.append(candidate["url"])
        except (Deferred, ValueError, OSError, http.client.HTTPException, etree.ParserError) as exc:
            errors.append({"url": url, "reason": f"{type(exc).__name__}: {exc}"[:600]})
    return {"schema": "organization_research/v1", "org_id": target["org_id"],
            "org_name": target["org_name"], "ein": target.get("ein"), "researched_at": now(),
            "status": "evidence_ready" if pages else "blocked", "review_status": "unreviewed",
            "identity_status": "needs_review", "pages_attempted": attempted, "pages": pages,
            "errors": errors, "discovered_links": list(links.values()),
            "unvisited_urls": [u for u in pending if u not in visited],
            "notes": "Acquisition only. Identity, claims, deadlines and cross-source conflicts need review."}
