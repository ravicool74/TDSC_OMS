from datetime import datetime, timezone, date, timedelta
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from security_vault import log_audit_entry, now_utc

class SearchResultItem(BaseModel):
    module: str  # customer, invoice, employee, task, document
    id: str
    title: str
    subtitle: Optional[str] = None
    route: str
    tag: Optional[str] = None

class GlobalSearchResponse(BaseModel):
    query: str
    total_matches: int
    results: List[SearchResultItem]

class SystemStats(BaseModel):
    total_branches: int
    branches: Optional[int] = None
    total_posts: int
    total_users: int
    total_employees: int
    employees: Optional[int] = None
    total_customers: int
    customers: Optional[int] = None
    total_services: int
    total_tasks: int
    pending_tasks: int
    total_invoices: int
    today_sales: float
    todays_sales: Optional[float] = None
    today_cash: Optional[float] = None
    todays_cash: Optional[float] = None
    today_inflow: Optional[float] = None
    today_outflow: Optional[float] = None
    net_closing_movement: Optional[float] = None
    total_receivable: float
    receivable: Optional[float] = None
    total_payable: float
    payable: Optional[float] = None
    today_punches: int
    expiring_documents: int
    expiring_documents_30_days: Optional[int] = None

def make_system_operations_router(db, get_current_user, require_admin):
    router = APIRouter(prefix="/system", tags=["system-operations"])

    # ====== GLOBAL SEARCH ======
    @router.get("/search", response_model=GlobalSearchResponse)
    async def global_search(
        q: str = Query(..., min_length=1),
        current: any = Depends(get_current_user)
    ):
        clean_q = q.strip()
        regex = {"$regex": clean_q, "$options": "i"}
        results: List[SearchResultItem] = []

        # 1. Search Customers
        cust_cursor = db.customers.find({
            "$or": [
                {"name": regex},
                {"customer_code": regex},
                {"mobile": regex},
                {"pan": regex},
                {"aadhar": regex},
                {"gst_no": regex},
                {"contractor_reg_no": regex},
            ]
        }, {"id": 1, "customer_code": 1, "name": 1, "mobile": 1, "pan": 1}).limit(10)
        async for c in cust_cursor:
            results.append(SearchResultItem(
                module="Customer",
                id=c.get("id"),
                title=c.get("name", "Unnamed Customer"),
                subtitle=f"{c.get('customer_code', '')} • {c.get('mobile', '')} • PAN: {c.get('pan', '')}",
                route=f"/customers/{c.get('id')}",
                tag="Party"
            ))

        # 2. Search Invoices
        inv_cursor = db.invoices.find({
            "$or": [
                {"invoice_number": regex},
                {"party_name": regex},
            ]
        }, {"id": 1, "invoice_number": 1, "party_name": 1, "total_amount": 1, "status": 1}).limit(10)
        async for inv in inv_cursor:
            results.append(SearchResultItem(
                module="Invoice",
                id=inv.get("id"),
                title=f"Invoice {inv.get('invoice_number', '')}",
                subtitle=f"{inv.get('party_name', '')} • ₹ {inv.get('total_amount', 0):,.2f}",
                route=f"/accounting/invoices/{inv.get('id')}",
                tag=inv.get("status", "unpaid")
            ))

        # 3. Search Employees
        emp_cursor = db.employees.find({
            "$or": [
                {"name": regex},
                {"employee_code": regex},
                {"phone": regex},
                {"designation": regex},
            ]
        }, {"id": 1, "name": 1, "employee_code": 1, "designation": 1, "posting_branch": 1}).limit(10)
        async for emp in emp_cursor:
            results.append(SearchResultItem(
                module="Employee",
                id=emp.get("id"),
                title=emp.get("name", "Employee"),
                subtitle=f"{emp.get('designation', '')} • {emp.get('posting_branch', '')}",
                route=f"/employees",
                tag=emp.get("employee_code", "Staff")
            ))

        # 4. Search Tasks
        task_cursor = db.tasks.find({
            "$or": [
                {"title": regex},
                {"task_id": regex},
                {"customer_name": regex},
            ]
        }, {"id": 1, "task_id": 1, "title": 1, "priority": 1, "status": 1}).limit(10)
        async for t in task_cursor:
            results.append(SearchResultItem(
                module="Task",
                id=t.get("id"),
                title=t.get("title", "Task"),
                subtitle=f"{t.get('task_id', '')} • Status: {t.get('status', 'pending')}",
                route=f"/tasks/{t.get('id')}",
                tag=t.get("priority", "medium")
            ))

        return GlobalSearchResponse(
            query=clean_q,
            total_matches=len(results),
            results=results
        )

    # ====== DASHBOARD & SYSTEM STATS ======
    @router.get("/stats", response_model=SystemStats)
    async def get_system_stats(current: any = Depends(get_current_user)):
        total_branches = await db.branches.count_documents({})
        total_posts = await db.posts.count_documents({})
        total_users = await db.users.count_documents({})
        total_employees = await db.employees.count_documents({})
        total_customers = await db.customers.count_documents({})
        total_services = await db.services.count_documents({})
        total_tasks = await db.tasks.count_documents({})
        pending_tasks = await db.tasks.count_documents({"status": {"$in": ["pending", "assigned", "in_progress", "under_review"]}})
        total_invoices = await db.invoices.count_documents({})

        now_utc = datetime.now(timezone.utc)
        now_ist = now_utc + timedelta(hours=5, minutes=30)
        today_dates = list(set([
            now_ist.strftime("%Y-%m-%d"),
            now_utc.strftime("%Y-%m-%d"),
            date.today().isoformat()
        ]))

        # Sales for today (Inflow & Billed Sales)
        sales = await db.invoices.find({"invoice_type": "sale"}, {"_id": 0}).to_list(1000)
        today_sales = 0.0
        today_inflow = 0.0
        for s in sales:
            d = s.get("date") or s.get("invoice_date")
            if d in today_dates:
                today_sales += float(s.get("total_amount") or 0.0)
                today_inflow += float(s.get("paid_amount") or s.get("total_amount") or 0.0)

        # Expenses for today (Outflow)
        expenses = await db.expenses.find({"status": {"$ne": "rejected"}}, {"_id": 0}).to_list(1000)
        today_outflow = 0.0
        for e in expenses:
            d = e.get("date")
            if d in today_dates:
                today_outflow += float(e.get("amount") or 0.0)

        # Purchases for today (Outflow)
        purchases = await db.invoices.find({"invoice_type": "purchase"}, {"_id": 0}).to_list(1000)
        for p in purchases:
            d = p.get("date") or p.get("invoice_date")
            if d in today_dates:
                today_outflow += float(p.get("paid_amount") or p.get("total_amount") or 0.0)

        # Net Day Book cash/bank movement for today
        today_cash = round(today_inflow - today_outflow, 2)

        # Receivables (To Receive) from Sale Invoices + Customer balances
        rec_cursor = db.invoices.find({"invoice_type": "sale"})
        total_rec = 0.0
        async for r in rec_cursor:
            r_tot = float(r.get("total_amount") or 0.0)
            r_paid = float(r.get("paid_amount") or 0.0)
            r_bal = float(r.get("balance") if r.get("balance") is not None else max(0.0, r_tot - r_paid))
            if r.get("status") != "paid" or r_bal > 0:
                total_rec += r_bal

        cust_cursor = db.customers.find({"balance": {"$gt": 0}})
        async for c in cust_cursor:
            total_rec += float(c.get("balance") or 0.0)

        # Payables (To Pay): Purchases balance + Pending Expense Approval Vouchers + Pending Expenses
        pur_cursor = db.invoices.find({"invoice_type": "purchase"})
        total_pay = 0.0
        async for p in pur_cursor:
            p_tot = float(p.get("total_amount") or 0.0)
            p_paid = float(p.get("paid_amount") or 0.0)
            p_bal = float(p.get("balance") if p.get("balance") is not None else max(0.0, p_tot - p_paid))
            if p.get("status") != "paid" or p_bal > 0:
                total_pay += p_bal

        app_cursor = db.expense_approval_vouchers.find({"status": {"$in": ["submitted", "verified", "pending"]}})
        async for a in app_cursor:
            total_pay += float(a.get("total_expense_amount") or a.get("amount") or 0.0)

        pending_exp_cursor = db.expenses.find({"status": {"$in": ["pending", "submitted", "unpaid"]}})
        async for pe in pending_exp_cursor:
            total_pay += float(pe.get("amount") or 0.0)

        total_rec = round(total_rec, 2)
        total_pay = round(total_pay, 2)

        # Today Punches
        today_dt = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0)
        today_punches = await db.punches.count_documents({"created_at": {"$gte": today_dt}})

        # Expiring documents count
        expiring_docs = await db.customers.count_documents({
            "$or": [
                {"dsc_expired_date": {"$ne": None, "$ne": ""}},
                {"encryption_expired_date": {"$ne": None, "$ne": ""}},
                {"documents.expiry_date": {"$ne": None, "$ne": ""}},
            ]
        })

        return SystemStats(
            total_branches=total_branches,
            branches=total_branches,
            total_posts=total_posts,
            total_users=total_users,
            total_employees=total_employees,
            employees=total_employees,
            total_customers=total_customers,
            customers=total_customers,
            total_services=total_services,
            total_tasks=total_tasks,
            pending_tasks=pending_tasks,
            total_invoices=total_invoices,
            today_sales=round(today_sales, 2),
            todays_sales=round(today_sales, 2),
            today_cash=round(today_cash, 2),
            todays_cash=round(today_cash, 2),
            today_inflow=round(today_inflow, 2),
            today_outflow=round(today_outflow, 2),
            net_closing_movement=round(today_cash, 2),
            total_receivable=round(total_rec, 2),
            receivable=round(total_rec, 2),
            total_payable=round(total_pay, 2),
            payable=round(total_pay, 2),
            today_punches=today_punches,
            expiring_documents=expiring_docs,
            expiring_documents_30_days=expiring_docs,
        )

    # ====== REPORTS ======
    @router.get("/reports/day-book")
    async def get_day_book(
        from_date: Optional[str] = Query(None),
        to_date: Optional[str] = Query(None),
        current: any = Depends(get_current_user)
    ):
        """Comprehensive Vyapar/Tally style Day Book with Opening & Closing Balances, Sale Receipts, Payment In, and Reconciliation."""
        now_ist = datetime.now(timezone.utc) + timedelta(hours=5, minutes=30)
        today_ist = now_ist.strftime("%Y-%m-%d")

        from_d = from_date or today_ist
        to_d = to_date or today_ist

        # 1. Bank Accounts & Opening Balances
        all_banks = await db.bank_accounts.find({"is_active": True}, {"_id": 0}).to_list(100)
        if not all_banks:
            all_banks = await db.bank_accounts.find({}, {"_id": 0}).to_list(100)

        # Standard accounts mapping:
        # (i) TRIVENI DSC AND ETENDER SERVICE PRIVATE LIMITED (SBI)
        # (ii) ANJU KUMARI (AXIS BANK)
        # (iii) Other Accounts
        # (iv) Cash in Hand

        # Calculate opening balances before from_d
        # We start with configured bank opening balance, adjusted by transactions prior to from_d
        opening_balances = []
        tot_bank_ob = 0.0

        idx_roman = ["(i)", "(ii)", "(iii)", "(iv)", "(v)", "(vi)", "(vii)"]
        r_idx = 0

        # Sort banks so SBI is (i), Axis is (ii), then others
        def bank_sort_key(b):
            acc = str(b.get("account_no") or "")
            name = (b.get("name") or "").upper()
            if "42137607814" in acc or "SBIN" in str(b.get("ifsc") or "") or "TRIVENI" in name:
                return 0
            if "915020011528516" in acc or "UTIB" in str(b.get("ifsc") or "") or "AXIS" in name:
                return 1
            return 2

        all_banks.sort(key=bank_sort_key)

        for b in all_banks:
            b_id = b.get("id")
            base_bal = float(b.get("opening_balance") or b.get("balance") or 0.0)
            account_no = b.get("account_no") or "—"
            ifsc = b.get("ifsc") or "—"
            name = b.get("name") or b.get("bank_name") or "Bank Account"
            bank_name = b.get("bank_name") or "Bank"

            opening_balances.append({
                "index": idx_roman[r_idx] if r_idx < len(idx_roman) else f"({r_idx+1})",
                "id": b_id,
                "name": name,
                "bank_name": bank_name,
                "account_no": account_no,
                "ifsc": ifsc,
                "balance": round(base_bal, 2),
                "formatted_balance": f"₹{base_bal:,.2f}",
            })
            tot_bank_ob += base_bal
            r_idx += 1

        # Cash in Hand opening balance calculation
        # Sum of cash receipts minus cash disbursements prior to from_d
        setting = await db.settings.find_one({"key": "cash_opening_balance"}, {"_id": 0})
        cash_base = float(setting.get("value", 0.0)) if setting else 0.0

        # Fetch prior cash sales & prior cash income
        prior_sales_cash = await db.invoices.find(
            {"date": {"$lt": from_d}, "payment_mode": {"$regex": "cash", "$options": "i"}},
            {"_id": 0, "paid_amount": 1, "total_amount": 1, "payment_splits": 1}
        ).to_list(1000)
        prior_cash_in = 0.0
        for s in prior_sales_cash:
            if s.get("payment_splits"):
                prior_cash_in += sum(float(ps.get("amount") or 0) for ps in s["payment_splits"] if "cash" in str(ps.get("mode") or "").lower())
            else:
                prior_cash_in += float(s.get("paid_amount") or s.get("total_amount") or 0)

        prior_inc_cash = await db.income.find(
            {"date": {"$lt": from_d}, "payment_mode": {"$regex": "cash", "$options": "i"}},
            {"_id": 0, "amount": 1, "payment_splits": 1}
        ).to_list(1000)
        for i in prior_inc_cash:
            if i.get("payment_splits"):
                prior_cash_in += sum(float(ps.get("amount") or 0) for ps in i["payment_splits"] if "cash" in str(ps.get("mode") or "").lower())
            else:
                prior_cash_in += float(i.get("amount") or 0)

        prior_exp_cash = await db.expenses.find(
            {"date": {"$lt": from_d}, "payment_mode": {"$regex": "cash", "$options": "i"}},
            {"_id": 0, "amount": 1}
        ).to_list(1000)
        prior_cash_out = sum(float(e.get("amount") or 0) for e in prior_exp_cash)

        # Prior contra cash-to-bank and bank-to-cash before from_d
        prior_contra = await db.bank_transactions.find({"transfer_date": {"$lt": from_d}}, {"_id": 0}).to_list(1000)
        prior_cash_dep = sum(
            float(t.get("amount") or 0) for t in prior_contra
            if t.get("withdraw_from") == "Cash in Hand" or (t.get("transfer_type") == "cash_to_bank" and t.get("direction") != "withdraw")
        )
        prior_cash_with = sum(
            float(t.get("amount") or 0) for t in prior_contra
            if t.get("deposit_to") == "Cash in Hand" or (t.get("transfer_type") == "bank_to_cash" and t.get("direction") == "deposit") or (t.get("transfer_type") == "cash_to_bank" and t.get("direction") == "withdraw")
        )

        cash_ob = max(0.0, round(cash_base + prior_cash_in + prior_cash_with - prior_cash_out - prior_cash_dep, 2))

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

        # 2. Receipt Amount from Sale Voucher Table
        sale_invoices = await db.invoices.find(
            {"invoice_type": "sale", "date": {"$gte": from_d, "$lte": to_d}},
            {"_id": 0}
        ).sort("date", 1).to_list(1000)

        sale_receipts = []
        sale_running = 0.0
        s_sl = 1
        for s in sale_invoices:
            paid_amt = float(s.get("paid_amount") or s.get("total_amount") or 0.0)
            if paid_amt <= 0:
                continue
            sale_running += paid_amt
            items_str = ", ".join([str(it.get("name") or it.get("item_name") or "") for it in (s.get("items") or []) if it.get("name") or it.get("item_name")])
            if not items_str:
                items_str = s.get("notes") or "Sale Invoice Services"

            p_mode = (s.get("payment_mode") or "CASH").upper()

            sale_receipts.append({
                "sl_no": s_sl,
                "date": s.get("date") or s.get("invoice_date") or from_d,
                "voucher": s.get("invoice_no") or s.get("invoice_number") or f"INV-{s_sl}",
                "ref_no": s.get("invoice_no") or s.get("invoice_number") or f"INV-{s_sl}",
                "transaction_type": "Sale Receipt",
                "party": s.get("party_name") or "Direct Customer",
                "particulars": items_str,
                "payment_mode": p_mode,
                "receipt_in": round(paid_amt, 2),
                "payment_out": 0.0,
                "cumulative_bal": round(sale_running, 2),
            })
            s_sl += 1

        total_sale_receipts = round(sale_running, 2)

        # 3. Receipt Amount from Payment In Table
        payment_incomes = await db.income.find(
            {"date": {"$gte": from_d, "$lte": to_d}},
            {"_id": 0}
        ).sort("date", 1).to_list(1000)

        payment_in_receipts = []
        payment_running = 0.0
        p_sl = 1
        for inc in payment_incomes:
            inc_amt = float(inc.get("amount") or 0.0)
            if inc_amt <= 0:
                continue
            payment_running += inc_amt

            linked_ref = inc.get("linked_voucher_no")
            if not linked_ref and inc.get("linked_vouchers"):
                linked_ref = ", ".join([lv.get("voucher_no") for lv in inc["linked_vouchers"] if lv.get("voucher_no")])
            if not linked_ref:
                linked_ref = "Direct Receipt"

            part_desc = inc.get("service_name") or inc.get("category") or inc.get("source") or inc.get("remarks") or "Part Payment Received"

            p_mode = (inc.get("payment_mode") or "CASH").upper()

            payment_in_receipts.append({
                "sl_no": p_sl,
                "date": inc.get("date") or from_d,
                "voucher": inc.get("voucher_no") or inc.get("income_no") or f"PAYIN-{p_sl}",
                "ref_no": inc.get("reference") or inc.get("voucher_no") or f"PAYIN-{p_sl}",
                "previous_voucher_ref": linked_ref,
                "transaction_type": "Payment-In Receipt",
                "party": inc.get("client_name") or inc.get("customer_name") or "Customer",
                "particulars": part_desc,
                "payment_mode": p_mode,
                "receipt_in": round(inc_amt, 2),
                "payment_out": 0.0,
                "cumulative_bal": round(payment_running, 2),
            })
            p_sl += 1

        total_payment_in_receipts = round(payment_running, 2)

        # Total O.B with Receipts during the period
        total_day_receipts = round(total_sale_receipts + total_payment_in_receipts, 2)
        total_ob_with_receipts = round(total_previous_ob + total_day_receipts, 2)

        # 3.5 Cash Deposited to Bank (Contra Transfers during period)
        contra_records = await db.bank_transactions.find(
            {
                "transfer_date": {"$gte": from_d, "$lte": to_d},
                "$or": [
                    {"withdraw_from": "Cash in Hand"},
                    {"transfer_type": "cash_to_bank"},
                    {"deposit_to": "Cash in Hand"},
                    {"transfer_type": "bank_to_cash"},
                ]
            },
            {"_id": 0}
        ).sort("transfer_date", 1).to_list(1000)

        c_u_ids = list({t.get("created_by") for t in contra_records if t.get("created_by")})
        c_u_map = {}
        if c_u_ids:
            u_docs = await db.users.find({"user_id": {"$in": c_u_ids}}, {"_id": 0, "user_id": 1, "name": 1}).to_list(len(c_u_ids))
            c_u_map = {u["user_id"]: u.get("name") for u in u_docs}

        contra_deposits = []
        contra_running = 0.0
        c_sl = 1
        bank_contra_inflow = {}
        bank_contra_outflow = {}
        total_contra_deposits = 0.0
        total_contra_withdrawals = 0.0

        for ct in contra_records:
            amt = float(ct.get("amount") or 0.0)
            if amt <= 0:
                continue

            is_cash_to_bank = (
                ct.get("withdraw_from") == "Cash in Hand" or 
                (ct.get("transfer_type") == "cash_to_bank" and ct.get("direction") != "withdraw")
            )
            is_bank_to_cash = (
                ct.get("deposit_to") == "Cash in Hand" or
                (ct.get("transfer_type") == "bank_to_cash" and ct.get("direction") == "deposit") or
                (ct.get("transfer_type") == "cash_to_bank" and ct.get("direction") == "withdraw")
            )

            depositor = ct.get("created_by_name") or c_u_map.get(ct.get("created_by")) or "Admin"

            if is_cash_to_bank:
                contra_running += amt
                total_contra_deposits += amt

                target_bank_id = ct.get("deposit_to")
                target_bank_name = ct.get("deposit_to_name")
                if not target_bank_name:
                    for b in all_banks:
                        if b.get("id") == target_bank_id:
                            target_bank_name = f"{b.get('name')} ({b.get('bank_name')})"
                            break
                if not target_bank_name:
                    target_bank_name = "Bank Account"

                bank_contra_inflow[target_bank_id] = bank_contra_inflow.get(target_bank_id, 0.0) + amt

                contra_deposits.append({
                    "sl_no": c_sl,
                    "date": ct.get("transfer_date") or from_d,
                    "voucher": ct.get("id") or f"CONTRA-{c_sl}",
                    "withdrawn_from": "Cash in Hand",
                    "deposited_to_bank": target_bank_name,
                    "bank_id": target_bank_id,
                    "deposited_by": depositor,
                    "amount": round(amt, 2),
                    "attachment_name": ct.get("attachment_name") or "Slip",
                    "attachment_path": ct.get("attachment_path"),
                    "note": ct.get("description") or f"Cash deposit into {target_bank_name}",
                    "cumulative_bal": round(contra_running, 2),
                })
                c_sl += 1
            elif is_bank_to_cash:
                total_contra_withdrawals += amt
                src_bank_id = ct.get("withdraw_from")
                bank_contra_outflow[src_bank_id] = bank_contra_outflow.get(src_bank_id, 0.0) + amt

        # 4. Expenses Breakdown (Online vs Cash)
        expenses = await db.expenses.find(
            {"date": {"$gte": from_d, "$lte": to_d}, "status": {"$ne": "rejected"}},
            {"_id": 0}
        ).sort("date", 1).to_list(1000)

        expenses_online = 0.0
        expenses_cash = 0.0
        for e in expenses:
            e_amt = float(e.get("amount") or 0.0)
            e_mode = str(e.get("payment_mode") or "cash").lower()
            if any(kw in e_mode for kw in ["bank", "online", "upi", "cheque", "neft", "rtgs", "card"]):
                expenses_online += e_amt
            else:
                expenses_cash += e_amt

        expenses_online = round(expenses_online, 2)
        expenses_cash = round(expenses_cash, 2)
        total_expenses = round(expenses_online + expenses_cash, 2)

        # 5. Closing Balances Calculation
        # For each bank account: Closing Balance = Opening Balance + Receipts into Bank - Expenses from Bank + Cash Deposited (Contra) - Cash Withdrawn
        # Cash in Hand: cash_ob + cash sales + cash income + withdrawals - cash expenses - cash deposited to bank

        cash_sales_period = sum(
            r["receipt_in"] for r in sale_receipts if "CASH" in r["payment_mode"]
        )
        cash_income_period = sum(
            r["receipt_in"] for r in payment_in_receipts if "CASH" in r["payment_mode"]
        )
        cash_cb = max(0.0, round(cash_ob + cash_sales_period + cash_income_period + total_contra_withdrawals - expenses_cash - total_contra_deposits, 2))

        # Calculate general bank receipts (non-cash)
        bank_inflow_period = round(total_day_receipts - (cash_sales_period + cash_income_period), 2)

        closing_balances = []
        c_idx = 0
        allocated_bank_cb = 0.0

        for b in all_banks:
            b_id = b.get("id")
            account_no = b.get("account_no") or "—"
            ifsc = b.get("ifsc") or "—"
            name = b.get("name") or b.get("bank_name") or "Bank Account"
            bank_name = b.get("bank_name") or "Bank"

            b_ob = float(b.get("opening_balance") or b.get("balance") or 0.0)
            b_dep = bank_contra_inflow.get(b_id, 0.0)
            b_with = bank_contra_outflow.get(b_id, 0.0)

            # If primary bank (SBI), also assign generic online inflow/expenses
            if "42137607814" in account_no or "TRIVENI" in name.upper():
                b_cb = round(b_ob + bank_inflow_period - expenses_online + b_dep - b_with, 2)
            else:
                b_cb = round(b_ob + b_dep - b_with, 2)
            allocated_bank_cb += b_cb

            closing_balances.append({
                "index": idx_roman[c_idx] if c_idx < len(idx_roman) else f"({c_idx+1})",
                "id": b_id,
                "name": name,
                "bank_name": bank_name,
                "account_no": account_no,
                "ifsc": ifsc,
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
            "balance": expenses_online,
            "formatted_balance": f"₹{expenses_online:,.2f}",
        })
        c_idx += 1

        closing_balances.append({
            "index": idx_roman[c_idx] if c_idx < len(idx_roman) else f"({c_idx+1})",
            "id": "exp_cash",
            "name": "Total Expenses by Cash",
            "bank_name": "Cash",
            "account_no": "—",
            "ifsc": "—",
            "balance": expenses_cash,
            "formatted_balance": f"₹{expenses_cash:,.2f}",
        })
        c_idx += 1

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

        # Total C.B Formula: (i)+(ii)+(iii)+(iv)+(v)+(vi)
        # Sum of all closing items (closing banks + closing cash + total online expenses + total cash expenses)
        total_cb = round(allocated_bank_cb + expenses_online + expenses_cash + cash_cb, 2)

        # 6. Verification / Reconciliation Check: Total O.B == Total C.B
        diff = round(abs(total_ob_with_receipts - total_cb), 2)
        is_balanced = (diff == 0.0 or diff < 0.01)

        # Combined chronologic list for backward compatibility with existing FlatList
        combined_entries = []
        for sr in sale_receipts:
            combined_entries.append({
                "date": sr["date"],
                "type": "Sale Invoice",
                "reference": sr["voucher"],
                "party": sr["party"],
                "debit": sr["receipt_in"],
                "credit": 0.0,
                "mode": sr["payment_mode"].lower(),
                "particulars": sr["particulars"],
            })
        for pr in payment_in_receipts:
            combined_entries.append({
                "date": pr["date"],
                "type": "Payment-In",
                "reference": pr["voucher"],
                "party": pr["party"],
                "debit": pr["receipt_in"],
                "credit": 0.0,
                "mode": pr["payment_mode"].lower(),
                "particulars": pr["particulars"],
            })
        for exp in expenses:
            combined_entries.append({
                "date": exp.get("date"),
                "type": f"Expense ({exp.get('category') or 'General'})",
                "reference": exp.get("expense_no") or "EXP",
                "party": exp.get("vendor") or exp.get("item_name") or exp.get("category") or "Expense",
                "debit": 0.0,
                "credit": float(exp.get("amount") or 0.0),
                "mode": str(exp.get("payment_mode") or "cash").lower(),
                "particulars": exp.get("note") or exp.get("category") or "",
            })
        combined_entries.sort(key=lambda x: str(x.get("date") or ""), reverse=True)

        return {
            "from_date": from_d,
            "to_date": to_d,
            "opening_balances": opening_balances,
            "total_opening_balance": total_previous_ob,
            "total_previous_ob": total_previous_ob,

            "sale_receipts": sale_receipts,
            "total_sale_receipts": total_sale_receipts,

            "payment_in_receipts": payment_in_receipts,
            "total_payment_in_receipts": total_payment_in_receipts,

            "contra_deposits": contra_deposits,
            "total_contra_deposits": round(total_contra_deposits, 2),
            "total_contra_withdrawals": round(total_contra_withdrawals, 2),

            "total_day_receipts": total_day_receipts,
            "total_ob_with_receipts": total_ob_with_receipts,

            "expenses_online": expenses_online,
            "expenses_cash": expenses_cash,
            "total_expenses": total_expenses,

            "closing_balances": closing_balances,
            "total_closing_balance": total_cb,
            "total_cb": total_cb,

            "is_balanced": is_balanced,
            "reconciliation_status": "ok" if is_balanced else "mismatch",
            "reconciliation_message": "Account is ok." if is_balanced else "Account Mismatch",
            "difference": diff,

            # Compatibility fields
            "entries": combined_entries,
            "transactions": combined_entries,
            "total_debit": total_day_receipts,
            "total_credit": total_expenses,
            "net_flow": round(total_day_receipts - total_expenses, 2),
        }

    # ====== DATABASE BACKUP ======
    @router.post("/backup")
    async def create_database_backup(current: any = Depends(require_admin)):
        """Generate a system backup metadata snapshot."""
        now = now_utc()
        collections = [
            "branches", "posts", "users", "roles", "customers", "services",
            "tasks", "invoices", "expenses", "income", "bank_accounts",
            "employees", "attendance", "leaves", "gps_tracking", "estimates",
            "proforma_invoices", "delivery_challans"
        ]
        summary = {}
        for coll in collections:
            cnt = await db[coll].count_documents({})
            summary[coll] = cnt

        backup_record = {
            "id": f"bkp_{now.strftime('%Y%m%d%H%M%S')}",
            "created_at": now,
            "created_by": current.user_id,
            "status": "success",
            "collection_counts": summary,
            "total_records": sum(summary.values()),
        }
        await db.backups.insert_one(backup_record)
        await log_audit_entry(db, current, "system", "backup", backup_record["id"], None, backup_record)
        return backup_record

    return router
