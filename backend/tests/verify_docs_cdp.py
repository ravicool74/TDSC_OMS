import asyncio
import json
import base64
import subprocess
import time
import urllib.request
from pathlib import Path
import websockets

EDGE_PATH = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
PORT = 9555
ARTIFACT_DIR = Path(r"C:\Users\RAVISHANKAR KUMAR\.gemini\antigravity\brain\cb7122e3-cb2e-45b9-bd22-bc72c3199985")
TEMP_USER_DATA = ARTIFACT_DIR / "scratch" / "edge_profile_docs_v5"
TEMP_USER_DATA.mkdir(parents=True, exist_ok=True)

msg_counter = 0

async def cdp_command(ws, method, params=None):
    global msg_counter
    msg_counter += 1
    msg_id = msg_counter
    payload = {"id": msg_id, "method": method, "params": params or {}}
    await ws.send(json.dumps(payload))
    while True:
        resp = await ws.recv()
        data = json.loads(resp)
        if data.get("id") == msg_id:
            return data.get("result", {})

async def wait_for_selector(ws, selector, timeout=10):
    start = time.time()
    while time.time() - start < timeout:
        js = f"!!document.querySelector('{selector}')"
        res = await cdp_command(ws, "Runtime.evaluate", {"expression": js})
        if res.get("result", {}).get("value") is True:
            return True
        await asyncio.sleep(0.4)
    return False

async def take_screenshot(ws, filename):
    res = await cdp_command(ws, "Page.captureScreenshot", {"format": "png"})
    data = base64.b64decode(res["data"])
    out_path = ARTIFACT_DIR / filename
    with open(out_path, "wb") as f:
        f.write(data)
    print(f"Screenshot saved: {out_path} ({len(data)} bytes)", flush=True)
    return str(out_path)

