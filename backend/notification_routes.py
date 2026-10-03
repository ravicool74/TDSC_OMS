import uuid
from datetime import datetime, timezone
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

def now_utc() -> datetime:
    return datetime.now(timezone.utc)

class Notification(BaseModel):
    id: str
    recipient_id: str  # user_id or "admin" or "all"
    title: str
    message: str
    notif_type: str  # task, invoice, payment, doc_expiry, leave, attendance, general
    link: Optional[str] = None
    is_read: bool = False
    created_at: datetime = Field(default_factory=now_utc)

class CreateNotificationInput(BaseModel):
    recipient_id: str = "all"
    title: str
    message: str
    notif_type: str = "general"
    link: Optional[str] = None

async def send_system_notification(
    db,
    title: str,
    message: str,
    notif_type: str = "general",
    recipient_id: str = "all",
    link: Optional[str] = None
):
    """Helper to dispatch notification to in-app notification center."""
    doc = {
        "id": f"notif_{uuid.uuid4().hex[:12]}",
        "recipient_id": recipient_id,
        "title": title,
        "message": message,
        "notif_type": notif_type,
        "link": link,
        "is_read": False,
        "created_at": now_utc(),
    }
    try:
        await db.notifications.insert_one(doc)
    except Exception as e:
        import logging
        logging.getLogger("notifications").error(f"Failed to save notification: {e}")

def make_notification_router(db, get_current_user):
    router = APIRouter(prefix="/notifications", tags=["notifications"])

    @router.get("", response_model=List[Notification])
    async def list_notifications(
        unread_only: bool = False,
        limit: int = Query(50, le=100),
        current: any = Depends(get_current_user)
    ):
        query = {
            "$or": [
                {"recipient_id": current.user_id},
                {"recipient_id": "all"},
                {"recipient_id": current.role},
            ]
        }
        if unread_only:
            query["is_read"] = False

        docs = await db.notifications.find(query, {"_id": 0}).sort("created_at", -1).to_list(limit)
        return [Notification(**d) for d in docs]

    @router.get("/unread-count")
    async def get_unread_count(current: any = Depends(get_current_user)):
        query = {
            "$or": [
                {"recipient_id": current.user_id},
                {"recipient_id": "all"},
                {"recipient_id": current.role},
            ],
            "is_read": False,
        }
        count = await db.notifications.count_documents(query)
        return {"unread_count": count}

    @router.patch("/{nid}/read", response_model=Notification)
    async def mark_as_read(nid: str, current: any = Depends(get_current_user)):
        await db.notifications.update_one({"id": nid}, {"$set": {"is_read": True}})
        d = await db.notifications.find_one({"id": nid}, {"_id": 0})
        if not d:
            raise HTTPException(status_code=404, detail="Notification not found")
        return Notification(**d)

    @router.post("/mark-all-read")
    async def mark_all_read(current: any = Depends(get_current_user)):
        query = {
            "$or": [
                {"recipient_id": current.user_id},
                {"recipient_id": "all"},
                {"recipient_id": current.role},
            ]
        }
        res = await db.notifications.update_many(query, {"$set": {"is_read": True}})
        return {"ok": True, "updated": res.modified_count}

    return router
