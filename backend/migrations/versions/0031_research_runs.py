from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


revision = "0031"
down_revision = "0030"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "company_research_runs",
        sa.Column("id", sa.Uuid, primary_key=True),
        sa.Column(
            "company_id",
            sa.String(64),
            sa.ForeignKey("marketing_companies.id"),
            nullable=False,
        ),
        sa.Column("campaign_id", sa.Uuid),
        sa.Column("request_key", sa.Uuid, nullable=False),
        sa.Column("brief", JSONB, nullable=False),
        sa.Column("state", sa.String(12), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("claim", sa.Uuid),
        sa.Column("attempts", sa.Integer, nullable=False),
        sa.Column("sources", JSONB, nullable=False),
        sa.Column("error", sa.String(64)),
        sa.Column("revision", sa.String(64)),
        sa.UniqueConstraint(
            "company_id", "request_key", name="uq_company_research_request"
        ),
        sa.ForeignKeyConstraint(
            ["company_id", "campaign_id"],
            [
                "marketing_company_campaigns.company_id",
                "marketing_company_campaigns.id",
            ],
        ),
        sa.CheckConstraint(
            "state IN ('queued','collecting','analyzing','ready','failed','cancelled')",
            name="research_run_state",
        ),
    )
    op.create_index(
        "ix_company_research_due", "company_research_runs", ["state", "due_at"]
    )
    op.create_index(
        "ix_company_research_recent",
        "company_research_runs",
        ["company_id", "created_at"],
    )


def downgrade():
    op.drop_table("company_research_runs")
