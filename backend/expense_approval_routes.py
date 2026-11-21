import uuid
from datetime import datetime, timezone
from typing import List, Optional, Any
from fastapi import APIRouter, Depends, HTTPException, Query, Header, Response
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from expense_approval_pdf import generate_expense_approval_pdf

def now_utc_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

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
    voucher_no: Optional[str] = None
    voucher_date: Optional[str] = None
    expenses: List[ExpenseLineItem]
    notes: Optional[str] = ""
    status: Optional[str] = "submitted"
    is_old_accounting: Optional[bool] = False


class ApproverActionInput(BaseModel):
    action: str  # 'approve', 'verify', 'reject', 'return', 'reopen'
    remarks: Optional[str] = None
    selected_item_ids: Optional[List[str]] = None
    approved_amount: Optional[float] = None


class WorkflowConfigInput(BaseModel):
    workflow_mode: str = "multi_stage"  # "single_stage" (Submitted -> Approved) or "multi_stage" (Submitted -> Verified -> Approved)
    stages_count: int = 2  # 1 or 2
    stage_1_name: str = "Verification Stage"
    stage_1_roles: List[str] = ["admin", "super_admin", "manager", "accountant"]
    stage_1_users: List[dict] = []  # Specific employees for Stage 1: [{"user_id": "...", "name": "...", "role": "..."}]
    stage_2_name: str = "Final Approval"
    stage_2_roles: List[str] = ["admin", "super_admin"]
    stage_2_users: List[dict] = []  # Specific employees for Stage 2: [{"user_id": "...", "name": "...", "role": "..."}]
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
                "workflow_mode": "multi_stage",
                "stages_count": 2,
                "stage_1_name": "Verification Stage",
                "stage_1_roles": ["admin", "super_admin", "manager", "accountant"],
                "stage_1_users": [],
                "stage_2_name": "Final Approval",
                "stage_2_roles": ["admin", "super_admin"],
                "stage_2_users": [],
                "enabled_stages": ["submitted", "verified", "approved"],
                "allow_verification_stage": True,
                "approver_roles": ["admin", "super_admin", "manager"],
                "allow_self_approval": False,
                "updated_at": now_utc_iso(),
            }
            await db.expense_workflow_config.insert_one(cfg)
        return cfg

    async def _generate_voucher_no(date_str: Optional[str] = None) -> str:
        from server import _next_voucher_no
        return await _next_voucher_no("new_expense_approval", date_str)

    @router.get("/next-no")
    async def get_next_expense_approval_no(date: Optional[str] = Query(None), current: Any = Depends(get_current_user)):
        from server import _get_voucher_settings, _peek_next_voucher_no
        s = await _get_voucher_settings("new_expense_approval")
        effective_date = date or s.get("date_start_from")
        next_no = await _peek_next_voucher_no("new_expense_approval", effective_date)
        return {
            "next_no": next_no,
            "voucher_mode": s.get("voucher_mode", "auto"),
            "date_start_from": s.get("date_start_from"),
            "prefix": s.get("prefix", "EXP-REQ"),
            "start_seq": s.get("start_seq", 1),
        }

    @router.get("/approver-candidates")
    async def list_approver_candidates(current: Any = Depends(get_current_user)):
        """List active employees across the organisation for workflow assignment."""
        users = await db.users.find(
            {"status": {"$ne": "inactive"}},
            {"_id": 0, "user_id": 1, "id": 1, "name": 1, "email": 1, "role": 1, "department": 1, "designation": 1}
        ).sort("name", 1).to_list(500)
        results = []
        for u in users:
            uid = u.get("user_id") or u.get("id")
            results.append({
                "user_id": uid,
                "name": u.get("name") or u.get("email") or uid,
                "email": u.get("email") or "",
                "role": u.get("role") or "employee",
                "department": u.get("department") or "",
                "designation": u.get("designation") or "",
            })
        return clean_doc(results)

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
        is_old_accounting: Optional[bool] = Query(None),
        current: Any = Depends(get_current_user)
    ):
        """List eligible sales vouchers/invoices for a customer with received amount and available expense limit."""
        inv_q: dict = {"party_id": customer_id}
        if is_old_accounting is True:
            inv_q["is_old_accounting"] = True
        elif is_old_accounting is False:
            inv_q["is_old_accounting"] = {"$ne": True}

        # 1. Fetch invoices
        invoices = await db.invoices.find(
            inv_q,
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
        is_old_accounting: Optional[bool] = Query(None),
        current: Any = Depends(get_current_user)
    ):
        query = {}
        if is_old_accounting is True:
            query["is_old_accounting"] = True
        elif is_old_accounting is False:
            query["is_old_accounting"] = {"$ne": True}
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

        custom_no = getattr(payload, "voucher_no", None)
        effective_vdate = (getattr(payload, "voucher_date", None) or "").strip() or datetime.now().strftime("%d-%m-%Y")
        if custom_no and not "preview" in str(custom_no).lower() and str(custom_no).strip():
            voucher_no = str(custom_no).strip()
        elif getattr(payload, "is_old_accounting", False):
            from server import _next_voucher_no
            voucher_no = await _next_voucher_no("old_expense_approval", effective_vdate)
        else:
            voucher_no = await _generate_voucher_no(effective_vdate)
        vid = f"eapp_{uuid.uuid4().hex[:12]}"
        now_str = now_utc_iso()

        # Enrich customer details if missing
        cust = await db.customers.find_one({"id": payload.customer_id}, {"_id": 0}) or {}

        doc = {
            "id": vid,
            "voucher_no": voucher_no,
            "voucher_date": effective_vdate,
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
            "is_old_accounting": bool(getattr(payload, "is_old_accounting", False)),
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

        is_admin = getattr(current, "role", "") in ("admin", "super_admin")
        if not is_admin and existing["status"] not in ("draft", "returned"):
            raise HTTPException(status_code=400, detail=f"Cannot edit voucher with status '{existing['status']}'. Only Admins can modify active vouchers.")

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
        target_status = payload.status if payload.status else existing.get("status", "submitted")
        updates = {
            "expenses": processed_items,
            "total_expense_amount": tot_expense,
            "notes": (payload.notes or "").strip(),
            "status": target_status,
            "updated_at": now_str,
        }

        # If already approved, also synchronize the posted expense record
        if existing.get("status") == "approved":
            primary_head = processed_items[0]["head"] if processed_items else "Pass-on Expense"
            await db.expenses.update_many(
                {
                    "$or": [
                        {"id": existing.get("linked_expense_id")},
                        {"expense_no": f"EXP-{existing['voucher_no']}"},
                        {"linked_voucher_no": existing.get("voucher_no")}
                    ]
                },
                {
                    "$set": {
                        "amount": tot_expense,
                        "category": primary_head,
                        "notes": f"Generated from approved Expense Approval Voucher {existing['voucher_no']}. {(payload.notes or '').strip()}",
                        "updated_at": now_str,
                    }
                }
            )

        action_name = "edited_by_admin" if is_admin else ("resubmitted" if target_status == "submitted" else "edited")
        remarks_msg = f"Voucher updated by {current.name} (Admin)" if is_admin else ("Voucher updated and resubmitted" if target_status == "submitted" else "Voucher updated")
        history_entry = {
            "action": action_name,
            "actor": {"user_id": get_user_id(current), "name": current.name, "role": current.role},
            "timestamp": now_str,
            "remarks": remarks_msg,
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
        """Perform approver action: approve, verify, reject, return, reopen according to configured single/multi-stage workflow."""
        voucher = await db.expense_approval_vouchers.find_one({"$or": [{"id": vid}, {"voucher_no": vid}]}, {"_id": 0})
        if not voucher:
            raise HTTPException(status_code=404, detail="Expense approval voucher not found")

        cfg = await _get_workflow_config()
        workflow_mode = cfg.get("workflow_mode", "multi_stage")
        is_admin = getattr(current, "role", "") in ("admin", "super_admin")
        uid = get_user_id(current)

        action = payload.action.lower()
        now_str = now_utc_iso()
        remarks = (payload.remarks or "").strip()

        # Self-approval check: only non-admins are restricted if allow_self_approval is False
        creator_id = voucher.get("created_by", {}).get("user_id")
        if action != "reopen" and not cfg.get("allow_self_approval", False) and uid == creator_id and not is_admin:
            raise HTTPException(status_code=403, detail="Self-approval is not permitted. Another authorized approver must approve this voucher.")

        if action in ("reject", "return") and not remarks:
            raise HTTPException(status_code=400, detail=f"Mandatory remarks / reason required for action '{action}'.")

        # Stage-specific approver check
        stage_1_roles = cfg.get("stage_1_roles") or ["admin", "super_admin", "manager", "accountant"]
        stage_1_user_ids = [u.get("user_id") for u in cfg.get("stage_1_users", []) if u.get("user_id")]
        stage_2_roles = cfg.get("stage_2_roles") or ["admin", "super_admin"]
        stage_2_user_ids = [u.get("user_id") for u in cfg.get("stage_2_users", []) if u.get("user_id")]

        next_status = ""
        updates = {
            "status": next_status,
            "updated_at": now_str,
        }

        if action == "verify":
            can_verify = is_admin or (current.role in stage_1_roles) or (uid in stage_1_user_ids)
            if not can_verify:
                raise HTTPException(status_code=403, detail="You do not have permission to verify vouchers at Stage 1.")
            next_status = "verified"
            updates["status"] = next_status

        elif action == "approve":
            # If multi-stage, must be verified first unless caller is admin or single_stage
            if workflow_mode == "multi_stage" and cfg.get("allow_verification_stage", True):
                if voucher.get("status") == "submitted" and not is_admin:
                    raise HTTPException(status_code=400, detail="This voucher requires Stage 1 Verification before Final Approval. Please verify first.")

            can_approve = is_admin or (current.role in stage_2_roles) or (uid in stage_2_user_ids)
            if not can_approve:
                raise HTTPException(status_code=403, detail="You do not have permission for Final Approval at Stage 2.")
            next_status = "approved"
            updates["status"] = next_status

            all_expenses = voucher.get("expenses") or []
            selected_ids = [str(x) for x in (payload.selected_item_ids or [])]

            if selected_ids:
                approved_items = [
                    it for idx, it in enumerate(all_expenses)
                    if (str(it.get("id")) in selected_ids or str(idx) in selected_ids)
                ]
            else:
                approved_items = all_expenses

            if payload.approved_amount is not None and float(payload.approved_amount) > 0:
                total_approved = round(float(payload.approved_amount), 2)
            else:
                total_approved = round(sum(float(it.get("amount") or 0) for it in approved_items), 2)

            updates["approved_item_ids"] = [
                (it.get("id") or str(idx)) for idx, it in enumerate(all_expenses)
                if (not selected_ids or str(it.get("id")) in selected_ids or str(idx) in selected_ids)
            ]
            updates["approved_items"] = approved_items
            updates["approved_amount"] = total_approved
            updates["total_expense_amount"] = total_approved

        elif action == "reject":
            can_reject = is_admin or (current.role in stage_1_roles) or (current.role in stage_2_roles) or (uid in stage_1_user_ids) or (uid in stage_2_user_ids)
            if not can_reject:
                raise HTTPException(status_code=403, detail="You do not have permission to reject this voucher.")
            next_status = "rejected"
            updates["status"] = next_status

        elif action == "return":
            can_return = is_admin or (current.role in stage_1_roles) or (current.role in stage_2_roles) or (uid in stage_1_user_ids) or (uid in stage_2_user_ids)
            if not can_return:
                raise HTTPException(status_code=403, detail="You do not have permission to return this voucher.")
            next_status = "returned"
            updates["status"] = next_status

        elif action == "reopen":
            if not is_admin:
                raise HTTPException(status_code=403, detail="Only Admins can reopen an expense voucher.")
            next_status = "submitted"
            updates["status"] = next_status
        else:
            raise HTTPException(status_code=400, detail=f"Invalid action '{action}'")

        history_event = {
            "action": "reopened" if action == "reopen" else next_status,
            "actor": {"user_id": uid, "name": current.name, "role": current.role},
            "timestamp": now_str,
            "remarks": remarks or (
                f"Approved {len(updates.get('approved_items', []))} item(s) totaling ₹{updates.get('approved_amount', 0):,.2f}"
                if next_status == "approved"
                else (f"Voucher reopened by {current.name} (Admin)" if action == "reopen" else f"Action {action} performed")
            ),
        }

        # If reopen, remove or unapprove linked expense in accounting ledger
        if action == "reopen":
            if voucher.get("source") == "add_expense" and voucher.get("linked_expense_id"):
                await db.expenses.update_one(
                    {"id": voucher["linked_expense_id"]},
                    {"$set": {"status": "pending", "updated_at": now_str}}
                )
            else:
                await db.expenses.delete_many({
                    "$or": [
                        {"id": voucher.get("linked_expense_id")},
                        {"expense_no": f"EXP-{voucher['voucher_no']}"},
                        {"linked_voucher_no": voucher.get("voucher_no")}
                    ]
                })
                updates["linked_expense_id"] = None

        elif next_status == "rejected":
            if voucher.get("linked_expense_id"):
                await db.expenses.update_one(
                    {"id": voucher["linked_expense_id"]},
                    {"$set": {"status": "rejected", "updated_at": now_str}}
                )

        # If approved, post or activate in general ledger / expenses collection for accounting integration
        elif next_status == "approved":
            final_approved_amt = updates.get("total_expense_amount") or voucher.get("total_expense_amount") or 0
            approved_items_list = updates.get("approved_items") or voucher.get("expenses") or []
            primary_head = approved_items_list[0]["head"] if approved_items_list else "Pass-on Expense"

            linked_eid = voucher.get("linked_expense_id")
            existing_exp = await db.expenses.find_one({"id": linked_eid}, {"_id": 0}) if linked_eid else None

            if existing_exp:
                # Update existing expense to approved
                await db.expenses.update_one(
                    {"id": linked_eid},
                    {"$set": {
                        "status": "approved",
                        "approved_by": current.name,
                        "approved_at": now_str,
                        "amount": final_approved_amt,
                        "notes": f"Approved {len(approved_items_list)} item(s) via Workflow (Voucher: {voucher['voucher_no']}). {remarks}".strip(),
                        "updated_at": now_str,
                    }}
                )
                updates["linked_expense_id"] = linked_eid
            else:
                # Auto-seed a new approved expense into db.expenses
                is_old = bool(voucher.get("is_old_accounting"))
                exp_prefix = "OLD-EXP" if is_old else "EXP"
                exp_id = f"exp_old_{uuid.uuid4().hex[:10]}" if is_old else f"exp_{uuid.uuid4().hex[:12]}"
                expense_record = {
                    "id": exp_id,
                    "expense_no": f"{exp_prefix}-{voucher['voucher_no']}",
                    "date": voucher.get("voucher_date") or datetime.now().strftime("%Y-%m-%d"),
                    "category": primary_head,
                    "amount": final_approved_amt,
                    "payment_mode": "bank_transfer",
                    "customer_id": voucher.get("customer_id"),
                    "customer_name": voucher.get("customer_name"),
                    "linked_voucher_no": voucher.get("voucher_no"),
                    "linked_approval_id": voucher.get("id"),
                    "sale_voucher_no": voucher.get("sale_voucher_no"),
                    "status": "approved",
                    "approved_by": current.name,
                    "approved_at": now_str,
                    "created_by": uid,
                    "created_at": now_str,
                    "is_old_accounting": is_old,
                    "notes": f"Generated from approved Expense Approval Voucher {voucher['voucher_no']} ({len(approved_items_list)} items approved). {remarks}".strip(),
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

    @router.delete("/{vid}")
    async def delete_expense_approval(vid: str, current: Any = Depends(get_current_user)):
        """Delete expense approval voucher (Admin only). Also removes linked expense in general ledger."""
        if getattr(current, "role", "") not in ("admin", "super_admin"):
            raise HTTPException(status_code=403, detail="Only Admins have permission to delete expense approval vouchers.")

        existing = await db.expense_approval_vouchers.find_one(
            {"$or": [{"id": vid}, {"voucher_no": vid}]},
            {"_id": 0}
        )
        if not existing:
            raise HTTPException(status_code=404, detail="Expense approval voucher not found.")

        # Remove any linked expense posted to accounting ledger
        await db.expenses.delete_many({
            "$or": [
                {"id": existing.get("linked_expense_id")},
                {"expense_no": f"EXP-{existing['voucher_no']}"},
                {"linked_voucher_no": existing.get("voucher_no")}
            ]
        })

        # Delete the voucher document
        await db.expense_approval_vouchers.delete_one({"id": existing["id"]})

        if log_audit:
            await log_audit(db, current, "expense_approval", "delete", existing.get("voucher_no"), existing, None)

        return {"message": "Expense approval voucher deleted successfully", "id": existing["id"]}

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
