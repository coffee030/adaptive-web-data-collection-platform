"""Seed the local synthetic intelligence demo and one provenance-checked Core collection."""

import csv
import io
import os
from datetime import UTC, datetime, timedelta
from pathlib import Path
from time import monotonic, sleep
from uuid import UUID

from backend.core.contracts import CsvMappingConfiguration
from backend.core.evidence import LocalEvidenceStore

from ..demo_provision import DemoError, api, post, require, stable_key, unique
from .demo_dataset import demo_payload

BRIDGE = "harbourline-core-dining"
LIBRARY = "harbourline-demo-library"
SOURCE = "Harbourline controlled creator submissions (Fictional)"
GRANT = "harbourline-core-demo-only"
OPERATOR = "Harbourline Synthetic Demo"
FIELDS = (
    "creator_id",
    "creator_name",
    "post_id",
    "caption",
    "language",
    "reviewed_fact",
    "quote_hkd",
)
FIXTURE = (
    (
        "bridge-harbour-bowl",
        "Fixture Harbour Bowl",
        "bridge-bowl-post",
        "上環街坊午餐，街坊粉麵餐廳平價探店，一碗雲吞麵加熱茶四十蚊。",
        "yue",
        "affordable_local_lunch",
        1200,
    ),
)
BASE = "/marketing/intelligence"
INTAKE = BASE + "/operator/demo/datasets/"


def entry():
    content = io.StringIO(newline="")
    writer = csv.writer(content, lineterminator="\n")
    writer.writerow(FIELDS)
    writer.writerows(FIXTURE)
    return {"adapter_type": "csv", "dataset_id": BRIDGE, "content": content.getvalue()}


def current_dataset(dataset_id, token):
    try:
        status = api(INTAKE + dataset_id, token=token)
    except DemoError as error:
        if "returned HTTP 404 (dataset_not_found)" not in str(error):
            raise
        return False
    require(status["state"] != "withdrawn", f"{dataset_id} was withdrawn.")
    return status["state"] != "expired" and status["record_count"] > 0


def prepared_profile():
    registered = post(
        "/sources",
        source_name=SOURCE,
        adapter_type="csv",
        approval_status="approved",
        permission_reference=GRANT,
        allowed_datasets=[BRIDGE],
        request_key=stable_key(BRIDGE + "/source"),
    )
    source = api(f"/sources/{registered['source_id']}")
    require(
        source["source_name"] == SOURCE
        and source["adapter_type"] == "csv"
        and source["approval_status"] == "approved"
        and source["permission_reference"] == GRANT
        and source["allowed_datasets"] == [BRIDGE],
        "The bundled CSV Source is not authorized for this fixture.",
    )
    versions = f"/sources/{source['source_id']}/versions"
    configuration = CsvMappingConfiguration.model_validate(
        {
            "adapter_type": "csv",
            "config_schema_version": "1",
            "columns": [{"name": name, "column": name} for name in FIELDS],
            "record_schema": {
                "record_type": "harbourline_creator_fixture",
                "schema_version": "1",
                "identity_field": "post_id",
                "fields": [
                    {
                        "name": name,
                        "value_type": "integer" if name == "quote_hkd" else "string",
                    }
                    for name in FIELDS
                ],
            },
        }
    )
    digest = configuration.config_hash()
    profile = unique(
        [item for item in api(versions) if item["config_hash"] == digest],
        "Harbourline bundled Profile",
    )
    if profile is None:
        profile = post(versions, configuration=configuration.model_dump(mode="json"))
    profile_id = profile["profile_version_id"]
    if profile["approval_status"] == "draft":
        path = f"{versions}/{profile_id}"
        report = post(path + "/validate", **entry())
        require(report["passed"], "The bundled CSV did not pass Profile validation.")
        profile = post(
            path + "/approve",
            approver=OPERATOR,
            report_id=report["report_id"],
            config_hash=digest,
        )
    require(
        profile["approval_status"] == "approved",
        "The bundled CSV Profile is no longer approved.",
    )
    return source["source_id"], profile_id, digest


