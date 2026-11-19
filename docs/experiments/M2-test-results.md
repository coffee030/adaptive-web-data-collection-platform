# M2 Verification Results

On 2026-11-14 Hong Kong time, verification used Windows, CPython 3.12.14, native PostgreSQL 17.7 on a dedicated loopback instance, Scrapling 0.5.1, Pydantic 2.14.3, SQLAlchemy 2.0.57, Alembic 1.20.1, psycopg 3.3.9, FastAPI 0.162.7, pytest 9.2.0, and Ruff 0.17.5. Tests set `M2_TEST_DATABASE_URL` explicitly and used random schemas per case. The restart test used `M2_TEST_PG_CTL` and `M2_TEST_PGDATA` with a separate data directory.

## Baseline and batches

| Batch | Commands and focus | Observed results |
| --- | --- | --- |
| M1 baseline `cd7c681` | `python -m pytest -q --tb=short backend/tests` | Default sandbox blocked loopback, with 69 PASS and 43 FAIL. The same suite passed all 112 with loopback enabled. Ruff lint and format passed. |
| A | `python -m pytest -q --tb=short backend/tests`, `python -m alembic upgrade head`, `python -m alembic check` | 115 PASS. A separate empty DB upgraded to 0001. FK, uniqueness, concurrent version creation, and hash round-trip passed. |
| B | Same as A | 122 PASS. At 0002, verified approval, rollback, stale revision, DB immutability, API, and OpenAPI. Fixed a report DTO forward reference and ran the full suite. |
| C | `python -m pytest -q --tb=short backend/tests/m2` and Alembic upgrade and check | 15 PASS. At 0003, one of two simultaneous claims succeeded, a revoked Source failed execution, and mixed-input CSV returned partial. |
| D | Same as C | 20 PASS. At 0004, missing Evidence and failed transactions blocked result publication, and cross-Job Evidence foreign keys rejected invalid references. |
| E | `python -m pytest -q --tb=short backend/tests/m2/test_process_restart.py` | 1 PASS. On the first Windows pg_ctl restart, a child inherited the output pipe and the test timed out. Redirecting server logs to a file and isolating pg_ctl stdio fixed the test. |

## Final commands and results

Run from the repository root with `.venv/Scripts/python.exe`. Alembic CLI verification uses the separate test `DATABASE_URL`.

| Command | Result |
| --- | --- |
| `python -m pytest -q --tb=short backend/tests/test_m0_extraction.py backend/tests/test_m0_http.py` | 36 PASS |
| `python -m pytest -q --tb=short backend/tests/m1` | 76 PASS |
| `python -m pytest -q --tb=short backend/tests/m2` | 22 PASS |
| `python -m pytest -q --tb=short backend/tests` | 134 PASS |
| `python -m pip check` | PASS, no dependency conflicts |
| `python -m ruff check backend` | PASS |
| `python -m ruff format --check backend` | PASS |
| `python -m alembic upgrade head` | PASS. 0001 through 0004 apply to empty databases and test schemas. |
| `python -m alembic current --check-heads` | PASS, `0004 (head)` |
| `python -m alembic check` | PASS, no schema drift |
| `git diff --check cd7c681 HEAD` | PASS for M2 changes |
| `git diff --check` | Flagged trailing blank lines in an existing local teammate brief edit. The original was preserved. |
| `Get-Command docker -ErrorAction Stop` | Docker CLI not found. Compose config, container start, and volume restart could not run. |

## Actual data flow

| Fixture | Job outcome | Valid | Invalid | Duplicate | Evidence |
| --- | --- | ---: | ---: | ---: | --- |
| M0 HTML `table.html` | `succeeded` | 2 | 0 | 0 | Loopback HTTP, original bytes match SHA-256 |
| M1 CSV `listings.csv` | `partial` | 2 | 3 | 1 | Fixture UTF-8 bytes match SHA-256 |

End-to-end tests used FastAPI endpoints for Source, Draft, Preview, Validation, Approval, and Job. JobExecutor, PostgreSQL, and filesystem published results. REST returned counts, events, Records, Quarantine, and Evidence metadata. Both HTML and CSV tests read saved data from a new API instance. A separate process test ran live Uvicorn, created a CSV Job over TCP REST and executed `python -m backend.cli <job UUID>`. It stopped API, restarted PostgreSQL normally via `pg_ctl restart` while retaining the data directory, started Uvicorn with a different PID, and compared six committed API responses and the Evidence file.

The dedicated Compose named volume test uses `M2_TEST_COMPOSE_PROJECT`. Use a running dedicated test project and its correct database URL. Full container verification depends on this result.
