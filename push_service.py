"""
Web Push (VAPID) — true server push for PWA. Free; no Firebase required.
Set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_CLAIM_EMAIL, PUSH_CRON_SECRET on Railway.
Run scripts/generate_vapid_keys.py once, then scripts/export_push_templates.py after template edits.
"""
from __future__ import annotations

import json
import os
import random
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import db

NOTIFY_TZ = ZoneInfo("Asia/Manila")
MS_PER_DAY = 86400000
BASE_DIR = Path(__file__).resolve().parent
_TEMPLATES: dict | None = None
# Bump when push send path changes (visible in /api/push/vapid-public-key).
PUSH_BACKEND_VERSION = "2026-05-19-schedule-v19"
DAILY_PUSH_RETRY_MIN_SECONDS = max(
    120, int(os.environ.get("DAILY_PUSH_RETRY_MIN_SECONDS", "300"))
)
DAILY_PUSH_MAX_ATTEMPTS = max(1, int(os.environ.get("DAILY_PUSH_MAX_ATTEMPTS", "2")))
DISPATCH_WINDOW_MINUTES = max(
    1, int(os.environ.get("PUSH_DISPATCH_WINDOW_MINUTES", "15"))
)
# Do not delete a subscription FCM rejects right after register (token may need a moment).
PUSH_SUBSCRIPTION_GRACE_SECONDS = max(
    60, int(os.environ.get("PUSH_SUBSCRIPTION_GRACE_SECONDS", "300"))
)


def _load_templates() -> dict:
    global _TEMPLATES
    if _TEMPLATES is not None:
        return _TEMPLATES
    path = BASE_DIR / "static" / "push-templates.json"
    with open(path, encoding="utf-8") as f:
        _TEMPLATES = json.load(f)
    return _TEMPLATES


def vapid_public_key() -> str | None:
    return (os.environ.get("VAPID_PUBLIC_KEY") or "").strip().strip('"').strip("'") or None


def vapid_private_key() -> str | None:
    v = _get_vapid()
    if not v:
        return None
    try:
        pem = v.private_pem()
        return pem.decode() if isinstance(pem, bytes) else str(pem)
    except Exception:
        return None


def _decode_b64_key(raw: str) -> bytes | None:
    import base64

    cleaned = (raw or "").strip().strip('"').strip("'")
    if not cleaned:
        return None
    pad = "=" * ((4 - len(cleaned) % 4) % 4)
    for decoder in (base64.urlsafe_b64decode, base64.b64decode):
        try:
            return decoder(cleaned + pad)
        except Exception:
            continue
    return None


def _b64_private_to_pem(raw: str) -> str | None:
    try:
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric import ec

        key_bytes = _decode_b64_key(raw)
        if not key_bytes:
            return None
        if len(key_bytes) == 32:
            private_key = ec.derive_private_key(
                int.from_bytes(key_bytes, "big"), ec.SECP256R1()
            )
        else:
            return None
        return private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        ).decode()
    except Exception:
        return None


_vapid_instance = None


def _normalize_private_pem(raw: str) -> str | None:
    """Turn Railway env values into a PEM string cryptography can load."""
    s = (raw or "").strip().strip('"').strip("'")
    if not s:
        return None
    for rep in ("\\\\n", "\\n"):
        if rep in s:
            s = s.replace(rep, "\n")
    s = s.replace("\r\n", "\n").replace("\r", "\n")
    if "BEGIN" in s:
        if not s.endswith("\n"):
            s += "\n"
        return s
    compact = re.sub(r"\s+", "", s)
    if compact and len(compact) > 40:
        wrapped = "\n".join(compact[i : i + 64] for i in range(0, len(compact), 64))
        return f"-----BEGIN PRIVATE KEY-----\n{wrapped}\n-----END PRIVATE KEY-----\n"
    pem = _b64_private_to_pem(s)
    return pem


def _vapid_from_pem(pem: str):
    from cryptography.hazmat.primitives import serialization
    from py_vapid import Vapid01

    key = serialization.load_pem_private_key(pem.encode(), password=None)
    return Vapid01(private_key=key)


def _get_vapid():
    """Load VAPID signing key once (PEM or legacy base64 private on Railway)."""
    global _vapid_instance
    if _vapid_instance is not None:
        return _vapid_instance

    raw_priv = (os.environ.get("VAPID_PRIVATE_KEY") or "").strip().strip('"').strip("'")
    if not raw_priv:
        return None

    try:
        from py_vapid import Vapid01
    except ImportError:
        return None

    pem = _normalize_private_pem(raw_priv)
    loaders = []
    if pem:
        loaders.append(lambda p=pem: _vapid_from_pem(p))
        loaders.append(lambda p=pem: Vapid01.from_pem(p.encode()))
    if "BEGIN" not in raw_priv:
        loaders.append(lambda r=raw_priv: Vapid01.from_string(r))

    for loader in loaders:
        try:
            v = loader()
            _ = v.private_key
            _vapid_instance = v
            return v
        except Exception:
            continue
    return None


def _vapid_sign_test(v) -> bool:
    """True if VAPID can sign headers (same path pywebpush uses)."""
    try:
        v.sign(
            {
                "sub": vapid_claim_email(),
                "aud": "https://fcm.googleapis.com",
            }
        )
        return True
    except Exception:
        return False


def _subscription_for_webpush(stored: dict) -> tuple[dict | None, str | None]:
    """Build pywebpush subscription dict; detect stale VAPID-bound subscriptions."""
    if not isinstance(stored, dict):
        return None, "invalid"
    endpoint = str(stored.get("endpoint") or "").strip()
    if not endpoint:
        return None, "invalid"
    current = vapid_public_key()
    saved = str(stored.get("_vapidPublicKey") or "").strip()
    if saved and current and saved != current:
        return None, "stale_vapid"
    keys = stored.get("keys")
    if not isinstance(keys, dict):
        return None, "missing_keys"
    p256dh = keys.get("p256dh")
    auth = keys.get("auth")
    if not p256dh or not auth:
        return None, "missing_keys"
    clean: dict = {
        "endpoint": endpoint,
        "keys": {"p256dh": str(p256dh), "auth": str(auth)},
    }
    if stored.get("expirationTime") is not None:
        clean["expirationTime"] = stored["expirationTime"]
    return clean, None


