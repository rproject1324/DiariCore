"""Generate VAPID keys for Web Push. Add output to Railway environment variables."""
import base64
import secrets

from cryptography.hazmat.primitives import serialization
from py_vapid import Vapid01

v = Vapid01()
v.generate_keys()

public_key = v.public_key.public_bytes(
    encoding=serialization.Encoding.X962,
    format=serialization.PublicFormat.UncompressedPoint,
)
public_key_b64 = base64.urlsafe_b64encode(public_key).decode().rstrip("=")

private_pem = v.private_pem().decode()
# Railway: paste PEM as one line with \n between lines, or use multiline variable
private_pem_one_line = private_pem.replace("\n", "\\n")

print("====================================")
print("Add these to Railway → Variables")
print("====================================\n")
print("VAPID_PUBLIC_KEY=" + public_key_b64)
pem_body = "".join(line for line in private_pem.splitlines() if not line.startswith("-----"))
print("\nVAPID_PRIVATE_KEY (easiest on Railway — one line, no PEM headers):")
print(pem_body)
print("\n--- OR multiline PEM ---")
print(private_pem)
print("\n--- OR single-line PEM with \\n ---")
print("VAPID_PRIVATE_KEY=" + private_pem_one_line)
print("\nVAPID_CLAIM_EMAIL=mailto:your-email@gmail.com")
print("PUSH_CRON_SECRET=" + secrets.token_urlsafe(32))
print("\nAfter updating keys, reinstall PWA and Allow notifications again.")
