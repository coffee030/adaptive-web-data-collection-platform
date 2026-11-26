"""Bounded acquisition from the official YouTube Data API."""

import json
import re
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime
from typing import Literal
from uuid import UUID

import httpx2
from pydantic import TypeAdapter, ValidationError

from .contracts import (
    DISCOVERY_RETENTION,
    RETENTION,
    SOURCE_URL,
    ChannelId,
    ChannelSnapshot,
    Lead,
    Metric,
    Post,
    Provenance,
    VideoId,
)

Endpoint = Literal["channels", "playlistItems", "videos", "search"]
MAX_PAGES = 2
PAGE_SIZE = 25
POST_LIMIT = MAX_PAGES * PAGE_SIZE
DISCOVERY_LIMIT = 10
MAX_RESPONSE_BYTES = 1_000_000
VIDEO_ID = TypeAdapter(VideoId)
UPLOADS_PLAYLIST = re.compile(r"^UU[A-Za-z0-9_-]{22}$")


class ProviderError(Exception):
    def __init__(self, code: str, *, retry_seconds: int | None = None):
        super().__init__(code)
        self.code = code
        self.retry_seconds = retry_seconds


@dataclass(frozen=True)
class Refresh:
    channel: ChannelSnapshot | None
    posts: list[Post]
    truncated: bool = False


def _retry_after(value: str | None) -> int:
    if not value:
        return 0
    try:
        if value.isascii() and value.isdecimal():
            return int(value[:10]) if len(value) <= 10 else 86400
        date = parsedate_to_datetime(value)
        return max(0, int((date - datetime.now(UTC)).total_seconds()) + 1)
    except (ValueError, TypeError, OverflowError):
        return 0


def _error(status: int, headers: httpx2.Headers, body: bytes) -> ProviderError:
    codes = set()
    try:
        error = json.loads(body)["error"]
        codes = {
            item.get("reason")
            for item in error.get("errors", []) + error.get("details", [])
        }
    except (ValueError, TypeError, KeyError, AttributeError):
        pass
    if codes & {"quotaExceeded", "dailyLimitExceeded", "QUOTA_EXCEEDED"}:
        return ProviderError("provider_quota")
    delay = _retry_after(headers.get("Retry-After"))
    if status == 429 or codes & {"rateLimitExceeded", "userRateLimitExceeded"}:
        return ProviderError("provider_rate_limited", retry_seconds=max(30, delay))
    if status in {401, 403} or codes & {"keyInvalid", "API_KEY_INVALID"}:
        return ProviderError("provider_access_blocked")
    if status == 404 and "playlistNotFound" in codes:
        return ProviderError("uploads_unavailable")
    if 500 <= status <= 599:
        return ProviderError(
            "provider_unavailable",
            retry_seconds=max(10, delay),
        )
    return ProviderError("provider_request_rejected")


def _metric(values: dict, key: str, *, hidden: bool = False) -> Metric:
    if hidden:
        return Metric(status="hidden")
    value = values.get(key)
    if isinstance(value, str) and value.isascii() and value.isdecimal():
        value = int(value)
    if type(value) is int and value >= 0:
        return Metric(status="available", value=value)
    return Metric(status="unavailable")


