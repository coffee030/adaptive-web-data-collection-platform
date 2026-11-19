# M3 Verification Results

Verification ran on 2026-11-14 Hong Kong time. Windows 11 Pro 25H2 build 26200 had about 31.9 GiB visible and 15.7 GiB available. Versions were CPython 3.12.14, PostgreSQL 17.7, Celery 5.6.3, Kombu 5.6.2, redis-py 5.2.1, and Redis 7.4.8. The test DB used `127.0.0.1:55439`, 32 MiB shared_buffers, a separate cluster, and isolated schemas per case. The development DB was unused. Redis was a SHA-256-verified portable Windows build on `127.0.0.1:56379` with persistence disabled for native tests. Evidence used pytest temporary storage. The project default is `var/evidence`.

On first native Windows regression, Docker Desktop, Engine, WSL2 runtime, and Linux containers were unavailable. Standalone Compose v2.40.3 validated config. Docker Hub registry confirmed Linux amd64 manifests for Python, Redis, and PostgreSQL tags in Dockerfile and Compose. Container builds, Linux prefork, volume restart, and Docker resource use remained untested.

## Commands and results

Run from the repository root. The native environment below uses dedicated test runtime paths. Substitute other prepared dedicated test services where appropriate.

```powershell
$python = '.\.venv\Scripts\python.exe'
$env:M2_TEST_DATABASE_URL = 'postgresql+psycopg://collection_test@127.0.0.1:55439/collection_m3_test'
$env:M2_TEST_PG_CTL = (Resolve-Path 'var/m2-postgres/pgsql/bin/pg_ctl.exe').Path
$env:M2_TEST_PGDATA = (Resolve-Path 'var/m3-postgres-test/data').Path
$env:M3_TEST_BROKER_URL = 'redis://127.0.0.1:56379/0'
$env:M3_TEST_REDIS_SERVER = (Get-ChildItem var/m3-redis-test -Recurse -Filter redis-server.exe | Select-Object -First 1).FullName
$env:DATABASE_URL = $env:M2_TEST_DATABASE_URL
& $python -m pytest -q -rs --tb=short backend/tests
& $python -m pip check
& $python -m ruff check backend
& $python -m ruff format --check backend
& $python -m alembic upgrade head
& $python -m alembic current --check-heads
& $python -m alembic check
git diff --check 2790cc3 HEAD
```

| Check | Result |
| --- | --- |
| M2 baseline `pytest -q --tb=short backend/tests` | 134 PASS in 24.73s, including native PostgreSQL restart |
| Batch A and B Redis ping, registration, and CSV duplicates | Redis PONG. Kombu OperationalError without a listener. Live worker test 1 PASS. |
| Batch C `pytest -q backend/tests/m2` and reliability subset | 23 PASS, and 6 new reliability checks PASS |
| Batch D M3 retry and M1 adapter run separately | 20 PASS and 36 PASS |
| Full M3 `pytest -q -rs --tb=short backend/tests` | 170 PASS and 1 SKIPPED because dedicated Compose runtime was unconfigured. Added migration and actual DB unavailability coverage. |
| `pip check`, Ruff check and format | PASS, with 56 files checked by Ruff |
| Alembic upgrade, current, and check | PASS, head 0005 and no drift. Also downgraded seeded schema to 0004 and upgraded again. |
| `docker-compose.exe -p collection-m3-test config --quiet` | PASS, Compose v2.40.3 |
| `docker-compose.exe -p collection-m3-test -f compose.yaml -f compose.fixture.yaml config --quiet` | PASS, 6 services |
| `git diff --check 2790cc3 HEAD` | PASS. The unscoped command still flagged existing trailing whitespace in the teammate brief. |
| M2 and M3 Docker runtime | BLOCKED pending Engine and WSL2 |

## Live failures and results

