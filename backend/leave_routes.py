from datetime import datetime, timezone, timedelta
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

def now_utc() -> datetime:
    return datetime.now(timezone.utc)

class LeaveCategory(BaseModel):
    id: str
    name: str  # e.g. "Casual Leave (CL)", "Sick Leave (SL)"
    code: str  # e.g. "CL", "SL", "EL", "CO"
    description: Optional[str] = None
    max_per_week: float = 1.0     # Total leave limit per week
    max_per_month: float = 1.5    # Total leave limit per month
    max_per_year: float = 12.0    # Total leave quota per year
    is_paid: bool = True
    status: str = "active"        # "active" | "inactive"
    created_at: datetime = Field(default_factory=now_utc)
    updated_at: datetime = Field(default_factory=now_utc)

class LeaveCategoryInput(BaseModel):
    name: str
    code: str
    description: Optional[str] = None
    max_per_week: float = 1.0
    max_per_month: float = 1.5
    max_per_year: float = 12.0
    is_paid: bool = True
    status: str = "active"

class LeaveCategoryUpdate(BaseModel):
    name: Optional[str] = None
    code: Optional[str] = None
    description: Optional[str] = None
    max_per_week: Optional[float] = None
    max_per_month: Optional[float] = None
    max_per_year: Optional[float] = None
    is_paid: Optional[bool] = None
    status: Optional[str] = None

class LeaveRequestItem(BaseModel):
    id: str
    user_id: str
    user_name: str
    employee_code: Optional[str] = None
    category_id: Optional[str] = None
    category_code: Optional[str] = None
    leave_type: str  # Category name or code
    from_date: str   # YYYY-MM-DD
    to_date: str     # YYYY-MM-DD
    days_count: float = 1.0
    reason: Optional[str] = None
    status: str = "pending"  # "pending", "approved", "rejected", "cancelled"
    decided_by: Optional[str] = None
    decided_by_name: Optional[str] = None
    decided_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=now_utc)

class LeaveApplyInput(BaseModel):
    category_id: Optional[str] = None
    leave_type: Optional[str] = None
    from_date: str
    to_date: str
    days_count: Optional[float] = None
    reason: Optional[str] = None

class LeaveDecisionInput(BaseModel):
    status: str  # "approved", "rejected"
    remarks: Optional[str] = None

