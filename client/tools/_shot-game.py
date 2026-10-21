# -*- coding: utf-8 -*-
"""把 game.html 真的打开并截图，产出 1280x720 的 1:1 画面。

为什么要这么绕：本机 headless 浏览器在这个沙箱里不落盘（0.2s 就 rc=0，
只留半个 profile），所以只能"开真窗口 + 截客户区"。
而且必须把「启动 → 等窗口 → 截图」写在同一进程里 ——
沙箱会在命令结束时回收子进程。

踩过的坑（都会导致截出一张"看起来像但其实是别人窗口"的图）：
  ① 按「窗口面积最大」挑窗口 → 会挑到用户自己开着的浏览器主窗口（带标签栏）。
     正解：启动前后做 msedge PID 差集，只在**新进程**里找窗口。
     这样也就不用去杀用户正在用的浏览器。
  ② 抢焦点不可靠（常驻聊天软件会立刻盖回来）→ 截出来右半是别人的窗口。
     正解：HWND_TOPMOST 强制置顶，截完撤掉。
  ③ 截窗口矩形而不是客户区 → 边框和标题栏带偏 8~40px。
     正解：GetClientRect + ClientToScreen。
  ④ --force-device-scale-factor=1 + SetProcessDpiAwareness(2)
     → CSS px 与物理像素 1:1，截出来才是真 1280x720。

用法：
  python _shot-game.py shot      # 默认开局
  python _shot-game.py shotall   # 与概念图同状态（6 只全解锁 / 3 关 / 年糕出战）
"""
import ctypes
import os
import subprocess
import sys
import time

from PIL import ImageGrab
import win32con
import win32gui
import win32process

EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
HERE = os.path.dirname(os.path.abspath(__file__))
PAGE = os.path.join(HERE, "..", "prototype", "game.html")
OUTDIR = os.path.join(HERE, "..", "shots")

W, H = 1280, 720


def pids_of(exe_name):
    raw = subprocess.run(
        ["tasklist", "/FI", "IMAGENAME eq %s" % exe_name, "/FO", "CSV", "/NH"],
        capture_output=True).stdout.decode("gbk", errors="replace")
    pids = set()
    for line in raw.splitlines():
        parts = [p.strip().strip('"') for p in line.split('","')]
        if len(parts) > 1 and parts[0].lower() == exe_name.lower():
            try:
                pids.add(int(parts[1]))
            except ValueError:
                pass
    return pids


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "shot"
    out = os.path.abspath(os.path.join(OUTDIR, "game-%s.png" % mode))
    profile = os.path.join(os.environ.get("TEMP", "."), "pawpack-shot-profile")

    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(2)
    except Exception:
        ctypes.windll.user32.SetProcessDPIAware()

    before = pids_of("msedge.exe")
    url = "file:///" + os.path.abspath(PAGE).replace("\\", "/") + "#" + mode
    args = [
        EDGE,
        "--app=" + url,
        "--window-size=%d,%d" % (W + 60, H + 120),
        "--window-position=60,40",
        "--force-device-scale-factor=1",
        "--user-data-dir=" + profile,
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-sync",
        "--disable-extensions",
        "--hide-crash-restore-bubble",
    ]
    subprocess.Popen(args, creationflags=0x00000008, close_fds=True)
    print("launched:", url)

    target = None
    for i in range(24):
        time.sleep(1)
        new = pids_of("msedge.exe") - before
        if not new:
            continue
        best = None

        def cb(h_, _):
            nonlocal best
            if not win32gui.IsWindowVisible(h_):
                return
            _, pid = win32process.GetWindowThreadProcessId(h_)
            if pid not in new:
                return
            l, t, r, b = win32gui.GetWindowRect(h_)
            if r - l < 400 or b - t < 400:
                return
            area = (r - l) * (b - t)
            if best is None or area > best[0]:
                best = (area, h_, win32gui.GetWindowText(h_))

        win32gui.EnumWindows(cb, None)
        if best:
            target = best
            print("window at %ds: %r (新进程 %d 个)" % (i + 1, best[2], len(new)))
            break

    if not target:
        print("TIMEOUT: 新进程里没等到窗口")
        return 2

    h = target[1]
    win32gui.ShowWindow(h, win32con.SW_RESTORE)
    # 强制置顶（见文件头坑 ② ）
    win32gui.SetWindowPos(h, win32con.HWND_TOPMOST, 0, 0, 0, 0,
                          win32con.SWP_NOMOVE | win32con.SWP_NOSIZE | win32con.SWP_SHOWWINDOW)
    time.sleep(1.8)          # 等入场动画与 boot 跑完

    cl, ct, cr, cb_ = win32gui.GetClientRect(h)
    sx, sy = win32gui.ClientToScreen(h, (cl, ct))
    cw, ch = cr - cl, cb_ - ct
    print("client rect:", (sx, sy, cw, ch))
    if cw < W or ch < H:
        print("✗ 客户区比 %dx%d 小，1:1 不成立（调大 --window-size）" % (W, H))
        return 3

    img = ImageGrab.grab(bbox=(sx, sy, sx + W, sy + H), all_screens=True)
    img.save(out)
    win32gui.SetWindowPos(h, win32con.HWND_NOTOPMOST, 0, 0, 0, 0,
                          win32con.SWP_NOMOVE | win32con.SWP_NOSIZE)
    win32gui.PostMessage(h, win32con.WM_CLOSE, 0, 0)
    print("SAVED", out, img.size)
    return 0


if __name__ == "__main__":
    sys.exit(main())
