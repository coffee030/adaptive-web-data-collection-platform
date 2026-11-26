"""Run a real MCP client and stdio subprocess against the API and disposable PostgreSQL."""

import os
import subprocess
from uuid import uuid4

import pytest
from conftest import ROOT
from test_company_workspaces import BASE, DATA, DRAFT
from test_intelligence import (
    BRIEF,
    CUSTOMER_TOKEN,
    OP,
    OPERATOR_TOKEN,
    WORKSPACE,
    demo_body,
    grant,
    timestamps,
)
from test_process_restart import child_environment, server

from backend.intelligence.contracts import ORIGINS


def test_company_marketing_mcp(pg_engine, pg_url, pg_schema, tmp_path):
    python = os.environ.get("HARBOURLINE_MCP_TEST_PYTHON")
    if not python:
        pytest.skip("Set HARBOURLINE_MCP_TEST_PYTHON to the optional MCP interpreter")
    env = child_environment(pg_url, pg_schema, tmp_path) | {
        "MARKETING_PILOT_PASSWORD": "controlled-browser-password",
        "MARKETING_PARTNER_WORKSPACE": WORKSPACE,
        "MARKETING_CUSTOMER_TOKEN": CUSTOMER_TOKEN,
        "MARKETING_OPERATOR_TOKEN": OPERATOR_TOKEN,
    }
    password = "controlled-test-member-password"
    with server(env, tmp_path / "api.log") as (_, http):

        def account(name):
            receipt = http.post(
                BASE + "/registry",
                headers=OP,
                json={"name": name, "username": name, "password": password},
            )
            assert receipt.status_code == 201, receipt.text
            return receipt.json()["id"]

        def sign(user):
            http.cookies.clear()
            receipt = http.post(
                BASE + "/session", json={"username": user, "password": password}
            )
            assert receipt.status_code == 200, receipt.text
            return http.cookies.get("harbourline_company_session")

        alpha = account("research-alpha")
        beta = account("research-beta")
        beta_session = sign("research-beta")
        sign("research-alpha")
        member = {
            "username": "research-planner",
            "password": password,
            "role": "member",
        }
        assert http.post(BASE + "/members", json=member).status_code == 201
        user_session = sign(member["username"])
        _, end = timestamps()
        for record in demo_body()["records"]:
            if record["id"] in ("c-audience", "a-post-copy"):
                continue
            permission = grant(
                ORIGINS[record["kind"]],
                end,
                record["creator_id"],
                pilot_analytics=True,
                commercial_display=True,
            )
            receipt = http.put(
                DATA + "/operator/partner/datasets/" + record["id"],
                params={"company": alpha},
                headers=OP,
                json={"grant": permission, "records": [record]},
            )
            assert receipt.status_code == 200, receipt.text
        campaign_id = str(uuid4())
        draft = {
            **DRAFT,
            "evaluation": BRIEF,
            "shortlist": ["a", "b", "c"],
            "scenario": {"currency": "HKD", "impressions": 1000},
        }
        assert (
            http.put(
                BASE + "/campaigns/" + campaign_id, json={"version": 0, "draft": draft}
            ).status_code
            == 200
        )
        client_env = os.environ.copy()
        command = [python, "-m", "mcp_access.tests.company_client"]
        if os.name == "nt":
            client_env.pop("PSMODULEPATH", None)
            command = [
                "powershell.exe",
                "-NoProfile",
                "-Command",
                """
$ErrorActionPreference = 'Stop'
$password = ConvertTo-SecureString $env:MCP_TEST_PASSWORD -AsPlainText -Force
$credential = [PSCredential]::new('research-planner', $password)
& ./mcp_access/Connect-HarbourlineMcp.ps1 -ApiBase $env:MCP_TEST_API_BASE -Credential $credential
if ($env:HARBOURLINE_MCP_COMPANY_ID -ne $env:MCP_TEST_COMPANY -or $env:HARBOURLINE_MCP_ALLOW_BUDGET_EDITS -ne '0') { throw 'Unexpected company scope' }
$env:MCP_TEST_MEMBER_SESSION = $env:HARBOURLINE_MCP_SESSION
& $env:HARBOURLINE_MCP_TEST_PYTHON -m mcp_access.tests.company_client
exit $LASTEXITCODE
""",
            ]
        result = subprocess.run(
            command,
            cwd=ROOT,
            check=False,
            env=client_env
            | {
                "MCP_TEST_API_BASE": str(http.base_url).rstrip("/") + "/api/v1",
                "MCP_TEST_CAMPAIGN": campaign_id,
                "MCP_TEST_MEMBER_SESSION": user_session,
                "MCP_TEST_PASSWORD": password,
                "MCP_TEST_COMPANY": alpha,
                "MCP_TEST_OTHER": beta,
                "MCP_TEST_OTHER_SESSION": beta_session,
            },
            capture_output=True,
            text=True,
            timeout=100,
        )
        assert result.returncode == 0, result.stdout + result.stderr
        print(result.stdout)
