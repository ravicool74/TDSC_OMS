import os
import re
import uuid
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form, Header
from pydantic import BaseModel, Field
import bcrypt
from pymongo import ReturnDocument

def now_utc() -> datetime:
    return datetime.now(timezone.utc)

def clean_doc(d: Any) -> Any:
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

def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False

# 27 Master Services as defined in TDSC-OMS specifications
MASTER_SERVICES_CATALOGUE = [
    {"name": "Digital Signature", "code": "DSC", "category": "Certificates & Licenses", "rate": 2000.0, "description": "Class 3 DSC Signing & Encryption combo with USB Token", "mandatory_docs": ["Aadhaar Card", "PAN Card", "Passport Size Photo"], "optional_docs": ["Email & Mobile OTP Authorization"]},
    {"name": "eproc2 Registration", "code": "EPROC2_REG", "category": "Government Portals", "rate": 1500.0, "description": "Bihar eProc2 Contractor Portal New Registration", "mandatory_docs": ["Digital Signature (DSC)", "PAN Card", "Aadhaar Card", "Mobile Number & Email ID"], "optional_docs": ["Registration Certificate"]},
    {"name": "eproc2 Renewal", "code": "EPROC2_REN", "category": "Government Portals", "rate": 1200.0, "description": "Bihar eProc2 Profile & DSC Mapping Renewal", "mandatory_docs": ["New Digital Signature (DSC)", "Previous eproc2 User ID"], "optional_docs": ["PAN Card"]},
    {"name": "RCD Class IV Registration", "code": "RCD_IV", "category": "Contractor Registration", "rate": 5000.0, "description": "Road Construction Department Class IV Contractor Registration", "mandatory_docs": ["PAN Card", "Aadhaar Card", "Character Certificate", "Bank Solvency Certificate"], "optional_docs": ["GST Registration", "Experience Certificate"]},
    {"name": "RCD Class III Registration", "code": "RCD_III", "category": "Contractor Registration", "rate": 8000.0, "description": "Road Construction Department Class III Contractor Registration", "mandatory_docs": ["PAN Card", "Aadhaar Card", "Character Certificate", "Bank Solvency Certificate", "GST Registration"], "optional_docs": ["Previous Work Done Certificate", "EPFO Certificate"]},
    {"name": "RCD Class II Registration", "code": "RCD_II", "category": "Contractor Registration", "rate": 12000.0, "description": "Road Construction Department Class II Contractor Registration", "mandatory_docs": ["PAN Card", "Aadhaar Card", "Character Certificate", "Bank Solvency", "Key Personnel Credentials", "Machinery List"], "optional_docs": ["Audit Report (Last 3 Years)"]},
    {"name": "RCD Class I Registration", "code": "RCD_I", "category": "Contractor Registration", "rate": 18000.0, "description": "Road Construction Department Class I (Highest) Contractor Registration", "mandatory_docs": ["PAN Card", "Aadhaar Card", "Character Certificate", "High Value Bank Solvency", "3-Year Audited Balance Sheet"], "optional_docs": ["Joint Venture Agreement", "Engineers Bio-data"]},
    {"name": "GST Registration", "code": "GST_REG", "category": "Tax & Compliance", "rate": 1500.0, "description": "New GSTIN Registration for Proprietorship/Firm/Company", "mandatory_docs": ["PAN Card", "Aadhaar Card", "Electricity Bill / Rent Agreement", "Bank Statement / Cancelled Cheque"], "optional_docs": ["Partnership Deed / MOA"]},
    {"name": "GST Return", "code": "GST_RET", "category": "Tax & Compliance", "rate": 800.0, "description": "Monthly/Quarterly GSTR-1 & GSTR-3B Return Filing", "mandatory_docs": ["Sales & Purchase Invoices / Summary", "GST Portal Credentials"], "optional_docs": ["Bank Statement"]},
    {"name": "EPFO Registration", "code": "EPFO_REG", "category": "Tax & Compliance", "rate": 2000.0, "description": "Employees Provident Fund Organization Employer Registration", "mandatory_docs": ["PAN Card", "Aadhaar Card", "Bank Cancelled Cheque", "Specimen Signature"], "optional_docs": ["Shop Act / Trade License"]},
    {"name": "ESIC Registration", "code": "ESIC_REG", "category": "Tax & Compliance", "rate": 2000.0, "description": "Employee State Insurance Corporation Registration", "mandatory_docs": ["PAN Card", "Aadhaar Card", "Bank Cancelled Cheque", "Employee List with Wages"], "optional_docs": ["Rent Agreement"]},
    {"name": "Company Creation", "code": "CO_CREATION", "category": "Corporate Services", "rate": 8500.0, "description": "Pvt Ltd / LLP / OPC Incorporation with SPICe+ MCA filing", "mandatory_docs": ["PAN & Aadhaar of Directors", "Passport Size Photos", "Address Proof of Directors", "Office Address Electricity Bill & NOC"], "optional_docs": ["Name Reservation Approval"]},
    {"name": "Character Certificate", "code": "CHAR_CERT", "category": "Certificates & Licenses", "rate": 500.0, "description": "Police Character Verification Certificate for Bihar Tenders", "mandatory_docs": ["Aadhaar Card", "Passport Photo", "Residential Proof", "Ration Card / Voter ID"], "optional_docs": ["Matriculation Marksheet"]},
    {"name": "GEM Portal Registration", "code": "GEM_REG", "category": "Government Portals", "rate": 2500.0, "description": "Government e-Marketplace Primary Seller & Contractor Onboarding", "mandatory_docs": ["Digital Signature (DSC)", "PAN Card", "Aadhaar Linked Mobile", "Bank Account Details", "GSTIN"], "optional_docs": ["Udyam Registration"]},
    {"name": "Railway Registration", "code": "RAIL_REG", "category": "Government Portals", "rate": 3000.0, "description": "IREPS Indian Railways e-Procurement Portal Registration", "mandatory_docs": ["Class 3 DSC", "PAN Card", "Bank Cancelled Cheque", "Valid Email & Mobile"], "optional_docs": ["Experience Certificate"]},
    {"name": "PASARA Licence", "code": "PASARA", "category": "Certificates & Licenses", "rate": 15000.0, "description": "Private Security Agencies Regulation Act (PSARA) License", "mandatory_docs": ["Character Certificate", "Training Certificate", "Security Agency Office Lease", "IT Returns of Last 3 Years"], "optional_docs": ["Uniform and Logo Sample"]},
    {"name": "ISO Registration", "code": "ISO_REG", "category": "Corporate Services", "rate": 4500.0, "description": "ISO 9001:2015 Quality Management Certification", "mandatory_docs": ["Firm/Company Registration Proof", "Sale/Purchase Bill Copy", "Visiting Card / Letterhead"], "optional_docs": ["Organizational Flowchart"]},
    {"name": "MSME Registration", "code": "MSME_REG", "category": "Corporate Services", "rate": 800.0, "description": "Udyam MSME Government Certificate", "mandatory_docs": ["Aadhaar Card", "PAN Card", "Bank Account Number & IFSC"], "optional_docs": ["GSTIN (if applicable)"]},
    {"name": "Trade Mark Registration", "code": "TM_REG", "category": "Corporate Services", "rate": 6500.0, "description": "Trademark Brand Name & Logo IP Filing", "mandatory_docs": ["Brand Name / Logo Artwork", "Applicant PAN & Aadhaar", "User Affidavit (Date of Use Proof)"], "optional_docs": ["MSME Certificate"]},
    {"name": "Audit Report", "code": "AUDIT_REP", "category": "Tax & Compliance", "rate": 5000.0, "description": "Statutory Financial Audit Report & Balance Sheet Compilation", "mandatory_docs": ["Bank Statements for the Year", "Previous Year Audit Report", "Ledger Book / Tally Backup"], "optional_docs": ["GST 3B Filings"]},
    {"name": "K-Licence", "code": "K_LIC", "category": "Certificates & Licenses", "rate": 10000.0, "description": "K-Category Mining & Explosive / Mineral Transport License", "mandatory_docs": ["Mining Lease / Recommendation Letter", "Character Certificate", "Bank Solvency", "ID & Address Proof"], "optional_docs": ["Environmental Clearance"]},
    {"name": "MSTC Registration", "code": "MSTC_REG", "category": "Government Portals", "rate": 3500.0, "description": "MSTC e-Auction & Tender Buyer / Seller Portal Registration", "mandatory_docs": ["Class 3 DSC", "PAN Card", "GSTIN Certificate", "Cancelled Cheque"], "optional_docs": ["Bank Mandate Form"]},
    {"name": "PMGSY Site Registration", "code": "PMGSY_SITE", "category": "Government Portals", "rate": 2500.0, "description": "Pradhan Mantri Gram Sadak Yojana Contractor Portal Enrollment", "mandatory_docs": ["RWD Contractor Registration Proof", "Class 3 DSC", "PAN & Aadhaar"], "optional_docs": ["Contract Agreement Letter"]},
    {"name": "CPP Portal Registration", "code": "CPP_REG", "category": "Government Portals", "rate": 2000.0, "description": "Central Public Procurement Portal (CPPP) eProcure Registration", "mandatory_docs": ["Class 3 DSC", "PAN Card", "Company / Firm Registration Proof"], "optional_docs": ["Authorisation Letter"]},
    {"name": "Trade License", "code": "TRADE_LIC", "category": "Certificates & Licenses", "rate": 1800.0, "description": "Municipal Corporation Trade License Issuance / Renewal", "mandatory_docs": ["Property Tax Receipt / Rent Agreement", "Applicant ID Proof", "Shop Photo with Signboard"], "optional_docs": ["Fire NOC"]},
    {"name": "Other Portal Registration", "code": "OTHER_PORTAL", "category": "Government Portals", "rate": 2500.0, "description": "State / PSU Specific e-Tendering Portal Onboarding", "mandatory_docs": ["Portal Details / URL", "Class 3 DSC", "PAN & Aadhaar", "Firm Documents"], "optional_docs": ["Power of Attorney"]},
    {"name": "Other Services", "code": "OTHER_SRV", "category": "General Services", "rate": 1500.0, "description": "Custom Administrative, Documentation and Tender Consultancy Services", "mandatory_docs": ["Service Requirements Brief", "Primary Identity Proof"], "optional_docs": ["Supporting Documents"]},
]

