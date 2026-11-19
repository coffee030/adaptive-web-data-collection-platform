# M17B handoff — Submit controlled collections through MCP

Acceptance took place on 2026-11-20 (Hong Kong time). The reviewed M17A baseline was `92fb62ebb7ebef27573b17d1ddab039d0c1bd1cc` on `feature/M17-mcp-access`. Commit `991c220ed00ffe692243095a438f8265429e5114` contains the implementation, tests, Demo verifier, and Windows instructions. [Windows MCP guide](docs/setup/Windows-MCP-Access.md)

`prepare_collection` validates arguments locally and returns a new `request_key` and the submission parameters. The only write tool, `start_collection`, sends one POST to a fixed loopback REST route. The backend decides eligibility and creates or replays the Request. If the reply is lost, MCP returns a tool error with `outcome: unknown`, the original key, and instructions to replay the same intent. The seven read tools remain available. `get_collection_status` adds record counts, next retry times, and short errors for each Job.

## Live Demo Requests and Jobs

The SDK discovered **Core Demonstration → Fixture Listings** over stdio and selected Demo Catalog and Demo Cards. Verification used the existing isolated Windows Synthetic Demo on API port `58098` and React Dashboard port `5198`. The UUIDs below are backend-issued Request and Job IDs.

| Case | Request ID | Demo Catalog Job ID | Demo Cards Job ID | Result |
| --- | --- | --- | --- | --- |
| `quick` | `c47c14ce-a400-4abc-9d96-89c1eb9f36e6` | `34f7845e-9be0-4cea-abf1-a04b91fbcbfe` | `ed8d2d11-1a86-4934-8918-c226ebee0326` | HTTP 201. Both Jobs and their Request moved from pending to succeeded. Replay with the binding order reversed returned HTTP 200. |
| New `quick` run with the same intent and a fresh key, with a simulated lost reply after commit | `1544b28b-d894-46db-b6bd-39cdd84203ec` | `4c839450-11ff-4408-9105-36ca4d713cc2` | `4a6a69f2-4853-49a8-9d09-f0577ca497df` | The test proxy received HTTP 201 from the backend and then closed the return connection. A fresh MCP process used the original key and parameters to retrieve HTTP 200 with the same three IDs. The run succeeded. |
| `detail404` | `75a11597-380f-4a9e-a652-214579e07e7c` | `7876feae-3211-4b86-a469-06cb31cceb73` | `9d107b54-0667-48f8-86d8-f62d5e59a7d5` | HTTP 201. The Request and both Jobs finished partial. Each Job retained one valid Alpha with zero invalid records and zero duplicates, and reported `http_error` with HTTP 404. |

The lost-reply case used prepared key `8e117028-52f9-41ff-bfc5-f1fcd20628fd`. The ordinary `quick` preparation used `2a229c67-3f39-40e3-a3ae-a981051d460c`. Reusing that key with `detail404` produced HTTP 409 `collection_request_conflict`.

| Demo checkpoint | Requests | Jobs | ID set difference |
| --- | ---: | ---: | --- |
| At the start and after preparation | 4 | 8 | 0 / 0 |
| After the ordinary `quick` submission | 5 | 10 | Added 1 / 2 above. Reversed-binding replay and the different-keyword conflict each added 0 / 0. |
| After backend commit in the lost-reply case | 6 | 12 | Added 1 / 2 above. Replay in a fresh MCP process added 0 / 0. |
| After `detail404` finished | 7 | 14 | Added 1 / 2 above. |
| After `quick` on the temporary Topic finished | 8 | 16 | Added 1 / 2 below. After disabling one binding, rejection and historical replay each added 0 / 0. |

The temporary Topic Request was `2113ef51-f86b-40ed-ace6-9905e8a9e9b0`, with Jobs `d59ec2ba-8635-49bc-b46d-10b14278f936` and `e910b04c-ef5f-4ba0-8af9-04cf7beeac92`. A separate operator REST step disabled one binding. A mixed selection with a fresh key returned HTTP 409 `binding_ineligible`. The original key and intent returned HTTP 200 with the original IDs. Verification ended by deactivating the temporary Topic. Both Fixture Listings bindings remained eligible.

The initial verifier attempt created successful `quick` Request `14246a05-3456-454b-8062-74014fb99174` and Jobs `eb9e2b5e-a895-4d98-b457-14003d27c307` and `670d8e89-603f-4683-b1ce-1f5fc6279e83`. The verifier looked for `title` when reading Alpha. After correcting it to the fixture field `headline`, the full check was rerun. The first successful run remained in the Demo and was counted in the rerun's 4 / 8 starting inventory.

