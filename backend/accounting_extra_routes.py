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
    estimate_no: Optional[str] = None
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
    proforma_no: Optional[str] = None
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
    challan_no: Optional[str] = None
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
            query["$or"] = [{"estimate_no": regex}, {"customer_name": regex}, {"customer_code": regex}, {"customer_mobile": regex}]
        docs = await db.estimates.find(query, {"_id": 0}).sort("created_at", -1).to_list(200)
        return [Estimate(**d) for d in docs]

    @router.get("/estimates/next-no")
    async def get_next_estimate_no(date: Optional[str] = Query(None), current: any = Depends(get_current_user)):
        from server import _get_voucher_settings, _peek_next_voucher_no
        s = await _get_voucher_settings("estimate")
        effective_date = date or s.get("date_start_from")
        next_no = await _peek_next_voucher_no("estimate", effective_date)
        return {
            "next_no": next_no,
            "voucher_mode": s.get("voucher_mode", "auto"),
            "date_start_from": s.get("date_start_from"),
            "prefix": s.get("prefix", "TDSC-EST"),
            "start_seq": s.get("start_seq", 1),
        }

    @router.post("/estimates", response_model=Estimate)
    async def create_estimate(payload: EstimateInput, current: any = Depends(get_current_user)):
        cust = await db.customers.find_one({"$or": [{"id": payload.customer_id}, {"customer_code": payload.customer_id}]})
        if not cust:
            raise HTTPException(status_code=404, detail="Customer not found")

        from server import _next_voucher_no
        custom_no = getattr(payload, "estimate_no", None)
        if custom_no and not "preview" in str(custom_no).lower() and str(custom_no).strip():
            est_no = str(custom_no).strip()
            seq = 1
        else:
            est_no = await _next_voucher_no("estimate", payload.date)
            seq = 1
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

    @router.get("/estimates/{eid}", response_model=Estimate)
    async def get_estimate(eid: str, current: any = Depends(get_current_user)):
        est = await db.estimates.find_one({"$or": [{"id": eid}, {"estimate_no": eid}]}, {"_id": 0})
        if not est:
            raise HTTPException(status_code=404, detail="Estimate not found")
        return Estimate(**est)

    @router.put("/estimates/{eid}", response_model=Estimate)
    @router.patch("/estimates/{eid}", response_model=Estimate)
    async def update_estimate(eid: str, payload: EstimateInput, current: any = Depends(require_admin_or_manager)):
        est = await db.estimates.find_one({"$or": [{"id": eid}, {"estimate_no": eid}]})
        if not est:
            raise HTTPException(status_code=404, detail="Estimate not found")
        cust = await db.customers.find_one({"$or": [{"id": payload.customer_id}, {"customer_code": payload.customer_id}]})
        items, subtotal, discount, tax, grand = compute_totals(payload.items)
        now = now_utc()
        upd = {
            "date": payload.date,
            "customer_id": cust.get("id") if cust else payload.customer_id,
            "customer_code": cust.get("customer_code") if cust else est.get("customer_code"),
            "customer_name": cust.get("name") if cust else est.get("customer_name"),
            "customer_mobile": cust.get("mobile") if cust else est.get("customer_mobile"),
            "customer_address": cust.get("address") if cust else est.get("customer_address"),
            "items": items,
            "subtotal": subtotal,
            "total_discount": discount,
            "total_tax": tax,
            "grand_total": grand,
            "status": payload.status or est.get("status", "draft"),
            "notes": payload.notes,
            "updated_at": now,
        }
        await db.estimates.update_one({"id": est["id"]}, {"$set": upd})
        doc = await db.estimates.find_one({"id": est["id"]}, {"_id": 0})
        await log_audit_entry(db, current, "estimates", "update", est.get("estimate_no"), est, doc)
        return Estimate(**doc)

    @router.delete("/estimates/{eid}")
    async def delete_estimate(eid: str, current: any = Depends(require_admin_or_manager)):
        res = await db.estimates.delete_one({"$or": [{"id": eid}, {"estimate_no": eid}]})
        if res.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Estimate not found")
        await log_audit_entry(db, current, "estimates", "delete", eid, None, {"deleted": True})
        return {"ok": True, "deleted": res.deleted_count}

    # ====== PROFORMA INVOICES ======
    @router.get("/proforma", response_model=List[ProformaInvoice])
    async def list_proforma(
        q: Optional[str] = Query(None),
        current: any = Depends(get_current_user)
    ):
        query = {}
        if q:
            regex = {"$regex": q.strip(), "$options": "i"}
            query["$or"] = [{"proforma_no": regex}, {"customer_name": regex}, {"customer_code": regex}, {"customer_mobile": regex}]
        docs = await db.proforma_invoices.find(query, {"_id": 0}).sort("created_at", -1).to_list(200)
        return [ProformaInvoice(**d) for d in docs]

    @router.get("/proforma/next-no")
    async def get_next_proforma_no(date: Optional[str] = Query(None), current: any = Depends(get_current_user)):
        from server import _get_voucher_settings, _peek_next_voucher_no
        s = await _get_voucher_settings("proforma")
        effective_date = date or s.get("date_start_from")
        next_no = await _peek_next_voucher_no("proforma", effective_date)
        return {
            "next_no": next_no,
            "voucher_mode": s.get("voucher_mode", "auto"),
            "date_start_from": s.get("date_start_from"),
            "prefix": s.get("prefix", "TDSC-PI"),
            "start_seq": s.get("start_seq", 1),
        }

    @router.post("/proforma", response_model=ProformaInvoice)
    async def create_proforma(payload: ProformaInput, current: any = Depends(get_current_user)):
        cust = await db.customers.find_one({"$or": [{"id": payload.customer_id}, {"customer_code": payload.customer_id}]})
        if not cust:
            raise HTTPException(status_code=404, detail="Customer not found")

        from server import _next_voucher_no
        custom_no = getattr(payload, "proforma_no", None)
        if custom_no and not "preview" in str(custom_no).lower() and str(custom_no).strip():
            pi_no = str(custom_no).strip()
            seq = 1
        else:
            pi_no = await _next_voucher_no("proforma", payload.date)
            seq = 1
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

    @router.get("/proforma/{pid}", response_model=ProformaInvoice)
    async def get_proforma(pid: str, current: any = Depends(get_current_user)):
        pi = await db.proforma_invoices.find_one({"$or": [{"id": pid}, {"proforma_no": pid}]}, {"_id": 0})
        if not pi:
            raise HTTPException(status_code=404, detail="Proforma not found")
        return ProformaInvoice(**pi)

    @router.put("/proforma/{pid}", response_model=ProformaInvoice)
    @router.patch("/proforma/{pid}", response_model=ProformaInvoice)
    async def update_proforma(pid: str, payload: ProformaInput, current: any = Depends(require_admin_or_manager)):
        pi = await db.proforma_invoices.find_one({"$or": [{"id": pid}, {"proforma_no": pid}]})
        if not pi:
            raise HTTPException(status_code=404, detail="Proforma not found")
        cust = await db.customers.find_one({"$or": [{"id": payload.customer_id}, {"customer_code": payload.customer_id}]})
        items, subtotal, discount, tax, grand = compute_totals(payload.items)
        now = now_utc()
        upd = {
            "date": payload.date,
            "customer_id": cust.get("id") if cust else payload.customer_id,
            "customer_code": cust.get("customer_code") if cust else pi.get("customer_code"),
            "customer_name": cust.get("name") if cust else pi.get("customer_name"),
            "customer_mobile": cust.get("mobile") if cust else pi.get("customer_mobile"),
            "customer_address": cust.get("address") if cust else pi.get("customer_address"),
            "items": items,
            "subtotal": subtotal,
            "total_discount": discount,
            "total_tax": tax,
            "grand_total": grand,
            "notes": payload.notes,
            "updated_at": now,
        }
        await db.proforma_invoices.update_one({"id": pi["id"]}, {"$set": upd})
        doc = await db.proforma_invoices.find_one({"id": pi["id"]}, {"_id": 0})
        await log_audit_entry(db, current, "proforma", "update", pi.get("proforma_no"), pi, doc)
        return ProformaInvoice(**doc)

    @router.delete("/proforma/{pid}")
    async def delete_proforma(pid: str, current: any = Depends(require_admin_or_manager)):
        res = await db.proforma_invoices.delete_one({"$or": [{"id": pid}, {"proforma_no": pid}]})
        if res.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Proforma not found")
        await log_audit_entry(db, current, "proforma", "delete", pid, None, {"deleted": True})
        return {"ok": True, "deleted": res.deleted_count}

    # ====== DELIVERY CHALLANS ======
    @router.get("/delivery-challans", response_model=List[DeliveryChallan])
    @router.get("/challans", response_model=List[DeliveryChallan])
    async def list_challans(q: Optional[str] = Query(None), current: any = Depends(get_current_user)):
        query = {}
        if q:
            regex = {"$regex": q.strip(), "$options": "i"}
            query["$or"] = [
                {"challan_no": regex},
                {"customer_name": regex},
                {"vehicle_no": regex},
                {"dispatch_through": regex},
                {"notes": regex}
            ]
        docs = await db.delivery_challans.find(query, {"_id": 0}).sort("created_at", -1).to_list(200)
        return [DeliveryChallan(**d) for d in docs]

    @router.get("/delivery-challans/next-no")
    @router.get("/challans/next-no")
    async def get_next_challan_no(date: Optional[str] = Query(None), current: any = Depends(get_current_user)):
        from server import _get_voucher_settings, _peek_next_voucher_no
        s = await _get_voucher_settings("delivery_challan")
        effective_date = date or s.get("date_start_from")
        next_no = await _peek_next_voucher_no("delivery_challan", effective_date)
        return {
            "next_no": next_no,
            "voucher_mode": s.get("voucher_mode", "auto"),
            "date_start_from": s.get("date_start_from"),
            "prefix": s.get("prefix", "TDSC-DC"),
            "start_seq": s.get("start_seq", 1),
        }

    @router.post("/delivery-challans", response_model=DeliveryChallan)
    @router.post("/challans", response_model=DeliveryChallan)
    async def create_challan(payload: DeliveryChallanInput, current: any = Depends(get_current_user)):
        cust = await db.customers.find_one({"$or": [{"id": payload.customer_id}, {"customer_code": payload.customer_id}]})
        if not cust:
            raise HTTPException(status_code=404, detail="Customer not found")

        from server import _next_voucher_no
        custom_no = getattr(payload, "challan_no", None)
        if custom_no and not "preview" in str(custom_no).lower() and str(custom_no).strip():
            dc_no = str(custom_no).strip()
            seq = 1
        else:
            dc_no = await _next_voucher_no("delivery_challan", payload.date)
            seq = 1
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

    @router.get("/delivery-challans/{cid}", response_model=DeliveryChallan)
    @router.get("/challans/{cid}", response_model=DeliveryChallan)
    async def get_challan(cid: str, current: any = Depends(get_current_user)):
        c = await db.delivery_challans.find_one({"$or": [{"id": cid}, {"challan_no": cid}]}, {"_id": 0})
        if not c:
            raise HTTPException(status_code=404, detail="Delivery Challan not found")
        return DeliveryChallan(**c)

    @router.put("/delivery-challans/{cid}", response_model=DeliveryChallan)
    @router.patch("/delivery-challans/{cid}", response_model=DeliveryChallan)
    @router.put("/challans/{cid}", response_model=DeliveryChallan)
    @router.patch("/challans/{cid}", response_model=DeliveryChallan)
    async def update_challan(cid: str, payload: DeliveryChallanInput, current: any = Depends(require_admin_or_manager)):
        c = await db.delivery_challans.find_one({"$or": [{"id": cid}, {"challan_no": cid}]})
        if not c:
            raise HTTPException(status_code=404, detail="Delivery Challan not found")
        cust = await db.customers.find_one({"$or": [{"id": payload.customer_id}, {"customer_code": payload.customer_id}]})
        items, _, _, _, _ = compute_totals(payload.items)
        now = now_utc()
        upd = {
            "date": payload.date,
            "customer_id": cust.get("id") if cust else payload.customer_id,
            "customer_name": cust.get("name") if cust else c.get("customer_name"),
            "invoice_id": payload.invoice_id or c.get("invoice_id"),
            "vehicle_no": payload.vehicle_no,
            "dispatch_through": payload.dispatch_through,
            "items": items,
            "notes": payload.notes,
            "updated_at": now,
        }
        await db.delivery_challans.update_one({"id": c["id"]}, {"$set": upd})
        doc = await db.delivery_challans.find_one({"id": c["id"]}, {"_id": 0})
        await log_audit_entry(db, current, "challans", "update", c.get("challan_no"), c, doc)
        return DeliveryChallan(**doc)

    @router.delete("/delivery-challans/{cid}")
    @router.delete("/challans/{cid}")
    async def delete_challan(cid: str, current: any = Depends(require_admin_or_manager)):
        res = await db.delivery_challans.delete_one({"$or": [{"id": cid}, {"challan_no": cid}]})
        if res.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Delivery Challan not found")
        await log_audit_entry(db, current, "challans", "delete", cid, None, {"deleted": True})
        return {"ok": True, "deleted": res.deleted_count}

    return router
