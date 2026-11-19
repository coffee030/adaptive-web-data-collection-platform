# M1 Local Issue Manifest

The baseline was `a85f5de` and the new branch was `feature/M1-generic-collection-core`. Git had no remote. GitHub Issues, Project, and PR were pending remote setup.

| Issue | Deliverable and acceptance checks | Local progress |
| --- | --- | --- |
| M1-01 Versioned Source and Profile Contracts | Pydantic contracts, version and enum rejection tests, canonical hash tests | Batch A passed |
| M1-02 Source Profile Lifecycle | Draft editing, validation snapshot, explicit approval, retirement, and immutability | Batch A unit tests passed. Live preview and validation were wired in Batch D. |
| M1-03 Configurable Scrapling Extraction | Shared CSS and XPath extractor, covering missing matches, invalid selectors, and relative URLs | Batch B passed |
| M1-04 CSV Import Adapter | UTF-8, column mapping, size limit, invalid rows, and row positions | Batch B passed |
| M1-05 Shared Validation and Deduplication | Typed payload, error reasons, within-run deduplication, and identity fallback | Batch C passed |
| M1-06 Evidence and Provenance | Raw bytes, hash, access and integrity, and protection against overwriting across runs | Batch C passed |
| M1-07 Controlled Collection Runner | Authorisation gate, controlled HTTP, CSV, and structured run failures | Batch D passed |
| M1-08 End-to-End Testing and M2 Readiness | M0 regression, M1 end-to-end tests, Ruff, documentation, and readiness | Batch E passed. [Readiness](M1-readiness-review.md) |
