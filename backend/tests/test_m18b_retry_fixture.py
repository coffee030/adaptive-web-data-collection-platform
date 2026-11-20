from concurrent.futures import ThreadPoolExecutor
from urllib.error import HTTPError
from urllib.request import urlopen

from backend.tests.m18b_retry_fixture import RETRY_SEARCH, RetryFixtureServer


def test_retry_fault_is_scoped_to_one_search_per_fixture_instance():
    for _ in range(2):
        with RetryFixtureServer(("127.0.0.1", 0)) as server, ThreadPoolExecutor() as executor:
            serve = executor.submit(server.serve_forever)
            base = f"http://127.0.0.1:{server.server_port}"

            def get(path):
                try:
                    with urlopen(base + path, timeout=3) as response:
                        return response.status, response.read()
                except HTTPError as error:
                    with error:
                        return error.code, error.read()

            try:
                assert get("/m7/cards/search?q=quick")[0] == 200
                outcomes = list(executor.map(get, [RETRY_SEARCH, RETRY_SEARCH]))
                assert sorted(status for status, _ in outcomes) == [200, 503]
                status, body = get(RETRY_SEARCH)
                assert status == 200
                assert b'href="/m7/cards/detail/alpha"' in body
            finally:
                server.shutdown()
                serve.result(timeout=3)
