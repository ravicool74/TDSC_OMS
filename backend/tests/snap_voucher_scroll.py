import asyncio
import json
import base64
import subprocess
import time
import urllib.request
from pathlib import Path
import websockets

EDGE_PATH = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
PORT = 9572
ARTIFACT_DIR = Path(r"C:\Users\RAVISHANKAR KUMAR\.gemini\antigravity\brain\cb7122e3-cb2e-45b9-bd22-bc72c3199985")
TEMP_USER_DATA = ARTIFACT_DIR / "scratch" / "edge_profile_voucher_scroll"
TEMP_USER_DATA.mkdir(parents=True, exist_ok=True)

async def main():
    # Login via HTTP
    login_req = urllib.request.Request(
        "http://127.0.0.1:8000/api/auth/login",
        data=json.dumps({"email": "admin@triveni.com", "password": "admin123"}).encode(),
        headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(login_req) as resp:
        auth_data = json.loads(resp.read().decode())
    token = auth_data["session_token"]
    user_obj = auth_data["user"]

    inv_req = urllib.request.Request(
        "http://127.0.0.1:8000/api/invoices?invoice_type=sale",
        headers={"Authorization": f"Bearer {token}"}
    )
    with urllib.request.urlopen(inv_req) as resp:
        invoices = json.loads(resp.read().decode())
    first_inv_id = invoices[0]["id"]

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

            await call("Page.navigate", {"url": "http://localhost:8081/"})
            await asyncio.sleep(2)

            token_script = f"""
                localStorage.setItem('triveni_session_token', {json.dumps(token)});
                localStorage.setItem('triveni_auth_user', {json.dumps(json.dumps(user_obj))});
            """
            await call("Runtime.evaluate", {"expression": token_script})
            await asyncio.sleep(1)

            # Navigate to voucher
            await call("Page.navigate", {"url": f"http://localhost:8081/accounting/invoices/{first_inv_id}"})
            await asyncio.sleep(4)

            # Scroll all scrollable elements down
            scroll_js = """
                (() => {
                    const scrollables = Array.from(document.querySelectorAll('div')).filter(el => {
                        const style = window.getComputedStyle(el);
                        return (style.overflowY === 'auto' || style.overflowY === 'scroll') && el.scrollHeight > el.clientHeight;
                    });
                    scrollables.forEach(el => { el.scrollTop = el.scrollHeight; });
                    return scrollables.length;
                })()
            """
            res = await call("Runtime.evaluate", {"expression": scroll_js, "returnByValue": True})
            print(f"Scrolled elements count: {res.get('result', {}).get('value')}")
            await asyncio.sleep(1)

            snap_res = await call("Page.captureScreenshot", {"format": "png"})
            data = base64.b64decode(snap_res["data"])
            out_p = ARTIFACT_DIR / "voucher_signatory_details_view.png"
            out_p.write_bytes(data)
            print(f"Saved: {out_p} ({len(data)} bytes)")

    finally:
        try:
            proc.terminate()
            proc.wait(timeout=5)
        except Exception:
            pass

if __name__ == "__main__":
    asyncio.run(main())
