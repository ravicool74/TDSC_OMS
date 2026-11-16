import os
import re
import uuid
import logging
import secrets
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import List, Optional, Dict, Any, Union

import bcrypt
import certifi
import httpx
import requests
from dotenv import load_dotenv
from fastapi import FastAPI, APIRouter, Depends, HTTPException, Header, UploadFile, File, Form, Query, Request
from fastapi.responses import Response, FileResponse
from fastapi.concurrency import run_in_threadpool
from invoice_pdf import build_invoice_pdf
from customer_pdf import build_customer_pdf, generate_contractors_directory_pdf
from payment_in_pdf import build_payment_in_pdf
from expense_pdf import build_expense_pdf
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import ReturnDocument
from pydantic import BaseModel, Field, EmailStr, field_validator
from starlette.middleware.cors import CORSMiddleware
from security_vault import log_audit_entry, encrypt_credential, decrypt_credential, mask_credential
from branch_routes import make_branch_router
from post_routes import make_post_router
from role_routes import make_role_router, ALL_MENU_IDS, get_all_perms, build_role_menu_matrix
from user_routes import make_user_router
from service_routes import make_service_router
from audit_routes import make_audit_router
from notification_routes import make_notification_router
from customer_vault_routes import make_customer_vault_router
from accounting_extra_routes import make_accounting_extra_router
from field_gps_routes import make_gps_router
from task_workflow_routes import make_task_workflow_router
from system_operations_routes import make_system_operations_router
from custom_field_routes import make_custom_field_router
from leave_routes import make_leave_router
from payroll_routes import make_payroll_router
from tender_management_routes import make_tender_management_router
from document_library_routes import make_document_library_router
from tender_calling_routes import make_tender_calling_router
from accounting_reports_routes import make_accounting_reports_router
from cash_bank_routes import make_cash_bank_router
from task_chat_routes import make_task_chat_router
from service_workflow_routes import make_service_workflow_router
from service_request_routes import make_service_request_router, ensure_customer_account
from customer_portal_core import init_customer_portal_indexes
from district_routes import make_district_router
from expense_approval_routes import make_expense_approval_router


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# ============ MongoDB ============
raw_mongo_url = os.environ.get('MONGO_URL', 'mongodb://localhost:27017')
mongo_url = re.sub(r'[\x00-\x20\x7f-\x9f]', '', raw_mongo_url)
client_kwargs = {}
if "mongodb+srv://" in mongo_url or "tls=true" in mongo_url.lower():
    client_kwargs["tlsCAFile"] = certifi.where()
client = AsyncIOMotorClient(mongo_url, **client_kwargs)
raw_db_name = os.environ.get('DB_NAME', 'triveni_fms')
db_name = re.sub(r'[\x00-\x20\x7f-\x9f]', '', raw_db_name)
db = client[db_name]

# ============ Object Storage ============
STORAGE_BASE = (os.environ.get("INTEGRATION_PROXY_URL") or "").strip().rstrip("/")
if not STORAGE_BASE:
    logger_boot = logging.getLogger(__name__)
    logger_boot.warning("INTEGRATION_PROXY_URL not configured — object storage will fail until set")
STORAGE_URL = (STORAGE_BASE + "/objstore/api/v1/storage") if STORAGE_BASE else ""
EMERGENT_KEY = os.environ.get("EMERGENT_LLM_KEY")
APP_NAME = "triveni-business-manager"
_storage_key: Optional[str] = None


def init_storage():
    global _storage_key
    if not STORAGE_URL:
        return None
    if _storage_key:
        return _storage_key
    resp = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": EMERGENT_KEY}, timeout=30)
    resp.raise_for_status()
    _storage_key = resp.json()["storage_key"]
    return _storage_key


LOCAL_STORAGE_DIR = ROOT_DIR / "uploads"
LOCAL_STORAGE_DIR.mkdir(parents=True, exist_ok=True)


def put_object(path: str, data: bytes, content_type: str) -> dict:
    if not STORAGE_URL:
        target_path = (LOCAL_STORAGE_DIR / path).resolve()
        if not str(target_path).startswith(str(LOCAL_STORAGE_DIR.resolve())):
            raise HTTPException(status_code=400, detail="Invalid storage path")
        target_path.parent.mkdir(parents=True, exist_ok=True)
        with open(target_path, "wb") as f:
            f.write(data)
        return {"path": path, "size": len(data), "content_type": content_type}
    key = init_storage()
    resp = requests.put(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key, "Content-Type": content_type},
        data=data,
        timeout=120,
    )
    resp.raise_for_status()
    return resp.json()


def get_object(path: str):
    if not STORAGE_URL:
        clean_path = path.replace("\\", "/")
        if clean_path.startswith("uploads/"):
            clean_path = clean_path[len("uploads/"):]
        target_path = (LOCAL_STORAGE_DIR / clean_path).resolve()
        if not target_path.exists():
            # Check with path as is
            target_path = (LOCAL_STORAGE_DIR / path).resolve()
        if not target_path.exists():
            # Check relative to ROOT_DIR
            alt = (ROOT_DIR / path).resolve()
            if alt.exists():
                target_path = alt
            else:
                raise HTTPException(status_code=404, detail="File not found")
        with open(target_path, "rb") as f:
            content = f.read()
        import mimetypes
        guess_ct = mimetypes.guess_type(target_path.name)[0] or "application/octet-stream"
        return content, guess_ct
    global _storage_key
    key = init_storage()
    resp = requests.get(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key}, timeout=60)
    if resp.status_code == 503:
        _storage_key = None
        key = init_storage()
        resp = requests.get(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key}, timeout=60)
    resp.raise_for_status()
    return resp.content, resp.headers.get("Content-Type", "application/octet-stream")


# ============ App ============
app = FastAPI()
api_router = APIRouter(prefix="/api")


@app.get("/download-apk")
@api_router.get("/download-apk")
async def download_apk():
    apk_path = ROOT_DIR.parent / "TDSC-Office-Manager.apk"
    if apk_path.exists():
        return FileResponse(apk_path, media_type="application/vnd.android.package-archive", filename="TDSC-Office-Manager.apk")
    raise HTTPException(status_code=404, detail="APK not found")


@app.get("/api/app/version")
@api_router.get("/app/version")
async def get_app_version():
    return {
        "version": "1.3.5",
        "version_code": 10,
        "apk_url": "https://tdsc-oms-backend.onrender.com/download-apk",
        "fallback_apk_url": "https://frontend-rho-woad-43.vercel.app/TDSC-Office-Manager.apk",
        "release_notes": "• Financial Suite Real Mode: Zeroed demo vouchers, bank balances & cash in hand\n• Cheques & Loans: Full Add, Edit, Safe Delete with automatic balance reconciliation\n• Fixed Cash in Hand opening balance to 0.00\n• Web UX improvements and confirmation dialogs",
        "mandatory": False,
    }

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


# ============ Models ============
class User(BaseModel):
    user_id: str
    email: str
    name: str
    role: str = "employee"  # super_admin, admin, manager, employee, customer
    role_id: Optional[str] = None
    role_name: Optional[str] = None
    status: Optional[str] = "active"
    picture: Optional[str] = None
    phone: Optional[str] = None
    department: Optional[str] = None
    designation: Optional[str] = None
    permissions: Dict[str, List[str]] = Field(default_factory=dict)
    allowed_menus: List[str] = Field(default_factory=list)
    app_menu_matrix: Dict[str, Any] = Field(default_factory=dict)
    customer_id: Optional[str] = None
    customer_code: Optional[str] = None
    customer_user_id: Optional[str] = None
    numeric_user_id: Optional[str] = None
    agency_name: Optional[str] = None
    company_name: Optional[str] = None
    must_change_password: Optional[bool] = False
    created_at: Optional[Union[datetime, str]] = Field(default_factory=now_utc)


class SignupInput(BaseModel):
    email: EmailStr
    name: str
    password: str
    role: str = "employee"


class LoginInput(BaseModel):
    email: str  # Supports Email, Username, or User ID (e.g. TDSC-USR-000001)
    password: str


class ChangePasswordInput(BaseModel):
    current_password: str
    new_password: str


class SessionExchangeInput(BaseModel):
    session_id: str


class AuthResponse(BaseModel):
    session_token: str
    user: User


class Customer(BaseModel):
    id: str = Field(default_factory=lambda: new_id("cus"))
    customer_code: Optional[str] = None  # auto TDSC-CUST-ID-00000001

    # Basic (mandatory: name, mobile, whatsapp, pan, aadhar, TDSC Branch, District)
    name: str  # Contractor name
    address: Optional[str] = None
    mobile: str
    whatsapp: str
    email: Optional[str] = None
    pan: str
    aadhar: str
    branch_id: Optional[str] = None
    branch_name: Optional[str] = None
    district: Optional[str] = None

    # eproc2
    eproc2_user_id: Optional[str] = None
    eproc2_password: Optional[str] = None
    eproc2_email: Optional[str] = None

    # Railway
    railway_user_id: Optional[str] = None
    railway_password: Optional[str] = None
    railway_email: Optional[str] = None

    # CPP
    cpp_user_id: Optional[str] = None
    cpp_password: Optional[str] = None
    cpp_email: Optional[str] = None

    # GST
    gst_no: Optional[str] = None
    gst_password: Optional[str] = None
    gst_email: Optional[str] = None

    # EPFO
    epfo_user_id: Optional[str] = None
    epfo_password: Optional[str] = None
    epfo_email: Optional[str] = None

    # Other portal
    other_portal_user_id: Optional[str] = None
    other_portal_password: Optional[str] = None
    other_portal_email: Optional[str] = None

    # Digital Signature
    dsc_serial_no: Optional[str] = None
    dsc_issued_date: Optional[str] = None
    dsc_expired_date: Optional[str] = None

    # ISO
    iso_user_id: Optional[str] = None
    iso_password: Optional[str] = None

    # GEM
    gem_user_id: Optional[str] = None
    gem_password: Optional[str] = None
    gem_email: Optional[str] = None

    # PMGSY
    pmgsy_user_id: Optional[str] = None
    pmgsy_password: Optional[str] = None
    pmgsy_email: Optional[str] = None

    # Contractor Registration
    contractor_reg_no: Optional[str] = None
    registration_class: Optional[str] = None
    registration_validity: Optional[str] = None

    # Additional 42 fields
    alternate_mobile: Optional[str] = None
    departments: Optional[str] = None
    encryption_serial_no: Optional[str] = None
    encryption_issued_date: Optional[str] = None
    encryption_expired_date: Optional[str] = None
    iso_other_details: Optional[str] = None
    gem_seller_id: Optional[str] = None

    notes: Optional[str] = None
    custom_fields: Dict[str, Any] = Field(default_factory=dict)
    attachments: List[dict] = Field(default_factory=list)  # [{path,name,size,content_type,uploaded_at}]
    documents: List[dict] = Field(default_factory=list)  # customer vault documents (validity & general)
    created_by: Optional[str] = None
    created_at: datetime = Field(default_factory=now_utc)


class CustomerInput(BaseModel):
    name: str
    address: Optional[str] = None
    mobile: str
    whatsapp: str
    alternate_mobile: Optional[str] = None
    email: Optional[str] = None
    pan: str
    aadhar: str
    branch_id: Optional[str] = None
    branch_name: Optional[str] = None
    district: Optional[str] = None
    departments: Optional[str] = None
    eproc2_user_id: Optional[str] = None
    eproc2_password: Optional[str] = None
    eproc2_email: Optional[str] = None
    railway_user_id: Optional[str] = None
    railway_password: Optional[str] = None
    railway_email: Optional[str] = None
    cpp_user_id: Optional[str] = None
    cpp_password: Optional[str] = None
    cpp_email: Optional[str] = None
    gst_no: Optional[str] = None
    gst_password: Optional[str] = None
    gst_email: Optional[str] = None
    epfo_user_id: Optional[str] = None
    epfo_password: Optional[str] = None
    epfo_email: Optional[str] = None
    other_portal_user_id: Optional[str] = None
    other_portal_password: Optional[str] = None
    other_portal_email: Optional[str] = None
    dsc_serial_no: Optional[str] = None
    dsc_issued_date: Optional[str] = None
    dsc_expired_date: Optional[str] = None
    encryption_serial_no: Optional[str] = None
    encryption_issued_date: Optional[str] = None
    encryption_expired_date: Optional[str] = None
    iso_user_id: Optional[str] = None
    iso_password: Optional[str] = None
    iso_other_details: Optional[str] = None
    gem_user_id: Optional[str] = None
    gem_password: Optional[str] = None
    gem_seller_id: Optional[str] = None
    gem_email: Optional[str] = None
    pmgsy_user_id: Optional[str] = None
    pmgsy_password: Optional[str] = None
    pmgsy_email: Optional[str] = None
    contractor_reg_no: Optional[str] = None
    registration_class: Optional[str] = None
    registration_validity: Optional[str] = None
    notes: Optional[str] = None
    custom_fields: Optional[Dict[str, Any]] = Field(default_factory=dict)


class Employee(BaseModel):
    id: str = Field(default_factory=lambda: new_id("emp"))
    employee_code: Optional[str] = None  # TDSC{seq}{DDMMYYYY}

    # Basic
    name: str
    address: Optional[str] = None
    mobile: Optional[str] = None
    emergency_mobile: Optional[str] = None
    email: str
    photo_path: Optional[str] = None
    pan: Optional[str] = None
    aadhar: Optional[str] = None
    date_of_joining: Optional[str] = None  # DD-MM-YYYY or YYYY-MM-DD
    date_of_birth: Optional[str] = None

    # Bank
    bank_account_no: Optional[str] = None
    bank_ifsc: Optional[str] = None
    bank_name: Optional[str] = None
    account_holder_name: Optional[str] = None

    # Employment
    designation: Optional[str] = None
    posting_branch: Optional[str] = None
    office_id: Optional[str] = None
    role: str = "employee"
    epfo_no: Optional[str] = None
    esic_no: Optional[str] = None

    # Salary components
    pay: Optional[float] = 0
    da: Optional[float] = 0
    hra: Optional[float] = 0
    ma: Optional[float] = 0
    ta: Optional[float] = 0
    other1: Optional[float] = 0
    other2: Optional[float] = 0
    gross_amount: Optional[float] = 0

    # Deductions
    ded_epfo: Optional[float] = 0
    ded_esic: Optional[float] = 0
    ded_advance: Optional[float] = 0
    ded_advance_installments: Optional[str] = None
    ded_other: Optional[float] = 0
    net_total: Optional[float] = 0

    salary: Optional[float] = None  # backward-compat kept
    created_at: datetime = Field(default_factory=now_utc)


class EmployeeInput(BaseModel):
    name: str
    address: Optional[str] = None
    mobile: Optional[str] = None
    emergency_mobile: Optional[str] = None
    email: EmailStr
    pan: Optional[str] = None
    aadhar: Optional[str] = None
    date_of_joining: Optional[str] = None
    date_of_birth: Optional[str] = None
    bank_account_no: Optional[str] = None
    bank_ifsc: Optional[str] = None
    bank_name: Optional[str] = None
    account_holder_name: Optional[str] = None
    designation: Optional[str] = None
    posting_branch: Optional[str] = None
    office_id: Optional[str] = None
    role: str = "employee"
    epfo_no: Optional[str] = None
    esic_no: Optional[str] = None
    pay: Optional[float] = 0
    da: Optional[float] = 0
    hra: Optional[float] = 0
    ma: Optional[float] = 0
    ta: Optional[float] = 0
    other1: Optional[float] = 0
    other2: Optional[float] = 0
    ded_epfo: Optional[float] = 0
    ded_esic: Optional[float] = 0
    ded_advance: Optional[float] = 0
    ded_advance_installments: Optional[str] = None
    ded_other: Optional[float] = 0


class SubTask(BaseModel):
    id: str = Field(default_factory=lambda: new_id("sub"))
    title: str
    done: bool = False
    note: Optional[str] = None
    order: int = 0


class StageHistoryEntry(BaseModel):
    stage_id: str
    stage_name: str
    moved_at: datetime = Field(default_factory=now_utc)
    moved_by: Optional[str] = None
    moved_by_name: Optional[str] = None
    assignee_id: Optional[str] = None
    assignee_name: Optional[str] = None
    note: Optional[str] = None


class Task(BaseModel):
    id: str = Field(default_factory=lambda: new_id("tsk"))
    task_no: Optional[str] = None       # TSK-0001
    title: str
    description: Optional[str] = None

    task_type_id: Optional[str] = None
    task_type_name: Optional[str] = None

    task_category: Optional[str] = "task_followup"  # "payment_followup" | "task_followup"
    chat_participants: List[str] = Field(default_factory=list)
    service_id: Optional[str] = None
    service_name: Optional[str] = None
    workflow_stages: List[dict] = Field(default_factory=list)
    current_stage_index: Optional[int] = 0
    workflow_history: List[dict] = Field(default_factory=list)

    # Per-task custom stages (task creator/admin defines them)
    stages: List[dict] = Field(default_factory=list)  # [{id,name,order,color?}]
    current_stage_id: Optional[str] = None
    current_stage_name: Optional[str] = None
    stage_history: List[dict] = Field(default_factory=list)

    sub_tasks: List[dict] = Field(default_factory=list)

    source_type: Optional[str] = None
    source_id: Optional[str] = None
    request_no: Optional[str] = None

    voucher_no: Optional[str] = None
    voucher_date: Optional[str] = None
    total_amount: Optional[float] = 0
    paid_amount: Optional[float] = 0
    dues_amount: Optional[float] = 0

    deadline: Optional[str] = None

    assignee_id: Optional[str] = None
    assignee_name: Optional[str] = None

    # Linked customer (denormalised for quick display)
    customer_id: Optional[str] = None
    customer_code: Optional[str] = None
    customer_name: Optional[str] = None
    customer_mobile: Optional[str] = None
    customer_pan: Optional[str] = None
    customer_address: Optional[str] = None

    priority: str = "medium"
    status: str = "todo"

    attachments: List[dict] = Field(default_factory=list)

    created_by: Optional[str] = None
    created_by_name: Optional[str] = None
    linked_voucher_no: Optional[str] = None
    linked_approval_id: Optional[str] = None
    created_at: Any = Field(default_factory=now_utc)

    @field_validator("created_at", mode="before")
    @classmethod
    def _validate_created_at(cls, v):
        if not v:
            return now_utc()
        if isinstance(v, datetime):
            return v
        s = str(v).strip()
        formats = [
            "%d-%m-%Y %I:%M:%S %p",
            "%d/%m/%Y %I:%M:%S %p",
            "%Y-%m-%d %H:%M:%S",
            "%Y-%m-%dT%H:%M:%S",
            "%Y-%m-%d",
            "%d/%m/%Y",
            "%d-%m-%Y",
        ]
        for fmt in formats:
            try:
                return datetime.strptime(s, fmt).replace(tzinfo=timezone.utc)
            except Exception:
                pass
        try:
            return datetime.fromisoformat(s).replace(tzinfo=timezone.utc)
        except Exception:
            return now_utc()


class TaskInput(BaseModel):
    title: str
    description: Optional[str] = None
    task_type_id: Optional[str] = None
    task_category: Optional[str] = "task_followup"
    chat_participants: Optional[List[str]] = None
    service_id: Optional[str] = None
    service_name: Optional[str] = None
    stages: Optional[List[dict]] = None   # optional initial stages [{name,color?}]
    sub_tasks: Optional[List[dict]] = None
    voucher_no: Optional[str] = None
    voucher_date: Optional[str] = None
    total_amount: Optional[float] = 0
    paid_amount: Optional[float] = 0
    deadline: Optional[str] = None
    assignee_id: Optional[str] = None
    assignee_name: Optional[str] = None
    customer_id: Optional[str] = None
    customer_code: Optional[str] = None
    customer_name: Optional[str] = None
    customer_mobile: Optional[str] = None
    customer_pan: Optional[str] = None
    customer_address: Optional[str] = None
    priority: str = "medium"


class StageInput(BaseModel):
    name: str
    color: Optional[str] = None


class StagePatch(BaseModel):
    name: Optional[str] = None
    color: Optional[str] = None
    order: Optional[int] = None


class TaskUpdate(BaseModel):
    status: Optional[str] = None
    priority: Optional[str] = None
    title: Optional[str] = None
    description: Optional[str] = None
    task_category: Optional[str] = None
    chat_participants: Optional[List[str]] = None
    service_id: Optional[str] = None
    service_name: Optional[str] = None
    deadline: Optional[str] = None
    assignee_id: Optional[str] = None
    assignee_name: Optional[str] = None
    voucher_no: Optional[str] = None
    voucher_date: Optional[str] = None
    total_amount: Optional[float] = None
    paid_amount: Optional[float] = None
    sub_tasks: Optional[List[dict]] = None
    customer_id: Optional[str] = None
    customer_code: Optional[str] = None
    customer_name: Optional[str] = None
    customer_mobile: Optional[str] = None
    customer_pan: Optional[str] = None
    customer_address: Optional[str] = None


class MoveStageInput(BaseModel):
    stage_id: str
    assignee_id: Optional[str] = None
    assignee_name: Optional[str] = None
    note: Optional[str] = None


class WorkflowStage(BaseModel):
    id: str = Field(default_factory=lambda: new_id("stg"))
    name: str
    order: int
    color: Optional[str] = None
    role_hint: Optional[str] = None


class Workflow(BaseModel):
    id: str = Field(default_factory=lambda: new_id("wf"))
    name: str
    stages: List[dict]
    created_at: datetime = Field(default_factory=now_utc)


class WorkflowInput(BaseModel):
    name: str
    stages: List[dict]  # [{name, order, color?}]


class TaskType(BaseModel):
    id: str = Field(default_factory=lambda: new_id("tt"))
    name: str
    key: Optional[str] = None
    workflow_id: Optional[str] = None
    is_default: bool = False
    created_at: datetime = Field(default_factory=now_utc)


class TaskTypeInput(BaseModel):
    name: str
    workflow_id: Optional[str] = None


class ServiceTaskSetting(BaseModel):
    id: str = Field(default_factory=lambda: new_id("sts"))
    service_key: str                  # normalized: 'dsc', 'gst', 'tender', 'income_tax', ...
    service_label: str                # display: 'DSC Service'
    default_assignee_id: Optional[str] = None
    default_assignee_name: Optional[str] = None
    default_deadline_days: int = 7
    default_followup_days: int = 3
    auto_task_enabled: bool = True
    created_at: datetime = Field(default_factory=now_utc)


class ServiceTaskSettingInput(BaseModel):
    service_key: Optional[str] = None
    service_label: str
    default_assignee_id: Optional[str] = None
    default_assignee_name: Optional[str] = None
    default_deadline_days: int = 7
    default_followup_days: int = 3
    auto_task_enabled: bool = True


class AutoTaskGlobalToggle(BaseModel):
    enabled: bool


class AccountEntry(BaseModel):
    id: str = Field(default_factory=lambda: new_id("acc"))
    type: str  # invoice, expense
    title: str
    party: Optional[str] = None  # customer/vendor
    amount: float
    status: str = "pending"  # pending, paid
    date: Optional[str] = None
    notes: Optional[str] = None
    created_by: Optional[str] = None
    created_at: datetime = Field(default_factory=now_utc)


# ============ Accounting Phase 1 Models ============
INCOME_CATEGORIES = ["DSC Services", "E-Tender Services", "Railway Registration", "Contractor Registration", "GST/Tax Services", "Other Services"]
EXPENSE_CATEGORIES = ["Office Rent", "Salary", "Electricity", "Internet", "Travel", "Marketing", "Software/Subscription", "Office Expenses", "Other"]
PAYMENT_MODES = ["cash", "bank", "upi", "cheque"]


class BankAccount(BaseModel):
    id: str = Field(default_factory=lambda: new_id("bnk"))
    name: str
    bank_name: str
    account_no: str
    ifsc: Optional[str] = None
    opening_balance: float = 0.0
    is_active: bool = True
    created_at: datetime = Field(default_factory=now_utc)


class BankAccountInput(BaseModel):
    name: str
    bank_name: str
    account_no: str
    ifsc: Optional[str] = None
    opening_balance: float = 0.0
    is_active: bool = True


class Income(BaseModel):
    id: str = Field(default_factory=lambda: new_id("inc"))
    income_no: Optional[str] = None    # INC-0001 / PAYIN-0001
    voucher_no: Optional[str] = None   # PAYIN-0001
    date: str                          # YYYY-MM-DD
    client_id: Optional[str] = None
    client_name: str
    client_mobile: Optional[str] = None
    client_pan: Optional[str] = None
    client_gst: Optional[str] = None
    client_code: Optional[str] = None
    service_category: Optional[str] = "Other Services"
    service_name: Optional[str] = None
    amount: float
    payment_mode: str                  # cash / bank / upi / cheque
    bank_account_id: Optional[str] = None
    employee_id: Optional[str] = None
    employee_name: Optional[str] = None
    remarks: Optional[str] = None
    items: List[dict] = Field(default_factory=list)              # Particulars: sl, item, qty, rate, amount
    linked_vouchers: List[dict] = Field(default_factory=list)    # Linked sale vouchers
    payment_splits: Optional[List[dict]] = None
    attachments: List[dict] = Field(default_factory=list)
    created_by: Optional[str] = None
    created_by_name: Optional[str] = None
    linked_voucher_no: Optional[str] = None
    linked_approval_id: Optional[str] = None
    created_at: datetime = Field(default_factory=now_utc)


class IncomeInput(BaseModel):
    voucher_no: Optional[str] = None
    date: str
    client_id: Optional[str] = None
    client_name: str
    client_mobile: Optional[str] = None
    client_pan: Optional[str] = None
    client_gst: Optional[str] = None
    client_code: Optional[str] = None
    service_category: Optional[str] = "Other Services"
    service_name: Optional[str] = None
    amount: float
    payment_mode: str
    bank_account_id: Optional[str] = None
    employee_id: Optional[str] = None
    employee_name: Optional[str] = None
    remarks: Optional[str] = None
    items: List[dict] = Field(default_factory=list)
    linked_vouchers: List[dict] = Field(default_factory=list)
    payment_splits: Optional[List[dict]] = None


class IncomeUpdateInput(BaseModel):
    date: Optional[str] = None
    client_id: Optional[str] = None
    client_name: Optional[str] = None
    client_mobile: Optional[str] = None
    client_pan: Optional[str] = None
    client_gst: Optional[str] = None
    client_code: Optional[str] = None
    service_category: Optional[str] = None
    service_name: Optional[str] = None
    amount: Optional[float] = None
    payment_mode: Optional[str] = None
    bank_account_id: Optional[str] = None
    employee_id: Optional[str] = None
    employee_name: Optional[str] = None
    remarks: Optional[str] = None
    items: Optional[List[dict]] = None
    linked_vouchers: Optional[List[dict]] = None
    payment_splits: Optional[List[dict]] = None



class Expense(BaseModel):
    id: str = Field(default_factory=lambda: new_id("exp"))
    expense_no: Optional[str] = None
    date: str
    category: str
    amount: float
    payment_mode: str
    bank_account_id: Optional[str] = None
    vendor: Optional[str] = None
    description: Optional[str] = None
    status: str = "pending"  # pending, verified, approved, rejected
    verified_by: Optional[str] = None
    approved_by: Optional[str] = None
    attachments: List[dict] = Field(default_factory=list)
    customer_id: Optional[str] = None
    customer_name: Optional[str] = None
    customer_mobile: Optional[str] = None
    sale_item_names: Optional[List[str]] = None
    selected_items: Optional[List[dict]] = None
    customer_pan: Optional[str] = None
    customer_gst: Optional[str] = None
    customer_code: Optional[str] = None
    sale_invoice_id: Optional[str] = None
    sale_invoice_no: Optional[str] = None
    sale_invoice_date: Optional[str] = None
    sale_item_name: Optional[str] = None
    sale_item_names: Optional[List[str]] = None
    selected_items: Optional[List[dict]] = None
    pass_on_item_type: Optional[str] = None
    pass_on_received_amount: Optional[float] = 0.0
    created_by: Optional[str] = None
    created_by_name: Optional[str] = None
    linked_voucher_no: Optional[str] = None
    linked_approval_id: Optional[str] = None
    created_at: datetime = Field(default_factory=now_utc)


