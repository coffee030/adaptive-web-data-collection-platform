# Local MCP Access on Windows

Harbourline exposes customer research through `python -m mcp_access.harbourline`. Use the separate Core collection server for operator tasks. Both use local stdio and the same optional Python environment.

## Harbourline campaign research

Install the client dependencies once from the checkout. Use Python 3.12 or 3.13.

```powershell
python -m venv mcp_access/.venv
& .\mcp_access\.venv\Scripts\python.exe -m pip install -r mcp_access/requirements.txt
```

Set the MCP host's executable to that Python interpreter, arguments to `-m mcp_access.harbourline`, and working directory to the checkout. Configure its child process to inherit the environment named below. Use the loopback address for the deployment you launched, including `/api/v1`. The default is public read access.

| Workspace | Host configuration | Customer tasks |
| --- | --- | --- |
| Public research | `FYP_MCP_API_BASE` for the isolated public demo, `HARBOURLINE_MCP_WORKSPACE=public` | Search identity metadata and historical works. Results include the observed source date, citations, provenance, and known gaps. |
| Fictional advisor | Demo API address, `HARBOURLINE_MCP_WORKSPACE=demo` | Search and inspect demo creators, compare cited evidence, examine supported requirements, evaluate a brief and calculate scenarios. Every catalog result identifies its fictional basis. |
| Company research | Private pilot API address and a company member session | All public research tools, scoped creator and campaign analysis, a paginated saved campaign list, and individual company briefs with shortlists and stored research. |

For the company workspace, run this in the same PowerShell window where you will start the trusted host. Replace the port with the pilot port shown by `Diagnose-Platform.bat -Pilot`. Sign in with your own company account at the prompt.

```powershell
.\mcp_access\Connect-HarbourlineMcp.ps1 -ApiBase http://127.0.0.1:<PILOT_API_PORT>/api/v1
```

The helper holds the session in the current process environment. Forward `FYP_MCP_API_BASE`, `HARBOURLINE_MCP_WORKSPACE`, `HARBOURLINE_MCP_COMPANY_ID`, `HARBOURLINE_MCP_SESSION`, `HARBOURLINE_MCP_ALLOW_BUDGET_EDITS` and `HARBOURLINE_MCP_ALLOW_WORKSPACE_EDITS` to the research server. Start the host from this terminal. A session expires after twelve hours and stops working immediately if membership is revoked. Store credentials outside tracked files, chat messages and host configuration. [Local host configuration example](../../mcp_access/harbourline.config.example.toml)

Company members can read saved research, compare published activity and download an authorized campaign performance report. To initiate background research or submit measured results, run the connection helper with `-AllowWorkspaceEdits` and restart the host. Use `start_campaign_research` with the same request key when retrying a brief. Read `get_research_progress` until the run is ready, then use `get_research_findings` to examine source evidence, alternative allocations and missing information. Reopen the run with `refresh_campaign_research` after a source changes. Recording an actual campaign period requires its source, authorization reference and the current tracking version.

With the operator credential, the Core server can inspect collection jobs and their execution events, view the Operations pulse, trace publication receipts and request a due refresh for an approved source.

To enable edits, sign in with the same helper using `-AllowBudgetEdits` and restart the host. The additional `change_campaign_budget` tool accepts the saved campaign ID, current version and revised HKD cap in cents. Both members and administrators can edit their company campaigns. Configure the host to request approval on this tool. A conflicting version returns an error. Read the campaign again before submitting another edit. The public research budget is independent of the allocation cap.

Try these requests in the host:

- “Which dated published works support affordable Hong Kong dining? Give me each contributor, excerpt, historical date, source revision and reuse license.” Use `search_public_works`. Use `search_public_creators` for name or identity research.
- “Open my saved campaign, compare the shortlist and show the post or grant supporting each mandatory requirement. Which candidates still need a current quote or audience evidence?” Use `list_saved_campaigns`, `get_saved_campaign`, `compare_creators` and `inspect_creator`.
- “Using this brief's mandatory requirements and optional preferences, find a feasible allocation for HK$12,000 and then for HK$8,000. Show differences and missing evidence.” Use `campaign_criteria` and `evaluate_campaign`, with `budget_minor` in HKD cents. The result includes retrieval method, category suggestion basis, ranked evidence, exact allocation status and exclusions. Relevance and utility express relative fit. Fee and reach estimates require separately evidenced inputs.
- “Calculate a scenario using my assumptions for impressions, click rate, conversion rate, margin, ad spend and campaign cost.” Use `calculate_campaign_scenario`. Missing inputs can leave ROI unavailable.

