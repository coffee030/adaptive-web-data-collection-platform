"""Acquire attributed publications from bounded, explicitly licensed publisher APIs."""

import html
import re
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from email.utils import parsedate_to_datetime
from time import monotonic, sleep
from urllib.parse import urlencode, urlsplit
from uuid import NAMESPACE_URL, uuid5

import httpx2

from backend.marketing.store import MarketingError

AGENT = "Harbourline/1.0 (+https://github.com/coffee030/adaptive-web-data-collection-platform)"
CC = "https://creativecommons.org/"
LICENSES = {"cc0": CC + "publicdomain/zero/1.0/", "cc-by": CC + "licenses/by/4.0/"}
HK = re.compile(r"hong\s*kong|香港", re.I)
MAX_BYTES = 4 * 1024 * 1024
FRESH = timedelta(hours=48)


class PublisherError(MarketingError):
    def __init__(self, code, retry_after=3600):
        super().__init__(503, code, "The publisher could not supply an eligible update")
        self.retry_after = retry_after


class Reader:
    def __init__(self):
        self.requests = self.byte_count = 0
        self.next_request = 0.0

    def json(self, url, params):
        sleep(max(0, self.next_request - monotonic()))
        self.next_request = monotonic() + 1.15
        self.requests += 1
        try:
            with httpx2.stream(
                "GET",
                url + "?" + urlencode(params),
                timeout=14,
                headers={"User-Agent": AGENT, "Accept": "application/json"},
                follow_redirects=False,
                trust_env=False,
            ) as response:
                if (
                    response.status_code in (401, 403, 451)
                    or 300 <= response.status_code < 400
                ):
                    raise PublisherError("publisher_access_blocked")
                if response.status_code == 429:
                    retry = response.headers.get("retry-after", "")
                    try:
                        seconds = (
                            int(retry)
                            if retry.isdigit()
                            else (
                                parsedate_to_datetime(retry) - datetime.now(UTC)
                            ).total_seconds()
                        )
                    except (ValueError, TypeError, OverflowError):
                        seconds = 3600
                    raise PublisherError(
                        "publisher_rate_limited", max(3600, min(seconds, 2_592_000))
                    )
                response.raise_for_status()
                body = bytearray()
                for chunk in response.iter_bytes(16384):
                    body.extend(chunk)
                    if len(body) > MAX_BYTES:
                        raise PublisherError("publisher_response_too_large")
                self.byte_count += len(body)
                import json

                return json.loads(body), response.headers
        except (httpx2.HTTPError, ValueError, UnicodeError) as error:
            raise PublisherError("publisher_unavailable") from error


def text(value, limit=320):
    if not isinstance(value, str):
        return ""
    return " ".join(html.unescape(re.sub(r"<[^>]+>", " ", value)).split())[:limit]


def owned_url(value, host, prefix):
    if not isinstance(value, str):
        return None
    parts = urlsplit(value)
    return (
        value
        if parts.scheme == "https"
        and parts.netloc == host
        and parts.path.startswith(prefix)
        and not parts.query
        and not parts.fragment
        else None
    )


def publication(
    source,
    key,
    name,
    profile,
    title,
    published,
    url,
    topics,
    license_url,
    metrics,
    *,
    excerpt=None,
):
    try:
        when = datetime.fromisoformat(published.replace("Z", "+00:00"))
    except (TypeError, ValueError, AttributeError):
        return None
    if not when.tzinfo:
        when = when.replace(tzinfo=UTC)
    if not (name and profile and title and url) or when > datetime.now(UTC) + timedelta(
        minutes=5
    ):
        return None
    return dict(
        id=source + "-" + str(key),
        creator_id=uuid5(NAMESPACE_URL, profile).hex,
        creator_name=text(name, 150),
        profile_url=profile,
        title=text(title),
        excerpt=text(excerpt, 500) or None,
        published_at=when.astimezone(UTC).isoformat(),
        url=url,
        topics=list(dict.fromkeys(topics)),
        license_url=license_url,
        metrics=[
            dict(key=key, label=label, value=value)
            for key, label, value in metrics
            if type(value) is int and value >= 0
        ],
    )


