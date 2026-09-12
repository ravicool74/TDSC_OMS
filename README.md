# TDSC Office Management & Accounting System

A modern, cross-platform office management and Vyapar-style accounting application designed for **Triveni DSC & E-Tender Service Pvt. Ltd.** The system provides comprehensive business operations management, invoicing, GST billing, party directory with duplicate prevention, employee management, and PDF report generation.

---

## Architecture & Tech Stack

- **Frontend**:
  - React Native (0.81) & Expo (SDK 54)
  - Expo Router (File-based navigation)
  - React Native Web (Browser compatibility) & Native Android
  - React Native Reanimated, Gesture Handler, Bottom Sheet
  - TypeScript
- **Backend**:
  - Python 3.12 with FastAPI & Uvicorn (ASGI)
  - Motor (Async MongoDB Driver)
  - Pydantic v2 (Data validation)
  - ReportLab (Automated GST invoice & customer profile PDF generation)
  - Bcrypt & PyJWT (Authentication & Authorization)
- **Database**:
  - MongoDB / MongoDB Atlas (Cloud 24/7)

---

## Key Features

1. **Vyapar-Style Accounting & Billing**:
   - Cash / Credit sales toggles with custom payment terms and due dates.
   - Item catalog with auto-pricing and tax calculations.
   - Real-time GST calculation (CGST, SGST, IGST).
   - Auto-generated serial invoice numbering (`SI-000x`, `PB-000x`).
   - Automated income ledger entry creation on invoice submission.

2. **Customer Directory & Duplicate Prevention**:
   - Multi-field customer search (Name, Mobile, WhatsApp, PAN, Aadhar, GSTIN, Registration No).
   - Server-side duplicate prevention guards blocking duplicate parties across PAN, Aadhar, Mobile, or GST.

3. **PDF Generation**:
   - Downloadable official GST Tax Invoices matching company letterhead.
   - Comprehensive 39-field contractor/customer profile cards.

4. **Employee & Attendance Management**:
   - Role-based permissions (Admin, Manager, Employee).
   - Office location verification and attendance logs.

---

## Project Structure

```
├── backend/                  # FastAPI backend
│   ├── server.py             # Main API application & routes
│   ├── invoice_pdf.py        # ReportLab GST invoice PDF generator
│   ├── customer_pdf.py       # ReportLab customer profile PDF generator
│   ├── requirements.txt      # Python dependencies
│   ├── Procfile              # Cloud hosting entrypoint
│   └── .env.example          # Environment variable template
├── frontend/                 # React Native / Expo application
│   ├── app/                  # Expo Router pages & screens
│   ├── src/                  # Reusable components & API services
│   ├── assets/               # Images, icons, and logos
│   ├── android/              # Native Android project (Gradle & NDK)
│   ├── eas.json              # Expo Application Services build configuration
│   └── package.json          # Node dependencies & scripts
├── build-apk.bat             # 1-Click native Android APK compiler
├── start-all.bat             # 1-Click launcher for Backend + Frontend
├── start-backend.bat         # Launcher for FastAPI backend
├── start-frontend.bat        # Launcher for Expo Web frontend
└── README.md
```

---

## Quick Start (Local Development)

### Prerequisites
- **Node.js** (v18+)
- **Python** (v3.10 - v3.12)
- **MongoDB** (Local instance or MongoDB Atlas URI)

### 1. Backend Setup
```bash
cd backend
python -m venv .venv
# On Windows:
.venv\Scripts\activate
# On Mac/Linux:
source .venv/bin/activate

pip install -r requirements.txt
cp .env.example .env
# Edit .env with your MONGO_URL
uvicorn server:app --host 127.0.0.1 --port 8000 --reload
```
API Documentation will be accessible at: `http://127.0.0.1:8000/docs`

### 2. Frontend Setup
```bash
cd frontend
npm install # or yarn install
cp .env.example .env
npx expo start --web
```
Web app will be accessible at: `http://localhost:8081`

### Or Use the 1-Click Windows Launchers
- Double-click `start-all.bat` to launch both Backend and Frontend in separate windows.
- Double-click `start-backend.bat` to launch only the backend.
- Double-click `start-frontend.bat` to launch only the frontend.

---

## Building the Android APK Locally

A standalone Android release APK can be built directly on your PC:
1. Ensure JDK 17 and Android SDK/NDK 27 are installed.
2. Double-click `build-apk.bat`.
3. The compiled APK will be created at the project root as `TDSC-Office-Manager.apk`.

---

## 24/7 Cloud Deployment

- **Database**: Host on [MongoDB Atlas](https://www.mongodb.com/cloud/atlas) (M0 Free Cluster).
- **Backend**: Deploy on [Render](https://render.com) or [Koyeb](https://www.koyeb.com) using the provided `backend/Procfile` and `backend/requirements.txt`.
- **Frontend (Web)**: Deploy on [Vercel](https://vercel.com) by connecting this repository with build command `npx expo export --platform web` and output directory `dist`.

---

## Demo Credentials

| Role | Email | Password |
|---|---|---|
| **Admin** | `admin@triveni.com` | `admin123` |
| **Manager** | `manager@triveni.com` | `manager123` |
| **Employee** | `employee@triveni.com` | `employee123` |
