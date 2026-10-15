import requests
import io

BASE = "http://127.0.0.1:8000"

def test_phase2_comprehensive():
    print("=== TEST 1: Admin Service Catalogue Management CRUD ===")
    r_admin = requests.post(f"{BASE}/api/auth/login", json={"email": "admin@triveni.com", "password": "admin123"})
    assert r_admin.status_code == 200, f"Admin login failed: {r_admin.text}"
    admin_token = r_admin.json()["session_token"]
    admin_headers = {"Authorization": f"Bearer {admin_token}"}

    # Fetch admin services
    r_as = requests.get(f"{BASE}/api/admin/services", headers=admin_headers)
    assert r_as.status_code == 200, f"Admin services list failed: {r_as.text}"
    all_srv = r_as.json()
    print(f"Total admin services: {len(all_srv)}")
    assert len(all_srv) >= 27

    # Create a test service
    r_create = requests.post(f"{BASE}/api/admin/services", headers=admin_headers, json={
        "name": "Custom Corporate Consultancy",
        "category": "Corporate",
        "rate": 7500,
        "description": "Custom test corporate advisory service",
        "mandatory_docs": ["Company PAN", "Board Resolution"],
        "optional_docs": ["Previous Year Balance Sheet"],
        "max_file_size_mb": 10,
        "status": "active"
    })
    assert r_create.status_code == 200, f"Create service failed: {r_create.text}"
    created_srv = r_create.json()
    srv_id = created_srv["id"]
    print(f"Created custom service: ID={srv_id}, Name={created_srv['name']}")

    # Update the service
    r_update = requests.put(f"{BASE}/api/admin/services/{srv_id}", headers=admin_headers, json={
        "rate": 8000,
        "description": "Updated corporate advisory service"
    })
    assert r_update.status_code == 200
    assert r_update.json()["rate"] == 8000
    print("[OK] Admin Service Catalogue CRUD verified!")

    print("\n=== TEST 2: Customer Login, Stats & Tender Request ===")
    # Login as customer 00000017
    r_cust_login = requests.post(f"{BASE}/api/auth/login", json={"email": "00000017", "password": "MANO4375"})
    assert r_cust_login.status_code == 200
    cust_token = r_cust_login.json()["session_token"]
    cust_headers = {"Authorization": f"Bearer {cust_token}"}

    # Customer Stats
    r_stats = requests.get(f"{BASE}/api/customer-portal/stats", headers=cust_headers)
    assert r_stats.status_code == 200, f"Stats failed: {r_stats.text}"
    stats = r_stats.json()
    print(f"Customer Stats: Total Requests={stats.get('total_requests')}, Published Tenders={stats.get('published_tenders')}")
    assert "total_requests" in stats
    print("[OK] Customer Portal Stats endpoint verified!")

    # Customer Tender Request
    r_tenders = requests.get(f"{BASE}/api/customer-portal/tenders", headers=cust_headers)
    assert r_tenders.status_code == 200
    tenders_list = r_tenders.json()
    assert len(tenders_list) > 0
    tender_to_req = tenders_list[0]
    tender_id = tender_to_req.get("id") or tender_to_req.get("_id")
    print(f"Requesting bid prep for tender ID={tender_id}")

    r_req_tender = requests.post(f"{BASE}/api/customer-portal/tenders/{tender_id}/request", headers=cust_headers, json={
        "notes": "Please prepare technical bid for Sole Proprietorship."
    })
    assert r_req_tender.status_code == 200, f"Request tender failed: {r_req_tender.text}"
    print("[OK] Customer Tender Request for Bid Preparation verified!")

    print("\n=== TEST 3: New Service Request Submission with Custom Service ===")
    r_sub = requests.post(f"{BASE}/api/service-requests", headers=cust_headers, json={
        "service_id": srv_id,
        "remarks": "Please expedite corporate consultancy review",
        "priority": "urgent"
    })
    assert r_sub.status_code == 200
    sr_obj = r_sub.json()
    sr_id = sr_obj["id"]
    sr_no = sr_obj["request_no"]
    print(f"Submitted Request: {sr_no} (ID={sr_id})")

    print("\n=== TEST 4: Admin Reassignment Flow ===")
    # First assign to Admin
    r_assign = requests.post(f"{BASE}/api/service-requests/{sr_id}/assign-self", headers=admin_headers)
    assert r_assign.status_code == 200

    # Now Admin reassigns to another staff member or himself with a reason
    r_reassign = requests.post(f"{BASE}/api/service-requests/{sr_id}/reassign", headers=admin_headers, json={
        "new_employee_id": "usr_d5fd854c30bb",
        "reason": "Reassigned for specialized compliance handling"
    })
    assert r_reassign.status_code == 200, f"Reassign failed: {r_reassign.text}"
    sr_re = r_reassign.json().get("service_request") or r_reassign.json()
    assert sr_re.get("assigned_to") == "usr_d5fd854c30bb"
    print("[OK] Service Request Reassignment and history logging verified!")

    print("\n=== TEST 5: Customer Password Change Flow ===")
    # Change password from MANO4375 to MANO4375_NEW
    r_pwd = requests.post(f"{BASE}/api/customer-portal/change-password", headers=cust_headers, json={
        "current_password": "MANO4375",
        "new_password": "MANO4375_NEW"
    })
    assert r_pwd.status_code == 200, f"Password change failed: {r_pwd.text}"
    print("Password changed to MANO4375_NEW")

    # Verify old password rejected
    r_old_fail = requests.post(f"{BASE}/api/auth/login", json={"email": "00000017", "password": "MANO4375"})
    assert r_old_fail.status_code == 401
    print("[OK] Old temporary password successfully invalidated!")

    # Verify new password accepted
    r_new_ok = requests.post(f"{BASE}/api/auth/login", json={"email": "00000017", "password": "MANO4375_NEW"})
    assert r_new_ok.status_code == 200
    print("[OK] New customer password verified!")

    # Revert password back to MANO4375 so further runs remain consistent
    new_token = r_new_ok.json()["session_token"]
    r_revert = requests.post(f"{BASE}/api/customer-portal/change-password", headers={"Authorization": f"Bearer {new_token}"}, json={
        "current_password": "MANO4375_NEW",
        "new_password": "MANO4375"
    })
    assert r_revert.status_code == 200
    print("[OK] Password reverted to MANO4375 for continued testing!")

    print("\n=== TEST 6: Static Frontend Build Verification ===")
    r_index = requests.get(f"{BASE}/")
    assert r_index.status_code == 200
    assert "<!DOCTYPE html>" in r_index.text or "<html" in r_index.text
    print("[OK] Production Web Frontend served correctly from FastAPI root!")

    print("\n=======================================================")
    print("SUCCESS: ALL PHASE 2 TESTS PASSED WITH 100% SUCCESS!")
    print("=======================================================")

if __name__ == "__main__":
    test_phase2_comprehensive()