# Ensure indexes for customer portal and service requests
async def init_customer_portal_indexes(db):
    try:
        # Unique request_no
        await db.service_requests.create_index([("request_no", 1)], unique=True)
        # Unique primary task relationship (only for non-null string task_ids)
        try:
            await db.service_requests.drop_index("task_id_1")
        except Exception:
            pass
        await db.service_requests.create_index(
            [("task_id", 1)],
            unique=True,
            partialFilterExpression={"task_id": {"$type": "string"}},
        )
        # Fast query queues
        await db.service_requests.create_index([("customer_id", 1), ("created_at", -1)])
        await db.service_requests.create_index([("customer_user_id", 1), ("created_at", -1)])
        await db.service_requests.create_index([("status", 1), ("created_at", -1)])
        await db.service_requests.create_index([("assigned_to", 1), ("status", 1)])
        await db.service_requests.create_index([("service_id", 1)])
        
        # Customer accounts indexing
        await db.users.create_index([("customer_id", 1)], sparse=True)
        await db.users.create_index([("numeric_user_id", 1)], sparse=True)
        
        # Service catalogue index
        await db.service_catalogue.create_index([("code", 1)], unique=True)
        await db.service_catalogue.create_index([("status", 1), ("display_order", 1)])
    except Exception as e:
        print(f"Index initialization warning: {e}")

