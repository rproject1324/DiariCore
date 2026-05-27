"""Gunicorn config — start push dispatch scheduler inside each worker (threads do not survive fork)."""
import os

bind = f"0.0.0.0:{os.environ.get('PORT', '8080')}"
workers = int(os.environ.get("WEB_CONCURRENCY", "1"))
threads = 1
timeout = 120


def post_fork(server, worker):
    try:
        import push_scheduler

        push_scheduler.start(worker_id=worker.pid)
    except Exception as ex:
        print(f"[gunicorn] push_scheduler post_fork failed: {ex}", flush=True)
