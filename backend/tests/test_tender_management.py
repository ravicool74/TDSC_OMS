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
async def test_tender_management_full_suite():
    transport = ASGITransport(app=server.app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        # 1. Login as Admin
        admin_email = server.os.environ.get("SEED_ADMIN_EMAIL", "admin@triveni.com")
        admin_pass = server.os.environ.get("SEED_ADMIN_PASSWORD", "admin123")
        login_res = await client.post("/api/auth/login", json={"email": admin_email, "password": admin_pass})
        assert login_res.status_code == 200, f"Admin login failed: {login_res.text}"
        admin_token = login_res.json()["session_token"]
        headers = {"Authorization": f"Bearer {admin_token}"}

        # 2. Test Tender Creation & Computer Auto-Categorization by Value
        # (a) 0 to 25 Lacs
        t1_res = await client.post("/api/tender-mgmt/tenders", json={
            "name_of_work": "Construction of Village Drain at Ward-02",
            "tender_id": f"NIT-2026-RWD-{uuid.uuid4().hex[:4]}",
            "reference_no": "REF-001-A",
            "department": "Rural Works Department (RWD)",
            "estimated_cost": 1500000.0, # 15 Lakhs
            "contractor_class": "Class IV",
            "district": "Patna",
            "date_of_start": "2026-09-20",
            "end_date": "2026-09-30 15:00",
            "tender_description": "Masonry drain works 300m",
            "status": "open"
        }, headers=headers)
        assert t1_res.status_code == 200, t1_res.text
        t1 = t1_res.json()
        assert t1["value_category"] == "0_to_25_lacs"
        assert "time_left" in t1
        assert "d:" in t1["time_left"]["formatted"]

        # (b) 25 to 70 Lacs
        t2_res = await client.post("/api/tender-mgmt/tenders", json={
            "name_of_work": "Upgradation of Link Road to Bituminous Surface",
            "tender_id": f"NIT-2026-PWD-{uuid.uuid4().hex[:4]}",
            "reference_no": "REF-002-B",
            "department": "Public Works Department (PWD)",
            "estimated_cost": 4500000.0, # 45 Lakhs
            "contractor_class": "Class III",
            "district": "Gaya",
            "date_of_start": "2026-09-22",
            "end_date": "2026-10-05 17:00",
            "tender_description": "Bituminous road carpet 2.5 km",
            "status": "open"
        }, headers=headers)
        assert t2_res.status_code == 200, t2_res.text
        t2 = t2_res.json()
        assert t2["value_category"] == "25_to_70_lacs"

        # (c) 70 to 3.5 Crore
        t3_res = await client.post("/api/tender-mgmt/tenders", json={
            "name_of_work": "Construction of ITI College Academic Block",
            "tender_id": f"NIT-2026-BCD-{uuid.uuid4().hex[:4]}",
            "reference_no": "REF-003-C",
            "department": "Building Construction Department (BCD)",
            "estimated_cost": 19500000.0, # 1.95 Crore
            "contractor_class": "Class II",
            "district": "Muzaffarpur",
            "date_of_start": "2026-09-21",
            "end_date": "2026-10-15 15:30",
            "tender_description": "RCC G+3 Building structure",
            "status": "open"
        }, headers=headers)
        assert t3_res.status_code == 200, t3_res.text
        t3 = t3_res.json()
        assert t3["value_category"] == "70_to_3_5_cr"

        # (d) 3.5 Crore and above
        t4_res = await client.post("/api/tender-mgmt/tenders", json={
            "name_of_work": "Major Multi-Span Flyover on State Highway",
            "tender_id": f"NIT-2026-RCD-{uuid.uuid4().hex[:4]}",
            "reference_no": "REF-004-D",
            "department": "Road Construction Department (RCD)",
            "estimated_cost": 65000000.0, # 6.5 Crore
            "contractor_class": "Class I",
            "district": "Patna",
            "date_of_start": "2026-09-24",
            "end_date": "2026-11-01 12:00",
            "tender_description": "Pre-stressed concrete flyover 1.2km",
            "status": "open"
        }, headers=headers)
        assert t4_res.status_code == 200, t4_res.text
        t4 = t4_res.json()
        assert t4["value_category"] == "above_3_5_cr"

        # 3. Test Filter by Value Category
        list_0_25 = await client.get("/api/tender-mgmt/tenders?value_category=0_to_25_lacs", headers=headers)
        assert list_0_25.status_code == 200
        for item in list_0_25.json():
            assert item["value_category"] == "0_to_25_lacs"

        # 4. Test Web Sources (Admin attached web page addresses) & Scraper Collector
        sources_res = await client.get("/api/tender-mgmt/sources", headers=headers)
        assert sources_res.status_code == 200
        sources = sources_res.json()
        assert len(sources) >= 1
        src_id = sources[0]["id"]

        # Collect / scrape tenders from source
        collect_res = await client.post(f"/api/tender-mgmt/sources/{src_id}/collect", headers=headers)
        assert collect_res.status_code == 200, collect_res.text
        collect_data = collect_res.json()
        assert collect_data["ok"] is True
        assert collect_data["collected_count"] >= 4

        # 5. Test Contractor Database & Auto-sync
        sync_res = await client.post("/api/tender-mgmt/contractors/sync-customers", headers=headers)
        assert sync_res.status_code == 200, sync_res.text
        
        # Add a test contractor
        new_con = await client.post("/api/tender-mgmt/contractors", json={
            "name": "M/S Triveni Infra Buildcon",
            "mobile": "9876543210",
            "registration_class": "Class II",
            "departments": ["RWD", "PWD", "Building Construction"],
            "whatsapp": "9876543210",
            "email": "infrabuildcon@triveni.com",
            "district": "Patna",
            "validity": "2028-12-31"
        }, headers=headers)
        assert new_con.status_code == 200, new_con.text
        created_con = new_con.json()
        con_id = created_con["id"]

        # List contractors with search
        con_list_res = await client.get("/api/tender-mgmt/contractors?search=Triveni", headers=headers)
        assert con_list_res.status_code == 200
        assert any(c["id"] == con_id for c in con_list_res.json())

        # 6. Test Manage Tender & Contractor (Mappings & Subscriptions)
        mapping_res = await client.get("/api/tender-mgmt/mappings", headers=headers)
        assert mapping_res.status_code == 200
        mapping = mapping_res.json()
        assert "value_class_mapping" in mapping
        assert "0_to_25_lacs" in mapping["value_class_mapping"]

        # Add Contractor Subscription
        sub_res = await client.post("/api/tender-mgmt/subscriptions", json={
            "contractor_id": con_id,
            "subscribed_departments": ["RWD", "PWD"],
            "subscribed_value_categories": ["0_to_25_lacs", "25_to_70_lacs", "70_to_3_5_cr"],
            "alert_channels": ["whatsapp", "sms"],
            "status": "active",
            "valid_until": "2027-12-31"
        }, headers=headers)
        assert sub_res.status_code == 200, sub_res.text
        sub = sub_res.json()
        assert sub["contractor_id"] == con_id

        # 7. Test Automated Tender <-> Contractor Matching Engine
        match_res = await client.get(f"/api/tender-mgmt/match/tender/{t2['id']}", headers=headers)
        assert match_res.status_code == 200, match_res.text
        match_data = match_res.json()
        assert "matched_contractors" in match_data
        assert match_data["matched_count"] >= 1
        top_match = next((m for m in match_data["matched_contractors"] if m["contractor_id"] == con_id), None)
        assert top_match is not None
        assert "whatsapp_alert_text" in top_match
        assert "Triveni" in top_match["whatsapp_alert_text"]
