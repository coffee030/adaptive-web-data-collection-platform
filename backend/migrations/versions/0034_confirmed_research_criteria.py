from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


revision = "0034"
down_revision = "0033"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("company_research_runs", sa.Column("criteria_version", sa.String(64)))
    op.add_column("company_research_runs", sa.Column("confirmed_criteria", JSONB))
    op.create_check_constraint(
        "research_confirmed_criteria_pair",
        "company_research_runs",
        "(criteria_version IS NULL AND confirmed_criteria IS NULL) OR "
        "(criteria_version IS NOT NULL AND confirmed_criteria IS NOT NULL "
        "AND jsonb_typeof(confirmed_criteria) = 'object')",
    )


def downgrade():
    op.execute("LOCK TABLE company_research_runs IN ACCESS EXCLUSIVE MODE")
    op.execute("""
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM company_research_runs WHERE confirmed_criteria IS NOT NULL
            ) THEN
                RAISE EXCEPTION 'Cannot remove confirmed criteria while confirmed research runs exist';
            END IF;
        END;
        $$
    """)
    op.drop_constraint(
        "research_confirmed_criteria_pair", "company_research_runs", type_="check"
    )
    op.drop_column("company_research_runs", "confirmed_criteria")
    op.drop_column("company_research_runs", "criteria_version")