async def main():
    # 1. Obtain Admin token
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

    print("Launching Edge headless with remote debugging...", flush=True)
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
        print(f"Connecting to CDP page target: {ws_url}", flush=True)

        async with websockets.connect(ws_url, max_size=25*1024*1024) as ws:
            await cdp_command(ws, "Page.enable")
            await cdp_command(ws, "Runtime.enable")

            # 2. Inject Auth Token into origin
            print("Injecting auth token into localStorage...", flush=True)
            await cdp_command(ws, "Page.navigate", {"url": "http://localhost:8081/"})
            await asyncio.sleep(2)

            token_js = f"""
            localStorage.setItem('triveni_session_token', {json.dumps(token)});
            localStorage.setItem('triveni_auth_user', {json.dumps(json.dumps(user_obj))});
            """
            await cdp_command(ws, "Runtime.evaluate", {"expression": token_js})
            await asyncio.sleep(0.5)

            # 3. Navigate to Document Library Screen
            print("Navigating to http://localhost:8081/documents ...", flush=True)
            await cdp_command(ws, "Page.navigate", {"url": "http://localhost:8081/documents"})
            await wait_for_selector(ws, '[data-testid^="folder-"]', timeout=8)
            await asyncio.sleep(1)

            # Capture 1: Folders List View (with permissions badge and sub-menus)
            print("Capturing 1: Folders View...", flush=True)
            await take_screenshot(ws, "doc_library_folders_view.png")

            # 4. Open Folder Permissions Modal on the first folder
            print("Opening Folder Permissions Modal...", flush=True)
            open_perm_js = """
            (() => {
                const btn = document.querySelector('[data-testid^="folder-perms-"]') || document.querySelector('[title="Manage Access Permissions"]');
                if (btn) {
                    btn.click();
                    return "clicked";
                }
                return "not found";
            })()
            """
            res = await cdp_command(ws, "Runtime.evaluate", {"expression": open_perm_js})
            print("Open perm modal res:", res, flush=True)
            await wait_for_selector(ws, '[data-testid="perm-option-restricted"]', timeout=5)

            # Select "Specific Users Only"
            click_restricted_js = """
            (() => {
                const opt = document.querySelector('[data-testid="perm-option-restricted"]');
                if (opt) {
                    opt.click();
                    return "selected restricted";
                }
                return "restricted opt not found";
            })()
            """
            await cdp_command(ws, "Runtime.evaluate", {"expression": click_restricted_js})
            await asyncio.sleep(1)

            # Capture 2: Permissions Selector Modal
            print("Capturing 2: Folder Permissions Modal...", flush=True)
            await take_screenshot(ws, "doc_library_folder_permissions_modal.png")

            # Close modal via close button
            print("Closing permissions modal...", flush=True)
            close_perm_js = """
            (() => {
                const closeBtn = document.querySelector('[data-testid="perm-modal-close-btn"]');
                if (closeBtn) {
                    closeBtn.click();
                    return "closed via testid";
                }
                return "close btn not found";
            })()
            """
            close_res = await cdp_command(ws, "Runtime.evaluate", {"expression": close_perm_js})
            print("Close modal res:", close_res, flush=True)
            await asyncio.sleep(1.5)

            # 5. Open Folder (Click the open button)
            print("Opening folder to view line table...", flush=True)
            open_folder_js = """
            (() => {
                const openBtn = document.querySelector('[data-testid^="folder-open-"]') || document.querySelector('[title="Open Folder"]');
                if (openBtn) {
                    openBtn.click();
                    return "opened folder";
                }
                return "folder not found";
            })()
            """
            open_fld_res = await cdp_command(ws, "Runtime.evaluate", {"expression": open_folder_js})
            print("Open folder res:", open_fld_res, flush=True)

            # Wait until table rows load!
            print("Waiting for table rows to load...", flush=True)
            await wait_for_selector(ws, '[data-testid^="add-row-below-"]', timeout=10)
            await asyncio.sleep(1)

            # Capture 3: Inside Folder Line-by-Line Spreadsheet Table
            print("Capturing 3: Line Table inside Folder...", flush=True)
            await take_screenshot(ws, "doc_library_open_folder_table.png")

            # 6. Click '+' on a row to insert new row below
            print("Clicking '+' button to insert new field below...", flush=True)
            click_plus_js = """
            (() => {
                const plusBtn = document.querySelector('[data-testid^="add-row-below-"]');
                if (plusBtn) {
                    plusBtn.click();
                    return "clicked plus";
                }
                return "plus not found";
            })()
            """
            plus_res = await cdp_command(ws, "Runtime.evaluate", {"expression": click_plus_js})
            print("Plus click result:", plus_res, flush=True)
            await asyncio.sleep(3)

            # Capture 4: Table with newly inserted row below
            print("Capturing 4: Table with newly inserted row below...", flush=True)
            await take_screenshot(ws, "doc_library_row_inserted_below.png")

            # 7. Click Row Permissions icon to verify line-level permissions modal
            print("Opening Line-Level Permissions Modal...", flush=True)
            open_row_perm_js = """
            (() => {
                const btn = document.querySelector('[data-testid^="row-perms-"]') || document.querySelector('[title="User Permissions"]');
                if (btn) {
                    btn.click();
                    return "clicked row perm";
                }
                return "row perm btn not found";
            })()
            """
            row_perm_res = await cdp_command(ws, "Runtime.evaluate", {"expression": open_row_perm_js})
            print("Row perm click res:", row_perm_res, flush=True)
            await wait_for_selector(ws, '[data-testid="perm-modal-close-btn"]', timeout=5)
            await asyncio.sleep(1)

            # Capture 5: Document Line Permissions Modal
            print("Capturing 5: Document Line Permissions Modal...", flush=True)
            await take_screenshot(ws, "doc_library_row_permissions_modal.png")

            print("All CDP verification screenshots successfully captured!", flush=True)

    finally:
        proc.terminate()
        try:
            proc.wait(timeout=3)
        except Exception:
            proc.kill()

if __name__ == "__main__":
    asyncio.run(main())
