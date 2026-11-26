from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "core_render_01"
down_revision = "core_trends_01"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("raw_evidence", sa.Column("rendered_dom", JSONB, nullable=True))


def downgrade():
    op.drop_column("raw_evidence", "rendered_dom")
