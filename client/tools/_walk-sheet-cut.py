"""
_walk-sheet-cut.py —— 把 AI 出的行走序列图切成可用帧

为什么要这一步：生成工具交回来的是**白底 RGB**（不是透明底），而且六帧之间的
间距、脚底基线、角色大小都不会自动对齐 —— 直接拿去当序列帧会看到"一跳一跳的
高度差"和"背景白块"。所以这里做四件事：

  1. 白底抠图（从边缘 flood fill，保留深色描边，不做全局阈值 —— 全局阈值会把
     角色身上的高光一起抠掉）
  2. 按列内容切出 N 帧
  3. 对齐：脚底基线对齐 + 水平中心对齐 + 统一画布
  4. 输出：帧图 / 对位表 / 叠在主页背景上的 GIF 预览

用法：
    python tools/_walk-sheet-cut.py <sheet.png> [--out shots/walk-sheet]
"""
import os
import sys
from collections import deque

from PIL import Image

# ---- 参数 ----------------------------------------------------------------
NEAR_WHITE = 195          # 三通道都 ≥ 这个值
MAX_SAT = 22              # 且色差（max-min）≤ 这个值 —— 灰白画布才算背景
PAD = 4                   # 帧边留白


def key_white(im: Image.Image, thresh: int = NEAR_WHITE) -> Image.Image:
    """从四边 flood fill 抠白底。

    只抠**与边缘连通**的近白区域：角色内部的白色高光没有被边缘包围，
    所以不会被误抠。这比"全图把白变透明"安全得多 —— 后者会在角色胸口
    和眼角开洞。
    """
    im = im.convert('RGBA')
    w, h = im.size
    px = im.load()
    bg = bytearray(w * h)          # 1 = 背景
    q = deque()

    def near_white(x, y):
        r, g, b, _ = px[x, y]
        lo, hi = min(r, g, b), max(r, g, b)
        # 生成工具交回来的是"灰白画布"，带明暗噪点（实测 217~255），
        # 所以不能只卡一个白阈值；用「够亮 + 几乎无彩度」两个条件。
        # 角色的奶油色毛（约 240,225,200）彩度 40，不会被误判。
        return lo >= thresh and hi - lo <= MAX_SAT

    for x in range(w):
        for y in (0, h - 1):
            if not bg[y * w + x] and near_white(x, y):
                bg[y * w + x] = 1
                q.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            if not bg[y * w + x] and near_white(x, y):
                bg[y * w + x] = 1
                q.append((x, y))

    while q:
        x, y = q.popleft()
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < w and 0 <= ny < h and not bg[ny * w + nx] and near_white(nx, ny):
                bg[ny * w + nx] = 1
                q.append((nx, ny))

    out = Image.new('RGBA', (w, h))
    op = out.load()
    for y in range(h):
        row = y * w
        for x in range(w):
            if bg[row + x]:
                op[x, y] = (0, 0, 0, 0)
            else:
                op[x, y] = px[x, y]
    return out


def split_frames(im: Image.Image, expect: int = 6):
    """按列内容切帧。

    生成工具偶尔会把两帧挨得太近，纯"按空白列切"会切出 5 帧或 7 帧。
    所以切完还要跟期望帧数对一下 —— 数量不对就改成**等分**，
    等分至少不会把某个角色切成两半。
    """
    w, h = im.size
    px = im.load()
    col = []
    for x in range(w):
        n = 0
        for y in range(0, h, 2):
            if px[x, y][3] > 12:
                n += 1
        col.append(n)

    runs, inrun, start = [], False, 0
    for x, v in enumerate(col):
        if v > 0 and not inrun:
            start, inrun = x, True
        elif v == 0 and inrun:
            runs.append((start, x))
            inrun = False
    if inrun:
        runs.append((start, w))
    runs = [r for r in runs if r[1] - r[0] > w / (expect * 3)]

    if len(runs) != expect:
        print(f'  ! 按空白列切成 {len(runs)} 段，与期望 {expect} 不符 → 改为等分')
        step = w / expect
        runs = [(int(i * step), int((i + 1) * step)) for i in range(expect)]
    return runs


def main():
    src = sys.argv[1]
    outdir = 'shots/walk-sheet'
    if '--out' in sys.argv:
        outdir = sys.argv[sys.argv.index('--out') + 1]
    os.makedirs(outdir, exist_ok=True)

    im = key_white(Image.open(src))
    runs = split_frames(im)

    crops = []
    for (x0, x1) in runs:
        box = im.crop((x0, 0, x1, im.size[1])).getbbox()
        if not box:
            continue
        crops.append(im.crop(box))

    # 统一画布：宽高取最大值，底部中心对齐
    fw = max(c.size[0] for c in crops) + PAD * 2
    fh = max(c.size[1] for c in crops) + PAD * 2

    print(f'  切出 {len(crops)} 帧，统一画布 {fw}×{fh}')
    print('  帧  bbox 宽高      脚底对齐偏移')
    frames = []
    for i, c in enumerate(crops):
        canvas = Image.new('RGBA', (fw, fh), (0, 0, 0, 0))
        ox = (fw - c.size[0]) // 2
        oy = fh - PAD - c.size[1]
        canvas.paste(c, (ox, oy), c)
        frames.append(canvas)
        canvas.save(os.path.join(outdir, f'{i + 1:02d}.png'))
        print(f'  {i + 1:02d}  {c.size[0]:>4}×{c.size[1]:<4}    x={ox:<3} y={oy}')

    # ---- 对位检查：脚底基线必须一致（已经强制底部对齐，这里报出来给下次参考）----
    heights = [c.size[1] for c in crops]
    widths = [c.size[0] for c in crops]
    print(f'\n  高度范围 {min(heights)}~{max(heights)}px  宽度范围 {min(widths)}~{max(widths)}px')
    if max(heights) - min(heights) > fh * 0.18:
        print('  ⚠ 帧间高度差 >18%，可能需要人工修：AI 生成的帧大小不一致会读成"忽大忽小"')

    # ---- 预览：叠在主页背景上 ----
    try:
        bg = Image.open('shots/home-v27.png').convert('RGBA')
    except Exception:
        bg = None
    if bg:
        pet_h = 84
        scale = pet_h / (fh - PAD * 2)
        gif_frames = []
        for f in frames:
            fr = f.resize((max(1, int(fw * scale)), max(1, int(fh * scale))), Image.LANCZOS)
            canvas = bg.copy()
            canvas.alpha_composite(fr, (300, 560))
            gif_frames.append(canvas.convert('RGB'))
        gif_path = os.path.join(outdir, 'walk-preview.gif')
        gif_frames[0].save(gif_path, save_all=True, append_images=gif_frames[1:],
                           duration=90, loop=0, optimize=True)
        print(f'  预览 GIF → {gif_path}')

        # 2×2 拼图给静态评审用
        cols, rows = 3, 2
        sheet = Image.new('RGB', (bg.size[0] // 2 * cols, bg.size[1] // 2 * rows), (250, 244, 232))
        for i, fr in enumerate(gif_frames[:cols * rows]):
            thumb = fr.resize((bg.size[0] // 2, bg.size[1] // 2), Image.LANCZOS)
            sheet.paste(thumb, ((i % cols) * bg.size[0] // 2, (i // cols) * bg.size[1] // 2))
        sheet.save(os.path.join(outdir, 'walk-contact.png'))
        print(f'  静态对位图 → {outdir}/walk-contact.png')


if __name__ == '__main__':
    main()
