import asyncio
import json
import base64
import subprocess
import time
import urllib.request
from pathlib import Path
import websockets

EDGE_PATH = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
PORT = 9574
ARTIFACT_DIR = Path(r"C:\Users\RAVISHANKAR KUMAR\.gemini\antigravity\brain\cb7122e3-cb2e-45b9-bd22-bc72c3199985")
TEMP_USER_DATA = ARTIFACT_DIR / "scratch" / "edge_profile_inv_search"
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

            # Setup auth in localStorage
            await call("Page.navigate", {"url": "http://localhost:8081/"})
            await asyncio.sleep(2)

            token_script = f"""
                localStorage.setItem('triveni_session_token', {json.dumps(token)});
                localStorage.setItem('triveni_auth_user', {json.dumps(json.dumps(user_obj))});
            """
            await call("Runtime.evaluate", {"expression": token_script})
            await asyncio.sleep(1)

            # 1. Navigate to Sale Invoices List
            print("Navigating to /accounting/invoices ...")
            await call("Page.navigate", {"url": "http://localhost:8081/accounting/invoices"})
            await asyncio.sleep(4)

            snap1 = await call("Page.captureScreenshot", {"format": "png"})
            p1 = ARTIFACT_DIR / "sale_invoices_search_voucher_initial.png"
            p1.write_bytes(base64.b64decode(snap1["data"]))
            print(f"Saved: {p1} ({len(snap1['data'])} bytes)")

            # Helper function to type into input and trigger React Native Web input event
            async def set_search(query_text):
                set_input_js = f"""
                    (() => {{
                        const input = document.querySelector('input[data-testid="search-voucher-input"]') || document.querySelector('input[placeholder*="Search Voucher"]');
                        if (!input) return false;
                        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                        nativeInputValueSetter.call(input, {json.dumps(query_text)});
                        input.dispatchEvent(new Event('input', {{ bubbles: true }}));
                        input.dispatchEvent(new Event('change', {{ bubbles: true }}));
                        return true;
                    }})()
                """
                res = await call("Runtime.evaluate", {"expression": set_input_js, "returnByValue": True})
                await asyncio.sleep(2)
                return res.get("result", {}).get("value")

            # 2. Search by Mobile: 9876543210
            print("Searching by Mobile No. 9876543210 ...")
            await set_search("9876543210")
            snap2 = await call("Page.captureScreenshot", {"format": "png"})
            p2 = ARTIFACT_DIR / "sale_invoices_search_by_mobile.png"
            p2.write_bytes(base64.b64decode(snap2["data"]))
            print(f"Saved: {p2} ({len(snap2['data'])} bytes)")

            # 3. Search by PAN: ABCDE1234F
            print("Searching by PAN ABCDE1234F ...")
            await set_search("ABCDE1234F")
            snap3 = await call("Page.captureScreenshot", {"format": "png"})
            p3 = ARTIFACT_DIR / "sale_invoices_search_by_pan.png"
            p3.write_bytes(base64.b64decode(snap3["data"]))
            print(f"Saved: {p3} ({len(snap3['data'])} bytes)")

            # 4. Search by Voucher No.: 000005
            print("Searching by Voucher No. 000005 ...")
            await set_search("000005")
            snap4 = await call("Page.captureScreenshot", {"format": "png"})
            p4 = ARTIFACT_DIR / "sale_invoices_search_by_voucher_no.png"
            p4.write_bytes(base64.b64decode(snap4["data"]))
            print(f"Saved: {p4} ({len(snap4['data'])} bytes)")

            # 5. Search by GST NO: 10ABCDE
            print("Searching by GST NO 10ABCDE ...")
            await set_search("10ABCDE")
            snap5 = await call("Page.captureScreenshot", {"format": "png"})
            p5 = ARTIFACT_DIR / "sale_invoices_search_by_gst.png"
            p5.write_bytes(base64.b64decode(snap5["data"]))
            print(f"Saved: {p5} ({len(snap5['data'])} bytes)")

            # 6. Search for non-existing query
            print("Searching for non-existing query 'nomatch999' ...")
            await set_search("nomatch999")
            snap6 = await call("Page.captureScreenshot", {"format": "png"})
            p6 = ARTIFACT_DIR / "sale_invoices_search_no_matches.png"
            p6.write_bytes(base64.b64decode(snap6["data"]))
            print(f"Saved: {p6} ({len(snap6['data'])} bytes)")

    finally:
        try:
            proc.terminate()
            proc.wait(timeout=3)
        except Exception:
            proc.kill()

if __name__ == "__main__":
    asyncio.run(main())
