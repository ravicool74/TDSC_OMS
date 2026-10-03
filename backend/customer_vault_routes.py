import os
import uuid
from datetime import datetime, timezone, date
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form
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
                exp_dt = datetime.strptime(dsc_exp[:10], "%Y-%m-%d").date()
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
                exp_dt = datetime.strptime(enc_exp[:10], "%Y-%m-%d").date()
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
                    exp_dt = datetime.strptime(doc_exp[:10], "%Y-%m-%d").date()
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
        category: str = Form("PAN"),
        document_date: Optional[str] = Form(None),
        expiry_date: Optional[str] = Form(None),
        remarks: Optional[str] = Form(None),
        current: any = Depends(require_admin_or_manager)
    ):
        """Upload customer document with category, document date, and expiry alert date."""
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

        doc_entry = {
            "id": doc_id,
            "name": file.filename,
            "category": category,
            "document_date": document_date,
            "expiry_date": expiry_date,
            "remarks": remarks,
            "size": len(content),
            "content_type": file.content_type or "application/octet-stream",
            "file_path": file_path,
            "uploaded_at": now_utc(),
        }

        await db.customers.update_one({"id": cust["id"]}, {"$push": {"documents": doc_entry}})
        await log_audit_entry(
            db=db, user=current, module="customer_documents", action="upload",
            record_id=cust["id"], old_value=None,
            new_value={"doc_id": doc_id, "name": file.filename, "category": category, "expiry_date": expiry_date}
        )
        return {"ok": True, "document": doc_entry}

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

        await db.customers.update_one({"id": cust["id"]}, {"$pull": {"documents": {"id": doc_id}}})
        await log_audit_entry(
            db=db, user=current, module="customer_documents", action="delete",
            record_id=cust["id"], old_value=target, new_value=None
        )
        return {"ok": True, "deleted": True}

    return router
