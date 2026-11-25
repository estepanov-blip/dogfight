"""Derive temporary transparent sprites from the low-res concept cut-outs.

Usage: python3 -I process_assets.py <assets_src_dir> <out_dir>

NOT final art: these are auto-masked cut-outs (flood fill of the dark
background from the image borders). Final 512x512 sprites must be drawn
separately (see docs/ART_GUIDE.md).
"""
import sys
from collections import deque
from pathlib import Path
from PIL import Image, ImageFilter

src = Path(sys.argv[1])
out = Path(sys.argv[2])
out.mkdir(parents=True, exist_ok=True)


def flood_mask(im, thresh, seeds=None, protect=None):
    """Return a set-like bytearray mask of background pixels reachable from borders."""
    w, h = im.size
    px = im.load()
    bg = bytearray(w * h)
    q = deque()
    if seeds is None:
        seeds = [(x, 0) for x in range(w)] + [(x, h - 1) for x in range(w)] + \
                [(0, y) for y in range(h)] + [(w - 1, y) for y in range(h)]
    for s in seeds:
        q.append(s)
    while q:
        x, y = q.popleft()
        if x < 0 or y < 0 or x >= w or y >= h:
            continue
        i = y * w + x
        if bg[i]:
            continue
        if protect and protect[0] <= x < protect[2] and protect[1] <= y < protect[3]:
            continue
        r, g, b = px[x, y][:3]
        if max(r, g, b) > thresh:
            continue
        bg[i] = 1
        q.extend(((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))
    return bg


def cutout(im, thresh, erase_box=None, crop=None, protect_rel=None):
    im = im.convert("RGBA")
    if crop:
        im = im.crop(crop)
    if erase_box:  # paint label banner black so it joins the background
        x0, y0, x1, y1 = erase_box
        px = im.load()
        for y in range(y0, y1):
            for x in range(x0, x1):
                px[x, y] = (0, 0, 0, 255)
    w, h = im.size
    protect = None
    if protect_rel:
        a, b, c, d = protect_rel
        protect = (int(a * w), int(b * h), int(c * w), int(d * h))
    bg = flood_mask(im, thresh, protect=protect)
    # keep only the largest opaque connected component (drops specks / label leftovers)
    comp = [0] * (w * h)
    best, best_id, cid = 0, 0, 0
    for start in range(w * h):
        if bg[start] or comp[start]:
            continue
        cid += 1
        size = 0
        q = deque([start])
        comp[start] = cid
        while q:
            i = q.popleft()
            size += 1
            x, y = i % w, i // w
            for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                if 0 <= nx < w and 0 <= ny < h:
                    j = ny * w + nx
                    if not bg[j] and not comp[j]:
                        comp[j] = cid
                        q.append(j)
        if size > best:
            best, best_id = size, cid
    alpha = Image.new("L", (w, h), 0)
    ap = alpha.load()
    for y in range(h):
        for x in range(w):
            if comp[y * w + x] == best_id:
                ap[x, y] = 255
    # soften the edge a little
    alpha = alpha.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.8))
    im.putalpha(alpha)
    bbox = im.getbbox()
    return im.crop(bbox) if bbox else im


def upscale(im, target_h):
    r = target_h / im.height
    return im.resize((round(im.width * r), target_h), Image.LANCZOS)


# Characters: label banner sits in the top-left corner (~110x45 px).
for name, box in (("shiba", (0, 0, 108, 48)), ("bull", (0, 0, 92, 42))):
    im = Image.open(src / "characters" / f"{name}.png")
    # the right edge of the bull crop contains a sliver of the neighbouring panel
    crop = (0, 0, im.width - 6, im.height) if name == "bull" else None
    # protect the dark shadow under the shorts (otherwise the flood leaks in between the legs)
    c = cutout(im, 34, erase_box=box, crop=crop, protect_rel=(0.4, 0.56, 0.6, 0.83))
    upscale(c, 512).save(out / f"{name}.png")

# Slot symbols: dark rounded tile -> transparent icon.
for s in ("punch", "critical", "block", "heal", "extra", "miss"):
    im = Image.open(src / "slots" / f"{s}.png").convert("RGBA")
    im = im.crop((6, 6, im.width - 6, im.height - 6))
    c = cutout(im, 70)
    upscale(c, 128).save(out / f"sym_{s}.png")

# Ring background: keep as is (low-res), just re-encode as jpg.
Image.open(src / "environments" / "ring.png").convert("RGB").save(out / "ring.jpg", quality=90)
print("ok")
