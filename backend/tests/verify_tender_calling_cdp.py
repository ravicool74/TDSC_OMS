import asyncio
import json
import base64
import subprocess
import time
import urllib.request
from pathlib import Path
import websockets

EDGE_PATH = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
PORT = 9559
ARTIFACT_DIR = Path(r"C:\Users\RAVISHANKAR KUMAR\.gemini\antigravity\brain\cb7122e3-cb2e-45b9-bd22-bc72c3199985")
TEMP_USER_DATA = ARTIFACT_DIR / "scratch" / "edge_profile_calling_v1"
TEMP_USER_DATA.mkdir(parents=True, exist_ok=True)

class CDPClient:
    def __init__(self, ws):
        self.ws = ws
        self.msg_id = 0
        self.pending = {}

    async def listen(self):
        try:
            while True:
                raw = await self.ws.recv()
                msg = json.loads(raw)
                if "id" in msg:
                    fut = self.pending.get(msg["id"])
                    if fut and not fut.done():
                        fut.set_result(msg.get("result", {}))
        except asyncio.CancelledError:
            pass
        except Exception:
            pass

    async def call(self, method, params=None):
        self.msg_id += 1
        cid = self.msg_id
        fut = asyncio.get_running_loop().create_future()
        self.pending[cid] = fut
        await self.ws.send(json.dumps({"id": cid, "method": method, "params": params or {}}))
        try:
            return await asyncio.wait_for(fut, timeout=15)
        finally:
            self.pending.pop(cid, None)

    async def eval(self, js, await_promise=False):
        params = {"expression": js, "returnByValue": True}
        if await_promise:
            params["awaitPromise"] = True
        res = await self.call("Runtime.evaluate", params)
        return res.get("result", {}).get("value")

    async def wait_for_selector(self, selector, timeout=10):
        start = time.time()
        while time.time() - start < timeout:
            val = await self.eval(f"!!document.querySelector('{selector}')")
            if val is True:
                return True
            await asyncio.sleep(0.4)
        return False

    async def screenshot(self, filename):
        res = await self.call("Page.captureScreenshot", {"format": "png"})
        data = base64.b64decode(res["data"])
        out_path = ARTIFACT_DIR / filename
        with open(out_path, "wb") as f:
            f.write(data)
        print(f"Screenshot saved: {out_path} ({len(data)} bytes)", flush=True)
        return str(out_path)

