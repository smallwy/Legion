# -*- coding: utf-8 -*-
"""用 CDP 给 game.html 截一张**精确的** 1280x720 图。

为什么不用「开窗口 + ImageGrab」：
  Chromium 的 --app 窗口是自绘标题栏（标题栏画在客户区里面），
  GetClientRect/ClientToScreen 拿到的起点比真实视口高 28px 左右，
  于是截出来会带一条标题栏、右边还被切掉一截。
  再加上别的常驻程序会盖住窗口、抢焦点经常失败 —— 窗口截图这条路天生不稳。

CDP 这条路完全不碰窗口几何：
  Emulation.setDeviceMetricsOverride 直接把视口钉成 1280x720 @1x，
  Page.captureScreenshot 直接取渲染结果。跟窗口多大、在不在前台都无关。

用法：
  python _cdp-shot.py shot      [输出名]
  python _cdp-shot.py shotall   [输出名]
"""
import base64
import json
import os
import subprocess
import sys
import time
import urllib.request

import websocket

# 本机有 http_proxy 环境变量，会把这些请求转到代理上（回 502）。
# 显式用空 ProxyHandler，别让 localhost 走代理。
_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))

EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
HERE = os.path.dirname(os.path.abspath(__file__))
PAGE = os.path.abspath(os.path.join(HERE, "..", "prototype", "game.html"))
OUTDIR = os.path.abspath(os.path.join(HERE, "..", "shots"))

W, H = 1280, 720
PORT = 9333


def cdp(ws, mid, method, params=None):
    ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
    while True:
        msg = json.loads(ws.recv())
        if msg.get("id") == mid:
            if "error" in msg:
                raise RuntimeError(method + " -> " + json.dumps(msg["error"], ensure_ascii=False))
            return msg.get("result", {})


def wait_target(timeout=25):
    t0 = time.time()
    while time.time() - t0 < timeout:
        try:
            raw = _OPENER.open("http://127.0.0.1:%d/json/list" % PORT, timeout=2).read()
            for t in json.loads(raw):
                if t.get("type") == "page" and "game.html" in (t.get("url") or ""):
                    return t["webSocketDebuggerUrl"]
            for t in json.loads(raw):
                if t.get("type") == "page":
                    return t["webSocketDebuggerUrl"]
        except Exception:
            pass
        time.sleep(0.5)
    return None


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "shot"
    out = os.path.abspath(sys.argv[2] if len(sys.argv) > 2
                          else os.path.join(OUTDIR, "game-%s.png" % mode))
    profile = os.path.join(os.environ.get("TEMP", "."), "pawpack-cdp-profile")

    url = "file:///" + PAGE.replace("\\", "/") + "#" + mode
    # --headless=new：这个版本（Edge 155）headless 能正常起来，
    # 而且不需要窗口、不需要抢焦点、不受别的程序遮挡 —— 比开真窗口稳。
    # （旧版记忆里"headless 不落盘"是本机当时的状态，已复测失效。）
    subprocess.Popen([
        EDGE,
        "--headless=new",
        "--disable-gpu",
        "--hide-scrollbars",
        "--app=" + url,
        "--remote-debugging-port=%d" % PORT,
        "--user-data-dir=" + profile,
        "--force-device-scale-factor=1",
        "--window-size=%d,%d" % (W + 40, H + 80),
        "--window-position=60,40",
        "--no-first-run", "--no-default-browser-check",
        "--disable-sync", "--disable-extensions",
        "--hide-crash-restore-bubble",
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
        "--remote-allow-origins=*",
    ], creationflags=0x00000008, close_fds=True)
    print("launched:", url)

    wsurl = wait_target()
    if not wsurl:
        print("TIMEOUT: 没等到 CDP 目标")
        return 2
    print("cdp:", wsurl.split("/")[-1])

    ws = websocket.create_connection(wsurl, timeout=25, suppress_origin=True)
    mid = 0

    def call(method, params=None):
        nonlocal mid
        mid += 1
        return cdp(ws, mid, method, params)

    call("Page.enable")
    call("Runtime.enable")
    # 视口钉死：这是整条链里唯一决定"画面多大"的地方
    call("Emulation.setDeviceMetricsOverride",
         {"width": W, "height": H, "deviceScaleFactor": 1, "mobile": False})
    # 带 hash 重新导航，确保 #shotall 生效
    call("Page.navigate", {"url": url})
    time.sleep(2.2)

    # 等字体与"入场动画跑完"，再截图，避免截到半透明的飞行中帧
    for _ in range(20):
        r = call("Runtime.evaluate", {
            "expression": "document.readyState === 'complete' && document.fonts.status === 'loaded'",
            "returnByValue": True})
        if r.get("result", {}).get("value") is True:
            break
        time.sleep(0.35)
    time.sleep(1.6)

    # 顺手把页面状态读出来，截图不能只靠眼睛判断
    probe = call("Runtime.evaluate", {
        "returnByValue": True,
        "expression": """(() => {
          const q = s => document.querySelector(s);
          const cs = e => e ? getComputedStyle(e) : null;
          const r = e => { if(!e) return null; const b = e.getBoundingClientRect();
            return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]; };
          const g = q('.hud-prog'), t = q('.hud-tip'), go = q('#go');
          return JSON.stringify({
            stage: r(q('#stage')),
            pets: document.querySelectorAll('#pets .pet').length,
            slots: document.querySelectorAll('#slots .slot').length,
            hudProg: r(g), hudTip: r(t), goBtn: r(go),
            glassBg: cs(g) && cs(g).backgroundImage,
            glassShadow: cs(g) && cs(g).boxShadow,
            stageProg: q('#stageProg').textContent,
            chain: q('#chain').textContent,
            tip: q('#tipBar').textContent,
            goName: q('#goName').textContent.trim(),
            assetErr: cs(q('#assetErr')) && cs(q('#assetErr')).display
          });
        })()"""})
    print("state:", probe["result"]["value"])

    shot = call("Page.captureScreenshot", {
        "format": "png",
        "captureBeyondViewport": False,
        "clip": {"x": 0, "y": 0, "width": W, "height": H, "scale": 1},
    })
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "wb") as f:
        f.write(base64.b64decode(shot["data"]))
    print("SAVED", out)

    # 关掉这个 profile 的窗口，别把窗口堆起来
    try:
        call("Browser.close")
    except Exception:
        pass
    ws.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
