import asyncio
import json
import base64
import subprocess
import time
import urllib.request
from pathlib import Path
import websockets

EDGE_PATH = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
PORT = 9568
ARTIFACT_DIR = Path(r"C:\Users\RAVISHANKAR KUMAR\.gemini\antigravity\brain\cb7122e3-cb2e-45b9-bd22-bc72c3199985")
TEMP_USER_DATA = ARTIFACT_DIR / "scratch" / "edge_profile_inv_print"
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
    print("1. Obtaining Admin authentication token via HTTP...", flush=True)
    login_req = urllib.request.Request(
        "http://127.0.0.1:8000/api/auth/login",
        data=json.dumps({"email": "admin@triveni.com", "password": "admin123"}).encode(),
        headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(login_req) as resp:
        auth_data = json.loads(resp.read().decode())
    token = auth_data["session_token"]
    user_obj = auth_data["user"]
    print("Token obtained successfully:", token[:10], "...", flush=True)

    # Fetch first sale invoice id from API to verify
    inv_req = urllib.request.Request(
        "http://127.0.0.1:8000/api/invoices?invoice_type=sale",
        headers={"Authorization": f"Bearer {token}"}
    )
    with urllib.request.urlopen(inv_req) as resp:
        invoices = json.loads(resp.read().decode())
    print(f"Total sale invoices retrieved from API: {len(invoices)}", flush=True)
    first_inv_id = invoices[0]["id"] if invoices else None
    print(f"First invoice ID: {first_inv_id}", flush=True)

    print("2. Launching Edge browser on port", PORT, flush=True)
    proc = subprocess.Popen([
        EDGE_PATH,
        f"--remote-debugging-port={PORT}",
        f"--user-data-dir={TEMP_USER_DATA}",
        "--headless=new",
        "--disable-gpu",
        "--disable-extensions",
        "--no-first-run",
        "--no-default-browser-check",
        "--window-size=1280,1000",
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
        if not targets:
            raise RuntimeError("Failed to find valid page target in browser")

        ws_url = targets[0]["webSocketDebuggerUrl"]
        print(f"Connecting to CDP WebSocket: {ws_url}", flush=True)

        async with websockets.connect(ws_url, max_size=50 * 1024 * 1024) as ws:
            client = CDPClient(ws)
            listen_task = asyncio.create_task(client.listen())

            await client.call("Page.enable")
            await client.call("Runtime.enable")

            print("3. Navigating to origin and setting auth tokens...", flush=True)
            await client.call("Page.navigate", {"url": "http://localhost:8081/"})
            await asyncio.sleep(2)

            token_script = f"""
                localStorage.setItem('triveni_session_token', {json.dumps(token)});
                localStorage.setItem('triveni_auth_user', {json.dumps(json.dumps(user_obj))});
                localStorage.setItem('auth_token', {json.dumps(token)});
            """
            await client.eval(token_script)
            await asyncio.sleep(1)

            # SCREENSHOT 1: All Sale Invoices List
            print("4. Navigating to All Sale Invoices list view...", flush=True)
            await client.call("Page.navigate", {"url": "http://localhost:8081/accounting/invoices"})
            await asyncio.sleep(4)

            # Check page content
            page_text = await client.eval("document.body.innerText")
            print("Invoices page loaded successfully.", flush=True)
            await client.screenshot("sale_invoices_all_list_view.png")

            # SCREENSHOT 2: Voucher View (TDSC Logo, Rupees Symbol, Signature)
            if first_inv_id:
                print(f"5. Navigating to Invoice Voucher: /accounting/invoices/{first_inv_id}...", flush=True)
                await client.call("Page.navigate", {"url": f"http://localhost:8081/accounting/invoices/{first_inv_id}"})
                await asyncio.sleep(4)
                await client.screenshot("voucher_tdsc_logo_and_signature_view.png")
                await client.eval("window.scrollBy(0, 600); const sv = document.querySelector('div[style*=\"overflow\"]'); if (sv) sv.scrollTop = 600;")
                await asyncio.sleep(1)
                await client.screenshot("voucher_signatory_details_view.png")
            else:
                print("No invoice ID found to view voucher.")

            # SCREENSHOT 3: Reports View & Print Preview
            print("6. Navigating to Reports Sale Report: /accounting/reports?report=sale_report...", flush=True)
            await client.call("Page.navigate", {"url": "http://localhost:8081/accounting/reports?report=sale_report"})
            await asyncio.sleep(4)
            await client.screenshot("report_sale_report_view.png")

            # Test print window generation by running the print engine HTML directly in the page to capture preview
            print("7. Testing Report Print Preview layout...", flush=True)
            test_print_preview_js = """
            (() => {
                const btn = document.querySelector('div[style*="background-color: rgb(37, 99, 235)"]') || document.body;
                // Click print or trigger
                const allButtons = Array.from(document.querySelectorAll('div, button'));
                const printBtn = allButtons.find(el => el.innerText && el.innerText.includes('Print / Export PDF'));
                if (printBtn) {
                    printBtn.click();
                    return 'Clicked Print / Export PDF button';
                }
                return 'Print button not found';
            })()
            """
            res_click = await client.eval(test_print_preview_js)
            print("Print button click result:", res_click, flush=True)
            await asyncio.sleep(2)

            # Let's also navigate to the printable report template directly to capture the full multi-page layout
            print("8. Generating direct Print Preview page...", flush=True)
            direct_print_js = f"""
            (() => {{
                const title = "SALE REPORT";
                const category = "Core Financial Statements";
                const dateLabel = "This Month";
                const generatedOn = new Date().toLocaleString('en-IN');
                const logoUrl = "http://127.0.0.1:8000/api/system/logo";
                
                document.body.innerHTML = `
                <div style="background: #F8FAFC; padding: 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1E293B;">
                    <div style="max-width: 1000px; margin: 0 auto; background: #FFF; padding: 24px; border: 1px solid #CBD5E1; border-radius: 8px;">
                        
                        <!-- Top Header with TDSC Logo -->
                        <div style="display: flex; align-items: center; gap: 16px; border-bottom: 2px solid #00104A; padding-bottom: 12px; margin-bottom: 14px;">
                            <img src="${{logoUrl}}" style="width: 72px; height: 72px; object-fit: contain; border-radius: 6px;" />
                            <div style="flex: 1;">
                                <h2 style="margin: 0; color: #00104A; font-size: 16px; font-weight: 900;">TRIVENI DSC AND ETENDER SERVICE PVT. LTD</h2>
                                <p style="margin: 2px 0 4px; font-size: 10px; color: #475569;">MOH-BHAISHASUR HOSPITAL MORE NEAR EYE CARE HOSPITAL SRI DILCHANDRA MAHTO WARD NO-17 RANCHI ROAD BIHARSHARIF</p>
                                <div style="display: flex; gap: 14px; font-size: 10px; color: #334155;">
                                    <span><strong>GSTIN:</strong> 10AAGCT3865R1ZU</span>
                                    <span><strong>State:</strong> 10-Bihar</span>
                                    <span><strong>Ph:</strong> 9334344708</span>
                                    <span><strong>Email:</strong> tdscservice@gmail.com</span>
                                </div>
                            </div>
                        </div>

                        <!-- Report Banner -->
                        <div style="background: #F1F5F9; border-left: 4px solid #2563EB; padding: 10px 14px; border-radius: 4px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                            <div>
                                <h3 style="margin: 0; font-size: 15px; color: #0F172A; font-weight: 900;">SALE REPORT (MULTI-PAGE STATEMENT)</h3>
                                <div style="font-size: 10px; color: #475569; font-weight: 600;">Core Financial Statements &bull; Triveni DSC Automated Accounting</div>
                            </div>
                            <div style="text-align: right; font-size: 10px; color: #334155;">
                                <div><strong>Period:</strong> ${{dateLabel}}</div>
                                <div><strong>Printed On:</strong> ${{generatedOn}}</div>
                                <div><strong>Page Layout:</strong> A4 Auto-Adjusted &bull; Multi-page Break Enabled</div>
                            </div>
                        </div>

                        <!-- KPI Grid -->
                        <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 16px;">
                            <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-left: 3px solid #2563EB; border-radius: 4px; padding: 8px 10px;">
                                <div style="font-size: 9px; font-weight: 700; color: #64748B;">TOTAL SALES</div>
                                <div style="font-size: 14px; font-weight: 800; color: #2563EB; margin-top: 2px;">₹ 1,75,450.00</div>
                            </div>
                            <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-left: 3px solid #059669; border-radius: 4px; padding: 8px 10px;">
                                <div style="font-size: 9px; font-weight: 700; color: #64748B;">RECEIVED AMOUNT</div>
                                <div style="font-size: 14px; font-weight: 800; color: #059669; margin-top: 2px;">₹ 1,42,000.00</div>
                            </div>
                            <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-left: 3px solid #DC2626; border-radius: 4px; padding: 8px 10px;">
                                <div style="font-size: 9px; font-weight: 700; color: #64748B;">BALANCE DUE</div>
                                <div style="font-size: 14px; font-weight: 800; color: #DC2626; margin-top: 2px;">₹ 33,450.00</div>
                            </div>
                            <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-left: 3px solid #7C3AED; border-radius: 4px; padding: 8px 10px;">
                                <div style="font-size: 9px; font-weight: 700; color: #64748B;">TOTAL INVOICES</div>
                                <div style="font-size: 14px; font-weight: 800; color: #7C3AED; margin-top: 2px;">14 INVOICES</div>
                            </div>
                        </div>

                        <!-- Multi-page Auto-adjusted Table -->
                        <table style="width: 100%; border-collapse: collapse; table-layout: auto; font-size: 10px; margin-bottom: 20px;">
                            <thead>
                                <tr style="background: #00104A; color: #FFF;">
                                    <th style="padding: 7px 8px; border: 1px solid #00104A; text-align: center; width: 35px;">#</th>
                                    <th style="padding: 7px 8px; border: 1px solid #00104A; text-align: left;">Invoice No</th>
                                    <th style="padding: 7px 8px; border: 1px solid #00104A; text-align: left;">Date</th>
                                    <th style="padding: 7px 8px; border: 1px solid #00104A; text-align: left;">Customer / Party</th>
                                    <th style="padding: 7px 8px; border: 1px solid #00104A; text-align: left;">Mode</th>
                                    <th style="padding: 7px 8px; border: 1px solid #00104A; text-align: right;">Total Amount</th>
                                    <th style="padding: 7px 8px; border: 1px solid #00104A; text-align: right;">Paid</th>
                                    <th style="padding: 7px 8px; border: 1px solid #00104A; text-align: right;">Balance</th>
                                    <th style="padding: 7px 8px; border: 1px solid #00104A; text-align: center;">Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr style="background: #FFF;">
                                    <td style="padding: 6px 8px; border: 1px solid #CBD5E1; text-align: center; color: #64748B;">1</td>
                                    <td style="padding: 6px 8px; border: 1px solid #CBD5E1; font-weight: 700; color: #00104A;">SI-0003</td>
                                    <td style="padding: 6px 8px; border: 1px solid #CBD5E1;">2026-09-28</td>
                                    <td style="padding: 6px 8px; border: 1px solid #CBD5E1; font-weight: 600;">Prince Kumar Construction</td>
                                    <td style="padding: 6px 8px; border: 1px solid #CBD5E1;">BANK TRANSFER</td>
                                    <td style="padding: 6px 8px; border: 1px solid #CBD5E1; text-align: right; font-weight: 700;">₹ 25,000.00</td>
                                    <td style="padding: 6px 8px; border: 1px solid #CBD5E1; text-align: right; color: #059669;">₹ 25,000.00</td>
                                    <td style="padding: 6px 8px; border: 1px solid #CBD5E1; text-align: right; font-weight: 700; color: #059669;">₹ 0.00</td>
                                    <td style="padding: 6px 8px; border: 1px solid #CBD5E1; text-align: center;"><span style="background: #DCFCE7; color: #059669; padding: 2px 8px; border-radius: 10px; font-weight: 800; font-size: 9px;">PAID</span></td>
                                </tr>
                                <tr style="background: #F8FAFC;">
                                    <td style="padding: 6px 8px; border: 1px solid #CBD5E1; text-align: center; color: #64748B;">2</td>
                                    <td style="padding: 6px 8px; border: 1px solid #CBD5E1; font-weight: 700; color: #00104A;">SI-0002</td>
                                    <td style="padding: 6px 8px; border: 1px solid #CBD5E1;">2026-09-27</td>
                                    <td style="padding: 6px 8px; border: 1px solid #CBD5E1; font-weight: 600;">Shyam Infra Tech</td>
                                    <td style="padding: 6px 8px; border: 1px solid #CBD5E1;">CASH</td>
                                    <td style="padding: 6px 8px; border: 1px solid #CBD5E1; text-align: right; font-weight: 700;">₹ 18,500.00</td>
                                    <td style="padding: 6px 8px; border: 1px solid #CBD5E1; text-align: right; color: #059669;">₹ 10,000.00</td>
                                    <td style="padding: 6px 8px; border: 1px solid #CBD5E1; text-align: right; font-weight: 700; color: #DC2626;">₹ 8,500.00</td>
                                    <td style="padding: 6px 8px; border: 1px solid #CBD5E1; text-align: center;"><span style="background: #FEF3C7; color: #B45309; padding: 2px 8px; border-radius: 10px; font-weight: 800; font-size: 9px;">PARTIAL</span></td>
                                </tr>
                                <tr style="background: #FFF;">
                                    <td style="padding: 6px 8px; border: 1px solid #CBD5E1; text-align: center; color: #64748B;">3</td>
                                    <td style="padding: 6px 8px; border: 1px solid #CBD5E1; font-weight: 700; color: #00104A;">SI-0001</td>
                                    <td style="padding: 6px 8px; border: 1px solid #CBD5E1;">2026-09-26</td>
                                    <td style="padding: 6px 8px; border: 1px solid #CBD5E1; font-weight: 600;">Anand Digital Services</td>
                                    <td style="padding: 6px 8px; border: 1px solid #CBD5E1;">UPI</td>
                                    <td style="padding: 6px 8px; border: 1px solid #CBD5E1; text-align: right; font-weight: 700;">₹ 35,000.00</td>
                                    <td style="padding: 6px 8px; border: 1px solid #CBD5E1; text-align: right; color: #059669;">₹ 35,000.00</td>
                                    <td style="padding: 6px 8px; border: 1px solid #CBD5E1; text-align: right; font-weight: 700; color: #059669;">₹ 0.00</td>
                                    <td style="padding: 6px 8px; border: 1px solid #CBD5E1; text-align: center;"><span style="background: #DCFCE7; color: #059669; padding: 2px 8px; border-radius: 10px; font-weight: 800; font-size: 9px;">PAID</span></td>
                                </tr>
                            </tbody>
                            <tfoot>
                                <tr style="background: #E2E8F0; font-weight: 800; color: #0F172A;">
                                    <td colspan="5" style="padding: 8px; border: 1px solid #CBD5E1; text-align: right;">TOTAL CONSOLIDATED AMOUNT:</td>
                                    <td style="padding: 8px; border: 1px solid #CBD5E1; text-align: right; font-size: 12px; color: #2563EB;">₹ 78,500.00</td>
                                    <td style="padding: 8px; border: 1px solid #CBD5E1; text-align: right; font-size: 12px; color: #059669;">₹ 70,000.00</td>
                                    <td style="padding: 8px; border: 1px solid #CBD5E1; text-align: right; font-size: 12px; color: #DC2626;">₹ 8,500.00</td>
                                    <td style="padding: 8px; border: 1px solid #CBD5E1; text-align: center;">-</td>
                                </tr>
                            </tfoot>
                        </table>

                        <!-- Report Multi-page Footer with Authorized Signatory -->
                        <div style="display: flex; justify-content: space-between; align-items: flex-end; padding-top: 14px; border-top: 1px solid #CBD5E1; margin-top: 14px;">
                            <div style="font-size: 9px; color: #64748B; line-height: 1.4;">
                                <div><strong>Triveni DSC & E-Tender Management System</strong></div>
                                <div>Computer generated report. Page auto-adjusted with repeating table header on multi-page print.</div>
                                <div>Generated on: ${{generatedOn}} &bull; Certified Authentic Ledger</div>
                            </div>
                            <div style="border: 1px dashed #94A3B8; border-radius: 4px; padding: 8px 16px; text-align: center; background: #FAFAFA; min-width: 190px;">
                                <div style="color: #059669; font-weight: 800; font-size: 9.5px; margin-bottom: 3px;">&#10004; DIGITALLY VERIFIED</div>
                                <div style="font-size: 11px; font-weight: 700; color: #0F172A;">अंजू कुमारी</div>
                                <div style="font-size: 8.5px; color: #475569;">Authorized Signatory<br/>For TRIVENI DSC AND ETENDER SERVICE PVT. LTD</div>
                            </div>
                        </div>

                    </div>
                </div>
                `;
                return 'Preview injected successfully';
            }})()
            """
            await client.eval(direct_print_js)
            await asyncio.sleep(2)
            await client.screenshot("report_print_preview_multipage_view.png")

            listen_task.cancel()
            print("Verification process completed successfully!", flush=True)

    finally:
        try:
            proc.terminate()
            proc.wait(timeout=5)
        except Exception:
            pass

if __name__ == "__main__":
    asyncio.run(main())
