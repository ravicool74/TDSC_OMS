import os
import uuid
from datetime import datetime, timezone
from typing import List, Optional, Any
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form
from pydantic import BaseModel, EmailStr, Field

def now_utc() -> datetime:
    return datetime.now(timezone.utc)

MAX_UPLOAD_SIZE = 10 * 1024 * 1024  # 10 MB

class UserDocument(BaseModel):
    id: str
    name: str
    doc_type: Optional[str] = "Identity"  # Identity, Address, Certificate, Contract, Other
    size: int
    content_type: str
    file_path: str
    uploaded_at: datetime = Field(default_factory=now_utc)
    remarks: Optional[str] = None

class ManagedUser(BaseModel):
    user_id: str
    name: str
    username: Optional[str] = None
    email: EmailStr
    mobile: Optional[str] = None
    address: Optional[str] = None
    profile_photo: Optional[str] = None
    status: str = "active"  # active, inactive
    
    # Mapping User -> Office/Branch -> Post -> Role
    branch_id: Optional[str] = None
    branch_name: Optional[str] = None
    post_id: Optional[str] = None
    post_title: Optional[str] = None
    role_id: Optional[str] = "employee"
    role_name: Optional[str] = "Employee"
    role: str = "employee"  # backward compat string

    documents: List[UserDocument] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=now_utc)
    updated_at: datetime = Field(default_factory=now_utc)

class CreateUserInput(BaseModel):
    name: str
    username: Optional[str] = None
    email: EmailStr
    password: str
    mobile: Optional[str] = None
    address: Optional[str] = None
    profile_photo: Optional[str] = None
    status: str = "active"
    
    # User Mapping
    branch_id: Optional[str] = None
    post_id: Optional[str] = None
    role_id: Optional[str] = "employee"

class UpdateUserInput(BaseModel):
    name: Optional[str] = None
    username: Optional[str] = None
    email: Optional[EmailStr] = None
    password: Optional[str] = None
    mobile: Optional[str] = None
    address: Optional[str] = None
    profile_photo: Optional[str] = None
    status: Optional[str] = None
    
    # User Mapping
    branch_id: Optional[str] = None
    post_id: Optional[str] = None
    role_id: Optional[str] = None

class BulkUserActionInput(BaseModel):
    user_ids: List[str]
    action: str  # "set_status", "set_branch", "set_post", "set_role", "delete"
    status: Optional[str] = None
    branch_id: Optional[str] = None
    post_id: Optional[str] = None
    role_id: Optional[str] = None

