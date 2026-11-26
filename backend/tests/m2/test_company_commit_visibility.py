from uuid import uuid4

from sqlalchemy import select
from test_process_restart import child_environment, server

from backend.marketing.company_models import CompanyRow, CompanySessionRow


def test_account_and_session_are_committed_before_the_http_response(
    pg_engine, pg_url, pg_schema, tmp_path
):
    with pg_engine.begin() as connection:
        connection.exec_driver_sql("""
            CREATE FUNCTION hold_company_commit() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN PERFORM pg_sleep(0.5); RETURN NEW; END $$""")
        for table in ("marketing_companies", "marketing_company_sessions"):
            connection.exec_driver_sql(
                f"CREATE CONSTRAINT TRIGGER delay_commit AFTER INSERT ON {table} "
                "DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION hold_company_commit()"
            )
    operator = "controlled-operator-" + uuid4().hex
    env = child_environment(pg_url, pg_schema, tmp_path) | {
        "MARKETING_PILOT_PASSWORD": "controlled-company-pilot",
        "MARKETING_OPERATOR_TOKEN": operator,
        "MARKETING_CUSTOMER_TOKEN": "controlled-customer-" + uuid4().hex,
        "MARKETING_PARTNER_WORKSPACE": "commit-check",
    }
    member = {"username": "commit-member", "password": "controlled-member-password"}
    api = "/api/v1/marketing/companies"
    with server(env, tmp_path / "api.log") as (_, http):
        registered = http.post(
            api + "/registry",
            json={**member, "name": "Commit visibility"},
            headers={"Authorization": "Bearer " + operator},
        )
        assert registered.status_code == 201, registered.text
        with pg_engine.connect() as verifier:
            assert (
                verifier.scalar(
                    select(CompanyRow.name).where(
                        CompanyRow.id == registered.json()["id"]
                    )
                )
                == "Commit visibility"
            )
        signed = http.post(api + "/session", json=member)
        assert signed.status_code == 200, signed.text
        with pg_engine.connect() as verifier:
            assert (
                verifier.scalar(select(CompanySessionRow.username))
                == member["username"]
            )
        assert http.get(api + "/session").json()["id"] == registered.json()["id"]