# Helper to derive numeric Customer ID
def derive_numeric_customer_id(customer_doc: dict) -> str:
    code = customer_doc.get("customer_code") or ""
    # Extract digits from code e.g. "TDSC-CUST-ID-00000017" -> "00000017"
    digits = re.sub(r"\D", "", code)
    if digits:
        return digits.zfill(8)
    
    # Fallback to customer ID numeric hash
    cid = customer_doc.get("id") or ""
    cid_digits = re.sub(r"\D", "", cid)
    if cid_digits:
        return cid_digits[-8:].zfill(8)
    return str(abs(hash(cid)))[-8:].zfill(8)

# Helper to compute temporary password according to policy:
# "The requested initial password policy is the first four letters of the customer's name plus the year of birth."
def generate_customer_temp_password(customer_doc: dict) -> str:
    name = (customer_doc.get("name") or "User").strip()
    clean_name = re.sub(r"[^a-zA-Z]", "", name)
    first_four = (clean_name[:4] if len(clean_name) >= 4 else clean_name.ljust(4, "X")).upper()
    
    dob = customer_doc.get("date_of_birth") or customer_doc.get("dob") or ""
    year_str = ""
    if dob:
        m = re.search(r"\b(19\d\d|20\d\d)\b", str(dob))
        if m:
            year_str = m.group(1)
            
    if not year_str:
        # Secure fallback: last 4 digits of mobile or current year
        mobile = re.sub(r"\D", "", customer_doc.get("mobile") or "")
        year_str = mobile[-4:] if len(mobile) >= 4 else "2026"
        
    return f"{first_four}{year_str}"
