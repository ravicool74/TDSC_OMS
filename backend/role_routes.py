from datetime import datetime, timezone
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

def now_utc() -> datetime:
    return datetime.now(timezone.utc)

ALL_MODULES = [
    "dashboard", "branches", "posts", "users", "roles", "customers", "services",
    "tasks", "sales", "purchases", "expenses", "banking", "employees", "payroll",
    "attendance", "leaves", "gps_tracking", "documents", "reports", "notifications",
    "audit_logs", "settings"
]

ALL_ACTIONS = [
    "view", "add", "edit", "delete", "print", "download", "share",
    "approve", "reject", "cancel", "export"
]

# The 4 Primary Types of Menu defined by Triveni OMS specifications:
# (i) Dashboard
# (ii) Business
# (iii) Task
# (iv) More
FOUR_MENU_STRUCTURE = {
    "dashboard": {
        "title": "Dashboard",
        "description": "System dashboard metrics, summaries, and action triggers",
        "items": [
            {
                "key": "financial_overview",
                "title": "Financial Overview",
                "description": "Today's Sales, To Receive, To Pay summaries",
                "icon": "cash-outline",
            },
            {
                "key": "operations_metrics",
                "title": "Operations Metrics",
                "description": "Pending Tasks, Clients, Staff, Branches, Open Tenders, Leave Req",
                "icon": "speedometer-outline",
            },
            {
                "key": "urgent_tenders",
                "title": "Urgent Tenders",
                "description": "Imminent tender deadlines, earnest deposits, live bids",
                "icon": "document-text-outline",
            },
            {
                "key": "quick_actions",
                "title": "Quick Actions",
                "description": "Direct launch tiles (Add Customer, New Task, Sale Invoice, Field GPS, etc.)",
                "icon": "flash-outline",
            },
        ],
    },
    "business": {
        "title": "Business",
        "description": "Contractor accounts, customer records, and ledger vouchers",
        "items": [
            {
                "key": "customers",
                "title": "Customers",
                "description": "Contractors & Customers Database, PAN/Aadhar KYC, Documents, Export",
                "icon": "people-outline",
            },
            {
                "key": "accounts",
                "title": "Accounts",
                "description": "Sales Invoices, Payments-In, Returns, Estimates, Challans, Purchases, Cash & Bank",
                "icon": "wallet-outline",
            },
        ],
    },
    "task": {
        "title": "Task",
        "description": "Operations execution, client workflows, and collection follow-ups",
        "items": [
            {
                "key": "payment_followup",
                "title": "Payment Followup",
                "description": "Payment pending tasks, dues tracking, collection reminders, cleared status",
                "icon": "card-outline",
            },
            {
                "key": "task_followup",
                "title": "Task Follow up",
                "description": "Service workflows, stage movement, forward/return, approvals, chat, activity log",
                "icon": "checkmark-done-circle-outline",
            },
        ],
    },
    "more": {
        "title": "More",
        "description": "Extended operational services, HR management, and enterprise administration",
        "sections": [
            {
                "section_key": "operations_services",
                "section_title": "Operations & Services",
                "items": [
                    {"key": "customers", "title": "Contractors & Customers Database", "icon": "people", "route": "/customers"},
                    {"key": "accounting", "title": "Accounting & Invoices", "icon": "wallet", "route": "/accounting/menu"},
                    {"key": "reports", "title": "Financial & Accounting Reports", "icon": "bar-chart", "route": "/accounting/reports"},
                    {"key": "services", "title": "Service Master & Workflows", "icon": "construct", "route": "/services"},
                    {"key": "expiry_alerts", "title": "Document & DSC Expiry Alerts", "icon": "alert-circle", "route": "/customers/expiry-alerts"},
                    {"key": "gps_tracking", "title": "Field Staff GPS Tracking", "icon": "navigate", "route": "/gps/tracking"},
                    {"key": "documents", "title": "Document Library", "icon": "folder-open", "route": "/documents"},
                    {"key": "tenders", "title": "Tender Management", "icon": "document-text", "route": "/tenders"},
                    {"key": "tender_calling", "title": "Tender Calling & Follow-up", "icon": "call", "route": "/tenders?tab=calling"},
                    {"key": "simple_accounts", "title": "Simple Accounts", "icon": "cash", "route": "/(tabs)/business"},
                ],
            },
            {
                "section_key": "human_resources",
                "section_title": "Human Resources",
                "items": [
                    {"key": "employees", "title": "Employees Directory", "icon": "people", "route": "/employees"},
                    {"key": "attendance_leaves", "title": "Attendance & Leaves", "icon": "calendar", "route": "/hr"},
                    {"key": "payroll", "title": "Payroll & Salary Slips", "icon": "card", "route": "/payroll"},
                    {"key": "attendance_settings", "title": "Attendance Settings", "icon": "time", "route": "/attendance-settings"},
                ],
            },
            {
                "section_key": "enterprise_administration",
                "section_title": "Enterprise Administration",
                "items": [
                    {"key": "branches", "title": "Branch Management", "icon": "business", "route": "/admin/branches"},
                    {"key": "posts", "title": "Post / Designations", "icon": "ribbon", "route": "/admin/posts"},
                    {"key": "users", "title": "System User Directory", "icon": "person-add", "route": "/admin/users"},
                    {"key": "roles", "title": "Roles & RBAC Matrix", "icon": "shield-checkmark", "route": "/admin/roles"},
                    {"key": "audit_logs", "title": "Security Audit Trail", "icon": "finger-print", "route": "/admin/audit-logs"},
                    {"key": "settings", "title": "System Settings & Backup", "icon": "settings", "route": "/admin/settings"},
                ],
            },
        ],
    },
}