def count_stale_push_subscriptions() -> int:
    """Devices still registered under a previous VAPID public key."""
    current = vapid_public_key()
    if not current:
        return 0
    stale = 0
    for subs in db.list_push_subscriptions_grouped_by_user().values():
        for sub in subs:
            saved = str(sub.get("_vapidPublicKey") or "").strip()
            if saved and saved != current:
                stale += 1
    return stale


def purge_stale_push_subscriptions() -> int:
    """Remove device subscriptions registered under an old VAPID public key."""
    current = vapid_public_key()
    if not current:
        return 0
    removed = 0
    grouped = db.list_push_subscriptions_grouped_by_user()
    for subs in grouped.values():
        for sub in subs:
            saved = str(sub.get("_vapidPublicKey") or "").strip()
            if saved and saved != current:
                ep = str(sub.get("endpoint") or "").strip()
                if ep and db.delete_push_subscription_by_endpoint(ep):
                    removed += 1
    return removed


def push_health() -> dict:
    """Diagnostics for Railway / support (no secrets)."""
    pub = vapid_public_key()
    raw_priv = (os.environ.get("VAPID_PRIVATE_KEY") or "").strip().strip('"').strip("'")
    v = _get_vapid()
    pem_ok = False
    sign_ok = False
    if v:
        try:
            _ = v.private_key
            pem_ok = True
            sign_ok = _vapid_sign_test(v)
        except Exception:
            pem_ok = False
    try:
        from pywebpush import webpush  # noqa: F401

        pywebpush_ok = True
    except ImportError:
        pywebpush_ok = False
    subs = db.list_push_subscriptions_grouped_by_user()
    private_key_set = bool(raw_priv)
    if not private_key_set:
        private_key_status = "missing"
    elif not v:
        private_key_status = "unreadable"
    elif not pem_ok:
        private_key_status = "invalid"
    else:
        private_key_status = "ok"
    return {
        "pushBackendVersion": PUSH_BACKEND_VERSION,
        "configured": bool(pub and v and pem_ok and sign_ok),
        "publicKeySet": bool(pub),
        "privateKeySet": private_key_set,
        "privateKeySignable": pem_ok,
        "vapidCanSign": sign_ok,
        "privateKeyStatus": private_key_status,
        "pywebpushInstalled": pywebpush_ok,
        "subscribedUsers": len(subs),
        "subscribedDevices": sum(len(s) for s in subs.values()),
        "staleSubscriptionCount": count_stale_push_subscriptions(),
    }


def push_scheduler_health() -> dict:
    try:
        import push_scheduler

        return push_scheduler.status()
    except Exception:
        return {"schedulerStarted": False}


def _normalized_vapid_private_key() -> str | None:
    return vapid_private_key()


def vapid_claim_email() -> str:
    email = (os.environ.get("VAPID_CLAIM_EMAIL") or "mailto:support@diaricore.app").strip()
    if not email.startswith("mailto:"):
        email = f"mailto:{email}"
    return email


def push_configured() -> bool:
    h = push_health()
    return bool(h.get("configured") and h.get("privateKeySignable") and h.get("vapidCanSign"))


def _manila_now() -> datetime:
    return datetime.now(NOTIFY_TZ)


def _manila_date_key(dt: datetime | None = None) -> str:
    d = dt or _manila_now()
    return d.strftime("%Y-%m-%d")


def _manila_hm(dt: datetime | None = None) -> tuple[int, int]:
    d = dt or _manila_now()
    return d.hour, d.minute


def _parse_hhmm(s: str) -> tuple[int, int] | None:
    raw = str(s or "").strip()
    if not raw:
        return None
    m = re.match(r"^(\d{1,2}):(\d{2})$", raw)
    if not m:
        return None
    h, mi = int(m.group(1)), int(m.group(2))
    if 0 <= h <= 23 and 0 <= mi <= 59:
        return h, mi
    return None


def _resolve_reminder_hhmm(prefs: dict, entries: list[dict]) -> tuple[int, int] | None:
    override = (prefs.get("reminderTimeOverride") or "").strip()
    return _parse_hhmm(override) or _parse_hhmm(_most_active_hour_hhmm(entries))


def _reminder_due_in_window(
    h: int, m: int, reminder: tuple[int, int], window_minutes: int | None = None
) -> bool:
    """True during [reminder, reminder+window) Manila — tolerates cron every 1–5 min."""
    w = DISPATCH_WINDOW_MINUTES if window_minutes is None else max(1, window_minutes)
    now = h * 60 + m
    start = reminder[0] * 60 + reminder[1]
    return start <= now < start + w


def _entry_manila_date_key(entry: dict) -> str:
    raw = entry.get("createdAt") or entry.get("created_at") or entry.get("date")
    if not raw:
        return ""
    try:
        s = str(raw).strip()
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(NOTIFY_TZ).strftime("%Y-%m-%d")
    except Exception:
        return ""


def _serialize_entries_for_user(user_id: int) -> list[dict]:
    rows = db.get_journal_entries_by_user(user_id)
    out = []
    for row in rows:
        tags = []
        if row.get("tags_json"):
            try:
                tags = json.loads(row["tags_json"])
            except Exception:
                pass
        emo = (row.get("emotion_label") or "neutral").lower()
        created = row.get("created_at")
        entry_dt = row.get("entry_datetime_utc")
        date_val = entry_dt or created
        out.append(
            {
                "id": row.get("id"),
                "title": row.get("title") or "",
                "text": row.get("text_content") or "",
                "date": date_val,
                "createdAt": created,
                "emotionLabel": emo,
                "feeling": emo,
            }
        )
    return out


