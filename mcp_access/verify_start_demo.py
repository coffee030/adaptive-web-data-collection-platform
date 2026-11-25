"""Verify MCP writes against an isolated Synthetic Demo using controlled fixtures."""

import asyncio
import json
import os
import sys
from contextlib import contextmanager
from functools import partial
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from queue import Queue
from threading import Thread
from uuid import uuid4

import httpx2
from mcp import Client, StdioServerParameters

from .server import api_base
from .verify_demo import inventory, read_api

TERMINAL = {"succeeded", "partial", "failed"}
REQUESTS = "/collection-requests"


def connect(base):
    return Client(
        StdioServerParameters(
            command=sys.executable,
            args=["-m", "mcp_access.server"],
            cwd=Path(__file__).resolve().parents[1],
            env={"FYP_MCP_API_BASE": base},
        ),
        read_timeout_seconds=10,
    )


async def call(client, name, *, expect_error=False, **arguments):
    result = await client.call_tool(name, arguments)
    assert result.is_error == expect_error, result.content
    assert result.structured_content is not None, result.content
    return result.structured_content


async def prepare(client, topic_id, binding_ids, keyword):
    prepared = await call(
        client,
        "prepare_collection",
        topic_id=topic_id,
        keyword=keyword,
        binding_ids=binding_ids,
    )
    assert prepared["submitted"] is False
    return prepared["submission"]


def job_ids(request):
    return {child.get("job", child)["job_id"] for child in request["jobs"]}


def assert_delta(before, after, request_id, jobs):
    assert after[0] == before[0] | {request_id} and request_id not in before[0]
    assert (
        after[1] == before[1] | jobs and len(jobs) == 2 and before[1].isdisjoint(jobs)
    )


def totals(snapshot):
    return dict(zip(("requests", "jobs"), map(len, snapshot)))


@contextmanager
def drop_committed_reply(base):
    """Forward one fixed POST and close the client connection after the backend replies."""
    replies = Queue(maxsize=1)

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def do_POST(self):
            size = int(self.headers.get("Content-Length", "0"))
            if (
                self.path != "/api/v1" + REQUESTS
                or not 0 < size <= 2048
                or not replies.empty()
            ):
                self.send_error(400)
                return
            self.connection.settimeout(5)
            with httpx2.Client(
                timeout=4, trust_env=False, follow_redirects=False
            ) as upstream:
                response = upstream.post(
                    base + REQUESTS,
                    content=self.rfile.read(size),
                    headers={"Content-Type": "application/json"},
                )
            replies.put_nowait((response.status_code, response.json()))
            self.close_connection = True

    with ThreadingHTTPServer(("127.0.0.1", 0), Handler) as proxy:
        thread = Thread(target=proxy.serve_forever, daemon=True)
        thread.start()
        try:
            yield f"http://127.0.0.1:{proxy.server_port}/api/v1", replies
        finally:
            proxy.shutdown()
            thread.join(timeout=5)


