"""
Build PWA home-screen / manifest icons only.

Outputs diariclogo-pwa-*.png — does NOT modify diariclogo.png used in the app UI.
Run: py -3 scripts/build_pwa_icons.py
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image

IMG = Path(__file__).resolve().parent.parent / "static" / "img"
SOURCE = IMG / "diariclogo.png"
BG = (0x6F, 0x8F, 0x7F, 255)
# Smaller artwork so the book is not cropped on Android adaptive icons.
ART_SCALE = 0.56
# Maskable safe zone (~80% diameter).
MASKABLE_SCALE = 0.72


def _compose(size: int, scale: float, dest: Path) -> None:
    src = Image.open(SOURCE).convert("RGBA")
    canvas = Image.new("RGBA", (size, size), BG)
    art_max = max(1, int(size * scale))
    fitted = src.copy()
    fitted.thumbnail((art_max, art_max), Image.Resampling.LANCZOS)
    x = (size - fitted.width) // 2
    y = (size - fitted.height) // 2
    canvas.paste(fitted, (x, y), fitted)
    canvas.convert("RGB").save(dest, format="PNG", optimize=True)
    print(f"wrote {dest.name} ({size}x{size}, scale={scale})")


def main() -> None:
    if not SOURCE.is_file():
        raise SystemExit(f"missing source: {SOURCE}")
    _compose(192, ART_SCALE, IMG / "diariclogo-pwa-192.png")
    _compose(512, ART_SCALE, IMG / "diariclogo-pwa-512.png")
    _compose(512, MASKABLE_SCALE, IMG / "diariclogo-pwa-maskable.png")


if __name__ == "__main__":
    main()