def _has_entry_today_manila(entries: list[dict]) -> bool:
    today = _manila_date_key()
    return any(_entry_manila_date_key(e) == today for e in entries)


def _compute_streak(entries: list[dict]) -> int:
    day_set: set[str] = set()
    for e in entries:
        k = _entry_manila_date_key(e)
        if k:
            day_set.add(k)
    if not day_set:
        return 0
    today = _manila_date_key()
    yesterday = (_manila_now().date() - timedelta(days=1)).isoformat()
    if today in day_set:
        anchor = today
    elif yesterday in day_set:
        anchor = yesterday
    else:
        return 0
    streak = 0
    d = datetime.strptime(anchor, "%Y-%m-%d").date()
    while True:
        key = d.isoformat()
        if key not in day_set:
            break
        streak += 1
        d -= timedelta(days=1)
    return streak


def _most_active_hour_hhmm(entries: list[dict]) -> str:
    buckets = [0] * 24
    for e in entries:
        raw = e.get("createdAt") or e.get("date")
        if not raw:
            continue
        try:
            s = str(raw).strip()
            if s.endswith("Z"):
                s = s[:-1] + "+00:00"
            dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            h = dt.astimezone(NOTIFY_TZ).hour
            buckets[h] += 1
        except Exception:
            continue
    peak = max(range(24), key=lambda i: buckets[i])
    if buckets[peak] <= 0:
        return "09:00"
    return f"{peak:02d}:00"


def _user_notification_prefs(user_id: int) -> dict:
    blob = db._load_ui_preferences_blob(user_id)
    n = blob.get("notifications")
    if not isinstance(n, dict):
        n = {}
    return {
        "dailyEnabled": n.get("dailyEnabled", True) is not False,
        "streakEnabled": n.get("streakEnabled", True) is not False,
        "insightEnabled": n.get("insightEnabled", True) is not False,
        "reminderTimeOverride": (
            (n.get("reminderTimeOverride") or n.get("reminderHHmm") or "").strip()
        ),
    }


def _user_push_state(user_id: int) -> dict:
    blob = db._load_ui_preferences_blob(user_id)
    s = blob.get("pushState")
    return s if isinstance(s, dict) else {}


def _save_push_state(user_id: int, state: dict) -> None:
    db.merge_user_ui_preferences_json(user_id, {"pushState": state})


def _daily_reminder_fired_today(state: dict, today_key: str, reminder: tuple[int, int]) -> bool:
    """True if we already sent daily push for this calendar day at this reminder time."""
    hhmm = f"{reminder[0]:02d}:{reminder[1]:02d}"
    last = state.get("lastDailyReminder")
    if isinstance(last, dict):
        return last.get("dateKey") == today_key and last.get("hhmm") == hhmm
    # Legacy: only date key — without hhmm do not block (user may have changed reminder time).
    if state.get("lastDailyReminderDateKey") == today_key:
        legacy_hhmm = str(state.get("lastDailyReminderHhmm") or "").strip()
        if legacy_hhmm:
            return legacy_hhmm == hhmm
    return False


def _mark_daily_reminder_sent(state: dict, today_key: str, reminder: tuple[int, int]) -> None:
    hhmm = f"{reminder[0]:02d}:{reminder[1]:02d}"
    state["lastDailyReminder"] = {"dateKey": today_key, "hhmm": hhmm}
    state["lastDailyReminderDateKey"] = today_key
    state["lastDailyReminderHhmm"] = hhmm
    state.pop("pendingDailyReminder", None)


def _mark_daily_reminder_pending(
    state: dict, today_key: str, reminder: tuple[int, int], *, attempts: int
) -> None:
    hhmm = f"{reminder[0]:02d}:{reminder[1]:02d}"
    state["pendingDailyReminder"] = {
        "dateKey": today_key,
        "hhmm": hhmm,
        "at": datetime.now(timezone.utc).isoformat(),
        "attempts": max(1, int(attempts)),
    }


def _pending_daily_matches(
    state: dict, today_key: str, reminder: tuple[int, int]
) -> dict | None:
    pending = state.get("pendingDailyReminder")
    if not isinstance(pending, dict):
        return None
    hhmm = f"{reminder[0]:02d}:{reminder[1]:02d}"
    if pending.get("dateKey") == today_key and pending.get("hhmm") == hhmm:
        return pending
    return None


def _seconds_since_iso(ts: str | None) -> float | None:
    if not ts:
        return None
    try:
        s = str(ts).strip().replace("Z", "+00:00")
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return (datetime.now(timezone.utc) - dt.astimezone(timezone.utc)).total_seconds()
    except Exception:
        return None


def _ack_confirms_daily_reminder(
    state: dict, today_key: str, reminder: tuple[int, int]
) -> bool:
    """Delivery ack counts only for this reminder time's 15-minute window."""
    hhmm = f"{reminder[0]:02d}:{reminder[1]:02d}"
    last = state.get("lastDailyReminder")
    if (
        isinstance(last, dict)
        and last.get("dateKey") == today_key
        and last.get("hhmm") == hhmm
    ):
        return True
    ack = state.get("lastDeliveryAck")
    if not isinstance(ack, dict):
        return False
    if str(ack.get("tag") or "") != "diari-daily-reminder":
        return False
    try:
        s = str(ack.get("at") or "").strip().replace("Z", "+00:00")
        ack_dt = datetime.fromisoformat(s)
        if ack_dt.tzinfo is None:
            ack_dt = ack_dt.replace(tzinfo=timezone.utc)
        ack_manila = ack_dt.astimezone(NOTIFY_TZ)
    except Exception:
        return False
    if _manila_date_key(ack_manila) != today_key:
        return False
    return _reminder_due_in_window(
        ack_manila.hour, ack_manila.minute, reminder
    )


