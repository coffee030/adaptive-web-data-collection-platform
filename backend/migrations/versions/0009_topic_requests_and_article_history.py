"""Add the topic catalog, collection requests, and article history."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "categories",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column(
            "active", sa.Boolean(), server_default=sa.text("true"), nullable=False
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "uq_category_name",
        "categories",
        [sa.literal_column("lower(name)")],
        unique=True,
    )
    op.create_table(
        "articles",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("source_id", sa.Uuid(), nullable=False),
        sa.Column("identity_hash", sa.String(length=64), nullable=False),
        sa.Column("identity_kind", sa.String(length=3), nullable=False),
        sa.ForeignKeyConstraint(
            ["source_id"],
            ["sources.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "source_id", "identity_hash", name="uq_source_article_identity"
        ),
    )
    op.create_table(
        "topics",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("category_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column(
            "active", sa.Boolean(), server_default=sa.text("true"), nullable=False
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["category_id"],
            ["categories.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "uq_topic_category_name",
        "topics",
        ["category_id", sa.literal_column("lower(name)")],
        unique=True,
    )
    op.create_table(
        "article_content_versions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("article_id", sa.Uuid(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("content_hash", sa.String(length=64), nullable=False),
        sa.Column("content", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint("version > 0", name="ck_article_version_positive"),
        sa.ForeignKeyConstraint(
            ["article_id"],
            ["articles.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "article_id", "content_hash", name="uq_article_content_hash"
        ),
        sa.UniqueConstraint("article_id", "id", name="uq_article_version_id"),
        sa.UniqueConstraint("article_id", "version", name="uq_article_version"),
    )
    op.create_table(
        "collection_requests",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("topic_id", sa.Uuid(), nullable=False),
        sa.Column("topic_name", sa.String(length=128), nullable=False),
        sa.Column("keyword", sa.String(length=128), nullable=False),
        sa.Column("request_key", sa.Uuid(), nullable=False),
        sa.Column("intent_hash", sa.String(length=64), nullable=False),
        sa.Column("refresh_of", sa.Uuid(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["refresh_of"],
            ["collection_requests.id"],
        ),
        sa.ForeignKeyConstraint(
            ["topic_id"],
            ["topics.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("request_key"),
    )
    op.create_index(
        "ix_request_created", "collection_requests", ["created_at", "id"], unique=False
    )
    op.create_table(
        "topic_bindings",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("topic_id", sa.Uuid(), nullable=False),
        sa.Column("source_id", sa.Uuid(), nullable=False),
        sa.Column("profile_version_id", sa.Uuid(), nullable=False),
        sa.Column("config_hash", sa.String(length=64), nullable=False),
        sa.Column("approved_by", sa.String(length=128), nullable=False),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("disabled_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["source_id", "profile_version_id", "config_hash"],
            [
                "profile_versions.source_id",
                "profile_versions.id",
                "profile_versions.config_hash",
            ],
            name="fk_binding_profile_pin",
        ),
        sa.ForeignKeyConstraint(
            ["topic_id"],
            ["topics.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "topic_id", "source_id", "profile_version_id", name="uq_topic_binding"
        ),
    )
    op.create_table(
        "collection_request_jobs",
        sa.Column("job_id", sa.Uuid(), nullable=False),
        sa.Column("request_id", sa.Uuid(), nullable=False),
        sa.Column("binding_id", sa.Uuid(), nullable=False),
        sa.Column("approved_by", sa.String(length=128), nullable=False),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["binding_id"],
            ["topic_bindings.id"],
        ),
        sa.ForeignKeyConstraint(
            ["job_id"],
            ["collection_jobs.id"],
        ),
        sa.ForeignKeyConstraint(
            ["request_id"],
            ["collection_requests.id"],
        ),
        sa.PrimaryKeyConstraint("job_id"),
        sa.UniqueConstraint("request_id", "binding_id", name="uq_request_binding"),
    )
    op.create_table(
        "article_observations",
        sa.Column("record_id", sa.Uuid(), nullable=False),
        sa.Column("article_id", sa.Uuid(), nullable=False),
        sa.Column("content_version_id", sa.Uuid(), nullable=False),
        sa.Column("captured_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("url", sa.String(length=2048), nullable=False),
        sa.Column(
            "raw_payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False
        ),
        sa.ForeignKeyConstraint(
            ["article_id", "content_version_id"],
            ["article_content_versions.article_id", "article_content_versions.id"],
            name="fk_observation_article_version",
        ),
        sa.ForeignKeyConstraint(
            ["record_id"],
            ["generic_records.id"],
        ),
        sa.PrimaryKeyConstraint("record_id"),
    )
    op.create_index(
        "ix_article_latest_observation",
        "article_observations",
        ["article_id", "captured_at", "record_id"],
        unique=False,
    )


def downgrade():
    op.drop_index("ix_article_latest_observation", table_name="article_observations")
    op.drop_table("article_observations")
    op.drop_table("collection_request_jobs")
    op.drop_table("topic_bindings")
    op.drop_index("ix_request_created", table_name="collection_requests")
    op.drop_table("collection_requests")
    op.drop_table("article_content_versions")
    op.drop_index("uq_topic_category_name", table_name="topics")
    op.drop_table("topics")
    op.drop_table("articles")
    op.drop_index("uq_category_name", table_name="categories")
    op.drop_table("categories")
