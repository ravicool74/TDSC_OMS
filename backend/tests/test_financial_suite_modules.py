import pytest
import asyncio
from datetime import datetime, timezone
from httpx import AsyncClient, ASGITransport
import server

@pytest.fixture(scope="session")
def anyio_backend():
    return "asyncio"

@pytest.mark.asyncio
async def test_full_financial_suite_modules():
    transport = ASGITransport(app=server.app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        # 1. Login as Admin
        admin_email = server.os.environ.get("SEED_ADMIN_EMAIL", "admin@triveni.com")
        admin_pass = server.os.environ.get("SEED_ADMIN_PASSWORD", "admin123")
        login_res = await client.post("/api/auth/login", json={"email": admin_email, "password": admin_pass})
        if login_res.status_code != 200:
            signup_res = await client.post("/api/auth/signup", json={
                "email": admin_email, "name": "Admin Tester", "password": admin_pass, "role": "admin"
            })
            token = signup_res.json()["session_token"]
        else:
            token = login_res.json()["session_token"]
        admin_headers = {"Authorization": f"Bearer {token}"}

        emp_email = "accountant_test@triveni.com"
        emp_pass = "TestPass@123"
        emp_user = await server.db.users.find_one({"email": emp_email})
        if not emp_user:
            await server.db.users.insert_one({
                "id": "usr-test-accountant-001",
                "user_id": "EMP-TEST01",
                "name": "Test Accountant",
                "email": emp_email,
                "role": "employee",
                "password_hash": server.hash_password(emp_pass),
                "created_at": datetime.now(timezone.utc).isoformat()
            })
        emp_login = await client.post("/api/auth/login", json={"email": emp_email, "password": emp_pass})
        assert emp_login.status_code == 200, f"Employee login failed: {emp_login.text}"
        emp_token = emp_login.json()["session_token"]
        emp_headers = {"Authorization": f"Bearer {emp_token}"}

        # =========================================================================
        # MODULE 1: CASH & BANK – EDIT & DELETE BUTTONS & FINANCIAL SAFETY
        # =========================================================================
        # A. Cheques: Seed/Insert, Edit, Delete
        chq_id = f"chq_test_{int(datetime.now().timestamp())}"
        await server.db.cheques.insert_one({
            "id": chq_id,
            "cheque_no": "CHQ-998877",
            "customer_name": "Test Contractor Cheque",
            "amount": 25000.0,
            "bank_name": "State Bank of India",
            "cheque_date": "2026-11-15",
            "status": "open",
            "created_at": datetime.now(timezone.utc).isoformat()
        })

        # Edit Cheque
        edit_chq_res = await client.patch(f"/api/accounting/cash-bank/cheques/{chq_id}", json={
            "customer_name": "Test Contractor Cheque Updated",
            "amount": 28000.0,
        }, headers=admin_headers)
        assert edit_chq_res.status_code == 200
        assert edit_chq_res.json()["amount"] == 28000.0
        assert edit_chq_res.json()["customer_name"] == "Test Contractor Cheque Updated"

        # Delete Cheque
        del_chq_res = await client.delete(f"/api/accounting/cash-bank/cheques/{chq_id}", headers=admin_headers)
        assert del_chq_res.status_code == 200
        assert del_chq_res.json().get("deleted") == 1

        # B. Loan Accounts: Create, Edit, Delete
        loan_payload = {
            "account_name": "Business Working Capital Loan",
            "account_number": "LOAN-HDFC-5544",
            "lender_bank": "HDFC Bank",
            "opening_balance": 500000.0,
            "current_balance": 500000.0,
            "interest_rate": 9.5,
            "duration_months": 24,
            "loan_received_in": "cash",
        }
        res_loan = await client.post("/api/accounting/cash-bank/loans", json=loan_payload, headers=admin_headers)
        assert res_loan.status_code == 200, res_loan.text
        loan_id = res_loan.json()["id"]

        # Edit Loan
        edit_loan_res = await client.patch(f"/api/accounting/cash-bank/loans/{loan_id}", json={
            "account_name": "Working Capital Loan Updated",
            "current_balance": 480000.0,
        }, headers=admin_headers)
        assert edit_loan_res.status_code == 200
        assert edit_loan_res.json()["current_balance"] == 480000.0

        # Delete Loan
        del_loan_res = await client.delete(f"/api/accounting/cash-bank/loans/{loan_id}", headers=admin_headers)
        assert del_loan_res.status_code == 200
        assert del_loan_res.json().get("deleted") == 1

        # C. Contra Transactions: Financial Balance Safety & Reversal
        # Create bank account first
        bank_res = await client.post("/api/bank-accounts", json={
            "name": "Test ICICI Operations",
            "bank_name": "ICICI Bank",
            "account_no": f"ICICI-{int(datetime.now().timestamp())}",
            "ifsc": "ICIC0000123",
            "opening_balance": 100000.0,
        }, headers=admin_headers)
        assert bank_res.status_code == 200
        bank_id = bank_res.json()["id"]

        # Transfer 15,000 from Bank to Cash (Withdrawal)
        contra_res = await client.post("/api/accounting/cash-bank/transfer", json={
            "transfer_type": "bank_to_cash",
            "direction": "deposit",
            "withdraw_from": bank_id,
            "amount": 15000.0,
            "description": "Cash withdrawal for office operations",
            "transfer_date": "2026-10-15",
        }, headers=admin_headers)
        assert contra_res.status_code == 200
        contra_id = contra_res.json()["id"]

        # Bank balance should now be 100000 - 15000 = 85000
        bank_check = await client.get("/api/accounting/cash-bank/banks", headers=admin_headers)
        target_bank = next(b for b in bank_check.json() if b["id"] == bank_id)
        assert target_bank["opening_balance"] == 85000.0

        # Delete Contra Transaction -> Bank balance must reverse back to 100000.0!
        del_contra_res = await client.delete(f"/api/accounting/cash-bank/contra/{contra_id}", headers=admin_headers)
        assert del_contra_res.status_code == 200
        bank_check_after = await client.get("/api/accounting/cash-bank/banks", headers=admin_headers)
        target_bank_after = next(b for b in bank_check_after.json() if b["id"] == bank_id)
        assert target_bank_after["opening_balance"] == 100000.0, "Bank balance was not safely reversed upon contra deletion!"

        # =========================================================================
        # MODULE 2: EXPENSES – ADD DELETE BUTTON & PROTECTION
        # =========================================================================
        # Create an unapproved expense
        res_exp = await client.post("/api/expenses", json={
            "date": "2026-10-15",
            "category": "Office Supplies",
            "amount": 1200.0,
            "payment_mode": "cash",
            "notes": "Printing paper and pens",
            "status": "pending",
        }, headers=admin_headers)
        assert res_exp.status_code == 200
        exp_id = res_exp.json()["id"]

        # Delete unapproved expense -> Should succeed
        del_exp_res = await client.delete(f"/api/expenses/{exp_id}", headers=admin_headers)
        assert del_exp_res.status_code == 200
        assert del_exp_res.json().get("deleted") == 1 or del_exp_res.json().get("ok") is True

        # Create an approved expense
        res_exp_approved = await client.post("/api/expenses", json={
            "date": "2026-10-15",
            "category": "Travel",
            "amount": 3500.0,
            "payment_mode": "bank_transfer",
            "status": "approved",
        }, headers=admin_headers)
        assert res_exp_approved.status_code == 200
        approved_exp_id = res_exp_approved.json()["id"]

        # Attempt to delete approved expense -> Must be protected and rejected!
        del_protected_res = await client.delete(f"/api/expenses/{approved_exp_id}", headers=admin_headers)
        assert del_protected_res.status_code == 400
        assert "approved or verified expense" in del_protected_res.json()["detail"]

        # =========================================================================
        # MODULE 3: BASIC DETAILS – MANDATORY BRANCH AND DISTRICT
        # =========================================================================
        # District master check
        dist_res = await client.get("/api/districts", headers=admin_headers)
        assert dist_res.status_code == 200
        districts = dist_res.json()
        assert len(districts) >= 38
        assert any(d["name"] == "Patna" for d in districts)
        assert any(d["name"] == "Muzaffarpur" for d in districts)

        # Attempt to create customer without branch_name or district -> Must fail validation
        invalid_cust_res = await client.post("/api/customers", json={
            "name": "Invalid Contractor Missing Fields",
            "mobile": "9876543210",
            "whatsapp": "9876543210",
            "pan": "ABCDE1234F",
            "aadhar": "123456789012",
        }, headers=admin_headers)
        assert invalid_cust_res.status_code in (400, 422)

        # Create valid customer with branch_name and district
        rand_suffix = f"{int(datetime.now().timestamp())}"[-6:]
        valid_cust_payload = {
            "name": f"Sharma Constructions {rand_suffix}",
            "mobile": f"98{rand_suffix}01",
            "whatsapp": f"98{rand_suffix}01",
            "pan": f"ABCDE{rand_suffix[:4]}G",
            "aadhar": f"9876{rand_suffix[:6]}",
            "branch_name": "Patna Head Office",
            "district": "Patna",
            "departments": "RWD, RCD",
            "registration_class": "Class-I",
        }
        create_cust_res = await client.post("/api/customers", json=valid_cust_payload, headers=admin_headers)
        assert create_cust_res.status_code == 200, create_cust_res.text
        contractor = create_cust_res.json()
        contractor_id = contractor["id"]
        assert contractor["branch_name"] == "Patna Head Office"
        assert contractor["district"] == "Patna"

        # Search / list customers by branch & district
        filtered_custs = await client.get("/api/customers?branch=Patna Head Office&district=Patna", headers=admin_headers)
        assert filtered_custs.status_code == 200
        assert any(c["id"] == contractor_id for c in filtered_custs.json())

        # =========================================================================
        # MODULE 4: CONTRACTORS DIRECTORY – MULTI-SELECT & PDF EXPORT
        # =========================================================================
        pdf_export_res = await client.post("/api/customers/export-pdf", json={
            "customer_ids": [contractor_id]
        }, headers=admin_headers)
        assert pdf_export_res.status_code == 200
        assert pdf_export_res.headers["content-type"] == "application/pdf"
        assert len(pdf_export_res.content) > 1000
        assert pdf_export_res.content.startswith(b"%PDF")

        # =========================================================================
        # MODULES 5-11: EXPENSE APPROVAL MODULE & PASS-ON FINANCIAL RULE
        # =========================================================================
        # A. Workflow Config
        cfg_res = await client.get("/api/expense-approvals/config", headers=admin_headers)
        assert cfg_res.status_code == 200
        assert "enabled_stages" in cfg_res.json()

        # Update config: restrict self-approval
        upd_cfg_res = await client.put("/api/expense-approvals/config", json={
            "enabled_stages": ["submitted", "verified", "approved"],
            "allow_verification_stage": True,
            "approver_roles": ["admin", "super_admin", "manager"],
            "allow_self_approval": False,
        }, headers=admin_headers)
        assert upd_cfg_res.status_code == 200
        assert upd_cfg_res.json()["allow_self_approval"] is False

        # B. Create a sale invoice for this contractor with received amount
        inv_payload = {
            "invoice_type": "sale",
            "invoice_no": f"INV-TEST-{int(datetime.now().timestamp())}",
            "date": "2026-10-15",
            "party_id": contractor_id,
            "party_name": contractor["name"],
            "items": [
                {"name": "Tender Documentation Service", "qty": 1, "price": 50000.0, "amount": 50000.0}
            ],
            "total_amount": 50000.0,
            "paid_amount": 20000.0, # Received 20,000 against 50,000 total
        }
        res_inv = await client.post("/api/invoices", json=inv_payload, headers=admin_headers)
        assert res_inv.status_code == 200, res_inv.text
        sale_inv = res_inv.json()

        # Query customer sale vouchers endpoint
        sv_list_res = await client.get(f"/api/expense-approvals/sale-vouchers?customer_id={contractor_id}", headers=admin_headers)
        assert sv_list_res.status_code == 200
        vouchers_found = sv_list_res.json()
        assert len(vouchers_found) >= 1
        matched_sv = next(s for s in vouchers_found if s["sale_voucher_id"] == sale_inv["id"])
        assert matched_sv["received_amount"] == 20000.0
        assert matched_sv["available_expense_limit"] == 20000.0

        # C. Critical Pass-On Validation: Attempt to submit claim of 25,000 (> 20,000 received)
        # MUST FAIL with EXACT detail "Expense cannot be greater than received amount"!
        excess_claim_payload = {
            "customer_id": contractor_id,
            "customer_name": contractor["name"],
            "customer_code": contractor.get("customer_code", ""),
            "customer_mobile": contractor["mobile"],
            "customer_pan": contractor["pan"],
            "sale_voucher_id": sale_inv["id"],
            "sale_voucher_no": sale_inv["invoice_no"],
            "sale_voucher_type": "invoice",
            "sale_voucher_amount": 50000.0,
            "sale_received_amount": 20000.0,
            "sale_unpaid_amount": 30000.0,
            "expenses": [
                {"head": "Tender Fee", "description": "Government tender portal fee", "qty": 1, "rate": 15000.0, "amount": 15000.0},
                {"head": "EMD / Security Deposit", "description": "EMD bank guarantee charge", "qty": 1, "rate": 10000.0, "amount": 10000.0},
            ], # Total = 25,000 > 20,000
            "notes": "Excessive claim testing",
        }
        excess_res = await client.post("/api/expense-approvals", json=excess_claim_payload, headers=emp_headers)
        assert excess_res.status_code == 400
        assert excess_res.json()["detail"] == "Expense cannot be greater than received amount", \
            f"Expected exact message 'Expense cannot be greater than received amount' but got {excess_res.json()}"

        # D. Valid Pass-On Claim: Submit claim of 12,500 (<= 20,000 received) as employee
        valid_claim_payload = {
            "customer_id": contractor_id,
            "customer_name": contractor["name"],
            "customer_code": contractor.get("customer_code", ""),
            "customer_mobile": contractor["mobile"],
            "customer_pan": contractor["pan"],
            "sale_voucher_id": sale_inv["id"],
            "sale_voucher_no": sale_inv["invoice_no"],
            "sale_voucher_type": "invoice",
            "sale_voucher_amount": 50000.0,
            "sale_received_amount": 20000.0,
            "sale_unpaid_amount": 30000.0,
            "expenses": [
                {"head": "Tender Fee", "description": "Tender doc fee", "qty": 1, "rate": 5000.0, "amount": 5000.0},
                {"head": "Notary / Affidavit", "description": "Affidavit stamp charges", "qty": 5, "rate": 500.0, "amount": 2500.0},
                {"head": "Travel & Fuel", "description": "Site visit travel", "qty": 1, "rate": 5000.0, "amount": 5000.0},
            ], # Total = 12,500
            "notes": "Valid pass-on claim under received amount",
            "status": "submitted",
        }
        submit_res = await client.post("/api/expense-approvals", json=valid_claim_payload, headers=emp_headers)
        assert submit_res.status_code == 200, submit_res.text
        claim_voucher = submit_res.json()
        claim_id = claim_voucher["id"]
        assert claim_voucher["total_expense_amount"] == 12500.0
        assert claim_voucher["status"] == "submitted"
        assert claim_voucher["voucher_no"].startswith("EXP-APP-")

        # E. Cumulative Pass-On Check: Second claim of 10,000 on same sale voucher
        # (12,500 prior + 10,000 new = 22,500 > 20,000 received -> MUST FAIL!)
        second_claim_payload = {
            "customer_id": contractor_id,
            "customer_name": contractor["name"],
            "sale_voucher_id": sale_inv["id"],
            "sale_voucher_no": sale_inv["invoice_no"],
            "sale_voucher_amount": 50000.0,
            "sale_received_amount": 20000.0,
            "expenses": [
                {"head": "Processing Charge", "description": "Second claim", "qty": 1, "rate": 10000.0, "amount": 10000.0}
            ],
        }
        second_res = await client.post("/api/expense-approvals", json=second_claim_payload, headers=emp_headers)
        assert second_res.status_code == 400
        assert second_res.json()["detail"] == "Expense cannot be greater than received amount"

        # F. Approver Actions & Self-Approval Prevention
        # 1. Employee who created it tries to self-approve -> Must be rejected (403)
        self_appr_res = await client.post(f"/api/expense-approvals/{claim_id}/action", json={
            "action": "approve", "remarks": "Self approval attempt"
        }, headers=emp_headers)
        assert self_appr_res.status_code in (403, 400)

        # 2. Admin verifies the voucher
        verify_res = await client.post(f"/api/expense-approvals/{claim_id}/action", json={
            "action": "verify", "remarks": "Documents and receipts verified by accounts team"
        }, headers=admin_headers)
        assert verify_res.status_code == 200
        assert verify_res.json()["status"] == "verified"

        # 3. Admin approves the voucher
        approve_res = await client.post(f"/api/expense-approvals/{claim_id}/action", json={
            "action": "approve", "remarks": "Approved and posted to accounting ledger"
        }, headers=admin_headers)
        assert approve_res.status_code == 200
        approved_doc = approve_res.json()
        assert approved_doc["status"] == "approved"
        assert approved_doc.get("linked_expense_id") is not None

        # Verify that an expense was posted to db.expenses
        exp_posted = await server.db.expenses.find_one({"id": approved_doc["linked_expense_id"]}, {"_id": 0})
        assert exp_posted is not None
        assert exp_posted["amount"] == 12500.0
        assert exp_posted["status"] == "approved"

        # G. PDF Printable Voucher Generation
        pdf_res = await client.get(f"/api/expense-approvals/{claim_id}/pdf?token={token}")
        assert pdf_res.status_code == 200
        assert pdf_res.headers["content-type"] == "application/pdf"
        assert len(pdf_res.content) > 1000
        assert pdf_res.content.startswith(b"%PDF")
