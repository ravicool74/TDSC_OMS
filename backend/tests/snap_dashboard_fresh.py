import asyncio
import json
import base64
import subprocess
import time
import urllib.request
from pathlib import Path
import websockets

EDGE_PATH = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
PORT = 9589
ARTIFACT_DIR = Path(r"C:\Users\RAVISHANKAR KUMAR\.gemini\antigravity\brain\cb7122e3-cb2e-45b9-bd22-bc72c3199985")
TEMP_USER_DATA = ARTIFACT_DIR / "scratch" / "edge_profile_fresh_dash"
TEMP_USER_DATA.mkdir(parents=True, exist_ok=True)

async def main():
    # Login via backend API
    login_req = urllib.request.Request(
        "http://127.0.0.1:8000/api/auth/login",
        data=json.dumps({"email": "admin@triveni.com", "password": "admin123"}).encode(),
        headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(login_req) as resp:
        auth_data = json.loads(resp.read().decode())
    token = auth_data["session_token"]
    user_obj = auth_data["user"]
    print(f"Logged in successfully via API as: {user_obj.get('email')}")

    proc = subprocess.Popen([
        EDGE_PATH,
        f"--remote-debugging-port={PORT}",
        f"--user-data-dir={TEMP_USER_DATA}",
        "--headless=new",
        "--disable-gpu",
        "--disable-extensions",
        "--window-size=1280,1050",
        "about:blank"
    ])

    try:
        targets = None
        for _ in range(20):
            try:
                url = f"http://127.0.0.1:{PORT}/json"
                with urllib.request.urlopen(url, timeout=2) as response:
                    raw = json.loads(response.read().decode())
                    targets = [t for t in raw if t.get("type") == "page"]
                    if targets:
                        break
            except Exception:
                time.sleep(0.5)

        ws_url = targets[0]["webSocketDebuggerUrl"]

        async with websockets.connect(ws_url) as ws:
            msg_id = 0

            async def send(method, params=None):
                nonlocal msg_id
                msg_id += 1
                payload = {"id": msg_id, "method": method, "params": params or {}}
                await ws.send(json.dumps(payload))
                while True:
                    res = json.loads(await ws.recv())
                    if res.get("id") == payload["id"]:
                        return res.get("result", {})

            await send("Page.enable")
            await send("Runtime.enable")

            # Navigate to base page
            await send("Page.navigate", {"url": "http://localhost:8081"})
            await asyncio.sleep(2)

            # Inject session token into localStorage
            inject_js = f"""
            (() => {{
                localStorage.setItem('triveni_session_token', {json.dumps(token)});
            }})()
            """
            await send("Runtime.evaluate", {"expression": inject_js})

            # Navigate to dashboard
            print("Navigating to http://localhost:8081/(tabs)/dashboard ...")
            await send("Page.navigate", {"url": "http://localhost:8081/(tabs)/dashboard"})
            await asyncio.sleep(4)

            # Capture Dashboard Screenshot
            snap = await send("Page.captureScreenshot", {"format": "png"})
            img_data = base64.b64decode(snap["data"])
            dash_path = ARTIFACT_DIR / "fresh_dashboard_screen.png"
            with open(dash_path, "wb") as f:
                f.write(img_data)
            print(f"Saved fresh dashboard snapshot to: {dash_path}")

    finally:
        proc.terminate()
        try:
            proc.wait(timeout=3)
        except Exception:
            proc.kill()

if __name__ == "__main__":
    asyncio.run(main())
