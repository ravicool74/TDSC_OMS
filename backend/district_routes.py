from datetime import datetime, timezone
from typing import List, Optional, Any
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

DEFAULT_DISTRICTS = [
    # Bihar 38 Districts
    "Araria", "Arwal", "Aurangabad", "Banka", "Begusarai", "Bhagalpur", "Bhojpur", "Buxar",
    "Darbhanga", "East Champaran (Motihari)", "Gaya", "Gopalganj", "Jamui", "Jehanabad",
    "Kaimur (Bhabua)", "Katihar", "Khagaria", "Kishanganj", "Lakhisarai", "Madhepura",
    "Madhubani", "Munger", "Muzaffarpur", "Nalanda (Bihar Sharif)", "Nawada", "Patna",
    "Purnia", "Rohtas (Sasaram)", "Saharsa", "Samastipur", "Saran (Chhapra)", "Sheikhpura",
    "Sheohar", "Sitamarhi", "Siwan", "Supaul", "Vaishali (Hajipur)", "West Champaran (Bettiah)",
    # Other Neighboring / Major Districts
    "Ranchi", "Dhanbad", "Jamshedpur", "Bokaro", "Hazaribagh", "Deoghar",
    "Varanasi", "Gorakhpur", "Prayagraj", "Lucknow", "Kolkata", "Delhi NCR"
]

class DistrictInput(BaseModel):
    name: str = Field(..., min_length=2)
    state: Optional[str] = "Bihar"
    is_active: bool = True

def make_district_router(db, get_current_user, require_admin, log_audit=None):
    router = APIRouter(prefix="/districts", tags=["districts"])

    async def _ensure_default_districts():
        count = await db.districts.count_documents({})
        if count == 0:
            docs = []
            for d_name in DEFAULT_DISTRICTS:
                docs.append({
                    "id": f"dist_{d_name.lower().replace(' ', '_').replace('(', '').replace(')', '')}",
                    "name": d_name,
                    "state": "Bihar" if "Jharkhand" not in d_name else "Jharkhand",
                    "is_active": True,
                    "created_at": now_utc(),
                })
            if docs:
                await db.districts.insert_many(docs)

    @router.get("")
    async def list_districts(
        q: Optional[str] = Query(None),
        state: Optional[str] = Query(None),
        current: Any = Depends(get_current_user)
    ):
        await _ensure_default_districts()
        query: dict = {"is_active": True}
        if state:
            query["state"] = state
        if q:
            import re
            query["name"] = {"$regex": re.escape(q.strip()), "$options": "i"}
        docs = await db.districts.find(query, {"_id": 0}).sort("name", 1).to_list(500)
        return clean_doc(docs)

    @router.post("")
    async def create_district(payload: DistrictInput, current: Any = Depends(require_admin)):
        await _ensure_default_districts()
        name_clean = payload.name.strip()
        existing = await db.districts.find_one({"name": {"$regex": f"^{name_clean}$", "$options": "i"}})
        if existing:
            raise HTTPException(status_code=400, detail=f"District '{name_clean}' already exists")

        dist_id = f"dist_{name_clean.lower().replace(' ', '_')}"
        doc = {
            "id": dist_id,
            "name": name_clean,
            "state": payload.state or "Bihar",
            "is_active": payload.is_active,
            "created_at": now_utc(),
            "created_by": current.user_id,
        }
        await db.districts.insert_one(doc)
        if log_audit:
            await log_audit(db, current, "districts", "create", dist_id, None, doc)
        return clean_doc(doc)

    return router
