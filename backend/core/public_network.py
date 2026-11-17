"""Resolve public HTTPS hosts and bind transfers to their vetted addresses."""

import ipaddress
import socket
from concurrent.futures import ThreadPoolExecutor, TimeoutError
from threading import BoundedSemaphore
from urllib.parse import urlsplit

from curl_cffi import CurlOpt
from curl_cffi.requests import Session

from .inputs import InputError

PUBLIC_IPV6 = ipaddress.ip_network("2000::/3")
DENIED_IPV6 = tuple(map(ipaddress.ip_network, ("2001::/23", "2002::/16", "3fff::/20")))
DENIED_IPV4 = tuple(
    map(ipaddress.ip_network, ("168.63.129.16/32", "192.0.0.0/24", "192.88.99.0/24"))
)
DNS_WORKERS = 4
_dns_pool = ThreadPoolExecutor(
    max_workers=DNS_WORKERS, thread_name_prefix="collection-dns"
)
_dns_slots = BoundedSemaphore(DNS_WORKERS)


def _public(address: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    if not address.is_global or address.is_multicast:
        return False
    if address.version == 4:
        return not any(address in network for network in DENIED_IPV4)
    return address in PUBLIC_IPV6 and not any(
        address in network for network in DENIED_IPV6
    )


def resolve_public(host: str, timeout: float) -> tuple[str, ...]:
    if not _dns_slots.acquire(blocking=False):
        raise InputError("transport_error", "Public DNS resolver is busy")
    # An absolute DNS name prevents resolver search suffixes from changing the host.
    future = _dns_pool.submit(
        socket.getaddrinfo, host + ".", 443, 0, socket.SOCK_STREAM
    )
    future.add_done_callback(lambda _: _dns_slots.release())
    try:
        answers = future.result(timeout=timeout)
    except TimeoutError as error:
        raise InputError("timeout", "Public DNS resolution timed out") from error
    except OSError as error:
        raise InputError("transport_error", "Public DNS resolution failed") from error

    addresses = tuple(
        dict.fromkeys(ipaddress.ip_address(answer[4][0]) for answer in answers)
    )
    if not addresses or any(not _public(address) for address in addresses):
        raise InputError(
            "destination_denied", "DNS resolved outside public network policy"
        )
    return tuple(str(address) for address in addresses)


def public_get(
    url: str, timeout: float, receive, user_agent: str, addresses: tuple[str, ...]
):
    host = urlsplit(url).hostname
    pins = ",".join(
        f"[{address}]" if ":" in address else address for address in addresses
    )
    # A fresh handle pins the connect address while retaining the original TLS SNI,
    # certificate hostname and HTTP authority. Proxies and automatic redirects are disabled.
    with Session(
        trust_env=False,
        curl_options={CurlOpt.RESOLVE: [f"{host}:443:{pins}"], CurlOpt.PROXY: b""},
    ) as session:
        response = session.get(
            url,
            timeout=timeout,
            allow_redirects=False,
            verify=True,
            headers={"User-Agent": user_agent},
            content_callback=receive,
        )
    if str(ipaddress.ip_address(response.primary_ip)) not in addresses:
        raise InputError(
            "destination_denied", "HTTPS peer did not match vetted DNS answers"
        )
    return response, response.status_code
