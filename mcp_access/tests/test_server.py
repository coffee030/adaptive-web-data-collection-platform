"""Exercise the real stdio process against a controlled REST contract."""

import asyncio
import json
import os
import socket
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from urllib.parse import parse_qs, urlsplit
from uuid import UUID

import pytest
from mcp import Client, StdioServerParameters

from mcp_access.server import MAX_FIELD_CHARS, MAX_PAYLOAD_FIELDS, MAX_RESPONSE_BYTES, api_base

ROOT = Path(__file__).resolve().parents[2]
CATEGORY, TOPIC, REQUEST_A, REQUEST_B, EMPTY, UNKNOWN, JOB, SOURCE, PROFILE, EVIDENCE = (
    str(UUID(int=i)) for i in range(1, 11)
)
RECORDS = [str(UUID(int=i)) for i in range(11, 14)]
DIGEST = "a" * 64


@pytest.fixture
def rest_api():
    calls = []
    category = {"id": CATEGORY, "name": "Controlled category", "active": True}
    topic = {**category, "id": TOPIC, "category_id": CATEGORY}
    binding = {"id": "eligible", "source_id": SOURCE, "profile_version_id": PROFILE, "eligible": True}
    lineage = {
        "job_id": JOB, "source_id": SOURCE, "profile_version_id": PROFILE,
        "evidence_reference": EVIDENCE,
    }
    records = [
        {
            **lineage,
            "record_id": record_id,
            "payload": {"title": "f" * 1000, "missing": None, "number": 7},
        }
        for record_id in RECORDS
    ]
    records[1]["payload"] = {f"field_{i}": i for i in range(MAX_PAYLOAD_FIELDS + 1)}

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def reply(self, status, value, **headers):
            body = json.dumps(value).encode()
            self.send_response(status)
            self.send_header("Content-Length", str(len(body)))
            for name, header in headers.items():
                self.send_header(name, header)
            self.end_headers()
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                pass

        def do_POST(self):
            calls.append(("POST", self.path, {}))
            self.reply(405, {})

        def do_GET(self):
            url = urlsplit(self.path)
            path = url.path.removeprefix("/api/v1")
            query = {key: values[0] for key, values in parse_qs(url.query).items()}
            calls.append(("GET", path, query))
            if path == "/categories":
                values = [category]
                if query.get("active_only") != "true":
                    values.append({"id": UNKNOWN, "active": False})
            elif path == "/topics":
                values = [topic] if query.get("category_id", CATEGORY) == CATEGORY else []
                if query.get("active_only") != "true":
                    values.append({"id": UNKNOWN, "active": False})
            elif path == f"/topics/{TOPIC}/bindings":
                values = [binding]
                if query.get("eligible_only") != "true":
                    values.append({"id": "ineligible", "eligible": False})
            elif path == f"/collection-requests/{REQUEST_A}":
                return self.reply(200, {
                    "id": REQUEST_A, "status": "partial", "refresh_of": None,
                    "jobs": [
                        {"job": {"job_id": JOB, "status": "succeeded"}},
                        {"job": {"job_id": UNKNOWN, "status": "failed"}},
                    ],
                })
            elif path == "/records":
                scoped = {
                    REQUEST_A: records[:2], REQUEST_B: records[2:], EMPTY: [],
                    None: records,
                }
                if query.get("request_id") not in scoped:
                    return self.reply(404, {"detail": "request missing"})
                values = scoped[query.get("request_id")]
            elif path == f"/records/{RECORDS[0]}":
                return self.reply(200, {**records[0], "request_id": REQUEST_A, "article_id": None})
            elif path == f"/evidence/{EVIDENCE}":
                return self.reply(200, {
                    **lineage, "evidence_id": EVIDENCE, "content_hash": DIGEST,
                    "content_type": None, "storage_path": "private",
                })
            elif path == f"/evidence/{REQUEST_A}":
                return self.reply(200, {"too_large": "X" * MAX_RESPONSE_BYTES})
            elif path == f"/evidence/{REQUEST_B}":
                return self.reply(302, {"detail": "private"}, Location="/unexpected")
            elif path == f"/evidence/{EMPTY}":
                return self.reply(503, {"detail": "private"})
            else:
                return self.reply(404, {"detail": "private"})
            offset = int(query["offset"])
            self.reply(200, values[offset : offset + int(query["limit"])])

    with ThreadingHTTPServer(("127.0.0.1", 0), Handler) as server:
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            yield f"http://127.0.0.1:{server.server_port}/api/v1", calls
        finally:
            server.shutdown()
            thread.join()


