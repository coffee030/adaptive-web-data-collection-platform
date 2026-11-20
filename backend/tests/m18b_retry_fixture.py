"""Serve a one-shot search failure on the isolated M18B fixture service."""

from http.server import ThreadingHTTPServer
from threading import Lock

from .m3_fixture_site import FixtureHandler


RETRY_SEARCH = "/m7/cards/search?q=m18b-retry"


class RetryFixtureServer(ThreadingHTTPServer):
    def __init__(self, address):
        self.fault_lock = Lock()
        self.fault_pending = True
        super().__init__(address, RetryFixtureHandler)

    def consume_fault(self):
        with self.fault_lock:
            pending = self.fault_pending
            self.fault_pending = False
            return pending


class RetryFixtureHandler(FixtureHandler):
    def do_GET(self):
        if self.path == RETRY_SEARCH:
            if self.server.consume_fault():
                self.send_error(503, "Controlled first-attempt search failure")
                return
            self.path = "/m7/cards/search?q=quick"
        super().do_GET()


if __name__ == "__main__":
    with RetryFixtureServer(("0.0.0.0", 8001)) as server:
        server.serve_forever()
