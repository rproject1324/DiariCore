"""Build PWA / home-screen icons from diariclogo-art.png (transparent artwork)."""
from __future__ import annotations

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
IMG = ROOT / "static" / "img"
SOURCE = IMG / "diariclogo-art.png"
OUT_MAIN = IMG / "diariclogo.png"
OUT_MASKABLE = IMG / "diariclogo-maskable.png"

BG_RGB = (0x6F, 0x8F, 0x7F, 255)
# Home-screen icon: smaller logo with padding (was too tight / zoomed).
LOGO_SCALE = 0.56
# Maskable safe zone (~80% diameter in center).
MASKABLE_SCALE = 0.48


def _prepare_artwork(src: Image.Image) -> Image.Image:
    img = src.convert("RGBA")
    px = img.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a < 16:
                continue
            if r < 40 and g < 40 and b < 40:
                px[x, y] = (r, g, b, 0)
    return img


def _render(size: int, scale: float, src: Image.Image) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), BG_RGB)
    target_w = max(1, int(size * scale))
    ratio = target_w / src.width
    target_h = max(1, int(src.height * ratio))
    art = src.resize((target_w, target_h), Image.Resampling.LANCZOS)
    x = (size - target_w) // 2
    y = (size - target_h) // 2
    canvas.paste(art, (x, y), art)
    return canvas.convert("RGB")


def main() -> None:
    if not SOURCE.is_file():
        raise SystemExit(f"Missing source artwork: {SOURCE}")

    art = _prepare_artwork(Image.open(SOURCE))
    _render(512, LOGO_SCALE, art).save(OUT_MAIN, "PNG", optimize=True)
    _render(512, MASKABLE_SCALE, art).save(OUT_MASKABLE, "PNG", optimize=True)
    print(f"Wrote {OUT_MAIN} (scale={LOGO_SCALE})")
    print(f"Wrote {OUT_MASKABLE} (scale={MASKABLE_SCALE})")


if __name__ == "__main__":
    main()
