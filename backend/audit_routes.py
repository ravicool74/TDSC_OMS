from datetime import datetime, timezone
from typing import List, Optional, Any
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

class AuditLogItem(BaseModel):
    id: str
    user_id: Optional[str] = None
    user_name: Optional[str] = None
    user_email: Optional[str] = None
    user_role: Optional[str] = None
    module: str
    action: str
    record_id: Optional[str] = None
    old_value: Optional[Any] = None
    new_value: Optional[Any] = None
    ip_address: Optional[str] = None
    device_info: Optional[str] = None
    created_at: datetime

def make_audit_router(db, get_current_user, require_admin):
    router = APIRouter(prefix="/audit-logs", tags=["audit-logs"])

    @router.get("", response_model=List[AuditLogItem])
    async def list_audit_logs(
        module: Optional[str] = Query(None),
        action: Optional[str] = Query(None),
        user_id: Optional[str] = Query(None),
        limit: int = Query(100, le=500),
        current: any = Depends(require_admin)
    ):
        query = {}
        if module:
            query["module"] = module
        if action:
            query["action"] = action
        if user_id:
            query["user_id"] = user_id

        from security_vault import clean_json_value
        docs = await db.audit_logs.find(query, {"_id": 0}).sort("created_at", -1).to_list(limit)
        cleaned = []
        for d in docs:
            d["old_value"] = clean_json_value(d.get("old_value"))
            d["new_value"] = clean_json_value(d.get("new_value"))
            cleaned.append(AuditLogItem(**d))
        return cleaned

    return router