def _daily_reminder_confirmed_on_phone(
    state: dict, today_key: str, reminder: tuple[int, int]
) -> bool:
    """True when the service worker reported today's daily banner at/after reminder time."""
    if _ack_confirms_daily_reminder(state, today_key, reminder):
        return True
    if _pending_daily_matches(state, today_key, reminder):
        return False
    return _daily_reminder_fired_today(state, today_key, reminder)


def _reconcile_legacy_daily_without_ack(
    state: dict, today_key: str, reminder: tuple[int, int]
) -> bool:
    """
    Older builds marked daily sent when FCM accepted the push, even if the phone never
    showed a banner. Clear that flag so cron can retry while the app is closed.
    """
    if not _daily_reminder_fired_today(state, today_key, reminder):
        return False
    if _ack_confirms_daily_reminder(state, today_key, reminder):
        return False
    for key in (
        "lastDailyReminder",
        "lastDailyReminderDateKey",
        "lastDailyReminderHhmm",
    ):
        state.pop(key, None)
    return True


def _should_send_daily_now(state: dict, today_key: str, reminder: tuple[int, int]) -> tuple[bool, str | None]:
    """Whether cron should POST another daily push (one retry only if phone never acked)."""
    if _daily_reminder_fired_today(state, today_key, reminder):
        return False, "already_confirmed_on_phone"
    pending = _pending_daily_matches(state, today_key, reminder)
    if not pending:
        return True, None
    attempts = int(pending.get("attempts") or 1)
    if attempts >= DAILY_PUSH_MAX_ATTEMPTS:
        return False, "max_retries_without_phone_ack"
    age = _seconds_since_iso(pending.get("at"))
    if age is not None and age < DAILY_PUSH_RETRY_MIN_SECONDS:
        return False, "waiting_before_retry"
    return True, "retry_no_phone_ack_yet"


def record_delivery_ack(user_id: int, data: dict) -> None:
    """Service worker calls this when a Web Push is received on the device."""
    state = dict(_user_push_state(user_id))
    tag = str(data.get("tag") or "")
    state["lastDeliveryAck"] = {
        "at": (data.get("receivedAt") or datetime.now(timezone.utc).isoformat()),
        "tag": tag,
        "title": str(data.get("title") or ""),
    }
    if tag == "diari-daily-reminder":
        today_key = _manila_date_key(_manila_now())
        rem = None
        pending_raw = state.get("pendingDailyReminder")
        if isinstance(pending_raw, dict):
            rem = _parse_hhmm(str(pending_raw.get("hhmm") or ""))
        if not rem:
            prefs = _user_notification_prefs(user_id)
            entries = _serialize_entries_for_user(user_id)
            rem = _resolve_reminder_hhmm(prefs, entries)
        if rem:
            _mark_daily_reminder_sent(state, today_key, rem)
    _save_push_state(user_id, state)


def send_daily_test_push_to_user(user_id: int) -> dict:
    """Same payload/tag as the scheduled daily reminder (for closed-app testing)."""
    uid = int(user_id)
    if len(db.list_push_subscriptions_for_user(uid)) > 1:
        db.prune_push_subscriptions_for_user(uid, max_keep=1)
    subs = db.list_push_subscriptions_for_user(uid)
    if not subs:
        return {"ok": False, "error": "No push subscription. Tap Use this phone only."}
    sub = subs[0]
    ok, err = send_web_push(
        sub,
        "A gentle journal nudge",
        _build_daily_body(),
        "/write-entry.html",
        tag="diari-daily-reminder-test",
    )
    needs_resubscribe = bool(
        err
        and any(
            k in err.lower()
            for k in ("expired", "unsubscribed", "use this phone only", "no push subscription")
        )
    )
    return {
        "ok": ok,
        "error": err,
        "needsResubscribe": needs_resubscribe,
        "hint": (
            "Tap “Use this phone only” to refresh this device, then try again with the app closed."
            if needs_resubscribe
            else "Close the app completely, then wait a few seconds for the banner."
        ),
    }


def clear_daily_reminder_state(user_id: int) -> None:
    """Allow a new reminder time to fire again the same day."""
    state = dict(_user_push_state(user_id))
    for key in (
        "lastDailyReminder",
        "lastDailyReminderDateKey",
        "lastDailyReminderHhmm",
        "pendingDailyReminder",
    ):
        state.pop(key, None)
    ack = state.get("lastDeliveryAck")
    if isinstance(ack, dict) and str(ack.get("tag") or "") == "diari-daily-reminder":
        state.pop("lastDeliveryAck", None)
    _save_push_state(user_id, state)


