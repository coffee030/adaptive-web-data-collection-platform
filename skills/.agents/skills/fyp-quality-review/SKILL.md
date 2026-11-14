---
name: fyp-quality-review
description: "Use when explicitly asked to review FYP code or a pull request for architecture, regressions, testing completeness, MVP compliance, or merge readiness."
---

# FYP Quality Review

## Establish the review scope

- Inspect the actual diff, base behavior, relevant contracts, and tests. Read the relevant [contracts](../../../../docs/contracts/) and [approved ADRs](../../../../docs/decisions/). Use current confirmed decisions when documents conflict.
- Tie findings to approved scope and available evidence. Distinguish work due in the current MVP from deferred work, pending requirements, and unverified prototype claims. Apply this workflow to requested reviews.

## Review the affected paths

- Check modular monolith boundaries, Core and application dependencies, Scrapling and Celery responsibilities, database consistency, API and schema compatibility, and undocumented architecture changes. Flag dependencies and complexity when they carry a concrete cost.
- Look for unclear responsibilities, names or types, duplicated rules, fragile error handling, and complexity that makes changes harder to test or maintain. Prefer fixes that fit the team and codebase.
- Trace source approval and URL validation through DNS, redirects, and pagination where applicable. Check SSRF exposure, secrets, input validation, duplicate prevention, evidence and provenance, job transitions, and failure handling.
- Run relevant available tests when possible. Check whether tests exercise changed behavior and failure cases and whether mocks hide missing integration. Distinguish previously reported results from tests executed during the review.

## Deliver the review

Lead with findings in severity order. For each meaningful finding give a verified file and location, the triggering condition and impact, a recommended correction, and the supporting requirement, contract, or other evidence.

- **Critical** Security compromise, data loss, or broken fundamental behavior.
- **High** Significant correctness, architecture, or integration issues.
- **Medium** Maintainability risks, incomplete coverage, or inconsistent contracts.
- **Low** Minor style or documentation improvements.

Finish with the scope reviewed, commands and actual results, checks not run and why, remaining risks, and a merge readiness recommendation tied to evidence. If there are no findings, state that and explain any verification gaps that limit the merge decision.
