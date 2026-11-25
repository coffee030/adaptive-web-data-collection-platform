"""Provision or check Demo presets through the owned API container's loopback API."""

import argparse
import csv
import fcntl
import io
import json
import os
import re
from pathlib import Path
from time import monotonic, sleep
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener
from uuid import NAMESPACE_URL, UUID, uuid5

from backend.core.contracts import CandidateRecord, ExtractionConfiguration, Source
from backend.core.evidence import EvidenceError, LocalEvidenceStore
from backend.core.ingestion import ingest

from .demo_presets import OPERATOR, ORIGIN, PRESETS

API = "http://127.0.0.1:8000/api/v1"
STATE = Path("/data/demo-state/presets-v1.json")
FAILED = {"partial", "failed"}
LOCK = STATE.with_suffix(".lock")


class DemoError(ValueError):
    pass


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


OPENER = build_opener(ProxyHandler({}), NoRedirect())


def require(condition, message):
    if not condition:
        raise DemoError(message)


def fetch(url, *, method="GET", body=None, token=None):
    request = Request(
        url,
        method=method,
        data=None if body is None else json.dumps(body).encode(),
        headers={
            "Content-Type": "application/json",
            **({"Authorization": f"Bearer {token}"} if token else {}),
        },
    )
    with OPENER.open(request, timeout=50 if method == "POST" else 5) as response:
        return response.read(), response.headers


def api(path, *, method="GET", body=None, token=None):
    try:
        return json.loads(fetch(API + path, method=method, body=body, token=token)[0])
    except HTTPError as error:
        code = None
        try:
            code = json.loads(error.read()).get("error", {}).get("code")
        except (ValueError, AttributeError):
            pass
        code = (
            code
            if isinstance(code, str) and re.fullmatch(r"[a-z0-9_]+", code)
            else "request_error"
        )
        raise DemoError(
            f"{method} {path} returned HTTP {error.code} ({code})."
        ) from None
    except (TimeoutError, URLError):
        raise DemoError(f"{method} {path} could not reach the owned API.") from None


def post(path, **body):
    return api(path, method="POST", body=body)


def pages(path, **params):
    for offset in range(0, 10_000, 100):
        query = urlencode(params | {"limit": 100, "offset": offset})
        rows = api(f"{path}?{query}")
        yield from rows
        if len(rows) < 100:
            return
    raise DemoError(f"Catalog search reached its limit for {path}.")


def stable_key(path):
    return str(uuid5(NAMESPACE_URL, f"https://adaptive-web.local/m10-demo/v1/{path}"))


def unique(rows, context):
    require(
        len(rows) <= 1, f"Multiple objects match {context}. Review existing Demo data."
    )
    return rows[0] if rows else None