SPECIES = {
    "Aves": "Birds",
    "Insecta": "Insects",
    "Plantae": "Plants",
    "Mammalia": "Mammals",
    "Reptilia": "Reptiles",
    "Amphibia": "Amphibians",
    "Fungi": "Fungi",
    "Mollusca": "Molluscs",
    "Arachnida": "Arachnids",
    "Actinopterygii": "Fish",
}


def nature_rows(reader, now, since=None, sample=False):
    endpoint = "https://api.inaturalist.org/v2/observations"
    params = dict(
        place_id=7613,
        quality_grade="research",
        license="cc-by,cc0",
        photo_license="cc-by,cc0",
        photos="true",
        created_d1=(now.date() - timedelta(days=365)).isoformat(),
        created_d2=now.date().isoformat(),
        fields="id,created_at,observed_on,license_code,faves_count,comments_count,place_ids,user.id,user.login,taxon.name,taxon.preferred_common_name,taxon.iconic_taxon_name,photos.license_code",
        order_by="id",
        order="desc",
        per_page=10 if sample else 200,
    )
    if since:
        params["updated_since"] = (since - timedelta(minutes=5)).isoformat()
    for page in range(1, 26):
        doc, _ = reader.json(endpoint, params)
        raw = doc.get("results")
        if not isinstance(raw, list) or not isinstance(doc.get("total_results"), int):
            raise PublisherError("publisher_schema_changed")
        for value in raw:
            user = value.get("user") or {}
            taxon = value.get("taxon") or {}
            name = user.get("login") or ""
            key = value.get("id")
            license_url = LICENSES.get(value.get("license_code"))
            if (
                not license_url
                or 7613 not in (value.get("place_ids") or [])
                or not any(
                    p.get("license_code") in LICENSES for p in value.get("photos") or []
                )
                or type(key) is not int
                or not re.fullmatch(r"[\w-]{1,100}", name)
            ):
                continue
            species = taxon.get("preferred_common_name") or taxon.get("name")
            if not species:
                continue
            topic = SPECIES.get(taxon.get("iconic_taxon_name"), "Wildlife")
            row = publication(
                "inat",
                key,
                name,
                "https://www.inaturalist.org/people/" + name,
                f"{species} observed in Hong Kong",
                value.get("created_at"),
                f"https://www.inaturalist.org/observations/{key}",
                ["Nature", "Outdoor photography", topic],
                license_url,
                [
                    ("favorites", "Observation favorites", value.get("faves_count")),
                    ("comments", "Observation comments", value.get("comments_count")),
                ],
                excerpt=f"Research-grade {taxon.get('name', species)} observation. Field date {value.get('observed_on') or 'unavailable'}.",
            )
            if row:
                yield row
        if sample or len(raw) < params["per_page"]:
            return
        oldest = min(v["id"] for v in raw)
        if oldest >= params.get("id_below", oldest + 1):
            raise PublisherError("publisher_cursor_stalled")
        params["id_below"] = oldest
    raise PublisherError("publisher_scope_exceeds_limit")


