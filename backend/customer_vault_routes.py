import os
import uuid
from datetime import datetime, timezone, date
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form, Header, Response
from pydantic import BaseModel, Field
from security_vault import encrypt_credential, decrypt_credential, mask_credential, log_audit_entry, now_utc

MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB
ALLOWED_EXTENSIONS = {".pdf", ".jpg", ".jpeg", ".png", ".doc", ".docx", ".xls", ".xlsx"}

PORTAL_PASSWORD_FIELDS = {
    "eproc2_password", "gst_password", "pmgsy_password", "railway_password",
    "ireps_password", "cpp_password", "epfo_password", "iso_password",
    "gem_password", "other_portal_password"
}

class RevealCredentialRequest(BaseModel):
    field: str

class RevealCredentialResponse(BaseModel):
    field: str
    value: Optional[str]
    customer_code: Optional[str]
    customer_name: Optional[str]

class ExpiryAlertItem(BaseModel):
    customer_id: str
    customer_code: Optional[str]
    customer_name: str
    item_type: str  # document, dsc, encryption
    title: str
    category: Optional[str] = None
    expiry_date: str
    days_left: int
    alert_level: str  # expired, 7_days, 15_days, 30_days

class ExpiryAlertsSummary(BaseModel):
    total_alerts: int
    expired_count: int
    seven_days_count: int
    fifteen_days_count: int
    thirty_days_count: int
    alerts: List[ExpiryAlertItem]

def parse_any_date(val: Optional[str]) -> Optional[date]:
    """Parse date from various formats including 'Monday, 10 April, 2028 12:21:10 AM', ISO, and DD-MM-YYYY."""
    if not val or not str(val).strip():
        return None
    s = str(val).strip()
    formats = [
        "%A, %d %B, %Y %I:%M:%S %p",
        "%A, %d %b, %Y %I:%M:%S %p",
        "%d %B, %Y %I:%M:%S %p",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d %I:%M:%S %p",
        "%Y-%m-%d",
        "%d-%m-%Y %H:%M:%S",
        "%d-%m-%Y",
        "%d/%m/%Y %H:%M:%S",
        "%d/%m/%Y",
    ]
    for fmt in formats:
        try:
            return datetime.strptime(s, fmt).date()
        except Exception:
            pass
    import re
    m = re.search(r"(\d{4})-(\d{2})-(\d{2})", s)
    if m:
        try:
            return datetime(int(m.group(1)), int(m.group(2)), int(m.group(3))).date()
        except Exception:
            pass
    m = re.search(r"(\d{1,2})[-/](\d{1,2})[-/](\d{4})", s)
    if m:
        try:
            return datetime(int(m.group(3)), int(m.group(2)), int(m.group(1))).date()
        except Exception:
            pass
    return None

