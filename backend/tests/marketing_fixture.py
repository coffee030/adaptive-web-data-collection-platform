"""Synthetic YouTube Data API responses used by connector and worker tests."""

import httpx2

CHANNEL = "UC" + "A" * 22
OTHER_CHANNEL = "UC" + "B" * 22
UPLOADS = "UU" + "A" * 22
FIRST = "F" * 11
SECOND = "S" * 11
THIRD = "T" * 11


def channel_stats():
    return {
        "id": CHANNEL,
        "snippet": {"title": "Synthetic creator"},
        "contentDetails": {"relatedPlaylists": {"uploads": UPLOADS}},
        "statistics": {"subscriberCount": "123", "hiddenSubscriberCount": True},
    }


def upload(video_id):
    return {"contentDetails": {"videoId": video_id}}


def video(video_id, day=1, *, privacy="public"):
    return {
        "id": video_id,
        "snippet": {
            "channelId": CHANNEL,
            "title": f"Synthetic post {video_id}",
            "publishedAt": f"2025-02-{day:02d}T01:00:00Z",
            "categoryId": "22",
        },
        "status": {"privacyStatus": privacy},
        "statistics": {"viewCount": "0", "commentCount": "42"},
        "contentDetails": {"duration": "PT58S"},
    }


def results(*items, **extra):
    return httpx2.Response(200, json={"items": items, **extra})


def standard_response(request):
    endpoint = request.url.path.rsplit("/", 1)[-1]
    if endpoint == "channels":
        return results(channel_stats())
    if endpoint == "playlistItems":
        return results(upload(FIRST))
    if endpoint == "videos":
        return results(video(FIRST))
    if endpoint == "search":
        return results(
            {
                "id": {"channelId": OTHER_CHANNEL},
                "snippet": {"title": "Synthetic lead B"},
            },
            {"id": {"channelId": CHANNEL}, "snippet": {"title": "Synthetic lead A"}},
        )
    raise AssertionError("Unexpected provider endpoint")
