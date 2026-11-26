"""Access FYP topic collections through a fixed local REST API over MCP stdio."""

import asyncio
import json
import os
import re
import sys
from collections.abc import Callable
from typing import Annotated, Literal
from uuid import UUID, uuid4

import httpx2
from mcp.server import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.types import CallToolResult, TextContent, ToolAnnotations
from pydantic import (
    AfterValidator,
    BaseModel,
    Field,
    JsonValue,
    StringConstraints,
    ValidationError,
)

from backend.core.contracts import Name

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
PREPARE = ToolAnnotations(
    readOnlyHint=True, destructiveHint=False, idempotentHint=False, openWorldHint=False
)
START = ToolAnnotations(
    readOnlyHint=False,
    destructiveHint=False,
    idempotentHint=True,
    openWorldHint=True,
)
JOB_ERRORS = {
    "http_error": "The source returned an HTTP error.",
    "timeout": "The source request timed out.",
    "transport_error": "The source request failed.",
    "source_not_approved": "The source is no longer approved for collection.",
}
SUBMISSION_ERRORS = {
    "invalid_request": "Check the collection arguments.",
    "topic_not_found": "Choose an existing topic.",
    "topic_inactive": "Choose an active topic and category.",
    "binding_ineligible": "One or more selected bindings are unavailable.",
    "source_not_approved": "A selected source is no longer approved.",
    "profile_not_approved": "A selected profile version is no longer approved.",
    "profile_not_found": "A selected profile version is unavailable.",
    "binding_requires_search": "A selected profile does not support keyword collection.",
    "destination_denied": "A selected source destination is disallowed.",
    "collection_request_conflict": "The key already belongs to a different collection intent.",
}


def printable_keyword(value: str) -> str:
    if not value.isprintable():
        raise ValueError("Keyword must contain only printable characters")
    return value


def distinct_bindings(value: list[UUID]) -> list[UUID]:
    if len(value) != len(set(value)):
        raise ValueError("Select distinct bindings")
    return value


# Match NewRequest's shape without importing the database-backed application layer.
Keyword = Annotated[Name, AfterValidator(printable_keyword)]
BindingIds = Annotated[
    list[UUID], Field(min_length=1, max_length=4), AfterValidator(distinct_bindings)
]
Status = Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_]{0,63}$")]


class Submission(BaseModel):
    request_key: UUID
    topic_id: UUID
    keyword: Keyword
    binding_ids: BindingIds


class PreparedCollection(BaseModel):
    submitted: Literal[False] = False
    submission: Submission


class ReceiptJob(BaseModel):
    binding_id: UUID
    job_id: UUID
    status: Status


class Receipt(BaseModel):
    request_key: UUID
    request_id: UUID
    outcome: Literal["created", "replayed"]
    http_status: Literal[200, 201]
    status: Status
    jobs: list[ReceiptJob]


class SubmissionFailure(BaseModel):
    request_key: UUID
    outcome: Literal["unknown", "rejected", "conflict"]
    code: str
    http_status: int | None = None
    retry_same_key: bool = False
    message: str


def submission_result(value: Receipt | SubmissionFailure) -> CallToolResult:
    return CallToolResult(
        is_error=isinstance(value, SubmissionFailure),
        structured_content=value.model_dump(mode="json"),
        content=[TextContent(type="text", text=value.model_dump_json())],
    )


