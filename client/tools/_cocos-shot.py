"""抓 Cocos 预览的运行时画面（headless + CDP）。

为什么不用窗口截图：编辑器窗口是 1920×1032，里面的场景视图是 3D 透视缩略，
看不到 1:1 的 UI。真正的运行时在 http://localhost:7456 —— 那是编辑器起的
预览服务，canvas 尺寸由 designResolution + 适配策略决定，只有它能反映
用户在设备上看到的画面。

用法：
    python tools/_cocos-shot.py                 # 输出 shots/cocos-runtime.png
    python tools/_cocos-shot.py out.png 18      # 自定义输出与等待秒数

前置：编辑器已打开工程（预览服务 7456 在跑）。服务没起的话先双击
      client/打开Cocos工程.bat，等场景标签出现后再跑本脚本。

踩过的坑：
  · 本机 http_proxy 会让 127.0.0.1 走代理 → 所有请求都要 ProxyHandler({})
  · CDP 握手 403 → 必须 --remote-allow-origins=* + suppress_origin=True
  · 顶部 47px 是预览工具栏，不是游戏画面；裁掉才是 1:1 的 canvas
  · 预览页默认带 Profiler 面板（左下角 Performance 那坨），会盖住资源卡。
    这里用 cc.profiler.hideStats() 关掉，只为截图干净 —— 不影响构建产物。

⚠ 非 16:9 视口会留黑边：fitHeight 下 1280×720 内容缩到 1198×673 居中，
  左右各 41px。比对概念图前必须按内容区裁切，否则量出来的是适配差。
"""
import base64
import json
import os
import subprocess
import sys
import time
import urllib.request

import websocket

CLIENT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = "http://127.0.0.1:7456/"
PORT = 9411
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(CLIENT, "shots", "cocos-runtime.png")
WAIT = float(sys.argv[2]) if len(sys.argv) > 2 else 16.0

EDGE_CANDIDATES = [
    r"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    r"C:/Program Files/Microsoft/Edge/Application/msedge.exe",
]
EDGE = next((p for p in EDGE_CANDIDATES if os.path.exists(p)), None)
if not EDGE:
    raise SystemExit("找不到 msedge.exe")

opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

proc = subprocess.Popen(
    [
        EDGE, "--headless=new", "--disable-gpu", "--no-first-run",
        f"--remote-debugging-port={PORT}",
        f"--user-data-dir={os.path.join(CLIENT, 'temp', '_cdp_cocos_prof')}",
        "--remote-allow-origins=*", "--window-size=1280,720",
        "about:blank",
    ],
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
)

ws_url = None
for _ in range(60):
    try:
        tabs = json.loads(opener.open(f"http://127.0.0.1:{PORT}/json", timeout=1).read())
        for t in tabs:
            if t.get("type") == "page":
                ws_url = t["webSocketDebuggerUrl"]
                break
        if ws_url:
            break
    except Exception:
        pass
    time.sleep(0.25)
if not ws_url:
    proc.terminate()
    raise SystemExit("CDP 端口没起来")

ws = websocket.create_connection(ws_url, timeout=60, suppress_origin=True)
_seq = [0]


def cmd(method, **params):
    _seq[0] += 1
    ws.send(json.dumps({"id": _seq[0], "method": method, "params": params}))
    while True:
        m = json.loads(ws.recv())
        if m.get("id") == _seq[0]:
            return m


cmd("Page.enable")
cmd("Runtime.enable")
cmd("Emulation.setDeviceMetricsOverride", width=1280, height=720, deviceScaleFactor=1, mobile=False)
cmd("Page.navigate", url=URL)
time.sleep(WAIT)

# 关掉 Profiler，并顺手报一下 canvas 实际尺寸与场景状态自检
probe = cmd(
    "Runtime.evaluate",
    expression="""
(() => {
  try { if (window.cc && cc.profiler) cc.profiler.hideStats(); } catch (e) {}
  const c = document.querySelector('canvas');
  const d = window.cc && cc.director && cc.director.getScene();
  let nodes = 0;
  if (d) { const walk = n => { nodes++; n.children.forEach(walk); }; walk(d); }
  return JSON.stringify({
    title: document.title,
    canvas: c ? c.width + 'x' + c.height : 'NO CANVAS',
    scene: d ? d.name : 'NO SCENE',
    nodes: nodes,
  });
})()
""",
    returnByValue=True,
)
print("状态:", probe["result"]["result"].get("value"))
time.sleep(0.6)

shot = cmd("Page.captureScreenshot", format="png")
with open(OUT, "wb") as f:
    f.write(base64.b64decode(shot["result"]["data"]))
print("✓", OUT, os.path.getsize(OUT) // 1024, "KB")

ws.close()
proc.terminate()
