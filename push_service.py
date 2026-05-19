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


def push_health() -> dict:
    """Diagnostics for Railway / support (no secrets)."""
    pub = vapid_public_key()
    raw_priv = (os.environ.get("VAPID_PRIVATE_KEY") or "").strip().strip('"').strip("'")
    v = _get_vapid()
    pem_ok = False
    if v:
        try:
            _ = v.private_key
            pem_ok = True
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
        "configured": bool(pub and v and pem_ok),
        "publicKeySet": bool(pub),
        "privateKeySet": private_key_set,
        "privateKeySignable": pem_ok,
        "privateKeyStatus": private_key_status,
        "pywebpushInstalled": pywebpush_ok,
        "subscribedUsers": len(subs),
        "subscribedDevices": sum(len(s) for s in subs.values()),
    }


def _normalized_vapid_private_key() -> str | None:
    return vapid_private_key()


def vapid_claim_email() -> str:
    email = (os.environ.get("VAPID_CLAIM_EMAIL") or "mailto:support@diaricore.app").strip()
    if not email.startswith("mailto:"):
        email = f"mailto:{email}"
    return email


def push_configured() -> bool:
    h = push_health()
    return bool(h.get("configured") and h.get("privateKeySignable"))


def _manila_now() -> datetime:
    return datetime.now(NOTIFY_TZ)


def _manila_date_key(dt: datetime | None = None) -> str:
    d = dt or _manila_now()
    return d.strftime("%Y-%m-%d")


def _manila_hm(dt: datetime | None = None) -> tuple[int, int]:
    d = dt or _manila_now()
    return d.hour, d.minute


def _parse_hhmm(s: str) -> tuple[int, int] | None:
    m = re.match(r"^(\d{2}):(\d{2})$", str(s or "").strip())
    if not m:
        return None
    return int(m.group(1)), int(m.group(2))


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
        "reminderTimeOverride": (n.get("reminderTimeOverride") or "").strip(),
    }


def _user_push_state(user_id: int) -> dict:
    blob = db._load_ui_preferences_blob(user_id)
    s = blob.get("pushState")
    return s if isinstance(s, dict) else {}


def _save_push_state(user_id: int, state: dict) -> None:
    db.merge_user_ui_preferences_json(user_id, {"pushState": state})


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


def send_web_push(
    subscription: dict, title: str, body: str, url: str = "/write-entry.html"
) -> tuple[bool, str | None]:
    """Returns (ok, error_message)."""
    vapid = _get_vapid()
    if not vapid:
        return False, "VAPID keys invalid — set VAPID_PRIVATE_KEY to PEM from scripts/generate_vapid_keys.py"
    try:
        from pywebpush import WebPushException, webpush
    except ImportError:
        return False, "pywebpush not installed on server"
    payload = json.dumps({"title": title, "body": body, "url": url})
    try:
        pem = vapid.private_pem()
        if isinstance(pem, bytes):
            pem = pem.decode()
        webpush(
            subscription_info=subscription,
            data=payload,
            vapid_private_key=pem,
            vapid_claims={"sub": vapid_claim_email()},
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
        if code in (404, 410):
            endpoint = subscription.get("endpoint")
            if endpoint:
                db.delete_push_subscription_by_endpoint(endpoint)
        return False, f"WebPush HTTP {code}: {text or str(ex)}"
    except Exception as ex:
        return False, str(ex)[:200]


def send_test_push_to_all() -> dict:
    """Send test push to every subscribed device (cron / ops)."""
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
    }
    if last_error:
        out["lastError"] = last_error
    return out


def send_test_push_to_user(user_id: int) -> dict:
    """Immediate test notification (ignores schedule and entry-today rules)."""
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
        )
        if ok:
            sent += 1
        results.append({"ok": ok, "error": err})
    return {
        "ok": sent > 0,
        "sent": sent,
        "devices": len(subs),
        "results": results,
    }


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


def dispatch_due_notifications() -> dict:
    """
    Called by cron every minute. Sends Web Push to subscribed PWA users.
    Returns summary stats.
    """
    if not push_configured():
        return {"ok": False, "error": "VAPID keys not configured", "sent": 0}

    grouped = db.list_push_subscriptions_grouped_by_user()
    now = _manila_now()
    today_key = _manila_date_key(now)
    h, m = _manila_hm(now)
    sent = 0
    errors = 0
    last_error = None
    skipped_entry_today = 0

    for user_id, subs in grouped.items():
        if not subs:
            continue
        entries = _serialize_entries_for_user(user_id)
        prefs = _user_notification_prefs(user_id)
        state = dict(_user_push_state(user_id))
        state_dirty = False
        has_entry_today = _has_entry_today_manila(entries)

        reminder = _parse_hhmm(prefs["reminderTimeOverride"]) or _parse_hhmm(
            _most_active_hour_hhmm(entries)
        )

        def _push_all(title: str, body: str, url: str) -> bool:
            nonlocal sent, errors, last_error
            ok_any = False
            for sub in subs:
                ok, err = send_web_push(sub, title, body, url)
                if ok:
                    sent += 1
                    ok_any = True
                else:
                    errors += 1
                    if err:
                        last_error = err
            return ok_any

        # Daily + streak: only when user has not journaled today (Manila).
        if not has_entry_today:
            if (
                prefs["dailyEnabled"]
                and reminder
                and h == reminder[0]
                and m == reminder[1]
                and state.get("lastDailyReminderDateKey") != today_key
            ):
                if _push_all(
                    "A gentle journal nudge",
                    _build_daily_body(),
                    "/write-entry.html",
                ):
                    state["lastDailyReminderDateKey"] = today_key
                    state_dirty = True

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
                    ):
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
                    ):
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
                ):
                    state["lastInsightEntryId"] = str(last.get("id"))
                    state["lastInsightDateKey"] = today_key
                    state_dirty = True

        if state_dirty:
            _save_push_state(user_id, state)

    out = {
        "ok": True,
        "sent": sent,
        "errors": errors,
        "users": len(grouped),
        "skippedEntryToday": skipped_entry_today,
        "manilaTime": f"{h:02d}:{m:02d}",
        "dateKey": today_key,
    }
    if last_error:
        out["lastError"] = last_error
    return out
