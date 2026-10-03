import asyncio
import json
import base64
import subprocess
import time
import urllib.request
from pathlib import Path
import websockets

EDGE_PATH = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
PORT = 9582
ARTIFACT_DIR = Path(r"C:\Users\RAVISHANKAR KUMAR\.gemini\antigravity\brain\cb7122e3-cb2e-45b9-bd22-bc72c3199985")
TEMP_USER_DATA = ARTIFACT_DIR / "scratch" / "edge_profile_payin_search"
TEMP_USER_DATA.mkdir(parents=True, exist_ok=True)

async def main():
    print("=== Edge CDP: Testing All Payment-In Search, Edit, and Print UI ===")
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
    print("[PASS] Logged in as Admin")

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

            # 1. Navigate to All Payment-In screen
            print("Navigating to http://localhost:8081/accounting/income ...")
            await call("Page.navigate", {"url": "http://localhost:8081/accounting/income"})
            await asyncio.sleep(4)

            # Snapshot 1: Initial View with Search Payment In bar, criteria chips, and action buttons (Print, Edit, View)
            snap1 = await call("Page.captureScreenshot", {"format": "png"})
            p1 = ARTIFACT_DIR / "payment_in_search_initial.png"
            p1.write_bytes(base64.b64decode(snap1["data"]))
            print(f"[PASS] Saved initial payment-in screen: {p1}")

            # Helper function to type into search input
            async def set_search(query_text):
                set_input_js = f"""
                    (() => {{
                        const input = document.querySelector('input[data-testid="search-payin-input"]') || document.querySelector('input[placeholder*="Search Payment In"]');
                        if (!input) return false;
                        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                        nativeInputValueSetter.call(input, {json.dumps(query_text)});
                        input.dispatchEvent(new Event('input', {{ bubbles: true }}));
                        input.dispatchEvent(new Event('change', {{ bubbles: true }}));
                        return true;
                    }})()
                """
                res = await call("Runtime.evaluate", {"expression": set_input_js, "returnByValue": True})
                return res.get("value")

            # Snapshot 2: Search by Voucher No.
            print("Searching by Voucher No. ('PAYIN-0011')...")
            await set_search("PAYIN-0011")
            await asyncio.sleep(1.5)
            snap2 = await call("Page.captureScreenshot", {"format": "png"})
            p2 = ARTIFACT_DIR / "payment_in_search_by_voucher_no.png"
            p2.write_bytes(base64.b64decode(snap2["data"]))
            print(f"[PASS] Saved search by voucher no: {p2}")

            # Snapshot 3: Search by PAN No.
            print("Searching by PAN ('ABCDE')...")
            await set_search("ABCDE")
            await asyncio.sleep(1.5)
            snap3 = await call("Page.captureScreenshot", {"format": "png"})
            p3 = ARTIFACT_DIR / "payment_in_search_by_pan.png"
            p3.write_bytes(base64.b64decode(snap3["data"]))
            print(f"[PASS] Saved search by PAN: {p3}")

            # Snapshot 4: Clear search and open Edit & Update Modal
            print("Clearing search and opening Edit Modal on first voucher...")
            await set_search("")
            await asyncio.sleep(1)

            open_edit_js = """
                (() => {
                    const editBtn = document.querySelector('[data-testid^="edit-payin-"]');
                    if (editBtn) {
                        editBtn.click();
                        return true;
                    }
                    return false;
                })()
            """
            opened = await call("Runtime.evaluate", {"expression": open_edit_js, "returnByValue": True})
            print(f"Edit button clicked: {opened.get('value')}")
            await asyncio.sleep(2)

            snap4 = await call("Page.captureScreenshot", {"format": "png"})
            p4 = ARTIFACT_DIR / "payment_in_edit_modal.png"
            p4.write_bytes(base64.b64decode(snap4["data"]))
            print(f"[PASS] Saved Edit & Update modal: {p4}")

            # Snapshot 5: Detail View
            print("Navigating to Payment-In Detail view...")
            await call("Page.navigate", {"url": "http://localhost:8081/accounting/income/inc_5e8b9c97e078"})
            await asyncio.sleep(3)
            snap5 = await call("Page.captureScreenshot", {"format": "png"})
            p5 = ARTIFACT_DIR / "payment_in_detail_view.png"
            p5.write_bytes(base64.b64decode(snap5["data"]))
            print(f"[PASS] Saved detail view: {p5}")

            print("\nAll Payment-In UI screenshots captured successfully!")

    finally:
        proc.terminate()

if __name__ == "__main__":
    asyncio.run(main())