def make_leave_router(db, get_current_user, require_admin, require_admin_or_manager, log_audit):
    router = APIRouter(prefix="", tags=["leaves"])

    async def ensure_default_categories():
        count = await db.leave_categories.count_documents({})
        if count == 0:
            defaults = [
                {
                    "id": "lvc_cl",
                    "name": "Casual Leave (CL)",
                    "code": "CL",
                    "description": "Short casual leaves for personal or urgent work",
                    "max_per_week": 1.0,
                    "max_per_month": 1.5,
                    "max_per_year": 12.0,
                    "is_paid": True,
                    "status": "active",
                    "created_at": now_utc(),
                    "updated_at": now_utc(),
                },
                {
                    "id": "lvc_sl",
                    "name": "Sick / Medical Leave (SL)",
                    "code": "SL",
                    "description": "Leave taken due to illness or medical checkup",
                    "max_per_week": 2.0,
                    "max_per_month": 2.0,
                    "max_per_year": 10.0,
                    "is_paid": True,
                    "status": "active",
                    "created_at": now_utc(),
                    "updated_at": now_utc(),
                },
                {
                    "id": "lvc_el",
                    "name": "Earned / Privilege Leave (EL)",
                    "code": "EL",
                    "description": "Annual earned leaves accrued with service tenure",
                    "max_per_week": 6.0,
                    "max_per_month": 2.5,
                    "max_per_year": 15.0,
                    "is_paid": True,
                    "status": "active",
                    "created_at": now_utc(),
                    "updated_at": now_utc(),
                },
                {
                    "id": "lvc_co",
                    "name": "Compensatory Off (CO)",
                    "code": "CO",
                    "description": "Compensatory leave for work performed on weekends or holidays",
                    "max_per_week": 1.0,
                    "max_per_month": 2.0,
                    "max_per_year": 6.0,
                    "is_paid": True,
                    "status": "active",
                    "created_at": now_utc(),
                    "updated_at": now_utc(),
                },
            ]
            await db.leave_categories.insert_many(defaults)

    # ============ LEAVE CATEGORIES MASTER (CRUD) ============

    @router.get("/leave-categories", response_model=List[LeaveCategory])
    async def list_leave_categories(current: any = Depends(get_current_user)):
        await ensure_default_categories()
        docs = await db.leave_categories.find({}, {"_id": 0}).sort("created_at", 1).to_list(100)
        return [LeaveCategory(**d) for d in docs]

    @router.post("/leave-categories", response_model=LeaveCategory)
    async def create_leave_category(payload: LeaveCategoryInput, current: any = Depends(require_admin_or_manager)):
        raw_code = payload.code.strip().upper()
        # Check duplicate code
        existing = await db.leave_categories.find_one({"code": raw_code})
        if existing:
            raise HTTPException(status_code=400, detail=f"Leave category with code '{raw_code}' already exists")
        
        cid = f"lvc_{raw_code.lower()}_{int(now_utc().timestamp())}"
        doc = payload.dict()
        doc.update({
            "id": cid,
            "code": raw_code,
            "created_at": now_utc(),
            "updated_at": now_utc(),
        })
        await db.leave_categories.insert_one(doc)
        await log_audit(db, current, "leave_categories", "create", cid, None, doc)
        return LeaveCategory(**doc)

    @router.put("/leave-categories/{cid}", response_model=LeaveCategory)
    @router.patch("/leave-categories/{cid}", response_model=LeaveCategory)
    async def update_leave_category(cid: str, payload: LeaveCategoryUpdate, current: any = Depends(require_admin_or_manager)):
        existing = await db.leave_categories.find_one({"$or": [{"id": cid}, {"code": cid.upper()}]}, {"_id": 0})
        if not existing:
            raise HTTPException(status_code=404, detail="Leave category not found")
        
        updates = {k: v for k, v in payload.dict().items() if v is not None}
        if "code" in updates:
            updates["code"] = updates["code"].strip().upper()
            # Check duplicate code on other category
            dup = await db.leave_categories.find_one({"code": updates["code"], "id": {"$ne": existing["id"]}})
            if dup:
                raise HTTPException(status_code=400, detail=f"Leave category with code '{updates['code']}' already exists")

        updates["updated_at"] = now_utc()
        target_id = existing["id"]
        await db.leave_categories.update_one({"id": target_id}, {"$set": updates})
        updated = await db.leave_categories.find_one({"id": target_id}, {"_id": 0})
        await log_audit(db, current, "leave_categories", "update", target_id, existing, updated)
        return LeaveCategory(**updated)

    @router.delete("/leave-categories/{cid}")
    async def delete_leave_category(cid: str, current: any = Depends(require_admin)):
        existing = await db.leave_categories.find_one({"$or": [{"id": cid}, {"code": cid.upper()}]}, {"_id": 0})
        if not existing:
            raise HTTPException(status_code=404, detail="Leave category not found")
        
        target_id = existing["id"]
        res = await db.leave_categories.delete_one({"id": target_id})
        await log_audit(db, current, "leave_categories", "delete", target_id, existing, None)
        return {"ok": True, "deleted": res.deleted_count}

    # ============ LEAVE BALANCES & UTILISATION SUMMARY ============

    @router.get("/leaves/balances")
    async def get_leave_balances(
        user_id: Optional[str] = Query(None),
        current: any = Depends(get_current_user)
    ):
        await ensure_default_categories()
        target_user_id = user_id if (user_id and current.role in ("admin", "manager")) else current.user_id
        
        # Get all categories
        categories = await db.leave_categories.find({"status": "active"}, {"_id": 0}).sort("created_at", 1).to_list(100)
        
        # Get current year
        curr_year = datetime.now().strftime("%Y")
        
        # Get all leaves for this user in current year
        user_leaves = await db.leaves.find({
            "user_id": target_user_id,
            "from_date": {"$regex": f"^{curr_year}"}
        }, {"_id": 0}).to_list(500)

        balances = []
        for cat in categories:
            cat_id = cat.get("id")
            cat_code = cat.get("code")
            cat_name = cat.get("name")
            
            # Filter user leaves matching this category
            matching_leaves = [
                l for l in user_leaves
                if l.get("category_id") == cat_id
                or l.get("category_code") == cat_code
                or (l.get("leave_type") and cat_code and cat_code.lower() in l.get("leave_type", "").lower())
            ]
            
            utilised_days = 0.0
            pending_days = 0.0
            for l in matching_leaves:
                status = l.get("status", "pending")
                days = float(l.get("days_count") or 1.0)
                if status == "approved":
                    utilised_days += days
                elif status == "pending":
                    pending_days += days
            
            max_year = float(cat.get("max_per_year") or 12.0)
            max_month = float(cat.get("max_per_month") or 1.5)
            max_week = float(cat.get("max_per_week") or 1.0)
            balance_days = max(0.0, round(max_year - utilised_days, 1))

            balances.append({
                "category_id": cat_id,
                "category_name": cat_name,
                "category_code": cat_code,
                "max_per_week": max_week,
                "max_per_month": max_month,
                "max_per_year": max_year,
                "utilised_leave": round(utilised_days, 1),
                "pending_leave": round(pending_days, 1),
                "balance_leave": balance_days,
                "is_paid": cat.get("is_paid", True),
                "status": cat.get("status", "active"),
            })

        return {
            "year": curr_year,
            "user_id": target_user_id,
            "balances": balances,
        }

    # ============ LEAVE APPLICATIONS (APPLY, LIST, DECIDE, DELETE) ============

    @router.get("/leaves", response_model=List[LeaveRequestItem])
    async def list_leaves(
        status: Optional[str] = Query(None),
        user_id: Optional[str] = Query(None),
        current: any = Depends(get_current_user)
    ):
        q: Dict[str, Any] = {}
        if current.role in ("admin", "manager"):
            if user_id:
                q["user_id"] = user_id
        else:
            q["user_id"] = current.user_id
        
        if status and status != "all":
            q["status"] = status

        docs = await db.leaves.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
        
        # Backfill default fields if missing in legacy records
        results = []
        for d in docs:
            if not d.get("days_count"):
                try:
                    d1 = datetime.strptime(d.get("from_date", "2026-01-01"), "%Y-%m-%d")
                    d2 = datetime.strptime(d.get("to_date", "2026-01-01"), "%Y-%m-%d")
                    d["days_count"] = max(1.0, float((d2 - d1).days + 1))
                except Exception:
                    d["days_count"] = 1.0
            results.append(LeaveRequestItem(**d))
        return results

    @router.post("/leaves", response_model=LeaveRequestItem)
    async def apply_leave(payload: LeaveApplyInput, current: any = Depends(get_current_user)):
        # Calculate days count
        days = payload.days_count
        if days is None or days <= 0:
            try:
                d1 = datetime.strptime(payload.from_date, "%Y-%m-%d")
                d2 = datetime.strptime(payload.to_date, "%Y-%m-%d")
                days = max(1.0, float((d2 - d1).days + 1))
            except Exception:
                days = 1.0

        # Resolve category if provided
        cat_name = payload.leave_type or "Casual Leave"
        cat_code = "CL"
        if payload.category_id:
            cat = await db.leave_categories.find_one({"id": payload.category_id}, {"_id": 0})
            if cat:
                cat_name = cat["name"]
                cat_code = cat["code"]

        emp = await db.employees.find_one({"email": current.email}, {"_id": 0})
        emp_code = emp.get("employee_code") if emp else None

        now = now_utc()
        lid = f"lv_{int(now.timestamp())}_{current.user_id[:6]}"
        doc = {
            "id": lid,
            "user_id": current.user_id,
            "user_name": current.name,
            "employee_code": emp_code,
            "category_id": payload.category_id,
            "category_code": cat_code,
            "leave_type": cat_name,
            "from_date": payload.from_date,
            "to_date": payload.to_date,
            "days_count": days,
            "reason": payload.reason,
            "status": "pending",
            "created_at": now,
        }
        await db.leaves.insert_one(doc)
        await log_audit(db, current, "leaves", "apply", lid, None, doc)
        return LeaveRequestItem(**doc)

    @router.patch("/leaves/{lid}", response_model=LeaveRequestItem)
    async def decide_leave(lid: str, payload: LeaveDecisionInput, current: any = Depends(require_admin_or_manager)):
        if payload.status not in ("approved", "rejected", "pending", "cancelled"):
            raise HTTPException(status_code=400, detail="Invalid status. Must be approved or rejected")
        
        existing = await db.leaves.find_one({"id": lid}, {"_id": 0})
        if not existing:
            raise HTTPException(status_code=404, detail="Leave request not found")

        now = now_utc()
        updates = {
            "status": payload.status,
            "decided_by": current.user_id,
            "decided_by_name": current.name,
            "decided_at": now,
        }
        if payload.remarks:
            updates["remarks"] = payload.remarks

        await db.leaves.update_one({"id": lid}, {"$set": updates})
        updated = await db.leaves.find_one({"id": lid}, {"_id": 0})
        await log_audit(db, current, "leaves", "decide", lid, existing, updated)
        return LeaveRequestItem(**updated)

    @router.delete("/leaves/{lid}")
    async def cancel_leave(lid: str, current: any = Depends(get_current_user)):
        existing = await db.leaves.find_one({"id": lid}, {"_id": 0})
        if not existing:
            raise HTTPException(status_code=404, detail="Leave request not found")
        
        # Only requester or admin/manager can delete
        if current.role not in ("admin", "manager") and existing.get("user_id") != current.user_id:
            raise HTTPException(status_code=403, detail="Not authorized to cancel this leave request")

        res = await db.leaves.delete_one({"id": lid})
        await log_audit(db, current, "leaves", "delete", lid, existing, None)
        return {"ok": True, "deleted": res.deleted_count}

    return router
