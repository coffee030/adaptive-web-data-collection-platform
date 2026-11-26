"""Serve the frozen M22A fixture with separate caller-attributed receipts."""

import argparse
import json
from datetime import UTC, datetime
from http.server import ThreadingHTTPServer

from .m22a_fixture import FixtureHandler

HEALTH_AGENT = "M22C-Compose-Health/1.0"


class PilotHandler(FixtureHandler):
    def log_request(self, code="-", size="-"):
        agent = self.headers.get("User-Agent", "")
        channel = self.server.channel
        if (
            channel == "internal"
            and agent == HEALTH_AGENT
            and self.client_address[0] == "127.0.0.1"
        ):
            caller = "compose_health"
        elif channel == "internal" and agent == "FYP-Collection-Core/1.0":
            caller = "core"
        elif channel == "mirror" and agent.startswith("Mozilla/"):
            caller = "browser"
        else:
            caller = "other"
        print(
            json.dumps(
                {
                    "utc": datetime.now(UTC).isoformat(),
                    "channel": channel,
                    "caller": caller,
                    "method": self.command,
                    "target": self.path,
                    "status": int(code),
                }
            ),
            flush=True,
        )

    def log_message(self, format, *args):
        pass


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("channel", choices=("internal", "mirror"))
    args = parser.parse_args()
    with ThreadingHTTPServer(("0.0.0.0", 8001), PilotHandler) as server:
        server.channel = args.channel
        server.serve_forever()
