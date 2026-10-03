import uuid
from datetime import datetime, timezone, date
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from security_vault import log_audit_entry, now_utc

class GpsPingInput(BaseModel):
    latitude: float
    longitude: float
    accuracy: Optional[float] = None
    speed: Optional[float] = None
    battery_level: Optional[float] = None
    activity: Optional[str] = "moving"  # still, moving, on_visit

class GpsPing(BaseModel):
    id: str
    user_id: str
    user_name: str
    latitude: float
    longitude: float
    accuracy: Optional[float] = None
    speed: Optional[float] = None
    battery_level: Optional[float] = None
    activity: str = "moving"
    timestamp: datetime = Field(default_factory=now_utc)

class ClientVisitInput(BaseModel):
    customer_id: str
    customer_name: Optional[str] = None
    purpose: str
    notes: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None

class ClientVisit(BaseModel):
    id: str
    user_id: str
    user_name: str
    customer_id: str
    customer_name: str
    purpose: str
    notes: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    visit_time: datetime = Field(default_factory=now_utc)

def make_gps_router(db, get_current_user, require_admin_or_manager):
    router = APIRouter(prefix="/gps", tags=["gps-tracking"])

    @router.post("/ping", response_model=GpsPing)
    async def record_gps_ping(payload: GpsPingInput, current: any = Depends(get_current_user)):
        """Record live field staff location ping."""
        now = now_utc()
        doc = {
            "id": f"gps_{uuid.uuid4().hex[:12]}",
            "user_id": current.user_id,
            "user_name": current.name,
            "latitude": payload.latitude,
            "longitude": payload.longitude,
            "accuracy": payload.accuracy,
            "speed": payload.speed,
            "battery_level": payload.battery_level,
            "activity": payload.activity or "moving",
            "timestamp": now,
        }
        await db.gps_tracking.insert_one(doc)

        # Update user's last known location
        await db.users.update_one(
            {"user_id": current.user_id},
            {"$set": {
                "last_location": {
                    "lat": payload.latitude,
                    "lng": payload.longitude,
                    "accuracy": payload.accuracy,
                    "updated_at": now
                }
            }}
        )
        return GpsPing(**doc)

    @router.get("/live", response_model=List[GpsPing])
    async def get_live_locations(current: any = Depends(require_admin_or_manager)):
        """Get latest location ping of all active field staff."""
        pipeline = [
            {"$sort": {"timestamp": -1}},
            {"$group": {
                "_id": "$user_id",
                "latest_ping": {"$first": "$$ROOT"}
            }},
            {"$replaceRoot": {"newRoot": "$latest_ping"}}
        ]
        docs = await db.gps_tracking.aggregate(pipeline).to_list(100)
        return [GpsPing(**d) for d in docs]

    @router.get("/history/{uid}", response_model=List[GpsPing])
    async def get_user_route_history(
        uid: str,
        target_date: Optional[str] = Query(None),
        current: any = Depends(require_admin_or_manager)
    ):
        """Retrieve historical GPS track of an employee for route visualization."""
        query = {"user_id": uid}
        if target_date:
            try:
                dt = datetime.strptime(target_date[:10], "%Y-%m-%d")
                start = dt.replace(hour=0, minute=0, second=0, tzinfo=timezone.utc)
                end = dt.replace(hour=23, minute=59, second=59, tzinfo=timezone.utc)
                query["timestamp"] = {"$gte": start, "$lte": end}
            except Exception:
                pass

        docs = await db.gps_tracking.find(query, {"_id": 0}).sort("timestamp", 1).to_list(1000)
        return [GpsPing(**d) for d in docs]

    @router.post("/visits", response_model=ClientVisit)
    async def log_client_visit(payload: ClientVisitInput, current: any = Depends(get_current_user)):
        """Log a field client visit."""
        cust = await db.customers.find_one({"$or": [{"id": payload.customer_id}, {"customer_code": payload.customer_id}]})
        cust_name = cust.get("name") if cust else payload.customer_name or "Unknown Client"

        now = now_utc()
        doc = {
            "id": f"vst_{uuid.uuid4().hex[:12]}",
            "user_id": current.user_id,
            "user_name": current.name,
            "customer_id": payload.customer_id,
            "customer_name": cust_name,
            "purpose": payload.purpose,
            "notes": payload.notes,
            "latitude": payload.latitude,
            "longitude": payload.longitude,
            "visit_time": now,
        }
        await db.client_visits.insert_one(doc)
        await log_audit_entry(db, current, "field_visits", "create", doc["id"], None, doc)
        return ClientVisit(**doc)

    @router.get("/visits", response_model=List[ClientVisit])
    async def list_client_visits(
        user_id: Optional[str] = Query(None),
        customer_id: Optional[str] = Query(None),
        current: any = Depends(get_current_user)
    ):
        query = {}
        if user_id: query["user_id"] = user_id
        if customer_id: query["customer_id"] = customer_id
        docs = await db.client_visits.find(query, {"_id": 0}).sort("visit_time", -1).to_list(200)
        return [ClientVisit(**d) for d in docs]

    return router
