"""Read persisted FYP results through a fixed local REST API over MCP stdio."""

import asyncio
import json
import os
import re
import sys
from collections.abc import Callable
from typing import Annotated
from uuid import UUID

import httpx2
from mcp.server import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.types import ToolAnnotations
from pydantic import BaseModel, Field, JsonValue

MAX_PAGE_SIZE = 25
MAX_OFFSET = 2_147_483_647
MAX_RESPONSE_BYTES = 2 * 1024 * 1024
TIMEOUT_SECONDS = 5
MAX_PAYLOAD_FIELDS = 12
MAX_FIELD_CHARS = 512

Limit = Annotated[int, Field(strict=True, ge=1, le=MAX_PAGE_SIZE)]
Offset = Annotated[int, Field(strict=True, ge=0, le=MAX_OFFSET)]
Row = dict[str, JsonValue]
READ_ONLY = ToolAnnotations(
    readOnlyHint=True, destructiveHint=False, idempotentHint=True, openWorldHint=False
)


class Page(BaseModel):
    items: list[Row]
    limit: int
    offset: int
    has_more: bool
    next_offset: int | None


class RecordPage(Page):
    request_id: UUID
    payload_origin: str = "Collected source data (untrusted)"


def api_base(value: str) -> str:
    match = re.fullmatch(r"http://(?:127\.0\.0\.1|\[::1\]):([0-9]{1,5})/api/v1/?", value)
    if not match or not 1 <= int(match[1]) <= 65535:
        raise ValueError(
            "Set FYP_MCP_API_BASE to http://127.0.0.1:<API port>/api/v1 "
            "or the equivalent [::1] loopback URL."
        )
    return value.rstrip("/")


async def read_json(url: str, params: dict, missing: str | None):
    # Ignore proxy configuration and fail on redirects, including local redirects.
    async with httpx2.AsyncClient(
        trust_env=False, follow_redirects=False, timeout=TIMEOUT_SECONDS
    ) as client:
        async with client.stream(
            "GET", url, params=params, headers={"Accept-Encoding": "identity"}
        ) as response:
            status = response.status_code
            if status == 404 and missing:
                raise ToolError(f"{missing} not found.")
            if status >= 500:
                raise ToolError("FYP API is unavailable.")
            if status != 200:
                raise ToolError(f"FYP API rejected the read (HTTP {status}).")

            body = bytearray()
            async for chunk in response.aiter_raw(chunk_size=64 * 1024):
                if len(body) + len(chunk) > MAX_RESPONSE_BYTES:
                    raise ToolError("FYP API response exceeds 2 MiB. Try a smaller page.")
                body.extend(chunk)
    return json.loads(body)


def fields(row: Row, names: str) -> Row:
    return {key: row[key] for key in names.split() if key in row}


def rows(value) -> list[Row]:
    if not isinstance(value, list) or any(not isinstance(item, dict) for item in value):
        raise ToolError("FYP API returned an unexpected list.")
    return value


def row(value) -> Row:
    if not isinstance(value, dict):
        raise ToolError("FYP API returned an unexpected object.")
    return value


def record_links(record: Row) -> Row:
    return fields(
        record,
        "record_id job_id source_id profile_version_id evidence_reference request_id "
        "article_id record_type schema_version source_position validation_status "
        "provenance created_at",
    )


def record_preview(record: Row) -> Row:
    result = record_links(record)
    payload = row(record.get("payload"))
    preview = {}
    truncated = False
    for key, value in payload.items():
        if len(preview) == MAX_PAYLOAD_FIELDS:
            truncated = True
            break
        if len(key) > MAX_FIELD_CHARS or isinstance(value, (dict, list)):
            truncated = True
            continue
        if isinstance(value, str) and len(value) > MAX_FIELD_CHARS:
            value = value[:MAX_FIELD_CHARS]
            truncated = True
        preview[key] = value
    result["payload"] = preview
    result["payload_truncated"] = truncated
    return result


