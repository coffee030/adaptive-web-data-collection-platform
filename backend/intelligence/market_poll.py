"""Keep publisher network requests outside the Core dispatcher polling loop."""

import logging
from concurrent.futures import ThreadPoolExecutor
from time import monotonic

from sqlalchemy.exc import SQLAlchemyError

from .market_collection import collect, publish
from .market_sources import SOURCES

LOG = logging.getLogger(__name__)


def maintain_source(sessions, key):
    publish(sessions, key)
    if collect(sessions, key):
        publish(sessions, key)


class MarketPoll:
    def __init__(self, sessions):
        self.sessions = sessions
        self.pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="publisher")
        self.pending = {}
        self.next_poll = 0.0

    def poll(self):
        if self.next_poll > monotonic():
            return
        self.next_poll = monotonic() + 5
        for key in SOURCES:
            previous = self.pending.get(key)
            if previous and not previous.done():
                continue
            if previous:
                try:
                    previous.result()
                except SQLAlchemyError as error:
                    LOG.warning(
                        "Publisher storage unavailable for %s (%s)",
                        key,
                        type(error).__name__,
                    )
                except Exception:
                    LOG.exception("Publisher maintenance failed for %s", key)
            self.pending[key] = self.pool.submit(maintain_source, self.sessions, key)

    def close(self):
        self.pool.shutdown(wait=True)
