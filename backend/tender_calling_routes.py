import os
import uuid
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from pydantic import BaseModel, Field
from pathlib import Path

def now_utc() -> datetime:
    return datetime.now(timezone.utc)

def clean_doc(d: Any) -> Any:
    """Recursively strip MongoDB ObjectId and _id fields for clean JSON responses."""
    if isinstance(d, dict):
        d.pop("_id", None)
        for k, v in list(d.items()):
            if v is not None and type(v).__name__ == "ObjectId":
                d[k] = str(v)
            elif isinstance(v, (dict, list)):
                clean_doc(v)
    elif isinstance(d, list):
        for item in d:
            clean_doc(item)
    return d

RECORDINGS_DIR = Path(__file__).parent / "uploads" / "recordings"
RECORDINGS_DIR.mkdir(parents=True, exist_ok=True)

# Valid Interest Statements
VALID_INTEREST_STATEMENTS = [
    "Interested",
    "Low Interested",
    "Medium Interested",
    "Highly Interested",
    "Not Interested",
    "Lead Converted",
]

# Pydantic Schemas
class TenderCallCreate(BaseModel):
    agency_name: str = Field(..., min_length=1)
    mobile: Optional[str] = None
    talking_about_works: Optional[str] = None
    remarks: Optional[str] = None
    interest_status: str = Field(default="Interested")
    insert_after_id: Optional[str] = None
    call_date: Optional[str] = None
    followup_date: Optional[str] = None
    followup_remarks: Optional[str] = None

class TenderCallUpdate(BaseModel):
    agency_name: Optional[str] = None
    mobile: Optional[str] = None
    talking_about_works: Optional[str] = None
    remarks: Optional[str] = None
    interest_status: Optional[str] = None
    call_date: Optional[str] = None
    followup_date: Optional[str] = None
    followup_remarks: Optional[str] = None
    followup_completed: Optional[bool] = None

class AssignWorkInput(BaseModel):
    assignee_id: str = Field(..., min_length=1)
    assignee_name: str = Field(..., min_length=1)
    deadline: Optional[str] = None
    instructions: Optional[str] = None
    estimated_amount: Optional[float] = 0.0

class CreateBillInput(BaseModel):
    amount: float = Field(..., gt=0)
    description: Optional[str] = None
    invoice_date: Optional[str] = None
    due_date: Optional[str] = None
    tax_rate: Optional[float] = 18.0

