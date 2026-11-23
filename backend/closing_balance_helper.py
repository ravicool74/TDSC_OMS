import asyncio
from datetime import datetime
from typing import Dict, Any, Optional, Tuple

async def calculate_closing_balances(db, as_of_date: Optional[str] = None) -> Dict[str, Any]:
    """
    Computes exact Closing Balances according to TDSC OMS Golden Roll-Forward rules:
    - Fixed Opening Balances on start_date (17-11-2026) set by Admin.
    - All Invoices (Sales), Payment-In (Income), Purchases, Expenses, and Contra/Bank Transfers
      are applied up to `as_of_date` (inclusive). If `as_of_date` is None, all transactions to date are included.
    Returns:
      {
        "as_of_date": str,
        "banks": { account_id: closing_balance },
        "cash_in_hand": closing_balance,
        "cash_in_bank": closing_balance,
        "total_funds": total_closing,
        "accounts_list": [ { id, name, bank_name, account_no, opening_balance, closing_balance }, ... ]
      }
    """
    if not as_of_date:
        as_of_date = datetime.now().strftime("%Y-%m-%d")

    all_banks = await db.bank_accounts.find({"is_active": True}, {"_id": 0}).to_list(100)
    if not all_banks:
        all_banks = await db.bank_accounts.find({}, {"_id": 0}).to_list(100)

    def b_sort(b):
        acc = str(b.get("account_no") or "")
        name = (b.get("name") or "").upper()
        if "42137607814" in acc or "SBIN" in str(b.get("ifsc") or "") or "TRIVENI" in name: return 0
        if "915020011528516" in acc or "UTIB" in str(b.get("ifsc") or "") or "AXIS" in name: return 1
        return 2
    all_banks.sort(key=b_sort)

    sbi_bank = None
    axis_bank = None
    for b in all_banks:
        acc = str(b.get("account_no") or "")
        name = (b.get("name") or "").upper()
        if "42137607814" in acc or "SBIN" in str(b.get("ifsc") or "") or "TRIVENI" in name:
            sbi_bank = b
        if "915020011528516" in acc or "UTIB" in str(b.get("ifsc") or "") or "AXIS" in name:
            axis_bank = b

    sbi_id = sbi_bank.get("id") if sbi_bank else (all_banks[0].get("id") if all_banks else "bnk_sbi_01")
    axis_id = axis_bank.get("id") if axis_bank else (all_banks[1].get("id") if len(all_banks) > 1 else "bnk_hdfc_02")

    def resolve_acc(item) -> Tuple[Optional[str], str, str, str]:
        mode = str(item.get("payment_mode") or item.get("mode") or "").lower()
        if item.get("deducted_at_source") or any(k in mode for k in ["pg_deduction", "gateway_deduction", "settlement_deduction"]):
            return None, "Paytm Clearing (Deducted at Source)", "PG", "pg_deduction"

        b_id = item.get("bank_id") or item.get("bank_account_id")
        b_name = item.get("bank_name") or ""
        acc_no = str(item.get("account_no") or "")
        splits = item.get("payment_splits") or []
        if splits:
            sp = splits[0]
            if "cash" in str(sp.get("mode") or "").lower():
                return "cash_in_hand", "Cash in Hand", "Cash", "cash"
            b_id = b_id or sp.get("bank_id") or sp.get("bank_account_id")
            b_name = b_name or sp.get("bank_name") or ""
            acc_no = acc_no or str(sp.get("account_no") or "")

        combined = f"{b_id or ''} {b_name} {acc_no}".lower()
        if "cash" in mode and not any(k in mode for k in ["bank", "online", "upi", "cheque", "transfer"]):
            return "cash_in_hand", "Cash in Hand", "Cash", "cash"

        if axis_id and (axis_id.lower() in combined or "915020011528516" in combined or "axis" in combined or "utib" in combined or "anju" in combined):
            return axis_id, "Axis Bank", "Axis", "axis"
        if sbi_id and (sbi_id.lower() in combined or "42137607814" in combined or "sbin" in combined or "state" in combined or "triveni" in combined):
            return sbi_id, "State Bank of India", "SBI", "sbi"

        for b in all_banks:
            bid = str(b.get("id") or "").lower()
            bacc = str(b.get("account_no") or "").lower()
            bnm = str(b.get("name") or b.get("bank_name") or "").lower()
            if (bid and bid in combined) or (bacc and bacc in combined) or (bnm and bnm in combined):
                tag = "Axis" if "axis" in bnm else "SBI" if "sbi" in bnm else b.get("bank_name") or "Bank"
                grp = "axis" if "axis" in bnm else "sbi" if "sbi" in bnm else "sbi"
                return b.get("id"), b.get("name") or b.get("bank_name"), tag, grp

        if any(k in mode for k in ["bank", "online", "upi", "cheque", "transfer"]):
            return sbi_id, "State Bank of India", "SBI", "sbi"
        return "cash_in_hand", "Cash in Hand", "Cash", "cash"

    # Base fixed opening balances on start_date (17-11-2026)
    setting = await db.settings.find_one({"key": "day_book_initial_balances"}, {"_id": 0})
    if setting:
        start_date = setting.get("start_date") or "2026-11-17"
        init_cash = float(setting.get("cash_in_hand", 10701.0))
        init_acc_map = setting.get("accounts", {})
    else:
        start_date = "2026-11-17"
        c_setting = await db.settings.find_one({"key": "cash_opening_balance"}, {"_id": 0})
        init_cash = float(c_setting.get("value", 10701.0)) if c_setting else 10701.0
        init_acc_map = {}

    fixed_sbi_ob = float(init_acc_map.get(sbi_id, init_acc_map.get("42137607814", 131553.72)))
    fixed_axis_ob = float(init_acc_map.get(axis_id, init_acc_map.get("915020011528516", 270338.13)))
    fixed_cash_ob = float(init_cash)
    fixed_bank_d_ob = float(init_acc_map.get("cash_in_bank", 0.0))

    running_balances = {
        sbi_id: fixed_sbi_ob,
        axis_id: fixed_axis_ob,
        "cash_in_hand": fixed_cash_ob,
        "cash_in_bank": fixed_bank_d_ob,
    }

    # Add other registered banks
    for b in all_banks:
        bid = b.get("id")
        if bid and bid not in running_balances and not b.get("is_clearing") and bid != "acc_paytm_clearing":
            running_balances[bid] = float(b.get("opening_balance") or 0.0)

    # Roll-forward: apply all transactions between start_date and as_of_date (inclusive)
    # 1. Invoices
    invoices = await db.invoices.find(
        {"invoice_type": "sale", "date": {"$gte": start_date, "$lte": as_of_date}},
        {"_id": 0}
    ).to_list(5000)
    for inv in invoices:
        acc_id, _, _, _ = resolve_acc(inv)
        amt = float(inv.get("paid_amount") or inv.get("total_amount") or 0.0)
        if amt > 0 and acc_id:
            running_balances[acc_id] = running_balances.get(acc_id, 0.0) + amt

    # 2. Income
    incomes = await db.income.find(
        {"date": {"$gte": start_date, "$lte": as_of_date}},
        {"_id": 0}
    ).to_list(5000)
    for inc in incomes:
        acc_id, _, _, _ = resolve_acc(inc)
        amt = float(inc.get("amount") or 0.0)
        if amt > 0 and acc_id:
            running_balances[acc_id] = running_balances.get(acc_id, 0.0) + amt

    # 3. Purchases
    purchases = await db.purchases.find(
        {"date": {"$gte": start_date, "$lte": as_of_date}},
        {"_id": 0}
    ).to_list(5000)
    for pur in purchases:
        acc_id, _, _, _ = resolve_acc(pur)
        amt = float(pur.get("paid_amount") or pur.get("total_amount") or 0.0)
        if amt > 0 and acc_id:
            running_balances[acc_id] = running_balances.get(acc_id, 0.0) - amt

    # 4. Expenses
    expenses = await db.expenses.find(
        {"date": {"$gte": start_date, "$lte": as_of_date}, "status": {"$in": ["verified", "approved", "pending"]}},
        {"_id": 0}
    ).to_list(5000)
    for exp in expenses:
        acc_id, _, _, acc_grp = resolve_acc(exp)
        if not acc_id or acc_grp == "pg_deduction":
            continue
        amt = float(exp.get("amount") or 0.0)
        if amt > 0:
            running_balances[acc_id] = running_balances.get(acc_id, 0.0) - amt

    # 5. Contra / Bank Transfers
    contra_txs = await db.bank_transactions.find(
        {"transfer_date": {"$gte": start_date, "$lte": as_of_date}},
        {"_id": 0}
    ).to_list(5000)
    for c in contra_txs:
        amt = float(c.get("amount") or 0.0)
        if amt <= 0: continue
        w_from = c.get("withdraw_from")
        d_to = c.get("deposit_to")
        ttype = c.get("transfer_type")

        if ttype == "pg_settlement":
            tgt = d_to if d_to in running_balances else sbi_id
            if tgt in running_balances:
                running_balances[tgt] += amt
            continue
        elif ttype == "pg_settlement_clearing":
            continue
        elif w_from == "Cash in Hand" or ttype == "cash_to_bank":
            running_balances["cash_in_hand"] -= amt
            tgt = d_to if d_to in running_balances else sbi_id
            if tgt in running_balances:
                running_balances[tgt] += amt
        elif d_to == "Cash in Hand" or ttype == "bank_to_cash":
            running_balances["cash_in_hand"] += amt
            src = w_from if w_from in running_balances else sbi_id
            if src in running_balances:
                running_balances[src] -= amt
        else:
            if w_from in running_balances:
                running_balances[w_from] -= amt
            if d_to in running_balances:
                running_balances[d_to] += amt

    # Round all running balances
    for k in running_balances:
        running_balances[k] = round(running_balances[k], 2)

    sbi_closing = running_balances.get(sbi_id, 0.0)
    axis_closing = running_balances.get(axis_id, 0.0)
    cash_closing = running_balances.get("cash_in_hand", 0.0)
    contra_closing = running_balances.get("cash_in_bank", 0.0)

    total_funds = round(sbi_closing + axis_closing + cash_closing + contra_closing, 2)

    # Build account details list
    acc_list = []
    for b in all_banks:
        if b.get("is_clearing") or b.get("id") == "acc_paytm_clearing":
            continue
        bid = b.get("id")
        cb = running_balances.get(bid, float(b.get("opening_balance") or 0.0))
        ob = float(init_acc_map.get(bid, b.get("opening_balance") or 0.0))
        acc_list.append({
            "id": bid,
            "name": b.get("name"),
            "bank_name": b.get("bank_name"),
            "account_no": b.get("account_no"),
            "ifsc": b.get("ifsc"),
            "opening_balance": ob,
            "current_balance": cb,
            "closing_balance": cb,
            "latest_closing_balance": cb,
        })

    return {
        "as_of_date": as_of_date,
        "start_date": start_date,
        "banks": {b["id"]: b["current_balance"] for b in acc_list},
        "sbi_closing": sbi_closing,
        "axis_closing": axis_closing,
        "cash_in_hand": cash_closing,
        "cash_in_bank": contra_closing,
        "total_funds": total_funds,
        "accounts_list": acc_list,
        "fixed_opening_balances": {
            sbi_id: fixed_sbi_ob,
            axis_id: fixed_axis_ob,
            "cash_in_hand": fixed_cash_ob,
            "cash_in_bank": fixed_bank_d_ob,
        }
    }
