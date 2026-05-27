"""Gunicorn config — allow concurrent I/O; single push cron loop via lock."""
import os

bind = f"0.0.0.0:{os.environ.get('PORT', '8080')}"
# Higher concurrency prevents long requests from blocking the entire app.
worker_class = os.environ.get("GUNICORN_WORKER_CLASS", "gthread")
workers = max(1, int(os.environ.get("WEB_CONCURRENCY", "2")))
threads = max(1, int(os.environ.get("GUNICORN_THREADS", "4")))
timeout = int(os.environ.get("GUNICORN_TIMEOUT", "120"))
graceful_timeout = 30
keepalive = 5


def post_fork(server, worker):
    try:
        import push_scheduler

        push_scheduler.start(worker_id=worker.pid)
    except Exception as ex:
        print(f"[gunicorn] push_scheduler post_fork failed: {ex}", flush=True)
