import uuid
from datetime import datetime, timezone
from typing import List, Optional, Any
from fastapi import APIRouter, Depends, HTTPException, Query, Header, Response
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from expense_approval_pdf import generate_expense_approval_pdf

def now_utc_iso() -> str:
    return datetime.now(timezone.utc).strftime("%d-%m-%Y %I:%M:%S %p")

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


def get_user_id(user: Any) -> str:
    return getattr(user, "user_id", None) or getattr(user, "id", None) or str(user)


class ExpenseLineItem(BaseModel):
    id: Optional[str] = None
    head: str = Field(..., min_length=2)
    description: Optional[str] = ""
    qty: float = 1.0
    rate: float = 0.0
    amount: float = 0.0


class ExpenseApprovalInput(BaseModel):
    customer_id: str
    customer_name: str
    customer_code: Optional[str] = ""
    customer_mobile: Optional[str] = ""
    customer_pan: Optional[str] = ""
    customer_whatsapp: Optional[str] = ""
    sale_voucher_id: str
    sale_voucher_no: str
    sale_voucher_type: Optional[str] = "invoice"
    sale_voucher_date: Optional[str] = ""
    sale_voucher_amount: float
    sale_received_amount: float
    sale_unpaid_amount: Optional[float] = 0.0
    expenses: List[ExpenseLineItem]
    notes: Optional[str] = ""
    status: Optional[str] = "submitted"


class ApproverActionInput(BaseModel):
    action: str  # 'approve', 'verify', 'reject', 'return'
    remarks: Optional[str] = None


class WorkflowConfigInput(BaseModel):
    enabled_stages: List[str] = ["submitted", "approved"]
    allow_verification_stage: bool = True
    approver_roles: List[str] = ["admin", "super_admin", "manager"]
    allow_self_approval: bool = False


