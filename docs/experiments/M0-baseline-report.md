# M0 Repository Baseline and Prototype Verification

The inventory ran on 2026-11-14 Hong Kong time. It covered the user-specified FYP workspace and the new `Adaptive-Web-Data-Collection-Platform/` project root.

| Item | Inventory result |
| --- | --- |
| Workspace baseline | The original working directory contained only `docs/design-system/dashboard-guidance.md`, `skills/`, and three FYP or course references. `git status` reported `not a git repository`. Existing branches, Git diff, and remotes were unavailable from that directory. |
| Source, tests, and deployment | The original workspace had no runnable backend or frontend, dependency lists, tests, fixtures, Compose, or `.github/workflows/`. The new root's `backend/` was this spike. |
| Instructions | `skills/AGENTS.md` applied within `skills/`. `skills/.agents/skills/` provided `fyp-backend-feature`, `fyp-frontend-design`, `fyp-source-adapter`, and `fyp-quality-review`. This spike applied the last two for controlled fixtures, access policy, and verification. |

## Documents and decision evidence

- **Confirmed.** Modular monolith with independent Celery workers. Scrapling handles HTTP and parsing, and the Core owns access policy and Jobs. Profiles require validation and manual approval before Jobs can use them.
- **Formal Proposal.** FR01–FR15, NFRs, schedule, and assessment criteria. The ADR explains the Scrapling direction and the effects of deferred features. [Architecture decisions](../decisions/M0-architecture-decisions.md)
- **Recommended.** Reuse acceptance cases for controlled pagination, evidence hash, robots rules, and failure handling. Dashboard guidance is a design proposal for later milestones.
- **Pending.** Confirm IA source permission, platforms, matching criteria, outputs, and acceptance, and whether the Proposal's technical description needs revision.

## Prototype evidence

The teammate brief named `web_scraping_public_demo` and described HTTPX fetching, Beautiful Soup pagination, controlled sites, raw HTML, metadata and hashes, a CLI, and saved results. The designated workspace did not contain the expected `web_scraping_public_demo/` source, `web_scraping_public_demo.zip`, tests, or dependency locks. Existing prototype tests were **BLOCKED** and reported results remained **unverified prototype claims**. The spike results came from a new experiment. [Spike results](M0-scrapling-spike.md)

Reusable design ideas include fixture ground truth, page budgets, loop prevention, raw Evidence, and failure classification. HTTPX and Beautiful Soup reflect the older direction. Assess reusable policy or fixtures after obtaining authorised source access.
