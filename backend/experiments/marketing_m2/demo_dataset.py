"""Build a dated demo import from the fictional multilingual research fixture."""

import csv
import json
import sys
from datetime import UTC, datetime, time, timedelta
from pathlib import Path

HERE = Path(__file__).parent


def read_fixture(name):
    with (HERE / name).open(encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle, delimiter="|"))


def demo_payload(as_of=None):
    today = datetime.combine(as_of or datetime.now(UTC).date(), time.min, UTC)
    observed_at = (today - timedelta(days=1)).isoformat()
    published_at = (today - timedelta(days=21)).isoformat()
    expiry = (today + timedelta(days=30)).isoformat()
    facets = {
        row["post_id"]: row["facets"].split(",")
        for row in read_fixture("post_facts.psv")
        if row["facets"]
    }
    records = []

    def record(kind, identity, creator, **values):
        records.append(
            {
                "kind": kind,
                "id": identity,
                "creator_id": creator,
                "observed_at": observed_at,
                "evidence_ref": f"fictional-{identity}",
                **values,
            }
        )

    for row in read_fixture("creators.psv"):
        creator = row["creator_id"]
        record(
            "profile",
            f"{creator}-profile",
            creator,
            name=row["display_name"],
            accounts=[{"platform": "other", "account_id": creator}],
        )
        if row["fee_hkd"]:
            record(
                "quote",
                f"{creator}-quote",
                creator,
                platform="other",
                deliverable="short_video",
                quote_type="firm",
                currency="HKD",
                amount_minor=int(row["fee_hkd"]) * 100,
                valid_until=expiry,
                terms="Fictional quote for one short video",
            )

    for row in read_fixture("posts.psv"):
        post, creator = row["post_id"], row["creator_id"]
        record(
            "content",
            post,
            creator,
            platform="other",
            account_id=creator,
            published_at=published_at,
            text=row["text"],
            languages=[row["language"]],
            reviewed_facts=facets.get(post, []),
        )
    return {
        "grant": {
            "origin": "synthetic",
            "owner_ref": "fictional-research",
            "authorization_ref": "demo-only",
            "attribution": "Fictional multilingual KOL Analytics Lab fixture",
            "expires_at": expiry,
            "academic_demo": True,
        },
        "records": records,
    }


if __name__ == "__main__":
    sys.stdout.buffer.write(
        json.dumps(demo_payload(), ensure_ascii=False).encode("utf-8") + b"\n"
    )