def make_tender_calling_router(db, get_current_user, require_admin, require_admin_or_manager, log_audit):
    router = APIRouter(prefix="/tender-mgmt/calls", tags=["Tender Calling & Follow-up"])

    # Seed initial demo calling lines if collection empty
    async def seed_demo_calls():
        try:
            count = await db.tender_calls.count_documents({})
            if count == 0:
                today_str = now_utc().strftime("%Y-%m-%d")
                tomorrow_str = (now_utc() + timedelta(days=1)).strftime("%Y-%m-%d")
                yesterday_str = (now_utc() - timedelta(days=1)).strftime("%Y-%m-%d")

                demo_items = [
                    {
                        "id": "call_demo_01",
                        "sl_no": 1,
                        "agency_name": "M/s Maa Sharda Construction",
                        "mobile": "9835012345",
                        "talking_about_works": "RWD Bihar Road Construction (Pkg BR-02R-145, 12.4 Km)",
                        "remarks": "Discussed BOQ rates and DSC renewal. Asked for detailed item rate estimate.",
                        "recording_file_url": None,
                        "recording_file_name": None,
                        "interest_status": "Highly Interested",
                        "caller_user_id": "usr_emp_alpha",
                        "caller_user_name": "Anita Employee",
                        "caller_role": "employee",
                        "call_date": today_str,
                        "is_followup": True,
                        "followup_date": tomorrow_str,
                        "followup_remarks": "Call back tomorrow at 11 AM regarding bank guarantee format.",
                        "followup_completed": False,
                        "followup_history": [],
                        "is_lead_converted": False,
                        "created_at": now_utc().isoformat(),
                        "updated_at": now_utc().isoformat(),
                    },
                    {
                        "id": "call_demo_02",
                        "sl_no": 2,
                        "agency_name": "Patliputra Buildtech Pvt Ltd",
                        "mobile": "9431098765",
                        "talking_about_works": "CPWD Patna AIIMS Boundary & Drainage Works (NIT-45/2026)",
                        "remarks": "Informed about tender opening on 28th Sept. Requested tender filing assistance.",
                        "recording_file_url": None,
                        "recording_file_name": None,
                        "interest_status": "Medium Interested",
                        "caller_user_id": "usr_emp_alpha",
                        "caller_user_name": "Anita Employee",
                        "caller_role": "employee",
                        "call_date": today_str,
                        "is_followup": True,
                        "followup_date": tomorrow_str,
                        "followup_remarks": "Follow up for class registration certificate & GST compliance.",
                        "followup_completed": False,
                        "followup_history": [],
                        "is_lead_converted": False,
                        "created_at": now_utc().isoformat(),
                        "updated_at": now_utc().isoformat(),
                    },
                    {
                        "id": "call_demo_03",
                        "sl_no": 3,
                        "agency_name": "Triveni Infratech & Engineers",
                        "mobile": "9934256789",
                        "talking_about_works": "PHED Water Supply Pipeline Scheme (Muzaffarpur Zone)",
                        "remarks": "Client agreed for full bid preparation and documentation service. Lead confirmed!",
                        "recording_file_url": None,
                        "recording_file_name": None,
                        "interest_status": "Lead Converted",
                        "caller_user_id": "usr_emp_beta",
                        "caller_user_name": "Employee Beta",
                        "caller_role": "employee",
                        "call_date": yesterday_str,
                        "is_followup": False,
                        "followup_date": None,
                        "followup_remarks": "Contract finalized. Proceed to billing and work assignment.",
                        "followup_completed": True,
                        "followup_history": [],
                        "is_lead_converted": True,
                        "converted_date": yesterday_str + "T15:30:00Z",
                        "converted_by_user_id": "usr_emp_beta",
                        "converted_by_user_name": "Employee Beta",
                        "converted_amount": 25000.0,
                        "assigned_employee_id": None,
                        "assigned_employee_name": None,
                        "task_id": None,
                        "task_no": None,
                        "invoice_id": None,
                        "invoice_no": None,
                        "created_at": now_utc().isoformat(),
                        "updated_at": now_utc().isoformat(),
                    },
                    {
                        "id": "call_demo_04",
                        "sl_no": 4,
                        "agency_name": "Vikramaditya Construction Group",
                        "mobile": "9123456780",
                        "talking_about_works": "BCD High School Building Construction (Bhojpur)",
                        "remarks": "Not bidding this month due to ongoing site commitments. Reconnect next quarter.",
                        "recording_file_url": None,
                        "recording_file_name": None,
                        "interest_status": "Low Interested",
                        "caller_user_id": "usr_emp_beta",
                        "caller_user_name": "Employee Beta",
                        "caller_role": "employee",
                        "call_date": today_str,
                        "is_followup": True,
                        "followup_date": tomorrow_str,
                        "followup_remarks": "Check again on 1st of next month.",
                        "followup_completed": False,
                        "followup_history": [],
                        "is_lead_converted": False,
                        "created_at": now_utc().isoformat(),
                        "updated_at": now_utc().isoformat(),
                    }
                ]
                await db.tender_calls.insert_many(demo_items)
        except Exception:
            pass

    # Helper: reindex Sl. No.
    async def _reindex_calls():
        docs = await db.tender_calls.find({}).sort("sl_no", 1).to_list(1000)
        for idx, doc in enumerate(docs, start=1):
            if doc.get("sl_no") != idx:
                await db.tender_calls.update_one({"id": doc["id"]}, {"$set": {"sl_no": idx}})

    # 1. GET /tender-mgmt/calls - List Calling Lines
    @router.get("")
    async def list_tender_calls(
        section: str = Query("calling_day", description="calling_day, followup, converted, all"),
        call_date: Optional[str] = Query(None),
        employee_id: Optional[str] = Query(None),
        status: Optional[str] = Query(None),
        search: Optional[str] = Query(None),
        current: any = Depends(get_current_user),
    ):
        await seed_demo_calls()

        query: Dict[str, Any] = {}
        user_role = getattr(current, "role", "employee")
        user_desig = (getattr(current, "designation", "") or "").lower()
        is_admin_or_mgr = user_role in ["admin", "manager"] or "manager" in user_desig

        # Non-manager employee only sees their own calls
        if not is_admin_or_mgr:
            query["$or"] = [
                {"caller_user_id": current.user_id},
                {"assigned_employee_id": current.user_id}
            ]
        elif employee_id and employee_id != "all":
            query["caller_user_id"] = employee_id

        # Section logic:
        # (a) calling_day: All calling lines logged today or overall active lines
        if section == "calling_day":
            if call_date:
                query["call_date"] = call_date
        # (b) followup: Low/Med/High interested calls requiring follow-up
        elif section == "followup":
            query["$and"] = query.get("$and", [])
            query["$and"].append({
                "$or": [
                    {"is_followup": True},
                    {"interest_status": {"$in": ["Low Interested", "Medium Interested", "Highly Interested", "Interested"]}}
                ]
            })
            query["interest_status"] = {"$nin": ["Not Interested", "Lead Converted"]}
            if call_date:
                query["followup_date"] = call_date
        # (c) converted: Leads converted
        elif section == "converted":
            query["$or"] = [
                {"interest_status": "Lead Converted"},
                {"is_lead_converted": True}
            ]

        if status and status != "all":
            query["interest_status"] = status

        if search:
            q_rx = {"$regex": re.escape(search.strip()), "$options": "i"}
            query["$or"] = [
                {"agency_name": q_rx},
                {"mobile": q_rx},
                {"talking_about_works": q_rx},
                {"remarks": q_rx}
            ]

        # Sorting: calling_day by sl_no asc, followup by followup_date asc, converted by converted_date desc
        sort_field = "sl_no"
        sort_dir = 1
        if section == "converted":
            sort_field = "converted_date"
            sort_dir = -1
        elif section == "followup":
            sort_field = "followup_date"
            sort_dir = 1

        calls = await db.tender_calls.find(query, {"_id": 0}).sort(sort_field, sort_dir).to_list(500)
        return clean_doc(calls)

    # 2. POST /tender-mgmt/calls - Create calling line (with '+' insert_after_id support)
    @router.post("")
    async def create_tender_call(
        payload: TenderCallCreate,
        current: any = Depends(get_current_user),
    ):
        await seed_demo_calls()

        call_id = f"call_{uuid.uuid4().hex[:10]}"
        now = now_utc()
        today_str = now.strftime("%Y-%m-%d")
        tomorrow_str = (now + timedelta(days=1)).strftime("%Y-%m-%d")

        # Determine target Sl. No.
        new_sl = 1
        if payload.insert_after_id:
            ref_call = await db.tender_calls.find_one({"id": payload.insert_after_id}, {"_id": 0})
            if ref_call:
                new_sl = ref_call.get("sl_no", 1) + 1
                # Shift all subsequent rows up by 1
                await db.tender_calls.update_many(
                    {"sl_no": {"$gte": new_sl}},
                    {"$inc": {"sl_no": 1}}
                )
        else:
            max_item = await db.tender_calls.find_one({}, {"_id": 0}, sort=[("sl_no", -1)])
            if max_item:
                new_sl = max_item.get("sl_no", 0) + 1

        interest = payload.interest_status.strip() if payload.interest_status else "Interested"
        is_followup = interest in ["Low Interested", "Medium Interested", "Highly Interested", "Interested"]
        is_converted = interest == "Lead Converted"

        followup_d = payload.followup_date
        if is_followup and not followup_d:
            followup_d = tomorrow_str

        doc = {
            "id": call_id,
            "sl_no": new_sl,
            "agency_name": payload.agency_name.strip(),
            "mobile": payload.mobile.strip() if payload.mobile else None,
            "talking_about_works": payload.talking_about_works.strip() if payload.talking_about_works else None,
            "remarks": payload.remarks.strip() if payload.remarks else None,
            "recording_file_url": None,
            "recording_file_name": None,
            "interest_status": interest,
            "caller_user_id": current.user_id,
            "caller_user_name": current.name,
            "caller_role": getattr(current, "role", "employee"),
            "call_date": payload.call_date or today_str,
            "is_followup": is_followup,
            "followup_date": followup_d,
            "followup_remarks": payload.followup_remarks,
            "followup_completed": False,
            "followup_history": [],
            "is_lead_converted": is_converted,
            "converted_date": now.isoformat() if is_converted else None,
            "converted_by_user_id": current.user_id if is_converted else None,
            "converted_by_user_name": current.name if is_converted else None,
            "converted_amount": 0.0,
            "assigned_employee_id": None,
            "assigned_employee_name": None,
            "task_id": None,
            "task_no": None,
            "invoice_id": None,
            "invoice_no": None,
            "created_at": now.isoformat(),
            "updated_at": now.isoformat(),
        }

        await db.tender_calls.insert_one(doc)
        await _reindex_calls()
        await log_audit(db, current, "tender_calls", "create", call_id, None, doc)
        return clean_doc(doc)

    # 3. PATCH /tender-mgmt/calls/{cid} - Update calling line
    @router.patch("/{cid}")
    async def update_tender_call(
        cid: str,
        payload: TenderCallUpdate,
        current: any = Depends(get_current_user),
    ):
        existing = await db.tender_calls.find_one({"id": cid}, {"_id": 0})
        if not existing:
            raise HTTPException(status_code=404, detail="Calling line not found")

        updates: Dict[str, Any] = {"updated_at": now_utc().isoformat()}

        if payload.agency_name is not None:
            updates["agency_name"] = payload.agency_name.strip()
        if payload.mobile is not None:
            updates["mobile"] = payload.mobile.strip() if payload.mobile else None
        if payload.talking_about_works is not None:
            updates["talking_about_works"] = payload.talking_about_works.strip() if payload.talking_about_works else None
        if payload.remarks is not None:
            updates["remarks"] = payload.remarks.strip() if payload.remarks else None
        if payload.call_date is not None:
            updates["call_date"] = payload.call_date

        now = now_utc()
        tomorrow_str = (now + timedelta(days=1)).strftime("%Y-%m-%d")

        # Interest status logic
        if payload.interest_status is not None:
            new_st = payload.interest_status.strip()
            updates["interest_status"] = new_st

            # Logic: If Low, Medium, Highly Interested -> Automatic Follow up Next day & Manager visibility
            if new_st in ["Low Interested", "Medium Interested", "Highly Interested", "Interested"]:
                updates["is_followup"] = True
                if not existing.get("followup_date") and not payload.followup_date:
                    updates["followup_date"] = tomorrow_str
            elif new_st == "Not Interested":
                updates["is_followup"] = False

            # Logic: If Lead Converted -> Automatic transfer to Lead Converted
            if new_st == "Lead Converted":
                updates["is_lead_converted"] = True
                if not existing.get("converted_date"):
                    updates["converted_date"] = now.isoformat()
                    updates["converted_by_user_id"] = current.user_id
                    updates["converted_by_user_name"] = current.name

        if payload.followup_date is not None:
            updates["followup_date"] = payload.followup_date
            updates["is_followup"] = True

        if payload.followup_remarks is not None:
            updates["followup_remarks"] = payload.followup_remarks

        if payload.followup_completed is not None:
            updates["followup_completed"] = payload.followup_completed
            if payload.followup_completed:
                updates["followup_completed_at"] = now.isoformat()
                updates["followup_by_user_id"] = current.user_id
                updates["followup_by_user_name"] = current.name
                # Record in followup_history
                hist_item = {
                    "date": now.strftime("%Y-%m-%d %H:%M"),
                    "remarks": payload.followup_remarks or updates.get("followup_remarks") or "Follow-up completed",
                    "status": updates.get("interest_status", existing.get("interest_status")),
                    "user_id": current.user_id,
                    "user_name": current.name,
                }
                updates["$push"] = {"followup_history": hist_item}

        # Handle $push vs $set for MongoDB
        push_op = updates.pop("$push", None)
        mongo_update: Dict[str, Any] = {"$set": updates}
        if push_op:
            mongo_update["$push"] = push_op

        await db.tender_calls.update_one({"id": cid}, mongo_update)
        updated = await db.tender_calls.find_one({"id": cid}, {"_id": 0})
        await log_audit(db, current, "tender_calls", "update", cid, existing, updated)
        return clean_doc(updated)

    # 4. DELETE /tender-mgmt/calls/{cid}
    @router.delete("/{cid}")
    async def delete_tender_call(
        cid: str,
        current: any = Depends(get_current_user),
    ):
        existing = await db.tender_calls.find_one({"id": cid}, {"_id": 0})
        if not existing:
            raise HTTPException(status_code=404, detail="Calling line not found")

        # Delete recording file if present
        if existing.get("recording_file_url"):
            try:
                fn = existing.get("recording_file_name")
                if fn:
                    fp = RECORDINGS_DIR / fn
                    if fp.exists():
                        fp.unlink()
            except Exception:
                pass

        await db.tender_calls.delete_one({"id": cid})
        await _reindex_calls()
        await log_audit(db, current, "tender_calls", "delete", cid, existing, None)
        return {"ok": True, "message": "Calling line deleted successfully"}

    # 5. POST /tender-mgmt/calls/{cid}/recording - Upload call recording
    @router.post("/{cid}/recording")
    async def upload_call_recording(
        cid: str,
        file: UploadFile = File(...),
        current: any = Depends(get_current_user),
    ):
        existing = await db.tender_calls.find_one({"id": cid}, {"_id": 0})
        if not existing:
            raise HTTPException(status_code=404, detail="Calling line not found")

        filename = f"{cid}_{uuid.uuid4().hex[:6]}_{file.filename}"
        dest_path = RECORDINGS_DIR / filename
        content = await file.read()
        with open(dest_path, "wb") as f:
            f.write(content)

        file_url = f"/api/tender-mgmt/calls/{cid}/recording-file"
        updates = {
            "recording_file_url": file_url,
            "recording_file_name": file.filename,
            "recording_file_size": len(content),
            "recording_saved_name": filename,
            "updated_at": now_utc().isoformat(),
        }
        await db.tender_calls.update_one({"id": cid}, {"$set": updates})
        updated = await db.tender_calls.find_one({"id": cid}, {"_id": 0})
        return clean_doc(updated)

    # 6. GET /tender-mgmt/calls/{cid}/recording-file - Download / Play recording
    @router.get("/{cid}/recording-file")
    async def get_call_recording(cid: str):
        from fastapi.responses import FileResponse
        existing = await db.tender_calls.find_one({"id": cid}, {"_id": 0})
        if not existing or not existing.get("recording_saved_name"):
            raise HTTPException(status_code=404, detail="Recording not found")

        saved = existing.get("recording_saved_name")
        fp = RECORDINGS_DIR / saved
        if not fp.exists():
            raise HTTPException(status_code=404, detail="File missing on disk")
        return FileResponse(path=fp, filename=existing.get("recording_file_name", "recording.mp3"))

    # 7. DELETE /tender-mgmt/calls/{cid}/recording - Remove recording
    @router.delete("/{cid}/recording")
    async def remove_call_recording(
        cid: str,
        current: any = Depends(get_current_user),
    ):
        existing = await db.tender_calls.find_one({"id": cid}, {"_id": 0})
        if not existing:
            raise HTTPException(status_code=404, detail="Calling line not found")

        if existing.get("recording_saved_name"):
            fp = RECORDINGS_DIR / existing.get("recording_saved_name")
            if fp.exists():
                fp.unlink()

        await db.tender_calls.update_one(
            {"id": cid},
            {"$set": {
                "recording_file_url": None,
                "recording_file_name": None,
                "recording_saved_name": None,
                "recording_file_size": 0,
                "updated_at": now_utc().isoformat()
            }}
        )
        return {"ok": True, "message": "Recording removed"}

    # 8. GET /tender-mgmt/calls/analytics - Admin & Manager Follow-up Counter & Employee breakdown
    @router.get("/metrics/analytics")
    async def get_calls_analytics(current: any = Depends(get_current_user)):
        await seed_demo_calls()

        today_str = now_utc().strftime("%Y-%m-%d")

        # Counts
        total_calls_today = await db.tender_calls.count_documents({"call_date": today_str})
        total_calls_all = await db.tender_calls.count_documents({})
        total_followups_due_today = await db.tender_calls.count_documents({
            "is_followup": True,
            "followup_date": today_str,
            "interest_status": {"$nin": ["Not Interested", "Lead Converted"]}
        })
        total_followups_completed_today = await db.tender_calls.count_documents({
            "followup_completed": True,
            "followup_completed_at": {"$regex": f"^{today_str}"}
        })
        total_followups_pending = await db.tender_calls.count_documents({
            "is_followup": True,
            "followup_completed": False,
            "interest_status": {"$nin": ["Not Interested", "Lead Converted"]}
        })
        total_leads_converted = await db.tender_calls.count_documents({
            "$or": [
                {"interest_status": "Lead Converted"},
                {"is_lead_converted": True}
            ]
        })

        # Breakdown by employee
        all_calls = await db.tender_calls.find({}, {"_id": 0}).to_list(1000)
        emp_stats: Dict[str, Dict[str, Any]] = {}

        for c in all_calls:
            emp_id = c.get("caller_user_id") or "unknown"
            emp_name = c.get("caller_user_name") or "Staff"
            if emp_id not in emp_stats:
                emp_stats[emp_id] = {
                    "user_id": emp_id,
                    "name": emp_name,
                    "total_calls": 0,
                    "followups_done": 0,
                    "followups_pending": 0,
                    "leads_converted": 0,
                }
            emp_stats[emp_id]["total_calls"] += 1
            if c.get("followup_completed"):
                emp_stats[emp_id]["followups_done"] += 1
            elif c.get("is_followup") and c.get("interest_status") not in ["Not Interested", "Lead Converted"]:
                emp_stats[emp_id]["followups_pending"] += 1
            if c.get("is_lead_converted") or c.get("interest_status") == "Lead Converted":
                emp_stats[emp_id]["leads_converted"] += 1

        leaderboard = sorted(emp_stats.values(), key=lambda x: (x["leads_converted"], x["followups_done"], x["total_calls"]), reverse=True)

        return {
            "total_calls_today": total_calls_today,
            "total_calls_all": total_calls_all,
            "total_followups_due_today": total_followups_due_today,
            "total_followups_completed_today": total_followups_completed_today,
            "total_followups_pending": total_followups_pending,
            "total_leads_converted": total_leads_converted,
            "employee_breakdown": leaderboard,
        }

    # 9. POST /tender-mgmt/calls/{cid}/assign-work - Assign work to employee & automatic task generated in Task Management System
    @router.post("/{cid}/assign-work")
    async def assign_call_work(
        cid: str,
        payload: AssignWorkInput,
        current: any = Depends(get_current_user),
    ):
        existing = await db.tender_calls.find_one({"id": cid}, {"_id": 0})
        if not existing:
            raise HTTPException(status_code=404, detail="Lead calling record not found")

        # Create Task in Task Management System
        counter = await db.counters.find_one_and_update(
            {"_id": "task_no"},
            {"$inc": {"seq": 1}},
            upsert=True,
            return_document=True,
        )
        seq = (counter or {}).get("seq") or 1
        task_no = f"TSK-{seq:04d}"
        task_id = f"tsk_{uuid.uuid4().hex[:10]}"

        work_title = existing.get("talking_about_works") or "Tender Documentation & Bid Preparation"
        task_title = f"Tender Work: {work_title} - {existing.get('agency_name')}"
        task_desc = (
            f"🎯 Converted Tender Lead Task\n"
            f"Agency/Contractor: {existing.get('agency_name')}\n"
            f"Mobile: {existing.get('mobile')}\n"
            f"Work Description: {work_title}\n"
            f"Calling Notes: {existing.get('remarks')}\n"
            f"Instructions: {payload.instructions or 'Execute tender preparation, BOQ check, and bid filing as agreed.'}"
        )

        initial_history = [{
            "stage_id": "stg_in_progress",
            "stage_name": "In Progress",
            "moved_at": now_utc().isoformat(),
            "moved_by": current.user_id,
            "moved_by_name": current.name,
            "assignee_id": payload.assignee_id,
            "assignee_name": payload.assignee_name,
            "note": "Task automatically generated from Tender Calling Lead Conversion",
        }]

        task_doc = {
            "id": task_id,
            "task_no": task_no,
            "title": task_title,
            "description": task_desc,
            "stages": [
                {"id": "stg_todo", "name": "To Do", "order": 1},
                {"id": "stg_in_progress", "name": "In Progress", "order": 2},
                {"id": "stg_review", "name": "Under Review", "order": 3},
                {"id": "stg_completed", "name": "Completed", "order": 4}
            ],
            "current_stage_id": "stg_in_progress",
            "current_stage_name": "In Progress",
            "stage_history": initial_history,
            "total_amount": float(payload.estimated_amount or 0),
            "paid_amount": 0.0,
            "dues_amount": float(payload.estimated_amount or 0),
            "deadline": payload.deadline or (now_utc() + timedelta(days=7)).strftime("%Y-%m-%d"),
            "assignee_id": payload.assignee_id,
            "assignee_name": payload.assignee_name,
            "customer_name": existing.get("agency_name"),
            "customer_mobile": existing.get("mobile"),
            "priority": "high",
            "created_by": current.user_id,
            "created_by_name": current.name,
            "created_at": now_utc().isoformat(),
            "updated_at": now_utc().isoformat(),
        }

        await db.tasks.insert_one(task_doc)

        # Update Calling Line with task details
        updates = {
            "assigned_employee_id": payload.assignee_id,
            "assigned_employee_name": payload.assignee_name,
            "task_id": task_id,
            "task_no": task_no,
            "converted_amount": float(payload.estimated_amount or existing.get("converted_amount", 0)),
            "updated_at": now_utc().isoformat(),
        }
        await db.tender_calls.update_one({"id": cid}, {"$set": updates})

        await log_audit(db, current, "tasks", "create_from_call", task_id, None, task_doc)
        return {
            "ok": True,
            "task_id": task_id,
            "task_no": task_no,
            "message": f"Task {task_no} automatically generated and assigned to {payload.assignee_name}"
        }

    # 10. POST /tender-mgmt/calls/{cid}/create-bill - Create a Bill against to work (Account & Billing integration)
    @router.post("/{cid}/create-bill")
    async def create_call_bill(
        cid: str,
        payload: CreateBillInput,
        current: any = Depends(get_current_user),
    ):
        existing = await db.tender_calls.find_one({"id": cid}, {"_id": 0})
        if not existing:
            raise HTTPException(status_code=404, detail="Lead calling record not found")

        # Auto invoice_no
        counter = await db.counters.find_one_and_update(
            {"_id": "invoice_no"},
            {"$inc": {"seq": 1}},
            upsert=True,
            return_document=True,
        )
        seq = (counter or {}).get("seq") or 1
        inv_no = f"INV-{seq:04d}"
        inv_id = f"inv_{uuid.uuid4().hex[:10]}"

        now = now_utc()
        inv_date = payload.invoice_date or now.strftime("%Y-%m-%d")
        due_date = payload.due_date or (now + timedelta(days=15)).strftime("%Y-%m-%d")
        
        base_amt = float(payload.amount)
        tax_rate = float(payload.tax_rate or 18.0)
        tax_amt = round(base_amt * (tax_rate / 100.0), 2)
        total_amt = round(base_amt + tax_amt, 2)

        work_desc = payload.description or existing.get("talking_about_works") or "Tender Preparation & Professional Consultation"

        invoice_doc = {
            "id": inv_id,
            "invoice_no": inv_no,
            "customer_name": existing.get("agency_name"),
            "customer_mobile": existing.get("mobile"),
            "invoice_type": "sale",
            "invoice_date": inv_date,
            "due_date": due_date,
            "items": [
                {
                    "item_id": "itm_tender_srv",
                    "item_name": work_desc,
                    "description": f"Tender work for agency {existing.get('agency_name')}",
                    "hsn_sac": "998311",
                    "quantity": 1,
                    "unit": "job",
                    "rate": base_amt,
                    "amount": base_amt,
                    "tax_rate": tax_rate,
                    "tax_amount": tax_amt,
                }
            ],
            "subtotal": base_amt,
            "tax_rate": tax_rate,
            "tax_amount": tax_amt,
            "total_amount": total_amt,
            "paid_amount": 0.0,
            "balance_amount": total_amt,
            "status": "unpaid",
            "notes": f"Generated against converted lead (Call ID: {cid})",
            "created_by": current.user_id,
            "created_by_name": current.name,
            "created_at": now.isoformat(),
            "updated_at": now.isoformat(),
        }

        await db.invoices.insert_one(invoice_doc)

        # Update Calling Line with invoice details
        updates = {
            "invoice_id": inv_id,
            "invoice_no": inv_no,
            "converted_amount": total_amt,
            "updated_at": now.isoformat(),
        }
        await db.tender_calls.update_one({"id": cid}, {"$set": updates})

        await log_audit(db, current, "invoices", "create_from_call", inv_id, None, invoice_doc)
        return {
            "ok": True,
            "invoice_id": inv_id,
            "invoice_no": inv_no,
            "total_amount": total_amt,
            "message": f"Bill {inv_no} created successfully against {existing.get('agency_name')}"
        }

    return router
