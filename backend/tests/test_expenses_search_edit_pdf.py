import requests
import sys

BASE_URL = "http://127.0.0.1:8000"

def run_tests():
    print("=== Testing Expenses Search, Edit, Update, Save & Print ===")

    # 1. Login
    login_res = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": "admin@triveni.com",
        "password": "admin123"
    })
    assert login_res.status_code == 200, f"Login failed: {login_res.text}"
    token = login_res.json()["session_token"]
    headers = {"Authorization": f"Bearer {token}"}
    print("[PASS] Admin login successful")

    # 2. Get list of expenses
    exp_res = requests.get(f"{BASE_URL}/api/expenses", headers=headers)
    assert exp_res.status_code == 200, f"Failed to get expenses: {exp_res.text}"
    expenses = exp_res.json()
    print(f"[PASS] Retrieved {len(expenses)} expenses")

    if not expenses:
        # Create a sample expense to test on
        create_res = requests.post(f"{BASE_URL}/api/expenses", json={
            "category": "Office Rent",
            "amount": 25000.0,
            "date": "2026-10-02",
            "payment_mode": "bank",
            "vendor": "Patna Complex Owner",
            "description": "Monthly rent for Patna office",
            "customer_name": "Bihar Rural Infrastructure",
            "customer_mobile": "9876543210",
            "customer_pan": "ABCDE1234F",
            "customer_gst": "10ABCDE1234F1Z5"
        }, headers=headers)
        assert create_res.status_code == 200, f"Failed to create expense: {create_res.text}"
        sample = create_res.json()
        print(f"[PASS] Created sample expense: {sample['expense_no']}")
    else:
        sample = expenses[0]
        # Make sure sample has customer details for testing search
        update_res = requests.patch(f"{BASE_URL}/api/expenses/{sample['id']}", json={
            "customer_name": "ABC Infra Ltd",
            "customer_mobile": "9876501234",
            "customer_pan": "ABCDE1234F",
            "customer_gst": "10ABCDE1234F1Z5"
        }, headers=headers)
        assert update_res.status_code == 200, f"Failed to enrich sample: {update_res.text}"
        sample = update_res.json()
        print(f"[PASS] Using sample expense: {sample['expense_no']} (ID: {sample['id']})")

    # 3. Test Search Backend Filter by EXP NO
    exp_no = sample["expense_no"]
    search_exp_res = requests.get(f"{BASE_URL}/api/expenses?search={exp_no}", headers=headers)
    assert search_exp_res.status_code == 200, f"Search by EXP NO failed: {search_exp_res.text}"
    found = search_exp_res.json()
    assert any(e["id"] == sample["id"] for e in found), f"Expense {exp_no} not found in search results: {found}"
    print(f"[PASS] Search by EXP NO '{exp_no}' returned {len(found)} results")

    # 4. Test Search by PAN
    search_pan_res = requests.get(f"{BASE_URL}/api/expenses?search=ABCDE1234F", headers=headers)
    assert search_pan_res.status_code == 200, f"Search by PAN failed: {search_pan_res.text}"
    found_pan = search_pan_res.json()
    assert any(e["id"] == sample["id"] for e in found_pan), f"Expense not found when searching by PAN"
    print(f"[PASS] Search by PAN 'ABCDE1234F' returned {len(found_pan)} results")

    # 5. Test Search by Mobile No
    search_mob_res = requests.get(f"{BASE_URL}/api/expenses?search=98765", headers=headers)
    assert search_mob_res.status_code == 200, f"Search by Mobile failed: {search_mob_res.text}"
    found_mob = search_mob_res.json()
    assert any(e["id"] == sample["id"] for e in found_mob), f"Expense not found when searching by mobile"
    print(f"[PASS] Search by Mobile '98765' returned {len(found_mob)} results")

    # 6. Test Search by GST No
    search_gst_res = requests.get(f"{BASE_URL}/api/expenses?search=10ABCDE", headers=headers)
    assert search_gst_res.status_code == 200, f"Search by GST failed: {search_gst_res.text}"
    found_gst = search_gst_res.json()
    assert any(e["id"] == sample["id"] for e in found_gst), f"Expense not found when searching by GST"
    print(f"[PASS] Search by GST '10ABCDE' returned {len(found_gst)} results")

    # 7. Test PATCH /api/expenses/{eid} (Edit / Update / Save)
    new_desc = "Updated office electricity & maintenance bill"
    patch_res = requests.patch(f"{BASE_URL}/api/expenses/{sample['id']}", json={
        "description": new_desc,
        "vendor": "Patna Power & Electric Services",
        "amount": 8750.0
    }, headers=headers)
    assert patch_res.status_code == 200, f"PATCH failed: {patch_res.text}"
    updated = patch_res.json()
    assert updated["description"] == new_desc, "Description was not updated"
    assert updated["vendor"] == "Patna Power & Electric Services", "Vendor was not updated"
    assert updated["amount"] == 8750.0, "Amount was not updated"
    print(f"[PASS] PATCH /api/expenses/{sample['id']} successfully updated description, vendor, and amount")

    # 8. Test GET /api/expenses/{eid}/pdf (Print)
    pdf_res = requests.get(f"{BASE_URL}/api/expenses/{sample['id']}/pdf?token={token}")
    assert pdf_res.status_code == 200, f"PDF failed: {pdf_res.status_code}, {pdf_res.text}"
    assert pdf_res.headers.get("content-type") == "application/pdf", f"Wrong Content-Type: {pdf_res.headers.get('content-type')}"
    assert pdf_res.content.startswith(b"%PDF"), "Response is not a valid PDF file"
    print(f"[PASS] GET /api/expenses/{sample['id']}/pdf returned valid PDF ({len(pdf_res.content)} bytes)")

    print("\nALL EXPENSES TESTS PASSED SUCCESSFULLY!")

if __name__ == "__main__":
    run_tests()
