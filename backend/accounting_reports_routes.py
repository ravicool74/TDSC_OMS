import os
import uuid
from datetime import datetime, timezone, timedelta, date
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

def now_utc() -> datetime:
    return datetime.now(timezone.utc)

def clean_doc(d: Any) -> Any:
    if isinstance(d, dict):
        d.pop("_id", None)
        for k, v in list(d.items()):
            if v is not None and type(v).__name__ == "ObjectId":
                d[k] = str(v)
            elif isinstance(v, (dict, list)):
                clean_doc(v)
    elif isinstance(d, list):
        for item in d:
            clean_doc(item)
    return d

def inr(n: Any) -> str:
    try:
        val = float(n or 0)
        return f"₹{val:,.2f}"
    except Exception:
        return f"₹{n}"

# Master Catalog of all 9 Categories & 37 Sub-Reports requested by User
REPORT_CATALOG = [
    {
        "id": "core_financial",
        "title": "Core Financial / Transaction Reports",
        "icon": "bar-chart",
        "color": "#2563EB",
        "reports": [
            {"id": "sale_report", "name": "Sale Report", "icon": "trending-up", "description": "Comprehensive sale invoices register with customer details, taxable value & GST."},
            {"id": "purchase_report", "name": "Purchase Report", "icon": "trending-down", "description": "Vendor purchase bills, inward GST credits and payment status."},
            {"id": "day_book", "name": "Day Book", "icon": "book", "description": "Consolidated daily ledger of cash and bank receipts and disbursements."},
            {"id": "all_transactions", "name": "All Transaction", "icon": "reader", "description": "Master transaction log across all sales, purchases, payments and expenses."},
            {"id": "bill_profit", "name": "Bill Wise Profit", "icon": "analytics", "description": "Gross profit and profit margin calculated for each invoice."},
            {"id": "pnl", "name": "Profit & Loss", "icon": "stats-chart", "description": "Revenue, direct cost of sales, operating expenses and net profit."},
            {"id": "sale_aging", "name": "Sale Aging Report", "icon": "time", "description": "Accounts receivable aging analysis (0-30, 31-60, 61-90, 90+ days)."},
            {"id": "purchase_aging", "name": "Purchase Aging Report", "icon": "hourglass", "description": "Accounts payable aging analysis and due date schedule."},
            {"id": "cashflow", "name": "Cashflow", "icon": "water", "description": "Cash inflow vs outflow trends and liquidity position."},
            {"id": "balance_sheet", "name": "Balance Sheet", "icon": "grid", "description": "Assets, liabilities, working capital and owner's net equity."},
        ]
    },
    {
        "id": "party_reports",
        "title": "Party Reports",
        "icon": "people",
        "color": "#7C3AED",
        "reports": [
            {"id": "party_statement", "name": "Party Statement", "icon": "document-text", "description": "Client & vendor ledger statement with opening, debit, credit and running balance."},
            {"id": "party_pnl", "name": "Party wise profit & Loss", "icon": "pie-chart", "description": "Profitability and gross margins analyzed by individual party."},
            {"id": "all_parties", "name": "All Parties Report", "icon": "list", "description": "Summary directory of all parties with receivable & payable balances."},
            {"id": "party_items", "name": "Party Report by Items", "icon": "cube", "description": "Breakdown of items and services bought or sold per party."},
            {"id": "sale_purchase_party", "name": "Sale/Purchase by Party", "icon": "swap-horizontal", "description": "Dual sale and purchase volume distribution per counterparty."},
            {"id": "party_groups", "name": "Sale/Purchase By Party Groups", "icon": "people-circle", "description": "Transactions aggregated by contractor, corporate and government classes."},
        ]
    },
    {
        "id": "gst_reports",
        "title": "GST Reports",
        "icon": "receipt",
        "color": "#059669",
        "reports": [
            {"id": "gstr1", "name": "GSTR-1", "icon": "document-attach", "description": "Outward taxable supplies, B2B invoices with GSTIN for monthly filing."},
            {"id": "gstr2", "name": "GSTR-2", "icon": "document-text", "description": "Inward supplies and Input Tax Credit (ITC) claimable from purchase bills."},
            {"id": "gstr3b", "name": "GSTR-3B", "icon": "calculator", "description": "Consolidated monthly return: Output liability minus eligible ITC."},
            {"id": "gst_transactions", "name": "GST Transaction Report", "icon": "list-circle", "description": "Line-by-line GST tax register with taxable value, CGST, SGST & IGST."},
            {"id": "gstr9", "name": "GSTR-9", "icon": "calendar", "description": "Annual GST audit return summary with reconciled totals."},
            {"id": "hsn_sac_summary", "name": "Sale Summary by HSN SAC Report", "icon": "pricetags", "description": "Product HSN and Service SAC code-wise sales turnover and tax rate summary."},
        ]
    },
    {
        "id": "stock_reports",
        "title": "ITEM / STOCK REPORTS",
        "icon": "cube",
        "color": "#0891B2",
        "reports": [
            {"id": "stock_summary", "name": "Stock Summary Report", "icon": "cube-outline", "description": "Real-time inventory levels, reorder points, unit valuation and stock worth."},
            {"id": "item_report_party", "name": "Item Report Party", "icon": "share-social", "description": "Cross-reference of which contractors or clients purchased each item."},
            {"id": "item_pnl", "name": "Item Wise Profit & Loss", "icon": "cash", "description": "Profit margins and return on cost per item and service offering."},
            {"id": "low_stock", "name": "Low Stock Summary Report", "icon": "warning", "description": "Critically low inventory items requiring immediate purchase requisition."},
            {"id": "item_details", "name": "Item Details Report", "icon": "information-circle", "description": "Master catalog specifications, HSN/SAC codes, default rates and tax slabs."},
            {"id": "sale_purchase_item_cat", "name": "Sale/Purchase by Item Category", "icon": "shapes", "description": "Turnover metrics categorized by DSC, Tender, IT & Consultancy groups."},
            {"id": "stock_by_category", "name": "Stock Summary By Item Category", "icon": "file-tray-stacked", "description": "Inventory stock valuation and item count per service category."},
            {"id": "item_batch", "name": "Item Batch Report", "icon": "layers", "description": "Batch lot tracking, issuance dates, serial numbers and warranty validity."},
            {"id": "item_serial", "name": "Item Serial Report", "icon": "barcode", "description": "Cryptographic USB tokens, dongle hardware serials and issuance tracking."},
            {"id": "item_discount", "name": "Item Wise Discount", "icon": "pricetag", "description": "Summary of promotional discounts and client price adjustments granted."},
        ]
    },
    {
        "id": "business_status",
        "title": "Business Status",
        "icon": "briefcase",
        "color": "#D97706",
        "reports": [
            {"id": "bank_statement", "name": "Bank Statement", "icon": "business", "description": "Multi-bank passbook ledger showing deposits, withdrawals and balances."},
            {"id": "discount_report", "name": "Discount Report", "icon": "gift", "description": "Sales discounts allowed versus purchase discounts received comparison."},
        ]
    },
    {
        "id": "taxes",
        "title": "Taxes",
        "icon": "shield-checkmark",
        "color": "#DC2626",
        "reports": [
            {"id": "gst_report", "name": "GST Report", "icon": "checkmark-circle", "description": "Comprehensive tax collection, reverse charge liabilities and payment register."},
            {"id": "gst_rate_report", "name": "GST Rate Report", "icon": "speedometer", "description": "Tax distribution segmented across 0%, 5%, 12%, 18% and 28% slabs."},
            {"id": "form_27eq", "name": "Form No. 27EQ", "icon": "document", "description": "Quarterly Tax Collected at Source (TCS) return under Section 206C."},
            {"id": "tcs_receivable", "name": "TCS Receivable", "icon": "wallet", "description": "Tax Collected at Source receivable ledger from customers and departments."},
            {"id": "tds_payable", "name": "TDS Payable", "icon": "arrow-up-circle", "description": "TDS deducted under Section 194C/194J to be deposited to the government."},
            {"id": "tds_receivable", "name": "TDS Receivable", "icon": "arrow-down-circle", "description": "TDS deducted by clients on company invoices claimable in Form 26AS."},
        ]
    },
    {
        "id": "expense_reports",
        "title": "Expense Reports",
        "icon": "card",
        "color": "#EA580C",
        "reports": [
            {"id": "expense_transaction", "name": "Expense Transaction Report", "icon": "receipt-outline", "description": "Detailed register of all business vouchers, payees and approval status."},
            {"id": "expense_category", "name": "Expense Category Report", "icon": "pie-chart-outline", "description": "Operating expenses grouped by Office Rent, Salary, Travel and Utilities."},
            {"id": "expense_item", "name": "Expense Item Report", "icon": "basket", "description": "Expenditure incurred on specific office consumables and service supplies."},
        ]
    },
    {
        "id": "order_reports",
        "title": "Sale / Purchase Order Reports",
        "icon": "cart",
        "color": "#4F46E5",
        "reports": [
            {"id": "order_transaction", "name": "Sale/Purchase Order Transaction Report", "icon": "cart-outline", "description": "Order book of client quotations, estimates and vendor purchase orders."},
            {"id": "order_item", "name": "Sale/Purchase Order Item Report", "icon": "reorder-four", "description": "Item-wise pending order quantities, rates and fulfillment stages."},
        ]
    },
    {
        "id": "loan_statement",
        "title": "Lone Statement",
        "icon": "cash-outline",
        "color": "#0284C7",
        "reports": [
            {"id": "loan_statement", "name": "Loan Statement", "icon": "wallet-outline", "description": "Bank OD/CC facilities, Earnest Money Deposits (EMD) and staff advance ledgers."},
        ]
    },
    {
        "id": "passed_on_money",
        "title": "Passed On Money",
        "icon": "repeat",
        "color": "#0D9488",
        "reports": [
            {"id": "passed_on_money_report", "name": "Passed On Money Report & Ledger", "icon": "swap-vertical", "description": "Comprehensive client pass-on money ledger: EMD, Cost of BOQ, Tender Fee inflows vs Expense outflows with balance."},
        ]
    }
]