async def compute_document_expiry_alerts(db) -> ExpiryAlertsSummary:
    """Retrieve upcoming and expired documents, DSCs, and encryption certificates."""
    today = date.today()
    alerts: List[ExpiryAlertItem] = []

    cursor = db.customers.find(
        {"$or": [
            {"dsc_expired_date": {"$ne": None, "$ne": ""}},
            {"encryption_expired_date": {"$ne": None, "$ne": ""}},
            {"documents.expiry_date": {"$ne": None, "$ne": ""}},
        ]},
        {"id": 1, "customer_code": 1, "name": 1, "dsc_expired_date": 1, "encryption_expired_date": 1, "documents": 1}
    )

    async for doc in cursor:
        cid = doc.get("id")
        code = doc.get("customer_code")
        cname = doc.get("name", "Unknown")

        # Check DSC expiry
        dsc_exp = doc.get("dsc_expired_date")
        if dsc_exp:
            try:
                exp_dt = parse_any_date(dsc_exp)
                if exp_dt:
                    delta = (exp_dt - today).days
                    if delta <= 30:
                        level = "expired" if delta <= 0 else "7_days" if delta <= 7 else "15_days" if delta <= 15 else "30_days"
                        alerts.append(ExpiryAlertItem(
                            customer_id=cid, customer_code=code, customer_name=cname,
                            item_type="dsc", title="Digital Signature (DSC)", category="DSC",
                            expiry_date=dsc_exp, days_left=delta, alert_level=level
                        ))
            except Exception:
                pass

        # Check Encryption expiry
        enc_exp = doc.get("encryption_expired_date")
        if enc_exp:
            try:
                exp_dt = parse_any_date(enc_exp)
                if exp_dt:
                    delta = (exp_dt - today).days
                    if delta <= 30:
                        level = "expired" if delta <= 0 else "7_days" if delta <= 7 else "15_days" if delta <= 15 else "30_days"
                        alerts.append(ExpiryAlertItem(
                            customer_id=cid, customer_code=code, customer_name=cname,
                            item_type="encryption", title="Encryption Certificate", category="DSC",
                            expiry_date=enc_exp, days_left=delta, alert_level=level
                        ))
            except Exception:
                pass

        # Check Document attachments
        for d in doc.get("documents", []):
            doc_exp = d.get("expiry_date")
            if doc_exp:
                try:
                    exp_dt = parse_any_date(doc_exp)
                    if exp_dt:
                        delta = (exp_dt - today).days
                        if delta <= 30:
                            level = "expired" if delta <= 0 else "7_days" if delta <= 7 else "15_days" if delta <= 15 else "30_days"
                            alerts.append(ExpiryAlertItem(
                                customer_id=cid, customer_code=code, customer_name=cname,
                                item_type="document", title=d.get("name", "Document"),
                                category=d.get("category", "General"),
                                expiry_date=doc_exp, days_left=delta, alert_level=level
                            ))
                except Exception:
                    pass


    alerts.sort(key=lambda x: x.days_left)

    expired_count = sum(1 for a in alerts if a.alert_level == "expired")
    seven_days_count = sum(1 for a in alerts if a.alert_level == "7_days")
    fifteen_days_count = sum(1 for a in alerts if a.alert_level == "15_days")
    thirty_days_count = sum(1 for a in alerts if a.alert_level == "30_days")

    return ExpiryAlertsSummary(
        total_alerts=len(alerts),
        expired_count=expired_count,
        seven_days_count=seven_days_count,
        fifteen_days_count=fifteen_days_count,
        thirty_days_count=thirty_days_count,
        alerts=alerts
    )