def schedule_status_for_user(user_id: int) -> dict:
    """What the cron dispatcher will use for this account (for debugging)."""
    entries = _serialize_entries_for_user(user_id)
    prefs = _user_notification_prefs(user_id)
    reminder = _resolve_reminder_hhmm(prefs, entries)
    now = _manila_now()
    h, m = _manila_hm(now)
    state = dict(_user_push_state(user_id))
    state_reconciled = False
    has_entry = _has_entry_today_manila(entries)
    hhmm = f"{reminder[0]:02d}:{reminder[1]:02d}" if reminder else None
    last_daily = state.get("lastDailyReminder")
    if isinstance(last_daily, dict):
        last_daily_out = {
            "dateKey": last_daily.get("dateKey"),
            "hhmm": last_daily.get("hhmm"),
        }
    else:
        last_daily_out = None
    today_key = _manila_date_key(now)
    if reminder and _reconcile_legacy_daily_without_ack(state, today_key, reminder):
        state_reconciled = True
    confirmed_today = (
        _daily_reminder_confirmed_on_phone(state, today_key, reminder) if reminder else False
    )
    pending_daily = (
        _pending_daily_matches(state, today_key, reminder) if reminder else None
    )
    due_now = bool(
        not has_entry
        and prefs["dailyEnabled"]
        and reminder
        and _reminder_due_in_window(h, m, reminder)
        and not confirmed_today
        and _should_send_daily_now(state, today_key, reminder)[0]
    )
    prefs_blob = db._load_ui_preferences_blob(user_id)
    push_debug = prefs_blob.get("pushDebug") if isinstance(prefs_blob.get("pushDebug"), dict) else {}
    last_client = push_debug.get("lastClientReport")
    last_client_at = push_debug.get("lastClientReportAt")
    subs = db.list_push_subscriptions_for_user(user_id)
    devices = len(subs)
    device_hints = [
        _endpoint_hint(s.get("endpoint") or s.get("_endpoint") or "") for s in subs[:5]
    ]
    last_ack = state.get("lastDeliveryAck")
    if isinstance(last_ack, dict):
        last_ack_out = {
            "at": last_ack.get("at"),
            "title": last_ack.get("title"),
            "tag": last_ack.get("tag"),
        }
    else:
        last_ack_out = None
    sched = push_scheduler_health()
    internal_off = bool(sched.get("internalCronDisabled"))
    last_dispatch = sched.get("lastDispatchAt")
    if state_reconciled:
        _save_push_state(user_id, state)
    return {
        "manilaNow": f"{h:02d}:{m:02d}",
        "dateKey": _manila_date_key(now),
        "reminderTimeOverride": prefs["reminderTimeOverride"],
        "reminderTimeUsed": hhmm,
        "reminderSource": (
            "override" if _parse_hhmm(prefs["reminderTimeOverride"]) else "most_active_hour"
        ),
        "dispatchWindowMinutes": DISPATCH_WINDOW_MINUTES,
        "internalCronRequired": False,
        "dailyEnabled": prefs["dailyEnabled"],
        "hasEntryToday": has_entry,
        "dailyDueNow": due_now,
        "dailyAlreadySentToday": confirmed_today,
        "dailyPushPending": bool(pending_daily),
        "pendingDailyReminder": pending_daily,
        "dailyDeliveryStatus": (
            "confirmed_on_phone"
            if confirmed_today
            else (
                "sent_to_google_waiting_for_phone"
                if pending_daily
                else "not_sent_yet"
            )
        ),
        "serverLastDailyReminder": last_daily_out,
        "serverLegacyDailyDateKey": state.get("lastDailyReminderDateKey"),
        "serverLegacyDailyHhmm": state.get("lastDailyReminderHhmm"),
        "alreadySentHint": (
            "Banner confirmed on this phone (service worker reported delivery)."
            if confirmed_today
            else (
                "Google accepted the push but this phone has not confirmed yet — fully close the app, "
                "disable battery saver for Chrome, wait up to 5 min for a retry. Tap Reset “sent today” to test again."
                if pending_daily
                else "No daily push confirmed on this phone yet today."
            )
        ),
        "deliveryMismatchWarning": (
            "Push reached Google but this phone has not shown the banner yet. "
            "Fully close the app (swipe away), set Chrome battery to Unrestricted, and wait for a retry."
            if pending_daily and not confirmed_today
            else None
        ),
        "subscribedDevices": devices,
        "registrationOk": devices >= 1,
        "lastClientDiagnostics": last_client if isinstance(last_client, dict) else None,
        "lastClientDiagnosticsAt": last_client_at,
        "criticalWarning": (
            "No device registered on the server — reminders cannot be delivered while the app is closed. "
            "Keep the app open for a few seconds and tap “Use this phone only” until this shows 1 device."
            if devices < 1
            else None
        ),
        "lastPushReceivedOnPhone": last_ack_out,
        "subscriptionDeviceHints": device_hints,
        "subscriptionWarning": (
            f"You have {devices} registered devices. Reminders may go to an old phone or browser tab. "
            "In Profile → Preferences tap “Use this phone only”, then test again."
            if devices > 1
            else None
        ),
        "internalCronDisabled": internal_off,
        "schedulerStarted": sched.get("schedulerStarted"),
        "lastServerDispatchAt": last_dispatch,
        "scheduledDispatchActive": sched.get("scheduledDispatchActive"),
        "needsCron": (
            "DISABLE_INTERNAL_PUSH_CRON is on — scheduled reminders will NOT run until you "
            "remove that Railway variable or add an external cron that POSTs "
            "/api/internal/push/dispatch every minute with header X-Push-Cron-Secret."
            if internal_off
            else (
                "Server should dispatch every 60s automatically. If lastServerDispatchAt stays "
                "empty for several minutes, check Railway logs for [diari-push-cron]."
            )
        ),
    }


def _pick(pool: list) -> str:
    if not pool:
        return ""
    return random.choice(pool)


def _fill(tpl: str, **kwargs) -> str:
    return re.sub(
        r"\{(\w+)\}",
        lambda m: str(kwargs.get(m.group(1), "")),
        tpl or "",
    )


def _build_daily_body() -> str:
    return _pick(_load_templates().get("daily") or [])


def _build_streak_body(phase: str, streak: int) -> str:
    key = "streak30min" if phase == "30min" else "streak1hr"
    return _fill(_pick(_load_templates().get(key) or []), streak=max(1, streak))


def _mood_bucket(mood: str) -> str:
    m = (mood or "neutral").lower()
    if m == "happy":
        return "high"
    if m in ("sad", "angry", "anxious"):
        return "low"
    if m == "neutral":
        return "neutral"
    return "mid"


def _reflective_tone(mood: str) -> str:
    return (_load_templates().get("toneByMood") or {}).get(
        (mood or "neutral").lower(), "mixed or shifting feelings"
    )


