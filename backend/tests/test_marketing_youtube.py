import json
from uuid import uuid4

import httpx2
import pytest

from backend.marketing.contracts import Metric, permits_youtube
from backend.marketing.youtube import ProviderError, YouTube
from backend.tests.marketing_fixture import (
    CHANNEL,
    FIRST,
    SECOND,
    THIRD,
    channel_stats,
    results,
    upload,
    video,
)


def test_incremental_uploads_and_nullable_metrics():
    seen = []
    refresh = False

    def respond(request):
        endpoint = request.url.path.rsplit("/", 1)[-1]
        seen.append(endpoint)
        assert request.url.host == "www.googleapis.com"
        assert request.headers["x-goog-api-key"] == "fixture"
        assert "key" not in request.url.params
        if endpoint == "channels":
            assert request.url.params["id"] == CHANNEL
            return results(channel_stats())
        if endpoint == "playlistItems":
            assert request.url.params["maxResults"] == "25"
            if refresh:
                assert "pageToken" not in request.url.params
                return results(upload(THIRD), upload(SECOND), nextPageToken="unneeded")
            if request.url.params.get("pageToken") == "older":
                return results(upload(FIRST), nextPageToken="beyond-budget")
            return results(upload(SECOND), upload(SECOND), nextPageToken="older")
        assert set(request.url.params["id"].split(",")) == (
            {FIRST, SECOND, THIRD} if refresh else {FIRST, SECOND}
        )
        if refresh:
            return results(video(THIRD, 3), video(SECOND, 2, privacy="unlisted"))
        return results(video(SECOND, 2), video(FIRST))

    charges = []
    with httpx2.Client(transport=httpx2.MockTransport(respond)) as client:
        connector = YouTube(client, "fixture", uuid4(), charges.append)
        initial = connector.refresh(CHANNEL, [])
        assert initial.truncated
        assert [post.video_id for post in initial.posts] == [SECOND, FIRST]
        assert initial.channel.subscribers == Metric(status="hidden")
        assert initial.posts[0].views == Metric(status="available", value=0)
        assert initial.posts[0].likes == Metric(status="unavailable")
        assert initial.posts[0].comments == Metric(status="available", value=42)
        assert initial.posts[0].duration_iso8601 == "PT58S"
        assert initial.posts[0].category_id == "22"
        assert initial.posts[0].content_format == "unsupported"
        refresh = True
        updated = connector.refresh(CHANNEL, initial.posts)
    assert not updated.truncated
    assert [post.video_id for post in updated.posts] == [THIRD]
    assert (
        charges
        == seen
        == [
            "channels",
            "playlistItems",
            "playlistItems",
            "videos",
            "channels",
            "playlistItems",
            "videos",
        ]
    )


@pytest.mark.parametrize(
    ("status", "reason", "code", "retry"),
    [
        (401, None, "provider_access_blocked", None),
        (403, "quotaExceeded", "provider_quota", None),
        (403, "rateLimitExceeded", "provider_rate_limited", 91),
        (429, None, "provider_rate_limited", 91),
        (503, None, "provider_unavailable", 91),
        (302, None, "provider_request_rejected", None),
    ],
)
def test_provider_errors_are_safe_and_redirects_are_not_followed(
    status, reason, code, retry
):
    calls = []

    def respond(request):
        calls.append(request.url.host)
        body = {"error": {"message": "secret", "errors": [{"reason": reason}]}}
        return httpx2.Response(
            status,
            content=json.dumps(body).encode(),
            headers={"Retry-After": "91", "Location": "https://example.test/"},
        )

    with httpx2.Client(
        transport=httpx2.MockTransport(respond), follow_redirects=True
    ) as client:
        with pytest.raises(ProviderError) as raised:
            YouTube(client, "fixture", uuid4(), lambda endpoint: None).refresh(
                CHANNEL, []
            )
    assert calls == ["www.googleapis.com"]
    assert str(raised.value) == code
    assert raised.value.retry_seconds == retry


@pytest.mark.parametrize(
    "second_response",
    [
        results(upload(FIRST), nextPageToken="repeated"),
        results(upload("not,a,real,id")),
    ],
)
def test_rejects_looping_tokens_or_invalid_ids_before_video_lookup(second_response):
    fixture = iter(
        [results(channel_stats()), results(nextPageToken="repeated"), second_response]
    )
    with httpx2.Client(
        transport=httpx2.MockTransport(lambda _: next(fixture))
    ) as client:
        with pytest.raises(ProviderError, match="provider_response_invalid"):
            YouTube(client, "fixture", uuid4(), lambda endpoint: None).refresh(
                CHANNEL, []
            )


def test_use_gate_and_metric_invariants():
    assert permits_youtube("research")
    assert all(
        not permits_youtube(purpose)
        for purpose in ("analytics", "aggregation", "training", "commercial", "export")
    )
    with pytest.raises(ValueError):
        Metric(status="available")
    with pytest.raises(ValueError):
        Metric(status="expired", value=0)
