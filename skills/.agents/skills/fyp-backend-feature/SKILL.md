---
name: fyp-backend-feature
description: "Use when implementing FastAPI endpoints or Pydantic schemas, PostgreSQL models or migrations, data access services, collection jobs, Celery tasks, execution events, or backend error handling for the FYP platform."
---

# FYP Backend Feature

## Trace the affected flow

- Inspect the relevant routes, application services, domain logic, persistence, worker entry points, migrations, and tests. Keep routes focused on transport and validation, services on use cases, domain code on business rules, and persistence on database access. Keep Celery task wrappers thin and independent applications behind documented Core interfaces.
- Follow existing API conventions. If contracts are absent, consult the FastAPI, PostgreSQL, and Celery milestones in the [project scope](../../../../PRODUCT.md) for proposed routes and entities. Use `/api/v1` as the baseline for new versioned API work where no established contract exists. Coordinate shared contract changes with affected owners.

## Change the API, schema, or task flow

- Validate requests and responses with Pydantic. Follow established naming, error envelopes, and status codes. Return safe error messages, preserve actionable details in events or logs, and keep OpenAPI and client contracts accurate.
- Use PostgreSQL for durable data and explicit migrations for schema changes. Respect foreign keys and constraints. Assess existing data before adding required fields or uniqueness. Use defined record identities and database constraints to prevent duplicate final records. Preserve evidence and configuration versions. Use JSONB for flexible payloads where appropriate and typed columns where strong constraints are needed.
- Commit durable job state before publishing work to Redis via Celery. Record dispatch failure and provide a recovery path so jobs cannot silently remain pending. Define valid job and task transitions and protect terminal outcomes against late or repeated deliveries. Design for duplicate execution with idempotent writes. Bound transient retries and record permanent failures. Persist outcomes before acknowledgement where required by the worker contract. Record events with job and task identifiers, attempt, outcome, and safe error details.
- Keep the Core's schemas and services reusable across domains. Keep application-specific logic behind documented interfaces when a downstream use is confirmed. Keep small features within the modular monolith and existing infrastructure.

## Verify and report

Select tests for the affected paths. Cover domain rules with unit tests, contracts with API tests, and constraints and migrations with PostgreSQL tests where relevant. For job changes, exercise the API-to-worker flow as appropriate, including dispatch failure, transient and permanent failures, invalid transitions, redelivery, and idempotency. Verify durable state and event history where the behavior depends on them.

Report architecture impact, schema and migration changes, API and worker changes, verification commands and results, and compatibility risks.
