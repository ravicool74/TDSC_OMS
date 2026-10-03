import pytest
import uuid
from httpx import AsyncClient, ASGITransport
import server

@pytest.fixture(scope="session")
def anyio_backend():
    return "asyncio"

@pytest.mark.asyncio
async def test_customer_custom_fields_lifecycle():
    transport = ASGITransport(app=server.app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        # 1. Login as admin
        admin_email = server.os.environ.get("SEED_ADMIN_EMAIL", "admin@triveni.com")
        admin_pass = server.os.environ.get("SEED_ADMIN_PASSWORD", "admin123")
        login_res = await client.post("/api/auth/login", json={"email": admin_email, "password": admin_pass})
        assert login_res.status_code == 200, f"Admin login failed: {login_res.text}"
        admin_token = login_res.json()["session_token"]
        admin_headers = {"Authorization": f"Bearer {admin_token}"}

        # 2. Login or create employee
        emp_email = f"emp_test_{uuid.uuid4().hex[:6]}@triveni.com"
        emp_signup = await client.post("/api/auth/signup", json={
            "email": emp_email, "name": "Employee Tester", "password": "emp123password", "role": "employee"
        })
        assert emp_signup.status_code == 200
        emp_token = emp_signup.json()["session_token"]
        emp_headers = {"Authorization": f"Bearer {emp_token}"}

        # 3. Non-admin should be rejected when creating a custom field
        bad_res = await client.post("/api/customers/custom-fields", json={
            "label": "Unauthorized Field", "field_type": "text"
        }, headers=emp_headers)
        assert bad_res.status_code == 403, f"Expected 403 for employee, got {bad_res.status_code}"

        # 4. Admin creates dynamic custom fields
        uid = uuid.uuid4().hex[:6]
        f1_label = f"Labour License No {uid}"
        create_f1 = await client.post("/api/customers/custom-fields", json={
            "label": f1_label,
            "field_type": "text",
            "placeholder": "e.g. LAB-2026-001",
            "required": False
        }, headers=admin_headers)
        assert create_f1.status_code == 200, create_f1.text
        f1_data = create_f1.json()
        assert f1_data["label"] == f1_label
        f1_key = f1_data["field_key"]
        f1_id = f1_data["id"]

        f2_label = f"Contractor Grade {uid}"
        create_f2 = await client.post("/api/customers/custom-fields", json={
            "label": f2_label,
            "field_type": "select",
            "options": ["Grade A", "Grade B", "Grade C"],
            "required": False
        }, headers=admin_headers)
        assert create_f2.status_code == 200, create_f2.text
        f2_data = create_f2.json()
        f2_key = f2_data["field_key"]
        f2_id = f2_data["id"]

        # 5. List custom fields (both admin and employee can view)
        list_res = await client.get("/api/customers/custom-fields", headers=emp_headers)
        assert list_res.status_code == 200
        all_fields = list_res.json()
        field_keys = [f["field_key"] for f in all_fields]
        assert f1_key in field_keys
        assert f2_key in field_keys

        # 6. Create customer with custom field values
        cust_mobile = f"98{uuid.uuid4().int % 100000000:08d}"
        cust_pan = f"ABCDE{uuid.uuid4().int % 10000:04d}F"
        cust_aadhar = f"123456{uuid.uuid4().int % 1000000:06d}"
        customer_payload = {
            "name": f"Dynamic Field Contractor {uid}",
            "mobile": cust_mobile,
            "whatsapp": cust_mobile,
            "pan": cust_pan,
            "aadhar": cust_aadhar,
            "custom_fields": {
                f1_key: "LAB-BIHAR-2026-99",
                f2_key: "Grade A"
            }
        }
        create_cust_res = await client.post("/api/customers", json=customer_payload, headers=admin_headers)
        assert create_cust_res.status_code == 200, create_cust_res.text
        cust_data = create_cust_res.json()
        cust_id = cust_data["id"]
        assert cust_data.get("custom_fields", {}).get(f1_key) == "LAB-BIHAR-2026-99"
        assert cust_data.get("custom_fields", {}).get(f2_key) == "Grade A"

        # 7. Retrieve customer and verify custom fields
        get_cust = await client.get(f"/api/customers/{cust_id}", headers=admin_headers)
        assert get_cust.status_code == 200
        saved_cf = get_cust.json().get("custom_fields", {})
        assert saved_cf.get(f1_key) == "LAB-BIHAR-2026-99"
        assert saved_cf.get(f2_key) == "Grade A"

        # 8. Update customer's custom fields
        customer_payload["custom_fields"][f1_key] = "LAB-BIHAR-2026-UPDATED"
        update_cust = await client.put(f"/api/customers/{cust_id}", json=customer_payload, headers=admin_headers)
        assert update_cust.status_code == 200
        assert update_cust.json().get("custom_fields", {}).get(f1_key) == "LAB-BIHAR-2026-UPDATED"

        # 9. Delete custom field as admin
        del_res = await client.delete(f"/api/customers/custom-fields/{f2_id}", headers=admin_headers)
        assert del_res.status_code == 200
        assert del_res.json()["status"] == "deleted"

        # Verify field is removed from list
        list_res2 = await client.get("/api/customers/custom-fields", headers=admin_headers)
        field_ids_after = [f["id"] for f in list_res2.json()]
        assert f2_id not in field_ids_after

        # 10. Clean up test data
        await server.db.customers.delete_one({"id": cust_id})
        await server.db.customer_custom_fields.delete_one({"id": f1_id})
        await server.db.users.delete_one({"email": emp_email})
