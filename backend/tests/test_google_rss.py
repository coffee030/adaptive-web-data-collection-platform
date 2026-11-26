import csv
import json
from contextlib import contextmanager
from datetime import timedelta
from hashlib import sha256
from io import StringIO
from types import SimpleNamespace

import httpx2
import pytest

from backend.trends import google_rss as google


def xml(market="HK"):
    return f"""<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:ht="https://trends.google.com/trending/rss"><channel>
    <atom:link rel="self" href="https://trends.google.com/trending/rss?geo={market}"/>
    <item><title>快餐</title><pubDate>Thu, 26 Nov 2026 12:00:00 -0800</pubDate>
    <ht:approx_traffic>1,000+</ht:approx_traffic><ht:news_item><ht:news_item_title>Third-party text</ht:news_item_title></ht:news_item></item>
    <item><title>食肆</title><pubDate>Thu, 26 Nov 2026 11:00:00 -0800</pubDate></item></channel></rss>""".encode()


def snapshot(market="HK"):
    raw = xml(market)
    return {
        "market": market,
        "source_url": google.feed_url(market),
        "observed_at": "2026-11-26T21:00:00Z",
        "attribution": google.ATTRIBUTION,
        "http": 200,
        "body_sha256": sha256(raw).hexdigest(),
        "rows": google.parse_feed(market, raw),
    }


def records(data):
    return list(csv.DictReader(StringIO(google.entry(data).content)))


def test_market_event_and_measurement_are_independent_and_attributed():
    data = snapshot()
    first, missing = records(data)
    assert (
        first["query"] == "快餐"
        and first["region"] == "HK"
        and first["published_at"] == "2026-11-26T20:00:00+00:00"
    )
    assert (
        first["traffic_bucket"] == "1,000+" and first["traffic_lower_bound"] == "1000"
    )
    assert first["attribution"] == google.ATTRIBUTION and first[
        "source_url"
    ] == google.feed_url("HK")
    assert (
        "Third-party" not in google.entry(data).content
        and "approximate" in first["metric"]
    )
    assert missing["traffic_lower_bound"] == missing["traffic_bucket"] == ""
    assert records(data | {"rows": [*data["rows"], data["rows"][0]]}) == [
        first,
        missing,
    ]
    revised = data | {
        "observed_at": "2026-11-26T22:00:00Z",
        "rows": [data["rows"][0] | {"approx_traffic": "2K+"}],
    }
    (later,) = records(revised)
    assert (
        later["event_id"] == first["event_id"]
        and later["measurement_id"] != first["measurement_id"]
        and later["traffic_lower_bound"] == "2000"
    )
    assert records(snapshot("JP"))[0]["event_id"] != first["event_id"]
    assert (
        google.event_key("HK", " 快餐 ", data["rows"][0]["published_at"])
        == google.event_key("HK", "快餐", "Thu, 26 Nov 2026 20:00:00 +0000")
        == first["event_id"]
    )
    assert google.MAPPING.record_schema.identity_field == "measurement_id"


def test_invalid_scope_malformed_data_and_conflict_do_not_become_observations():
    data = snapshot()
    with pytest.raises(google.ProviderError):
        google.parse_feed("JP", xml("HK"))
    with pytest.raises(google.ProviderError):
        google.parse_feed("HK", b'<!DOCTYPE rss [<!ENTITY e "injected">]>' + xml())
    with pytest.raises(google.ProviderError, match="no_data"):
        google.entry(data | {"rows": []})
    with pytest.raises(google.ProviderError):
        google.entry(
            data
            | {"rows": [data["rows"][0], data["rows"][0] | {"approx_traffic": "400+"}]}
        )
    for field, value in (
        ("approx_traffic", "200"),
        ("published_at", "not a supplied time"),
        ("query", ""),
    ):
        with pytest.raises(google.ProviderError):
            google.entry(data | {"rows": [data["rows"][0] | {field: value}]})
    with pytest.raises(ValueError):
        google.feed_url("HK&other=1")


