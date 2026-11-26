import hashlib
import json
from dataclasses import replace

import pytest
from pydantic import ValidationError

from backend.application.retry import retry_delay
from backend.core.contracts import (
    CollectionError,
    ControlledRendering,
    ExtractionConfiguration,
    Source,
    SourceProfileVersion,
)
from backend.core.evidence import EvidenceError, LocalEvidenceStore
from backend.core.inputs import CapturedInput, InputError
from backend.core.rendering import permitted_render_origin, render_document
from backend.tests.rendered_fixture import DIGEST, page


ORIGIN = "http://127.0.0.1:8091"


def source(origin=ORIGIN):
    return Source(
        source_id="test-source",
        source_name="Local test fixture",
        adapter_type="web",
        approval_status="approved",
        permission_reference="Self-authored test",
        allowed_origins=[origin],
    )


def test_opt_in_preserves_approved_static_profiles_and_bounds(
    cards_config, monkeypatch
):
    values = cards_config.model_dump(mode="json")
    assert "rendering" not in values
    expected = hashlib.sha256(
        json.dumps(values, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    assert cards_config.config_hash() == expected
    config = ControlledRendering(ready_selector="#ready", script_sha256=[DIGEST])
    assert (
        ExtractionConfiguration.model_validate(
            {**values, "rendering": config}
        ).config_hash()
        != expected
    )
    with pytest.raises(ValidationError):
        ExtractionConfiguration.model_validate(
            {
                **values,
                "rendering": config,
                "pagination": {"next_link_selector": "a", "max_pages": 2},
            }
        )
    for invalid in (
        {"script_sha256": []},
        {"script_sha256": ["wrong"]},
        {"timeout_ms": 5001},
    ):
        with pytest.raises(ValidationError):
            ControlledRendering.model_validate({**config.model_dump(), **invalid})
    monkeypatch.delenv("CORE_RENDER_FIXTURE_ORIGIN", raising=False)
    assert permitted_render_origin(source()) is None
    monkeypatch.setenv("CORE_RENDER_FIXTURE_ORIGIN", ORIGIN)
    assert permitted_render_origin(source()) == ORIGIN
    assert (
        permitted_render_origin(
            source().model_copy(update={"approval_status": "revoked"})
        )
        is None
    )
    monkeypatch.setenv("CORE_RENDER_FIXTURE_ORIGIN", "https://example.com")
    assert permitted_render_origin(source("https://example.com")) is None


def test_script_and_http_csp_fail_before_browser(monkeypatch):
    monkeypatch.setenv("CORE_RENDER_FIXTURE_ORIGIN", ORIGIN)
    monkeypatch.setattr("backend.core.rendering.shutil.which", lambda _: "node")

    def unexpected(*args):
        pytest.fail("A rejected input reached Chromium")

    monkeypatch.setattr("backend.core.rendering._run_browser", unexpected)
    cfg = ControlledRendering(ready_selector="#catalog-ready", script_sha256=[DIGEST])
    doc = CapturedInput(
        body=page("/catalog/unknown-script"),
        location=ORIGIN + "/catalog/unknown-script",
    )
    for input_document, code in (
        (doc, "render_script_denied"),
        (replace(doc, publisher_csp="script-src 'none'"), "render_policy_denied"),
        (
            replace(doc, body=b'<main></main><script src="/module.js"></script>'),
            "render_script_denied",
        ),
    ):
        with pytest.raises(InputError) as caught:
            render_document(source(), input_document, cfg)
        assert (
            caught.value.error.code == code and caught.value.capture is input_document
        )
    assert (
        retry_delay(
            CollectionError(code="render_timeout", message="Missing readiness"), 1
        ).total_seconds()
        == 10
    )
    assert (
        retry_delay(
            CollectionError(
                code="render_script_denied", message="Unapproved inline script"
            ),
            1,
        )
        is None
    )


def test_actual_offline_rendering_recovery_and_integrity(
    monkeypatch, tmp_path, cards_config, controlled_site
):
    origin, requests, _ = controlled_site
    monkeypatch.setenv("CORE_RENDER_FIXTURE_ORIGIN", origin)
    approved_source = source(origin)
    doc = CapturedInput(
        body=page("/catalog/products"),
        location=origin + "/catalog/products",
        content_type="text/html",
    )
    cfg = ControlledRendering(ready_selector="#catalog-ready", script_sha256=[DIGEST])
    with pytest.raises(InputError) as caught:
        render_document(
            approved_source,
            doc,
            cfg.model_copy(update={"ready_selector": "#absent", "timeout_ms": 250}),
        )
    assert caught.value.error.code == "render_timeout"
    request_script = "fetch('/extra').catch(() => {});"
    requesting = replace(
        doc, body=("<main></main><script>" + request_script + "</script>").encode()
    )
    request_config = ControlledRendering(
        ready_selector="#never",
        script_sha256=[hashlib.sha256(request_script.encode()).hexdigest()],
    )
    with pytest.raises(InputError) as blocked:
        render_document(approved_source, requesting, request_config)
    assert blocked.value.error.code == "render_resource_denied"
    assert not requests
    rendered = render_document(approved_source, doc, cfg)
    assert (
        rendered.body == doc.body
        and b"<article>" not in doc.body
        and rendered.rendered_body.count(b"<article>") == 10
    )
    assert (
        rendered.rendered_dom.sha256
        == hashlib.sha256(rendered.rendered_body).hexdigest()
    )
    profile_config = cards_config.model_copy(update={"rendering": cfg})
    profile = SourceProfileVersion(
        profile_version_id="version",
        source_id="test-source",
        version=1,
        configuration=profile_config,
        config_hash=profile_config.config_hash(),
    )
    store = LocalEvidenceStore(tmp_path)
    reference = store.save(rendered, profile, "run")
    assert store.resolve(reference.evidence_id) == (reference, doc.body)
    (tmp_path / reference.evidence_id / "rendered.html").write_bytes(b"corrupt")
    with pytest.raises(EvidenceError) as damaged:
        store.resolve(reference.evidence_id)
    assert damaged.value.code == "evidence_integrity_error"
