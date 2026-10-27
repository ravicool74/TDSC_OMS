import os
import re
import uuid
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Dict, Any
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form, Header
from fastapi.responses import Response, FileResponse
from pydantic import BaseModel, Field
from pymongo import ReturnDocument

from customer_portal_core import (
    now_utc,
    clean_doc,
    hash_password,
    verify_password,
    MASTER_SERVICES_CATALOGUE,
    derive_numeric_customer_id,
    generate_customer_temp_password,
    init_customer_portal_indexes,
)

# Workflow Status Constants
STATUS_SUBMITTED = "SUBMITTED"
STATUS_ASSIGNED = "ASSIGNED"
STATUS_IN_PROGRESS = "IN_PROGRESS"
STATUS_UNDER_REVIEW = "UNDER_REVIEW"
STATUS_COMPLETED = "COMPLETED"
STATUS_WAITING_FOR_CUSTOMER = "WAITING_FOR_CUSTOMER"
STATUS_ON_HOLD = "ON_HOLD"
STATUS_REJECTED = "REJECTED"
STATUS_CANCELLED = "CANCELLED"

VALID_TRANSITIONS = {
    STATUS_SUBMITTED: [STATUS_ASSIGNED, STATUS_CANCELLED, STATUS_REJECTED],
    STATUS_ASSIGNED: [STATUS_IN_PROGRESS, STATUS_ASSIGNED, STATUS_WAITING_FOR_CUSTOMER, STATUS_ON_HOLD, STATUS_CANCELLED],
    STATUS_IN_PROGRESS: [STATUS_UNDER_REVIEW, STATUS_COMPLETED, STATUS_WAITING_FOR_CUSTOMER, STATUS_ON_HOLD, STATUS_CANCELLED],
    STATUS_UNDER_REVIEW: [STATUS_COMPLETED, STATUS_IN_PROGRESS, STATUS_REJECTED, STATUS_CANCELLED],
    STATUS_WAITING_FOR_CUSTOMER: [STATUS_IN_PROGRESS, STATUS_UNDER_REVIEW, STATUS_CANCELLED],
    STATUS_ON_HOLD: [STATUS_IN_PROGRESS, STATUS_ASSIGNED, STATUS_CANCELLED],
    STATUS_COMPLETED: [],
    STATUS_REJECTED: [],
    STATUS_CANCELLED: [],
}

# Pydantic Schemas
class ServiceCreateInput(BaseModel):
    name: str
    code: Optional[str] = None
    category: str = "General Services"
    rate: float = 0.0
    description: Optional[str] = None
    mandatory_docs: List[str] = Field(default_factory=list)
    optional_docs: List[str] = Field(default_factory=list)
    allowed_file_types: List[str] = Field(default_factory=lambda: ["pdf", "jpg", "jpeg", "png"])
    max_file_size_mb: int = 10
    custom_fields: List[Dict[str, Any]] = Field(default_factory=list)
    display_order: int = 999
    status: str = "active"

