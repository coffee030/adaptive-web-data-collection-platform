import argparse
import json
import os
import sys
from datetime import datetime
from hashlib import sha256
from pathlib import Path
from uuid import NAMESPACE_URL, UUID, uuid5

import httpx2

from backend.core.contracts import loopback_origin
from backend.trends import google_rss


def save(path, snapshot):
    body = json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n"
    if str(path) == "-":
        sys.stdout.buffer.write(body.encode("utf-8"))
    else:
        with path.open("x", encoding="utf-8") as output:
            output.write(body)


def snapshot(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def delta(current, prior):
    if current["market"] != prior["market"]:
        raise ValueError(
            "Compare successive receipts from the same Google Trends region."
        )
    if datetime.fromisoformat(current["observed_at"]) <= datetime.fromisoformat(
        prior["observed_at"]
    ):
        raise ValueError("Use an earlier capture as the incremental baseline.")

    def key(item):
        return google_rss.event_key(
            current["market"], item["query"], item["published_at"]
        )

    previous = {key(item): item["approx_traffic"] for item in prior["rows"]}
    changes = []
    for item in current["rows"]:
        event = key(item)
        if event not in previous or previous[event] != item["approx_traffic"]:
            changes.append(item)
    return {**current, "rows": changes}


def request(client, method, path, payload=None, *, expected=(200,)):
    reply = client.request(method, "/api/v1" + path, json=payload)
    if reply.status_code not in expected:
        raise ValueError(
            f"Core rejected {method} {path} (HTTP {reply.status_code}). Inspect source and profile approval."
        )
    return reply


def connect(origin):
    url = loopback_origin(origin)
    headers = {"Origin": url}
    if secret := os.environ.get("CORE_OPERATOR_TOKEN"):
        headers["Authorization"] = f"Bearer {secret}"
    return httpx2.Client(
        base_url=url,
        timeout=30,
        trust_env=False,
        headers=headers,
        follow_redirects=False,
    )


def configure(args):
    entry = google_rss.entry(snapshot(args.receipt))
    with connect(args.origin) as client:
        source = request(
            client,
            "POST",
            "/sources",
            {
                "source_name": google_rss.ATTRIBUTION,
                "adapter_type": "csv",
                "allowed_datasets": [google_rss.DATASET],
                "permission_reference": google_rss.POLICY,
                "approval_status": "approved",
                "request_key": str(
                    uuid5(
                        NAMESPACE_URL, "https://trends.google.com/trending/rss#core-csv"
                    )
                ),
            },
            expected=(200, 201),
        ).json()
        if source["approval_status"] != "approved":
            raise ValueError(
                "Restore this source through the ordinary Core authorization workflow."
            )
        versions = "/sources/" + source["source_id"] + "/versions"
        mapping = google_rss.MAPPING
        matching = [
            version
            for version in request(client, "GET", versions).json()
            if version["config_hash"] == mapping.config_hash()
        ]
        profile = next(
            (
                version
                for version in matching
                if version["approval_status"] == "approved"
            ),
            None,
        )
        if profile is None:
            profile = next(
                (
                    version
                    for version in matching
                    if version["approval_status"] == "draft"
                ),
                None,
            )
            if profile is None:
                profile = request(
                    client,
                    "POST",
                    versions,
                    {"configuration": mapping.model_dump(mode="json")},
                    expected=(201,),
                ).json()
            target = versions + "/" + profile["profile_version_id"]
            report = request(
                client, "POST", target + "/validate", entry.model_dump(mode="json")
            ).json()
            if not report["passed"]:
                raise ValueError("Core could not validate this sample mapping.")
            profile = request(
                client,
                "POST",
                target + "/approve",
                {
                    "report_id": report["report_id"],
                    "config_hash": report["config_hash"],
                    "approver": args.approver,
                },
            ).json()
    print(
        json.dumps(
            {"source": source["source_id"], "profile": profile["profile_version_id"]}
        )
    )


def submit(args):
    receipt = snapshot(args.receipt)
    if args.previous:
        receipt = delta(receipt, snapshot(args.previous))
    if not receipt["rows"]:
        print(json.dumps({"status": "no_changed_observations"}))
        return
    entry = google_rss.entry(receipt)
    fingerprint = sha256(entry.content.encode("utf-8")).hexdigest()
    with connect(args.origin) as client:
        reply = request(
            client,
            "POST",
            "/collection-jobs",
            {
                "source_id": str(args.source),
                "profile_version_id": str(args.profile),
                "request_key": str(
                    uuid5(NAMESPACE_URL, "google-trends/" + fingerprint)
                ),
                "entry": entry.model_dump(mode="json"),
            },
            expected=(200, 201),
        )
        job = reply.json()
        print(
            json.dumps(
                {
                    "job_id": job["job_id"],
                    "status": job["status"],
                    "replayed": reply.status_code == 200,
                }
            )
        )


def compare(args):
    if len(args.job) > 8:
        raise ValueError("Choose at most eight completed Core jobs.")
    events = {}
    with connect(args.origin) as client:
        for job_id in dict.fromkeys(args.job):
            job = request(client, "GET", f"/collection-jobs/{job_id}").json()
            if (
                job["status"] != "succeeded"
                or job["invalid_count"]
                or job["duplicate_count"]
            ):
                raise ValueError(f"Core job {job_id} has no fully validated results.")
            source = request(client, "GET", f"/sources/{job['source_id']}").json()
            if source["approval_status"] != "approved" or source[
                "allowed_datasets"
            ] != [google_rss.DATASET]:
                raise ValueError(
                    f"Core job {job_id} is outside the approved Trending Now source."
                )
            records = request(
                client, "GET", f"/records?job_id={job_id}&limit=100"
            ).json()
            if not records or any(
                record["record_type"] != google_rss.DATASET for record in records
            ):
                raise ValueError(
                    f"Core job {job_id} does not contain Trending Now observations."
                )
            for record in records:
                row = record["payload"]
                if args.query and args.query.casefold() not in row["query"].casefold():
                    continue
                event = events.setdefault(
                    row["event_id"],
                    {
                        "market": row["region"],
                        "query": row["query"],
                        "published_at": row["published_at"],
                        "source_url": row["source_url"],
                        "observations": {},
                    },
                )
                event["observations"][row["measurement_id"]] = {
                    "observed_at": row["observed_at"],
                    "traffic_bucket": row.get("traffic_bucket"),
                    "traffic_lower_bound": row.get("traffic_lower_bound"),
                    "response_sha256": row["response_sha256"],
                    "job_id": str(job_id),
                    "record_id": record["record_id"],
                    "evidence_id": record["evidence_reference"],
                }
    for event in events.values():
        event["observations"] = sorted(
            event["observations"].values(),
            key=lambda point: datetime.fromisoformat(point["observed_at"]),
        )
    print(
        json.dumps(
            {
                "source": google_rss.ATTRIBUTION,
                "metric": google_rss.METRIC,
                "events": events,
            },
            ensure_ascii=False,
            indent=2,
        )
    )


def main():
    parser = argparse.ArgumentParser(
        description="Collect attributed regional Google Trending Now observations for Core."
    )
    commands = parser.add_subparsers(dest="command", required=True)
    capture = commands.add_parser(
        "capture", help="Capture permitted fields to a new normalized JSON receipt."
    )
    capture.add_argument("region")
    capture.add_argument("output", type=Path)
    commands.add_parser(
        "mapping", help="Print the fixed Core CSV profile configuration."
    )
    preview = commands.add_parser(
        "preview", help="Print a captured receipt as Core CSV for profile validation."
    )
    preview.add_argument("receipt", type=Path)
    onboarding = commands.add_parser(
        "approve-source", help="Validate and explicitly approve the documented source."
    )
    onboarding.add_argument("receipt", type=Path)
    onboarding.add_argument("--approver", required=True)
    onboarding.add_argument("--origin", default="http://127.0.0.1:5173")
    stage = commands.add_parser(
        "submit", help="Submit an existing capture through the approved Core profile."
    )
    stage.add_argument("receipt", type=Path)
    stage.add_argument(
        "--previous",
        type=Path,
        help="Use an earlier receipt from the same region as a delta baseline.",
    )
    stage.add_argument("--origin", default="http://127.0.0.1:5173")
    stage.add_argument("--source", required=True, type=UUID)
    stage.add_argument("--profile", required=True, type=UUID)
    comparison = commands.add_parser(
        "compare", help="Compare dated traffic buckets from approved Core jobs."
    )
    comparison.add_argument("--job", required=True, action="append", type=UUID)
    comparison.add_argument("--query")
    comparison.add_argument("--origin", default="http://127.0.0.1:5173")
    args = parser.parse_args()
    if args.command == "capture":
        if str(args.output) != "-" and args.output.exists():
            parser.error("Choose a new receipt path.")
        save(args.output, google_rss.capture(args.region))
    elif args.command == "mapping":
        print(google_rss.MAPPING.model_dump_json(indent=2))
    elif args.command == "preview":
        print(google_rss.entry(snapshot(args.receipt)).content, end="")
    elif args.command == "approve-source":
        configure(args)
    elif args.command == "submit":
        submit(args)
    elif args.command == "compare":
        compare(args)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, httpx2.HTTPError, google_rss.ProviderError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
