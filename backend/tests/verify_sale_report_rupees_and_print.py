import asyncio
import json
import base64
import subprocess
import time
import urllib.request
import sys
from pathlib import Path
import websockets

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

EDGE_PATH = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
PORT = 9570
ARTIFACT_DIR = Path(r"C:\Users\RAVISHANKAR KUMAR\.gemini\antigravity\brain\cb7122e3-cb2e-45b9-bd22-bc72c3199985")
TEMP_USER_DATA = ARTIFACT_DIR / "scratch" / "edge_profile_rep_rupees"
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
            return await asyncio.wait_for(fut, timeout=25)
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
    print("1. Logging in via HTTP to obtain token...", flush=True)
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

    print("2. Launching Edge headless on port", PORT, flush=True)
    proc = subprocess.Popen([
        EDGE_PATH,
        f"--remote-debugging-port={PORT}",
        f"--user-data-dir={TEMP_USER_DATA}",
        "--headless=new",
        "--disable-gpu",
        "--disable-extensions",
        "--no-first-run",
        "--no-default-browser-check",
        "--window-size=1360,1100",
        "about:blank"
    ])

    try:
        await asyncio.sleep(2)
        # Connect to Edge CDP
        tabs_url = f"http://127.0.0.1:{PORT}/json"
        with urllib.request.urlopen(tabs_url) as resp:
            tabs = json.loads(resp.read().decode())
        ws_url = tabs[0]["webSocketDebuggerUrl"]

        async with websockets.connect(ws_url) as ws:
            client = CDPClient(ws)
            listen_task = asyncio.create_task(client.listen())

            await client.call("Page.enable")
            await client.call("Runtime.enable")

            # First navigate to origin to set localStorage
            await client.call("Page.navigate", {"url": "http://localhost:8081"})
            await asyncio.sleep(2)

            token_script = f"""
                localStorage.setItem('triveni_session_token', {json.dumps(token)});
                localStorage.setItem('triveni_auth_user', {json.dumps(json.dumps(user_obj))});
                localStorage.setItem('auth_token', {json.dumps(token)});
            """
            await client.eval(token_script)
            await asyncio.sleep(1)

            # Also click "Login as Admin" if visible on screen
            await client.eval("""
                (() => {
                    const btns = Array.from(document.querySelectorAll('*')).filter(el => el.innerText && el.innerText.includes('Login as Admin'));
                    if (btns.length > 0) btns[btns.length - 1].click();
                })()
            """)
            await asyncio.sleep(2)

            # Navigate directly to Sale Report
            print("3. Navigating to Sale Report...", flush=True)
            await client.call("Page.navigate", {"url": "http://localhost:8081/accounting/reports?report=sale_report"})
            await asyncio.sleep(4)

            # Inspect DOM content
            kpi_texts = await client.eval("""
                Array.from(document.querySelectorAll('*')).map(el => el.innerText).filter(t => t && t.includes('₹')).slice(0, 20)
            """)
            print("Sample elements containing ₹ on page:", kpi_texts[:6], flush=True)

            # Check table headers and columns
            table_info = await client.eval("""
                (() => {
                    const allText = document.body.innerText;
                    return {
                        hasTotalSales: allText.includes('TOTAL SALES'),
                        hasTotalReceived: allText.includes('TOTAL RECEIVED'),
                        hasTaxable: allText.includes('TAXABLE'),
                        hasTotalAmount: allText.includes('TOTAL AMOUNT'),
                        hasPaid: allText.includes('PAID'),
                        hasBalance: allText.includes('BALANCE'),
                    };
                })()
            """)
            print("Table Column Visibility Check:", json.dumps(table_info, indent=2), flush=True)

            # Capture on-screen table screenshot
            await client.screenshot("sale_report_table_full_columns_view.png")

            # Click Print / Export PDF button
            print("4. Clicking 'Print / Export PDF' button...", flush=True)
            clicked = await client.eval("""
                (() => {
                    const btns = Array.from(document.querySelectorAll('*')).filter(el => el.innerText && el.innerText.trim() === 'Print / Export PDF');
                    if (btns.length > 0) {
                        btns[btns.length - 1].click();
                        return true;
                    }
                    return false;
                })()
            """)
            print("Clicked Print Button:", clicked, flush=True)
            await asyncio.sleep(2)

            # Check if hidden iframe exists
            iframe_info = await client.eval("""
                (() => {
                    const iframe = document.getElementById('tdsc-report-print-frame');
                    if (!iframe) return { exists: false };
                    const doc = iframe.contentDocument || iframe.contentWindow?.document;
                    if (!doc) return { exists: true, hasDoc: false };
                    return {
                        exists: true,
                        hasDoc: true,
                        title: doc.title,
                        hasLogo: !!doc.querySelector('.company-logo'),
                        companyName: doc.querySelector('.company-name')?.innerText,
                        reportTitle: doc.querySelector('.report-title-txt')?.innerText,
                        signatory: doc.querySelector('.signatory-title')?.innerText,
                        tableRowsCount: doc.querySelectorAll('.report-table tr').length,
                        htmlLength: doc.documentElement.innerHTML.length
                    };
                })()
            """)
            print("Print Iframe Inspection:", json.dumps(iframe_info, indent=2), flush=True)

            # Save the print HTML to an artifact so we can view/render it
            print_html = await client.eval("""
                (() => {
                    const iframe = document.getElementById('tdsc-report-print-frame');
                    const doc = iframe?.contentDocument || iframe?.contentWindow?.document;
                    return doc ? doc.documentElement.outerHTML : '';
                })()
            """)
            if print_html:
                html_path = ARTIFACT_DIR / "scratch" / "report_print_preview.html"
                with open(html_path, "w", encoding="utf-8") as f:
                    f.write(print_html)
                print(f"Saved print preview HTML to: {html_path}", flush=True)

                # Navigate page to view the printable HTML preview
                file_url = f"file:///{str(html_path).replace(chr(92), '/')}"
                await client.call("Page.navigate", {"url": file_url})
                await asyncio.sleep(2)
                await client.screenshot("sale_report_iframe_print_dialog_view.png")

            listen_task.cancel()
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=3)
        except Exception:
            proc.kill()

if __name__ == "__main__":
    asyncio.run(main())
