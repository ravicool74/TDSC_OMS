from datetime import datetime, timezone, date
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from security_vault import log_audit_entry, now_utc

def get_financial_year(dt: Optional[datetime] = None) -> str:
    d = dt.date() if dt else date.today()
    if d.month >= 4:
        return f"{d.year}-{str(d.year + 1)[-2:]}"
    else:
        return f"{d.year - 1}-{str(d.year)[-2:]}"

class VoucherItem(BaseModel):
    item_id: Optional[str] = None
    name: str
    description: Optional[str] = None
    qty: float = 1.0
    rate: float = 0.0
    discount: float = 0.0
    tax_rate: float = 18.0
    sac_hsn: Optional[str] = "998313"
    amount: float = 0.0
    tax_amount: float = 0.0
    total: float = 0.0

class Estimate(BaseModel):
    id: str
    estimate_no: str
    date: str
    customer_id: str
    customer_code: Optional[str] = None
    customer_name: str
    customer_mobile: Optional[str] = None
    customer_address: Optional[str] = None
    items: List[VoucherItem] = Field(default_factory=list)
    subtotal: float = 0.0
    total_discount: float = 0.0
    total_tax: float = 0.0
    grand_total: float = 0.0
    status: str = "draft"  # draft, sent, accepted, converted, closed
    converted_invoice_id: Optional[str] = None
    notes: Optional[str] = None
    created_at: datetime = Field(default_factory=now_utc)
    updated_at: datetime = Field(default_factory=now_utc)

class EstimateInput(BaseModel):
    date: str
    customer_id: str
    items: List[VoucherItem]
    notes: Optional[str] = None
    status: str = "draft"

class ProformaInvoice(BaseModel):
    id: str
    proforma_no: str
    date: str
    customer_id: str
    customer_code: Optional[str] = None
    customer_name: str
    customer_mobile: Optional[str] = None
    customer_address: Optional[str] = None
    items: List[VoucherItem] = Field(default_factory=list)
    subtotal: float = 0.0
    total_discount: float = 0.0
    total_tax: float = 0.0
    grand_total: float = 0.0
    status: str = "draft"  # draft, sent, converted, cancelled
    converted_invoice_id: Optional[str] = None
    notes: Optional[str] = None
    created_at: datetime = Field(default_factory=now_utc)
    updated_at: datetime = Field(default_factory=now_utc)

class ProformaInput(BaseModel):
    date: str
    customer_id: str
    items: List[VoucherItem]
    notes: Optional[str] = None

class DeliveryChallan(BaseModel):
    id: str
    challan_no: str
    date: str
    customer_id: str
    customer_name: str
    invoice_id: Optional[str] = None
    invoice_no: Optional[str] = None
    vehicle_no: Optional[str] = None
    dispatch_through: Optional[str] = None
    items: List[VoucherItem] = Field(default_factory=list)
    notes: Optional[str] = None
    created_at: datetime = Field(default_factory=now_utc)

class DeliveryChallanInput(BaseModel):
    date: str
    customer_id: str
    invoice_id: Optional[str] = None
    vehicle_no: Optional[str] = None
    dispatch_through: Optional[str] = None
    items: List[VoucherItem]
    notes: Optional[str] = None

def compute_totals(items: List[VoucherItem]):
    subtotal = 0.0
    total_discount = 0.0
    total_tax = 0.0
    calculated_items = []
    for it in items:
        amt = round(float(it.qty) * float(it.rate), 2)
        disc = round(float(it.discount), 2)
        taxable = max(0.0, amt - disc)
        tax = round(taxable * (float(it.tax_rate) / 100.0), 2)
        item_tot = round(taxable + tax, 2)

        subtotal += amt
        total_discount += disc
        total_tax += tax
        
        calculated_items.append({
            "item_id": it.item_id,
            "name": it.name,
            "description": it.description,
            "qty": it.qty,
            "rate": it.rate,
            "discount": disc,
            "tax_rate": it.tax_rate,
            "sac_hsn": it.sac_hsn,
            "amount": amt,
            "tax_amount": tax,
            "total": item_tot
        })
    grand_total = round(subtotal - total_discount + total_tax, 2)
    return calculated_items, round(subtotal, 2), round(total_discount, 2), round(total_tax, 2), grand_total

