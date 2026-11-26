from alembic import context

from backend.intelligence import public_directory  # noqa: F401
from backend.intelligence import models as intelligence  # noqa: F401 — register intelligence tables
from backend.marketing import company_models  # noqa: F401
from backend.marketing import models as marketing  # noqa: F401 — register marketing tables
from backend.persistence import collection  # noqa: F401 — register M8 tables
from backend.persistence.database import database_url, make_engine
from backend.persistence.models import Base
from backend.trends import models as trends  # noqa: F401
from backend.trends import rss_models  # noqa: F401


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
