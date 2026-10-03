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

            # Click "Match Contractors" on first tender card
            match_click_js = """
            (function() {
                const buttons = Array.from(document.querySelectorAll('div[role="button"], div[tabindex="0"]'));
                const btn = buttons.find(b => b.innerText && b.innerText.includes('Match Contractors'));
                if (btn) { btn.click(); return 'clicked match contractors'; }
                return 'btn not found';
            })()
            """
            res_match = await cdp_command(ws, "Runtime.evaluate", {"expression": match_click_js, "returnByValue": True})
            print("Match click:", res_match.get("result", {}).get("value"))
            await asyncio.sleep(2)

            shot_match = await cdp_command(ws, "Page.captureScreenshot", {"format": "png"})
            p_match = ARTIFACT_DIR / "tender_mgmt_modal_matching.png"
            with open(p_match, "wb") as f:
                f.write(base64.b64decode(shot_match["data"]))
            print(f"Saved: {p_match}")

            # Close modal
            await cdp_command(ws, "Runtime.evaluate", {"expression": "document.querySelector('div[role=\"button\"]')?.click()"})
            await asyncio.sleep(1)

            # Open Sources modal
            src_click_js = """
            (function() {
                const btn = document.querySelector('[data-testid="open-sources-btn"]');
                if (btn) { btn.click(); return 'clicked open-sources-btn'; }
                return 'source btn not found';
            })()
            """
            res_src = await cdp_command(ws, "Runtime.evaluate", {"expression": src_click_js, "returnByValue": True})
            print("Sources click:", res_src.get("result", {}).get("value"))
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
