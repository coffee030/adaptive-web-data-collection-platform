from alembic import context

from backend.persistence import collection  # noqa: F401 — register M8 tables
from backend.persistence.database import database_url, make_engine
from backend.persistence.models import Base


def configure(connection=None):
    if connection is None:
        context.configure(
            url=database_url(), target_metadata=Base.metadata, literal_binds=True
        )
    else:
        context.configure(connection=connection, target_metadata=Base.metadata)
    with context.begin_transaction():
        context.run_migrations()


if context.is_offline_mode():
    configure()
elif (connection := context.config.attributes.get("connection")) is not None:
    configure(connection)
else:
    engine = make_engine(database_url())
    try:
        with engine.connect() as connection:
            configure(connection)
    finally:
        engine.dispose()
