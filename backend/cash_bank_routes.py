import os
import uuid
import shutil
from datetime import datetime, timezone, date, timedelta
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from pydantic import BaseModel, Field
from pathlib import Path

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

def inr(n: Any) -> str:
    try:
        val = float(n or 0)
        return f"₹ {val:,.2f}"
    except Exception:
        return f"₹ {n}"

UPLOADS_DIR = Path(__file__).parent / "uploads" / "cash_bank"
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

# Pydantic Request Models
class BankTransferPayload(BaseModel):
    transfer_type: str = Field(..., description="bank_to_cash | cash_to_bank | bank_to_bank | adjust_balance")
    direction: Optional[str] = "deposit"  # "deposit" or "withdraw" for bank_to_cash and cash_to_bank
    adjust_action: Optional[str] = "increase"  # "increase" or "reduce" for adjust_balance
    transfer_date: str = Field(default_factory=lambda: date.today().isoformat())
    deposit_to: Optional[str] = None
    deposit_to_name: Optional[str] = None
    withdraw_from: Optional[str] = None
    withdraw_from_name: Optional[str] = None
    account_id: Optional[str] = None  # for adjust_balance
    account_name: Optional[str] = None
    amount: float = Field(..., gt=0)
    description: Optional[str] = None
    attachment_path: Optional[str] = None
    attachment_name: Optional[str] = None

class ChequeDepositPayload(BaseModel):
    transfer_date: str = Field(default_factory=lambda: date.today().isoformat())
    deposit_to: str = Field(..., description="cash or bank_account_id")
    deposit_to_name: Optional[str] = None
    description: Optional[str] = None

class LoanAccountCreate(BaseModel):
    account_name: str
    account_number: str
    lender_bank: str
    description: Optional[str] = None
    opening_balance: float = Field(..., ge=0)
    balance_as_of: str = Field(default_factory=lambda: date.today().isoformat())
    loan_received_in: str = Field(..., description="cash or bank_account_id")
    interest_rate: float = Field(default=8.5, ge=0)
    duration_months: int = Field(default=36, gt=0)
    processing_fee: float = Field(default=0.0, ge=0)

