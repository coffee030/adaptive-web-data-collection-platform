# M1 Collection Core Contracts and Architecture

This document turns the M0 concepts into a controlled Python library. It retains the M0 ADR's modular monolith, Scrapling HTTP and parsing, separate Source and Profile approval, and versioned ingestion. M1 verifies these boundaries with a synchronous `CollectionRunner`. Jobs, Tasks, and durable dispatch were left for later milestones. [M0 conceptual contracts](M0-core-contracts.md) [M0 ADR](../decisions/M0-architecture-decisions.md)

## Sources and Profiles

- `Source` records access authorisation with `source_id`, `adapter_type`, `permission_reference`, and `approval_status`. Web accepts only explicitly listed `http://127.0.0.1:PORT` origins. CSV requires an approved dataset ID and bytes supplied by the caller.
- Both `ExtractionConfiguration` and `CsvMappingConfiguration` specify `config_schema_version="1"` and a `RecordSchema` with `schema_version="1"`. Field names are unique and mapping covers each schema field. Web selector type can be overridden per field, and attribute mode needs the attribute name. The shared schema defines which fields are required.
- `config_hash` is SHA-256 over canonical JSON. Sort JSON keys, field mappings, and schema fields by name. Normalise explicit overrides equivalent to the default selector strategy. Version numbers start at 1 per Source and increase.
- `ProfileRepository` manages Sources, Drafts, latest validation reports, and versions in one process. Editing a Draft clears its prior report. Validation binds Profile Version, config hash, sample location, sample SHA-256, time, counts, and reasons for invalid records.
- Preview returns at most five candidates. Validation uses shared ingestion over the entire bounded sample. Passing requires at least one valid record, zero invalid records, and no read or extraction error. The report retains duplicate counts for manual review.
- `approve()` requires current Source authorisation, the latest passing `report_id`, and an explicit `approver`. Frozen models and tuples preserve approved config, fields, and schema. Retiring retains approval metadata and history. A new Run rechecks Source and Profile status, and HTTP rechecks Source authorisation before each request. In-flight requests may finish.

## Adapters and shared ingestion

HTML uses Scrapling with configured CSS or XPath, repeated items, the first field match, text or attributes, whitespace normalisation, and relative links resolved against the final page URL. URL fields are data. The runner requests approved input URLs and same-origin redirects only. CSV uses the standard `csv` module, UTF-8 including BOM, and comma separation. Mapping produces the same `CandidateRecord` and records each record's physical start line. Width mismatches are classified as invalid rows, while unparseable CSV syntax, empty files, missing required columns, and encoding errors are input failures.

`ingest()` handles string, integer, finite number, and boolean according to the schema. Missing values, type mismatches, undeclared fields, and structural errors carry field or position information. Number uses Python float. Schemas requiring exact decimals were deferred. Deduplication keeps the first valid record within each Run. The key uses Source ID, record type, schema version, identity kind, and normalised value. Without an identity, use canonical payload and a null `source_record_key`. Rerunning the same input keeps `record_id` stable and creates a new `run_id` and `evidence_id`.

## Runner outcomes and Evidence

- `completed` contains valid data and no invalid data, with duplicates counted separately. `partial` contains valid and invalid data. `failed` covers a gate, input, Evidence, or whole-input validation failure.
- `LocalEvidenceStore` uses UUID directories and saves `input.bin` and `metadata.json`. It stages both on the same filesystem before publishing. Evidence must be saved before creating records. HTTP or parsing failures can preserve Evidence when complete bytes are available. Timeout, denied access, and size limits may leave no complete Evidence.
- `GenericRecord → evidence_reference → metadata + input.bin`. Metadata includes Source ID, Run ID, Profile Version ID, configuration hash, UTC capture time, SHA-256, requested and final URLs or dataset ID, and HTML status and content type. A Record has a starting CSV line or one-based HTML item, provenance, and validation status. `LocalEvidenceStore.resolve()` reads the capture and verifies the hash.
- The trusted caller configures the store root. Filesystem Evidence remains readable after reopening locally. The calling process keeps Source, Profile approval, validation reports, run results, and Quarantine state.

## Controlled HTTP boundary

One document, up to two same-origin redirects, a 2-second timeout, and one attempt per request. Both HTML and CSV are capped at 1 MiB and 10,000 items or rows. The transport disables automatic redirects, browser impersonation, stealth headers, and environment proxies and uses the project User-Agent. It checks origin and robots before requesting and stops on HTTP 401 or 403 or an explicit challenge header. HTTP 429, 5xx, and timeouts each have failure outcomes. Scheduling from `Retry-After` was deferred. Robots timing directives, fetch failures, and redirects are rejected, while 404 and 410 indicate the controlled site has no robots file. Public-site DNS, TLS, egress policy, rate limiting, generic block detection, multi-page discovery, and long-term Evidence retention remained for later verification.
