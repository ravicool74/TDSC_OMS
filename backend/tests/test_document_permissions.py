import pytest
import uuid
import sys
from pathlib import Path
from httpx import AsyncClient, ASGITransport

sys.path.insert(0, str(Path(__file__).parent.parent))
import server

@pytest.fixture(scope="session")
def anyio_backend():
    return "asyncio"

@pytest.mark.asyncio
async def test_document_library_user_access_control():
    transport = ASGITransport(app=server.app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        # 1. Login as Admin
        admin_email = server.os.environ.get("SEED_ADMIN_EMAIL", "admin@triveni.com")
        admin_pass = server.os.environ.get("SEED_ADMIN_PASSWORD", "admin123")
        admin_login = await client.post("/api/auth/login", json={"email": admin_email, "password": admin_pass})
        assert admin_login.status_code == 200, admin_login.text
        admin_token = admin_login.json()["session_token"]
        admin_headers = {"Authorization": f"Bearer {admin_token}"}

        # 2. Check /users-list endpoint
        users_res = await client.get("/api/document-library/users-list", headers=admin_headers)
        assert users_res.status_code == 200, users_res.text
        users_list = users_res.json()
        assert len(users_list) > 0, "Users list should not be empty"

        # 3. Create two distinct employee test accounts (User A and User B)
        emp_a_email = f"emp_a_{uuid.uuid4().hex[:6]}@triveni.com"
        emp_b_email = f"emp_b_{uuid.uuid4().hex[:6]}@triveni.com"
        pwd = "Password123!"

        res_a = await client.post("/api/auth/signup", json={
            "email": emp_a_email, "name": "Employee Alpha", "password": pwd, "role": "employee"
        })
        assert res_a.status_code == 200, res_a.text
        token_a = res_a.json()["session_token"]
        user_a_id = res_a.json()["user"]["user_id"]
        headers_a = {"Authorization": f"Bearer {token_a}"}

        res_b = await client.post("/api/auth/signup", json={
            "email": emp_b_email, "name": "Employee Beta", "password": pwd, "role": "employee"
        })
        assert res_b.status_code == 200, res_b.text
        token_b = res_b.json()["session_token"]
        user_b_id = res_b.json()["user"]["user_id"]
        headers_b = {"Authorization": f"Bearer {token_b}"}

        # 4. Admin creates a restricted folder ONLY for Employee Alpha
        folder_res = await client.post("/api/document-library/folders", json={
            "name": f"Alpha Confidential Docs {uuid.uuid4().hex[:4]}",
            "category": "forms_and_rules",
            "description": "Visible only to Admin and Alpha",
            "access_type": "restricted",
            "allowed_user_ids": [user_a_id],
        }, headers=admin_headers)
        assert folder_res.status_code == 200, folder_res.text
        fld = folder_res.json()
        fld_id = fld["id"]
        assert fld["access_type"] == "restricted"
        assert user_a_id in fld["allowed_user_ids"]

        # 5. Check visibility in list_folders
        # Admin should see it
        admin_folders = (await client.get("/api/document-library/folders", headers=admin_headers)).json()
        assert any(f["id"] == fld_id for f in admin_folders), "Admin must see restricted folder"

        # User A should see it
        alpha_folders = (await client.get("/api/document-library/folders", headers=headers_a)).json()
        assert any(f["id"] == fld_id for f in alpha_folders), "User A must see allowed folder"

        # User B should NOT see it
        beta_folders = (await client.get("/api/document-library/folders", headers=headers_b)).json()
        assert not any(f["id"] == fld_id for f in beta_folders), "User B must NOT see restricted folder"

        # 6. Check files listing in restricted folder
        # User A can view folder files (200 OK)
        alpha_files_res = await client.get(f"/api/document-library/folders/{fld_id}/files", headers=headers_a)
        assert alpha_files_res.status_code == 200

        # User B should get 403 Forbidden
        beta_files_res = await client.get(f"/api/document-library/folders/{fld_id}/files", headers=headers_b)
        assert beta_files_res.status_code == 403, f"Expected 403 for User B but got {beta_files_res.status_code}"

        # 7. Admin updates folder permissions to include User B
        perm_update = await client.patch(f"/api/document-library/folders/{fld_id}/permissions", json={
            "access_type": "restricted",
            "allowed_user_ids": [user_a_id, user_b_id]
        }, headers=admin_headers)
        assert perm_update.status_code == 200, perm_update.text
        assert user_b_id in perm_update.json()["allowed_user_ids"]

        # Now User B can see it!
        beta_folders_now = (await client.get("/api/document-library/folders", headers=headers_b)).json()
        assert any(f["id"] == fld_id for f in beta_folders_now), "User B must now see newly shared folder"

        # 8. Test Row-Level File Permissions
        # Admin creates row 1: Public (all)
        row1_res = await client.post(f"/api/document-library/folders/{fld_id}/files", json={
            "file_description": "Public Notice Line",
            "access_type": "all",
            "allowed_user_ids": []
        }, headers=admin_headers)
        assert row1_res.status_code == 200
        row1_id = row1_res.json()["id"]

        # Admin creates row 2: Restricted ONLY to User A
        row2_res = await client.post(f"/api/document-library/folders/{fld_id}/files", json={
            "file_description": "Alpha Private Form",
            "access_type": "restricted",
            "allowed_user_ids": [user_a_id]
        }, headers=admin_headers)
        assert row2_res.status_code == 200
        row2_id = row2_res.json()["id"]

        # User A fetches folder files -> should see BOTH row 1 and row 2
        a_files = (await client.get(f"/api/document-library/folders/{fld_id}/files", headers=headers_a)).json()["files"]
        a_ids = [f["id"] for f in a_files]
        assert row1_id in a_ids and row2_id in a_ids, "User A should see both public and alpha-private rows"

        # User B fetches folder files -> should see row 1, but NOT row 2
        b_files = (await client.get(f"/api/document-library/folders/{fld_id}/files", headers=headers_b)).json()["files"]
        b_ids = [f["id"] for f in b_files]
        assert row1_id in b_ids, "User B should see public row"
        assert row2_id not in b_ids, "User B should NOT see alpha-restricted row"

        # 9. Admin updates row 2 permissions to "all"
        row_perm_update = await client.patch(
            f"/api/document-library/folders/{fld_id}/files/{row2_id}/permissions",
            json={"access_type": "all", "allowed_user_ids": []},
            headers=admin_headers
        )
        assert row_perm_update.status_code == 200
        assert row_perm_update.json()["access_type"] == "all"

        # Now User B can see row 2
        b_files_after = (await client.get(f"/api/document-library/folders/{fld_id}/files", headers=headers_b)).json()["files"]
        assert any(f["id"] == row2_id for f in b_files_after), "User B should now see row 2 after made public"

        # 10. Clean up folder
        del_res = await client.delete(f"/api/document-library/folders/{fld_id}", headers=admin_headers)
        assert del_res.status_code == 200