def make_cash_bank_router(db, get_current_user, require_admin, require_admin_or_manager, log_audit=None, prefix="/accounting/cash-bank"):
    router = APIRouter(prefix=prefix, tags=["cash-bank"])

    async def _ensure_seed_records():
        """Disabled in real production mode."""
        return

    # =========================================================================
    # 1. Attachment Upload Endpoint (for all transfer/cheque/loan vouchers)
    # =========================================================================
    @router.post("/upload-attachment")
    async def upload_attachment(file: UploadFile = File(...), current: Any = Depends(get_current_user)):
        ext = (file.filename or "receipt.jpg").rsplit(".", 1)[-1].lower()
        if ext not in ["jpg", "jpeg", "png", "pdf", "webp"]:
            ext = "jpg"
        file_id = f"att_{uuid.uuid4().hex[:12]}.{ext}"
        target_path = UPLOADS_DIR / file_id

        data = await file.read()
        with open(target_path, "wb") as f:
            f.write(data)

        # Store web accessible path
        rel_url = f"/api/accounting/cash-bank/attachments/{file_id}"
        return {
            "attachment_id": file_id,
            "attachment_name": file.filename or f"attachment.{ext}",
            "attachment_url": rel_url,
            "size": len(data)
        }

    @router.get("/attachments/{file_id}")
    async def get_attachment(file_id: str):
        target = UPLOADS_DIR / file_id
        if not target.exists():
            raise HTTPException(status_code=404, detail="Attachment not found")
        from fastapi.responses import FileResponse
        return FileResponse(str(target))

    # =========================================================================
    # 2. Bank Accounts & Balance Listing
    # =========================================================================
    @router.get("/banks")
    async def list_bank_accounts(current: Any = Depends(get_current_user)):
        await _ensure_seed_records()
        banks = await db.bank_accounts.find({}, {"_id": 0}).to_list(100)
        return clean_doc(banks)

    # =========================================================================
    # 3. Transfer & Adjustment Operations (All 4 Types)
    # =========================================================================
    @router.post("/transfer")
    async def execute_transfer(payload: BankTransferPayload, current: Any = Depends(get_current_user)):
        await _ensure_seed_records()
        now = now_utc()
        tx_id = f"tx_{uuid.uuid4().hex[:10]}"
        amount = float(payload.amount)

        # ----------------------------------------------------
        # (a) Bank to Cash Transfer
        # ----------------------------------------------------
        if payload.transfer_type == "bank_to_cash":
            # Two options: "deposit" or "withdraw"
            direction = payload.direction or "deposit"
            bank_id = payload.withdraw_from if direction == "deposit" else payload.deposit_to

            # Validate bank
            bank = await db.bank_accounts.find_one({"id": bank_id}, {"_id": 0})
            if not bank:
                # Fallback to first active bank
                bank = await db.bank_accounts.find_one({}, {"_id": 0})
            bank_name = f"{bank['name']} ({bank['bank_name']})" if bank else "Bank Account"

            if direction == "deposit":
                # Deposit to Cash, Withdraw from Bank
                # Bank balance decreases, Cash in hand increases
                await db.bank_accounts.update_one({"id": bank["id"]}, {"$inc": {"opening_balance": -amount}})
                tx_record = {
                    "id": tx_id,
                    "transfer_type": "bank_to_cash",
                    "direction": "deposit",
                    "transfer_date": payload.transfer_date,
                    "deposit_to": "Cash in Hand",
                    "withdraw_from": bank["id"],
                    "withdraw_from_name": bank_name,
                    "amount": amount,
                    "description": payload.description or f"Withdrawn from {bank_name} and deposited into Cash in Hand",
                    "attachment_path": payload.attachment_path,
                    "attachment_name": payload.attachment_name,
                    "created_at": now,
                    "created_by": current.user_id,
                }
            else:
                # Withdraw from Cash, Deposit to Bank
                await db.bank_accounts.update_one({"id": bank["id"]}, {"$inc": {"opening_balance": amount}})
                tx_record = {
                    "id": tx_id,
                    "transfer_type": "bank_to_cash",
                    "direction": "withdraw",
                    "transfer_date": payload.transfer_date,
                    "deposit_to": bank["id"],
                    "deposit_to_name": bank_name,
                    "withdraw_from": "Cash in Hand",
                    "amount": amount,
                    "description": payload.description or f"Deposited cash into {bank_name}",
                    "attachment_path": payload.attachment_path,
                    "attachment_name": payload.attachment_name,
                    "created_at": now,
                    "created_by": current.user_id,
                }
            await db.bank_transactions.insert_one(tx_record)
            return clean_doc(tx_record)

        # ----------------------------------------------------
        # (b) Cash to Bank Transfer
        # ----------------------------------------------------
        elif payload.transfer_type == "cash_to_bank":
            # Withdraw from is locked to "Cash in Hand"
            direction = payload.direction or "deposit"
            bank_id = payload.deposit_to

            bank = await db.bank_accounts.find_one({"id": bank_id}, {"_id": 0})
            if not bank:
                bank = await db.bank_accounts.find_one({}, {"_id": 0})
            bank_name = f"{bank['name']} ({bank['bank_name']})" if bank else "Bank Account"

            if direction == "deposit":
                # Cash deposited into Bank
                await db.bank_accounts.update_one({"id": bank["id"]}, {"$inc": {"opening_balance": amount}})
                tx_record = {
                    "id": tx_id,
                    "transfer_type": "cash_to_bank",
                    "direction": "deposit",
                    "transfer_date": payload.transfer_date,
                    "deposit_to": bank["id"],
                    "deposit_to_name": bank_name,
                    "withdraw_from": "Cash in Hand",  # Field locked as requested
                    "amount": amount,
                    "description": payload.description or f"Cash deposit into {bank_name}",
                    "attachment_path": payload.attachment_path,
                    "attachment_name": payload.attachment_name,
                    "created_at": now,
                    "created_by": current.user_id,
                }
            else:
                # Withdrawn from Bank into Cash
                await db.bank_accounts.update_one({"id": bank["id"]}, {"$inc": {"opening_balance": -amount}})
                tx_record = {
                    "id": tx_id,
                    "transfer_type": "cash_to_bank",
                    "direction": "withdraw",
                    "transfer_date": payload.transfer_date,
                    "deposit_to": "Cash in Hand",
                    "withdraw_from": bank["id"],
                    "withdraw_from_name": bank_name,
                    "amount": amount,
                    "description": payload.description or f"Withdrawn cash from {bank_name}",
                    "attachment_path": payload.attachment_path,
                    "attachment_name": payload.attachment_name,
                    "created_at": now,
                    "created_by": current.user_id,
                }
            await db.bank_transactions.insert_one(tx_record)
            return clean_doc(tx_record)

        # ----------------------------------------------------
        # (c) Bank to Bank Transfer
        # ----------------------------------------------------
        elif payload.transfer_type == "bank_to_bank":
            from_bank_id = payload.withdraw_from
            to_bank_id = payload.deposit_to

            if from_bank_id == to_bank_id:
                raise HTTPException(status_code=400, detail="Source and destination bank accounts cannot be the same")

            from_bank = await db.bank_accounts.find_one({"id": from_bank_id}, {"_id": 0})
            to_bank = await db.bank_accounts.find_one({"id": to_bank_id}, {"_id": 0})
            if not from_bank or not to_bank:
                raise HTTPException(status_code=404, detail="Selected bank account not found")

            # Deduct from source bank, credit destination bank
            await db.bank_accounts.update_one({"id": from_bank["id"]}, {"$inc": {"opening_balance": -amount}})
            await db.bank_accounts.update_one({"id": to_bank["id"]}, {"$inc": {"opening_balance": amount}})

            tx_record = {
                "id": tx_id,
                "transfer_type": "bank_to_bank",
                "transfer_date": payload.transfer_date,
                "withdraw_from": from_bank["id"],
                "withdraw_from_name": f"{from_bank['name']} ({from_bank['bank_name']})",
                "deposit_to": to_bank["id"],
                "deposit_to_name": f"{to_bank['name']} ({to_bank['bank_name']})",
                "amount": amount,
                "description": payload.description or f"Inter-bank transfer from {from_bank['name']} to {to_bank['name']}",
                "attachment_path": payload.attachment_path,
                "attachment_name": payload.attachment_name,
                "created_at": now,
                "created_by": current.user_id,
            }
            await db.bank_transactions.insert_one(tx_record)
            return clean_doc(tx_record)

        # ----------------------------------------------------
        # (d) Adjust Bank Balance
        # ----------------------------------------------------
        elif payload.transfer_type == "adjust_balance":
            action = payload.adjust_action or "increase"
            bank_id = payload.account_id or payload.deposit_to

            bank = await db.bank_accounts.find_one({"id": bank_id}, {"_id": 0})
            if not bank:
                raise HTTPException(status_code=404, detail="Bank account not found for adjustment")

            delta = amount if action == "increase" else -amount
            await db.bank_accounts.update_one({"id": bank["id"]}, {"$inc": {"opening_balance": delta}})

            tx_record = {
                "id": tx_id,
                "transfer_type": "adjust_balance",
                "adjust_action": action,
                "transfer_date": payload.transfer_date,
                "account_id": bank["id"],
                "account_name": f"{bank['name']} ({bank['bank_name']} - {bank['account_no']})",
                "amount": amount,
                "description": payload.description or f"Manual balance adjustment ({action})",
                "attachment_path": payload.attachment_path,
                "attachment_name": payload.attachment_name,
                "created_at": now,
                "created_by": current.user_id,
            }
            await db.bank_transactions.insert_one(tx_record)
            return clean_doc(tx_record)

        else:
            raise HTTPException(status_code=400, detail="Invalid transfer type specified")

    # =========================================================================
    # 4. Cash in Hand Summary & Recent Ledger
    # =========================================================================
    @router.get("/cash-summary")
    async def get_cash_summary(current: Any = Depends(get_current_user)):
        await _ensure_seed_records()

        # Calculate cash receipts from sales and payments in
        sales_cash = await db.invoices.find({"invoice_type": "sale", "payment_mode": "cash"}, {"_id": 0}).to_list(1000)
        tot_sales_cash = sum(float(s.get("paid_amount") or s.get("total_amount") or 0) for s in sales_cash)

        income_cash = await db.income.find({"payment_mode": "cash"}, {"_id": 0}).to_list(1000)
        tot_income_cash = sum(float(i.get("amount") or 0) for i in income_cash)

        # Cash disbursements
        exp_cash = await db.expenses.find({"payment_mode": "cash"}, {"_id": 0}).to_list(1000)
        tot_exp_cash = sum(float(e.get("amount") or 0) for e in exp_cash)

        # Bank transfers to/from cash
        contra_txs = await db.bank_transactions.find({"$or": [{"deposit_to": "Cash in Hand"}, {"withdraw_from": "Cash in Hand"}]}, {"_id": 0}).to_list(1000)
        cash_added_from_bank = sum(float(t.get("amount") or 0) for t in contra_txs if t.get("deposit_to") == "Cash in Hand")
        cash_deposited_to_bank = sum(float(t.get("amount") or 0) for t in contra_txs if t.get("withdraw_from") == "Cash in Hand")

        # Check if there is an explicit cash opening balance configured in db.settings (defaults to 0.0 in real mode)
        setting = await db.settings.find_one({"key": "cash_opening_balance"}, {"_id": 0})
        base_opening = float(setting.get("value", 0.0)) if setting else 0.0
        total_inflow = base_opening + tot_sales_cash + tot_income_cash + cash_added_from_bank
        total_outflow = tot_exp_cash + cash_deposited_to_bank
        net_cash_in_hand = round(total_inflow - total_outflow, 2)

        # Recent transactions
        recent = []
        for t in contra_txs[-10:]:
            is_in = (t.get("deposit_to") == "Cash in Hand")
            recent.append({
                "id": t.get("id"),
                "date": t.get("transfer_date"),
                "type": "Bank Contra",
                "particulars": t.get("description") or ("Cash added from Bank" if is_in else "Cash sent to Bank"),
                "inflow": inr(t.get("amount")) if is_in else "—",
                "outflow": inr(t.get("amount")) if not is_in else "—",
                "mode": "Contra / Bank Transfer"
            })

        return {
            "cash_in_hand": net_cash_in_hand,
            "opening_cash": base_opening,
            "total_cash_sales": tot_sales_cash,
            "total_cash_expenses": tot_exp_cash,
            "cash_from_banks": cash_added_from_bank,
            "cash_to_banks": cash_deposited_to_bank,
            "recent_entries": recent
        }

    # =========================================================================
    # 5. Cheques Management (Open, Closed, All + Deposit Action)
    # =========================================================================
    @router.get("/cheques")
    async def list_cheques(status: Optional[str] = Query("all"), current: Any = Depends(get_current_user)):
        await _ensure_seed_records()
        q = {}
        if status in ["open", "closed"]:
            q["status"] = status
        cheques = await db.cheques.find(q, {"_id": 0}).sort("cheque_date", -1).to_list(500)

        # Count summary
        all_chqs = await db.cheques.find({}, {"_id": 0}).to_list(1000)
        open_count = sum(1 for c in all_chqs if c.get("status") == "open")
        closed_count = sum(1 for c in all_chqs if c.get("status") == "closed")
        open_amount = sum(float(c.get("amount") or 0) for c in all_chqs if c.get("status") == "open")

        return {
            "cheques": clean_doc(cheques),
            "open_count": open_count,
            "closed_count": closed_count,
            "total_count": len(all_chqs),
            "open_amount": round(open_amount, 2),
        }

    @router.post("/cheques/{chq_id}/deposit")
    async def deposit_cheque(chq_id: str, payload: ChequeDepositPayload, current: Any = Depends(get_current_user)):
        cheque = await db.cheques.find_one({"id": chq_id}, {"_id": 0})
        if not cheque:
            raise HTTPException(status_code=404, detail="Cheque not found")
        if cheque.get("status") == "closed":
            raise HTTPException(status_code=400, detail="Cheque has already been deposited and closed")

        amount = float(cheque.get("amount") or 0)
        deposit_target = payload.deposit_to

        if deposit_target == "cash":
            target_name = "Cash in Hand"
            # Cash in hand increases
        else:
            bank = await db.bank_accounts.find_one({"id": deposit_target}, {"_id": 0})
            if not bank:
                bank = await db.bank_accounts.find_one({}, {"_id": 0})
            target_name = f"{bank['name']} ({bank['bank_name']})" if bank else "Bank Account"
            if bank:
                await db.bank_accounts.update_one({"id": bank["id"]}, {"$inc": {"opening_balance": amount}})

        # Update cheque status
        update_data = {
            "status": "closed",
            "deposit_date": payload.transfer_date,
            "deposit_to": deposit_target,
            "deposit_to_name": target_name,
            "deposit_description": payload.description,
            "closed_by": current.user_id,
            "closed_at": now_utc().isoformat()
        }
        await db.cheques.update_one({"id": chq_id}, {"$set": update_data})
        updated = await db.cheques.find_one({"id": chq_id}, {"_id": 0})
        return clean_doc(updated)

    @router.patch("/cheques/{chq_id}")
    async def update_cheque(chq_id: str, payload: dict, current: Any = Depends(require_admin_or_manager)):
        doc = await db.cheques.find_one({"id": chq_id}, {"_id": 0})
        if not doc:
            raise HTTPException(status_code=404, detail="Cheque not found")
        if doc.get("status") == "closed" and "amount" in payload and float(payload["amount"]) != float(doc.get("amount", 0)):
            raise HTTPException(
                status_code=400,
                detail="Cannot modify amount of an already deposited cheque as bank balances have been posted."
            )
        allowed = {"cheque_no", "cheque_date", "customer_name", "bank_name", "amount", "reference_no", "description", "status"}
        upd = {k: v for k, v in payload.items() if k in allowed}
        if "amount" in upd:
            upd["amount"] = float(upd["amount"])
        upd["updated_at"] = now_utc().isoformat()
        await db.cheques.update_one({"id": chq_id}, {"$set": upd})
        updated = await db.cheques.find_one({"id": chq_id}, {"_id": 0})
        if log_audit:
            await log_audit(db, current, "cheques", "update", chq_id, doc, updated)
        return clean_doc(updated)

    @router.post("/cheques")
    async def create_cheque(payload: dict, current: Any = Depends(require_admin_or_manager)):
        cheque_no = (payload.get("cheque_no") or "").strip()
        customer_name = (payload.get("customer_name") or "").strip()
        bank_name = (payload.get("bank_name") or "").strip()
        amount = float(payload.get("amount") or 0)
        cheque_date = payload.get("cheque_date") or date.today().isoformat()
        
        if not cheque_no or not customer_name or not bank_name or amount <= 0:
            raise HTTPException(status_code=400, detail="Cheque No, Customer Name, Bank Name, and valid Amount are required.")
            
        import uuid
        chq_id = f"chq_{uuid.uuid4().hex[:10]}"
        new_chq = {
            "id": chq_id,
            "cheque_no": cheque_no,
            "cheque_date": cheque_date,
            "customer_id": payload.get("customer_id") or None,
            "customer_name": customer_name,
            "bank_name": bank_name,
            "amount": amount,
            "reference_no": payload.get("reference_no") or f"REF-{cheque_no[-4:]}",
            "status": payload.get("status") or "open",
            "deposit_date": None,
            "deposit_to": None,
            "deposit_to_name": None,
            "description": payload.get("description") or None,
            "created_at": now_utc(),
            "created_by": current.user_id,
        }
        await db.cheques.insert_one(new_chq)
        if log_audit:
            await log_audit(db, current, "cheques", "create", chq_id, None, new_chq)
        return clean_doc(new_chq)

    @router.delete("/cheques/{chq_id}")
    async def delete_cheque(chq_id: str, current: Any = Depends(require_admin_or_manager)):
        doc = await db.cheques.find_one({"id": chq_id}, {"_id": 0})
        if not doc:
            raise HTTPException(status_code=404, detail="Cheque not found")
        # If cheque was deposited and closed, reverse the bank balance if target was bank
        if doc.get("status") == "closed":
            dep_to = doc.get("deposit_to")
            amt = float(doc.get("amount") or 0)
            if dep_to and dep_to != "cash" and amt > 0:
                await db.bank_accounts.update_one({"id": dep_to}, {"$inc": {"opening_balance": -amt}})
        res = await db.cheques.delete_one({"id": chq_id})
        if log_audit:
            await log_audit(db, current, "cheques", "delete", chq_id, doc, None)
        return {"deleted": res.deleted_count}

    # =========================================================================
    # 6. Loan Accounts Master (10 Fields)
    # =========================================================================
    @router.get("/loans")
    async def list_loan_accounts(current: Any = Depends(get_current_user)):
        await _ensure_seed_records()
        loans = await db.loan_accounts.find({}, {"_id": 0}).sort("created_at", -1).to_list(100)
        tot_sanctioned = sum(float(l.get("opening_balance") or 0) for l in loans)
        tot_outstanding = sum(float(l.get("current_balance") or l.get("opening_balance") or 0) for l in loans)
        return {
            "loans": clean_doc(loans),
            "total_sanctioned": round(tot_sanctioned, 2),
            "total_outstanding": round(tot_outstanding, 2),
            "active_loans_count": len(loans)
        }

    @router.post("/loans")
    async def create_loan_account(payload: LoanAccountCreate, current: Any = Depends(get_current_user)):
        loan_id = f"loan_{uuid.uuid4().hex[:10]}"
        now = now_utc()

        # Determine target receiving account
        target_name = "Cash in Hand"
        if payload.loan_received_in != "cash":
            bank = await db.bank_accounts.find_one({"id": payload.loan_received_in}, {"_id": 0})
            if bank:
                target_name = f"{bank['name']} ({bank['bank_name']})"
                # Credit loan proceeds into receiving bank
                await db.bank_accounts.update_one({"id": bank["id"]}, {"$inc": {"opening_balance": payload.opening_balance - payload.processing_fee}})

        # Calculate approximate monthly EMI
        P = float(payload.opening_balance)
        r = (float(payload.interest_rate) / 100) / 12 if payload.interest_rate > 0 else 0
        n = int(payload.duration_months)
        if r > 0 and n > 0:
            emi = (P * r * ((1 + r) ** n)) / (((1 + r) ** n) - 1)
        else:
            emi = P / n if n > 0 else 0

        doc = {
            "id": loan_id,
            "account_name": payload.account_name,
            "account_number": payload.account_number,
            "lender_bank": payload.lender_bank,
            "description": payload.description,
            "opening_balance": payload.opening_balance,
            "current_balance": payload.opening_balance,
            "balance_as_of": payload.balance_as_of,
            "loan_received_in": payload.loan_received_in,
            "loan_received_in_name": target_name,
            "interest_rate": payload.interest_rate,
            "duration_months": payload.duration_months,
            "processing_fee": payload.processing_fee,
            "emi_amount": round(emi, 2),
            "created_at": now,
            "created_by": current.user_id,
        }
        await db.loan_accounts.insert_one(doc)
        if log_audit:
            await log_audit(db, current, "loans", "create", loan_id, None, doc)
        return clean_doc(doc)

    @router.patch("/loans/{loan_id}")
    async def update_loan_account(loan_id: str, payload: dict, current: Any = Depends(require_admin_or_manager)):
        cur = await db.loan_accounts.find_one({"id": loan_id}, {"_id": 0})
        if not cur:
            raise HTTPException(status_code=404, detail="Loan not found")
        allowed = {"account_name", "account_number", "lender_bank", "description", "opening_balance", "current_balance", "interest_rate", "duration_months", "processing_fee"}
        upd = {k: v for k, v in payload.items() if k in allowed}
        if "opening_balance" in upd:
            upd["opening_balance"] = float(upd["opening_balance"])
        if "current_balance" in upd:
            upd["current_balance"] = float(upd["current_balance"])
        if "interest_rate" in upd or "duration_months" in upd or "opening_balance" in upd:
            P = float(upd.get("opening_balance", cur.get("opening_balance", 0)))
            rate = float(upd.get("interest_rate", cur.get("interest_rate", 0)))
            dur = int(upd.get("duration_months", cur.get("duration_months", 1)))
            r = (rate / 100) / 12 if rate > 0 else 0
            if r > 0 and dur > 0:
                upd["emi_amount"] = round((P * r * ((1 + r) ** dur)) / (((1 + r) ** dur) - 1), 2)
            else:
                upd["emi_amount"] = round(P / dur if dur > 0 else 0, 2)
        upd["updated_at"] = now_utc()
        await db.loan_accounts.update_one({"id": loan_id}, {"$set": upd})
        doc = await db.loan_accounts.find_one({"id": loan_id}, {"_id": 0})
        if log_audit:
            await log_audit(db, current, "loans", "update", loan_id, cur, doc)
        return clean_doc(doc)

    @router.delete("/loans/{loan_id}")
    async def delete_loan_account(loan_id: str, current: Any = Depends(require_admin_or_manager)):
        doc = await db.loan_accounts.find_one({"id": loan_id}, {"_id": 0})
        if not doc:
            raise HTTPException(status_code=404, detail="Loan not found")
        res = await db.loan_accounts.delete_one({"id": loan_id})
        if log_audit:
            await log_audit(db, current, "loans", "delete", loan_id, doc, None)
        return {"deleted": res.deleted_count}

    # Contra / Cash adjustment edit and delete
    @router.patch("/contra/{tx_id}")
    @router.patch("/cash-adjustments/{tx_id}")
    async def update_contra_transaction(tx_id: str, payload: dict, current: Any = Depends(require_admin_or_manager)):
        cur = await db.bank_transactions.find_one({"id": tx_id}, {"_id": 0})
        if not cur:
            raise HTTPException(status_code=404, detail="Transaction not found")
        
        upd = {}
        if "particulars" in payload and payload["particulars"]:
            upd["description"] = payload["particulars"].strip()
        elif "description" in payload and payload["description"]:
            upd["description"] = payload["description"].strip()
            
        if "date" in payload and payload["date"]:
            upd["transfer_date"] = payload["date"]
        elif "transfer_date" in payload and payload["transfer_date"]:
            upd["transfer_date"] = payload["transfer_date"]
            
        if "amount" in payload:
            new_amt = float(payload["amount"])
            old_amt = float(cur.get("amount") or 0)
            diff = new_amt - old_amt
            upd["amount"] = new_amt
            
            # Rebalance affected bank account if amount was modified
            if diff != 0:
                ttype = cur.get("transfer_type")
                direction = cur.get("direction", "deposit")
                if ttype == "bank_to_cash":
                    bank_id = cur.get("withdraw_from") if direction == "deposit" else cur.get("deposit_to")
                    if bank_id and bank_id != "Cash in Hand":
                        mult = -1 if direction == "deposit" else 1
                        await db.bank_accounts.update_one({"id": bank_id}, {"$inc": {"opening_balance": mult * diff}})
                elif ttype == "cash_to_bank":
                    bank_id = cur.get("deposit_to") if direction == "deposit" else cur.get("withdraw_from")
                    if bank_id and bank_id != "Cash in Hand":
                        mult = 1 if direction == "deposit" else -1
                        await db.bank_accounts.update_one({"id": bank_id}, {"$inc": {"opening_balance": mult * diff}})
                elif ttype == "bank_to_bank":
                    from_id = cur.get("withdraw_from")
                    to_id = cur.get("deposit_to")
                    if from_id:
                        await db.bank_accounts.update_one({"id": from_id}, {"$inc": {"opening_balance": -diff}})
                    if to_id:
                        await db.bank_accounts.update_one({"id": to_id}, {"$inc": {"opening_balance": diff}})
        
        upd["updated_at"] = now_utc()
        await db.bank_transactions.update_one({"id": tx_id}, {"$set": upd})
        doc = await db.bank_transactions.find_one({"id": tx_id}, {"_id": 0})
        if log_audit:
            await log_audit(db, current, "cash_bank_contra", "update", tx_id, cur, doc)
        return clean_doc(doc) if doc else {"ok": True}

    @router.delete("/contra/{tx_id}")
    @router.delete("/cash-adjustments/{tx_id}")
    async def delete_contra_transaction(tx_id: str, current: Any = Depends(require_admin_or_manager)):
        cur = await db.bank_transactions.find_one({"id": tx_id}, {"_id": 0})
        if not cur:
            raise HTTPException(status_code=404, detail="Transaction not found")
        
        amt = float(cur.get("amount") or 0)
        ttype = cur.get("transfer_type")
        direction = cur.get("direction", "deposit")
        
        # Reverse the balance change on affected bank accounts
        if ttype == "bank_to_cash":
            bank_id = cur.get("withdraw_from") if direction == "deposit" else cur.get("deposit_to")
            if bank_id and bank_id != "Cash in Hand":
                mult = 1 if direction == "deposit" else -1
                await db.bank_accounts.update_one({"id": bank_id}, {"$inc": {"opening_balance": mult * amt}})
        elif ttype == "cash_to_bank":
            bank_id = cur.get("deposit_to") if direction == "deposit" else cur.get("withdraw_from")
            if bank_id and bank_id != "Cash in Hand":
                mult = -1 if direction == "deposit" else 1
                await db.bank_accounts.update_one({"id": bank_id}, {"$inc": {"opening_balance": mult * amt}})
        elif ttype == "bank_to_bank":
            from_id = cur.get("withdraw_from")
            to_id = cur.get("deposit_to")
            if from_id:
                await db.bank_accounts.update_one({"id": from_id}, {"$inc": {"opening_balance": amt}})
            if to_id:
                await db.bank_accounts.update_one({"id": to_id}, {"$inc": {"opening_balance": -amt}})
                
        res = await db.bank_transactions.delete_one({"id": tx_id})
        if log_audit:
            await log_audit(db, current, "cash_bank_contra", "delete", tx_id, cur, None)
        return {"deleted": res.deleted_count}

    return router