def make_menu_item(view: bool, write: bool) -> dict:
    actions = []
    if view:
        actions.extend(["view", "search"])
    if write:
        actions.extend(["add", "edit", "delete", "share", "export"])
    actions = list(dict.fromkeys(actions))
    return {
        "view": view,
        "add": "add" in actions,
        "search": "search" in actions,
        "edit": "edit" in actions,
        "delete": "delete" in actions,
        "share": "share" in actions,
        "export": "export" in actions,
        "write": write,
        "actions": actions,
    }

def build_role_menu_matrix(role_id: str) -> dict:
    is_super = role_id in ("super_admin", "admin")
    is_manager = role_id in ("branch_manager", "assistant_branch_manager")
    is_accountant = role_id == "accountant"
    is_deo = role_id == "data_entry_operator"
    is_field = role_id == "field_executive"
    
    return {
        "dashboard": {
            "financial_overview": make_menu_item(is_super or is_manager or is_accountant, is_super or is_accountant),
            "operations_metrics": make_menu_item(is_super or is_manager or is_accountant or is_deo, is_super or is_manager),
            "urgent_tenders": make_menu_item(is_super or is_manager or is_deo, is_super or is_manager),
            "quick_actions": make_menu_item(is_super or is_manager or is_accountant or is_deo or is_field, is_super or is_manager or is_accountant or is_deo),
        },
        "business": {
            "customers": make_menu_item(is_super or is_manager or is_accountant or is_deo or is_field, is_super or is_manager or is_deo),
            "accounts": make_menu_item(is_super or is_manager or is_accountant, is_super or is_manager or is_accountant),
        },
        "task": {
            "payment_followup": make_menu_item(is_super or is_manager or is_accountant, is_super or is_manager or is_accountant),
            "task_followup": make_menu_item(True, is_super or is_manager or is_accountant or is_deo or is_field),
        },
        "more": {
            "operations_services": {
                "customers": make_menu_item(is_super or is_manager or is_accountant or is_deo or is_field, is_super or is_manager or is_deo),
                "accounting": make_menu_item(is_super or is_manager or is_accountant, is_super or is_manager or is_accountant),
                "reports": make_menu_item(is_super or is_manager or is_accountant, is_super or is_accountant),
                "services": make_menu_item(is_super or is_manager or is_deo, is_super),
                "expiry_alerts": make_menu_item(is_super or is_manager or is_deo, is_super or is_manager),
                "gps_tracking": make_menu_item(is_super or is_manager or is_field, is_super or is_field),
                "documents": make_menu_item(True, is_super or is_manager or is_deo),
                "tenders": make_menu_item(is_super or is_manager or is_deo, is_super or is_manager),
                "tender_calling": make_menu_item(is_super or is_manager or is_deo, is_super or is_manager),
                "simple_accounts": make_menu_item(is_super or is_manager or is_accountant, is_super or is_accountant),
            },
            "human_resources": {
                "employees": make_menu_item(is_super or is_manager, is_super),
                "attendance_leaves": make_menu_item(True, True),
                "payroll": make_menu_item(is_super or is_accountant, is_super or is_accountant),
                "attendance_settings": make_menu_item(is_super or is_manager, is_super),
            },
            "enterprise_administration": {
                "branches": make_menu_item(is_super, is_super),
                "posts": make_menu_item(is_super, is_super),
                "users": make_menu_item(is_super, is_super),
                "roles": make_menu_item(is_super, is_super),
                "audit_logs": make_menu_item(is_super, False),
                "settings": make_menu_item(is_super, is_super),
            },
        },
    }

