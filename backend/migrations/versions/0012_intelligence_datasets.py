"""Store authorized campaign datasets, lexical terms, and index leases."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "marketing_intelligence_datasets",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("mode", sa.String(length=7), nullable=False),
        sa.Column("workspace", sa.String(length=64), nullable=False),
        sa.Column("dataset_id", sa.String(length=64), nullable=False),
        sa.Column("digest", sa.String(length=64), nullable=True),
        sa.Column(
            "payload",
            postgresql.JSONB(none_as_null=True, astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column(
            "grams",
            postgresql.JSONB(none_as_null=True, astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column(
            "vectors",
            postgresql.JSONB(none_as_null=True, astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column("model_version", sa.String(length=120), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("imported_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("state", sa.String(length=12), nullable=False),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("lease_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("claim", sa.Uuid(), nullable=True),
        sa.Column("index_failures", sa.Integer(), nullable=False),
        sa.CheckConstraint(
            "mode IN ('demo', 'partner')", name="intelligence_dataset_mode"
        ),
        sa.CheckConstraint(
            "state IN ('lexical', 'running', 'ready', 'fallback', 'expired', 'withdrawn')",
            name="intelligence_dataset_state",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "mode", "workspace", "dataset_id", name="intelligence_dataset_identity"
        ),
    )
    op.create_index(
        "intelligence_dataset_expiration",
        "marketing_intelligence_datasets",
        ["expires_at"],
        unique=False,
    )
    op.create_index(
        "intelligence_dataset_index_due",
        "marketing_intelligence_datasets",
        ["state", "due_at"],
        unique=False,
    )


def downgrade():
    op.drop_table("marketing_intelligence_datasets")
