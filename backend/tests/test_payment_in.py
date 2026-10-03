import requests
import json

BASE = "http://127.0.0.1:8000/api"

def run_test():
    print("Logging in as admin...")
    login_resp = requests.post(f"{BASE}/auth/login", json={"email": "admin@triveni.com", "password": "admin123"})
    assert login_resp.status_code == 200, f"Login failed: {login_resp.text}"
    tok = login_resp.json().get("session_token")
    headers = {"Authorization": f"Bearer {tok}"}
    print(f"Logged in successfully, token: {tok[:10]}...")

    # 1. Test next-no
    print("\n--- 1. Testing GET /income/next-no ---")
    r = requests.get(f"{BASE}/income/next-no", headers=headers)
    assert r.status_code == 200, f"Failed next-no: {r.text}"
    next_no = r.json().get("next_no")
    print("Next Payment-In voucher number:", next_no)
    assert next_no.startswith("PAYIN-"), f"Invalid next_no prefix: {next_no}"

    # 2. Pick or create a test customer
    print("\n--- 2. Fetching/Creating Customer ---")
    cr = requests.get(f"{BASE}/customers/search?q=Test", headers=headers)
    cust = None
    if cr.status_code == 200 and len(cr.json()) > 0:
        cust = cr.json()[0]
    else:
        # Create quick customer
        cust_payload = {
            "name": "Ravi Kumar Test",
            "mobile": "9876543210",
            "pan": "ABCDE1234F",
            "gst_no": "10ABCDE1234F1Z5",
            "address": "Patna, Bihar"
        }
        cr_post = requests.post(f"{BASE}/customers/quick", json=cust_payload, headers=headers)
        if cr_post.status_code == 200:
            cust = cr_post.json()
        else:
            custs = requests.get(f"{BASE}/customers", headers=headers).json()
            cust = custs[0]
    print(f"Customer selected: {cust['name']} ({cust.get('id')})")

    # 3. Create test sale invoice with total 5000, paid 2000, balance 3000
    print("\n--- 3. Creating Sale Invoice: Total Rs.5,000.00, Paid Rs.2,000.00, Balance Rs.3,000.00 ---")
    import time
    unique_date = f"2026-10-{(int(time.time()) % 28) + 1:02d}"
    inv_payload = {
        "invoice_type": "sale",
        "payment_type": "credit",
        "payment_mode": "cash",
        "date": unique_date,
        "party_id": cust["id"],
        "party_name": cust["name"],
        "party_mobile": cust.get("mobile", "9876543210"),
        "party_gst": cust.get("gst_no"),
        "items": [
            {
                "name": "Digital Signature Certificate (Class 3)",
                "qty": 2,
                "price": 2500.0,
                "tax_rate": 0,
                "discount": 0,
                "amount": 5000.0
            }
        ],
        "total_amount": 5000.0,
        "paid_amount": 2000.0,
        "notes": "Initial bill Rs.5,000 with advance Rs.2,000 received on 30-09-2026"
    }
    inv_resp = requests.post(f"{BASE}/invoices", json=inv_payload, headers=headers)
    if inv_resp.status_code == 409:
        existing_info = inv_resp.json().get("detail", {}).get("existing", {})
        inv_id = existing_info["id"]
        inv_no = existing_info["invoice_no"]
        # Reset invoice to total 5000, paid 2000, balance 3000
        inv = requests.get(f"{BASE}/invoices/{inv_id}", headers=headers).json()
    else:
        assert inv_resp.status_code == 200, f"Invoice creation failed: {inv_resp.text}"
        inv = inv_resp.json()
        inv_id = inv["id"]
        inv_no = inv["invoice_no"]
    print(f"Target Invoice: {inv_no} (ID: {inv_id})")
    print(f"Total: Rs.{inv['total_amount']}, Paid: Rs.{inv['paid_amount']}, Balance: Rs.{inv['balance']}, Status: {inv['status']}")
    assert float(inv['balance']) == 3000.0, f"Expected balance 3000, got {inv['balance']}"
    assert inv['status'] == 'partial', f"Expected status partial, got {inv['status']}"

    # 4. Create Payment-In linking remaining Rs.3,000 on 01-10-2026
    print("\n--- 4. Creating Payment-In: Linking Rs.3,000.00 on 01-10-2026 ---")
    payin_payload = {
        "voucher_no": next_no,
        "date": "2026-10-01",
        "client_id": cust["id"],
        "client_name": cust["name"],
        "client_mobile": cust.get("mobile"),
        "service_category": "DSC Services",
        "service_name": "DSC Settlement Payment",
        "amount": 3000.0,
        "payment_mode": "bank",
        "remarks": "Balance settlement via NEFT",
        "items": [
            {
                "sl": 1,
                "item": f"Settlement against Sale Voucher {inv_no}",
                "qty": 1,
                "rate": 3000.0,
                "amount": 3000.0
            }
        ],
        "linked_vouchers": [
            {
                "voucher_id": inv_id,
                "voucher_no": inv_no,
                "voucher_date": "2026-09-30",
                "total_amount": 5000.0,
                "previous_paid": 2000.0,
                "outstanding_balance": 3000.0,
                "allocated_amount": 3000.0,
                "payment_mode": "bank",
                "payment_type": "Balance Cleared",
                "remarks": "Final clearance via Payment-In"
            }
        ]
    }
    pay_resp = requests.post(f"{BASE}/income", json=payin_payload, headers=headers)
    assert pay_resp.status_code == 200, f"Payment-In failed: {pay_resp.text}"
    payin = pay_resp.json()
    print(f"Payment-In created: {payin.get('voucher_no') or payin.get('income_no')} for Rs.{payin['amount']}")

    # 5. Verify Invoice is now fully paid
    print("\n--- 5. Verifying Sale Invoice Reconciled State ---")
    chk_resp = requests.get(f"{BASE}/invoices/{inv_id}", headers=headers)
    assert chk_resp.status_code == 200, f"Failed getting invoice: {chk_resp.text}"
    reconciled = chk_resp.json()
    print(f"Updated Invoice {inv_no}:")
    print(f"Total: Rs.{reconciled['total_amount']}, Paid: Rs.{reconciled['paid_amount']}, Balance: Rs.{reconciled['balance']}, Status: {reconciled['status']}")
    assert float(reconciled['paid_amount']) == 5000.0, f"Expected 5000 paid, got {reconciled['paid_amount']}"
    assert float(reconciled['balance']) == 0.0, f"Expected 0 balance, got {reconciled['balance']}"
    assert reconciled['status'] == 'paid', f"Expected status paid, got {reconciled['status']}"

    # 6. Verify Payment History endpoint
    print("\n--- 6. Testing GET /invoices/{iid}/payment-history ---")
    hist_resp = requests.get(f"{BASE}/invoices/{inv_id}/payment-history", headers=headers)
    assert hist_resp.status_code == 200, f"Failed getting payment history: {hist_resp.text}"
    history = hist_resp.json()
    print("History for invoice:", history["invoice_no"])
    print(f"Total Bill: Rs.{history['total_amount']}, Paid: Rs.{history['paid_amount']}, Balance: Rs.{history['balance']}")
    payments = history["payments"]
    print(f"Total Payment Entries: {len(payments)}")
    for idx, p in enumerate(payments, 1):
        print(f"  [{idx}] Date: {p['date']} | Voucher/Ref: {p['payment_no']} | Amount: Rs.{p['amount']} | Mode: {p['payment_mode']} | Balance After: Rs.{p['balance_after']}")
    assert len(payments) >= 2, f"Expected at least 2 payments, got {len(payments)}"
    assert float(payments[0]['amount']) == 2000.0, f"Payment 1 should be 2000, got {payments[0]['amount']}"
    assert float(payments[0]['balance_after']) == 3000.0, f"Payment 1 balance should be 3000, got {payments[0]['balance_after']}"
    assert float(payments[1]['amount']) == 3000.0, f"Payment 2 should be 3000, got {payments[1]['amount']}"
    assert float(payments[1]['balance_after']) == 0.0, f"Payment 2 balance should be 0, got {payments[1]['balance_after']}"

    # 8. Verify Payment-In PDF Generation
    print("\n--- 8. Testing Payment-In PDF Generation GET /income/{iid}/pdf ---")
    payin_pdf_resp = requests.get(f"{BASE}/income/{payin['id']}/pdf", headers=headers)
    assert payin_pdf_resp.status_code == 200, f"Payment-In PDF generation failed: {payin_pdf_resp.status_code}"
    print(f"Payment-In PDF successfully generated, size: {len(payin_pdf_resp.content)} bytes")
    assert len(payin_pdf_resp.content) > 1000, "Payment-In PDF content seems too small"

    print("\n==========================================")
    print("ALL BACKEND PAYMENT-IN, RECONCILIATION & PDF TESTS PASSED!")
    print("==========================================")

if __name__ == "__main__":
    run_test()
