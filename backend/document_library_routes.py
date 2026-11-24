import uuid
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

def now_utc() -> datetime:
    return datetime.now(timezone.utc)

def clean_doc(d: Any) -> Any:
    """Recursively strip MongoDB ObjectId and _id fields for clean JSON responses."""
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

# ============ Pydantic Models ============

class DocFolderCreate(BaseModel):
    name: str
    category: str = "general" # "general" | "forms_and_rules"
    parent_id: Optional[str] = None # Parent folder ID for nested subfolders
    description: Optional[str] = None
    icon: Optional[str] = "folder"
    color: Optional[str] = "#3b82f6"
    access_type: Optional[str] = "all" # "all" | "restricted"
    allowed_user_ids: Optional[List[str]] = Field(default_factory=list)

class DocFolderUpdate(BaseModel):
    name: Optional[str] = None
    parent_id: Optional[str] = None
    description: Optional[str] = None
    icon: Optional[str] = None
    color: Optional[str] = None
    access_type: Optional[str] = None
    allowed_user_ids: Optional[List[str]] = None

class DocFilesMove(BaseModel):
    file_ids: List[str]
    target_folder_id: str

class DocFileRowCreate(BaseModel):
    sl_no: Optional[int] = None
    file_description: str
    insert_after_id: Optional[str] = None # Insert directly below this row ID if provided
    access_type: Optional[str] = "all" # "all" | "restricted"
    allowed_user_ids: Optional[List[str]] = Field(default_factory=list)

class DocFileRowUpdate(BaseModel):
    file_description: Optional[str] = None
    sl_no: Optional[int] = None
    access_type: Optional[str] = None
    allowed_user_ids: Optional[List[str]] = None

class DocPermissionsUpdate(BaseModel):
    access_type: str = "all" # "all" | "restricted"
    allowed_user_ids: List[str] = Field(default_factory=list)

# ============ Router Factory ============

