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

class SettlementPayload(BaseModel):
    gateway: str = Field(default="paytm")
    date: str = Field(default_factory=lambda: date.today().isoformat())
    settlement_ref: str = Field(..., description="Settlement reference or batch number from Paytm")
    utr_no: Optional[str] = Field(default="", description="Bank transfer UTR number")
    bank_account_id: str = Field(..., description="Target bank account ID (e.g. SBI, Axis)")
    gross_amount: float = Field(..., gt=0, description="Gross collection amount settled by gateway")
    settlement_charges: float = Field(default=0.0, ge=0, description="Settlement charges / fee deducted by Paytm")
    tax_amount: Optional[float] = Field(default=0.0, ge=0, description="GST / tax on settlement charges")
    notes: Optional[str] = None
    linked_receipt_ids: Optional[List[str]] = Field(default_factory=list, description="IDs of customer receipts settled in this batch")

def make_cash_bank_router(db, get_current_user, require_admin, require_admin_or_manager, log_audit=None, prefix="/accounting/cash-bank"):
    router = APIRouter(prefix=prefix, tags=["cash-bank"])

    async def _ensure_seed_records():
        """Ensure initial company bank accounts with 0 balance if none exist."""
        try:
            bank_count = await db.bank_accounts.count_documents({})
            if bank_count == 0:
                sample_banks = [
                    {"id": "bnk_sbi_01", "name": "SBI Current A/c", "bank_name": "State Bank of India", "account_no": "39485720192", "ifsc": "SBIN0001234", "opening_balance": 0.0, "is_active": True, "created_at": now_utc()},
                    {"id": "bnk_hdfc_02", "name": "HDFC Business A/c", "bank_name": "HDFC Bank", "account_no": "50200039281726", "ifsc": "HDFC0000456", "opening_balance": 0.0, "is_active": True, "created_at": now_utc()},
                ]
                for sb in sample_banks:
                    await db.bank_accounts.update_one({"id": sb["id"]}, {"$setOnInsert": sb}, upsert=True)
        except Exception:
            pass

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
        try:
            from closing_balance_helper import calculate_closing_balances
            cb_data = await calculate_closing_balances(db)
            bank_map = cb_data.get("banks", {})
            for b in banks:
                bid = b.get("id")
                if bid in bank_map:
                    b["current_balance"] = bank_map[bid]
                    b["latest_closing_balance"] = bank_map[bid]
                    b["closing_balance"] = bank_map[bid]
                else:
                    b["current_balance"] = float(b.get("opening_balance") or 0.0)
                    b["latest_closing_balance"] = b["current_balance"]
                    b["closing_balance"] = b["current_balance"]
        except Exception as e:
            logger.warning(f"Error computing latest closing balances for banks in cash_bank_routes: {e}")
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
                    "created_by_name": getattr(current, "name", "") or getattr(current, "username", "") or "Admin",
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
                    "created_by_name": getattr(current, "name", "") or getattr(current, "username", "") or "Admin",
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
                    "created_by_name": getattr(current, "name", "") or getattr(current, "username", "") or "Admin",
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
                    "created_by_name": getattr(current, "name", "") or getattr(current, "username", "") or "Admin",
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

        # 1. Cash from Sales (invoices with cash mode or cash splits)
        all_sales = await db.invoices.find(
            {"invoice_type": {"$in": ["sale", None]}},
            {"_id": 0}
        ).to_list(1000)

        tot_sales_cash = 0.0
        cash_sale_entries = []
        for s in all_sales:
            c_mode = str(s.get("payment_mode") or "").lower()
            splits = s.get("payment_splits") or []
            s_cash = 0.0
            if splits:
                s_cash = sum(float(ps.get("amount") or 0) for ps in splits if "cash" in str(ps.get("mode") or "").lower())
            elif "cash" in c_mode:
                s_cash = float(s.get("paid_amount") or s.get("total_amount") or 0.0)

            if s_cash > 0:
                tot_sales_cash += s_cash
                party = s.get("party_name") or "Direct Customer"
                inv_no = s.get("invoice_no") or s.get("invoice_number") or "Invoice"
                d = s.get("date") or s.get("invoice_date") or ""
                items_str = ", ".join([str(it.get("name") or it.get("item_name") or "") for it in (s.get("items") or []) if it.get("name") or it.get("item_name")])
                cash_sale_entries.append({
                    "id": f"c_sale_{inv_no}",
                    "date": d,
                    "type": "Cash Sale Receipt",
                    "badge": "CASH SALE",
                    "direction": "inflow",
                    "title": f"Cash Received from {party}",
                    "party_or_bank": party,
                    "particulars": f"Receipt against Sale Invoice #{inv_no}" + (f" ({items_str})" if items_str else ""),
                    "voucher_ref": inv_no,
                    "handled_by": s.get("created_by_name") or "Staff",
                    "inflow": inr(s_cash),
                    "outflow": "—",
                    "amount_num": s_cash,
                    "mode": "Cash Receipt"
                })

        # 2. Cash from Payment-In
        all_incomes = await db.income.find({}, {"_id": 0}).to_list(1000)
        tot_income_cash = 0.0
        cash_income_entries = []
        for inc in all_incomes:
            i_mode = str(inc.get("payment_mode") or "").lower()
            splits = inc.get("payment_splits") or []
            i_cash = 0.0
            if splits:
                i_cash = sum(float(ps.get("amount") or 0) for ps in splits if "cash" in str(ps.get("mode") or "").lower())
            elif "cash" in i_mode:
                i_cash = float(inc.get("amount") or 0.0)

            if i_cash > 0:
                tot_income_cash += i_cash
                party = inc.get("client_name") or inc.get("customer_name") or "Customer"
                v_no = inc.get("voucher_no") or inc.get("income_no") or "Payment-In"
                d = inc.get("date") or ""
                cash_income_entries.append({
                    "id": f"c_inc_{v_no}",
                    "date": d,
                    "type": "Payment-In (Cash)",
                    "badge": "PAYMENT IN",
                    "direction": "inflow",
                    "title": f"Cash Received from {party}",
                    "party_or_bank": party,
                    "particulars": f"Payment-In #{v_no} ({inc.get('service_name') or inc.get('category') or 'Receipt'})",
                    "voucher_ref": v_no,
                    "handled_by": inc.get("created_by_name") or inc.get("employee_name") or "Staff",
                    "inflow": inr(i_cash),
                    "outflow": "—",
                    "amount_num": i_cash,
                    "mode": "Cash Receipt"
                })

        # 3. Cash Disbursements (Expenses)
        all_exp = await db.expenses.find({"status": {"$ne": "rejected"}}, {"_id": 0}).to_list(1000)
        tot_exp_cash = 0.0
        cash_exp_entries = []
        for e in all_exp:
            e_mode = str(e.get("payment_mode") or "").lower()
            if "cash" in e_mode:
                e_amt = float(e.get("amount") or 0.0)
                tot_exp_cash += e_amt
                cat = e.get("category") or "Expense"
                vendor = e.get("vendor") or e.get("item_name") or "Vendor"
                e_no = e.get("expense_no") or "EXP"
                d = e.get("date") or ""
                cash_exp_entries.append({
                    "id": f"c_exp_{e.get('id') or e_no}",
                    "date": d,
                    "type": "Cash Expense",
                    "badge": "EXPENSE",
                    "direction": "outflow",
                    "title": f"Cash Paid for {cat} ({vendor})",
                    "party_or_bank": vendor,
                    "particulars": e.get("description") or e.get("note") or f"Expense #{e_no} ({cat})",
                    "voucher_ref": e_no,
                    "handled_by": e.get("created_by_name") or "Staff",
                    "inflow": "—",
                    "outflow": inr(e_amt),
                    "amount_num": e_amt,
                    "mode": "Cash Payment"
                })

        # 4. Bank transfers to/from cash (Contra)
        contra_txs = await db.bank_transactions.find(
            {"$or": [{"deposit_to": "Cash in Hand"}, {"withdraw_from": "Cash in Hand"}]},
            {"_id": 0}
        ).to_list(1000)

        # Batch map user names for created_by
        u_ids = list({t.get("created_by") for t in contra_txs if t.get("created_by")})
        u_map = {}
        if u_ids:
            users_doc = await db.users.find({"user_id": {"$in": u_ids}}, {"_id": 0, "user_id": 1, "name": 1}).to_list(len(u_ids))
            u_map = {u["user_id"]: u.get("name") for u in users_doc}

        cash_added_from_bank = 0.0
        cash_deposited_to_bank = 0.0
        contra_entries = []

        for t in contra_txs:
            t_amt = float(t.get("amount") or 0.0)
            is_in = (t.get("deposit_to") == "Cash in Hand")
            d = t.get("transfer_date") or ""
            depositor = t.get("created_by_name") or u_map.get(t.get("created_by")) or "Admin"
            att_name = t.get("attachment_name")

            if is_in:
                cash_added_from_bank += t_amt
                bank_name = t.get("withdraw_from_name") or "Bank Account"
                contra_entries.append({
                    "id": t.get("id"),
                    "date": d,
                    "type": "Bank Withdrawal to Cash",
                    "badge": "BANK TO CASH",
                    "direction": "inflow",
                    "title": f"Cash Withdrawn from {bank_name}",
                    "party_or_bank": bank_name,
                    "particulars": t.get("description") or f"Cash withdrawn from {bank_name}",
                    "voucher_ref": t.get("id"),
                    "handled_by": depositor,
                    "attachment_name": att_name,
                    "attachment_path": t.get("attachment_path"),
                    "inflow": inr(t_amt),
                    "outflow": "—",
                    "amount_num": t_amt,
                    "mode": "Contra / Bank Transfer",
                    "is_contra": True,
                })
            else:
                cash_deposited_to_bank += t_amt
                bank_name = t.get("deposit_to_name") or "Bank Account"
                contra_entries.append({
                    "id": t.get("id"),
                    "date": d,
                    "type": "Cash Deposited to Bank",
                    "badge": "CASH TO BANK",
                    "direction": "outflow",
                    "title": f"Deposited Cash into {bank_name}",
                    "party_or_bank": bank_name,
                    "particulars": t.get("description") or f"Cash deposited into {bank_name}",
                    "voucher_ref": t.get("id"),
                    "handled_by": depositor,
                    "attachment_name": att_name,
                    "attachment_path": t.get("attachment_path"),
                    "inflow": "—",
                    "outflow": inr(t_amt),
                    "amount_num": t_amt,
                    "mode": "Contra / Bank Transfer",
                    "is_contra": True,
                })

        # 5. Cheques deposited into Cash in Hand
        chq_cash = await db.cheques.find({"status": "closed", "deposit_to": "cash"}, {"_id": 0}).to_list(1000)
        cash_from_cheques = sum(float(c.get("amount") or 0) for c in chq_cash)
        for c in chq_cash:
            c_amt = float(c.get("amount") or 0.0)
            contra_entries.append({
                "id": c.get("id"),
                "date": c.get("deposit_date") or c.get("cheque_date"),
                "type": "Cheque Encashment",
                "badge": "CHEQUE IN",
                "direction": "inflow",
                "title": f"Cheque Encashed from {c.get('customer_name')}",
                "party_or_bank": c.get("customer_name"),
                "particulars": f"Cheque #{c.get('cheque_no')} ({c.get('bank_name')})",
                "voucher_ref": c.get("cheque_no"),
                "handled_by": "Staff",
                "inflow": inr(c_amt),
                "outflow": "—",
                "amount_num": c_amt,
                "mode": f"Cheque ({c.get('bank_name')})"
            })

        # Base cash opening
        setting = await db.settings.find_one({"key": "cash_opening_balance"}, {"_id": 0})
        base_opening = float(setting.get("value", 0.0)) if setting else 0.0
        total_inflow = base_opening + tot_sales_cash + tot_income_cash + cash_added_from_bank + cash_from_cheques
        total_outflow = tot_exp_cash + cash_deposited_to_bank
        net_cash_in_hand = round(total_inflow - total_outflow, 2)
        try:
            from closing_balance_helper import calculate_closing_balances
            cb_data = await calculate_closing_balances(db)
            net_cash_in_hand = cb_data.get("cash_in_hand", net_cash_in_hand)
        except Exception:
            pass

        # Merge all into one comprehensive chronological ledger
        all_cash_entries = cash_sale_entries + cash_income_entries + cash_exp_entries + contra_entries
        all_cash_entries.sort(key=lambda x: str(x.get("date") or "9999-99-99"), reverse=True)

        return {
            "cash_in_hand": net_cash_in_hand,
            "opening_cash": base_opening,
            "total_cash_sales": round(tot_sales_cash + tot_income_cash, 2),
            "total_cash_expenses": round(tot_exp_cash, 2),
            "cash_from_banks": round(cash_added_from_bank, 2),
            "cash_to_banks": round(cash_deposited_to_bank, 2),
            "cash_from_cheques": round(cash_from_cheques, 2),
            "recent_entries": all_cash_entries[:100]
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
        else:
            bank = await db.bank_accounts.find_one({"id": deposit_target}, {"_id": 0})
            if not bank:
                bank = await db.bank_accounts.find_one({}, {"_id": 0})
            target_name = f"{bank['name']} ({bank['bank_name']})" if bank else "Bank Account"
            if bank:
                await db.bank_accounts.update_one({"id": bank["id"]}, {"$inc": {"opening_balance": amount}})
                # Insert bank transaction record for bank statement ledger
                tx_record = {
                    "id": f"tx_chq_{uuid.uuid4().hex[:8]}",
                    "cheque_id": chq_id,
                    "transfer_type": "cheque_deposit",
                    "transfer_date": payload.transfer_date,
                    "account_id": bank["id"],
                    "deposit_to": bank["id"],
                    "deposit_to_name": target_name,
                    "amount": amount,
                    "description": payload.description or f"Cheque #{cheque.get('cheque_no')} deposited from {cheque.get('customer_name')}",
                    "created_at": now_utc(),
                    "created_by": current.user_id,
                    "created_by_name": getattr(current, "name", "") or getattr(current, "username", "") or "Admin",
                }
                await db.bank_transactions.insert_one(tx_record)

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
            await db.bank_transactions.delete_many({"cheque_id": chq_id})
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

    # =========================================================================
    # 7. Payment Gateway Settlement Module (Paytm & PG Settlements)
    # Scenario: Gross Customer Receipt -> Paytm Clearing Account
    # Settlement: Dr Bank (Net), Dr Settlement Charges Expense, Cr Clearing (Gross)
    # =========================================================================
    @router.get("/settlements")
    async def list_settlements(current: Any = Depends(get_current_user)):
        docs = await db.pg_settlements.find({}, {"_id": 0}).sort([("date", -1), ("created_at", -1)]).to_list(1000)
        return clean_doc(docs)

    @router.get("/settlements/next-no")
    async def get_next_settlement_no(current: Any = Depends(get_current_user)):
        cnt = await db.pg_settlements.count_documents({})
        return {"next_no": f"PAYTM-SETTLE-{cnt + 1:04d}"}

    @router.get("/settlements/pending-receipts")
    async def get_pending_settlement_receipts(current: Any = Depends(get_current_user)):
        # 1. Unsettled receipts in db.income
        q_inc = {
            "payment_mode": {"$regex": "paytm|gateway", "$options": "i"},
            "settlement_status": {"$ne": "settled"}
        }
        income_recs = await db.income.find(q_inc, {"_id": 0}).sort("date", -1).to_list(500)

        # 2. Unsettled pg_collection transactions in db.bank_transactions
        q_tx = {
            "transfer_type": "pg_collection",
            "settlement_status": {"$ne": "settled"}
        }
        tx_recs = await db.bank_transactions.find(q_tx, {"_id": 0}).sort("transfer_date", -1).to_list(500)

        # Merge deduplicated list
        seen_keys = set()
        merged = []
        for r in income_recs:
            v_no = r.get("income_no") or r.get("voucher_no") or r.get("id")
            seen_keys.add(v_no)
            merged.append({
                "id": r.get("id") or str(r.get("_id", "")),
                "voucher_no": v_no,
                "date": r.get("date"),
                "party": r.get("customer_name") or r.get("party_name") or "Customer",
                "amount": float(r.get("amount") or 0.0),
                "payment_mode": r.get("payment_mode") or "paytm",
                "reference": r.get("reference") or "",
                "settlement_status": r.get("settlement_status") or "unsettled"
            })

        for tx in tx_recs:
            ref = tx.get("source_voucher") or tx.get("reference") or tx.get("id")
            if ref in seen_keys:
                continue
            merged.append({
                "id": tx.get("id"),
                "voucher_no": ref,
                "date": tx.get("transfer_date"),
                "party": tx.get("withdraw_from") or "Customer",
                "amount": float(tx.get("amount") or 0.0),
                "payment_mode": "paytm",
                "reference": tx.get("reference") or "",
                "settlement_status": tx.get("settlement_status") or "unsettled"
            })

        return clean_doc(merged)

    @router.get("/settlements/reconciliation")
    async def get_settlement_reconciliation(current: Any = Depends(get_current_user)):
        # 1. Total Paytm Collections (Gross In)
        collections = await db.bank_transactions.find(
            {"transfer_type": "pg_collection"},
            {"_id": 0}
        ).to_list(5000)
        tot_coll_from_tx = sum(float(c.get("amount") or 0.0) for c in collections)

        income_pg = await db.income.find(
            {"payment_mode": {"$regex": "paytm|gateway", "$options": "i"}},
            {"_id": 0}
        ).to_list(5000)
        tot_coll_from_inc = sum(float(r.get("amount") or 0.0) for r in income_pg)
        tot_collected_gross = max(tot_coll_from_tx, tot_coll_from_inc)

        # 2. Settlements
        settlements = await db.pg_settlements.find({}, {"_id": 0}).sort("date", -1).to_list(1000)
        tot_settled_gross = sum(float(s.get("gross_amount") or 0.0) for s in settlements)
        tot_charges_deducted = sum(float(s.get("total_charges") or 0.0) for s in settlements)
        tot_net_credited = sum(float(s.get("net_amount") or 0.0) for s in settlements)

        # 3. Clearing Account Balance
        cl_acc = await db.bank_accounts.find_one({"id": "acc_paytm_clearing"}, {"_id": 0})
        raw_balance = float(cl_acc.get("opening_balance") or 0.0) if cl_acc else round(tot_collected_gross - tot_settled_gross, 2)
        clearing_balance = round(raw_balance, 2)

        # 4. Pending Unsettled Receipts
        pending_receipts = [
            r for r in income_pg if r.get("settlement_status") != "settled"
        ]
        pending_unsettled_amount = sum(float(r.get("amount") or 0.0) for r in pending_receipts)

        diff = round(clearing_balance, 2)
        is_balanced = abs(diff) < 0.01

        return {
            "total_collected_gross": round(tot_collected_gross, 2),
            "total_settled_gross": round(tot_settled_gross, 2),
            "total_charges_deducted": round(tot_charges_deducted, 2),
            "total_net_bank_credited": round(tot_net_credited, 2),
            "clearing_account_balance": clearing_balance,
            "pending_unsettled_count": len(pending_receipts),
            "pending_unsettled_amount": round(pending_unsettled_amount, 2),
            "is_balanced": is_balanced,
            "reconciliation_status": "Reconciled (Zero Transit Balance)" if is_balanced else f"Transit Balance: ₹{clearing_balance:,.2f}",
            "settlements_count": len(settlements),
        }

    @router.post("/settlements")
    async def create_settlement(payload: SettlementPayload, current: Any = Depends(get_current_user)):
        ref_clean = payload.settlement_ref.strip()
        if not ref_clean:
            raise HTTPException(status_code=400, detail="Settlement reference number is required")

        # 1. Target bank check
        target_bank = await db.bank_accounts.find_one({"id": payload.bank_account_id}, {"_id": 0})
        if not target_bank:
            raise HTTPException(status_code=400, detail="Target bank account not found")
        if target_bank.get("is_clearing"):
            raise HTTPException(status_code=400, detail="Target bank cannot be a clearing account")

        # 2. Calculation: Net = Gross - Charges - Taxes
        gross = round(float(payload.gross_amount), 2)
        charges = round(float(payload.settlement_charges or 0.0), 2)
        tax = round(float(payload.tax_amount or 0.0), 2)
        total_charges = round(charges + tax, 2)
        net_amount = round(gross - total_charges, 2)

        if gross <= 0:
            raise HTTPException(status_code=400, detail="Gross collection amount must be greater than zero")
        if net_amount <= 0:
            raise HTTPException(status_code=400, detail="Net settlement amount must be greater than zero (charges cannot exceed gross)")

        # 3. Check for duplicate reference
        existing_ref = await db.pg_settlements.find_one({"settlement_ref": ref_clean})
        if existing_ref:
            raise HTTPException(status_code=400, detail=f"Settlement reference '{ref_clean}' has already been processed.")

        # 4. Generate IDs
        settlement_id = f"stl_{uuid.uuid4().hex[:12]}"
        cnt = await db.pg_settlements.count_documents({})
        settlement_no = f"PAYTM-SETTLE-{cnt + 1:04d}"
        now_iso = now_utc().isoformat()
        user_id = getattr(current, "id", None) or (current.get("id") if isinstance(current, dict) else "system")
        bank_name = target_bank.get("name") or target_bank.get("bank_name") or "Bank Account"

        # 5. Credit target physical bank account with Net Amount
        await db.bank_accounts.update_one({"id": payload.bank_account_id}, {"$inc": {"opening_balance": net_amount}})
        tx_bank = {
            "id": f"tx_{uuid.uuid4().hex[:10]}",
            "transfer_type": "pg_settlement",
            "direction": "deposit",
            "transfer_date": payload.date,
            "deposit_to": payload.bank_account_id,
            "deposit_to_name": bank_name,
            "withdraw_from": "acc_paytm_clearing",
            "withdraw_from_name": "Paytm Clearing Account",
            "amount": net_amount,
            "gross_amount": gross,
            "settlement_charges": total_charges,
            "description": f"Paytm Net Bank Settlement (Gross: ₹{gross:,.2f}, Charges: ₹{total_charges:,.2f}, Net: ₹{net_amount:,.2f}) Ref: {ref_clean}" + (f" UTR: {payload.utr_no.strip()}" if payload.utr_no else ""),
            "reference": ref_clean,
            "utr_no": payload.utr_no.strip() if payload.utr_no else "",
            "settlement_id": settlement_id,
            "created_at": now_iso,
            "created_by": user_id,
        }
        await db.bank_transactions.insert_one(tx_bank)

        # 6. Post Settlement Charges to Operating Expenses (Bank Charges)
        # Requirement 7: Deducted at source, do not debit bank account again
        # Requirement 8: Prevent duplicate expense posting
        exp_id = None
        if total_charges > 0:
            existing_exp = await db.expenses.find_one({"linked_settlement_id": settlement_id})
            if not existing_exp:
                exp_id = f"exp_{uuid.uuid4().hex[:12]}"
                exp_doc = {
                    "id": exp_id,
                    "expense_no": f"EXP-PG-{uuid.uuid4().hex[:6].upper()}",
                    "date": payload.date,
                    "expense_date": payload.date,
                    "category": "Bank Charges",
                    "sub_category": "Payment Gateway Charges",
                    "vendor": "Paytm Payment Gateway",
                    "payee": "Paytm Payment Gateway",
                    "amount": total_charges,
                    "payment_mode": "pg_deduction",
                    "deducted_at_source": True,
                    "bank_account_id": None,
                    "bank_id": None,
                    "account_name": "Paytm Clearing Account",
                    "notes": f"Paytm settlement charges deducted at source for batch {ref_clean} (Gross: ₹{gross:,.2f}, Net Credit: ₹{net_amount:,.2f}, Fee: ₹{charges:,.2f}, Tax: ₹{tax:,.2f})",
                    "description": f"Paytm Settlement Charges & GST for Ref: {ref_clean}",
                    "linked_settlement_id": settlement_id,
                    "settlement_ref": ref_clean,
                    "accounting_scope": "new",
                    "status": "approved",
                    "approval_status": "approved",
                    "created_at": now_iso,
                    "created_by": user_id,
                }
                await db.expenses.insert_one(exp_doc)

        # 7. Credit Paytm Clearing Account (Deduct gross amount from clearing balance)
        cl_acc = await db.bank_accounts.find_one({"id": "acc_paytm_clearing"})
        if not cl_acc:
            await db.bank_accounts.insert_one({
                "id": "acc_paytm_clearing",
                "name": "Paytm Clearing Account",
                "bank_name": "Paytm Payment Gateway",
                "account_no": "PAYTM-CLEARING-01",
                "ifsc": "PYTM0123456",
                "opening_balance": 0.0,
                "account_type": "clearing",
                "is_clearing": True,
                "is_active": True,
                "created_at": now_iso,
            })
        await db.bank_accounts.update_one({"id": "acc_paytm_clearing"}, {"$inc": {"opening_balance": -gross}})

        tx_clearing = {
            "id": f"tx_{uuid.uuid4().hex[:10]}",
            "transfer_type": "pg_settlement_clearing",
            "direction": "withdrawal",
            "transfer_date": payload.date,
            "withdraw_from": "acc_paytm_clearing",
            "withdraw_from_name": "Paytm Clearing Account",
            "deposit_to": payload.bank_account_id,
            "deposit_to_name": bank_name,
            "amount": gross,
            "description": f"Paytm Clearing Settlement Outflow to {bank_name} Ref: {ref_clean}",
            "reference": ref_clean,
            "settlement_id": settlement_id,
            "created_at": now_iso,
            "created_by": user_id,
        }
        await db.bank_transactions.insert_one(tx_clearing)

        # 8. Mark linked customer payment-in receipts as settled (support partial / multiple)
        if payload.linked_receipt_ids:
            for rec_id in payload.linked_receipt_ids:
                await db.income.update_one(
                    {"$or": [{"id": rec_id}, {"income_no": rec_id}]},
                    {"$set": {
                        "settlement_status": "settled",
                        "settlement_id": settlement_id,
                        "settled_at": now_iso,
                        "settled_ref": ref_clean
                    }}
                )
                await db.bank_transactions.update_many(
                    {"$or": [{"id": rec_id}, {"source_voucher": rec_id}], "transfer_type": "pg_collection"},
                    {"$set": {
                        "settlement_status": "settled",
                        "settlement_id": settlement_id
                    }}
                )

        # 9. Build Journal Entry record:
        # Dr. Selected Bank Account ₹net_amount
        # Dr. Paytm Settlement Charges Expense ₹total_charges
        # Cr. Paytm Clearing Account ₹gross
        journal = {
            "dr_bank": {
                "account_id": payload.bank_account_id,
                "account_name": bank_name,
                "amount": net_amount,
                "label": f"Dr. {bank_name}"
            },
            "dr_expense": {
                "account_name": "Paytm Settlement Charges Expense (Bank Charges)",
                "amount": total_charges,
                "charges": charges,
                "tax": tax,
                "label": "Dr. Paytm Settlement Charges Expense"
            },
            "cr_clearing": {
                "account_id": "acc_paytm_clearing",
                "account_name": "Paytm Clearing Account",
                "amount": gross,
                "label": "Cr. Paytm Clearing Account"
            }
        }

        doc = {
            "id": settlement_id,
            "settlement_no": settlement_no,
            "gateway": payload.gateway or "paytm",
            "date": payload.date,
            "settlement_ref": ref_clean,
            "utr_no": payload.utr_no.strip() if payload.utr_no else "",
            "bank_account_id": payload.bank_account_id,
            "bank_name": bank_name,
            "gross_amount": gross,
            "settlement_charges": charges,
            "tax_amount": tax,
            "total_charges": total_charges,
            "net_amount": net_amount,
            "journal_entry": journal,
            "notes": payload.notes or "",
            "linked_receipt_ids": payload.linked_receipt_ids or [],
            "linked_expense_id": exp_id,
            "linked_bank_tx_id": tx_bank["id"],
            "linked_clearing_tx_id": tx_clearing["id"],
            "created_at": now_iso,
            "created_by": user_id,
        }
        await db.pg_settlements.insert_one(doc)

        if log_audit:
            await log_audit(db, current, "pg_settlement", "create", settlement_id, None, doc)

        return clean_doc(doc)

    @router.delete("/settlements/{settlement_id}")
    async def delete_settlement(settlement_id: str, current: Any = Depends(require_admin_or_manager)):
        settlement = await db.pg_settlements.find_one({"id": settlement_id}, {"_id": 0})
        if not settlement:
            raise HTTPException(status_code=404, detail="Settlement record not found")

        net_amt = float(settlement.get("net_amount") or 0.0)
        gross_amt = float(settlement.get("gross_amount") or 0.0)
        bank_id = settlement.get("bank_account_id")

        # 1. Reverse bank account balance
        if bank_id:
            await db.bank_accounts.update_one({"id": bank_id}, {"$inc": {"opening_balance": -net_amt}})

        # 2. Reverse clearing account balance
        await db.bank_accounts.update_one({"id": "acc_paytm_clearing"}, {"$inc": {"opening_balance": gross_amt}})

        # 3. Delete linked bank transactions
        await db.bank_transactions.delete_many({"settlement_id": settlement_id})

        # 4. Delete linked expense
        await db.expenses.delete_many({"linked_settlement_id": settlement_id})

        # 5. Reset linked customer receipts to unsettled
        linked_receipts = settlement.get("linked_receipt_ids") or []
        if linked_receipts:
            await db.income.update_many(
                {"$or": [{"id": {"$in": linked_receipts}}, {"income_no": {"$in": linked_receipts}}]},
                {"$set": {"settlement_status": "unsettled"}, "$unset": {"settlement_id": "", "settled_at": "", "settled_ref": ""}}
            )
            await db.bank_transactions.update_many(
                {"$or": [{"id": {"$in": linked_receipts}}, {"source_voucher": {"$in": linked_receipts}}], "transfer_type": "pg_collection"},
                {"$set": {"settlement_status": "unsettled"}, "$unset": {"settlement_id": ""}}
            )

        # 6. Delete settlement doc
        res = await db.pg_settlements.delete_one({"id": settlement_id})
        if log_audit:
            await log_audit(db, current, "pg_settlement", "delete", settlement_id, settlement, None)

        return {"deleted": res.deleted_count}

    return router
