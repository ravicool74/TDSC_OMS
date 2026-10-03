import asyncio
import json
import base64
import subprocess
import time
import urllib.request
from pathlib import Path
import websockets

EDGE_PATH = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
PORT = 9561
ARTIFACT_DIR = Path(r"C:\Users\RAVISHANKAR KUMAR\.gemini\antigravity\brain\cb7122e3-cb2e-45b9-bd22-bc72c3199985")
TEMP_USER_DATA = ARTIFACT_DIR / "scratch" / "edge_profile_reports_v2"
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
            return await asyncio.wait_for(fut, timeout=20)
        finally:
            self.pending.pop(cid, None)

    async def eval(self, js, await_promise=False):
        params = {"expression": js, "returnByValue": True}
        if await_promise:
            params["awaitPromise"] = True
        res = await self.call("Runtime.evaluate", params)
        return res.get("result", {}).get("value")

    async def screenshot(self, filename):
        res = await self.call("Page.captureScreenshot", {"format": "png"})
        data = base64.b64decode(res["data"])
        out_path = ARTIFACT_DIR / filename
        with open(out_path, "wb") as f:
            f.write(data)
        print(f"Screenshot saved: {out_path} ({len(data)} bytes)", flush=True)
        return str(out_path)

async def main():
    # 1. Login via HTTP to obtain valid session token
    print("Obtaining Admin authentication token via HTTP...", flush=True)
    login_req = urllib.request.Request(
        "http://127.0.0.1:8000/api/auth/login",
        data=json.dumps({"email": "admin@triveni.com", "password": "admin123"}).encode(),
        headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(login_req) as resp:
        auth_data = json.loads(resp.read().decode())
    token = auth_data["session_token"]
    user_obj = auth_data["user"]
    print("Token obtained successfully.", flush=True)

    # 2. Launch Edge in headless mode
    print("Launching Edge headless browser on port", PORT, flush=True)
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
        print(f"Connecting to CDP WebSocket: {ws_url}", flush=True)

        async with websockets.connect(ws_url, max_size=50 * 1024 * 1024) as ws:
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

            # 1. Master Reports Hub View (9 Categories & 37 Reports)
            print("1. Capturing Master Reports Hub...", flush=True)
            await client.call("Page.navigate", {"url": "http://localhost:8081/accounting/reports"})
            await asyncio.sleep(3)
            await client.screenshot("accounting_reports_hub_view.png")

            # 2. Accounting Menu with Reports Tab & All 9 Accordion Categories
            print("2. Capturing Accounting Menu Reports Tab...", flush=True)
            await client.call("Page.navigate", {"url": "http://localhost:8081/accounting/menu"})
            await asyncio.sleep(2)
            await client.eval("""
            (() => {
                const tabs = Array.from(document.querySelectorAll('div, button, span, p'));
                const rTab = tabs.find(t => t.innerText && t.innerText.trim() === 'Reports');
                if (rTab) rTab.click();
            })()
            """)
            await asyncio.sleep(2)
            await client.screenshot("accounting_menu_reports_tab.png")

            # 3. Sale Report View
            print("3. Capturing Sale Report View...", flush=True)
            await client.call("Page.navigate", {"url": "http://localhost:8081/accounting/reports?report=sale_report"})
            await asyncio.sleep(2.5)
            await client.screenshot("accounting_report_sale_view.png")

            # 4. Profit & Loss Report View
            print("4. Capturing Profit & Loss Report View...", flush=True)
            await client.call("Page.navigate", {"url": "http://localhost:8081/accounting/reports?report=pnl"})
            await asyncio.sleep(2.5)
            await client.screenshot("accounting_report_pnl_view.png")

            # 5. GSTR-1 Report View
            print("5. Capturing GSTR-1 Outward Supplies Return View...", flush=True)
            await client.call("Page.navigate", {"url": "http://localhost:8081/accounting/reports?report=gstr1"})
            await asyncio.sleep(2.5)
            await client.screenshot("accounting_report_gstr1_view.png")

            # 6. Stock Summary Report View
            print("6. Capturing Stock Summary Report View...", flush=True)
            await client.call("Page.navigate", {"url": "http://localhost:8081/accounting/reports?report=stock_summary"})
            await asyncio.sleep(2.5)
            await client.screenshot("accounting_report_stock_summary_view.png")

            # 7. Party Statement View
            print("7. Capturing Party Statement Report View...", flush=True)
            await client.call("Page.navigate", {"url": "http://localhost:8081/accounting/reports?report=party_statement"})
            await asyncio.sleep(2.5)
            await client.screenshot("accounting_report_party_statement_view.png")

            # 8. Loan Statement (Lone Statement) View
            print("8. Capturing Loan Statement (Lone Statement) View...", flush=True)
            await client.call("Page.navigate", {"url": "http://localhost:8081/accounting/reports?report=loan_statement"})
            await asyncio.sleep(2.5)
            await client.screenshot("accounting_report_loan_statement_view.png")

            listen_task.cancel()
            print("All 8 verification screenshots successfully captured!", flush=True)

    finally:
        proc.terminate()

if __name__ == "__main__":
    asyncio.run(main())
