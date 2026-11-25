"""Replay the read-only SDK trace for a persisted Synthetic Demo request."""

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path
from uuid import UUID

import httpx2
from mcp import Client, StdioServerParameters

from .server import api_base


def read_api(client, path, **params):
    response = client.get(path, params=params)
    response.raise_for_status()
    return response.json()


def inventory(client):
    result = []
    for path, key in (("/collection-requests", "id"), ("/collection-jobs", "job_id")):
        ids = set()
        for offset in range(0, 100_000, 100):
            page = read_api(client, path, limit=100, offset=offset)
            ids.update(item[key] for item in page)
            if len(page) < 100:
                break
        else:
            raise RuntimeError("Demo inventory exceeded the verification limit.")
        result.append(ids)
    return result


async def trace(api, connection, request_id):
    async with Client(connection, read_timeout_seconds=10) as client:
        tools = await client.list_tools()

        async def read(name, **params):
            result = await client.call_tool(name, params)
            if result.is_error or result.structured_content is None:
                raise RuntimeError(f"{name} failed: {result.content}")
            return result.structured_content

        categories = await read("list_categories")
        category = next(
            item for item in categories["items"] if item["name"] == "Core Demonstration"
        )
        topics = await read("list_topics", category_id=category["id"])
        topic = next(
            item for item in topics["items"] if item["name"] == "Fixture Listings"
        )
        bindings = await read("list_topic_sources", topic_id=topic["id"])
        request = await read("get_collection_status", request_id=request_id)
        rest_request = read_api(api, f"/collection-requests/{request_id}")
        assert request["id"] == rest_request["id"] == request_id
        assert request["topic_id"] == rest_request["topic_id"] == topic["id"]
        assert request["status"] == rest_request["status"]
        assert {item["binding_id"] for item in request["jobs"]} <= {
            item["id"] for item in bindings["items"]
        }
        assert {
            (item["job"]["job_id"], item["job"]["status"]) for item in request["jobs"]
        } == {
            (item["job"]["job_id"], item["job"]["status"])
            for item in rest_request["jobs"]
        }

        first = await read("get_collection_records", request_id=request_id, limit=1)
        assert first["has_more"] and first["next_offset"] == 1
        second = await read(
            "get_collection_records", request_id=request_id, limit=1, offset=1
        )
        record_ids = [page["items"][0]["record_id"] for page in (first, second)]
        assert record_ids == [
            item["record_id"]
            for item in read_api(api, "/records", request_id=request_id, limit=2)
        ]

        record_id = record_ids[0]
        record = await read("get_record_lineage", record_id=record_id)
        rest_record = read_api(api, f"/records/{record_id}", include_lineage="true")
        assert record["request_id"] == rest_record["request_id"] == request_id
        keys = ("job_id", "source_id", "profile_version_id")
        evidence_id = record["evidence_reference"]
        evidence = await read("get_evidence_metadata", evidence_id=evidence_id)
        rest_evidence = read_api(api, f"/evidence/{evidence_id}")
        assert evidence["evidence_id"] == rest_evidence["evidence_id"] == evidence_id
        assert rest_record["evidence_reference"] == evidence_id
        for key in keys:
            assert (
                record[key] == rest_record[key] == evidence[key] == rest_evidence[key]
            )
        assert evidence["content_hash"] == rest_evidence["content_hash"]
        assert len(evidence["content_hash"]) == 64
        child = next(
            item
            for item in request["jobs"]
            if item["job"]["job_id"] == record["job_id"]
        )
        assert all(child["job"][key] == record[key] for key in keys)
        return {
            "tools": [tool.name for tool in tools.tools],
            "category": category,
            "topic": topic,
            "eligible_bindings": bindings["items"],
            "request_id": request_id,
            "request_status": request["status"],
            "record_pages": record_ids,
            "record_id": record_id,
            **{key: record[key] for key in keys},
            "source_name": child["source_name"],
            "profile_version": child["profile_version"],
            "evidence_id": evidence_id,
            "stored_sha256": evidence["content_hash"],
        }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "request_id",
        type=UUID,
        help="Use the Fixture Listings Request from the Dashboard",
    )
    request_id = str(parser.parse_args().request_id)
    base = api_base(os.environ.get("FYP_MCP_API_BASE", ""))
    connection = StdioServerParameters(
        command=sys.executable,
        args=["-m", "mcp_access.server"],
        cwd=Path(__file__).resolve().parents[1],
        env={"FYP_MCP_API_BASE": base},
    )
    with httpx2.Client(base_url=base, timeout=5, trust_env=False) as api:
        before = inventory(api)
        comparison = asyncio.run(trace(api, connection, request_id))
        after = inventory(api)
    assert before == after, (
        "The Demo Request or Job inventory changed during the trace."
    )
    comparison["inventory_before_and_after"] = {
        "requests": len(after[0]),
        "jobs": len(after[1]),
    }
    print(json.dumps(comparison, indent=2))


if __name__ == "__main__":
    main()
