"""Generate seamless textures for the book assets (embedded into books.glb).

Run: ~/hermes-photo-batch/.venv/bin/python blender/gen_book_textures.py
Writes blender/book_textures/{pages_col,linen_nor,linen_rough}.png
"""
import os
import numpy as np
from PIL import Image

OUT = os.path.expanduser("~/Projects/interior-3d/blender/book_textures")
os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(11)


def periodic_noise(n, lo, hi):
    fy, fx = np.meshgrid(np.fft.fftfreq(n), np.fft.fftfreq(n), indexing="ij")
    f = np.hypot(fx, fy)
    filt = np.exp(-(f / hi) ** 2) * (1 - np.exp(-(f / lo) ** 2))
    h = np.real(np.fft.ifft2(np.fft.fft2(rng.standard_normal((n, n))) * filt))
    return (h - h.mean()) / h.std()


# ---- page edges: cream paper, thin horizontal page lines (vary along V = rows) ----
N = 512
rows = np.zeros(N)
y = 0
while y < N:  # irregular page spacing, 3-5 px, varying darkness
    rows[y] = rng.uniform(0.35, 1.0)
    y += int(rng.integers(3, 6))
rows = np.convolve(np.tile(rows, 3), [0.25, 0.5, 0.25], "same")[N:2 * N]  # soft, still periodic
lines = np.repeat(rows[:, None], N, axis=1)
# lines are not perfectly straight: tiny horizontal-scale wobble in intensity
lines *= 0.92 + 0.08 * (periodic_noise(N, 1 / 200, 1 / 30) * 0.5 + 0.5).clip(0, 1)
paper = np.array([0.93, 0.89, 0.80])  # warm off-white
shade = np.array([0.62, 0.57, 0.48])
mott = periodic_noise(N, 1 / 300, 1 / 60)[..., None] * 0.004
col = paper * (1 - lines[..., None] * 0.7) + shade * (lines[..., None] * 0.7) + mott
Image.fromarray(np.uint8(np.clip(col, 0, 1) * 255 + 0.5)).save(f"{OUT}/pages_col.png")

# ---- linen book cloth: woven height field -> normal + roughness ----
N2 = 256
k = 32  # threads per tile in each direction
yy, xx = np.meshgrid(np.arange(N2), np.arange(N2), indexing="ij")
u, v = xx / N2 * k * 2 * np.pi, yy / N2 * k * 2 * np.pi
warp = np.abs(np.sin(u / 2)) ** 0.6       # vertical threads
weft = np.abs(np.sin(v / 2)) ** 0.6       # horizontal threads
over = np.sign(np.sin(u / 2) * np.sin(v / 2))  # plain-weave over/under pattern
h = np.where(over > 0, warp, weft) * 0.7 + 0.3 * (warp + weft) / 2
h += 0.25 * periodic_noise(N2, 1 / 40, 1 / 6)   # slubs / irregular threads
h = (h - h.mean()) / h.std()
dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5
dy = -(np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5
s = 0.9
n = np.dstack([-dx * s, -dy * s, np.ones_like(h)])
n /= np.linalg.norm(n, axis=2, keepdims=True)
Image.fromarray(np.uint8((n * 0.5 + 0.5) * 255 + 0.5)).save(f"{OUT}/linen_nor.png")
r = np.clip(0.80 + 0.06 * h, 0, 1)
g = np.uint8(r * 255 + 0.5)
Image.fromarray(np.dstack([g, g, g])).save(f"{OUT}/linen_rough.png")
print("ok", os.listdir(OUT))