class YouTube:
    def __init__(
        self,
        client: httpx2.Client,
        key: str,
        run_id: UUID,
        reserve: Callable[[Endpoint], None],
    ):
        self.client = client
        self.key = key
        self.run_id = run_id
        self.reserve = reserve

    def _list(self, endpoint: Endpoint, **params: str | int) -> tuple[dict, Provenance]:
        self.reserve(endpoint)
        try:
            with self.client.stream(
                "GET",
                SOURCE_URL + endpoint,
                params=params,
                headers={"X-Goog-Api-Key": self.key, "Accept": "application/json"},
                follow_redirects=False,
            ) as response:
                body = bytearray()
                for chunk in response.iter_bytes(chunk_size=16384):
                    body.extend(chunk)
                    if len(body) > MAX_RESPONSE_BYTES:
                        if response.status_code != 200:
                            raise _error(response.status_code, response.headers, b"")
                        raise ProviderError("provider_response_limit")
                if response.status_code != 200:
                    raise _error(response.status_code, response.headers, bytes(body))
        except httpx2.RequestError:
            raise ProviderError("provider_transport", retry_seconds=10) from None
        try:
            document = json.loads(body)
            items = document["items"]
            if not isinstance(items, list) or len(items) > 50:
                raise ValueError("Invalid results")
        except (ValueError, TypeError, KeyError):
            raise ProviderError("provider_response_invalid") from None
        now = datetime.now(UTC)
        retention = DISCOVERY_RETENTION if endpoint == "search" else RETENTION
        return document, Provenance(
            endpoint=endpoint,
            run_id=self.run_id,
            observed_at=now,
            expires_at=now + retention,
        )

    def discover(self, query: str) -> list[Lead]:
        document, evidence = self._list(
            "search",
            part="snippet",
            type="channel",
            q=query,
            maxResults=DISCOVERY_LIMIT,
            fields="items(id(channelId),snippet(title))",
        )
        leads = {}
        try:
            for item in document["items"][:DISCOVERY_LIMIT]:
                channel = item["id"]["channelId"]
                leads[channel] = Lead(
                    channel_id=channel,
                    title=item["snippet"]["title"],
                    url=f"https://www.youtube.com/channel/{channel}",
                    provenance=evidence,
                )
        except (KeyError, TypeError, AttributeError, ValidationError):
            raise ProviderError("provider_response_invalid") from None
        return list(leads.values())

    def refresh(self, channel_id: ChannelId, previous: list[Post]) -> Refresh:
        try:
            return self._refresh(channel_id, previous)
        except (KeyError, TypeError, AttributeError, ValueError):
            raise ProviderError("provider_response_invalid") from None

    def _refresh(self, channel_id: ChannelId, previous: list[Post]) -> Refresh:
        document, provenance = self._list(
            "channels",
            id=channel_id,
            part="snippet,contentDetails,statistics",
            fields="items(id,snippet(title),contentDetails(relatedPlaylists(uploads)),"
            "statistics(subscriberCount,hiddenSubscriberCount))",
        )
        if not document["items"]:
            return Refresh(None, [])
        (item,) = document["items"]
        if item["id"] != channel_id:
            raise ValueError("Unrequested channel")
        stats = item.get("statistics", {})
        channel = ChannelSnapshot(
            channel_id=channel_id,
            title=item["snippet"]["title"],
            url=f"https://www.youtube.com/channel/{channel_id}",
            subscribers=_metric(
                stats,
                "subscriberCount",
                hidden=stats.get("hiddenSubscriberCount") is True,
            ),
            provenance=provenance,
        )
        playlist = item["contentDetails"]["relatedPlaylists"].get("uploads")
        if playlist is None:
            return Refresh(channel, [])
        if not UPLOADS_PLAYLIST.fullmatch(playlist):
            raise ValueError("Invalid uploads playlist")
        try:
            uploads, truncated = self._uploads(
                playlist, {post.video_id for post in previous}
            )
        except ProviderError as error:
            if error.code == "uploads_unavailable":
                return Refresh(channel, [])
            raise
        for post in previous:
            evidence = post.uploads_provenance
            uploads.setdefault(
                post.video_id,
                evidence
                if evidence and evidence.expires_at > provenance.observed_at
                else None,
            )
        posts = self._videos(channel_id, uploads)
        posts.sort(key=lambda post: (post.published_at, post.video_id), reverse=True)
        return Refresh(channel, posts[:POST_LIMIT], truncated)

    def _uploads(
        self, playlist: str, known: set[str]
    ) -> tuple[dict[VideoId, Provenance | None], bool]:
        uploads = {}
        token = None
        seen_tokens = set()
        for _ in range(MAX_PAGES):
            page, evidence = self._list(
                "playlistItems",
                part="contentDetails",
                playlistId=playlist,
                maxResults=PAGE_SIZE,
                fields="nextPageToken,items(contentDetails(videoId))",
                **({"pageToken": token} if token else {}),
            )
            if len(page["items"]) > PAGE_SIZE:
                raise ValueError("Uploads page exceeded its limit")
            ids = {
                VIDEO_ID.validate_python(item["contentDetails"]["videoId"]): evidence
                for item in page["items"]
            }
            uploads.update(ids)
            token = page.get("nextPageToken")
            if not token or known.intersection(ids):
                return uploads, False
            if not isinstance(token, str) or token in seen_tokens:
                raise ValueError("Invalid uploads pagination")
            seen_tokens.add(token)
        return uploads, True

    def _videos(
        self, channel: ChannelId, uploads: dict[VideoId, Provenance | None]
    ) -> list[Post]:
        posts = {}
        ids = list(uploads)
        for offset in range(0, len(ids), 50):
            batch = set(ids[offset : offset + 50])
            document, evidence = self._list(
                "videos",
                part="snippet,statistics,status,contentDetails",
                id=",".join(sorted(batch)),
                fields="items(id,snippet(channelId,publishedAt,title,categoryId),"
                "statistics(viewCount,likeCount,commentCount),status(privacyStatus),"
                "contentDetails(duration))",
            )
            for item in document["items"]:
                video, snippet = item["id"], item["snippet"]
                if video not in batch or snippet["channelId"] != channel:
                    raise ValueError("Unrequested video")
                if item.get("status", {}).get("privacyStatus") != "public":
                    continue
                stats = item.get("statistics", {})
                posts[video] = Post(
                    video_id=video,
                    channel_id=channel,
                    published_at=snippet["publishedAt"],
                    title=snippet["title"],
                    url=f"https://www.youtube.com/watch?v={video}",
                    duration_iso8601=item.get("contentDetails", {}).get("duration"),
                    category_id=snippet.get("categoryId"),
                    views=_metric(stats, "viewCount"),
                    likes=_metric(stats, "likeCount"),
                    comments=_metric(stats, "commentCount"),
                    provenance=evidence,
                    uploads_provenance=uploads[video],
                )
        return list(posts.values())
