---
name: fyp-source-adapter
description: "Use when creating or modifying Scrapling source adapters, fetching or parsing rules, configurable extraction, source pagination, or extraction tests, and when diagnosing extraction failures in the FYP platform."
---

# FYP Source Adapter

## Establish the contract

- Find the adapter interface, approved Source Configuration and version, expected output schema, shared ingestion contract, source access restrictions, and relevant tests. Reuse Core URL, request-policy, validation, identity, and evidence utilities. Prefer configuring an existing adapter when the source fits its contract.
- If the contract is missing, read the [collection core contract](../../../../docs/contracts/M1-collection-core.md). Treat its selectors and field rules as examples. Identify gaps with the Core owner and mark proposed interfaces as provisional. Use fixtures while source access approval is pending.

## Collect and extract

- Keep source navigation and parsing inside the adapter or its configuration. Use Scrapling selectors for HTML extraction, Scrapling's Fetcher for controlled HTTP fixtures, and the Core's vetted-address HTTPS transport for public sources. Apply the Core request and retry policy to initial URLs, redirects, and discovered links. Enforce source approval, robots rules, request limits, destination validation, timeouts, and explicit block handling.
- Use configured item and field selectors, required-field rules, typed normalization, and text or attribute extraction as supported. Resolve relative links and recheck the policy before following them. Bound pagination and stop on loops, end markers, blocking, or access violations.
- Preserve field failures with reasons through the shared validation or quarantine flow. Verify match counts, completeness, and types when HTML changes or adaptive selectors match new elements. Quarantine suspect results or report the extraction failure.
- Return records and failure details through shared ingestion. Use the defined deduplication identity and preserve source URL, retrieval time, job or run ID, raw evidence reference and hash, and configuration version. Keep downstream application logic, application-table writes, and unrelated frontend or orchestration changes outside this workflow.

## Verify and report

Use deterministic HTML fixtures for valid pages, missing required fields, invalid types, changed markup or incorrect adaptive matches, duplicates, pagination limits and loops, and provenance. Use controlled responses or the local test site for timeouts, HTTP errors, explicit blocking, and disallowed URLs. Assert stopping and failure outcomes as well as returned data. Keep live sites out of unit tests.

Report the implementation, files changed, tests run with actual pass or fail results, unverified assumptions, and remaining limitations.
