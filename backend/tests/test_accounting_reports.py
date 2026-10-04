import pytest
import requests

BASE_URL = "http://127.0.0.1:8000/api"

@pytest.fixture(scope="session")
def admin_token():
    res = requests.post(f"{BASE_URL}/auth/login", json={"email": "admin@triveni.com", "password": "admin123"}, timeout=10)
    assert res.status_code == 200, res.text
    return res.json()["session_token"]

def test_report_catalog(admin_token):
    headers = {"Authorization": f"Bearer {admin_token}"}
    r = requests.get(f"{BASE_URL}/accounting/reports/catalog", headers=headers, timeout=10)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "categories" in data
    assert len(data["categories"]) >= 9
    assert data["total_reports"] >= 35

def test_report_summary(admin_token):
    headers = {"Authorization": f"Bearer {admin_token}"}
    r = requests.get(f"{BASE_URL}/accounting/reports/summary", headers=headers, timeout=10)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "total_sales" in data
    assert "gross_profit" in data
    assert "total_bank_balance" in data

ALL_TEST_REPORTS = [
    # 1. Core Financial
    "sale_report", "purchase_report", "day_book", "all_transactions", "bill_profit",
    "pnl", "sale_aging", "purchase_aging", "cashflow", "balance_sheet",
    # 2. Party Reports
    "party_statement", "party_pnl", "all_parties", "party_items", "sale_purchase_party", "party_groups",
    # 3. GST Reports
    "gstr1", "gstr2", "gstr3b", "gst_transactions", "gstr9", "hsn_sac_summary",
    # 4. Item / Stock Reports
    "stock_summary", "item_report_party", "item_pnl", "low_stock", "item_details",
    "sale_purchase_item_cat", "stock_by_category", "item_batch", "item_serial", "item_discount",
    # 5. Business Status
    "bank_statement", "discount_report",
    # 6. Taxes
    "gst_report", "gst_rate_report", "form_27eq", "tcs_receivable", "tds_payable", "tds_receivable",
    # 7. Expense Reports
    "expense_transaction", "expense_category", "expense_item",
    # 8. Order Reports
    "order_transaction", "order_item",
    # 9. Loan Statement
    "loan_statement"
]

@pytest.mark.parametrize("rep_id", ALL_TEST_REPORTS)
def test_each_report_endpoint(admin_token, rep_id):
    headers = {"Authorization": f"Bearer {admin_token}"}
    r = requests.get(f"{BASE_URL}/accounting/reports/data?report_type={rep_id}", headers=headers, timeout=10)
    assert r.status_code == 200, f"Report {rep_id} failed with {r.status_code}: {r.text}"
    data = r.json()
    assert data["report_type"] == rep_id
    assert "report_title" in data
    assert "category" in data
    assert "kpis" in data
    assert isinstance(data["kpis"], list)
    assert "columns" in data
    assert isinstance(data["columns"], list)
    assert "rows" in data
    assert isinstance(data["rows"], list)
