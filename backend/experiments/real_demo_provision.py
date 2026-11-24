"""Provision and run the optional Welsh Government live website demo."""

from __future__ import annotations

import json
from time import monotonic, sleep
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener
from uuid import uuid4

from backend.core.contracts import ExtractionConfiguration

API = "http://127.0.0.1:8000/api/v1"
SOURCE_NAME = "Quick Real Demo - Welsh Government"
PERMISSION_REFERENCE = "https://www.gov.wales/copyright-statement"
ORIGIN = "https://www.gov.wales"
ALLOWED_PATHS = ("/search", "/written-statement-")
CATEGORY_NAME = "Real Website Demo"
TOPIC_NAME = "Welsh Government Publications"
KEYWORD = "inflation"
OPERATOR = "Quick Real Demo"

CONFIGURATION = {
    "adapter_type": "web",
    "config_schema_version": "1",
    "selector_type": "xpath",
    "item_selector": "//html",
    "record_schema": {
        "record_type": "publication",
        "schema_version": "1",
        "identity_field": "publication_url",
        "fields": [
            {"name": "title"},
            {"name": "publication_url"},
            {"name": "published_at", "required": False},
        ],
    },
    "fields": [
        {"name": "title", "selector_type": "css", "selector": "h1.page-header__title"},
        {
            "name": "publication_url",
            "selector_type": "css",
            "selector": 'head link[rel="canonical"]',
            "mode": "attribute",
            "attribute": "href",
        },
        {
            "name": "published_at",
            "selector": "(.//time[@datetime])[1]",
            "mode": "attribute",
            "attribute": "datetime",
        },
    ],
    "search": {
        "origin": ORIGIN,
        "path": "/search",
        "keyword_parameter": "globalkeywords",
        "result_item_selector": (
            '//h3/a[starts-with(@href,"https://www.gov.wales/written-statement-") '
            'and contains(@href,"budget")]'
        ),
        "detail_link_selector": "self::a",
        "max_detail_pages": 1,
        "max_requests": 3,
        "max_redirects": 0,
        "max_body_bytes": 512000,
        "timeout_seconds": 5,
        "max_seconds": 25,
        "max_attempts": 1,
    },
}


class RealDemoError(RuntimeError):
    pass


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


OPENER = build_opener(ProxyHandler({}), NoRedirect())


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RealDemoError(message)


def api(path: str, *, method: str = "GET", body=None, timeout: int = 60):
    payload = None if body is None else json.dumps(body).encode()
    request = Request(API + path, method=method, data=payload, headers={"Content-Type": "application/json"})
    try:
        with OPENER.open(request, timeout=timeout) as response:
            raw = response.read()
            return json.loads(raw) if raw else None
    except HTTPError as error:
        details = error.read().decode("utf-8", "replace")[:800]
        raise RealDemoError(f"{method} {path} returned HTTP {error.code}: {details}") from None
    except (TimeoutError, URLError) as error:
        raise RealDemoError(f"{method} {path} could not reach the local Core: {error}") from None


def post(path: str, **body):
    return api(path, method="POST", body=body)


def one(rows, predicate, label):
    matches = [row for row in rows if predicate(row)]
    require(len(matches) <= 1, f"Multiple objects match {label}; use a fresh Normal workspace.")
    return matches[0] if matches else None


def ensure_source():
    expected = {
        "source_name": SOURCE_NAME,
        "adapter_type": "web",
        "permission_reference": PERMISSION_REFERENCE,
        "allowed_origins": [ORIGIN],
        "allowed_paths": {ORIGIN: list(ALLOWED_PATHS)},
        "min_request_interval_ms": 2000,
    }
    source = one(api("/sources"), lambda row: row["source_name"] == SOURCE_NAME, SOURCE_NAME)
    if source is None:
        source = post("/sources", **expected)
        print("Created the bounded Welsh Government Source.", flush=True)
    for key, value in expected.items():
        require(source.get(key) == value, f"Existing Source conflicts on {key}.")
    require(source["approval_status"] != "revoked", "The Real Demo Source was revoked; review it manually.")
    if source["approval_status"] == "pending":
        source = api(
            f"/sources/{source['source_id']}/authorization",
            method="PATCH",
            body={"approval_status": "approved"},
        )
        print("Authorized the Source for this trusted local demo.", flush=True)
    return source


