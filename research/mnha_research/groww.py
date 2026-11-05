"""Groww Trading API client — market data only. This service never places,
modifies or cancels an order; there is no code path here that could.

Mirrors the TOTP token flow in src/lib/api/groww.ts: the API key plus a TOTP
code mints an access token, which is cached on disk until shortly before its
own expiry so repeated runs do not mint a new one each time.
"""

from __future__ import annotations

import base64
import datetime as dt
import hashlib
import hmac
import json
import os
import struct
import time
from dataclasses import dataclass

import requests

from . import config

HOST = "https://api.groww.in"

# Largest span (days) Groww answers in one historical request per interval —
# probed by the TS adapter (it returns GA001 "duration too long" past these).
CANDLE_MAX_DAYS = {1: 7, 5: 15, 10: 30, 15: 30, 30: 60, 60: 90, 1440: 1000}

# The backtesting endpoint: deeper intraday history (from 2020-07), with its own
# per-request caps in calendar days (from Groww's GA001 replies).
BT_INTERVAL = {5: "5minute", 15: "15minute", 30: "30minute", 60: "1hour"}
BT_MAX_DAYS = {5: 30, 15: 90, 30: 90, 60: 180}

DAY_MS = 86_400_000


class GrowwError(RuntimeError):
    def __init__(self, message: str, status: int | None = None, code: str | None = None):
        super().__init__(message)
        self.status = status
        self.code = code


