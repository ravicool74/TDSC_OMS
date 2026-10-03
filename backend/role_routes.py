from datetime import datetime, timezone
from typing import List, Optional, Dict
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

def now_utc() -> datetime:
    return datetime.now(timezone.utc)

ALL_MODULES = [
    "dashboard", "branches", "posts", "users", "roles", "customers", "services",
    "tasks", "sales", "purchases", "expenses", "banking", "employees", "payroll",
    "attendance", "leaves", "gps_tracking", "documents", "reports", "notifications",
    "audit_logs", "settings"
]

ALL_ACTIONS = [
    "view", "add", "edit", "delete", "print", "download", "share",
    "approve", "reject", "cancel", "export"
]

class Role(BaseModel):
    id: str
    role_id: str
    name: str
    description: Optional[str] = None
    is_system: bool = False
    permissions: Dict[str, List[str]] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=now_utc)
    updated_at: datetime = Field(default_factory=now_utc)

class RoleInput(BaseModel):
    name: str
    description: Optional[str] = None
    permissions: Dict[str, List[str]] = Field(default_factory=dict)

class RoleUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    permissions: Optional[Dict[str, List[str]]] = None

def get_all_perms():
    return {mod: list(ALL_ACTIONS) for mod in ALL_MODULES}

DEFAULT_ROLES = [
    {
        "role_id": "super_admin",
        "name": "Super Admin",
        "description": "Unrestricted administrative system access across all modules",
        "is_system": True,
        "permissions": get_all_perms(),
    },
    {
        "role_id": "admin",
        "name": "Admin",
        "description": "Full administrative control over office, billing, and employees",
        "is_system": True,
        "permissions": get_all_perms(),
    },
    {
        "role_id": "branch_manager",
        "name": "Branch Manager",
        "description": "Manages branch operations, tasks, attendance, leaves, and accounts",
        "is_system": True,
        "permissions": {
            "dashboard": ["view", "export"],
            "branches": ["view"],
            "customers": ["view", "add", "edit", "print", "download", "share", "export"],
            "services": ["view"],
            "tasks": ["view", "add", "edit", "print", "download", "share", "approve", "reject", "cancel"],
            "sales": ["view", "add", "edit", "print", "download", "share"],
            "purchases": ["view", "add", "print", "download"],
            "expenses": ["view", "add", "edit", "print", "download"],
            "banking": ["view"],
            "employees": ["view", "edit"],
            "attendance": ["view", "add", "edit", "print", "download", "export"],
            "leaves": ["view", "approve", "reject"],
            "gps_tracking": ["view"],
            "documents": ["view", "download", "share"],
            "reports": ["view", "print", "download", "export"],
            "notifications": ["view"],
        },
    },
    {
        "role_id": "assistant_branch_manager",
        "name": "Assistant Branch Manager",
        "description": "Assists branch manager in operations, task progression, and attendance",
        "is_system": True,
        "permissions": {
            "dashboard": ["view"],
            "customers": ["view", "add", "edit", "print", "download"],
            "tasks": ["view", "add", "edit", "approve", "reject"],
            "sales": ["view", "add", "print", "download"],
            "attendance": ["view", "add"],
            "leaves": ["view"],
            "reports": ["view"],
            "notifications": ["view"],
        },
    },
    {
        "role_id": "accountant",
        "name": "Accountant",
        "description": "Vyapar accounting, sales invoicing, payments in/out, expenses, banking & tax returns",
        "is_system": True,
        "permissions": {
            "dashboard": ["view"],
            "customers": ["view", "add", "print", "download"],
            "services": ["view"],
            "tasks": ["view", "approve", "forward", "return"],
            "sales": ["view", "add", "edit", "print", "download", "share", "export"],
            "purchases": ["view", "add", "edit", "print", "download", "export"],
            "expenses": ["view", "add", "edit", "print", "download", "export"],
            "banking": ["view", "add", "edit", "export"],
            "payroll": ["view", "add", "print", "export"],
            "reports": ["view", "print", "download", "export"],
            "notifications": ["view"],
        },
    },
    {
        "role_id": "data_entry_operator",
        "name": "Data Entry Operator",
        "description": "Customer profile entry, document uploads, and task registration",
        "is_system": True,
        "permissions": {
            "dashboard": ["view"],
            "customers": ["view", "add", "edit", "print", "download"],
            "services": ["view"],
            "tasks": ["view", "add", "forward"],
            "documents": ["view", "add", "download"],
            "attendance": ["view", "add"],
            "leaves": ["view", "add"],
            "notifications": ["view"],
        },
    },
    {
        "role_id": "field_executive",
        "name": "Field Executive",
        "description": "Field client meetings, mobile GPS location updates, and task execution",
        "is_system": True,
        "permissions": {
            "dashboard": ["view"],
            "customers": ["view"],
            "tasks": ["view", "edit"],
            "attendance": ["view", "add"],
            "gps_tracking": ["add"],
            "leaves": ["view", "add"],
            "notifications": ["view"],
        },
    },
    {
        "role_id": "employee",
        "name": "Employee",
        "description": "Staff member with personal attendance, assigned tasks, and leave requests",
        "is_system": True,
        "permissions": {
            "dashboard": ["view"],
            "customers": ["view"],
            "tasks": ["view"],
            "attendance": ["view", "add"],
            "leaves": ["view", "add"],
            "notifications": ["view"],
        },
    },
]