SYSTEM_MENUS = [
    # Accounting & Billing
    {"id": "sales_invoices", "title": "Sale Invoices", "category": "Accounting & Billing", "route": "/accounting/invoices", "icon": "receipt", "description": "Create and manage sales tax invoices"},
    {"id": "payments_in", "title": "Payments-In (Receipts)", "category": "Accounting & Billing", "route": "/accounting/income", "icon": "wallet", "description": "Client payments and money receipts"},
    {"id": "sale_returns", "title": "Sale Return / Credit Note", "category": "Accounting & Billing", "route": "/accounting/sale-returns", "icon": "refresh-circle", "description": "Sales returns, credit notes, refunds"},
    {"id": "estimates", "title": "Estimates / Quotations", "category": "Accounting & Billing", "route": "/accounting/estimates", "icon": "document-text", "description": "Price estimates and client quotations"},
    {"id": "proforma", "title": "Proforma Invoices", "category": "Accounting & Billing", "route": "/accounting/proforma", "icon": "newspaper", "description": "Proforma invoices prior to final billing"},
    {"id": "challans", "title": "Delivery Challans", "category": "Accounting & Billing", "route": "/accounting/delivery-challans", "icon": "car", "description": "Material delivery challans and dispatch notes"},
    {"id": "purchases", "title": "Purchase Bills", "category": "Accounting & Billing", "route": "/accounting/purchases", "icon": "cart", "description": "Vendor invoices and inward bills"},
    {"id": "cash_bank", "title": "Cash & Bank Accounts", "category": "Accounting & Billing", "route": "/accounting/banking", "icon": "cash", "description": "Bank ledger and cash-in-hand accounts"},
    {"id": "accounting_reports", "title": "Financial Reports", "category": "Accounting & Billing", "route": "/accounting/reports", "icon": "bar-chart", "description": "GSTR, Profit & Loss, ledger summaries"},

    # Operations & Services
    {"id": "customers", "title": "Contractors & Customers Database", "category": "Operations", "route": "/customers", "icon": "people", "description": "Contractors, DSC holders, and client accounts"},
    {"id": "tasks", "title": "Task Management & Operations", "category": "Operations", "route": "/(tabs)/tasks", "icon": "checkmark-done", "description": "Client workflow tasks, stages, execution"},
    {"id": "services", "title": "Service Master & Workflows", "category": "Operations", "route": "/services", "icon": "construct", "description": "Service definitions, rate card, workflow stages"},
    {"id": "tenders", "title": "Tender Management", "category": "Operations", "route": "/tenders", "icon": "document-text", "description": "Live tenders, bidding documents, deadlines"},
    {"id": "tender_calling", "title": "Tender Calling & Follow-up", "category": "Operations", "route": "/tenders?tab=calling", "icon": "call", "description": "Telecalling logs, vendor bids, client followups"},
    {"id": "documents", "title": "Document Library", "category": "Operations", "route": "/documents", "icon": "folder-open", "description": "Central file store and office documents"},
    {"id": "expiry_alerts", "title": "Document & DSC Expiry Alerts", "category": "Operations", "route": "/customers/expiry-alerts", "icon": "alert-circle", "description": "Validity alerts for DSC, licences, registrations"},

    # HR & Staff
    {"id": "employees", "title": "Employees Directory", "category": "HR & Staff", "route": "/employees", "icon": "people", "description": "Staff profile directory, KYC, bank details"},
    {"id": "attendance_leaves", "title": "Staff Attendance & Leaves", "category": "HR & Staff", "route": "/hr", "icon": "calendar", "description": "Daily punch in/out and staff leave requests"},
    {"id": "payroll", "title": "Payroll & Salary Slips", "category": "HR & Staff", "route": "/payroll", "icon": "card", "description": "Salary generation, payslips, deductions"},
    {"id": "gps_tracking", "title": "Field Staff GPS Tracking", "category": "HR & Staff", "route": "/gps/tracking", "icon": "navigate", "description": "Live field staff location and routes"},

    # Administration
    {"id": "branches", "title": "Branch Management", "category": "Administration", "route": "/admin/branches", "icon": "business", "description": "Offices and branches directory"},
    {"id": "posts", "title": "Post & Designations", "category": "Administration", "route": "/admin/posts", "icon": "ribbon", "description": "Designations and office positions"},
    {"id": "user_management", "title": "User Directory & Access", "category": "Administration", "route": "/admin/users", "icon": "person-add", "description": "System user accounts, credentials, status"},
    {"id": "roles_permissions", "title": "Roles & RBAC Matrix", "category": "Administration", "route": "/admin/roles", "icon": "shield-checkmark", "description": "Access control matrix and menu permissions"},
    {"id": "audit_logs", "title": "Security Audit Trail", "category": "Administration", "route": "/admin/audit-logs", "icon": "finger-print", "description": "Immutable security and audit event logs"},
    {"id": "settings", "title": "System Settings & Backup", "category": "Administration", "route": "/admin/settings", "icon": "settings", "description": "System config, company profile, database backup"},
]