class Provisioner:
    def __init__(self, *, check=False, retry=False):
        self.check = check
        self.retry = retry
        self.state = json.loads(STATE.read_bytes()) if STATE.exists() else {}
        self.evidence = LocalEvidenceStore(Path(os.environ["EVIDENCE_ROOT"]))

    def save(self, key, value):
        if not self.check and self.state.get(key) != value:
            self.state[key] = value
            pending = STATE.with_suffix(".tmp")
            with pending.open("w", encoding="utf-8") as stream:
                json.dump(self.state, stream, indent=2)
                stream.flush()
                os.fsync(stream.fileno())
            pending.replace(STATE)

    def catalog(self, path, key, name, **scope):
        identity = self.state.get(key)
        item = (
            api(f"{path}/{identity}")
            if identity
            else unique(
                [
                    row
                    for row in pages(path, **scope)
                    if row["name"].casefold() == name.casefold()
                ],
                name,
            )
        )
        if item is None and not self.check:
            item = post(path, name=name, **scope)
        require(item, f"Missing {name}.")
        require(
            item["name"] == name
            and item["active"]
            and all(item[field] == value for field, value in scope.items()),
            f"{name} conflicts with the saved preset. Review its name and active state.",
        )
        self.save(key, item["id"])
        return item["id"]

    def approved_source(self, fixture):
        key = "source" + fixture.path
        body = {
            "source_name": fixture.name,
            "adapter_type": "web",
            "permission_reference": f"{fixture.label} (M10 preset {fixture.path})",
            "allowed_origins": [ORIGIN],
            "allowed_paths": {ORIGIN: [fixture.path]},
        }
        if identity := self.state.get(key):
            source = api(f"/sources/{identity}")
        else:
            source = unique(
                [
                    row
                    for row in api("/sources")
                    if row["source_name"].casefold() == fixture.name.casefold()
                    or row["permission_reference"] == body["permission_reference"]
                ],
                fixture.name,
            )
            if source is None and not self.check:
                source = post("/sources", **body, request_key=stable_key(key))
        require(source, f"Missing Source {fixture.name}.")
        identity = source["source_id"]
        status = source["approval_status"]
        expected = Source(source_id=identity, approval_status=status, **body)
        require(
            Source.model_validate(source) == expected,
            f"{fixture.name} has a conflicting Source policy.",
        )
        require(status != "revoked", f"{fixture.name} Source access was revoked.")
        self.save(key, identity)
        if (
            status == "pending"
            and not self.check
            and not self.state.get(key + "/authorized")
        ):
            source = api(
                f"/sources/{identity}/authorization",
                method="PATCH",
                body={"approval_status": "approved"},
            )
        require(
            source["approval_status"] == "approved",
            f"{fixture.name} Source authorization is pending.",
        )
        self.save(key + "/authorized", True)
        return identity

    def approved_profile(self, source, fixture, keyword):
        versions = f"/sources/{source}/versions"
        key = "profile" + fixture.path
        configuration = ExtractionConfiguration.model_validate(fixture.configuration())
        expected_hash = configuration.config_hash()
        if identity := self.state.get(key):
            profile = api(f"{versions}/{identity}")
        else:
            profile = unique(
                [row for row in api(versions) if row["version"] == 1],
                fixture.name + " Version 1",
            )
            if profile is None and not self.check:
                profile = post(
                    versions, configuration=configuration.model_dump(mode="json")
                )
        require(profile, f"Missing Profile for {fixture.name}.")
        require(
            profile["version"] == 1
            and profile["config_hash"] == expected_hash
            and profile["source_id"] == source,
            f"{fixture.name} has a conflicting Profile Version 1.",
        )
        identity = profile["profile_version_id"]
        self.save(key, identity)
        if (
            profile["approval_status"] == "draft"
            and profile["revision"] == 1
            and not self.check
        ):
            print(f"Validating {fixture.name} Version 1...", flush=True)
            version = f"{versions}/{identity}"
            report = post(version + "/validate", adapter_type="web", keyword=keyword)
            require(
                report["passed"],
                f"Profile validation failed for {fixture.name}. Check fixture service and profile selectors.",
            )
            profile = post(
                version + "/approve",
                approver=OPERATOR,
                report_id=report["report_id"],
                config_hash=expected_hash,
            )
        require(
            profile["approval_status"] == "approved",
            f"{fixture.name} Profile is edited, unapproved or retired.",
        )
        return profile

    def binding(self, topic, profile, fixture):
        path = f"/topics/{topic}/bindings"
        key = "binding" + fixture.path
        source = str(UUID(profile["source_id"]))
        version = str(UUID(profile["profile_version_id"]))
        binding = unique(
            [
                row
                for row in pages(path)
                if row["source_id"] == source and row["profile_version_id"] == version
            ],
            fixture.name + " binding",
        )
        if binding is None and not self.check and key not in self.state:
            binding = post(
                path, source_id=source, profile_version_id=version, approved_by=OPERATOR
            )
        require(
            binding
            and binding["eligible"]
            and binding["config_hash"] == profile["config_hash"]
            and binding["id"] == self.state.get(key, binding["id"]),
            f"{fixture.name} binding is missing, disabled or conflicts with the saved preset.",
        )
        self.save(key, binding["id"])
        return binding

    def collect(self, preset, topic, bindings):
        key = "request/" + preset.key
        path = "/collection-requests"
        generation = self.state.get(key + "/generation", 0)
        identity = self.state.get(key)
        request = api(f"{path}/{identity}") if identity else None
        if self.retry and request and request["status"] in FAILED:
            # Persist the new intent before submitting it so an interrupted retry reuses its key.
            generation += 1
            self.state[key + "/generation"] = generation
            self.save(key, None)
            request = None
        if request is None and not self.check:
            request = post(
                path,
                topic_id=topic,
                keyword=preset.keyword,
                binding_ids=list(bindings),
                request_key=stable_key(f"{key}/{generation}"),
            )
            self.save(key, request["id"])
        require(request, f"Missing baseline Collection Request for {preset.topic}.")
        require(
            request["topic_id"] == topic
            and request["keyword"] == preset.keyword
            and request["refresh_of"] is None,
            f"Unexpected baseline Request for {preset.topic}.",
        )
        if not self.check and request["status"] in {"pending", "running"}:
            print(f"Waiting for {preset.topic} Request {request['id']}...", flush=True)
            deadline = monotonic() + 125
            while (
                request["status"] in {"pending", "running"} and monotonic() < deadline
            ):
                sleep(1)
                request = api(f"{path}/{request['id']}")
        failures = [
            entry["job"]["error"]["code"]
            for entry in request["jobs"]
            if entry["job"]["error"]
        ]
        require(
            request["status"] == "succeeded",
            f"{preset.topic} Request {request['id']} is {request['status']}"
            + (f" ({', '.join(failures)})." if failures else "."),
        )
        return request

    def verify(self, request, bindings):
        request_id = request["id"]
        require(
            {entry["binding_id"] for entry in request["jobs"]} == set(bindings),
            "Baseline Request has unexpected child Jobs.",
        )
        records = api(f"/records?request_id={request_id}")
        articles = api(f"/articles?request_id={request_id}")
        require(
            len(records)
            == len(articles)
            == sum(fixture.records for _, fixture in bindings.values()),
            "The Request has missing Records or Article History.",
        )
        capture_count = 0
        for entry in request["jobs"]:
            job = entry["job"]
            binding, fixture = bindings[entry["binding_id"]]
            require(
                job["status"] == "succeeded"
                and job["execution_attempt"] >= 1
                and job["valid_count"] == fixture.records
                and job["invalid_count"] == 0
                and all(
                    job[field] == binding[field]
                    for field in ("source_id", "profile_version_id", "config_hash")
                ),
                f"{fixture.name} Job has unexpected results or provenance.",
            )
            captures = api(f"/collection-jobs/{job['job_id']}/evidence-pages")
            require(
                len(captures) == fixture.captures,
                f"{fixture.name} is missing Evidence captures.",
            )
            detail = {}
            for capture in captures:
                reference, _ = self.evidence.resolve(UUID(capture["evidence_id"]).hex)
                require(
                    reference.content_hash == capture["content_hash"]
                    and reference.config_hash == job["config_hash"]
                    and UUID(reference.source_id) == UUID(job["source_id"])
                    and UUID(reference.profile_version_id)
                    == UUID(job["profile_version_id"])
                    and UUID(reference.run_id) == UUID(capture["run_id"])
                    and capture["job_id"] == job["job_id"],
                    f"{fixture.name} Evidence has unexpected lineage or hash.",
                )
                if capture["capture_kind"] == "detail":
                    detail[capture["evidence_id"]] = reference
            capture_count += len(captures)
            schema = ExtractionConfiguration.model_validate(
                fixture.configuration()
            ).record_schema
            job_records = [
                record for record in records if record["job_id"] == job["job_id"]
            ]
            require(
                len(job_records) == fixture.records,
                f"{fixture.name} is missing validated Records.",
            )
            for record in job_records:
                reference = detail.get(record["evidence_reference"])
                require(
                    reference
                    and record["payload"].get("dataset") == fixture.label
                    and record["provenance"]["config_hash"] == job["config_hash"]
                    and record["provenance"]["run_id"] == reference.run_id
                    and record["validation_status"] == "passed",
                    f"{fixture.name} Record is missing its Evidence, provenance or synthetic label.",
                )
                if fixture.is_market:
                    require(
                        all(
                            type(record["payload"][field]) in {int, float}
                            for field in ("price", "price_change")
                        ),
                        "Simulated prices must remain numeric.",
                    )
                lineage = api(f"/records/{record['record_id']}?include_lineage=true")
                require(
                    lineage["article_id"] and lineage["request_id"] == request_id,
                    "Record is missing Article History lineage.",
                )
                observation = api(
                    f"/articles/{lineage['article_id']}/observations/{record['record_id']}"
                )
                normalized = ingest(
                    [
                        CandidateRecord(
                            source_position=record["source_position"],
                            payload=observation["raw_payload"],
                        )
                    ],
                    schema,
                    reference.source_id,
                )
                require(
                    len(normalized.valid) == 1
                    and normalized.valid[0].payload == record["payload"]
                    and observation["evidence_id"] == record["evidence_reference"]
                    and observation["profile_version_id"] == job["profile_version_id"]
                    and observation["config_hash"] == job["config_hash"]
                    and observation["url"] == reference.original_location,
                    "Article Observation does not match its Record.",
                )
        export = API + f"/collection-requests/{request_id}/records/export?format="
        raw_csv, csv_headers = fetch(export + "csv")
        raw_json, json_headers = fetch(export + "json")
        for fmt, headers in (("csv", csv_headers), ("json", json_headers)):
            require(
                f"request-{request_id}-records.{fmt}"
                in headers.get("Content-Disposition", ""),
                f"Missing {fmt.upper()} attachment.",
            )
        csv_rows = list(csv.DictReader(io.StringIO(raw_csv.decode())))
        for row in csv_rows:
            for field in ("payload", "source_position", "provenance"):
                row[field] = json.loads(row[field])
            row["source_record_key"] = row["source_record_key"] or None
        require(
            csv_rows == json.loads(raw_json) == records,
            "CSV or JSON export differs from validated Records.",
        )
        return len(records), capture_count

    def preset(self, preset):
        category = self.catalog(
            "/categories", f"category/{preset.key}", preset.category
        )
        topic = self.catalog(
            "/topics", f"topic/{preset.key}", preset.topic, category_id=category
        )
        bindings = {}
        for fixture in preset.fixtures:
            source = self.approved_source(fixture)
            profile = self.approved_profile(source, fixture, preset.keyword)
            binding = self.binding(topic, profile, fixture)
            bindings[binding["id"]] = (binding, fixture)
        request = self.collect(preset, topic, bindings)
        records, captures = self.verify(request, bindings)
        print(
            f"PASS {preset.topic}: Request {request['id']}, 2 Jobs, {records} Records/Observations, "
            f"{captures} verified Evidence captures and both exports.",
            flush=True,
        )