def ensure_profile(source):
    configuration = ExtractionConfiguration.model_validate(CONFIGURATION)
    expected_hash = configuration.config_hash()
    base = f"/sources/{source['source_id']}/versions"
    profile = one(
        api(base),
        lambda row: row["config_hash"] == expected_hash and row["approval_status"] != "retired",
        "the Real Demo Profile",
    )
    if profile is None:
        profile = post(base, configuration=configuration.model_dump(mode="json"))
        print("Created the reviewed extraction Profile.", flush=True)
    require(profile["config_hash"] == expected_hash, "Profile configuration hash changed unexpectedly.")
    if profile["approval_status"] == "draft":
        version = f"{base}/{profile['profile_version_id']}"
        print("Validating the live publisher sample...", flush=True)
        report = post(version + "/validate", adapter_type="web", keyword=KEYWORD)
        require(
            report["passed"],
            "Live Profile validation did not pass. The publisher may have changed or be temporarily unavailable.",
        )
        profile = post(
            version + "/approve",
            approver=OPERATOR,
            report_id=report["report_id"],
            config_hash=expected_hash,
        )
        print("Approved the validated Profile Version.", flush=True)
    require(profile["approval_status"] == "approved", "The Real Demo Profile is not approved.")
    return profile


def ensure_category():
    category = one(api("/categories?limit=100&offset=0"), lambda row: row["name"] == CATEGORY_NAME, CATEGORY_NAME)
    if category is None:
        category = post("/categories", name=CATEGORY_NAME, active=True)
    require(category["active"], "The Real Website Demo category is inactive.")
    return category


def ensure_topic(category):
    query = urlencode({"limit": 100, "offset": 0, "category_id": category["id"]})
    topic = one(api(f"/topics?{query}"), lambda row: row["name"] == TOPIC_NAME, TOPIC_NAME)
    if topic is None:
        topic = post("/topics", category_id=category["id"], name=TOPIC_NAME, active=True)
    require(topic["active"], "The Real Website Demo topic is inactive.")
    return topic


def ensure_binding(topic, source, profile):
    path = f"/topics/{topic['id']}/bindings"
    binding = one(
        api(path + "?limit=100&offset=0"),
        lambda row: row["source_id"] == source["source_id"]
        and row["profile_version_id"] == profile["profile_version_id"],
        "the Real Demo binding",
    )
    if binding is None:
        binding = post(
            path,
            source_id=source["source_id"],
            profile_version_id=profile["profile_version_id"],
            approved_by=OPERATOR,
        )
    elif not binding["eligible"] and binding.get("disabled_at"):
        binding = post(path + f"/{binding['id']}/approve", approved_by=OPERATOR)
    require(binding["eligible"], "The Real Demo binding is not eligible.")
    return binding


def run_collection(topic, binding):
    request = post(
        "/collection-requests",
        topic_id=topic["id"],
        keyword=KEYWORD,
        binding_ids=[binding["id"]],
        request_key=str(uuid4()),
    )
    identity = request["id"]
    print(f"Submitted live Request {identity}.", flush=True)
    deadline = monotonic() + 120
    while request["status"] in {"pending", "running"} and monotonic() < deadline:
        sleep(1)
        request = api(f"/collection-requests/{identity}")
    require(
        request["status"] not in {"pending", "running"},
        f"Live Request {identity} did not finish within 120 seconds.",
    )
    records = api(f"/records?request_id={identity}&limit=50&offset=0")
    print(f"REAL_DEMO_REQUEST_ID={identity}", flush=True)
    print(f"REAL_DEMO_STATUS={request['status']}", flush=True)
    print(f"REAL_DEMO_RECORDS={len(records)}", flush=True)
    if records:
        payload = records[0].get("payload", {})
        print(f"REAL_DEMO_TITLE={payload.get('title', '')}", flush=True)
        print(f"REAL_DEMO_URL={payload.get('publication_url', '')}", flush=True)
    if request["status"] != "succeeded":
        errors = [item["job"].get("error") for item in request["jobs"] if item["job"].get("error")]
        raise RealDemoError(f"Live Request ended {request['status']}. Job errors: {errors or 'none reported'}")
    require(records, "Live Request succeeded but returned no accepted Records.")
    return identity


def main() -> int:
    try:
        source = ensure_source()
        profile = ensure_profile(source)
        category = ensure_category()
        topic = ensure_topic(category)
        binding = ensure_binding(topic, source, profile)
        run_collection(topic, binding)
        print("REAL_DEMO_RESULT=PASS", flush=True)
        return 0
    except (RealDemoError, ValueError) as error:
        print("REAL_DEMO_RESULT=FAIL", flush=True)
        print(f"REAL_DEMO_ERROR={error}", flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
