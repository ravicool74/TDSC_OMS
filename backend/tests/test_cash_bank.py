import pytest
import requests
import io

BASE_URL = "http://127.0.0.1:8000/api"

@pytest.fixture(scope="session")
def admin_token():
    res = requests.post(f"{BASE_URL}/auth/login", json={"email": "admin@triveni.com", "password": "admin123"}, timeout=10)
    assert res.status_code == 200, res.text
    return res.json()["session_token"]

def test_bank_accounts_list(admin_token):
    headers = {"Authorization": f"Bearer {admin_token}"}
    r = requests.get(f"{BASE_URL}/accounting/cash-bank/banks", headers=headers, timeout=10)
    assert r.status_code == 200, r.text
    banks = r.json()
    assert isinstance(banks, list)
    assert len(banks) >= 2

def test_bank_to_cash_transfer(admin_token):
    headers = {"Authorization": f"Bearer {admin_token}"}
    r_b = requests.get(f"{BASE_URL}/accounting/cash-bank/banks", headers=headers, timeout=10)
    banks = r_b.json()
    bank_id = banks[0]["id"]

    payload = {
        "transfer_type": "bank_to_cash",
        "direction": "deposit",
        "transfer_date": "2026-09-29",
        "deposit_to": "Cash in Hand",
        "withdraw_from": bank_id,
        "amount": 5000.0,
        "description": "Withdraw cash from bank for office expenses"
    }
    r = requests.post(f"{BASE_URL}/accounting/cash-bank/transfer", json=payload, headers=headers, timeout=10)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["transfer_type"] == "bank_to_cash"
    assert data["amount"] == 5000.0

def test_cash_to_bank_transfer(admin_token):
    headers = {"Authorization": f"Bearer {admin_token}"}
    r_b = requests.get(f"{BASE_URL}/accounting/cash-bank/banks", headers=headers, timeout=10)
    banks = r_b.json()
    bank_id = banks[0]["id"]

    payload = {
        "transfer_type": "cash_to_bank",
        "direction": "deposit",
        "transfer_date": "2026-09-29",
        "deposit_to": bank_id,
        "withdraw_from": "Cash in Hand",
        "amount": 3500.0,
        "description": "Deposited excess counter cash into bank"
    }
    r = requests.post(f"{BASE_URL}/accounting/cash-bank/transfer", json=payload, headers=headers, timeout=10)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["transfer_type"] == "cash_to_bank"
    assert data["withdraw_from"] == "Cash in Hand"

def test_bank_to_bank_transfer(admin_token):
    headers = {"Authorization": f"Bearer {admin_token}"}
    r_b = requests.get(f"{BASE_URL}/accounting/cash-bank/banks", headers=headers, timeout=10)
    banks = r_b.json()
    assert len(banks) >= 2
    b1, b2 = banks[0]["id"], banks[1]["id"]

    payload = {
        "transfer_type": "bank_to_bank",
        "transfer_date": "2026-09-29",
        "withdraw_from": b1,
        "deposit_to": b2,
        "amount": 10000.0,
        "description": "Funds transfer between company accounts"
    }
    r = requests.post(f"{BASE_URL}/accounting/cash-bank/transfer", json=payload, headers=headers, timeout=10)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["transfer_type"] == "bank_to_bank"
    assert data["amount"] == 10000.0

def test_adjust_bank_balance(admin_token):
    headers = {"Authorization": f"Bearer {admin_token}"}
    r_b = requests.get(f"{BASE_URL}/accounting/cash-bank/banks", headers=headers, timeout=10)
    banks = r_b.json()
    bank_id = banks[0]["id"]

    payload = {
        "transfer_type": "adjust_balance",
        "adjust_action": "increase",
        "transfer_date": "2026-09-29",
        "account_id": bank_id,
        "amount": 1200.0,
        "description": "Interest earned on current account"
    }
    r = requests.post(f"{BASE_URL}/accounting/cash-bank/transfer", json=payload, headers=headers, timeout=10)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["transfer_type"] == "adjust_balance"
    assert data["adjust_action"] == "increase"

def test_cash_summary(admin_token):
    headers = {"Authorization": f"Bearer {admin_token}"}
    r = requests.get(f"{BASE_URL}/accounting/cash-bank/cash-summary", headers=headers, timeout=10)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "cash_in_hand" in data
    assert "opening_cash" in data

def test_cheques_lifecycle(admin_token):
    headers = {"Authorization": f"Bearer {admin_token}"}
    r_b = requests.get(f"{BASE_URL}/accounting/cash-bank/banks", headers=headers, timeout=10)
    banks = r_b.json()
    bank_id = banks[0]["id"]

    # List all cheques
    r = requests.get(f"{BASE_URL}/accounting/cash-bank/cheques?status=all", headers=headers, timeout=10)
    assert r.status_code == 200, r.text
    res = r.json()
    assert "cheques" in res
    assert res["total_count"] >= 1

    # Check open cheques or deposit an open cheque if one exists
    open_cheques = [c for c in res["cheques"] if c.get("status") == "open"]
    if open_cheques:
        chq = open_cheques[0]
        dep_payload = {
            "transfer_date": "2026-09-29",
            "deposit_to": bank_id,
            "description": "Cheque deposited in clearing"
        }
        r_dep = requests.post(f"{BASE_URL}/accounting/cash-bank/cheques/{chq['id']}/deposit", json=dep_payload, headers=headers, timeout=10)
        assert r_dep.status_code == 200, r_dep.text
        updated = r_dep.json()
        assert updated["status"] == "closed"
        assert updated["deposit_to"] == bank_id

def test_loan_accounts_and_creation(admin_token):
    headers = {"Authorization": f"Bearer {admin_token}"}
    # List loans
    r = requests.get(f"{BASE_URL}/accounting/cash-bank/loans", headers=headers, timeout=10)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "loans" in data
    assert "total_sanctioned" in data

    r_b = requests.get(f"{BASE_URL}/accounting/cash-bank/banks", headers=headers, timeout=10)
    banks = r_b.json()
    bank_id = banks[0]["id"]

    # Create new loan account with 10 fields
    new_loan = {
        "account_name": "Canara Bank Machinery Hypothecation Loan",
        "account_number": "LOAN-CAN-8877",
        "lender_bank": "Canara Bank",
        "description": "Loan for buying digital certification hardware tokens & testing kits",
        "opening_balance": 250000.0,
        "balance_as_of": "2026-09-29",
        "loan_received_in": bank_id,
        "interest_rate": 8.90,
        "duration_months": 24,
        "processing_fee": 2500.0
    }
    r_create = requests.post(f"{BASE_URL}/accounting/cash-bank/loans", json=new_loan, headers=headers, timeout=10)
    assert r_create.status_code == 200, r_create.text
    created = r_create.json()
    assert created["account_name"] == new_loan["account_name"]
    assert created["duration_months"] == 24
    assert created["emi_amount"] > 0

def test_attachment_upload(admin_token):
    headers = {"Authorization": f"Bearer {admin_token}"}
    fake_img = io.BytesIO(b"fake image data for bank deposit slip")
    files = {"file": ("deposit_slip.jpg", fake_img, "image/jpeg")}
    r = requests.post(f"{BASE_URL}/accounting/cash-bank/upload-attachment", files=files, headers=headers, timeout=10)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "attachment_url" in data
    assert "attachment_id" in data
