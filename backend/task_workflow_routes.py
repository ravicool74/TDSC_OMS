import uuid
from datetime import datetime, timezone
from typing import List, Optional, Any
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from security_vault import log_audit_entry, now_utc
from notification_routes import send_system_notification

WORKFLOW_STAGES = [
    {"index": 0, "name": "Data Entry Operator", "role_key": "data_entry_operator"},
    {"index": 1, "name": "Accountant", "role_key": "accountant"},
    {"index": 2, "name": "Manager", "role_key": "manager"},
    {"index": 3, "name": "Admin", "role_key": "admin"},
]

class WorkflowActionInput(BaseModel):
    action: str  # approve, reject, forward, return, comment
    remarks: Optional[str] = None
    target_stage_index: Optional[int] = None
    assigned_user_id: Optional[str] = None

class WorkflowHistoryItem(BaseModel):
    id: str
    action: str
    from_stage: str
    to_stage: str
    action_by_id: str
    action_by_name: str
    action_by_role: str
    remarks: Optional[str] = None
    timestamp: datetime = Field(default_factory=now_utc)

class EnhancedTask(BaseModel):
    id: str
    task_id: Optional[str] = None
    task_no: Optional[str] = None
    title: str
    description: Optional[str] = None
    customer_id: Optional[str] = None
    customer_code: Optional[str] = None
    customer_name: Optional[str] = None
    project: Optional[str] = None
    branch: Optional[str] = None
    priority: str = "medium"  # urgent, high, medium, low
    start_date: Optional[str] = None
    due_date: Optional[str] = None
    assigned_user: Optional[str] = None
    assigned_name: Optional[str] = None
    status: str = "pending"  # pending, assigned, in_progress, under_review, completed, rejected, cancelled
    
    task_category: Optional[str] = "task_followup"
    service_id: Optional[str] = None
    service_name: Optional[str] = None
    workflow_stages: List[dict] = Field(default_factory=list)
    chat_participants: List[str] = Field(default_factory=list)
    
    total_amount: Optional[float] = 0
    paid_amount: Optional[float] = 0
    dues_amount: Optional[float] = 0
    voucher_no: Optional[str] = None
    voucher_date: Optional[str] = None
    deadline: Optional[str] = None
    
    current_stage_index: int = 0
    current_stage_name: str = "Data Entry Operator"
    workflow_history: List[WorkflowHistoryItem] = Field(default_factory=list)
    remarks: Optional[str] = None
    created_at: datetime = Field(default_factory=now_utc)
    updated_at: datetime = Field(default_factory=now_utc)

class CreateTaskInput(BaseModel):
    title: str
    description: Optional[str] = None
    customer_id: Optional[str] = None
    project: Optional[str] = None
    branch: Optional[str] = None
    priority: str = "medium"
    start_date: Optional[str] = None
    due_date: Optional[str] = None
    assigned_user: Optional[str] = None
    remarks: Optional[str] = None
    task_category: Optional[str] = "task_followup"
    service_id: Optional[str] = None
    service_name: Optional[str] = None
    chat_participants: Optional[List[str]] = None