def totp(secret: str, at: float | None = None) -> str:
    """RFC 6238: SHA-1, 30 s step, six digits."""
    s = secret.strip().replace(" ", "").upper()
    s += "=" * (-len(s) % 8)
    key = base64.b32decode(s)
    counter = int((time.time() if at is None else at) // 30)
    mac = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()
    off = mac[-1] & 0x0F
    code = (struct.unpack(">I", mac[off : off + 4])[0] & 0x7FFFFFFF) % 1_000_000
    return f"{code:06d}"


def _jwt_exp(token: str) -> float:
    try:
        part = token.split(".")[1]
        part += "=" * (-len(part) % 4)
        return float(json.loads(base64.urlsafe_b64decode(part))["exp"])
    except Exception:
        return time.time() + 3600


@dataclass
class Candle:
    time: int  # bar open, epoch ms
    open: float
    high: float
    low: float
    close: float
    volume: float


class Groww:
    """Throttled, retrying market-data client."""

    def __init__(self, api_key: str | None = None, totp_secret: str | None = None, min_interval: float = 0.34):
        self.api_key = (api_key or os.environ.get("GROWW_API_KEY", "")).strip()
        self.totp_secret = (totp_secret or os.environ.get("GROWW_TOTP_SECRET", "")).strip()
        # A ready-minted access token works too, until it expires (Groww ends
        # them at 06:00 IST); it cannot be renewed, so unattended runs need the
        # key + TOTP secret.
        self.static_token = os.environ.get("GROWW_ACCESS_TOKEN", "").strip() if not (self.api_key and self.totp_secret) else ""
        if not (self.api_key and self.totp_secret) and not self.static_token:
            raise GrowwError("set GROWW_API_KEY + GROWW_TOTP_SECRET, or GROWW_ACCESS_TOKEN (see /etc/mnha-research.env)")
        self.min_interval = min_interval
        self._last = 0.0
        self._token: str | None = None
        self._exp = 0.0
        self.session = requests.Session()
        self.requests_made = 0
        if self.static_token:
            self._token, self._exp = self.static_token, _jwt_exp(self.static_token)

    # ------------------------------------------------------------ token
    def _load_cached_token(self) -> None:
        try:
            raw = json.loads(config.TOKEN_FILE.read_text())
            fp = hashlib.sha256(self.api_key.encode()).hexdigest()[:16]
            if raw.get("fp") == fp and raw.get("exp", 0) - 300 > time.time():
                self._token, self._exp = raw["token"], raw["exp"]
        except Exception:
            pass

    def _mint(self) -> None:
        r = self.session.post(
            f"{HOST}/v1/token/api/access",
            headers={"Authorization": f"Bearer {self.api_key}", "Accept": "application/json", "X-API-VERSION": "1.0"},
            json={"key_type": "totp", "totp": totp(self.totp_secret)},
            timeout=20,
        )
        try:
            body = r.json()
        except ValueError:
            body = {}
        token = body.get("token")
        if r.status_code != 200 or not token:
            raise GrowwError(f"token mint failed: HTTP {r.status_code} {str(body)[:200]}", r.status_code)
        self._token, self._exp = token, _jwt_exp(token)
        config.ensure_dirs()
        fp = hashlib.sha256(self.api_key.encode()).hexdigest()[:16]
        config.TOKEN_FILE.write_text(json.dumps({"fp": fp, "token": token, "exp": self._exp}))
        os.chmod(config.TOKEN_FILE, 0o600)

    def token(self) -> str:
        if self.static_token:
            if self._exp <= time.time():
                when = time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime(self._exp))
                raise GrowwError(f"GROWW_ACCESS_TOKEN expired at {when}; add GROWW_API_KEY + GROWW_TOTP_SECRET for unattended runs", 401)
            return self.static_token
        if self._token is None:
            self._load_cached_token()
        if self._token is None or self._exp - 300 < time.time():
            self._mint()
        return self._token  # type: ignore[return-value]

    # ------------------------------------------------------------ http
    def _throttle(self) -> None:
        wait = self.min_interval - (time.monotonic() - self._last)
        if wait > 0:
            time.sleep(wait)
        self._last = time.monotonic()

    def get(self, path: str, params: dict) -> dict:
        """GET with the { status, payload } envelope unwrapped. Retries 429/5xx
        with backoff; a 401 re-mints once. Raises on a definite refusal."""
        delay = 1.0
        reminted = False
        last_err: Exception | None = None
        for _attempt in range(6):
            self._throttle()
            try:
                r = self.session.get(
                    f"{HOST}{path}",
                    params=params,
                    headers={"Authorization": f"Bearer {self.token()}", "Accept": "application/json", "X-API-VERSION": "1.0"},
                    timeout=30,
                )
            except requests.RequestException as e:
                last_err = e
                time.sleep(delay)
                delay = min(delay * 2, 30)
                continue
            self.requests_made += 1
            if r.status_code in (401, 403) and self.static_token:
                raise GrowwError(f"{path}: Groww refused the access token (HTTP {r.status_code}): {r.text[:160]}", r.status_code)
            if r.status_code == 401 and not reminted:
                self._token = None
                self._mint()
                reminted = True
                continue
            if r.status_code == 429 or r.status_code >= 500:
                last_err = GrowwError(f"HTTP {r.status_code}", r.status_code)
                time.sleep(delay)
                delay = min(delay * 2, 30)
                continue
            try:
                body = r.json()
            except ValueError:
                raise GrowwError(f"{path}: non-JSON HTTP {r.status_code}: {r.text[:160]}", r.status_code)
            if r.status_code == 200 and body.get("status") == "SUCCESS":
                return body.get("payload") or {}
            err = body.get("error") or {}
            raise GrowwError(f"{path}: HTTP {r.status_code} {err.get('code')} {err.get('message')}", r.status_code, err.get("code"))
        raise GrowwError(f"{path}: gave up after retries: {last_err}")

    # ------------------------------------------------------------ candles
    def candles_bt(self, groww_symbol: str, interval: int, start_day: "dt.date", end_day: "dt.date", exchange: str = "NSE") -> list[Candle]:
        """Backtesting history (/v1/historical/candles): intraday back to mid-2020.
        Timestamps arrive as IST wall-clock strings. At most BT_MAX_DAYS[interval]
        calendar days between start and end date per request."""
        p = self.get(
            "/v1/historical/candles",
            {
                "exchange": exchange,
                "segment": "CASH",
                "groww_symbol": groww_symbol,
                "start_time": f"{start_day.isoformat()} 09:00:00",
                "end_time": f"{end_day.isoformat()} 15:30:00",
                "candle_interval": BT_INTERVAL[interval],
            },
        )
        out = []
        for c in p.get("candles") or []:
            if c is None or len(c) < 5 or any(v is None for v in c[1:5]):
                continue
            t = dt.datetime.fromisoformat(str(c[0])).replace(tzinfo=dt.timezone.utc)
            ms = int(t.timestamp() * 1000) - config.IST_OFFSET_S * 1000
            out.append(Candle(ms, float(c[1]), float(c[2]), float(c[3]), float(c[4]), float(c[5] or 0) if len(c) > 5 else 0.0))
        return out

    def candles(self, symbol: str, interval: int, start_ms: int, end_ms: int, exchange: str = "NSE") -> list[Candle]:
        """One window of history. [] means Groww has no bars there; any failure raises."""
        p = self.get(
            "/v1/historical/candle/range",
            {
                "exchange": exchange,
                "segment": "CASH",
                "trading_symbol": symbol,
                "start_time": int(start_ms),
                "end_time": int(end_ms),
                "interval_in_minutes": interval,
            },
        )
        out = []
        for c in p.get("candles") or []:
            if c is None or len(c) < 5 or any(v is None for v in c[:5]):
                continue
            out.append(Candle(int(c[0]) * 1000, float(c[1]), float(c[2]), float(c[3]), float(c[4]), float(c[5] or 0) if len(c) > 5 else 0.0))
        return out