def make_accounting_extra_router(db, get_current_user, require_admin, require_admin_or_manager):
    router = APIRouter(prefix="/accounting", tags=["accounting-extra"])

    # ====== ESTIMATES / QUOTATIONS ======
    @router.get("/estimates", response_model=List[Estimate])
    async def list_estimates(
        q: Optional[str] = Query(None),
        status: Optional[str] = Query(None),
        current: any = Depends(get_current_user)
    ):
        query = {}
        if status: query["status"] = status
        if q:
            regex = {"$regex": q.strip(), "$options": "i"}
            query["$or"] = [{"estimate_no": regex}, {"customer_name": regex}, {"customer_code": regex}]
        docs = await db.estimates.find(query, {"_id": 0}).sort("created_at", -1).to_list(200)
        return [Estimate(**d) for d in docs]

    @router.post("/estimates", response_model=Estimate)
    async def create_estimate(payload: EstimateInput, current: any = Depends(get_current_user)):
        cust = await db.customers.find_one({"$or": [{"id": payload.customer_id}, {"customer_code": payload.customer_id}]})
        if not cust:
            raise HTTPException(status_code=404, detail="Customer not found")

        fy = get_financial_year()
        counter = await db.counters.find_one_and_update(
            {"_id": f"estimate_{fy}"}, {"$inc": {"seq": 1}}, upsert=True, return_document=True
        )
        seq = counter.get("seq", 1)
        est_no = f"TDSC-EST/{fy}/{seq:04d}"
        now = now_utc()

        items, subtotal, discount, tax, grand = compute_totals(payload.items)
        doc = {
            "id": f"est_{now.strftime('%Y%m%d%H%M%S')}_{seq}",
            "estimate_no": est_no,
            "date": payload.date,
            "customer_id": cust.get("id"),
            "customer_code": cust.get("customer_code"),
            "customer_name": cust.get("name"),
            "customer_mobile": cust.get("mobile"),
            "customer_address": cust.get("address"),
            "items": items,
            "subtotal": subtotal,
            "total_discount": discount,
            "total_tax": tax,
            "grand_total": grand,
            "status": payload.status,
            "converted_invoice_id": None,
            "notes": payload.notes,
            "created_at": now,
            "updated_at": now,
        }
        await db.estimates.insert_one(doc)
        await log_audit_entry(db, current, "estimates", "create", est_no, None, doc)
        return Estimate(**doc)

    @router.post("/estimates/{eid}/convert-to-invoice")
    async def convert_estimate_to_invoice(eid: str, current: any = Depends(require_admin_or_manager)):
        est = await db.estimates.find_one({"$or": [{"id": eid}, {"estimate_no": eid}]})
        if not est:
            raise HTTPException(status_code=404, detail="Estimate not found")
        if est.get("status") == "converted":
            raise HTTPException(status_code=400, detail="Estimate already converted")

        fy = get_financial_year()
        counter = await db.counters.find_one_and_update(
            {"_id": f"invoice_{fy}"}, {"$inc": {"seq": 1}}, upsert=True, return_document=True
        )
        seq = counter.get("seq", 1)
        inv_no = f"TDSC/{fy}/{seq:06d}"
        now = now_utc()

        inv_items = []
        for it in est.get("items", []):
            inv_items.append({
                "item_id": it.get("item_id"),
                "name": it.get("name"),
                "quantity": it.get("qty", 1.0),
                "price": it.get("rate", 0.0),
                "discount": it.get("discount", 0.0),
                "tax_rate": it.get("tax_rate", 18.0),
                "total": it.get("total", 0.0)
            })

        inv_doc = {
            "id": f"inv_{now.strftime('%Y%m%d%H%M%S')}_{seq}",
            "invoice_number": inv_no,
            "invoice_type": "sale",
            "invoice_date": est.get("date") or date.today().isoformat(),
            "due_date": est.get("date") or date.today().isoformat(),
            "party_id": est.get("customer_id"),
            "party_name": est.get("customer_name"),
            "payment_type": "credit",
            "payment_mode": "cash",
            "items": inv_items,
            "subtotal": est.get("subtotal", 0.0),
            "total_discount": est.get("total_discount", 0.0),
            "total_tax": est.get("total_tax", 0.0),
            "total_amount": est.get("grand_total", 0.0),
            "paid_amount": 0.0,
            "balance": est.get("grand_total", 0.0),
            "status": "unpaid",
            "notes": f"Converted from Estimate {est.get('estimate_no')}",
            "attachments": [],
            "created_by": current.user_id,
            "created_at": now,
        }
        await db.invoices.insert_one(inv_doc)

        await db.estimates.update_one(
            {"id": est["id"]},
            {"$set": {"status": "converted", "converted_invoice_id": inv_doc["id"], "updated_at": now}}
        )

        await log_audit_entry(db, current, "estimates", "convert_to_invoice", est.get("estimate_no"), est, inv_doc)
        return {"ok": True, "invoice_id": inv_doc["id"], "invoice_number": inv_no}

    # ====== PROFORMA INVOICES ======
    @router.get("/proforma", response_model=List[ProformaInvoice])
    async def list_proforma(
        q: Optional[str] = Query(None),
        current: any = Depends(get_current_user)
    ):
        query = {}
        if q:
            regex = {"$regex": q.strip(), "$options": "i"}
            query["$or"] = [{"proforma_no": regex}, {"customer_name": regex}]
        docs = await db.proforma_invoices.find(query, {"_id": 0}).sort("created_at", -1).to_list(200)
        return [ProformaInvoice(**d) for d in docs]

    @router.post("/proforma", response_model=ProformaInvoice)
    async def create_proforma(payload: ProformaInput, current: any = Depends(get_current_user)):
        cust = await db.customers.find_one({"$or": [{"id": payload.customer_id}, {"customer_code": payload.customer_id}]})
        if not cust:
            raise HTTPException(status_code=404, detail="Customer not found")

        fy = get_financial_year()
        counter = await db.counters.find_one_and_update(
            {"_id": f"proforma_{fy}"}, {"$inc": {"seq": 1}}, upsert=True, return_document=True
        )
        seq = counter.get("seq", 1)
        pi_no = f"TDSC-PI/{fy}/{seq:04d}"
        now = now_utc()

        items, subtotal, discount, tax, grand = compute_totals(payload.items)
        doc = {
            "id": f"pi_{now.strftime('%Y%m%d%H%M%S')}_{seq}",
            "proforma_no": pi_no,
            "date": payload.date,
            "customer_id": cust.get("id"),
            "customer_code": cust.get("customer_code"),
            "customer_name": cust.get("name"),
            "customer_mobile": cust.get("mobile"),
            "customer_address": cust.get("address"),
            "items": items,
            "subtotal": subtotal,
            "total_discount": discount,
            "total_tax": tax,
            "grand_total": grand,
            "status": "draft",
            "converted_invoice_id": None,
            "notes": payload.notes,
            "created_at": now,
            "updated_at": now,
        }
        await db.proforma_invoices.insert_one(doc)
        await log_audit_entry(db, current, "proforma", "create", pi_no, None, doc)
        return ProformaInvoice(**doc)

    @router.post("/proforma/{pid}/convert-to-invoice")
    async def convert_proforma_to_invoice(pid: str, current: any = Depends(require_admin_or_manager)):
        pi = await db.proforma_invoices.find_one({"$or": [{"id": pid}, {"proforma_no": pid}]})
        if not pi:
            raise HTTPException(status_code=404, detail="Proforma Invoice not found")
        if pi.get("status") == "converted":
            raise HTTPException(status_code=400, detail="Proforma already converted")

        fy = get_financial_year()
        counter = await db.counters.find_one_and_update(
            {"_id": f"invoice_{fy}"}, {"$inc": {"seq": 1}}, upsert=True, return_document=True
        )
        seq = counter.get("seq", 1)
        inv_no = f"TDSC/{fy}/{seq:06d}"
        now = now_utc()

        inv_items = []
        for it in pi.get("items", []):
            inv_items.append({
                "item_id": it.get("item_id"),
                "name": it.get("name"),
                "quantity": it.get("qty", 1.0),
                "price": it.get("rate", 0.0),
                "discount": it.get("discount", 0.0),
                "tax_rate": it.get("tax_rate", 18.0),
                "total": it.get("total", 0.0)
            })

        inv_doc = {
            "id": f"inv_{now.strftime('%Y%m%d%H%M%S')}_{seq}",
            "invoice_number": inv_no,
            "invoice_type": "sale",
            "invoice_date": pi.get("date") or date.today().isoformat(),
            "due_date": pi.get("date") or date.today().isoformat(),
            "party_id": pi.get("customer_id"),
            "party_name": pi.get("customer_name"),
            "payment_type": "credit",
            "payment_mode": "cash",
            "items": inv_items,
            "subtotal": pi.get("subtotal", 0.0),
            "total_discount": pi.get("total_discount", 0.0),
            "total_tax": pi.get("total_tax", 0.0),
            "total_amount": pi.get("grand_total", 0.0),
            "paid_amount": 0.0,
            "balance": pi.get("grand_total", 0.0),
            "status": "unpaid",
            "notes": f"Converted from Proforma {pi.get('proforma_no')}",
            "attachments": [],
            "created_by": current.user_id,
            "created_at": now,
        }
        await db.invoices.insert_one(inv_doc)

        await db.proforma_invoices.update_one(
            {"id": pi["id"]},
            {"$set": {"status": "converted", "converted_invoice_id": inv_doc["id"], "updated_at": now}}
        )

        await log_audit_entry(db, current, "proforma", "convert_to_invoice", pi.get("proforma_no"), pi, inv_doc)
        return {"ok": True, "invoice_id": inv_doc["id"], "invoice_number": inv_no}

    # ====== DELIVERY CHALLANS ======
    @router.get("/challans", response_model=List[DeliveryChallan])
    async def list_challans(current: any = Depends(get_current_user)):
        docs = await db.delivery_challans.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)
        return [DeliveryChallan(**d) for d in docs]

    @router.post("/challans", response_model=DeliveryChallan)
    async def create_challan(payload: DeliveryChallanInput, current: any = Depends(get_current_user)):
        cust = await db.customers.find_one({"$or": [{"id": payload.customer_id}, {"customer_code": payload.customer_id}]})
        if not cust:
            raise HTTPException(status_code=404, detail="Customer not found")

        fy = get_financial_year()
        counter = await db.counters.find_one_and_update(
            {"_id": f"challan_{fy}"}, {"$inc": {"seq": 1}}, upsert=True, return_document=True
        )
        seq = counter.get("seq", 1)
        dc_no = f"TDSC-DC/{fy}/{seq:04d}"
        now = now_utc()

        items, _, _, _, _ = compute_totals(payload.items)
        doc = {
            "id": f"dc_{now.strftime('%Y%m%d%H%M%S')}_{seq}",
            "challan_no": dc_no,
            "date": payload.date,
            "customer_id": cust.get("id"),
            "customer_name": cust.get("name"),
            "invoice_id": payload.invoice_id,
            "vehicle_no": payload.vehicle_no,
            "dispatch_through": payload.dispatch_through,
            "items": items,
            "notes": payload.notes,
            "created_at": now,
        }
        await db.delivery_challans.insert_one(doc)
        await log_audit_entry(db, current, "challans", "create", dc_no, None, doc)
        return DeliveryChallan(**doc)

    return router