class ExpenseInput(BaseModel):
    date: str
    category: str
    amount: float
    payment_mode: str
    bank_account_id: Optional[str] = None
    vendor: Optional[str] = None
    description: Optional[str] = None
    customer_id: Optional[str] = None
    customer_name: Optional[str] = None
    customer_mobile: Optional[str] = None
    customer_pan: Optional[str] = None
    customer_gst: Optional[str] = None
    customer_code: Optional[str] = None
    sale_invoice_id: Optional[str] = None
    sale_invoice_no: Optional[str] = None
    sale_invoice_date: Optional[str] = None
    sale_item_name: Optional[str] = None
    sale_item_names: Optional[List[str]] = None
    selected_items: Optional[List[dict]] = None
    pass_on_item_type: Optional[str] = None
    pass_on_received_amount: Optional[float] = 0.0
    status: Optional[str] = "pending"


class ExpenseUpdateInput(BaseModel):
    date: Optional[str] = None
    category: Optional[str] = None
    amount: Optional[float] = None
    payment_mode: Optional[str] = None
    bank_account_id: Optional[str] = None
    vendor: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    customer_id: Optional[str] = None
    customer_name: Optional[str] = None
    customer_mobile: Optional[str] = None
    customer_pan: Optional[str] = None
    customer_gst: Optional[str] = None
    customer_code: Optional[str] = None
    sale_invoice_id: Optional[str] = None
    sale_invoice_no: Optional[str] = None
    sale_invoice_date: Optional[str] = None
    sale_item_name: Optional[str] = None


class ExpenseDecision(BaseModel):
    action: str  # verify | approve | reject


# ============ Passed On Money Items ============
class PassedOnItem(BaseModel):
    id: str = Field(default_factory=lambda: new_id("poi"))
    name: str
    fee_type: str = "Other Fee"
    unit: str = "LOT"
    default_amount: float = 0.0
    tax_rate: float = 0.0
    description: Optional[str] = None
    is_system: bool = False
    created_by: Optional[str] = None
    created_at: datetime = Field(default_factory=now_utc)


class PassedOnItemInput(BaseModel):
    name: str
    fee_type: Optional[str] = "Other Fee"
    unit: Optional[str] = "LOT"
    default_amount: Optional[float] = 0.0
    tax_rate: Optional[float] = 0.0
    description: Optional[str] = None


class PassedOnItemUpdate(BaseModel):
    name: Optional[str] = None
    fee_type: Optional[str] = None
    unit: Optional[str] = None
    default_amount: Optional[float] = None
    tax_rate: Optional[float] = None
    description: Optional[str] = None


# ============ Items (Inventory / catalog) ============
class Item(BaseModel):
    id: str = Field(default_factory=lambda: new_id("itm"))
    item_code: Optional[str] = None
    name: str
    unit: str = "PCS"
    hsn_sac: Optional[str] = None
    sale_price: float = 0.0
    purchase_price: float = 0.0
    tax_rate: float = 0.0  # GST %
    is_service: bool = False
    stock: float = 0.0
    low_stock_alert: float = 0.0
    description: Optional[str] = None
    created_by: Optional[str] = None
    created_at: datetime = Field(default_factory=now_utc)


class ItemInput(BaseModel):
    name: str
    unit: str = "PCS"
    hsn_sac: Optional[str] = None
    sale_price: float = 0.0
    purchase_price: float = 0.0
    tax_rate: float = 0.0
    is_service: bool = False
    stock: float = 0.0
    low_stock_alert: float = 0.0
    description: Optional[str] = None


# ============ Invoices (Sale / Purchase) ============
class InvoiceItem(BaseModel):
    item_id: Optional[str] = None
    name: str = "Item"
    qty: float = 1
    unit: str = "PCS"
    price: float = 0.0
    tax_rate: float = 0.0  # % GST
    discount: float = 0.0
    amount: float = 0.0    # qty*price - discount + tax
    item_type: Optional[str] = "actual_service"  # "passed_on_money" | "actual_service"
    fee_type: Optional[str] = None               # "EMD", "Cost of BOQ", "Tender Processing Fee", "Registration Fee", "Other Fee"
    notes: Optional[str] = None


class Invoice(BaseModel):
    id: str = Field(default_factory=lambda: new_id("inv"))
    invoice_no: Optional[str] = None    # SI-0001 / PB-0001
    invoice_type: str = "sale"          # sale | purchase
    payment_type: str = "credit"        # credit | cash
    payment_mode: str = "cash"          # cash | bank_transfer | cheque | upi | other
    date: Optional[str] = None
    payment_terms: Optional[str] = None  # Net 15/30/45/60/90 or Custom
    due_date: Optional[str] = None
    party_id: Optional[str] = None
    party_name: Optional[str] = "Unknown"
    party_mobile: Optional[str] = None
    party_pan: Optional[str] = None
    party_gst: Optional[str] = None
    party_code: Optional[str] = None
    items: List[InvoiceItem] = Field(default_factory=list)
    subtotal: float = 0.0
    total_discount: float = 0.0
    total_tax: float = 0.0
    total_amount: float = 0.0
    paid_amount: float = 0.0
    balance: float = 0.0
    status: str = "unpaid"  # unpaid | partial | paid | cancelled
    notes: Optional[str] = None
    attachments: List[dict] = Field(default_factory=list)
    signatory_name: Optional[str] = "अंजू कुमारी"
    signature_url: Optional[str] = None
    include_signature: bool = True
    payments: List[dict] = Field(default_factory=list)
    payment_splits: Optional[List[dict]] = None
    created_by: Optional[str] = None
    created_by_name: Optional[str] = None
    linked_voucher_no: Optional[str] = None
    linked_approval_id: Optional[str] = None
    created_at: datetime = Field(default_factory=now_utc)


class InvoiceInput(BaseModel):
    invoice_type: str = "sale"
    invoice_no: Optional[str] = None
    payment_type: str = "credit"
    payment_mode: str = "cash"
    date: str
    payment_terms: Optional[str] = None
    due_date: Optional[str] = None
    party_id: str
    party_name: str
    party_mobile: Optional[str] = None
    party_pan: Optional[str] = None
    party_gst: Optional[str] = None
    party_code: Optional[str] = None
    items: List[InvoiceItem] = Field(default_factory=list)
    total_amount: float = 0.0
    paid_amount: float = 0.0
    notes: Optional[str] = None
    signatory_name: Optional[str] = "अंजू कुमारी"
    signature_url: Optional[str] = None
    include_signature: Optional[bool] = True
    payments: Optional[List[dict]] = None
    payment_splits: Optional[List[dict]] = None


class AccountInput(BaseModel):
    type: str
    title: str
    party: Optional[str] = None
    amount: float
    status: str = "pending"
    date: Optional[str] = None
    notes: Optional[str] = None


class Attendance(BaseModel):
    id: str = Field(default_factory=lambda: new_id("att"))
    user_id: str
    user_name: str
    date: str
    check_in: Optional[str] = None
    check_out: Optional[str] = None
    status: str = "present"  # present, absent, half-day
    created_at: datetime = Field(default_factory=now_utc)


class AttendanceInput(BaseModel):
    date: str
    check_in: Optional[str] = None
    check_out: Optional[str] = None
    status: str = "present"


class LeaveRequest(BaseModel):
    id: str = Field(default_factory=lambda: new_id("lv"))
    user_id: str
    user_name: str
    leave_type: str  # casual, sick, earned
    from_date: str
    to_date: str
    reason: Optional[str] = None
    status: str = "pending"  # pending, approved, rejected
    created_at: datetime = Field(default_factory=now_utc)


class LeaveInput(BaseModel):
    leave_type: str
    from_date: str
    to_date: str
    reason: Optional[str] = None


class LeaveDecision(BaseModel):
    status: str  # approved or rejected


class Tender(BaseModel):
    id: str = Field(default_factory=lambda: new_id("tnd"))
    tender_code: Optional[str] = None  # auto TND-0001

    # Core
    name_of_work: str
    estimated_cost: Optional[float] = None
    contractor_class: Optional[str] = None
    nit_no: Optional[str] = None
    department: Optional[str] = None
    district: Optional[str] = None
    last_date: Optional[str] = None      # last date of tender submission
    status: str = "open"  # open, submitted, awarded, lost
    description: Optional[str] = None

    # File slots
    nit_copy: Optional[dict] = None      # {path,name,size,content_type,uploaded_at}
    boq: Optional[dict] = None           # single file
    other_documents: List[dict] = Field(default_factory=list)  # multiple files

    # Backward-compat (kept optional; new UI does not use these)
    title: Optional[str] = None
    reference_no: Optional[str] = None
    value: Optional[float] = None
    submission_deadline: Optional[str] = None
    file_path: Optional[str] = None
    file_name: Optional[str] = None

    created_by: Optional[str] = None
    created_at: datetime = Field(default_factory=now_utc)


class TenderInput(BaseModel):
    name_of_work: str
    estimated_cost: Optional[float] = None
    contractor_class: Optional[str] = None
    nit_no: Optional[str] = None
    department: Optional[str] = None
    district: Optional[str] = None
    last_date: Optional[str] = None
    status: str = "open"
    description: Optional[str] = None


class OfficeSettings(BaseModel):
    # Global settings (per-office location moved to Office model)
    start_time: str = "09:00"      # HH:MM 24h
    grace_minutes: int = 10
    late_fine_per_day: float = 100.0
    working_days_per_month: int = 26


class OfficeSettingsInput(BaseModel):
    start_time: Optional[str] = None
    grace_minutes: Optional[int] = None
    late_fine_per_day: Optional[float] = None
    working_days_per_month: Optional[int] = None


class Office(BaseModel):
    id: str = Field(default_factory=lambda: new_id("off"))
    name: str
    address: Optional[str] = None
    lat: float
    lng: float
    radius_m: int = 20
    created_at: datetime = Field(default_factory=now_utc)


class OfficeInput(BaseModel):
    name: str
    address: Optional[str] = None
    lat: float
    lng: float
    radius_m: int = 20


class OfficeUpdate(BaseModel):
    name: Optional[str] = None
    address: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    radius_m: Optional[int] = None


class PunchRecord(BaseModel):
    id: str = Field(default_factory=lambda: new_id("pn"))
    user_id: str
    user_name: str
    employee_code: Optional[str] = None
    office_id: Optional[str] = None
    office_name: Optional[str] = None
    place_name: Optional[str] = None
    type: str  # "in" | "out"
    date: str  # YYYY-MM-DD
    time: str  # HH:MM:SS
    lat: Optional[float] = None
    lng: Optional[float] = None
    accuracy: Optional[float] = None
    distance_m: Optional[float] = None
    within_geofence: bool = True
    is_late: bool = False
    face_verified: bool = True
    selfie_path: Optional[str] = None
    created_at: datetime = Field(default_factory=now_utc)


# ============ Auth ============
def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()


def verify_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode(), hashed.encode())
    except Exception:
        return False


def make_session_token() -> str:
    return secrets.token_urlsafe(48)


async def create_session(user_id: str) -> str:
    token = make_session_token()
    await db.user_sessions.insert_one({
        "session_token": token,
        "user_id": user_id,
        "created_at": now_utc(),
        "expires_at": now_utc() + timedelta(days=7),
    })
    return token


async def enrich_user_permissions(user_doc: dict) -> dict:
    role_key = user_doc.get("role_id") or user_doc.get("role") or "employee"
    role_doc = await db.roles.find_one({"$or": [{"role_id": role_key}, {"id": role_key}]}, {"_id": 0})
    if role_doc:
        if not user_doc.get("role_name"):
            user_doc["role_name"] = role_doc.get("name")
        if not user_doc.get("permissions"):
            user_doc["permissions"] = role_doc.get("permissions", {})
        if not user_doc.get("allowed_menus"):
            user_doc["allowed_menus"] = role_doc.get("allowed_menus", [])
        if not user_doc.get("app_menu_matrix"):
            user_doc["app_menu_matrix"] = role_doc.get("app_menu_matrix", build_role_menu_matrix(role_key))

    # If user is super_admin, grant full permissions and all menus
    if user_doc.get("role") == "super_admin" or user_doc.get("role_id") == "super_admin":
        user_doc["permissions"] = get_all_perms()
        user_doc["allowed_menus"] = list(ALL_MENU_IDS)
        user_doc["app_menu_matrix"] = build_role_menu_matrix("super_admin")
    elif not user_doc.get("allowed_menus") and user_doc.get("role") == "admin":
        user_doc["allowed_menus"] = list(ALL_MENU_IDS)
        if not user_doc.get("app_menu_matrix"):
            user_doc["app_menu_matrix"] = build_role_menu_matrix("admin")
    elif not user_doc.get("app_menu_matrix"):
        user_doc["app_menu_matrix"] = build_role_menu_matrix(role_key)
    return user_doc


async def get_current_user(authorization: Optional[str] = Header(None)) -> User:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing token")
    token = authorization.split(" ", 1)[1].strip()
    session = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=401, detail="Invalid session")
    expires_at = session.get("expires_at")
    if expires_at and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at and expires_at < now_utc():
        raise HTTPException(status_code=401, detail="Session expired")
    user_doc = await db.users.find_one({"user_id": session["user_id"]}, {"_id": 0, "password_hash": 0})
    if not user_doc:
        raise HTTPException(status_code=401, detail="User not found")
    user_doc = await enrich_user_permissions(user_doc)
    return User(**user_doc)


async def require_super_admin(current: User = Depends(get_current_user)) -> User:
    if current.role != "super_admin":
        raise HTTPException(status_code=403, detail="Super Admin access required")
    return current


async def require_admin(current: User = Depends(get_current_user)) -> User:
    if current.role not in ("admin", "super_admin"):
        raise HTTPException(status_code=403, detail="Admin or Super Admin access required")
    return current


async def require_admin_or_manager(current: User = Depends(get_current_user)) -> User:
    if current.role not in ("admin", "super_admin", "manager", "branch_manager"):
        raise HTTPException(status_code=403, detail="Manager, Admin, or Super Admin access required")
    return current


# ============ Auth routes ============
@api_router.post("/auth/signup")
async def signup():
    """Public self-registration is permanently disabled for security.
    All user accounts must be provisioned by an Administrator or Super Admin."""
    raise HTTPException(
        status_code=403,
        detail="Public self-registration is disabled. Please contact your system administrator to provision your account."
    )


