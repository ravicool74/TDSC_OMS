import uuid
from datetime import datetime, timezone
from typing import List, Optional, Any
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from security_vault import log_audit_entry, now_utc

class WorkflowStageDef(BaseModel):
    order: int
    name: str
    role: Optional[str] = None
    description: Optional[str] = None
    color: Optional[str] = None

class ServiceWorkflow(BaseModel):
    id: str
    service_id: Optional[str] = None
    service_name: str
    stages: List[WorkflowStageDef] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=now_utc)
    updated_at: datetime = Field(default_factory=now_utc)

class SaveWorkflowInput(BaseModel):
    service_id: Optional[str] = None
    service_name: str
    stages: List[WorkflowStageDef]

DEFAULT_SERVICE_WORKFLOWS = [
    {
        "service_name": "Digital Signature (DSC Class 3)",
        "stages": [
            {"order": 0, "name": "Document Collection", "role": "DEO", "description": "Aadhaar, PAN, Photo, OTP mobile validation", "color": "#3B82F6"},
            {"order": 1, "name": "KYC & Video Verification", "role": "Accountant", "description": "Video KYC, email verification and applicant approval", "color": "#8B5CF6"},
            {"order": 2, "name": "Token Download & Issuance", "role": "Manager", "description": "Token download, password PIN setup, certificate import", "color": "#F59E0B"},
            {"order": 3, "name": "Client Delivery & Settlement", "role": "Admin", "description": "Handover to client, acknowledgment and payment reconciliation", "color": "#10B981"}
        ]
    },
    {
        "service_name": "E-Tender Service",
        "stages": [
            {"order": 0, "name": "NIT & Eligibility Review", "role": "DEO", "description": "Check tender notice, experience criteria, EMD/Tender fee", "color": "#3B82F6"},
            {"order": 1, "name": "BOQ & Financial Rate Analysis", "role": "Accountant", "description": "Estimate preparation, rate analysis, item quoting", "color": "#8B5CF6"},
            {"order": 2, "name": "Technical Bid Compilation", "role": "Manager", "description": "Dossier compilation, DSC encryption, affidavit & affidavits", "color": "#F59E0B"},
            {"order": 3, "name": "Portal Submission & Acknowledgment", "role": "Admin", "description": "Final portal bid submission, receipt generation", "color": "#10B981"}
        ]
    },
    {
        "service_name": "GeM Registration",
        "stages": [
            {"order": 0, "name": "Basic Profile & Aadhaar Link", "role": "DEO", "description": "Primary user creation, Aadhaar OTP authentication", "color": "#3B82F6"},
            {"order": 1, "name": "Vendor Assessment & Bank Link", "role": "Accountant", "description": "Bank account validation, caution money deposit", "color": "#8B5CF6"},
            {"order": 2, "name": "Brand / OEM Approval", "role": "Manager", "description": "Brand upload, catalog listing, OEM authorization", "color": "#F59E0B"},
            {"order": 3, "name": "Account Activation & Handover", "role": "Admin", "description": "Profile 100% completion & handover to client", "color": "#10B981"}
        ]
    },
    {
        "service_name": "GST Registration",
        "stages": [
            {"order": 0, "name": "Document Verification", "role": "DEO", "description": "Electricity bill, rent agreement, proprietor KYC", "color": "#3B82F6"},
            {"order": 1, "name": "TRN Generation & Part-B Filing", "role": "Accountant", "description": "Filling business details, goods/services HSN/SAC", "color": "#8B5CF6"},
            {"order": 2, "name": "ARN Tracking & Aadhaar Auth", "role": "Manager", "description": "Biometric/Aadhaar OTP auth and officer query reply", "color": "#F59E0B"},
            {"order": 3, "name": "Certificate Issuance", "role": "Admin", "description": "GSTIN allotment certificate download & login delivery", "color": "#10B981"}
        ]
    },
    {
        "service_name": "Contractor Registration",
        "stages": [
            {"order": 0, "name": "File Preparation & Affidavit", "role": "DEO", "description": "Work experience certificates, character certificate, machinery list", "color": "#3B82F6"},
            {"order": 1, "name": "Solvency & Bank Guarantee", "role": "Accountant", "description": "Bank solvency certificate and registration fee challan", "color": "#8B5CF6"},
            {"order": 2, "name": "Department Submission", "role": "Manager", "description": "PWD / RWD / BCD department portal submission", "color": "#F59E0B"},
            {"order": 3, "name": "License Approval & Dispatch", "role": "Admin", "description": "Contractor license book receipt and client delivery", "color": "#10B981"}
        ]
    },
    {
        "service_name": "Payment Follow-up",
        "stages": [
            {"order": 0, "name": "Invoice Notice Sent", "role": "Accountant", "description": "Invoice copy and payment reminder shared on WhatsApp/Email", "color": "#3B82F6"},
            {"order": 1, "name": "Tele-calling & Commitment", "role": "DEO", "description": "Follow-up phone call with client, recording promise date", "color": "#8B5CF6"},
            {"order": 2, "name": "Escalation / Manager Review", "role": "Manager", "description": "Manager level escalation for overdue balance", "color": "#F59E0B"},
            {"order": 3, "name": "Payment Received & Reconciled", "role": "Admin", "description": "Bank receipt matched, balance cleared, voucher adjusted", "color": "#10B981"}
        ]
    }
]

