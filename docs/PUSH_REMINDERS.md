# PWA scheduled push reminders

## How it works

1. **Installed PWA** subscribes via Web Push (Profile → notifications on → Allow).
2. **Reminder time** is saved to the server in `users.ui_preferences_json.notifications.reminderTimeOverride`.
3. **Every minute**, the server runs `dispatch_due_notifications()` and sends a daily nudge if:
   - Daily reminders are enabled
   - No journal entry today (Asia/Manila calendar day)
   - Current Manila time is within 15 minutes after your reminder time
   - Not already sent today for that reminder time

**Test push** (`POST /api/push/test`) sends immediately and does not use the schedule.

## Railway: enable the dispatcher

Scheduled reminders **do not run** if `DISABLE_INTERNAL_PUSH_CRON=1` unless you add an external cron.

**Recommended:** Remove `DISABLE_INTERNAL_PUSH_CRON` from Railway variables (or set it to `0`). Redeploy. Logs should show `[diari-push-cron] started` and every minute `manila=HH:MM sent=...`.

**Alternative:** Keep `DISABLE_INTERNAL_PUSH_CRON=1` and use [cron-job.org](https://cron-job.org) (or similar):

- URL: `https://YOUR-APP.up.railway.app/api/internal/push/dispatch`
- Method: POST
- Schedule: every 1 minute
- Header: `X-Push-Cron-Secret: <your PUSH_CRON_SECRET>`

## Debug from the PWA (logged in)

In DevTools console on the installed PWA:

```js
const r = await fetch('/api/push/schedule-status', { credentials: 'same-origin' });
console.log(await r.json());
```

Check:

| Field | Meaning |
|--------|---------|
| `reminderTimeUsed` | Time the server will use (must match what you set) |
| `internalCronDisabled` | If `true`, scheduled push will not run until fixed |
| `lastServerDispatchAt` | Should update every ~60s when cron is active |
| `dailyDueNow` | `true` only during your 15-minute window with no entry today |
| `dailyAlreadySentToday` | If `true`, server already sent (or tried) today — reset for retest |
| `hasEntryToday` | If `true`, daily reminder is skipped |
| `subscribedDevices` | Must be ≥ 1 on the device you expect |

Reset “already sent today” for testing:

```js
await fetch('/api/push/reset-daily-reminder', { method: 'POST', credentials: 'same-origin' });
```

## Common mistakes

- Testing in **Chrome desktop tab** instead of the **installed PWA** — push goes to the subscribed device only.
- Expecting a notification **when you open the app** — that was often the **test push** on startup (now only runs once until confirmed).
- **Local** service-worker reminders only run while the app can wake the SW; **closed-app** reminders need server dispatch.
