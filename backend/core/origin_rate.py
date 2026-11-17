"""Serialize requests and enforce cooldowns across processes using Redis."""

import hashlib
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from math import ceil
from time import monotonic, sleep
from uuid import uuid4

from redis import Redis
from redis.backoff import NoBackoff
from redis.exceptions import RedisError
from redis.retry import Retry

from .inputs import InputError

MAX_WAIT_SECONDS = 11
# Longer than the Celery hard limit, including a killed request holder.
LEASE_MS = 65_000

ACQUIRE = """
local cooldown = math.max(redis.call('PTTL', KEYS[2]), redis.call('PTTL', KEYS[3]) + tonumber(ARGV[3]) - 10000)
if cooldown >= 0 then return -math.max(cooldown, 1) end
local locked = redis.call('PTTL', KEYS[1])
if locked >= 0 then return math.max(locked, 1) end
redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])
return 0
"""

RELEASE = """
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
local interval = math.max(tonumber(ARGV[2]), tonumber(redis.call('GET', KEYS[3]) or 0))
redis.call('SET', KEYS[3], interval, 'EX', 86400)
redis.call('SET', KEYS[2], '1', 'PX', math.max(interval, tonumber(ARGV[3])))
redis.call('SET', KEYS[4], '1', 'PX', 10000)
redis.call('DEL', KEYS[1])
return 1
"""


@dataclass
class RequestCooldown:
    interval_ms: int
    retry_after_ms: int = 0


class OriginRate:
    def __init__(self, url: str):
        self.redis = Redis.from_url(
            url,
            socket_connect_timeout=0.5,
            socket_timeout=0.5,
            retry=Retry(NoBackoff(), 0),
        )

    def _eval(self, script: str, keys: tuple[str, ...], *args: str | int) -> int:
        try:
            return int(self.redis.eval(script, len(keys), *keys, *args))
        except RedisError as error:
            raise InputError(
                "origin_rate_unavailable",
                "Shared origin rate controller is unavailable",
            ) from error

    @contextmanager
    def request(
        self, origin: str, interval_ms: int, deadline: float
    ) -> Iterator[RequestCooldown]:
        key = "collection:origin:{" + hashlib.sha256(origin.encode()).hexdigest() + "}"
        lock, cooldown, policy, last = (
            f"{key}:{kind}" for kind in ("lock", "cooldown", "policy", "last")
        )
        token = uuid4().hex
        wait_until = min(deadline, monotonic() + MAX_WAIT_SECONDS)
        # Short polling lets a contender observe a holder releasing its lease early.
        while monotonic() < wait_until:
            wait_ms = self._eval(
                ACQUIRE, (lock, cooldown, last), token, LEASE_MS, interval_ms
            )
            if not wait_ms:
                break
            if wait_ms < 0 and -wait_ms > (wait_until - monotonic()) * 1000:
                raise InputError(
                    "origin_rate_busy",
                    "Origin cooldown exceeds the request budget",
                    retry_after_seconds=ceil(-wait_ms / 1000),
                )
            sleep(max(0, min(abs(wait_ms) / 1000, 0.2, wait_until - monotonic())))
        else:
            raise InputError(
                "origin_rate_busy", "Origin request slot did not become available"
            )

        timing = RequestCooldown(interval_ms)
        try:
            yield timing
        finally:
            released = self._eval(
                RELEASE,
                (lock, cooldown, policy, last),
                token,
                timing.interval_ms,
                timing.retry_after_ms,
            )
            if not released:
                raise InputError(
                    "origin_rate_unavailable", "Origin request lease was lost"
                )