ALL_MENU_IDS = [m["id"] for m in SYSTEM_MENUS]

class Role(BaseModel):
    id: str
    role_id: str
    name: str
    description: Optional[str] = None
    is_system: bool = False
    permissions: Dict[str, List[str]] = Field(default_factory=dict)
    allowed_menus: List[str] = Field(default_factory=list)
    app_menu_matrix: Dict[str, Any] = Field(default_factory=dict)
    users_count: Optional[int] = 0
    created_at: datetime = Field(default_factory=now_utc)
    updated_at: datetime = Field(default_factory=now_utc)

class RoleInput(BaseModel):
    name: str
    description: Optional[str] = None
    permissions: Dict[str, List[str]] = Field(default_factory=dict)
    allowed_menus: List[str] = Field(default_factory=list)
    app_menu_matrix: Optional[Dict[str, Any]] = None

class RoleUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    permissions: Optional[Dict[str, List[str]]] = None
    allowed_menus: Optional[List[str]] = None
    app_menu_matrix: Optional[Dict[str, Any]] = None

class AssignUserRoleInput(BaseModel):
    user_id: str

def get_all_perms():
    return {mod: list(ALL_ACTIONS) for mod in ALL_MODULES}

DEFAULT_ROLES = [
    {
        "role_id": "super_admin",
        "name": "Super Admin",
        "description": "Unrestricted administrative system access across all modules and all dashboard menus",
        "is_system": True,
        "permissions": get_all_perms(),
        "allowed_menus": ALL_MENU_IDS,
        "app_menu_matrix": build_role_menu_matrix("super_admin"),
    },
    {
        "role_id": "admin",
        "name": "Admin",
        "description": "Full administrative control over office, billing, employees, and operations",
        "is_system": True,
        "permissions": get_all_perms(),
        "allowed_menus": ALL_MENU_IDS,
        "app_menu_matrix": build_role_menu_matrix("admin"),
    },
    {
        "role_id": "branch_manager",
        "name": "Branch Manager",
        "description": "Manages branch operations, tasks, billing, attendance, leaves, and staff",
        "is_system": True,
        "permissions": {
            "dashboard": ["view", "export"],
            "branches": ["view"],
            "customers": ["view", "add", "edit", "print", "download", "share", "export"],
            "services": ["view"],
            "tasks": ["view", "add", "edit", "print", "download", "share", "approve", "reject", "cancel"],
            "sales": ["view", "add", "edit", "print", "download", "share"],
            "purchases": ["view", "add", "print", "download"],
            "expenses": ["view", "add", "edit", "print", "download"],
            "banking": ["view"],
            "employees": ["view", "edit"],
            "attendance": ["view", "add", "edit", "print", "download", "export"],
            "leaves": ["view", "approve", "reject"],
            "gps_tracking": ["view"],
            "documents": ["view", "download", "share"],
            "reports": ["view", "print", "download", "export"],
            "notifications": ["view"],
        },
        "allowed_menus": [
            "customers", "sales_invoices", "payments_in", "sale_returns", "estimates",
            "proforma", "challans", "purchases", "cash_bank", "accounting_reports",
            "tasks", "services", "tenders", "tender_calling", "documents", "expiry_alerts",
            "employees", "attendance_leaves", "gps_tracking"
        ],
        "app_menu_matrix": build_role_menu_matrix("branch_manager"),
    },
    {
        "role_id": "assistant_branch_manager",
        "name": "Assistant Branch Manager",
        "description": "Assists branch manager in operations, task progression, customer follow-up, and attendance",
        "is_system": True,
        "permissions": {
            "dashboard": ["view"],
            "customers": ["view", "add", "edit", "print", "download"],
            "tasks": ["view", "add", "edit", "approve", "reject"],
            "sales": ["view", "add", "print", "download"],
            "attendance": ["view", "add"],
            "leaves": ["view"],
            "reports": ["view"],
            "notifications": ["view"],
        },
        "allowed_menus": [
            "customers", "sales_invoices", "estimates", "tasks", "documents",
            "attendance_leaves", "expiry_alerts"
        ],
        "app_menu_matrix": build_role_menu_matrix("assistant_branch_manager"),
    },
    {
        "role_id": "accountant",
        "name": "Accountant",
        "description": "Vyapar accounting, sales invoicing, payments in/out, expenses, banking, payroll & financial reports",
        "is_system": True,
        "permissions": {
            "dashboard": ["view"],
            "customers": ["view", "add", "print", "download"],
            "services": ["view"],
            "tasks": ["view", "approve", "forward", "return"],
            "sales": ["view", "add", "edit", "print", "download", "share", "export"],
            "purchases": ["view", "add", "edit", "print", "download", "export"],
            "expenses": ["view", "add", "edit", "print", "download", "export"],
            "banking": ["view", "add", "edit", "export"],
            "payroll": ["view", "add", "print", "export"],
            "reports": ["view", "print", "download", "export"],
            "notifications": ["view"],
        },
        "allowed_menus": [
            "customers", "sales_invoices", "payments_in", "sale_returns", "estimates",
            "proforma", "challans", "purchases", "cash_bank", "accounting_reports",
            "tasks", "payroll", "documents"
        ],
        "app_menu_matrix": build_role_menu_matrix("accountant"),
    },
    {
        "role_id": "data_entry_operator",
        "name": "Data Entry Operator",
        "description": "Customer profile entry, document uploads, and task registration",
        "is_system": True,
        "permissions": {
            "dashboard": ["view"],
            "customers": ["view", "add", "edit", "print", "download"],
            "services": ["view"],
            "tasks": ["view", "add", "forward"],
            "documents": ["view", "add", "download"],
            "attendance": ["view", "add"],
            "leaves": ["view", "add"],
            "notifications": ["view"],
        },
        "allowed_menus": [
            "customers", "tasks", "services", "documents", "expiry_alerts", "attendance_leaves"
        ],
        "app_menu_matrix": build_role_menu_matrix("data_entry_operator"),
    },
    {
        "role_id": "field_executive",
        "name": "Field Executive",
        "description": "Field client meetings, mobile GPS location updates, and task execution",
        "is_system": True,
        "permissions": {
            "dashboard": ["view"],
            "customers": ["view"],
            "tasks": ["view", "edit"],
            "attendance": ["view", "add"],
            "gps_tracking": ["add"],
            "leaves": ["view", "add"],
            "notifications": ["view"],
        },
        "allowed_menus": [
            "customers", "tasks", "gps_tracking", "attendance_leaves", "documents"
        ],
        "app_menu_matrix": build_role_menu_matrix("field_executive"),
    },
    {
        "role_id": "employee",
        "name": "Employee",
        "description": "Staff member with personal attendance, assigned tasks, and leave requests",
        "is_system": True,
        "permissions": {
            "dashboard": ["view"],
            "customers": ["view"],
            "tasks": ["view"],
            "attendance": ["view", "add"],
            "leaves": ["view", "add"],
            "notifications": ["view"],
        },
        "allowed_menus": [
            "tasks", "attendance_leaves", "documents"
        ],
        "app_menu_matrix": build_role_menu_matrix("employee"),
    },
]

