# TDSC Office Management System — Credentials & Access Guide

All login credentials, roles, and live cloud links for the TDSC Office Management System.

---

## 1. App Login Credentials

| Role | Email | Password | Access Level |
| :--- | :--- | :--- | :--- |
| **Admin** | `admin@triveni.com` | `admin123` | **Full Access**: Billing, Invoicing, Customer Directory, Attendance, Approvals, System Settings |
| **Manager** | `manager@triveni.com` | `manager123` | **Operational Access**: Invoices, Customer Records, Task Management, Attendance Monitoring |
| **Employee** | `employee@triveni.com` | `employee123` | **Staff Access**: Selfie Attendance Punch-In/Out, View Assigned Tasks |

> **Tip**: You can create new employee logins or change existing passwords anytime directly from the **Admin Dashboard** under the **Employees** tab.

---

## 2. Live Links & Deployment URLs

| Service | Platform | URL / Location | Notes |
| :--- | :--- | :--- | :--- |
| **iOS Web App (Safari)** | Vercel | **[https://frontend-rho-woad-43.vercel.app](https://frontend-rho-woad-43.vercel.app)** | Add to Home Screen via Safari for full-screen app |
| **Android APK** | Native Release | `TDSC-Office-Manager.apk` *(Project Root)* | Installable on any Android device |
| **Backend API** | Render | `https://tdscoms.onrender.com` | FastAPI 24/7 Cloud Backend |
| **API Docs (Swagger)** | Render | `https://tdscoms.onrender.com/docs` | Interactive REST API documentation |
| **Database** | MongoDB Atlas | Cluster: `tdscmanagementapk.sdv1sbt.mongodb.net` | Database: `triveni_fms` |
| **GitHub Repository** | GitHub | **[github.com/PrinceN1raj/tdscoms](https://github.com/PrinceN1raj/tdscoms)** | Private source repository |

---

## 3. Database Credentials (MongoDB Atlas)

* **Cluster Host**: `tdscmanagementapk.sdv1sbt.mongodb.net`
* **Username**: `princerajj2013_db_user`
* **Password**: `sIGmhRNHa5Amu7OP`
* **Database Name**: `triveni_fms`
* **Full Connection URI**:
  ```text
  mongodb+srv://princerajj2013_db_user:sIGmhRNHa5Amu7OP@tdscmanagementapk.sdv1sbt.mongodb.net/?retryWrites=true&w=majority
  ```

---

## 4. How to Test & Access

### On Android / BlueStacks:
1. Open [`TDSC-Office-Manager.apk`](file:///C:/Users/Prince%20N1raj/Desktop/fms/TDSC-Office-Manager.apk) in BlueStacks or install on your Android phone.
2. Sign in with `admin@triveni.com` and `admin123`.

### On iPhone (Safari):
1. Open **[https://frontend-rho-woad-43.vercel.app](https://frontend-rho-woad-43.vercel.app)** in Safari.
2. Tap **Share** (bottom center icon) $\rightarrow$ **Add to Home Screen**.
3. Launch from your home screen and sign in with `admin@triveni.com` and `admin123`.
