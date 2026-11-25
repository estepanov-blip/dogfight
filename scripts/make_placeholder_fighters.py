"""Temporary placeholder sprites for the six new v0.3 fighters (assetStatus: placeholder).

Derived from the existing temporary Шиба / Буль cut-outs by recolouring and
reshaping; NOT final art (see docs/ART_GUIDE.md and Q12).
Usage: python3 -I scripts/make_placeholder_fighters.py src/assets/game
"""
import sys
from pathlib import Path
from PIL import Image, ImageEnhance, ImageOps

root = Path(sys.argv[1])
out = root / "fighters"
out.mkdir(exist_ok=True)
shiba = Image.open(root / "shiba.png").convert("RGBA")
bull = Image.open(root / "bull.png").convert("RGBA")


def tint(im, rgb, amount):
    """Blend the colour channels towards `rgb` (keeps alpha and shading)."""
    r, g, b, a = im.split()
    gray = ImageOps.grayscale(Image.merge("RGB", (r, g, b)))
    col = ImageOps.colorize(gray, black=(20, 16, 14), white=rgb).convert("RGB")
    mixed = Image.blend(Image.merge("RGB", (r, g, b)), col, amount)
    return Image.merge("RGBA", (*mixed.split(), a))


def resize(im, sx, sy):
    w, h = im.size
    return im.resize((max(1, int(w * sx)), max(1, int(h * sy))), Image.LANCZOS)


def save(im, name):
    # keep a 512-high canvas, feet on the bottom, like the originals
    canvas = Image.new("RGBA", (max(im.width, 420), 512), (0, 0, 0, 0))
    canvas.alpha_composite(im, ((canvas.width - im.width) // 2, 512 - im.height))
    canvas.save(out / f"{name}.png", optimize=True)


save(resize(tint(shiba, (255, 225, 170), 0.55), 0.78, 0.78), "chih")  # Чихуахуа: small, cream
save(resize(ImageEnhance.Brightness(tint(shiba, (205, 170, 120), 0.6)).enhance(0.92), 1.12, 0.9), "puzan")  # Мопс: wide, fawn
save(tint(bull, (175, 190, 215), 0.55), "psikh")  # Хаски: grey-blue
save(resize(ImageEnhance.Brightness(tint(bull, (120, 85, 60), 0.75)).enhance(0.75), 1.08, 1.0), "heavy")  # Ротвейлер: dark, wide
save(resize(tint(shiba, (165, 80, 40), 0.6), 1.15, 0.82), "kolbasa")  # Такса: long, low, red-brown
save(ImageEnhance.Color(tint(shiba, (255, 190, 90), 0.5)).enhance(1.3), "pushok")  # Шпиц: bright orange
print("ok", sorted(p.name for p in out.iterdir()))
