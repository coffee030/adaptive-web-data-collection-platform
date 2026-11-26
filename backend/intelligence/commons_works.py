"""Acquire credited works from Wikimedia Commons under explicit reusable licenses."""

import csv
import io
import json
import re

from datetime import UTC, date, datetime, timedelta
from html.parser import HTMLParser
from pathlib import Path
from time import monotonic
from urllib.parse import quote, urlencode, urlsplit
from uuid import NAMESPACE_URL, uuid5

import httpx2

from backend.application.inputs import CsvEntry
from backend.core.contracts import CsvMappingConfiguration
from backend.marketing.store import MarketingError
from .public_feed import PublicFeed

API = "https://commons.wikimedia.org/w/api.php"
RIGHTS = "https://commons.wikimedia.org/wiki/Commons:Licensing"
TEXT_LICENSE = "https://creativecommons.org/licenses/by-sa/4.0/"
METRIC_LICENSE = "https://creativecommons.org/publicdomain/zero/1.0/"
AGENT = "Harbourline/1.0 (https://github.com/coffee030/adaptive-web-data-collection-platform)"
DATASET = "hk-commons-published-works"
SEEDS = (
    97594989,
    73623226,
    92297134,
    92323508,
    92976666,
    96222071,
    51271598,
    51272135,
    51272744,
    45599770,
    109487547,
    159423281,
    159423282,
    16942336,
    24415784,
    24415836,
    153237769,
)
PREVIEWS = {
    92297134,
    92323508,
    92976666,
    96222071,
    45599770,
    109487547,
    159423281,
    159423282,
}
QUERIES = (
    "intitle:兩餸飯",
    'intitle:graffiti "Hong Kong" filetype:bitmap',
    '"Hong Kong" "hiking" filetype:bitmap',
    '"Hong Kong" "cha chaan teng" filetype:bitmap',
)
CATEGORIES = (
    "Hong Kong",
    "香港",
    "Sham Shui Po",
    "Sai Kung",
    "Yuen Long",
    "Tsuen Wan",
    "Causeway Bay",
    "Yau Tsim Mong",
    "Mong Kok",
    "Taikoo",
)
META = "Artist|DateTimeOriginal|Credit|LicenseShortName|LicenseUrl|ImageDescription|Restrictions|NonFree"
FLAGS = "Template:Delete|Template:Copyvio|Template:Speedydelete|Template:No permission since|Template:No license since|Template:Personality rights"
FRESH = timedelta(days=7)
FIELDS = ("id", "work", "checked")
CONFIG = CsvMappingConfiguration.model_validate(
    {
        "adapter_type": "csv",
        "config_schema_version": "1",
        "columns": [{"name": f, "column": f} for f in FIELDS],
        "record_schema": {
            "record_type": DATASET,
            "schema_version": "1",
            "identity_field": "id",
            "fields": [{"name": f, "required": True} for f in FIELDS],
        },
    }
)


class Markup(HTMLParser):
    def __init__(self, value):
        super().__init__(convert_charrefs=True)
        self.texts, self.links = [], []
        self.feed(value if isinstance(value, str) else "")

    def handle_data(self, data):
        self.texts.append(data)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "a" and attrs.get("href"):
            self.links.append((attrs["href"], attrs.get("title", "")))
        if tag in ("p", "br", "li"):
            self.texts.append(" ")

    @property
    def text(self):
        return " ".join("".join(self.texts).replace("\u200b", "").split())


def linked(fragment, host, path):
    for href, _ in fragment.links:
        parts = urlsplit("https:" + href if href.startswith("//") else href)
        if (
            parts.scheme in ("http", "https")
            and parts.netloc in host
            and re.fullmatch(path, parts.path)
        ):
            return "https://" + parts.netloc + parts.path.rstrip("/")
    return None


def creator_and_source(artist, credit):
    byline, source = Markup(artist), Markup(credit)
    commons = [
        title
        for href, title in byline.links
        if title.startswith("User:")
        and "/" not in title
        and href.removeprefix("https:").startswith("//commons.wikimedia.org/wiki/User:")
    ]
    if source.text == "Own work" and len(set(commons)) == 1:
        profile = "https://commons.wikimedia.org/wiki/" + quote(
            commons[0].replace(" ", "_"), safe=":_"
        )
        return byline.text, profile, "Wikimedia Commons", None
    for platform, hosts, profile_pattern, work_pattern in (
        (
            "Flickr",
            {"www.flickr.com", "flickr.com"},
            r"/people/[^/]+/?",
            r"/photos/[^/]+/\d+/?",
        ),
        ("500px", {"500px.com"}, r"/(?:p/)?[\w.-]+/?", r"/photo/\d+/[\w-]+/?"),
    ):
        profile = linked(byline, hosts, profile_pattern)
        original = linked(source, hosts, work_pattern)
        if profile and original:
            return byline.text.split(" from ")[0], profile, platform, original
    return None


