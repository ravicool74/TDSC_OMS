from datetime import datetime, timezone
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

def now_utc() -> datetime:
    return datetime.now(timezone.utc)

class Branch(BaseModel):
    id: str
    branch_id: str
    name: str
    address: Optional[str] = None
    mobile: Optional[str] = None
    email: Optional[str] = None
    branch_head: Optional[str] = None
    total_employees: int = 0
    status: str = "active"  # active, inactive
    lat: Optional[float] = None
    lng: Optional[float] = None
    radius_m: int = 200
    created_at: datetime = Field(default_factory=now_utc)
    updated_at: datetime = Field(default_factory=now_utc)

class BranchInput(BaseModel):
    name: str
    address: Optional[str] = None
    mobile: Optional[str] = None
    email: Optional[str] = None
    branch_head: Optional[str] = None
    status: str = "active"
    lat: Optional[float] = None
    lng: Optional[float] = None
    radius_m: int = 200

class BranchUpdate(BaseModel):
    name: Optional[str] = None
    address: Optional[str] = None
    mobile: Optional[str] = None
    email: Optional[str] = None
    branch_head: Optional[str] = None
    status: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    radius_m: Optional[int] = None

def make_branch_router(db, get_current_user, require_admin, log_audit):
    router = APIRouter(prefix="/branches", tags=["branches"])

    async def get_next_branch_id() -> str:
        counter = await db.counters.find_one_and_update(
            {"_id": "branch_id"},
            {"$inc": {"seq": 1}},
            upsert=True,
            return_document=True
        )
        seq = counter.get("seq", 1)
        return f"TDSC-BR-{seq:04d}"

    async def ensure_default_branches():
        count = await db.branches.count_documents({})
        if count == 0:
            offices = await db.offices.find({}).to_list(10)
            if offices:
                for off in offices:
                    bid = await get_next_branch_id()
                    b_doc = {
                        "id": off.get("id") or f"br_{bid.replace('-', '_').lower()}",
                        "branch_id": bid,
                        "name": off.get("name", "Branch Office"),
                        "city": off.get("city", "Patna"),
                        "state": off.get("state", "Bihar"),
                        "status": "active",
                        "lat": off.get("latitude") or off.get("lat") or 25.5941,
                        "lng": off.get("longitude") or off.get("lng") or 85.1376,
                        "radius_m": off.get("radius_m") or 100,
                        "total_employees": 0,
                        "created_at": now_utc(),
                        "updated_at": now_utc(),
                    }
                    await db.branches.insert_one(b_doc)
            else:
                bid = await get_next_branch_id()
                b_doc = {
                    "id": f"br_{bid.replace('-', '_').lower()}",
                    "branch_id": bid,
                    "name": "Head Office - Patna",
                    "city": "Patna",
                    "state": "Bihar",
                    "address": "Frazer Road, Patna, Bihar - 800001",
                    "mobile": "0612-220011",
                    "email": "patna@triveni.com",
                    "status": "active",
                    "lat": 25.5941,
                    "lng": 85.1376,
                    "radius_m": 100,
                    "total_employees": 0,
                    "created_at": now_utc(),
                    "updated_at": now_utc(),
                }
                await db.branches.insert_one(b_doc)

    @router.get("", response_model=List[Branch])
    async def list_branches(
        q: Optional[str] = Query(None),
        status: Optional[str] = Query(None),
        current: any = Depends(get_current_user)
    ):
        await ensure_default_branches()
        query = {}
        if status:
            query["status"] = status
        if q:
            regex = {"$regex": q.strip(), "$options": "i"}
            query["$or"] = [
                {"name": regex},
                {"branch_id": regex},
                {"address": regex},
                {"mobile": regex},
                {"email": regex},
                {"branch_head": regex},
            ]
        docs = await db.branches.find(query, {"_id": 0}).sort("created_at", -1).to_list(500)
        
        # Calculate real-time employee counts for each branch
        res = []
        for d in docs:
            emp_count = await db.employees.count_documents({"posting_branch": d.get("name")})
            if emp_count == 0:
                emp_count = await db.employees.count_documents({"branch_id": d.get("branch_id")})
            d["total_employees"] = emp_count
            res.append(Branch(**d))
        return res

    @router.get("/{bid}", response_model=Branch)
    async def get_branch(bid: str, current: any = Depends(get_current_user)):
        d = await db.branches.find_one({"$or": [{"id": bid}, {"branch_id": bid}]}, {"_id": 0})
        if not d:
            raise HTTPException(status_code=404, detail="Branch not found")
        emp_count = await db.employees.count_documents({"posting_branch": d.get("name")})
        d["total_employees"] = emp_count
        return Branch(**d)

    @router.post("", response_model=Branch)
    async def create_branch(payload: BranchInput, current: any = Depends(require_admin)):
        branch_id = await get_next_branch_id()
        oid = f"br_{branch_id.replace('-', '_').lower()}"
        now = now_utc()
        doc = payload.dict()
        doc.update({
            "id": oid,
            "branch_id": branch_id,
            "total_employees": 0,
            "created_at": now,
            "updated_at": now,
        })
        await db.branches.insert_one(doc)

        # Mirror in offices collection for backward-compatible geofence punches
        if doc.get("lat") is not None and doc.get("lng") is not None:
            await db.offices.update_one(
                {"id": oid},
                {"$set": {
                    "id": oid,
                    "name": doc["name"],
                    "address": doc.get("address"),
                    "lat": doc["lat"],
                    "lng": doc["lng"],
                    "radius_m": doc.get("radius_m", 200),
                    "created_at": now,
                }},
                upsert=True
            )

        await log_audit(db, current, "branches", "create", branch_id, None, doc)
        return Branch(**doc)

    @router.put("/{bid}", response_model=Branch)
    @router.patch("/{bid}", response_model=Branch)
    async def update_branch(bid: str, payload: BranchUpdate, current: any = Depends(require_admin)):
        existing = await db.branches.find_one({"$or": [{"id": bid}, {"branch_id": bid}]}, {"_id": 0})
        if not existing:
            raise HTTPException(status_code=404, detail="Branch not found")
        
        updates = {k: v for k, v in payload.dict().items() if v is not None}
        updates["updated_at"] = now_utc()
        
        target_id = existing["id"]
        await db.branches.update_one({"id": target_id}, {"$set": updates})

        # Update mirrored office if lat/lng changed
        if "lat" in updates or "lng" in updates or "name" in updates:
            office_updates = {}
            if "name" in updates: office_updates["name"] = updates["name"]
            if "address" in updates: office_updates["address"] = updates["address"]
            if "lat" in updates: office_updates["lat"] = updates["lat"]
            if "lng" in updates: office_updates["lng"] = updates["lng"]
            if "radius_m" in updates: office_updates["radius_m"] = updates["radius_m"]
            if office_updates:
                await db.offices.update_one({"id": target_id}, {"$set": office_updates}, upsert=True)

        updated = await db.branches.find_one({"id": target_id}, {"_id": 0})
        await log_audit(db, current, "branches", "update", existing.get("branch_id"), existing, updated)
        return Branch(**updated)

    @router.delete("/{bid}")
    async def delete_branch(bid: str, current: any = Depends(require_admin)):
        existing = await db.branches.find_one({"$or": [{"id": bid}, {"branch_id": bid}]}, {"_id": 0})
        if not existing:
            raise HTTPException(status_code=404, detail="Branch not found")
        
        target_id = existing["id"]
        res = await db.branches.delete_one({"id": target_id})
        await db.offices.delete_one({"id": target_id})
        await log_audit(db, current, "branches", "delete", existing.get("branch_id"), existing, None)
        return {"ok": True, "deleted": res.deleted_count}

    return router
