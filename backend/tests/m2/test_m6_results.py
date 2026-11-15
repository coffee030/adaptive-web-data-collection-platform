import json
from http.server import ThreadingHTTPServer
from threading import Thread
from uuid import UUID, uuid4, uuid5

import pytest
from alembic import command
from alembic.config import Config
from conftest import ROOT, approve_job_profile
from fastapi.testclient import TestClient
from sqlalchemy import text
from test_m3_reliability import make_retry_due
from test_vertical_slice import create_approved_source, submit_job

from backend.api.app import create_app
from backend.application.execution import JobExecutor
from backend.application.inputs import CsvEntry
from backend.application.results import Results
from backend.core.evidence import LocalEvidenceStore
from backend.tests.m3_fixture_site import FixtureHandler
from backend.tests.m6_fixture import CONFIGURATION, ROOT_PATH


@pytest.mark.parametrize("pg_engine", ["0006"], indirect=True)
def test_upgrade_preserves_legacy_evidence_records_and_quarantine(
    pg_engine, sessions, job_setup
):
    _, source, version, _, store = job_setup
    approve_job_profile(job_setup)
    executor = JobExecutor(sessions, store)
    entry = CsvEntry(
        adapter_type="csv",
        dataset_id="listings",
        content="Name,Count\nAlpha,2\nBad,NaN\n",
    )
    job, _ = executor.jobs.create(source, version, entry)
    claim, payload = executor.jobs.claim(job.job_id)
    result = executor._run(claim, payload)
    capture = result.evidence
    evidence_id = UUID(capture.evidence_id)
    metadata = store.root / evidence_id.hex / "metadata.json"
    metadata.write_text(
        capture.model_dump_json(exclude={"page_number"}), encoding="utf-8"
    )
    record = result.records[0]
    record_id = uuid5(job.job_id, record.record_id)
    rejected = result.invalid[0]
    quarantine_id = uuid5(job.job_id, "csv_row:3")
    ids = {"job": job.job_id, "evidence": evidence_id}
    with sessions.begin() as session:
        session.execute(
            text("""INSERT INTO raw_evidence
                     (id, job_id, run_id, storage_reference, captured_at, content_hash,
                      adapter_type, original_location, content_type)
                     VALUES (:evidence, :job, :run, :reference, :captured, :hash,
                             'csv', :location, :content_type)"""),
            ids
            | {
                "run": UUID(capture.run_id),
                "reference": f"{evidence_id.hex}/input.bin",
                "captured": capture.captured_at,
                "hash": capture.content_hash,
                "location": capture.original_location,
                "content_type": capture.content_type,
            },
        )
        session.execute(
            text("""INSERT INTO generic_records
                     (id, job_id, evidence_id, record_type, schema_version, source_record_key,
                      deduplication_key, validation_status, payload, source_position)
                     VALUES (:id, :job, :evidence, :record_type, :schema_version, :key,
                             :dedup, 'passed', CAST(:payload AS jsonb), CAST(:position AS jsonb))"""),
            ids
            | {
                "id": record_id,
                "record_type": record.record_type,
                "schema_version": record.schema_version,
                "key": record.source_record_key,
                "dedup": record.record_id,
                "payload": json.dumps(record.payload),
                "position": record.source_position.model_dump_json(),
            },
        )
        session.execute(
            text("""INSERT INTO quarantined_records
                     (id, job_id, evidence_id, position_kind, position_index, problems)
                     VALUES (:id, :job, :evidence, 'csv_row', 3, CAST(:problems AS jsonb))"""),
            ids
            | {
                "id": quarantine_id,
                "problems": json.dumps(
                    [item.model_dump() for item in rejected.problems]
                ),
            },
        )
        row = executor.jobs._get_row(session, job.job_id, lock=True)
        executor.jobs._finish(session, row, "partial", counts=(1, 1, 0))

    config = Config(ROOT / "alembic.ini")
    with pg_engine.begin() as connection:
        config.attributes["connection"] = connection
        command.upgrade(config, "head")
        command.check(config)
    results = Results(sessions)
    first = results.job_evidence(job.job_id)
    assert results.job_evidence_pages(job.job_id) == [first]
    assert first.page_number == 1 and first.evidence_id == evidence_id
    assert (
        first.profile_version_id == version
        and first.content_hash == capture.content_hash
    )
    assert results.record(record_id).evidence_reference == evidence_id
    assert results.record(record_id).payload == record.payload
    [item] = results.quarantine(job.job_id, 50, 0)
    assert item.record_id == quarantine_id and item.evidence_reference == evidence_id
    assert store.resolve(evidence_id.hex) == (capture, entry.collection_input().content)


@pytest.mark.parametrize("recover", [False, True])
def test_later_503_retries_the_whole_job_and_only_commits_terminal_attempt(
    sessions, pg_engine, tmp_path, recover
):
    failing = True

    class Handler(FixtureHandler):
        def do_GET(self):
            if failing and self.path == ROOT_PATH + "3":
                self.send_error(503)
                return
            super().do_GET()

        def log_message(self, *_):
            pass

    with ThreadingHTTPServer(("127.0.0.1", 0), Handler) as server:
        thread = Thread(
            target=server.serve_forever, kwargs={"poll_interval": 0.02}, daemon=True
        )
        thread.start()
        try:
            origin = f"http://127.0.0.1:{server.server_port}"
            executor = JobExecutor(sessions, LocalEvidenceStore(tmp_path))
            with TestClient(
                create_app(engine=pg_engine, evidence_root=tmp_path),
                base_url="http://127.0.0.1",
            ) as client:
                entry = {"adapter_type": "web", "url": origin + ROOT_PATH + "1"}
                profile = create_approved_source(
                    client,
                    {"adapter_type": "web", "allowed_origins": [origin]},
                    CONFIGURATION,
                    entry,
                )
                job, _ = submit_job(client, profile, entry, uuid4())
                job_id = UUID(job["job_id"])
                path = f"/api/v1/collection-jobs/{job_id}"
                records_path = f"/api/v1/records?job_id={job_id}"
                for attempt in range(1, 2 if recover else 3):
                    pending = executor.execute(job_id)
                    assert (
                        pending.status == "pending"
                        and pending.execution_attempt == attempt
                    )
                    assert (
                        pending.error.code == "http_error"
                        and pending.error.http_status == 503
                    )
                    assert pending.valid_count == pending.invalid_count == 0
                    assert client.get(path + "/evidence-pages").json() == []
                    assert client.get(records_path).json() == []
                    assert client.get(path + "/quarantine").json() == []
                    make_retry_due(sessions, job_id)
                failing = not recover
                final = executor.execute(job_id)
                assert final.status == "partial"
                assert final.execution_attempt == (2 if recover else 3)
                assert (
                    final.valid_count,
                    final.invalid_count,
                    final.duplicate_count,
                ) == ((3, 2, 1) if recover else (2, 1, 0))
                pages = client.get(path + "/evidence-pages").json()
                assert [item["page_number"] for item in pages] == [1, 2, 3]
                assert len({item["run_id"] for item in pages}) == 1
                assert client.get(path + "/evidence").json() == pages[0]
                assert pages[-1]["http_status"] == (200 if recover else 503)
                assert (final.error is None) is recover
                assert len(client.get(records_path).json()) == final.valid_count
                assert [event.kind for event in executor.jobs.events(job_id)].count(
                    "PARTIAL"
                ) == 1
        finally:
            server.shutdown()
            thread.join()