class ServiceUpdateInput(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    rate: Optional[float] = None
    description: Optional[str] = None
    mandatory_docs: Optional[List[str]] = None
    optional_docs: Optional[List[str]] = None
    allowed_file_types: Optional[List[str]] = None
    max_file_size_mb: Optional[int] = None
    custom_fields: Optional[List[Dict[str, Any]]] = None
    display_order: Optional[int] = None
    status: Optional[str] = None

class ServiceRequestCreateInput(BaseModel):
    service_id: str
    remarks: Optional[str] = None
    custom_form_data: Dict[str, Any] = Field(default_factory=dict)
    priority: str = "medium"

class TransitionInput(BaseModel):
    status: str
    remarks: Optional[str] = None
    internal_notes: Optional[str] = None

class ReassignInput(BaseModel):
    new_employee_id: str
    reason: str

class ProfileUpdateInput(BaseModel):
    agency_name: Optional[str] = None
    company_name: Optional[str] = None
    address: Optional[str] = None
    mobile: Optional[str] = None
    email: Optional[str] = None
    registration_number: Optional[str] = None

class CustomerPasswordChangeInput(BaseModel):
    current_password: str
    new_password: str

# Helper to automatically create or link customer account
async def ensure_customer_account(db, customer_doc: dict, log_audit=None, actor=None) -> dict:
    cid = customer_doc.get("id")
    if not cid:
        return {}

    # Check if user account already linked to this customer
    existing_user = await db.users.find_one({"customer_id": cid}, {"_id": 0})
    if existing_user:
        return existing_user

    # Derive pure numeric Customer ID
    numeric_id = derive_numeric_customer_id(customer_doc)

    # Ensure uniqueness of numeric User ID
    num_cand = numeric_id
    idx = 1
    while await db.users.find_one({"$or": [{"user_id": num_cand}, {"numeric_user_id": num_cand}]}):
        num_cand = f"{int(numeric_id) + idx:08d}"
        idx += 1
    numeric_id = num_cand

    temp_pw = generate_customer_temp_password(customer_doc)
    pw_hash = hash_password(temp_pw)

    raw_email = (customer_doc.get("email") or "").strip().lower()
    clean_email = re.sub(r'[,\\.\s]+$', '', raw_email)
    if not clean_email or "@" not in clean_email:
        email = f"cust.{numeric_id}@triveni.in"
    else:
        existing_email_user = await db.users.find_one({"email": clean_email})
        if existing_email_user:
            email = f"cust.{numeric_id}@triveni.in"
        else:
            email = clean_email

    user_payload = {
        "user_id": numeric_id,
        "numeric_user_id": numeric_id,
        "username": numeric_id,
        "email": email,
        "name": customer_doc.get("name") or "Valued Customer",
        "mobile": customer_doc.get("mobile"),
        "role": "customer",
        "role_id": "customer",
        "role_name": "Customer",
        "status": "active",
        "customer_id": cid,
        "customer_code": customer_doc.get("customer_code"),
        "company_name": customer_doc.get("name"),
        "agency_name": customer_doc.get("name"),
        "pan": customer_doc.get("pan"),
        "aadhar": customer_doc.get("aadhar"),
        "must_change_password": True,
        "password_hash": pw_hash,
        "created_at": now_utc(),
        "updated_at": now_utc(),
    }

    await db.users.insert_one(user_payload)
    await db.customers.update_one(
        {"id": cid},
        {"$set": {"customer_user_id": numeric_id, "user_id": numeric_id, "account_created_at": now_utc()}}
    )

    if log_audit and actor:
        try:
            await log_audit(db, actor, "customers", "create_customer_account", cid, None, {
                "numeric_user_id": numeric_id,
                "customer_code": customer_doc.get("customer_code")
            })
        except Exception:
            pass

    clean_doc(user_payload)
    return user_payload

# Atomic Service Request Number Generator: SR-YYYY-XXXXX
async def get_next_service_request_no(db) -> str:
    year = datetime.now().year
    counter_id = f"service_request_no_{year}"
    counter = await db.counters.find_one_and_update(
        {"_id": counter_id},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    seq = (counter or {}).get("seq") or 1
    return f"SR-{year}-{seq:05d}"

# Ensure default service catalogue
async def seed_master_services(db):
    count = await db.service_catalogue.count_documents({})
    if count == 0:
        for idx, srv in enumerate(MASTER_SERVICES_CATALOGUE):
            doc = {
                "id": f"srv_{uuid.uuid4().hex[:10]}",
                "code": srv["code"],
                "name": srv["name"],
                "category": srv.get("category", "General Services"),
                "rate": float(srv.get("rate", 0.0)),
                "description": srv.get("description", ""),
                "mandatory_docs": srv.get("mandatory_docs", []),
                "optional_docs": srv.get("optional_docs", []),
                "allowed_file_types": ["pdf", "jpg", "jpeg", "png"],
                "max_file_size_mb": 10,
                "custom_fields": [],
                "display_order": idx + 1,
                "status": "active",
                "created_at": now_utc(),
                "updated_at": now_utc(),
            }
            await db.service_catalogue.insert_one(doc)

def make_service_request_router(db, get_current_user, require_admin, require_admin_or_manager, log_audit, uploads_dir: Path):
    router = APIRouter(prefix="", tags=["Customer Portal & Service Request Management"])

    # Middleware helper to get customer context
    async def get_current_customer(current: Any = Depends(get_current_user)):
        if current.role != "customer":
            raise HTTPException(status_code=403, detail="Customer portal access required")
        # Find linked customer record
        cust = await db.customers.find_one({
            "$or": [{"id": current.customer_id}, {"customer_code": current.customer_code}, {"user_id": current.user_id}]
        }, {"_id": 0})
        if not cust:
            raise HTTPException(status_code=404, detail="Customer record not linked")
        return {"user": current, "customer": cust}

    # Helper to check employee queue access
    async def get_authorized_staff(current: Any = Depends(get_current_user)):
        if current.role == "customer":
            raise HTTPException(status_code=403, detail="Staff access required")
        return current

    # =========================================================================
    # 1. SERVICE CATALOGUE (Customer & Admin)
    # =========================================================================

    @router.get("/api/services/catalogue")
    @router.get("/api/service-catalogue")
    async def get_service_catalogue(current: Any = Depends(get_current_user)):
        """Returns active services catalogue for customers and staff."""
        await seed_master_services(db)
        cursor = db.service_catalogue.find({"status": "active"}, {"_id": 0}).sort("display_order", 1)
        items = await cursor.to_list(100)
        return items

    @router.get("/api/admin/services")
    async def get_admin_services(current: Any = Depends(get_authorized_staff)):
        """Returns all services including inactive with configuration for Admins."""
        await seed_master_services(db)
        cursor = db.service_catalogue.find({}, {"_id": 0}).sort("display_order", 1)
        items = await cursor.to_list(200)
        return items

    @router.post("/api/admin/services")
    async def create_admin_service(payload: ServiceCreateInput, current: Any = Depends(require_admin_or_manager)):
        code = payload.code or f"SRV_{uuid.uuid4().hex[:6].upper()}"
        existing = await db.service_catalogue.find_one({"code": code})
        if existing:
            raise HTTPException(status_code=409, detail=f"Service with code {code} already exists")

        new_doc = {
            **payload.dict(),
            "id": f"srv_{uuid.uuid4().hex[:10]}",
            "code": code,
            "created_at": now_utc(),
            "updated_at": now_utc(),
        }
        await db.service_catalogue.insert_one(new_doc)
        await log_audit(db, current, "service_catalogue", "create", new_doc["id"], None, {"name": payload.name})
        clean_doc(new_doc)
        return new_doc

    @router.put("/api/admin/services/{service_id}")
    async def update_admin_service(service_id: str, payload: ServiceUpdateInput, current: Any = Depends(require_admin_or_manager)):
        existing = await db.service_catalogue.find_one({"$or": [{"id": service_id}, {"code": service_id}]})
        if not existing:
            raise HTTPException(status_code=404, detail="Service not found")

        update_dict = {k: v for k, v in payload.dict().items() if v is not None}
        update_dict["updated_at"] = now_utc()

        await db.service_catalogue.update_one({"_id": existing["_id"]}, {"$set": update_dict})
        updated = await db.service_catalogue.find_one({"_id": existing["_id"]}, {"_id": 0})
        await log_audit(db, current, "service_catalogue", "update", service_id, None, update_dict)
        return updated

    # =========================================================================
    # 2. CUSTOMER PORTAL (Profile, Statistics, Own Requests, Tenders)
    # =========================================================================

    @router.get("/api/customer-portal/profile")
    async def get_customer_profile(ctx: dict = Depends(get_current_customer)):
        cust = ctx["customer"]
        u = ctx["user"]
        return {
            "customer_id": cust.get("id"),
            "customer_code": cust.get("customer_code"),
            "user_id": u.user_id,
            "name": cust.get("name"),
            "agency_name": cust.get("agency_name") or cust.get("name"),
            "company_name": cust.get("company_name") or cust.get("name"),
            "address": cust.get("address"),
            "mobile": cust.get("mobile"),
            "email": cust.get("email") or u.email,
            "pan": cust.get("pan"),
            "aadhar": cust.get("aadhar"),
            "registration_number": cust.get("contractor_reg_no") or cust.get("registration_number"),
            "must_change_password": getattr(u, "must_change_password", False),
        }

    @router.put("/api/customer-portal/profile")
    async def update_customer_profile(payload: ProfileUpdateInput, ctx: dict = Depends(get_current_customer)):
        cust = ctx["customer"]
        u = ctx["user"]
        upd = {k: v.strip() for k, v in payload.dict().items() if v is not None and v.strip()}
        if not upd:
            raise HTTPException(status_code=400, detail="No fields to update")

        # Update customer doc and user doc
        await db.customers.update_one({"id": cust["id"]}, {"$set": upd})
        user_sync = {}
        if "mobile" in upd: user_sync["mobile"] = upd["mobile"]
        if "email" in upd: user_sync["email"] = upd["email"]
        if "agency_name" in upd: user_sync["agency_name"] = upd["agency_name"]
        if "company_name" in upd: user_sync["company_name"] = upd["company_name"]
        if user_sync:
            await db.users.update_one({"user_id": u.user_id}, {"$set": user_sync})

        await log_audit(db, u, "customer_profile", "update", cust["id"], None, upd)
        return {"ok": True, "message": "Profile updated successfully"}

    @router.post("/api/customer-portal/change-password")
    async def customer_change_password(payload: CustomerPasswordChangeInput, ctx: dict = Depends(get_current_customer)):
        u = ctx["user"]
        user_doc = await db.users.find_one({"user_id": u.user_id})
        if not user_doc or not user_doc.get("password_hash"):
            raise HTTPException(status_code=400, detail="User account does not have a local password set")
        if not verify_password(payload.current_password, user_doc["password_hash"]):
            raise HTTPException(status_code=400, detail="Current password is incorrect")
        if len(payload.new_password.strip()) < 6:
            raise HTTPException(status_code=400, detail="New password must be at least 6 characters")

        new_hash = hash_password(payload.new_password.strip())
        await db.users.update_one(
            {"user_id": u.user_id},
            {"$set": {"password_hash": new_hash, "must_change_password": False, "updated_at": now_utc()}}
        )
        await log_audit(db, u, "customer_profile", "change_password", u.user_id, None, {"action": "Password changed"})
        return {"ok": True, "message": "Password changed successfully"}

    @router.get("/api/customer-portal/stats")
    async def get_customer_stats(ctx: dict = Depends(get_current_customer)):
        cust = ctx["customer"]
        cid = cust["id"]
        total_reqs = await db.service_requests.count_documents({"customer_id": cid})
        in_progress = await db.service_requests.count_documents({"customer_id": cid, "status": {"$in": [STATUS_SUBMITTED, STATUS_ASSIGNED, STATUS_IN_PROGRESS, STATUS_UNDER_REVIEW]}})
        completed = await db.service_requests.count_documents({"customer_id": cid, "status": STATUS_COMPLETED})
        waiting_customer = await db.service_requests.count_documents({"customer_id": cid, "status": STATUS_WAITING_FOR_CUSTOMER})
        total_tenders = await db.tenders.count_documents({"status": {"$in": ["open", "published"]}})

        return {
            "total_requests": total_reqs,
            "in_progress_requests": in_progress,
            "completed_requests": completed,
            "waiting_customer_requests": waiting_customer,
            "published_tenders": total_tenders,
        }

    # =========================================================================
    # 3. SERVICE REQUEST SUBMISSION & DOCUMENT UPLOAD (Section 6 & 15)
    # =========================================================================

    @router.post("/api/service-requests")
    async def submit_service_request(payload: ServiceRequestCreateInput, ctx: dict = Depends(get_current_customer)):
        cust = ctx["customer"]
        u = ctx["user"]

        srv = await db.service_catalogue.find_one({"$or": [{"id": payload.service_id}, {"code": payload.service_id}]})
        if not srv or srv.get("status") != "active":
            raise HTTPException(status_code=400, detail="Invalid or inactive service selected")

        request_no = await get_next_service_request_no(db)
        sr_id = f"sr_{uuid.uuid4().hex[:12]}"

        new_request = {
            "id": sr_id,
            "request_no": request_no,
            "customer_id": cust.get("id"),
            "customer_code": cust.get("customer_code"),
            "customer_user_id": u.user_id,
            "customer_name": cust.get("name"),
            "agency_name": cust.get("agency_name") or cust.get("name"),
            "company_name": cust.get("company_name") or cust.get("name"),
            "mobile": cust.get("mobile"),
            "email": cust.get("email") or u.email,
            "service_id": srv.get("id"),
            "service_code": srv.get("code"),
            "service_name": srv.get("name"),
            "service_category": srv.get("category", "General Services"),
            "service_rate": srv.get("rate", 0.0),
            "remarks": payload.remarks,
            "custom_form_data": payload.custom_form_data,
            "priority": payload.priority or "medium",
            "status": STATUS_SUBMITTED,
            "assigned_to": None,
            "assigned_to_name": None,
            "assigned_at": None,
            "required_docs_status": "pending_upload",
            "documents": [],
            "completed_documents": [],
            "employee_remarks": None,
            "internal_notes": None,
            "workflow_history": [
                {
                    "from_status": None,
                    "to_status": STATUS_SUBMITTED,
                    "actor_id": u.user_id,
                    "actor_name": u.name,
                    "actor_role": "customer",
                    "action": "submitted",
                    "remarks": "Service request submitted by customer",
                    "timestamp": now_utc(),
                }
            ],
            "created_at": now_utc(),
            "updated_at": now_utc(),
            "version": 1,
        }

        await db.service_requests.insert_one(new_request)

        # In-app notification for staff
        await db.notifications.insert_one({
            "id": f"notif_{uuid.uuid4().hex[:10]}",
            "title": f"New Service Request: {request_no}",
            "message": f"{cust.get('name')} submitted a new request for {srv.get('name')}.",
            "target_role": "employee",
            "service_request_id": sr_id,
            "request_no": request_no,
            "is_read": False,
            "created_at": now_utc(),
        })

        await log_audit(db, u, "service_requests", "submit", sr_id, None, {
            "request_no": request_no,
            "service_name": srv.get("name")
        })

        clean_doc(new_request)
        return new_request

    @router.post("/api/service-requests/{request_id}/documents")
    async def upload_service_request_document(
        request_id: str,
        doc_type: str = Form("supporting_document"),
        file: UploadFile = File(...),
        current: Any = Depends(get_current_user),
    ):
        sr = await db.service_requests.find_one({"$or": [{"id": request_id}, {"request_no": request_id}]})
        if not sr:
            raise HTTPException(status_code=404, detail="Service request not found")

        # Ownership / permission check
        if current.role == "customer" and sr.get("customer_id") != current.customer_id and sr.get("customer_user_id") != current.user_id:
            raise HTTPException(status_code=403, detail="Unauthorized: Access denied to this service request")

        # Read file bytes & enforce 10MB limit
        content = await file.read()
        max_bytes = 10 * 1024 * 1024
        if len(content) > max_bytes:
            raise HTTPException(status_code=400, detail="File exceeds maximum allowed size of 10 MB")

        # Enforce permitted file extensions
        ext = (file.filename.split(".")[-1] or "").lower()
        if ext not in ["pdf", "jpg", "jpeg", "png"]:
            raise HTTPException(status_code=400, detail="Invalid file format. Allowed formats: PDF, JPG, JPEG, PNG")

        # Secure server-generated storage path
        doc_id = f"doc_{uuid.uuid4().hex[:10]}"
        safe_filename = f"{doc_id}_{re.sub(r'[^a-zA-Z0-9_.-]', '_', file.filename)}"
        target_dir = uploads_dir / "service_requests" / sr["id"]
        target_dir.mkdir(parents=True, exist_ok=True)
        file_path = target_dir / safe_filename

        with open(file_path, "wb") as f:
            f.write(content)

        doc_meta = {
            "doc_id": doc_id,
            "file_name": file.filename,
            "safe_filename": safe_filename,
            "file_size": len(content),
            "mime_type": file.content_type or "application/octet-stream",
            "doc_type": doc_type,
            "uploaded_by_id": current.user_id,
            "uploaded_by_name": current.name,
            "uploaded_by_role": current.role,
            "uploaded_at": now_utc(),
            "relative_path": f"service_requests/{sr['id']}/{safe_filename}",
        }

        await db.service_requests.update_one(
            {"_id": sr["_id"]},
            {
                "$push": {"documents": doc_meta},
                "$set": {"updated_at": now_utc(), "required_docs_status": "documents_attached"}
            }
        )

        await log_audit(db, current, "service_requests", "upload_document", sr["id"], None, {
            "doc_id": doc_id, "file_name": file.filename, "size": len(content)
        })

        return {"ok": True, "document": doc_meta}

    @router.get("/api/service-requests/{request_id}/documents/{doc_id}")
    async def download_service_request_document(
        request_id: str,
        doc_id: str,
        token: Optional[str] = None,
        authorization: Optional[str] = Header(default=None),
    ):
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
        user_doc = await db.users.find_one({"user_id": session["user_id"]}, {"_id": 0, "password_hash": 0})
        if not user_doc:
            raise HTTPException(status_code=401, detail="User not found")
        current_role = user_doc.get("role")
        current_cust_id = user_doc.get("customer_id")
        current_uid = user_doc.get("user_id")

        sr = await db.service_requests.find_one({"$or": [{"id": request_id}, {"request_no": request_id}]})
        if not sr:
            raise HTTPException(status_code=404, detail="Service request not found")

        # Object level authorization
        if current_role == "customer" and sr.get("customer_id") != current_cust_id and sr.get("customer_user_id") != current_uid:
            raise HTTPException(status_code=403, detail="Unauthorized: Access denied")

        # Locate doc in documents or completed_documents
        all_docs = sr.get("documents", []) + sr.get("completed_documents", [])
        target = next((d for d in all_docs if d.get("doc_id") == doc_id), None)
        if not target:
            raise HTTPException(status_code=404, detail="Document not found")

        rel_path = target.get("relative_path")
        file_path = uploads_dir / rel_path
        if not file_path.exists():
            raise HTTPException(status_code=404, detail="File on disk not found")

        return FileResponse(file_path, media_type=target.get("mime_type", "application/octet-stream"), filename=target.get("file_name"))

    # =========================================================================
    # 4. CUSTOMER MY SERVICE REQUESTS (Section 4.D)
    # =========================================================================

    @router.get("/api/customer-portal/service-requests")
    async def list_customer_service_requests(ctx: dict = Depends(get_current_customer)):
        cust = ctx["customer"]
        cid = cust["id"]
        cursor = db.service_requests.find({"customer_id": cid}, {"_id": 0}).sort("created_at", -1)
        items = await cursor.to_list(100)
        return items

    @router.get("/api/customer-portal/service-requests/{id_or_no}")
    async def get_customer_service_request_detail(id_or_no: str, ctx: dict = Depends(get_current_customer)):
        cust = ctx["customer"]
        cid = cust["id"]
        sr = await db.service_requests.find_one(
            {"customer_id": cid, "$or": [{"id": id_or_no}, {"request_no": id_or_no}]},
            {"_id": 0}
        )
        if not sr:
            raise HTTPException(status_code=404, detail="Service request not found")

        # Omit internal notes from customer view
        sr.pop("internal_notes", None)
        return sr

    # =========================================================================
    # 5. CUSTOMER MY TENDER (Section 4.B)
    # =========================================================================

    @router.get("/api/customer-portal/tenders")
    async def get_customer_published_tenders(
        search: Optional[str] = Query(None),
        department: Optional[str] = Query(None),
        value_category: Optional[str] = Query(None),
        ctx: dict = Depends(get_current_customer)
    ):
        """Latest Tender published by existing Tender Section."""
        query: Dict[str, Any] = {"status": {"$in": ["open", "published"]}}
        if search:
            query["$or"] = [
                {"name_of_work": {"$regex": re.escape(search), "$options": "i"}},
                {"tender_id": {"$regex": re.escape(search), "$options": "i"}},
                {"reference_no": {"$regex": re.escape(search), "$options": "i"}},
            ]
        if department and department != "all":
            query["department"] = {"$regex": re.escape(department), "$options": "i"}
        if value_category and value_category != "all":
            query["value_category"] = value_category

        cursor = db.tenders.find(query, {"_id": 0}).sort("created_at", -1)
        items = await cursor.to_list(100)
        return items

    @router.post("/api/customer-portal/tenders/{tender_id}/request")
    async def request_tender_filling(tender_id: str, ctx: dict = Depends(get_current_customer)):
        """Customer requests Tender Filling for a specific published tender."""
        cust = ctx["customer"]
        u = ctx["user"]

        t = await db.tenders.find_one({"$or": [{"tender_id": tender_id}, {"id": tender_id}]})
        if not t:
            raise HTTPException(status_code=404, detail="Tender not found")

        req_no = await get_next_service_request_no(db)
        sr_id = f"sr_{uuid.uuid4().hex[:12]}"

        new_request = {
            "id": sr_id,
            "request_no": req_no,
            "customer_id": cust.get("id"),
            "customer_code": cust.get("customer_code"),
            "customer_user_id": u.user_id,
            "customer_name": cust.get("name"),
            "agency_name": cust.get("agency_name") or cust.get("name"),
            "company_name": cust.get("company_name") or cust.get("name"),
            "mobile": cust.get("mobile"),
            "email": cust.get("email") or u.email,
            "service_id": "srv_tender_filling",
            "service_code": "TENDER_FILL",
            "service_name": f"Tender Filling: {t.get('name_of_work')[:50]}",
            "service_category": "Tender Services",
            "service_rate": 2500.0,
            "tender_id": t.get("tender_id"),
            "tender_ref_no": t.get("reference_no"),
            "tender_end_date": t.get("end_date"),
            "tender_estimated_cost": t.get("estimated_cost", 0.0),
            "remarks": f"Tender filling requested for NIT/Tender ID {t.get('tender_id')}",
            "custom_form_data": {"tender_id": t.get("tender_id"), "department": t.get("department")},
            "priority": "high",
            "status": STATUS_SUBMITTED,
            "assigned_to": None,
            "assigned_to_name": None,
            "task_id": None,
            "documents": [],
            "completed_documents": [],
            "workflow_history": [
                {
                    "from_status": None,
                    "to_status": STATUS_SUBMITTED,
                    "actor_id": u.user_id,
                    "actor_name": u.name,
                    "actor_role": "customer",
                    "action": "tender_request_submitted",
                    "remarks": f"Customer requested bid filling for Tender {t.get('tender_id')}",
                    "timestamp": now_utc(),
                }
            ],
            "created_at": now_utc(),
            "updated_at": now_utc(),
            "version": 1,
        }

        await db.service_requests.insert_one(new_request)

        await db.notifications.insert_one({
            "id": f"notif_{uuid.uuid4().hex[:10]}",
            "title": f"New Tender Request: {req_no}",
            "message": f"{cust.get('name')} requested tender filling for Tender {t.get('tender_id')}.",
            "target_role": "employee",
            "service_request_id": sr_id,
            "is_read": False,
            "created_at": now_utc(),
        })

        clean_doc(new_request)
        return new_request

    # =========================================================================
    # 6. EMPLOYEE QUEUE: SERVICE REQUEST BY CUSTOMER (Section 8)
    # =========================================================================

    @router.get("/api/service-requests/queue")
    async def get_employee_request_queue(
        status: Optional[str] = Query(None),
        service_id: Optional[str] = Query(None),
        assigned_to: Optional[str] = Query(None),
        search: Optional[str] = Query(None),
        priority: Optional[str] = Query(None),
        limit: int = 50,
        skip: int = 0,
        current: Any = Depends(get_authorized_staff),
    ):
        query: Dict[str, Any] = {}

        if status and status != "all":
            if status == "unassigned":
                query["assigned_to"] = None
                query["status"] = STATUS_SUBMITTED
            else:
                query["status"] = status.upper()

        if service_id and service_id != "all":
            query["$or"] = [{"service_id": service_id}, {"service_code": service_id}]

        if assigned_to:
            if assigned_to == "me":
                query["assigned_to"] = current.user_id
            elif assigned_to != "all":
                query["assigned_to"] = assigned_to

        if priority and priority != "all":
            query["priority"] = priority

        if search:
            rx = {"$regex": re.escape(search), "$options": "i"}
            query["$or"] = [
                {"request_no": rx},
                {"customer_name": rx},
                {"customer_code": rx},
                {"customer_user_id": rx},
                {"agency_name": rx},
                {"service_name": rx},
                {"mobile": rx},
            ]

        total = await db.service_requests.count_documents(query)
        cursor = db.service_requests.find(query, {"_id": 0}).sort("created_at", -1).skip(skip).limit(limit)
        items = await cursor.to_list(limit)

        return {
            "total": total,
            "items": items,
            "limit": limit,
            "skip": skip,
        }

    # =========================================================================
    # 7. ASSIGN TO ME API WITH SAFE CONCURRENCY & TASK LINKING (Section 9 & 10)
    # =========================================================================

    @router.post("/api/service-requests/{request_id}/assign-self")
    async def assign_request_to_me(request_id: str, current: Any = Depends(get_authorized_staff)):
        """Atomically claims a service request and creates the corresponding primary task in db.tasks."""
        sr = await db.service_requests.find_one({"$or": [{"id": request_id}, {"request_no": request_id}]})
        if not sr:
            raise HTTPException(status_code=404, detail="Service request not found")

        # Concurrency safety: conditional atomic update
        # Must be SUBMITTED or unassigned
        updated_sr = await db.service_requests.find_one_and_update(
            {
                "_id": sr["_id"],
                "$or": [
                    {"assigned_to": None},
                    {"assigned_to": ""},
                    {"status": STATUS_SUBMITTED}
                ]
            },
            {
                "$set": {
                    "assigned_to": current.user_id,
                    "assigned_to_name": current.name,
                    "assigned_at": now_utc(),
                    "status": STATUS_ASSIGNED,
                    "updated_at": now_utc(),
                },
                "$push": {
                    "workflow_history": {
                        "from_status": sr.get("status"),
                        "to_status": STATUS_ASSIGNED,
                        "actor_id": current.user_id,
                        "actor_name": current.name,
                        "actor_role": current.role,
                        "action": "assign_to_me",
                        "remarks": f"Claimed by {current.name}",
                        "timestamp": now_utc(),
                    }
                },
                "$inc": {"version": 1}
            },
            return_document=ReturnDocument.AFTER
        )

        if not updated_sr:
            # Another employee already claimed it
            current_sr = await db.service_requests.find_one({"_id": sr["_id"]}, {"_id": 0})
            claimed_by = current_sr.get("assigned_to_name") or "another team member"
            raise HTTPException(
                status_code=409,
                detail=f"Conflict: This service request has already been assigned to {claimed_by}."
            )

        # Create or link the corresponding primary Task in db.tasks
        task_id = updated_sr.get("task_id")
        if not task_id:
            task_counter = await db.counters.find_one_and_update(
                {"_id": "task_no"},
                {"$inc": {"seq": 1}},
                upsert=True,
                return_document=ReturnDocument.AFTER
            )
            t_seq = (task_counter or {}).get("seq") or 1
            task_no = f"TSK-{t_seq:04d}"
            task_id = f"tsk_{uuid.uuid4().hex[:12]}"

            task_doc = {
                "id": task_id,
                "task_no": task_no,
                "source_type": "SERVICE_REQUEST",
                "source_id": updated_sr["id"],
                "request_no": updated_sr["request_no"],
                "title": f"Service: {updated_sr.get('service_name')} ({updated_sr.get('request_no')})",
                "description": f"Customer Request for {updated_sr.get('service_name')}. Agency: {updated_sr.get('agency_name')}. Remarks: {updated_sr.get('remarks') or 'None'}",
                "task_category": "task_followup",
                "service_id": updated_sr.get("service_id"),
                "service_name": updated_sr.get("service_name"),
                "customer_id": updated_sr.get("customer_id"),
                "customer_code": updated_sr.get("customer_code"),
                "customer_name": updated_sr.get("customer_name"),
                "customer_mobile": updated_sr.get("mobile"),
                "assignee_id": current.user_id,
                "assignee_name": current.name,
                "priority": updated_sr.get("priority", "medium"),
                "status": "todo",
                "created_by": current.user_id,
                "created_by_name": current.name,
                "attachments": updated_sr.get("documents", []),
                "created_at": now_utc(),
                "updated_at": now_utc(),
            }
            await db.tasks.insert_one(task_doc)

            # Update service request with task reference
            await db.service_requests.update_one(
                {"_id": updated_sr["_id"]},
                {"$set": {"task_id": task_id, "task_no": task_no}}
            )
            updated_sr["task_id"] = task_id
            updated_sr["task_no"] = task_no

        await log_audit(db, current, "service_requests", "assign_to_me", updated_sr["id"], None, {
            "task_id": task_id, "request_no": updated_sr["request_no"]
        })

        clean_doc(updated_sr)
        return updated_sr

    # =========================================================================
    # 8. WORKFLOW TRANSITIONS & COMPLETION (Section 11)
    # =========================================================================

    @router.post("/api/service-requests/{request_id}/transition")
    async def transition_request_status(
        request_id: str,
        payload: TransitionInput,
        current: Any = Depends(get_authorized_staff)
    ):
        sr = await db.service_requests.find_one({"$or": [{"id": request_id}, {"request_no": request_id}]})
        if not sr:
            raise HTTPException(status_code=404, detail="Service request not found")

        target_status = payload.status.upper()
        current_status = sr.get("status")

        # Validate transition graph
        allowed = VALID_TRANSITIONS.get(current_status, [])
        if target_status not in allowed:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid transition from {current_status} to {target_status}. Allowed: {', '.join(allowed) or 'None'}"
            )

        update_set: Dict[str, Any] = {
            "status": target_status,
            "updated_at": now_utc(),
        }
        if payload.remarks:
            update_set["employee_remarks"] = payload.remarks
        if payload.internal_notes:
            update_set["internal_notes"] = payload.internal_notes

        workflow_entry = {
            "from_status": current_status,
            "to_status": target_status,
            "actor_id": current.user_id,
            "actor_name": current.name,
            "actor_role": current.role,
            "action": f"transition_to_{target_status.lower()}",
            "remarks": payload.remarks or f"Status changed to {target_status}",
            "timestamp": now_utc(),
        }

        await db.service_requests.update_one(
            {"_id": sr["_id"]},
            {
                "$set": update_set,
                "$push": {"workflow_history": workflow_entry},
                "$inc": {"version": 1}
            }
        )

        # Synchronize linked task status
        if sr.get("task_id"):
            task_status = "todo"
            if target_status in [STATUS_IN_PROGRESS, STATUS_WAITING_FOR_CUSTOMER, STATUS_ON_HOLD]:
                task_status = "doing"
            elif target_status == STATUS_COMPLETED:
                task_status = "done"

            await db.tasks.update_one(
                {"id": sr["task_id"]},
                {"$set": {"status": task_status, "updated_at": now_utc()}}
            )

        # Customer notification
        await db.notifications.insert_one({
            "id": f"notif_{uuid.uuid4().hex[:10]}",
            "title": f"Service Request Update: {sr.get('request_no')}",
            "message": f"Your request status has been updated to {target_status.replace('_', ' ')}.",
            "target_user_id": sr.get("customer_user_id"),
            "customer_id": sr.get("customer_id"),
            "service_request_id": sr.get("id"),
            "is_read": False,
            "created_at": now_utc(),
        })

        await log_audit(db, current, "service_requests", "transition", sr["id"], None, {
            "from": current_status, "to": target_status, "remarks": payload.remarks
        })

        updated = await db.service_requests.find_one({"_id": sr["_id"]}, {"_id": 0})
        return updated

    # =========================================================================
    # 9. REASSIGNMENT API (Section 12)
    # =========================================================================

    @router.post("/api/service-requests/{request_id}/reassign")
    async def reassign_service_request(
        request_id: str,
        payload: ReassignInput,
        current: Any = Depends(require_admin_or_manager)
    ):
        sr = await db.service_requests.find_one({"$or": [{"id": request_id}, {"request_no": request_id}]})
        if not sr:
            raise HTTPException(status_code=404, detail="Service request not found")

        # Find target staff user
        target_staff = await db.users.find_one({"user_id": payload.new_employee_id})
        if not target_staff:
            raise HTTPException(status_code=404, detail="Target employee not found")

        old_assignee_id = sr.get("assigned_to")
        old_assignee_name = sr.get("assigned_to_name")

        reassign_entry = {
            "from_status": sr.get("status"),
            "to_status": STATUS_ASSIGNED,
            "actor_id": current.user_id,
            "actor_name": current.name,
            "actor_role": current.role,
            "action": "reassigned",
            "old_assignee": old_assignee_name,
            "new_assignee": target_staff.get("name"),
            "remarks": payload.reason,
            "timestamp": now_utc(),
        }

        await db.service_requests.update_one(
            {"_id": sr["_id"]},
            {
                "$set": {
                    "assigned_to": target_staff.get("user_id"),
                    "assigned_to_name": target_staff.get("name"),
                    "assigned_at": now_utc(),
                    "status": STATUS_ASSIGNED,
                    "updated_at": now_utc(),
                },
                "$push": {"workflow_history": reassign_entry},
                "$inc": {"version": 1}
            }
        )

        # Update linked task assignee
        if sr.get("task_id"):
            await db.tasks.update_one(
                {"id": sr["task_id"]},
                {
                    "$set": {
                        "assignee_id": target_staff.get("user_id"),
                        "assignee_name": target_staff.get("name"),
                        "updated_at": now_utc(),
                    }
                }
            )

        # Notify new assignee
        await db.notifications.insert_one({
            "id": f"notif_{uuid.uuid4().hex[:10]}",
            "title": f"Assigned Request: {sr.get('request_no')}",
            "message": f"Service request {sr.get('request_no')} ({sr.get('service_name')}) has been reassigned to you by {current.name}.",
            "target_user_id": target_staff.get("user_id"),
            "is_read": False,
            "created_at": now_utc(),
        })

        await log_audit(db, current, "service_requests", "reassign", sr["id"], None, {
            "old_assignee": old_assignee_id, "new_assignee": target_staff.get("user_id"), "reason": payload.reason
        })

        updated = await db.service_requests.find_one({"_id": sr["_id"]}, {"_id": 0})
        return updated

    # =========================================================================
    # 10. SINGLE REQUEST DETAIL (Employee & Admin)
    # =========================================================================

    @router.get("/api/service-requests/{request_id}")
    async def get_service_request_detail(request_id: str, current: Any = Depends(get_authorized_staff)):
        sr = await db.service_requests.find_one({"$or": [{"id": request_id}, {"request_no": request_id}]}, {"_id": 0})
        if not sr:
            raise HTTPException(status_code=404, detail="Service request not found")
        return sr

    return router
