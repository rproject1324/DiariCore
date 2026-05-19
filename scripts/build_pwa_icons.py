"""
Build PWA manifest / launcher icons only (does NOT modify diariclogo.png in the app UI).

- diariclogo-pwa-*.png — white background + logo (OS splash + launcher; no sage box flash)
- diariclogo-pwa-home-*.png — optional green-brand launcher assets

Run: py -3 scripts/build_pwa_icons.py
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image

IMG = Path(__file__).resolve().parent.parent / "static" / "img"
SOURCE = IMG / "diariclogo.png"
WHITE = (0xFF, 0xFF, 0xFF, 255)
BRAND_GREEN = (0x6F, 0x8F, 0x7F, 255)
ART_SCALE = 0.56
MASKABLE_SCALE = 0.72
NOTIF_ART_SCALE = 0.78


def _compose(size: int, scale: float, dest: Path, bg: tuple[int, int, int, int]) -> None:
    src = Image.open(SOURCE).convert("RGBA")
    canvas = Image.new("RGBA", (size, size), bg)
    art_max = max(1, int(size * scale))
    fitted = src.copy()
    fitted.thumbnail((art_max, art_max), Image.Resampling.LANCZOS)
    x = (size - fitted.width) // 2
    y = (size - fitted.height) // 2
    canvas.paste(fitted, (x, y), fitted)
    canvas.convert("RGB").save(dest, format="PNG", optimize=True)
    print(f"wrote {dest.name} ({size}x{size}, bg={'white' if bg == WHITE else 'brand'})")


def main() -> None:
    if not SOURCE.is_file():
        raise SystemExit(f"missing source: {SOURCE}")
    for size, scale, name in (
        (192, ART_SCALE, "diariclogo-pwa-192.png"),
        (512, ART_SCALE, "diariclogo-pwa-512.png"),
        (512, MASKABLE_SCALE, "diariclogo-pwa-maskable.png"),
    ):
        _compose(size, scale, IMG / name, WHITE)
    _compose(192, ART_SCALE, IMG / "diariclogo-pwa-home-192.png", BRAND_GREEN)
    _compose(512, ART_SCALE, IMG / "diariclogo-pwa-home-512.png", BRAND_GREEN)
    _compose(192, NOTIF_ART_SCALE, IMG / "diariclogo-pwa-notif-192.png", BRAND_GREEN)
    _compose(512, NOTIF_ART_SCALE, IMG / "diariclogo-pwa-notif-512.png", BRAND_GREEN)


if __name__ == "__main__":
    main()