async def main():
    # 1. Login to get Admin Token
    login_req = urllib.request.Request(
        "http://127.0.0.1:8000/api/auth/login",
        data=json.dumps({"email": "admin@triveni.com", "password": "admin123"}).encode(),
        headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(login_req) as resp:
        auth_data = json.loads(resp.read().decode())
    token = auth_data["session_token"]
    user_obj = auth_data["user"]
    print("Admin token obtained:", token[:15] + "...", flush=True)

    print("Launching Edge headless...", flush=True)
    proc = subprocess.Popen([
        EDGE_PATH,
        f"--remote-debugging-port={PORT}",
        f"--user-data-dir={TEMP_USER_DATA}",
        "--headless=new",
        "--disable-gpu",
        "--disable-extensions",
        "--no-first-run",
        "--no-default-browser-check",
        "--window-size=1300,1050",
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
        if not targets:
            raise RuntimeError("Failed to find valid page target in browser")

        ws_url = targets[0]["webSocketDebuggerUrl"]
        print(f"Connecting to CDP: {ws_url}", flush=True)

        async with websockets.connect(ws_url, max_size=25*1024*1024) as ws:
            client = CDPClient(ws)
            listen_task = asyncio.create_task(client.listen())

            await client.call("Page.enable")
            await client.call("Runtime.enable")

            # Inject Auth token into origin
            print("Injecting auth token into localStorage...", flush=True)
            await client.call("Page.navigate", {"url": "http://localhost:8081/"})
            await asyncio.sleep(2)

            token_js = f"""
            localStorage.setItem('triveni_session_token', {json.dumps(token)});
            localStorage.setItem('triveni_auth_user', {json.dumps(json.dumps(user_obj))});
            """
            await client.eval(token_js)
            await asyncio.sleep(0.5)

            # Navigate to Tender Calling tab
            print("Navigating to http://localhost:8081/tenders?tab=calling ...", flush=True)
            await client.call("Page.navigate", {"url": "http://localhost:8081/tenders?tab=calling"})
            await client.wait_for_selector('[data-testid="subtab-calling-day"]', timeout=10)
            await asyncio.sleep(2)

            # Capture 1: Tender Calling During the Day View
            print("Capturing 1: Section (a) Tender Calling During the Day...", flush=True)
            await client.screenshot("tender_calling_day_view.png")

            # Click '+' button on a row to insert new row below
            print("Clicking '+' button in last column to insert new row below...", flush=True)
            click_plus_js = """
            (() => {
                const btn = document.querySelector('[data-testid^="add-call-below-"]');
                if (btn) { btn.click(); return 'clicked'; }
                return 'not found';
            })()
            """
            plus_res = await client.eval(click_plus_js)
            print("Plus click res:", plus_res, flush=True)
            await asyncio.sleep(2.5)

            # Capture 2: Table with new row inserted below
            print("Capturing 2: Row inserted below with edit inputs...", flush=True)
            await client.screenshot("tender_calling_row_inserted_below.png")

            # Click Section (b): Tender Follow-up
            print("Switching to Section (b) Tender Follow-up...", flush=True)
            click_followup_tab = """
            (() => {
                const btn = document.querySelector('[data-testid="subtab-followup"]');
                if (btn) { btn.click(); return 'clicked'; }
                return 'not found';
            })()
            """
            await client.eval(click_followup_tab)
            await asyncio.sleep(2)

            # Capture 3: Follow-up Section with Admin Counter
            print("Capturing 3: Section (b) Tender Follow-up...", flush=True)
            await client.screenshot("tender_calling_followup_view.png")

            # Click Section (c): New Lead Generated
            print("Switching to Section (c) New Lead Generated...", flush=True)
            click_conv_tab = """
            (() => {
                const btn = document.querySelector('[data-testid="subtab-converted"]');
                if (btn) { btn.click(); return 'clicked'; }
                return 'not found';
            })()
            """
            await client.eval(click_conv_tab)
            await asyncio.sleep(2)

            # Capture 4: New Lead Generated Section
            print("Capturing 4: Section (c) New Lead Generated...", flush=True)
            await client.screenshot("tender_calling_lead_converted_view.png")

            # Click "Create Bill Against Work"
            print("Opening Create Bill Against Work modal...", flush=True)
            open_bill_js = """
            (() => {
                const btn = document.querySelector('[data-testid^="create-bill-btn-"]');
                if (btn) { btn.click(); return 'clicked'; }
                return 'not found';
            })()
            """
            await client.eval(open_bill_js)
            await asyncio.sleep(1.5)

            # Capture 5: Create Bill Modal
            print("Capturing 5: Create Bill Modal...", flush=True)
            await client.screenshot("tender_calling_create_bill_modal.png")

            # Close bill modal via Cancel
            await client.eval("""(() => {
                const cancelBtns = Array.from(document.querySelectorAll('div, button')).filter(e => e.innerText === 'Cancel');
                if (cancelBtns.length > 0) cancelBtns[0].click();
            })()""")
            await asyncio.sleep(1)

            # Click "Assign Work & Auto-Generate Task"
            print("Opening Assign Work modal...", flush=True)
            open_assign_js = """
            (() => {
                const btn = document.querySelector('[data-testid^="assign-work-btn-"]');
                if (btn) { btn.click(); return 'clicked'; }
                return 'not found';
            })()
            """
            await client.eval(open_assign_js)
            await asyncio.sleep(1.5)

            # Capture 6: Assign Work & Task Modal
            print("Capturing 6: Assign Work & Auto Task Modal...", flush=True)
            await client.screenshot("tender_calling_assign_work_modal.png")

            print("All Tender Calling CDP screenshots successfully captured!", flush=True)
            listen_task.cancel()

    finally:
        proc.terminate()
        try:
            proc.wait(timeout=3)
        except Exception:
            proc.kill()

if __name__ == "__main__":
    asyncio.run(main())
