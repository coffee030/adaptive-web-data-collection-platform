import asyncio
import csv
import io
import json
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread

import pytest

from mcp_access.harbourline import create_server, worksheet_page
from mcp_access.tests.company_client import connection, read

BASE = "http://127.0.0.1:5198/api/v1"


def test_rate_request_pages_keep_headings_and_quoted_credits():
    heading = [["Company", "Test"], [], ["Creator", "Work", "Price"]]
    names = [["First", 'Programme, "one"', ""], ["Second", "Series\npart two", ""]]
    buffer = io.StringIO(newline="")
    csv.writer(buffer, quoting=csv.QUOTE_ALL).writerows(heading + names)
    full = buffer.getvalue()
    assert worksheet_page(full, 10, 0)["csv"] == full
    first = worksheet_page(full, 1, 0)
    second = worksheet_page(full, 1, first["next_offset"])
    assert first["total"] == 2 and second["next_offset"] is None
    assert (
        list(csv.reader(io.StringIO(second["csv"], newline=""))) == heading + names[1:]
    )


def test_public_and_demo_tool_scopes():
    async def run():
        async with connection(BASE, "public") as public:
            tools = (await public.list_tools()).tools
            assert {tool.name for tool in tools} == {
                "search_public_creators",
                "search_public_works",
                "search_market_creators",
                "find_market_activity",
                "compare_market_creators",
                "market_activity_overview",
                "compare_market_measurements",
            }
            assert all(tool.annotations.read_only_hint for tool in tools)
        async with connection(BASE, "demo") as demo:
            tools = (await demo.list_tools()).tools
            assert {tool.name for tool in tools} == {
                "search_creators",
                "inspect_creator",
                "compare_creators",
                "campaign_criteria",
                "evaluate_campaign",
                "calculate_campaign_scenario",
            }

    asyncio.run(run())
    with pytest.raises(ValueError):
        create_server(BASE, "company")
    with pytest.raises(ValueError):
        create_server(BASE, "public", allow_budget_edits=True)


@contextmanager
def published_works():
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_GET(self):
            assert (
                self.path
                == "/api/v1/marketing/intelligence/public-research/works?q=dining"
            )
            assert "Authorization" not in self.headers and "Cookie" not in self.headers
            works = [
                {
                    "id": str(i),
                    "revision_url": f"https://commons.wikimedia.org/?oldid={i}",
                    "license": "CC BY 4.0",
                    "license_url": "https://creativecommons.org/licenses/by/4.0/",
                }
                for i in (1, 2)
            ]
            data = {
                "state": "available",
                "criteria": "Dated food evidence",
                "retrieval": "evidence_filter_with_granite",
                "contributors": [
                    {
                        "name": "Controlled contributor",
                        "matched_works": works,
                        "audience": None,
                        "campaign_quote": None,
                        "performance": None,
                    }
                ],
            }
            payload = json.dumps(data).encode()
            self.send_response(200)
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

    with ThreadingHTTPServer(("127.0.0.1", 0), Handler) as server:
        worker = Thread(target=server.serve_forever, daemon=True)
        worker.start()
        try:
            yield f"http://127.0.0.1:{server.server_port}/api/v1"
        finally:
            server.shutdown()
            worker.join()


def test_public_work_pages_retain_credit_source_and_missing_measurements():
    async def run(base):
        async with connection(
            base, "public", FYP_MCP_OPERATOR_TOKEN="unused-controlled-token"
        ) as public:
            first = await read(
                public, "search_public_works", query="dining", work_limit=1
            )
            assert first["criteria"] == "Dated food evidence"
            assert first["retrieval"] == "evidence_filter_with_granite"
            contributor = first["items"][0]
            assert (
                contributor["name"] == "Controlled contributor"
                and contributor["total_matched_works"] == 2
            )
            assert (
                contributor["audience"] is None
                and contributor["campaign_quote"] is None
            )
            second = await read(
                public,
                "search_public_works",
                query="dining",
                work_limit=1,
                work_offset=contributor["next_work_offset"],
            )
            last = second["items"][0]
            assert last["next_work_offset"] is None
            work = last["matched_works"][0]
            assert (
                work["revision_url"].endswith("oldid=2")
                and work["license"] == "CC BY 4.0"
            )

    with published_works() as base:
        asyncio.run(run(base))