def run(*, check, retry):
    provisioner = Provisioner(check=check, retry=retry)
    ready = True
    for preset in PRESETS:
        try:
            provisioner.preset(preset)
        except (DemoError, EvidenceError) as error:
            print(f"FAIL {preset.topic}: {error}", flush=True)
            ready = False
        except HTTPError as error:
            print(
                f"FAIL {preset.topic}: verification returned HTTP {error.code}.",
                flush=True,
            )
            ready = False
        except (OSError, ValueError, TypeError, KeyError) as error:
            print(
                f"FAIL {preset.topic}: verification could not complete ({type(error).__name__}).",
                flush=True,
            )
            ready = False
    return 0 if ready else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--check", action="store_true")
    mode.add_argument("--retry", action="store_true")
    args = parser.parse_args()
    require(
        os.environ.get("PLATFORM_SYNTHETIC_DEMO") == "1"
        and os.environ.get("M3_COMPOSE_FIXTURE") == "1"
        and STATE.parent.is_mount(),
        "Run only inside the owned Synthetic Demo API container.",
    )
    try:
        body, _ = fetch(ORIGIN + "/robots.txt")
        require(
            b"Allow: /demo/" in body,
            "The bundled Synthetic Demo fixture is unavailable.",
        )
    except (OSError, ValueError):
        print("FAIL Synthetic Demo fixture is unavailable.", flush=True)
        return 1
    if args.check:
        return run(check=True, retry=False)
    with LOCK.open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return run(check=False, retry=args.retry)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError) as error:
        print(
            f"FAIL Demo provisioning state is unavailable ({type(error).__name__}).",
            flush=True,
        )
        raise SystemExit(1) from None