def make_customer_vault_router(db, get_current_user, require_admin_or_manager):
    router = APIRouter(prefix="/customers", tags=["customer-vault"])

    @router.post("/{cid}/credentials/reveal", response_model=RevealCredentialResponse)
    async def reveal_credential(
        cid: str,
        payload: RevealCredentialRequest,
        current: any = Depends(require_admin_or_manager)
    ):
        """Reveal customer portal password and record an immutable audit trail entry."""
        field = payload.field.strip()
        if field not in PORTAL_PASSWORD_FIELDS:
            raise HTTPException(status_code=400, detail=f"Invalid credential field: {field}")

        cust = await db.customers.find_one({"$or": [{"id": cid}, {"customer_code": cid}]})
        if not cust:
            raise HTTPException(status_code=404, detail="Customer not found")

        encrypted_val = cust.get(field)
        decrypted_val = decrypt_credential(encrypted_val) if encrypted_val else None

        # Log audit entry
        await log_audit_entry(
            db=db,
            user=current,
            module="customer_vault",
            action="reveal_credential",
            record_id=cust.get("customer_code") or cust.get("id"),
            old_value=None,
            new_value={"field": field, "customer_name": cust.get("name")},
        )

        return RevealCredentialResponse(
            field=field,
            value=decrypted_val,
            customer_code=cust.get("customer_code"),
            customer_name=cust.get("name")
        )

    @router.get("/document-expiry-alerts", response_model=ExpiryAlertsSummary)
    @router.get("/alerts/document-expiry", response_model=ExpiryAlertsSummary)
    async def get_document_expiry_alerts(current: any = Depends(get_current_user)):
        return await compute_document_expiry_alerts(db)

    @router.post("/{cid}/documents")
    async def upload_customer_document(
        cid: str,
        file: UploadFile = File(...),
        category: str = Form("Other"),
        doc_type: str = Form("validity"),
        document_no: Optional[str] = Form(None),
        document_date: Optional[str] = Form(None),
        issue_date: Optional[str] = Form(None),
        expiry_date: Optional[str] = Form(None),
        remarks: Optional[str] = Form(None),
        description: Optional[str] = Form(None),
        current: any = Depends(require_admin_or_manager)
    ):
        """Upload customer document with category, doc_type (validity/general), dates, and expiry."""
        cust = await db.customers.find_one({"$or": [{"id": cid}, {"customer_code": cid}]})
        if not cust:
            raise HTTPException(status_code=404, detail="Customer not found")

        content = await file.read()
        if len(content) > MAX_FILE_SIZE:
            raise HTTPException(status_code=400, detail="Document exceeds maximum 10 MB limit")

        ext = os.path.splitext(file.filename)[1].lower()
        if ext not in ALLOWED_EXTENSIONS:
            raise HTTPException(status_code=400, detail=f"File extension {ext} not allowed. Supported: {', '.join(ALLOWED_EXTENSIONS)}")

        doc_id = f"cdoc_{uuid.uuid4().hex[:10]}"
        storage_dir = os.path.join("uploads", "customer_docs", cust["id"])
        os.makedirs(storage_dir, exist_ok=True)
        file_path = os.path.join(storage_dir, f"{doc_id}_{file.filename}")
        with open(file_path, "wb") as f:
            f.write(content)

        effective_issue = issue_date or document_date
        doc_entry = {
            "id": doc_id,
            "name": file.filename,
            "category": category,
            "doc_type": doc_type,
            "document_no": document_no,
            "document_date": effective_issue,
            "issue_date": effective_issue,
            "expiry_date": expiry_date if doc_type == "validity" else None,
            "remarks": remarks,
            "description": description or file.filename,
            "size": len(content),
            "size_mb": round(len(content) / (1024 * 1024), 2),
            "content_type": file.content_type or "application/octet-stream",
            "file_path": file_path,
            "uploaded_at": now_utc(),
        }

        await db.customers.update_one({"_id": cust["_id"]}, {"$push": {"documents": doc_entry}})
        await log_audit_entry(
            db=db, user=current, module="customer_documents", action="upload",
            record_id=cust.get("id") or cid, old_value=None,
            new_value={"doc_id": doc_id, "name": file.filename, "category": category, "doc_type": doc_type, "expiry_date": expiry_date}
        )
        return {"ok": True, "document": doc_entry}

    @router.patch("/{cid}/documents/{doc_id}")
    @router.put("/{cid}/documents/{doc_id}")
    async def update_customer_document(
        cid: str,
        doc_id: str,
        file: Optional[UploadFile] = File(None),
        category: Optional[str] = Form(None),
        doc_type: Optional[str] = Form(None),
        document_no: Optional[str] = Form(None),
        document_date: Optional[str] = Form(None),
        issue_date: Optional[str] = Form(None),
        expiry_date: Optional[str] = Form(None),
        remarks: Optional[str] = Form(None),
        description: Optional[str] = Form(None),
        current: any = Depends(require_admin_or_manager)
    ):
        """Update metadata or replace file for an existing customer document."""
        cust = await db.customers.find_one({"$or": [{"id": cid}, {"customer_code": cid}]})
        if not cust:
            raise HTTPException(status_code=404, detail="Customer not found")

        docs = cust.get("documents", [])
        target = next((d for d in docs if d.get("id") == doc_id), None)
        if not target:
            raise HTTPException(status_code=404, detail="Document not found")

        updates: Dict[str, Any] = {"updated_at": now_utc()}
        if category is not None:
            updates["category"] = category
        if doc_type is not None:
            updates["doc_type"] = doc_type
        if document_no is not None:
            updates["document_no"] = document_no
        effective_issue = issue_date if issue_date is not None else document_date
        if effective_issue is not None:
            updates["document_date"] = effective_issue
            updates["issue_date"] = effective_issue
        if expiry_date is not None:
            updates["expiry_date"] = expiry_date
        if remarks is not None:
            updates["remarks"] = remarks
        if description is not None:
            updates["description"] = description

        if file and file.filename:
            content = await file.read()
            if len(content) > MAX_FILE_SIZE:
                raise HTTPException(status_code=400, detail="Document exceeds maximum 10 MB limit")
            ext = os.path.splitext(file.filename)[1].lower()
            if ext not in ALLOWED_EXTENSIONS:
                raise HTTPException(status_code=400, detail=f"File extension {ext} not allowed.")

            storage_dir = os.path.join("uploads", "customer_docs", cust["id"])
            os.makedirs(storage_dir, exist_ok=True)
            file_path = os.path.join(storage_dir, f"{doc_id}_{file.filename}")
            with open(file_path, "wb") as f:
                f.write(content)

            updates["name"] = file.filename
            updates["size"] = len(content)
            updates["size_mb"] = round(len(content) / (1024 * 1024), 2)
            updates["content_type"] = file.content_type or "application/octet-stream"
            updates["file_path"] = file_path

        # Update document in array
        set_dict = {f"documents.$.{k}": v for k, v in updates.items()}
        await db.customers.update_one({"_id": cust["_id"], "documents.id": doc_id}, {"$set": set_dict})

        updated_cust = await db.customers.find_one({"_id": cust["_id"]})
        updated_doc = next((d for d in updated_cust.get("documents", []) if d.get("id") == doc_id), None)
        await log_audit_entry(
            db=db, user=current, module="customer_documents", action="update",
            record_id=cust.get("id") or cid, old_value=target, new_value=updated_doc
        )
        return {"ok": True, "document": updated_doc}

    @router.get("/{cid}/documents/{doc_id}/download")
    async def download_customer_document(
        cid: str,
        doc_id: str,
        token: Optional[str] = None,
        authorization: Optional[str] = Header(None)
    ):
        """Direct file download for a customer document with attachment header."""
        if not authorization and token:
            authorization = f"Bearer {token}"
        if not authorization or not authorization.startswith("Bearer "):
            raise HTTPException(status_code=401, detail="Missing authorization")
        tok = authorization.split(" ", 1)[1].strip()
        session = await db.user_sessions.find_one({"session_token": tok}, {"_id": 0})
        if not session:
            raise HTTPException(status_code=401, detail="Invalid session")

        cust = await db.customers.find_one({"$or": [{"id": cid}, {"customer_code": cid}]})
        if not cust:
            raise HTTPException(status_code=404, detail="Customer not found")

        docs = cust.get("documents", [])
        target = next((d for d in docs if d.get("id") == doc_id), None)
        if not target:
            raise HTTPException(status_code=404, detail="Document not found")

        file_path = target.get("file_path", "")
        base_dir = os.path.dirname(os.path.abspath(__file__))
        cand_paths = [
            file_path,
            os.path.join(base_dir, file_path),
            os.path.join(base_dir, "uploads", file_path.replace("uploads/", "").replace("uploads\\", "")),
        ]
        resolved = None
        for p in cand_paths:
            if os.path.exists(p) and os.path.isfile(p):
                resolved = p
                break

        if not resolved:
            raise HTTPException(status_code=404, detail="File content not found on server disk")

        filename = target.get("name", "document")
        ct = target.get("content_type") or "application/octet-stream"
        with open(resolved, "rb") as f:
            data = f.read()

        return Response(
            content=data,
            media_type=ct,
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"',
                "Content-Length": str(len(data)),
            }
        )

    @router.delete("/{cid}/documents/{doc_id}")
    async def delete_customer_document(
        cid: str,
        doc_id: str,
        current: any = Depends(require_admin_or_manager)
    ):
        """Delete customer document attachment."""
        cust = await db.customers.find_one({"$or": [{"id": cid}, {"customer_code": cid}]})
        if not cust:
            raise HTTPException(status_code=404, detail="Customer not found")

        docs = cust.get("documents", [])
        target = next((d for d in docs if d.get("id") == doc_id), None)
        if not target:
            raise HTTPException(status_code=404, detail="Document not found")

        try:
            if os.path.exists(target.get("file_path", "")):
                os.remove(target["file_path"])
        except Exception:
            pass

        await db.customers.update_one({"_id": cust["_id"]}, {"$pull": {"documents": {"id": doc_id}}})
        await log_audit_entry(
            db=db, user=current, module="customer_documents", action="delete",
            record_id=cust.get("id") or cid, old_value=target, new_value=None
        )
        return {"ok": True, "deleted": True}

    return router
