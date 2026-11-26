from backend.trends.google_cli import delta


def test_incremental_keeps_new_events_with_no_reported_bucket():
    prior = {
        "market": "HK",
        "observed_at": "2026-11-27T03:15:00+08:00",
        "rows": [
            {
                "query": "Duplicate",
                "published_at": "Thu, 26 Nov 2026 10:30:00 -0800",
                "approx_traffic": None,
            }
        ],
    }
    current = {
        "market": "HK",
        "observed_at": "2026-11-26T19:30:00Z",
        "rows": [
            {
                "query": "Duplicate",
                "published_at": "Thu, 26 Nov 2026 18:30:00 +0000",
                "approx_traffic": None,
            },
            {
                "query": "New",
                "published_at": "Thu, 26 Nov 2026 11:00:00 -0800",
                "approx_traffic": None,
            },
        ],
    }
    assert delta(current, prior)["rows"] == current["rows"][1:]
