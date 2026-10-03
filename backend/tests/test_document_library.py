import pytest
import uuid
import io
import sys
from pathlib import Path
from httpx import AsyncClient, ASGITransport

sys.path.insert(0, str(Path(__file__).parent.parent))
import server

@pytest.fixture(scope="session")
def anyio_backend():
    return "asyncio"

@pytest.mark.asyncio
async def test_document_library_and_forms_rules_lifecycle():
    transport = ASGITransport(app=server.app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        # 1. Login as Admin
        admin_email = server.os.environ.get("SEED_ADMIN_EMAIL", "admin@triveni.com")
        admin_pass = server.os.environ.get("SEED_ADMIN_PASSWORD", "admin123")
        login_res = await client.post("/api/auth/login", json={"email": admin_email, "password": admin_pass})
        assert login_res.status_code == 200, f"Admin login failed: {login_res.text}"
        token = login_res.json()["session_token"]
        headers = {"Authorization": f"Bearer {token}"}

        # 2. List Folders (Auto-seeds defaults)
        folders_res = await client.get("/api/document-library/folders", headers=headers)
        assert folders_res.status_code == 200, folders_res.text
        folders = folders_res.json()
        assert len(folders) >= 3

        # Check forms_and_rules folders exist
        forms_folders_res = await client.get("/api/document-library/folders?category=forms_and_rules", headers=headers)
        assert forms_folders_res.status_code == 200
        forms_folders = forms_folders_res.json()
        assert len(forms_folders) >= 2
        assert any("CPWD" in f["name"] for f in forms_folders)

        # 3. Create a new folder (+ Sign)
        new_folder_res = await client.post("/api/document-library/folders", json={
            "name": f"Bihar Tender Circulars 2026 {uuid.uuid4().hex[:4]}",
            "category": "forms_and_rules",
            "description": "Government notifications and standard bidding documents",
            "icon": "folder",
            "color": "#10b981"
        }, headers=headers)
        assert new_folder_res.status_code == 200, new_folder_res.text
        created_folder = new_folder_res.json()
        fid = created_folder["id"]
        assert created_folder["category"] == "forms_and_rules"

        # 4. Rename Folder
        renamed_title = f"Bihar Tender Circulars Updated {uuid.uuid4().hex[:4]}"
        rename_res = await client.patch(f"/api/document-library/folders/{fid}", json={
            "name": renamed_title
        }, headers=headers)
        assert rename_res.status_code == 200, rename_res.text
        assert rename_res.json()["name"] == renamed_title

        # 5. List Files in this folder (initially empty)
        files_res = await client.get(f"/api/document-library/folders/{fid}/files", headers=headers)
        assert files_res.status_code == 200
        assert len(files_res.json()["files"]) == 0

        # 6. Add First File Line (Sl. No. 1, File Description)
        line1_res = await client.post(f"/api/document-library/folders/{fid}/files", json={
            "file_description": "Standard General Conditions of Contract (GCC 2026)"
        }, headers=headers)
        assert line1_res.status_code == 200, line1_res.text
        line1 = line1_res.json()
        assert line1["sl_no"] == 1
        assert line1["file_description"] == "Standard General Conditions of Contract (GCC 2026)"

        # 7. Add Second Line directly below using '+' (insert_after_id)
        line2_res = await client.post(f"/api/document-library/folders/{fid}/files", json={
            "file_description": "Schedule of Rates (SOR) Road & Bridge Works",
            "insert_after_id": line1["id"]
        }, headers=headers)
        assert line2_res.status_code == 200, line2_res.text
        line2 = line2_res.json()
        assert line2["sl_no"] == 2

        # 8. Edit / Update description of line 2
        update_line_res = await client.patch(f"/api/document-library/folders/{fid}/files/{line2['id']}", json={
            "file_description": "Schedule of Rates (SOR) Road & Bridge Works - Bihar RWD 2026 Edition"
        }, headers=headers)
        assert update_line_res.status_code == 200
        assert "Bihar RWD" in update_line_res.json()["file_description"]

        # 9. Upload File Attachment to line 1
        fake_pdf = b"%PDF-1.4 Fake PDF Content for Forms and Rules testing"
        upload_res = await client.post(
            f"/api/document-library/folders/{fid}/files/{line1['id']}/upload",
            files={"file": ("GCC_2026_Standard.pdf", fake_pdf, "application/pdf")},
            headers=headers
        )
        assert upload_res.status_code == 200, upload_res.text
        uploaded_doc = upload_res.json()
        assert uploaded_doc["file_name"] == "GCC_2026_Standard.pdf"
        assert uploaded_doc["file_path"].startswith(f"documents/{fid}/")
        assert uploaded_doc["file_type"] == "pdf"

        # 10. Delete a file row and verify serial numbers
        del_line_res = await client.delete(f"/api/document-library/folders/{fid}/files/{line1['id']}", headers=headers)
        assert del_line_res.status_code == 200
        
        # Verify line 2 is now compacted to sl_no 1
        remaining_res = await client.get(f"/api/document-library/folders/{fid}/files", headers=headers)
        assert len(remaining_res.json()["files"]) == 1
        assert remaining_res.json()["files"][0]["sl_no"] == 1

        # 11. Delete Folder
        del_fld_res = await client.delete(f"/api/document-library/folders/{fid}", headers=headers)
        assert del_fld_res.status_code == 200
        assert del_fld_res.json()["ok"] is True
