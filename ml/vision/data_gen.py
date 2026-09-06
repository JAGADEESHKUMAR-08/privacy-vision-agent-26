"""
Phase 5a: Synthetic UI-text crop generator for the binary vision classifier.

Renders short text onto realistic UI-like backgrounds and labels each crop
1 = "sensitive" (contains PII) or 0 = "benign" (ordinary UI text).

The renderer mimics what the extension sees when it crops a DOM element's
screen region, so text is drawn inset on a solid/panel/gradient background,
matching the overall scale a browser page would show.

Output:
  ml/vision/dataset.npz with:
    images  : float32 [N, H, W], values in [0, 1]
    labels  : int64   [N], 0 or 1
  plus a JSON manifest of the strings used (for reference / reproducibility).
"""

import argparse
import json
import os
import random

import numpy as np
from PIL import Image, ImageDraw, ImageFont

H = 48
W = 96

FONTS = [
    r"C:\Windows\Fonts\arial.ttf",
    r"C:\Windows\Fonts\segoeui.ttf",
    r"C:\Windows\Fonts\calibri.ttf",
    r"C:\Windows\Fonts\consola.ttf",
    r"C:\Windows\Fonts\cour.ttf",
    r"C:\Windows\Fonts\times.ttf",
    r"C:\Windows\Fonts\verdana.ttf",
]

# True PII-value templates: these are the "sensitive" positives.
SENSITIVE_TEMPLATES = [
    "{}-{}-{}",                      # 123-45-6789 SSN
    "{} {} {} {}",                   # credit card 4111 1111 1111 1111
    "user@example.com",
    "{}@gmail.com",
    "{}@mail.com",
    "({}) {}-{}",
    "+1 {} {}-{}",
    "ssn {} {} {}",
    "card {} {} {} {}",
    "email {}",
    "verify your account {}",
    "Your access code: {}",
    "one-time password {}",
    "password: {}",
    "PIN {}",
]

BENIGN_TEMPLATES = [
    "Continue",
    "Sign in",
    "Cancel",
    "Settings",
    "Account overview",
    "View statement",
    "Search",
    "Dashboard",
    "Notifications",
    "Your balance",
    "Transactions",
    "Security",
    "Help center",
    "About us",
    "Terms of service",
    "Privacy policy",
    "Confirm",
    "Back",
    "Submit",
    "Save changes",
    "Welcome back",
    "Recent activity",
    "Add new",
    "View all",
    "English",
    "Manage profile",
    "Contact support",
    "Learn more",
    "Get started",
    "Loading...",
]


def _digit(n):
    return "".join(str(random.randint(0, 9)) for _ in range(n))


def _random_sensitive():
    fmt = random.choice(SENSITIVE_TEMPLATES)
    return fmt.format(
        _digit(3), _digit(2), _digit(4),      # SSN parts
        _digit(4), _digit(4), _digit(4), _digit(4),
        _digit(3), _digit(3), _digit(4),
        _digit(3), _digit(3), _digit(4),
        "".join(random.choice("abcdefghjkmnpqrstuvwxyz") for _ in range(random.randint(4, 10))),
        "".join(random.choice("ABCDEFGHJKMNPQRTUVWXYZ") for _ in range(random.randint(1, 2))),
    )


def _random_benign():
    return random.choice(BENIGN_TEMPLATES)


def _render(text, font_path, bg_mode):
    """Render one text crop -> HxW float [0,1]."""
    img = Image.new("L", (W, H))
    d = ImageDraw.Draw(img)

    # Background: solid, vertical gradient, or light panel.
    if bg_mode == "solid_dark":
        base = random.randint(18, 45)
        d.rectangle([0, 0, W, H], fill=base)
        fg = 235
    elif bg_mode == "solid_light":
        base = random.randint(222, 252)
        d.rectangle([0, 0, W, H], fill=base)
        fg = random.randint(25, 45)
    elif bg_mode == "gradient":
        top = random.randint(30, 70)
        bot = top + random.randint(40, 90)
        for y in range(H):
            t = y / max(H - 1, 1)
            val = int(top + (bot - top) * t)
            d.line([(0, y), (W, y)], fill=val)
        fg = 245 if (top + bot) / 2 < 140 else 25
    else:  # panel (light card on darker page)
        d.rectangle([0, 0, W, H], fill=random.randint(120, 200))
        pad = random.randint(5, 10)
        d.rectangle([pad, pad, W - pad, H - pad], fill=random.randint(235, 255))
        fg = 20

    try:
        font = ImageFont.truetype(font_path, random.randint(18, 30))
    except Exception:
        font = ImageFont.load_default()

    # Fit text: shrink font if it overflows the crop.
    size = None
    for _ in range(6):
        size = d.textbbox((0, 0), text, font=font)
        if size[2] - size[0] <= W - 8:
            break
        try:
            font = ImageFont.truetype(font_path, max(8, font.size - 2))
        except Exception:
            break
    tw = size[2] - size[0]
    th = size[3] - size[1]
    x = random.randint(4, max(4, W - 8 - tw))
    y = random.randint(4, max(4, H - 8 - th))
    d.text((x, y), text, font=font, fill=fg)

    # Occasionally add a subtle horizontal line (like an input field underline).
    if random.random() < 0.2:
        yy = H - random.randint(2, 8)
        d.line([(6, yy), (W - 6, yy)], fill=120, width=2)

    arr = np.asarray(img, dtype=np.float32) / 255.0
    return arr


def generate(n_per_class, seed=0, out_dir=None):
    rng = random.Random(seed)
    random.seed(seed)
    np.random.seed(seed)

    half = n_per_class
    images = np.zeros((2 * half, H, W), dtype=np.float32)
    labels = np.zeros((2 * half,), dtype=np.int64)
    manifest = []

    idx = 0
    for cls in (0, 1):
        for _ in range(half):
            bg = rng.choice(["solid_dark", "solid_light", "gradient", "panel"])
            font = rng.choice(FONTS)
            if cls == 1:
                text = _random_sensitive()
                s = _random_sensitive()
            else:
                text = _random_benign()
                s = text
            images[idx] = _render(text, font, bg)
            labels[idx] = cls
            manifest.append({"label": int(cls), "text": s})
            idx += 1

    # Deterministic shuffle while keeping image/label pairs aligned.
    perm = np.random.permutation(images.shape[0])
    images = images[perm]
    labels = labels[perm]

    if out_dir is None:
        out_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
    os.makedirs(out_dir, exist_ok=True)
    out_npz = os.path.join(out_dir, "dataset.npz")
    np.savez_compressed(out_npz, images=images, labels=labels)

    # Reorder manifest to match perm (only for reproducibility of positives).
    manifest = [manifest[i] for i in perm]

    out_json = os.path.join(out_dir, "dataset_manifest.json")
    with open(out_json, "w", encoding="utf-8") as f:
        json.dump({"H": H, "W": W, "manifest": manifest}, f)

    pos = int((labels == 1).sum())
    neg = int((labels == 0).sum())
    print(f"wrote {out_npz}")
    print(f"samples={images.shape[0]}  sensitive={pos}  benign={neg}")
    return out_npz


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--per-class", type=int, default=8000)
    ap.add_argument("--seed", type=int, default=0)
    a = ap.parse_args()
    generate(a.per_class, a.seed)
