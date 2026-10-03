import calendar
import uuid
from datetime import datetime, timezone
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

def now_utc() -> datetime:
    return datetime.now(timezone.utc)

def number_to_words_inr(amount: float) -> str:
    """Convert amount to Indian Rupee words."""
    try:
        n = int(round(amount))
        if n == 0:
            return "Zero Rupees Only"
        
        ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
                "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
                "Seventeen", "Eighteen", "Nineteen"]
        tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"]

        def _two_digits(num: int) -> str:
            if num < 20:
                return ones[num]
            t = tens[num // 10]
            o = ones[num % 10]
            return f"{t} {o}".strip()

        def _three_digits(num: int) -> str:
            h = num // 100
            rem = num % 100
            res = ""
            if h > 0:
                res += f"{ones[h]} Hundred"
            if rem > 0:
                if res:
                    res += " and "
                res += _two_digits(rem)
            return res

        parts = []
        crores = n // 10000000
        n %= 10000000
        if crores > 0:
            parts.append(f"{_two_digits(crores)} Crore")

        lakhs = n // 100000
        n %= 100000
        if lakhs > 0:
            parts.append(f"{_two_digits(lakhs)} Lakh")

        thousands = n // 1000
        n %= 1000
        if thousands > 0:
            parts.append(f"{_two_digits(thousands)} Thousand")

        if n > 0:
            parts.append(_three_digits(n))

        return " ".join(parts) + " Rupees Only"
    except Exception:
        return f"{amount} Rupees Only"


# ============ Pydantic Models ============

class SalaryStructureUpdate(BaseModel):
    pay: Optional[float] = None
    da: Optional[float] = None
    hra: Optional[float] = None
    ma: Optional[float] = None
    ta: Optional[float] = None
    other1: Optional[float] = None
    other2: Optional[float] = None
    ded_epfo: Optional[float] = None
    ded_esic: Optional[float] = None
    ded_advance: Optional[float] = None
    ded_advance_installments: Optional[int] = None
    ded_other: Optional[float] = None


class PayrollGenerateInput(BaseModel):
    month: Optional[str] = None  # Format: "YYYY-MM", defaults to current month
    employee_id: Optional[str] = None  # If None, generate for all employees
    auto_sync_attendance: bool = True  # Pull punch days & approved leaves


class SalarySlipUpdate(BaseModel):
    status: Optional[str] = None  # "pending", "paid", "on_hold"
    payment_mode: Optional[str] = None  # "bank_transfer", "upi", "cash", "cheque"
    payment_ref: Optional[str] = None  # UTR / Transaction ID / Cheque No
    payment_date: Optional[str] = None  # YYYY-MM-DD
    remarks: Optional[str] = None
    payable_days: Optional[float] = None
    bonus: Optional[float] = None
    ded_other: Optional[float] = None


class SalarySlipResponse(BaseModel):
    id: str
    payroll_month: str
    employee_id: str
    employee_name: str
    employee_code: Optional[str] = None
    designation: Optional[str] = None
    posting_branch: Optional[str] = None
    bank_name: Optional[str] = None
    bank_account_no: Optional[str] = None
    bank_ifsc: Optional[str] = None
    pan: Optional[str] = None
    epfo_no: Optional[str] = None
    esic_no: Optional[str] = None
    
    total_days: int
    present_days: float
    paid_leave_days: float
    unpaid_days: float
    payable_days: float
    
    base_pay: float = 0.0
    base_da: float = 0.0
    base_hra: float = 0.0
    base_ma: float = 0.0
    base_ta: float = 0.0
    base_other: float = 0.0
    base_gross: float = 0.0
    
    earned_pay: float = 0.0
    earned_da: float = 0.0
    earned_hra: float = 0.0
    earned_ma: float = 0.0
    earned_ta: float = 0.0
    earned_other: float = 0.0
    bonus: float = 0.0
    gross_amount: float = 0.0
    
    ded_epfo: float = 0.0
    ded_esic: float = 0.0
    ded_advance: float = 0.0
    ded_other: float = 0.0
    total_deductions: float = 0.0
    
    net_payable: float = 0.0
    status: str = "pending"
    payment_mode: Optional[str] = None
    payment_ref: Optional[str] = None
    payment_date: Optional[str] = None
    remarks: Optional[str] = None
    created_at: datetime = Field(default_factory=now_utc)
    updated_at: datetime = Field(default_factory=now_utc)


# ============ Router Factory ============

def make_payroll_router(db, get_current_user, require_admin, require_admin_or_manager, log_audit):
    router = APIRouter(prefix="/payroll", tags=["Salary Box & Payroll Management"])

    def _get_month_days(month_str: str) -> int:
        try:
            y, m = month_str.split("-")
            return calendar.monthrange(int(y), int(m))[1]
        except Exception:
            now = datetime.now()
            return calendar.monthrange(now.year, now.month)[1]

    def _current_month_str() -> str:
        return datetime.now().strftime("%Y-%m")

    # 1. Summary Endpoint
    @router.get("/summary")
    async def get_payroll_summary(
        month: Optional[str] = Query(None),
        current: any = Depends(get_current_user)
    ):
        target_month = month or _current_month_str()
        total_employees = await db.employees.count_documents({})
        slips = await db.salary_slips.find({"payroll_month": target_month}, {"_id": 0}).to_list(1000)
        
        slips_count = len(slips)
        total_gross = sum(s.get("gross_amount", 0.0) for s in slips)
        total_deductions = sum(s.get("total_deductions", 0.0) for s in slips)
        total_net = sum(s.get("net_payable", 0.0) for s in slips)
        
        paid_slips = [s for s in slips if s.get("status") == "paid"]
        pending_slips = [s for s in slips if s.get("status") != "paid"]
        
        total_paid = sum(s.get("net_payable", 0.0) for s in paid_slips)
        total_pending = sum(s.get("net_payable", 0.0) for s in pending_slips)

        return {
            "month": target_month,
            "total_employees": total_employees,
            "slips_generated": slips_count,
            "total_gross": round(total_gross, 2),
            "total_deductions": round(total_deductions, 2),
            "total_net_payable": round(total_net, 2),
            "total_paid": round(total_paid, 2),
            "total_pending": round(total_pending, 2),
            "paid_count": len(paid_slips),
            "pending_count": len(pending_slips),
        }

    # 2. List Slips
    @router.get("/slips", response_model=List[SalarySlipResponse])
    async def list_salary_slips(
        month: Optional[str] = Query(None),
        status: Optional[str] = Query(None),
        search: Optional[str] = Query(None),
        current: any = Depends(get_current_user)
    ):
        target_month = month or _current_month_str()
        query: Dict[str, Any] = {"payroll_month": target_month}
        
        # If regular employee, only show their own slip
        if current.role not in ("admin", "manager"):
            emp = await db.employees.find_one({"email": current.email}, {"_id": 0})
            if emp:
                query["employee_id"] = emp.get("id")
            else:
                query["employee_name"] = current.name

        if status:
            query["status"] = status

        slips = await db.salary_slips.find(query, {"_id": 0}).sort("employee_name", 1).to_list(1000)
        
        if search:
            q = search.lower()
            slips = [
                s for s in slips
                if q in (s.get("employee_name") or "").lower()
                or q in (s.get("employee_code") or "").lower()
                or q in (s.get("designation") or "").lower()
                or q in (s.get("posting_branch") or "").lower()
            ]

        return [SalarySlipResponse(**s) for s in slips]

    # 3. Generate Payroll for a Month
    @router.post("/generate")
    async def generate_payroll(
        payload: PayrollGenerateInput,
        current: any = Depends(require_admin_or_manager)
    ):
        target_month = payload.month or _current_month_str()
        total_days = _get_month_days(target_month)

        emp_query = {}
        if payload.employee_id:
            emp_query["id"] = payload.employee_id

        employees = await db.employees.find(emp_query, {"_id": 0}).to_list(1000)
        if not employees:
            raise HTTPException(status_code=404, detail="No employees found to generate payroll")

        generated_records = []
        now = now_utc()

        # Cache paid leave category codes
        paid_leave_categories = await db.leave_categories.find({"is_paid": True}, {"code": 1, "_id": 0}).to_list(100)
        paid_codes = {c.get("code") for c in paid_leave_categories if c.get("code")}

        for emp in employees:
            emp_id = emp.get("id")
            emp_code = emp.get("employee_code") or ""
            emp_user_id = emp.get("user_id") or ""
            emp_email = emp.get("email") or ""

            # Attendance calculation
            present_days = 0.0
            paid_leave_days = 0.0

            if payload.auto_sync_attendance:
                # 1. Count unique punch-in dates in target month
                punch_filter: Dict[str, Any] = {
                    "date": {"$regex": f"^{target_month}"}
                }
                id_conditions = []
                if emp_user_id: id_conditions.append({"user_id": emp_user_id})
                if emp_code: id_conditions.append({"employee_code": emp_code})
                if emp_email: id_conditions.append({"email": emp_email})
                
                if id_conditions:
                    punch_filter["$or"] = id_conditions
                    punches = await db.punches.find(punch_filter, {"date": 1, "_id": 0}).to_list(1000)
                    punch_dates = {p["date"] for p in punches if p.get("date")}
                    punch_count = len(punch_dates)
                else:
                    punch_count = 0

                # 2. Count approved paid leaves in target month
                leave_filter: Dict[str, Any] = {
                    "status": "approved",
                    "$or": [
                        {"from_date": {"$regex": f"^{target_month}"}},
                        {"to_date": {"$regex": f"^{target_month}"}}
                    ]
                }
                leave_id_cond = []
                if emp_user_id: leave_id_cond.append({"user_id": emp_user_id})
                if emp_code: leave_id_cond.append({"employee_code": emp_code})
                if leave_id_cond:
                    leave_filter["$and"] = [{"$or": leave_id_cond}]
                    approved_leaves = await db.leaves.find(leave_filter, {"_id": 0}).to_list(200)
                    for lv in approved_leaves:
                        cat_code = lv.get("category_code") or lv.get("leave_type")
                        if not paid_codes or cat_code in paid_codes:
                            paid_leave_days += float(lv.get("days_count") or 1.0)

                # If punch attendance was found, use it; if no punches recorded yet across month, default to full total_days
                if punch_count > 0:
                    present_days = float(min(total_days, punch_count))
                    paid_leave_days = float(min(max(0.0, total_days - present_days), paid_leave_days))
                    payable_days = float(min(total_days, present_days + paid_leave_days))
                else:
                    # Default: assuming full attendance if no digital punches logged yet
                    present_days = float(total_days)
                    paid_leave_days = 0.0
                    payable_days = float(total_days)
            else:
                present_days = float(total_days)
                paid_leave_days = 0.0
                payable_days = float(total_days)

            unpaid_days = float(max(0.0, total_days - payable_days))

            # Base salary structure from Employee
            def _num(key: str) -> float:
                try: return float(emp.get(key) or 0.0)
                except: return 0.0

            base_pay = _num("pay")
            base_da = _num("da")
            base_hra = _num("hra")
            base_ma = _num("ma")
            base_ta = _num("ta")
            base_other = _num("other1") + _num("other2")
            base_gross = round(base_pay + base_da + base_hra + base_ma + base_ta + base_other, 2)

            # Pro-rata ratio
            ratio = (payable_days / total_days) if total_days > 0 else 1.0

            earned_pay = round(base_pay * ratio, 2)
            earned_da = round(base_da * ratio, 2)
            earned_hra = round(base_hra * ratio, 2)
            earned_ma = round(base_ma * ratio, 2)
            earned_ta = round(base_ta * ratio, 2)
            earned_other = round(base_other * ratio, 2)
            bonus = 0.0
            gross_amount = round(earned_pay + earned_da + earned_hra + earned_ma + earned_ta + earned_other + bonus, 2)

            # Deductions
            ded_epfo = round(_num("ded_epfo") * (ratio if _num("ded_epfo") > 0 else 0), 2)
            ded_esic = round(_num("ded_esic") * (ratio if _num("ded_esic") > 0 else 0), 2)
            
            # Advance recovery installment
            ded_advance_total = _num("ded_advance")
            installments = int(emp.get("ded_advance_installments") or 1)
            installment_amount = round(ded_advance_total / max(1, installments), 2) if ded_advance_total > 0 else 0.0
            ded_advance = installment_amount
            
            ded_other = round(_num("ded_other"), 2)
            total_deductions = round(ded_epfo + ded_esic + ded_advance + ded_other, 2)

            net_payable = round(max(0.0, gross_amount - total_deductions), 2)

            slip_id = f"slp_{uuid.uuid4().hex[:10]}"
            
            # Check if slip exists for this employee and month
            existing = await db.salary_slips.find_one({
                "payroll_month": target_month,
                "employee_id": emp_id
            }, {"_id": 0})

            slip_doc = {
                "payroll_month": target_month,
                "employee_id": emp_id,
                "employee_name": emp.get("name") or "Employee",
                "employee_code": emp_code,
                "designation": emp.get("designation") or "Staff",
                "posting_branch": emp.get("posting_branch") or "Main Branch",
                "bank_name": emp.get("bank_name"),
                "bank_account_no": emp.get("bank_account_no"),
                "bank_ifsc": emp.get("bank_ifsc"),
                "pan": emp.get("pan"),
                "epfo_no": emp.get("epfo_no"),
                "esic_no": emp.get("esic_no"),
                
                "total_days": total_days,
                "present_days": present_days,
                "paid_leave_days": paid_leave_days,
                "unpaid_days": unpaid_days,
                "payable_days": payable_days,
                
                "base_pay": base_pay,
                "base_da": base_da,
                "base_hra": base_hra,
                "base_ma": base_ma,
                "base_ta": base_ta,
                "base_other": base_other,
                "base_gross": base_gross,
                
                "earned_pay": earned_pay,
                "earned_da": earned_da,
                "earned_hra": earned_hra,
                "earned_ma": earned_ma,
                "earned_ta": earned_ta,
                "earned_other": earned_other,
                "bonus": bonus,
                "gross_amount": gross_amount,
                
                "ded_epfo": ded_epfo,
                "ded_esic": ded_esic,
                "ded_advance": ded_advance,
                "ded_other": ded_other,
                "total_deductions": total_deductions,
                
                "net_payable": net_payable,
                "status": existing.get("status", "pending") if existing else "pending",
                "payment_mode": existing.get("payment_mode") if existing else None,
                "payment_ref": existing.get("payment_ref") if existing else None,
                "payment_date": existing.get("payment_date") if existing else None,
                "remarks": existing.get("remarks") if existing else None,
                "updated_at": now,
            }

            if existing:
                slip_doc["id"] = existing["id"]
                slip_doc["created_at"] = existing.get("created_at", now)
                await db.salary_slips.update_one(
                    {"id": existing["id"]},
                    {"$set": slip_doc}
                )
            else:
                slip_doc["id"] = slip_id
                slip_doc["created_at"] = now
                await db.salary_slips.insert_one(slip_doc)

            generated_records.append(slip_doc)

        await log_audit(db, current, "payroll", "generate", target_month, None, {"count": len(generated_records)})
        
        return {
            "ok": True,
            "month": target_month,
            "generated_count": len(generated_records),
            "message": f"Successfully generated payroll for {len(generated_records)} employees for {target_month}."
        }

    # 4. Get Single Slip
    @router.get("/slips/{sid}", response_model=SalarySlipResponse)
    async def get_salary_slip(sid: str, current: any = Depends(get_current_user)):
        slip = await db.salary_slips.find_one({"id": sid}, {"_id": 0})
        if not slip:
            raise HTTPException(status_code=404, detail="Salary slip not found")
        
        # Non-admin / non-manager can only access their own slip
        if current.role not in ("admin", "manager"):
            emp = await db.employees.find_one({"email": current.email}, {"_id": 0})
            if not emp or emp.get("id") != slip.get("employee_id"):
                raise HTTPException(status_code=403, detail="Not authorized to view this salary slip")

        return SalarySlipResponse(**slip)

    # 5. Update Salary Slip (Mark Paid, Change Days, Add Bonus, etc.)
    @router.patch("/slips/{sid}", response_model=SalarySlipResponse)
    async def update_salary_slip(
        sid: str,
        payload: SalarySlipUpdate,
        current: any = Depends(require_admin_or_manager)
    ):
        existing = await db.salary_slips.find_one({"id": sid}, {"_id": 0})
        if not existing:
            raise HTTPException(status_code=404, detail="Salary slip not found")

        updates: Dict[str, Any] = {}
        if payload.status is not None:
            updates["status"] = payload.status
        if payload.payment_mode is not None:
            updates["payment_mode"] = payload.payment_mode
        if payload.payment_ref is not None:
            updates["payment_ref"] = payload.payment_ref
        if payload.payment_date is not None:
            updates["payment_date"] = payload.payment_date
        elif payload.status == "paid" and not existing.get("payment_date"):
            updates["payment_date"] = datetime.now().strftime("%Y-%m-%d")
        if payload.remarks is not None:
            updates["remarks"] = payload.remarks

        # If recalculating payable days or bonus or deduction
        recalculate = False
        payable_days = existing.get("payable_days", 30.0)
        total_days = existing.get("total_days", 30)
        bonus = existing.get("bonus", 0.0)
        ded_other = existing.get("ded_other", 0.0)

        if payload.payable_days is not None:
            payable_days = float(payload.payable_days)
            updates["payable_days"] = payable_days
            updates["unpaid_days"] = float(max(0.0, total_days - payable_days))
            recalculate = True

        if payload.bonus is not None:
            bonus = float(payload.bonus)
            updates["bonus"] = bonus
            recalculate = True

        if payload.ded_other is not None:
            ded_other = float(payload.ded_other)
            updates["ded_other"] = ded_other
            recalculate = True

        if recalculate:
            ratio = (payable_days / total_days) if total_days > 0 else 1.0
            base_pay = existing.get("base_pay", 0.0)
            base_da = existing.get("base_da", 0.0)
            base_hra = existing.get("base_hra", 0.0)
            base_ma = existing.get("base_ma", 0.0)
            base_ta = existing.get("base_ta", 0.0)
            base_other = existing.get("base_other", 0.0)

            earned_pay = round(base_pay * ratio, 2)
            earned_da = round(base_da * ratio, 2)
            earned_hra = round(base_hra * ratio, 2)
            earned_ma = round(base_ma * ratio, 2)
            earned_ta = round(base_ta * ratio, 2)
            earned_other = round(base_other * ratio, 2)
            gross_amount = round(earned_pay + earned_da + earned_hra + earned_ma + earned_ta + earned_other + bonus, 2)

            ded_epfo = round(existing.get("ded_epfo", 0.0), 2)
            ded_esic = round(existing.get("ded_esic", 0.0), 2)
            ded_advance = round(existing.get("ded_advance", 0.0), 2)
            total_deductions = round(ded_epfo + ded_esic + ded_advance + ded_other, 2)
            net_payable = round(max(0.0, gross_amount - total_deductions), 2)

            updates.update({
                "earned_pay": earned_pay,
                "earned_da": earned_da,
                "earned_hra": earned_hra,
                "earned_ma": earned_ma,
                "earned_ta": earned_ta,
                "earned_other": earned_other,
                "gross_amount": gross_amount,
                "total_deductions": total_deductions,
                "net_payable": net_payable,
            })

        updates["updated_at"] = now_utc()
        await db.salary_slips.update_one({"id": sid}, {"$set": updates})
        updated = await db.salary_slips.find_one({"id": sid}, {"_id": 0})
        await log_audit(db, current, "payroll", "update_slip", sid, existing, updated)

        return SalarySlipResponse(**updated)

    # 6. Detailed Printable Payslip View Data
    @router.get("/slips/{sid}/slip")
    async def get_printable_payslip(sid: str, current: any = Depends(get_current_user)):
        slip = await db.salary_slips.find_one({"id": sid}, {"_id": 0})
        if not slip:
            raise HTTPException(status_code=404, detail="Salary slip not found")

        if current.role not in ("admin", "manager"):
            emp = await db.employees.find_one({"email": current.email}, {"_id": 0})
            if not emp or emp.get("id") != slip.get("employee_id"):
                raise HTTPException(status_code=403, detail="Not authorized to view this salary slip")

        # Company profile info
        company_info = {
            "company_name": "Triveni DSC & e-Tender Service Pvt. Ltd.",
            "sub_title": "Integrated Enterprise Digital Security & Business Suite",
            "address": "Head Office: Triveni Complex, Main Road, Bihar, India - 800001",
            "phone": "+91 98765 43210",
            "email": "hr@triveni.com",
            "website": "www.trivenidsc.com",
            "gstin": "10AABCT1234F1Z5",
            "pan": "AABCT1234F"
        }

        # Amount in words
        net_words = number_to_words_inr(slip.get("net_payable", 0.0))

        # Month display e.g. "2026-09" -> "September 2026"
        month_str = slip.get("payroll_month", "")
        month_label = month_str
        try:
            dt = datetime.strptime(month_str, "%Y-%m")
            month_label = dt.strftime("%B %Y")
        except Exception:
            pass

        return {
            "company": company_info,
            "payslip_id": slip["id"],
            "payroll_month": month_str,
            "month_label": month_label,
            "generated_date": slip.get("created_at").strftime("%d-%m-%Y") if slip.get("created_at") else datetime.now().strftime("%d-%m-%Y"),
            "employee": {
                "id": slip.get("employee_id"),
                "name": slip.get("employee_name"),
                "code": slip.get("employee_code"),
                "designation": slip.get("designation"),
                "branch": slip.get("posting_branch"),
                "bank_name": slip.get("bank_name") or "State Bank of India",
                "bank_account_no": slip.get("bank_account_no") or "XXXXXXXX1234",
                "bank_ifsc": slip.get("bank_ifsc") or "SBIN0001234",
                "pan": slip.get("pan") or "ABCDE1234F",
                "epfo_no": slip.get("epfo_no") or "UAN100987654321",
                "esic_no": slip.get("esic_no") or "1029384756",
            },
            "attendance": {
                "total_days": slip.get("total_days", 30),
                "present_days": slip.get("present_days", 0.0),
                "paid_leave_days": slip.get("paid_leave_days", 0.0),
                "unpaid_days": slip.get("unpaid_days", 0.0),
                "payable_days": slip.get("payable_days", 0.0),
            },
            "earnings": [
                {"label": "Basic Pay", "base": slip.get("base_pay", 0.0), "amount": slip.get("earned_pay", 0.0)},
                {"label": "Dearness Allowance (DA)", "base": slip.get("base_da", 0.0), "amount": slip.get("earned_da", 0.0)},
                {"label": "House Rent Allowance (HRA)", "base": slip.get("base_hra", 0.0), "amount": slip.get("earned_hra", 0.0)},
                {"label": "Medical Allowance (MA)", "base": slip.get("base_ma", 0.0), "amount": slip.get("earned_ma", 0.0)},
                {"label": "Transport Allowance (TA)", "base": slip.get("base_ta", 0.0), "amount": slip.get("earned_ta", 0.0)},
                {"label": "Special / Other Allowances", "base": slip.get("base_other", 0.0), "amount": slip.get("earned_other", 0.0)},
                {"label": "Performance Bonus / Incentive", "base": 0.0, "amount": slip.get("bonus", 0.0)},
            ],
            "deductions": [
                {"label": "EPFO (Provident Fund)", "amount": slip.get("ded_epfo", 0.0)},
                {"label": "ESIC (Employee State Insurance)", "amount": slip.get("ded_esic", 0.0)},
                {"label": "Salary Advance / Loan Recovery", "amount": slip.get("ded_advance", 0.0)},
                {"label": "Other Deductions / TDS", "amount": slip.get("ded_other", 0.0)},
            ],
            "gross_earnings": slip.get("gross_amount", 0.0),
            "total_deductions": slip.get("total_deductions", 0.0),
            "net_payable": slip.get("net_payable", 0.0),
            "net_payable_words": net_words,
            "payment": {
                "status": slip.get("status", "pending"),
                "mode": slip.get("payment_mode"),
                "reference": slip.get("payment_ref"),
                "date": slip.get("payment_date"),
                "remarks": slip.get("remarks"),
            }
        }

    # 7. Update Base Salary Structure of an Employee
    @router.patch("/employees/{eid}/salary-structure")
    async def update_employee_salary_structure(
        eid: str,
        payload: SalaryStructureUpdate,
        current: any = Depends(require_admin_or_manager)
    ):
        emp = await db.employees.find_one({"id": eid}, {"_id": 0})
        if not emp:
            raise HTTPException(status_code=404, detail="Employee not found")

        updates: Dict[str, Any] = {}
        for k, v in payload.dict(exclude_unset=True).items():
            if v is not None:
                updates[k] = v

        if not updates:
            return emp

        merged = {**emp, **updates}
        
        def f(k):
            try: return float(merged.get(k) or 0.0)
            except: return 0.0

        gross = f("pay") + f("da") + f("hra") + f("ma") + f("ta") + f("other1") + f("other2")
        ded = f("ded_epfo") + f("ded_esic") + f("ded_advance") + f("ded_other")
        updates["gross_amount"] = round(gross, 2)
        updates["net_total"] = round(gross - ded, 2)

        await db.employees.update_one({"id": eid}, {"$set": updates})
        updated = await db.employees.find_one({"id": eid}, {"_id": 0})
        await log_audit(db, current, "employees", "update_salary_structure", eid, emp, updated)

        return updated

    # 8. Delete Slip
    @router.delete("/slips/{sid}")
    async def delete_salary_slip(sid: str, current: any = Depends(require_admin)):
        existing = await db.salary_slips.find_one({"id": sid}, {"_id": 0})
        if not existing:
            raise HTTPException(status_code=404, detail="Salary slip not found")

        await db.salary_slips.delete_one({"id": sid})
        await log_audit(db, current, "payroll", "delete_slip", sid, existing, None)
        return {"ok": True, "deleted": sid}

    return router
