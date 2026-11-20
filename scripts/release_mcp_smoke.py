"""Verify MCP over stdio against the release gate's isolated Synthetic Demo."""

import asyncio
import os
import sys
from pathlib import Path

from mcp import Client, StdioServerParameters

from mcp_access.server import api_base


async def check():
    base = api_base(os.environ["FYP_MCP_API_BASE"])
    stdio = StdioServerParameters(
        command=sys.executable,
        args=["-m", "mcp_access.server"],
        cwd=Path(__file__).resolve().parents[1],
        env={"FYP_MCP_API_BASE": base},
    )
    async with Client(stdio, mode="legacy", read_timeout_seconds=10) as client:

        async def call(tool, **arguments):
            result = await client.call_tool(tool, arguments)
            assert not result.is_error, result.content
            return result.structured_content

        tools = {tool.name for tool in (await client.list_tools()).tools}
        assert "start_collection" in tools
        topics = await call("list_topics", limit=25)
        topic = next(
            row for row in topics["items"] if row["name"] == "Fixture Listings"
        )
        bindings = await call("list_topic_sources", topic_id=topic["id"])
        assert {row["source_name"] for row in bindings["items"]} == {
            "Demo Cards",
            "Demo Catalog",
        }
        prepared = await call(
            "prepare_collection",
            topic_id=topic["id"],
            keyword="quick",
            binding_ids=[row["id"] for row in bindings["items"]],
        )
        assert prepared["submitted"] is False
        created = await call("start_collection", **prepared["submission"])
        replay = await call("start_collection", **prepared["submission"])
        request_id = created["request_id"]
        assert created["outcome"] == "created"
        assert replay["outcome"] == "replayed" and replay["request_id"] == request_id
        assert [job["job_id"] for job in replay["jobs"]] == [
            job["job_id"] for job in created["jobs"]
        ]
        async with asyncio.timeout(75):
            while True:
                status = await call("get_collection_status", request_id=request_id)
                if status["status"] not in {"pending", "running"}:
                    break
                await asyncio.sleep(1)
        assert status["status"] == "succeeded", status
        records = await call("get_collection_records", request_id=request_id)
        assert len(records["items"]) == 2
        for record in records["items"]:
            lineage = await call("get_record_lineage", record_id=record["record_id"])
            digest = await call(
                "get_evidence_metadata", evidence_id=lineage["evidence_reference"]
            )
            assert len(digest["content_hash"]) == 64
            assert digest["profile_version_id"] == lineage["profile_version_id"]
    print(
        "PASS real MCP discovery, controlled submission, replay, Records and Evidence."
    )


if __name__ == "__main__":
    asyncio.run(check())
