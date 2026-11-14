"""Persist validation reports and protect approved profile snapshots."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "profile_validation_reports",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "profile_version_id",
            sa.Uuid(),
            sa.ForeignKey("profile_versions.id"),
            nullable=False,
        ),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("config_hash", sa.String(64), nullable=False),
        sa.Column("sequence", sa.BigInteger(), sa.Identity(), nullable=False),
        sa.Column("validated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("result", JSONB(), nullable=False),
        sa.UniqueConstraint(
            "profile_version_id", "id", "config_hash", name="uq_validation_snapshot"
        ),
    )
    op.create_index(
        "ix_validation_latest",
        "profile_validation_reports",
        ["profile_version_id", "revision", "sequence"],
    )
    op.create_foreign_key(
        "fk_profile_approved_report",
        "profile_versions",
        "profile_validation_reports",
        ["id", "validation_report_id", "config_hash"],
        ["profile_version_id", "id", "config_hash"],
    )
    op.execute("""
        CREATE FUNCTION protect_approved_profile() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            IF OLD.approval_status IN ('approved', 'retired') THEN
                IF TG_OP = 'DELETE' THEN
                    RAISE EXCEPTION 'Approved profile history is immutable' USING ERRCODE = '23514';
                ELSIF ROW(NEW.id, NEW.source_id, NEW.version, NEW.revision, NEW.configuration,
                          NEW.config_hash, NEW.approved_by, NEW.approved_at,
                          NEW.validation_report_id, NEW.created_at)
                    IS DISTINCT FROM
                      ROW(OLD.id, OLD.source_id, OLD.version, OLD.revision, OLD.configuration,
                          OLD.config_hash, OLD.approved_by, OLD.approved_at,
                          OLD.validation_report_id, OLD.created_at)
                    OR (NEW.approval_status <> OLD.approval_status AND
                        (OLD.approval_status, NEW.approval_status) <> ('approved', 'retired')) THEN
                    RAISE EXCEPTION 'Approved profile history is immutable' USING ERRCODE = '23514';
                END IF;
            END IF;
            IF TG_OP = 'DELETE' THEN
                RETURN OLD;
            END IF;
            RETURN NEW;
        END;
        $$
    """)
    op.execute("""
        CREATE TRIGGER protect_approved_profile
        BEFORE UPDATE OR DELETE ON profile_versions
        FOR EACH ROW EXECUTE FUNCTION protect_approved_profile()
    """)


def downgrade():
    op.execute("DROP TRIGGER protect_approved_profile ON profile_versions")
    op.execute("DROP FUNCTION protect_approved_profile()")
    op.drop_constraint(
        "fk_profile_approved_report", "profile_versions", type_="foreignkey"
    )
    op.drop_table("profile_validation_reports")
