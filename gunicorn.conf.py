"""Gunicorn config — start push dispatch scheduler inside each worker (threads do not survive fork)."""
import os


def _safe_int(name: str, default: int) -> int:
    raw = os.environ.get(name, "")
    if raw is None or str(raw).strip() == "":
        return default
    try:
        return max(1, int(raw))
    except ValueError:
        return default


bind = f"0.0.0.0:{os.environ.get('PORT', '8080')}"
workers = _safe_int("WEB_CONCURRENCY", 1)
threads = 1
timeout = 120


def post_fork(server, worker):
    try:
        import push_scheduler

        push_scheduler.start(worker_id=worker.pid)
    except Exception as ex:
        print(f"[gunicorn] push_scheduler post_fork failed: {ex}", flush=True)
