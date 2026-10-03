import os
import base64
import hashlib
from typing import Optional
from datetime import datetime, timezone
from cryptography.fernet import Fernet

def now_utc() -> datetime:
    return datetime.now(timezone.utc)

def get_vault_cipher() -> Fernet:
    secret = os.environ.get("VAULT_SECRET_KEY", "TDSC_SECRET_CREDENTIAL_VAULT_KEY_2026_TRIVENI_PRIVATE_LIMITED")
    key = base64.urlsafe_b64encode(hashlib.sha256(secret.encode()).digest())
    return Fernet(key)

def encrypt_credential(plain_text: Optional[str]) -> Optional[str]:
    """Encrypt sensitive portal password using AES-256 (Fernet)."""
    if not plain_text or not plain_text.strip():
        return plain_text
    cipher = get_vault_cipher()
    token = cipher.encrypt(plain_text.strip().encode())
    return f"ENC:{token.decode()}"

def decrypt_credential(cipher_text: Optional[str]) -> Optional[str]:
    """Decrypt sensitive portal password. Handles legacy unencrypted strings gracefully."""
    if not cipher_text:
        return cipher_text
    if cipher_text.startswith("ENC:"):
        token = cipher_text[4:]
        try:
            cipher = get_vault_cipher()
            return cipher.decrypt(token.encode()).decode()
        except Exception:
            return "••••••••"
    return cipher_text

def mask_credential(value: Optional[str]) -> Optional[str]:
    """Return masked dots if value is present, else None."""
    if not value or not value.strip():
        return None
    return "••••••••"

def clean_json_value(val: any) -> any:
    if val is None:
        return None
    if isinstance(val, dict):
        return {str(k): clean_json_value(v) for k, v in val.items() if k != "_id"}
    if isinstance(val, (list, tuple, set)):
        return [clean_json_value(v) for v in val]
    if hasattr(val, "isoformat"):
        return val.isoformat()
    if type(val).__name__ == "ObjectId":
        return str(val)
    if isinstance(val, (str, int, float, bool)):
        return val
    return str(val)

async def log_audit_entry(
    db,
    user: any,
    module: str,
    action: str,
    record_id: str = "",
    old_value: any = None,
    new_value: any = None,
    ip_address: str = "",
    device_info: str = ""
):
    """Immutable audit logging for sensitive actions and changes."""
    user_id = getattr(user, "user_id", None) or (user.get("user_id") if isinstance(user, dict) else "system")
    user_name = getattr(user, "name", None) or (user.get("name") if isinstance(user, dict) else "System")
    user_email = getattr(user, "email", None) or (user.get("email") if isinstance(user, dict) else "")
    user_role = getattr(user, "role", None) or (user.get("role") if isinstance(user, dict) else "")

    entry = {
        "id": f"aud_{now_utc().strftime('%Y%m%d%H%M%S')}_{os.urandom(4).hex()}",
        "user_id": user_id,
        "user_name": user_name,
        "user_email": user_email,
        "user_role": user_role,
        "module": module,
        "action": action,
        "record_id": str(record_id),
        "old_value": clean_json_value(old_value),
        "new_value": clean_json_value(new_value),
        "ip_address": ip_address,
        "device_info": device_info,
        "created_at": now_utc(),
    }
    try:
        await db.audit_logs.insert_one(entry)
    except Exception as e:
        import logging
        logging.getLogger("audit").error(f"Failed to record audit log: {e}")