A read can time out after thirty seconds or fail if the API response exceeds 2 MiB. Narrow the criteria or select fewer creators. A missing or expired public feed returns its availability state. Host and operator API permissions are separated.

## Core collection access

Optional MCP clients on Windows use a separate Python 3.12 or 3.13 environment for the stdio server. Start `Start-FYP-Demo.bat` and wait for `Synthetic Demo is ready!`. Run `Diagnose-Platform.bat -Demo` to find the current **API port** and **Dashboard URL**. Use the direct API port in the MCP configuration. The ordinary Dashboard runs entirely in Docker. [Windows one-click setup](Windows-One-Click-Setup.md)

Open PowerShell in the checkout root. Replace `<DEMO_API_PORT>` with the API port from diagnostics. The example uses `python` for the installed interpreter. You can use its full path.

```powershell
python -m venv mcp_access/.venv
$python = '.\mcp_access\.venv\Scripts\python.exe'
& $python -m pip install -r mcp_access/requirements.txt
$env:FYP_MCP_API_BASE = 'http://127.0.0.1:<DEMO_API_PORT>/api/v1'
Invoke-RestMethod "$env:FYP_MCP_API_BASE/health"
```

For a private Harbourline pilot, configure the trusted MCP host with the pilot loopback API address and the operator credential in `FYP_MCP_OPERATOR_TOKEN`. Keep this credential in the operator process environment.

## Connect Codex or another local MCP client

Add the example's `fyp` tables to this checkout's local `.codex/config.toml`. Fill in the absolute checkout path and the current Demo API port. In a fresh Codex CLI session that trusts the checkout, ask it to call `fyp.list_categories` and report the first Category name and ID. Other local clients can use the same Python executable, arguments `-m mcp_access.server`, checkout root, and environment variable, with stdio transport. [Project configuration example](../../mcp_access/codex.config.example.toml) [Codex MCP configuration](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)

For a one-off read from PowerShell, reuse `$python` and `FYP_MCP_API_BASE` from the setup above. This command exposes only `list_categories` from the FYP server.

```powershell
$command = (Resolve-Path $python).Path.Replace('\', '/')
$root = (Get-Location).Path.Replace('\', '/')
$overrides = @(
    '-c', ('mcp_servers.fyp.command="' + $command + '"'),
    '-c', 'mcp_servers.fyp.args=["-m","mcp_access.server"]',
    '-c', "mcp_servers.fyp.enabled_tools=['list_categories']",
    '-c', ('mcp_servers.fyp.cwd="' + $root + '"'),
    '-c', ('mcp_servers.fyp.env.FYP_MCP_API_BASE="' + $env:FYP_MCP_API_BASE + '"')
)
codex @overrides --ask-for-approval never exec --ignore-user-config --ephemeral --sandbox read-only --json 'Use only the fyp MCP server. Call list_categories with limit 1 and report the category name and ID.'
```

## Four-minute presenter walkthrough

Complete the setup above before the presentation. Open the Dashboard URL from diagnostics. In a new PowerShell window at the trusted checkout, confirm `codex --version` and `codex login status`. Ensure the local copy of the example sets `start_collection` to `approval_mode = "prompt"`. Start the signed-in interactive host with `codex --ask-for-approval on-request --sandbox read-only`. Ask the host to use the local FYP MCP server for platform actions. Review the action, keyword, and two source bindings at each write prompt, and approve that call once.

| Time | Say this to the host | Show in the Dashboard |
| --- | --- | --- |
| 0:00–0:45 | “Which approved sources can I use for Fixture Listings under Core Demonstration? Show me the choices and wait.” | The available choices are Demo Catalog and Demo Cards. |
| 0:45–1:30 | “Collect the keyword quick from both of those sources once. Give me the request ID so I can open it in the Dashboard.” | Open `<DASHBOARD_ORIGIN>/collection-requests/<REQUEST_ID>` using the Dashboard origin from diagnostics and the ID returned by the host. The history list labels rows by topic and keyword, so repeated runs can look alike. Explain the state the receipt reported. |
| 1:30–2:45 | “How did each source finish? Show me one accepted record, where it came from, and the stored SHA-256 for its evidence.” | Check both **Child jobs**, then select **View request records**. Match the Record ID under **Provenance and identifiers** because both headlines can be Alpha. Open **View capture evidence** and compare Evidence ID and **Content SHA-256**. |
| 2:45–4:00 | “Run one new collection for detail404 using the same two sources. Once it finishes, tell me what each source retained, what failed, and show me the evidence for a retained record.” | In the new Request, show Partial for the parent and both Jobs. Each Job retains one Alpha with zero invalid records and duplicates, and separately reports a fetch error with HTTP 404. Follow the host's retained Record to Evidence. |

