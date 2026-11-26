from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "0016"
down_revision = "0015"
branch_labels = None
depends_on = None


def upgrade():
    parent = "marketing_company_campaigns"
    op.add_column(
        parent,
        sa.Column("status", sa.String(12), server_default="planning", nullable=False),
    )
    op.add_column(
        parent,
        sa.Column("tracking_version", sa.Integer(), server_default="0", nullable=False),
    )
    op.create_table(
        "marketing_campaign_periods",
        sa.Column("company_id", sa.String(64), primary_key=True),
        sa.Column("campaign_id", sa.Uuid, primary_key=True),
        sa.Column("id", sa.Uuid, primary_key=True),
        sa.Column("channel", sa.String(60), nullable=False),
        sa.Column("period_start", sa.Date, nullable=False),
        sa.Column("period_end", sa.Date, nullable=False),
        sa.Column("report", JSONB, nullable=False),
        sa.Column("recorded_by", sa.String(80), nullable=False),
        sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["company_id", "campaign_id"],
            [parent + ".company_id", parent + ".id"],
            ondelete="CASCADE",
        ),
    )


def downgrade():
    op.drop_table("marketing_campaign_periods")
    op.drop_column("marketing_company_campaigns", "tracking_version")
    op.drop_column("marketing_company_campaigns", "status")
