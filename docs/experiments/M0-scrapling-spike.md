# M0 Scrapling Parser and HTTP Fetcher Spike

Verification used CPython 3.12.14, Scrapling 0.5.1, and `curl_cffi` 0.17.0, with two offline HTML files and a temporary HTTP server bound to `127.0.0.1`. [Environment and reproduction](M0-environment-report.md) [README](../../README.md)

## Parser

| Expected behaviour | Observation | Outcome |
| --- | --- | --- |
| One extractor for two layouts | CSS selects repeated `article` in `cards.html` and XPath selects `tr` in `table.html`. Both configurations use the same `extract()`. Each extracted two records and matched explicit expected payloads. | PASS |
| Text, attributes, and relative URLs | Normalises whitespace in nested text and reads IDs and links from attributes. Resolves `../items/a1` and `/items/c3` against the page URL. A payload link can retain `#map`. Scheduling separately removes fragments and validates URLs. | PASS |
| Missing fields and empty results | Blank text and missing `href` become `None` and are listed in `missing_required`. Missing optional fields become `None`. A valid selector with no match returns an empty list. | PASS |
| Identify invalid CSS or XPath | Both raise `cssselect.SelectorSyntaxError`. Scrapling wraps the underlying XPath exception in the same type. | PASS |

The default `get_all_text()` separator can insert newlines between nested text. This spike collapses whitespace to one space. A field uses its first match, and XPath fields use relative expressions. Profile validation still needed to decide cardinality, XPath scope, and sample anomaly thresholds. Adaptive matching was disabled.

## HTTP and request metadata

| Scenario | Expected behaviour | Observation |
| --- | --- | --- |
| `200`, `403`, `429`, `500` | Get status, headers, raw body, and URL | Each returned a `Response` with `status`, `headers`, `body`, and `url` and supported direct CSS parsing. Defaults and `retries=2` each made one request. The `429` returned `Retry-After: 60` as supplied, without delay or retry. |
| `timeout=0.2` with a 0.8-second server delay | Timeout with bounded request count | Raised `curl_cffi.requests.exceptions.Timeout`, curl code 28. Defaults made 3 attempts (about 2.64 seconds), `retries=0` and `1` made 1 (about 0.19–0.22 seconds), and `retries=2` made 2 (about 1.42 seconds). Default retry delay was about 1 second. |
| Default headers | Observe User-Agent and Referer at the server | Sent Windows Chrome 152 User-Agent, `sec-ch-ua`, and `Referer: https://www.google.com/`. The Referer is a header. Requests went only to loopback. |
| Disable only `stealthy_headers` | Measure the change from defaults | Google Referer was absent. Chrome User-Agent and `sec-ch-ua` remained. |
| Disable only `impersonate` | Measure the change from defaults | Browser-like headers and Google Referer remained. A custom `Referer` overrode the default. |
| Disable both and set the project User-Agent | Identify project requests | Received `FYP-Collection-Spike/0.1`, Host, and Accept-Encoding. The request carried no Referer or `sec-ch-ua`. |
| Default `follow_redirects="safe"` | Observe loopback redirects | First GET reached the test server. After `302`, curl code 7 rejected the internal IP and the target saw zero requests. Default mode allows loopback as the starting origin. |
| `follow_redirects=True` | Measure hops and final URL | `/redirect` led to `/ok` with the expected final URL and `200`. The history entry was a curl_cffi `Response` and exposed `302` via `status_code`. `max_redirects=1` hit a loop and raised curl code 47 after two HTTP requests. |
| `follow_redirects=False` and fixture gate | Read `Location` before approving each hop | Read `302`, original URL, and Location, verified it, then followed the same-origin hop. A different-port Location was rejected and only the original request was issued. |

The first full run had one failure from treating an HTTP transport entry in `response.history` as a Scrapling `Response`. Switching to `status_code` and adding the expected history passed the full suite. User-Agent version depends on pinned transport and header data. Tests check observable behaviour.

## Required Source Access Policy controls

1. Accept only explicit approved HTTP(S) `scheme + hostname + effective port`. Reject credentials, malformed authority, and unsafe characters. Resolve relative redirects and discovered links against a verified response URL. Explicitly handle cross-origin targets, HTTPS downgrades, loops, and hop budgets.
2. Disable auto-follow and recheck Source permission, robots, and request budgets for the initial URL, every redirect, and discovered URLs. Verify DNS A and AAAA. Reject disallowed addresses, including loopback, private, link-local, and IPv4-mapped IPv6. Use verified resolution or controlled egress enforcement while retaining Host, SNI, and TLS certificate verification to prevent DNS rebinding and time-of-check races.
3. Verify the wrapper prevents environment proxies from changing actual egress. Version 0.5.1 creates `curl_cffi.Session()` with underlying default `trust_env=True`. In the experiment, pytest set `NO_PROXY=127.0.0.1` to confine traffic to the test server. Public proxy behaviour, DNS pinning, HTTPS certificate handling, and response limits still required verification.
4. Use a fixed project User-Agent, `stealthy_headers=False`, `impersonate=None`, `retries=1`, a per-request timeout, and an overall task deadline. Stop on HTTP 403 or an explicit block. The Core parses and caps `Retry-After` and adjusts cooldown for 429. For timeout and selected 5xx, the Core owns bounded retry and durable events with safe diagnostic, status, attempt, and time.

The fixture gate allows only the current server's exact origin on `127.0.0.1`. It rejects private and link-local addresses, different ports, other schemes, credentials, and alternate loopback forms first. It issued no requests to rejected destinations. These experiments covered redirect policy feasibility. Production DNS, robots, egress protection, and retry still required implementation and tests. [Scrapling HTTP guide](https://scrapling.readthedocs.io/en/latest/fetching/static.html) [OWASP SSRF Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)