def _build_insight_body(entry: dict) -> str:
    t = _load_templates()
    mood = (entry.get("emotionLabel") or entry.get("feeling") or "neutral").lower()
    bucket = _mood_bucket(mood)
    pool_key = {
        "high": "insightHigh",
        "low": "insightLow",
        "neutral": "insightNeutral",
        "mid": "insightMid",
    }[bucket]
    phrase_key = {
        "high": "phrasesHigh",
        "low": "phrasesLow",
        "neutral": "phrasesNeutral",
        "mid": "phrasesMid",
    }[bucket]
    title = (entry.get("title") or "").strip()[:60] or "your recent entry"
    text = (entry.get("text") or "").strip()
    snippet = (text.split("\n")[0][:60] if text else title) or title
    insight = _pick(t.get(phrase_key) or [])
    tone = _reflective_tone(mood)
    return _fill(
        _pick(t.get(pool_key) or []),
        tone=tone,
        insight=insight,
        title=title,
        snippet=snippet,
    )


def _subscription_recently_registered(stored: dict, *, seconds: int | None = None) -> bool:
    """True if this device row was saved recently (protect from instant FCM 410 after subscribe)."""
    if not isinstance(stored, dict):
        return False
    raw = stored.get("_updatedAt")
    if raw is None:
        return False
    grace = seconds if seconds is not None else PUSH_SUBSCRIPTION_GRACE_SECONDS
    try:
        if isinstance(raw, datetime):
            updated = raw if raw.tzinfo else raw.replace(tzinfo=timezone.utc)
        else:
            s = str(raw).strip().replace("Z", "+00:00")
            updated = datetime.fromisoformat(s)
            if updated.tzinfo is None:
                updated = updated.replace(tzinfo=timezone.utc)
        age = (datetime.now(timezone.utc) - updated.astimezone(timezone.utc)).total_seconds()
        return age < grace
    except Exception:
        return False


def _endpoint_hint(endpoint: str) -> str:
    ep = str(endpoint or "").strip()
    if not ep:
        return ""
    if "fcm.googleapis.com" in ep or "googleapis.com" in ep:
        return "Android/Chrome (FCM)"
    if "mozilla.com" in ep:
        return "Firefox"
    if "apple.com" in ep or "push.apple.com" in ep:
        return "Apple"
    return ep[-36:] if len(ep) > 36 else ep


def send_web_push(
    subscription: dict,
    title: str,
    body: str,
    url: str = "/write-entry.html",
    *,
    tag: str = "diari-web-push",
) -> tuple[bool, str | None]:
    """Returns (ok, error_message)."""
    vapid = _get_vapid()
    if not vapid:
        return False, "VAPID keys invalid — set VAPID_PRIVATE_KEY to PEM from scripts/generate_vapid_keys.py"
    sub_info, sub_err = _subscription_for_webpush(subscription)
    if sub_err == "stale_vapid":
        ep = str(subscription.get("endpoint") or "").strip()
        if ep:
            db.delete_push_subscription_by_endpoint(ep)
        return (
            False,
            "Device subscribed with old VAPID keys — in the PWA turn notifications off, then on again.",
        )
    if not sub_info:
        return False, f"Invalid push subscription ({sub_err or 'unknown'})."
    try:
        from pywebpush import WebPushException, webpush
    except ImportError:
        return False, "pywebpush not installed on server"
    payload = json.dumps({"title": title, "body": body, "url": url, "tag": tag})
    ep_hint = _endpoint_hint(sub_info.get("endpoint") or "")
    try:
        # pywebpush treats str keys via Vapid.from_string (raw/der), not PEM — pass Vapid01 instance.
        webpush(
            subscription_info=sub_info,
            data=payload,
            vapid_private_key=vapid,
            vapid_claims={"sub": vapid_claim_email()},
            headers={"Urgency": "high", "TTL": "86400"},
        )
        print(
            f"[diari-push-send] ok tag={tag} target={ep_hint}",
            flush=True,
        )
        return True, None
    except WebPushException as ex:
        status = getattr(ex, "response", None)
        code = getattr(status, "status_code", None) if status else None
        text = ""
        try:
            text = (status.text or "")[:200] if status is not None else ""
        except Exception:
            pass
        msg = (text or str(ex) or "").strip()
        endpoint = sub_info.get("endpoint")
        dead_sub = code in (404, 410) or any(
            k in msg.lower() for k in ("expired", "unsubscribed", "not registered")
        )
        if dead_sub and endpoint:
            if _subscription_recently_registered(subscription):
                print(
                    f"[diari-push-send] FAIL tag={tag} target={ep_hint} "
                    f"expired but kept (registered <{PUSH_SUBSCRIPTION_GRACE_SECONDS}s ago)",
                    flush=True,
                )
                return (
                    False,
                    "Push not ready yet on this phone — wait 30s and tap Test daily nudge now.",
                )
            db.delete_push_subscription_by_endpoint(endpoint)
        if code in (401, 403):
            return (
                False,
                f"WebPush HTTP {code}: VAPID rejected — tap Use this phone only in Profile.",
            )
        if dead_sub:
            print(
                f"[diari-push-send] FAIL tag={tag} target={ep_hint} expired subscription removed",
                flush=True,
            )
            return (
                False,
                "Push registration on this phone expired. Tap “Use this phone only”, then try again.",
            )
        print(
            f"[diari-push-send] FAIL tag={tag} target={ep_hint} code={code} {msg}",
            flush=True,
        )
        return False, f"WebPush failed ({code or 'error'}): {msg[:160]}"
    except Exception as ex:
        print(f"[diari-push-send] FAIL tag={tag} target={ep_hint} {ex}", flush=True)
        return False, str(ex)[:200]