- The CSV duplicate test used real Redis and a separate Windows solo worker. It produced 1 Record, 1 Evidence directory, and 1 terminal event.
- HTML ran through real TCP API, separate Dispatcher, Redis, and worker. Two workers were online, with 2 Records and matching Evidence bytes and SHA-256. A duplicate sent to the second worker while the first held the claim was skipped, leaving one attempt.
- Broker test started, stopped, and restarted Redis on a dedicated port. During downtime the Job remained pending with `broker_unavailable`. It completed after the second dispatch.
- A dedicated worker targeted a closed PostgreSQL port. The Job remained pending with attempt 0. After advancing dispatch due time, a worker with connectivity completed it.
- Interruption terminated a worker blocked on a PostgreSQL lock during the result transaction. The failed attempt wrote no result rows. Advancing the DB lease to expiry triggered redispatch, and attempt 2 completed.
- Commit and acknowledgement testing paused a test worker at the Celery ACK boundary, verified the DB had committed, and terminated it. The test advanced only that Redis unacknowledged entry's visibility time and invoked existing Kombu restore so a fresh worker received the same message. Job, events, Record, and Evidence matched.
- Stale completion and rollback covered PostgreSQL ownership, result rollback, and detecting orphaned Evidence. Missing fixture import and a Redis restore cadence longer than the test wait were corrected in the harness. Alembic CLI once overlapped native restart and passed after restart completed.

## Native resource samples

The two-worker HTML integration passed. Windows `Win32_Process.WorkingSetSize` sampled approximate 200 ms intervals and reports observed peak per group. PostgreSQL includes only the postmaster. Peaks can occur at different times and working sets can include shared pages. Linux containers and full 8 GB machine usage were unmeasured.

| Process group | Observed peak |
| --- | ---: |
| FastAPI | 107.0 MiB |
| Dispatcher | 101.0 MiB |
| Two Celery solo workers | 216.1 MiB |
| Redis | 14.7 MiB |
| PostgreSQL postmaster | 18.5 MiB |

