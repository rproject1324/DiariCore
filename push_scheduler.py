"""Background thread: run push dispatch every 60s (no external cron required)."""
from __future__ import annotations

import os
import threading
import time

_started = False
_lock = threading.Lock()


def start() -> None:
    global _started
    if _started:
        return
    if os.environ.get("DISABLE_INTERNAL_PUSH_CRON", "").lower() in ("1", "true", "yes"):
        return
    if not (os.environ.get("VAPID_PUBLIC_KEY") or "").strip():
        return
    _started = True

    def loop() -> None:
        time.sleep(max(1.0, 60.0 - (time.time() % 60.0)))
        import push_service

        while True:
            try:
                with _lock:
                    push_service.dispatch_due_notifications()
            except Exception as ex:
                print(f"[diari-push-cron] {ex}", flush=True)
            time.sleep(60.0)

    threading.Thread(target=loop, daemon=True, name="diari-push-cron").start()