@api_router.post("/auth/login", response_model=AuthResponse)
async def login(payload: LoginInput):
    ident = payload.email.strip()
    ident_lower = ident.lower()
    doc = await db.users.find_one({
        "$or": [
            {"email": ident_lower},
            {"username": ident_lower},
            {"user_id": ident},
            {"user_id": ident.upper()},
            {"numeric_user_id": ident},
            {"customer_code": ident.upper()},
            {"mobile": ident}
        ]
    }, {"_id": 0})
    if not doc or not doc.get("password_hash"):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if not verify_password(payload.password, doc["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    doc.pop("password_hash", None)
    doc = await enrich_user_permissions(doc)
    user = User(**doc)
    token = await create_session(user.user_id)
    return AuthResponse(session_token=token, user=user)


@api_router.post("/auth/change-password")
async def change_password(payload: ChangePasswordInput, current: User = Depends(get_current_user)):
    user_doc = await db.users.find_one({"user_id": current.user_id})
    if not user_doc or not user_doc.get("password_hash"):
        raise HTTPException(status_code=400, detail="User account does not have a local password set")
    if not verify_password(payload.current_password, user_doc["password_hash"]):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    if len(payload.new_password.strip()) < 6:
        raise HTTPException(status_code=400, detail="New password must be at least 6 characters")

    new_hash = hash_password(payload.new_password.strip())
    await db.users.update_one(
        {"user_id": current.user_id},
        {"$set": {"password_hash": new_hash, "updated_at": now_utc()}}
    )
    await log_audit_entry(db, current, "users", "change_password", current.user_id, None, {"action": "Password changed successfully"})
    return {"ok": True, "message": "Password updated successfully"}


@api_router.post("/auth/session", response_model=AuthResponse)
async def exchange_session(payload: SessionExchangeInput):
    base = (os.environ.get("EMERGENT_AUTH_BASE_URL") or "").rstrip("/")
    if not base:
        raise HTTPException(status_code=500, detail="EMERGENT_AUTH_BASE_URL not configured")
    async with httpx.AsyncClient(timeout=30) as hx:
        r = await hx.get(
            f"{base}/auth/v1/env/oauth/session-data",
            headers={"X-Session-ID": payload.session_id},
        )
    if r.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid session")
    data = r.json()
    email = (data.get("email") or "").lower()
    name = data.get("name") or email.split("@")[0]
    picture = data.get("picture")
    session_token = data.get("session_token") or make_session_token()

    existing = await db.users.find_one({"email": email}, {"_id": 0})
    if not existing:
        raise HTTPException(
            status_code=403,
            detail="Account not found. Public registration is disabled. Please contact your system administrator to provision your account."
        )

    user_id = existing["user_id"]
    existing.pop("password_hash", None)
    existing = await enrich_user_permissions(existing)
    user = User(**{**existing, "name": name, "picture": picture})
    await db.users.update_one({"user_id": user_id}, {"$set": {"name": name, "picture": picture}})

    await db.user_sessions.insert_one({
        "session_token": session_token,
        "user_id": user.user_id,
        "created_at": now_utc(),
        "expires_at": now_utc() + timedelta(days=7),
    })
    return AuthResponse(session_token=session_token, user=user)


@api_router.get("/auth/me", response_model=User)
async def me(current: User = Depends(get_current_user)):
    return current


@api_router.post("/auth/logout")
async def logout(authorization: Optional[str] = Header(None)):
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ", 1)[1].strip()
        await db.user_sessions.delete_one({"session_token": token})
    return {"ok": True}


@api_router.delete("/auth/me")
async def delete_my_account(current: User = Depends(get_current_user)):
    """Self-service account deletion (App Store / Play Store compliance).
    Removes the user, their sessions, and anonymizes personally-identifiable
    references so their business data (tasks, invoices) does not orphan.
    Admins cannot self-delete via this endpoint to avoid locking the tenant out.
    """
    if current.role in ("admin", "super_admin"):
        # Prevent lockout — administrative accounts cannot self-delete.
        raise HTTPException(status_code=400, detail="Admin and Super Admin accounts cannot self-delete. Please use User Management.")
    uid = current.user_id
    email = current.email
    # Delete auth sessions
    await db.user_sessions.delete_many({"user_id": uid})
    # Delete user document
    await db.users.delete_one({"user_id": uid})
    # Anonymize employee link if present
    try:
        await db.employees.update_many(
            {"user_id": uid},
            {"$set": {"user_id": None, "status": "inactive", "deleted_at": datetime.now(timezone.utc).isoformat()}},
        )
    except Exception:
        pass
    logger.info("Account deleted (self-service): %s / %s", uid, email)
    return {"ok": True, "deleted": True}


# ============ Customers ============
async def _find_customer_duplicate(payload_dict: dict, exclude_id: Optional[str] = None) -> Optional[dict]:
    """Return existing customer doc if any unique field matches (mobile/whatsapp/pan/aadhar/gst_no/contractor_reg_no/email)."""
    unique_pairs = []
    for f in ("mobile", "whatsapp", "pan", "aadhar", "gst_no", "contractor_reg_no", "email"):
        val = (payload_dict.get(f) or "").strip()
        if val and val.upper() not in ("NA", "N/A", "NONE", "-"):
            unique_pairs.append({f: val})
    if not unique_pairs:
        return None
    q: dict = {"$or": unique_pairs}
    if exclude_id:
        q["id"] = {"$ne": exclude_id}
    return await db.customers.find_one(q, {"_id": 0})


# Custom fields router mounted before /customers/{cid} parameter matching
api_router.include_router(make_custom_field_router(db, get_current_user, require_admin, log_audit_entry))


@api_router.post("/customers", response_model=Customer)
async def create_customer(payload: CustomerInput, current: User = Depends(get_current_user)):
    # Validate mandatory fields (name, mobile, whatsapp, pan, aadhar, TDSC Branch, District)
    missing = []
    for k in ("name", "mobile", "whatsapp", "pan", "aadhar"):
        if not (getattr(payload, k) or "").strip():
            missing.append(k)
    branch_val = (payload.branch_name or payload.branch_id or "").strip()
    if not branch_val:
        missing.append("TDSC Branch")
    if not (payload.district or "").strip():
        missing.append("District")
    if missing:
        raise HTTPException(status_code=400, detail=f"Missing mandatory: {', '.join(missing)}")

    # Resolve branch_id and branch_name
    body = payload.dict()
    b_id = body.get("branch_id")
    b_name = body.get("branch_name")
    if b_id and not b_name:
        b_doc = await db.branches.find_one({"$or": [{"id": b_id}, {"branch_id": b_id}]}, {"_id": 0})
        if b_doc:
            body["branch_name"] = b_doc.get("name")
    elif b_name and not b_id:
        b_doc = await db.branches.find_one({"name": b_name}, {"_id": 0})
        if b_doc:
            body["branch_id"] = b_doc.get("id") or b_doc.get("branch_id")

    # Duplicate check across mobile/PAN/Aadhar/GST/email/whatsapp/reg_no
    dup = await _find_customer_duplicate(body)
    if dup:
        matched_on = []
        for f in ("mobile", "whatsapp", "pan", "aadhar", "gst_no", "contractor_reg_no", "email"):
            if (getattr(payload, f, None) or "").strip() and (dup.get(f) or "").strip() == (getattr(payload, f) or "").strip():
                matched_on.append(f.upper())
        raise HTTPException(status_code=409, detail={
            "message": f"Customer already exists ({', '.join(matched_on)} match)",
            "matched_on": matched_on,
            "existing": {
                "id": dup.get("id"),
                "customer_code": dup.get("customer_code"),
                "name": dup.get("name"),
                "mobile": dup.get("mobile"),
                "pan": dup.get("pan"),
            },
        })

    # Atomically increment counter to build unique customer_code like TDSC-CUST-ID-00000001
    counter = await db.counters.find_one_and_update(
        {"_id": "customer_code"},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    seq = (counter or {}).get("seq") or 1
    code = f"TDSC-CUST-ID-{seq:08d}"
    c = Customer(**body, customer_code=code, created_by=current.user_id)
    c_dict = c.dict()
    await db.customers.insert_one(c_dict)
    # Ensure linked customer login account
    try:
        await ensure_customer_account(db, c_dict, log_audit_entry, current)
    except Exception as e:
        logger.warning("Failed to auto-create customer login account: %s", e)
    return c


class QuickPartyInput(BaseModel):
    name: str
    mobile: str
    whatsapp: Optional[str] = None
    pan: Optional[str] = None
    aadhar: Optional[str] = None
    email: Optional[str] = None
    gst_no: Optional[str] = None
    address: Optional[str] = None


@api_router.post("/customers/quick", response_model=Customer)
async def quick_add_party(payload: QuickPartyInput, current: User = Depends(get_current_user)):
    """Simplified inline party add for voucher/invoice screens. Auto-fills whatsapp=mobile, aadhar/pan as N/A if missing."""
    if not payload.name.strip() or not payload.mobile.strip():
        raise HTTPException(status_code=400, detail="Name and mobile are required")
    body = payload.dict()
    body["whatsapp"] = body.get("whatsapp") or body["mobile"]
    body["pan"] = body.get("pan") or "NA"
    body["aadhar"] = body.get("aadhar") or "NA"
    dup = await _find_customer_duplicate(body)
    if dup:
        raise HTTPException(status_code=409, detail={
            "message": "Party already exists (matched mobile/PAN/Aadhar/GST/email)",
            "existing": {
                "id": dup.get("id"),
                "customer_code": dup.get("customer_code"),
                "name": dup.get("name"),
                "mobile": dup.get("mobile"),
            },
        })
    counter = await db.counters.find_one_and_update(
        {"_id": "customer_code"}, {"$inc": {"seq": 1}}, upsert=True, return_document=ReturnDocument.AFTER,
    )
    seq = (counter or {}).get("seq") or 1
    code = f"TDSC-CUST-ID-{seq:08d}"
    c = Customer(
        name=body["name"].strip(), mobile=body["mobile"].strip(), whatsapp=body["whatsapp"].strip(),
        pan=body["pan"], aadhar=body["aadhar"], email=body.get("email"), gst_no=body.get("gst_no"),
        address=body.get("address"), customer_code=code, created_by=current.user_id,
    )
    c_dict = c.dict()
    await db.customers.insert_one(c_dict)
    try:
        await ensure_customer_account(db, c_dict, log_audit_entry, current)
    except Exception as e:
        logger.warning("Failed to auto-create customer login account in quick add: %s", e)
    return c


@api_router.get("/customers/search", response_model=List[Customer])
async def search_customers(q: str = "", limit: int = 25, current: User = Depends(get_current_user)):
    """Search customers by any of: name, customer_code, mobile, whatsapp, PAN, Aadhar, email, GST no, contractor_reg_no.

    Special handling: if the query is a pure integer or padded number (e.g. "56" or "00000056"),
    we ALSO search the padded 8-digit form so the customer_code TDSC-CUST-ID-00000056 is found."""
    s = (q or "").strip()
    if not s:
        docs = await db.customers.find({}, {"_id": 0}).sort("created_at", -1).to_list(limit)
        return [Customer(**d) for d in docs]
    import re
    rx = {"$regex": re.escape(s), "$options": "i"}
    or_clauses = [
        {"name": rx}, {"customer_code": rx}, {"mobile": rx}, {"whatsapp": rx},
        {"pan": rx}, {"aadhar": rx}, {"email": rx}, {"gst_no": rx}, {"contractor_reg_no": rx},
    ]
    exact_match = None
    # If query is purely digits, also match zero-padded 8-digit form on customer_code
    if s.isdigit():
        padded = s.zfill(8)
        or_clauses.append({"customer_code": {"$regex": re.escape(padded), "$options": "i"}})
        exact_code = f"TDSC-CUST-ID-{padded}"
        exact_match = await db.customers.find_one({"customer_code": exact_code}, {"_id": 0})
    query = {"$or": or_clauses}
    docs = await db.customers.find(query, {"_id": 0}).sort("created_at", -1).to_list(limit)
    if exact_match:
        docs = [d for d in docs if d.get("id") != exact_match.get("id")]
        docs.insert(0, exact_match)
    return [Customer(**d) for d in docs[:limit]]


@api_router.get("/customers", response_model=List[Customer])
async def list_customers(
    branch: Optional[str] = Query(None),
    district: Optional[str] = Query(None),
    current: User = Depends(get_current_user)
):
    query: dict = {}
    if branch and branch != "All":
        query["$or"] = [{"branch_name": branch}, {"branch_id": branch}]
    if district and district != "All":
        query["district"] = district
    docs = await db.customers.find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return [Customer(**d) for d in docs]


@api_router.get("/customers/document-expiry-alerts")
@api_router.get("/customer-alerts/document-expiry")
async def get_customer_document_expiry_alerts_route(current: User = Depends(get_current_user)):
    from customer_vault_routes import compute_document_expiry_alerts
    return await compute_document_expiry_alerts(db)


@api_router.get("/customers/{cid}", response_model=Customer)
async def get_customer(cid: str, current: User = Depends(get_current_user)):
    d = await db.customers.find_one({"$or": [{"id": cid}, {"customer_code": cid}]}, {"_id": 0})
    if not d:
        raise HTTPException(status_code=404, detail="Not found")
    return Customer(**d)


@api_router.put("/customers/{cid}", response_model=Customer)
async def update_customer(cid: str, payload: CustomerInput, current: User = Depends(require_admin_or_manager)):
    dup = await _find_customer_duplicate(payload.dict(), exclude_id=cid)
    if dup:
        raise HTTPException(status_code=409, detail={
            "message": "Another customer already has these unique fields (mobile/PAN/Aadhar/GST/email/reg no)",
            "existing": {"id": dup.get("id"), "customer_code": dup.get("customer_code"), "name": dup.get("name")},
        })
    await db.customers.update_one({"id": cid}, {"$set": payload.dict()})
    d = await db.customers.find_one({"id": cid}, {"_id": 0})
    if not d:
        raise HTTPException(status_code=404, detail="Not found")
    try:
        # Sync user profile or ensure customer account
        linked_u = await db.users.find_one({"customer_id": cid})
        if linked_u:
            await db.users.update_one(
                {"customer_id": cid},
                {"$set": {
                    "name": d.get("name"),
                    "mobile": d.get("mobile"),
                    "agency_name": d.get("agency_name") or d.get("name"),
                    "company_name": d.get("company_name") or d.get("name"),
                    "updated_at": now_utc(),
                }}
            )
        else:
            await ensure_customer_account(db, d, log_audit_entry, current)
    except Exception as e:
        logger.warning("Failed to sync customer account in update: %s", e)
    return Customer(**d)


@api_router.post("/customers/bulk-delete")
async def bulk_delete_customers(payload: dict, current: User = Depends(require_admin)):
    ids = [i for i in (payload.get("ids") or []) if i]
    if not ids:
        return {"deleted": 0}
    res = await db.customers.delete_many({"id": {"$in": ids}})
    return {"deleted": res.deleted_count}


class BulkCustomerActionInput(BaseModel):
    ids: List[str] = Field(default_factory=list)
    action: str  # "delete", "set_department"
    department: Optional[str] = None


@api_router.post("/customers/bulk-action")
async def bulk_customer_action(payload: BulkCustomerActionInput, current: User = Depends(require_admin)):
    ids = [i for i in (payload.ids or []) if i]
    if not ids:
        return {"ok": True, "count": 0, "deleted": 0}
    if payload.action == "delete":
        res = await db.customers.delete_many({"id": {"$in": ids}})
        return {"ok": True, "count": res.deleted_count, "deleted": res.deleted_count}
    elif payload.action == "set_department":
        dept = payload.department or "All"
        res = await db.customers.update_many({"id": {"$in": ids}}, {"$set": {"departments": dept}})
        return {"ok": True, "count": res.modified_count, "department": dept}
    else:
        raise HTTPException(status_code=400, detail="Invalid bulk action")


class ExportContractorsPdfPayload(BaseModel):
    customer_ids: Optional[List[str]] = None


@api_router.post("/customers/export-pdf")
async def export_contractors_directory_pdf_endpoint(
    payload: ExportContractorsPdfPayload,
    token: Optional[str] = None,
    authorization: Optional[str] = Header(default=None),
):
    tk = None
    if authorization and authorization.startswith("Bearer "):
        tk = authorization[7:]
    elif token:
        tk = token
    if not tk:
        raise HTTPException(status_code=401, detail="Auth required")
    session = await db.user_sessions.find_one({"session_token": tk}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=401, detail="Invalid session")

    ids = [i for i in (payload.customer_ids or []) if i]
    if ids:
        contractors = await db.customers.find({"id": {"$in": ids}}, {"_id": 0}).to_list(1000)
    else:
        contractors = await db.customers.find({}, {"_id": 0}).sort("created_at", -1).to_list(1000)

    if not contractors:
        raise HTTPException(status_code=404, detail="No contractors found to export")

    pdf_bytes = await run_in_threadpool(generate_contractors_directory_pdf, contractors)
    fname = f"contractors_directory_{datetime.now().strftime('%Y%m%d_%H%M%S')}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'}
    )


@api_router.get("/customers/{cid}/pdf")
async def get_customer_pdf(cid: str, token: Optional[str] = None, authorization: Optional[str] = Header(default=None)):
    tk = None
    if authorization and authorization.startswith("Bearer "):
        tk = authorization[7:]
    elif token:
        tk = token
    if not tk:
        raise HTTPException(status_code=401, detail="Auth required")
    session = await db.user_sessions.find_one({"session_token": tk}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=401, detail="Invalid session")
    c = await db.customers.find_one({"id": cid}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Customer not found")
    pdf_bytes = await run_in_threadpool(build_customer_pdf, c)
    fname = f"{(c.get('customer_code') or 'customer').replace(' ', '_')}.pdf"
    return Response(content=pdf_bytes, media_type="application/pdf",
                   headers={"Content-Disposition": f'inline; filename="{fname}"'})


@api_router.delete("/customers/{cid}")
async def delete_customer(cid: str, current: User = Depends(require_admin)):
    res = await db.customers.delete_one({"id": cid})
    return {"deleted": res.deleted_count}


MAX_CUSTOMER_FILE_BYTES = 10 * 1024 * 1024  # 10 MB


@api_router.post("/customers/{cid}/attachments", response_model=Customer)
async def upload_customer_file(cid: str, file: UploadFile = File(...), current: User = Depends(get_current_user)):
    cust = await db.customers.find_one({"id": cid}, {"_id": 0})
    if not cust:
        raise HTTPException(status_code=404, detail="Customer not found")
    data = await file.read()
    if len(data) > MAX_CUSTOMER_FILE_BYTES:
        raise HTTPException(status_code=400, detail=f"File exceeds 10 MB limit ({len(data) // 1024} KB)")
    ext = (file.filename or "file").rsplit(".", 1)[-1].lower()
    ext = ext if len(ext) <= 8 else "bin"
    path = f"{APP_NAME}/uploads/{current.user_id}/{uuid.uuid4().hex}.{ext}"
    content_type = file.content_type or "application/octet-stream"
    await run_in_threadpool(put_object, path, data, content_type)
    attachment = {
        "path": path,
        "name": file.filename or f"file.{ext}",
        "size": len(data),
        "content_type": content_type,
        "uploaded_at": now_utc().isoformat(),
        "uploaded_by": current.user_id,
    }
    await db.customers.update_one({"id": cid}, {"$push": {"attachments": attachment}})
    updated = await db.customers.find_one({"id": cid}, {"_id": 0})
    return Customer(**updated)


@api_router.delete("/customers/{cid}/attachments", response_model=Customer)
async def delete_customer_attachment(cid: str, path: str, current: User = Depends(get_current_user)):
    cust = await db.customers.find_one({"id": cid}, {"_id": 0})
    if not cust:
        raise HTTPException(status_code=404, detail="Customer not found")
    await db.customers.update_one({"id": cid}, {"$pull": {"attachments": {"path": path}}})
    updated = await db.customers.find_one({"id": cid}, {"_id": 0})
    return Customer(**updated)


# ============ Employees ============
def _ddmmyyyy(date_str: Optional[str]) -> str:
    if not date_str:
        return datetime.now().strftime("%d%m%Y")
    s = date_str.strip()
    # accept YYYY-MM-DD or DD-MM-YYYY or DD/MM/YYYY
    for sep in ("-", "/"):
        parts = s.split(sep)
        if len(parts) == 3:
            if len(parts[0]) == 4:  # YYYY-MM-DD
                return f"{parts[2].zfill(2)}{parts[1].zfill(2)}{parts[0]}"
            else:  # DD-MM-YYYY
                return f"{parts[0].zfill(2)}{parts[1].zfill(2)}{parts[2].zfill(4)}"
    return datetime.now().strftime("%d%m%Y")


def _compute_salary(d: dict) -> dict:
    def f(k):
        try: return float(d.get(k) or 0)
        except: return 0.0
    gross = f("pay") + f("da") + f("hra") + f("ma") + f("ta") + f("other1") + f("other2")
    ded = f("ded_epfo") + f("ded_esic") + f("ded_advance") + f("ded_other")
    d["gross_amount"] = round(gross, 2)
    d["net_total"] = round(gross - ded, 2)
    return d


@api_router.post("/employees", response_model=Employee)
async def create_employee(payload: EmployeeInput, current: User = Depends(require_admin_or_manager)):
    data = payload.dict()
    counter = await db.counters.find_one_and_update(
        {"_id": "employee_code"},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    seq = (counter or {}).get("seq") or 1
    ddmmyyyy = _ddmmyyyy(data.get("date_of_joining"))
    code = f"TDSC{seq:02d}{ddmmyyyy}"
    data = _compute_salary(data)
    e = Employee(**data, employee_code=code)
    await db.employees.insert_one(e.dict())
    return e


@api_router.get("/employees", response_model=List[Employee])
async def list_employees(q: Optional[str] = Query(None), current: User = Depends(get_current_user)):
    query = {}
    if q and q.strip():
        term = q.strip()
        regex = {"$regex": term, "$options": "i"}
        clean_num = re.sub(r"\D", "", term)
        or_clauses = [
            {"name": regex},
            {"pan": regex},
            {"aadhar": regex},
            {"mobile": regex},
            {"employee_code": regex},
            {"id": regex},
            {"email": regex},
            {"designation": regex},
            {"posting_branch": regex},
        ]
        if clean_num and len(clean_num) >= 3:
            or_clauses.append({"mobile": {"$regex": clean_num}})
            or_clauses.append({"aadhar": {"$regex": clean_num}})
        query["$or"] = or_clauses
    docs = await db.employees.find(query, {"_id": 0}).sort("created_at", -1).to_list(500)
    return [Employee(**d) for d in docs]


@api_router.get("/employees/{eid}", response_model=Employee)
async def get_employee(eid: str, current: User = Depends(get_current_user)):
    d = await db.employees.find_one({"id": eid}, {"_id": 0})
    if not d:
        raise HTTPException(status_code=404, detail="Not found")
    return Employee(**d)


@api_router.patch("/employees/{eid}", response_model=Employee)
async def update_employee(eid: str, payload: dict, current: User = Depends(require_admin_or_manager)):
    allowed = {"name", "email", "office_id", "designation", "posting_branch", "role", "pay", "da", "hra", "ma", "ta", "other1", "other2", "ded_epfo", "ded_esic", "ded_advance", "ded_advance_installments", "ded_other", "mobile", "emergency_mobile", "address", "bank_account_no", "bank_ifsc", "bank_name", "account_holder_name", "pan", "aadhar", "date_of_birth", "date_of_joining", "epfo_no", "esic_no"}
    updates = {k: v for k, v in payload.items() if k in allowed and v is not None}
    if updates:
        # If salary fields changed, recompute gross/net
        if any(k in updates for k in ("pay","da","hra","ma","ta","other1","other2","ded_epfo","ded_esic","ded_advance","ded_other")):
            current_doc = await db.employees.find_one({"id": eid}, {"_id": 0}) or {}
            merged = {**current_doc, **updates}
            merged = _compute_salary(merged)
            updates["gross_amount"] = merged["gross_amount"]
            updates["net_total"] = merged["net_total"]
        await db.employees.update_one({"id": eid}, {"$set": updates})
    d = await db.employees.find_one({"id": eid}, {"_id": 0})
    if not d:
        raise HTTPException(status_code=404, detail="Not found")
    return Employee(**d)


class BulkEmployeeActionInput(BaseModel):
    ids: List[str] = Field(default_factory=list)
    action: str  # "delete", "assign_office"
    office_id: Optional[str] = None


@api_router.post("/employees/bulk-action")
async def bulk_employee_action(payload: BulkEmployeeActionInput, current: User = Depends(require_admin_or_manager)):
    ids = [i for i in (payload.ids or []) if i]
    if not ids:
        return {"ok": True, "count": 0, "deleted": 0}
    if payload.action == "delete":
        if current.role not in ("admin", "super_admin"):
            raise HTTPException(status_code=403, detail="Admin or Super Admin access required to delete employees")
        res = await db.employees.delete_many({"id": {"$in": ids}})
        return {"ok": True, "count": res.deleted_count, "deleted": res.deleted_count}
    elif payload.action == "assign_office":
        res = await db.employees.update_many({"id": {"$in": ids}}, {"$set": {"office_id": payload.office_id}})
        return {"ok": True, "count": res.modified_count, "office_id": payload.office_id}
    else:
        raise HTTPException(status_code=400, detail="Invalid bulk action")


@api_router.delete("/employees/{eid}")
async def delete_employee(eid: str, current: User = Depends(require_admin)):
    res = await db.employees.delete_one({"id": eid})
    return {"deleted": res.deleted_count}


@api_router.post("/employees/{eid}/photo", response_model=Employee)
async def upload_employee_photo(eid: str, file: UploadFile = File(...), current: User = Depends(require_admin_or_manager)):
    emp = await db.employees.find_one({"id": eid}, {"_id": 0})
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")
    data = await file.read()
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Photo exceeds 10 MB limit")
    ext = (file.filename or "img").rsplit(".", 1)[-1].lower()
    ext = ext if len(ext) <= 8 else "jpg"
    path = f"{APP_NAME}/uploads/{current.user_id}/{uuid.uuid4().hex}.{ext}"
    content_type = file.content_type or "image/jpeg"
    await run_in_threadpool(put_object, path, data, content_type)
    await db.employees.update_one({"id": eid}, {"$set": {"photo_path": path}})
    updated = await db.employees.find_one({"id": eid}, {"_id": 0})
    return Employee(**updated)


# ============ Workflows & Task Types ============
DEFAULT_STAGES = [
    {"name": "Received", "order": 0, "color": "#3B82F6"},
    {"name": "In Progress", "order": 1, "color": "#F59E0B"},
    {"name": "Under Review", "order": 2, "color": "#8B5CF6"},
    {"name": "Completed", "order": 3, "color": "#10B981"},
]

DEFAULT_TASK_TYPES = [
    {"key": "digital_signature", "name": "Digital Signature"},
    {"key": "tender", "name": "Tender"},
    {"key": "contractor_registration", "name": "Contractor Registration Class"},
    {"key": "gst_registration", "name": "GST Registration"},
]


def _stage_with_ids(stages: List[dict]) -> List[dict]:
    out = []
    for i, s in enumerate(sorted(stages, key=lambda x: x.get("order", 0))):
        d = dict(s)
        d.setdefault("id", new_id("stg"))
        d["order"] = i
        out.append(d)
    return out


async def _ensure_seed_workflows_and_types():
    # Default workflow
    wf = await db.workflows.find_one({"name": "Standard 4-Stage"}, {"_id": 0})
    if not wf:
        wf = Workflow(name="Standard 4-Stage", stages=_stage_with_ids(DEFAULT_STAGES)).dict()
        await db.workflows.insert_one(wf)
    wf_id = wf["id"]
    # Default task types
    for tt in DEFAULT_TASK_TYPES:
        existing = await db.task_types.find_one({"key": tt["key"]}, {"_id": 0})
        if not existing:
            new_tt = TaskType(name=tt["name"], key=tt["key"], workflow_id=wf_id, is_default=True).dict()
            await db.task_types.insert_one(new_tt)


@api_router.get("/workflows", response_model=List[Workflow])
async def list_workflows(current: User = Depends(get_current_user)):
    docs = await db.workflows.find({}, {"_id": 0}).sort("created_at", 1).to_list(200)
    return [Workflow(**d) for d in docs]


@api_router.post("/workflows", response_model=Workflow)
async def create_workflow(payload: WorkflowInput, current: User = Depends(require_admin_or_manager)):
    wf = Workflow(name=payload.name, stages=_stage_with_ids(payload.stages))
    await db.workflows.insert_one(wf.dict())
    return wf


@api_router.get("/task-types", response_model=List[TaskType])
async def list_task_types(current: User = Depends(get_current_user)):
    docs = await db.task_types.find({}, {"_id": 0}).sort("created_at", 1).to_list(200)
    return [TaskType(**d) for d in docs]


@api_router.post("/task-types", response_model=TaskType)
async def create_task_type(payload: TaskTypeInput, current: User = Depends(require_admin_or_manager)):
    # Default to standard workflow if none
    workflow_id = payload.workflow_id
    if not workflow_id:
        wf = await db.workflows.find_one({"name": "Standard 4-Stage"}, {"_id": 0})
        workflow_id = wf["id"] if wf else None
    key = payload.name.lower().replace(" ", "_")[:30]
    tt = TaskType(name=payload.name.strip(), key=key, workflow_id=workflow_id, is_default=False)
    await db.task_types.insert_one(tt.dict())
    return tt


@api_router.delete("/task-types/{ttid}")
async def delete_task_type(ttid: str, current: User = Depends(require_admin)):
    doc = await db.task_types.find_one({"id": ttid}, {"_id": 0})
    if doc and doc.get("is_default"):
        raise HTTPException(status_code=400, detail="Cannot delete default task type")
    res = await db.task_types.delete_one({"id": ttid})
    return {"deleted": res.deleted_count}


# ============ Tasks ============
def _sub_tasks_with_ids(items: List[dict]) -> List[dict]:
    out = []
    for i, s in enumerate(items or []):
        d = dict(s)
        d.setdefault("id", new_id("sub"))
        d.setdefault("done", False)
        d["order"] = i
        out.append(d)
    return out


async def _resolve_type(task_type_id: Optional[str]):
    if not task_type_id:
        return None
    return await db.task_types.find_one({"id": task_type_id}, {"_id": 0})


def _order_stages(stages: List[dict]) -> List[dict]:
    out = []
    for i, s in enumerate(sorted(stages or [], key=lambda x: x.get("order", 0))):
        d = dict(s)
        d.setdefault("id", new_id("stg"))
        d["order"] = i
        out.append(d)
    return out


@api_router.post("/tasks", response_model=Task)
async def create_task(payload: TaskInput, current: User = Depends(get_current_user)):
    # Auto task_no
    counter = await db.counters.find_one_and_update(
        {"_id": "task_no"},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    seq = (counter or {}).get("seq") or 1
    task_no = f"TSK-{seq:04d}"

    tt = await _resolve_type(payload.task_type_id)

    stages = _order_stages(payload.stages or [])
    first = stages[0] if stages else None

    total = float(payload.total_amount or 0)
    paid = float(payload.paid_amount or 0)
    dues = round(total - paid, 2)

    subs = _sub_tasks_with_ids(payload.sub_tasks or [])

    initial_history = []
    if first:
        initial_history.append({
            "stage_id": first["id"],
            "stage_name": first["name"],
            "moved_at": now_utc().isoformat(),
            "moved_by": current.user_id,
            "moved_by_name": current.name,
            "assignee_id": payload.assignee_id,
            "assignee_name": payload.assignee_name,
            "note": "Task created",
        })

    # Resolve workflow stages for service if available
    wf_stages = []
    svc_name = payload.service_name or (tt or {}).get("name")
    if svc_name:
        swf = await db.service_workflows.find_one({"service_name": svc_name}, {"_id": 0})
        if swf and swf.get("stages"):
            wf_stages = swf["stages"]

    participants = list(payload.chat_participants or [])
    if payload.assignee_id and payload.assignee_id not in participants:
        participants.append(payload.assignee_id)

    t = Task(
        task_no=task_no,
        title=payload.title.strip(),
        description=payload.description,
        task_type_id=(tt or {}).get("id"),
        task_type_name=(tt or {}).get("name"),
        task_category=payload.task_category or ("payment_followup" if "Payment Follow-up" in payload.title or dues > 0 else "task_followup"),
        chat_participants=participants,
        service_id=payload.service_id,
        service_name=svc_name,
        workflow_stages=wf_stages or stages,
        stages=stages,
        current_stage_id=(first or {}).get("id"),
        current_stage_name=(first or {}).get("name") or (wf_stages[0]["name"] if wf_stages else None),
        stage_history=initial_history,
        sub_tasks=subs,
        voucher_no=payload.voucher_no,
        voucher_date=payload.voucher_date,
        total_amount=total, paid_amount=paid, dues_amount=dues,
        deadline=payload.deadline,
        assignee_id=payload.assignee_id, assignee_name=payload.assignee_name,
        customer_id=payload.customer_id, customer_code=payload.customer_code,
        customer_name=payload.customer_name, customer_mobile=payload.customer_mobile,
        customer_pan=payload.customer_pan, customer_address=payload.customer_address,
        priority=payload.priority,
        created_by=current.user_id, created_by_name=current.name,
    )
    await db.tasks.insert_one(t.dict())
    return t


@api_router.get("/tasks", response_model=List[Task])
async def list_tasks(
    mine: bool = False,
    category: Optional[str] = Query(None),
    current: User = Depends(get_current_user)
):
    q: dict = {}
    if mine or current.role == "employee":
        q = {"$or": [
            {"assignee_id": current.user_id},
            {"created_by": current.user_id},
            {"chat_participants": current.user_id},
        ]}

    docs = await db.tasks.find(q, {"_id": 0}).sort("created_at", -1).to_list(1000)
    out = []
    for d in docs:
        # Normalize category
        cat = d.get("task_category")
        if not cat:
            title = d.get("title") or ""
            dues = float(d.get("dues_amount") or 0)
            if "Payment Follow-up" in title or (dues > 0 and not d.get("service_name")):
                cat = "payment_followup"
            else:
                cat = "task_followup"
            d["task_category"] = cat

        if category and d.get("task_category") != category:
            continue

        out.append(Task(**d))
    return out


@api_router.get("/tasks/{tid}", response_model=Task)
async def get_task(tid: str, current: User = Depends(get_current_user)):
    d = await db.tasks.find_one({"id": tid}, {"_id": 0})
    if not d:
        raise HTTPException(status_code=404, detail="Not found")
    return Task(**d)


@api_router.patch("/tasks/{tid}", response_model=Task)
async def update_task(tid: str, payload: TaskUpdate, current: User = Depends(require_admin_or_manager)):
    updates = {k: v for k, v in payload.dict().items() if v is not None}
    if "sub_tasks" in updates:
        updates["sub_tasks"] = _sub_tasks_with_ids(updates["sub_tasks"])
    # Recompute dues if amounts changed
    if "total_amount" in updates or "paid_amount" in updates:
        cur = await db.tasks.find_one({"id": tid}, {"_id": 0}) or {}
        total = float(updates.get("total_amount", cur.get("total_amount") or 0) or 0)
        paid = float(updates.get("paid_amount", cur.get("paid_amount") or 0) or 0)
        updates["total_amount"] = total
        updates["paid_amount"] = paid
        updates["dues_amount"] = round(total - paid, 2)
    if updates:
        await db.tasks.update_one({"id": tid}, {"$set": updates})
    d = await db.tasks.find_one({"id": tid}, {"_id": 0})
    if not d:
        raise HTTPException(status_code=404, detail="Not found")
    return Task(**d)


@api_router.post("/tasks/{tid}/move-stage", response_model=Task)
async def move_stage(tid: str, payload: MoveStageInput, current: User = Depends(get_current_user)):
    t = await db.tasks.find_one({"id": tid}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Task not found")
    stages = t.get("stages") or []
    stage = next((s for s in stages if s["id"] == payload.stage_id), None)
    if not stage:
        raise HTTPException(status_code=400, detail="Invalid stage for this task")
    history_entry = {
        "stage_id": stage["id"],
        "stage_name": stage["name"],
        "moved_at": now_utc().isoformat(),
        "moved_by": current.user_id,
        "moved_by_name": current.name,
        "assignee_id": payload.assignee_id or t.get("assignee_id"),
        "assignee_name": payload.assignee_name or t.get("assignee_name"),
        "note": payload.note,
    }
    total_stages = len(stages)
    if stage["order"] == 0:
        new_status = "todo"
    elif stage["order"] == total_stages - 1:
        new_status = "done"
    else:
        new_status = "doing"
    updates = {
        "current_stage_id": stage["id"],
        "current_stage_name": stage["name"],
        "status": new_status,
    }
    if payload.assignee_id is not None:
        updates["assignee_id"] = payload.assignee_id
        updates["assignee_name"] = payload.assignee_name
    await db.tasks.update_one({"id": tid}, {"$set": updates, "$push": {"stage_history": history_entry}})
    d = await db.tasks.find_one({"id": tid}, {"_id": 0})
    return Task(**d)


@api_router.post("/tasks/{tid}/stages", response_model=Task)
async def add_stage(tid: str, payload: StageInput, current: User = Depends(get_current_user)):
    t = await db.tasks.find_one({"id": tid}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Task not found")
    stages = list(t.get("stages") or [])
    new_stage = {"id": new_id("stg"), "name": payload.name.strip(), "color": payload.color, "order": len(stages)}
    stages.append(new_stage)
    stages = _order_stages(stages)
    updates: dict = {"stages": stages}
    # If task had no current stage yet, set this as current
    if not t.get("current_stage_id"):
        updates["current_stage_id"] = new_stage["id"]
        updates["current_stage_name"] = new_stage["name"]
    await db.tasks.update_one({"id": tid}, {"$set": updates})
    d = await db.tasks.find_one({"id": tid}, {"_id": 0})
    return Task(**d)


@api_router.patch("/tasks/{tid}/stages/{sid}", response_model=Task)
async def edit_stage(tid: str, sid: str, payload: StagePatch, current: User = Depends(get_current_user)):
    t = await db.tasks.find_one({"id": tid}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Task not found")
    stages = list(t.get("stages") or [])
    updated = False
    for s in stages:
        if s["id"] == sid:
            if payload.name is not None: s["name"] = payload.name.strip()
            if payload.color is not None: s["color"] = payload.color
            if payload.order is not None: s["order"] = int(payload.order)
            updated = True
            break
    if not updated:
        raise HTTPException(status_code=404, detail="Stage not found")
    stages = _order_stages(stages)
    updates: dict = {"stages": stages}
    if t.get("current_stage_id") == sid and payload.name:
        updates["current_stage_name"] = payload.name.strip()
    await db.tasks.update_one({"id": tid}, {"$set": updates})
    d = await db.tasks.find_one({"id": tid}, {"_id": 0})
    return Task(**d)


@api_router.delete("/tasks/{tid}/stages/{sid}", response_model=Task)
async def remove_stage(tid: str, sid: str, current: User = Depends(get_current_user)):
    t = await db.tasks.find_one({"id": tid}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Task not found")
    stages = [s for s in (t.get("stages") or []) if s["id"] != sid]
    stages = _order_stages(stages)
    updates: dict = {"stages": stages}
    if t.get("current_stage_id") == sid:
        first = stages[0] if stages else None
        updates["current_stage_id"] = (first or {}).get("id")
        updates["current_stage_name"] = (first or {}).get("name")
    await db.tasks.update_one({"id": tid}, {"$set": updates})
    d = await db.tasks.find_one({"id": tid}, {"_id": 0})
    return Task(**d)


class BulkDeleteInput(BaseModel):
    ids: List[str] = Field(default_factory=list)


@api_router.post("/tasks/bulk-delete")
async def bulk_delete_tasks(payload: BulkDeleteInput, current: User = Depends(require_admin)):
    ids = [i for i in (payload.ids or []) if i]
    if not ids:
        return {"deleted": 0}
    res = await db.tasks.delete_many({"id": {"$in": ids}})
    return {"deleted": res.deleted_count}


class BulkTaskActionInput(BaseModel):
    ids: List[str] = Field(default_factory=list)
    action: str  # "delete", "move_stage", "assign", "set_priority"
    stage_id: Optional[str] = None
    stage_name: Optional[str] = None
    assignee_id: Optional[str] = None
    assignee_name: Optional[str] = None
    priority: Optional[str] = None


@api_router.post("/tasks/bulk-action")
async def bulk_task_action(payload: BulkTaskActionInput, current: User = Depends(require_admin_or_manager)):
    ids = [i for i in (payload.ids or []) if i]
    if not ids:
        return {"ok": True, "count": 0, "deleted": 0}
    if payload.action == "delete":
        if current.role not in ("admin", "super_admin"):
            raise HTTPException(status_code=403, detail="Admin or Super Admin access required to delete tasks")
        res = await db.tasks.delete_many({"id": {"$in": ids}})
        return {"ok": True, "count": res.deleted_count, "deleted": res.deleted_count}
    elif payload.action == "move_stage":
        stg_id = payload.stage_id
        stg_name = payload.stage_name
        update_doc: Dict[str, Any] = {"updated_at": now_utc()}
        if stg_id:
            update_doc["stage_id"] = stg_id
            update_doc["current_stage_id"] = stg_id
            if stg_id in ("todo", "doing", "done"):
                update_doc["status"] = stg_id
            else:
                update_doc["status"] = "doing"
        if stg_name:
            update_doc["stage_name"] = stg_name
            update_doc["current_stage_name"] = stg_name
        res = await db.tasks.update_many({"id": {"$in": ids}}, {"$set": update_doc})
        return {"ok": True, "count": res.modified_count}
    elif payload.action == "assign":
        res = await db.tasks.update_many(
            {"id": {"$in": ids}},
            {"$set": {
                "assignee_id": payload.assignee_id,
                "assignee_name": payload.assignee_name,
                "updated_at": now_utc()
            }}
        )
        return {"ok": True, "count": res.modified_count}
    elif payload.action == "set_priority":
        p = (payload.priority or "medium").lower()
        if p not in ("urgent", "high", "medium", "low"):
            p = "medium"
        res = await db.tasks.update_many({"id": {"$in": ids}}, {"$set": {"priority": p, "updated_at": now_utc()}})
        return {"ok": True, "count": res.modified_count}
    else:
        raise HTTPException(status_code=400, detail="Invalid bulk action")


@api_router.delete("/tasks/{tid}")
async def delete_task(tid: str, current: User = Depends(require_admin)):
    res = await db.tasks.delete_one({"id": tid})
    return {"deleted": res.deleted_count}


@api_router.post("/tasks/{tid}/attachments", response_model=Task)
async def upload_task_file(tid: str, file: UploadFile = File(...), current: User = Depends(get_current_user)):
    t = await db.tasks.find_one({"id": tid}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Task not found")
    data = await file.read()
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail=f"File exceeds 10 MB limit ({len(data) // 1024} KB)")
    ext = (file.filename or "file").rsplit(".", 1)[-1].lower()
    ext = ext if len(ext) <= 8 else "bin"
    path = f"{APP_NAME}/uploads/{current.user_id}/{uuid.uuid4().hex}.{ext}"
    ct = file.content_type or "application/octet-stream"
    await run_in_threadpool(put_object, path, data, ct)
    attachment = {
        "path": path, "name": file.filename or f"file.{ext}", "size": len(data),
        "content_type": ct, "uploaded_at": now_utc().isoformat(), "uploaded_by": current.user_id,
    }
    await db.tasks.update_one({"id": tid}, {"$push": {"attachments": attachment}})
    d = await db.tasks.find_one({"id": tid}, {"_id": 0})
    return Task(**d)


@api_router.delete("/tasks/{tid}/attachments", response_model=Task)
async def delete_task_attachment(tid: str, path: str, current: User = Depends(get_current_user)):
    t = await db.tasks.find_one({"id": tid}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Task not found")
    await db.tasks.update_one({"id": tid}, {"$pull": {"attachments": {"path": path}}})
    d = await db.tasks.find_one({"id": tid}, {"_id": 0})
    return Task(**d)


# ============ Accounts ============
@api_router.post("/accounts", response_model=AccountEntry)
async def create_account(payload: AccountInput, current: User = Depends(require_admin_or_manager)):
    a = AccountEntry(**payload.dict(), created_by=current.user_id)
    await db.accounts.insert_one(a.dict())
    return a


@api_router.get("/accounts", response_model=List[AccountEntry])
async def list_accounts(current: User = Depends(get_current_user)):
    docs = await db.accounts.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return [AccountEntry(**d) for d in docs]


@api_router.patch("/accounts/{aid}", response_model=AccountEntry)
async def update_account(aid: str, payload: AccountInput, current: User = Depends(require_admin_or_manager)):
    await db.accounts.update_one({"id": aid}, {"$set": payload.dict()})
    d = await db.accounts.find_one({"id": aid}, {"_id": 0})
    if not d:
        raise HTTPException(status_code=404, detail="Not found")
    return AccountEntry(**d)


@api_router.delete("/accounts/{aid}")
async def delete_account(aid: str, current: User = Depends(require_admin)):
    res = await db.accounts.delete_one({"id": aid})
    return {"deleted": res.deleted_count}


# ============ Accounting: Bank Accounts ============
@api_router.get("/bank-accounts", response_model=List[BankAccount])
async def list_bank_accounts(current: User = Depends(get_current_user)):
    docs = await db.bank_accounts.find({}, {"_id": 0}).sort("created_at", 1).to_list(200)
    return [BankAccount(**d) for d in docs]


@api_router.post("/bank-accounts", response_model=BankAccount)
async def create_bank_account(payload: BankAccountInput, current: User = Depends(require_admin_or_manager)):
    b = BankAccount(**payload.dict())
    await db.bank_accounts.insert_one(b.dict())
    return b


@api_router.patch("/bank-accounts/{bid}", response_model=BankAccount)
async def update_bank_account(bid: str, payload: BankAccountInput, current: User = Depends(require_admin_or_manager)):
    await db.bank_accounts.update_one({"id": bid}, {"$set": payload.dict()})
    d = await db.bank_accounts.find_one({"id": bid}, {"_id": 0})
    if not d: raise HTTPException(status_code=404, detail="Not found")
    return BankAccount(**d)


@api_router.delete("/bank-accounts/{bid}")
async def delete_bank_account(bid: str, current: User = Depends(require_admin)):
    res = await db.bank_accounts.delete_one({"id": bid})
    return {"deleted": res.deleted_count}


# ============ Accounting: Income ============
@api_router.get("/accounting/meta")
async def accounting_meta(current: User = Depends(get_current_user)):
    return {
        "income_categories": INCOME_CATEGORIES,
        "expense_categories": EXPENSE_CATEGORIES,
        "payment_modes": PAYMENT_MODES,
    }


async def _next_no(counter_key: str, prefix: str) -> str:
    counter = await db.counters.find_one_and_update(
        {"_id": counter_key}, {"$inc": {"seq": 1}}, upsert=True, return_document=ReturnDocument.AFTER,
    )
    seq = (counter or {}).get("seq") or 1
    return f"{prefix}-{seq:04d}"


async def _peek_next_no(counter_key: str, prefix: str) -> str:
    counter = await db.counters.find_one({"_id": counter_key})
    seq = ((counter or {}).get("seq") or 0) + 1
    return f"{prefix}-{seq:04d}"


def get_indian_financial_year(date_str: Optional[str] = None) -> str:
    """Return Indian Financial Year format like '2026-27' for a given ISO date (Apr 1 - Mar 31)."""
    try:
        if date_str:
            d = datetime.strptime(str(date_str)[:10], "%Y-%m-%d").date()
        else:
            d = datetime.now(timezone.utc).date()
    except Exception:
        d = datetime.now(timezone.utc).date()

    year = d.year
    if d.month >= 4:
        start_yr = year
        end_yr = (year + 1) % 100
    else:
        start_yr = year - 1
        end_yr = year % 100
    return f"{start_yr}-{end_yr:02d}"


VOUCHERS_CONFIG_REGISTRY = {
    "sale_invoice": {
        "title": "Sale Invoice",
        "default_prefix": "TDSC",
        "format": "{prefix}/{fy}/{seq:06d}",
        "counter": "sale_invoice_{fy}",
        "digits": 6,
        "fy_scoped": True,
    },
    "payment_in": {
        "title": "Payment-In",
        "default_prefix": "PAYIN",
        "format": "{prefix}-{seq:04d}",
        "counter": "payment_in_no",
        "digits": 4,
        "fy_scoped": False,
    },
    "sale_return": {
        "title": "Sale Return / Credit Note",
        "default_prefix": "CN",
        "format": "{prefix}-{seq:04d}",
        "counter": "sale_return_no",
        "digits": 4,
        "fy_scoped": False,
    },
    "estimate": {
        "title": "Estimate / Quotation",
        "default_prefix": "TDSC-EST",
        "format": "{prefix}/{fy}/{seq:04d}",
        "counter": "estimate_{fy}",
        "digits": 4,
        "fy_scoped": True,
    },
    "proforma": {
        "title": "Proforma Invoice",
        "default_prefix": "TDSC-PI",
        "format": "{prefix}/{fy}/{seq:04d}",
        "counter": "proforma_{fy}",
        "digits": 4,
        "fy_scoped": True,
    },
    "sale_order": {
        "title": "Sale Order",
        "default_prefix": "TDSC-SO",
        "format": "{prefix}/{fy}/{seq:04d}",
        "counter": "sale_order_{fy}",
        "digits": 4,
        "fy_scoped": True,
    },
    "delivery_challan": {
        "title": "Delivery Challan",
        "default_prefix": "TDSC-DC",
        "format": "{prefix}/{fy}/{seq:04d}",
        "counter": "challan_{fy}",
        "digits": 4,
        "fy_scoped": True,
    },
    "mobile_pos": {
        "title": "Mobile POS",
        "default_prefix": "POS",
        "format": "{prefix}-{seq:04d}",
        "counter": "pos_no",
        "digits": 4,
        "fy_scoped": False,
    },
    "new_expense_approval": {
        "title": "New Expense Approval",
        "default_prefix": "EXP-APP",
        "format": "{prefix}-{year}-{seq:04d}",
        "counter": "expense_req_{year}",
        "digits": 4,
        "fy_scoped": True,
    },
    "expense_approval": {
        "title": "Expense Approval",
        "default_prefix": "EXP-APP",
        "format": "{prefix}/{fy}/{seq:04d}",
        "counter": "expense_app_{fy}",
        "digits": 4,
        "fy_scoped": True,
    },
}


class SaleInvoiceSettingsInput(BaseModel):
    voucher_type: Optional[str] = "sale_invoice"
    voucher_mode: str = "auto"  # "auto" or "manual"
    start_seq: int = 1
    date_start_from: Optional[str] = None
    prefix: Optional[str] = None
    reset_counter_now: Optional[bool] = False


async def _get_voucher_settings(voucher_type: str) -> dict:
    reg = VOUCHERS_CONFIG_REGISTRY.get(voucher_type) or VOUCHERS_CONFIG_REGISTRY["sale_invoice"]
    doc = await db.app_settings.find_one({"_id": f"voucher_settings_{voucher_type}"}, {"_id": 0})
    if not doc and voucher_type == "sale_invoice":
        doc = await db.app_settings.find_one({"_id": "sale_invoice_settings"}, {"_id": 0})
    if not doc:
        return {
            "voucher_type": voucher_type,
            "title": reg["title"],
            "voucher_mode": "auto",
            "start_seq": 1,
            "date_start_from": None,
            "prefix": reg["default_prefix"],
        }
    return {
        "voucher_type": voucher_type,
        "title": reg["title"],
        "voucher_mode": doc.get("voucher_mode", "auto"),
        "start_seq": int(doc.get("start_seq") or 1),
        "date_start_from": doc.get("date_start_from"),
        "prefix": doc.get("prefix") or reg["default_prefix"],
    }


def _extract_year(date_str: Optional[str]) -> str:
    if not date_str:
        return str(datetime.now().year)
    s = str(date_str).strip()
    if len(s) >= 4 and s[:4].isdigit():
        return s[:4]
    if len(s) >= 4 and s[-4:].isdigit():
        return s[-4:]
    return str(datetime.now().year)


def _build_voucher_counter_key(voucher_type: str, date_str: Optional[str] = None) -> str:
    reg = VOUCHERS_CONFIG_REGISTRY.get(voucher_type) or VOUCHERS_CONFIG_REGISTRY["sale_invoice"]
    fy = get_indian_financial_year(date_str)
    year = _extract_year(date_str)
    return reg["counter"].format(fy=fy, year=year)


def _format_voucher_code(voucher_type: str, prefix: str, seq: int, date_str: Optional[str] = None) -> str:
    reg = VOUCHERS_CONFIG_REGISTRY.get(voucher_type) or VOUCHERS_CONFIG_REGISTRY["sale_invoice"]
    fy = get_indian_financial_year(date_str)
    year = _extract_year(date_str)
    return reg["format"].format(prefix=prefix, fy=fy, year=year, seq=seq)


async def _next_voucher_no(voucher_type: str, date_str: Optional[str] = None) -> str:
    settings = await _get_voucher_settings(voucher_type)
    prefix = settings.get("prefix") or VOUCHERS_CONFIG_REGISTRY.get(voucher_type, {}).get("default_prefix", "TDSC")
    start_seq = max(1, int(settings.get("start_seq") or 1))
    counter_key = _build_voucher_counter_key(voucher_type, date_str)

    counter = await db.counters.find_one({"_id": counter_key})
    if counter is None:
        base_seq = start_seq - 1
        await db.counters.update_one({"_id": counter_key}, {"$set": {"seq": base_seq}}, upsert=True)

    res = await db.counters.find_one_and_update(
        {"_id": counter_key},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=ReturnDocument.AFTER
    )
    seq = (res or {}).get("seq") or start_seq
    if seq < start_seq:
        seq = start_seq
        await db.counters.update_one({"_id": counter_key}, {"$set": {"seq": seq}})
    return _format_voucher_code(voucher_type, prefix, seq, date_str)


async def _peek_next_voucher_no(voucher_type: str, date_str: Optional[str] = None) -> str:
    settings = await _get_voucher_settings(voucher_type)
    prefix = settings.get("prefix") or VOUCHERS_CONFIG_REGISTRY.get(voucher_type, {}).get("default_prefix", "TDSC")
    start_seq = max(1, int(settings.get("start_seq") or 1))
    counter_key = _build_voucher_counter_key(voucher_type, date_str)

    counter = await db.counters.find_one({"_id": counter_key})
    if counter is None:
        seq = start_seq
    else:
        current_seq = int(counter.get("seq") or 0)
        seq = max(current_seq + 1, start_seq)
    return _format_voucher_code(voucher_type, prefix, seq, date_str)


async def _get_sale_invoice_settings() -> dict:
    return await _get_voucher_settings("sale_invoice")


async def _next_sale_invoice_no(date_str: Optional[str] = None) -> str:
    return await _next_voucher_no("sale_invoice", date_str)


async def _peek_next_sale_invoice_no(date_str: Optional[str] = None) -> str:
    return await _peek_next_voucher_no("sale_invoice", date_str)



@api_router.get("/settings/vouchers")
async def get_all_voucher_settings_api(current: User = Depends(get_current_user)):
    """Get settings, preview numbers, and current sequences for all 10 voucher types."""
    result = []
    for v_key, reg in VOUCHERS_CONFIG_REGISTRY.items():
        s = await _get_voucher_settings(v_key)
        effective_date = s.get("date_start_from")
        counter_key = _build_voucher_counter_key(v_key, effective_date)
        counter_doc = await db.counters.find_one({"_id": counter_key})
        curr_seq = (counter_doc or {}).get("seq", 0)
        next_no = await _peek_next_voucher_no(v_key, effective_date)
        fy = get_indian_financial_year(effective_date)
        result.append({
            **s,
            "title": reg["title"],
            "current_seq": curr_seq,
            "next_no": next_no,
            "financial_year": fy,
            "counter_key": counter_key,
        })
    return result


@api_router.get("/settings/voucher/{voucher_type}")
async def get_single_voucher_setting_api(voucher_type: str, current: User = Depends(get_current_user)):
    if voucher_type not in VOUCHERS_CONFIG_REGISTRY:
        raise HTTPException(status_code=404, detail=f"Unknown voucher type: {voucher_type}")
    reg = VOUCHERS_CONFIG_REGISTRY[voucher_type]
    s = await _get_voucher_settings(voucher_type)
    effective_date = s.get("date_start_from")
    counter_key = _build_voucher_counter_key(voucher_type, effective_date)
    counter_doc = await db.counters.find_one({"_id": counter_key})
    curr_seq = (counter_doc or {}).get("seq", 0)
    next_no = await _peek_next_voucher_no(voucher_type, effective_date)
    fy = get_indian_financial_year(effective_date)
    return {
        **s,
        "title": reg["title"],
        "current_seq": curr_seq,
        "next_no": next_no,
        "financial_year": fy,
        "counter_key": counter_key,
    }


@api_router.put("/settings/voucher/{voucher_type}")
async def update_single_voucher_setting_api(
    voucher_type: str,
    payload: SaleInvoiceSettingsInput,
    current: User = Depends(require_admin)
):
    if voucher_type not in VOUCHERS_CONFIG_REGISTRY:
        raise HTTPException(status_code=404, detail=f"Unknown voucher type: {voucher_type}")
    reg = VOUCHERS_CONFIG_REGISTRY[voucher_type]
    start_seq = max(1, int(payload.start_seq or 1))
    clean_date = payload.date_start_from.strip() if payload.date_start_from else None
    clean_prefix = (payload.prefix or reg["default_prefix"]).strip().upper()

    doc = {
        "voucher_type": voucher_type,
        "voucher_mode": "manual" if payload.voucher_mode == "manual" else "auto",
        "start_seq": start_seq,
        "date_start_from": clean_date,
        "prefix": clean_prefix,
        "updated_at": now_utc().isoformat(),
        "updated_by": current.user_id,
    }

    await db.app_settings.update_one(
        {"_id": f"voucher_settings_{voucher_type}"},
        {"$set": doc},
        upsert=True
    )
    if voucher_type == "sale_invoice":
        await db.app_settings.update_one(
            {"_id": "sale_invoice_settings"},
            {"$set": doc},
            upsert=True
        )

    counter_key = _build_voucher_counter_key(voucher_type, clean_date)
    if payload.reset_counter_now:
        reset_val = max(0, start_seq - 1)
        await db.counters.update_one(
            {"_id": counter_key},
            {"$set": {"seq": reset_val}},
            upsert=True
        )

    counter_doc = await db.counters.find_one({"_id": counter_key})
    curr_seq = (counter_doc or {}).get("seq", 0)
    next_no = await _peek_next_voucher_no(voucher_type, clean_date)
    fy = get_indian_financial_year(clean_date)

    return {
        **doc,
        "title": reg["title"],
        "current_seq": curr_seq,
        "next_no": next_no,
        "financial_year": fy,
        "counter_key": counter_key,
        "message": f"{reg['title']} voucher settings updated successfully",
    }


@api_router.get("/settings/sale-invoice")
async def get_sale_invoice_settings_api(current: User = Depends(get_current_user)):
    return await get_single_voucher_setting_api("sale_invoice", current)


@api_router.put("/settings/sale-invoice")
async def update_sale_invoice_settings_api(
    payload: SaleInvoiceSettingsInput,
    current: User = Depends(require_admin)
):
    return await update_single_voucher_setting_api("sale_invoice", payload, current)


@api_router.get("/vouchers/next-no")
async def get_generic_voucher_next_no(
    voucher_type: str = Query("sale_invoice"),
    date: Optional[str] = Query(None),
    current: User = Depends(get_current_user)
):
    if voucher_type not in VOUCHERS_CONFIG_REGISTRY:
        raise HTTPException(status_code=404, detail="Unknown voucher type")
    s = await _get_voucher_settings(voucher_type)
    effective_date = date or s.get("date_start_from")
    next_no = await _peek_next_voucher_no(voucher_type, effective_date)
    fy = get_indian_financial_year(effective_date)
    return {
        "voucher_type": voucher_type,
        "next_no": next_no,
        "voucher_mode": s.get("voucher_mode", "auto"),
        "start_seq": s.get("start_seq", 1),
        "date_start_from": s.get("date_start_from"),
        "prefix": s.get("prefix"),
        "financial_year": fy,
    }


@api_router.get("/invoices/next-no")
async def get_next_invoice_no(
    invoice_type: str = Query("sale"),
    date: Optional[str] = Query(None),
    current: User = Depends(get_current_user)
):
    if invoice_type == "sale":
        s = await _get_voucher_settings("sale_invoice")
        effective_date = date or s.get("date_start_from")
        next_no = await _peek_next_voucher_no("sale_invoice", effective_date)
        fy = get_indian_financial_year(effective_date)
        return {
            "next_no": next_no,
            "invoice_type": "sale",
            "financial_year": fy,
            "voucher_mode": s.get("voucher_mode", "auto"),
            "start_seq": s.get("start_seq", 1),
            "date_start_from": s.get("date_start_from"),
            "prefix": s.get("prefix", "TDSC"),
        }
    elif invoice_type == "sale_return":
        s = await _get_voucher_settings("sale_return")
        effective_date = date or s.get("date_start_from")
        next_no = await _peek_next_voucher_no("sale_return", effective_date)
        return {
            "next_no": next_no,
            "invoice_type": "sale_return",
            "voucher_mode": s.get("voucher_mode", "auto"),
            "start_seq": s.get("start_seq", 1),
            "date_start_from": s.get("date_start_from"),
            "prefix": s.get("prefix", "CN"),
        }
    elif invoice_type in ["pos", "mobile_pos"]:
        s = await _get_voucher_settings("mobile_pos")
        effective_date = date or s.get("date_start_from")
        next_no = await _peek_next_voucher_no("mobile_pos", effective_date)
        return {
            "next_no": next_no,
            "invoice_type": "pos",
            "voucher_mode": s.get("voucher_mode", "auto"),
            "start_seq": s.get("start_seq", 1),
            "date_start_from": s.get("date_start_from"),
            "prefix": s.get("prefix", "POS"),
        }
    elif invoice_type == "purchase_return":
        counter = await db.counters.find_one({"_id": "purchase_return_no"})
        seq = ((counter or {}).get("seq") or 0) + 1
        return {"next_no": f"DN-{seq:04d}", "invoice_type": "purchase_return"}
    else:
        counter = await db.counters.find_one({"_id": "purchase_bill_no"})
        seq = ((counter or {}).get("seq") or 0) + 1
        return {"next_no": f"PB-{seq:04d}", "invoice_type": "purchase"}



@api_router.get("/income/next-no")
async def get_next_payment_in_no(
    date: Optional[str] = Query(None),
    current: User = Depends(get_current_user)
):
    s = await _get_voucher_settings("payment_in")
    effective_date = date or s.get("date_start_from")
    next_no = await _peek_next_voucher_no("payment_in", effective_date)
    return {
        "next_no": next_no,
        "voucher_mode": s.get("voucher_mode", "auto"),
        "start_seq": s.get("start_seq", 1),
        "date_start_from": s.get("date_start_from"),
        "prefix": s.get("prefix", "PAYIN"),
    }


@api_router.post("/income", response_model=Income)
async def create_income(payload: IncomeInput, current: User = Depends(get_current_user)):
    settings = await _get_voucher_settings("payment_in")
    no = (payload.voucher_no or "").strip()
    if not no or "preview" in no.lower() or no == "PAYIN-0000":
        no = await _next_voucher_no("payment_in", payload.date)
    else:
        prefix = settings.get("prefix") or "PAYIN"
        if no.startswith(f"{prefix}-"):
            try:
                val = int(no.split("-")[1])
                await db.counters.update_one(
                    {"_id": "payment_in_no"},
                    {"$max": {"seq": val}},
                    upsert=True
                )
            except Exception:
                pass

    inc_dict = payload.dict()
    inc_dict.pop("voucher_no", None)
    inc_dict.pop("income_no", None)

    # Process multi-mode payment splits if provided
    if payload.payment_splits:
        running_tot = 0.0
        for ps in payload.payment_splits:
            p_amt = float(ps.get("amount") or 0)
            if p_amt > 0:
                running_tot = round(running_tot + p_amt, 2)
        if running_tot > 0:
            inc_dict["amount"] = running_tot
        distinct_modes = list(dict.fromkeys(
            str(ps.get("mode") or ps.get("payment_mode") or "cash").lower()
            for ps in payload.payment_splits if float(ps.get("amount") or 0) > 0
        ))
        if distinct_modes:
            inc_dict["payment_mode"] = ", ".join(distinct_modes)

    # Auto-fill customer details if client_id is present
    if payload.client_id:
        cust = await db.customers.find_one({"id": payload.client_id}, {"_id": 0})
        if cust:
            inc_dict["client_name"] = inc_dict.get("client_name") or cust.get("name")
            inc_dict["client_mobile"] = inc_dict.get("client_mobile") or cust.get("mobile")
            inc_dict["client_pan"] = inc_dict.get("client_pan") or cust.get("pan")
            inc_dict["client_gst"] = inc_dict.get("client_gst") or cust.get("gst_no")
            inc_dict["client_code"] = inc_dict.get("client_code") or cust.get("customer_code")

    inc = Income(
        **inc_dict,
        income_no=no,
        voucher_no=no,
        created_by=current.user_id,
        created_by_name=current.name,
    )
    await db.income.insert_one(inc.dict())

    # Auto-allocate unlinked Payment-In to customer's unpaid / partial sale invoices (FIFO basis)
    allocated_vouchers = list(payload.linked_vouchers or [])
    if not allocated_vouchers and float(payload.amount or 0.0) > 0 and (payload.client_id or payload.client_name):
        cid = payload.client_id
        cname = payload.client_name
        match_or = []
        if cid: match_or.append({"party_id": cid})
        if cname: match_or.append({"party_name": cname})
        
        open_invoices = await db.invoices.find(
            {
                "invoice_type": {"$in": ["sale", None]},
                "$or": match_or,
                "balance": {"$gt": 0}
            },
            {"_id": 0}
        ).sort([("date", 1), ("created_at", 1)]).to_list(50)
        
        rem_alloc = float(payload.amount or 0.0)
        for sinv in open_invoices:
            if rem_alloc <= 0: break
            sinv_bal = float(sinv.get("balance") or 0.0)
            if sinv_bal <= 0: continue
            alloc_amt = min(sinv_bal, rem_alloc)
            allocated_vouchers.append({
                "voucher_id": sinv["id"],
                "voucher_no": sinv.get("invoice_no"),
                "voucher_date": sinv.get("date"),
                "total_amount": sinv.get("total_amount"),
                "previous_paid": sinv.get("paid_amount"),
                "outstanding_balance": sinv_bal,
                "allocated_amount": alloc_amt,
                "payment_mode": payload.payment_mode or "cash",
                "payment_type": f"Payment-In ({payload.service_name or 'Receipt'})",
                "remarks": payload.remarks or f"Payment-In {no}",
            })
            rem_alloc = round(rem_alloc - alloc_amt, 2)
        
        if allocated_vouchers:
            await db.income.update_one(
                {"id": inc.id},
                {"$set": {
                    "linked_vouchers": allocated_vouchers,
                    "linked_voucher_no": allocated_vouchers[0].get("voucher_no")
                }}
            )
            inc.linked_vouchers = allocated_vouchers
            inc.linked_voucher_no = allocated_vouchers[0].get("voucher_no")

    # Update linked sale vouchers and record payment history
    for lv in allocated_vouchers:
        vid = lv.get("voucher_id") or lv.get("id")
        alloc = float(lv.get("allocated_amount") or 0.0)
        if not vid or alloc <= 0:
            continue
        sinv = await db.invoices.find_one({"id": vid})
        if not sinv:
            continue

        cur_paid = float(sinv.get("paid_amount") or 0.0)
        tot_amt = float(sinv.get("total_amount") or 0.0)
        new_paid = round(cur_paid + alloc, 2)
        new_bal = max(0.0, round(tot_amt - new_paid, 2))
        new_status = "paid" if new_bal <= 0 and tot_amt > 0 else "partial"

        payment_record = {
            "payment_id": inc.id,
            "payment_no": no,
            "date": payload.date,
            "amount": alloc,
            "payment_mode": lv.get("payment_mode") or payload.payment_mode or "cash",
            "payment_type": lv.get("payment_type") or f"Payment-In ({payload.service_name or 'Receipt'})",
            "remarks": lv.get("remarks") or payload.remarks or f"Payment-In {no}",
            "created_at": now_utc().isoformat(),
            "balance_after": new_bal,
        }

        existing_payments = list(sinv.get("payments") or [])
        if cur_paid > 0 and len(existing_payments) == 0:
            existing_payments.append({
                "payment_id": f"init_{sinv.get('id')}",
                "payment_no": f"INITIAL-{sinv.get('invoice_no')}",
                "date": sinv.get("date") or "Initial",
                "amount": cur_paid,
                "payment_mode": sinv.get("payment_mode") or "cash",
                "payment_type": "Initial / Down Payment",
                "remarks": "Payment received at invoice generation",
                "created_at": str(sinv.get("created_at") or now_utc().isoformat()),
                "balance_after": max(0.0, round(tot_amt - cur_paid, 2)),
            })

        if not any(p.get("payment_id") == inc.id or p.get("payment_no") == no for p in existing_payments):
            existing_payments.append(payment_record)

        try:
            existing_payments.sort(key=lambda x: str(x.get("date") or "9999-99-99"))
        except Exception:
            pass

        await db.invoices.update_one(
            {"id": sinv["id"]},
            {
                "$set": {
                    "paid_amount": new_paid,
                    "balance": new_bal,
                    "status": new_status,
                    "payments": existing_payments,
                }
            }
        )

    return inc


@api_router.get("/income", response_model=List[Income])
async def list_income(
    client_id: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    search: Optional[str] = None,
    current: User = Depends(get_current_user)
):
    q: dict = {}
    if client_id: q["client_id"] = client_id
    if from_date or to_date:
        q["date"] = {}
        if from_date: q["date"]["$gte"] = from_date
        if to_date: q["date"]["$lte"] = to_date

    if search:
        s = re.escape(search.strip())
        matching_custs = await db.customers.find({
            "$or": [
                {"name": {"$regex": s, "$options": "i"}},
                {"mobile": {"$regex": s, "$options": "i"}},
                {"pan": {"$regex": s, "$options": "i"}},
                {"gst_no": {"$regex": s, "$options": "i"}},
                {"customer_code": {"$regex": s, "$options": "i"}},
            ]
        }, {"_id": 0, "id": 1}).to_list(500)
        matching_cust_ids = [c["id"] for c in matching_custs if "id" in c]

        or_conds = [
            {"voucher_no": {"$regex": s, "$options": "i"}},
            {"income_no": {"$regex": s, "$options": "i"}},
            {"client_name": {"$regex": s, "$options": "i"}},
            {"client_mobile": {"$regex": s, "$options": "i"}},
            {"client_pan": {"$regex": s, "$options": "i"}},
            {"client_gst": {"$regex": s, "$options": "i"}},
            {"client_code": {"$regex": s, "$options": "i"}},
            {"service_category": {"$regex": s, "$options": "i"}},
            {"service_name": {"$regex": s, "$options": "i"}},
            {"employee_name": {"$regex": s, "$options": "i"}},
            {"remarks": {"$regex": s, "$options": "i"}},
            {"payment_mode": {"$regex": s, "$options": "i"}},
            {"linked_vouchers.voucher_no": {"$regex": s, "$options": "i"}},
            {"items.item": {"$regex": s, "$options": "i"}},
        ]
        if matching_cust_ids:
            or_conds.append({"client_id": {"$in": matching_cust_ids}})

        q["$or"] = or_conds

    docs = await db.income.find(q, {"_id": 0}).sort("date", -1).to_list(1000)

    # Dynamic customer enrichment if missing on older income documents
    cust_ids = [d.get("client_id") for d in docs if d.get("client_id") and (not d.get("client_pan") or not d.get("client_gst") or not d.get("client_mobile"))]
    if cust_ids:
        custs = await db.customers.find({"id": {"$in": list(set(cust_ids))}}, {"_id": 0, "id": 1, "name": 1, "mobile": 1, "pan": 1, "gst_no": 1, "customer_code": 1}).to_list(1000)
        cmap = {c["id"]: c for c in custs}
        for d in docs:
            cid = d.get("client_id")
            if cid and cid in cmap:
                c = cmap[cid]
                if not d.get("client_mobile"): d["client_mobile"] = c.get("mobile")
                if not d.get("client_pan"): d["client_pan"] = c.get("pan")
                if not d.get("client_gst"): d["client_gst"] = c.get("gst_no")
                if not d.get("client_code"): d["client_code"] = c.get("customer_code")

    return [Income(**d) for d in docs]


@api_router.get("/income/{iid}", response_model=Income)
async def get_income(iid: str, current: User = Depends(get_current_user)):
    d = await db.income.find_one({"id": iid}, {"_id": 0})
    if not d: raise HTTPException(status_code=404, detail="Not found")
    cid = d.get("client_id")
    if cid and (not d.get("client_pan") or not d.get("client_gst") or not d.get("client_mobile")):
        cust = await db.customers.find_one({"id": cid}, {"_id": 0})
        if cust:
            d["client_mobile"] = d.get("client_mobile") or cust.get("mobile")
            d["client_pan"] = d.get("client_pan") or cust.get("pan")
            d["client_gst"] = d.get("client_gst") or cust.get("gst_no")
            d["client_code"] = d.get("client_code") or cust.get("customer_code")
    return Income(**d)


@api_router.patch("/income/{iid}", response_model=Income)
async def update_income(iid: str, payload: IncomeUpdateInput, current: User = Depends(get_current_user)):
    existing = await db.income.find_one({"id": iid}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Payment-In voucher not found")

    upd = {k: v for k, v in payload.dict().items() if v is not None}

    if payload.payment_splits is not None:
        running_tot = 0.0
        for ps in payload.payment_splits:
            p_amt = float(ps.get("amount") or 0)
            if p_amt > 0:
                running_tot = round(running_tot + p_amt, 2)
        if running_tot > 0:
            upd["amount"] = running_tot
        distinct_modes = list(dict.fromkeys(
            str(ps.get("mode") or ps.get("payment_mode") or "cash").lower()
            for ps in payload.payment_splits if float(ps.get("amount") or 0) > 0
        ))
        if distinct_modes:
            upd["payment_mode"] = ", ".join(distinct_modes)

    cid = upd.get("client_id") or existing.get("client_id")
    if cid:
        cust = await db.customers.find_one({"id": cid}, {"_id": 0})
        if cust:
            if not upd.get("client_name"): upd["client_name"] = cust.get("name")
            if not upd.get("client_mobile"): upd["client_mobile"] = cust.get("mobile")
            if not upd.get("client_pan"): upd["client_pan"] = cust.get("pan")
            if not upd.get("client_gst"): upd["client_gst"] = cust.get("gst_no")
            if not upd.get("client_code"): upd["client_code"] = cust.get("customer_code")

    upd["updated_at"] = now_utc()
    upd["updated_by"] = current.user_id

    await db.income.update_one({"id": iid}, {"$set": upd})
    d = await db.income.find_one({"id": iid}, {"_id": 0})
    return Income(**d)


@api_router.get("/income/{iid}/pdf")
async def get_income_pdf(iid: str, token: Optional[str] = None, authorization: Optional[str] = Header(default=None)):
    tk = None
    if authorization and authorization.startswith("Bearer "):
        tk = authorization[7:]
    elif token:
        tk = token
    if not tk:
        raise HTTPException(status_code=401, detail="Auth required")
    session = await db.user_sessions.find_one({"session_token": tk}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=401, detail="Invalid session")

    inc = await db.income.find_one({"id": iid}, {"_id": 0})
    if not inc:
        raise HTTPException(status_code=404, detail="Payment-In voucher not found")

    cust = await db.customers.find_one({"id": inc.get("client_id")}, {"_id": 0}) if inc.get("client_id") else None
    pdf_bytes = await run_in_threadpool(build_payment_in_pdf, inc, cust)
    fname = f"{(inc.get('voucher_no') or inc.get('income_no') or 'receipt')}_{(inc.get('date') or '').replace('-','')}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{fname}"'}
    )


@api_router.delete("/income/{iid}")
async def delete_income(iid: str, current: User = Depends(require_admin_or_manager)):
    res = await db.income.delete_one({"id": iid})
    return {"deleted": res.deleted_count}


# ============ Passed On Money (EMD, Cost of BOQ, Tender Fee, etc.) ============
DEFAULT_PASSED_ON_ITEMS = [
    {
        "name": "EMD",
        "fee_type": "EMD",
        "unit": "LOT",
        "default_amount": 0.0,
        "tax_rate": 0.0,
        "description": "Earnest Money Deposit (EMD for Tenders)",
        "is_system": True,
    },
    {
        "name": "Cost of BOQ",
        "fee_type": "Cost of BOQ",
        "unit": "LOT",
        "default_amount": 0.0,
        "tax_rate": 0.0,
        "description": "Cost of BOQ / Tender Document Fee",
        "is_system": True,
    },
    {
        "name": "Tender Processing Fee",
        "fee_type": "Tender Processing Fee",
        "unit": "LOT",
        "default_amount": 0.0,
        "tax_rate": 0.0,
        "description": "Tender Portal e-Processing Fee",
        "is_system": True,
    },
    {
        "name": "Registration Fee",
        "fee_type": "Registration Fee",
        "unit": "LOT",
        "default_amount": 0.0,
        "tax_rate": 0.0,
        "description": "Department / Portal Contractor Registration Fee",
        "is_system": True,
    },
    {
        "name": "Other Fee",
        "fee_type": "Other Fee",
        "unit": "LOT",
        "default_amount": 0.0,
        "tax_rate": 0.0,
        "description": "Other Passed On Reimbursement / Pass-through Fee",
        "is_system": True,
    },
]
DEFAULT_PASSED_ON_FEE_NAMES = [x["name"] for x in DEFAULT_PASSED_ON_ITEMS]


@api_router.get("/passed-on-items", response_model=List[PassedOnItem])
async def list_passed_on_items(current: User = Depends(get_current_user)):
    count = await db.passed_on_items.count_documents({})
    if count == 0:
        for seed in DEFAULT_PASSED_ON_ITEMS:
            item = PassedOnItem(**seed)
            await db.passed_on_items.insert_one(item.dict())
    docs = await db.passed_on_items.find({}, {"_id": 0}).sort("created_at", 1).to_list(200)
    return [PassedOnItem(**d) for d in docs]


@api_router.post("/passed-on-items", response_model=PassedOnItem)
async def create_passed_on_item(payload: PassedOnItemInput, current: User = Depends(require_admin_or_manager)):
    name_clean = payload.name.strip()
    if not name_clean:
        raise HTTPException(status_code=400, detail="Fee item name is required")
    ex = await db.passed_on_items.find_one({"name": {"$regex": f"^{re.escape(name_clean)}$", "$options": "i"}})
    if ex:
        raise HTTPException(status_code=400, detail="Fee item with this name already exists")
    data = payload.dict()
    data["name"] = name_clean
    data["is_system"] = False
    data["created_by"] = current.user_id
    it = PassedOnItem(**data)
    await db.passed_on_items.insert_one(it.dict())
    return it


@api_router.patch("/passed-on-items/{poi_id}", response_model=PassedOnItem)
async def update_passed_on_item(poi_id: str, payload: PassedOnItemUpdate, current: User = Depends(require_admin_or_manager)):
    it = await db.passed_on_items.find_one({"id": poi_id}, {"_id": 0})
    if not it:
        raise HTTPException(status_code=404, detail="Passed on item not found")
    data = {k: v for k, v in payload.dict().items() if v is not None}
    if "name" in data:
        data["name"] = data["name"].strip()
    if data:
        await db.passed_on_items.update_one({"id": poi_id}, {"$set": data})
    d = await db.passed_on_items.find_one({"id": poi_id}, {"_id": 0})
    return PassedOnItem(**d)


@api_router.delete("/passed-on-items/{poi_id}")
async def delete_passed_on_item(poi_id: str, current: User = Depends(require_admin_or_manager)):
    it = await db.passed_on_items.find_one({"id": poi_id}, {"_id": 0})
    if not it:
        raise HTTPException(status_code=404, detail="Passed on item not found")
    res = await db.passed_on_items.delete_one({"id": poi_id})
    return {"deleted": res.deleted_count}


@api_router.get("/invoices/{iid}/passed-on-items")
async def get_invoice_passed_on_items(iid: str, current: User = Depends(get_current_user)):
    inv = await db.invoices.find_one({"id": iid}, {"_id": 0})
    if not inv:
        raise HTTPException(status_code=404, detail="Sale invoice not found")

    passed_items = []
    for it in inv.get("items", []):
        name = it.get("name", "").strip()
        itype = it.get("item_type")
        is_pass_on = (itype == "passed_on_money") or (name.lower() in [f.lower() for f in DEFAULT_PASSED_ON_FEE_NAMES])
        if is_pass_on:
            line_total = float(it.get("amount") or (float(it.get("qty", 1)) * float(it.get("price", 0))))
            prior_exp = await db.expenses.find({
                "sale_invoice_id": iid,
                "$or": [
                    {"sale_item_name": name},
                    {"sale_item_names": name},
                    {"selected_items.name": name}
                ],
                "status": {"$ne": "rejected"}
            }, {"_id": 0, "amount": 1, "expense_no": 1, "date": 1, "status": 1, "sale_item_name": 1, "selected_items": 1}).to_list(100)
            already_spent = 0.0
            for x in prior_exp:
                sel = x.get("selected_items")
                if sel and isinstance(sel, list):
                    found_sel = False
                    for s in sel:
                        if s.get("name", "").strip().lower() == name.lower():
                            already_spent += float(s.get("allocated_amount") or s.get("amount") or 0)
                            found_sel = True
                    if not found_sel and x.get("sale_item_name") == name:
                        already_spent += float(x.get("amount") or 0)
                elif x.get("sale_item_name") == name:
                    already_spent += float(x.get("amount") or 0)
            already_spent = round(already_spent, 2)
            remaining = round(max(0.0, line_total - already_spent), 2)
            passed_items.append({
                "item_id": it.get("item_id"),
                "name": name,
                "fee_type": it.get("fee_type") or name,
                "unit": it.get("unit") or "LOT",
                "qty": it.get("qty", 1),
                "price": it.get("price", 0),
                "billed_amount": line_total,
                "already_spent": already_spent,
                "remaining_balance": remaining,
                "expense_history": prior_exp,
            })
    return {
        "invoice_id": iid,
        "invoice_no": inv.get("invoice_no"),
        "date": inv.get("date"),
        "party_id": inv.get("party_id"),
        "party_name": inv.get("party_name"),
        "party_mobile": inv.get("party_mobile"),
        "total_amount": inv.get("total_amount"),
        "passed_on_items": passed_items,
    }


# ============ Accounting: Expense ============
@api_router.post("/expenses", response_model=Expense)
async def create_expense(payload: ExpenseInput, current: User = Depends(get_current_user)):
    no = await _next_no("expense_no", "EXP")
    exp_dict = payload.dict()
    exp_dict["expense_no"] = no
    exp_dict["created_by"] = current.user_id
    exp_dict["created_by_name"] = current.name
    selected_items_breakdown = []

    # Auto-fill customer details if customer_id is provided
    if payload.customer_id and not payload.sale_invoice_id:
        cust = await db.customers.find_one({"id": payload.customer_id}, {"_id": 0})
        if cust:
            exp_dict["customer_name"] = exp_dict.get("customer_name") or cust.get("name")
            exp_dict["customer_mobile"] = exp_dict.get("customer_mobile") or cust.get("mobile")
            exp_dict["customer_pan"] = exp_dict.get("customer_pan") or cust.get("pan")
            exp_dict["customer_gst"] = exp_dict.get("customer_gst") or cust.get("gst_no")
            exp_dict["customer_code"] = exp_dict.get("customer_code") or cust.get("customer_code")

    # If linked to a Sale Invoice, perform strict pass-on item balance validation
    if payload.sale_invoice_id:
        inv = await db.invoices.find_one({"id": payload.sale_invoice_id}, {"_id": 0})
        if not inv:
            raise HTTPException(status_code=404, detail="Selected Sale Voucher not found")

        # Auto-fill customer details from invoice if missing
        customer_id = payload.customer_id or inv.get("party_id")
        customer_name = payload.customer_name or inv.get("party_name")
        customer_mobile = payload.customer_mobile or inv.get("party_mobile")
        customer_pan = payload.customer_pan or inv.get("party_pan")
        customer_gst = payload.customer_gst or inv.get("party_gst")
        customer_code = payload.customer_code or inv.get("party_code")
        if customer_id and (not customer_pan or not customer_gst):
            cust = await db.customers.find_one({"id": customer_id}, {"_id": 0})
            if cust:
                customer_mobile = customer_mobile or cust.get("mobile")
                customer_pan = customer_pan or cust.get("pan")
                customer_gst = customer_gst or cust.get("gst_no")
                customer_code = customer_code or cust.get("customer_code")

        exp_dict["customer_id"] = customer_id
        exp_dict["customer_name"] = customer_name
        exp_dict["customer_mobile"] = customer_mobile
        exp_dict["customer_pan"] = customer_pan
        exp_dict["customer_gst"] = customer_gst
        exp_dict["customer_code"] = customer_code
        exp_dict["sale_invoice_no"] = inv.get("invoice_no")
        exp_dict["sale_invoice_date"] = inv.get("date")

        # Multi-select or single select Passed On Money items
        target_item_names = []
        if payload.sale_item_names and isinstance(payload.sale_item_names, list):
            target_item_names = [n.strip() for n in payload.sale_item_names if n and n.strip()]
        elif payload.sale_item_name:
            target_item_names = [n.strip() for n in payload.sale_item_name.split(",") if n and n.strip()]

        if not target_item_names:
            raise HTTPException(
                status_code=400,
                detail="Please select at least one Passed On Money item from the voucher"
            )

        matched_items = []
        for target_name in target_item_names:
            found = None
            for it in inv.get("items", []):
                if it.get("name", "").strip().lower() == target_name.lower():
                    found = it
                    break
            if not found:
                raise HTTPException(
                    status_code=400,
                    detail=f"Item '{target_name}' was not found in Sale Voucher {inv.get('invoice_no')}"
                )
            name = found.get("name", "").strip()
            itype = found.get("item_type")
            is_pass_on = (itype == "passed_on_money") or (name.lower() in [f.lower() for f in DEFAULT_PASSED_ON_FEE_NAMES])
            if not is_pass_on:
                raise HTTPException(
                    status_code=400,
                    detail=f"'{name}' is an Actual Service item, not a Passed On Money item. Expenses can only be booked against Passed On Money items."
                )
            matched_items.append(found)

        items_detail = []
        total_received = 0.0
        total_spent = 0.0
        total_remaining_balance = 0.0

        for sale_item in matched_items:
            name = sale_item.get("name", "").strip()
            line_total = float(sale_item.get("amount") or (float(sale_item.get("qty", 1)) * float(sale_item.get("price", 0))))
            prior_expenses = await db.expenses.find({
                "sale_invoice_id": payload.sale_invoice_id,
                "$or": [
                    {"sale_item_name": name},
                    {"sale_item_names": name},
                    {"selected_items.name": name}
                ],
                "status": {"$ne": "rejected"},
            }, {"_id": 0, "amount": 1, "sale_item_name": 1, "selected_items": 1}).to_list(500)

            item_already_spent = 0.0
            for pe in prior_expenses:
                sel = pe.get("selected_items")
                if sel and isinstance(sel, list):
                    found_sel = False
                    for s in sel:
                        if s.get("name", "").strip().lower() == name.lower():
                            item_already_spent += float(s.get("allocated_amount") or s.get("amount") or 0)
                            found_sel = True
                    if not found_sel and pe.get("sale_item_name") == name:
                        item_already_spent += float(pe.get("amount") or 0)
                elif pe.get("sale_item_name") == name:
                    item_already_spent += float(pe.get("amount") or 0)

            item_already_spent = round(item_already_spent, 2)
            rem = round(max(0.0, line_total - item_already_spent), 2)
            items_detail.append({
                "name": name,
                "fee_type": sale_item.get("fee_type") or name,
                "line_total": line_total,
                "already_spent": item_already_spent,
                "remaining_balance": rem,
            })
            total_received += line_total
            total_spent += item_already_spent
            total_remaining_balance += rem

        total_received = round(total_received, 2)
        total_spent = round(total_spent, 2)
        total_remaining_balance = round(total_remaining_balance, 2)

        if round(payload.amount, 2) > total_remaining_balance:
            raise HTTPException(
                status_code=400,
                detail=f"Expense amount ₹{payload.amount:,.2f} exceeds available combined Passed On Money balance ₹{total_remaining_balance:,.2f} for selected items ({', '.join(target_item_names)}). (Total Received: ₹{total_received:,.2f}, Already Spent: ₹{total_spent:,.2f})"
            )

        # Check if user specified individual itemwise spent amounts in payload.selected_items
        user_spent_map = {}
        if payload.selected_items:
            for si in payload.selected_items:
                if isinstance(si, dict) and "name" in si:
                    s_amt = si.get("spent_amount")
                    if s_amt is None:
                        s_amt = si.get("amount")
                    if s_amt is not None:
                        try:
                            user_spent_map[str(si["name"]).strip().lower()] = float(s_amt)
                        except (ValueError, TypeError):
                            pass

        selected_items_breakdown = []
        if user_spent_map:
            # Allocate according to user's item-wise specified spent amounts
            for idet in items_detail:
                norm_name = str(idet["name"]).strip().lower()
                alloc = user_spent_map.get(norm_name, 0.0)
                alloc = round(alloc, 2)
                selected_items_breakdown.append({
                    "name": idet["name"],
                    "fee_type": idet["fee_type"],
                    "billed_amount": idet["line_total"],
                    "already_spent": idet["already_spent"],
                    "remaining_balance": idet["remaining_balance"],
                    "allocated_amount": alloc,
                    "amount": alloc,
                })
        else:
            # Distribute payload.amount across selected items (waterfall fallback)
            rem_to_allocate = round(payload.amount, 2)
            for idet in items_detail:
                if rem_to_allocate <= 0:
                    alloc = 0.0
                elif rem_to_allocate >= idet["remaining_balance"]:
                    alloc = idet["remaining_balance"]
                    rem_to_allocate = round(rem_to_allocate - alloc, 2)
                else:
                    alloc = rem_to_allocate
                    rem_to_allocate = 0.0

                selected_items_breakdown.append({
                    "name": idet["name"],
                    "fee_type": idet["fee_type"],
                    "billed_amount": idet["line_total"],
                    "already_spent": idet["already_spent"],
                    "remaining_balance": idet["remaining_balance"],
                    "allocated_amount": alloc,
                    "amount": alloc,
                })

            if rem_to_allocate > 0 and selected_items_breakdown:
                selected_items_breakdown[0]["allocated_amount"] = round(selected_items_breakdown[0]["allocated_amount"] + rem_to_allocate, 2)
                selected_items_breakdown[0]["amount"] = selected_items_breakdown[0]["allocated_amount"]

        exp_dict["sale_item_name"] = ", ".join(target_item_names)
        exp_dict["sale_item_names"] = target_item_names
        exp_dict["selected_items"] = selected_items_breakdown
        exp_dict["pass_on_item_type"] = "passed_on_money"
        exp_dict["pass_on_received_amount"] = total_received

    exp_dict["status"] = payload.status or exp_dict.get("status") or "pending"
    e = Expense(**exp_dict)

    # Auto-seed into Expense Approval Section (Point iii of user requirements)
    year = datetime.now().year
    app_count = await db.expense_approval_vouchers.count_documents({})
    app_voucher_no = f"EXP-APP-{year}-{(app_count + 1):04d}"
    app_vid = f"eapp_{uuid.uuid4().hex[:12]}"
    now_iso = datetime.now(timezone.utc).isoformat()

    cust_id = exp_dict.get("customer_id") or "general"
    cust_name = exp_dict.get("customer_name") or exp_dict.get("vendor") or "General Operating"

    # Build approval line items
    approval_line_items = []
    if selected_items_breakdown:
        has_positive = any(float(s.get("allocated_amount") or 0) > 0 for s in selected_items_breakdown)
        for sitem in selected_items_breakdown:
            alloc_val = float(sitem.get("allocated_amount") or sitem.get("amount") or 0.0)
            if alloc_val > 0 or not has_positive:
                approval_line_items.append({
                    "id": f"item_{uuid.uuid4().hex[:8]}",
                    "head": sitem["name"],
                    "description": f"Disbursement of {sitem['name']} against voucher {exp_dict.get('sale_invoice_no') or ''}".strip(),
                    "qty": 1.0,
                    "rate": alloc_val,
                    "amount": alloc_val,
                })
    else:
        approval_line_items = [
            {
                "id": f"item_{uuid.uuid4().hex[:8]}",
                "head": payload.category or "Operating Expense",
                "description": payload.description or "",
                "qty": 1.0,
                "rate": float(payload.amount),
                "amount": float(payload.amount),
            }
        ]

    app_voucher_doc = {
        "id": app_vid,
        "voucher_no": app_voucher_no,
        "voucher_date": payload.date or datetime.now().strftime("%d-%m-%Y"),
        "customer_id": cust_id,
        "customer_name": cust_name,
        "customer_code": exp_dict.get("customer_code") or "",
        "customer_mobile": exp_dict.get("customer_mobile") or "",
        "customer_pan": exp_dict.get("customer_pan") or "",
        "customer_gst": exp_dict.get("customer_gst") or "",
        "customer_whatsapp": exp_dict.get("customer_mobile") or "",
        "sale_voucher_id": payload.sale_invoice_id or "",
        "sale_voucher_no": exp_dict.get("sale_invoice_no") or "DIRECT-EXP",
        "sale_voucher_type": "invoice" if payload.sale_invoice_id else "direct",
        "sale_voucher_date": exp_dict.get("sale_invoice_date") or payload.date,
        "sale_voucher_amount": float(exp_dict.get("pass_on_received_amount") or payload.amount),
        "sale_received_amount": float(exp_dict.get("pass_on_received_amount") or payload.amount),
        "sale_unpaid_amount": 0.0,
        "expenses": approval_line_items,
        "total_expense_amount": float(payload.amount),
        "notes": f"Auto-seeded from Add Expense ({payload.payment_mode.upper()}). Vendor: {payload.vendor or 'N/A'}. {payload.description or ''}".strip(),
        "status": "submitted",
        "created_by": {
            "user_id": current.user_id,
            "name": current.name,
            "email": current.email,
            "role": current.role,
        },
        "created_at": now_iso,
        "created_at_dt": datetime.now(timezone.utc),
        "updated_at": now_iso,
        "linked_expense_id": e.id,
        "source": "add_expense",
        "workflow_history": [
            {
                "action": "submitted",
                "actor": {"user_id": current.user_id, "name": current.name, "role": current.role},
                "timestamp": now_iso,
                "remarks": f"Expense {no} auto-seeded into Approval Section from Add Expense",
            }
        ],
    }

    await db.expense_approval_vouchers.insert_one(app_voucher_doc)

    e.linked_voucher_no = app_voucher_no
    e.linked_approval_id = app_vid
    e.status = exp_dict.get("status") or "pending"

    exp_doc = e.dict()
    exp_doc["linked_voucher_no"] = app_voucher_no
    exp_doc["linked_approval_id"] = app_vid
    await db.expenses.insert_one(exp_doc)
    return e


@api_router.get("/expenses", response_model=List[Expense])
async def list_expenses(
    status: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    search: Optional[str] = None,
    customer_id: Optional[str] = None,
    category: Optional[str] = None,
    payment_mode: Optional[str] = None,
    current: User = Depends(get_current_user)
):
    q: dict = {}
    if status and status != "all":
        q["status"] = status
    if customer_id and customer_id != "all":
        q["customer_id"] = customer_id
    if category and category != "all":
        q["category"] = category
    if payment_mode and payment_mode != "all":
        q["payment_mode"] = payment_mode
    if from_date or to_date:
        q["date"] = {}
        if from_date:
            q["date"]["$gte"] = from_date
        if to_date:
            q["date"]["$lte"] = to_date

    if search:
        s = re.escape(search.strip())
        matching_custs = await db.customers.find({
            "$or": [
                {"name": {"$regex": s, "$options": "i"}},
                {"mobile": {"$regex": s, "$options": "i"}},
                {"pan": {"$regex": s, "$options": "i"}},
                {"gst_no": {"$regex": s, "$options": "i"}},
                {"customer_code": {"$regex": s, "$options": "i"}},
            ]
        }, {"_id": 0, "id": 1}).to_list(500)
        matching_cust_ids = [c["id"] for c in matching_custs if "id" in c]

        or_conds = [
            {"expense_no": {"$regex": s, "$options": "i"}},
            {"linked_voucher_no": {"$regex": s, "$options": "i"}},
            {"vendor": {"$regex": s, "$options": "i"}},
            {"customer_name": {"$regex": s, "$options": "i"}},
            {"customer_mobile": {"$regex": s, "$options": "i"}},
            {"customer_pan": {"$regex": s, "$options": "i"}},
            {"customer_gst": {"$regex": s, "$options": "i"}},
            {"customer_code": {"$regex": s, "$options": "i"}},
            {"category": {"$regex": s, "$options": "i"}},
            {"description": {"$regex": s, "$options": "i"}},
            {"sale_invoice_no": {"$regex": s, "$options": "i"}},
            {"sale_item_name": {"$regex": s, "$options": "i"}},
        ]
        if matching_cust_ids:
            or_conds.append({"customer_id": {"$in": matching_cust_ids}})

        q["$or"] = or_conds

    docs = await db.expenses.find(q, {"_id": 0}).sort("date", -1).to_list(1000)

    # Dynamic customer enrichment if missing on older expenses
    cust_ids = [d.get("customer_id") for d in docs if d.get("customer_id") and (not d.get("customer_pan") or not d.get("customer_gst") or not d.get("customer_mobile"))]
    if cust_ids:
        custs = await db.customers.find({"id": {"$in": list(set(cust_ids))}}, {"_id": 0, "id": 1, "name": 1, "mobile": 1, "pan": 1, "gst_no": 1, "customer_code": 1}).to_list(1000)
        cmap = {c["id"]: c for c in custs}
        for d in docs:
            cid = d.get("customer_id")
            if cid and cid in cmap:
                c = cmap[cid]
                if not d.get("customer_mobile"): d["customer_mobile"] = c.get("mobile")
                if not d.get("customer_pan"): d["customer_pan"] = c.get("pan")
                if not d.get("customer_gst"): d["customer_gst"] = c.get("gst_no")
                if not d.get("customer_code"): d["customer_code"] = c.get("customer_code")

    expenses_out = []
    for d in docs:
        try:
            expenses_out.append(Expense(**d))
        except Exception as err:
            logger.error(f"Error parsing expense doc {d.get('id')}: {err}")
    return expenses_out


@api_router.get("/expenses/{eid}", response_model=Expense)
async def get_expense(eid: str, current: User = Depends(get_current_user)):
    d = await db.expenses.find_one({"id": eid}, {"_id": 0})
    if not d:
        raise HTTPException(status_code=404, detail="Expense not found")
    cid = d.get("customer_id")
    if cid and (not d.get("customer_pan") or not d.get("customer_gst") or not d.get("customer_mobile")):
        cust = await db.customers.find_one({"id": cid}, {"_id": 0})
        if cust:
            d["customer_mobile"] = d.get("customer_mobile") or cust.get("mobile")
            d["customer_pan"] = d.get("customer_pan") or cust.get("pan")
            d["customer_gst"] = d.get("customer_gst") or cust.get("gst_no")
            d["customer_code"] = d.get("customer_code") or cust.get("customer_code")
    return Expense(**d)


@api_router.patch("/expenses/{eid}", response_model=Expense)
async def update_expense(eid: str, payload: ExpenseUpdateInput, current: User = Depends(get_current_user)):
    existing = await db.expenses.find_one({"id": eid}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Expense not found")

    upd = {k: v for k, v in payload.dict().items() if v is not None}

    # If customer_id changed or passed, enrich customer info
    cid = upd.get("customer_id") or existing.get("customer_id")
    if cid:
        cust = await db.customers.find_one({"id": cid}, {"_id": 0})
        if cust:
            if not upd.get("customer_name"): upd["customer_name"] = cust.get("name")
            if not upd.get("customer_mobile"): upd["customer_mobile"] = cust.get("mobile")
            if not upd.get("customer_pan"): upd["customer_pan"] = cust.get("pan")
            if not upd.get("customer_gst"): upd["customer_gst"] = cust.get("gst_no")
            if not upd.get("customer_code"): upd["customer_code"] = cust.get("customer_code")

    upd["updated_at"] = now_utc()
    upd["updated_by"] = current.user_id

    await db.expenses.update_one({"id": eid}, {"$set": upd})
    d = await db.expenses.find_one({"id": eid}, {"_id": 0})
    return Expense(**d)


@api_router.get("/expenses/{eid}/pdf")
async def get_expense_pdf(eid: str, token: Optional[str] = None, authorization: Optional[str] = Header(default=None)):
    tk = None
    if authorization and authorization.startswith("Bearer "):
        tk = authorization[7:]
    elif token:
        tk = token
    if not tk:
        raise HTTPException(status_code=401, detail="Auth required")
    session = await db.user_sessions.find_one({"session_token": tk}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=401, detail="Invalid session")

    exp = await db.expenses.find_one({"id": eid}, {"_id": 0})
    if not exp:
        raise HTTPException(status_code=404, detail="Expense voucher not found")

    cust = None
    if exp.get("customer_id"):
        cust = await db.customers.find_one({"id": exp.get("customer_id")}, {"_id": 0})

    pdf_bytes = await run_in_threadpool(build_expense_pdf, exp, cust)
    fname = f"{(exp.get('expense_no') or 'expense')}_{(exp.get('date') or '').replace('-','')}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{fname}"'}
    )


@api_router.post("/expenses/{eid}/decision", response_model=Expense)
async def decide_expense(eid: str, payload: ExpenseDecision, current: User = Depends(get_current_user)):
    e = await db.expenses.find_one({"id": eid}, {"_id": 0})
    if not e: raise HTTPException(status_code=404, detail="Not found")
    if payload.action == "verify":
        if current.role not in ("admin", "manager"):
            raise HTTPException(status_code=403, detail="Only accounts/manager can verify")
        upd = {"status": "verified", "verified_by": current.user_id}
    elif payload.action == "approve":
        if current.role != "admin":
            raise HTTPException(status_code=403, detail="Only admin can approve")
        upd = {"status": "approved", "approved_by": current.user_id}
    elif payload.action == "reject":
        if current.role not in ("admin", "manager"):
            raise HTTPException(status_code=403, detail="Only admin/manager can reject")
        upd = {"status": "rejected"}
    else:
        raise HTTPException(status_code=400, detail="Invalid action")
    await db.expenses.update_one({"id": eid}, {"$set": upd})
    d = await db.expenses.find_one({"id": eid}, {"_id": 0})
    return Expense(**d)


@api_router.delete("/expenses/{eid}")
async def delete_expense(eid: str, current: User = Depends(require_admin_or_manager)):
    e = await db.expenses.find_one({"id": eid}, {"_id": 0})
    if not e:
        raise HTTPException(status_code=404, detail="Expense not found")
    if e.get("status") in ("approved", "verified"):
        raise HTTPException(status_code=400, detail="Cannot delete an approved or verified expense voucher. Financial records are locked.")

    res = await db.expenses.delete_one({"id": eid})
    await log_audit_entry(db, current, "expenses", "delete", eid, e, None)
    return {"deleted": res.deleted_count, "id": eid}


# ============ Items (catalog) ============
@api_router.get("/items", response_model=List[Item])
async def list_items(q: Optional[str] = None, current: User = Depends(get_current_user)):
    query: dict = {}
    if q:
        import re
        rx = {"$regex": re.escape(q), "$options": "i"}
        query = {"$or": [{"name": rx}, {"item_code": rx}, {"hsn_sac": rx}]}
    docs = await db.items.find(query, {"_id": 0}).sort("created_at", -1).to_list(500)
    return [Item(**d) for d in docs]


@api_router.post("/items", response_model=Item)
async def create_item(payload: ItemInput, current: User = Depends(get_current_user)):
    # unique by name (case-insensitive)
    existing = await db.items.find_one({"name": {"$regex": f"^{payload.name.strip()}$", "$options": "i"}}, {"_id": 0})
    if existing:
        raise HTTPException(status_code=409, detail={"message": f"Item '{payload.name}' already exists", "existing": {"id": existing["id"], "name": existing["name"]}})
    code = await _next_no("item_code", "ITM")
    itm = Item(**payload.dict(), item_code=code, created_by=current.user_id)
    await db.items.insert_one(itm.dict())
    return itm


@api_router.patch("/items/{iid}", response_model=Item)
async def update_item(iid: str, payload: ItemInput, current: User = Depends(get_current_user)):
    await db.items.update_one({"id": iid}, {"$set": payload.dict()})
    d = await db.items.find_one({"id": iid}, {"_id": 0})
    if not d: raise HTTPException(status_code=404, detail="Not found")
    return Item(**d)


@api_router.delete("/items/{iid}")
async def delete_item(iid: str, current: User = Depends(require_admin_or_manager)):
    res = await db.items.delete_one({"id": iid})
    return {"deleted": res.deleted_count}


# ============ Auto-task settings & helpers (used on Sale Invoice save) ============
DEFAULT_SERVICES = [
    ("dsc", "DSC Service"),
    ("gst", "GST Service"),
    ("tender", "Tender Service"),
    ("income_tax", "Income Tax Service"),
    ("registration", "Registration Service"),
]


async def _seed_default_service_settings():
    for key, label in DEFAULT_SERVICES:
        existing = await db.service_task_settings.find_one({"service_key": key}, {"_id": 0})
        if not existing:
            s = ServiceTaskSetting(service_key=key, service_label=label,
                                   default_deadline_days=7, default_followup_days=3, auto_task_enabled=True)
            await db.service_task_settings.insert_one(s.dict())


def _slug(s: str) -> str:
    return "".join(ch.lower() if ch.isalnum() else "_" for ch in (s or "")).strip("_")


async def _match_service_setting(inv):
    await _seed_default_service_settings()
    if inv.items:
        docs = await db.service_task_settings.find({}, {"_id": 0}).to_list(50)
        for it in inv.items:
            nm = (it.name or "").lower()
            slug = _slug(it.name)
            for s in docs:
                if s["service_key"] and (
                    s["service_key"] in slug
                    or s["service_key"] in nm
                    or s["service_label"].lower() in nm
                ):
                    return s
    return await db.service_task_settings.find_one({}, {"_id": 0})


async def _get_global_auto_toggle() -> bool:
    doc = await db.app_settings.find_one({"_id": "auto_task_on_invoice"}, {"_id": 0}) or {}
    val = doc.get("enabled")
    return True if val is None else bool(val)


async def _auto_create_tasks_for_invoice(inv, current: User):
    if not await _get_global_auto_toggle():
        return []
    setting = await _match_service_setting(inv)
    if not setting or not setting.get("auto_task_enabled", True):
        return []

    cust = await db.customers.find_one({"id": inv.party_id}, {"_id": 0}) if inv.party_id else None
    cust_pan = (cust or {}).get("pan")
    cust_addr = (cust or {}).get("address")
    cust_code = (cust or {}).get("customer_code")

    service_label = setting["service_label"]
    deadline_days = int(setting.get("default_deadline_days") or 7)
    followup_days = int(setting.get("default_followup_days") or 3)
    assignee_id = setting.get("default_assignee_id")
    assignee_name = setting.get("default_assignee_name")

    def _add_days(d: str, days: int) -> str:
        try:
            base = datetime.strptime(d, "%Y-%m-%d")
        except Exception:
            base = datetime.utcnow()
        return (base + timedelta(days=days)).strftime("%Y-%m-%d")

    common_customer = dict(
        customer_id=inv.party_id, customer_code=cust_code, customer_name=inv.party_name,
        customer_mobile=inv.party_mobile, customer_pan=cust_pan, customer_address=cust_addr,
    )
    common_voucher = dict(
        voucher_no=inv.invoice_no, voucher_date=inv.date,
        total_amount=inv.total_amount, paid_amount=inv.paid_amount,
        dues_amount=round(inv.total_amount - inv.paid_amount, 2),
    )

    tasks_created = []

    # Look up service workflow stages
    swf = await db.service_workflows.find_one({"service_name": service_label}, {"_id": 0})
    wf_stages = (swf.get("stages") if swf else []) or []

    service_task = Task(
        task_no=await _next_no("task_no", "TSK"),
        title=f"{service_label} — {inv.party_name}",
        description=f"Auto-generated on {inv.invoice_no}. Complete {service_label}.",
        task_category="task_followup",
        service_name=service_label,
        workflow_stages=wf_stages,
        current_stage_name=wf_stages[0]["name"] if wf_stages else "Data Entry Operator",
        deadline=_add_days(inv.date, deadline_days),
        assignee_id=assignee_id, assignee_name=assignee_name,
        chat_participants=[assignee_id] if assignee_id else [],
        priority="high", status="todo",
        created_by=current.user_id, created_by_name=current.name,
        **common_customer, **common_voucher,
    )
    await db.tasks.insert_one(service_task.dict())
    tasks_created.append(service_task.dict())

    # Look up payment follow-up workflow stages
    swf_pay = await db.service_workflows.find_one({"service_name": "Payment Follow-up"}, {"_id": 0})
    pay_stages = (swf_pay.get("stages") if swf_pay else []) or []

    followup_task = Task(
        task_no=await _next_no("task_no", "TSK"),
        title=f"Payment Follow-up — {inv.party_name}",
        description=f"Follow-up on {inv.invoice_no}. Balance: ₹{round(inv.balance, 2)}",
        task_category="payment_followup",
        service_name="Payment Follow-up",
        workflow_stages=pay_stages,
        current_stage_name=pay_stages[0]["name"] if pay_stages else "Invoice Notice Sent",
        deadline=_add_days(inv.date, followup_days),
        assignee_id=assignee_id, assignee_name=assignee_name,
        chat_participants=[assignee_id] if assignee_id else [],
        priority="medium" if inv.balance <= 0 else "high", status="todo",
        created_by=current.user_id, created_by_name=current.name,
        **common_customer, **common_voucher,
    )
    await db.tasks.insert_one(followup_task.dict())
    tasks_created.append(followup_task.dict())
    return tasks_created


@api_router.get("/settings/service-tasks", response_model=List[ServiceTaskSetting])
async def list_service_task_settings(current: User = Depends(get_current_user)):
    await _seed_default_service_settings()
    docs = await db.service_task_settings.find({}, {"_id": 0}).sort("service_label", 1).to_list(200)
    return [ServiceTaskSetting(**d) for d in docs]


@api_router.post("/settings/service-tasks", response_model=ServiceTaskSetting)
async def create_service_task_setting(payload: ServiceTaskSettingInput, current: User = Depends(require_admin)):
    key = _slug(payload.service_key or payload.service_label)
    if not key:
        raise HTTPException(status_code=400, detail="service_key or service_label required")
    existing = await db.service_task_settings.find_one({"service_key": key}, {"_id": 0})
    if existing:
        raise HTTPException(status_code=409, detail=f"Service '{payload.service_label}' already exists")
    data = payload.dict()
    data["service_key"] = key
    s = ServiceTaskSetting(**data)
    await db.service_task_settings.insert_one(s.dict())
    return s


@api_router.patch("/settings/service-tasks/{sid}", response_model=ServiceTaskSetting)
async def update_service_task_setting(sid: str, payload: ServiceTaskSettingInput, current: User = Depends(require_admin)):
    updates = payload.dict()
    updates["service_key"] = _slug(updates.get("service_key") or updates.get("service_label", ""))
    await db.service_task_settings.update_one({"id": sid}, {"$set": updates})
    d = await db.service_task_settings.find_one({"id": sid}, {"_id": 0})
    if not d:
        raise HTTPException(status_code=404, detail="Not found")
    return ServiceTaskSetting(**d)


@api_router.delete("/settings/service-tasks/{sid}")
async def delete_service_task_setting(sid: str, current: User = Depends(require_admin)):
    res = await db.service_task_settings.delete_one({"id": sid})
    return {"deleted": res.deleted_count}


@api_router.get("/settings/auto-task-toggle")
async def get_auto_task_toggle(current: User = Depends(get_current_user)):
    return {"enabled": await _get_global_auto_toggle()}


@api_router.put("/settings/auto-task-toggle")
async def set_auto_task_toggle(payload: AutoTaskGlobalToggle, current: User = Depends(require_admin)):
    await db.app_settings.update_one(
        {"_id": "auto_task_on_invoice"},
        {"$set": {"enabled": bool(payload.enabled)}},
        upsert=True,
    )
    return {"enabled": bool(payload.enabled)}


# ============ Invoices (Sale / Purchase) ============
def _recalc_invoice(items: List[InvoiceItem]):
    subtotal = 0.0; total_discount = 0.0; total_tax = 0.0; total_amount = 0.0
    out: List[InvoiceItem] = []
    for it in items:
        line = it.qty * it.price
        after_disc = max(0.0, line - it.discount)
        tax = round(after_disc * (it.tax_rate or 0) / 100.0, 2)
        amt = round(after_disc + tax, 2)
        it_copy = it.copy(update={"amount": amt})
        out.append(it_copy)
        subtotal += line
        total_discount += it.discount
        total_tax += tax
        total_amount += amt
    return out, round(subtotal, 2), round(total_discount, 2), round(total_tax, 2), round(total_amount, 2)


@api_router.post("/invoices", response_model=Invoice)
async def create_invoice(payload: InvoiceInput, current: User = Depends(get_current_user)):
    if not payload.party_id or not payload.party_name.strip():
        raise HTTPException(status_code=400, detail="Party (Customer) is required")
    items, subtotal, tdisc, ttax, ttotal = _recalc_invoice(payload.items or [])
    if payload.invoice_type == "sale":
        custom_no = (payload.invoice_no or "").strip()
        if custom_no and not "preview" in custom_no.lower() and not custom_no.upper() in ["AUTO", "NEW"]:
            no = custom_no
            fy = get_indian_financial_year(payload.date)
            m = re.match(r"^TDSC/" + re.escape(fy) + r"/(\d+)$", no)
            if m:
                await db.counters.update_one({"_id": f"sale_invoice_{fy}"}, {"$max": {"seq": int(m.group(1))}}, upsert=True)
        else:
            no = await _next_sale_invoice_no(payload.date)
    elif payload.invoice_type == "sale_return":
        prefix = "CN"
        counter_key = "sale_return_no"
        custom_no = (payload.invoice_no or "").strip()
        if custom_no and not "preview" in custom_no.lower() and not custom_no.upper() in ["AUTO", "NEW"]:
            no = custom_no
        else:
            no = await _next_no(counter_key, prefix)
    elif payload.invoice_type == "purchase_return":
        prefix = "DN"
        counter_key = "purchase_return_no"
        custom_no = (payload.invoice_no or "").strip()
        if custom_no and not "preview" in custom_no.lower() and not custom_no.upper() in ["AUTO", "NEW"]:
            no = custom_no
        else:
            no = await _next_no(counter_key, prefix)
    else:
        prefix = "PB"
        counter_key = "purchase_bill_no"
        custom_no = (payload.invoice_no or "").strip()
        if custom_no and not "preview" in custom_no.lower() and not custom_no.upper() in ["AUTO", "NEW"]:
            no = custom_no
        else:
            no = await _next_no(counter_key, prefix)
    total = ttotal if ttotal > 0 else float(payload.total_amount or 0)
    
    # Process multiple payment splits (cash, upi, cheque, bank transfer, other)
    initial_payments = []
    if payload.payment_splits:
        running_tot = 0.0
        for idx, ps in enumerate(payload.payment_splits):
            p_amt = float(ps.get("amount") or 0)
            if p_amt > 0:
                p_mode = str(ps.get("mode") or ps.get("payment_mode") or "cash").lower()
                p_ref = str(ps.get("reference") or ps.get("ref") or "").strip()
                running_tot = round(running_tot + p_amt, 2)
                initial_payments.append({
                    "payment_id": f"init_{no}_{idx+1}",
                    "payment_no": f"PAY-{no}-{idx+1}",
                    "date": ps.get("date") or payload.date,
                    "amount": round(p_amt, 2),
                    "payment_mode": p_mode,
                    "reference": p_ref,
                    "payment_type": "Initial / Split Payment",
                    "remarks": (f"Payment via {p_mode.replace('_', ' ').title()}" + (f" (Ref: {p_ref})" if p_ref else "")).strip(),
                    "created_at": now_utc().isoformat(),
                    "balance_after": max(0.0, round(total - running_tot, 2)),
                })

    if initial_payments:
        paid = round(sum(p["amount"] for p in initial_payments), 2)
        distinct_modes = list(dict.fromkeys(p["payment_mode"] for p in initial_payments))
        inv_payment_mode = ", ".join(distinct_modes)
    else:
        paid = float(payload.paid_amount or 0)
        if payload.payment_type == "cash": paid = total
        inv_payment_mode = payload.payment_mode or "cash"
        if paid > 0:
            initial_payments.append({
                "payment_id": f"init_{no}",
                "payment_no": f"INITIAL-{no}",
                "date": payload.date,
                "amount": paid,
                "payment_mode": inv_payment_mode,
                "payment_type": "Initial / Down Payment" if (round(total - paid, 2)) > 0 else "Full Payment",
                "remarks": "Payment received at invoice generation",
                "created_at": now_utc().isoformat(),
                "balance_after": round(total - paid, 2),
            })

    balance = round(total - paid, 2)
    status = "paid" if balance <= 0 and total > 0 else ("partial" if paid > 0 else "unpaid")

    party_mobile = payload.party_mobile
    party_gst = payload.party_gst
    party_pan = payload.party_pan
    party_code = payload.party_code
    if payload.party_id and (not party_mobile or not party_pan or not party_gst or not party_code):
        c = await db.customers.find_one({"id": payload.party_id}, {"_id": 0, "mobile": 1, "pan": 1, "gst_no": 1, "customer_code": 1})
        if c:
            party_mobile = party_mobile or c.get("mobile")
            party_gst = party_gst or c.get("gst_no")
            party_pan = party_pan or c.get("pan")
            party_code = party_code or c.get("customer_code")

    inv = Invoice(
        invoice_no=no, invoice_type=payload.invoice_type, payment_type=payload.payment_type,
        payment_mode=inv_payment_mode,
        date=payload.date, payment_terms=payload.payment_terms, due_date=payload.due_date,
        party_id=payload.party_id, party_name=payload.party_name,
        party_mobile=party_mobile, party_pan=party_pan, party_gst=party_gst, party_code=party_code,
        items=items, subtotal=subtotal, total_discount=tdisc, total_tax=ttax, total_amount=total,
        paid_amount=paid, balance=balance, status=status, notes=payload.notes,
        signatory_name=payload.signatory_name or "अंजू कुमारी",
        signature_url=payload.signature_url,
        include_signature=True if payload.include_signature is None else payload.include_signature,
        payments=initial_payments,
        payment_splits=payload.payment_splits,
        created_by=current.user_id, created_by_name=current.name,
    )
    await db.invoices.insert_one(inv.dict())
    # Auto-create tasks (best-effort — do not fail invoice on error)
    try:
        if payload.invoice_type == "sale":
            await _auto_create_tasks_for_invoice(inv, current)
    except Exception as e:
        logger.exception("Auto-task creation failed: %s", e)
    return inv


@api_router.get("/invoices", response_model=List[Invoice])
async def list_invoices(
    invoice_type: Optional[str] = None,
    party_id: Optional[str] = None,
    search: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    current: User = Depends(get_current_user)
):
    q: dict = {}
    if invoice_type: q["invoice_type"] = invoice_type
    if party_id: q["party_id"] = party_id
    if from_date or to_date:
        q["date"] = {}
        if from_date: q["date"]["$gte"] = from_date
        if to_date: q["date"]["$lte"] = to_date
    docs = await db.invoices.find(q, {"_id": 0}).sort("date", -1).to_list(500)

    # Batch enrich party metadata from db.customers
    party_ids = list({d.get("party_id") for d in docs if d.get("party_id")})
    cust_map = {}
    if party_ids:
        try:
            customers = await db.customers.find(
                {"id": {"$in": party_ids}},
                {"_id": 0, "id": 1, "name": 1, "mobile": 1, "pan": 1, "gst_no": 1, "customer_code": 1}
            ).to_list(len(party_ids))
            cust_map = {c["id"]: c for c in customers}
        except Exception as e:
            logger.warning("Could not batch load customers for invoices: %s", e)

    s_query = (search or "").strip().lower()

    out = []
    for d in docs:
        try:
            c = cust_map.get(d.get("party_id"))
            if c:
                if not d.get("party_mobile"): d["party_mobile"] = c.get("mobile")
                if not d.get("party_gst"): d["party_gst"] = c.get("gst_no")
                if not d.get("party_pan"): d["party_pan"] = c.get("pan")
                if not d.get("party_code"): d["party_code"] = c.get("customer_code")

            if s_query:
                inv_no = str(d.get("invoice_no") or d.get("invoice_number") or "").lower()
                p_name = str(d.get("party_name") or "").lower()
                p_mob = str(d.get("party_mobile") or "").lower()
                p_pan = str(d.get("party_pan") or "").lower()
                p_gst = str(d.get("party_gst") or "").lower()
                p_code = str(d.get("party_code") or "").lower()
                p_notes = str(d.get("notes") or "").lower()
                p_date = str(d.get("date") or "").lower()
                if not (s_query in inv_no or s_query in p_name or s_query in p_mob or
                        s_query in p_pan or s_query in p_gst or s_query in p_code or
                        s_query in p_notes or s_query in p_date):
                    continue

            items = d.get("items") or []
            for it in items:
                if isinstance(it, dict) and not it.get("name"):
                    it["name"] = it.get("item_name") or it.get("description") or "Item"
            out.append(Invoice(**d))
        except Exception as e:
            logger.error("Error parsing invoice %s: %s", d.get("id"), e)
    return out


async def _reconcile_single_invoice_payments(d: dict) -> dict:
    inv_id = d.get("id")
    inv_no = d.get("invoice_no")
    party_id = d.get("party_id")
    party_name = d.get("party_name")
    total_amount = float(d.get("total_amount") or 0.0)

    or_conds = []
    if inv_id:
        or_conds.extend([{"linked_vouchers.voucher_id": inv_id}, {"linked_voucher_no": inv_no}])
    if inv_no:
        or_conds.append({"linked_vouchers.voucher_no": inv_no})

    existing_payments = list(d.get("payments") or [])
    
    init_entries = []
    for p in existing_payments:
        pno = str(p.get("payment_no") or "").upper()
        ptype = str(p.get("payment_type") or "").lower()
        pid = str(p.get("payment_id") or "").lower()
        if (
            "INITIAL" in pno or
            "initial" in ptype or
            "down" in ptype or
            "split" in ptype or
            pid.startswith("init_") or
            (pno.startswith("PAY-") and "init_" in pid)
        ):
            init_entries.append(dict(p))

    # If no initial entries in existing_payments, check payment_splits
    if not init_entries and d.get("payment_splits"):
        running_tot_splits = 0.0
        for idx, ps in enumerate(d.get("payment_splits") or []):
            p_amt = float(ps.get("amount") or 0)
            if p_amt > 0:
                p_mode = str(ps.get("mode") or ps.get("payment_mode") or "cash").lower()
                p_ref = str(ps.get("reference") or ps.get("ref") or "").strip()
                running_tot_splits = round(running_tot_splits + p_amt, 2)
                init_entries.append({
                    "payment_id": f"init_{inv_no}_{idx+1}",
                    "payment_no": f"PAY-{inv_no}-{idx+1}",
                    "date": ps.get("date") or d.get("date"),
                    "amount": round(p_amt, 2),
                    "payment_mode": p_mode,
                    "reference": p_ref,
                    "payment_type": "Initial / Split Payment",
                    "remarks": (f"Payment via {p_mode.replace('_', ' ').title()}" + (f" (Ref: {p_ref})" if p_ref else "")).strip(),
                    "created_at": str(d.get("created_at") or now_utc().isoformat()),
                    "balance_after": max(0.0, round(total_amount - running_tot_splits, 2)),
                })

    if not init_entries and float(d.get("paid_amount") or 0.0) > 0 and len(existing_payments) == 0:
        init_entries.append({
            "payment_id": f"init_{inv_id}",
            "payment_no": f"INITIAL-{inv_no}",
            "date": d.get("date") or "Initial",
            "amount": float(d.get("paid_amount")),
            "payment_mode": d.get("payment_mode") or "cash",
            "payment_type": "Initial / Down Payment",
            "remarks": "Payment received at invoice generation",
            "created_at": str(d.get("created_at") or now_utc().isoformat()),
            "balance_after": max(0.0, round(total_amount - float(d.get("paid_amount")), 2)),
        })

    merged = list(init_entries)

    if or_conds:
        incomes = await db.income.find({"$or": or_conds}, {"_id": 0}).sort("date", 1).to_list(100)
        for inc in incomes:
            inc_remarks = str(inc.get("remarks") or "").lower()
            inc_id = inc.get("id")
            inc_no = inc.get("voucher_no") or inc.get("income_no")

            # Check if this income corresponds to the initial down payment already recorded in init_entry
            is_initial = (
                "initial" in inc_remarks or
                "auto-linked" in inc_remarks or
                inc_no == "PAYIN-0001" or
                any(
                    (float(inc.get("amount") or 0.0) == float(ie.get("amount") or 0.0) and inc.get("date") == d.get("date")) or
                    (ie.get("payment_no") == inc_no or ie.get("payment_id") == inc_id)
                    for ie in init_entries
                )
            )
            if is_initial:
                continue

            if any(p.get("payment_id") == inc_id or p.get("payment_no") == inc_no for p in merged):
                continue

            inc_amt = float(inc.get("amount") or 0.0)
            allocated = 0.0
            matched_this_invoice = False
            if inc.get("linked_vouchers"):
                for lv in inc["linked_vouchers"]:
                    if lv.get("voucher_id") == inv_id or lv.get("voucher_no") == inv_no:
                        allocated = float(lv.get("allocated_amount") or inc_amt)
                        matched_this_invoice = True
                        break
            elif inc.get("linked_voucher_no") == inv_no:
                allocated = inc_amt
                matched_this_invoice = True

            if not matched_this_invoice:
                continue

            svc_label = inc.get("service_name") or "Receipt"
            merged.append({
                "payment_id": inc_id,
                "payment_no": inc_no,
                "date": inc.get("date"),
                "amount": allocated,
                "payment_mode": inc.get("payment_mode") or "cash",
                "payment_type": f"Payment-In ({svc_label})",
                "remarks": inc.get("remarks") or f"Payment-In {inc_no}",
                "created_at": str(inc.get("created_at") or now_utc().isoformat()),
                "balance_after": 0.0
            })

    try:
        merged.sort(key=lambda x: str(x.get("date") or "9999-99-99"))
    except Exception:
        pass

    running_paid = 0.0
    for p in merged:
        amt = float(p.get("amount") or 0.0)
        running_paid = round(running_paid + amt, 2)
        p["balance_after"] = max(0.0, round(total_amount - running_paid, 2))

    new_bal = max(0.0, round(total_amount - running_paid, 2))
    new_status = "paid" if new_bal <= 0 and total_amount > 0 else ("partial" if running_paid > 0 else "unpaid")

    if running_paid != float(d.get("paid_amount") or 0.0) or len(merged) != len(existing_payments) or new_bal != float(d.get("balance") or 0.0):
        await db.invoices.update_one(
            {"id": inv_id},
            {"$set": {
                "paid_amount": running_paid,
                "balance": new_bal,
                "status": new_status,
                "payments": merged,
            }}
        )
        d["paid_amount"] = running_paid
        d["balance"] = new_bal
        d["status"] = new_status
        d["payments"] = merged

    return d


@api_router.get("/invoices/{iid}", response_model=Invoice)
async def get_invoice(iid: str, current: User = Depends(get_current_user)):
    d = await db.invoices.find_one({"id": iid}, {"_id": 0})
    if not d: raise HTTPException(status_code=404, detail="Not found")
    d = await _reconcile_single_invoice_payments(d)
    if d.get("party_id"):
        c = await db.customers.find_one({"id": d.get("party_id")}, {"_id": 0, "mobile": 1, "pan": 1, "gst_no": 1, "customer_code": 1})
        if c:
            if not d.get("party_mobile"): d["party_mobile"] = c.get("mobile")
            if not d.get("party_gst"): d["party_gst"] = c.get("gst_no")
            if not d.get("party_pan"): d["party_pan"] = c.get("pan")
            if not d.get("party_code"): d["party_code"] = c.get("customer_code")
    items = d.get("items") or []
    for it in items:
        if isinstance(it, dict) and not it.get("name"):
            it["name"] = it.get("item_name") or it.get("description") or "Item"
    return Invoice(**d)


@api_router.get("/invoices/{iid}/payment-history")
async def get_invoice_payment_history(iid: str, current: User = Depends(get_current_user)):
    inv = await db.invoices.find_one({"id": iid}, {"_id": 0})
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")

    total = float(inv.get("total_amount") or 0.0)
    paid = float(inv.get("paid_amount") or 0.0)
    bal = float(inv.get("balance") or max(0.0, round(total - paid, 2)))
    raw_payments = list(inv.get("payments") or [])

    # If invoice has recorded paid_amount but raw_payments was empty, synthesize the initial payment
    if paid > 0 and len(raw_payments) == 0:
        raw_payments.append({
            "payment_id": f"init_{inv.get('id')}",
            "payment_no": f"INITIAL-{inv.get('invoice_no')}",
            "date": inv.get("date") or "Initial",
            "amount": paid,
            "payment_mode": inv.get("payment_mode") or "cash",
            "payment_type": "Initial / Down Payment" if bal > 0 else "Full Payment",
            "remarks": "Payment received at invoice generation",
            "created_at": str(inv.get("created_at") or now_utc().isoformat()),
            "balance_after": bal,
        })

    return {
        "invoice_id": inv.get("id"),
        "invoice_no": inv.get("invoice_no"),
        "invoice_date": inv.get("date"),
        "party_name": inv.get("party_name"),
        "total_amount": total,
        "paid_amount": paid,
        "balance": bal,
        "status": inv.get("status"),
        "payments": raw_payments,
    }


@api_router.get("/invoices/{iid}/profit-analysis")
async def get_invoice_profit_analysis(iid: str, current: User = Depends(get_current_user)):
    """Calculate justified bill-wise profit for an invoice voucher:
    Total Profit = Voucher Total Amount - Voucher Total Expense
    Profit % = (Total Profit * 100) / Voucher Amount Excluding Pass-On Money
    """
    inv = await db.invoices.find_one({"$or": [{"id": iid}, {"invoice_no": iid}]}, {"_id": 0})
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice voucher not found")

    total_amount = float(inv.get("total_amount") or 0.0)

    # 1. Identify Passed On Money vs Actual Service items
    pass_on_items = []
    pass_on_amount = 0.0
    actual_service_items = []
    actual_service_amount = 0.0

    for it in inv.get("items", []):
        it_amt = float(it.get("amount") or (float(it.get("qty", 1)) * float(it.get("price", 0))))
        is_passon = (
            it.get("item_type") == "passed_on_money" or
            (it.get("item_type") != "actual_service" and (
                it.get("fee_type") in ("EMD", "Cost of BOQ", "Tender Processing Fee", "Registration Fee", "Other Fee") or
                any(k in (it.get("name") or "").lower() for k in ["emd", "cost of boq", "pass-on", "passed on"])
            ))
        )
        if is_passon:
            pass_on_items.append({
                "name": it.get("name"),
                "fee_type": it.get("fee_type") or "Pass-On Fee",
                "amount": it_amt,
                "qty": it.get("qty", 1),
                "price": it.get("price", it_amt),
            })
            pass_on_amount += it_amt
        else:
            actual_service_items.append({
                "name": it.get("name"),
                "amount": it_amt,
                "qty": it.get("qty", 1),
                "price": it.get("price", it_amt),
                "tax_rate": it.get("tax_rate", 0),
            })
            actual_service_amount += it_amt

    # Total voucher amount excluding pass-on money
    voucher_amount_ex_passon = max(0.0, round(total_amount - pass_on_amount, 2))
    if voucher_amount_ex_passon == 0 and actual_service_amount > 0:
        voucher_amount_ex_passon = round(actual_service_amount, 2)

    # 2. Find all linked expenses for this voucher in db.expenses
    inv_id = inv.get("id")
    inv_no = inv.get("invoice_no")
    exp_or = []
    if inv_id:
        exp_or.extend([{"sale_invoice_id": inv_id}, {"sale_voucher_id": inv_id}])
    if inv_no:
        exp_or.extend([{"sale_invoice_no": inv_no}, {"sale_voucher_no": inv_no}])

    linked_expenses = []
    total_expense = 0.0
    if exp_or:
        exp_docs = await db.expenses.find({"$or": exp_or}, {"_id": 0}).to_list(100)
        for e in exp_docs:
            if e.get("status") != "rejected":
                amt = float(e.get("amount") or 0.0)
                total_expense += amt
                linked_expenses.append({
                    "id": e.get("id"),
                    "expense_no": e.get("expense_no"),
                    "category": e.get("category"),
                    "amount": amt,
                    "date": e.get("date"),
                    "status": e.get("status"),
                    "payment_mode": e.get("payment_mode"),
                    "vendor": e.get("vendor"),
                    "description": e.get("description"),
                })

    # 3. Apply User's Justified Formula:
    # Voucher ka total profit = Voucher ka total amount - Voucher ka total Expence
    total_profit = round(total_amount - total_expense, 2)

    # percent of profit = (total profit * 100) / total Voucher amount
    if total_amount > 0:
        profit_percent = round((total_profit * 100.0) / total_amount, 2)
    else:
        profit_percent = 0.0

    return {
        "invoice_id": inv.get("id"),
        "invoice_no": inv.get("invoice_no"),
        "party_name": inv.get("party_name"),
        "party_mobile": inv.get("party_mobile"),
        "date": inv.get("date"),
        "status": inv.get("status"),
        "total_voucher_amount": total_amount,
        "pass_on_amount": pass_on_amount,
        "voucher_amount_ex_passon": voucher_amount_ex_passon,
        "total_voucher_expense": round(total_expense, 2),
        "total_profit": total_profit,
        "profit_percent": profit_percent,
        "pass_on_items": pass_on_items,
        "actual_service_items": actual_service_items,
        "linked_expenses": linked_expenses,
        "formula": {
            "profit_formula": "Voucher Total Amount - Voucher Total Expense",
            "margin_formula": "(Total Profit × 100) / (Total Voucher Amount)",
            "explanation": f"₹{total_amount:,.2f} - ₹{total_expense:,.2f} = ₹{total_profit:,.2f} Profit ({profit_percent}% on ₹{total_amount:,.2f} total voucher amount)"
        }
    }


@api_router.get("/invoices/{iid}/pdf")
async def get_invoice_pdf(iid: str, token: Optional[str] = None, authorization: Optional[str] = Header(default=None)):
    # Accept token either via Authorization header (via dependency) OR ?token=... (browser)
    tk = None
    if authorization and authorization.startswith("Bearer "):
        tk = authorization[7:]
    elif token:
        tk = token
    if not tk:
        raise HTTPException(status_code=401, detail="Auth required")
    session = await db.user_sessions.find_one({"session_token": tk}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=401, detail="Invalid session")
    d = await db.invoices.find_one({"id": iid}, {"_id": 0})
    if not d:
        raise HTTPException(status_code=404, detail="Invoice not found")
    # Fetch customer for address
    cust = await db.customers.find_one({"id": d.get("party_id")}, {"_id": 0}) if d.get("party_id") else None
    pdf_bytes = await run_in_threadpool(build_invoice_pdf, d, cust)
    safe_inv_no = str(d.get('invoice_no') or 'invoice').replace('/', '_')
    fname = f"{safe_inv_no}_{(d.get('date') or '').replace('-','')}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{fname}"'},
    )


@api_router.patch("/invoices/{iid}", response_model=Invoice)
async def update_invoice(iid: str, payload: InvoiceInput, current: User = Depends(require_admin)):
    existing = await db.invoices.find_one({"id": iid}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Invoice not found")
    items, subtotal, tdisc, ttax, ttotal = _recalc_invoice(payload.items or [])
    total = ttotal if ttotal > 0 else float(payload.total_amount or 0)
    no = existing.get("invoice_no") or iid

    initial_payments = []
    if payload.payment_splits:
        running_tot = 0.0
        for idx, ps in enumerate(payload.payment_splits):
            p_amt = float(ps.get("amount") or 0)
            if p_amt > 0:
                p_mode = str(ps.get("mode") or ps.get("payment_mode") or "cash").lower()
                p_ref = str(ps.get("reference") or ps.get("ref") or "").strip()
                running_tot = round(running_tot + p_amt, 2)
                initial_payments.append({
                    "payment_id": f"init_{no}_{idx+1}",
                    "payment_no": f"PAY-{no}-{idx+1}",
                    "date": ps.get("date") or payload.date,
                    "amount": round(p_amt, 2),
                    "payment_mode": p_mode,
                    "reference": p_ref,
                    "payment_type": "Initial / Split Payment",
                    "remarks": (f"Payment via {p_mode.replace('_', ' ').title()}" + (f" (Ref: {p_ref})" if p_ref else "")).strip(),
                    "created_at": now_utc().isoformat(),
                    "balance_after": max(0.0, round(total - running_tot, 2)),
                })

    if initial_payments:
        paid = round(sum(p["amount"] for p in initial_payments), 2)
        distinct_modes = list(dict.fromkeys(p["payment_mode"] for p in initial_payments))
        inv_payment_mode = ", ".join(distinct_modes)
    else:
        paid = float(payload.paid_amount or 0)
        if payload.payment_type == "cash":
            paid = total
        inv_payment_mode = payload.payment_mode or existing.get("payment_mode") or "cash"
        if paid > 0:
            initial_payments.append({
                "payment_id": f"init_{no}",
                "payment_no": f"INITIAL-{no}",
                "date": payload.date,
                "amount": paid,
                "payment_mode": inv_payment_mode,
                "payment_type": "Initial / Down Payment" if (round(total - paid, 2)) > 0 else "Full Payment",
                "remarks": "Payment received at invoice generation",
                "created_at": now_utc().isoformat(),
                "balance_after": max(0.0, round(total - paid, 2)),
            })

    balance = max(0.0, round(total - paid, 2))
    status = "paid" if balance <= 0 and total > 0 else ("partial" if paid > 0 else "unpaid")
    updates = {
        "invoice_type": payload.invoice_type, "payment_type": payload.payment_type,
        "payment_mode": inv_payment_mode,
        "payment_splits": payload.payment_splits,
        "payments": initial_payments,
        "date": payload.date, "payment_terms": payload.payment_terms, "due_date": payload.due_date,
        "party_id": payload.party_id, "party_name": payload.party_name,
        "party_mobile": payload.party_mobile, "party_gst": payload.party_gst,
        "items": [it.dict() for it in items],
        "subtotal": subtotal, "total_discount": tdisc, "total_tax": ttax,
        "total_amount": total, "paid_amount": paid, "balance": balance, "status": status,
        "notes": payload.notes,
        "signatory_name": payload.signatory_name or "अंजू कुमारी",
        "signature_url": payload.signature_url,
        "include_signature": True if payload.include_signature is None else payload.include_signature,
    }
    await db.invoices.update_one({"id": iid}, {"$set": updates})
    d = await db.invoices.find_one({"id": iid}, {"_id": 0})
    items_d = d.get("items") or []
    for it in items_d:
        if isinstance(it, dict) and not it.get("name"):
            it["name"] = it.get("item_name") or it.get("description") or "Item"
    return Invoice(**d)


@api_router.delete("/invoices/{iid}")
async def delete_invoice(iid: str, current: User = Depends(require_admin)):
    res = await db.invoices.delete_one({"id": iid})
    return {"deleted": res.deleted_count}


# ============ Voucher Attachments (generic: invoices / expenses / incomes) ============
VOUCHER_MAX_BYTES = 10 * 1024 * 1024  # 10 MB per file
_VOUCHER_COLLECTIONS = {"invoices": "invoices", "expenses": "expenses", "incomes": "income"}


async def _voucher_attach(kind: str, oid: str, file: UploadFile, current: User):
    if kind not in _VOUCHER_COLLECTIONS:
        raise HTTPException(status_code=400, detail="Invalid voucher kind")
    coll_name = _VOUCHER_COLLECTIONS[kind]
    coll = getattr(db, coll_name)
    doc = await coll.find_one({"id": oid}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail=f"{kind[:-1].title()} not found")
    data = await file.read()
    if len(data) > VOUCHER_MAX_BYTES:
        raise HTTPException(status_code=400, detail=f"File exceeds 10 MB limit ({len(data)//1024} KB)")
    ext = (file.filename or "file").rsplit(".", 1)[-1].lower()
    ext = ext if len(ext) <= 8 else "bin"
    path = f"{APP_NAME}/uploads/{current.user_id}/{uuid.uuid4().hex}.{ext}"
    ct = file.content_type or "application/octet-stream"
    await run_in_threadpool(put_object, path, data, ct)
    attachment = {
        "path": path,
        "name": file.filename or f"file.{ext}",
        "size": len(data),
        "content_type": ct,
        "uploaded_at": now_utc().isoformat(),
        "uploaded_by": current.user_id,
    }
    await coll.update_one({"id": oid}, {"$push": {"attachments": attachment}})
    updated = await coll.find_one({"id": oid}, {"_id": 0})
    return updated


async def _voucher_detach(kind: str, oid: str, path: str):
    if kind not in _VOUCHER_COLLECTIONS:
        raise HTTPException(status_code=400, detail="Invalid voucher kind")
    coll = getattr(db, _VOUCHER_COLLECTIONS[kind])
    doc = await coll.find_one({"id": oid}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail=f"{kind[:-1].title()} not found")
    await coll.update_one({"id": oid}, {"$pull": {"attachments": {"path": path}}})
    return await coll.find_one({"id": oid}, {"_id": 0})


@api_router.post("/invoices/{iid}/attachments", response_model=Invoice)
async def upload_invoice_file(iid: str, file: UploadFile = File(...), current: User = Depends(get_current_user)):
    d = await _voucher_attach("invoices", iid, file, current)
    return Invoice(**d)


@api_router.delete("/invoices/{iid}/attachments", response_model=Invoice)
async def delete_invoice_attachment(iid: str, path: str, current: User = Depends(get_current_user)):
    d = await _voucher_detach("invoices", iid, path)
    return Invoice(**d)


@api_router.post("/invoices/upload-signature")
async def upload_invoice_signature(file: UploadFile = File(...), current: User = Depends(get_current_user)):
    data = await file.read()
    if len(data) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Signature file exceeds 5 MB limit")
    ext = (file.filename or "signature.png").rsplit(".", 1)[-1].lower()
    if ext not in ["png", "jpg", "jpeg", "webp"]:
        ext = "png"
    sig_id = f"sig_{uuid.uuid4().hex[:12]}.{ext}"
    path = f"{APP_NAME}/uploads/signatures/{sig_id}"
    ct = file.content_type or f"image/{ext}"
    await run_in_threadpool(put_object, path, data, ct)
    sig_url = f"/api/invoices/signatures/{sig_id}"
    return {"signature_url": sig_url, "file_id": sig_id}


@api_router.get("/invoices/signatures/{file_id}")
async def get_invoice_signature(file_id: str):
    path = f"{APP_NAME}/uploads/signatures/{file_id}"
    try:
        content, ct = await run_in_threadpool(get_object, path)
        return Response(content=content, media_type=ct)
    except Exception:
        raise HTTPException(status_code=404, detail="Signature image not found")


@api_router.get("/system/logo")
async def get_system_company_logo():
    logo_file = ROOT_DIR / "assets" / "images" / "company-logo.jpg"
    if logo_file.exists():
        return FileResponse(str(logo_file), media_type="image/jpeg")
    # Fallback to frontend assets if needed
    fe_logo = ROOT_DIR.parent / "frontend" / "assets" / "images" / "company-logo.jpg"
    if fe_logo.exists():
        return FileResponse(str(fe_logo), media_type="image/jpeg")
    raise HTTPException(status_code=404, detail="Logo not found")



@api_router.post("/expenses/{eid}/attachments", response_model=Expense)
async def upload_expense_file(eid: str, file: UploadFile = File(...), current: User = Depends(get_current_user)):
    d = await _voucher_attach("expenses", eid, file, current)
    return Expense(**d)


@api_router.delete("/expenses/{eid}/attachments", response_model=Expense)
async def delete_expense_attachment(eid: str, path: str, current: User = Depends(get_current_user)):
    d = await _voucher_detach("expenses", eid, path)
    return Expense(**d)


@api_router.post("/income/{iid}/attachments", response_model=Income)
async def upload_income_file(iid: str, file: UploadFile = File(...), current: User = Depends(get_current_user)):
    d = await _voucher_attach("incomes", iid, file, current)
    return Income(**d)


@api_router.delete("/income/{iid}/attachments", response_model=Income)
async def delete_income_attachment(iid: str, path: str, current: User = Depends(get_current_user)):
    d = await _voucher_detach("incomes", iid, path)
    return Income(**d)


# ============ Accounting: Dashboard, Cash & Bank Book, Ledgers ============
def _sum(docs: list, key: str = "amount") -> float:
    return round(sum(float(d.get(key) or 0) for d in docs), 2)


@api_router.get("/accounting/dashboard")
async def accounting_dashboard(current: User = Depends(get_current_user)):
    from datetime import timedelta as _td
    today = datetime.now().strftime("%Y-%m-%d")
    yesterday = (datetime.now() - _td(days=1)).strftime("%Y-%m-%d")
    month = today[:7]

    inc_today = await db.income.find({"date": today}, {"_id": 0}).to_list(500)
    exp_today = await db.expenses.find({"date": today}, {"_id": 0}).to_list(500)
    inc_yest = await db.income.find({"date": yesterday}, {"_id": 0}).to_list(500)
    exp_yest = await db.expenses.find({"date": yesterday}, {"_id": 0}).to_list(500)
    inc_month = await db.income.find({"date": {"$regex": f"^{month}"}}, {"_id": 0}).to_list(2000)
    exp_month = await db.expenses.find({"date": {"$regex": f"^{month}"}, "status": {"$in": ["verified", "approved", "pending"]}}, {"_id": 0}).to_list(2000)
    all_inc = await db.income.find({}, {"_id": 0}).to_list(5000)
    all_exp = await db.expenses.find({"status": {"$in": ["verified", "approved", "pending"]}}, {"_id": 0}).to_list(5000)

    cash_income = _sum([d for d in all_inc if d.get("payment_mode") == "cash"])
    cash_expense = _sum([d for d in all_exp if d.get("payment_mode") == "cash"])
    cash_in_hand = round(cash_income - cash_expense, 2)

    bank_accounts = await db.bank_accounts.find({}, {"_id": 0}).to_list(200)
    bank_balances = []
    total_bank = 0.0
    for b in bank_accounts:
        cred = _sum([d for d in all_inc if d.get("bank_account_id") == b["id"]])
        deb = _sum([d for d in all_exp if d.get("bank_account_id") == b["id"]])
        bal = round(float(b.get("opening_balance") or 0) + cred - deb, 2)
        total_bank += bal
        bank_balances.append({"id": b["id"], "name": b["name"], "bank_name": b["bank_name"], "account_no": b["account_no"], "balance": bal})

    tasks = await db.tasks.find({}, {"_id": 0, "dues_amount": 1, "created_at": 1}).to_list(5000)
    total_outstanding = round(sum(float(t.get("dues_amount") or 0) for t in tasks if (t.get("dues_amount") or 0) > 0), 2)

    # Aging buckets from tasks
    now = datetime.now(timezone.utc)
    buckets = {"0-30": 0.0, "31-60": 0.0, "61-90": 0.0, "90+": 0.0}
    for t in tasks:
        due = float(t.get("dues_amount") or 0)
        if due <= 0: continue
        ca = t.get("created_at")
        if ca and hasattr(ca, "tzinfo"):
            if ca.tzinfo is None: ca = ca.replace(tzinfo=timezone.utc)
            age = (now - ca).days
        else: age = 0
        if age <= 30: buckets["0-30"] += due
        elif age <= 60: buckets["31-60"] += due
        elif age <= 90: buckets["61-90"] += due
        else: buckets["90+"] += due

    # Monthly series (last 7 months)
    series = []
    for i in range(6, -1, -1):
        d = (datetime.now() - _td(days=30 * i))
        ym = d.strftime("%Y-%m")
        mi = _sum([r for r in all_inc if (r.get("date") or "").startswith(ym)])
        me = _sum([r for r in all_exp if (r.get("date") or "").startswith(ym)])
        series.append({"label": d.strftime("%b"), "income": mi, "expense": me})

    # Top services / employees (this month)
    from collections import defaultdict
    svc_map, emp_map = defaultdict(float), defaultdict(float)
    for r in inc_month:
        svc_map[r.get("service_category") or "Other"] += float(r.get("amount") or 0)
        if r.get("employee_name"): emp_map[r["employee_name"]] += float(r.get("amount") or 0)
    top_services = [{"name": k, "amount": round(v, 2)} for k, v in sorted(svc_map.items(), key=lambda x: -x[1])[:5]]
    top_employees = [{"name": k, "amount": round(v, 2)} for k, v in sorted(emp_map.items(), key=lambda x: -x[1])[:5]]

    recent_collections = sorted(all_inc, key=lambda x: (x.get("date") or "", x.get("created_at") or ""), reverse=True)[:5]
    recent_expenses = sorted(all_exp, key=lambda x: (x.get("date") or "", x.get("created_at") or ""), reverse=True)[:5]

    return {
        "today_income": _sum(inc_today),
        "today_expense": _sum(exp_today),
        "yesterday_income": _sum(inc_yest),
        "yesterday_expense": _sum(exp_yest),
        "cash_in_hand": cash_in_hand,
        "total_bank": round(total_bank, 2),
        "bank_balances": bank_balances,
        "total_outstanding": total_outstanding,
        "outstanding_clients": sum(1 for t in tasks if (t.get("dues_amount") or 0) > 0),
        "pending_expense_approvals": await db.expenses.count_documents({"status": "pending"}),
        "month_income": _sum(inc_month),
        "month_expense": _sum(exp_month),
        "month_profit": round(_sum(inc_month) - _sum(exp_month), 2),
        "monthly_series": series,
        "top_services": top_services,
        "top_employees": top_employees,
        "recent_collections": recent_collections,
        "recent_expenses": recent_expenses,
        "aging_buckets": {k: round(v, 2) for k, v in buckets.items()},
    }


@api_router.get("/accounting/cash-book")
async def cash_book(from_date: Optional[str] = None, to_date: Optional[str] = None, current: User = Depends(get_current_user)):
    q_inc: dict = {"payment_mode": "cash"}
    q_exp: dict = {"payment_mode": "cash"}
    if from_date or to_date:
        d: dict = {}
        if from_date: d["$gte"] = from_date
        if to_date: d["$lte"] = to_date
        q_inc["date"] = d; q_exp["date"] = d
    inc = await db.income.find(q_inc, {"_id": 0}).to_list(2000)
    exp = await db.expenses.find(q_exp, {"_id": 0}).to_list(2000)
    entries = []
    for d in inc:
        entries.append({"date": d["date"], "type": "in", "amount": d["amount"], "party": d.get("client_name"), "category": d.get("service_category"), "no": d.get("income_no"), "id": d["id"]})
    for d in exp:
        entries.append({"date": d["date"], "type": "out", "amount": d["amount"], "party": d.get("vendor"), "category": d.get("category"), "no": d.get("expense_no"), "id": d["id"]})
    entries.sort(key=lambda x: x["date"])
    running = 0.0
    for e in entries:
        running += e["amount"] if e["type"] == "in" else -e["amount"]
        e["running"] = round(running, 2)
    total_in = _sum([e for e in entries if e["type"] == "in"])
    total_out = _sum([e for e in entries if e["type"] == "out"])
    return {"entries": entries, "total_in": total_in, "total_out": total_out, "closing": round(total_in - total_out, 2)}


@api_router.get("/accounting/bank-book")
async def bank_book(bank_id: str, from_date: Optional[str] = None, to_date: Optional[str] = None, current: User = Depends(get_current_user)):
    b = await db.bank_accounts.find_one({"id": bank_id}, {"_id": 0})
    if not b: raise HTTPException(status_code=404, detail="Bank account not found")
    q_inc: dict = {"bank_account_id": bank_id}
    q_exp: dict = {"bank_account_id": bank_id}
    if from_date or to_date:
        d: dict = {}
        if from_date: d["$gte"] = from_date
        if to_date: d["$lte"] = to_date
        q_inc["date"] = d; q_exp["date"] = d
    inc = await db.income.find(q_inc, {"_id": 0}).to_list(2000)
    exp = await db.expenses.find(q_exp, {"_id": 0}).to_list(2000)
    entries = []
    for d in inc:
        entries.append({"date": d["date"], "type": "credit", "amount": d["amount"], "party": d.get("client_name"), "category": d.get("service_category"), "no": d.get("income_no"), "id": d["id"]})
    for d in exp:
        entries.append({"date": d["date"], "type": "debit", "amount": d["amount"], "party": d.get("vendor"), "category": d.get("category"), "no": d.get("expense_no"), "id": d["id"]})
    entries.sort(key=lambda x: x["date"])
    running = float(b.get("opening_balance") or 0)
    for e in entries:
        running += e["amount"] if e["type"] == "credit" else -e["amount"]
        e["running"] = round(running, 2)
    return {"bank": b, "entries": entries, "closing": round(running, 2)}


@api_router.get("/accounting/client-ledger")
async def client_ledger(client_id: str, current: User = Depends(get_current_user)):
    client = await db.customers.find_one({"id": client_id}, {"_id": 0})
    if not client: raise HTTPException(status_code=404, detail="Client not found")
    inc = await db.income.find({"client_id": client_id}, {"_id": 0}).sort("date", -1).to_list(1000)
    # Total service value + dues from tasks (basic linking: matching customer via voucher_no or assignee — here we just show all tasks with this client via task.description or nothing)
    total_received = _sum(inc)
    return {
        "client": {"id": client["id"], "name": client["name"], "mobile": client.get("mobile"), "customer_code": client.get("customer_code")},
        "income_entries": inc,
        "total_received": total_received,
    }


# ============ HR: Attendance ============
@api_router.post("/attendance", response_model=Attendance)
async def mark_attendance(payload: AttendanceInput, current: User = Depends(get_current_user)):
    existing = await db.attendance.find_one({"user_id": current.user_id, "date": payload.date}, {"_id": 0})
    if existing:
        await db.attendance.update_one({"id": existing["id"]}, {"$set": payload.dict()})
        d = await db.attendance.find_one({"id": existing["id"]}, {"_id": 0})
        return Attendance(**d)
    a = Attendance(**payload.dict(), user_id=current.user_id, user_name=current.name)
    await db.attendance.insert_one(a.dict())
    return a


@api_router.get("/attendance", response_model=List[Attendance])
async def list_attendance(current: User = Depends(get_current_user)):
    q = {} if current.role in ("admin", "manager") else {"user_id": current.user_id}
    docs = await db.attendance.find(q, {"_id": 0}).sort("date", -1).to_list(500)
    return [Attendance(**d) for d in docs]


# HR Leaves handled by modular leave_routes router


# ============ Tenders ============
async def _save_tender_file(current: User, file: UploadFile) -> dict:
    data = await file.read()
    if len(data) > 25 * 1024 * 1024:  # tenders can be a bit bigger, 25 MB cap
        raise HTTPException(status_code=400, detail="File exceeds 25 MB limit")
    ext = (file.filename or "file").rsplit(".", 1)[-1].lower()
    ext = ext if len(ext) <= 8 else "bin"
    path = f"{APP_NAME}/uploads/{current.user_id}/{uuid.uuid4().hex}.{ext}"
    ct = file.content_type or "application/octet-stream"
    await run_in_threadpool(put_object, path, data, ct)
    return {
        "path": path, "name": file.filename or f"file.{ext}", "size": len(data),
        "content_type": ct, "uploaded_at": now_utc().isoformat(), "uploaded_by": current.user_id,
    }


@api_router.post("/tenders", response_model=Tender)
async def create_tender(payload: TenderInput, current: User = Depends(get_current_user)):
    counter = await db.counters.find_one_and_update(
        {"_id": "tender_code"}, {"$inc": {"seq": 1}}, upsert=True, return_document=ReturnDocument.AFTER,
    )
    seq = (counter or {}).get("seq") or 1
    tender_code = f"TND-{seq:04d}"
    t = Tender(**payload.dict(), tender_code=tender_code, title=payload.name_of_work,
               submission_deadline=payload.last_date, value=payload.estimated_cost,
               created_by=current.user_id)
    await db.tenders.insert_one(t.dict())
    return t


@api_router.get("/tenders", response_model=List[Tender])
async def list_tenders(current: User = Depends(get_current_user)):
    docs = await db.tenders.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return [Tender(**d) for d in docs]


@api_router.get("/tenders/{tid}", response_model=Tender)
async def get_tender(tid: str, current: User = Depends(get_current_user)):
    d = await db.tenders.find_one({"id": tid}, {"_id": 0})
    if not d:
        raise HTTPException(status_code=404, detail="Not found")
    return Tender(**d)


@api_router.patch("/tenders/{tid}", response_model=Tender)
async def update_tender(tid: str, payload: TenderInput, current: User = Depends(get_current_user)):
    updates = payload.dict()
    updates["title"] = payload.name_of_work
    updates["value"] = payload.estimated_cost
    updates["submission_deadline"] = payload.last_date
    await db.tenders.update_one({"id": tid}, {"$set": updates})
    d = await db.tenders.find_one({"id": tid}, {"_id": 0})
    if not d:
        raise HTTPException(status_code=404, detail="Not found")
    return Tender(**d)


@api_router.delete("/tenders/{tid}")
async def delete_tender(tid: str, current: User = Depends(require_admin_or_manager)):
    res = await db.tenders.delete_one({"id": tid})
    return {"deleted": res.deleted_count}


@api_router.post("/tenders/{tid}/nit-copy", response_model=Tender)
async def upload_nit_copy(tid: str, file: UploadFile = File(...), current: User = Depends(get_current_user)):
    d = await db.tenders.find_one({"id": tid}, {"_id": 0})
    if not d: raise HTTPException(status_code=404, detail="Tender not found")
    meta = await _save_tender_file(current, file)
    await db.tenders.update_one({"id": tid}, {"$set": {"nit_copy": meta}})
    d2 = await db.tenders.find_one({"id": tid}, {"_id": 0})
    return Tender(**d2)


@api_router.post("/tenders/{tid}/boq", response_model=Tender)
async def upload_boq(tid: str, file: UploadFile = File(...), current: User = Depends(get_current_user)):
    d = await db.tenders.find_one({"id": tid}, {"_id": 0})
    if not d: raise HTTPException(status_code=404, detail="Tender not found")
    meta = await _save_tender_file(current, file)
    await db.tenders.update_one({"id": tid}, {"$set": {"boq": meta}})
    d2 = await db.tenders.find_one({"id": tid}, {"_id": 0})
    return Tender(**d2)


@api_router.post("/tenders/{tid}/documents", response_model=Tender)
async def upload_tender_document(tid: str, file: UploadFile = File(...), current: User = Depends(get_current_user)):
    d = await db.tenders.find_one({"id": tid}, {"_id": 0})
    if not d: raise HTTPException(status_code=404, detail="Tender not found")
    meta = await _save_tender_file(current, file)
    await db.tenders.update_one({"id": tid}, {"$push": {"other_documents": meta}})
    d2 = await db.tenders.find_one({"id": tid}, {"_id": 0})
    return Tender(**d2)


@api_router.delete("/tenders/{tid}/documents", response_model=Tender)
async def delete_tender_document(tid: str, path: str, current: User = Depends(get_current_user)):
    await db.tenders.update_one({"id": tid}, {"$pull": {"other_documents": {"path": path}}})
    d = await db.tenders.find_one({"id": tid}, {"_id": 0})
    return Tender(**d)


# Legacy single-file upload — keep so any lingering UI works
@api_router.post("/tenders/{tid}/upload", response_model=Tender)
async def upload_tender_file(tid: str, file: UploadFile = File(...), current: User = Depends(get_current_user)):
    d = await db.tenders.find_one({"id": tid}, {"_id": 0})
    if not d:
        raise HTTPException(status_code=404, detail="Tender not found")
    meta = await _save_tender_file(current, file)
    await db.tenders.update_one({"id": tid}, {"$set": {"other_documents_legacy": meta, "file_path": meta["path"], "file_name": meta["name"]}, "$push": {"other_documents": meta}})
    d2 = await db.tenders.find_one({"id": tid}, {"_id": 0})
    return Tender(**d2)


@api_router.get("/files/{full_path:path}")
async def download_file(full_path: str, token: Optional[str] = None, authorization: Optional[str] = Header(None)):
    # allow token via query for <img> tags on web
    if not authorization and token:
        authorization = f"Bearer {token}"
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing token")
    tok = authorization.split(" ", 1)[1].strip()
    session = await db.user_sessions.find_one({"session_token": tok}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=401, detail="Invalid session")
    # ownership: verify path belongs to a tender the user can access (any authenticated user for now)
    data, ct = await run_in_threadpool(get_object, full_path)
    return Response(content=data, media_type=ct)


# ============ Office Settings ============
async def get_office_settings_doc() -> dict:
    doc = await db.office_settings.find_one({"_id": "singleton"}, {"_id": 0})
    if not doc:
        default = OfficeSettings().dict()
        await db.office_settings.insert_one({"_id": "singleton", **default})
        return default
    return doc


@api_router.get("/office-settings", response_model=OfficeSettings)
async def get_office_settings(current: User = Depends(get_current_user)):
    doc = await get_office_settings_doc()
    return OfficeSettings(**doc)


@api_router.put("/office-settings", response_model=OfficeSettings)
async def update_office_settings(payload: OfficeSettingsInput, current: User = Depends(require_admin)):
    updates = {k: v for k, v in payload.dict().items() if v is not None}
    if updates:
        await db.office_settings.update_one({"_id": "singleton"}, {"$set": updates}, upsert=True)
    doc = await get_office_settings_doc()
    return OfficeSettings(**doc)


# ============ Offices (multi-office) ============
@api_router.get("/offices", response_model=List[Office])
async def list_offices(current: User = Depends(get_current_user)):
    docs = await db.offices.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)
    return [Office(**d) for d in docs]


@api_router.post("/offices", response_model=Office)
async def create_office(payload: OfficeInput, current: User = Depends(require_admin)):
    o = Office(**payload.dict())
    await db.offices.insert_one(o.dict())
    return o


@api_router.patch("/offices/{oid}", response_model=Office)
async def update_office(oid: str, payload: OfficeUpdate, current: User = Depends(require_admin)):
    updates = {k: v for k, v in payload.dict().items() if v is not None}
    if updates:
        await db.offices.update_one({"id": oid}, {"$set": updates})
    d = await db.offices.find_one({"id": oid}, {"_id": 0})
    if not d:
        raise HTTPException(status_code=404, detail="Not found")
    return Office(**d)


@api_router.delete("/offices/{oid}")
async def delete_office(oid: str, current: User = Depends(require_admin)):
    res = await db.offices.delete_one({"id": oid})
    return {"deleted": res.deleted_count}


# ============ Punches ============
def _haversine_m(lat1, lng1, lat2, lng2) -> float:
    import math
    R = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def _parse_hhmm(s: str) -> tuple:
    try:
        h, m = s.split(":")
        return int(h), int(m)
    except Exception:
        return 9, 0


@api_router.post("/punches", response_model=PunchRecord)
async def create_punch(
    type: str = Form(...),  # "in" or "out"
    lat: Optional[float] = Form(None),
    lng: Optional[float] = Form(None),
    accuracy: Optional[float] = Form(None),
    place_name: Optional[str] = Form(None),
    selfie: UploadFile = File(...),
    current: User = Depends(get_current_user),
):
    if type not in ("in", "out"):
        raise HTTPException(status_code=400, detail="type must be 'in' or 'out'")

    now = datetime.now(timezone.utc)
    # local IST for date/time display (server can be UTC)
    ist = now.astimezone(tz=None) if True else now
    date_str = ist.strftime("%Y-%m-%d")
    time_str = ist.strftime("%H:%M:%S")

    # Enforce 10 punches per day (counting both in+out)
    todays = await db.punches.count_documents({"user_id": current.user_id, "date": date_str})
    if todays >= 10:
        raise HTTPException(status_code=400, detail="Daily punch limit reached (10)")

    # Selfie mandatory for Face Recognition verification
    if not selfie:
        raise HTTPException(status_code=400, detail="Selfie photo is mandatory for face verification")
    data = await selfie.read()
    if not data:
        raise HTTPException(status_code=400, detail="Selfie is empty")
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Selfie exceeds 10 MB limit")

    settings = await get_office_settings_doc()

    # Resolve employee's assigned branch or office
    emp = await db.employees.find_one({"email": current.email}, {"_id": 0})
    if not emp:
        counter = await db.counters.find_one_and_update(
            {"_id": "employee_code"},
            {"$inc": {"seq": 1}},
            upsert=True,
            return_document=ReturnDocument.AFTER,
        )
        seq = (counter or {}).get("seq") or 1
        ddmmyyyy = _ddmmyyyy(None)
        stub = Employee(
            name=current.name, email=current.email, role=current.role,
            employee_code=f"TDSC{seq:02d}{ddmmyyyy}",
        )
        await db.employees.insert_one(stub.dict())
        emp = stub.dict()

    office = None
    if emp.get("office_id"):
        office = await db.offices.find_one({"id": emp["office_id"]}, {"_id": 0})
        if not office:
            office = await db.branches.find_one({"$or": [{"id": emp["office_id"]}, {"branch_id": emp["office_id"]}]}, {"_id": 0})
    if not office and emp.get("posting_branch"):
        office = await db.branches.find_one({"$or": [{"name": emp["posting_branch"]}, {"branch_id": emp["posting_branch"]}]}, {"_id": 0})

    # Search nearest branch or office from coordinates
    nearest_place = None
    min_distance = 999999999.0
    if lat is not None and lng is not None:
        branches = await db.branches.find({"status": "active"}, {"_id": 0}).to_list(100)
        offices = await db.offices.find({}, {"_id": 0}).to_list(100)
        for loc in (branches + offices):
            llat = loc.get("lat") or loc.get("latitude")
            llng = loc.get("lng") or loc.get("longitude")
            if llat is not None and llng is not None:
                d = _haversine_m(lat, lng, float(llat), float(llng))
                if d < min_distance:
                    min_distance = d
                    nearest_place = loc

    # If employee has no explicitly assigned office, fall back to nearest active branch/office
    if not office and nearest_place:
        office = nearest_place

    within = True
    distance = None
    if office and lat is not None and lng is not None:
        olat = office.get("lat") or office.get("latitude")
        olng = office.get("lng") or office.get("longitude")
        if olat is not None and olng is not None:
            distance = _haversine_m(lat, lng, float(olat), float(olng))
            radius = int(office.get("radius_m") or 200)
            within = distance <= radius

    if type == "in":
        if lat is None or lng is None:
            raise HTTPException(status_code=400, detail="GPS location coordinates required for punch-in")
        if office and not within:
            strict = settings.get("strict_geofence", False)
            if strict and current.role not in ("admin", "manager"):
                radius = int(office.get("radius_m") or 200)
                raise HTTPException(status_code=400, detail=f"You are {int(distance)}m from '{office.get('name')}'. Must be within {radius}m to punch in.")

    # Resolve display place name
    resolved_place = place_name
    if not resolved_place:
        if office and distance is not None and within:
            resolved_place = f"{office.get('name')} (On-Site)"
        elif nearest_place and min_distance < 1000:
            resolved_place = f"{nearest_place.get('name')}"
        elif office:
            resolved_place = f"{office.get('name')} ({int(distance)}m away)" if distance is not None else office.get("name")
        else:
            resolved_place = "Mobile Field / GPS Location"

    # Late detection on punch-in
    is_late = False
    if type == "in":
        sh, sm = _parse_hhmm(settings.get("start_time") or "09:00")
        grace = int(settings.get("grace_minutes") or 0)
        limit = ist.replace(hour=sh, minute=sm, second=0, microsecond=0) + timedelta(minutes=grace)
        is_late = ist > limit

    # Upload selfie photo to object storage
    ext = (selfie.filename or "img").rsplit(".", 1)[-1].lower()
    ext = ext if len(ext) <= 8 else "jpg"
    path = f"{APP_NAME}/uploads/{current.user_id}/{uuid.uuid4().hex}.{ext}"
    await run_in_threadpool(put_object, path, data, selfie.content_type or "image/jpeg")

    emp_code = emp.get("employee_code") if emp else None

    rec = PunchRecord(
        user_id=current.user_id,
        user_name=current.name,
        employee_code=emp_code,
        office_id=(office or {}).get("id"),
        office_name=(office or {}).get("name"),
        place_name=resolved_place,
        type=type,
        date=date_str,
        time=time_str,
        lat=lat,
        lng=lng,
        accuracy=accuracy,
        distance_m=distance,
        within_geofence=within,
        is_late=is_late,
        face_verified=True,
        selfie_path=path,
    )
    await db.punches.insert_one(rec.dict())
    return rec


@api_router.get("/punches", response_model=List[PunchRecord])
async def list_punches(date: Optional[str] = None, month: Optional[str] = None, user_id: Optional[str] = None, current: User = Depends(get_current_user)):
    q: dict = {}
    if current.role in ("admin", "manager"):
        if user_id:
            q["user_id"] = user_id
    else:
        q["user_id"] = current.user_id
    if date:
        q["date"] = date
    if month:  # YYYY-MM
        q["date"] = {"$regex": f"^{month}"}
    docs = await db.punches.find(q, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return [PunchRecord(**d) for d in docs]


@api_router.get("/punches/today/summary")
async def today_summary(current: User = Depends(get_current_user)):
    date_str = datetime.now().strftime("%Y-%m-%d")
    docs = await db.punches.find({"user_id": current.user_id, "date": date_str}, {"_id": 0}).sort("created_at", 1).to_list(50)
    ins = [d for d in docs if d["type"] == "in"]
    outs = [d for d in docs if d["type"] == "out"]
    late_count = sum(1 for d in ins if d.get("is_late"))
    return {
        "date": date_str,
        "count": len(docs),
        "remaining": max(0, 10 - len(docs)),
        "last_type": docs[-1]["type"] if docs else None,
        "last_time": docs[-1]["time"] if docs else None,
        "punches_in": len(ins),
        "punches_out": len(outs),
        "late_count": late_count,
        "records": docs,
    }


@api_router.get("/punches/all-today")
async def get_all_punches_today(date: Optional[str] = None, current: User = Depends(get_current_user)):
    target_date = date or datetime.now().strftime("%Y-%m-%d")
    q: dict = {"date": target_date}
    if current.role not in ("admin", "manager"):
        q["user_id"] = current.user_id
    docs = await db.punches.find(q, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return docs


# ============ Payroll ============
@api_router.get("/payroll")
async def payroll_summary(month: str, current: User = Depends(require_admin_or_manager)):
    # month = YYYY-MM
    settings = await get_office_settings_doc()
    working_days = int(settings.get("working_days_per_month") or 26)
    fine_per_day = float(settings.get("late_fine_per_day") or 0)
    employees = await db.employees.find({}, {"_id": 0}).to_list(500)
    result = []
    for e in employees:
        gross = float(e.get("gross_amount") or 0)
        per_day = gross / working_days if working_days else 0

        # Attendance: distinct dates with at least one punch-in this month
        dates = await db.punches.distinct("date", {
            "user_id": {"$exists": True},
            "type": "in",
            "date": {"$regex": f"^{month}"},
        })
        # Filter dates to this employee via email->user
        user_doc = await db.users.find_one({"email": e.get("email")}, {"_id": 0, "user_id": 1})
        emp_user_id = user_doc.get("user_id") if user_doc else None
        emp_dates = []
        if emp_user_id:
            emp_dates = await db.punches.distinct("date", {"user_id": emp_user_id, "type": "in", "date": {"$regex": f"^{month}"}})
        days_present = len(emp_dates)

        # Late days this month
        late_days = 0
        if emp_user_id:
            late_days = await db.punches.count_documents({"user_id": emp_user_id, "type": "in", "is_late": True, "date": {"$regex": f"^{month}"}})

        earned = round(per_day * days_present, 2)
        late_fine = round(fine_per_day * late_days, 2)
        deductions = float(e.get("ded_epfo") or 0) + float(e.get("ded_esic") or 0) + float(e.get("ded_advance") or 0) + float(e.get("ded_other") or 0)
        net = round(earned - late_fine - deductions, 2)
        result.append({
            "employee_id": e.get("id"),
            "employee_code": e.get("employee_code"),
            "name": e.get("name"),
            "designation": e.get("designation"),
            "gross_configured": gross,
            "per_day": round(per_day, 2),
            "days_present": days_present,
            "working_days": working_days,
            "earned": earned,
            "late_days": late_days,
            "late_fine": late_fine,
            "deductions": round(deductions, 2),
            "net_payable": net,
        })
    return {"month": month, "settings": {"working_days_per_month": working_days, "late_fine_per_day": fine_per_day}, "employees": result}


# ============ Dashboard ============
@api_router.get("/dashboard/summary")
async def dashboard_summary(current: User = Depends(get_current_user)):
    customers = await db.customers.count_documents({})
    employees = await db.employees.count_documents({})
    branches = await db.branches.count_documents({})
    total_tasks = await db.tasks.count_documents({})
    open_tasks = await db.tasks.count_documents({"status": {"$in": ["todo", "doing"]}})
    open_tenders = await db.tenders.count_documents({"status": "open"})
    pending_leaves = await db.leaves.count_documents({"status": "pending"})
    accounts_pending = await db.accounts.count_documents({"status": "pending"})
    urgent = await db.tenders.find({"status": "open"}, {"_id": 0}).sort("submission_deadline", 1).to_list(3)
    return {
        "customers": customers,
        "employees": employees,
        "branches": branches,
        "tasks_total": total_tasks,
        "tasks_open": open_tasks,
        "open_tenders": open_tenders,
        "pending_leaves": pending_leaves,
        "accounts_pending": accounts_pending,
        "urgent_tenders": [Tender(**t).dict() for t in urgent],
    }


@api_router.get("/")
async def root():
    return {"service": "Triveni Business Manager API", "status": "ok"}


@api_router.get("/health")
async def api_health():
    return {"status": "ok"}


@app.api_route("/health", methods=["GET", "HEAD"], include_in_schema=False)
async def app_health():
    return {"status": "ok"}


@app.api_route("/", methods=["GET", "HEAD"], include_in_schema=False)
async def app_root(request: Request):
    """Serve frontend index.html if available, otherwise return health probe."""
    public_index = ROOT_DIR / "public" / "index.html"
    accept = request.headers.get("accept", "")
    if public_index.exists() and "application/json" not in accept:
        return FileResponse(str(public_index))
    return {"service": "Triveni Business Manager API", "status": "ok"}


# ============ Startup ============
@app.on_event("startup")
async def startup():
    try:
        await db.users.create_index("email", unique=True)
        await db.users.create_index("user_id", unique=True)
        await db.user_sessions.create_index("session_token", unique=True)
        await db.user_sessions.create_index("user_id")
        await db.user_sessions.create_index("expires_at", expireAfterSeconds=0)
        await db.customers.create_index("id", unique=True)
        await db.employees.create_index("id", unique=True)
        await db.tasks.create_index("id", unique=True)
        await db.accounts.create_index("id", unique=True)
        await db.tenders.create_index("id", unique=True)
        await db.attendance.create_index("id", unique=True)
        await db.leaves.create_index("id", unique=True)
        await db.customer_custom_fields.create_index("id", unique=True)
        await db.customer_custom_fields.create_index("field_key", unique=True)

        # Migration: TRV-CUST-XXXX → TDSC-CUST-ID-00000XXX (8-digit padded)
        try:
            cursor = db.customers.find({"customer_code": {"$regex": "^TRV-CUST-"}}, {"_id": 0, "id": 1, "customer_code": 1})
            legacy = await cursor.to_list(10000)
            max_seq = 0
            migrated = 0
            for c in legacy:
                old = c.get("customer_code") or ""
                try:
                    seq = int(old.rsplit("-", 1)[-1])
                except Exception:
                    continue
                if seq > max_seq: max_seq = seq
                new_code = f"TDSC-CUST-ID-{seq:08d}"
                await db.customers.update_one({"id": c["id"]}, {"$set": {"customer_code": new_code}})
                # Also propagate to tasks with denormalised customer_code
                await db.tasks.update_many({"customer_code": old}, {"$set": {"customer_code": new_code}})
                migrated += 1
            if migrated > 0:
                # Bump counter so future codes continue from max_seq
                counter_doc = await db.counters.find_one({"_id": "customer_code"}, {"_id": 0}) or {}
                current_seq = int(counter_doc.get("seq") or 0)
                if current_seq < max_seq:
                    await db.counters.update_one({"_id": "customer_code"}, {"$set": {"seq": max_seq}}, upsert=True)
                logger.info("Migrated %d customer_codes from TRV-CUST-* to TDSC-CUST-ID-* format", migrated)
        except Exception as _e:
            logger.exception("Customer code migration failed: %s", _e)

        # Seed administrative accounts (Super Admin & Admin) if explicitly provided in environment
        super_email = os.environ.get("SEED_SUPERADMIN_EMAIL", "superadmin@triveni.com")
        super_pass = os.environ.get("SEED_SUPERADMIN_PASSWORD")
        existing_super = await db.users.find_one({"$or": [{"email": super_email}, {"role": "super_admin"}]})
        if not existing_super and super_pass:
            s_admin = User(user_id=new_id("usr"), email=super_email, name="Super Admin", role="super_admin")
            s_doc = s_admin.dict()
            s_doc["role_id"] = "super_admin"
            s_doc["role_name"] = "Super Admin"
            s_doc["status"] = "active"
            s_doc["password_hash"] = hash_password(super_pass)
            await db.users.insert_one(s_doc)
            logger.info("Seeded initial Super Admin: %s", super_email)
        elif existing_super and existing_super.get("role") != "super_admin":
            await db.users.update_one({"_id": existing_super["_id"]}, {"$set": {"role": "super_admin", "role_id": "super_admin"}})

        admin_email = os.environ.get("SEED_ADMIN_EMAIL", "admin@triveni.com")
        admin_pass = os.environ.get("SEED_ADMIN_PASSWORD")
        existing_admin = await db.users.find_one({"email": admin_email})
        if not existing_admin and admin_pass:
            admin = User(user_id=new_id("usr"), email=admin_email, name="Triveni Admin", role="admin")
            doc = admin.dict()
            doc["role_id"] = "admin"
            doc["role_name"] = "Administrator"
            doc["status"] = "active"
            doc["password_hash"] = hash_password(admin_pass)
            await db.users.insert_one(doc)
            logger.info("Seeded initial Admin: %s", admin_email)

        try:
            await run_in_threadpool(init_storage)
            logger.info("Storage initialized")
        except Exception as e:
            logger.warning(f"Storage init failed at startup (non-fatal): {e}")

        # Seed default workflow + task types
        try:
            await _ensure_seed_workflows_and_types()
        except Exception as e:
            logger.warning(f"Seed workflows failed: {e}")

        # Ensure indexes for enterprise modules
        try:
            await db.branches.create_index("id", unique=True)
            await db.branches.create_index("branch_id", unique=True)
            await db.posts.create_index("id", unique=True)
            await db.posts.create_index("post_id", unique=True)
            await db.roles.create_index("id", unique=True)
            await db.roles.create_index("role_id", unique=True)
            await db.services.create_index("id", unique=True)
            await db.services.create_index("service_id", unique=True)
            await db.audit_logs.create_index("id", unique=True)
            await db.notifications.create_index("id", unique=True)
            await db.gps_tracking.create_index("id", unique=True)
            await db.estimates.create_index("id", unique=True)
            await db.proforma_invoices.create_index("id", unique=True)
            await db.delivery_challans.create_index("id", unique=True)
            await init_customer_portal_indexes(db)
        except Exception as _ie:
            logger.warning(f"Indexes init: {_ie}")
    except Exception as e:
        logger.error(f"Startup error: {e}")


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()


# Mount all TDSC-OMS enterprise modular routers
api_router.include_router(make_branch_router(db, get_current_user, require_admin, log_audit_entry))
api_router.include_router(make_post_router(db, get_current_user, require_admin, log_audit_entry))
api_router.include_router(make_role_router(db, get_current_user, require_admin, log_audit_entry))
api_router.include_router(make_user_router(db, get_current_user, require_admin, hash_password, put_object, get_object, log_audit_entry))
api_router.include_router(make_service_router(db, get_current_user, require_admin, log_audit_entry))
api_router.include_router(make_audit_router(db, get_current_user, require_admin))
api_router.include_router(make_notification_router(db, get_current_user))
api_router.include_router(make_customer_vault_router(db, get_current_user, require_admin_or_manager))
api_router.include_router(make_accounting_extra_router(db, get_current_user, require_admin, require_admin_or_manager))
api_router.include_router(make_gps_router(db, get_current_user, require_admin_or_manager))
api_router.include_router(make_task_workflow_router(db, get_current_user, require_admin, require_admin_or_manager))
api_router.include_router(make_system_operations_router(db, get_current_user, require_admin))
api_router.include_router(make_leave_router(db, get_current_user, require_admin, require_admin_or_manager, log_audit_entry))
api_router.include_router(make_payroll_router(db, get_current_user, require_admin, require_admin_or_manager, log_audit_entry))
api_router.include_router(make_tender_management_router(db, get_current_user, require_admin, require_admin_or_manager, log_audit_entry))
api_router.include_router(make_document_library_router(db, get_current_user, require_admin, require_admin_or_manager, put_object, log_audit_entry))
api_router.include_router(make_tender_calling_router(db, get_current_user, require_admin, require_admin_or_manager, log_audit_entry))
api_router.include_router(make_accounting_reports_router(db, get_current_user, require_admin, require_admin_or_manager))
api_router.include_router(make_cash_bank_router(db, get_current_user, require_admin, require_admin_or_manager, log_audit_entry, prefix="/accounting/cash-bank"))
api_router.include_router(make_cash_bank_router(db, get_current_user, require_admin, require_admin_or_manager, log_audit_entry, prefix="/cash-bank"))
api_router.include_router(make_task_chat_router(db, get_current_user, require_admin))
api_router.include_router(make_service_workflow_router(db, get_current_user, require_admin))
api_router.include_router(make_district_router(db, get_current_user, require_admin, log_audit_entry))
api_router.include_router(make_expense_approval_router(db, get_current_user, require_admin, log_audit_entry))
app.include_router(make_service_request_router(db, get_current_user, require_admin, require_admin_or_manager, log_audit_entry, LOCAL_STORAGE_DIR))
app.include_router(api_router)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve static frontend production build from backend/public
public_dir = ROOT_DIR / "public"
if public_dir.exists():
    from starlette.staticfiles import StaticFiles

    expo_dir = public_dir / "_expo"
    if expo_dir.exists():
        app.mount("/_expo", StaticFiles(directory=str(expo_dir)), name="expo_static")
    assets_dir = public_dir / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets_static")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_spa_app(full_path: str):
        if full_path.startswith("api/") or full_path == "api" or full_path.startswith("docs") or full_path.startswith("openapi.json"):
            raise HTTPException(status_code=404)
        target = public_dir / full_path
        if target.exists() and target.is_file():
            return FileResponse(str(target))
        index_file = public_dir / "index.html"
        if index_file.exists():
            return FileResponse(str(index_file), headers={"Cache-Control": "no-cache, no-store, must-revalidate"})
        raise HTTPException(status_code=404, detail="SPA not found")