def work_date(raw):
    text = Markup(raw).text
    try:
        if re.match(r"^\d{4}-\d{2}-\d{2}(?:$|[ ,T])", text):
            return date.fromisoformat(text[:10])
        return datetime.strptime(text, "%d %B %Y, %H:%M:%S (UTC)").date()
    except ValueError:
        return None


def localized(raw, fallback_language):
    if not isinstance(raw, dict):
        return Markup(raw).text, fallback_language, None, None
    local_language = next(
        (k for k in ("zh-hant", "zh-hk", "yue", "zh", "zh-hans") if raw.get(k)), None
    )
    local = Markup(raw.get(local_language)).text if local_language else None
    if raw.get("en"):
        return Markup(raw["en"]).text, "en", local, local_language
    return local or "", local_language or "und", None, None


def compact(value, limit=520):
    if not value or len(value) <= limit:
        return value
    return value[: limit - 1].rstrip() + "…"


def menu_observation(pid, image, profile):
    fingerprint = "34e4ed054f09b7afc4b45dd00773453841cdc8b4"
    if (
        pid == 153237769
        and image.get("sha1") == fingerprint
        and profile == "https://commons.wikimedia.org/wiki/User:JamezKinaLoon_V802"
    ):
        return {
            "source_text": "章魚小丸子 · Octopus Balls/Takoyaki · $25 6粒 (6 pieces) · $30 8粒 (8 pieces)",
            "interpretation": "The photographed menu lists six octopus balls for HK$25 and eight for HK$30.",
            "source_language": "zh-Hant / en",
            "image_sha1": fingerprint,
        }
    return None


def normalize(page, checked):
    pid = page.get("pageid")
    revision = page.get("lastrevid")
    if (
        not isinstance(pid, int)
        or not isinstance(revision, int)
        or page.get("templates")
        or page.get("ns") != 6
    ):
        return None
    image = (page.get("imageinfo") or [{}])[0]
    m = {k: v.get("value") for k, v in image.get("extmetadata", {}).items()}
    if (
        image.get("mime") not in ("image/jpeg", "image/png", "image/webp")
        or m.get("Restrictions")
        or m.get("NonFree")
    ):
        return None
    lic = str(m.get("LicenseUrl", "")).replace("http://", "https://").rstrip("/")
    lic = re.sub(r"/deed\.[a-z-]+$", "", lic) + "/"
    if not re.fullmatch(
        r"https://creativecommons\.org/(?:licenses/(?:by|by-sa)/(?:[1-4]\.0|2\.5)|publicdomain/zero/1\.0)/",
        lic,
    ):
        return None
    attribution = creator_and_source(m.get("Artist"), m.get("Credit"))
    when = work_date(m.get("DateTimeOriginal"))
    if not attribution or not when or when > checked.date():
        return None
    name, profile, platform, original = attribution
    if not name or len(name) > 150:
        return None
    excerpt, lang, local, local_lang = localized(m.get("ImageDescription"), "und")
    excerpt = re.split(
        r"\s+(?:Tel\.?\s*[: ]?\d|References:)", excerpt, maxsplit=1, flags=re.I
    )[0]
    title = page["title"].removeprefix("File:").rsplit(".", 1)[0]
    context = (title + " " + excerpt + " " + (local or "")).casefold()
    if not excerpt or (
        pid not in SEEDS and not any(s.casefold() in context for s in CATEGORIES)
    ):
        return None
    archive = f"https://commons.wikimedia.org/?curid={pid}"
    thumb = image.get("thumburl", "")
    parts = urlsplit(thumb)
    preview = (
        thumb
        if pid in PREVIEWS
        and parts.scheme == "https"
        and parts.netloc in {"upload.wikimedia.org", "thumb.wikimedia.org"}
        and parts.path.startswith("/wikipedia/commons/thumb/")
        and re.search(r"\.(jpg|jpeg|png|webp)$", parts.path, re.I)
        else None
    )
    return dict(
        id=str(pid),
        creator_id=uuid5(NAMESPACE_URL, profile).hex,
        name=name,
        profile_url=profile,
        title=title,
        date=when.isoformat(),
        excerpt=compact(excerpt),
        excerpt_language=lang,
        local_excerpt=compact(local),
        local_language=local_lang,
        archive_url=archive,
        revision_url=f"https://commons.wikimedia.org/w/index.php?oldid={revision}",
        original_url=original or archive,
        platform=platform,
        license=m["LicenseShortName"],
        license_url=lic,
        text_license_url=TEXT_LICENSE,
        thumbnail_url=preview,
        visual_evidence=menu_observation(pid, image, profile),
        pageviews=None,
    )