def make_service_workflow_router(db, get_current_user, require_admin):
    router = APIRouter(prefix="/service-workflows", tags=["service-workflows"])

    async def ensure_defaults():
        cnt = await db.service_workflows.count_documents({})
        if cnt == 0:
            for item in DEFAULT_SERVICE_WORKFLOWS:
                doc = {
                    "id": f"swf_{uuid.uuid4().hex[:10]}",
                    "service_id": None,
                    "service_name": item["service_name"],
                    "stages": item["stages"],
                    "created_at": now_utc(),
                    "updated_at": now_utc(),
                }
                await db.service_workflows.insert_one(doc)

    @router.get("", response_model=List[ServiceWorkflow])
    async def list_service_workflows(current: any = Depends(get_current_user)):
        await ensure_defaults()
        docs = await db.service_workflows.find({}, {"_id": 0}).sort("service_name", 1).to_list(100)
        return [ServiceWorkflow(**d) for d in docs]

    @router.get("/{name_or_id}")
    async def get_service_workflow(name_or_id: str, current: any = Depends(get_current_user)):
        await ensure_defaults()
        doc = await db.service_workflows.find_one(
            {"$or": [{"id": name_or_id}, {"service_id": name_or_id}, {"service_name": name_or_id}]},
            {"_id": 0}
        )
        if not doc:
            # Case-insensitive match on service_name
            doc = await db.service_workflows.find_one(
                {"service_name": {"$regex": f"^{name_or_id}$", "$options": "i"}},
                {"_id": 0}
            )
        if not doc:
            # Return default generic 4-stage workflow
            return {
                "id": "swf_default",
                "service_name": name_or_id,
                "stages": [
                    {"order": 0, "name": "Data Entry & Collection", "role": "DEO", "description": "Initial collection", "color": "#3B82F6"},
                    {"order": 1, "name": "Accounts Verification", "role": "Accountant", "description": "Billing & check", "color": "#8B5CF6"},
                    {"order": 2, "name": "Manager Review", "role": "Manager", "description": "Operational review", "color": "#F59E0B"},
                    {"order": 3, "name": "Final Admin Approval", "role": "Admin", "description": "Completion & delivery", "color": "#10B981"},
                ]
            }
        return doc

    @router.post("", response_model=ServiceWorkflow)
    async def save_service_workflow(
        payload: SaveWorkflowInput,
        current: any = Depends(require_admin)
    ):
        """Admin defines or updates the workflow chart for a specific service."""
        now = now_utc()
        existing = await db.service_workflows.find_one({
            "$or": [
                {"service_name": payload.service_name},
                {"service_id": payload.service_id} if payload.service_id else {"_id": None}
            ]
        })

        stages_dict = [s.dict() for s in payload.stages]
        # Ensure order is 0, 1, 2...
        for idx, s in enumerate(stages_dict):
            s["order"] = idx

        if existing:
            await db.service_workflows.update_one(
                {"id": existing["id"]},
                {"$set": {
                    "stages": stages_dict,
                    "service_name": payload.service_name,
                    "service_id": payload.service_id or existing.get("service_id"),
                    "updated_at": now
                }}
            )
            doc = await db.service_workflows.find_one({"id": existing["id"]}, {"_id": 0})
            await log_audit_entry(db, current, "service_workflows", "update", existing["id"], existing, doc)
            return ServiceWorkflow(**doc)
        else:
            wid = f"swf_{uuid.uuid4().hex[:10]}"
            doc = {
                "id": wid,
                "service_id": payload.service_id,
                "service_name": payload.service_name,
                "stages": stages_dict,
                "created_at": now,
                "updated_at": now,
            }
            await db.service_workflows.insert_one(doc)
            await log_audit_entry(db, current, "service_workflows", "create", wid, None, doc)
            return ServiceWorkflow(**doc)

    return router