def make_expense_approval_router(db, get_current_user, require_admin, log_audit=None):
    router = APIRouter(prefix="/expense-approvals", tags=["expense_approvals"])

    async def _get_workflow_config() -> dict:
        cfg = await db.expense_workflow_config.find_one({"id": "default_workflow"}, {"_id": 0})
        if not cfg:
            cfg = {
                "id": "default_workflow",
                "enabled_stages": ["submitted", "approved"],
                "allow_verification_stage": True,
                "approver_roles": ["admin", "super_admin", "manager"],
                "allow_self_approval": False,
                "updated_at": now_utc_iso(),
            }
            await db.expense_workflow_config.insert_one(cfg)
        return cfg

    async def _generate_voucher_no() -> str:
        year = datetime.now().year
        count = await db.expense_approval_vouchers.count_documents({})
        return f"EXP-APP-{year}-{(count + 1):04d}"

    @router.get("/config")
    async def get_config(current: Any = Depends(get_current_user)):
        cfg = await _get_workflow_config()
        return clean_doc(cfg)

    @router.put("/config")
    async def update_config(payload: WorkflowConfigInput, current: Any = Depends(require_admin)):
        data = payload.dict()
        data["id"] = "default_workflow"
        data["updated_at"] = now_utc_iso()
        data["updated_by"] = {"user_id": get_user_id(current), "name": current.name, "role": current.role}
        await db.expense_workflow_config.update_one({"id": "default_workflow"}, {"$set": data}, upsert=True)
        if log_audit:
            await log_audit(db, current, "expense_approval", "update_config", "default_workflow", None, data)
        return clean_doc(data)

    @router.get("/sale-vouchers")
    async def list_customer_sale_vouchers(
        customer_id: str = Query(..., description="Contractor ID"),
        current: Any = Depends(get_current_user)
    ):
        """List eligible sales vouchers/invoices for a customer with received amount and available expense limit."""
        # 1. Fetch invoices
        invoices = await db.invoices.find(
            {"party_id": customer_id},
            {"_id": 0}
        ).sort("created_at", -1).to_list(100)

        results = []
        for inv in invoices:
            inv_id = inv.get("id") or str(inv.get("invoice_no"))
            inv_no = inv.get("invoice_no") or inv.get("id")
            total = float(inv.get("total_amount") or inv.get("grand_total") or inv.get("total") or 0)
            received = float(inv.get("received_amount") or inv.get("paid_amount") or 0)
            unpaid = float(inv.get("balance_due") or inv.get("unpaid_amount") or max(0, total - received))

            # Prior pass-on expenses for this sale voucher
            prior_vouchers = await db.expense_approval_vouchers.find(
                {"sale_voucher_id": inv_id, "status": {"$in": ["submitted", "verified", "approved"]}},
                {"_id": 0, "total_expense_amount": 1}
            ).to_list(100)
            already_claimed = sum(float(v.get("total_expense_amount") or 0) for v in prior_vouchers)
            available_limit = max(0.0, received - already_claimed)

            results.append({
                "sale_voucher_id": inv_id,
                "sale_voucher_no": inv_no,
                "sale_voucher_type": "invoice",
                "sale_voucher_date": inv.get("invoice_date") or inv.get("date") or "",
                "total_amount": total,
                "received_amount": received,
                "unpaid_amount": unpaid,
                "already_approved_expenses": already_claimed,
                "available_expense_limit": available_limit,
            })

        # 2. Fetch income records (if customer has direct payment_in / advance)
        incomes = await db.income.find(
            {"client_id": customer_id},
            {"_id": 0}
        ).sort("date", -1).to_list(100)

        for inc in incomes:
            inc_id = inc.get("id") or str(inc.get("receipt_no"))
            inc_no = inc.get("receipt_no") or inc.get("id")
            amt = float(inc.get("amount") or 0)

            prior_vouchers = await db.expense_approval_vouchers.find(
                {"sale_voucher_id": inc_id, "status": {"$in": ["submitted", "verified", "approved"]}},
                {"_id": 0, "total_expense_amount": 1}
            ).to_list(100)
            already_claimed = sum(float(v.get("total_expense_amount") or 0) for v in prior_vouchers)
            available_limit = max(0.0, amt - already_claimed)

            results.append({
                "sale_voucher_id": inc_id,
                "sale_voucher_no": inc_no,
                "sale_voucher_type": "income",
                "sale_voucher_date": inc.get("date") or "",
                "total_amount": amt,
                "received_amount": amt,
                "unpaid_amount": 0.0,
                "already_approved_expenses": already_claimed,
                "available_expense_limit": available_limit,
            })

        return clean_doc(results)

    @router.get("")
    async def list_expense_approvals(
        status: Optional[str] = Query(None),
        customer_id: Optional[str] = Query(None),
        q: Optional[str] = Query(None),
        current: Any = Depends(get_current_user)
    ):
        query = {}
        if status and status != "all":
            query["status"] = status
        if customer_id and customer_id != "all":
            query["customer_id"] = customer_id
        if q:
            regex = {"$regex": q.strip(), "$options": "i"}
            query["$or"] = [
                {"voucher_no": regex},
                {"customer_name": regex},
                {"customer_code": regex},
                {"sale_voucher_no": regex},
            ]

        docs = await db.expense_approval_vouchers.find(query, {"_id": 0}).sort("created_at_dt", -1).to_list(500)
        return clean_doc(docs)

    @router.post("")
    async def create_expense_approval(
        payload: ExpenseApprovalInput,
        current: Any = Depends(get_current_user)
    ):
        """Create and submit an Expense Approval Voucher with pass-on validation."""
        # Calculate line items
        processed_items = []
        tot_expense = 0.0
        for it in payload.expenses:
            item_id = it.id or f"item_{uuid.uuid4().hex[:8]}"
            qty = float(it.qty or 1)
            rate = float(it.rate or 0)
            amt = round(qty * rate, 2)
            tot_expense += amt
            processed_items.append({
                "id": item_id,
                "head": it.head.strip(),
                "description": (it.description or "").strip(),
                "qty": qty,
                "rate": rate,
                "amount": amt,
            })

        tot_expense = round(tot_expense, 2)
        if tot_expense <= 0:
            raise HTTPException(status_code=400, detail="Total expense must be greater than zero.")

        # CRITICAL PASS-ON RULE CHECK:
        # Cumulative pass-on expenses for this sale voucher cannot exceed sale_received_amount
        prior_vouchers = await db.expense_approval_vouchers.find(
            {"sale_voucher_id": payload.sale_voucher_id, "status": {"$in": ["submitted", "verified", "approved"]}},
            {"_id": 0, "total_expense_amount": 1}
        ).to_list(100)
        already_claimed = sum(float(v.get("total_expense_amount") or 0) for v in prior_vouchers)
        cumulative = round(already_claimed + tot_expense, 2)

        if cumulative > float(payload.sale_received_amount):
            raise HTTPException(
                status_code=400,
                detail="Expense cannot be greater than received amount"
            )

        voucher_no = await _generate_voucher_no()
        vid = f"eapp_{uuid.uuid4().hex[:12]}"
        now_str = now_utc_iso()

        # Enrich customer details if missing
        cust = await db.customers.find_one({"id": payload.customer_id}, {"_id": 0}) or {}

        doc = {
            "id": vid,
            "voucher_no": voucher_no,
            "voucher_date": datetime.now().strftime("%d-%m-%Y"),
            "customer_id": payload.customer_id,
            "customer_name": payload.customer_name or cust.get("name") or "Contractor",
            "customer_code": payload.customer_code or cust.get("customer_code") or "",
            "customer_mobile": payload.customer_mobile or cust.get("mobile") or "",
            "customer_pan": payload.customer_pan or cust.get("pan") or "",
            "customer_whatsapp": payload.customer_whatsapp or cust.get("whatsapp") or cust.get("mobile") or "",
            "sale_voucher_id": payload.sale_voucher_id,
            "sale_voucher_no": payload.sale_voucher_no,
            "sale_voucher_type": payload.sale_voucher_type or "invoice",
            "sale_voucher_date": payload.sale_voucher_date or "",
            "sale_voucher_amount": float(payload.sale_voucher_amount or 0),
            "sale_received_amount": float(payload.sale_received_amount or 0),
            "sale_unpaid_amount": float(payload.sale_unpaid_amount or 0),
            "expenses": processed_items,
            "total_expense_amount": tot_expense,
            "notes": (payload.notes or "").strip(),
            "status": payload.status or "submitted",
            "created_by": {
                "user_id": get_user_id(current),
                "name": current.name,
                "email": current.email,
                "role": current.role,
            },
            "created_at": now_str,
            "created_at_dt": datetime.now(timezone.utc),
            "updated_at": now_str,
            "workflow_history": [
                {
                    "action": "submitted" if payload.status != "draft" else "draft",
                    "actor": {"user_id": get_user_id(current), "name": current.name, "role": current.role},
                    "timestamp": now_str,
                    "remarks": "Expense approval voucher created and submitted",
                }
            ],
        }

        await db.expense_approval_vouchers.insert_one(doc)

        if log_audit:
            await log_audit(db, current, "expense_approval", "create", voucher_no, None, doc)

        return clean_doc(doc)

    @router.get("/{vid}")
    async def get_expense_approval(vid: str, current: Any = Depends(get_current_user)):
        doc = await db.expense_approval_vouchers.find_one({"$or": [{"id": vid}, {"voucher_no": vid}]}, {"_id": 0})
        if not doc:
            raise HTTPException(status_code=404, detail="Expense approval voucher not found")
        return clean_doc(doc)

    @router.put("/{vid}")
    async def update_expense_approval(
        vid: str,
        payload: ExpenseApprovalInput,
        current: Any = Depends(get_current_user)
    ):
        """Update draft or returned voucher and re-validate financial rules."""
        existing = await db.expense_approval_vouchers.find_one({"$or": [{"id": vid}, {"voucher_no": vid}]}, {"_id": 0})
        if not existing:
            raise HTTPException(status_code=404, detail="Voucher not found")

        if existing["status"] not in ("draft", "returned"):
            raise HTTPException(status_code=400, detail=f"Cannot edit voucher with status '{existing['status']}'")

        # Line items
        processed_items = []
        tot_expense = 0.0
        for it in payload.expenses:
            item_id = it.id or f"item_{uuid.uuid4().hex[:8]}"
            qty = float(it.qty or 1)
            rate = float(it.rate or 0)
            amt = round(qty * rate, 2)
            tot_expense += amt
            processed_items.append({
                "id": item_id,
                "head": it.head.strip(),
                "description": (it.description or "").strip(),
                "qty": qty,
                "rate": rate,
                "amount": amt,
            })

        tot_expense = round(tot_expense, 2)
        if tot_expense <= 0:
            raise HTTPException(status_code=400, detail="Total expense must be greater than zero.")

        # PASS-ON RULE CHECK (exclude self)
        prior_vouchers = await db.expense_approval_vouchers.find(
            {
                "sale_voucher_id": payload.sale_voucher_id,
                "status": {"$in": ["submitted", "verified", "approved"]},
                "id": {"$ne": existing["id"]}
            },
            {"_id": 0, "total_expense_amount": 1}
        ).to_list(100)
        already_claimed = sum(float(v.get("total_expense_amount") or 0) for v in prior_vouchers)
        cumulative = round(already_claimed + tot_expense, 2)

        if cumulative > float(payload.sale_received_amount):
            raise HTTPException(
                status_code=400,
                detail="Expense cannot be greater than received amount"
            )

        now_str = now_utc_iso()
        updates = {
            "expenses": processed_items,
            "total_expense_amount": tot_expense,
            "notes": (payload.notes or "").strip(),
            "status": payload.status or "submitted",
            "updated_at": now_str,
        }

        history_entry = {
            "action": "resubmitted" if payload.status == "submitted" else "edited",
            "actor": {"user_id": get_user_id(current), "name": current.name, "role": current.role},
            "timestamp": now_str,
            "remarks": "Voucher updated and resubmitted" if payload.status == "submitted" else "Voucher updated",
        }

        await db.expense_approval_vouchers.update_one(
            {"id": existing["id"]},
            {"$set": updates, "$push": {"workflow_history": history_entry}}
        )

        updated = await db.expense_approval_vouchers.find_one({"id": existing["id"]}, {"_id": 0})
        if log_audit:
            await log_audit(db, current, "expense_approval", "update", existing["voucher_no"], existing, updated)

        return clean_doc(updated)

    @router.post("/{vid}/action")
    async def process_approval_action(
        vid: str,
        payload: ApproverActionInput,
        current: Any = Depends(get_current_user)
    ):
        """Perform approver action: approve, verify, reject, return."""
        voucher = await db.expense_approval_vouchers.find_one({"$or": [{"id": vid}, {"voucher_no": vid}]}, {"_id": 0})
        if not voucher:
            raise HTTPException(status_code=404, detail="Expense approval voucher not found")

        cfg = await _get_workflow_config()
        approver_roles = cfg.get("approver_roles") or ["admin", "super_admin", "manager"]

        # Check role permission
        if current.role not in approver_roles:
            raise HTTPException(status_code=403, detail="You do not have permission to act as an approver.")

        # Self-approval check
        creator_id = voucher.get("created_by", {}).get("user_id")
        if not cfg.get("allow_self_approval", False) and get_user_id(current) == creator_id and current.role != "super_admin":
            raise HTTPException(status_code=403, detail="Self-approval is not permitted. Another authorized approver must approve this voucher.")

        action = payload.action.lower()
        now_str = now_utc_iso()
        remarks = (payload.remarks or "").strip()

        if action in ("reject", "return") and not remarks:
            raise HTTPException(status_code=400, detail=f"Mandatory remarks / reason required for action '{action}'.")

        next_status = ""
        if action == "approve":
            next_status = "approved"
        elif action == "verify":
            next_status = "verified"
        elif action == "reject":
            next_status = "rejected"
        elif action == "return":
            next_status = "returned"
        else:
            raise HTTPException(status_code=400, detail=f"Invalid action '{action}'")

        history_event = {
            "action": next_status,
            "actor": {"user_id": get_user_id(current), "name": current.name, "role": current.role},
            "timestamp": now_str,
            "remarks": remarks or f"Action {action} performed",
        }

        updates = {
            "status": next_status,
            "updated_at": now_str,
        }

        # If approved, post to general ledger / expenses collection for accounting integration
        if next_status == "approved":
            exp_id = f"exp_{uuid.uuid4().hex[:12]}"
            primary_head = voucher["expenses"][0]["head"] if voucher.get("expenses") else "Pass-on Expense"
            expense_record = {
                "id": exp_id,
                "expense_no": f"EXP-{voucher['voucher_no']}",
                "date": voucher.get("voucher_date") or datetime.now().strftime("%Y-%m-%d"),
                "category": primary_head,
                "amount": voucher.get("total_expense_amount") or 0,
                "payment_mode": "bank_transfer",
                "customer_id": voucher.get("customer_id"),
                "customer_name": voucher.get("customer_name"),
                "linked_voucher_no": voucher.get("voucher_no"),
                "sale_voucher_no": voucher.get("sale_voucher_no"),
                "status": "approved",
                "created_by": get_user_id(current),
                "created_at": now_str,
                "notes": f"Generated from approved Expense Approval Voucher {voucher['voucher_no']}. {remarks}",
            }
            await db.expenses.insert_one(expense_record)
            updates["linked_expense_id"] = exp_id

        await db.expense_approval_vouchers.update_one(
            {"id": voucher["id"]},
            {"$set": updates, "$push": {"workflow_history": history_event}}
        )

        updated = await db.expense_approval_vouchers.find_one({"id": voucher["id"]}, {"_id": 0})
        if log_audit:
            await log_audit(db, current, "expense_approval", action, voucher["voucher_no"], voucher, updated)

        return clean_doc(updated)

    @router.get("/{vid}/pdf")
    async def get_expense_approval_pdf(
        vid: str,
        token: Optional[str] = Query(None),
        authorization: Optional[str] = Header(default=None)
    ):
        """Generate and stream ReportLab PDF voucher."""
        tk = None
        if authorization and authorization.startswith("Bearer "):
            tk = authorization[7:]
        elif token:
            tk = token
        if not tk:
            raise HTTPException(status_code=401, detail="Auth required")
        session = await db.user_sessions.find_one({"session_token": tk}, {"_id": 0})
        if not session:
            raise HTTPException(status_code=401, detail="Invalid session")

        v = await db.expense_approval_vouchers.find_one({"$or": [{"id": vid}, {"voucher_no": vid}]}, {"_id": 0})
        if not v:
            raise HTTPException(status_code=404, detail="Expense approval voucher not found")

        pdf_bytes = await run_in_threadpool(generate_expense_approval_pdf, v)
        fname = f"{(v.get('voucher_no') or 'expense_voucher').replace(' ', '_')}.pdf"
        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={"Content-Disposition": f'inline; filename="{fname}"'}
        )

    return router
