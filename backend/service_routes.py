from datetime import datetime, timezone
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

def now_utc() -> datetime:
    return datetime.now(timezone.utc)

class Service(BaseModel):
    id: str
    service_id: str
    name: str
    description: Optional[str] = None
    rate: float = 0.0
    gst_percent: float = 18.0
    sac_hsn: Optional[str] = "998313"
    status: str = "active"  # active, inactive
    created_at: datetime = Field(default_factory=now_utc)
    updated_at: datetime = Field(default_factory=now_utc)

class ServiceInput(BaseModel):
    name: str
    description: Optional[str] = None
    rate: float = 0.0
    gst_percent: float = 18.0
    sac_hsn: Optional[str] = "998313"
    status: str = "active"

class ServiceUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    rate: Optional[float] = None
    gst_percent: Optional[float] = None
    sac_hsn: Optional[str] = None
    status: Optional[str] = None

DEFAULT_SERVICES = [
    {"name": "Digital Signature (DSC Class 3)", "rate": 2000.0, "gst_percent": 18.0, "sac_hsn": "998313", "description": "Class 3 DSC Signing & Encryption Combo with 2 Years validity"},
    {"name": "E-Tender Service", "rate": 2500.0, "gst_percent": 18.0, "sac_hsn": "998313", "description": "Tender search, document preparation, and bidding on state/central portals"},
    {"name": "Eproc2 Registration", "rate": 1500.0, "gst_percent": 18.0, "sac_hsn": "998313", "description": "Bihar eProc2 contractor registration and profile verification"},
    {"name": "Contractor Registration", "rate": 5000.0, "gst_percent": 18.0, "sac_hsn": "998313", "description": "State PWD, RWD, BCD contractor registration and license renewal"},
    {"name": "GST Registration", "rate": 1500.0, "gst_percent": 18.0, "sac_hsn": "998311", "description": "New GSTIN registration for proprietor, partnership or company"},
    {"name": "EPFO Registration", "rate": 2000.0, "gst_percent": 18.0, "sac_hsn": "998311", "description": "Employees Provident Fund Organization employer establishment code"},
    {"name": "FSSAI Registration", "rate": 2000.0, "gst_percent": 18.0, "sac_hsn": "998311", "description": "Food Safety and Standards Authority of India basic or state license"},
    {"name": "GeM Registration", "rate": 2500.0, "gst_percent": 18.0, "sac_hsn": "998313", "description": "Government e-Marketplace primary seller registration & brand listing"},
    {"name": "Railway Tender Service (IREPS)", "rate": 3000.0, "gst_percent": 18.0, "sac_hsn": "998313", "description": "Indian Railways E-Procurement System registration & bid submission"},
    {"name": "Trade License", "rate": 1800.0, "gst_percent": 18.0, "sac_hsn": "998311", "description": "Municipal corporation trade license issuance and renewal"},
    {"name": "Factory License", "rate": 7500.0, "gst_percent": 18.0, "sac_hsn": "998311", "description": "Industrial factory license & compliance documentation"},
    {"name": "Company Creation (Pvt Ltd / LLP / OPC)", "rate": 8000.0, "gst_percent": 18.0, "sac_hsn": "998311", "description": "MCA company incorporation, MOA, AOA, PAN and TAN"},
    {"name": "MSME / Udyam Registration", "rate": 1000.0, "gst_percent": 18.0, "sac_hsn": "998311", "description": "Government Udyam registration certificate for small enterprises"},
    {"name": "SBD (Standard Bidding Document)", "rate": 3500.0, "gst_percent": 18.0, "sac_hsn": "998313", "description": "Comprehensive standard bidding preparation for infrastructure tenders"},
    {"name": "MBD (Medium Bidding Document)", "rate": 4500.0, "gst_percent": 18.0, "sac_hsn": "998313", "description": "Technical and financial bid dossier for medium-value tenders"},
    {"name": "CMBD (Complex Multi-work Bidding Document)", "rate": 6000.0, "gst_percent": 18.0, "sac_hsn": "998313", "description": "Multi-work joint venture and complex consortium tender document compilation"},
    {"name": "OPRMC (Output and Performance Based Road Maintenance)", "rate": 7500.0, "gst_percent": 18.0, "sac_hsn": "998313", "description": "OPRMC road network maintenance bid compliance and reporting package"},
]

