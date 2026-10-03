import asyncio
import json
import base64
import subprocess
import time
import urllib.request
from pathlib import Path
import websockets

EDGE_PATH = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
PORT = 9555
ARTIFACT_DIR = Path(r"C:\Users\RAVISHANKAR KUMAR\.gemini\antigravity\brain\cb7122e3-cb2e-45b9-bd22-bc72c3199985")
TEMP_USER_DATA = ARTIFACT_DIR / "scratch" / "edge_profile_test"
TEMP_USER_DATA.mkdir(parents=True, exist_ok=True)

msg_counter = 0

async def cdp_command(ws, method, params=None):
    global msg_counter
    msg_counter += 1
    msg_id = msg_counter
    payload = {"id": msg_id, "method": method, "params": params or {}}
    print(f"-> Sending {method} (id={msg_id})", flush=True)
    await ws.send(json.dumps(payload))
    while True:
        resp = await ws.recv()
        data = json.loads(resp)
        if "id" in data:
            print(f"<- Received response for id={data['id']}", flush=True)
            if data["id"] == msg_id:
                return data.get("result", {})
        else:
            print(f"<- Received event: {data.get('method')}", flush=True)

async def main():
    print("Starting Edge...", flush=True)
    proc = subprocess.Popen([
        EDGE_PATH,
        f"--remote-debugging-port={PORT}",
        f"--user-data-dir={TEMP_USER_DATA}",
        "--headless=new",
        "--disable-gpu",
        "--window-size=1280,800",
        "http://localhost:8081"
    ])
    try:
        targets = None
        for _ in range(15):
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json", timeout=2) as r:
                    targets = json.loads(r.read().decode())
                if targets:
                    break
            except Exception:
                time.sleep(1)
        print("Connected to targets:", targets[0]["url"], flush=True)
        ws_url = targets[0]["webSocketDebuggerUrl"]
        async with websockets.connect(ws_url, max_size=25*1024*1024) as ws:
            await cdp_command(ws, "Page.enable")
            await asyncio.sleep(2)
            shot = await cdp_command(ws, "Page.captureScreenshot", {"format": "png"})
            print("Shot len:", len(shot.get("data", "")))
            out = ARTIFACT_DIR / "test_shot.png"
            with open(out, "wb") as f:
                f.write(base64.b64decode(shot["data"]))
            print(f"Saved to {out}")
    finally:
        proc.kill()

if __name__ == "__main__":
    asyncio.run(main())