def make_user_router(db, get_current_user, require_admin, hash_password, put_object, get_object, log_audit):
    router = APIRouter(prefix="/manage-users", tags=["manage-users"])

    async def get_next_user_id() -> str:
        counter = await db.counters.find_one_and_update(
            {"_id": "user_id"},
            {"$inc": {"seq": 1}},
            upsert=True,
            return_document=True
        )
        seq = counter.get("seq", 1)
        return f"TDSC-USR-{seq:06d}"

    async def enrich_mapping(doc: dict) -> dict:
        # Resolve Branch Name
        if doc.get("branch_id"):
            branch = await db.branches.find_one({"$or": [{"id": doc["branch_id"]}, {"branch_id": doc["branch_id"]}]})
            if branch:
                doc["branch_name"] = branch.get("name")
        # Resolve Post Title
        if doc.get("post_id"):
            post = await db.posts.find_one({"$or": [{"id": doc["post_id"]}, {"post_id": doc["post_id"]}]})
            if post:
                doc["post_title"] = post.get("title")
        # Resolve Role Name
        if doc.get("role_id"):
            role = await db.roles.find_one({"$or": [{"id": doc["role_id"]}, {"role_id": doc["role_id"]}]})
            if role:
                doc["role_name"] = role.get("name")
                doc["role"] = role.get("role_id")
        return doc

    @router.get("", response_model=List[ManagedUser])
    async def list_users(
        q: Optional[str] = Query(None),
        status: Optional[str] = Query(None),
        branch_id: Optional[str] = Query(None),
        role_id: Optional[str] = Query(None),
        current: any = Depends(require_admin)
    ):
        query = {}
        if status:
            query["status"] = status
        if branch_id:
            query["branch_id"] = branch_id
        if role_id:
            query["role_id"] = role_id
        if q:
            regex = {"$regex": q.strip(), "$options": "i"}
            query["$or"] = [
                {"name": regex},
                {"user_id": regex},
                {"email": regex},
                {"mobile": regex},
                {"username": regex},
                {"branch_name": regex},
                {"post_title": regex},
            ]
        
        docs = await db.users.find(query, {"_id": 0, "password_hash": 0}).sort("created_at", -1).to_list(500)
        res = []
        for d in docs:
            # Backfill defaults if user was created before mapping
            if "status" not in d: d["status"] = "active"
            if "role_id" not in d: d["role_id"] = d.get("role", "employee")
            if "documents" not in d: d["documents"] = []
            d = await enrich_mapping(d)
            res.append(ManagedUser(**d))
        return res

    @router.post("/bulk-action")
    async def bulk_user_action(payload: BulkUserActionInput, current: any = Depends(require_admin)):
        if not payload.user_ids:
            return {"ok": True, "count": 0, "message": "No users provided"}

        uids = list(set(payload.user_ids))
        now = now_utc()

        if payload.action == "delete":
            # RBAC check: cannot delete yourself
            if current.user_id in uids:
                raise HTTPException(status_code=400, detail="Cannot delete your own logged-in account in bulk deletion.")

            # RBAC check: Non-super_admin cannot delete any super_admin
            super_admins = await db.users.find({
                "user_id": {"$in": uids},
                "$or": [{"role": "super_admin"}, {"role_id": "super_admin"}]
            }).to_list(100)

            if super_admins:
                if current.role != "super_admin":
                    raise HTTPException(status_code=403, detail="Admins cannot delete Super Admin accounts.")
                total_supers = await db.users.count_documents({"$or": [{"role": "super_admin"}, {"role_id": "super_admin"}]})
                if total_supers - len(super_admins) < 1:
                    raise HTTPException(status_code=400, detail="Cannot delete all Super Admin accounts. At least one must remain.")

            await db.user_sessions.delete_many({"user_id": {"$in": uids}})
            res = await db.users.delete_many({"user_id": {"$in": uids}})
            await log_audit(db, current, "users", "bulk_delete", "bulk", None, {"deleted_uids": uids, "count": res.deleted_count})
            return {"ok": True, "count": res.deleted_count, "message": f"{res.deleted_count} user(s) deleted"}

        elif payload.action == "set_status":
            st = payload.status or "active"
            if st not in ("active", "inactive"):
                raise HTTPException(status_code=400, detail="Invalid status. Must be 'active' or 'inactive'.")
            if st == "inactive" and current.user_id in uids:
                raise HTTPException(status_code=400, detail="Cannot deactivate your own account.")

            res = await db.users.update_many(
                {"user_id": {"$in": uids}},
                {"$set": {"status": st, "updated_at": now}}
            )
            await log_audit(db, current, "users", "bulk_status", "bulk", None, {"uids": uids, "status": st})
            return {"ok": True, "count": res.modified_count, "message": f"{res.modified_count} user(s) status updated to {st}"}

        elif payload.action == "set_branch":
            branch_name = None
            if payload.branch_id:
                branch = await db.branches.find_one({"$or": [{"id": payload.branch_id}, {"branch_id": payload.branch_id}]})
                if branch:
                    branch_name = branch.get("name")
            res = await db.users.update_many(
                {"user_id": {"$in": uids}},
                {"$set": {"branch_id": payload.branch_id, "branch_name": branch_name, "updated_at": now}}
            )
            await log_audit(db, current, "users", "bulk_branch", "bulk", None, {"uids": uids, "branch_id": payload.branch_id})
            return {"ok": True, "count": res.modified_count, "message": f"{res.modified_count} user(s) branch updated"}

        elif payload.action == "set_post":
            post_title = None
            if payload.post_id:
                post = await db.posts.find_one({"$or": [{"id": payload.post_id}, {"post_id": payload.post_id}]})
                if post:
                    post_title = post.get("title")
            res = await db.users.update_many(
                {"user_id": {"$in": uids}},
                {"$set": {"post_id": payload.post_id, "post_title": post_title, "updated_at": now}}
            )
            await log_audit(db, current, "users", "bulk_post", "bulk", None, {"uids": uids, "post_id": payload.post_id})
            return {"ok": True, "count": res.modified_count, "message": f"{res.modified_count} user(s) post updated"}

        elif payload.action == "set_role":
            target_role = payload.role_id or "employee"
            if target_role == "super_admin" and current.role != "super_admin":
                raise HTTPException(status_code=403, detail="Only Super Admin can assign the Super Admin role.")

            role_name = target_role.capitalize()
            role = await db.roles.find_one({"$or": [{"id": target_role}, {"role_id": target_role}]})
            if role:
                role_name = role.get("name")

            res = await db.users.update_many(
                {"user_id": {"$in": uids}},
                {"$set": {"role": target_role, "role_id": target_role, "role_name": role_name, "updated_at": now}}
            )
            await log_audit(db, current, "users", "bulk_role", "bulk", None, {"uids": uids, "role": target_role})
            return {"ok": True, "count": res.modified_count, "message": f"{res.modified_count} user(s) role updated to {role_name}"}

        else:
            raise HTTPException(status_code=400, detail=f"Unsupported bulk action: {payload.action}")

    @router.get("/{uid}", response_model=ManagedUser)
    async def get_user(uid: str, current: any = Depends(get_current_user)):
        d = await db.users.find_one({"$or": [{"user_id": uid}, {"email": uid.lower()}]}, {"_id": 0, "password_hash": 0})
        if not d:
            raise HTTPException(status_code=404, detail="User not found")
        if "status" not in d: d["status"] = "active"
        if "role_id" not in d: d["role_id"] = d.get("role", "employee")
        if "documents" not in d: d["documents"] = []
        d = await enrich_mapping(d)
        return ManagedUser(**d)

    @router.post("", response_model=ManagedUser)
    async def create_user(payload: CreateUserInput, current: any = Depends(require_admin)):
        existing = await db.users.find_one({"email": payload.email.lower()})
        if existing:
            raise HTTPException(status_code=400, detail="Email already registered")
        
        if payload.username:
            existing_user = await db.users.find_one({"username": payload.username.lower()})
            if existing_user:
                raise HTTPException(status_code=400, detail="Username already taken")

        # RBAC Check: Admin cannot create a super_admin
        target_role = payload.role_id or "employee"
        if target_role == "super_admin" and current.role != "super_admin":
            raise HTTPException(status_code=403, detail="Only Super Admin can create another Super Admin account.")

        user_id = await get_next_user_id()
        now = now_utc()
        doc = payload.dict()
        doc["email"] = doc["email"].lower()
        if doc.get("username"):
            doc["username"] = doc["username"].lower()
        pw = doc.pop("password")
        doc["password_hash"] = hash_password(pw)
        doc["user_id"] = user_id
        doc["role"] = doc.get("role_id", "employee")
        doc["documents"] = []
        doc["created_at"] = now
        doc["updated_at"] = now
        
        doc = await enrich_mapping(doc)
        await db.users.insert_one(doc)

        safe_doc = dict(doc)
        safe_doc.pop("password_hash", None)
        await log_audit(db, current, "users", "create", user_id, None, safe_doc)
        return ManagedUser(**safe_doc)

    @router.put("/{uid}", response_model=ManagedUser)
    @router.patch("/{uid}", response_model=ManagedUser)
    async def update_user(uid: str, payload: UpdateUserInput, current: any = Depends(require_admin)):
        existing = await db.users.find_one({"user_id": uid})
        if not existing:
            raise HTTPException(status_code=404, detail="User not found")

        # RBAC Check: Admin cannot modify a super_admin
        target_is_super = existing.get("role") == "super_admin" or existing.get("role_id") == "super_admin"
        if target_is_super and current.role != "super_admin":
            raise HTTPException(status_code=403, detail="Admins cannot modify a Super Admin account. Only Super Admin can modify a Super Admin.")

        updates = {k: v for k, v in payload.dict().items() if v is not None}
        if "email" in updates:
            updates["email"] = updates["email"].lower()
            dupe = await db.users.find_one({"email": updates["email"], "user_id": {"$ne": uid}})
            if dupe:
                raise HTTPException(status_code=400, detail="Email already in use")
        
        if "username" in updates and updates["username"]:
            updates["username"] = updates["username"].lower()
            dupe = await db.users.find_one({"username": updates["username"], "user_id": {"$ne": uid}})
            if dupe:
                raise HTTPException(status_code=400, detail="Username already in use")

        # RBAC Check: Admin cannot elevate anyone to super_admin
        if updates.get("role_id") == "super_admin" and current.role != "super_admin":
            raise HTTPException(status_code=403, detail="Only Super Admin can assign the Super Admin role.")

        if "password" in updates and updates["password"]:
            updates["password_hash"] = hash_password(updates.pop("password"))

        if "role_id" in updates:
            updates["role"] = updates["role_id"]

        updates["updated_at"] = now_utc()
        
        # Enrich names if IDs changed
        enriched = await enrich_mapping(updates)
        updates.update(enriched)

        await db.users.update_one({"user_id": uid}, {"$set": updates})
        updated = await db.users.find_one({"user_id": uid}, {"_id": 0, "password_hash": 0})
        await log_audit(db, current, "users", "update", uid, None, updated)
        return ManagedUser(**updated)

    @router.delete("/{uid}")
    async def delete_user(uid: str, current: any = Depends(require_admin)):
        if current.user_id == uid:
            raise HTTPException(status_code=400, detail="Cannot delete your own account")
        existing = await db.users.find_one({"user_id": uid})
        if not existing:
            raise HTTPException(status_code=404, detail="User not found")
        
        # RBAC Check: Admin CANNOT delete super_admin. Super admin CAN delete super_admin (if not the sole one).
        target_is_super = existing.get("role") == "super_admin" or existing.get("role_id") == "super_admin"
        if target_is_super:
            if current.role != "super_admin":
                raise HTTPException(
                    status_code=403,
                    detail="Admins cannot delete a Super Admin account. Only a Super Admin can delete a Super Admin."
                )
            super_count = await db.users.count_documents({"$or": [{"role": "super_admin"}, {"role_id": "super_admin"}]})
            if super_count <= 1:
                raise HTTPException(status_code=400, detail="Cannot delete the sole remaining Super Admin account.")

        await db.user_sessions.delete_many({"user_id": uid})
        res = await db.users.delete_one({"user_id": uid})
        await log_audit(db, current, "users", "delete", uid, existing, None)
        return {"ok": True, "deleted": res.deleted_count}

    @router.post("/{uid}/documents", response_model=ManagedUser)
    async def upload_user_document(
        uid: str,
        file: UploadFile = File(...),
        doc_type: str = Form("Identity"),
        remarks: Optional[str] = Form(None),
        current: any = Depends(require_admin)
    ):
        existing = await db.users.find_one({"user_id": uid})
        if not existing:
            raise HTTPException(status_code=404, detail="User not found")

        content = await file.read()
        if len(content) > MAX_UPLOAD_SIZE:
            raise HTTPException(status_code=400, detail="File size exceeds maximum allowed 10 MB")

        # Save to local storage or cloud
        doc_id = f"udoc_{uuid.uuid4().hex[:10]}"
        storage_dir = os.path.join("uploads", "user_docs", uid)
        os.makedirs(storage_dir, exist_ok=True)
        file_path = os.path.join(storage_dir, f"{doc_id}_{file.filename}")
        with open(file_path, "wb") as f:
            f.write(content)

        doc_entry = {
            "id": doc_id,
            "name": file.filename,
            "doc_type": doc_type,
            "size": len(content),
            "content_type": file.content_type or "application/octet-stream",
            "file_path": file_path,
            "uploaded_at": now_utc(),
            "remarks": remarks,
        }

        await db.users.update_one({"user_id": uid}, {"$push": {"documents": doc_entry}})
        updated = await db.users.find_one({"user_id": uid}, {"_id": 0, "password_hash": 0})
        await log_audit(db, current, "users", "upload_document", uid, None, {"filename": file.filename, "size": len(content)})
        return ManagedUser(**updated)

    @router.delete("/{uid}/documents/{doc_id}", response_model=ManagedUser)
    async def delete_user_document(uid: str, doc_id: str, current: any = Depends(require_admin)):
        existing = await db.users.find_one({"user_id": uid})
        if not existing:
            raise HTTPException(status_code=404, detail="User not found")
        
        docs = existing.get("documents", [])
        target = next((d for d in docs if d.get("id") == doc_id), None)
        if not target:
            raise HTTPException(status_code=404, detail="Document not found")

        # Remove local file if exists
        try:
            if os.path.exists(target.get("file_path", "")):
                os.remove(target["file_path"])
        except Exception:
            pass

        await db.users.update_one({"user_id": uid}, {"$pull": {"documents": {"id": doc_id}}})
        updated = await db.users.find_one({"user_id": uid}, {"_id": 0, "password_hash": 0})
        await log_audit(db, current, "users", "delete_document", uid, target, None)
        return ManagedUser(**updated)

    return router
