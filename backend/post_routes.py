from datetime import datetime, timezone
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

def now_utc() -> datetime:
    return datetime.now(timezone.utc)

class Post(BaseModel):
    id: str
    post_id: str
    title: str
    department: Optional[str] = "Operations"
    description: Optional[str] = None
    status: str = "active"  # active, inactive
    created_at: datetime = Field(default_factory=now_utc)
    updated_at: datetime = Field(default_factory=now_utc)

class PostInput(BaseModel):
    title: str
    department: Optional[str] = "Operations"
    description: Optional[str] = None
    status: str = "active"

class PostUpdate(BaseModel):
    title: Optional[str] = None
    department: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None

DEFAULT_POSTS = [
    {"title": "Branch Manager", "department": "Management", "description": "Branch in-charge & general operations lead"},
    {"title": "Assistant Branch Manager", "department": "Management", "description": "Operations assistant & branch supervision"},
    {"title": "Accountant", "department": "Finance & Accounts", "description": "Vyapar accounting, sales invoices, tax and cash book"},
    {"title": "Data Entry Operator", "department": "Operations", "description": "Data processing, customer files & tender documentation"},
    {"title": "Office Assistant", "department": "Administration", "description": "Office coordination and support duties"},
    {"title": "Field Executive", "department": "Field Operations", "description": "On-site customer visits, documentation & GPS reporting"},
]

def make_post_router(db, get_current_user, require_admin, log_audit):
    router = APIRouter(prefix="/posts", tags=["posts"])

    async def get_next_post_id() -> str:
        counter = await db.counters.find_one_and_update(
            {"_id": "post_id"},
            {"$inc": {"seq": 1}},
            upsert=True,
            return_document=True
        )
        seq = counter.get("seq", 1)
        return f"TDSC-PST-{seq:03d}"

    async def ensure_default_posts():
        count = await db.posts.count_documents({})
        if count == 0:
            for item in DEFAULT_POSTS:
                pid = await get_next_post_id()
                now = now_utc()
                doc = {
                    "id": f"pst_{pid.replace('-', '_').lower()}",
                    "post_id": pid,
                    "title": item["title"],
                    "department": item["department"],
                    "description": item["description"],
                    "status": "active",
                    "created_at": now,
                    "updated_at": now,
                }
                await db.posts.insert_one(doc)

    router.ensure_default_posts = ensure_default_posts

    @router.get("", response_model=List[Post])
    async def list_posts(
        q: Optional[str] = Query(None),
        status: Optional[str] = Query(None),
        department: Optional[str] = Query(None),
        current: any = Depends(get_current_user)
    ):
        await ensure_default_posts()
        query = {}
        if status:
            query["status"] = status
        if department:
            query["department"] = department
        if q:
            regex = {"$regex": q.strip(), "$options": "i"}
            query["$or"] = [
                {"title": regex},
                {"post_id": regex},
                {"department": regex},
                {"description": regex},
            ]
        docs = await db.posts.find(query, {"_id": 0}).sort("created_at", 1).to_list(200)
        return [Post(**d) for d in docs]

    @router.get("/{pid}", response_model=Post)
    async def get_post(pid: str, current: any = Depends(get_current_user)):
        d = await db.posts.find_one({"$or": [{"id": pid}, {"post_id": pid}]}, {"_id": 0})
        if not d:
            raise HTTPException(status_code=404, detail="Post not found")
        return Post(**d)

    @router.post("", response_model=Post)
    async def create_post(payload: PostInput, current: any = Depends(require_admin)):
        pid = await get_next_post_id()
        now = now_utc()
        doc = payload.dict()
        doc.update({
            "id": f"pst_{pid.replace('-', '_').lower()}",
            "post_id": pid,
            "created_at": now,
            "updated_at": now,
        })
        await db.posts.insert_one(doc)
        await log_audit(db, current, "posts", "create", pid, None, doc)
        return Post(**doc)

    @router.put("/{pid}", response_model=Post)
    @router.patch("/{pid}", response_model=Post)
    async def update_post(pid: str, payload: PostUpdate, current: any = Depends(require_admin)):
        existing = await db.posts.find_one({"$or": [{"id": pid}, {"post_id": pid}]}, {"_id": 0})
        if not existing:
            raise HTTPException(status_code=404, detail="Post not found")
        
        updates = {k: v for k, v in payload.dict().items() if v is not None}
        updates["updated_at"] = now_utc()
        
        await db.posts.update_one({"id": existing["id"]}, {"$set": updates})
        updated = await db.posts.find_one({"id": existing["id"]}, {"_id": 0})
        await log_audit(db, current, "posts", "update", existing.get("post_id"), existing, updated)
        return Post(**updated)

    @router.delete("/{pid}")
    async def delete_post(pid: str, current: any = Depends(require_admin)):
        existing = await db.posts.find_one({"$or": [{"id": pid}, {"post_id": pid}]}, {"_id": 0})
        if not existing:
            raise HTTPException(status_code=404, detail="Post not found")
        
        res = await db.posts.delete_one({"id": existing["id"]})
        await log_audit(db, current, "posts", "delete", existing.get("post_id"), existing, None)
        return {"ok": True, "deleted": res.deleted_count}

    return router
