# M1 Verification and M2 Readiness

Verification ran on 2026-11-14 Hong Kong time. All 36 M0 tests passed at baseline `a85f5de` before modification. Git had no remote. The complete v3 Guide was absent from the named project. Implementation followed the user's M1 specification, the M0 contracts, and ADRs.

## Actual results

The fresh Windows 11 x64 `.venv` used CPython 3.12.14, Scrapling 0.5.1, Pydantic 2.14.3, pytest 9.2.0, and Ruff 0.17.5. Run below from the repository root with `$py = './.venv/Scripts/python.exe'`.

| Command | Result |
| --- | --- |
| `& $py -m pip install --index-url https://pypi.org/simple/ --disable-pip-version-check --retries 0 --timeout 15 --no-cache-dir -r backend/requirements.txt` | PASS |
| `& $py -m pip check` | PASS |
| `& $py -m pytest -q backend/tests/test_m0_extraction.py backend/tests/test_m0_http.py` | 36 PASS, 0 FAIL, 6.17 seconds |
| `& $py -m pytest -q backend/tests/m1/test_m1_profiles.py backend/tests/m1/test_m1_adapters.py backend/tests/m1/test_m1_ingestion_evidence.py` | 65 PASS, 0 FAIL, 1.33 seconds |
| `& $py -m pytest -q backend/tests/m1/test_m1_runner.py` | 11 PASS, 0 FAIL, 0.85 seconds |
| `& $py -m pytest -q backend/tests` | 112 PASS, 0 FAIL, 0 SKIP, 7.27 seconds |
| `& $py -m ruff check backend` | PASS |
| `& $py -m ruff format --check backend` | PASS, 17 files |
| `git diff --check a85f5de HEAD` | PASS for M1 commits. Whole-worktree `git diff --check` flagged an existing trailing blank line in the local teammate brief. That local change was preserved. |

Batch counts were A 23, B with the M0 parser 33, C 6, D 11, and E 112. Batch B initially failed once because `Disallow: /denied` blocked the test's redirect start `/denied-redirect`. Changing it to `/go-denied` confirmed that the first hop got a request and the restricted hop did not. Pinned curl_cffi showed a write callback returning 0 may only warn. The transport uses `CURL_WRITEFUNC_ERROR` to abort and a controlled overflow response to verify it. M1 HTTP tests connect only to local controlled fixtures.

Mixed CSV produced 2 valid, 3 invalid (missing required, wrong type, row width), and 1 duplicate, giving `partial`. Rerun retained Record IDs and used fresh Run and Evidence IDs. CSS and XPath both used live HTTP and Scrapling. Tests checked raw bytes and SHA-256 and traced the output back to Source, Run, Profile Version, and position.

## M1 Definition of Done

| Requirement | Status |
| --- | --- |
| M0 regression | PASS, 36 tests |
| Create Draft | PASS |
| Preview | PASS, end to end |
| Validation pins exact configuration | PASS, including stale report |
| Reject approval of invalid Profile | PASS |
| Explicit human approval | PASS, requires approver and current report ID |
| Approved Profiles are immutable | PASS, including nested configuration |
| Unapproved and retired versions cannot run | PASS |
| One extractor handles two HTML layouts | PASS |
| CSV and HTML share ingestion | PASS |
| Generic Records are schema-validated | PASS |
| Deterministic deduplication | PASS, including missing IDs and different Sources |
| Invalid records have structured reasons | PASS |
| Raw Evidence and SHA-256 | PASS |
| Traceable record provenance | PASS |
| Controlled runner end to end | PASS, 11 tests |
| Core has no ML or IA dependencies | PASS, dependency and diff checks |
| Standalone Python library at this stage | PASS, code and dependency scope checks |
| pytest and Ruff | PASS |
| Actual results and limits documented | PASS |
| M2 integration work defined | PASS |

GitHub remote, Project, and PR were **BLOCKED** without a verified destination. Docker and Linux, 8 GB deployment, public-network security, and production persistence were **NOT RUN** for later verification. Second-student review was pending.

## M2 Readiness

**GO** for the first persistent FastAPI and PostgreSQL slice. Start with transactional Source, Profile Version, validation report, and manual approval. Preserve unique `source_id + version`, immutable config, and hash checks. PostgreSQL tests should cover stale validation, duplicate approval, readback after restart, and two concurrent approvals. FastAPI should obtain approver from trusted identity and call the same domain rules.

Then integrate Run and Task, Evidence metadata, identity constraints, and durable Quarantine. Decide revocation and in-flight boundaries, filesystem and DB rollback and orphan cleanup, retention, and schema evolution. Public Sources require separate authorisation, DNS, TLS, egress, full robots behaviour, and request budget verification.
