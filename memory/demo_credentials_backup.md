# Backup of Demo & Test Credentials

> **Notice**: This file serves as a permanent reference backup of the demo/testing credentials that were previously displayed on the login screen.
> These accounts remain active in the MongoDB database (`triveni_fms.users`) and can be used for manual login whenever required.

---

## 1. Demo User Accounts (Active in Database)

| Role | Full Name | Email | Password | Access Level |
| :--- | :--- | :--- | :--- | :--- |
| **System Admin** | Triveni Admin | `admin@triveni.com` | `admin123` | Full administrative control (Billing, Invoicing, Customers, Users, Settings) |
| **Manager** | Ravi Manager | `manager@triveni.com` | `manager123` | Operational access (Invoices, Customers, Tasks, Attendance review) |
| **Employee** | Anita Employee | `employee@triveni.com` | `employee123` | Staff access (Selfie Attendance punch-in/out, Assigned tasks) |

---

## 2. Database Credentials (MongoDB Atlas)

- **Cluster Host**: `tdscmanagementapk.sdv1sbt.mongodb.net`
- **Database Name**: `triveni_fms`
- **Username**: `princerajj2013_db_user`
- **Password**: `sIGmhRNHa5Amu7OP`
- **Connection URI**:
  ```text
  mongodb+srv://princerajj2013_db_user:sIGmhRNHa5Amu7OP@tdscmanagementapk.sdv1sbt.mongodb.net/?retryWrites=true&w=majority
  ```

---

## 3. Previous Environment Variables Backup

```env
# Frontend Demo Flags
EXPO_PUBLIC_SHOW_DEMO_CREDS=true
EXPO_PUBLIC_DEMO_ADMIN=admin@triveni.com / admin123
EXPO_PUBLIC_DEMO_MANAGER=manager@triveni.com / manager123
EXPO_PUBLIC_DEMO_EMPLOYEE=employee@triveni.com / employee123

# Backend Demo Seed Flags
SEED_DEMO_ACCOUNTS=true
SEED_ADMIN_EMAIL=admin@triveni.com
SEED_ADMIN_PASSWORD=admin123
SEED_MANAGER_EMAIL=manager@triveni.com
SEED_MANAGER_PASSWORD=manager123
SEED_EMPLOYEE_EMAIL=employee@triveni.com
SEED_EMPLOYEE_PASSWORD=employee123
```