def client_for(base):
    return Client(
        StdioServerParameters(
            command=sys.executable,
            args=["-m", "mcp_access.server"],
            cwd=ROOT,
            env={"FYP_MCP_API_BASE": base},
        ),
        mode="legacy",
        read_timeout_seconds=10,
    )


async def read(client, tool, **arguments):
    result = await client.call_tool(tool, arguments)
    assert not result.is_error, result.content
    return result.structured_content


async def error(client, tool, **arguments):
    result = await client.call_tool(tool, arguments)
    assert result.is_error
    message = result.content[0].text
    assert len(message) < 500
    assert "private" not in message
    return message


def test_stdio_read_only_surface(rest_api):
    base, calls = rest_api

    async def exercise():
        async with client_for(base) as client:
            tools = {tool.name: tool for tool in (await client.list_tools()).tools}
            assert set(tools) == {
                "list_categories", "list_topics", "list_topic_sources", "get_collection_status",
                "get_collection_records", "get_record_lineage", "get_evidence_metadata",
            }
            assert all(tool.annotations.read_only_hint for tool in tools.values())
            assert all(tool.annotations.destructive_hint is False for tool in tools.values())
            record_schema = tools["get_collection_records"].input_schema
            assert record_schema["required"] == ["request_id"]
            assert record_schema["properties"]["limit"]["maximum"] == 25
            assert all(tool.output_schema for tool in tools.values())

            assert [item["id"] for item in (await read(client, "list_categories"))["items"]] == [CATEGORY]
            assert (await read(client, "list_topics"))["items"][0]["id"] == TOPIC
            assert (await read(client, "list_topics", category_id=CATEGORY))["items"][0]["id"] == TOPIC
            assert (await read(client, "list_topics", category_id=UNKNOWN))["items"] == []
            bindings = await read(client, "list_topic_sources", topic_id=TOPIC)
            assert [item["id"] for item in bindings["items"]] == ["eligible"]

            status = await read(client, "get_collection_status", request_id=REQUEST_A)
            assert status["status"] == "partial"
            assert status["refresh_of"] is None
            assert "finished_at" not in status
            assert [child["job"]["status"] for child in status["jobs"]] == ["succeeded", "failed"]

            first = await read(client, "get_collection_records", request_id=REQUEST_A, limit=1)
            second = await read(
                client, "get_collection_records", request_id=REQUEST_A, limit=1, offset=first["next_offset"]
            )
            other = await read(client, "get_collection_records", request_id=REQUEST_B)
            assert first["has_more"] and first["next_offset"] == 1 and "total" not in first
            assert not second["has_more"] and second["next_offset"] is None
            assert [page["items"][0]["record_id"] for page in (first, second, other)] == RECORDS
            assert other["request_id"] == REQUEST_B
            assert "source data" in first["payload_origin"]
            item = first["items"][0]
            assert item["payload_truncated"] and len(item["payload"]["title"]) == MAX_FIELD_CHARS
            assert item["payload"]["missing"] is None and item["payload"]["number"] == 7
            assert second["items"][0]["payload_truncated"]
            assert len(second["items"][0]["payload"]) == MAX_PAYLOAD_FIELDS
            empty = await read(client, "get_collection_records", request_id=EMPTY)
            assert empty["items"] == [] and empty["request_id"] == EMPTY and not empty["has_more"]

            lineage = await read(client, "get_record_lineage", record_id=RECORDS[0])
            assert lineage["request_id"] == REQUEST_A and lineage["article_id"] is None
            assert lineage["job_id"] == JOB and lineage["source_id"] == SOURCE
            assert lineage["profile_version_id"] == PROFILE and lineage["evidence_reference"] == EVIDENCE
            evidence = await read(client, "get_evidence_metadata", evidence_id=EVIDENCE)
            assert evidence["content_hash"] == DIGEST and evidence["content_type"] is None
            assert "storage_path" not in evidence and evidence["job_id"] == JOB

    asyncio.run(exercise())
    assert calls == [
        ("GET", "/categories", {"limit": "11", "offset": "0", "active_only": "true"}),
        ("GET", "/topics", {"limit": "11", "offset": "0", "active_only": "true"}),
        ("GET", "/topics", {"limit": "11", "offset": "0", "active_only": "true", "category_id": CATEGORY}),
        ("GET", "/topics", {"limit": "11", "offset": "0", "active_only": "true", "category_id": UNKNOWN}),
        ("GET", f"/topics/{TOPIC}/bindings", {"limit": "11", "offset": "0", "eligible_only": "true"}),
        ("GET", f"/collection-requests/{REQUEST_A}", {}),
        ("GET", "/records", {"request_id": REQUEST_A, "limit": "2", "offset": "0"}),
        ("GET", "/records", {"request_id": REQUEST_A, "limit": "2", "offset": "1"}),
        ("GET", "/records", {"request_id": REQUEST_B, "limit": "11", "offset": "0"}),
        ("GET", "/records", {"request_id": EMPTY, "limit": "11", "offset": "0"}),
        ("GET", f"/records/{RECORDS[0]}", {"include_lineage": "true"}),
        ("GET", f"/evidence/{EVIDENCE}", {}),
    ]


