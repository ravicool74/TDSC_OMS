# TDSC Office Management System (TDSC-OMS)
## TRIVENI DSC AND ETENDER SERVICE PRIVATE LIMITED

A complete, modern, secure, responsive and scalable **Office Management + Customer Management + Accounting + Employee Management + Task Management + Attendance System** designed for **TRIVENI DSC AND ETENDER SERVICE PRIVATE LIMITED**.

---

## 1. System Architecture & Tech Stack

- **Backend**:
  - Python 3.12 with **FastAPI** & **Uvicorn** (Async REST API)
  - **Motor**: Async MongoDB Driver connected to MongoDB Atlas Cloud Cluster (`triveni_fms`)
  - **Cryptography (Fernet AES-256)**: Secure encryption vault for all portal credentials
  - **Pydantic v2**: Strict enterprise schema validation
  - **ReportLab**: High-resolution GST Tax Invoice & Customer Profile PDF generator
  - **PyJWT & Bcrypt**: JWT session security with password hashing
- **Frontend**:
  - **React Native (0.81)** & **Expo (SDK 54)**
  - **Expo Router (v6)**: File-based routing & deep linking
  - **React Native Web**: Full desktop & browser responsive layout
  - **TypeScript**: 100% type-safe codebase
  - **Native Android APK**: Release APK build configuration via Gradle
- **Database**:
  - **MongoDB Atlas** Cloud Cluster (`tdscmanagementapk.sdv1sbt.mongodb.net`, DB: `triveni_fms`)

---

## 2. 18 Core Enterprise Modules

### 1. Master Data Management
- **Branch Master**: Auto-generated Branch ID (`TDSC-BR-xxxx`), geofence radius sync, dynamic staff counts.
- **Post Master**: Auto-generated Post ID (`TDSC-PST-xxx`), seeding 6 organizational designations.
- **User Master**: Organization mapping `User -> Branch -> Post -> Role` (`TDSC-USR-xxxxxx`) with 10MB document uploads.
- **Role & Granular RBAC Matrix**: 22 modules $\times$ 11 actions (`view`, `add`, `edit`, `delete`, `print`, `download`, `share`, `approve`, `reject`, `cancel`, `export`).
- **Service Master**: 17 TDSC services pre-seeded with SAC/HSN codes and auto-sync into Vyapar billing catalog.

### 2. Customer Master & Credential Vault
- **42-Field Contractor Profile**: Complete identification (Name, Code, PAN, Aadhar, Mobile, WhatsApp, Alt Mobile, Email, Full Address).
- **Class & Department Classification**: Class-I to Class-IV chips and department tags (RWD, RCD, WRD, BCD, PHED, CPWD, Railway, etc.).
- **AES-256 Credential Vault**: Encrypted passwords for eProc2, Railway/IREPS, CPP, GST, EPFO, GeM, PMGSY, ISO, and Other portals.
- **Audit-Logged Reveal**: Passwords masked by default; unmasking via the eye button logs an immutable audit trail entry.
- **Category Document Uploader**: Upload attachments classified by PAN, Aadhar, GST, DSC, Registration, etc.
- **30-Day Expiry Alert Detector**: Highlights documents, DSC signing, and encryption keys expiring in $\le 30$ days.

### 3. Task Management & 4-Stage Approval Workflows
- **Auto Task ID**: `TDSC-TSK-xxxxxx`.
- **4-Stage Pipeline**: `Data Entry Operator` $\rightarrow$ `Accountant` $\rightarrow$ `Manager` $\rightarrow$ `Admin`.
- **Workflow Actions**: `Approve & Next`, `Forward`, `Return`, `Reject`, and `Comment`.
- **Audit Trail**: Chronological history recording user actor, role, stage transition, remarks, and timestamp.

### 4. Vyapar-Style Accounting & Financial Reporting
- **Sales Invoices**: Auto serial numbering (`TDSC/{fy}/{seq}` or `SI-xxxx`), GST calculation (CGST, SGST, IGST).
- **Estimates / Quotations**: Quotation generation (`TDSC-EST/{fy}/{seq}`) with 1-click **Convert to Sale Invoice**.
- **Proforma Invoices**: Provisional commercial invoices (`TDSC-PI/{fy}/{seq}`) with 1-click **Convert to Tax Invoice**.
- **Delivery Challans**: Material dispatch documents (`TDSC-DC/{fy}/{seq}`) with vehicle and courier tracking.
- **Credit & Debit Notes**: Sale Return (`type=sale_return`) and Purchase Return (`type=purchase_return`) vouchers.
- **GST Tax Filing Center**: Real-time GSTR-1 outward supplies & 18% output GST, GSTR-2 inward input tax credits (ITC), GSTR-3B net payable reconciliation, HSN/SAC breakdown, and Section 51/194C TDS tracking.
- **Financial & Aging Reports**: Dynamic Balance Sheet with net worth calculation, 4-tier Receivables & Payables Aging analysis (0-30, 31-60, 61-90, 90+ days), and bill-wise gross profit margins.
- **Payments-In & Payments-Out**: Income and expense tracking with cash/bank split.
- **Day Book Report**: Financial movement report with receipts, payments, and net flow summary.
- **Banking**: Bank account management with live running balances and Bank Book.
- **UI & Navigation Polish**: High-contrast, tactile circular Back Button with distinct arrow icon (`arrow-back`) standardized across 20+ screens.

### 5. HR, Attendance & Field Operations
- **Geofenced Attendance**: Validates distance against assigned branch GPS coordinates.
- **Face Selfie Verification**: Selfie camera capture on attendance punch.
- **Leave Management**: Leave requests with approval lifecycle.
- **Payroll**: Salary slip generation and allowances.
- **Field Staff GPS Tracking**: Real-time staff location pings, active map feed, and client visit reporting.

### 6. Security, Intelligence & System Operations
- **Security Audit Trail**: Immutable queryable audit log with actor ID, action, old values, and new values.
- **Live Multi-Module Global Search**: Multi-collection search across Customers, Tasks, Invoices, Branches, and Employees.
- **Executive Dashboard**: Live financial KPIs (Today's Sales, To Receive, To Pay) and operations counters.
- **Database Backup**: 1-click JSON snapshot generator across all collections.

---

## 3. Quick Start & Execution

### Launch Everything in 1-Click (Windows):
Double-click `start-all.bat` at the project root to launch both Backend and Frontend in separate windows.

### Manual Backend Launch:
```powershell
cd "e:\MY PROJECTS\tdscoms\backend"
.\.venv\Scripts\python.exe -m uvicorn server:app --host 127.0.0.1 --port 8000 --reload
```
- API Docs: `http://127.0.0.1:8000/docs`

### Manual Frontend Launch:
```powershell
cd "e:\MY PROJECTS\tdscoms\frontend"
npx.cmd expo start --web
```
- Web Application: `http://localhost:8081`

### Running the Enterprise Test Suite:
```powershell
cd "e:\MY PROJECTS\tdscoms\backend"
.\.venv\Scripts\python.exe -m pytest tests/test_enterprise_modules.py -v
```

---

## 4. User Authentication & Administration

- **Authentication**: Users authenticate securely with registered email and password.
- **Account Registration**: New accounts can be registered via the **Sign Up** tab or created by administrators.
- **User & Role Administration**: Full role-based access control (Admin, Manager, Accountant, Employee) is configured via **Admin -> Users & Roles**.
