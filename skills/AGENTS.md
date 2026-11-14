# Final Year Project development instructions

## Project and architecture

- Build the Adaptive Scalable and Observable Web Data Collection Platform. The reusable Core manages approved sources, web collection and controlled CSV imports, jobs, record validation and deduplication, raw evidence and provenance, execution events, REST APIs, and operational monitoring.
- Use a modular monolith with React and TypeScript, Python with FastAPI and Pydantic, PostgreSQL for durable state, Redis as the Celery broker, separate Celery worker processes, and Docker Compose. Keep development practical on Windows 11 with about 8 GB RAM and a near-zero budget. The platform must run without an external LLM.
- Celery distributes work. The Core owns job state, retry policy, and shared request limits. Scrapling fetches and parses permitted web content and supersedes the earlier HTTPX and Beautiful Soup collection direction. A second scheduler, including Scrapling Spider scheduling, requires an approved architecture decision record (ADR).
- Keep application logic behind module boundaries and use documented Core interfaces. IA KOL Discovery and Matching is the main FYP application. Its platforms, sources, campaign inputs, matching criteria, and acceptance criteria are pending. E-commerce Sentiment Analysis is the first planned application and supports the ITP4524 group assignment. Keep model training, comparison, and selected-model integration in that application.

## Source access and data integrity

- Collect from approved public sources and controlled test sites. Follow source access restrictions, robots rules, and configured request limits. Validate HTTP(S) destinations, including DNS resolution, redirects, and discovered URLs. Block private, loopback, link-local, and other unsafe destinations for public sources. Scope controlled test-site access to the test environment.
- Stop on explicit blocking. Do not bypass CAPTCHA, authentication, paywalls, or other access restrictions. Keep credentials out of logs and version control.
- Preserve traceability from each record to its source and configuration version, job or import run, collection time, and raw evidence reference. Retain the evidence hash and validation or failure reasons where applicable. For CSV, preserve the dataset identity and row reference.

## Working conventions

- Inspect the current code, contracts, tests, and applicable instructions before editing. Use the [project scope](../PRODUCT.md), [contracts](../docs/contracts/), and [architecture decisions](../docs/decisions/) for milestone context. Treat proposed schemas, routes, milestones, and described prototypes as planning evidence until verified against the checkout.
- Keep changes small. Reuse shared types, policies, and components. Prefer clear functions and justified dependencies. Follow existing Python formatting and linting conventions, and use type hints where helpful. Use pytest for Python tests and consider Ruff if linting is undecided. In TypeScript, prefer strict typing and follow existing ESLint and Prettier rules. Avoid unnecessary `any`. Write short English comments for decisions that need explanation.
- Keep API contracts and documentation aligned. Use migrations for schema changes. Update affected usage and test commands, and explain trade-offs, assumptions, and limitations in language the team can explain during evaluation.
- Cover changed behavior and relevant failure paths. Run the available relevant tests, using deterministic fixtures and controlled integration targets. Report actual commands, results, and skipped or unavailable checks. Keep generated runtime data out of version control.

## Ownership and changes

- Member A coordinates backend and job orchestration. Member B coordinates Scrapling, extraction, adapters, and the controlled site. Member C coordinates React, UI/UX, records presentation, and dashboard integration. Everyone can contribute across areas and shares architecture review, integration testing, code review, documentation, and evaluation.
- Use short-lived feature or fix branches and small pull requests. Give major changes one primary owner and at least one other team member as reviewer. Describe the scope, affected contracts, verification, limitations, and screenshots for visual changes. Coordinate changes to shared interfaces with affected owners.
- Obtain team agreement for major changes to architecture, stack, data access policy, public sources, proxy behavior, external or paid services, LLM use, or approved scope and acceptance criteria. Record architectural decisions in `docs/decisions/` with context, decision, alternatives, consequences, date, and approval. Continue independent work within the approved task scope while a decision is pending.