def get_json(url):
    try:
        with httpx2.stream(
            "GET",
            url,
            headers={"User-Agent": AGENT},
            timeout=9,
            follow_redirects=False,
            trust_env=False,
        ) as response:
            if (
                response.status_code in (401, 403, 429)
                or 300 <= response.status_code < 400
            ):
                raise MarketingError(
                    503, "directory_source_blocked", "Publisher access requires review"
                )
            if response.status_code == 404:
                return {}
            response.raise_for_status()
            data = bytearray()
            for chunk in response.iter_bytes(8192):
                data.extend(chunk)
                if len(data) > 2 * 1024 * 1024:
                    raise ValueError("Oversize response")
            result = json.loads(data)
            if not isinstance(result, dict) or "error" in result:
                raise ValueError("Upstream API error")
            return result
    except (httpx2.HTTPError, TypeError, ValueError) as error:
        raise MarketingError(
            503, "directory_source_unavailable", "Public source unavailable"
        ) from error


def query(**params):
    result = get_json(
        API
        + "?"
        + urlencode(
            dict(action="query", format="json", formatversion=2, maxlag=5, **params)
        )
    )
    if not isinstance(result.get("query"), dict):
        raise MarketingError(
            503, "directory_source_unavailable", "Commons returned no query result"
        )
    return result


def pageview(work_title, checked):
    end = checked.date().replace(day=1) - timedelta(days=1)
    start = end.replace(day=1)
    url = (
        "https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/commons.wikimedia/"
        "all-access/user/"
        + quote(work_title.replace(" ", "_"), safe="")
        + f"/monthly/{start:%Y%m%d}00/{end:%Y%m%d}00"
    )
    items = get_json(url).get("items") or []
    if len(items) != 1:
        return None
    item = items[0]
    if (
        item.get("agent") != "user"
        or item.get("timestamp") != start.strftime("%Y%m%d00")
        or type(item.get("views")) is not int
        or item["views"] < 0
    ):
        return None
    return dict(
        count=item["views"],
        month=start.strftime("%Y-%m"),
        source_url=url,
        scope="Commons file-page views",
        license_url=METRIC_LICENSE,
    )


def acquire():
    try:
        return collect_works()
    except (ValueError, TypeError, KeyError, AttributeError) as error:
        raise MarketingError(
            503, "directory_source_unavailable", "Unexpected public source record"
        ) from error


def collect_works():
    ids = set(SEEDS)
    deadline = monotonic() + 25
    for search in QUERIES:
        if monotonic() >= deadline:
            raise MarketingError(
                503,
                "directory_source_unavailable",
                "Discovery exceeded its time budget",
            )
        result = query(list="search", srnamespace=6, srlimit=8, srsearch=search)
        ids.update(
            hit["pageid"]
            for hit in result["query"].get("search", [])
            if isinstance(hit.get("pageid"), int)
        )
    data = query(
        pageids="|".join(map(str, sorted(ids))),
        prop="imageinfo|info|templates",
        iiprop="mime|url|sha1|extmetadata",
        iiurlwidth=330,
        iiextmetadatafilter=META,
        iiextmetadatamultilang=1,
        tltemplates=FLAGS,
        tllimit=500,
    )
    if "continue" in data:
        raise MarketingError(
            503, "directory_source_unavailable", "Incomplete source restrictions"
        )
    checked, rows, metrics_enabled = datetime.now(UTC), [], True
    for page in data["query"]["pages"]:
        row = normalize(page, checked)
        if row:
            if (
                metrics_enabled
                and monotonic() < deadline
                and page["pageid"] in SEEDS[:6]
            ):
                try:
                    row["pageviews"] = pageview(page["title"], checked)
                except MarketingError as error:
                    if error.code == "directory_source_blocked":
                        raise
                    metrics_enabled = False
            rows.append(row)
    return sorted(rows, key=lambda r: int(r["id"]))


def release_snapshot():
    data = json.loads(
        Path(__file__).with_name("commons-works.json").read_text(encoding="utf-8")
    )
    checked = datetime.fromisoformat(data["observed"])
    return checked, data["records"] if checked + FRESH > datetime.now(UTC) else []


def entry(records, observed=None):
    checked = (observed or datetime.now(UTC)).isoformat()
    buffer = io.StringIO(newline="")
    writer = csv.DictWriter(buffer, fieldnames=FIELDS, lineterminator="\n")
    writer.writeheader()
    for row in records:
        writer.writerow(
            dict(
                id=row["id"],
                work=json.dumps(row, ensure_ascii=False, separators=(",", ":")),
                checked=checked,
            )
        )
    return CsvEntry(adapter_type="csv", dataset_id=DATASET, content=buffer.getvalue())


def feed():
    return PublicFeed(
        2,
        DATASET,
        "Credited Hong Kong works on Wikimedia Commons",
        RIGHTS,
        CONFIG,
        FRESH,
        acquire,
        release_snapshot,
        entry,
        hold_during_refresh=True,
    )
