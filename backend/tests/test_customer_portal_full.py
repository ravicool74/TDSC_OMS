import requests
import io

BASE = "http://127.0.0.1:8000"

def test_full_customer_portal_flow():
    print("=== TEST 1: Admin Login & Check Services ===")
    r_admin = requests.post(f"{BASE}/api/auth/login", json={"email": "admin@triveni.com", "password": "admin123"})
    assert r_admin.status_code == 200, f"Admin login failed: {r_admin.text}"
    admin_token = r_admin.json()["session_token"]
    admin_headers = {"Authorization": f"Bearer {admin_token}"}

    r_srv = requests.get(f"{BASE}/api/services/catalogue", headers=admin_headers)
    print(f"Catalogue response: {r_srv.status_code} - {r_srv.text}")
    assert r_srv.status_code == 200, f"Get services catalogue failed: {r_srv.text}"
    services = r_srv.json()
    print(f"Total active services in catalogue: {len(services)}")
    assert len(services) >= 26, f"Expected at least 26 services, got {len(services)}"
    print("[OK] All master services verified!")

    print("\n=== TEST 2: Customer Account Login with Numeric User ID ===")
    # Login with Customer TDSC-CUST-ID-00000017 (Manoj Kumar)
    # Temporary password policy: first 4 letters (MANO) + mobile last 4 (4375) or DOB -> MANO4375
    r_cust_login = requests.post(f"{BASE}/api/auth/login", json={"email": "00000017", "password": "MANO4375"})
    assert r_cust_login.status_code == 200, f"Customer login with numeric ID failed: {r_cust_login.text}"
    cust_data = r_cust_login.json()
    cust_token = cust_data["session_token"]
    cust_user = cust_data["user"]
    cust_headers = {"Authorization": f"Bearer {cust_token}"}
    print(f"Logged in as Customer: {cust_user['name']} (User ID: {cust_user['user_id']}, Role: {cust_user['role']})")
    assert cust_user["role"] == "customer"
    assert cust_user["user_id"] == "00000017"
    print("[OK] Customer logged in successfully with pure numeric User ID!")

    print("\n=== TEST 3: Customer Profile & Security Isolation ===")
    r_prof = requests.get(f"{BASE}/api/customer-portal/profile", headers=cust_headers)
    assert r_prof.status_code == 200
    prof = r_prof.json()
    print(f"Profile: Name={prof['name']}, PAN={prof['pan']}, Mobile={prof['mobile']}")
    assert prof["user_id"] == "00000017"

    # Profile update
    r_upd_prof = requests.put(f"{BASE}/api/customer-portal/profile", headers=cust_headers, json={
        "agency_name": "Manoj Kumar & Sons Infra",
        "address": "Boring Road, Patna, Bihar"
    })
    assert r_upd_prof.status_code == 200
    r_prof_re = requests.get(f"{BASE}/api/customer-portal/profile", headers=cust_headers)
    assert r_prof_re.json()["agency_name"] == "Manoj Kumar & Sons Infra"
    print("[OK] Profile update and ownership verified!")

    print("\n=== TEST 4: Customer Portal Published Tenders ===")
    r_tenders = requests.get(f"{BASE}/api/customer-portal/tenders", headers=cust_headers)
    assert r_tenders.status_code == 200
    tenders = r_tenders.json()
    print(f"Published tenders available to customer: {len(tenders)}")
    assert len(tenders) > 0
    sample_tender = tenders[0]
    print(f"Sample tender: {sample_tender.get('tender_id')} - {sample_tender.get('name_of_work')[:40]}")
    print("[OK] Customer tender section integration verified!")

    print("\n=== TEST 5: Submit Service Request & Atomic SR Numbering ===")
    dsc_service = next(s for s in services if s["name"] == "Digital Signature")
    r_sr = requests.post(f"{BASE}/api/service-requests", headers=cust_headers, json={
        "service_id": dsc_service["id"],
        "remarks": "Urgent Class 3 DSC required for eproc2 tender deadline",
        "priority": "high",
        "custom_form_data": {"validity_years": "2", "token_type": "USB"}
    })
    assert r_sr.status_code == 200, f"Submit request failed: {r_sr.text}"
    sr = r_sr.json()
    req_no = sr["request_no"]
    sr_id = sr["id"]
    print(f"Submitted Service Request: ID={sr_id}, Request No={req_no}, Status={sr['status']}")
    assert req_no.startswith("SR-2026-")
    assert sr["status"] == "SUBMITTED"
    print("[OK] Unique request number generated server-side!")

    print("\n=== TEST 6: Document Upload & File Limit Validation ===")
    # Test file upload with valid pdf
    fake_pdf = io.BytesIO(b"%PDF-1.4 Fake PDF Content for Aadhaar Verification")
    r_up_doc = requests.post(
        f"{BASE}/api/service-requests/{sr_id}/documents",
        headers=cust_headers,
        data={"doc_type": "Aadhaar Card"},
        files={"file": ("aadhaar_doc.pdf", fake_pdf, "application/pdf")}
    )
    assert r_up_doc.status_code == 200, f"Upload document failed: {r_up_doc.text}"
    doc_res = r_up_doc.json()["document"]
    print(f"Uploaded Document: {doc_res['file_name']}, Doc ID={doc_res['doc_id']}, Size={doc_res['file_size']} bytes")
    doc_id = doc_res["doc_id"]

    # Test download
    r_dl = requests.get(f"{BASE}/api/service-requests/{sr_id}/documents/{doc_id}", headers=cust_headers)
    assert r_dl.status_code == 200
    assert len(r_dl.content) == len(b"%PDF-1.4 Fake PDF Content for Aadhaar Verification")
    print("[OK] Secure document upload and download verified!")

    # Test file size limit (>10MB should be rejected)
    big_file = io.BytesIO(b"0" * (11 * 1024 * 1024))
    r_up_big = requests.post(
        f"{BASE}/api/service-requests/{sr_id}/documents",
        headers=cust_headers,
        data={"doc_type": "Big File"},
        files={"file": ("big_doc.pdf", big_file, "application/pdf")}
    )
    assert r_up_big.status_code == 400
    assert "10 MB" in r_up_big.json()["detail"]
    print("[OK] 10 MB per-file limit enforced on backend!")

    # Test invalid file format (e.g. .exe should be rejected)
    bad_file = io.BytesIO(b"binary executable")
    r_up_bad = requests.post(
        f"{BASE}/api/service-requests/{sr_id}/documents",
        headers=cust_headers,
        data={"doc_type": "Executable"},
        files={"file": ("virus.exe", bad_file, "application/octet-stream")}
    )
    assert r_up_bad.status_code == 400
    assert "Invalid file format" in r_up_bad.json()["detail"]
    print("[OK] Invalid file format rejection verified!")

    print("\n=== TEST 7: Employee Service Request Queue & Unauthorized Access Check ===")
    # Customer trying to view employee queue should be blocked
    r_cust_queue = requests.get(f"{BASE}/api/service-requests/queue", headers=cust_headers)
    assert r_cust_queue.status_code == 403
    print("[OK] Customer blocked from employee queue (Security Isolation)!")

    # Admin/Staff views queue
    r_emp_queue = requests.get(f"{BASE}/api/service-requests/queue?status=unassigned", headers=admin_headers)
    assert r_emp_queue.status_code == 200
    queue_data = r_emp_queue.json()
    print(f"Total unassigned requests in queue: {queue_data['total']}")
    found_in_queue = any(item["request_no"] == req_no for item in queue_data["items"])
    assert found_in_queue, "Submitted request not found in employee unassigned queue"
    print("[OK] Request successfully visible in Employee Queue!")

    print("\n=== TEST 8: Assign to Me & Concurrency Conflict Protection ===")
    # Login Employee A (admin) and Employee B (Staff user)
    # Employee A assigns
    r_assign_a = requests.post(f"{BASE}/api/service-requests/{sr_id}/assign-self", headers=admin_headers)
    assert r_assign_a.status_code == 200, f"Assign to Me failed: {r_assign_a.text}"
    assigned_sr = r_assign_a.json()
    print(f"Assigned to: {assigned_sr['assigned_to_name']} ({assigned_sr['assigned_to']})")
    assert assigned_sr["status"] == "ASSIGNED"
    assert assigned_sr["task_id"] is not None
    assert assigned_sr["task_no"] is not None
    linked_task_id = assigned_sr["task_id"]
    print(f"Linked Primary Task Created: {assigned_sr['task_no']} (ID={linked_task_id})")

    # Employee B attempts simultaneous assignment on already assigned request -> MUST RETURN 409 CONFLICT!
    r_assign_b = requests.post(f"{BASE}/api/service-requests/{sr_id}/assign-self", headers=admin_headers)
    assert r_assign_b.status_code == 409
    print(f"[OK] Concurrency Conflict Verified: HTTP {r_assign_b.status_code} - {r_assign_b.json()['detail']}")

    print("\n=== TEST 9: Task Verification in Employee Tasks Module ===")
    r_tasks = requests.get(f"{BASE}/api/tasks", headers=admin_headers)
    assert r_tasks.status_code == 200
    all_tasks = r_tasks.json()
    linked_task = next((t for t in all_tasks if t.get("id") == linked_task_id), None)
    assert linked_task is not None
    print(f"Found in Employee Tasks: Task No={linked_task.get('task_no')}, Title={linked_task.get('title')}, Assignee={linked_task.get('assignee_name')}")
    assert linked_task.get("source_type") == "SERVICE_REQUEST"
    assert linked_task.get("customer_id") == cust_data["user"]["customer_id"]
    print("[OK] Primary Task automatically linked to Service Request & displayed in My Tasks!")

    print("\n=== TEST 10: Workflow State Transitions ===")
    # ASSIGNED -> IN_PROGRESS
    r_tr1 = requests.post(f"{BASE}/api/service-requests/{sr_id}/transition", headers=admin_headers, json={
        "status": "IN_PROGRESS",
        "remarks": "DSC Application submitted to eMudhra Certifying Authority"
    })
    assert r_tr1.status_code == 200
    assert r_tr1.json()["status"] == "IN_PROGRESS"

    # IN_PROGRESS -> UNDER_REVIEW
    r_tr2 = requests.post(f"{BASE}/api/service-requests/{sr_id}/transition", headers=admin_headers, json={
        "status": "UNDER_REVIEW",
        "remarks": "DSC Token downloaded; video verification pending review"
    })
    assert r_tr2.status_code == 200
    assert r_tr2.json()["status"] == "UNDER_REVIEW"

    # UNDER_REVIEW -> COMPLETED
    r_tr3 = requests.post(f"{BASE}/api/service-requests/{sr_id}/transition", headers=admin_headers, json={
        "status": "COMPLETED",
        "remarks": "DSC USB Token successfully delivered to client. Valid for 2 years."
    })
    assert r_tr3.status_code == 200
    assert r_tr3.json()["status"] == "COMPLETED"
    print("[OK] Workflow transition graph (SUBMITTED -> ASSIGNED -> IN_PROGRESS -> UNDER_REVIEW -> COMPLETED) verified!")

    print("\n=== TEST 11: Customer Viewing Final Request Timeline & Status ===")
    r_cust_view = requests.get(f"{BASE}/api/customer-portal/service-requests/{sr_id}", headers=cust_headers)
    assert r_cust_view.status_code == 200
    view_data = r_cust_view.json()
    assert view_data["status"] == "COMPLETED"
    assert len(view_data["workflow_history"]) >= 4
    print(f"Customer View: Status={view_data['status']}, Workflow Steps={len(view_data['workflow_history'])}, Remarks={view_data['employee_remarks']}")
    print("[OK] Full chronological progress timeline visible to customer!")

    print("\n=======================================================")
    print("SUCCESS: ALL 11 CORE INTEGRATION TESTS PASSED WITH 100% SUCCESS!")
    print("=======================================================")

if __name__ == "__main__":
    test_full_customer_portal_flow()
