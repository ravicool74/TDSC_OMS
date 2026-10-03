import asyncio
import json
import base64
import subprocess
import time
import urllib.request
from pathlib import Path
import websockets

EDGE_PATH = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
PORT = 9578
ARTIFACT_DIR = Path(r"C:\Users\RAVISHANKAR KUMAR\.gemini\antigravity\brain\cb7122e3-cb2e-45b9-bd22-bc72c3199985")
TEMP_USER_DATA = ARTIFACT_DIR / "scratch" / "edge_profile_exp_details"
TEMP_USER_DATA.mkdir(parents=True, exist_ok=True)

async def main():
    # 1. Login via HTTP
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
        "--disable-extensions",
        "--window-size=1280,1050",
        "about:blank"
    ])

    try:
        targets = None
        for _ in range(25):
            try:
                url = f"http://127.0.0.1:{PORT}/json"
                with urllib.request.urlopen(url, timeout=2) as response:
                    raw = json.loads(response.read().decode())
                page_targets = [t for t in raw if t.get("type") == "page"]
                if page_targets:
                    targets = page_targets
                    break
            except Exception:
                time.sleep(1)

        ws_url = targets[0]["webSocketDebuggerUrl"]
        async with websockets.connect(ws_url, max_size=50 * 1024 * 1024) as ws:
            async def call(method, params=None):
                cid = int(time.time() * 1000) % 1000000
                await ws.send(json.dumps({"id": cid, "method": method, "params": params or {}}))
                while True:
                    raw = await ws.recv()
                    msg = json.loads(raw)
                    if msg.get("id") == cid:
                        return msg.get("result", {})

            await call("Page.enable")
            await call("Runtime.enable")

            # Setup auth in localStorage
            await call("Page.navigate", {"url": "http://localhost:8081/"})
            await asyncio.sleep(2)

            token_script = f"""
                localStorage.setItem('triveni_session_token', {json.dumps(token)});
                localStorage.setItem('triveni_auth_user', {json.dumps(json.dumps(user_obj))});
            """
            await call("Runtime.evaluate", {"expression": token_script})
            await asyncio.sleep(1)

            # 1. No match search
            await call("Page.navigate", {"url": "http://localhost:8081/accounting/expenses"})
            await asyncio.sleep(3)

            set_input_js = """
                (() => {
                    const input = document.querySelector('input[data-testid="search-exp-input"]') || document.querySelector('input[placeholder*="Search Expences"]');
                    if (!input) return false;
                    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                    nativeInputValueSetter.call(input, "NONEXISTENT9999");
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                    return true;
                })()
            """
            await call("Runtime.evaluate", {"expression": set_input_js, "returnByValue": True})
            await asyncio.sleep(1.5)

            snap_nomatch = await call("Page.captureScreenshot", {"format": "png"})
            p_nomatch = ARTIFACT_DIR / "expenses_search_no_matches.png"
            p_nomatch.write_bytes(base64.b64decode(snap_nomatch["data"]))
            print(f"[PASS] Saved no matches screenshot: {p_nomatch}")

            # 2. Detail view
            await call("Page.navigate", {"url": "http://localhost:8081/accounting/expenses/exp_be4fe5e68952"})
            await asyncio.sleep(3)

            snap_detail = await call("Page.captureScreenshot", {"format": "png"})
            p_detail = ARTIFACT_DIR / "expenses_detail_view.png"
            p_detail.write_bytes(base64.b64decode(snap_detail["data"]))
            print(f"[PASS] Saved detail view screenshot: {p_detail}")

    finally:
        proc.terminate()

if __name__ == "__main__":
    asyncio.run(main())