def unknown_submission(key: UUID, status: int | None = None) -> SubmissionFailure:
    return SubmissionFailure(
        request_key=key,
        outcome="unknown",
        code="submission_outcome_unknown",
        http_status=status,
        retry_same_key=True,
        message=(
            "Retry start_collection with this key and the same arguments. "
            "If the key was lost, check existing collection request history."
        ),
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
    match = re.fullmatch(
        r"http://(?:127\.0\.0\.1|\[::1\]):([0-9]{1,5})/api/v1/?", value
    )
    if not match or not 1 <= int(match[1]) <= 65535:
        raise ValueError(
            "Set FYP_MCP_API_BASE to http://127.0.0.1:<API port>/api/v1 "
            "or the equivalent [::1] loopback URL."
        )
    return value.rstrip("/")


def rest_client() -> httpx2.AsyncClient:
    pilot_token = os.environ.get("FYP_MCP_OPERATOR_TOKEN")
    return httpx2.AsyncClient(
        trust_env=False,
        follow_redirects=False,
        timeout=TIMEOUT_SECONDS,
        headers={"Authorization": f"Bearer {pilot_token}"} if pilot_token else None,
    )


async def response_json(response: httpx2.Response):
    body = bytearray()
    async for chunk in response.aiter_raw(chunk_size=64 * 1024):
        if len(body) + len(chunk) > MAX_RESPONSE_BYTES:
            raise ToolError("FYP API response exceeds 2 MiB. Try a smaller page.")
        body.extend(chunk)
    return json.loads(body)


async def read_json(url: str, params: dict, missing: str | None):
    async with rest_client() as client:
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

            return await response_json(response)


async def post_collection(
    base: str, submission: Submission
) -> Receipt | SubmissionFailure:
    key = submission.request_key
    async with rest_client() as client:
        async with client.stream(
            "POST",
            base + "/collection-requests",
            json=submission.model_dump(mode="json"),
            headers={"Accept-Encoding": "identity"},
        ) as response:
            status = response.status_code
            has_receipt = status in (200, 201)
            rejected = 400 <= status < 500 and status != 408
            if not (has_receipt or rejected):
                return unknown_submission(key, status)

            try:
                payload = row(await response_json(response))
            except (ToolError, httpx2.RequestError, ValueError, RecursionError):
                payload = {}

            if has_receipt:
                try:
                    jobs = [
                        ReceiptJob(
                            binding_id=child.get("binding_id"),
                            **fields(row(child.get("job")), "job_id status"),
                        )
                        for child in rows(payload.get("jobs"))
                    ]
                    if (
                        len(jobs) != len(submission.binding_ids)
                        or {job.binding_id for job in jobs}
                        != set(submission.binding_ids)
                        or len({job.job_id for job in jobs}) != len(jobs)
                    ):
                        return unknown_submission(key, status)
                    return Receipt(
                        request_key=key,
                        request_id=payload.get("id"),
                        outcome="created" if status == 201 else "replayed",
                        http_status=status,
                        status=payload.get("status"),
                        jobs=jobs,
                    )
                except (ToolError, ValidationError):
                    return unknown_submission(key, status)

            error = payload.get("error")
            code = error.get("code") if isinstance(error, dict) else None
            if not isinstance(code, str) or code not in SUBMISSION_ERRORS:
                code = "submission_rejected"
            conflict = status == 409 and code == "collection_request_conflict"
            return SubmissionFailure(
                request_key=key,
                outcome="conflict" if conflict else "rejected",
                code=code,
                http_status=status,
                message=SUBMISSION_ERRORS.get(
                    code, "The FYP API rejected the collection."
                ),
            )


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


def public_job(value: JsonValue) -> Row:
    job = row(value)
    result = fields(job, "job_id status source_id profile_version_id")
    for name in (
        "valid_count",
        "invalid_count",
        "duplicate_count",
        "execution_attempt",
    ):
        count = job.get(name)
        result[name] = count if type(count) is int and count >= 0 else None
    retry_at = job.get("next_attempt_at")
    result["next_attempt_at"] = (
        retry_at
        if isinstance(retry_at, str) and re.fullmatch(r"[0-9T:Z+.-]{1,40}", retry_at)
        else None
    )
    error = job.get("error")
    result["error"] = None
    if isinstance(error, dict):
        code = error.get("code")
        if not isinstance(code, str) or not re.fullmatch(r"[a-z][a-z0-9_]{0,63}", code):
            code = None
        status = error.get("http_status")
        result["error"] = {
            "code": code,
            "http_status": status
            if type(status) is int and 100 <= status <= 599
            else None,
            "summary": JOB_ERRORS.get(
                code, "See the Dashboard execution events for this job."
            ),
        }
    return result


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
    server = MCPServer("FYP topic collections", log_level="WARNING")

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

    if os.environ.get("FYP_MCP_OPERATOR_TOKEN"):

        @server.tool(annotations=READ_ONLY)
        async def inspect_collection_queue(
            status: Literal["pending", "running", "succeeded", "partial", "failed"]
            | None = None,
            limit: Limit = 10,
            offset: Offset = 0,
        ) -> Page:
            """List recent Core collection jobs, accepted and invalid record counts, attempts, and bounded recovery reasons."""
            return await page(
                "/collection-jobs",
                limit,
                offset,
                public_job,
                **({"status": status} if status else {}),
                order="newest",
            )

        @server.tool(annotations=READ_ONLY)
        async def collection_execution_events(
            job_id: UUID, limit: Limit = 10, offset: Offset = 0
        ) -> Page:
            """Inspect the execution timeline of a job using worker identities, attempt numbers, status and error codes."""
            events = rows(
                await get(f"/collection-jobs/{job_id}/events", missing="Collection job")
            )
            items = []
            for event in events[offset : offset + limit]:
                items.append(
                    {
                        **fields(
                            event,
                            "event_id job_id status occurred_at kind execution_attempt worker_instance_id execution_origin",
                        ),
                        "error_code": event["error"].get("code")
                        if isinstance(event.get("error"), dict)
                        else None,
                    }
                )
            more = offset + limit < len(events)
            return Page(
                items=items,
                limit=limit,
                offset=offset,
                has_more=more,
                next_offset=offset + limit if more else None,
            )

        @server.tool(annotations=READ_ONLY)
        async def get_operations_pulse(window: Literal["24h", "7d"] = "24h") -> Row:
            """Read measured throughput, worker activity, completion latency, failures and record quality for the selected time window."""
            return row(await get("/operations/pulse", window=window))

        @server.tool(annotations=READ_ONLY)
        async def inspect_market_publications() -> Row:
            """Inspect authorized market source licenses, publication state, refresh timing and Core collection receipts."""
            result = await get("/marketing/intelligence/operator/market/sources")
            return {"sources": result} if isinstance(result, list) else row(result)

        @server.tool(annotations=READ_ONLY)
        async def inspect_public_research_feed(
            feed: Literal["public-directory", "public-works"],
        ) -> Row:
            """Inspect a public research publication's most recent Core job receipt, accepted rows, freshness and next check."""
            return row(await get(f"/marketing/intelligence/operator/{feed}/status"))

        @server.tool(
            annotations=ToolAnnotations(
                readOnlyHint=False,
                destructiveHint=False,
                idempotentHint=True,
                openWorldHint=True,
            )
        )
        async def refresh_market_publication(
            key: Annotated[str, Field(pattern=r"^[a-zA-Z0-9_.-]{1,80}$")],
        ) -> Row:
            """Request a refresh of a specifically approved market source. Respect its eligibility, due time and backoff."""
            try:
                async with (
                    rest_client() as client,
                    client.stream(
                        "POST",
                        f"{base}/marketing/intelligence/operator/market/sources/{key}/refresh",
                        headers={"Accept-Encoding": "identity"},
                    ) as response,
                ):
                    if response.status_code not in (200, 202):
                        raise ToolError(
                            f"Harbourline rejected the refresh (HTTP {response.status_code})."
                        )
                    return row(await response_json(response))
            except (httpx2.RequestError, TimeoutError):
                raise ToolError(
                    "Inspect the current source status before retrying this refresh."
                ) from None

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
    async def list_topic_sources(
        topic_id: UUID, limit: Limit = 10, offset: Offset = 0
    ) -> Page:
        """List the topic's eligible bindings and pinned source and profile versions."""
        return await page(
            f"/topics/{topic_id}/bindings",
            limit,
            offset,
            lambda item: fields(
                item,
                "id topic_id source_id source_name profile_version_id profile_version eligible",
            ),
            eligible_only="true",
            missing="Topic",
        )

    @server.tool(annotations=PREPARE)
    async def prepare_collection(
        topic_id: UUID, keyword: Keyword, binding_ids: BindingIds
    ) -> PreparedCollection:
        """Prepare arguments and a fresh retry key for a requested collection. Submits nothing."""
        return PreparedCollection(
            submission=Submission(
                request_key=uuid4(),
                topic_id=topic_id,
                keyword=keyword,
                binding_ids=binding_ids,
            )
        )

    @server.tool(annotations=START)
    async def start_collection(
        request_key: UUID, topic_id: UUID, keyword: Keyword, binding_ids: BindingIds
    ) -> Annotated[CallToolResult, Receipt]:
        """Submit a collection only when the user asked to run it. To inspect sources, use the read tools.

        Save the prepared key and arguments before calling. After an unknown outcome, replay the
        same key and intent. Poll get_collection_status with the receipt's request_id.
        """
        submission = Submission(
            request_key=request_key,
            topic_id=topic_id,
            keyword=keyword,
            binding_ids=binding_ids,
        )
        try:
            result = await asyncio.wait_for(
                post_collection(base, submission), TIMEOUT_SECONDS
            )
        except (httpx2.RequestError, TimeoutError):
            result = unknown_submission(request_key)
        return submission_result(result)

    @server.tool(annotations=READ_ONLY)
    async def get_collection_status(request_id: UUID) -> Row:
        """Read an existing request's status and child jobs, including partial or failed outcomes."""
        request = row(
            await get(
                f"/collection-requests/{request_id}", missing="Collection request"
            )
        )
        result = fields(
            request,
            "id topic_id topic_name keyword status created_at finished_at refresh_of",
        )
        result["jobs"] = [
            {
                **fields(child, "binding_id source_name profile_version"),
                "job": public_job(child.get("job")),
            }
            for child in rows(request.get("jobs"))
        ]
        return result

    @server.tool(annotations=READ_ONLY)
    async def get_collection_records(
        request_id: UUID, limit: Limit = 10, offset: Offset = 0
    ) -> RecordPage:
        """Page through accepted records for one request, with bounded collected source data."""
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
        record = await get(
            f"/records/{record_id}", include_lineage="true", missing="Record"
        )
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