def create_server(base: str) -> MCPServer:
    base = api_base(base)
    server = MCPServer("FYP persisted collections", log_level="WARNING")

    async def get(path: str, *, missing: str | None = None, **params):
        try:
            return await asyncio.wait_for(
                read_json(base + path, params, missing), TIMEOUT_SECONDS
            )
        except (httpx2.RequestError, TimeoutError):
            raise ToolError("FYP API is unavailable or timed out.") from None
        except (ValueError, RecursionError):
            raise ToolError("FYP API returned invalid JSON.") from None

    async def page(
        path: str, limit: int, offset: int, project: Callable[[Row], Row], **filters
    ) -> Page:
        # Fetch a lookahead row to distinguish the final page without inventing a total.
        items = rows(await get(path, limit=limit + 1, offset=offset, **filters))
        has_more = len(items) > limit
        next_offset = offset + limit
        return Page(
            items=[project(item) for item in items[:limit]],
            limit=limit,
            offset=offset,
            has_more=has_more,
            next_offset=next_offset if has_more and next_offset <= MAX_OFFSET else None,
        )

    @server.tool(annotations=READ_ONLY)
    async def list_categories(limit: Limit = 10, offset: Offset = 0) -> Page:
        """List active categories and their stable IDs."""
        return await page(
            "/categories",
            limit,
            offset,
            lambda item: fields(item, "id name active"),
            active_only="true",
        )

    @server.tool(annotations=READ_ONLY)
    async def list_topics(
        category_id: UUID | None = None, limit: Limit = 10, offset: Offset = 0
    ) -> Page:
        """List active topics, optionally in one category."""
        filters = {"category_id": str(category_id)} if category_id is not None else {}
        return await page(
            "/topics",
            limit,
            offset,
            lambda item: fields(item, "id name active category_id"),
            active_only="true",
            **filters,
        )

    @server.tool(annotations=READ_ONLY)
    async def list_topic_sources(topic_id: UUID, limit: Limit = 10, offset: Offset = 0) -> Page:
        """List the topic's eligible bindings and pinned source and profile versions."""
        return await page(
            f"/topics/{topic_id}/bindings",
            limit,
            offset,
            lambda item: fields(
                item, "id topic_id source_id source_name profile_version_id profile_version eligible"
            ),
            eligible_only="true",
            missing="Topic",
        )

    @server.tool(annotations=READ_ONLY)
    async def get_collection_status(request_id: UUID) -> Row:
        """Read an existing request's status and child jobs, including partial or failed outcomes."""
        request = row(await get(f"/collection-requests/{request_id}", missing="Collection request"))
        result = fields(
            request, "id topic_id topic_name keyword status created_at finished_at refresh_of"
        )
        result["jobs"] = [
            {
                **fields(child, "binding_id source_name profile_version"),
                "job": fields(row(child.get("job")), "job_id status source_id profile_version_id"),
            }
            for child in rows(request.get("jobs"))
        ]
        return result

    @server.tool(annotations=READ_ONLY)
    async def get_collection_records(
        request_id: UUID, limit: Limit = 10, offset: Offset = 0
    ) -> RecordPage:
        """Page through accepted records for one request, with bounded collected source data."""
        # This REST route already returns 404 when the requested parent does not exist.
        result = await page(
            "/records",
            limit,
            offset,
            record_preview,
            request_id=str(request_id),
            missing="Collection request",
        )
        return RecordPage(request_id=request_id, **result.model_dump())

    @server.tool(annotations=READ_ONLY)
    async def get_record_lineage(record_id: UUID) -> Row:
        """Trace a record to its job, source, profile version, and evidence reference."""
        record = await get(f"/records/{record_id}", include_lineage="true", missing="Record")
        return record_links(row(record))

    @server.tool(annotations=READ_ONLY)
    async def get_evidence_metadata(evidence_id: UUID) -> Row:
        """Read public capture metadata and its stored SHA-256 digest."""
        evidence = row(await get(f"/evidence/{evidence_id}", missing="Evidence"))
        return fields(
            evidence,
            "evidence_id job_id source_id profile_version_id config_hash run_id page_number "
            "capture_kind captured_at content_hash content_type adapter_type http_status",
        )

    return server


def main() -> None:
    try:
        server = create_server(os.environ.get("FYP_MCP_API_BASE", ""))
    except ValueError as error:
        print(error, file=sys.stderr)
        raise SystemExit(2) from None
    server.run(transport="stdio")


if __name__ == "__main__":
    main()
