"""Background thread: run push dispatch every 60s (no external cron required)."""
from __future__ import annotations

import os
import tempfile
import threading
import time
from datetime import datetime, timezone

_started_lock = threading.Lock()
_started_workers: set[int] = set()
_lock = threading.Lock()
_last_dispatch_at: str | None = None
_last_dispatch_summary: dict | None = None
_worker_pid: int | None = None


def _internal_cron_disabled() -> bool:
    return os.environ.get("DISABLE_INTERNAL_PUSH_CRON", "").lower() in ("1", "true", "yes")

def _acquire_cross_process_lock() -> bool:
    """
    Ensure only one push cron loop runs across multiple gunicorn workers.
    Uses an atomic lock file creation in the OS temp directory.
    """
    name = os.environ.get("DIARI_PUSH_CRON_LOCK", "diaricore_push_cron.lock").strip() or "diaricore_push_cron.lock"
    path = os.path.join(tempfile.gettempdir(), name)
    try:
        fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        try:
            os.write(fd, str(os.getpid()).encode("utf-8", errors="ignore"))
        finally:
            os.close(fd)
        return True
    except FileExistsError:
        return False
    except Exception:
        # If locking fails unexpectedly, do not start duplicate loops.
        return False


def status() -> dict:
    disabled = _internal_cron_disabled()
    return {
        "schedulerStarted": bool(_started_workers),
        "internalCronDisabled": disabled,
        "scheduledDispatchActive": bool(_started_workers) and not disabled,
        "workerPids": sorted(_started_workers),
        "lastDispatchAt": _last_dispatch_at,
        "lastDispatch": _last_dispatch_summary,
        "hint": (
            "Scheduled reminders need dispatch every minute. Remove DISABLE_INTERNAL_PUSH_CRON "
            "on Railway, or POST /api/internal/push/dispatch each minute with X-Push-Cron-Secret."
            if disabled
            else None
        ),
    }


def start(worker_id: int | None = None) -> None:
    """Start dispatch loop in this OS process (call from gunicorn post_fork or dev)."""
    global _worker_pid
    wid = worker_id if worker_id is not None else os.getpid()
    with _started_lock:
        if wid in _started_workers:
            return
        if _internal_cron_disabled():
            print(
                "[diari-push-cron] DISABLED — set DISABLE_INTERNAL_PUSH_CRON=0 or unset it, "
                "or call POST /api/internal/push/dispatch every minute (X-Push-Cron-Secret).",
                flush=True,
            )
            return
        if not (os.environ.get("VAPID_PUBLIC_KEY") or "").strip():
            return
        if not _acquire_cross_process_lock():
            print("[diari-push-cron] skipped (another worker holds lock)", flush=True)
            return
        _started_workers.add(wid)
        _worker_pid = wid

    def loop() -> None:
        time.sleep(max(1.0, 60.0 - (time.time() % 60.0)))
        import push_service

        while True:
            try:
                with _lock:
                    result = push_service.dispatch_due_notifications(debug=True)
                global _last_dispatch_at, _last_dispatch_summary
                _last_dispatch_at = datetime.now(timezone.utc).isoformat()
                _last_dispatch_summary = {
                    "manilaTime": result.get("manilaTime"),
                    "sent": result.get("sent"),
                    "dailyDueUsers": result.get("dailyDueUsers"),
                    "skippedEntryToday": result.get("skippedEntryToday"),
                    "ok": result.get("ok"),
                    "error": result.get("error"),
                    "lastError": result.get("lastError"),
                }
                extra = ""
                if result.get("dailyDueUsers"):
                    ud = [u for u in (result.get("userDebug") or []) if u.get("dailyFiring") or u.get("inReminderWindow")]
                    if not ud:
                        ud = (result.get("userDebug") or [])[:3]
                    parts = []
                    for u0 in ud[:5]:
                        parts.append(
                            f"u{u0.get('userId')}@{u0.get('reminderTimeUsed') or '?'}"
                            f":ok={u0.get('dailyPushOk')} fail={u0.get('dailyPushFail')}"
                            f" skip={u0.get('dailySkipReason')}"
                        )
                    extra = " | " + "; ".join(parts) if parts else ""
                print(
                    "[diari-push-cron] "
                    f"manila={result.get('manilaTime')} sent={result.get('sent')} "
                    f"dailyDue={result.get('dailyDueUsers')} skippedEntry={result.get('skippedEntryToday')}"
                    f"{extra}",
                    flush=True,
                )
            except Exception as ex:
                print(f"[diari-push-cron] ERROR: {ex}", flush=True)
            time.sleep(60.0)

    threading.Thread(
        target=loop, daemon=True, name=f"diari-push-cron-{wid}"
    ).start()
    print(f"[diari-push-cron] started in worker pid={wid}", flush=True)
