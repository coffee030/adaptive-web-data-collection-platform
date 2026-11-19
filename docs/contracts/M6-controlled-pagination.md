# M6 Controlled HTML Pagination

Create a Draft Profile on an authorised HTML Source. Set **Next-link selector** and **Maximum HTML pages**, then Preview, Validate sample, and Approve. The HTML API `configuration` accepts the following fields.

```json
{
  "pagination": {
    "next_link_selector": "a.next",
    "max_pages": 3
  }
}
```

The selector uses the Profile's CSS or XPath type. A page can have no match or one matching `<a>` with an `href`. No match marks the last page. The limit is 1 to 5 pages including the starting page. Omitting `pagination` keeps single-page HTML collection and the existing Profile configuration SHA-256. CSV retains dataset and row locations. Preview and Validate use the submitted single-page sample. Validate also checks the next link's shape and destination.

The backend resolves relative links against the final response URL. The attempt's visited set records every requested document URL, including redirect hops. It normalises fragments, empty paths, and equivalent percent encodings for duplicate detection. Next links and redirects are same-origin and subject to Source allowlist, robots, and authorisation checks. M6 remains limited to literal loopback and the opt-in Compose fixture. Each page allows at most 1 robots request and 3 document requests including 2 redirects, each with a 2-second timeout. Five pages allow at most 20 HTTP requests. Celery's hard limit is 60 seconds and the PostgreSQL lease is 90 seconds.

## Job outcomes

| Condition | Outcome |
| --- | --- |
| Traversal ends with valid records and no field validation failures | `succeeded`, with duplicates counted separately |
| Some valid records and some invalid candidates or an interrupted traversal | `partial`, retaining `error` for a traversal failure |
| No valid records | `failed`, retaining captured Evidence, Quarantine, and applicable errors |
| Retryable transient error and attempt budget remains | `pending`. Retry starts at the first page according to the existing 429, 5xx, timeout, connection, and `Retry-After` policy. |

A next link at the page limit sets `page_limit_reached`. A repeated document URL sets `pagination_loop`. Invalid next links, selectors, or redirects stop traversal. A received failure response such as 429 or 503 can be retained as Evidence. A timeout without a response has no Evidence for that page. Job-level Record deduplication keeps the first valid identity. Quarantine HTML item indexes start at 1 on each page.

The terminal attempt publishes Evidence, Records, Quarantine, counts, and its terminal event in one PostgreSQL transaction. Dispatcher initiates bounded recovery if the worker stops or its lease expires. An expired attempt or redelivered message cannot republish a completed Job. Raw bytes and sidecars are published first via directory rename on one filesystem. Files and hashes are then checked before SQL writes. Superseded attempts, hard termination, and SQL rollback may leave directories without database references. Compare database Evidence IDs with volume contents after stopping writers.

## API and data upgrade

- `GET /api/v1/collection-jobs/{job_id}/evidence` retains its first Evidence object or `null` contract.
- `GET /api/v1/collection-jobs/{job_id}/evidence-pages` returns committed Evidence by `page_number` or `[]` for an existing Job without published Evidence.
- `GET /api/v1/evidence/{evidence_id}` and the Job Evidence object include `page_number`. Records and Quarantine retain `evidence_reference`. Quarantine orders by page, candidate position, and ID.
- Stop API, worker, and Dispatcher. Run `python -m alembic upgrade head` on the new version and verify `python -m alembic current --check-heads` shows `0007 (head)` before restarting. `0007` assigns earlier Evidence to page 1 and preserves UUIDs, hashes, URLs, Profile pins, raw files, and links.
- `0007 → 0006` applies only to data that satisfies the previous uniqueness restriction. With multi-page Evidence, PostgreSQL rolls back the downgrade while rebuilding that constraint. To restore M5.5, use database and Evidence volume backups from before enabling multi-page configuration.

## Controlled fixture

Use `compose.fixture.yaml` and register authorised origin `http://collection-fixture:8001`. Set the Draft to CSS with item selector `article`. Map required string `title` from `h2` and choose `title` as identity. Use `a.next` as the next link and cap the crawl at 3 pages. Use `/pagination/1` for both sample and Job document paths. Expect `partial`, 3 Evidence pages, 3 valid Records, 2 Quarantine entries, and 1 duplicate. Both Quarantine entries point to item 2 on their respective pages and link to page 2 and page 3 Evidence.
