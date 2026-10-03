import pytest
import asyncio
from datetime import date, datetime, timezone
from httpx import AsyncClient, ASGITransport
import server
from security_vault import encrypt_credential, decrypt_credential

@pytest.fixture(scope="session")
def anyio_backend():
    return "asyncio"

@pytest.mark.asyncio
async def test_credential_vault_encryption():
    plain = "MySecretPortalPass@2026"
    encrypted = encrypt_credential(plain)
    assert encrypted.startswith("ENC:")
    decrypted = decrypt_credential(encrypted)
    assert decrypted == plain
    assert decrypt_credential(None) is None
    # Test legacy plaintext fallback
    assert decrypt_credential("legacy_plain_pass") == "legacy_plain_pass"

@pytest.mark.asyncio
async def test_enterprise_modules_flow():
    transport = ASGITransport(app=server.app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        # 1. Health check
        res = await client.get("/health")
        assert res.status_code == 200
        assert res.json().get("status") == "ok"

        # 2. Login as admin
        admin_email = server.os.environ.get("SEED_ADMIN_EMAIL", "admin@triveni.com")
        admin_pass = server.os.environ.get("SEED_ADMIN_PASSWORD", "admin123")
        login_res = await client.post("/api/auth/login", json={"email": admin_email, "password": admin_pass})
        if login_res.status_code != 200:
            # Seed admin if needed in test
            signup_res = await client.post("/api/auth/signup", json={
                "email": admin_email, "name": "Admin Tester", "password": admin_pass, "role": "admin"
            })
            token = signup_res.json()["session_token"]
        else:
            token = login_res.json()["session_token"]

        headers = {"Authorization": f"Bearer {token}"}

        # 3. Test Posts module (Section 8)
        posts_res = await client.get("/api/posts", headers=headers)
        assert posts_res.status_code == 200
        posts = posts_res.json()
        assert len(posts) >= 6
        assert any(p["title"] == "Branch Manager" for p in posts)
        assert any(p["title"] == "Accountant" for p in posts)

        # Create custom post
        new_post_res = await client.post("/api/posts", json={
            "title": "Legal Advisor", "department": "Legal", "description": "Tender and contract compliance"
        }, headers=headers)
        assert new_post_res.status_code == 200
        created_post = new_post_res.json()
        assert created_post["post_id"].startswith("TDSC-PST-")

        # 4. Test Branch module (Section 7)
        new_br_res = await client.post("/api/branches", json={
            "name": "Patna Main Office",
            "address": "Boring Road, Patna, Bihar",
            "mobile": "9876543210",
            "email": "patna@triveni.com",
            "branch_head": "Ravi Kumar",
            "lat": 25.6093,
            "lng": 85.1235,
            "radius_m": 250
        }, headers=headers)
        assert new_br_res.status_code == 200
        created_br = new_br_res.json()
        assert created_br["branch_id"].startswith("TDSC-BR-")
        assert created_br["name"] == "Patna Main Office"

        # List branches
        branches_res = await client.get("/api/branches", headers=headers)
        assert branches_res.status_code == 200
        assert any(b["branch_id"] == created_br["branch_id"] for b in branches_res.json())

        # 5. Test Roles & RBAC (Section 11)
        roles_res = await client.get("/api/roles", headers=headers)
        assert roles_res.status_code == 200
        roles = roles_res.json()
        assert any(r["role_id"] == "branch_manager" for r in roles)
        assert any(r["role_id"] == "accountant" for r in roles)

        # 6. Test Services Management (Section 14)
        services_res = await client.get("/api/services", headers=headers)
        assert services_res.status_code == 200
        services = services_res.json()
        assert len(services) >= 15
        assert any("Digital Signature" in s["name"] for s in services)
        assert any("E-Tender Service" in s["name"] for s in services)

        # 7. Test User Management & Mapping (Section 9 & 10)
        user_email = f"officer_{server.uuid.uuid4().hex[:6]}@triveni.com"
        create_user_res = await client.post("/api/manage-users", json={
            "name": "Sunil Verma",
            "username": f"sunil_{server.uuid.uuid4().hex[:4]}",
            "email": user_email,
            "password": "Password@123",
            "mobile": "9934112233",
            "address": "Kankarbagh, Patna",
            "branch_id": created_br["branch_id"],
            "post_id": created_post["post_id"],
            "role_id": "accountant"
        }, headers=headers)
        assert create_user_res.status_code == 200
        created_user = create_user_res.json()
        assert created_user["user_id"].startswith("TDSC-USR-")
        assert created_user["branch_name"] == "Patna Main Office"
        assert created_user["post_title"] == "Legal Advisor"

        # 8. Test Customer & Credential Vault (Section 15 & 16)
        cust_mobile = f"99{server.secrets.randbelow(89999999) + 10000000}"
        cust_pan = f"ABCDE{server.secrets.randbelow(8999) + 1000}F"
        cust_aadhar = f"{server.secrets.randbelow(899999999999) + 100000000000}"

        new_cust_res = await client.post("/api/customers", json={
            "name": "M/S Bihar Construction Pvt Ltd",
            "address": "Gandhi Maidan, Patna",
            "mobile": cust_mobile,
            "whatsapp": cust_mobile,
            "alternate_mobile": "9876543299",
            "email": f"bihar_{server.uuid.uuid4().hex[:4]}@construction.com",
            "pan": cust_pan,
            "aadhar": cust_aadhar,
            "registration_class": "Class I",
            "departments": "RWD, BCD, PWD",
            "eproc2_user_id": "eproc_bihar_01",
            "eproc2_password": encrypt_credential("EprocSecret@2026"),
            "dsc_issued_date": "2025-01-01",
            "dsc_expired_date": (date.today()).isoformat(),  # expired today
        }, headers=headers)
        assert new_cust_res.status_code == 200
        created_cust = new_cust_res.json()

        # Reveal credential via vault endpoint
        reveal_res = await client.post(
            f"/api/customers/{created_cust['id']}/credentials/reveal",
            json={"field": "eproc2_password"},
            headers=headers
        )
        assert reveal_res.status_code == 200
        reveal_data = reveal_res.json()
        assert reveal_data["value"] == "EprocSecret@2026"

        # Check Expiry alerts (Section 18)
        alerts_res = await client.get("/api/customers/document-expiry-alerts", headers=headers)
        assert alerts_res.status_code == 200
        alerts = alerts_res.json()
        assert alerts["total_alerts"] >= 1
        assert any(a["customer_name"] == "M/S Bihar Construction Pvt Ltd" for a in alerts["alerts"])

        # 9. Test Estimates and Conversion to Invoice (Section 25)
        est_res = await client.post("/api/accounting/estimates", json={
            "date": date.today().isoformat(),
            "customer_id": created_cust["id"],
            "items": [
                {
                    "name": "E-Tender Service Fee",
                    "qty": 2.0,
                    "rate": 2500.0,
                    "discount": 500.0,
                    "tax_rate": 18.0
                }
            ],
            "notes": "Quotation for upcoming RWD tender"
        }, headers=headers)
        assert est_res.status_code == 200
        est_data = est_res.json()
        assert est_data["estimate_no"].startswith("TDSC-EST/")
        assert est_data["subtotal"] == 5000.0
        assert est_data["total_discount"] == 500.0
        # Taxable: 4500, Tax (18%): 810, Total: 5310
        assert est_data["grand_total"] == 5310.0

        # Convert Estimate to Sales Invoice
        conv_res = await client.post(f"/api/accounting/estimates/{est_data['id']}/convert-to-invoice", headers=headers)
        assert conv_res.status_code == 200
        assert conv_res.json()["ok"] is True
        inv_no = conv_res.json()["invoice_number"]
        assert inv_no.startswith("TDSC/")

        # 10. Test Task Workflow progression (Section 12 & 13)
        task_res = await client.post("/api/tasks-workflow", json={
            "title": "Process RWD Bihar Bid Document",
            "description": "Prepare technical sheets and upload DSC signature",
            "customer_id": created_cust["id"],
            "priority": "high",
            "due_date": date.today().isoformat(),
            "assigned_user": created_user["user_id"]
        }, headers=headers)
        assert task_res.status_code == 200
        task_data = task_res.json()
        assert task_data["task_id"].startswith("TDSC-TSK-")
        assert task_data["current_stage_name"] == "Data Entry Operator"

        # Advance stage: Approve by DEO -> Accountant
        action_res = await client.post(
            f"/api/tasks-workflow/{task_data['id']}/action",
            json={"action": "approve", "remarks": "Documents verified by DEO"},
            headers=headers
        )
        assert action_res.status_code == 200
        updated_task = action_res.json()
        assert updated_task["current_stage_name"] == "Accountant"
        assert len(updated_task["workflow_history"]) >= 2

        # 11. Test Field Staff GPS Ping (Section 35)
        gps_res = await client.post("/api/gps/ping", json={
            "latitude": 25.6120,
            "longitude": 85.1440,
            "accuracy": 5.0,
            "activity": "moving"
        }, headers=headers)
        assert gps_res.status_code == 200
        assert gps_res.json()["latitude"] == 25.6120

        # 12. Test Global Search (Section 39)
        search_res = await client.get(f"/api/system/search?q=Bihar", headers=headers)
        assert search_res.status_code == 200
        search_data = search_res.json()
        assert search_data["total_matches"] >= 1
        assert any(r["module"] == "Customer" for r in search_data["results"])

        # 13. Test System Stats (Section 38)
        stats_res = await client.get("/api/system/stats", headers=headers)
        assert stats_res.status_code == 200
        stats = stats_res.json()
        assert stats["total_branches"] >= 1
        assert stats["total_customers"] >= 1

        # 14. Test Audit Logs (Section 41)
        audit_res = await client.get("/api/audit-logs?limit=10", headers=headers)
        assert audit_res.status_code == 200
        assert len(audit_res.json()) >= 1
        assert any(a["module"] in ("customer_vault", "branches", "tasks") for a in audit_res.json())
