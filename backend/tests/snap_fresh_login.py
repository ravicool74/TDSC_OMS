import asyncio
import json
import base64
import subprocess
import time
import urllib.request
from pathlib import Path
import websockets

EDGE_PATH = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
PORT = 9588
ARTIFACT_DIR = Path(r"C:\Users\RAVISHANKAR KUMAR\.gemini\antigravity\brain\cb7122e3-cb2e-45b9-bd22-bc72c3199985")
TEMP_USER_DATA = ARTIFACT_DIR / "scratch" / "edge_profile_fresh_login"
TEMP_USER_DATA.mkdir(parents=True, exist_ok=True)

async def main():
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

            # Navigate to login
            print("Navigating to http://localhost:8081/login ...")
            await send("Page.navigate", {"url": "http://localhost:8081/login"})
            await asyncio.sleep(4)

            # Check DOM for demoBox or Quick 1-Click Demo Login
            eval_res = await send("Runtime.evaluate", {
                "expression": "document.body.innerText.includes('Quick 1-Click Demo Login') || document.body.innerText.includes('admin@triveni.com • Full Access')"
            })
            has_demo_creds = eval_res.get("result", {}).get("value", False)
            print(f"Has Demo Credentials on Page: {has_demo_creds}")

            # Capture Login Screenshot
            snap = await send("Page.captureScreenshot", {"format": "png"})
            img_data = base64.b64decode(snap["data"])
            login_path = ARTIFACT_DIR / "fresh_login_screen.png"
            with open(login_path, "wb") as f:
                f.write(img_data)
            print(f"Saved fresh login snapshot to: {login_path}")

            # Click Sign Up tab
            click_eval = await send("Runtime.evaluate", {
                "expression": """
                (() => {
                    const el = document.querySelector('[data-testid="tab-signup"]');
                    if (el) { el.click(); return true; }
                    return false;
                })()
                """
            })
            await asyncio.sleep(1.5)

            # Capture Sign-Up Screenshot
            snap_signup = await send("Page.captureScreenshot", {"format": "png"})
            img_signup_data = base64.b64decode(snap_signup["data"])
            signup_path = ARTIFACT_DIR / "fresh_signup_screen.png"
            with open(signup_path, "wb") as f:
                f.write(img_signup_data)
            print(f"Saved fresh signup snapshot to: {signup_path}")

            assert not has_demo_creds, "Demo credentials should NOT be present on the page!"
            print("VERIFICATION SUCCESSFUL: No test/demo credentials detected on page!")

    finally:
        proc.terminate()
        try:
            proc.wait(timeout=3)
        except Exception:
            proc.kill()

if __name__ == "__main__":
    asyncio.run(main())