def make_role_router(db, get_current_user, require_admin, log_audit):
    router = APIRouter(prefix="/roles", tags=["roles"])

    async def ensure_default_roles():
        for r in DEFAULT_ROLES:
            existing = await db.roles.find_one({"role_id": r["role_id"]})
            if not existing:
                now = now_utc()
                doc = dict(r)
                doc["id"] = f"rol_{r['role_id']}"
                doc["created_at"] = now
                doc["updated_at"] = now
                await db.roles.insert_one(doc)

    router.ensure_default_roles = ensure_default_roles

    @router.get("/meta")
    async def get_role_meta(current: any = Depends(get_current_user)):
        return {
            "modules": ALL_MODULES,
            "actions": ALL_ACTIONS,
        }

    @router.get("", response_model=List[Role])
    async def list_roles(current: any = Depends(get_current_user)):
        await ensure_default_roles()
        docs = await db.roles.find({}, {"_id": 0}).sort("created_at", 1).to_list(100)
        return [Role(**d) for d in docs]

    @router.get("/{rid}", response_model=Role)
    async def get_role(rid: str, current: any = Depends(get_current_user)):
        await ensure_default_roles()
        d = await db.roles.find_one({"$or": [{"id": rid}, {"role_id": rid}]}, {"_id": 0})
        if not d:
            raise HTTPException(status_code=404, detail="Role not found")
        return Role(**d)

    @router.post("", response_model=Role)
    async def create_role(payload: RoleInput, current: any = Depends(require_admin)):
        slug = payload.name.lower().replace(" ", "_")
        role_id = f"custom_{slug}"
        existing = await db.roles.find_one({"role_id": role_id})
        if existing:
            raise HTTPException(status_code=400, detail="Role with this name already exists")
        now = now_utc()
        doc = {
            "id": f"rol_{role_id}",
            "role_id": role_id,
            "name": payload.name,
            "description": payload.description,
            "is_system": False,
            "permissions": payload.permissions,
            "created_at": now,
            "updated_at": now,
        }
        await db.roles.insert_one(doc)
        await log_audit(db, current, "roles", "create", role_id, None, doc)
        return Role(**doc)

    @router.put("/{rid}", response_model=Role)
    @router.patch("/{rid}", response_model=Role)
    async def update_role(rid: str, payload: RoleUpdate, current: any = Depends(require_admin)):
        existing = await db.roles.find_one({"$or": [{"id": rid}, {"role_id": rid}]}, {"_id": 0})
        if not existing:
            raise HTTPException(status_code=404, detail="Role not found")
        
        updates = {k: v for k, v in payload.dict().items() if v is not None}
        updates["updated_at"] = now_utc()
        
        await db.roles.update_one({"id": existing["id"]}, {"$set": updates})
        updated = await db.roles.find_one({"id": existing["id"]}, {"_id": 0})
        await log_audit(db, current, "roles", "update", existing.get("role_id"), existing, updated)
        return Role(**updated)

    @router.delete("/{rid}")
    async def delete_role(rid: str, current: any = Depends(require_admin)):
        existing = await db.roles.find_one({"$or": [{"id": rid}, {"role_id": rid}]}, {"_id": 0})
        if not existing:
            raise HTTPException(status_code=404, detail="Role not found")
        if existing.get("is_system"):
            raise HTTPException(status_code=400, detail="System default roles cannot be deleted")
        
        res = await db.roles.delete_one({"id": existing["id"]})
        await log_audit(db, current, "roles", "delete", existing.get("role_id"), existing, None)
        return {"ok": True, "deleted": res.deleted_count}

    return router
