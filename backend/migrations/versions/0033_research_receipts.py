from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


revision = "0033"
down_revision = "0032"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("company_research_runs", sa.Column("review", JSONB))


def downgrade():
    op.drop_column("company_research_runs", "review")
