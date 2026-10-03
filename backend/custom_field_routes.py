from datetime import datetime, timezone
import re
import uuid
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

def now_utc() -> datetime:
    return datetime.now(timezone.utc)

def slugify_key(text: str) -> str:
    s = re.sub(r'[^a-zA-Z0-9]+', '_', text.strip().lower())
    s = re.sub(r'^_+|_+$', '', s)
    return s or f"field_{uuid.uuid4().hex[:6]}"

class CustomerCustomField(BaseModel):
    id: str
    field_key: str
    label: str
    field_type: str = "text"  # text, number, date, textarea, select
    options: List[str] = Field(default_factory=list)
    placeholder: Optional[str] = None
    required: bool = False
    created_by: Optional[str] = None
    created_at: datetime = Field(default_factory=now_utc)

class CustomerCustomFieldInput(BaseModel):
    label: str
    field_key: Optional[str] = None
    field_type: str = "text"  # text, number, date, textarea, select
    options: Optional[List[str]] = Field(default_factory=list)
    placeholder: Optional[str] = None
    required: bool = False

def make_custom_field_router(db, get_current_user, require_admin, log_audit):
    router = APIRouter(prefix="/customers/custom-fields", tags=["customer-custom-fields"])

    @router.get("", response_model=List[CustomerCustomField])
    async def list_customer_custom_fields(current=Depends(get_current_user)):
        docs = await db.customer_custom_fields.find({}, {"_id": 0}).sort("created_at", 1).to_list(100)
        return [CustomerCustomField(**d) for d in docs]

    @router.post("", response_model=CustomerCustomField)
    async def create_customer_custom_field(payload: CustomerCustomFieldInput, current=Depends(require_admin)):
        label = (payload.label or "").strip()
        if not label:
            raise HTTPException(status_code=400, detail="Field label is required")
        
        field_type = (payload.field_type or "text").strip().lower()
        if field_type not in ("text", "number", "date", "textarea", "select"):
            field_type = "text"

        key = (payload.field_key or "").strip()
        if not key:
            key = slugify_key(label)
        else:
            key = slugify_key(key)

        # Ensure field_key uniqueness
        existing = await db.customer_custom_fields.find_one({"field_key": key}, {"_id": 0})
        if existing:
            # If same key exists, append short hash to keep unique
            key = f"{key}_{uuid.uuid4().hex[:4]}"

        cf_id = f"TDSC-CF-{uuid.uuid4().hex[:8].upper()}"
        options = [o.strip() for o in (payload.options or []) if o.strip()]

        doc = CustomerCustomField(
            id=cf_id,
            field_key=key,
            label=label,
            field_type=field_type,
            options=options,
            placeholder=payload.placeholder,
            required=payload.required,
            created_by=getattr(current, "user_id", "admin"),
            created_at=now_utc(),
        )

        await db.customer_custom_fields.insert_one(doc.dict())

        await log_audit(
            db,
            current,
            "customers",
            "create_custom_field",
            cf_id,
            None,
            doc.dict()
        )

        return doc

    @router.delete("/{field_id}")
    async def delete_customer_custom_field(field_id: str, current=Depends(require_admin)):
        field = await db.customer_custom_fields.find_one({"id": field_id}, {"_id": 0})
        if not field:
            raise HTTPException(status_code=404, detail="Custom field not found")

        await db.customer_custom_fields.delete_one({"id": field_id})

        await log_audit(
            db,
            current,
            "customers",
            "delete_custom_field",
            field_id,
            field,
            None
        )

        return {"status": "deleted", "id": field_id, "label": field.get("label")}

    return router
