#!/usr/bin/env python3
"""Generate every app icon and logo asset from branding/ (needs Pillow: pip install pillow).

    python3 scripts/brand-icons.py

Sources: branding/Parley-Neon-Logo.png (the app logo: neon mark on a dark background) and branding/Parley-Logo.svg
(the flat mark; the web client and website draw it inline in the theme colour, and the favicon uses it because the
neon glow turns to mush at 16 px). Outputs:

  frontend/public/brand/parley-neon-256.png          logo on the login, loading and account pages
  frontend/public/favicon.svg                        flat mark in Parley violet
  frontend/public/icons/*.png                        installed web app icons (iPhone, Android, desktop browsers)
  desktop/assets/icon.png                            source for `tauri icon` (Windows, macOS, Linux app icons)
  desktop/www/logo.png, mobile/www/logo.png          connect screens of the desktop and mobile apps
  mobile/android/app/src/main/res/mipmap-*/          Android launcher icons (legacy, round, adaptive foreground)
  mobile/ios/App/App/Assets.xcassets/AppIcon...      iOS app icon (opaque 1024 px)

Masks that may crop to a circle (Android adaptive icons, the web "maskable" icon) keep only the middle third or so,
so those versions shrink the artwork and feather it into a matching background so the glow never gets clipped.
"""
import re
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
NEON = Image.open(ROOT / "branding/Parley-Neon-Logo.png").convert("RGB")
BG = (1, 9, 40)          # the neon artwork's edge colour, so padded versions blend in
VIOLET = "#6d5dfc"       # Parley accent (frontend --color-accent)


def neon(size: int) -> Image.Image:
    return NEON.resize((size, size), Image.LANCZOS)


def padded(size: int, scale: float = 0.8) -> Image.Image:
    """The artwork shrunk to `scale` and feathered into BG, for masks that crop to a circle."""
    canvas = Image.new("RGB", (size, size), BG)
    inner = int(size * scale)
    art = neon(inner)
    mask = Image.new("L", (inner, inner), 0)
    edge = max(2, inner // 14)
    ImageDraw.Draw(mask).rectangle([edge, edge, inner - edge, inner - edge], fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(edge / 2))
    off = (size - inner) // 2
    canvas.paste(art, (off, off), mask)
    return canvas


def rounded(img: Image.Image, radius: float, margin: float = 0.0) -> Image.Image:
    """img with rounded corners (radius as a fraction of the side) and an optional transparent margin."""
    size = img.size[0]
    inner = int(size * (1 - 2 * margin))
    art = img.resize((inner, inner), Image.LANCZOS).convert("RGBA")
    mask = Image.new("L", (inner * 4, inner * 4), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, inner * 4 - 1, inner * 4 - 1], radius=int(inner * 4 * radius), fill=255)
    art.putalpha(mask.resize((inner, inner), Image.LANCZOS))
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    off = (size - inner) // 2
    out.paste(art, (off, off), art)
    return out


def circle(img: Image.Image) -> Image.Image:
    size = img.size[0]
    mask = Image.new("L", (size * 4, size * 4), 0)
    ImageDraw.Draw(mask).ellipse([0, 0, size * 4 - 1, size * 4 - 1], fill=255)
    out = img.convert("RGBA")
    out.putalpha(mask.resize((size, size), Image.LANCZOS))
    return out


def save(img: Image.Image, rel: str) -> None:
    path = ROOT / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, optimize=True)
    print(f"  {rel} {img.size[0]}px")


# Web client
save(neon(256), "frontend/public/brand/parley-neon-256.png")
save(neon(180), "frontend/public/icons/apple-touch-icon.png")
save(neon(192), "frontend/public/icons/icon-192.png")
save(neon(512), "frontend/public/icons/icon-512.png")
save(padded(512), "frontend/public/icons/maskable-512.png")
svg = (ROOT / "branding/Parley-Logo.svg").read_text()
path_d = re.search(r'<path d="([^"]+)"', svg).group(1)
(ROOT / "frontend/public/favicon.svg").write_text(
    f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="123 110 820 820"><path fill="{VIOLET}" d="{path_d}"/></svg>\n')
print("  frontend/public/favicon.svg")

# Desktop: rounded square with a little breathing room, which reads well in the Windows taskbar, macOS dock and Linux docks.
save(rounded(neon(1024), radius=0.22, margin=0.04), "desktop/assets/icon.png")
save(neon(256), "desktop/www/logo.png")
save(neon(256), "mobile/www/logo.png")

# Android launcher icons (dp sizes at each density).
for dpi, scale in {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}.items():
    legacy = int(48 * scale)
    save(rounded(neon(legacy), radius=0.18), f"mobile/android/app/src/main/res/mipmap-{dpi}/ic_launcher.png")
    save(circle(padded(legacy, 0.84)), f"mobile/android/app/src/main/res/mipmap-{dpi}/ic_launcher_round.png")
    save(padded(int(108 * scale)), f"mobile/android/app/src/main/res/mipmap-{dpi}/ic_launcher_foreground.png")

# iOS wants a square, opaque 1024 px icon and rounds it itself.
save(neon(1024), "mobile/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png")