def test_stdio_bounded_errors(rest_api):
    base, calls = rest_api

    async def exercise():
        async with client_for(base) as client:
            await error(client, "get_collection_records")
            await error(client, "get_collection_records", request_id="invalid/" * 1000)
            await error(client, "list_categories", limit=26)
            await error(client, "list_topics", offset=-1)
            assert calls == []

            for tool, argument in (
                ("get_collection_records", "request_id"),
                ("get_collection_status", "request_id"),
                ("list_topic_sources", "topic_id"),
                ("get_record_lineage", "record_id"),
                ("get_evidence_metadata", "evidence_id"),
            ):
                assert "not found" in await error(client, tool, **{argument: UNKNOWN})
            assert "exceeds 2 MiB" in await error(client, "get_evidence_metadata", evidence_id=REQUEST_A)
            assert "HTTP 302" in await error(client, "get_evidence_metadata", evidence_id=REQUEST_B)
            assert "unavailable" in await error(client, "get_evidence_metadata", evidence_id=EMPTY)

    asyncio.run(exercise())
    assert len(calls) == 8 and all(method == "GET" for method, _, _ in calls)
    assert not any(path == "/unexpected" for _, path, _ in calls)


def test_stdio_unavailable_api():
    # Keep a local port reserved without accepting or serving requests.
    with socket.socket() as reserved:
        reserved.bind(("127.0.0.1", 0))
        base = f"http://127.0.0.1:{reserved.getsockname()[1]}/api/v1"

        async def exercise():
            async with client_for(base) as client:
                assert "unavailable" in await error(client, "list_categories")

        asyncio.run(exercise())


def test_bad_startup_config_uses_stderr():
    process = subprocess.run(
        [sys.executable, "-m", "mcp_access.server"],
        cwd=ROOT,
        env={**os.environ, "FYP_MCP_API_BASE": ""},
        capture_output=True,
        text=True,
        timeout=10,
    )
    assert process.returncode == 2
    assert process.stdout == ""
    assert "FYP_MCP_API_BASE" in process.stderr


@pytest.mark.parametrize("value", [
    "", "https://127.0.0.1:58098/api/v1", "http://example.org:8000/api/v1",
    "http://127.0.0.1:8000/api/v1?x=1", "http://127.0.0.1:0/api/v1",
    "http://127.0.0.1:65536/api/v1", "http://127.0.0.1:8000/api/v1/records",
    "http://127.0.0.1:8000@example.org/api/v1",
])
def test_api_base_rejects_other_destinations(value):
    with pytest.raises(ValueError, match="FYP_MCP_API_BASE"):
        api_base(value)