async def verify_terminal(client, api, receipt, expected):
    request_id = receipt["request_id"]
    async with asyncio.timeout(90):
        while True:
            status = await call(client, "get_collection_status", request_id=request_id)
            if status["status"] in TERMINAL:
                break
            await asyncio.sleep(0.5)
    assert status["id"] == request_id and job_ids(status) == job_ids(receipt)
    assert status["status"] == expected, status
    rest = read_api(api, f"{REQUESTS}/{request_id}")
    rest_jobs = {child["job"]["job_id"]: child for child in rest["jobs"]}
    assert rest["status"] == expected and set(rest_jobs) == job_ids(status)

    records = (await call(client, "get_collection_records", request_id=request_id))[
        "items"
    ]
    assert len(records) == 2 and {item["job_id"] for item in records} == job_ids(status)
    evidence_rows = []
    for child in status["jobs"]:
        job = child["job"]
        rest_child = rest_jobs[job["job_id"]]
        for key in ("source_name", "binding_id", "profile_version"):
            assert child[key] == rest_child[key]
        for key in ("status", "valid_count", "invalid_count", "duplicate_count"):
            assert job[key] == rest_child["job"][key]
        assert (
            job["status"],
            job["valid_count"],
            job["invalid_count"],
            job["duplicate_count"],
        ) == (
            expected,
            1,
            0,
            0,
        )
        if expected == "partial":
            assert (
                job["error"]["code"]
                == rest_child["job"]["error"]["code"]
                == "http_error"
            )
            assert (
                job["error"]["http_status"]
                == rest_child["job"]["error"]["http_status"]
                == 404
            )
        else:
            assert job["error"] is rest_child["job"]["error"] is None

        record = next(item for item in records if item["job_id"] == job["job_id"])
        assert record["payload"]["headline"] == "Alpha"
        record_id = record["record_id"]
        lineage = await call(client, "get_record_lineage", record_id=record_id)
        rest_record = read_api(api, f"/records/{record_id}", include_lineage="true")
        evidence_id = lineage["evidence_reference"]
        assert (
            evidence_id
            == rest_record["evidence_reference"]
            == record["evidence_reference"]
        )
        evidence = await call(client, "get_evidence_metadata", evidence_id=evidence_id)
        rest_evidence = read_api(api, f"/evidence/{evidence_id}")
        assert evidence_id == evidence["evidence_id"] == rest_evidence["evidence_id"]
        assert lineage["request_id"] == rest_record["request_id"] == request_id
        for key in ("job_id", "source_id", "profile_version_id"):
            assert (
                lineage[key]
                == rest_record[key]
                == evidence[key]
                == rest_evidence[key]
                == job[key]
            )
        assert evidence["content_hash"] == rest_evidence["content_hash"]
        assert len(evidence["content_hash"]) == 64
        evidence_rows.append(
            {
                "headline": record["payload"]["headline"],
                "record_id": record_id,
                "job_id": job["job_id"],
                "evidence_id": evidence_id,
                "stored_sha256": evidence["content_hash"],
            }
        )
    return {"receipt": receipt, "terminal": status, "evidence": evidence_rows}


def operator_write(api, method, path, payload=None):
    response = api.request(method, path, json=payload)
    response.raise_for_status()
    return response.json()


async def verify_eligibility(client, api, category, bindings):
    write = partial(operator_write, api)
    name = f"M17B disposable eligibility {uuid4()}"
    topic = write("POST", "/topics", {"name": name, "category_id": category["id"]})
    topic_path = "/topics/" + topic["id"]
    try:
        binding_path = topic_path + "/bindings"
        for binding in bindings:
            write(
                "POST",
                binding_path,
                {
                    "source_id": binding["source_id"],
                    "profile_version_id": binding["profile_version_id"],
                    "approved_by": "M17B isolated verification",
                },
            )
        discovery = await call(client, "list_topic_sources", topic_id=topic["id"])
        ids = [item["id"] for item in discovery["items"]]
        assert len(ids) == 2
        before = inventory(api)
        original = await prepare(client, topic["id"], ids, "quick")
        created = await call(client, "start_collection", **original)
        assert created["http_status"] == 201
        await verify_terminal(client, api, created, "succeeded")
        accepted = inventory(api)
        assert_delta(before, accepted, created["request_id"], job_ids(created))
        write("POST", f"{binding_path}/{ids[0]}/disable")
        fresh = await prepare(client, topic["id"], ids, "quick")
        assert fresh["request_key"] != original["request_key"]
        rejected = await call(client, "start_collection", expect_error=True, **fresh)
        assert (rejected["http_status"], rejected["outcome"], rejected["code"]) == (
            409,
            "rejected",
            "binding_ineligible",
        )
        assert inventory(api) == accepted
        replay = await call(client, "start_collection", **original)
        assert (
            replay["http_status"] == 200
            and replay["request_id"] == created["request_id"]
        )
        assert job_ids(replay) == job_ids(created) and inventory(api) == accepted
        return {
            "created": created,
            "disabled_binding_id": ids[0],
            "fresh_rejected": rejected,
            "historical_replay": replay,
            "inventory_after_all_checks": totals(accepted),
        }
    finally:
        write("PUT", topic_path, {"name": name, "active": False})