def make_document_library_router(db, get_current_user, require_admin, require_admin_or_manager, put_object, log_audit):
    router = APIRouter(prefix="/document-library", tags=["Document Library & Forms and Rules"])

    # Seed default sample folders if empty
    async def _ensure_seed_folders():
        count = await db.doc_folders.count_documents({})
        if count == 0:
            now = now_utc()
            default_folders = [
                # General Documents
                {
                    "id": f"fld_general_notices",
                    "name": "Office Notices & Circulars",
                    "category": "general",
                    "description": "General office administration circulars and policies",
                    "icon": "megaphone",
                    "color": "#3b82f6",
                    "created_by": "system",
                    "created_at": now,
                    "updated_at": now,
                },
                {
                    "id": f"fld_tender_guidelines",
                    "name": "Tender Guidelines & Manuals",
                    "category": "general",
                    "description": "E-Tendering standard operating procedures and user manuals",
                    "icon": "book",
                    "color": "#8b5cf6",
                    "created_by": "system",
                    "created_at": now,
                    "updated_at": now,
                },
                # 20. Forms & Rules
                {
                    "id": f"fld_cpwd_forms",
                    "name": "CPWD Standard Forms & Formats",
                    "category": "forms_and_rules",
                    "description": "Form 7, Form 8, Contract Conditions, and Works Manuals",
                    "icon": "document-text",
                    "color": "#f59e0b",
                    "created_by": "system",
                    "created_at": now,
                    "updated_at": now,
                },
                {
                    "id": f"fld_pwd_rules",
                    "name": "Bihar PWD / RWD Rules & Schedule of Rates",
                    "category": "forms_and_rules",
                    "description": "SOR 2026, Road specifications, and contractor registration rules",
                    "icon": "construct",
                    "color": "#10b981",
                    "created_by": "system",
                    "created_at": now,
                    "updated_at": now,
                },
                {
                    "id": f"fld_statutory_forms",
                    "name": "Statutory & GST / EPFO Formats",
                    "category": "forms_and_rules",
                    "description": "Form 27Q, GST declaration formats, and labour compliance rules",
                    "icon": "shield-checkmark",
                    "color": "#ef4444",
                    "created_by": "system",
                    "created_at": now,
                    "updated_at": now,
                },
            ]
            await db.doc_folders.insert_many(default_folders)

            # Seed initial sample lines for CPWD Forms
            cpwd_lines = [
                {
                    "id": f"dfl_cpwd_001",
                    "folder_id": "fld_cpwd_forms",
                    "category": "forms_and_rules",
                    "sl_no": 1,
                    "file_description": "CPWD Form 7 - Standard General Conditions of Contract for Item Rate Tenders",
                    "file_name": "CPWD_Form_7_General_Conditions.pdf",
                    "file_path": "documents/fld_cpwd_forms/CPWD_Form_7.pdf",
                    "file_size": 245000,
                    "content_type": "application/pdf",
                    "file_type": "pdf",
                    "created_by": "system",
                    "created_at": now,
                    "updated_at": now,
                },
                {
                    "id": f"dfl_cpwd_002",
                    "folder_id": "fld_cpwd_forms",
                    "category": "forms_and_rules",
                    "sl_no": 2,
                    "file_description": "CPWD Form 8 - Percentage Rate Tender & Contract for Works",
                    "file_name": "CPWD_Form_8_Percentage_Rate.pdf",
                    "file_path": "documents/fld_cpwd_forms/CPWD_Form_8.pdf",
                    "file_size": 312000,
                    "content_type": "application/pdf",
                    "file_type": "pdf",
                    "created_by": "system",
                    "created_at": now,
                    "updated_at": now,
                },
                {
                    "id": f"dfl_cpwd_003",
                    "folder_id": "fld_cpwd_forms",
                    "category": "forms_and_rules",
                    "sl_no": 3,
                    "file_description": "Standard Format for Bank Guarantee for Earnest Money Deposit (EMD)",
                    "file_name": "EMD_Bank_Guarantee_Format.docx",
                    "file_path": "documents/fld_cpwd_forms/EMD_BG_Format.docx",
                    "file_size": 48000,
                    "content_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    "file_type": "docx",
                    "created_by": "system",
                    "created_at": now,
                    "updated_at": now,
                },
            ]
            await db.doc_files.insert_many(cpwd_lines)

    # Admin / Manager: Get list of active users to select for permissions
    @router.get("/users-list")
    async def list_users_for_permissions(
        current: any = Depends(require_admin_or_manager),
    ):
        users = await db.users.find(
            {"status": {"$ne": "inactive"}},
            {"_id": 0, "password_hash": 0, "documents": 0}
        ).sort("name", 1).to_list(500)
        res = []
        for u in users:
            res.append({
                "user_id": u.get("user_id"),
                "name": u.get("name") or u.get("username") or "User",
                "email": u.get("email", ""),
                "role": u.get("role", "employee"),
                "branch_name": u.get("branch_name", ""),
            })
        return res

    # 1. List Folders (Filtered by permission for non-admins, supports subfolders)
    @router.get("/folders")
    async def list_folders(
        category: Optional[str] = Query(None), # "general" | "forms_and_rules" | "all"
        search: Optional[str] = Query(None),
        parent_id: Optional[str] = Query(None), # None / "root" / "all" / "<folder_id>"
        current: any = Depends(get_current_user),
    ):
        await _ensure_seed_folders()
        and_conditions = []
        if category and category != "all":
            and_conditions.append({"category": category})
        if search:
            and_conditions.append({"name": {"$regex": re.escape(search), "$options": "i"}})

        if parent_id == "all":
            pass # Return all folders regardless of nesting level
        elif parent_id and parent_id != "root":
            and_conditions.append({"parent_id": parent_id})
        else:
            # Root level folders only
            and_conditions.append({
                "$or": [
                    {"parent_id": None},
                    {"parent_id": {"$exists": False}},
                    {"parent_id": ""}
                ]
            })

        is_admin = getattr(current, "role", "employee") == "admin"
        if not is_admin:
            c_email = (getattr(current, "email", "") or "").lower()
            and_conditions.append({
                "$or": [
                    {"access_type": {"$ne": "restricted"}},
                    {"allowed_user_ids": current.user_id},
                    {"allowed_user_ids": c_email}
                ]
            })

        query = {"$and": and_conditions} if and_conditions else {}
        folders = await db.doc_folders.find(query, {"_id": 0}).sort("created_at", 1).to_list(500)

        # Attach metadata, files count and subfolders count
        for fld in folders:
            clean_doc(fld)
            fld["access_type"] = fld.get("access_type", "all")
            fld["allowed_user_ids"] = fld.get("allowed_user_ids", [])
            fld["allowed_count"] = len(fld["allowed_user_ids"])

            cnt_query: Dict[str, Any] = {"folder_id": fld["id"]}
            if not is_admin:
                c_email = (getattr(current, "email", "") or "").lower()
                cnt_query["$or"] = [
                    {"access_type": {"$ne": "restricted"}},
                    {"allowed_user_ids": current.user_id},
                    {"allowed_user_ids": c_email}
                ]
            fld["files_count"] = await db.doc_files.count_documents(cnt_query)
            fld["subfolders_count"] = await db.doc_folders.count_documents({"parent_id": fld["id"]})

        return folders

    # 2. Create Folder (+ Sign, supports subfolders via parent_id)
    @router.post("/folders")
    async def create_folder(
        payload: DocFolderCreate,
        current: any = Depends(require_admin_or_manager),
    ):
        fid = f"fld_{uuid.uuid4().hex[:10]}"
        now = now_utc()
        acc_type = payload.access_type if payload.access_type in ("all", "restricted") else "all"
        allowed = list(set(payload.allowed_user_ids or []))

        category = payload.category or "general"
        parent_id = payload.parent_id.strip() if (payload.parent_id and payload.parent_id.strip()) else None
        if parent_id:
            parent_fld = await db.doc_folders.find_one({"id": parent_id}, {"_id": 0})
            if parent_fld:
                category = parent_fld.get("category", category)

        doc = {
            "id": fid,
            "parent_id": parent_id,
            "name": payload.name.strip(),
            "category": category,
            "description": payload.description,
            "icon": payload.icon or "folder",
            "color": payload.color or "#3b82f6",
            "access_type": acc_type,
            "allowed_user_ids": allowed if acc_type == "restricted" else [],
            "created_by": current.user_id,
            "created_at": now,
            "updated_at": now,
        }
        await db.doc_folders.insert_one(doc)
        clean_doc(doc)
        doc["files_count"] = 0
        doc["subfolders_count"] = 0
        doc["allowed_count"] = len(doc.get("allowed_user_ids") or [])
        await log_audit(db, current, "doc_folders", "create", fid, None, doc)
        return doc

    # 3. Rename / Edit Folder
    @router.patch("/folders/{fid}")
    async def update_folder(
        fid: str,
        payload: DocFolderUpdate,
        current: any = Depends(require_admin_or_manager),
    ):
        existing = await db.doc_folders.find_one({"id": fid}, {"_id": 0})
        if not existing:
            raise HTTPException(status_code=404, detail="Folder not found")

        updates: Dict[str, Any] = {"updated_at": now_utc()}
        if payload.name is not None:
            updates["name"] = payload.name.strip()
        if payload.description is not None:
            updates["description"] = payload.description
        if payload.icon is not None:
            updates["icon"] = payload.icon
        if payload.color is not None:
            updates["color"] = payload.color
        if payload.parent_id is not None:
            updates["parent_id"] = payload.parent_id.strip() if payload.parent_id.strip() else None
        if payload.access_type is not None:
            updates["access_type"] = payload.access_type
            if payload.access_type != "restricted":
                updates["allowed_user_ids"] = []
        if payload.allowed_user_ids is not None:
            updates["allowed_user_ids"] = list(set(payload.allowed_user_ids))

        await db.doc_folders.update_one({"id": fid}, {"$set": updates})
        updated = await db.doc_folders.find_one({"id": fid}, {"_id": 0})
        clean_doc(updated)
        updated["files_count"] = await db.doc_files.count_documents({"folder_id": fid})
        updated["subfolders_count"] = await db.doc_folders.count_documents({"parent_id": fid})
        updated["allowed_count"] = len(updated.get("allowed_user_ids") or [])
        await log_audit(db, current, "doc_folders", "update", fid, existing, updated)
        return updated

    # 3a. Update Folder Permissions (Admin only)
    @router.patch("/folders/{fid}/permissions")
    async def update_folder_permissions(
        fid: str,
        payload: DocPermissionsUpdate,
        current: any = Depends(require_admin),
    ):
        existing = await db.doc_folders.find_one({"id": fid}, {"_id": 0})
        if not existing:
            raise HTTPException(status_code=404, detail="Folder not found")

        acc_type = payload.access_type if payload.access_type in ("all", "restricted") else "all"
        allowed = list(set(payload.allowed_user_ids or []))

        updates = {
            "access_type": acc_type,
            "allowed_user_ids": allowed if acc_type == "restricted" else [],
            "updated_at": now_utc(),
        }
        await db.doc_folders.update_one({"id": fid}, {"$set": updates})
        updated = await db.doc_folders.find_one({"id": fid}, {"_id": 0})
        clean_doc(updated)
        updated["files_count"] = await db.doc_files.count_documents({"folder_id": fid})
        updated["allowed_count"] = len(updated.get("allowed_user_ids") or [])
        await log_audit(db, current, "doc_folders", "update_permissions", fid, existing, updated)
        return updated

    async def _get_all_subfolder_ids(fid: str) -> List[str]:
        ids = [fid]
        to_check = [fid]
        while to_check:
            cur = to_check.pop(0)
            subs = await db.doc_folders.find({"parent_id": cur}, {"id": 1}).to_list(500)
            sub_ids = [s["id"] for s in subs]
            ids.extend(sub_ids)
            to_check.extend(sub_ids)
        return ids

    # 4. Delete Folder (Recursively deletes subfolders and all contained files)
    @router.delete("/folders/{fid}")
    async def delete_folder(
        fid: str,
        current: any = Depends(require_admin_or_manager),
    ):
        existing = await db.doc_folders.find_one({"id": fid}, {"_id": 0})
        if not existing:
            raise HTTPException(status_code=404, detail="Folder not found")

        all_fids = await _get_all_subfolder_ids(fid)
        # Delete all files in this folder and its subfolders
        del_files = await db.doc_files.delete_many({"folder_id": {"$in": all_fids}})
        res = await db.doc_folders.delete_many({"id": {"$in": all_fids}})
        await log_audit(db, current, "doc_folders", "delete", fid, existing, {
            "deleted_folder_ids": all_fids,
            "deleted_folders_count": res.deleted_count,
            "deleted_files_count": del_files.deleted_count
        })
        return {
            "ok": True,
            "deleted": res.deleted_count,
            "files_deleted": del_files.deleted_count,
            "folder_ids": all_fids
        }

    # =========================================================================
    # FOLDER CONTENT & FORMS & RULES TABLE (Sl. No., Description, Upload, etc.)
    # =========================================================================

    # 5. List Files & Subfolders in a Folder (Breadcrumbs, subfolders, search filter)
    @router.get("/folders/{fid}/files")
    async def list_folder_files(
        fid: str,
        search: Optional[str] = Query(None),
        current: any = Depends(get_current_user),
    ):
        fld = await db.doc_folders.find_one({"id": fid}, {"_id": 0})
        if not fld:
            raise HTTPException(status_code=404, detail="Folder not found")

        is_admin = getattr(current, "role", "employee") == "admin"
        if not is_admin:
            if fld.get("access_type") == "restricted":
                allowed = fld.get("allowed_user_ids") or []
                c_email = (getattr(current, "email", "") or "").lower()
                if current.user_id not in allowed and c_email not in [x.lower() for x in allowed]:
                    raise HTTPException(status_code=403, detail="Access denied: You do not have permission to view this folder")

        clean_doc(fld)
        fld["access_type"] = fld.get("access_type", "all")
        fld["allowed_user_ids"] = fld.get("allowed_user_ids", [])
        fld["allowed_count"] = len(fld["allowed_user_ids"])

        # Breadcrumbs resolution
        breadcrumbs = [{"id": fld["id"], "name": fld["name"]}]
        curr_p = fld.get("parent_id")
        visited = {fld["id"]}
        while curr_p and curr_p not in visited:
            visited.add(curr_p)
            p_doc = await db.doc_folders.find_one({"id": curr_p}, {"_id": 0, "id": 1, "name": 1, "parent_id": 1})
            if not p_doc:
                break
            breadcrumbs.insert(0, {"id": p_doc["id"], "name": p_doc["name"]})
            curr_p = p_doc.get("parent_id")

        # Subfolders resolution
        sf_and = [{"parent_id": fid}]
        if not is_admin:
            c_email = (getattr(current, "email", "") or "").lower()
            sf_and.append({
                "$or": [
                    {"access_type": {"$ne": "restricted"}},
                    {"allowed_user_ids": current.user_id},
                    {"allowed_user_ids": c_email}
                ]
            })
        subfolders = await db.doc_folders.find({"$and": sf_and}, {"_id": 0}).sort("created_at", 1).to_list(100)
        for sf in subfolders:
            clean_doc(sf)
            sf["access_type"] = sf.get("access_type", "all")
            sf["allowed_user_ids"] = sf.get("allowed_user_ids", [])
            sf["allowed_count"] = len(sf["allowed_user_ids"])
            sf["files_count"] = await db.doc_files.count_documents({"folder_id": sf["id"]})
            sf["subfolders_count"] = await db.doc_folders.count_documents({"parent_id": sf["id"]})

        # Files resolution
        f_and = [{"folder_id": fid}]
        if search:
            escaped = re.escape(search)
            f_and.append({
                "$or": [
                    {"file_description": {"$regex": escaped, "$options": "i"}},
                    {"file_name": {"$regex": escaped, "$options": "i"}},
                ]
            })
        if not is_admin:
            c_email = (getattr(current, "email", "") or "").lower()
            f_and.append({
                "$or": [
                    {"access_type": {"$ne": "restricted"}},
                    {"allowed_user_ids": current.user_id},
                    {"allowed_user_ids": c_email}
                ]
            })

        files = await db.doc_files.find({"$and": f_and}, {"_id": 0}).sort("sl_no", 1).to_list(500)
        for fl in files:
            clean_doc(fl)
            fl["access_type"] = fl.get("access_type", "all")
            fl["allowed_user_ids"] = fl.get("allowed_user_ids", [])
            fl["allowed_count"] = len(fl["allowed_user_ids"])

        return {
            "folder": fld,
            "breadcrumbs": breadcrumbs,
            "subfolders": subfolders,
            "files": files,
        }

    # 6. Add File / Line (when clicking + button to insert new field below)
    @router.post("/folders/{fid}/files")
    async def add_file_row(
        fid: str,
        payload: DocFileRowCreate,
        current: any = Depends(require_admin_or_manager),
    ):
        fld = await db.doc_folders.find_one({"id": fid}, {"_id": 0})
        if not fld:
            raise HTTPException(status_code=404, detail="Folder not found")

        now = now_utc()
        file_id = f"dfl_{uuid.uuid4().hex[:10]}"
        acc_type = payload.access_type if payload.access_type in ("all", "restricted") else "all"
        allowed = list(set(payload.allowed_user_ids or []))

        # Calculate sl_no
        existing_files = await db.doc_files.find({"folder_id": fid}, {"_id": 0}).sort("sl_no", 1).to_list(500)

        target_sl_no = 1
        if payload.insert_after_id:
            # Insert directly below the specified row
            after_row = next((r for r in existing_files if r["id"] == payload.insert_after_id), None)
            if after_row:
                target_sl_no = after_row.get("sl_no", 1) + 1
                # Increment sl_no for all subsequent rows
                await db.doc_files.update_many(
                    {"folder_id": fid, "sl_no": {"$gte": target_sl_no}},
                    {"$inc": {"sl_no": 1}}
                )
            else:
                target_sl_no = (existing_files[-1].get("sl_no", 0) + 1) if existing_files else 1
        elif payload.sl_no:
            target_sl_no = payload.sl_no
        else:
            target_sl_no = (existing_files[-1].get("sl_no", 0) + 1) if existing_files else 1

        doc = {
            "id": file_id,
            "folder_id": fid,
            "category": fld.get("category", "general"),
            "sl_no": target_sl_no,
            "file_description": payload.file_description.strip(),
            "file_name": None,
            "file_path": None,
            "file_size": None,
            "content_type": None,
            "file_type": None,
            "access_type": acc_type,
            "allowed_user_ids": allowed if acc_type == "restricted" else [],
            "created_by": current.user_id,
            "created_at": now,
            "updated_at": now,
        }

        await db.doc_files.insert_one(doc)
        clean_doc(doc)
        doc["allowed_count"] = len(doc.get("allowed_user_ids") or [])
        await log_audit(db, current, "doc_files", "create", file_id, None, doc)
        return doc

    # 7. Edit / Update File Row (Update Description & Sl. No.)
    @router.patch("/folders/{fid}/files/{file_id}")
    async def update_file_row(
        fid: str,
        file_id: str,
        payload: DocFileRowUpdate,
        current: any = Depends(require_admin_or_manager),
    ):
        existing = await db.doc_files.find_one({"id": file_id, "folder_id": fid}, {"_id": 0})
        if not existing:
            raise HTTPException(status_code=404, detail="File row not found")

        updates: Dict[str, Any] = {"updated_at": now_utc()}
        if payload.file_description is not None:
            updates["file_description"] = payload.file_description.strip()
        if payload.sl_no is not None:
            updates["sl_no"] = payload.sl_no
        if payload.access_type is not None:
            updates["access_type"] = payload.access_type
            if payload.access_type != "restricted":
                updates["allowed_user_ids"] = []
        if payload.allowed_user_ids is not None:
            updates["allowed_user_ids"] = list(set(payload.allowed_user_ids))

        await db.doc_files.update_one({"id": file_id}, {"$set": updates})
        updated = await db.doc_files.find_one({"id": file_id}, {"_id": 0})
        clean_doc(updated)
        updated["access_type"] = updated.get("access_type", "all")
        updated["allowed_user_ids"] = updated.get("allowed_user_ids", [])
        updated["allowed_count"] = len(updated["allowed_user_ids"])
        await log_audit(db, current, "doc_files", "update", file_id, existing, updated)
        return updated

    # 7a. Update File Row Permissions (Admin only)
    @router.patch("/folders/{fid}/files/{file_id}/permissions")
    async def update_file_row_permissions(
        fid: str,
        file_id: str,
        payload: DocPermissionsUpdate,
        current: any = Depends(require_admin),
    ):
        existing = await db.doc_files.find_one({"id": file_id, "folder_id": fid}, {"_id": 0})
        if not existing:
            raise HTTPException(status_code=404, detail="File row not found")

        acc_type = payload.access_type if payload.access_type in ("all", "restricted") else "all"
        allowed = list(set(payload.allowed_user_ids or []))

        updates = {
            "access_type": acc_type,
            "allowed_user_ids": allowed if acc_type == "restricted" else [],
            "updated_at": now_utc(),
        }
        await db.doc_files.update_one({"id": file_id}, {"$set": updates})
        updated = await db.doc_files.find_one({"id": file_id}, {"_id": 0})
        clean_doc(updated)
        updated["access_type"] = updated.get("access_type", "all")
        updated["allowed_user_ids"] = updated.get("allowed_user_ids", [])
        updated["allowed_count"] = len(updated["allowed_user_ids"])
        await log_audit(db, current, "doc_files", "update_permissions", file_id, existing, updated)
        return updated

    # 8. Delete File Row
    @router.delete("/folders/{fid}/files/{file_id}")
    async def delete_file_row(
        fid: str,
        file_id: str,
        current: any = Depends(require_admin_or_manager),
    ):
        existing = await db.doc_files.find_one({"id": file_id, "folder_id": fid}, {"_id": 0})
        if not existing:
            raise HTTPException(status_code=404, detail="File row not found")

        del_sl_no = existing.get("sl_no", 1)
        res = await db.doc_files.delete_one({"id": file_id})

        # Re-compact subsequent serial numbers
        await db.doc_files.update_many(
            {"folder_id": fid, "sl_no": {"$gt": del_sl_no}},
            {"$inc": {"sl_no": -1}}
        )

        await log_audit(db, current, "doc_files", "delete", file_id, existing, None)
        return {"ok": True, "deleted": res.deleted_count}

    # 9. Upload File Attachment to a Row
    @router.post("/folders/{fid}/files/{file_id}/upload")
    async def upload_file_attachment(
        fid: str,
        file_id: str,
        file: UploadFile = File(...),
        current: any = Depends(require_admin_or_manager),
    ):
        existing = await db.doc_files.find_one({"id": file_id, "folder_id": fid}, {"_id": 0})
        if not existing:
            raise HTTPException(status_code=404, detail="File row not found")

        data = await file.read()
        if not data:
            raise HTTPException(status_code=400, detail="Uploaded file is empty")
        if len(data) > 50 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="File size exceeds 50 MB limit")

        filename = file.filename or "document.bin"
        ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "bin"
        stored_path = f"documents/{fid}/{uuid.uuid4().hex[:8]}_{filename}"
        ct = file.content_type or "application/octet-stream"

        await run_in_threadpool(put_object, stored_path, data, ct)

        updates = {
            "file_name": filename,
            "file_path": stored_path,
            "file_size": len(data),
            "content_type": ct,
            "file_type": ext,
            "updated_at": now_utc(),
        }

        await db.doc_files.update_one({"id": file_id}, {"$set": updates})
        updated = await db.doc_files.find_one({"id": file_id}, {"_id": 0})
        clean_doc(updated)
        await log_audit(db, current, "doc_files", "upload", file_id, existing, updated)
        return updated

    # 10. Batch Upload Multiple Files directly into Folder
    @router.post("/folders/{fid}/batch-upload")
    async def batch_upload_files(
        fid: str,
        files: List[UploadFile] = File(...),
        current: any = Depends(require_admin_or_manager),
    ):
        fld = await db.doc_folders.find_one({"id": fid}, {"_id": 0})
        if not fld:
            raise HTTPException(status_code=404, detail="Folder not found")

        if not files:
            raise HTTPException(status_code=400, detail="No files uploaded")

        # Get current max sl_no
        last_file = await db.doc_files.find({"folder_id": fid}, {"sl_no": 1}).sort("sl_no", -1).to_list(1)
        base_sl = last_file[0].get("sl_no", 0) if last_file else 0

        now = now_utc()
        created_files = []

        for file in files:
            data = await file.read()
            if not data:
                continue
            if len(data) > 50 * 1024 * 1024:
                continue

            filename = file.filename or "document.bin"
            ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "bin"
            stored_path = f"documents/{fid}/{uuid.uuid4().hex[:8]}_{filename}"
            ct = file.content_type or "application/octet-stream"

            await run_in_threadpool(put_object, stored_path, data, ct)

            file_id = f"dfl_{uuid.uuid4().hex[:10]}"
            base_sl += 1

            raw_name = filename.rsplit(".", 1)[0] if "." in filename else filename
            desc = raw_name.replace("_", " ").replace("-", " ").strip()
            if not desc:
                desc = filename

            doc = {
                "id": file_id,
                "folder_id": fid,
                "category": fld.get("category", "general"),
                "sl_no": base_sl,
                "file_description": desc,
                "file_name": filename,
                "file_path": stored_path,
                "file_size": len(data),
                "content_type": ct,
                "file_type": ext,
                "access_type": fld.get("access_type", "all"),
                "allowed_user_ids": fld.get("allowed_user_ids", []),
                "created_by": current.user_id,
                "created_at": now,
                "updated_at": now,
            }
            await db.doc_files.insert_one(doc)
            clean_doc(doc)
            created_files.append(doc)

        await log_audit(db, current, "doc_files", "batch_upload", fid, None, {
            "count": len(created_files),
            "files": [f["file_name"] for f in created_files]
        })

        return {
            "ok": True,
            "count": len(created_files),
            "files": created_files,
        }

    # 11. Move Multiple Files to Target Destination Folder
    @router.post("/move-files")
    async def move_files(
        payload: DocFilesMove,
        current: any = Depends(require_admin_or_manager),
    ):
        if not payload.file_ids:
            raise HTTPException(status_code=400, detail="No files selected to move")

        target_fld = await db.doc_folders.find_one({"id": payload.target_folder_id}, {"_id": 0})
        if not target_fld:
            raise HTTPException(status_code=404, detail="Target destination folder not found")

        last_file = await db.doc_files.find({"folder_id": payload.target_folder_id}, {"sl_no": 1}).sort("sl_no", -1).to_list(1)
        base_sl = last_file[0].get("sl_no", 0) if last_file else 0

        files_to_move = await db.doc_files.find({"id": {"$in": payload.file_ids}}, {"_id": 0}).to_list(len(payload.file_ids))
        if not files_to_move:
            raise HTTPException(status_code=404, detail="No matching files found to move")

        now = now_utc()
        moved_count = 0
        source_folder_ids = set()
        for fl in files_to_move:
            source_folder_ids.add(fl.get("folder_id"))
            base_sl += 1
            await db.doc_files.update_one(
                {"id": fl["id"]},
                {
                    "$set": {
                        "folder_id": payload.target_folder_id,
                        "category": target_fld.get("category", "general"),
                        "sl_no": base_sl,
                        "updated_at": now,
                    }
                }
            )
            moved_count += 1

        # Re-compact source folder(s) sl_no
        for s_fid in source_folder_ids:
            if s_fid and s_fid != payload.target_folder_id:
                s_files = await db.doc_files.find({"folder_id": s_fid}, {"id": 1}).sort("sl_no", 1).to_list(500)
                for s_idx, sf in enumerate(s_files, 1):
                    await db.doc_files.update_one({"id": sf["id"]}, {"$set": {"sl_no": s_idx}})

        await log_audit(db, current, "doc_files", "move", payload.target_folder_id, None, {
            "file_ids": payload.file_ids,
            "target_folder_id": payload.target_folder_id,
            "count": moved_count,
        })

        return {
            "ok": True,
            "moved_count": moved_count,
            "target_folder_id": payload.target_folder_id,
            "target_folder_name": target_fld.get("name", ""),
        }

    # 12. Get Hierarchical Folders List for Move Picker
    @router.get("/folders-hierarchy")
    async def get_folders_hierarchy(
        category: Optional[str] = Query(None),
        current: any = Depends(get_current_user),
    ):
        query = {}
        if category and category != "all":
            query["category"] = category
        is_admin = getattr(current, "role", "employee") == "admin"
        if not is_admin:
            c_email = (getattr(current, "email", "") or "").lower()
            query["$or"] = [
                {"access_type": {"$ne": "restricted"}},
                {"allowed_user_ids": current.user_id},
                {"allowed_user_ids": c_email}
            ]
        all_flds = await db.doc_folders.find(query, {"_id": 0}).sort("created_at", 1).to_list(500)
        for f in all_flds:
            clean_doc(f)

        id_map = {f["id"]: f for f in all_flds}
        result = []
        for f in all_flds:
            path_parts = [f["name"]]
            cur = f.get("parent_id")
            depth = 0
            while cur and cur in id_map and depth < 10:
                path_parts.insert(0, id_map[cur]["name"])
                cur = id_map[cur].get("parent_id")
                depth += 1
            result.append({
                "id": f["id"],
                "name": f["name"],
                "category": f.get("category", "general"),
                "parent_id": f.get("parent_id"),
                "depth": depth,
                "path_display": " > ".join(path_parts),
            })
        result.sort(key=lambda x: x["path_display"].lower())
        return result

    return router
