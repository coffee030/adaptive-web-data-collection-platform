"""Exercise the public M8 API and the fenced worker on PostgreSQL."""

from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
from http.server import ThreadingHTTPServer
from threading import Barrier, Thread
from urllib.parse import urlsplit
from uuid import UUID, uuid4

import pytest
from alembic import command
from alembic.config import Config
from conftest import ROOT, approve_job_profile
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from test_m7_results import rate_url  # noqa: F401 - pytest fixture
from test_vertical_slice import create_approved_source, submit_job

from backend.api.app import create_app
from backend.application.execution import JobExecutor
from backend.core.evidence import LocalEvidenceStore
from backend.core.profiles import ProfileError
from backend.persistence.collection import (
    ArticleRow,
    CollectionRequestRow,
    RequestJobRow,
)
from backend.persistence.models import JobRow
from backend.tests.m3_fixture_site import FixtureHandler
from backend.tests.m7_fixture import search_config

API = "/api/v1"
REQUESTS = "/collection-requests"
SAMPLE = {"adapter_type": "web", "keyword": "quick"}


@pytest.fixture
def client(pg_engine, tmp_path):
    with TestClient(
        create_app(engine=pg_engine, evidence_root=tmp_path),
        base_url="http://127.0.0.1",
    ) as client:
        yield client


@pytest.fixture
def article_site():
    state = {"cards": "Alpha", "catalog": "Alpha"}

    class Handler(FixtureHandler):
        def do_GET(self):
            path = urlsplit(self.path).path
            layout = path.split("/")[2] if path.startswith("/m7/") else None
            if path.endswith("/detail/alpha") and layout in state:
                value = state[layout]
                if value is None:
                    self.send_error(404)
                    return
                body = (
                    f'<article><h2>{value}</h2><span class="count">010</span></article>'
                    if layout == "cards"
                    else f"<main><dl><dt>{value}</dt><dd>010</dd></dl></main>"
                ).encode()
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            super().do_GET()

    with ThreadingHTTPServer(("127.0.0.1", 0), Handler) as server:
        thread = Thread(
            target=server.serve_forever, kwargs={"poll_interval": 0.02}, daemon=True
        )
        thread.start()
        try:
            yield f"http://127.0.0.1:{server.server_port}", state
        finally:
            server.shutdown()
            thread.join()


def response(client, method, path, status, body=None):
    kwargs = {"json": body} if body is not None else {}
    reply = client.request(method, API + path, **kwargs)
    assert reply.status_code == status, reply.text
    return reply.json()


def create_topic(client, name="Collection subject"):
    category = response(client, "POST", "/categories", 201, {"name": "Demonstration"})
    return response(
        client, "POST", "/topics", 201, {"name": name, "category_id": category["id"]}
    )


def approved(client, origin, layout):
    config = search_config(origin, layout)
    config["article"] = {"title": "title"}
    return create_approved_source(
        client,
        {
            "adapter_type": "web",
            "allowed_origins": [origin],
            "allowed_paths": {origin: [f"/m7/{layout}"]},
        },
        config,
        SAMPLE,
    )


def binding_body(profile, operator="topic reviewer"):
    return {
        "source_id": profile["source_id"],
        "profile_version_id": profile["profile_version_id"],
        "approved_by": operator,
    }


def bind(client, topic, profile):
    return response(
        client, "POST", f"/topics/{topic['id']}/bindings", 201, binding_body(profile)
    )


def new_intent(topic, *bindings):
    return {
        "topic_id": topic["id"],
        "binding_ids": [binding["id"] for binding in bindings],
        "keyword": "quick",
        "request_key": str(uuid4()),
    }


def refresh(client, parent, key=None, expected=201):
    return response(
        client,
        "POST",
        f"{REQUESTS}/{parent['id']}/refresh",
        expected,
        {"request_key": str(key or uuid4())},
    )


