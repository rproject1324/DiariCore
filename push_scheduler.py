"""Background thread: run push dispatch every 60s (no external cron required)."""
from __future__ import annotations

import os
import threading
import time
from datetime import datetime, timezone

_started_lock = threading.Lock()
_started_workers: set[int] = set()
_lock = threading.Lock()
_last_dispatch_at: str | None = None
_last_dispatch_summary: dict | None = None
_worker_pid: int | None = None


def status() -> dict:
    return {
        "schedulerStarted": bool(_started_workers),
        "workerPids": sorted(_started_workers),
        "lastDispatchAt": _last_dispatch_at,
        "lastDispatch": _last_dispatch_summary,
    }


def start(worker_id: int | None = None) -> None:
    """Start dispatch loop in this OS process (call from gunicorn post_fork or dev)."""
    global _worker_pid
    wid = worker_id if worker_id is not None else os.getpid()
    with _started_lock:
        if wid in _started_workers:
            return
        if os.environ.get("DISABLE_INTERNAL_PUSH_CRON", "").lower() in ("1", "true", "yes"):
            return
        if not (os.environ.get("VAPID_PUBLIC_KEY") or "").strip():
            return
        _started_workers.add(wid)
        _worker_pid = wid

    def loop() -> None:
        time.sleep(max(1.0, 60.0 - (time.time() % 60.0)))
        import push_service

        while True:
            try:
                with _lock:
                    result = push_service.dispatch_due_notifications()
                global _last_dispatch_at, _last_dispatch_summary
                _last_dispatch_at = datetime.now(timezone.utc).isoformat()
                _last_dispatch_summary = {
                    "manilaTime": result.get("manilaTime"),
                    "sent": result.get("sent"),
                    "dailyDueUsers": result.get("dailyDueUsers"),
                    "skippedEntryToday": result.get("skippedEntryToday"),
                    "ok": result.get("ok"),
                    "error": result.get("error"),
                    "userSummary": result.get("userSummary"),
                }
                print(
                    "[diari-push-cron] "
                    f"manila={result.get('manilaTime')} sent={result.get('sent')} "
                    f"dailyDue={result.get('dailyDueUsers')} skippedEntry={result.get('skippedEntryToday')}",
                    flush=True,
                )
                for row in result.get("userSummary") or []:
                    print(
                        "[diari-push-cron] "
                        f"user={row.get('userId')} reminder={row.get('reminderTimeUsed')} "
                        f"override={row.get('override')!r} why={row.get('whyNotDue')}",
                        flush=True,
                    )
            except Exception as ex:
                print(f"[diari-push-cron] ERROR: {ex}", flush=True)
            time.sleep(60.0)

    threading.Thread(
        target=loop, daemon=True, name=f"diari-push-cron-{wid}"
    ).start()
    print(f"[diari-push-cron] started in worker pid={wid}", flush=True)
