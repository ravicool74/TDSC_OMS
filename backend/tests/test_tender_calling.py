import pytest
import requests
import uuid

BASE_URL = "http://127.0.0.1:8000/api"

@pytest.fixture(scope="session")
def admin_token():
    res = requests.post(f"{BASE_URL}/auth/login", json={"email": "admin@triveni.com", "password": "admin123"}, timeout=10)
    assert res.status_code == 200, res.text
    return res.json()["session_token"]

@pytest.fixture(scope="session")
def employee_token():
    res = requests.post(f"{BASE_URL}/auth/login", json={"email": "employee@triveni.com", "password": "employee123"}, timeout=10)
    assert res.status_code == 200, res.text
    return res.json()["session_token"]

def test_tender_calling_flow(admin_token, employee_token):
    admin_headers = {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}
    emp_headers = {"Authorization": f"Bearer {employee_token}", "Content-Type": "application/json"}

    # 1. List calls - calling_day section
    r = requests.get(f"{BASE_URL}/tender-mgmt/calls?section=calling_day", headers=admin_headers, timeout=10)
    assert r.status_code == 200, r.text
    calls = r.json()
    assert isinstance(calls, list)
    assert len(calls) >= 1

    # 2. Create a new call with "Highly Interested"
    new_call_payload = {
        "agency_name": "Test Agency Apex Infotech",
        "mobile": "9876543210",
        "talking_about_works": "Bihar PWD Highway Construction Tender",
        "remarks": "Very keen to bid. Need BOQ calculation.",
        "interest_status": "Highly Interested"
    }
    r = requests.post(f"{BASE_URL}/tender-mgmt/calls", json=new_call_payload, headers=admin_headers, timeout=10)
    assert r.status_code == 200, r.text
    created = r.json()
    cid1 = created["id"]
    assert created["agency_name"] == "Test Agency Apex Infotech"
    assert created["interest_status"] == "Highly Interested"
    assert created["is_followup"] is True
    assert created["followup_date"] is not None

    # 3. Test '+' Row Insertion directly below (insert_after_id)
    below_call_payload = {
        "agency_name": "Inserted Below Construction",
        "mobile": "9123456789",
        "talking_about_works": "RWD Culvert & Bridges",
        "remarks": "Added via + button directly below cid1",
        "interest_status": "Interested",
        "insert_after_id": cid1
    }
    r = requests.post(f"{BASE_URL}/tender-mgmt/calls", json=below_call_payload, headers=admin_headers, timeout=10)
    assert r.status_code == 200, r.text
    created_below = r.json()
    cid2 = created_below["id"]
    assert created_below["sl_no"] == created["sl_no"] + 1

    # 4. Verify Follow-up section contains the "Highly Interested" call
    r = requests.get(f"{BASE_URL}/tender-mgmt/calls?section=followup", headers=admin_headers, timeout=10)
    assert r.status_code == 200
    f_calls = r.json()
    f_ids = [c["id"] for c in f_calls]
    assert cid1 in f_ids

    # 5. Convert lead to "Lead Converted"
    r = requests.patch(f"{BASE_URL}/tender-mgmt/calls/{cid1}", json={"interest_status": "Lead Converted"}, headers=admin_headers, timeout=10)
    assert r.status_code == 200
    updated = r.json()
    assert updated["interest_status"] == "Lead Converted"
    assert updated["is_lead_converted"] is True

    # Verify it now appears in Converted section
    r = requests.get(f"{BASE_URL}/tender-mgmt/calls?section=converted", headers=admin_headers, timeout=10)
    assert r.status_code == 200
    conv_calls = r.json()
    conv_ids = [c["id"] for c in conv_calls]
    assert cid1 in conv_ids

    # 6. Assign work to employee -> Auto Task generated in Task Management System
    assign_payload = {
        "assignee_id": "usr_emp_test",
        "assignee_name": "Test Assignee",
        "deadline": "2026-10-15",
        "instructions": "Prepare technical bid document and EMD submission",
        "estimated_amount": 35000.0
    }
    r = requests.post(f"{BASE_URL}/tender-mgmt/calls/{cid1}/assign-work", json=assign_payload, headers=admin_headers, timeout=10)
    assert r.status_code == 200, r.text
    task_res = r.json()
    assert task_res["ok"] is True
    assert "task_no" in task_res
    assert task_res["task_no"].startswith("TSK-")

    # 7. Create a Bill against work -> Auto Invoice generated in Account & Billing
    bill_payload = {
        "amount": 25000.0,
        "description": "Tender Document Preparation & Bid Filing Charges",
        "tax_rate": 18.0
    }
    r = requests.post(f"{BASE_URL}/tender-mgmt/calls/{cid1}/create-bill", json=bill_payload, headers=admin_headers, timeout=10)
    assert r.status_code == 200, r.text
    bill_res = r.json()
    assert bill_res["ok"] is True
    assert "invoice_no" in bill_res
    assert bill_res["invoice_no"].startswith("INV-")

    # 8. Check Analytics Counter
    r = requests.get(f"{BASE_URL}/tender-mgmt/calls/metrics/analytics", headers=admin_headers, timeout=10)
    assert r.status_code == 200, r.text
    analytics = r.json()
    assert "total_calls_today" in analytics
    assert "total_followups_due_today" in analytics
    assert "total_leads_converted" in analytics
    assert analytics["total_leads_converted"] >= 1
    assert "employee_breakdown" in analytics

    # Clean up test rows
    requests.delete(f"{BASE_URL}/tender-mgmt/calls/{cid1}", headers=admin_headers, timeout=10)
    requests.delete(f"{BASE_URL}/tender-mgmt/calls/{cid2}", headers=admin_headers, timeout=10)
