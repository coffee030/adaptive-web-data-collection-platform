import hashlib
import json
import os
import shutil
import signal
import subprocess
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path

from lxml import etree, html

from .contracts import ControlledRendering, RenderedEvidence, Source, controlled_origin
from .inputs import CapturedInput, InputError
from .web_adapter import MAX_BODY_BYTES, _decode_html, checked_url

BROWSER_PROCESS_OVERHEAD_SECONDS = 15

ERRORS = {
    "render_script_denied": "The document uses an external or unapproved script.",
    "render_resource_denied": "The offline document requested a blocked resource or navigation.",
    "render_timeout": "The rendered document did not become ready before its time limit.",
    "render_dom_limit": "The rendered HTML exceeds the 1 MiB document limit.",
    "invalid_selector": "The renderer could not apply the CSS readiness selector.",
    "render_unavailable": "The configured isolated Chromium renderer is unavailable.",
    "render_policy_denied": "The offline renderer could not honor the document's security policy.",
}


def permitted_render_origin(source: Source) -> str | None:
    origin = os.environ.get("CORE_RENDER_FIXTURE_ORIGIN", "")
    if (
        source.approval_status != "approved"
        or not origin.startswith("http://")
        or origin not in source.allowed_origins
    ):
        return None
    try:
        return controlled_origin(origin)
    except ValueError:
        return None


def require_render_origin(source: Source, origin: str) -> None:
    if permitted_render_origin(source) != origin:
        raise InputError(
            "render_origin_denied",
            "Rendering requires the deployment's approved local fixture origin.",
        )


def _run_browser(
    node: str, payload: bytes, environment: dict[str, str], timeout: float
) -> bytes:
    with subprocess.Popen(
        [node, str(Path(__file__).with_name("render_document.cjs"))],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        env=environment,
        start_new_session=os.name != "nt",
    ) as process:
        try:
            data, _ = process.communicate(payload, timeout=timeout)
        except subprocess.TimeoutExpired:
            try:
                if os.name == "nt":
                    taskkill = (
                        Path(os.environ["SystemRoot"]) / "System32" / "taskkill.exe"
                    )
                    subprocess.run(
                        [str(taskkill), "/pid", str(process.pid), "/t", "/f"],
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL,
                        timeout=4,
                        check=False,
                    )
                else:
                    os.killpg(process.pid, signal.SIGTERM)
                    try:
                        process.wait(timeout=2)
                    except subprocess.TimeoutExpired:
                        os.killpg(process.pid, signal.SIGKILL)
            except (OSError, subprocess.TimeoutExpired):
                pass
            finally:
                if process.poll() is None:
                    process.kill()
                process.communicate(timeout=2)
            raise
        return data


def render_document(
    source: Source, document: CapturedInput, config: ControlledRendering
) -> CapturedInput:
    _, origin = checked_url(source, document.location)
    require_render_origin(source, origin)
    if document.publisher_csp:
        raise InputError(
            "render_policy_denied", ERRORS["render_policy_denied"], capture=document
        )
    node = shutil.which("node")
    if not node:
        raise InputError(
            "render_unavailable", ERRORS["render_unavailable"], capture=document
        )
    text = _decode_html(document)
    try:
        parsed = html.document_fromstring(text)
    except (etree.ParserError, ValueError) as error:
        raise InputError(
            "render_script_denied", ERRORS["render_script_denied"], capture=document
        ) from error
    approved_script = False
    for script in parsed.iter("script"):
        kind = (script.get("type") or "").strip().lower()
        if (
            kind in {"application/json", "application/ld+json"}
            and script.get("src") is None
        ):
            continue
        digest = hashlib.sha256((script.text or "").encode("utf-8")).hexdigest()
        if (
            script.get("src") is not None
            or kind not in {"", "text/javascript", "application/javascript"}
            or digest not in config.script_sha256
        ):
            raise InputError(
                "render_script_denied", ERRORS["render_script_denied"], capture=document
            )
        approved_script = True
    if not approved_script:
        raise InputError(
            "render_script_denied", ERRORS["render_script_denied"], capture=document
        )
    body = json.dumps(
        {
            "html": text,
            "url": document.location,
            "config": config.model_dump(),
            "limit": MAX_BODY_BYTES,
        },
        ensure_ascii=False,
    ).encode("utf-8")
    env = {
        name: os.environ[name]
        for name in (
            "PATH",
            "SystemRoot",
            "TEMP",
            "TMP",
            "TMPDIR",
            "HOME",
            "USERPROFILE",
            "LOCALAPPDATA",
            "PROGRAMFILES",
            "PROGRAMFILES(X86)",
            "PLAYWRIGHT_BROWSERS_PATH",
            "CORE_RENDER_BROWSER",
        )
        if name in os.environ
    }
    if modules := os.environ.get("CORE_RENDER_NODE_MODULES"):
        env["NODE_PATH"] = modules
    try:
        process_timeout = BROWSER_PROCESS_OVERHEAD_SECONDS + config.timeout_ms / 1000
        reply = json.loads(_run_browser(node, body, env, process_timeout))
        if "error" in reply:
            code = reply.get("error", "render_unavailable")
            raise InputError(
                code if code in ERRORS else "render_unavailable",
                ERRORS.get(code, ERRORS["render_unavailable"]),
                capture=document,
            )
        rendered = reply["html"].encode("utf-8")
        if not 0 < len(rendered) <= MAX_BODY_BYTES:
            raise InputError(
                "render_dom_limit", ERRORS["render_dom_limit"], capture=document
            )
        metadata = RenderedEvidence(
            sha256=hashlib.sha256(rendered).hexdigest(),
            byte_count=len(rendered),
            rendered_at=datetime.now(UTC),
            engine=reply["engine"],
        )
    except subprocess.TimeoutExpired as error:
        raise InputError(
            "render_timeout", ERRORS["render_timeout"], capture=document
        ) from error
    except InputError:
        raise
    except (OSError, ValueError, KeyError, AttributeError) as error:
        raise InputError(
            "render_unavailable", ERRORS["render_unavailable"], capture=document
        ) from error
    return replace(document, rendered_body=rendered, rendered_dom=metadata)
