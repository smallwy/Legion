# -*- coding: utf-8 -*-
"""确认「宠物真的在走」——不看图，直接读 wrap.style.left。
   连续采样 6 次、间隔 1.2s：既要知道它在动，也要知道它没越界。"""
import json, os, subprocess, time, glob, urllib.request
import websocket

EDGE = r"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
if not os.path.exists(EDGE):
    EDGE = r"C:/Program Files/Microsoft/Edge/Application/msedge.exe"
PORT = 9413
prof = os.path.abspath("temp/_cdp_walk")
os.makedirs(prof, exist_ok=True)
for f in glob.glob(prof + "/*"):
    try: os.remove(f)
    except Exception: pass

p = subprocess.Popen([EDGE, "--headless=new", "--disable-gpu", "--no-first-run",
    f"--remote-debugging-port={PORT}", f"--user-data-dir={prof}",
    "--remote-allow-origins=*", "--window-size=1280,760", "about:blank"],
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
op = urllib.request.build_opener(urllib.request.ProxyHandler({}))
ws_url = None
for _ in range(40):
    try:
        for t in json.loads(op.open(f"http://127.0.0.1:{PORT}/json", timeout=1).read()):
            if t.get("type") == "page":
                ws_url = t["webSocketDebuggerUrl"]; break
        if ws_url: break
    except Exception: pass
    time.sleep(0.25)

ws = websocket.create_connection(ws_url, timeout=60, suppress_origin=True)
mid = [0]
def cmd(method, **params):
    mid[0] += 1
    ws.send(json.dumps({"id": mid[0], "method": method, "params": params}))
    while True:
        m = json.loads(ws.recv())
        if m.get("id") == mid[0]: return m

cmd("Page.enable"); cmd("Runtime.enable")
cmd("Emulation.setDeviceMetricsOverride", width=1280, height=720, deviceScaleFactor=1, mobile=False)
cmd("Page.navigate", url="file:///D:/Legion/client/prototype/game.html#shotall")
time.sleep(3.0)

EXPR = """(() => JSON.stringify([...document.querySelectorAll('.pet')].map(e => ({
  id: e.dataset.id, left: +parseFloat(e.style.left).toFixed(1)
}))))()"""

rows = []
for i in range(6):
    r = cmd("Runtime.evaluate", expression=EXPR, returnByValue=True)
    rows.append(json.loads(r["result"]["result"]["value"]))
    time.sleep(1.2)

ids = [r["id"] for r in rows[0]]
print("宠物       起始x   采样序列                        位移   判定")
for k, pid in enumerate(ids):
    seq = [r[k]["left"] for r in rows]
    span = max(seq) - min(seq)
    print(f"{pid:<14}{seq[0]:>6}   " + " ".join(f"{v:>6.1f}" for v in seq) +
          f"   {span:>5.1f}   {'走动 ✓' if span > 4 else '没动'}")

# 领地是否越界
ROAM = {'sugar-stand':(136,192),'nian-gao-dog':(288,358),'xuan':(0,0),
        'xue-tuan-rab':(472,532),'tuan-zi-ham':(676,746),
        'dou-nai-ox':(862,932),'xing-xie-fox':(1106,1162)}
bad = 0
for r in rows:
    for e in r:
        lo, hi = ROAM.get(e["id"], (-1e9, 1e9))
        cx = e["left"] + 50   # 容器宽约 100，换算回中心（近似）
        if e["id"] in ROAM and (cx < lo - 70 or cx > hi + 70):
            bad += 1
print(f"\n越界次数：{bad}（0 = 各守领地）")
ws.close(); p.terminate()