Transport settings and the native Redis build are documented upstream. [Celery 5.6 configuration](https://docs.celeryq.dev/en/v5.6.3/userguide/configuration.html) [Redis portable release 7.4.8](https://github.com/redis-windows/redis-windows/releases/tag/7.4.8)

## Final acceptance preflight

On 2026-11-14 Hong Kong time, `python -m pytest -q -rs backend/tests` at baseline 3947ddc reported 170 passed, 2 skipped, and 0 failed in 95.73 seconds. Both skips were in `test_m3_compose.py` because the dedicated project and API URL were missing while Linux Engine was unavailable. Native PostgreSQL 17.7 restart, real Redis 7.4.8, and Celery 5.6.3 regression passed. `python -m alembic upgrade head`, `current --check-heads`, and `check` passed at 0005 with no drift. Ruff lint and format, `pip check`, and static fixture overlay validation through Compose v2.40.3 passed.

Acceptance tests added actual PostgreSQL volume identity comparison, CSV partial, Quarantine and duplicate counts, and actual lease timing after SIGKILL. Docker assertions still awaited a Linux Engine.

The authorised download used Docker's official Desktop 4.99.0 AMD64 installer. SHA-256 A5E299131C9C53D60F3F752B162078945EB5FAF6EEDCF0BE20A214C6E6CEA444 matched Docker. Authenticode was Valid from Docker Inc. Microsoft WSL 3.0.5 and kernel 6.18.58.1-1 were installed and Virtual Machine Platform was enabled. WSL2 still needed verification after a Windows restart. Python dependencies were ready.

[Docker Desktop Windows installation](https://docs.docker.com/desktop/setup/install/windows-install/) [Docker Desktop 4.99.0](https://docs.docker.com/desktop/release-notes/#4990)

### Docker Desktop post-reboot check

The official installer set up Docker Desktop 4.99.0 for the current user and exited 0. Docker CLI was 29.9.3, Compose v5.7.0. Windows restarted, Virtual Machine Platform was Enabled, and the pending servicing reboot cleared. Docker Desktop moved from starting to stopped with backend errors `WslVirtualizationDisabledInFirmware` and `HCS_E_HYPERV_NOT_INSTALLED`. Windows reported `VirtualizationFirmwareEnabled=False`, `VMMonitorModeExtensions=True`, and `HypervisorPresent=False`. On a physical host the operator must enable CPU virtualisation in UEFI. For a VM the administrator can provide nested virtualisation or an authorised Linux Engine.

## Linux Docker closure

On 2026-11-14 Hong Kong time, the physical ASUS Windows 11 host with AMD Ryzen 7 5800X reported `VirtualizationFirmwareEnabled=True` and `HypervisorPresent=True` with Virtual Machine Platform enabled. After relaunching installed Docker Desktop, `wsl -l -v` showed `docker-desktop Running 2`. This reused Docker Desktop 4.99.0, Engine 29.9.3 (`OSType=linux`), Compose 5.7.0, and WSL 3.0.5. The host had about 31.9 GiB. Engine reported 16 CPUs and 15.56 GiB.

| Gate | Observed result |
| --- | --- |
| A PostgreSQL persistence | PASS. Dedicated `collection-m2-test-3bfe9ebf` ran `python -m pytest -q -rs -s backend/tests/m2/test_process_restart.py`, 1 passed in 8.04s. The container retained `collection-m2-test-3bfe9ebf_postgres_data` after normal restart. API readback, Evidence bytes, and SHA-256 matched. |
| B Linux Redis and Celery | PASS. Redis 7.4.8 returned PONG. Linux Celery 5.6.3 reported `concurrency: 1 (prefork)` and registered and received `collection.execute_job`. PostgreSQL image was 17.12. |
| C HTML and CSV | PASS. HTML had 2 valid Records. CSV was partial with 2 valid, 1 Quarantine, and 1 duplicate. API approved both Source and Profile and read back Evidence ID, original bytes, and SHA-256. |
| D SIGKILL and lease | PASS. Job `0139bfbf-cdb3-44cb-8bb1-6d18e31b2cd6` attempt 1 was killed by SIGKILL. Real lease expiry was 2026-11-14 04:26:32.263670 HKT, worker loss 04:26:32.461751, and attempt 2 completion 04:26:37.603926. No clock advance. One result and one SUCCEEDED event. |
| E Broker and restart | PASS. Redis stop left the Job pending and recorded broker failure. Recovery completed. Redelivery of the Job UUID logged `job_not_pending`, and Job and events matched. After service restart, PostgreSQL state and Evidence shared by API and worker matched, with the same physical PostgreSQL volume name. |

`python -m pytest -q -rs -s backend/tests/m2/test_m3_compose.py` in `collection-m3-test-e07466b3` had 2 passed in 123.08s. In-container Alembic upgrade, current, and check passed with head 0005 and no drift. The Linux build passed `pip check`. Official digests were PostgreSQL `sha256:d3244e8ce3f165ee3c93d9c4a4b1d0fe48b3a89e2287b717fdcbbde92d405065`, Redis `sha256:7aec734b2bb298a1d769fd8729f13b8514a41bf90fcdd1f38ec52267fbaa8ee6`, and Python base `sha256:392307d22300de8b5986851a12d9176dfc0fc073e65bf6523ebd7dcbeb23564e`.

### Container resources

After acceptance, one `docker stats --no-stream` sample measured about 313 MiB across six containers. Whole-host load and usability at 8 GB remained unmeasured.

| Service | CPU | Memory |
| --- | ---: | ---: |
| PostgreSQL | 2.68% | 32.10 MiB |
| Redis | 0.34% | 4.71 MiB |
| API | 0.15% | 77.89 MiB |
| Dispatcher | 0.22% | 73.73 MiB |
| Worker | 0.12% | 111.60 MiB |
| Fixture | 0.01% | 13.16 MiB |

Full regression used another isolated project, `collection-m3-test-8e103692`. Windows pytest connected to Linux PostgreSQL and dedicated local Redis and ran live Linux Compose checks. `python -m pytest -q -rs -s backend/tests` reported 172 passed, 0 failed, and 0 skipped in 216.20 seconds. Second SIGKILL Job `142ab8a8-eb63-4447-a728-a2cfb50a07e5` lease expired at 04:29:02.762686 HKT, worker loss logged at 04:29:02.959849, and attempt 2 finished at 04:29:08.089672. The second container memory sample totalled about 324 MiB. Both test projects stopped with volumes retained.