def run_children(worker, request):
    return [worker.execute(UUID(item["job"]["job_id"])) for item in request["jobs"]]


@pytest.mark.usefixtures("rate_url")
def test_request_with_a_held_or_cancelled_child(
    client, article_site, sessions, tmp_path
):
    origin, _ = article_site
    topic = create_topic(client)
    binding = bind(client, topic, approved(client, origin, "cards"))
    parent = response(client, "POST", REQUESTS, 201, new_intent(topic, binding))
    parent_path = f"{REQUESTS}/{parent['id']}"
    job_id = parent["jobs"][0]["job"]["job_id"]
    control = f"/collection-jobs/{job_id}/control"
    worker = JobExecutor(sessions, LocalEvidenceStore(tmp_path))
    response(client, "POST", control, 200, {"action": "pause"})
    assert response(client, "GET", parent_path, 200)["status"] == "paused"
    export_path = f"{parent_path}/records/export?format=json"
    assert (
        response(client, "GET", export_path, 409)["error"]["code"]
        == "record_export_pending"
    )
    response(client, "POST", control, 200, {"action": "resume"})
    worker.jobs.claim(UUID(job_id))
    response(client, "POST", control, 200, {"action": "pause"})
    assert response(client, "GET", parent_path, 200)["status"] == "running"
    assert (
        response(client, "GET", export_path, 409)["error"]["code"]
        == "record_export_pending"
    )
    response(client, "POST", control, 200, {"action": "cancel"})
    cancelled = response(client, "GET", parent_path, 200)
    assert cancelled["status"] == "cancelled" and cancelled["finished_at"]
    assert response(client, "GET", export_path, 200) == []


def test_catalog_crud_active_scope_and_invalid_binding(client, job_setup):
    topic = create_topic(client)
    topic_path = f"/topics/{topic['id']}"
    category = f"/categories/{topic['category_id']}"
    assert response(client, "GET", "/categories", 200)[0]["id"] == topic["category_id"]
    assert response(client, "GET", category, 200)["name"] == "Demonstration"
    assert (
        response(client, "POST", "/categories", 409, {"name": " demonstration "})[
            "error"
        ]["code"]
        == "duplicate_catalog_name"
    )
    assert response(client, "GET", topic_path, 200) == topic
    assert response(client, "GET", "/topics", 200) == [topic]
    renamed = response(
        client, "PUT", topic_path, 200, {"name": "Renamed", "active": True}
    )
    assert renamed["id"] == topic["id"]
    response(
        client,
        "POST",
        "/topics",
        409,
        {"name": "renamed", "category_id": topic["category_id"]},
    )
    response(client, "PUT", category, 200, {"name": "New group", "active": False})
    assert response(client, "GET", "/categories?active_only=true", 200) == []
    assert response(client, "GET", "/topics?active_only=true", 200) == []
    assert response(client, "GET", topic_path, 200)["name"] == "Renamed"
    response(
        client,
        "POST",
        "/topics",
        404,
        {"name": "Unknown parent", "category_id": str(uuid4())},
    )
    _, source_id, version_id, _, _ = job_setup
    body = binding_body(
        {"source_id": str(source_id), "profile_version_id": str(version_id)}
    )
    path = topic_path + "/bindings"
    assert (
        response(client, "POST", path, 409, body)["error"]["code"]
        == "profile_not_approved"
    )
    approve_job_profile(job_setup)
    assert (
        response(client, "POST", path, 400, body)["error"]["code"]
        == "binding_requires_search"
    )