def make_service_router(db, get_current_user, require_admin, log_audit):
    router = APIRouter(prefix="/services", tags=["services"])

    async def get_next_service_id() -> str:
        counter = await db.counters.find_one_and_update(
            {"_id": "service_id"},
            {"$inc": {"seq": 1}},
            upsert=True,
            return_document=True
        )
        seq = counter.get("seq", 1)
        return f"TDSC-SRV-{seq:04d}"

    async def ensure_default_services():
        count = await db.services.count_documents({})
        if count == 0:
            for item in DEFAULT_SERVICES:
                sid = await get_next_service_id()
                now = now_utc()
                doc = {
                    "id": f"srv_{sid.replace('-', '_').lower()}",
                    "service_id": sid,
                    "name": item["name"],
                    "description": item["description"],
                    "rate": float(item["rate"]),
                    "gst_percent": float(item["gst_percent"]),
                    "sac_hsn": item["sac_hsn"],
                    "status": "active",
                    "created_at": now,
                    "updated_at": now,
                }
                await db.services.insert_one(doc)

                # Also sync into items collection for Vyapar item autocomplete
                item_doc = {
                    "id": doc["id"],
                    "name": doc["name"],
                    "sale_price": doc["rate"],
                    "purchase_price": 0.0,
                    "tax_rate": doc["gst_percent"],
                    "unit": "PCS",
                    "is_service": True,
                    "hsn_code": doc["sac_hsn"],
                    "created_at": now,
                }
                await db.items.update_one({"name": {"$regex": f"^{doc['name']}$", "$options": "i"}}, {"$set": item_doc}, upsert=True)

    router.ensure_default_services = ensure_default_services

    @router.get("", response_model=List[Service])
    async def list_services(
        q: Optional[str] = Query(None),
        status: Optional[str] = Query(None),
        current: any = Depends(get_current_user)
    ):
        await ensure_default_services()
        query = {}
        if status:
            query["status"] = status
        if q:
            regex = {"$regex": q.strip(), "$options": "i"}
            query["$or"] = [
                {"name": regex},
                {"service_id": regex},
                {"sac_hsn": regex},
                {"description": regex},
            ]
        docs = await db.services.find(query, {"_id": 0}).sort("created_at", 1).to_list(200)
        return [Service(**d) for d in docs]

    @router.get("/{sid}", response_model=Service)
    async def get_service(sid: str, current: any = Depends(get_current_user)):
        d = await db.services.find_one({"$or": [{"id": sid}, {"service_id": sid}]}, {"_id": 0})
        if not d:
            raise HTTPException(status_code=404, detail="Service not found")
        return Service(**d)

    @router.post("", response_model=Service)
    async def create_service(payload: ServiceInput, current: any = Depends(require_admin)):
        sid = await get_next_service_id()
        now = now_utc()
        doc = payload.dict()
        doc.update({
            "id": f"srv_{sid.replace('-', '_').lower()}",
            "service_id": sid,
            "created_at": now,
            "updated_at": now,
        })
        await db.services.insert_one(doc)

        # Mirror into items for billing autocomplete
        item_doc = {
            "id": doc["id"],
            "name": doc["name"],
            "sale_price": doc["rate"],
            "purchase_price": 0.0,
            "tax_rate": doc["gst_percent"],
            "unit": "PCS",
            "is_service": True,
            "hsn_code": doc.get("sac_hsn"),
            "created_at": now,
        }
        await db.items.update_one({"name": {"$regex": f"^{doc['name']}$", "$options": "i"}}, {"$set": item_doc}, upsert=True)

        await log_audit(db, current, "services", "create", sid, None, doc)
        return Service(**doc)

    @router.put("/{sid}", response_model=Service)
    @router.patch("/{sid}", response_model=Service)
    async def update_service(sid: str, payload: ServiceUpdate, current: any = Depends(require_admin)):
        existing = await db.services.find_one({"$or": [{"id": sid}, {"service_id": sid}]}, {"_id": 0})
        if not existing:
            raise HTTPException(status_code=404, detail="Service not found")

        updates = {k: v for k, v in payload.dict().items() if v is not None}
        updates["updated_at"] = now_utc()

        await db.services.update_one({"id": existing["id"]}, {"$set": updates})

        # Sync with items
        item_updates = {}
        if "name" in updates: item_updates["name"] = updates["name"]
        if "rate" in updates: item_updates["sale_price"] = updates["rate"]
        if "gst_percent" in updates: item_updates["tax_rate"] = updates["gst_percent"]
        if "sac_hsn" in updates: item_updates["hsn_code"] = updates["sac_hsn"]
        if item_updates:
            await db.items.update_one({"id": existing["id"]}, {"$set": item_updates})

        updated = await db.services.find_one({"id": existing["id"]}, {"_id": 0})
        await log_audit(db, current, "services", "update", existing.get("service_id"), existing, updated)
        return Service(**updated)

    @router.delete("/{sid}")
    async def delete_service(sid: str, current: any = Depends(require_admin)):
        existing = await db.services.find_one({"$or": [{"id": sid}, {"service_id": sid}]}, {"_id": 0})
        if not existing:
            raise HTTPException(status_code=404, detail="Service not found")

        res = await db.services.delete_one({"id": existing["id"]})
        await db.items.delete_one({"id": existing["id"]})
        await log_audit(db, current, "services", "delete", existing.get("service_id"), existing, None)
        return {"ok": True, "deleted": res.deleted_count}

    return router
