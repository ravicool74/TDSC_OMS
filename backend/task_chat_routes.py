import uuid
from datetime import datetime, timezone
from typing import List, Optional, Any
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from pydantic import BaseModel, Field
from security_vault import log_audit_entry, now_utc
from notification_routes import send_system_notification

class TaskChatMessage(BaseModel):
    id: str
    task_id: str
    sender_id: str
    sender_name: str
    sender_role: str
    message: str
    attachment: Optional[dict] = None
    is_system: bool = False
    timestamp: datetime = Field(default_factory=now_utc)

class SendMessageInput(BaseModel):
    message: str
    attachment: Optional[dict] = None

class UpdateParticipantsInput(BaseModel):
    participant_ids: List[str]

def make_task_chat_router(db, get_current_user, require_admin):
    router = APIRouter(prefix="/tasks", tags=["task-chat"])

    async def check_task_chat_access(task: dict, user: any) -> bool:
        """Admin/Super Admin always has access. For others, must be in chat_participants or assignee or creator."""
        if user.role in ("admin", "super_admin", "manager"):
            return True
        participants = task.get("chat_participants") or []
        user_id = str(user.user_id)
        if user_id in participants:
            return True
        if task.get("assignee_id") == user_id or task.get("assigned_user") == user_id:
            return True
        if task.get("created_by") == user_id:
            return True
        return False

    @router.get("/{tid}/chat", response_model=List[TaskChatMessage])
    async def get_task_chat(tid: str, current: any = Depends(get_current_user)):
        task = await db.tasks.find_one({"$or": [{"id": tid}, {"task_id": tid}, {"task_no": tid}]})
        if not task:
            raise HTTPException(status_code=404, detail="Task not found")

        has_access = await check_task_chat_access(task, current)
        if not has_access:
            raise HTTPException(status_code=403, detail="You are not authorized to view the chat for this task")

        docs = await db.task_chats.find({"task_id": task["id"]}, {"_id": 0}).sort("timestamp", 1).to_list(1000)
        return [TaskChatMessage(**d) for d in docs]

    @router.post("/{tid}/chat", response_model=TaskChatMessage)
    async def send_task_chat_message(
        tid: str,
        payload: SendMessageInput,
        current: any = Depends(get_current_user)
    ):
        task = await db.tasks.find_one({"$or": [{"id": tid}, {"task_id": tid}, {"task_no": tid}]})
        if not task:
            raise HTTPException(status_code=404, detail="Task not found")

        has_access = await check_task_chat_access(task, current)
        if not has_access:
            raise HTTPException(status_code=403, detail="You are not authorized to chat on this task")

        if not payload.message.strip() and not payload.attachment:
            raise HTTPException(status_code=400, detail="Message or attachment required")

        msg_doc = {
            "id": f"msg_{uuid.uuid4().hex[:12]}",
            "task_id": task["id"],
            "sender_id": current.user_id,
            "sender_name": current.name,
            "sender_role": current.role,
            "message": payload.message.strip(),
            "attachment": payload.attachment,
            "is_system": False,
            "timestamp": now_utc(),
        }

        await db.task_chats.insert_one(msg_doc)

        # Notify other participants + admin
        recipients = set(task.get("chat_participants") or [])
        if task.get("assignee_id"):
            recipients.add(task["assignee_id"])
        if task.get("created_by"):
            recipients.add(task["created_by"])
        # Remove sender from recipient notifications
        recipients.discard(current.user_id)

        task_title = task.get("title") or task.get("task_no") or "Task"
        for rec_id in recipients:
            try:
                await send_system_notification(
                    db=db,
                    title=f"Chat: {task_title}",
                    message=f"{current.name}: {payload.message[:80]}",
                    notif_type="chat",
                    recipient_id=rec_id,
                    link=f"/tasks/{task['id']}"
                )
            except Exception:
                pass

        return TaskChatMessage(**msg_doc)

    @router.get("/{tid}/chat/participants")
    async def get_task_chat_participants(tid: str, current: any = Depends(get_current_user)):
        task = await db.tasks.find_one({"$or": [{"id": tid}, {"task_id": tid}, {"task_no": tid}]})
        if not task:
            raise HTTPException(status_code=404, detail="Task not found")

        participant_ids = set(task.get("chat_participants") or [])
        if task.get("assignee_id"):
            participant_ids.add(task["assignee_id"])

        users = []
        if participant_ids:
            found = await db.users.find(
                {"$or": [{"user_id": {"$in": list(participant_ids)}}, {"id": {"$in": list(participant_ids)}}]},
                {"_id": 0, "password_hash": 0}
            ).to_list(100)
            users = found

        return {
            "task_id": task["id"],
            "chat_participants": list(participant_ids),
            "users": users,
            "assignee_id": task.get("assignee_id"),
            "assignee_name": task.get("assignee_name"),
        }

    @router.put("/{tid}/chat/participants")
    async def update_task_chat_participants(
        tid: str,
        payload: UpdateParticipantsInput,
        current: any = Depends(require_admin)
    ):
        """Admin fixes/updates which employees are allowed to participate in this task's chat."""
        task = await db.tasks.find_one({"$or": [{"id": tid}, {"task_id": tid}, {"task_no": tid}]})
        if not task:
            raise HTTPException(status_code=404, detail="Task not found")

        cleaned_ids = list(set(payload.participant_ids))
        await db.tasks.update_one(
            {"id": task["id"]},
            {"$set": {"chat_participants": cleaned_ids, "updated_at": now_utc()}}
        )

        # Post system message into chat
        emp_names = []
        if cleaned_ids:
            emps = await db.users.find({"user_id": {"$in": cleaned_ids}}, {"_id": 0, "name": 1}).to_list(100)
            emp_names = [e.get("name", "Employee") for e in emps]
        joined_names = ", ".join(emp_names) if emp_names else "None"

        sys_msg = {
            "id": f"msg_{uuid.uuid4().hex[:12]}",
            "task_id": task["id"],
            "sender_id": current.user_id,
            "sender_name": "System",
            "sender_role": "admin",
            "message": f"🔒 Admin updated chat participants: {joined_names}",
            "attachment": None,
            "is_system": True,
            "timestamp": now_utc(),
        }
        await db.task_chats.insert_one(sys_msg)

        return {"status": "ok", "chat_participants": cleaned_ids, "names": emp_names}

    return router