@pytest.mark.usefixtures("rate_url")
def test_multiple_sources_refresh_history_and_revocation(
    client,
    sessions,
    tmp_path,
    article_site,
):
    origin, site = article_site
    topic = create_topic(client)
    cards = approved(client, origin, "cards")
    catalog = approved(client, origin, "catalog")
    card_binding = bind(client, topic, cards)
    catalog_binding = bind(client, topic, catalog)
    binding_path = f"/topics/{topic['id']}/bindings"
    assert (
        response(client, "POST", binding_path, 409, binding_body(cards))["error"][
            "code"
        ]
        == "duplicate_binding"
    )
    assert (
        response(
            client,
            "POST",
            binding_path,
            404,
            binding_body(cards)
            | {
                "profile_version_id": catalog["profile_version_id"],
            },
        )["error"]["code"]
        == "profile_not_found"
    )
    assert len(response(client, "GET", binding_path + "?eligible_only=true", 200)) == 2

    intent = new_intent(topic, card_binding, catalog_binding)
    response(
        client,
        "POST",
        REQUESTS,
        422,
        intent | {"binding_ids": [card_binding["id"]] * 2},
    )
    response(
        client,
        "POST",
        REQUESTS,
        409,
        intent | {"binding_ids": [card_binding["id"], str(uuid4())]},
    )
    assert response(client, "GET", REQUESTS, 200) == []
    assert response(client, "GET", "/collection-jobs", 200) == []
    with ThreadPoolExecutor(2) as executor:
        submissions = list(
            executor.map(lambda _: client.post(API + REQUESTS, json=intent), range(2))
        )
    assert sorted(reply.status_code for reply in submissions) == [200, 201]
    original = submissions[0].json()
    assert original == submissions[1].json()
    assert original["status"] == "pending" and len(original["jobs"]) == 2
    assert {item["job"]["profile_version_id"] for item in original["jobs"]} == {
        str(UUID(profile["profile_version_id"])) for profile in (cards, catalog)
    }
    assert (
        response(
            client,
            "POST",
            REQUESTS,
            200,
            intent | {"binding_ids": intent["binding_ids"][::-1]},
        )
        == original
    )
    response(client, "POST", REQUESTS, 409, intent | {"keyword": "different"})

    worker = JobExecutor(sessions, LocalEvidenceStore(tmp_path))
    completed = run_children(worker, original)
    first = response(client, "GET", f"{REQUESTS}/{original['id']}", 200)
    assert first["status"] == "succeeded" and first["finished_at"]
    assert [child["job"] for child in first["jobs"]] == [
        job.model_dump(mode="json") for job in completed
    ]
    articles = response(client, "GET", f"/articles?request_id={original['id']}", 200)
    assert len(articles) == len({article["id"] for article in articles}) == 2
    card_id = next(
        article["id"]
        for article in articles
        if UUID(article["source_id"]) == UUID(cards["source_id"])
    )
    article = f"/articles/{card_id}"
    original_observation = response(client, "GET", f"{article}/observations", 200)[0]
    evidence_id = original_observation["evidence_id"]
    evidence = response(client, "GET", f"/evidence/{evidence_id}", 200)
    assert evidence["capture_kind"] == "detail"
    assert evidence["job_id"] == original_observation["job_id"]
    record = response(
        client, "GET", f"/records/{original_observation['record_id']}", 200
    )
    assert record["evidence_reference"] == evidence_id
    assert record["payload"]["count"] == 10
    raw = response(client, "GET", f"{article}/observations/{record['record_id']}", 200)
    assert raw["raw_payload"]["count"] == "010"
    _, raw_bytes = worker.evidence.resolve(UUID(evidence_id).hex)
    assert sha256(raw_bytes).hexdigest() == evidence["content_hash"]

    response(
        client,
        "PUT",
        f"/topics/{topic['id']}",
        200,
        {"name": "Renamed topic", "active": True},
    )
    binding_action = f"{binding_path}/{card_binding['id']}"
    response(client, "POST", binding_action + "/disable", 200)
    assert (
        refresh(client, original, expected=409)["error"]["code"] == "binding_ineligible"
    )
    response(
        client,
        "POST",
        binding_action + "/approve",
        200,
        {"approved_by": "second reviewer"},
    )
    new_profile_path = f"/sources/{cards['source_id']}/versions"
    new_config = search_config(origin, "cards")
    draft = response(
        client, "POST", new_profile_path, 201, {"configuration": new_config}
    )
    assert draft["approval_status"] == "draft"
    assert (
        response(client, "POST", binding_path, 409, binding_body(draft))["error"][
            "code"
        ]
        == "profile_not_approved"
    )
    draft_path = new_profile_path + "/" + draft["profile_version_id"]
    report = response(client, "POST", draft_path + "/validate", 200, SAMPLE)
    replacement = response(
        client,
        "POST",
        draft_path + "/approve",
        200,
        {
            "approver": "profile reviewer",
            "report_id": report["report_id"],
            "config_hash": draft["config_hash"],
        },
    )
    replacement_binding = bind(client, topic, replacement)
    assert replacement_binding["config_hash"] != card_binding["config_hash"]
    assert len(response(client, "GET", binding_path + "?eligible_only=true", 200)) == 3

    same_key = uuid4()
    same = refresh(client, original, same_key)
    assert refresh(client, original, same_key, expected=200) == same
    assert (
        same["refresh_of"] == original["id"]
        and same["topic_name"] == original["topic_name"]
    )
    assert same["keyword"] == original["keyword"]
    assert [item["binding_id"] for item in same["jobs"]] == [
        item["binding_id"] for item in original["jobs"]
    ]
    assert [item["approved_by"] for item in same["jobs"]] == ["topic reviewer"] * 2
    assert [item["job"]["config_hash"] for item in same["jobs"]] == [
        item["job"]["config_hash"] for item in first["jobs"]
    ]
    run_children(worker, same)
    assert len(response(client, "GET", article + "/observations", 200)) == 2
    assert len(response(client, "GET", article + "/versions", 200)) == 1

    site.update(cards="Revised title", catalog=None)
    revised = refresh(client, same)
    run_children(worker, revised)
    assert (
        response(client, "GET", f"{REQUESTS}/{revised['id']}", 200)["status"]
        == "partial"
    )
    changed = response(client, "GET", article, 200)
    assert (changed["id"], changed["title"], changed["version"]) == (
        card_id,
        "Revised title",
        2,
    )
    assert len(response(client, "GET", article + "/observations", 200)) == 3
    versions = response(client, "GET", article + "/versions", 200)
    assert [version["version"] for version in versions] == [2, 1]
    kept = response(client, "GET", article + "/versions/" + versions[1]["id"], 200)
    assert kept["content"]["title"] == "Alpha"
    assert response(client, "GET", f"/evidence/{evidence_id}", 200) == evidence
    assert worker.evidence.resolve(UUID(evidence_id).hex)[1] == raw_bytes
    assert (
        len(response(client, "GET", f"/articles?request_id={revised['id']}", 200)) == 1
    )
    site["catalog"] = "Alpha"
    recovery = refresh(client, revised)
    run_children(worker, recovery)
    assert (
        response(client, "GET", f"{REQUESTS}/{recovery['id']}", 200)["status"]
        == "succeeded"
    )

    failed = refresh(client, recovery)
    for profile in (cards, catalog):
        response(
            client,
            "PATCH",
            f"/sources/{profile['source_id']}/authorization",
            200,
            {"approval_status": "revoked"},
        )
    assert (
        refresh(client, recovery, expected=403)["error"]["code"]
        == "source_not_approved"
    )
    assert response(client, "GET", binding_path + "?eligible_only=true", 200) == []
    assert {job.error.code for job in run_children(worker, failed)} == {
        "source_not_approved"
    }
    assert (
        response(client, "GET", f"{REQUESTS}/{failed['id']}", 200)["status"] == "failed"
    )
    assert response(client, "GET", f"/articles?request_id={failed['id']}", 200) == []
    assert len(response(client, "GET", REQUESTS, 200)) == 5


