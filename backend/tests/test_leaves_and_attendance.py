import pytest
import io
import uuid
from httpx import AsyncClient, ASGITransport
import server

@pytest.fixture(scope="session")
def anyio_backend():
    return "asyncio"

@pytest.mark.asyncio
async def test_leaves_and_attendance_complete_lifecycle():
    transport = ASGITransport(app=server.app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        # 1. Login as Admin
        admin_email = server.os.environ.get("SEED_ADMIN_EMAIL", "admin@triveni.com")
        admin_pass = server.os.environ.get("SEED_ADMIN_PASSWORD", "admin123")
        login_res = await client.post("/api/auth/login", json={"email": admin_email, "password": admin_pass})
        assert login_res.status_code == 200, f"Admin login failed: {login_res.text}"
        admin_token = login_res.json()["session_token"]
        admin_headers = {"Authorization": f"Bearer {admin_token}"}

        # 2. Test GET /api/leave-categories (Seeds defaults CL, SL, EL, CO)
        cat_res = await client.get("/api/leave-categories", headers=admin_headers)
        assert cat_res.status_code == 200, cat_res.text
        categories = cat_res.json()
        assert len(categories) >= 4
        codes = [c["code"] for c in categories]
        assert "CL" in codes
        assert "SL" in codes
        assert "EL" in codes

        # 3. Test POST /api/leave-categories (Add Category with week, month, year limits)
        uid = uuid.uuid4().hex[:5].upper()
        new_cat_code = f"T{uid}"
        create_cat_res = await client.post("/api/leave-categories", json={
            "name": f"Test Special Leave {uid}",
            "code": new_cat_code,
            "description": "Special project work compensatory leave",
            "max_per_week": 2.0,
            "max_per_month": 3.0,
            "max_per_year": 18.0,
            "is_paid": True,
            "status": "active"
        }, headers=admin_headers)
        assert create_cat_res.status_code == 200, create_cat_res.text
        created_cat = create_cat_res.json()
        cat_id = created_cat["id"]
        assert created_cat["max_per_week"] == 2.0
        assert created_cat["max_per_month"] == 3.0
        assert created_cat["max_per_year"] == 18.0

        # 4. Test PATCH /api/leave-categories/{id} (Edit / Update Category)
        update_cat_res = await client.patch(f"/api/leave-categories/{cat_id}", json={
            "name": f"Test Special Leave Updated {uid}",
            "max_per_month": 4.0,
            "max_per_year": 20.0
        }, headers=admin_headers)
        assert update_cat_res.status_code == 200, update_cat_res.text
        updated_cat = update_cat_res.json()
        assert updated_cat["max_per_month"] == 4.0
        assert updated_cat["max_per_year"] == 20.0

        # 5. Test POST /api/leaves (Apply for leave under this category)
        apply_res = await client.post("/api/leaves", json={
            "category_id": cat_id,
            "from_date": "2026-09-23",
            "to_date": "2026-09-25",
            "days_count": 3.0,
            "reason": "Family function"
        }, headers=admin_headers)
        assert apply_res.status_code == 200, apply_res.text
        applied_leave = apply_res.json()
        leave_id = applied_leave["id"]
        assert applied_leave["days_count"] == 3.0
        assert applied_leave["status"] == "pending"

        # 6. Test GET /api/leaves/balances before approval (should show in pending_leave)
        balance_res = await client.get("/api/leaves/balances", headers=admin_headers)
        assert balance_res.status_code == 200, balance_res.text
        b_data = balance_res.json()
        cat_balance = next((b for b in b_data["balances"] if b["category_id"] == cat_id), None)
        assert cat_balance is not None
        assert cat_balance["pending_leave"] == 3.0
        assert cat_balance["utilised_leave"] == 0.0
        assert cat_balance["balance_leave"] == 20.0

        # 7. Test PATCH /api/leaves/{id} (Approve leave)
        decide_res = await client.patch(f"/api/leaves/{leave_id}", json={
            "status": "approved",
            "remarks": "Approved by Admin"
        }, headers=admin_headers)
        assert decide_res.status_code == 200, decide_res.text
        assert decide_res.json()["status"] == "approved"

        # 8. Test GET /api/leaves/balances after approval (utilised should be 3, balance should be 17)
        balance_res2 = await client.get("/api/leaves/balances", headers=admin_headers)
        b_data2 = balance_res2.json()
        cat_balance2 = next((b for b in b_data2["balances"] if b["category_id"] == cat_id), None)
        assert cat_balance2 is not None
        assert cat_balance2["utilised_leave"] == 3.0
        assert cat_balance2["balance_leave"] == 17.0
        assert cat_balance2["max_per_week"] == 2.0
        assert cat_balance2["max_per_month"] == 4.0
        assert cat_balance2["max_per_year"] == 20.0

        # 9. Test DELETE /api/leave-categories/{id} (Delete Category)
        del_cat_res = await client.delete(f"/api/leave-categories/{cat_id}", headers=admin_headers)
        assert del_cat_res.status_code == 200, del_cat_res.text
        assert del_cat_res.json()["ok"] is True

        # 10. Test Punch In with Geo-Tag, Face Recognition & Place
        fake_selfie = io.BytesIO(b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x01\x00H\x00H\x00\x00\xff\xdb\x00C\x00")
        files = {"selfie": ("selfie.jpg", fake_selfie, "image/jpeg")}
        data = {
            "type": "in",
            "lat": "25.5941",
            "lng": "85.1376",
            "accuracy": "12.5",
            "place_name": "Patna Head Office"
        }
        punch_in_res = await client.post("/api/punches", data=data, files=files, headers=admin_headers)
        assert punch_in_res.status_code == 200, punch_in_res.text
        p_in = punch_in_res.json()
        assert p_in["type"] == "in"
        assert p_in["face_verified"] is True
        assert p_in["lat"] == 25.5941
        assert p_in["lng"] == 85.1376
        assert p_in["place_name"] is not None

        # 11. Test Punch Out with Geo-Tag, Face Recognition & Place
        fake_selfie_out = io.BytesIO(b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x01\x00H\x00H\x00\x00\xff\xdb\x00C\x00")
        files_out = {"selfie": ("selfie_out.jpg", fake_selfie_out, "image/jpeg")}
        data_out = {
            "type": "out",
            "lat": "25.5945",
            "lng": "85.1380",
            "accuracy": "10.0",
            "place_name": "Patna Head Office"
        }
        punch_out_res = await client.post("/api/punches", data=data_out, files=files_out, headers=admin_headers)
        assert punch_out_res.status_code == 200, punch_out_res.text
        p_out = punch_out_res.json()
        assert p_out["type"] == "out"
        assert p_out["face_verified"] is True
        assert p_out["lat"] == 25.5945

        # 12. Test GET /api/punches/all-today
        all_punches = await client.get("/api/punches/all-today", headers=admin_headers)
        assert all_punches.status_code == 200, all_punches.text
        assert len(all_punches.json()) >= 2