def make_role_router(db, get_current_user, require_admin, log_audit):
    router = APIRouter(prefix="/roles", tags=["roles"])

    async def ensure_default_roles():
        for r in DEFAULT_ROLES:
            existing = await db.roles.find_one({"role_id": r["role_id"]})
            if not existing:
                now = now_utc()
                doc = dict(r)
                doc["id"] = f"rol_{r['role_id']}"
                doc["created_at"] = now
                doc["updated_at"] = now
                await db.roles.insert_one(doc)
            else:
                updates = {}
                if "allowed_menus" not in existing or not existing.get("allowed_menus"):
                    updates["allowed_menus"] = r.get("allowed_menus", [])
                if "app_menu_matrix" not in existing or not existing.get("app_menu_matrix"):
                    updates["app_menu_matrix"] = r.get("app_menu_matrix", build_role_menu_matrix(r["role_id"]))
                if updates:
                    await db.roles.update_one({"role_id": r["role_id"]}, {"$set": updates})

    router.ensure_default_roles = ensure_default_roles

    @router.get("/meta")
    async def get_role_meta(current: any = Depends(get_current_user)):
        return {
            "modules": ALL_MODULES,
            "actions": ALL_ACTIONS,
            "menus": SYSTEM_MENUS,
            "four_menu_structure": FOUR_MENU_STRUCTURE,
        }

    @router.get("", response_model=List[Role])
    async def list_roles(current: any = Depends(get_current_user)):
        await ensure_default_roles()
        docs = await db.roles.find({}, {"_id": 0}).sort("created_at", 1).to_list(100)
        roles = []
        for d in docs:
            rid = d.get("role_id")
            count = await db.users.count_documents({"$or": [{"role_id": rid}, {"role": rid}]})
            d["users_count"] = count
            if not d.get("app_menu_matrix"):
                d["app_menu_matrix"] = build_role_menu_matrix(rid)
            roles.append(Role(**d))
        return roles

    @router.get("/{rid}", response_model=Role)
    async def get_role(rid: str, current: any = Depends(get_current_user)):
        await ensure_default_roles()
        d = await db.roles.find_one({"$or": [{"id": rid}, {"role_id": rid}]}, {"_id": 0})
        if not d:
            raise HTTPException(status_code=404, detail="Role not found")
        role_slug = d.get("role_id")
        count = await db.users.count_documents({"$or": [{"role_id": role_slug}, {"role": role_slug}]})
        d["users_count"] = count
        if not d.get("app_menu_matrix"):
            d["app_menu_matrix"] = build_role_menu_matrix(role_slug)
        return Role(**d)

    @router.get("/{rid}/users")
    async def get_role_users(rid: str, current: any = Depends(get_current_user)):
        target_role = await db.roles.find_one({"$or": [{"id": rid}, {"role_id": rid}]}, {"_id": 0})
        if not target_role:
            raise HTTPException(status_code=404, detail="Role not found")
        role_slug = target_role["role_id"]
        users = await db.users.find(
            {"$or": [{"role_id": role_slug}, {"role": role_slug}]},
            {"_id": 0, "password_hash": 0}
        ).sort("name", 1).to_list(200)
        return users

    @router.post("/{rid}/assign-user")
    async def assign_user_to_role(rid: str, payload: AssignUserRoleInput, current: any = Depends(require_admin)):
        target_role = await db.roles.find_one({"$or": [{"id": rid}, {"role_id": rid}]})
        if not target_role:
            raise HTTPException(status_code=404, detail="Role not found")
        role_slug = target_role["role_id"]

        if role_slug == "super_admin" and current.role != "super_admin":
            raise HTTPException(status_code=403, detail="Only Super Admin can assign the Super Admin role.")

        user = await db.users.find_one({"user_id": payload.user_id})
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        if (user.get("role") == "super_admin" or user.get("role_id") == "super_admin") and current.role != "super_admin":
            raise HTTPException(status_code=403, detail="Admins cannot change role of Super Admin accounts.")

        await db.users.update_one(
            {"user_id": payload.user_id},
            {"$set": {
                "role_id": role_slug,
                "role": role_slug,
                "role_name": target_role.get("name"),
                "app_menu_matrix": target_role.get("app_menu_matrix", build_role_menu_matrix(role_slug)),
                "updated_at": now_utc(),
            }}
        )
        await log_audit(db, current, "roles", "assign_user", role_slug, None, {"user_id": payload.user_id, "role": role_slug})
        return {"ok": True, "message": f"User {user.get('name')} assigned to {target_role.get('name')}"}

    @router.post("/{rid}/remove-user")
    async def remove_user_from_role(rid: str, payload: AssignUserRoleInput, current: any = Depends(require_admin)):
        target_role = await db.roles.find_one({"$or": [{"id": rid}, {"role_id": rid}]})
        if not target_role:
            raise HTTPException(status_code=404, detail="Role not found")

        user = await db.users.find_one({"user_id": payload.user_id})
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        if (user.get("role") == "super_admin" or user.get("role_id") == "super_admin") and current.role != "super_admin":
            raise HTTPException(status_code=403, detail="Admins cannot change role of Super Admin accounts.")

        emp_role = await db.roles.find_one({"role_id": "employee"})
        emp_name = emp_role.get("name", "Employee") if emp_role else "Employee"

        await db.users.update_one(
            {"user_id": payload.user_id},
            {"$set": {
                "role_id": "employee",
                "role": "employee",
                "role_name": emp_name,
                "app_menu_matrix": build_role_menu_matrix("employee"),
                "updated_at": now_utc(),
            }}
        )
        await log_audit(db, current, "roles", "remove_user", rid, None, {"user_id": payload.user_id, "new_role": "employee"})
        return {"ok": True, "message": f"User {user.get('name')} reset to Employee role"}

    @router.post("", response_model=Role)
    async def create_role(payload: RoleInput, current: any = Depends(require_admin)):
        slug = payload.name.lower().replace(" ", "_")
        role_id = f"custom_{slug}"
        existing = await db.roles.find_one({"role_id": role_id})
        if existing:
            raise HTTPException(status_code=400, detail="Role with this name already exists")
        now = now_utc()
        doc = {
            "id": f"rol_{role_id}",
            "role_id": role_id,
            "name": payload.name,
            "description": payload.description,
            "is_system": False,
            "permissions": payload.permissions,
            "allowed_menus": payload.allowed_menus if payload.allowed_menus else ["tasks", "attendance_leaves", "documents"],
            "app_menu_matrix": payload.app_menu_matrix or build_role_menu_matrix("employee"),
            "created_at": now,
            "updated_at": now,
        }
        await db.roles.insert_one(doc)
        await log_audit(db, current, "roles", "create", role_id, None, doc)
        doc["users_count"] = 0
        return Role(**doc)

    @router.put("/{rid}", response_model=Role)
    @router.patch("/{rid}", response_model=Role)
    async def update_role(rid: str, payload: RoleUpdate, current: any = Depends(require_admin)):
        existing = await db.roles.find_one({"$or": [{"id": rid}, {"role_id": rid}]}, {"_id": 0})
        if not existing:
            raise HTTPException(status_code=404, detail="Role not found")

        if existing.get("role_id") == "super_admin" and current.role != "super_admin":
            raise HTTPException(status_code=403, detail="Only Super Admin can modify the Super Admin role.")

        updates = {k: v for k, v in payload.dict().items() if v is not None}
        updates["updated_at"] = now_utc()

        await db.roles.update_one({"id": existing["id"]}, {"$set": updates})
        updated = await db.roles.find_one({"id": existing["id"]}, {"_id": 0})
        count = await db.users.count_documents({"$or": [{"role_id": existing.get("role_id")}, {"role": existing.get("role_id")}]})
        updated["users_count"] = count
        if not updated.get("app_menu_matrix"):
            updated["app_menu_matrix"] = build_role_menu_matrix(existing.get("role_id"))
        await log_audit(db, current, "roles", "update", existing.get("role_id"), existing, updated)
        return Role(**updated)

    @router.delete("/{rid}")
    async def delete_role(rid: str, current: any = Depends(require_admin)):
        existing = await db.roles.find_one({"$or": [{"id": rid}, {"role_id": rid}]}, {"_id": 0})
        if not existing:
            raise HTTPException(status_code=404, detail="Role not found")
        if existing.get("is_system"):
            raise HTTPException(status_code=400, detail="System default roles cannot be deleted")

        await db.users.update_many(
            {"$or": [{"role_id": existing.get("role_id")}, {"role": existing.get("role_id")}]},
            {"$set": {"role_id": "employee", "role": "employee", "role_name": "Employee", "updated_at": now_utc()}}
        )

        res = await db.roles.delete_one({"id": existing["id"]})
        await log_audit(db, current, "roles", "delete", existing.get("role_id"), existing, None)
        return {"ok": True, "deleted": res.deleted_count}

    return router