def make_task_workflow_router(db, get_current_user, require_admin, require_admin_or_manager):
    router = APIRouter(prefix="/tasks-workflow", tags=["tasks-workflow"])

    async def get_next_task_id() -> str:
        counter = await db.counters.find_one_and_update(
            {"_id": "task_id"},
            {"$inc": {"seq": 1}},
            upsert=True,
            return_document=True
        )
        seq = counter.get("seq", 1)
        return f"TDSC-TSK-{seq:06d}"

    @router.get("", response_model=List[EnhancedTask])
    async def list_tasks(
        q: Optional[str] = Query(None),
        status: Optional[str] = Query(None),
        priority: Optional[str] = Query(None),
        branch: Optional[str] = Query(None),
        stage: Optional[str] = Query(None),
        assigned_user: Optional[str] = Query(None),
        category: Optional[str] = Query(None),
        current: any = Depends(get_current_user)
    ):
        query = {}
        if status: query["status"] = status
        if priority: query["priority"] = priority
        if branch: query["branch"] = branch
        if stage: query["current_stage_name"] = stage
        if assigned_user: query["assigned_user"] = assigned_user
        if category: query["task_category"] = category

        # Non-admin / non-manager users see their own assigned tasks or branch tasks
        if current.role not in ("admin", "manager", "super_admin"):
            query["$or"] = [
                {"assigned_user": current.user_id},
                {"created_by": current.user_id},
                {"chat_participants": current.user_id},
            ]

        if q:
            regex = {"$regex": q.strip(), "$options": "i"}
            query["$or"] = [
                {"title": regex},
                {"task_id": regex},
                {"task_no": regex},
                {"customer_name": regex},
                {"customer_code": regex},
                {"project": regex},
                {"description": regex},
            ]

        docs = await db.tasks.find(query, {"_id": 0}).sort("created_at", -1).to_list(500)
        res = []
        for d in docs:
            # Ensure workflow fields exist
            if "task_id" not in d:
                d["task_id"] = d.get("task_no") or d.get("id")
            if "current_stage_index" not in d:
                d["current_stage_index"] = 0
                d["current_stage_name"] = "Data Entry Operator"
            if "workflow_history" not in d:
                d["workflow_history"] = []
            res.append(EnhancedTask(**d))
        return res

    @router.post("", response_model=EnhancedTask)
    async def create_task(payload: CreateTaskInput, current: any = Depends(get_current_user)):
        task_id = await get_next_task_id()
        now = now_utc()
        
        cname, ccode = None, None
        if payload.customer_id:
            cust = await db.customers.find_one({"$or": [{"id": payload.customer_id}, {"customer_code": payload.customer_id}]})
            if cust:
                cname = cust.get("name")
                ccode = cust.get("customer_code")

        as_name = None
        if payload.assigned_user:
            u = await db.users.find_one({"user_id": payload.assigned_user})
            if u: as_name = u.get("name")

        # Resolve workflow stages for service
        resolved_stages = []
        if payload.service_name or payload.project:
            svc_name = payload.service_name or payload.project
            swf = await db.service_workflows.find_one(
                {"$or": [{"service_name": svc_name}, {"service_id": payload.service_id}]},
                {"_id": 0}
            )
            if swf and swf.get("stages"):
                resolved_stages = swf["stages"]

        first_stage_name = resolved_stages[0]["name"] if resolved_stages else WORKFLOW_STAGES[0]["name"]

        doc = payload.dict()
        doc.update({
            "id": f"tsk_{uuid.uuid4().hex[:12]}",
            "task_id": task_id,
            "task_no": task_id,
            "customer_name": cname,
            "customer_code": ccode,
            "assigned_name": as_name,
            "status": "assigned" if payload.assigned_user else "pending",
            "current_stage_index": 0,
            "current_stage_name": first_stage_name,
            "workflow_stages": resolved_stages,
            "chat_participants": payload.chat_participants or ([payload.assigned_user] if payload.assigned_user else []),
            "workflow_history": [{
                "id": f"wh_{uuid.uuid4().hex[:8]}",
                "action": "create",
                "from_stage": "Start",
                "to_stage": first_stage_name,
                "action_by_id": current.user_id,
                "action_by_name": current.name,
                "action_by_role": current.role,
                "remarks": "Task registered",
                "timestamp": now
            }],
            "created_by": current.user_id,
            "created_at": now,
            "updated_at": now,
        })

        await db.tasks.insert_one(doc)
        await log_audit_entry(db, current, "tasks", "create", task_id, None, doc)

        # Send notification to assigned user
        if payload.assigned_user:
            await send_system_notification(
                db=db,
                title="New Task Assigned",
                message=f"You have been assigned task '{payload.title}' ({task_id})",
                notif_type="task",
                recipient_id=payload.assigned_user,
                link=f"/tasks/{doc['id']}"
            )

        return EnhancedTask(**doc)

    @router.post("/{tid}/action", response_model=EnhancedTask)
    async def perform_workflow_action(
        tid: str,
        payload: WorkflowActionInput,
        current: any = Depends(get_current_user)
    ):
        """Execute stage workflow operation: Approve (Approved to Next), Reject, Forward, Return (Back), Comment."""
        task = await db.tasks.find_one({"$or": [{"id": tid}, {"task_id": tid}, {"task_no": tid}]})
        if not task:
            raise HTTPException(status_code=404, detail="Task not found")

        # Determine effective stages
        active_stages = task.get("workflow_stages") or task.get("stages") or []
        if not active_stages:
            # Try to lookup by service_name or task_type_name
            svc_name = task.get("service_name") or task.get("task_type_name") or task.get("project")
            if svc_name:
                swf = await db.service_workflows.find_one(
                    {"service_name": {"$regex": f"^{svc_name}$", "$options": "i"}},
                    {"_id": 0}
                )
                if swf and swf.get("stages"):
                    active_stages = swf["stages"]

        if not active_stages:
            active_stages = WORKFLOW_STAGES

        total_stages = len(active_stages)
        curr_idx = task.get("current_stage_index", 0)
        if curr_idx >= total_stages:
            curr_idx = max(0, total_stages - 1)

        from_stage = active_stages[curr_idx].get("name", f"Stage {curr_idx+1}")
        to_idx = curr_idx
        to_stage = from_stage
        status = task.get("status", "in_progress")
        act = payload.action.lower().strip()
        now = now_utc()

        if act == "approve":
            # Approved to Next
            if curr_idx < total_stages - 1:
                to_idx = curr_idx + 1
                to_stage = active_stages[to_idx].get("name", f"Stage {to_idx+1}")
                status = "in_progress"
            else:
                to_stage = "Completed"
                status = "completed"
        elif act == "forward":
            if payload.target_stage_index is not None and 0 <= payload.target_stage_index < total_stages:
                to_idx = payload.target_stage_index
            else:
                to_idx = min(total_stages - 1, curr_idx + 1)
            to_stage = active_stages[to_idx].get("name", f"Stage {to_idx+1}")
            status = "in_progress"
        elif act == "return" or act == "back":
            act = "return"
            if payload.target_stage_index is not None and 0 <= payload.target_stage_index < total_stages:
                to_idx = payload.target_stage_index
            else:
                to_idx = max(0, curr_idx - 1)
            to_stage = active_stages[to_idx].get("name", f"Stage {to_idx+1}")
            status = "under_review"
        elif act == "reject":
            status = "rejected"
            to_stage = f"Rejected at {from_stage}"
        elif act == "comment":
            # Stage remains unchanged
            pass
        else:
            raise HTTPException(status_code=400, detail=f"Invalid action: {act}")

        history_entry = {
            "id": f"wh_{uuid.uuid4().hex[:8]}",
            "action": act,
            "from_stage": from_stage,
            "to_stage": to_stage,
            "action_by_id": current.user_id,
            "action_by_name": current.name,
            "action_by_role": current.role,
            "remarks": payload.remarks,
            "timestamp": now
        }

        updates = {
            "status": status,
            "current_stage_index": to_idx,
            "current_stage_name": to_stage if status != "rejected" else from_stage,
            "workflow_stages": active_stages,
            "updated_at": now,
        }
        if payload.assigned_user_id:
            u = await db.users.find_one({"user_id": payload.assigned_user_id})
            if u:
                updates["assigned_user"] = u["user_id"]
                updates["assigned_name"] = u.get("name")
                updates["assignee_id"] = u["user_id"]
                updates["assignee_name"] = u.get("name")

        await db.tasks.update_one(
            {"id": task["id"]},
            {"$set": updates, "$push": {"workflow_history": history_entry}}
        )

        # Automated Chat Bot notification message into task_chats
        emoji = "✅" if act == "approve" else "⏩" if act == "forward" else "↩️" if act == "return" else "❌" if act == "reject" else "💬"
        action_title = "APPROVED TO NEXT" if act == "approve" else "FORWARDED" if act == "forward" else "RETURNED (BACK)" if act == "return" else "REJECTED" if act == "reject" else "COMMENT"
        
        chat_msg_text = f"{emoji} [{action_title}] {from_stage} → {to_stage}\nBy: {current.name} ({current.role})"
        if payload.remarks:
            chat_msg_text += f"\nRemarks: {payload.remarks}"

        sys_chat_doc = {
            "id": f"msg_{uuid.uuid4().hex[:12]}",
            "task_id": task["id"],
            "sender_id": current.user_id,
            "sender_name": "Workflow Engine",
            "sender_role": "system",
            "message": chat_msg_text,
            "attachment": None,
            "is_system": True,
            "timestamp": now,
        }
        await db.task_chats.insert_one(sys_chat_doc)

        updated = await db.tasks.find_one({"id": task["id"]}, {"_id": 0})
        await log_audit_entry(db, current, "tasks", f"workflow_{act}", task.get("task_id"), task, history_entry)
        
        return EnhancedTask(**updated)

    return router
