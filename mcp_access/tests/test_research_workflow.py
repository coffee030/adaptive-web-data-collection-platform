import asyncio
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
from threading import Thread
from uuid import uuid4

import httpx2
from mcp.server.mcpserver.exceptions import ToolError
import pytest

from mcp_access.harbourline import create_server
from mcp_access.tests.company_client import connection, denied, read


SETTINGS = {
    "HARBOURLINE_MCP_COMPANY_ID": "fixture-company",
    "HARBOURLINE_MCP_SESSION": "a" * 43,
    "HARBOURLINE_MCP_ALLOW_WORKSPACE_EDITS": "1",
}
TOOL = "start_campaign_research"


def submissions():
    root = Path(__file__).resolve().parents[2]
    fixture = root / "backend/tests/fixtures/pr26b_research.json"
    preparation = json.loads(fixture.read_text(encoding="utf-8"))["preparation"]
    legacy = {"request_key": str(uuid4()), "brief": preparation["brief"]}
    confirmed = (
        legacy
        | preparation
        | {
            "request_key": str(uuid4()),
            "decisions": {"publication_age": {"max_evidence_age_days": 30}},
            "confirmation": {
                "action": "confirm",
                "version": "research-criteria-v1",
                "proposal_fingerprint": "f" * 64,
            },
        }
    )
    return legacy, confirmed


@contextmanager
def outbound_fixture():
    calls = []
    replies = []

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_GET(self):
            self.reply(None)

        def do_POST(self):
            self.reply(json.loads(self.rfile.read(int(self.headers["Content-Length"]))))

        def reply(self, body):
            calls.append((self.command, self.path, body))
            status, payload = (
                replies.pop(0) if replies else (200, {"id": "captured-run"})
            )
            data = (
                payload if isinstance(payload, bytes) else json.dumps(payload).encode()
            )
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

    with ThreadingHTTPServer(("127.0.0.1", 0), Handler) as server:
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            yield f"http://127.0.0.1:{server.server_port}/api/v1", calls, replies
        finally:
            server.shutdown()
            thread.join()


def test_raw_tool_schema_and_presence_are_enforced_over_stdio():
    async def invoke(base, calls):
        legacy, confirmed = submissions()
        async with connection(base, "company", **SETTINGS) as client:
            tool = next(
                tool for tool in (await client.list_tools()).tools if tool.name == TOOL
            )
            schema = tool.input_schema
            assert schema["type"] == "object" and len(schema["anyOf"]) == 2
            assert (
                schema["$defs"]["LegacyResearchToolRequest"]["additionalProperties"]
                is False
            )
            assert "confirmation" in schema["$defs"]["ConfirmedResearch"]["required"]
            assert not tool.annotations.read_only_hint
            for bad in (
                *(
                    legacy | {name: None}
                    for name in ("confirmation", "provenance", "decisions", "protocol")
                ),
                legacy | {"protocol": "legacy", "provenance": {}},
                legacy | {"protocol": "legacy", "decisions": {}},
                legacy | {"confirmation": {}},
                legacy | {"protocol": "confirmed-v1"},
                confirmed | {"confirmation": None},
                confirmed | {"confirmation": {}},
                confirmed
                | {
                    "confirmation": {
                        "action": "confirm",
                        "version": "research-criteria-v1",
                        "proposal_fingerprint": "invalid",
                    }
                },
                confirmed | {"decisions": None},
                confirmed | {"provenance": None},
                confirmed | {"protocol": "confirmed-v9"},
            ):
                await denied(client, TOOL, "Invalid research submission", **bad)
                assert calls == []

            assert (await read(client, TOOL, **legacy))["id"] == "captured-run"
            assert (await read(client, TOOL, **(legacy | {"protocol": "legacy"})))[
                "id"
            ] == "captured-run"
            assert (await read(client, TOOL, **confirmed))["id"] == "captured-run"
            assert all(
                method == "POST" and path == "/api/v1/marketing/companies/research-runs"
                for method, path, _ in calls
            )
            sent = [item[2] for item in calls]
            assert set(sent[0]) == {"request_key", "brief", "campaign_id"}
            assert sent[0] == sent[1]
            assert {
                key: sent[2][key]
                for key in ("protocol", "confirmation", "request_key", "provenance")
            } == {
                key: confirmed[key]
                for key in ("protocol", "confirmation", "request_key", "provenance")
            }
            assert (
                sent[2]["decisions"]["publication_age"]
                == confirmed["decisions"]["publication_age"]
            )

    with outbound_fixture() as (base, calls, _):
        asyncio.run(invoke(base, calls))


def test_known_research_errors_and_bounded_fallbacks_over_stdio():
    async def invoke(base, replies):
        _, confirmed = submissions()
        async with connection(base, "company", **SETTINGS) as client:
            for code, status, recovery in (
                (
                    "research_confirmation_stale",
                    409,
                    "Preview the current proposal again and confirm that exact proposal",
                ),
                (
                    "research_criteria_unresolved",
                    422,
                    "Resolve the reported blocking criteria",
                ),
                (
                    "research_request_changed",
                    409,
                    "Read the existing request or use a new key",
                ),
                (
                    "research_snapshot_invalid",
                    409,
                    "Stop this action and report the integrity problem",
                ),
            ):
                replies.append(
                    (
                        status,
                        {
                            "error": {
                                "code": code,
                                "message": "Internal detail will not be echoed",
                                "issues": [
                                    {
                                        "field": "platform",
                                        "action": "Choose YouTube explicitly",
                                    }
                                ],
                            }
                        },
                    )
                )
                result = await client.call_tool(TOOL, confirmed)
                assert result.is_error
                message = result.content[0].text
                assert code in message and recovery in message
                assert "Internal detail" not in message
                assert ("platform: Choose YouTube explicitly" in message) == (
                    code == "research_criteria_unresolved"
                )

            for payload in (
                b"not JSON",
                {"error": []},
                {"error": {"code": ["invalid"]}},
                {"error": {"code": "unknown", "message": "Private payload"}},
                b"x" * 17000,
            ):
                replies.append((409, payload))
                await denied(
                    client, TOOL, "The workspace or record changed.", **confirmed
                )

            for status, guidance in (
                (401, "Reconnect with an active member account"),
                (403, "does not permit this workspace operation"),
            ):
                replies.append((status, b"non-JSON authentication response"))
                await denied(client, TOOL, guidance, **confirmed)

            replies.append((409, {"error": {"code": "no_current_leads"}}))
            await denied(
                client,
                "export_rate_request",
                "needs a shortlisted creator",
                campaign_id=str(uuid4()),
                expected_version=1,
            )

    with outbound_fixture() as (base, calls, replies):
        asyncio.run(invoke(base, replies))
        assert len(calls) == 12
        assert not replies


def test_research_wrapper_retains_network_recovery(monkeypatch):
    def disconnect(request):
        raise httpx2.ConnectError("fixture disconnect", request=request)

    original = httpx2.AsyncClient

    def controlled_client(**options):
        return original(transport=httpx2.MockTransport(disconnect), **options)

    monkeypatch.setattr(httpx2, "AsyncClient", controlled_client)
    server = create_server(
        "http://127.0.0.1:5198/api/v1",
        "company",
        company="fixture-company",
        session="a" * 43,
    )
    with pytest.raises(
        ToolError, match="Read the current state before retrying a change"
    ):
        asyncio.run(server.call_tool("get_research_progress", {"run_id": str(uuid4())}))
