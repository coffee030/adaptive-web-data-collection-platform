# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary users are authorised collection operators who create and approve source configurations, run controlled collections, and investigate issues. Maintainers trace results through Jobs, Profile Versions, Records, and Evidence. The FYP team demonstrates and evaluates the system with reproducible local workflows.

## Product Purpose

The Adaptive Scalable and Observable Web Data Collection Platform turns permitted HTML and CSV inputs into validated, traceable structured records. Its reusable Core manages source access, profile approval, collection jobs, validation, evidence and exports for downstream applications. Operators can see the source, configuration version, and evidence used for a run, as well as partial success and failure. [System overview](docs/architecture/System-Overview.md)

## Operating Context

- Manage Source access authorisation separately from Profile Version approval for extraction. The Profile workflow is Draft → Preview → Validate → Approve. Approval requires an explicit action.
- Each Job is pinned to a specific Profile Version. Use execution events, valid records, quarantine, and Evidence Metadata to investigate issues.
- The console provides Overview, New Collection, Sources, Collection Jobs, and Data Explorer. The API and verified execution evidence determine the status shown.

## Stack

The React and TypeScript frontend works with FastAPI, Pydantic, SQLAlchemy, Alembic, PostgreSQL, Scrapling, Redis, and Celery. The team develops on Windows 11 with a near-zero budget. The frontend provides local font fallbacks.

## Capabilities and Constraints

- The Core provides APIs for Sources and Profiles, Jobs, Records, quarantine, and Evidence Metadata. The Dispatcher sends Jobs to Celery workers.
- The Core runs in trusted local mode. Approved Profiles can search static HTML by keyword and extract details from registered and authorised public HTTPS origins. Controlled HTTP fixtures and authorised CSV datasets remain available. The approval operator field supports local audits. [M7 Controlled Website Collection](docs/contracts/M7-controlled-website-collection.md)
- PostgreSQL stores metadata and lineage. Local storage holds the raw evidence files. The UI shows available metadata and offers actions supported by the implemented API.
- The downstream industry application remains open. KOL discovery is one possible use if industry requirements are confirmed. ITP4524 coursework is outside the FYP scope.

## Evidence on Hand

- [M1 Collection Core contracts](docs/contracts/M1-collection-core.md)
- [M2 REST API contracts](docs/contracts/M2-api-contracts.md)
- [M2 persistence architecture](docs/architecture/M2-persistence-architecture.md)
- [M2 verification and outstanding checks](docs/experiments/M2-readiness-review.md)

## Product Principles

- Show the access policy, approved version, and source evidence wherever operators need them to make a decision.
- Preserve partial success, failure, unknown, and unavailable states. Offer actions when the implemented API supports them.
- Use clear status names, easy-to-scan tables, and predictable keyboard controls.