## Dashboard and evidence

Headless Chrome opened Request Detail for the three Fixture Listings runs above and compared each source's Job link, status, counts, Source, and Profile Version. We followed **View request records** and opened each **Inspect Alpha** action. The IDs under **Provenance and identifiers** and the SHA-256 under **View capture evidence** agreed with the SDK and independent REST GET checks. The Dashboard made zero non-GET API requests.

| Case and source | Record ID | Evidence ID | Stored SHA-256 |
| --- | --- | --- | --- |
| `quick` · Demo Catalog | `d08cc6a8-423f-5924-b28d-c317e4b38bff` | `f22f7c59-3326-4220-9501-0dbbe7277901` | `4ce7ceca659b894e809bc5e95a8c39a41a647bf7059336a8f96115b36c23710b` |
| `detail404` · Demo Catalog | `cd675e25-86f9-53e9-a8b7-252652edc368` | `1a26bb03-769d-4c61-bfe7-fc76d39d2446` | `4ce7ceca659b894e809bc5e95a8c39a41a647bf7059336a8f96115b36c23710b` |
| `detail404` · Demo Cards | `7b7aabf4-bc8d-5c22-b2f2-3a5c86083094` | `dba36f97-469d-4726-bedf-0e69561d7dc8` | `bbf25a9c35ea154e2e3b856679194ca5f37849345dbfafe2906e46edeac9b898` |

Each source's `invalid_count` counts record validation failures. The page fetch HTTP 404 appears separately as a Job error. The live comparison used the stored digest. The existing PostgreSQL integration tests listed below covered recomputing SHA-256 from raw capture bytes.

## Commands and results

| Command or action run | Environment and result |
| --- | --- |
| `.venv-m17/Scripts/python.exe -m pytest -q mcp_access/tests` | 14 passed. Used real SDK stdio and fake loopback REST. Covered preparation without writes, invalid arguments, the fixed POST route, original-key forwarding, 201/200, 409, 408, 5xx, redirects, unreadable receipts, partial completion fields, and the existing read trace. |
| `.venv-m17/Scripts/python.exe -m pip check` | No dependency conflicts. |
| `python -m pytest -q -rs -p no:cacheprovider backend/tests/m2/test_m7_results.py backend/tests/m2/test_m8_collections.py backend/tests/m2/test_m9_record_export.py` | 11 passed. A one-off container used the existing Demo backend image, `M2_TEST_DATABASE_URL` and `M3_TEST_BROKER_URL`, a read-only mount of the checkout's `backend`, and isolated PostgreSQL 17 and Redis 7.4. The usual Docker address pools were exhausted. The run passed on available subnet `10.249.230.0/28`. The M8 concurrency test confirmed one parent Request and one Job per binding for concurrent submissions with the same key, returning HTTP 201 and 200. |
| `$env:FYP_MCP_API_BASE='http://127.0.0.1:58098/api/v1'`, then `.venv-m17/Scripts/python.exe -m mcp_access.verify_start_demo` | Full Synthetic Demo with real PostgreSQL, Dispatcher, and worker. Passed the submission, lost reply, conflict, eligibility, and partial completion scenarios above. |
| `.venv-m17/Scripts/python.exe -m mcp_access.verify_demo 9b98e289-9424-4592-a46c-03391b3e68d0` | The existing M17A SDK read passed. The Request and Job ID sets stayed at 8 / 16. |
| `node .local-demo/m17b-dashboard.cjs` | Local temporary Playwright and Chrome verification passed for three Requests. The first two attempts led to adjustments to the return query matching for Job links and the selector for the partial error list. The preceding walkthrough reproduces the checks in the Dashboard. |

Acceptance covered controlled fixtures, the SDK, and the existing Dashboard. The natural-language AI host demonstration was deferred to M17C.

## Publication and review

The repository-local author and committer were `coffee030 <59193099+coffee030@users.noreply.github.com>`. The HTTPS credential used to publish verified the GitHub login `coffee030`, account ID `59193099`, and push permission for `coffee030/adaptive-web-data-collection-platform`.

`git push --no-follow-tags origin HEAD:refs/heads/feature/M17-mcp-access` used the same credential. `git ls-remote --exit-code --refs origin refs/heads/feature/M17-mcp-access` confirmed implementation commit `991c220ed00ffe692243095a438f8265429e5114`. This handoff is a later commit on the same branch for review. [GitHub feature branch](https://github.com/coffee030/adaptive-web-data-collection-platform/tree/feature/M17-mcp-access)
