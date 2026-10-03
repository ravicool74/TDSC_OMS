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
TEMP_USER_DATA.mkdir(parents=True, exist_ok=True)

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
    # 1. Obtain Admin token directly from backend API
    login_req = urllib.request.Request(
        "http://127.0.0.1:8000/api/auth/login",
        data=json.dumps({"email": "admin@triveni.com", "password": "admin123"}).encode(),
        headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(login_req) as resp:
        auth_data = json.loads(resp.read().decode())
    token = auth_data["session_token"]
    user_obj = auth_data["user"]
    print("Admin token obtained:", token[:15] + "...")

    print("Launching Edge headless with remote debugging...")
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
        print(f"Connecting to CDP: {ws_url}")

        async with websockets.connect(ws_url, max_size=20*1024*1024) as ws:
            await cdp_command(ws, "Page.enable")
            await cdp_command(ws, "Runtime.enable")

            # 2. Go to origin to set localStorage
            print("Injecting auth token into localStorage...")
            await cdp_command(ws, "Page.navigate", {"url": "http://localhost:8081/"})
            await asyncio.sleep(2)

            token_js = f"""
            localStorage.setItem('triveni_session_token', {json.dumps(token)});
            localStorage.setItem('triveni_auth_user', {json.dumps(json.dumps(user_obj))});
            """
            await cdp_command(ws, "Runtime.evaluate", {"expression": token_js})
            await asyncio.sleep(0.5)

            # 3. Navigate to Tenders Screen
            print("Navigating to http://localhost:8081/tenders ...")
            await cdp_command(ws, "Page.navigate", {"url": "http://localhost:8081/tenders"})
            await asyncio.sleep(4)

            # Capture Sub-menu 1: Tenders
            print("Capturing Sub-menu 1: Tenders...")
            shot_1 = await cdp_command(ws, "Page.captureScreenshot", {"format": "png"})
            p1 = ARTIFACT_DIR / "tender_mgmt_sub1_tenders.png"
            with open(p1, "wb") as f:
                f.write(base64.b64decode(shot_1["data"]))
            print(f"Saved: {p1}")

            # 4. Click Sub-menu 2: Contractor
            print("Clicking Tab 2: Contractor...")
            click_tab2_js = """
            (function() {
                const el = document.querySelector('[data-testid="tab-contractors"]');
                if (el) { el.click(); return 'clicked testID tab-contractors'; }
                const tabs = Array.from(document.querySelectorAll('div[role="button"], div[tabindex="0"]'));
                const t = tabs.find(x => x.innerText && x.innerText.includes('Contractor'));
                if (t) { t.click(); return 'clicked Contractor text'; }
                return 'tab not found';
            })()
            """
            res_tab2 = await cdp_command(ws, "Runtime.evaluate", {"expression": click_tab2_js, "returnByValue": True})
            print("Tab 2 click result:", res_tab2.get("result", {}).get("value"))
            await asyncio.sleep(3)

            # Capture Sub-menu 2: Contractor
            print("Capturing Sub-menu 2: Contractor...")
            shot_2 = await cdp_command(ws, "Page.captureScreenshot", {"format": "png"})
            p2 = ARTIFACT_DIR / "tender_mgmt_sub2_contractor.png"
            with open(p2, "wb") as f:
                f.write(base64.b64decode(shot_2["data"]))
            print(f"Saved: {p2}")

            # 5. Click Sub-menu 3: Manage Tender & Contractor
            print("Clicking Tab 3: Manage & Match...")
            click_tab3_js = """
            (function() {
                const el = document.querySelector('[data-testid="tab-manage"]');
                if (el) { el.click(); return 'clicked testID tab-manage'; }
                const tabs = Array.from(document.querySelectorAll('div[role="button"], div[tabindex="0"]'));
                const t = tabs.find(x => x.innerText && x.innerText.includes('Manage'));
                if (t) { t.click(); return 'clicked Manage text'; }
                return 'tab not found';
            })()
            """
            res_tab3 = await cdp_command(ws, "Runtime.evaluate", {"expression": click_tab3_js, "returnByValue": True})
            print("Tab 3 click result:", res_tab3.get("result", {}).get("value"))
            await asyncio.sleep(3)

            # Capture Sub-menu 3: Manage
            print("Capturing Sub-menu 3: Manage...")
            shot_3 = await cdp_command(ws, "Page.captureScreenshot", {"format": "png"})
            p3 = ARTIFACT_DIR / "tender_mgmt_sub3_manage.png"
            with open(p3, "wb") as f:
                f.write(base64.b64decode(shot_3["data"]))
            print(f"Saved: {p3}")

            print("All 3 sub-menus verified and captured successfully!")
    finally:
        proc.terminate()

if __name__ == "__main__":
    asyncio.run(main())
