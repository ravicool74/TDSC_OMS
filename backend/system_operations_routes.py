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
    total_posts: int
    total_users: int
    total_employees: int
    total_customers: int
    total_services: int
    total_tasks: int
    pending_tasks: int
    total_invoices: int
    today_sales: float
    total_receivable: float
    total_payable: float
    today_punches: int
    expiring_documents: int

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

        today_str = date.today().isoformat()
        # Today's Sales
        sales_cursor = db.invoices.find({"invoice_type": "sale", "invoice_date": today_str})
        today_sales = 0.0
        async for s in sales_cursor:
            today_sales += float(s.get("total_amount") or 0.0)

        # Receivables & Payables
        rec_cursor = db.invoices.find({"invoice_type": "sale", "status": {"$ne": "paid"}})
        total_rec = 0.0
        async for r in rec_cursor:
            total_rec += float(r.get("balance") or 0.0)

        pay_cursor = db.invoices.find({"invoice_type": "purchase", "status": {"$ne": "paid"}})
        total_pay = 0.0
        async for p in pay_cursor:
            total_pay += float(p.get("balance") or 0.0)

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
            total_posts=total_posts,
            total_users=total_users,
            total_employees=total_employees,
            total_customers=total_customers,
            total_services=total_services,
            total_tasks=total_tasks,
            pending_tasks=pending_tasks,
            total_invoices=total_invoices,
            today_sales=round(today_sales, 2),
            total_receivable=round(total_rec, 2),
            total_payable=round(total_pay, 2),
            today_punches=today_punches,
            expiring_documents=expiring_docs,
        )

    # ====== REPORTS ======
    @router.get("/reports/day-book")
    async def get_day_book(
        from_date: Optional[str] = Query(None),
        to_date: Optional[str] = Query(None),
        current: any = Depends(get_current_user)
    ):
        """Day book combining all Invoices, Expenses, Payments-in, and Cash transactions."""
        from_d = from_date or (date.today() - timedelta(days=30)).isoformat()
        to_d = to_date or date.today().isoformat()

        entries = []
        # Sales
        sales = await db.invoices.find({"invoice_date": {"$gte": from_d, "$lte": to_d}}).to_list(500)
        for s in sales:
            entries.append({
                "date": s.get("invoice_date"),
                "type": "Sale Invoice" if s.get("invoice_type") == "sale" else "Purchase Bill",
                "reference": s.get("invoice_number"),
                "party": s.get("party_name"),
                "debit": float(s.get("total_amount") or 0.0) if s.get("invoice_type") == "sale" else 0.0,
                "credit": float(s.get("total_amount") or 0.0) if s.get("invoice_type") == "purchase" else 0.0,
                "mode": s.get("payment_mode", "credit"),
            })

        # Expenses
        expenses = await db.expenses.find({"date": {"$gte": from_d, "$lte": to_d}}).to_list(500)
        for e in expenses:
            entries.append({
                "date": e.get("date"),
                "type": "Expense",
                "reference": e.get("category", "Expense"),
                "party": e.get("item_name") or e.get("note") or "General",
                "debit": 0.0,
                "credit": float(e.get("amount") or 0.0),
                "mode": e.get("payment_mode", "cash"),
            })

        # Income / Payment In
        incomes = await db.income.find({"date": {"$gte": from_d, "$lte": to_d}}).to_list(500)
        for inc in incomes:
            entries.append({
                "date": inc.get("date"),
                "type": "Payment-In",
                "reference": inc.get("source", "Receipt"),
                "party": inc.get("customer_name") or inc.get("source") or "Customer",
                "debit": float(inc.get("amount") or 0.0),
                "credit": 0.0,
                "mode": inc.get("payment_mode", "cash"),
            })

        entries.sort(key=lambda x: x.get("date") or "", reverse=True)
        total_debit = sum(e["debit"] for e in entries)
        total_credit = sum(e["credit"] for e in entries)

        return {
            "from_date": from_d,
            "to_date": to_d,
            "total_debit": round(total_debit, 2),
            "total_credit": round(total_credit, 2),
            "net_flow": round(total_debit - total_credit, 2),
            "entries": entries,
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
