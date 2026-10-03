import asyncio
import json
import urllib.request
import subprocess
from pathlib import Path
import websockets

EDGE_PATH = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
PORT = 9557
TEMP_DIR = Path(r"C:\Users\RAVISHANKAR KUMAR\.gemini\antigravity\brain\cb7122e3-cb2e-45b9-bd22-bc72c3199985\scratch\edge_debug")
TEMP_DIR.mkdir(parents=True, exist_ok=True)

async def run():
    req = urllib.request.Request(
        "http://127.0.0.1:8000/api/auth/login",
        data=json.dumps({"email": "admin@triveni.com", "password": "admin123"}).encode(),
        headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req) as resp:
        auth_data = json.loads(resp.read().decode())
    token = auth_data["session_token"]
    user = auth_data["user"]

    proc = subprocess.Popen([
        EDGE_PATH,
        f"--remote-debugging-port={PORT}",
        f"--user-data-dir={TEMP_DIR}",
        "--headless=new",
        "--disable-gpu",
        "--disable-extensions",
        "about:blank"
    ])
    await asyncio.sleep(2)
    try:
        targets_url = f"http://127.0.0.1:{PORT}/json"
        with urllib.request.urlopen(targets_url) as r:
            raw = json.loads(r.read())
        target = [t for t in raw if t.get("type") == "page"][0]
        ws_url = target["webSocketDebuggerUrl"]

        async with websockets.connect(ws_url) as ws:
            msg_id = 1
            async def send(method, params=None):
                nonlocal msg_id
                msg_id += 1
                cur = msg_id
                await ws.send(json.dumps({"id": cur, "method": method, "params": params or {}}))
                while True:
                    data = json.loads(await ws.recv())
                    if data.get("id") == cur:
                        return data.get("result", {})

            await send("Page.enable")
            await send("Runtime.enable")
            await send("Log.enable")
            await send("Network.enable")

            # Enable event receiving
            async def event_listener():
                try:
                    while True:
                        msg = await ws.recv()
                        ev = json.loads(msg)
                        method = ev.get("method", "")
                        if "consoleAPICalled" in method:
                            args = ev.get("params", {}).get("args", [])
                            vals = [a.get("value") or a.get("description") for a in args]
                            print("[CONSOLE]", *vals)
                        elif "loadingFailed" in method:
                            print("[NET FAIL]", ev.get("params", {}))
                        elif "responseReceived" in method:
                            url = ev.get("params", {}).get("response", {}).get("url", "")
                            status = ev.get("params", {}).get("response", {}).get("status")
                            if "api" in url:
                                print(f"[NET RESP] {status} {url}")
                except Exception:
                    pass

            listener_task = asyncio.create_task(event_listener())

            await send("Page.navigate", {"url": "http://localhost:8081/"})
            await asyncio.sleep(2)

            token_val = json.dumps(token)
            user_val = json.dumps(json.dumps(user))
            token_js = f"localStorage.setItem('triveni_session_token', {token_val}); localStorage.setItem('triveni_auth_user', {user_val});"
            await send("Runtime.evaluate", {"expression": token_js})

            await send("Page.navigate", {"url": "http://localhost:8081/documents"})
            await asyncio.sleep(2.5)

            # Click open folder
            open_res = await send("Runtime.evaluate", {"expression": """(() => {
                const btn = document.querySelector('[data-testid^="folder-open-"]');
                if (btn) { btn.click(); return 'clicked: ' + btn.getAttribute('data-testid'); }
                return 'not found';
            })()"""})
            print("Open folder clicked:", open_res)

            await asyncio.sleep(3)

            # Check what api.getFolderFiles call in window or fetch in page does:
            fetch_eval = await send("Runtime.evaluate", {"expression": """
                (async () => {
                    try {
                        const token = localStorage.getItem('triveni_session_token');
                        const res = await fetch('http://localhost:8000/api/document-library/folders/fld_cpwd_forms/files', {
                            headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }
                        });
                        const data = await res.json();
                        return { ok: res.ok, status: res.status, filesCount: data.files?.length };
                    } catch (e) {
                        return { error: e.message };
                    }
                })()
            """, "awaitPromise": True})
            print("Direct browser fetch result:", fetch_eval)

            listener_task.cancel()

    finally:
        proc.terminate()

if __name__ == "__main__":
    asyncio.run(run())
