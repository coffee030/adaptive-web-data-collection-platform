"""Track approval and the last validated public directory snapshot."""

from alembic import op
import sqlalchemy as sa

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "public_directory_feed",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("source_id", sa.Uuid, sa.ForeignKey("sources.id"), nullable=False),
        sa.Column(
            "profile_id", sa.Uuid, sa.ForeignKey("profile_versions.id"), nullable=False
        ),
        sa.Column("pending", sa.Uuid, sa.ForeignKey("collection_jobs.id")),
        sa.Column("published", sa.Uuid, sa.ForeignKey("collection_jobs.id")),
        sa.Column("next_attempt", sa.DateTime(timezone=True), nullable=False),
        sa.Column("error", sa.String(64)),
    )


def downgrade():
    op.drop_table("public_directory_feed")