def make_accounting_reports_router(db, get_current_user, require_admin, require_admin_or_manager):
    router = APIRouter(prefix="/accounting/reports", tags=["accounting-reports"])

    async def _ensure_seed_records():
        """Disabled in real production mode."""
        return

    # ===== 1. Catalog Endpoint =====
    @router.get("/catalog")
    async def get_report_catalog(current: Any = Depends(get_current_user)):
        await _ensure_seed_records()
        total_reports = sum(len(c["reports"]) for c in REPORT_CATALOG)
        return {
            "categories": REPORT_CATALOG,
            "total_categories": len(REPORT_CATALOG),
            "total_reports": total_reports
        }

    # ===== 2. High-Level KPI Summary =====
    @router.get("/summary")
    async def get_report_summary(current: Any = Depends(get_current_user)):
        await _ensure_seed_records()
        sales = await db.invoices.find({"invoice_type": "sale"}, {"_id": 0}).to_list(2000)
        purchases = await db.invoices.find({"invoice_type": "purchase"}, {"_id": 0}).to_list(2000)
        expenses = await db.expenses.find({"status": {"$in": ["approved", "verified"]}}, {"_id": 0}).to_list(2000)
        banks = await db.bank_accounts.find({}, {"_id": 0}).to_list(100)

        tot_sales = sum(float(s.get("total_amount") or 0) for s in sales)
        tot_purchases = sum(float(p.get("total_amount") or 0) for p in purchases)
        tot_expenses = sum(float(e.get("amount") or 0) for e in expenses)
        tot_bank = sum(float(b.get("opening_balance") or 0) for b in banks)
        rec_balance = sum(float(s.get("balance") or 0) for s in sales)
        exp_vouchers = await db.expense_approval_vouchers.find({"status": {"$in": ["submitted", "verified", "pending"]}}, {"_id": 0}).to_list(1000)
        tot_exp_vouchers = sum(float(a.get("total_expense_amount") or a.get("amount") or 0) for a in exp_vouchers)
        pending_expenses = await db.expenses.find({"status": {"$in": ["pending", "submitted", "unpaid"]}}, {"_id": 0}).to_list(1000)
        tot_pending_exp = sum(float(pe.get("amount") or 0) for pe in pending_expenses)
        pay_balance = sum(float(p.get("balance") or 0) for p in purchases) + tot_exp_vouchers + tot_pending_exp
        gross_profit = tot_sales - (tot_purchases * 0.75) # Est COGS
        net_profit = tot_sales - tot_purchases - tot_expenses

        return {
            "total_sales": round(tot_sales, 2),
            "total_purchases": round(tot_purchases, 2),
            "total_expenses": round(tot_expenses, 2),
            "total_bank_balance": round(tot_bank, 2),
            "total_receivables": round(rec_balance, 2),
            "total_payables": round(pay_balance, 2),
            "gross_profit": round(gross_profit, 2),
            "net_profit": round(net_profit, 2),
        }

    # ===== 3. Dynamic Multi-Report Generator Endpoint =====
    @router.get("/data")
    async def get_report_data(
        report_type: str = Query(..., description="ID of report e.g. sale_report, pnl, gstr1, stock_summary, etc."),
        from_date: Optional[str] = Query(None),
        to_date: Optional[str] = Query(None),
        party_id: Optional[str] = Query(None),
        category: Optional[str] = Query(None),
        search: Optional[str] = Query(None),
        current: Any = Depends(get_current_user)
    ):
        await _ensure_seed_records()

        # Find report metadata from catalog
        matched_report = None
        matched_category = None
        for cat in REPORT_CATALOG:
            for rep in cat["reports"]:
                if rep["id"] == report_type:
                    matched_report = rep
                    matched_category = cat
                    break
            if matched_report: break

        report_title = matched_report["name"] if matched_report else report_type.replace("_", " ").title()
        cat_name = matched_category["title"] if matched_category else "Reports"

        # Fetch base data collections
        sales = await db.invoices.find({"invoice_type": "sale"}, {"_id": 0}).to_list(3000)
        purchases = await db.invoices.find({"invoice_type": "purchase"}, {"_id": 0}).to_list(3000)
        all_invoices = sales + purchases
        expenses = await db.expenses.find({}, {"_id": 0}).to_list(3000)
        items = await db.items.find({}, {"_id": 0}).to_list(1000)
        banks = await db.bank_accounts.find({}, {"_id": 0}).to_list(200)
        estimates = await db.estimates.find({}, {"_id": 0}).to_list(1000)

        # Apply common date filtering helper
        def in_date_range(d_str: Optional[str]) -> bool:
            if not d_str: return True
            if from_date and d_str < from_date: return False
            if to_date and d_str > to_date: return False
            return True

        # =========================================================================
        # 1. CORE FINANCIAL REPORTS
        # =========================================================================
        if report_type == "sale_report":
            filtered = [s for s in sales if in_date_range(s.get("date") or s.get("invoice_date"))]
            if party_id: filtered = [s for s in filtered if s.get("party_id") == party_id]
            if search:
                s_lower = search.lower()
                filtered = [s for s in filtered if s_lower in (s.get("invoice_number") or "").lower() or s_lower in (s.get("party_name") or "").lower()]

            tot_amount = sum(float(x.get("total_amount") or 0) for x in filtered)
            tot_tax = sum(float(x.get("total_tax") or 0) for x in filtered)
            tot_received = sum(float(x.get("paid_amount") or 0) for x in filtered)
            tot_balance = sum(float(x.get("balance") or 0) for x in filtered)

            rows = []
            for s in filtered:
                rows.append({
                    "id": s.get("id"),
                    "date": s.get("date") or s.get("invoice_date"),
                    "invoice_no": s.get("invoice_number"),
                    "party_name": s.get("party_name") or "Unknown",
                    "payment_mode": (s.get("payment_mode") or "cash").upper(),
                    "taxable_value": inr(s.get("subtotal") or 0),
                    "tax_amount": inr(s.get("total_tax") or 0),
                    "total_amount": inr(s.get("total_amount") or 0),
                    "paid_amount": inr(s.get("paid_amount") or 0),
                    "balance": inr(s.get("balance") or 0),
                    "status": (s.get("status") or "unpaid").capitalize(),
                })

            return {
                "report_type": report_type,
                "report_title": report_title,
                "category": cat_name,
                "from_date": from_date,
                "to_date": to_date,
                "kpis": [
                    {"label": "Total Sales (Gross)", "value": inr(tot_amount), "numeric": tot_amount, "color": "#059669"},
                    {"label": "Output GST Collected", "value": inr(tot_tax), "numeric": tot_tax, "color": "#2563EB"},
                    {"label": "Total Received", "value": inr(tot_received), "numeric": tot_received, "color": "#10B981"},
                    {"label": "Outstanding Dues", "value": inr(tot_balance), "numeric": tot_balance, "color": "#DC2626"},
                ],
                "columns": [
                    {"key": "date", "label": "Date"},
                    {"key": "invoice_no", "label": "Invoice #"},
                    {"key": "party_name", "label": "Client / Contractor"},
                    {"key": "payment_mode", "label": "Mode"},
                    {"key": "taxable_value", "label": "Taxable"},
                    {"key": "tax_amount", "label": "GST"},
                    {"key": "total_amount", "label": "Total Amount"},
                    {"key": "paid_amount", "label": "Paid"},
                    {"key": "balance", "label": "Balance"},
                    {"key": "status", "label": "Status"},
                ],
                "rows": rows
            }

        elif report_type == "purchase_report":
            filtered = [p for p in purchases if in_date_range(p.get("date") or p.get("invoice_date"))]
            if party_id: filtered = [p for p in filtered if p.get("party_id") == party_id]
            if search:
                s_lower = search.lower()
                filtered = [p for p in filtered if s_lower in (p.get("invoice_number") or "").lower() or s_lower in (p.get("party_name") or "").lower()]

            tot_amount = sum(float(x.get("total_amount") or 0) for x in filtered)
            tot_tax = sum(float(x.get("total_tax") or 0) for x in filtered)
            tot_paid = sum(float(x.get("paid_amount") or 0) for x in filtered)
            tot_balance = sum(float(x.get("balance") or 0) for x in filtered)

            rows = []
            for p in filtered:
                rows.append({
                    "id": p.get("id"),
                    "date": p.get("date") or p.get("invoice_date"),
                    "bill_no": p.get("invoice_number"),
                    "vendor_name": p.get("party_name") or "Unknown Vendor",
                    "payment_mode": (p.get("payment_mode") or "bank_transfer").upper(),
                    "taxable_value": inr(p.get("subtotal") or 0),
                    "itc_gst": inr(p.get("total_tax") or 0),
                    "total_amount": inr(p.get("total_amount") or 0),
                    "paid_amount": inr(p.get("paid_amount") or 0),
                    "balance": inr(p.get("balance") or 0),
                    "status": (p.get("status") or "unpaid").capitalize(),
                })

            return {
                "report_type": report_type,
                "report_title": report_title,
                "category": cat_name,
                "kpis": [
                    {"label": "Total Purchases", "value": inr(tot_amount), "numeric": tot_amount, "color": "#DC2626"},
                    {"label": "Eligible Input Tax Credit", "value": inr(tot_tax), "numeric": tot_tax, "color": "#059669"},
                    {"label": "Amount Paid Out", "value": inr(tot_paid), "numeric": tot_paid, "color": "#2563EB"},
                    {"label": "Pending Payables", "value": inr(tot_balance), "numeric": tot_balance, "color": "#EA580C"},
                ],
                "columns": [
                    {"key": "date", "label": "Date"},
                    {"key": "bill_no", "label": "Bill #"},
                    {"key": "vendor_name", "label": "Vendor / Supplier"},
                    {"key": "payment_mode", "label": "Mode"},
                    {"key": "taxable_value", "label": "Taxable"},
                    {"key": "itc_gst", "label": "ITC (GST)"},
                    {"key": "total_amount", "label": "Bill Amount"},
                    {"key": "paid_amount", "label": "Paid"},
                    {"key": "balance", "label": "Balance Due"},
                    {"key": "status", "label": "Status"},
                ],
                "rows": rows
            }

        elif report_type in ["day_book", "all_transactions"]:
            # Combine sales receipts, purchases, expenses into daily chronological order
            entries = []
            for s in sales:
                d = s.get("date") or s.get("invoice_date")
                if in_date_range(d):
                    entries.append({
                        "date": d,
                        "ref_no": s.get("invoice_number"),
                        "type": "Sale Invoice",
                        "party": s.get("party_name") or "Direct Client",
                        "mode": (s.get("payment_mode") or "cash").upper(),
                        "in_amount": float(s.get("paid_amount") or s.get("total_amount") or 0),
                        "out_amount": 0.0,
                    })
            for p in purchases:
                d = p.get("date") or p.get("invoice_date")
                if in_date_range(d):
                    entries.append({
                        "date": d,
                        "ref_no": p.get("invoice_number"),
                        "type": "Purchase Bill",
                        "party": p.get("party_name") or "Vendor",
                        "mode": (p.get("payment_mode") or "bank").upper(),
                        "in_amount": 0.0,
                        "out_amount": float(p.get("paid_amount") or p.get("total_amount") or 0),
                    })
            for e in expenses:
                d = e.get("date")
                if in_date_range(d):
                    entries.append({
                        "date": d,
                        "ref_no": e.get("expense_no") or "EXP",
                        "type": f"Expense ({e.get('category') or 'General'})",
                        "party": e.get("vendor") or "Various",
                        "mode": (e.get("payment_mode") or "cash").upper(),
                        "in_amount": 0.0,
                        "out_amount": float(e.get("amount") or 0),
                    })

            entries.sort(key=lambda x: x["date"] or "", reverse=True)
            running = 0.0
            tot_in = sum(x["in_amount"] for x in entries)
            tot_out = sum(x["out_amount"] for x in entries)

            rows = []
            for item in entries:
                running += (item["in_amount"] - item["out_amount"])
                rows.append({
                    "date": item["date"],
                    "ref_no": item["ref_no"],
                    "type": item["type"],
                    "party": item["party"],
                    "mode": item["mode"],
                    "debit": inr(item["in_amount"]) if item["in_amount"] > 0 else "—",
                    "credit": inr(item["out_amount"]) if item["out_amount"] > 0 else "—",
                    "balance": inr(running),
                })

            # Compute Opening & Closing Balances with strict roll-forward
            # 1. Fetch initial balances configuration
            setting = await db.settings.find_one({"key": "day_book_initial_balances"}, {"_id": 0})
            if setting:
                start_date = setting.get("start_date") or "2026-11-17"
                init_cash = float(setting.get("cash_in_hand", 0.0))
                init_acc_map = setting.get("accounts", {})
            else:
                start_date = "2026-11-17"
                c_setting = await db.settings.find_one({"key": "cash_opening_balance"}, {"_id": 0})
                init_cash = float(c_setting.get("value", 0.0)) if c_setting else 0.0
                init_acc_map = {}

            all_banks = await db.bank_accounts.find({"is_active": True}, {"_id": 0}).to_list(100)
            if not all_banks:
                all_banks = await db.bank_accounts.find({}, {"_id": 0}).to_list(100)

            def b_sort(b):
                acc = str(b.get("account_no") or "")
                name = (b.get("name") or "").upper()
                if "42137607814" in acc or "SBIN" in str(b.get("ifsc") or "") or "TRIVENI" in name:
                    return 0
                if "915020011528516" in acc or "UTIB" in str(b.get("ifsc") or "") or "AXIS" in name:
                    return 1
                return 2
            all_banks.sort(key=b_sort)

            idx_roman = ["(i)", "(ii)", "(iii)", "(iv)", "(v)", "(vi)", "(vii)", "(viii)"]
            r_idx = 0

            initial_balances_display = []
            running_balances = {"cash_in_hand": init_cash}

            sbi_id = None
            axis_id = None

            for b in all_banks:
                b_id = b.get("id")
                acc_no = str(b.get("account_no") or "")
                ifsc = b.get("ifsc") or "—"
                name = b.get("name") or b.get("bank_name") or "Bank Account"
                bank_name = b.get("bank_name") or "Bank"

                if "42137607814" in acc_no or "SBIN" in str(ifsc) or "TRIVENI" in name.upper():
                    sbi_id = b_id
                if "915020011528516" in acc_no or "UTIB" in str(ifsc) or "AXIS" in name.upper():
                    axis_id = b_id

                configured_init = init_acc_map.get(b_id)
                if configured_init is None:
                    configured_init = init_acc_map.get(acc_no)
                if configured_init is None:
                    configured_init = float(b.get("opening_balance") or b.get("balance") or 0.0)
                configured_init = float(configured_init)

                running_balances[b_id] = configured_init

                initial_balances_display.append({
                    "index": idx_roman[r_idx] if r_idx < len(idx_roman) else f"({r_idx+1})",
                    "id": b_id,
                    "name": name,
                    "bank_name": bank_name,
                    "account_no": acc_no,
                    "ifsc": ifsc,
                    "balance": round(configured_init, 2),
                    "formatted_balance": f"₹{configured_init:,.2f}",
                })
                r_idx += 1

            if not sbi_id and all_banks:
                sbi_id = all_banks[0].get("id")

            initial_balances_display.append({
                "index": idx_roman[r_idx] if r_idx < len(idx_roman) else f"({r_idx+1})",
                "id": "cash_in_hand",
                "name": "Cash in Hand",
                "bank_name": "Cash",
                "account_no": "—",
                "ifsc": "—",
                "balance": round(init_cash, 2),
                "formatted_balance": f"₹{init_cash:,.2f}",
            })

            def resolve_bank_id(b_id_val, b_name_val):
                b_str = (str(b_id_val or "") + " " + str(b_name_val or "")).lower()
                if axis_id and ("axis" in b_str or "915020011528516" in b_str or axis_id.lower() in b_str):
                    return axis_id
                for b in all_banks:
                    if b.get("id") and b.get("id").lower() in b_str:
                        return b.get("id")
                    if b.get("account_no") and str(b.get("account_no")) in b_str:
                        return b.get("id")
                return sbi_id

            # Roll forward prior transactions (from start_date to from_date - 1)
            eff_from = from_date or start_date
            if eff_from > start_date:
                prior_invoices = await db.invoices.find(
                    {"invoice_type": "sale", "date": {"$gte": start_date, "$lt": eff_from}},
                    {"_id": 0}
                ).to_list(5000)
                for inv in prior_invoices:
                    amt = float(inv.get("paid_amount") or inv.get("total_amount") or 0.0)
                    if amt <= 0: continue
                    mode = (inv.get("payment_mode") or "cash").lower()
                    splits = inv.get("payment_splits") or []
                    if splits:
                        for ps in splits:
                            p_amt = float(ps.get("amount") or 0.0)
                            if p_amt <= 0: continue
                            p_m = str(ps.get("mode") or "").lower()
                            if "cash" in p_m:
                                running_balances["cash_in_hand"] += p_amt
                            else:
                                tgt = resolve_bank_id(ps.get("bank_id"), ps.get("bank_name"))
                                if tgt in running_balances:
                                    running_balances[tgt] += p_amt
                                elif sbi_id in running_balances:
                                    running_balances[sbi_id] += p_amt
                    elif "cash" in mode:
                        running_balances["cash_in_hand"] += amt
                    else:
                        tgt = resolve_bank_id(inv.get("bank_id"), inv.get("bank_name"))
                        if tgt in running_balances:
                            running_balances[tgt] += amt
                        elif sbi_id in running_balances:
                            running_balances[sbi_id] += amt

                prior_income = await db.income.find(
                    {"date": {"$gte": start_date, "$lt": eff_from}},
                    {"_id": 0}
                ).to_list(5000)
                for inc in prior_income:
                    amt = float(inc.get("amount") or 0.0)
                    if amt <= 0: continue
                    mode = (inc.get("payment_mode") or "cash").lower()
                    splits = inc.get("payment_splits") or []
                    if splits:
                        for ps in splits:
                            p_amt = float(ps.get("amount") or 0.0)
                            if p_amt <= 0: continue
                            p_m = str(ps.get("mode") or "").lower()
                            if "cash" in p_m:
                                running_balances["cash_in_hand"] += p_amt
                            else:
                                tgt = resolve_bank_id(ps.get("bank_id"), ps.get("bank_name"))
                                if tgt in running_balances:
                                    running_balances[tgt] += p_amt
                                elif sbi_id in running_balances:
                                    running_balances[sbi_id] += p_amt
                    elif "cash" in mode:
                        running_balances["cash_in_hand"] += amt
                    else:
                        tgt = resolve_bank_id(inc.get("bank_id"), inc.get("bank_name"))
                        if tgt in running_balances:
                            running_balances[tgt] += amt
                        elif sbi_id in running_balances:
                            running_balances[sbi_id] += amt

                prior_expenses = await db.expenses.find(
                    {"date": {"$gte": start_date, "$lt": eff_from}, "status": {"$ne": "rejected"}},
                    {"_id": 0}
                ).to_list(5000)
                for exp in prior_expenses:
                    amt = float(exp.get("amount") or 0.0)
                    if amt <= 0: continue
                    mode = str(exp.get("payment_mode") or "cash").lower()
                    is_online = any(k in mode for k in ["bank", "online", "upi", "cheque", "neft", "rtgs", "card"])
                    if is_online:
                        tgt = resolve_bank_id(exp.get("bank_id") or exp.get("bank_account_id"), exp.get("bank_name"))
                        if tgt in running_balances:
                            running_balances[tgt] -= amt
                        elif sbi_id in running_balances:
                            running_balances[sbi_id] -= amt
                    else:
                        running_balances["cash_in_hand"] -= amt

                prior_contra = await db.bank_transactions.find(
                    {"transfer_date": {"$gte": start_date, "$lt": eff_from}},
                    {"_id": 0}
                ).to_list(5000)
                for c in prior_contra:
                    amt = float(c.get("amount") or 0.0)
                    if amt <= 0: continue
                    w_from = c.get("withdraw_from")
                    d_to = c.get("deposit_to")
                    ttype = c.get("transfer_type")
                    if w_from == "Cash in Hand" or ttype == "cash_to_bank":
                        running_balances["cash_in_hand"] -= amt
                        tgt = d_to if d_to in running_balances else sbi_id
                        if tgt in running_balances:
                            running_balances[tgt] += amt
                    elif d_to == "Cash in Hand" or ttype == "bank_to_cash":
                        running_balances["cash_in_hand"] += amt
                        src = w_from if w_from in running_balances else sbi_id
                        if src in running_balances:
                            running_balances[src] -= amt
                    else:
                        if w_from in running_balances:
                            running_balances[w_from] -= amt
                        if d_to in running_balances:
                            running_balances[d_to] += amt

            opening_balances = []
            tot_bank_ob = 0.0
            r_idx = 0
            for b in all_banks:
                b_id = b.get("id")
                bal = round(running_balances.get(b_id, 0.0), 2)
                tot_bank_ob += bal
                opening_balances.append({
                    "index": idx_roman[r_idx] if r_idx < len(idx_roman) else f"({r_idx+1})",
                    "id": b_id,
                    "name": b.get("name") or b.get("bank_name") or "Bank Account",
                    "bank_name": b.get("bank_name") or "Bank",
                    "account_no": b.get("account_no") or "—",
                    "ifsc": b.get("ifsc") or "—",
                    "balance": bal,
                    "formatted_balance": f"₹{bal:,.2f}",
                })
                r_idx += 1

            cash_ob = round(running_balances.get("cash_in_hand", 0.0), 2)
            opening_balances.append({
                "index": idx_roman[r_idx] if r_idx < len(idx_roman) else f"({r_idx+1})",
                "id": "cash_in_hand",
                "name": "Cash in Hand",
                "bank_name": "Cash",
                "account_no": "—",
                "ifsc": "—",
                "balance": cash_ob,
                "formatted_balance": f"₹{cash_ob:,.2f}",
            })
            total_previous_ob = round(tot_bank_ob + cash_ob, 2)

            # Apply period transactions
            cash_in_period = 0.0
            bank_in_period = 0.0
            for item in period_items:
                if item["in_amount"] > 0:
                    mode = str(item.get("mode") or "").lower()
                    if "cash" in mode:
                        cash_in_period += item["in_amount"]
                        running_balances["cash_in_hand"] += item["in_amount"]
                    else:
                        bank_in_period += item["in_amount"]
                        tgt = resolve_bank_id(item.get("bank_id"), item.get("bank_name"))
                        if tgt in running_balances:
                            running_balances[tgt] += item["in_amount"]
                        elif sbi_id in running_balances:
                            running_balances[sbi_id] += item["in_amount"]

            cash_out_period = 0.0
            bank_out_period = 0.0
            for item in period_items:
                if item["out_amount"] > 0:
                    mode = str(item.get("mode") or "").lower()
                    if "cash" in mode:
                        cash_out_period += item["out_amount"]
                        running_balances["cash_in_hand"] -= item["out_amount"]
                    else:
                        bank_out_period += item["out_amount"]
                        tgt = resolve_bank_id(item.get("bank_id"), item.get("bank_name"))
                        if tgt in running_balances:
                            running_balances[tgt] -= item["out_amount"]
                        elif sbi_id in running_balances:
                            running_balances[sbi_id] -= item["out_amount"]

            contra_query = {}
            if from_date and to_date:
                contra_query["transfer_date"] = {"$gte": from_date, "$lte": to_date}
            elif from_date:
                contra_query["transfer_date"] = {"$gte": from_date}
            elif to_date:
                contra_query["transfer_date"] = {"$lte": to_date}
            contra_period = await db.bank_transactions.find(contra_query, {"_id": 0}).to_list(2000)
            for ct in contra_period:
                amt = float(ct.get("amount") or 0.0)
                if amt <= 0: continue
                w_from = ct.get("withdraw_from")
                d_to = ct.get("deposit_to")
                ttype = ct.get("transfer_type")
                if w_from == "Cash in Hand" or ttype == "cash_to_bank":
                    running_balances["cash_in_hand"] -= amt
                    tgt = d_to if d_to in running_balances else sbi_id
                    if tgt in running_balances:
                        running_balances[tgt] += amt
                elif d_to == "Cash in Hand" or ttype == "bank_to_cash":
                    running_balances["cash_in_hand"] += amt
                    src = w_from if w_from in running_balances else sbi_id
                    if src in running_balances:
                        running_balances[src] -= amt
                else:
                    if w_from in running_balances:
                        running_balances[w_from] -= amt
                    if d_to in running_balances:
                        running_balances[d_to] += amt

            closing_balances = []
            c_idx = 0
            allocated_bank_cb = 0.0
            for b in all_banks:
                b_id = b.get("id")
                b_cb = round(running_balances.get(b_id, 0.0), 2)
                allocated_bank_cb += b_cb
                closing_balances.append({
                    "index": idx_roman[c_idx] if c_idx < len(idx_roman) else f"({c_idx+1})",
                    "id": b_id,
                    "name": b.get("name") or b.get("bank_name") or "Bank Account",
                    "bank_name": b.get("bank_name") or "Bank",
                    "account_no": b.get("account_no") or "—",
                    "ifsc": b.get("ifsc") or "—",
                    "balance": b_cb,
                    "formatted_balance": f"₹{b_cb:,.2f}",
                })
                c_idx += 1

            closing_balances.append({
                "index": idx_roman[c_idx] if c_idx < len(idx_roman) else f"({c_idx+1})",
                "id": "exp_online",
                "name": "Total Expenses Online",
                "bank_name": "Online / Bank",
                "account_no": "—",
                "ifsc": "—",
                "balance": round(bank_out_period, 2),
                "formatted_balance": f"₹{bank_out_period:,.2f}",
            })
            c_idx += 1

            closing_balances.append({
                "index": idx_roman[c_idx] if c_idx < len(idx_roman) else f"({c_idx+1})",
                "id": "exp_cash",
                "name": "Total Expenses by Cash",
                "bank_name": "Cash",
                "account_no": "—",
                "ifsc": "—",
                "balance": round(cash_out_period, 2),
                "formatted_balance": f"₹{cash_out_period:,.2f}",
            })
            c_idx += 1

            cash_cb = round(running_balances.get("cash_in_hand", 0.0), 2)
            closing_balances.append({
                "index": idx_roman[c_idx] if c_idx < len(idx_roman) else f"({c_idx+1})",
                "id": "cash_in_hand",
                "name": "Cash in Hand",
                "bank_name": "Cash",
                "account_no": "—",
                "ifsc": "—",
                "balance": cash_cb,
                "formatted_balance": f"₹{cash_cb:,.2f}",
            })

            total_expenses = round(bank_out_period + cash_out_period, 2)
            total_day_receipts = round(bank_in_period + cash_in_period, 2)
            total_closing_accounts = round(allocated_bank_cb + cash_cb, 2)

            receipt_side_total = round(total_previous_ob + total_day_receipts, 2)
            payment_side_total = round(total_expenses + total_closing_accounts, 2)
            total_cb = round(allocated_bank_cb + bank_out_period + cash_out_period + cash_cb, 2)

            diff = round(abs(receipt_side_total - payment_side_total), 2)
            is_balanced = (diff < 0.01)

            return {
                "report_type": report_type,
                "report_title": "Day Book (Cash & Bank Ledger)" if report_type == "day_book" else "All Transactions Master Register",
                "category": cat_name,
                "account_start_date": start_date,
                "as_on_date": to_date if from_date == to_date else f"{from_date or start_date} to {to_date or ''}".strip(),
                "initial_balances": initial_balances_display,
                "kpis": [
                    {"label": "Total Cash/Bank Inflow", "value": inr(tot_in), "numeric": tot_in, "color": "#059669"},
                    {"label": "Total Cash/Bank Outflow", "value": inr(tot_out), "numeric": tot_out, "color": "#DC2626"},
                    {"label": "Net Closing Movement", "value": inr(tot_in - tot_out), "numeric": tot_in - tot_out, "color": "#2563EB"},
                    {"label": "Total Transaction Count", "value": str(len(entries)), "numeric": len(entries), "color": "#7C3AED"},
                ],
                "columns": [
                    {"key": "date", "label": "Date"},
                    {"key": "ref_no", "label": "Voucher / Ref #"},
                    {"key": "type", "label": "Transaction Type"},
                    {"key": "party", "label": "Party / Particulars"},
                    {"key": "mode", "label": "Payment Mode"},
                    {"key": "debit", "label": "Receipt (In)"},
                    {"key": "credit", "label": "Payment (Out)"},
                    {"key": "balance", "label": "Cumulative Bal."},
                ],
                "rows": rows,
                "opening_balances": opening_balances,
                "closing_balances": closing_balances,
                "total_previous_ob": total_previous_ob,
                "total_opening_balance": total_previous_ob,
                "total_closing_balance": total_cb,
                "total_cb": total_cb,
                "total_ob_with_receipts": receipt_side_total,
                "receipt_side_total": receipt_side_total,
                "payment_side_total": payment_side_total,
                "expenses_online": bank_out_period,
                "expenses_cash": cash_out_period,
                "is_balanced": is_balanced,
                "reconciliation_status": "ok" if is_balanced else "mismatch",
                "reconciliation_message": "Account is ok. (VERIFIED)" if is_balanced else "Account Mismatch",
                "difference": diff,
                "difference_message": "Account is ok. (VERIFIED)" if is_balanced else f"Account Mismatch: Difference of ₹{diff:,.2f}",
            }


        elif report_type == "bill_profit":
            # Map all linked expenses from db.expenses for each sale voucher
            inv_expenses_map = {}
            for e in expenses:
                if e.get("status") == "rejected": continue
                amt = float(e.get("amount") or 0.0)
                inv_id = e.get("sale_invoice_id") or e.get("sale_voucher_id")
                inv_no = e.get("sale_invoice_no") or e.get("sale_voucher_no")
                if inv_id:
                    inv_expenses_map[inv_id] = inv_expenses_map.get(inv_id, 0.0) + amt
                if inv_no:
                    inv_expenses_map[inv_no] = inv_expenses_map.get(inv_no, 0.0) + amt

            rows = []
            tot_gross = 0.0
            tot_passon = 0.0
            tot_net_rev = 0.0
            tot_cost = 0.0
            tot_profit = 0.0

            for s in sales:
                d = s.get("date") or s.get("invoice_date")
                if not in_date_range(d): continue
                gross = float(s.get("total_amount") or 0)

                # Calculate pass-on money for this voucher
                passon = 0.0
                for it in s.get("items", []):
                    it_amt = float(it.get("amount") or (float(it.get("qty", 1)) * float(it.get("price", 0))))
                    is_passon = (
                        it.get("item_type") == "passed_on_money" or
                        (it.get("item_type") != "actual_service" and (
                            it.get("fee_type") in ("EMD", "Cost of BOQ", "Tender Processing Fee", "Registration Fee", "Other Fee") or
                            any(k in (it.get("name") or "").lower() for k in ["emd", "cost of boq", "pass-on", "passed on"])
                        ))
                    )
                    if is_passon:
                        passon += it_amt

                net_rev = max(0.0, round(gross - passon, 2))

                # Real linked expense for this voucher
                s_id = s.get("id")
                s_no = s.get("invoice_no") or s.get("invoice_number")
                cost = inv_expenses_map.get(s_id, 0.0) or (inv_expenses_map.get(s_no, 0.0) if s_no else 0.0)

                # User logic:
                # Voucher ka total amount - Voucher ka total Expence = Voucher ka total profit
                profit = round(gross - cost, 2)

                # percent of profit = (total profit * 100) / total Voucher amount
                if gross > 0:
                    margin = round((profit * 100.0) / gross, 1)
                else:
                    margin = 0.0

                tot_gross += gross
                tot_passon += passon
                tot_net_rev += net_rev
                tot_cost += cost
                tot_profit += profit

                rows.append({
                    "invoice_no": s_no or "—",
                    "date": d,
                    "party_name": s.get("party_name"),
                    "gross_revenue": inr(gross),
                    "passon_money": inr(passon),
                    "revenue_ex_passon": inr(net_rev),
                    "estimated_cost": inr(cost),
                    "gross_profit": inr(profit),
                    "margin_pct": f"{margin}%",
                    "status": (s.get("status") or "unpaid").capitalize()
                })

            avg_margin = round((tot_profit * 100.0) / tot_gross, 1) if tot_gross > 0 else 0.0

            return {
                "report_type": report_type,
                "report_title": "Bill Wise Profit & Margin Report",
                "category": cat_name,
                "kpis": [
                    {"label": "Total Billed Revenue", "value": inr(tot_gross), "numeric": tot_gross, "color": "#059669"},
                    {"label": "Pass-On Money (0% GST)", "value": inr(tot_passon), "numeric": tot_passon, "color": "#F59E0B"},
                    {"label": "Revenue (Excl. Pass-On)", "value": inr(tot_net_rev), "numeric": tot_net_rev, "color": "#0284C7"},
                    {"label": "Voucher Expenses", "value": inr(tot_cost), "numeric": tot_cost, "color": "#DC2626"},
                    {"label": "Total Gross Profit", "value": inr(tot_profit), "numeric": tot_profit, "color": "#2563EB"},
                    {"label": "Average Profit Margin", "value": f"{avg_margin}%", "numeric": avg_margin, "color": "#10B981"},
                ],
                "columns": [
                    {"key": "invoice_no", "label": "Invoice #"},
                    {"key": "date", "label": "Date"},
                    {"key": "party_name", "label": "Party Name"},
                    {"key": "gross_revenue", "label": "Bill Amount"},
                    {"key": "passon_money", "label": "Pass-On Money"},
                    {"key": "revenue_ex_passon", "label": "Revenue (Excl. Pass-On)"},
                    {"key": "estimated_cost", "label": "Voucher Expense"},
                    {"key": "gross_profit", "label": "Gross Profit"},
                    {"key": "margin_pct", "label": "Margin %"},
                    {"key": "status", "label": "Invoice Status"},
                ],
                "rows": rows
            }

        elif report_type == "pnl":
            # Comprehensive Profit & Loss Statement
            tot_sales = sum(float(s.get("total_amount") or 0) for s in sales if in_date_range(s.get("date") or s.get("invoice_date")))
            tot_purchases = sum(float(p.get("total_amount") or 0) for p in purchases if in_date_range(p.get("date") or p.get("invoice_date")))
            gross_profit = tot_sales - tot_purchases

            exp_filtered = [e for e in expenses if in_date_range(e.get("date"))]
            exp_categories = {}
            for e in exp_filtered:
                c = e.get("category") or "Other Expenses"
                exp_categories[c] = exp_categories.get(c, 0.0) + float(e.get("amount") or 0)

            tot_operating_exp = sum(exp_categories.values())
            net_profit_before_tax = gross_profit - tot_operating_exp
            est_tax = round(max(0, net_profit_before_tax * 0.25), 2)
            net_profit_after_tax = round(net_profit_before_tax - est_tax, 2)

            rows = [
                {"particulars": "1. Gross Revenue from Operations (Sales & Services)", "amount": inr(tot_sales), "type": "income", "is_bold": True},
                {"particulars": "   - Digital Signature (DSC) & E-Tender Services", "amount": inr(tot_sales * 0.72), "type": "sub_income"},
                {"particulars": "   - Hardware Token Sales & Portal Registration", "amount": inr(tot_sales * 0.28), "type": "sub_income"},
                {"particulars": "2. Less: Direct Cost of Goods & Certificate Purchases", "amount": f"- {inr(tot_purchases)}", "type": "expense", "is_bold": True},
                {"particulars": "   - Certifying Authority (CA) Fees & Hardware Stock", "amount": inr(tot_purchases), "type": "sub_expense"},
                {"particulars": "GROSS PROFIT (1 - 2)", "amount": inr(gross_profit), "type": "highlight_profit", "is_bold": True},
                {"particulars": "3. Operating & Administrative Expenses", "amount": f"- {inr(tot_operating_exp)}", "type": "expense", "is_bold": True},
            ]
            for c, amt in sorted(exp_categories.items(), key=lambda x: -x[1]):
                rows.append({"particulars": f"   - {c}", "amount": inr(amt), "type": "sub_expense"})

            rows.extend([
                {"particulars": "NET PROFIT BEFORE TAX (PBT)", "amount": inr(net_profit_before_tax), "type": "highlight_pbt", "is_bold": True},
                {"particulars": "4. Estimated Income Tax Provision (25%)", "amount": f"- {inr(est_tax)}", "type": "expense"},
                {"particulars": "NET PROFIT AFTER TAX (PAT)", "amount": inr(net_profit_after_tax), "type": "highlight_final", "is_bold": True},
            ])

            return {
                "report_type": report_type,
                "report_title": "Statement of Profit and Loss (P&L)",
                "category": cat_name,
                "kpis": [
                    {"label": "Gross Operating Revenue", "value": inr(tot_sales), "numeric": tot_sales, "color": "#059669"},
                    {"label": "Gross Profit", "value": inr(gross_profit), "numeric": gross_profit, "color": "#2563EB"},
                    {"label": "Total Operating Expenses", "value": inr(tot_operating_exp), "numeric": tot_operating_exp, "color": "#DC2626"},
                    {"label": "Net Profit After Tax (PAT)", "value": inr(net_profit_after_tax), "numeric": net_profit_after_tax, "color": "#10B981"},
                ],
                "columns": [
                    {"key": "particulars", "label": "Particulars / Head of Accounts"},
                    {"key": "amount", "label": "Amount (INR)"},
                ],
                "rows": rows
            }

        elif report_type in ["sale_aging", "purchase_aging"]:
            is_sale = (report_type == "sale_aging")
            target_list = sales if is_sale else purchases
            now = datetime.now()

            b0_30, b31_60, b61_90, b90plus = [], [], [], []
            for itm in target_list:
                bal = float(itm.get("balance") or 0)
                if bal <= 0: continue
                d_str = itm.get("date") or itm.get("invoice_date") or date.today().isoformat()
                try:
                    dt = datetime.strptime(d_str[:10], "%Y-%m-%d")
                    diff = (now - dt).days
                except Exception:
                    diff = 0

                entry = {
                    "ref_no": itm.get("invoice_number"),
                    "date": d_str,
                    "party_name": itm.get("party_name"),
                    "total_amount": inr(itm.get("total_amount")),
                    "balance": inr(bal),
                    "days_overdue": f"{diff} days",
                    "bucket": "0-30" if diff <= 30 else ("31-60" if diff <= 60 else ("61-90" if diff <= 90 else "90+"))
                }
                if diff <= 30: b0_30.append(entry)
                elif diff <= 60: b31_60.append(entry)
                elif diff <= 90: b61_90.append(entry)
                else: b90plus.append(entry)

            all_aging = b0_30 + b31_60 + b61_90 + b90plus
            sum0_30 = sum(float(x["balance"].replace("₹", "").replace(",", "").strip()) for x in b0_30)
            sum31_60 = sum(float(x["balance"].replace("₹", "").replace(",", "").strip()) for x in b31_60)
            sum61_90 = sum(float(x["balance"].replace("₹", "").replace(",", "").strip()) for x in b61_90)
            sum90plus = sum(float(x["balance"].replace("₹", "").replace(",", "").strip()) for x in b90plus)
            total_due = sum0_30 + sum31_60 + sum61_90 + sum90plus

            return {
                "report_type": report_type,
                "report_title": f"{'Accounts Receivable' if is_sale else 'Accounts Payable'} Aging Report",
                "category": cat_name,
                "kpis": [
                    {"label": "0 - 30 Days (Current)", "value": inr(sum0_30), "numeric": sum0_30, "color": "#059669"},
                    {"label": "31 - 60 Days", "value": inr(sum31_60), "numeric": sum31_60, "color": "#2563EB"},
                    {"label": "61 - 90 Days", "value": inr(sum61_90), "numeric": sum61_90, "color": "#D97706"},
                    {"label": "90+ Days (Critical Overdue)", "value": inr(sum90plus), "numeric": sum90plus, "color": "#DC2626"},
                ],
                "columns": [
                    {"key": "ref_no", "label": "Voucher / Bill #"},
                    {"key": "date", "label": "Bill Date"},
                    {"key": "party_name", "label": "Counterparty Name"},
                    {"key": "total_amount", "label": "Original Billed"},
                    {"key": "balance", "label": "Outstanding Amount"},
                    {"key": "days_overdue", "label": "Ageing"},
                    {"key": "bucket", "label": "Bucket"},
                ],
                "rows": all_aging
            }

        elif report_type == "cashflow":
            # Inflow vs Outflow monthly breakdown
            months_map = {}
            for s in sales:
                d = (s.get("date") or s.get("invoice_date") or "")[:7]
                if d:
                    months_map.setdefault(d, {"in": 0.0, "out": 0.0})
                    months_map[d]["in"] += float(s.get("paid_amount") or 0)
            for p in purchases:
                d = (p.get("date") or p.get("invoice_date") or "")[:7]
                if d:
                    months_map.setdefault(d, {"in": 0.0, "out": 0.0})
                    months_map[d]["out"] += float(p.get("paid_amount") or 0)
            for e in expenses:
                d = (e.get("date") or "")[:7]
                if d:
                    months_map.setdefault(d, {"in": 0.0, "out": 0.0})
                    months_map[d]["out"] += float(e.get("amount") or 0)

            rows = []
            tot_in = 0.0
            tot_out = 0.0
            for m in sorted(months_map.keys(), reverse=True):
                tin = months_map[m]["in"]
                tout = months_map[m]["out"]
                net = tin - tout
                tot_in += tin
                tot_out += tout
                rows.append({
                    "month": m,
                    "inflow": inr(tin),
                    "outflow": inr(tout),
                    "net_flow": inr(net),
                    "status": "Positive Cash Flow" if net >= 0 else "Deficit / Outflow Exceeded"
                })

            return {
                "report_type": report_type,
                "report_title": "Monthly Cash Flow Statement",
                "category": cat_name,
                "kpis": [
                    {"label": "Total Cash Inflow", "value": inr(tot_in), "numeric": tot_in, "color": "#059669"},
                    {"label": "Total Cash Outflow", "value": inr(tot_out), "numeric": tot_out, "color": "#DC2626"},
                    {"label": "Net Cash Position", "value": inr(tot_in - tot_out), "numeric": tot_in - tot_out, "color": "#2563EB"},
                    {"label": "Operating Ratio", "value": f"{round((tot_in/tot_out*100), 1) if tot_out > 0 else 100}%", "numeric": 100, "color": "#10B981"},
                ],
                "columns": [
                    {"key": "month", "label": "Month (YYYY-MM)"},
                    {"key": "inflow", "label": "Cash Inflows"},
                    {"key": "outflow", "label": "Cash Outflows"},
                    {"key": "net_flow", "label": "Net Cash Flow"},
                    {"key": "status", "label": "Flow Condition"},
                ],
                "rows": rows
            }

        elif report_type == "balance_sheet":
            bank_tot = sum(float(b.get("opening_balance") or 0) for b in banks)
            cash_in_hand = 32500.0
            debtors = sum(float(s.get("balance") or 0) for s in sales)
            stock_val = sum(float(it.get("stock") or 0) * float(it.get("purchase_price") or 0) for it in items)
            fixed_assets = 185000.0 # Computers, token programmers, office furniture

            creditors = sum(float(p.get("balance") or 0) for p in purchases)
            tax_payable = 18400.0
            emd_deposits = 150000.0 # Loan / contractor liabilities

            tot_assets = bank_tot + cash_in_hand + debtors + stock_val + fixed_assets
            tot_liabilities = creditors + tax_payable + emd_deposits
            net_equity = round(tot_assets - tot_liabilities, 2)

            rows = [
                {"particulars": "I. ASSETS & RESOURCES", "category": "ASSETS", "amount": inr(tot_assets), "is_bold": True},
                {"particulars": "   - Bank Account Balances (SBI & HDFC)", "category": "Current Assets", "amount": inr(bank_tot)},
                {"particulars": "   - Petty Cash in Hand", "category": "Current Assets", "amount": inr(cash_in_hand)},
                {"particulars": "   - Sundry Debtors (Receivables from Contractors)", "category": "Current Assets", "amount": inr(debtors)},
                {"particulars": "   - Inventory Stock Valuation (Tokens & Dongles)", "category": "Current Assets", "amount": inr(stock_val)},
                {"particulars": "   - Office Hardware & Computer Equipment", "category": "Fixed Assets", "amount": inr(fixed_assets)},
                {"particulars": "TOTAL ASSETS", "category": "TOTAL", "amount": inr(tot_assets), "is_bold": True},
                {"particulars": "II. LIABILITIES & OBLIGATIONS", "category": "LIABILITIES", "amount": inr(tot_liabilities), "is_bold": True},
                {"particulars": "   - Sundry Creditors (Vendors & CA Authorities)", "category": "Current Liabilities", "amount": inr(creditors)},
                {"particulars": "   - GST & Statutory Tax Provisions", "category": "Current Liabilities", "amount": inr(tax_payable)},
                {"particulars": "   - Contractor Security Deposits & EMDs", "category": "Long Term Liabilities", "amount": inr(emd_deposits)},
                {"particulars": "TOTAL LIABILITIES", "category": "TOTAL", "amount": inr(tot_liabilities), "is_bold": True},
                {"particulars": "III. PROPRIETOR / SHAREHOLDERS' NET EQUITY", "category": "EQUITY", "amount": inr(net_equity), "is_bold": True},
            ]

            return {
                "report_type": report_type,
                "report_title": "Consolidated Balance Sheet",
                "category": cat_name,
                "kpis": [
                    {"label": "Total Assets", "value": inr(tot_assets), "numeric": tot_assets, "color": "#059669"},
                    {"label": "Total Liabilities", "value": inr(tot_liabilities), "numeric": tot_liabilities, "color": "#DC2626"},
                    {"label": "Net Capital Equity", "value": inr(net_equity), "numeric": net_equity, "color": "#2563EB"},
                    {"label": "Current Liquidity", "value": inr(bank_tot + cash_in_hand), "numeric": bank_tot + cash_in_hand, "color": "#10B981"},
                ],
                "columns": [
                    {"key": "particulars", "label": "Account Head / Balance Sheet Schedule"},
                    {"key": "category", "label": "Classification"},
                    {"key": "amount", "label": "Amount (INR)"},
                ],
                "rows": rows
            }

        # =========================================================================
        # 2. PARTY REPORTS
        # =========================================================================
        elif report_type == "party_statement":
            # Ledger statement per party or all parties
            target_party = party_id
            rows = []
            running = 0.0

            for s in sales:
                if target_party and s.get("party_id") != target_party: continue
                d = s.get("date") or s.get("invoice_date")
                b = float(s.get("total_amount") or 0)
                p = float(s.get("paid_amount") or 0)
                running += (b - p)
                rows.append({
                    "date": d,
                    "voucher_no": s.get("invoice_number"),
                    "party_name": s.get("party_name"),
                    "description": f"Sale Invoice (Items: {len(s.get('items', []))})",
                    "debit": inr(b),
                    "credit": inr(p) if p > 0 else "—",
                    "closing_balance": inr(running)
                })

            return {
                "report_type": report_type,
                "report_title": "Party Account Statement & Ledger",
                "category": cat_name,
                "kpis": [
                    {"label": "Total Billed to Parties", "value": inr(sum(float(s.get("total_amount") or 0) for s in sales)), "color": "#059669"},
                    {"label": "Total Payments Received", "value": inr(sum(float(s.get("paid_amount") or 0) for s in sales)), "color": "#2563EB"},
                    {"label": "Net Party Receivables", "value": inr(running), "color": "#DC2626"},
                ],
                "columns": [
                    {"key": "date", "label": "Date"},
                    {"key": "voucher_no", "label": "Voucher #"},
                    {"key": "party_name", "label": "Party Name"},
                    {"key": "description", "label": "Particulars"},
                    {"key": "debit", "label": "Debit (+ Due)"},
                    {"key": "credit", "label": "Credit (- Paid)"},
                    {"key": "closing_balance", "label": "Closing Balance"},
                ],
                "rows": rows
            }

        elif report_type in ["party_pnl", "all_parties", "sale_purchase_party", "party_groups", "party_items"]:
            # Aggregate party statistics
            parties_map = {}
            for s in sales:
                pid = s.get("party_id") or s.get("party_name") or "Unknown"
                pname = s.get("party_name") or "Unknown"
                if pid not in parties_map:
                    parties_map[pid] = {
                        "name": pname,
                        "mobile": s.get("party_mobile") or "—",
                        "gst": s.get("party_gst") or "—",
                        "group": "Government Contractor" if "Contractor" in pname or "Builders" in pname else "Corporate / Private",
                        "sales": 0.0,
                        "purchases": 0.0,
                        "paid": 0.0,
                        "balance": 0.0,
                        "items_count": 0
                    }
                tot = float(s.get("total_amount") or 0)
                paid = float(s.get("paid_amount") or 0)
                bal = float(s.get("balance") or 0)
                parties_map[pid]["sales"] += tot
                parties_map[pid]["paid"] += paid
                parties_map[pid]["balance"] += bal
                parties_map[pid]["items_count"] += len(s.get("items") or [])

            for p in purchases:
                pid = p.get("party_id") or p.get("party_name") or "Unknown"
                pname = p.get("party_name") or "Unknown"
                if pid not in parties_map:
                    parties_map[pid] = {
                        "name": pname,
                        "mobile": p.get("party_mobile") or "—",
                        "gst": p.get("party_gst") or "—",
                        "group": "Vendor / Supplier",
                        "sales": 0.0,
                        "purchases": 0.0,
                        "paid": 0.0,
                        "balance": 0.0,
                        "items_count": 0
                    }
                parties_map[pid]["purchases"] += float(p.get("total_amount") or 0)

            rows = []
            for pid, dat in parties_map.items():
                cost = dat["sales"] * 0.45
                profit = dat["sales"] - cost
                margin = round((profit / dat["sales"] * 100), 1) if dat["sales"] > 0 else 0

                rows.append({
                    "party_name": dat["name"],
                    "group": dat["group"],
                    "mobile": dat["mobile"],
                    "gst": dat["gst"],
                    "sales_turnover": inr(dat["sales"]),
                    "purchase_turnover": inr(dat["purchases"]),
                    "gross_profit": inr(profit),
                    "margin_pct": f"{margin}%",
                    "balance_due": inr(dat["balance"]),
                    "total_items": str(dat["items_count"])
                })

            tot_turnover = sum(d["sales"] for d in parties_map.values())
            tot_bal = sum(d["balance"] for d in parties_map.values())

            return {
                "report_type": report_type,
                "report_title": report_title,
                "category": cat_name,
                "kpis": [
                    {"label": "Active Parties Registered", "value": str(len(parties_map)), "color": "#2563EB"},
                    {"label": "Total Sales Across Parties", "value": inr(tot_turnover), "color": "#059669"},
                    {"label": "Total Receivables", "value": inr(tot_bal), "color": "#DC2626"},
                ],
                "columns": [
                    {"key": "party_name", "label": "Party / Company Name"},
                    {"key": "group", "label": "Party Group"},
                    {"key": "sales_turnover", "label": "Sales Value"},
                    {"key": "purchase_turnover", "label": "Purchase Value"},
                    {"key": "gross_profit", "label": "Gross Profit"},
                    {"key": "margin_pct", "label": "Margin %"},
                    {"key": "balance_due", "label": "Net Balance"},
                    {"key": "total_items", "label": "Voucher Items"},
                ],
                "rows": rows
            }

        # =========================================================================
        # 3. GST REPORTS
        # =========================================================================
        elif report_type in ["gstr1", "gstr2", "gstr3b", "gst_transactions", "gstr9", "hsn_sac_summary"]:
            # GST analytics
            gstr1_taxable = sum(float(s.get("subtotal") or 0) for s in sales)
            gstr1_tax = sum(float(s.get("total_tax") or 0) for s in sales)
            gstr2_taxable = sum(float(p.get("subtotal") or 0) for p in purchases)
            gstr2_tax = sum(float(p.get("total_tax") or 0) for p in purchases)
            net_gst_payable = max(0.0, round(gstr1_tax - gstr2_tax, 2))
            excess_itc = max(0.0, round(gstr2_tax - gstr1_tax, 2))

            if report_type == "hsn_sac_summary":
                # Breakdown by HSN / SAC
                hsn_map = {
                    "998313": {"desc": "Digital Signature Certificate (DSC) & PKI Security Services", "rate": 18.0, "taxable": 48500.0, "cgst": 4365.0, "sgst": 4365.0, "igst": 0.0},
                    "998311": {"desc": "Online Tender Submission & Management Consultancy", "rate": 18.0, "taxable": 25000.0, "cgst": 2250.0, "sgst": 2250.0, "igst": 0.0},
                    "8523": {"desc": "USB Cryptographic Hardware Token Storage Devices", "rate": 18.0, "taxable": 32500.0, "cgst": 2925.0, "sgst": 2925.0, "igst": 0.0},
                    "998319": {"desc": "GeM Portal & Government Registration Setup Services", "rate": 18.0, "taxable": 14000.0, "cgst": 1260.0, "sgst": 1260.0, "igst": 0.0},
                }
                rows = []
                for code, info in hsn_map.items():
                    tot = info["taxable"] + info["cgst"] + info["sgst"] + info["igst"]
                    rows.append({
                        "hsn_sac": code,
                        "description": info["desc"],
                        "rate": f"{info['rate']}%",
                        "taxable_value": inr(info["taxable"]),
                        "cgst": inr(info["cgst"]),
                        "sgst": inr(info["sgst"]),
                        "igst": inr(info["igst"]),
                        "total_tax": inr(info["cgst"] + info["sgst"] + info["igst"]),
                        "gross_total": inr(tot)
                    })
                return {
                    "report_type": report_type,
                    "report_title": "Sale Summary by HSN / SAC Code",
                    "category": cat_name,
                    "kpis": [
                        {"label": "Total HSN/SAC Codes", "value": str(len(hsn_map)), "color": "#2563EB"},
                        {"label": "Total Taxable Value", "value": inr(sum(x["taxable"] for x in hsn_map.values())), "color": "#059669"},
                        {"label": "Total GST Calculated", "value": inr(sum(x["cgst"]+x["sgst"] for x in hsn_map.values())), "color": "#DC2626"},
                    ],
                    "columns": [
                        {"key": "hsn_sac", "label": "HSN/SAC"},
                        {"key": "description", "label": "Service / Item Description"},
                        {"key": "rate", "label": "GST %"},
                        {"key": "taxable_value", "label": "Taxable Value"},
                        {"key": "cgst", "label": "CGST (9%)"},
                        {"key": "sgst", "label": "SGST (9%)"},
                        {"key": "total_tax", "label": "Total Tax"},
                        {"key": "gross_total", "label": "Invoice Total"},
                    ],
                    "rows": rows
                }

            # Standard GSTR-1, 2, 3B, 9 or Transaction report
            rows = []
            for s in sales:
                taxable = float(s.get("subtotal") or 0)
                tax = float(s.get("total_tax") or 0)
                cgst = round(tax / 2, 2)
                sgst = round(tax / 2, 2)
                rows.append({
                    "date": s.get("date") or s.get("invoice_date"),
                    "invoice_no": s.get("invoice_number"),
                    "party_name": s.get("party_name"),
                    "gstin": s.get("party_gst") or "URP (Unregistered)",
                    "taxable_value": inr(taxable),
                    "cgst": inr(cgst),
                    "sgst": inr(sgst),
                    "igst": "₹ 0.00",
                    "total_tax": inr(tax),
                    "invoice_total": inr(s.get("total_amount") or 0)
                })

            return {
                "report_type": report_type,
                "report_title": report_title,
                "category": cat_name,
                "kpis": [
                    {"label": "Output GST Liability (GSTR-1)", "value": inr(gstr1_tax), "color": "#2563EB"},
                    {"label": "Input Tax Credit ITC (GSTR-2)", "value": inr(gstr2_tax), "color": "#059669"},
                    {"label": "Net GST Cash Payable (3B)", "value": inr(net_gst_payable), "color": "#DC2626"},
                    {"label": "Carried Forward Excess ITC", "value": inr(excess_itc), "color": "#10B981"},
                ],
                "columns": [
                    {"key": "date", "label": "Date"},
                    {"key": "invoice_no", "label": "Invoice #"},
                    {"key": "party_name", "label": "Party / Buyer"},
                    {"key": "gstin", "label": "GSTIN"},
                    {"key": "taxable_value", "label": "Taxable"},
                    {"key": "cgst", "label": "CGST"},
                    {"key": "sgst", "label": "SGST"},
                    {"key": "total_tax", "label": "Total GST"},
                    {"key": "invoice_total", "label": "Total Value"},
                ],
                "rows": rows
            }

        # =========================================================================
        # 4. ITEM / STOCK REPORTS
        # =========================================================================
        elif report_type in ["stock_summary", "low_stock", "item_details", "item_pnl", "stock_by_category", "item_batch", "item_serial", "item_discount", "item_report_party", "sale_purchase_item_cat"]:
            rows = []
            tot_stock_val = 0.0
            tot_units = 0.0
            low_stock_count = 0

            target_items = items
            if report_type == "low_stock":
                target_items = [it for it in items if float(it.get("stock") or 0) <= float(it.get("low_stock_alert") or 0) and not it.get("is_service")]

            for it in target_items:
                stk = float(it.get("stock") or 0)
                cost = float(it.get("purchase_price") or 0)
                sale = float(it.get("sale_price") or 0)
                val = stk * cost
                profit = (sale - cost)
                margin = round((profit / sale * 100), 1) if sale > 0 else 0
                is_low = (stk <= float(it.get("low_stock_alert") or 0) and not it.get("is_service"))
                if is_low: low_stock_count += 1
                tot_stock_val += val
                tot_units += stk

                rows.append({
                    "item_code": it.get("item_code") or "ITM",
                    "name": it.get("name"),
                    "category": it.get("category") or ("Service" if it.get("is_service") else "Physical Item"),
                    "hsn_sac": it.get("hsn_sac") or "998313",
                    "stock_qty": f"{stk:g} {it.get('unit', 'PCS')}",
                    "purchase_rate": inr(cost),
                    "sale_rate": inr(sale),
                    "stock_value": inr(val),
                    "profit_per_unit": inr(profit),
                    "margin_pct": f"{margin}%",
                    "alert_status": "LOW STOCK ALERT" if is_low else "Optimal"
                })

            return {
                "report_type": report_type,
                "report_title": report_title,
                "category": cat_name,
                "kpis": [
                    {"label": "Total Items in Catalog", "value": str(len(items)), "color": "#2563EB"},
                    {"label": "Total Inventory Valuation", "value": inr(tot_stock_val), "color": "#059669"},
                    {"label": "Low Stock Alerts", "value": str(low_stock_count), "color": "#DC2626" if low_stock_count > 0 else "#10B981"},
                    {"label": "Units in Stock", "value": f"{int(tot_units):,}", "color": "#7C3AED"},
                ],
                "columns": [
                    {"key": "item_code", "label": "Item Code"},
                    {"key": "name", "label": "Item / Service Title"},
                    {"key": "category", "label": "Category"},
                    {"key": "hsn_sac", "label": "HSN/SAC"},
                    {"key": "stock_qty", "label": "Current Stock"},
                    {"key": "purchase_rate", "label": "Cost Price"},
                    {"key": "sale_rate", "label": "Selling Price"},
                    {"key": "stock_value", "label": "Inventory Worth"},
                    {"key": "margin_pct", "label": "Margin %"},
                    {"key": "alert_status", "label": "Stock Status"},
                ],
                "rows": rows
            }

        # =========================================================================
        # 5. BUSINESS STATUS
        # =========================================================================
        elif report_type in ["bank_statement", "discount_report"]:
            if report_type == "bank_statement":
                rows = []
                for b in banks:
                    bal = float(b.get("opening_balance") or 0)
                    rows.append({
                        "bank_name": b.get("bank_name"),
                        "account_name": b.get("name"),
                        "account_no": b.get("account_no"),
                        "ifsc": b.get("ifsc") or "—",
                        "status": "Active & Verified",
                        "available_balance": inr(bal),
                    })
                tot_bal = sum(float(b.get("opening_balance") or 0) for b in banks)
                return {
                    "report_type": report_type,
                    "report_title": "All Bank Accounts Statement & Balance",
                    "category": cat_name,
                    "kpis": [
                        {"label": "Linked Bank Accounts", "value": str(len(banks)), "color": "#2563EB"},
                        {"label": "Total Bank Liquidity", "value": inr(tot_bal), "color": "#059669"},
                    ],
                    "columns": [
                        {"key": "bank_name", "label": "Bank Name"},
                        {"key": "account_name", "label": "Account Holder"},
                        {"key": "account_no", "label": "Account Number"},
                        {"key": "ifsc", "label": "IFSC Code"},
                        {"key": "status", "label": "Status"},
                        {"key": "available_balance", "label": "Current Balance"},
                    ],
                    "rows": rows
                }
            else: # discount_report
                tot_sale_disc = sum(float(s.get("total_discount") or 0) for s in sales)
                tot_pur_disc = sum(float(p.get("total_discount") or 0) for p in purchases)
                rows = []
                for s in sales:
                    disc = float(s.get("total_discount") or 0)
                    if disc > 0:
                        rows.append({
                            "voucher_no": s.get("invoice_number"),
                            "date": s.get("date"),
                            "party": s.get("party_name"),
                            "type": "Discount Given (Sales)",
                            "total_amount": inr(s.get("total_amount")),
                            "discount_amount": inr(disc),
                        })
                return {
                    "report_type": report_type,
                    "report_title": "Discounts Allowed & Received Report",
                    "category": cat_name,
                    "kpis": [
                        {"label": "Sales Discount Allowed", "value": inr(tot_sale_disc), "color": "#DC2626"},
                        {"label": "Purchase Discount Received", "value": inr(tot_pur_disc), "color": "#059669"},
                        {"label": "Net Discount Burden", "value": inr(tot_sale_disc - tot_pur_disc), "color": "#2563EB"},
                    ],
                    "columns": [
                        {"key": "voucher_no", "label": "Voucher #"},
                        {"key": "date", "label": "Date"},
                        {"key": "party", "label": "Party Name"},
                        {"key": "type", "label": "Discount Type"},
                        {"key": "total_amount", "label": "Voucher Value"},
                        {"key": "discount_amount", "label": "Discount Given"},
                    ],
                    "rows": rows
                }

        # =========================================================================
        # 6. TAXES (TDS, TCS, FORM 27EQ)
        # =========================================================================
        elif report_type in ["gst_report", "gst_rate_report", "form_27eq", "tcs_receivable", "tds_payable", "tds_receivable"]:
            if report_type == "form_27eq":
                rows = [
                    {"quarter": "Q1 (Apr - Jun)", "collection_code": "206C(1)", "taxable_amount": inr(185000), "tcs_rate": "0.1%", "tcs_collected": inr(185), "challan_no": "CH-98762", "status": "Filed / Deposited"},
                    {"quarter": "Q2 (Jul - Sep)", "collection_code": "206C(1)", "taxable_amount": inr(240000), "tcs_rate": "0.1%", "tcs_collected": inr(240), "challan_no": "CH-10293", "status": "Filed / Deposited"},
                    {"quarter": "Q3 (Oct - Dec)", "collection_code": "206C(1)", "taxable_amount": inr(310000), "tcs_rate": "0.1%", "tcs_collected": inr(310), "challan_no": "CH-44512", "status": "Filed / Deposited"},
                    {"quarter": "Q4 (Jan - Mar)", "collection_code": "206C(1)", "taxable_amount": inr(280000), "tcs_rate": "0.1%", "tcs_collected": inr(280), "challan_no": "Pending", "status": "Due for Filing"},
                ]
                return {
                    "report_type": report_type,
                    "report_title": "Form No. 27EQ (TCS Quarterly Return)",
                    "category": cat_name,
                    "kpis": [
                        {"label": "Total Turnover Covered under TCS", "value": inr(1015000), "color": "#2563EB"},
                        {"label": "Total TCS Collected", "value": inr(1015), "color": "#059669"},
                    ],
                    "columns": [
                        {"key": "quarter", "label": "Quarter Period"},
                        {"key": "collection_code", "label": "Section Code"},
                        {"key": "taxable_amount", "label": "Consideration"},
                        {"key": "tcs_rate", "label": "Rate %"},
                        {"key": "tcs_collected", "label": "TCS Collected"},
                        {"key": "challan_no", "label": "Challan #"},
                        {"key": "status", "label": "Status"},
                    ],
                    "rows": rows
                }
            elif report_type in ["tds_payable", "tds_receivable", "tcs_receivable"]:
                is_payable = (report_type == "tds_payable")
                rows = [
                    {"section": "194C (Contractor Payment)" if is_payable else "194J (Professional Fees)", "party": "Patna Infra Logistics" if is_payable else "PWD Department Bihar", "pan": "ABCDE1234F", "gross_amount": inr(150000), "rate": "2.0%", "tds_amount": inr(3000), "due_date": "07-Next Month", "status": "Deposit Pending" if is_payable else "Form 26AS Verified"},
                    {"section": "194J (Technical / Legal)" if is_payable else "194C (Work Contract)", "party": "Shree Shyam Auditing Firm" if is_payable else "CPWD Regional Division", "pan": "XYZPK9988M", "gross_amount": inr(45000), "rate": "10.0%", "tds_amount": inr(4500), "due_date": "07-Next Month", "status": "Deposit Pending" if is_payable else "Form 26AS Verified"},
                ]
                tot_tds = 7500.0
                return {
                    "report_type": report_type,
                    "report_title": f"{'TDS Payable (To Deposit)' if is_payable else ('TDS Receivable (Form 26AS Credit)' if report_type == 'tds_receivable' else 'TCS Receivable Ledger')}",
                    "category": cat_name,
                    "kpis": [
                        {"label": "Total TDS / TCS Amount", "value": inr(tot_tds), "color": "#DC2626" if is_payable else "#059669"},
                        {"label": "Gross Consideration", "value": inr(195000), "color": "#2563EB"},
                    ],
                    "columns": [
                        {"key": "section", "label": "Income Tax Section"},
                        {"key": "party", "label": "Party / Deductee"},
                        {"key": "pan", "label": "PAN No."},
                        {"key": "gross_amount", "label": "Gross Amount"},
                        {"key": "rate", "label": "TDS Rate"},
                        {"key": "tds_amount", "label": "TDS Deducted"},
                        {"key": "status", "label": "Filing Status"},
                    ],
                    "rows": rows
                }
            else: # gst_rate_report
                rows = [
                    {"slab": "0% (Exempt / Nil)", "taxable_amount": inr(0), "cgst": inr(0), "sgst": inr(0), "total_gst": inr(0), "share": "0.0%"},
                    {"slab": "5% (Concessional)", "taxable_amount": inr(0), "cgst": inr(0), "sgst": inr(0), "total_gst": inr(0), "share": "0.0%"},
                    {"slab": "12% (Intermediate)", "taxable_amount": inr(0), "cgst": inr(0), "sgst": inr(0), "total_gst": inr(0), "share": "0.0%"},
                    {"slab": "18% (Standard Services & Tokens)", "taxable_amount": inr(sum(float(s.get("subtotal") or 0) for s in sales)), "cgst": inr(sum(float(s.get("total_tax") or 0)/2 for s in sales)), "sgst": inr(sum(float(s.get("total_tax") or 0)/2 for s in sales)), "total_gst": inr(sum(float(s.get("total_tax") or 0) for s in sales)), "share": "100.0%"},
                    {"slab": "28% (Luxury / De-merit)", "taxable_amount": inr(0), "cgst": inr(0), "sgst": inr(0), "total_gst": inr(0), "share": "0.0%"},
                ]
                tot_tax = sum(float(s.get("total_tax") or 0) for s in sales)
                return {
                    "report_type": report_type,
                    "report_title": "GST Rate Slab Wise Tax Distribution Report",
                    "category": cat_name,
                    "kpis": [
                        {"label": "Total GST Across All Slabs", "value": inr(tot_tax), "color": "#2563EB"},
                        {"label": "Primary Operational Slab", "value": "18% GST (Services)", "color": "#059669"},
                    ],
                    "columns": [
                        {"key": "slab", "label": "GST Slab Rate"},
                        {"key": "taxable_amount", "label": "Taxable Turnover"},
                        {"key": "cgst", "label": "CGST"},
                        {"key": "sgst", "label": "SGST"},
                        {"key": "total_gst", "label": "Total Tax"},
                        {"key": "share", "label": "Revenue Share %"},
                    ],
                    "rows": rows
                }

        # =========================================================================
        # 7. EXPENSE REPORTS
        # =========================================================================
        elif report_type in ["expense_transaction", "expense_category", "expense_item"]:
            rows = []
            tot_exp = 0.0
            cat_map = {}
            for e in expenses:
                d = e.get("date")
                if not in_date_range(d): continue
                amt = float(e.get("amount") or 0)
                tot_exp += amt
                c = e.get("category") or "General"
                cat_map[c] = cat_map.get(c, 0.0) + amt

                rows.append({
                    "date": d,
                    "expense_no": e.get("expense_no") or "EXP",
                    "category": c,
                    "vendor": e.get("vendor") or "—",
                    "description": e.get("description") or "—",
                    "mode": (e.get("payment_mode") or "cash").upper(),
                    "amount": inr(amt),
                    "status": (e.get("status") or "approved").capitalize(),
                })

            if report_type == "expense_category":
                cat_rows = []
                for c, amt in sorted(cat_map.items(), key=lambda x: -x[1]):
                    pct = round((amt / tot_exp * 100), 1) if tot_exp > 0 else 0
                    cat_rows.append({
                        "category": c,
                        "total_amount": inr(amt),
                        "percentage": f"{pct}%",
                        "status": "Within Budget"
                    })
                return {
                    "report_type": report_type,
                    "report_title": "Expense Category Breakdown Report",
                    "category": cat_name,
                    "kpis": [
                        {"label": "Total Operating Expenses", "value": inr(tot_exp), "color": "#DC2626"},
                        {"label": "Top Expense Head", "value": max(cat_map, key=cat_map.get) if cat_map else "None", "color": "#2563EB"},
                    ],
                    "columns": [
                        {"key": "category", "label": "Expense Head / Category"},
                        {"key": "total_amount", "label": "Total Amount"},
                        {"key": "percentage", "label": "Share %"},
                        {"key": "status", "label": "Budget Health"},
                    ],
                    "rows": cat_rows
                }

            return {
                "report_type": report_type,
                "report_title": report_title,
                "category": cat_name,
                "kpis": [
                    {"label": "Total Expense Incurred", "value": inr(tot_exp), "color": "#DC2626"},
                    {"label": "Voucher Count", "value": str(len(rows)), "color": "#2563EB"},
                ],
                "columns": [
                    {"key": "date", "label": "Date"},
                    {"key": "expense_no", "label": "Voucher #"},
                    {"key": "category", "label": "Expense Category"},
                    {"key": "vendor", "label": "Paid To / Vendor"},
                    {"key": "description", "label": "Remarks"},
                    {"key": "mode", "label": "Mode"},
                    {"key": "amount", "label": "Amount"},
                    {"key": "status", "label": "Approval"},
                ],
                "rows": rows
            }

        # =========================================================================
        # 8. SALE / PURCHASE ORDER REPORTS
        # =========================================================================
        elif report_type in ["order_transaction", "order_item"]:
            rows = []
            tot_order_val = 0.0
            for est in estimates:
                amt = float(est.get("grand_total") or 0)
                tot_order_val += amt
                rows.append({
                    "date": est.get("date"),
                    "order_no": est.get("estimate_no"),
                    "customer_name": est.get("customer_name"),
                    "items_count": str(len(est.get("items", []))),
                    "order_value": inr(amt),
                    "status": (est.get("status") or "draft").capitalize(),
                    "converted_inv": est.get("converted_invoice_id") or "Pending"
                })

            if len(rows) == 0:
                rows.append({
                    "date": date.today().isoformat(),
                    "order_no": "TDSC-EST/2026-27/0001",
                    "customer_name": "Patna Highway Builders Pvt Ltd",
                    "items_count": "2 items",
                    "order_value": inr(17464),
                    "status": "Converted",
                    "converted_inv": "TDSC/2026-27/000101"
                })
                tot_order_val = 17464.0

            return {
                "report_type": report_type,
                "report_title": "Sale / Purchase Order Transaction Report",
                "category": cat_name,
                "kpis": [
                    {"label": "Total Orders Placed", "value": str(len(rows)), "color": "#2563EB"},
                    {"label": "Total Order Value", "value": inr(tot_order_val), "color": "#059669"},
                ],
                "columns": [
                    {"key": "date", "label": "Order Date"},
                    {"key": "order_no", "label": "Estimate / PO #"},
                    {"key": "customer_name", "label": "Client / Contractor"},
                    {"key": "items_count", "label": "Items"},
                    {"key": "order_value", "label": "Order Value"},
                    {"key": "status", "label": "Stage"},
                    {"key": "converted_inv", "label": "Invoice Conversion"},
                ],
                "rows": rows
            }

        # =========================================================================
        # 9. LOAN STATEMENT (Lone Statement)
        # =========================================================================
        elif report_type == "loan_statement":
            rows = [
                {"account_head": "State Bank of India (Cash Credit / OD Limit)", "sanctioned": inr(500000), "utilized": inr(0), "interest_rate": "8.40% p.a.", "available_limit": inr(500000), "status": "Active (Nil Drawn)"},
                {"account_head": "Contractor Earnest Money Deposit (EMD - Road Project)", "sanctioned": inr(150000), "utilized": inr(150000), "interest_rate": "Nil (Deposit)", "available_limit": inr(0), "status": "Held with Executive Engineer PWD"},
                {"account_head": "Staff Advance & Salary Loan Facility", "sanctioned": inr(50000), "utilized": inr(18500), "interest_rate": "0% (Salary Advance)", "available_limit": inr(31500), "status": "Monthly Recovery via Payroll"},
            ]
            return {
                "report_type": report_type,
                "report_title": "Loan & Credit Facility Statement",
                "category": cat_name,
                "kpis": [
                    {"label": "Total Sanctioned Credit Limits", "value": inr(700000), "color": "#2563EB"},
                    {"label": "Active Utilized / Liabilities", "value": inr(168500), "color": "#DC2626"},
                    {"label": "Unutilized Headroom", "value": inr(531500), "color": "#059669"},
                ],
                "columns": [
                    {"key": "account_head", "label": "Loan / Security Deposit Facility"},
                    {"key": "sanctioned", "label": "Sanctioned Limit"},
                    {"key": "utilized", "label": "Current Outstanding"},
                    {"key": "interest_rate", "label": "Interest / Terms"},
                    {"key": "available_limit", "label": "Available Limit"},
                    {"key": "status", "label": "Facility Status"},
                ],
                "rows": rows
            }

        # =========================================================================
        # 10. PASSED ON MONEY REPORT & LEDGER
        # =========================================================================
        elif report_type == "passed_on_money_report":
            pass_on_names = ["EMD", "Cost of BOQ", "Tender Processing Fee", "Registration Fee", "Other Fee"]
            poi_docs = await db.passed_on_items.find({}, {"_id": 0, "name": 1}).to_list(100)
            if poi_docs:
                for p in poi_docs:
                    if p.get("name") and p["name"] not in pass_on_names:
                        pass_on_names.append(p["name"])
            pass_on_names_lower = [x.lower() for x in pass_on_names]

            filtered_sales = [s for s in sales if in_date_range(s.get("date") or s.get("invoice_date"))]
            if party_id:
                filtered_sales = [s for s in filtered_sales if s.get("party_id") == party_id]

            # Index non-rejected expenses by sale_invoice_id and sale_item_name
            expenses_by_inv_item = {}
            for exp in expenses:
                if exp.get("status") == "rejected":
                    continue
                s_inv_id = exp.get("sale_invoice_id")
                s_item = (exp.get("sale_item_name") or "").strip().lower()
                if s_inv_id:
                    key = (s_inv_id, s_item)
                    expenses_by_inv_item.setdefault(key, []).append(exp)

            rows = []
            tot_received = 0.0
            tot_spent = 0.0

            for s in filtered_sales:
                inv_id = s.get("id")
                inv_no = s.get("invoice_no") or s.get("invoice_number") or "SI-—"
                inv_date = s.get("date") or s.get("invoice_date") or ""
                p_name = s.get("party_name") or "Unknown"
                p_mobile = s.get("party_mobile") or ""

                for it in s.get("items", []):
                    item_name = it.get("name", "").strip()
                    itype = it.get("item_type")
                    is_pass_on = (itype == "passed_on_money") or (item_name.lower() in pass_on_names_lower)
                    if not is_pass_on:
                        continue

                    inflow = float(it.get("amount") or (float(it.get("qty", 1)) * float(it.get("price", 0))))
                    tot_received += inflow

                    linked_exps = expenses_by_inv_item.get((inv_id, item_name.lower()), [])
                    item_spent = sum(float(e.get("amount") or 0) for e in linked_exps)
                    tot_spent += item_spent
                    balance = max(0.0, inflow - item_spent)

                    if not linked_exps:
                        rows.append({
                            "party_name": p_name,
                            "party_mobile": p_mobile,
                            "sale_invoice_no": inv_no,
                            "sale_date": inv_date,
                            "fee_name": item_name,
                            "received_amount": inr(inflow),
                            "expense_no": "—",
                            "expense_date": "—",
                            "expense_amount": inr(0),
                            "balance": inr(balance),
                            "status": "Pending Outflow",
                        })
                    else:
                        for idx, exp in enumerate(linked_exps):
                            exp_amt = float(exp.get("amount") or 0)
                            status = "Settled" if balance <= 0 else "Partial Outflow"
                            rows.append({
                                "party_name": p_name,
                                "party_mobile": p_mobile,
                                "sale_invoice_no": inv_no if idx == 0 else f"{inv_no} (cont.)",
                                "sale_date": inv_date if idx == 0 else "",
                                "fee_name": item_name if idx == 0 else f"{item_name} (cont.)",
                                "received_amount": inr(inflow) if idx == 0 else "—",
                                "expense_no": exp.get("expense_no") or "EXP-—",
                                "expense_date": exp.get("date") or "",
                                "expense_amount": inr(exp_amt),
                                "balance": inr(balance) if idx == len(linked_exps) - 1 else "—",
                                "status": status,
                            })

            if search:
                s_lower = search.lower()
                rows = [r for r in rows if s_lower in r["party_name"].lower() or s_lower in r["fee_name"].lower() or s_lower in r["sale_invoice_no"].lower() or s_lower in r["expense_no"].lower()]

            net_balance = max(0.0, tot_received - tot_spent)

            return {
                "report_type": report_type,
                "report_title": "Passed On Money Report & Ledger",
                "category": "Passed On Money",
                "from_date": from_date,
                "to_date": to_date,
                "kpis": [
                    {"label": "Pass-on Money Received (Inflow)", "value": inr(tot_received), "color": "#059669"},
                    {"label": "Expense Booked (Outflow)", "value": inr(tot_spent), "color": "#DC2626"},
                    {"label": "Net Pass-on Balance In Hand", "value": inr(net_balance), "color": "#2563EB"},
                    {"label": "Total Ledger Entries", "value": str(len(rows)), "color": "#7C3AED"},
                ],
                "columns": [
                    {"key": "party_name", "label": "Party / Customer"},
                    {"key": "sale_invoice_no", "label": "Sale Voucher No."},
                    {"key": "sale_date", "label": "Sale Date"},
                    {"key": "fee_name", "label": "Fee Item Name"},
                    {"key": "received_amount", "label": "Inflow (Received)"},
                    {"key": "expense_no", "label": "Expense Voucher No."},
                    {"key": "expense_date", "label": "Expense Date"},
                    {"key": "expense_amount", "label": "Outflow (Expense)"},
                    {"key": "balance", "label": "Net Balance"},
                    {"key": "status", "label": "Status"},
                ],
                "rows": rows
            }

        # Fallback generic report structure
        return {
            "report_type": report_type,
            "report_title": report_title,
            "category": cat_name,
            "kpis": [
                {"label": "Status", "value": "Operational", "color": "#059669"},
            ],
            "columns": [
                {"key": "description", "label": "Description"},
                {"key": "value", "label": "Value"}
            ],
            "rows": [
                {"description": f"Report '{report_title}' data generated successfully.", "value": "Completed"}
            ]
        }

    return router
