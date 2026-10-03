import requests
import sys

BASE_URL = "http://127.0.0.1:8000"

def run_tests():
    print("=== Testing Payment-In Search, Edit, Update, Save & Print ===")

    # 1. Login
    login_res = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": "admin@triveni.com",
        "password": "admin123"
    })
    assert login_res.status_code == 200, f"Login failed: {login_res.text}"
    token = login_res.json()["session_token"]
    headers = {"Authorization": f"Bearer {token}"}
    print("[PASS] Admin login successful")

    # 2. Get list of payment-in entries
    inc_res = requests.get(f"{BASE_URL}/api/income", headers=headers)
    assert inc_res.status_code == 200, f"Failed to get payment-in: {inc_res.text}"
    incomes = inc_res.json()
    print(f"[PASS] Retrieved {len(incomes)} Payment-In vouchers")

    if not incomes:
        # Create a sample payment-in
        create_res = requests.post(f"{BASE_URL}/api/income", json={
            "date": "2026-10-02",
            "client_name": "Triveni Constructions",
            "client_mobile": "9876543210",
            "client_pan": "ABCDE1234F",
            "client_gst": "10ABCDE1234F1Z5",
            "service_category": "Tender Services",
            "amount": 15000.0,
            "payment_mode": "bank",
            "remarks": "Advance payment for tender consultancy"
        }, headers=headers)
        assert create_res.status_code == 200, f"Failed to create: {create_res.text}"
        sample = create_res.json()
        print(f"[PASS] Created sample Payment-In voucher: {sample.get('voucher_no')}")
    else:
        sample = incomes[0]
        # Enrich sample with PAN & GST for testing search
        update_res = requests.patch(f"{BASE_URL}/api/income/{sample['id']}", json={
            "client_name": "M/S Bihar Construction Pvt Ltd",
            "client_mobile": "9995583355",
            "client_pan": "ABCDE9493F",
            "client_gst": "10ABCDE9493F1Z8"
        }, headers=headers)
        assert update_res.status_code == 200, f"Failed to enrich sample: {update_res.text}"
        sample = update_res.json()
        print(f"[PASS] Using sample Payment-In voucher: {sample.get('voucher_no')} (ID: {sample['id']})")

    v_no = sample.get("voucher_no") or sample.get("income_no")

    # 3. Test Search Backend Filter by Voucher No.
    search_no_res = requests.get(f"{BASE_URL}/api/income?search={v_no}", headers=headers)
    assert search_no_res.status_code == 200, f"Search by voucher no failed: {search_no_res.text}"
    found = search_no_res.json()
    assert any(i["id"] == sample["id"] for i in found), f"Voucher {v_no} not found in search results: {found}"
    print(f"[PASS] Search by Voucher No. '{v_no}' returned {len(found)} results")

    # 4. Test Search by Name
    search_name_res = requests.get(f"{BASE_URL}/api/income?search=Bihar Construction", headers=headers)
    assert search_name_res.status_code == 200, f"Search by Name failed: {search_name_res.text}"
    found_name = search_name_res.json()
    assert any(i["id"] == sample["id"] for i in found_name), f"Payment-in not found by Name"
    print(f"[PASS] Search by Name 'Bihar Construction' returned {len(found_name)} results")

    # 5. Test Search by Mobile No.
    search_mob_res = requests.get(f"{BASE_URL}/api/income?search=999558", headers=headers)
    assert search_mob_res.status_code == 200, f"Search by Mobile failed: {search_mob_res.text}"
    found_mob = search_mob_res.json()
    assert any(i["id"] == sample["id"] for i in found_mob), f"Payment-in not found by Mobile"
    print(f"[PASS] Search by Mobile '999558' returned {len(found_mob)} results")

    # 6. Test Search by PAN No.
    search_pan_res = requests.get(f"{BASE_URL}/api/income?search=ABCDE9493F", headers=headers)
    assert search_pan_res.status_code == 200, f"Search by PAN failed: {search_pan_res.text}"
    found_pan = search_pan_res.json()
    assert any(i["id"] == sample["id"] for i in found_pan), f"Payment-in not found by PAN"
    print(f"[PASS] Search by PAN 'ABCDE9493F' returned {len(found_pan)} results")

    # 7. Test Search by GST No.
    search_gst_res = requests.get(f"{BASE_URL}/api/income?search=10ABCDE9493F", headers=headers)
    assert search_gst_res.status_code == 200, f"Search by GST failed: {search_gst_res.text}"
    found_gst = search_gst_res.json()
    assert any(i["id"] == sample["id"] for i in found_gst), f"Payment-in not found by GST"
    print(f"[PASS] Search by GST '10ABCDE9493F' returned {len(found_gst)} results")

    # 8. Test PATCH /api/income/{iid} (Edit / Update / Save)
    new_remarks = "Full settlement received via RTGS Bank Transfer"
    new_amt = 18500.0
    patch_res = requests.patch(f"{BASE_URL}/api/income/{sample['id']}", json={
        "remarks": new_remarks,
        "amount": new_amt,
        "payment_mode": "bank",
        "service_category": "Tender Services"
    }, headers=headers)
    assert patch_res.status_code == 200, f"PATCH failed: {patch_res.text}"
    updated = patch_res.json()
    assert updated["remarks"] == new_remarks, "Remarks was not updated"
    assert updated["amount"] == new_amt, "Amount was not updated"
    assert updated["payment_mode"] == "bank", "Payment mode was not updated"
    print(f"[PASS] PATCH /api/income/{sample['id']} successfully updated remarks, amount, and payment mode")

    # 9. Test GET /api/income/{iid}/pdf (Print)
    pdf_res = requests.get(f"{BASE_URL}/api/income/{sample['id']}/pdf?token={token}")
    assert pdf_res.status_code == 200, f"PDF failed: {pdf_res.status_code}, {pdf_res.text}"
    assert pdf_res.headers.get("content-type") == "application/pdf", f"Wrong Content-Type: {pdf_res.headers.get('content-type')}"
    assert pdf_res.content.startswith(b"%PDF"), "Response is not a valid PDF file"
    print(f"[PASS] GET /api/income/{sample['id']}/pdf returned valid PDF ({len(pdf_res.content)} bytes)")

    print("\nALL PAYMENT-IN TESTS PASSED SUCCESSFULLY!")

if __name__ == "__main__":
    run_tests()
