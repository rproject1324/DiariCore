"""Local: test VAPID_PRIVATE_KEY parsing (run after generate_vapid_keys.py)."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from py_vapid import Vapid01
import base64
from cryptography.hazmat.primitives import serialization

import push_service

v = Vapid01()
v.generate_keys()
pub = base64.urlsafe_b64encode(
    v.public_key.public_bytes(
        encoding=serialization.Encoding.X962,
        format=serialization.PublicFormat.UncompressedPoint,
    )
).decode().rstrip("=")
pem = v.private_pem().decode()
one = pem.replace("\n", "\\n")


def try_load(label: str, priv: str) -> None:
    push_service._vapid_instance = None
    os.environ["VAPID_PRIVATE_KEY"] = priv
    os.environ["VAPID_PUBLIC_KEY"] = pub
    got = push_service._get_vapid()
    pem_ok = False
    if got:
        try:
            p = got.private_pem()
            pem_ok = bool(p)
        except Exception:
            pass
    print(f"{label:30} -> vapid={bool(got)} signable={pem_ok}")


cases = [
    ("pem_multiline", pem),
    ("one_line_escaped", one),
    ("one_line_real_nl", one.replace("\\n", "\n")),
    ("spaces_not_newlines", pem.replace("\n", " ")),
    ("double_backslash_n", pem.replace("\n", "\\\\n")),
    ("with_quotes", f'"{one}"'),
    ("missing_end_truncated", pem[:80]),
    ("only_body_no_headers", "\n".join(pem.splitlines()[1:-1])),
]
for label, val in cases:
    try_load(label, val)