@pytest.mark.usefixtures("rate_url")
def test_concurrent_publication_and_late_observation(
    client, sessions, tmp_path, article_site
):
    origin, site = article_site
    topic = create_topic(client)
    profile = approved(client, origin, "cards")
    binding = bind(client, topic, profile)
    request = response(client, "POST", REQUESTS, 201, new_intent(topic, binding))
    standalone, _ = submit_job(client, profile, SAMPLE, uuid4())
    worker = JobExecutor(sessions, LocalEvidenceStore(tmp_path))

    first, first_input = worker.jobs.claim(UUID(request["jobs"][0]["job"]["job_id"]))
    first_result = worker._run(first, first_input)
    second, second_input = worker.jobs.claim(UUID(standalone["job_id"]))
    second_result = worker._run(second, second_input)
    ready = Barrier(2)
    with ThreadPoolExecutor(2) as executor:

        def publish(job, result):
            ready.wait(timeout=5)
            return worker._publish(job, result)

        first_done = executor.submit(publish, first, first_result)
        second_done = executor.submit(publish, second, second_result)
        assert first_done.result().status == second_done.result().status == "succeeded"
    assert worker._publish(first, first_result).status == "succeeded"
    with pytest.raises(ProfileError, match="pending"):
        worker.execute(first.job_id)

    [listed] = response(client, "GET", "/articles", 200)
    article = "/articles/" + listed["id"]
    assert len(response(client, "GET", article + "/observations", 200)) == 2
    assert len(response(client, "GET", article + "/versions", 200)) == 1
    next_request = refresh(client, request)
    earlier, payload = worker.jobs.claim(UUID(next_request["jobs"][0]["job"]["job_id"]))
    site["cards"] = "Earlier changed title"
    earlier_result = worker._run(earlier, payload)
    site["cards"] = "Latest changed title"
    latest_request = refresh(client, next_request)
    (latest_job,) = run_children(worker, latest_request)
    worker._publish(earlier, earlier_result)

    current = response(client, "GET", article, 200)
    assert current["title"] == "Latest changed title"
    assert current["latest_observation"]["job_id"] == str(latest_job.job_id)
    assert len(response(client, "GET", article + "/versions", 200)) == 3
    assert len(response(client, "GET", article + "/observations", 200)) == 4
    with sessions() as session:
        assert session.scalar(select(func.count()).select_from(ArticleRow)) == 1
        assert session.scalar(select(func.count()).select_from(RequestJobRow)) == 3
        assert session.scalar(select(func.count()).select_from(JobRow)) == 4