class RedisState(dict):
    def exists(self, key):
        return key in self

    def set(self, key, value, *, nx):
        assert nx
        return self.setdefault(key, value)

    def close(self):
        pass


class Rate:
    def __init__(self, state):
        self.slots = []
        self.redis = state

    @contextmanager
    def request(self, origin, interval, deadline):
        assert origin == google.ORIGIN and deadline > 0
        state = SimpleNamespace(interval_ms=interval, retry_after_ms=0)
        self.slots.append(state)
        yield state


@pytest.fixture
def source(monkeypatch):
    state = RedisState()
    calls = []
    rates = []
    replies = []
    real_client = httpx2.Client

    def respond(request):
        calls.append((str(request.url), request.headers["user-agent"]))
        status, headers, body = replies.pop(0)
        return httpx2.Response(status, headers=headers, stream=httpx2.ByteStream(body))

    transport = httpx2.MockTransport(respond)
    monkeypatch.setattr(
        google.httpx2, "Client", lambda **kw: real_client(**kw, transport=transport)
    )

    def connect(url):
        rate = Rate(state)
        rates.append(rate)
        return rate

    monkeypatch.setattr(google, "OriginRate", connect)
    return SimpleNamespace(state=state, calls=calls, rates=rates, replies=replies)


ALLOW = (
    200,
    {"Content-Type": "text/plain"},
    b"User-agent: *\nDisallow: /explore?\nCrawl-delay: 2\n",
)


@pytest.mark.parametrize("block", ["robots_policy", "robots_http", "feed_http"])
def test_new_capture_after_access_denial_makes_no_requests(source, block):
    if block == "robots_policy":
        bot = google.AGENT.split("/")[0]
        rules = f"User-agent: *\nAllow: /\nUser-agent: {bot}\nDisallow: /trending/rss\n".encode()
        source.replies.append((200, {"Content-Type": "text/plain"}, rules))
    else:
        if block == "feed_http":
            source.replies.append(ALLOW)
        source.replies.append((403, {}, b""))
    with pytest.raises(google.ProviderError, match="access_blocked") as refusal:
        google.capture("HK")
    urls = [google.ROBOTS]
    if block == "feed_http":
        urls.append(google.feed_url("HK"))
    assert refusal.value.retry is None
    assert source.calls == [(url, google.AGENT) for url in urls]
    marker = source.state[google.ACCESS_STOP_KEY]
    assert json.loads(marker)["url"] == urls[-1]
    with pytest.raises(google.ProviderError, match="access_blocked") as stopped:
        google.capture("JP")
    assert stopped.value.retry is None
    assert source.rates[0] is not source.rates[1]
    assert source.calls == [(url, google.AGENT) for url in urls]
    assert source.state[google.ACCESS_STOP_KEY] == marker and not source.replies


def test_robots_interval_and_temporary_rate_limit_do_not_block_source(source):
    source.replies.extend([ALLOW, (429, {"Retry-After": "7200"}, b"")])
    with pytest.raises(google.ProviderError, match="rate_limited") as failure:
        google.capture("HK")
    rate = source.rates[-1]
    assert (
        failure.value.retry == timedelta(hours=2)
        and rate.slots[-1].retry_after_ms == 7200000
    )
    assert source.calls == [
        (google.ROBOTS, google.AGENT),
        (google.feed_url("HK"), google.AGENT),
    ]
    assert rate.slots[-2].interval_ms == rate.slots[-1].interval_ms == 2000
    assert google.ACCESS_STOP_KEY not in source.state
    source.replies.extend(
        [ALLOW, (200, {"Content-Type": "application/rss+xml"}, xml())]
    )
    measured = google.capture("HK")
    assert (
        len(measured["rows"]) == 2
        and measured["body_sha256"] == sha256(xml()).hexdigest()
    )
    assert not source.replies
