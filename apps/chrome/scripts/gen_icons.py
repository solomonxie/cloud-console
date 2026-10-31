#!/usr/bin/env python3
"""Regenerate static/icons/icon*.png from the mobile app icon.

The source of truth is the iOS app icon
(apps/ios/CloudConsole/Assets.xcassets/AppIcon.appiconset/icon-light.png,
the same file apps/mobile/app.json uses), so the extension and the app share
one mark. That PNG is a full 1024x1024 square; headless Chrome renders it once
with rounded, transparent corners (~22% radius, like a toolbar icon), then
macOS `sips` downsamples that to each size, keeping the alpha channel.

static/icons/icon.svg is a hand-made vector redraw of the same mark, used as
the glyph in the store listing art; it is not an input here.
"""
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ICON_DIR = ROOT / "static" / "icons"
SOURCE = (
    ROOT.parent
    / "ios"
    / "CloudConsole"
    / "Assets.xcassets"
    / "AppIcon.appiconset"
    / "icon-light.png"
)
MASTER = 1024
RADIUS = 0.2237  # iOS-style corner radius as a fraction of the side
SIZES = (16, 32, 48, 128)
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

PAGE = """<!doctype html><html><head><style>
html, body {{ margin: 0; padding: 0; background: transparent; }}
img {{ display: block; width: {size}px; height: {size}px;
  border-radius: {radius}px; }}
</style></head><body><img src="{src}"></body></html>"""


def png_size(path):
    data = path.read_bytes()
    assert data[:8] == b"\x89PNG\r\n\x1a\n", f"{path}: not a PNG"
    return struct.unpack(">II", data[16:24])


def render_rounded(dest, workdir):
    page = workdir / "icon.html"
    page.write_text(
        PAGE.format(size=MASTER, radius=round(MASTER * RADIUS), src=SOURCE.as_uri())
    )
    subprocess.run(
        [
            CHROME,
            "--headless",
            "--disable-gpu",
            "--hide-scrollbars",
            "--force-device-scale-factor=1",
            "--default-background-color=00000000",
            f"--window-size={MASTER},{MASTER}",
            f"--screenshot={dest}",
            page.as_uri(),
        ],
        check=True,
        capture_output=True,
    )
    got = png_size(dest)
    assert got == (MASTER, MASTER), f"{dest.name}: got {got}, want {(MASTER, MASTER)}"


def resize(master, size, dest):
    subprocess.run(
        ["sips", "-z", str(size), str(size), str(master), "--out", str(dest)],
        check=True,
        capture_output=True,
    )
    got = png_size(dest)
    assert got == (size, size), f"{dest.name}: got {got}, want {(size, size)}"
    print(f"{dest.relative_to(ROOT)}  {size}x{size}")


def main():
    if not Path(CHROME).exists():
        sys.exit(f"Chrome not found at {CHROME}")
    if not SOURCE.exists():
        sys.exit(f"App icon not found at {SOURCE}")
    workdir = Path(tempfile.mkdtemp(prefix="icons-"))
    master = workdir / "icon-rounded.png"
    render_rounded(master, workdir)
    for size in SIZES:
        resize(master, size, ICON_DIR / f"icon{size}.png")


if __name__ == "__main__":
    main()