@pytest.mark.parametrize("pg_engine", ["0008"], indirect=True)
def test_m7_upgrade_with_populated_database(
    pg_engine, sessions, job_setup, client, legacy_execution_events
):
    _, source, version, entry, store = job_setup
    approve_job_profile(job_setup)
    executor = JobExecutor(sessions, store)
    with legacy_execution_events():
        job, _ = executor.jobs.create(source, version, entry)
        assert executor.execute(job.job_id).status == "succeeded"
    path = f"/collection-jobs/{job.job_id}/evidence-pages"
    [before] = response(client, "GET", path, 200)
    evidence = store.resolve(UUID(before["evidence_id"]).hex)
    config = Config(ROOT / "alembic.ini")
    with pg_engine.begin() as connection:
        config.attributes["connection"] = connection
        command.upgrade(config, "head")
        command.check(config)
    assert response(client, "GET", path, 200) == [before]
    assert store.resolve(UUID(before["evidence_id"]).hex) == evidence
    assert len(response(client, "GET", f"/records?job_id={job.job_id}", 200)) == 1
    assert response(client, "GET", "/articles", 200) == []
    assert response(client, "GET", REQUESTS, 200) == []
    with pytest.raises(IntegrityError), sessions.begin() as session:
        session.add(
            CollectionRequestRow(
                id=uuid4(),
                topic_id=uuid4(),
                topic_name="Invalid",
                request_key=uuid4(),
                keyword="x",
                intent_hash="a" * 64,
            )
        )
