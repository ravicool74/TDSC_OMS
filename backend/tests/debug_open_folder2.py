import asyncio
import json
import urllib.request
import subprocess
from pathlib import Path
import websockets

EDGE_PATH = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
PORT = 9558
TEMP_DIR = Path(r"C:\Users\RAVISHANKAR KUMAR\.gemini\antigravity\brain\cb7122e3-cb2e-45b9-bd22-bc72c3199985\scratch\edge_debug2")
TEMP_DIR.mkdir(parents=True, exist_ok=True)

class CDPClient:
    def __init__(self, ws):
        self.ws = ws
        self.msg_id = 0
        self.pending = {}
        self.console_logs = []
        self.net_logs = []

    async def listen(self):
        try:
            while True:
                raw = await self.ws.recv()
                msg = json.loads(raw)
                if "id" in msg:
                    fut = self.pending.get(msg["id"])
                    if fut and not fut.done():
                        fut.set_result(msg.get("result", {}))
                else:
                    method = msg.get("method", "")
                    if "consoleAPICalled" in method:
                        args = msg.get("params", {}).get("args", [])
                        vals = [str(a.get("value") or a.get("description")) for a in args]
                        print(" [CONSOLE]", " ".join(vals))
                    elif "responseReceived" in method:
                        url = msg.get("params", {}).get("response", {}).get("url", "")
                        status = msg.get("params", {}).get("response", {}).get("status")
                        if "api" in url:
                            print(f" [NET] {status} {url}")
                    elif "loadingFailed" in method:
                        print(f" [NET FAILED] {msg.get('params', {})}")
        except asyncio.CancelledError:
            pass
        except Exception as e:
            print("Listen loop terminated:", e)

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

        async with websockets.connect(ws_url, max_size=20*1024*1024) as ws:
            client = CDPClient(ws)
            listen_task = asyncio.create_task(client.listen())

            await client.call("Page.enable")
            await client.call("Runtime.enable")
            await client.call("Network.enable")

            await client.call("Page.navigate", {"url": "http://localhost:8081/"})
            await asyncio.sleep(2)

            token_val = json.dumps(token)
            user_val = json.dumps(json.dumps(user))
            token_js = f"localStorage.setItem('triveni_session_token', {token_val}); localStorage.setItem('triveni_auth_user', {user_val});"
            await client.eval(token_js)

            await client.call("Page.navigate", {"url": "http://localhost:8081/documents"})
            await asyncio.sleep(2.5)

            # Click open folder
            open_res = await client.eval("""(() => {
                const btn = document.querySelector('[data-testid^="folder-open-"]');
                if (btn) { btn.click(); return 'clicked: ' + btn.getAttribute('data-testid'); }
                return 'not found';
            })()""")
            print("Open folder clicked:", open_res)

            await asyncio.sleep(4)

            # Check rows count
            rows_count = await client.eval('document.querySelectorAll("[data-testid^=\'add-row-below-\']").length')
            print("Table row + buttons found in DOM:", rows_count)

            # Check if any alert was triggered or error is in body
            alert_or_body = await client.eval('document.body.innerText')
            print("Has CPWD in body:", "CPWD" in (alert_or_body or ""))
            print("Has Form 7 in body:", "Form 7" in (alert_or_body or ""))

            listen_task.cancel()

    finally:
        proc.terminate()

if __name__ == "__main__":
    asyncio.run(run())