def send_test_push_to_all() -> dict:
    """Send test push to every subscribed device (cron / ops)."""
    purged = purge_stale_push_subscriptions()
    grouped = db.list_push_subscriptions_grouped_by_user()
    results = []
    sent = 0
    errors = 0
    last_error = None
    for user_id, subs in grouped.items():
        for sub in subs:
            ok, err = send_web_push(
                sub,
                "DiariCore test",
                "If you see this, true push is working — even when the app is closed.",
                "/dashboard.html",
                tag="diari-web-push-test",
            )
            results.append({"userId": user_id, "ok": ok, "error": err})
            if ok:
                sent += 1
            else:
                errors += 1
                if err:
                    last_error = err
    out = {
        "ok": sent > 0,
        "sent": sent,
        "errors": errors,
        "users": len(grouped),
        "results": results,
        "pushBackendVersion": PUSH_BACKEND_VERSION,
        "staleSubscriptionsPurged": purged,
    }
    if last_error:
        out["lastError"] = last_error
    if sent == 0 and not grouped:
        out["hint"] = (
            "No devices subscribed. Open the installed PWA, Profile → turn notifications on, Allow."
        )
    elif sent == 0 and purged > 0:
        out["hint"] = (
            "Stale subscriptions removed after VAPID key change. Re-enable notifications in the PWA, then test again."
        )
    return out


def send_test_push_to_user(user_id: int) -> dict:
    """Immediate test notification (ignores schedule and entry-today rules)."""
    purged = purge_stale_push_subscriptions()
    grouped = db.list_push_subscriptions_grouped_by_user()
    subs = grouped.get(int(user_id)) or []
    if not subs:
        return {"ok": False, "error": "No push subscription for this account. Allow notifications in the installed PWA."}
    results = []
    sent = 0
    for sub in subs:
        ok, err = send_web_push(
            sub,
            "DiariCore test",
            "If you see this, true push is working — even when the app is closed.",
            "/dashboard.html",
            tag="diari-web-push-test",
        )
        if ok:
            sent += 1
        results.append({"ok": ok, "error": err})
    out = {
        "ok": sent > 0,
        "sent": sent,
        "devices": len(subs),
        "results": results,
        "pushBackendVersion": PUSH_BACKEND_VERSION,
        "staleSubscriptionsPurged": purged,
    }
    if sent == 0 and purged > 0:
        out["hint"] = (
            "Stale subscriptions removed after VAPID key change. Turn notifications off and on in Profile."
        )
    elif sent == 0 and not subs:
        out["hint"] = "No device subscribed. Turn notifications on in Profile and tap Allow."
    return out


def _should_fire_insight(state: dict, entry: dict, today_key: str) -> bool:
    if not entry or entry.get("id") is None:
        return False
    eid = str(entry["id"])
    if state.get("lastInsightEntryId") == eid and state.get("lastInsightDateKey") == today_key:
        return False
    raw = entry.get("createdAt") or entry.get("date")
    try:
        s = str(raw).strip()
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        elapsed = (datetime.now(timezone.utc) - dt).total_seconds()
    except Exception:
        return False
    min_delay = 45 * 60
    four_h = 4 * 3600
    if elapsed < min_delay:
        return False
    if four_h <= elapsed < 36 * 3600:
        return True
    h, m = _manila_hm()
    entry_day = _entry_manila_date_key(entry)
    return h == 10 and m == 0 and entry_day != today_key