def collect():
    source, profile, digest = prepared_profile()
    epoch = datetime.now(UTC).strftime("%Y-%m")
    job = post(
        "/collection-jobs",
        source_id=source,
        profile_version_id=profile,
        entry=entry(),
        request_key=stable_key(f"{BRIDGE}/{epoch}/collection"),
    )
    job_id = job["job_id"]
    deadline = monotonic() + 45
    while job["status"] in {"pending", "running"} and monotonic() < deadline:
        sleep(0.5)
        job = api(f"/collection-jobs/{job_id}")
    require(
        job["status"] == "succeeded"
        and job["valid_count"] == len(FIXTURE)
        and job["invalid_count"] == 0,
        "The bundled Core collection did not finish with only validated fixture rows.",
    )
    records = api(f"/records?job_id={job_id}")
    require(len(records) == len(FIXTURE), "Bundled Core Records are missing.")
    store = LocalEvidenceStore(Path(os.environ["EVIDENCE_ROOT"]))
    for record in records:
        ref, raw = store.resolve(UUID(record["evidence_reference"]).hex)
        require(
            record["validation_status"] == "passed"
            and record["record_type"] == "harbourline_creator_fixture"
            and record["source_position"]["kind"] == "csv_row"
            and UUID(record["source_id"]) == UUID(source) == UUID(ref.source_id)
            and UUID(record["profile_version_id"])
            == UUID(profile)
            == UUID(ref.profile_version_id)
            and record["provenance"]["run_id"] == ref.run_id
            and record["provenance"]["config_hash"] == digest == ref.config_hash
            and raw == entry()["content"].encode("utf-8"),
            "Record, approved Profile and raw CSV Evidence do not reconcile.",
        )
    return records


def project(records):
    expected = {row[2]: dict(zip(FIELDS, row, strict=True)) for row in FIXTURE}
    require(
        len(records) == len(expected)
        and {row["payload"].get("post_id") for row in records} == expected.keys(),
        "Only the bundled fictional CSV can enter this projection.",
    )
    rows = []
    captured = min(datetime.fromisoformat(row["created_at"]) for row in records)
    expiry = (captured + timedelta(days=31)).isoformat()
    for row in records:
        payload = row["payload"]
        require(
            payload == expected[payload["post_id"]],
            "A collected row differs from the authorized fictional fixture.",
        )
        creator, post_id = payload["creator_id"], payload["post_id"]
        stamp = row["created_at"]
        base = {
            "creator_id": creator,
            "observed_at": stamp,
            "evidence_ref": "core-record-" + UUID(row["record_id"]).hex,
        }
        platform = {"platform": "other"}
        rows.extend(
            [
                dict(
                    base,
                    id=creator + "-profile",
                    kind="profile",
                    name=payload["creator_name"],
                    accounts=[dict(platform, account_id=creator)],
                ),
                dict(
                    base,
                    **platform,
                    id=post_id,
                    kind="content",
                    account_id=creator,
                    published_at=stamp,
                    text=payload["caption"],
                    languages=[payload["language"]],
                    reviewed_facts=[payload["reviewed_fact"]],
                ),
                dict(
                    base,
                    **platform,
                    id=creator + "-quote",
                    kind="quote",
                    deliverable="short_video",
                    currency="HKD",
                    amount_minor=payload["quote_hkd"] * 100,
                    quote_type="firm",
                    valid_until=expiry,
                    terms="Fictional firm quote for one short video",
                ),
            ]
        )
    return {
        "grant": {
            "owner_ref": BRIDGE,
            "authorization_ref": GRANT,
            "origin": "synthetic",
            "attribution": "Fictional Core CSV creator submissions",
            "expires_at": expiry,
            "academic_demo": True,
        },
        "records": rows,
    }


def main():
    require(
        os.environ.get("PLATFORM_SYNTHETIC_DEMO") == "1"
        and os.environ.get("MARKETING_DEMO_ENABLED") == "1",
        "This command requires the isolated Harbourline Synthetic Demo.",
    )
    token = os.environ.get("MARKETING_OPERATOR_TOKEN", "")
    require(len(token) >= 24, "The local demo operator token is missing.")
    if not current_dataset(LIBRARY, token):
        api(INTAKE + LIBRARY, method="PUT", body=demo_payload(), token=token)
    if not current_dataset(BRIDGE, token):
        records = collect()
        api(INTAKE + BRIDGE, method="PUT", body=project(records), token=token)
        for record in records:
            print(
                f"PASS Core Job {record['job_id']} Record {record['record_id']} "
                f"Evidence {record['evidence_reference']} Profile {record['profile_version_id']}"
            )
    deadline = monotonic() + 90
    while True:
        processing = api(BASE + "/demo/processing")
        if processing["state"] != "preparing" or monotonic() >= deadline:
            break
        sleep(1)
    require(
        processing["eligible_datasets"] >= 2,
        "The two fictional datasets are not available.",
    )
    print(
        f"PASS Harbourline demo index {processing['state']} "
        f"({processing['indexed_datasets']}/{processing['eligible_datasets']} datasets indexed)."
    )


if __name__ == "__main__":
    try:
        main()
    except DemoError as error:
        raise SystemExit(f"DemoError: {error}") from None
