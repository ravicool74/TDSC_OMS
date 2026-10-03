import pytest
import uuid
from httpx import AsyncClient, ASGITransport
import server

@pytest.fixture(scope="session")
def anyio_backend():
    return "asyncio"

@pytest.mark.asyncio
async def test_branch_management_crud_lifecycle():
    transport = ASGITransport(app=server.app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        # 1. Login as Admin
        admin_email = server.os.environ.get("SEED_ADMIN_EMAIL", "admin@triveni.com")
        admin_pass = server.os.environ.get("SEED_ADMIN_PASSWORD", "admin123")
        login_res = await client.post("/api/auth/login", json={"email": admin_email, "password": admin_pass})
        assert login_res.status_code == 200, f"Admin login failed: {login_res.text}"
        admin_token = login_res.json()["session_token"]
        admin_headers = {"Authorization": f"Bearer {admin_token}"}

        # 2. Login as regular Employee
        emp_email = f"emp_branch_{uuid.uuid4().hex[:6]}@triveni.com"
        emp_signup = await client.post("/api/auth/signup", json={
            "email": emp_email, "name": "Employee Branch Tester", "password": "emp123password", "role": "employee"
        })
        assert emp_signup.status_code == 200
        emp_token = emp_signup.json()["session_token"]
        emp_headers = {"Authorization": f"Bearer {emp_token}"}

        # 3. Employee should NOT be allowed to create a branch
        unauth_create = await client.post("/api/branches", json={
            "name": "Unauthorized Branch Office"
        }, headers=emp_headers)
        assert unauth_create.status_code == 403, f"Expected 403 for employee create, got {unauth_create.status_code}"

        # 4. Admin creates a new branch (Testing SAVE on new branch)
        uid = uuid.uuid4().hex[:6]
        branch_name = f"Muzaffarpur Regional Branch {uid}"
        create_res = await client.post("/api/branches", json={
            "name": branch_name,
            "address": "Station Road, Muzaffarpur, Bihar - 842001",
            "mobile": "9876543219",
            "email": "muzaffarpur@triveni.com",
            "branch_head": "Rajeev Ranjan",
            "status": "active",
            "lat": 26.1209,
            "lng": 85.3647,
            "radius_m": 250
        }, headers=admin_headers)
        assert create_res.status_code == 200, f"Branch create failed: {create_res.text}"
        created = create_res.json()
        assert created["name"] == branch_name
        assert created["branch_id"].startswith("TDSC-BR-")
        assert created["lat"] == 26.1209
        assert created["radius_m"] == 250
        branch_id = created["id"]
        branch_code = created["branch_id"]

        # 5. Get branch details
        get_res = await client.get(f"/api/branches/{branch_id}", headers=admin_headers)
        assert get_res.status_code == 200
        assert get_res.json()["branch_id"] == branch_code

        # 6. Admin updates branch (Testing SAVE on edit branch via PATCH)
        updated_name = f"Muzaffarpur Zonal Office {uid}"
        patch_res = await client.patch(f"/api/branches/{branch_id}", json={
            "name": updated_name,
            "branch_head": "Rajeev Ranjan (Zonal Head)",
            "radius_m": 350
        }, headers=admin_headers)
        assert patch_res.status_code == 200, f"Branch patch failed: {patch_res.text}"
        patched = patch_res.json()
        assert patched["name"] == updated_name
        assert patched["branch_head"] == "Rajeev Ranjan (Zonal Head)"
        assert patched["radius_m"] == 350

        # Also test update using branch_code
        patch_res2 = await client.patch(f"/api/branches/{branch_code}", json={
            "status": "inactive"
        }, headers=admin_headers)
        assert patch_res2.status_code == 200
        assert patch_res2.json()["status"] == "inactive"

        # 7. Employee should NOT be allowed to delete a branch
        unauth_del = await client.delete(f"/api/branches/{branch_id}", headers=emp_headers)
        assert unauth_del.status_code == 403

        # 8. Admin deletes branch (Testing DELETE button operation)
        del_res = await client.delete(f"/api/branches/{branch_id}", headers=admin_headers)
        assert del_res.status_code == 200, f"Branch delete failed: {del_res.text}"
        del_data = del_res.json()
        assert del_data.get("ok") is True
        assert del_data.get("deleted") == 1

        # 9. Verify branch is gone
        get_after_del = await client.get(f"/api/branches/{branch_id}", headers=admin_headers)
        assert get_after_del.status_code == 404
