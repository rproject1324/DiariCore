"""Generate VAPID keys for Web Push. Add output to Railway env vars."""
from py_vapid import Vapid

v = Vapid()
v.generate_keys()
print("VAPID_PUBLIC_KEY=" + v.public_key)
print("VAPID_PRIVATE_KEY=" + v.private_pem.decode())
print("VAPID_CLAIM_EMAIL=mailto:support@diaricore.app")
print("PUSH_CRON_SECRET=" + __import__("secrets").token_urlsafe(32))
