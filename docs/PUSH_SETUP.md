# True push notifications (PWA, free)

DiariCore uses **Web Push + VAPID** (not Firebase). This is the standard free approach for installed PWAs and delivers notifications when the app is closed (subject to OS limits).

## Why not FCM?

- **FCM** is free and great for **native Android** apps.
- For **web/PWA**, Chrome still uses Web Push under the hood; FCM is optional.
- We use **VAPID directly** so you do not need a Firebase project.

## One-time setup (Railway)

1. Install deps locally: `py -m pip install pywebpush`
2. Generate keys: `py scripts/generate_vapid_keys.py`
3. Add to Railway variables:
   - `VAPID_PUBLIC_KEY`
   - `VAPID_PRIVATE_KEY`
   - `VAPID_CLAIM_EMAIL` (e.g. `mailto:you@example.com`)
   - `PUSH_CRON_SECRET` (random string)
4. Cron: call every minute:
   - `POST https://your-app.up.railway.app/api/internal/push/dispatch`
   - Header: `X-Push-Cron-Secret: <PUSH_CRON_SECRET>`

Use [cron-job.org](https://cron-job.org) or Railway cron if available.

## User flow

1. User installs PWA and allows notifications.
2. App calls `POST /api/push/subscribe` with the browser subscription.
3. Cron runs `dispatch_due_notifications()` — sends daily, streak (11:00 / 11:30 PM Manila), and insight reminders.

## Templates

Edit `static/js/pwa-notification-templates.js`, then run:

`py scripts/export_push_templates.py`

This updates `static/push-templates.json` for the server.
