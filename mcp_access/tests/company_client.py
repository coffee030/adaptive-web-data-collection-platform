"""Exercise the marketing tools against accounts provisioned by the live API test."""

import asyncio
import os
import sys
from decimal import Decimal
from pathlib import Path

import httpx2
from mcp import Client, StdioServerParameters

ROOT = Path(__file__).resolve().parents[2]


def connection(base, mode, **environment):
    return Client(
        StdioServerParameters(
            command=sys.executable,
            args=["-m", "mcp_access.harbourline"],
            cwd=ROOT,
            env={
                "FYP_MCP_API_BASE": base,
                "HARBOURLINE_MCP_WORKSPACE": mode,
                **environment,
            },
        ),
        mode="legacy",
        read_timeout_seconds=40,
    )


async def read(client, tool, **arguments):
    result = await client.call_tool(tool, arguments)
    assert not result.is_error, result.content
    return result.structured_content


async def denied(client, tool, match, **arguments):
    result = await client.call_tool(tool, arguments)
    assert result.is_error and match in result.content[0].text, result.content


async def exercise():
    base = os.environ["MCP_TEST_API_BASE"]
    campaign = os.environ["MCP_TEST_CAMPAIGN"]
    cookie = os.environ["MCP_TEST_MEMBER_SESSION"]
    settings = {
        "HARBOURLINE_MCP_COMPANY_ID": os.environ["MCP_TEST_COMPANY"],
        "HARBOURLINE_MCP_SESSION": cookie,
    }
    async with connection(base, "company", **settings) as member:
        tools = (await member.list_tools()).tools
        assert {
            "get_research_findings",
            "get_research_progress",
            "get_campaign_performance",
            "export_campaign_performance",
        } <= {tool.name for tool in tools} and all(
            tool.annotations.read_only_hint for tool in tools
        )
        assert "change_campaign_budget" not in {tool.name for tool in tools}
        records = await read(
            member, "search_creators", filters={"language": "yue"}, limit=1
        )
        assert records["total"] == 3 and records["next_offset"] == 1
        assert records["items"][0]["profile"]["data"]["creator_id"] == "a"
        fees = await read(member, "inspect_creator", creator_id="a")
        assert (
            fees["creator"]["quotes"][0]["evidence"]["reference"] == "receipt-a-quote"
        )
        compared = await read(
            member, "compare_creators", creator_ids=["a", "c", "unknown"]
        )
        assert compared["unavailable_ids"] == ["unknown"]
        assert compared["creators"][1]["pricing"] == "unknown"
        assert compared["creators"][1]["audience"] == "unknown"
        criteria = await read(member, "campaign_criteria", platform="youtube")
        assert criteria["reviewed_facts"] == ["stroller_access"]
        assert criteria["quoted_deliverables"] == ["video_integration"]
        listed = await read(member, "list_saved_campaigns")
        assert [item["name"] for item in listed["items"]] == ["Tea launch"]
        saved = await read(member, "get_saved_campaign", campaign_id=campaign)
        assert saved["version"] == 1
        brief = saved["draft"]["evaluation"]
        plan = await read(member, "evaluate_campaign", brief=brief)
        assert (
            plan["plan"]["status"] == "optimal" and plan["plan"]["total_minor"] == 6000
        )
        assert plan["plan"]["selected"] == ["a", "b"]
        assert plan["categories"]["source"] == "suggested"
        assert plan["candidates"]["items"][0]["requirement_evidence"][
            "stroller_access"
        ]["reference"]
        no_quote = next(
            item for item in plan["candidates"]["items"] if item["creator_id"] == "c"
        )
        assert "confirmed_quote_unavailable" in no_quote["limitations"]
        reduced = await read(
            member, "evaluate_campaign", brief={**brief, "budget_minor": 5999}
        )
        assert reduced["plan"]["status"] == "infeasible"
        scenario = await read(
            member,
            "calculate_campaign_scenario",
            assumptions={"currency": "HKD", "impressions": 1000, "click_rate": "0.02"},
        )
        assert (
            scenario["basis"] == "assumption_based"
            and Decimal(scenario["clicks"]["value"]) == 20
        )
        assert scenario["roi"]["status"] == "unavailable"
        print(
            f"Member: {len(tools)} read tools, 3 candidates, a+b at HKD 60.00, HKD 59.99 infeasible, {plan['retrieval']}."
        )
    async with connection(
        base, "company", **settings, HARBOURLINE_MCP_ALLOW_BUDGET_EDITS="1"
    ) as editor:
        before = await read(editor, "get_saved_campaign", campaign_id=campaign)
        receipt = await read(
            editor,
            "change_campaign_budget",
            campaign_id=campaign,
            expected_version=1,
            budget_hkd_cents=5999,
        )
        assert receipt["version"] == 2
        after = await read(editor, "get_saved_campaign", campaign_id=campaign)
        expected = before["draft"]
        expected["brief"]["budget"] = 59.99
        expected["evaluation"]["budget_minor"] = 5999
        assert after["draft"] == expected
        await denied(
            editor,
            "change_campaign_budget",
            "changed",
            campaign_id=campaign,
            expected_version=1,
            budget_hkd_cents=1000,
        )
        print(
            "Budget: revision 1 to 2, untouched draft fields preserved, stale write rejected."
        )
    async with connection(
        base,
        "company",
        HARBOURLINE_MCP_COMPANY_ID=os.environ["MCP_TEST_OTHER"],
        HARBOURLINE_MCP_SESSION=os.environ["MCP_TEST_OTHER_SESSION"],
    ) as other:
        assert not (await read(other, "list_saved_campaigns"))["items"]
        assert not (await read(other, "search_creators", filters={}))["items"]
        await denied(other, "get_saved_campaign", "404", campaign_id=campaign)
        print(
            "Other company: empty search and campaign list, cross-company campaign unavailable."
        )
    async with connection(base, "company", **settings) as member:
        async with httpx2.AsyncClient(
            trust_env=False, cookies={"harbourline_company_session": cookie}
        ) as http:
            assert (
                await http.delete(base + "/marketing/companies/session")
            ).status_code == 204
        await denied(member, "list_saved_campaigns", "401")
        print("Revoked member session: subsequent list rejected.")


if __name__ == "__main__":
    asyncio.run(exercise())