For acceptance, also ask “For Fixture Listings, can you include a website that is not on the approved source list? Explain my options and wait.” The expected response explains Source authorisation, separate Profile Version approval, and an approved Topic binding. Compare Request and Job ID sets before and after each scenario in the isolated Demo.

## Submit one Topic Collection

1. Use `list_categories`, `list_topics`, and `list_topic_sources` to discover eligible sources. For **Core Demonstration → Fixture Listings**, select the Demo Cards and Demo Catalog binding IDs.
2. After the operator explicitly requests collection, call `prepare_collection(topic_id, keyword, binding_ids)` with 1 to 4 distinct binding IDs. The result sets `submitted` to `false`. Each preparation generates a fresh UUID. Save the complete `submission` before sending it.
3. Check the Topic, keyword, bindings, and the host's write approval. Pass all four fields from `submission` unchanged to `start_collection`. HTTP 201 with a `created` receipt means a new Request. HTTP 200 with a `replayed` receipt means this intent already exists. The receipt contains the server-assigned `request_id`, current status, and the Job ID for each binding. Open the Dashboard with `request_id` or poll `get_collection_status` at a bounded interval, for example once per second for up to 90 seconds.
4. If MCP reports `outcome: unknown` or the client loses the submission reply, call `start_collection` again with the saved key and same parameters. The transport error's `structuredContent` includes `request_key` and `retry_same_key`. If the key is lost, first check **Collection requests** history in the Dashboard. HTTP 409 with `collection_request_conflict` means the key belongs to a different intent. Call `prepare_collection` again for a separate, explicitly requested collection.

Each `start_collection` call sends one POST with a deadline. The platform decides eligibility and creates the Request and Jobs. Replaying an accepted intent returns its historical receipt. If a Source or binding later becomes ineligible, a new key with a mixed selection fails as a whole. Keep the host's write approval enabled.

`get_collection_status` reports each source's Job status, accepted, invalid, and duplicate counts, and known error codes and HTTP statuses. A partially completed Job can retain valid records. Use `get_collection_records` to read them. `invalid_count` counts records that failed validation. Page fetch failures appear in the Job error and Dashboard execution events.

Maintainers can run the following verification on an isolated Synthetic Demo. It submits `quick`, checks that a fresh key can create another Request with the same intent, simulates a lost reply after commit, submits `detail404`, and tests binding ineligibility on a separate temporary Topic. Run it without other operators submitting collections so the Request and Job ID sets can be compared.

```powershell
& $python -m mcp_access.verify_start_demo
```

## Reproduce an evidence trace for a Demo record

1. Open the persisted **Fixture Listings · quick** under **Collection requests** in the Dashboard. Copy the Request UUID from the URL.
2. Run the commands below. The SDK discovers and calls seven tools over stdio, reads two pages of Records, and cross-checks the selected Record's lineage and Evidence hash and the before and after Request and Job ID sets against the REST API.
3. Open the same Request. Check the Job details and **Pinned profile version** links under **Child jobs**. Select **View request records**, sort by **Oldest first**, and open the first Record. Expand **Provenance and identifiers** to verify each ID, then select **View capture evidence** to check **Content SHA-256**. If two Records have the same headline, select the one with the Record ID printed by the SDK.

```powershell
& $python -m mcp_access.verify_demo '<REQUEST_UUID>'
& $python -m pip install pytest
& $python -m pytest -q mcp_access/tests
```

## Troubleshooting

- If MCP fails to initialize, check the absolute Python path, checkout working directory, dependencies, and stderr. The API base must be `http://127.0.0.1:<port>/api/v1` or its IPv6 loopback equivalent.
- If the API is unavailable or returns an HTTP error, run `Diagnose-Platform.bat -Demo` and check `/api/v1/health`. Start a fresh MCP session after changing the host config. Reuse the saved key and parameters if the submission outcome is unknown.
- `get_collection_records` requires a Request UUID. An unknown Request returns a tool error. An empty page for a known Request returns empty `items`. The page limit is 25. Continue with `next_offset`. Each REST read is limited to 5 seconds and 2 MiB. Reduce `limit` if a response exceeds the size limit.
- `payload` is extracted source data. Each preview contains up to 12 fields with up to 512 characters per text value. `payload_truncated` is `true` if the preview omits an overlong field name or clips text. Evidence `content_hash` is the stored SHA-256. To verify raw capture bytes, obtain them independently and recompute the digest.
