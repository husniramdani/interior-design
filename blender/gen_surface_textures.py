"""Generate seamless PBR surface maps for non-wood finishes (normal + roughness).

Run: ~/hermes-photo-batch/.venv/bin/python blender/gen_surface_textures.py
Writes public/textures/surf_<name>_nor.webp and surf_<name>_rough.webp.

All noise is shaped in the frequency domain (FFT), so every map tiles perfectly.
Normal maps use the OpenGL convention (+Y up), same as the Poly Haven *_nor_gl maps.
"""
import os
import numpy as np
from PIL import Image

OUT = os.path.expanduser("~/Projects/interior-3d/public/textures")
N = 512  # tiles seamlessly; density set per finish via catalog 'scale'
rng = np.random.default_rng(7)
fy, fx = np.meshgrid(np.fft.fftfreq(N), np.fft.fftfreq(N), indexing="ij")  # cycles / px


def shaped_noise(filt):
    """Periodic noise with spectrum shaped by `filt`, normalised to zero mean / unit std."""
    w = rng.standard_normal((N, N))
    h = np.real(np.fft.ifft2(np.fft.fft2(w) * filt))
    return (h - h.mean()) / h.std()


def band(lo, hi):
    """Smooth band-pass, frequencies in cycles/px."""
    f = np.hypot(fx, fy)
    return np.exp(-(f / hi) ** 2) * (1 - np.exp(-(f / lo) ** 2))


def normal_map(h, strength):
    # periodic central differences; image rows grow downward => flip for +Y up
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5
    dy = -(np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5
    n = np.dstack([-dx * strength, -dy * strength, np.ones_like(h)])
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    return Image.fromarray(np.uint8(np.clip((n * 0.5 + 0.5) * 255 + 0.5, 0, 255)), "RGB")


def gray(a, lo, hi):
    """Map std-normal field to [lo, hi] (approx +-2.5 sigma), as RGB (three reads G)."""
    v = np.clip(lo + (hi - lo) * (a + 2.5) / 5.0, 0, 1)
    g = np.uint8(v * 255 + 0.5)
    return Image.fromarray(np.dstack([g, g, g]), "RGB")


def save(name, nor, rough):
    nor.save(f"{OUT}/surf_{name}_nor.webp", "WEBP", quality=94, method=6)
    rough.save(f"{OUT}/surf_{name}_rough.webp", "WEBP", quality=92, method=6)
    for k in ("nor", "rough"):
        p = f"{OUT}/surf_{name}_{k}.webp"
        print(f"surf_{name}_{k}.webp", os.path.getsize(p) // 1024, "KB")


# 1) Satin furniture paint / lacquered MDF: soft, very fine orange peel + gentle sheen mottling
peel = shaped_noise(band(1 / 60, 1 / 9))
mottle = shaped_noise(band(1 / 400, 1 / 90))
save("satin", normal_map(peel, 0.9), gray(0.6 * mottle + 0.4 * peel, 0.88, 1.0))

# 2) Powder-coated steel: coarser, more pronounced orange peel
peel2 = shaped_noise(band(1 / 40, 1 / 6)) + 0.35 * shaped_noise(band(1 / 12, 1 / 3))
peel2 /= peel2.std()
save("powder", normal_map(peel2, 1.6), gray(0.5 * shaped_noise(band(1 / 300, 1 / 60)) + 0.5 * peel2, 0.86, 1.0))

# 3) Brushed metal: long streaks along U (x), fine across V (y)
aniso = np.exp(-(fx / 0.0015) ** 2) * np.exp(-(fy / 0.25) ** 2) * (1 - np.exp(-(fy / 0.004) ** 2))
streak = shaped_noise(aniso)
streak2 = shaped_noise(np.exp(-(fx / 0.006) ** 2) * np.exp(-(fy / 0.08) ** 2))
s = (streak + 0.5 * streak2) / 1.12
save("brushed", normal_map(s, 1.2), gray(s, 0.70, 1.0))