def dispatch_due_notifications(debug: bool = False) -> dict:
    """
    Called by cron every minute. Sends Web Push to subscribed PWA users.
    Returns summary stats.
    """
    if not push_configured():
        return {"ok": False, "error": "VAPID keys not configured", "sent": 0}

    purged = purge_stale_push_subscriptions()
    grouped = db.list_push_subscriptions_grouped_by_user()
    subscribed_ids = set(grouped.keys())
    now = _manila_now()
    today_key = _manila_date_key(now)
    h, m = _manila_hm(now)
    sent = 0
    errors = 0
    last_error = None
    skipped_entry_today = 0
    daily_due_users = 0
    user_debug: list[dict] = []

    for user_id, subs in grouped.items():
        if not subs:
            continue
        if len(subs) > 1:
            db.prune_push_subscriptions_for_user(user_id, max_keep=1)
            subs = db.list_push_subscriptions_for_user(user_id)
        if not subs:
            continue
        entries = _serialize_entries_for_user(user_id)
        prefs = _user_notification_prefs(user_id)
        state = dict(_user_push_state(user_id))
        state_dirty = False
        has_entry_today = _has_entry_today_manila(entries)

        reminder = _resolve_reminder_hhmm(prefs, entries)
        if reminder and _reconcile_legacy_daily_without_ack(
            state, today_key, reminder
        ):
            state_dirty = True
        if reminder and _ack_confirms_daily_reminder(state, today_key, reminder):
            if _pending_daily_matches(state, today_key, reminder) or not _daily_reminder_fired_today(
                state, today_key, reminder
            ):
                _mark_daily_reminder_sent(state, today_key, reminder)
                state_dirty = True
        dbg = {
            "userId": user_id,
            "reminderTimeOverride": prefs["reminderTimeOverride"],
            "reminderTimeUsed": (
                f"{reminder[0]:02d}:{reminder[1]:02d}" if reminder else None
            ),
            "dailyEnabled": prefs["dailyEnabled"],
            "hasEntryToday": has_entry_today,
            "inReminderWindow": (
                _reminder_due_in_window(h, m, reminder) if reminder else False
            ),
            "alreadySentToday": (
                _daily_reminder_fired_today(state, today_key, reminder)
                if reminder
                else False
            ),
            "devices": len(subs),
        }

        def _push_all(
            title: str, body: str, url: str, *, tag: str = "diari-web-push"
        ) -> tuple[bool, int, int]:
            nonlocal sent, errors, last_error
            ok_count = 0
            fail_count = 0
            for sub in subs:
                ok, err = send_web_push(sub, title, body, url, tag=tag)
                if ok:
                    sent += 1
                    ok_count += 1
                else:
                    errors += 1
                    fail_count += 1
                    if err:
                        last_error = err
            dbg["pushOk"] = ok_count
            dbg["pushFail"] = fail_count
            dbg["pushTargets"] = [
                _endpoint_hint(sub.get("endpoint") or "") for sub in subs[:6]
            ]
            return ok_count > 0, ok_count, fail_count

        # Daily + streak: only when user has not journaled today (Manila).
        if not has_entry_today:
            if (
                prefs["dailyEnabled"]
                and reminder
                and _reminder_due_in_window(h, m, reminder)
            ):
                daily_due_users += 1
                should_send, skip_reason = _should_send_daily_now(
                    state, today_key, reminder
                )
                dbg["dailySendAllowed"] = should_send
                dbg["dailySkipReason"] = skip_reason
                dbg["alreadyConfirmedOnPhone"] = _daily_reminder_confirmed_on_phone(
                    state, today_key, reminder
                )
                if should_send:
                    dbg["dailyFiring"] = True
                    target = subs[:1]
                    ok_n = 0
                    fail_n = 0
                    last_ep = ""
                    pending_prev = _pending_daily_matches(state, today_key, reminder)
                    prev_attempts = (
                        int(pending_prev.get("attempts") or 0) if pending_prev else 0
                    )
                    for sub in target:
                        ep_raw = sub.get("endpoint") or sub.get("_endpoint") or ""
                        last_ep = _endpoint_hint(ep_raw)
                        ok, err = send_web_push(
                            sub,
                            "A gentle journal nudge",
                            _build_daily_body(),
                            "/write-entry.html",
                            tag="diari-daily-reminder",
                        )
                        if ok:
                            sent += 1
                            ok_n += 1
                        else:
                            errors += 1
                            fail_n += 1
                            if err:
                                last_error = err
                    dbg["pushOk"] = ok_n
                    dbg["pushFail"] = fail_n
                    dbg["dailyPushOk"] = ok_n
                    dbg["dailyPushFail"] = fail_n
                    dbg["dailyPushTarget"] = last_ep
                    if ok_n > 0:
                        _mark_daily_reminder_pending(
                            state,
                            today_key,
                            reminder,
                            attempts=prev_attempts + 1,
                        )
                        state_dirty = True
                        state["lastDailyPushTarget"] = last_ep
                        dbg["dailyPushPending"] = state.get("pendingDailyReminder")
                    elif fail_n > 0:
                        dbg["dailyPushHint"] = (
                            "Push failed for this device — open the PWA and tap Use this phone only."
                        )

            streak = _compute_streak(entries)
            if prefs["streakEnabled"] and prefs["dailyEnabled"] and streak > 0:
                if (
                    h == 23
                    and m == 0
                    and state.get("lastStreak1hrDateKey") != today_key
                ):
                    if _push_all(
                        "Your streak tonight",
                        _build_streak_body("1hr", streak),
                        "/write-entry.html",
                        tag="diari-streak-reminder",
                    )[0]:
                        state["lastStreak1hrDateKey"] = today_key
                        state_dirty = True
                if (
                    h == 23
                    and m == 30
                    and state.get("lastStreak30minDateKey") != today_key
                ):
                    if _push_all(
                        "Before the day ends",
                        _build_streak_body("30min", streak),
                        "/write-entry.html",
                        tag="diari-streak-reminder",
                    )[0]:
                        state["lastStreak30minDateKey"] = today_key
                        state_dirty = True
        else:
            skipped_entry_today += 1

        # Last-entry insight: own schedule (may fire after user wrote today or yesterday).
        if prefs["insightEnabled"] and entries:
            last = entries[0]
            if _should_fire_insight(state, last, today_key):
                if _push_all(
                    "Following up on your journal",
                    _build_insight_body(last),
                    "/entries.html",
                    tag="diari-insight-followup",
                )[0]:
                    state["lastInsightEntryId"] = str(last.get("id"))
                    state["lastInsightDateKey"] = today_key
                    state_dirty = True

        if state_dirty:
            _save_push_state(user_id, state)

        if debug:
            user_debug.append(dbg)

    daily_due_no_device = 0
    for user_id in db.list_user_ids_with_daily_reminders_enabled():
        if user_id in subscribed_ids:
            continue
        prefs = _user_notification_prefs(user_id)
        if not prefs.get("dailyEnabled", True):
            continue
        entries = _serialize_entries_for_user(user_id)
        if _has_entry_today_manila(entries):
            continue
        reminder = _resolve_reminder_hhmm(prefs, entries)
        if not reminder or not _reminder_due_in_window(h, m, reminder):
            continue
        state = _user_push_state(user_id)
        if _daily_reminder_fired_today(state, today_key, reminder):
            continue
        daily_due_no_device += 1
        print(
            f"[diari-push-cron] manila={h:02d}:{m:02d} user={user_id} "
            "dailyDue=1 NO_DEVICE_REGISTERED (open PWA → Use this phone only)",
            flush=True,
        )

    out = {
        "ok": True,
        "sent": sent,
        "errors": errors,
        "users": len(grouped),
        "skippedEntryToday": skipped_entry_today,
        "manilaTime": f"{h:02d}:{m:02d}",
        "dateKey": today_key,
        "pushBackendVersion": PUSH_BACKEND_VERSION,
        "staleSubscriptionsPurged": purged,
        "dailyDueUsers": daily_due_users,
        "dailyDueNoDevice": daily_due_no_device,
        "dispatchWindowMinutes": DISPATCH_WINDOW_MINUTES,
    }
    if debug:
        out["userDebug"] = user_debug
    if last_error:
        out["lastError"] = last_error
    if daily_due_no_device > 0:
        out["hint"] = (
            f"{daily_due_no_device} user(s) due for reminder but zero devices registered — "
            "open the PWA once to register push."
        )
    elif daily_due_users > 0 and sent == 0:
        out["hint"] = "Daily reminder was due but send failed — check lastError."
    return out