async def verify(api, base):
    before = inventory(api)
    async with connect(base) as client:
        tools = {tool.name: tool for tool in (await client.list_tools()).tools}
        assert {
            name for name, tool in tools.items() if not tool.annotations.read_only_hint
        } == {"start_collection"}
        categories = (await call(client, "list_categories"))["items"]
        category = next(
            item for item in categories if item["name"] == "Core Demonstration"
        )
        topics = (await call(client, "list_topics", category_id=category["id"]))[
            "items"
        ]
        topic = next(item for item in topics if item["name"] == "Fixture Listings")
        bindings = (await call(client, "list_topic_sources", topic_id=topic["id"]))[
            "items"
        ]
        assert {item["source_name"] for item in bindings} == {
            "Demo Cards",
            "Demo Catalog",
        }
        prep = partial(prepare, client, topic["id"], [item["id"] for item in bindings])
        quick = await prep("quick")
        assert inventory(api) == before
        created = await call(client, "start_collection", **quick)
        assert (created["outcome"], created["http_status"]) == ("created", 201)
        normal = await verify_terminal(client, api, created, "succeeded")
        after_normal = inventory(api)
        assert_delta(before, after_normal, created["request_id"], job_ids(created))
        reordered = quick | {"binding_ids": quick["binding_ids"][::-1]}
        replayed = await call(client, "start_collection", **reordered)
        assert (replayed["outcome"], replayed["http_status"]) == ("replayed", 200)
        assert replayed["request_id"] == created["request_id"] and job_ids(
            replayed
        ) == job_ids(created)
        assert inventory(api) == after_normal
        conflict = await call(
            client,
            "start_collection",
            expect_error=True,
            **(quick | {"keyword": "detail404"}),
        )
        assert (conflict["outcome"], conflict["http_status"], conflict["code"]) == (
            "conflict",
            409,
            "collection_request_conflict",
        )
        assert inventory(api) == after_normal
        lost_intent = await prep("quick")
        assert lost_intent == quick | {"request_key": lost_intent["request_key"]}
        assert lost_intent["request_key"] != quick["request_key"]

    with drop_committed_reply(base) as (proxy_base, replies):
        async with connect(proxy_base) as client:
            lost = await call(
                client, "start_collection", expect_error=True, **lost_intent
            )
        code, committed = replies.get(timeout=5)
    assert code == 201 and committed["id"] != created["request_id"]
    assert lost["outcome"] == "unknown" and lost["retry_same_key"]
    assert lost["request_key"] == lost_intent["request_key"]
    after_commit = inventory(api)
    assert_delta(after_normal, after_commit, committed["id"], job_ids(committed))

    async with connect(base) as fresh_client:
        recovered = await call(fresh_client, "start_collection", **lost_intent)
        assert (recovered["outcome"], recovered["http_status"]) == ("replayed", 200)
        assert recovered["request_id"] == committed["id"] and job_ids(
            recovered
        ) == job_ids(committed)
        assert inventory(api) == after_commit
        recovery = await verify_terminal(fresh_client, api, recovered, "succeeded")
        partial_intent = await prepare(
            fresh_client, topic["id"], quick["binding_ids"], "detail404"
        )
        partial_receipt = await call(fresh_client, "start_collection", **partial_intent)
        assert partial_receipt["http_status"] == 201
        partial_result = await verify_terminal(
            fresh_client, api, partial_receipt, "partial"
        )
        after_partial = inventory(api)
        assert_delta(
            after_commit,
            after_partial,
            partial_receipt["request_id"],
            job_ids(partial_receipt),
        )
        eligibility = await verify_eligibility(fresh_client, api, category, bindings)

    return {
        "topic": topic,
        "normal": normal,
        "reordered_replay": replayed,
        "conflict": conflict,
        "lost_reply": lost,
        "lost_upstream_http_status": code,
        "recovery": recovery,
        "partial": partial_result,
        "eligibility": eligibility,
        "inventory": {
            "initial_and_after_prepare": totals(before),
            "normal_after_replay_and_conflict": totals(after_normal),
            "lost_after_backend_commit_and_recovery": totals(after_commit),
            "partial_complete": totals(after_partial),
        },
    }


def main():
    base = api_base(os.environ.get("FYP_MCP_API_BASE", ""))
    with httpx2.Client(
        base_url=base, timeout=5, trust_env=False, follow_redirects=False
    ) as api:
        print(json.dumps(asyncio.run(verify(api, base)), indent=2))


if __name__ == "__main__":
    main()