def photo_rows(reader, now, since=None, sample=False):
    endpoint = "https://wordpress.org/photos/wp-json/wp/v2/photos"
    terms = {
        "food-drink": "Food and drink",
        "food": "Food and drink",
        "architecture": "Architecture",
        "travel": "Travel",
        "nature": "Nature",
        "people": "People",
        "transportation": "Transport",
    }
    params = {
        "search": "Hong Kong",
        "per_page": 10 if sample else 50,
        "_embed": "author,wp:term",
        "_fields": "id,date_gmt,link,content,_links,_embedded",
        "after": (now - timedelta(days=365 * 5)).strftime("%Y-%m-%dT00:00:00"),
        "orderby": "date",
        "order": "desc",
    }
    if since:
        params["modified_after"] = (since - timedelta(minutes=5)).strftime(
            "%Y-%m-%dT%H:%M:%S"
        )
    for page in range(1, 9):
        raw, headers = reader.json(endpoint, dict(params, page=page))
        if not isinstance(raw, list):
            raise PublisherError("publisher_schema_changed")
        for value in raw:
            description = text((value.get("content") or {}).get("rendered"))
            embedded = value.get("_embedded", {})
            author = next(iter(embedded.get("author", [])), {})
            profile = owned_url(author.get("link"), "wordpress.org", "/photos/author/")
            url = owned_url(value.get("link"), "wordpress.org", "/photos/photo/")
            if not HK.search(description) or not profile or not url:
                continue
            tags = [
                term.get("slug", "")
                for group in embedded.get("wp:term", [])
                if isinstance(group, list)
                for term in group
                if isinstance(term, dict)
            ]
            topics = ["Photography"] + [terms[t] for t in tags if t in terms]
            row = publication(
                "wpp",
                value.get("id"),
                author.get("name"),
                profile,
                description,
                value.get("date_gmt"),
                url,
                topics,
                LICENSES["cc0"],
                [],
            )
            if row:
                yield row
        if sample or page >= int(headers.get("x-wp-totalpages", "1")):
            return
    raise PublisherError("publisher_scope_exceeds_limit")


def video_rows(reader, now, since=None, sample=False):
    host = "video.canadiancivil.com"
    raw, _ = reader.json(
        "https://" + host + "/api/v1/search/videos",
        {"search": "Hong Kong", "count": 100, "isLocal": "true", "nsfw": "false"},
    )
    if not isinstance(raw.get("data"), list) or raw.get("total", 101) > 100:
        raise PublisherError("publisher_scope_exceeds_limit")
    for value in raw["data"]:
        name = value.get("name") or ""
        channel, account = value.get("channel") or {}, value.get("account") or {}
        license_url = {
            1: LICENSES["cc-by"],
            2: CC + "licenses/by-sa/4.0/",
            7: LICENSES["cc0"],
        }.get((value.get("licence") or {}).get("id"))
        profile = owned_url(channel.get("url"), host, "/video-channels/")
        url = owned_url(value.get("url"), host, "/videos/watch/")
        if (
            not HK.search(name)
            or not license_url
            or not value.get("isLocal")
            or value.get("nsfw") is not False
            or (value.get("privacy") or {}).get("id") != 1
            or value.get("isLive")
            or not profile
            or not url
            or account.get("host") != host
            or channel.get("host") != host
        ):
            continue
        row = publication(
            "pt",
            value.get("uuid"),
            channel.get("displayName"),
            profile,
            name,
            value.get("publishedAt"),
            url,
            ["Video", "Urban travel"]
            if re.search("MTR|transit|transport", name, re.I)
            else ["Video"],
            license_url,
            [
                ("views", "PeerTube video views", value.get("views")),
                ("likes", "PeerTube video likes", value.get("likes")),
                ("comments", "PeerTube video comments", value.get("comments")),
            ],
        )
        if row:
            yield row


@dataclass(frozen=True)
class SourceSpec:
    key: str
    name: str
    platform: str
    rights_url: str
    measure: str
    load: Callable
    incremental: bool


SOURCES = {
    s.key: s
    for s in (
        SourceSpec(
            "inaturalist",
            "Hong Kong nature observations",
            "iNaturalist",
            "https://help.inaturalist.org/en/support/solutions/articles/151000175695",
            "Favorites and comments on individual Hong Kong observations",
            nature_rows,
            True,
        ),
        SourceSpec(
            "wordpress-photos",
            "Hong Kong community photography",
            "WordPress Photo Directory",
            "https://wordpress.org/photos/faq/",
            "Publication dates only",
            photo_rows,
            True,
        ),
        SourceSpec(
            "canadian-civil",
            "Hong Kong transit and urban video",
            "PeerTube · Canadian Civil",
            "https://video.canadiancivil.com/about/instance",
            "Views, likes and comments on the local PeerTube video",
            video_rows,
            False,
        ),
    )
}
