from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "marketing_companies",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("name", sa.String(120), nullable=False, unique=True),
    )
    op.create_table(
        "marketing_company_members",
        sa.Column("username", sa.String(80), primary_key=True),
        sa.Column(
            "company_id",
            sa.String(64),
            sa.ForeignKey("marketing_companies.id"),
            nullable=False,
            index=True,
        ),
        sa.Column("role", sa.String(8), nullable=False),
        sa.Column("password_hash", sa.String(192), nullable=False),
        sa.Column("failed_attempts", sa.Integer, nullable=False),
        sa.Column("locked_until", sa.DateTime(timezone=True)),
        sa.CheckConstraint("role IN ('admin', 'member')", name="company_member_role"),
    )
    op.create_table(
        "marketing_company_sessions",
        sa.Column("digest", sa.String(64), primary_key=True),
        sa.Column(
            "username",
            sa.String(80),
            sa.ForeignKey("marketing_company_members.username", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), index=True, nullable=False),
    )
    op.create_table(
        "marketing_company_campaigns",
        sa.Column(
            "company_id",
            sa.String(64),
            sa.ForeignKey("marketing_companies.id"),
            primary_key=True,
        ),
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("version", sa.Integer, nullable=False),
        sa.Column("draft", postgresql.JSONB, nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade():
    op.drop_table("marketing_company_campaigns")
    op.drop_table("marketing_company_sessions")
    op.drop_table("marketing_company_members")
    op.drop_table("marketing_companies")
