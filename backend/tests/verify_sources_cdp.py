import asyncio
import json
import base64
import subprocess
import time
import urllib.request
from pathlib import Path
import websockets

EDGE_PATH = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
PORT = 9222
ARTIFACT_DIR = Path(r"C:\Users\RAVISHANKAR KUMAR\.gemini\antigravity\brain\cb7122e3-cb2e-45b9-bd22-bc72c3199985")
TEMP_USER_DATA = ARTIFACT_DIR / "scratch" / "edge_profile"

async def cdp_command(ws, method, params=None):
    msg_id = int(time.time() * 1000) % 10000000
    payload = {"id": msg_id, "method": method, "params": params or {}}
    await ws.send(json.dumps(payload))
    while True:
        resp = await ws.recv()
        data = json.loads(resp)
        if data.get("id") == msg_id:
            return data.get("result", {})

async def main():
    login_req = urllib.request.Request(
        "http://127.0.0.1:8000/api/auth/login",
        data=json.dumps({"email": "admin@triveni.com", "password": "admin123"}).encode(),
        headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(login_req) as resp:
        auth_data = json.loads(resp.read().decode())
    token = auth_data["session_token"]
    user_obj = auth_data["user"]

    proc = subprocess.Popen([
        EDGE_PATH,
        f"--remote-debugging-port={PORT}",
        f"--user-data-dir={TEMP_USER_DATA}",
        "--headless=new",
        "--disable-gpu",
        "--window-size=1280,1000",
        "about:blank"
    ])
    
    time.sleep(2)
    try:
        url = f"http://127.0.0.1:{PORT}/json"
        with urllib.request.urlopen(url) as response:
            targets = json.loads(response.read().decode())
        ws_url = targets[0]["webSocketDebuggerUrl"]

        async with websockets.connect(ws_url, max_size=20*1024*1024) as ws:
            await cdp_command(ws, "Page.enable")
            await cdp_command(ws, "Runtime.enable")

            await cdp_command(ws, "Page.navigate", {"url": "http://localhost:8081/"})
            await asyncio.sleep(2)

            token_js = f"""
            localStorage.setItem('triveni_session_token', {json.dumps(token)});
            localStorage.setItem('triveni_auth_user', {json.dumps(json.dumps(user_obj))});
            """
            await cdp_command(ws, "Runtime.evaluate", {"expression": token_js})

            await cdp_command(ws, "Page.navigate", {"url": "http://localhost:8081/tenders"})
            await asyncio.sleep(3)

            # Click globe button directly
            click_src_js = """
            (function() {
                const btn = document.querySelector('[data-testid="open-sources-btn"]');
                if (btn) { btn.click(); return 'clicked open-sources-btn'; }
                return 'not found';
            })()
            """
            res = await cdp_command(ws, "Runtime.evaluate", {"expression": click_src_js, "returnByValue": True})
            print("Click result:", res.get("result", {}).get("value"))
            await asyncio.sleep(2)

            shot_src = await cdp_command(ws, "Page.captureScreenshot", {"format": "png"})
            p_src = ARTIFACT_DIR / "tender_mgmt_modal_sources.png"
            with open(p_src, "wb") as f:
                f.write(base64.b64decode(shot_src["data"]))
            print(f"Saved: {p_src}")

    finally:
        proc.terminate()

if __name__ == "__main__":
    asyncio.run(main())
