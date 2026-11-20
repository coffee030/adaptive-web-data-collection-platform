# FYP follow-up plan after M17

Planning baseline: accepted GitHub PR #6, merged into main at `1b1ed19fe03670dac57a6006d3b1a5be149700b0`. This document proposes the next milestones. Its source candidates and acceptance checks are planning inputs. M17 already demonstrated a real Codex host using controlled fixture sources. Preserve that repeatable demonstration alongside the live website evaluation.

## M18A. Establish which public sources the current Core can collect

**Decision to make.** Can three independent external HTTPS origins be supported by approved profiles, with at least two supplying comparable records for one meaningful topic? The existing public HTTPS workflow expects a configured keyword search, a results page and detail links. The same keyword is passed to each selected binding. A reachable article alone does not demonstrate this contract.

Start with a provisional topic such as **UK economic publications**, a shared keyword such as **inflation**, and a modest record containing publication title, canonical source URL and publication date where available. Assess the House of Commons Library, the Office for National Statistics and the Institute for Fiscal Studies. The Bank of England and GOV.UK search paths were ruled out during initial screening. Their published material overlaps, but the search endpoints, permitted access and profile compatibility still need checking. The pages below establish topic fit or the presence of a search interface.

| Publisher | Initial evidence |
| --- | --- |
| House of Commons Library | [UK inflation briefing](https://commonslibrary.parliament.uk/research-briefings/sn02792/) |
| Office for National Statistics | [Consumer price inflation bulletin](https://www.ons.gov.uk/economy/inflationandpriceindices/bulletins/consumerpriceinflation/july2026) |
| Institute for Fiscal Studies | [Publisher search and publication categories](https://ifs.org.uk/search) |

**Initial screening on 20 November 2026.** The Commons Library exposes [a search form](https://commonslibrary.parliament.uk/search/?s=), and both the Commons Library and ONS publish relevant HTML detail pages. IFS exposes a search page covering consumption and prices. The research environment could not retrieve the robots files for these three origins. Their policies, search responses and suitability for live Core collection remain unverified. The [Bank of England robots policy](https://www.bankofengland.co.uk/robots.txt) disallows `/search` for the wildcard agent. The [GOV.UK robots policy](https://www.gov.uk/robots.txt) disallows `/search/all*`. Exclude those search routes. Neither existing M10 candidate, FTC or New York Fed, counts as a success. No external source was authorised in this screening. This session could not reach the local Docker Engine or Demo API and recorded zero end-to-end source successes.

1. For each candidate, record its HTTPS origin, purpose, published access and reuse conditions, robots rules for the actual search and detail paths, attribution and allowed request budget. Stop on explicit blocking. Keep one short reason for each rejected candidate and evaluate a substitute.
2. Check the public search with the shared keyword. Inspect the HTML the Core receives. Verify result-to-detail links, redirects, approved origins, stable IDs, field mappings and whether pagination is supported. Record any required fields the site does not publish.
3. Use the existing operator workflow in an isolated environment. Register and explicitly authorise the Source, then create the Draft Profile and run Preview and Validate against a small live sample. Record the approved profile version separately when approval is given. Capture actual commands, dates, response outcomes and field examples. A page opened in a browser is insufficient evidence.
4. Produce one English source feasibility table. Assign each candidate an outcome: compatible with the present Core, requires a specific generic capability, or unsuitable. Where possible, prove one compatible source by completing a small Job and following one accepted Record to Evidence.
5. Exit with a named pair for a shared Topic and a third independent origin, or a specific documented capability gap plus the smallest testable proposal. Record provisional sources as provisional. If the three-source target is already achievable, proceed to M18B without adding a collection mode.

**Scope.** Keep the formal FYP title. UK economic publications are a demonstration topic. M18A does not settle the IA business application. Do not introduce hostname-specific parsers, represent a fixed listing as keyword search, or relax approvals to get a passing demonstration.

## M18B. Prove the reuse claim on live data

Use the proven configurations. If M18A identifies a necessary generic change, isolate it in a small reviewed change first. For example, an approved fixed listing would require explicit entry semantics and honest UI and MCP descriptions wherever a keyword currently appears mandatory. Preserve existing search profiles, eligibility checks, request replay and evidence capture.

- Complete one bounded collection on each of three independent real origins. Use materially different profiles where the page structures differ. Keep reproducible source/profile/binding instructions with the date, allowed paths, rates, attribution, limits and observed results. A fresh setup must still require explicit authorisation.
- Submit one Request through MCP for at least two origins bound to the same Topic. Record the Request ID, distinct child Job IDs, Source and Profile Version IDs, statuses, accepted counts and a traced Record and Evidence ID for each successful origin.
- Open that same Request in the Dashboard. Download its CSV and JSON and reconcile their accepted record IDs or equivalent stable keys with the request-scoped API results. Compare sets and counts, including records from both origins. Check the capture hash against stored bytes using the existing verification path outside MCP.
- Exercise a comparable UI submission and use a controlled fixture for any required retry or partial-failure comparison. Avoid deliberately inducing failures on external publishers. Keep the fixture demonstration reproducible when the network is unavailable.

**Exit:** three external origins completed, one demonstrable multi-origin Request, both export formats reconciled, per-origin evidence verified, and another teammate can reproduce the configurations. Log real partial outcomes and any unresolved gap.

## M19. Align product positioning and architecture

Reconcile active README, product instructions and team skills with the formally approved academic title and the domain-neutral Core. Remove stale assertions that a downstream KOL or sentiment application is already selected. Record the distinction between the formal title and the descriptive name *Reusable Web Data Collection Platform*. Add a current architecture overview with a diagram showing the shared backend behind the Dashboard and MCP, the dispatch and worker path, Records, Evidence, exports and limitations.

**Exit:** a teammate can explain and run the platform from the current English documentation.

## M20. Make worker attempts traceable

Persist a safe worker identifier against each execution attempt and expose it through the Job/Event API and Job diagnostics. Decide how the platform identifies a worker incarnation after restart. Historical attempts without an identifier should display an explicit unknown value.

**Exit:** demonstrate two actual worker instances, identify which processed each observed attempt, then interrupt a controlled job and trace the subsequent attempt through recovery. Preserve historical attempt attribution, attempt fencing, record counts and existing API consumers. An attempt number alone cannot identify a worker.

## M21. Verify the integrated release

Extend PR CI to run the isolated MCP dependency check and protocol suite, relevant API contracts and proportionate static checks alongside the existing frontend and backend jobs. Review the tracked tree, development-only tooling, ignore rules, secrets checks and repository review settings. Record any owner-only settings separately. The MCP CI job can be brought forward when preparing the first M18 implementation PR.

Use a fresh checkout or isolated Docker project on Windows 11. Follow the documented setup, start the fixture Demo, connect MCP, reproduce the approved external source configuration, collect, export, stop and restart. Verify persistence with the same identifiers.

Exercise the affected reliability cases, including worker interruption, duplicate dispatch, stale attempts and dependency recovery. Reuse the M10 and M16 baselines with provenance. Repeat the 1/2/4-worker comparison where changes affect execution, separating processing throughput from same-origin rate limits. Record host memory, container limits, workload, elapsed time, throughput, errors and bottlenecks. If an 8 GB physical machine is unavailable, report constrained results and leave physical cold-start testing explicitly open.

**Exit:** an English release matrix maps the original acceptance requirements to current evidence, preserved historical evidence, or a named limitation. Include the short human and AI walkthrough, real-source inventory, verified commands, reviewed PR and any pending human decision.
