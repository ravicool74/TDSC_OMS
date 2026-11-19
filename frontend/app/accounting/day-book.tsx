import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, Platform, Share, Modal } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, font, shadow } from '@/src/theme';
import { api } from '@/src/api';
import { ScreenHeader } from '@/src/ScreenHeader';

const inr = (n: any) => {
  const val = Number(n || 0);
  return `₹${val.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const todayKolkata = (): string => {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istDate = new Date(now.getTime() + istOffset + (now.getTimezoneOffset() * 60 * 1000));
  return istDate.toISOString().slice(0, 10);
};

const daysAgo = (d: number) => {
  const dt = new Date();
  dt.setDate(dt.getDate() - d);
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istDate = new Date(dt.getTime() + istOffset + (dt.getTimezoneOffset() * 60 * 1000));
  return istDate.toISOString().slice(0, 10);
};

export default function DayBookReport() {
  const router = useRouter();
  const [fromDate, setFromDate] = useState(todayKolkata());
  const [toDate, setToDate] = useState(todayKolkata());
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  // Quick Deposit Cash to Bank Modal states
  const [showDepositModal, setShowDepositModal] = useState(false);
  const [banksList, setBanksList] = useState<any[]>([]);
  const [cashInHandVal, setCashInHandVal] = useState<number>(0);
  const [depositBankId, setDepositBankId] = useState('');
  const [depositAmount, setDepositAmount] = useState('');
  const [depositDate, setDepositDate] = useState(todayKolkata());
  const [depositedBy, setDepositedBy] = useState('');
  const [depositSlip, setDepositSlip] = useState('');
  const [depositNote, setDepositNote] = useState('');
  const [depositBusy, setDepositBusy] = useState(false);
  const [depositErr, setDepositErr] = useState<string | null>(null);
  const [depositSuccessMsg, setDepositSuccessMsg] = useState<string | null>(null);

  const openDepositModal = async () => {
    setDepositErr(null);
    setDepositAmount('');
    setDepositDate(todayKolkata());
    setDepositSlip('');
    setDepositNote('');
    setShowDepositModal(true);
    try {
      const [banksRes, cashRes] = await Promise.all([
        api.getCashBankAccounts(),
        api.getCashSummary()
      ]);
      setBanksList(banksRes || []);
      if (banksRes && banksRes.length > 0) {
        setDepositBankId(banksRes[0].id);
      }
      setCashInHandVal(cashRes?.cash_in_hand || 0);
    } catch (err: any) {
      console.warn('Failed to load banks for deposit modal', err);
    }
  };

  const handleExecuteDeposit = async () => {
    const amt = parseFloat(depositAmount);
    if (isNaN(amt) || amt <= 0) {
      setDepositErr('Please enter a valid deposit amount.');
      return;
    }
    if (!depositBankId) {
      setDepositErr('Please select a destination bank account.');
      return;
    }
    setDepositBusy(true);
    setDepositErr(null);
    try {
      const selectedBank = banksList.find(b => b.id === depositBankId);
      const bankTitle = selectedBank ? `${selectedBank.name} (${selectedBank.bank_name})` : 'Bank';
      const desc = depositNote.trim() 
        ? `${depositNote.trim()} (Deposited by ${depositedBy || 'Staff'})` 
        : `Cash deposited into ${bankTitle} by ${depositedBy || 'Staff'}` + (depositSlip.trim() ? ` [Slip: ${depositSlip.trim()}]` : '');

      await api.executeCashBankTransfer({
        transfer_type: 'cash_to_bank',
        direction: 'deposit',
        withdraw_from: 'Cash in Hand',
        deposit_to: depositBankId,
        amount: amt,
        transfer_date: depositDate || todayKolkata(),
        description: desc,
        attachment_name: depositSlip.trim() || undefined,
      });

      setShowDepositModal(false);
      setDepositSuccessMsg(`Successfully deposited ₹${amt.toLocaleString('en-IN')} into ${bankTitle}!`);
      setTimeout(() => setDepositSuccessMsg(null), 6000);
      await load();
    } catch (e: any) {
      setDepositErr(e?.message || 'Failed to execute cash deposit');
    } finally {
      setDepositBusy(false);
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<any>(`/system/reports/day-book?from_date=${fromDate}&to_date=${toDate}`);
      setData(res);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const setPreset = (days: number) => {
    if (days === 0) {
      setFromDate(todayKolkata());
      setToDate(todayKolkata());
    } else if (days === 1) {
      setFromDate(daysAgo(1));
      setToDate(daysAgo(1));
    } else {
      setFromDate(daysAgo(days));
      setToDate(todayKolkata());
    }
  };

  const handlePrint = () => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const generatedOn = new Date().toLocaleString('en-IN', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: true
      });

      // 1. Opening Balance Table HTML
      let obRowsHtml = '';
      openingBalances.forEach((acc: any) => {
        obRowsHtml += `
          <tr>
            <td style="font-weight: 700; width: 60px;">${acc.index}</td>
            <td>
              <strong>${acc.name}</strong>
              ${acc.account_no && acc.account_no !== '—' ? `<div style="font-size: 8px; color: #64748B;">${acc.bank_name} &bull; A/c ${acc.account_no} &bull; IFSC: ${acc.ifsc}</div>` : ''}
            </td>
            <td style="text-align: right; font-weight: 700; width: 140px;">${inr(acc.balance)}</td>
          </tr>
        `;
      });

      // 2. Sale Receipts Table HTML
      let saleRowsHtml = '';
      if (saleReceipts.length === 0) {
        saleRowsHtml = `<tr><td colspan="10" style="text-align: center; color: #94A3B8; padding: 10px;">No Sale Receipts recorded in selected date range.</td></tr>`;
      } else {
        saleReceipts.forEach((sr: any) => {
          saleRowsHtml += `
            <tr>
              <td style="text-align: center; font-weight: 700;">${sr.sl_no}</td>
              <td>${sr.date}</td>
              <td style="font-weight: 700; color: #1D4ED8;">${sr.voucher}</td>
              <td>${sr.ref_no}</td>
              <td>${sr.transaction_type}</td>
              <td><strong>${sr.party}</strong></td>
              <td>${sr.particulars}</td>
              <td><span class="badge badge-sale">${sr.payment_mode}</span></td>
              <td style="text-align: right; font-weight: 700; color: #059669;">${inr(sr.receipt_in)}</td>
              <td style="text-align: right; color: #64748B;">—</td>
              <td style="text-align: right; font-weight: 700;">${inr(sr.cumulative_bal)}</td>
            </tr>
          `;
        });
      }

      // 3. Payment In Table HTML
      let payInRowsHtml = '';
      if (paymentInReceipts.length === 0) {
        payInRowsHtml = `<tr><td colspan="10" style="text-align: center; color: #94A3B8; padding: 10px;">No Payment In receipts recorded in selected date range.</td></tr>`;
      } else {
        paymentInReceipts.forEach((pr: any) => {
          payInRowsHtml += `
            <tr>
              <td style="text-align: center; font-weight: 700;">${pr.sl_no}</td>
              <td>${pr.date}</td>
              <td style="font-weight: 700; color: #7E22CE;">${pr.voucher}</td>
              <td>${pr.ref_no}</td>
              <td style="color: #2563EB;">${pr.previous_voucher_ref || 'Direct'}</td>
              <td><strong>${pr.party}</strong></td>
              <td>${pr.particulars}</td>
              <td><span class="badge badge-payin">${pr.payment_mode}</span></td>
              <td style="text-align: right; font-weight: 700; color: #059669;">${inr(pr.receipt_in)}</td>
              <td style="text-align: right; color: #64748B;">—</td>
              <td style="text-align: right; font-weight: 700;">${inr(pr.cumulative_bal)}</td>
            </tr>
          `;
        });
      }

      // 3.5 Contra Deposits Table HTML
      let contraRowsHtml = '';
      if (contraDeposits.length === 0) {
        contraRowsHtml = `<tr><td colspan="8" style="text-align: center; color: #94A3B8; padding: 10px;">No Cash Deposited to Bank (Contra) recorded in selected date range.</td></tr>`;
      } else {
        contraDeposits.forEach((cd: any) => {
          contraRowsHtml += `
            <tr>
              <td style="text-align: center; font-weight: 700;">${cd.sl_no}</td>
              <td>${cd.date}</td>
              <td style="font-weight: 700; color: #2563EB;">${cd.voucher}</td>
              <td style="color: #B45309; font-weight: 600;">${cd.withdrawn_from}</td>
              <td><strong>${cd.deposited_to_bank}</strong></td>
              <td>${cd.deposited_by}</td>
              <td style="text-align: right; font-weight: 700; color: #2563EB;">${inr(cd.amount)}</td>
              <td>${cd.attachment_name || '—'} ${cd.note ? `<div style="font-size: 8px; color: #64748B;">${cd.note}</div>` : ''}</td>
            </tr>
          `;
        });
      }

      // 3.8 Expense Details Table HTML
      let expRowsHtml = '';
      if (expenseDetails.length === 0) {
        expRowsHtml = `<tr><td colspan="9" style="text-align: center; color: #94A3B8; padding: 10px;">No Expenses / Payment Out recorded in selected date range.</td></tr>`;
      } else {
        expenseDetails.forEach((e: any) => {
          expRowsHtml += `
            <tr>
              <td style="text-align: center; font-weight: 700;">${e.sl_no}</td>
              <td>${e.date}</td>
              <td style="font-weight: 700; color: #DC2626;">${e.voucher}</td>
              <td><strong>${e.category}</strong></td>
              <td>${e.particulars}</td>
              <td>${e.paid_to}</td>
              <td><span class="badge badge-exp">${e.payment_mode}</span></td>
              <td style="text-align: right; font-weight: 700; color: #DC2626;">${inr(e.payment_out)}</td>
              <td style="text-align: right; font-weight: 700;">${inr(e.cumulative_bal)}</td>
            </tr>
          `;
        });
      }

      // 5. Closing Balances Table HTML
      let cbRowsHtml = '';
      closingBalances.forEach((item: any) => {
        const isExp = item.id?.startsWith('exp_');
        cbRowsHtml += `
          <tr>
            <td style="font-weight: 700; width: 60px;">${item.index}</td>
            <td>
              <strong>${item.name}</strong>
              ${item.account_no && item.account_no !== '—' ? `<div style="font-size: 8px; color: #64748B;">${item.bank_name} &bull; A/c ${item.account_no} &bull; IFSC: ${item.ifsc}</div>` : ''}
            </td>
            <td style="text-align: right; font-weight: 700; width: 140px; color: ${isExp ? '#DC2626' : '#0F172A'};">${inr(item.balance)}</td>
          </tr>
        `;
      });

      const printableHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Day Book Report - TRIVENI DSC AND ETENDER SERVICE PVT. LTD</title>
  <style>
    @media print {
      @page {
        size: A4 landscape;
        margin: 8mm;
      }
      body {
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      margin: 0;
      padding: 10px;
      color: #0F172A;
      font-size: 9.5px;
      line-height: 1.35;
      background: #FFF;
    }
    .header-box {
      border-bottom: 2px solid #00104A;
      padding-bottom: 8px;
      margin-bottom: 8px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .company-title {
      font-size: 16px;
      font-weight: 900;
      color: #00104A;
      margin: 0 0 2px 0;
    }
    .company-sub {
      font-size: 8.5px;
      color: #475569;
    }
    .report-banner {
      background: #F1F5F9;
      border: 1px solid #CBD5E1;
      border-radius: 4px;
      padding: 6px 12px;
      margin-bottom: 8px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .report-title {
      font-size: 13px;
      font-weight: 900;
      color: #0F172A;
    }
    .status-stamp-ok {
      background: #ECFDF5;
      border: 1px solid #A7F3D0;
      color: #065F46;
      padding: 4px 10px;
      border-radius: 4px;
      font-weight: 800;
      font-size: 9.5px;
    }
    .section-title {
      font-size: 11px;
      font-weight: 900;
      color: #1E293B;
      margin: 8px 0 3px 0;
      display: flex;
      justify-content: space-between;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 8px;
      page-break-inside: auto;
    }
    tr {
      page-break-inside: avoid;
    }
    thead {
      display: table-header-group;
    }
    th {
      background: #F8FAFC !important;
      border: 1px solid #CBD5E1;
      padding: 4px 5px;
      font-size: 8.5px;
      font-weight: 800;
      text-align: left;
      color: #334155;
    }
    td {
      border: 1px solid #E2E8F0;
      padding: 4px 5px;
      font-size: 8.5px;
    }
    .table-footer-row td {
      background: #F8FAFC !important;
      font-weight: 800;
      border-top: 2px solid #CBD5E1;
    }
    .badge {
      display: inline-block;
      padding: 1px 4px;
      border-radius: 3px;
      font-size: 7.5px;
      font-weight: 800;
    }
    .badge-sale { background: #DCFCE7; color: #166534; }
    .badge-payin { background: #F3E8FF; color: #7E22CE; }
    .badge-exp { background: #FEE2E2; color: #991B1B; }
    .summary-card {
      background: #F0FDF4;
      border: 1px solid #BBF7D0;
      border-radius: 4px;
      padding: 8px 12px;
      margin-bottom: 8px;
      page-break-inside: avoid;
    }
    .summary-row {
      display: flex;
      justify-content: space-between;
      font-size: 9.5px;
      margin: 2px 0;
    }
    .signatory-box {
      margin-top: 12px;
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      page-break-inside: avoid;
      border-top: 1px solid #E2E8F0;
      padding-top: 8px;
    }
    .stamp-badge {
      border: 2px solid #059669;
      color: #059669;
      font-weight: 900;
      font-size: 9px;
      padding: 2px 6px;
      border-radius: 3px;
      display: inline-block;
    }
  </style>
</head>
<body>
  <div class="header-box">
    <div>
      <div class="company-title">TRIVENI DSC AND ETENDER SERVICE PVT. LTD</div>
      <div class="company-sub">MOH-BHAISHASUR HOSPITAL MORE NEAR EYE CARE HOSPITAL SRI DILCHANDRA MAHTO WARD NO-17 RANCHI ROAD BIHARSHARIF</div>
      <div class="company-sub"><strong>GSTIN:</strong> 10AAGCT3865R1ZU &bull; <strong>State:</strong> 10-Bihar &bull; <strong>Phone:</strong> 9334344708 &bull; <strong>Email:</strong> tdscservice@gmail.com</div>
    </div>
    <div style="text-align: right;">
      <div class="status-stamp-ok">${isBalanced ? '&#10004; Account is ok. (VERIFIED)' : 'Account Mismatch'}</div>
      <div style="font-size: 8px; color: #64748B; margin-top: 3px;">Printed On: ${generatedOn}</div>
    </div>
  </div>

  <div class="report-banner">
    <div>
      <span class="report-title">DAY BOOK REPORT (CASH &amp; BANK REGISTER)</span>
      <span style="font-size: 9.5px; color: #64748B; margin-left: 8px;">&bull; Official Management Ledger</span>
    </div>
    <div style="font-size: 9.5px; font-weight: 700;">
      Period: ${fromDate} to ${toDate}
    </div>
  </div>

  <!-- 1. Opening Balance -->
  <div class="section-title">
    <span>1. Opening Balance:- (As of ${fromDate})</span>
    <span style="color: #2563EB;">Total OB: Rs. ${inr(data?.total_previous_ob || 0).replace('₹', '')}</span>
  </div>
  <table>
    <thead>
      <tr>
        <th style="width: 60px;">Index</th>
        <th>Account Name &amp; Details</th>
        <th style="text-align: right; width: 140px;">Current Balance in Rs.</th>
      </tr>
    </thead>
    <tbody>
      ${obRowsHtml}
      <tr class="table-footer-row">
        <td colspan="2"><strong>Total OB = (i)+(ii)+(iii)+(iv) + ... =</strong></td>
        <td style="text-align: right; color: #2563EB; font-weight: 900;">${inr(data?.total_previous_ob || 0)}</td>
      </tr>
    </tbody>
  </table>

  <!-- 2. Sale Receipts -->
  <div class="section-title">
    <span>2. Receipt Amount from Sale Voucher:</span>
    <span style="color: #059669;">${saleReceipts.length} Vouchers &bull; Total: ${inr(data?.total_sale_receipts || 0)}</span>
  </div>
  <table>
    <thead>
      <tr>
        <th style="width: 35px; text-align: center;">Sl.</th>
        <th style="width: 70px;">Date</th>
        <th style="width: 120px;">Voucher</th>
        <th style="width: 110px;">Ref #</th>
        <th style="width: 100px;">Type</th>
        <th style="width: 130px;">Party</th>
        <th>Particulars</th>
        <th style="width: 65px;">Mode</th>
        <th style="width: 75px; text-align: right;">Receipt (In)</th>
        <th style="width: 65px; text-align: right;">Payment (Out)</th>
        <th style="width: 80px; text-align: right;">Cumulative</th>
      </tr>
    </thead>
    <tbody>
      ${saleRowsHtml}
      <tr class="table-footer-row">
        <td colspan="8"><strong>Total Receipt Amount against Sale Vouchers:</strong></td>
        <td style="text-align: right; color: #059669;">${inr(data?.total_sale_receipts || 0)}</td>
        <td style="text-align: right;">₹0.00</td>
        <td style="text-align: right; color: #059669;">${inr(data?.total_sale_receipts || 0)}</td>
      </tr>
    </tbody>
  </table>

  <!-- 3. Payment In Receipts -->
  <div class="section-title">
    <span>3. Receipt Amount From Payment In:</span>
    <span style="color: #7E22CE;">${paymentInReceipts.length} Receipts &bull; Total: ${inr(data?.total_payment_in_receipts || 0)}</span>
  </div>
  <table>
    <thead>
      <tr>
        <th style="width: 35px; text-align: center;">Sl.</th>
        <th style="width: 70px;">Date</th>
        <th style="width: 110px;">Voucher</th>
        <th style="width: 110px;">Previous Ref.</th>
        <th style="width: 100px;">Type</th>
        <th style="width: 130px;">Party</th>
        <th>Particulars</th>
        <th style="width: 65px;">Mode</th>
        <th style="width: 75px; text-align: right;">Receipt (In)</th>
        <th style="width: 65px; text-align: right;">Payment (Out)</th>
        <th style="width: 80px; text-align: right;">Cumulative</th>
      </tr>
    </thead>
    <tbody>
      ${payInRowsHtml}
      <tr class="table-footer-row">
        <td colspan="8"><strong>Total Receipt Amount from Payment In:</strong></td>
        <td style="text-align: right; color: #059669;">${inr(data?.total_payment_in_receipts || 0)}</td>
        <td style="text-align: right;">₹0.00</td>
        <td style="text-align: right; color: #059669;">${inr(data?.total_payment_in_receipts || 0)}</td>
      </tr>
    </tbody>
  </table>

  <!-- 3.5 Contra Deposits -->
  <div class="section-title">
    <span>3.5. Cash Deposited to Bank (Contra Transfers):</span>
    <span style="color: #1D4ED8;">${contraDeposits.length} Contra &bull; Total: ${inr(data?.total_contra_deposits || 0)}</span>
  </div>
  <table>
    <thead>
      <tr>
        <th style="width: 35px; text-align: center;">Sl.</th>
        <th style="width: 70px;">Date</th>
        <th style="width: 110px;">Voucher #</th>
        <th style="width: 90px;">Withdrawn From</th>
        <th>Deposited To Bank</th>
        <th style="width: 100px;">Deposited By</th>
        <th style="width: 85px; text-align: right;">Amount (₹)</th>
        <th>Slip / Remarks</th>
      </tr>
    </thead>
    <tbody>
      ${contraRowsHtml}
      <tr class="table-footer-row">
        <td colspan="6"><strong>Total Cash Deposited into Bank (Contra):</strong></td>
        <td style="text-align: right; color: #1D4ED8;">${inr(data?.total_contra_deposits || 0)}</td>
        <td></td>
      </tr>
    </tbody>
  </table>

  <!-- 3.8 Payment Out / Expenses Detail Table -->
  <div class="section-title">
    <span>3.8. Payment Out / Expenses Detail:</span>
    <span style="color: #DC2626;">${expenseDetails.length} Expenses &bull; Total: ${inr(data?.total_expenses || 0)}</span>
  </div>
  <table>
    <thead>
      <tr>
        <th style="width: 35px; text-align: center;">Sl.</th>
        <th style="width: 70px;">Date</th>
        <th style="width: 90px;">Expense #</th>
        <th style="width: 140px;">Expense Category</th>
        <th>Particulars / Narration</th>
        <th style="width: 130px;">Paid To (Vendor/Payee)</th>
        <th style="width: 80px;">Mode</th>
        <th style="width: 85px; text-align: right;">Payment (Out)</th>
        <th style="width: 85px; text-align: right;">Cumulative</th>
      </tr>
    </thead>
    <tbody>
      ${expRowsHtml}
      <tr class="table-footer-row">
        <td colspan="7"><strong>Total Payment Out (Expenses):</strong></td>
        <td style="text-align: right; color: #DC2626;">${inr(data?.total_expenses || 0)}</td>
        <td style="text-align: right; color: #DC2626;">${inr(data?.total_expenses || 0)}</td>
      </tr>
    </tbody>
  </table>

  <!-- 4. Day Summary & Total O.B -->
  <div class="summary-card">
    <div style="font-weight: 900; font-size: 11px; color: #065F46; margin-bottom: 4px;">4. Day Book Summary &amp; Total O.B =</div>
    <div class="summary-row">
      <span>Total previous OB = (i)+(ii)+(iii)+(iv) + ... =</span>
      <span style="font-weight: 700;">Rs. ${inr(data?.total_previous_ob || 0).replace('₹', '')}</span>
    </div>
    <div style="font-weight: 800; color: #059669; margin: 1px 0;">And</div>
    <div class="summary-row">
      <span>Total Receipt amount against Sale during the day in Rs.</span>
      <span style="font-weight: 700; color: #059669;">${inr(data?.total_sale_receipts || 0).replace('₹', '')}</span>
    </div>
    <div style="font-weight: 800; color: #059669; margin: 1px 0;">And</div>
    <div class="summary-row">
      <span>Total Receipt amount against Payment in during the day in Rs.</span>
      <span style="font-weight: 700; color: #059669;">${inr(data?.total_payment_in_receipts || 0).replace('₹', '')}</span>
    </div>
    <div style="border-top: 1px dashed #86EFAC; margin-top: 4px; padding-top: 4px;" class="summary-row">
      <span style="font-weight: 900; color: #065F46; font-size: 11px;">Total O.B</span>
      <span style="font-weight: 900; color: #059669; font-size: 13px;">Rs. ${inr(data?.total_ob_with_receipts || 0).replace('₹', '')}</span>
    </div>
  </div>

  <!-- 5. Closing Balances -->
  <div class="section-title">
    <span>5. Closing Balance: (As of ${toDate})</span>
    <span style="color: #0F172A;">Total CB: Rs. ${inr(data?.total_closing_balance || 0).replace('₹', '')}</span>
  </div>
  <table>
    <thead>
      <tr>
        <th style="width: 60px;">Index</th>
        <th>Account / Component Name</th>
        <th style="text-align: right; width: 140px;">Current Balance in Rs.</th>
      </tr>
    </thead>
    <tbody>
      ${cbRowsHtml}
      <tr class="table-footer-row">
        <td colspan="2"><strong>Total C.B = (i)+(ii)+(iii)+(iv)+(v)+(vi) =</strong></td>
        <td style="text-align: right; color: #0F172A; font-weight: 900;">${inr(data?.total_closing_balance || 0)}</td>
      </tr>
    </tbody>
  </table>

  <!-- Footer with Digital Signature -->
  <div class="signatory-box">
    <div>
      <div style="font-weight: 800; font-size: 9px;">Triveni DSC &amp; E-Tender Management System</div>
      <div style="font-size: 8px; color: #64748B;">Computer generated financial statement. Page layout automatically adjusted for multi-page export.</div>
      <div style="font-size: 8px; color: #64748B;">Generated on: ${generatedOn}</div>
    </div>
    <div style="text-align: right;">
      <div class="stamp-badge">&#10004; DIGITALLY VERIFIED</div>
      <div style="font-size: 11px; font-weight: 800; color: #0F172A; margin-top: 2px;">अंजू कुमारी</div>
      <div style="font-size: 8px; color: #64748B;">Authorized Signatory<br/>For TRIVENI DSC AND ETENDER SERVICE PVT. LTD</div>
    </div>
  </div>
</body>
</html>`;

      // Render into hidden iframe and print cleanly without window cropping
      try {
        let iframe = document.getElementById('tdsc-daybook-print-frame') as HTMLIFrameElement;
        if (!iframe) {
          iframe = document.createElement('iframe');
          iframe.id = 'tdsc-daybook-print-frame';
          iframe.style.position = 'fixed';
          iframe.style.right = '0';
          iframe.style.bottom = '0';
          iframe.style.width = '0';
          iframe.style.height = '0';
          iframe.style.border = '0';
          document.body.appendChild(iframe);
        }
        const doc = iframe.contentDocument || iframe.contentWindow?.document;
        if (doc) {
          doc.open();
          doc.write(printableHtml);
          doc.close();
          setTimeout(() => {
            try {
              iframe.contentWindow?.focus();
              iframe.contentWindow?.print();
            } catch {
              window.print();
            }
          }, 350);
        }
      } catch {
        window.print();
      }
    } else {
      Share.share({
        message: `TRIVENI DSC & ETENDER SERVICE PVT. LTD. - Day Book Report (${fromDate} to ${toDate})\nTotal OB: ${inr(data?.total_ob_with_receipts)}\nTotal CB: ${inr(data?.total_cb)}\nStatus: ${data?.reconciliation_message || 'OK'}`,
        title: 'Day Book Report',
      });
    }
  };

  const openingBalances: any[] = data?.opening_balances || [];
  const saleReceipts: any[] = data?.sale_receipts || [];
  const paymentInReceipts: any[] = data?.payment_in_receipts || [];
  const contraDeposits: any[] = data?.contra_deposits || [];
  const expenseDetails: any[] = data?.expense_details || [];
  const closingBalances: any[] = data?.closing_balances || [];
  const isBalanced: boolean = data?.is_balanced !== false;
  const diffAmt = data?.difference || 0;

  return (
    <View style={styles.root} testID="day-book-screen">
      <ScreenHeader
        title="Day Book Report"
        right={
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Pressable onPress={openDepositModal} style={styles.depositBtn} testID="btn-deposit-cash">
              <Ionicons name="arrow-up-circle-outline" size={16} color="#059669" />
              <Text style={styles.depositBtnTxt}>+ Deposit Cash to Bank</Text>
            </Pressable>
            <Pressable onPress={handlePrint} style={styles.printBtn} testID="btn-print-day-book">
              <Ionicons name="print-outline" size={18} color="#2563EB" />
              <Text style={styles.printBtnTxt}>Print / PDF</Text>
            </Pressable>
          </View>
        }
      />

      {/* Date Filter Bar */}
      <View style={styles.filterCard}>
        <View style={styles.presetRow}>
          <Pressable onPress={() => setPreset(0)} style={[styles.presetChip, fromDate === todayKolkata() && toDate === todayKolkata() && styles.presetChipActive]}>
            <Text style={[styles.presetText, fromDate === todayKolkata() && toDate === todayKolkata() && styles.presetTextActive]}>Today</Text>
          </Pressable>
          <Pressable onPress={() => setPreset(1)} style={[styles.presetChip, fromDate === daysAgo(1) && toDate === daysAgo(1) && styles.presetChipActive]}>
            <Text style={[styles.presetText, fromDate === daysAgo(1) && toDate === daysAgo(1) && styles.presetTextActive]}>Yesterday</Text>
          </Pressable>
          <Pressable onPress={() => setPreset(7)} style={[styles.presetChip, fromDate === daysAgo(7) && styles.presetChipActive]}>
            <Text style={[styles.presetText, fromDate === daysAgo(7) && styles.presetTextActive]}>Last 7 Days</Text>
          </Pressable>
          <Pressable onPress={() => setPreset(30)} style={[styles.presetChip, fromDate === daysAgo(30) && styles.presetChipActive]}>
            <Text style={[styles.presetText, fromDate === daysAgo(30) && styles.presetTextActive]}>Last 30 Days</Text>
          </Pressable>
        </View>

        <View style={styles.dateInputsRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.dateLbl}>From Date (Calendar)</Text>
            {Platform.OS === 'web' ? (
              <input
                type="date"
                value={fromDate}
                onChange={(e: any) => setFromDate(e.target.value)}
                style={webDateInputStyle}
              />
            ) : (
              <TextInput style={styles.dateInput} value={fromDate} onChangeText={setFromDate} placeholder="YYYY-MM-DD" />
            )}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.dateLbl}>To Date (Calendar)</Text>
            {Platform.OS === 'web' ? (
              <input
                type="date"
                value={toDate}
                onChange={(e: any) => setToDate(e.target.value)}
                style={webDateInputStyle}
              />
            ) : (
              <TextInput style={styles.dateInput} value={toDate} onChangeText={setToDate} placeholder="YYYY-MM-DD" />
            )}
          </View>
          <Pressable onPress={load} style={styles.goBtn}>
            <Ionicons name="refresh" size={18} color="#FFF" />
          </Pressable>
        </View>
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={colors.brandPrimary} />
          <Text style={{ color: colors.muted, marginTop: 8 }}>Compiling Day Book Ledger...</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scrollContent}>

          {/* Reconciliation Status Alert Banner */}
          <View style={[styles.statusBanner, isBalanced ? styles.statusBannerOk : styles.statusBannerMismatch]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Ionicons
                name={isBalanced ? 'checkmark-circle' : 'alert-circle'}
                size={28}
                color={isBalanced ? '#059669' : '#DC2626'}
              />
              <View style={{ flex: 1 }}>
                <Text style={[styles.statusBannerTitle, { color: isBalanced ? '#065F46' : '#991B1B' }]}>
                  {isBalanced ? 'Account is ok.' : 'Account Mismatch'}
                </Text>
                <Text style={[styles.statusBannerSub, { color: isBalanced ? '#047857' : '#B91C1C' }]}>
                  {isBalanced
                    ? `Total O.B (${inr(data?.total_ob_with_receipts)}) matches Total C.B (${inr(data?.total_cb)}) perfectly.`
                    : `Discrepancy of ${inr(diffAmt)} between Total O.B (${inr(data?.total_ob_with_receipts)}) and Total C.B (${inr(data?.total_cb)}).`}
                </Text>
              </View>
            </View>
          </View>

          {/* ============================================================== */}
          {/* 1. Opening Balance Section                                     */}
          {/* ============================================================== */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="wallet-outline" size={20} color="#2563EB" />
                <Text style={styles.cardTitle}>Opening Balance:-</Text>
              </View>
              <Text style={styles.cardPeriodBadge}>As of {fromDate}</Text>
            </View>

            <View style={{ gap: 10, marginTop: 8 }}>
              {openingBalances.map((acc, i) => (
                <View key={acc.id || i} style={styles.balanceItemRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.balanceItemName}>
                      <Text style={{ fontWeight: '800', color: '#2563EB' }}>{acc.index} </Text>
                      {acc.name}
                    </Text>
                    {acc.account_no && acc.account_no !== '—' ? (
                      <Text style={styles.balanceItemSub}>
                        {acc.bank_name} • A/c {acc.account_no} • IFSC: {acc.ifsc}
                      </Text>
                    ) : null}
                  </View>
                  <View style={styles.dottedLeader} />
                  <Text style={styles.balanceItemAmt}>
                    Current Balance in Rs. <Text style={{ fontWeight: '800', color: '#0F172A' }}>{inr(acc.balance)}</Text>
                  </Text>
                </View>
              ))}
            </View>

            <View style={styles.sectionDivider} />

            <View style={styles.summaryTotalRow}>
              <Text style={styles.summaryTotalLabel}>
                Total OB = (i)+(ii)+(iii)+(iv) + ... =
              </Text>
              <Text style={[styles.summaryTotalValue, { color: '#2563EB' }]}>
                Rs. {inr(data?.total_previous_ob || 0).replace('₹', '')}
              </Text>
            </View>
          </View>

          {/* ============================================================== */}
          {/* 2. Receipt Amount from Sale Voucher Table                     */}
          {/* ============================================================== */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="receipt-outline" size={20} color="#059669" />
                <Text style={styles.cardTitle}>Receipt Amount from Sale Voucher:</Text>
              </View>
              <View style={{ backgroundColor: '#D1FAE5', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 }}>
                <Text style={{ color: '#047857', fontSize: 11, fontWeight: '800' }}>
                  {saleReceipts.length} Vouchers • Total: {inr(data?.total_sale_receipts || 0)}
                </Text>
              </View>
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={true} style={{ marginTop: 8 }}>
              <View>
                {/* Table Header */}
                <View style={styles.tableHeaderRow}>
                  <Text style={[styles.thCell, { width: 50 }]}>Sl. No.</Text>
                  <Text style={[styles.thCell, { width: 95 }]}>Date</Text>
                  <Text style={[styles.thCell, { width: 140 }]}>Voucher</Text>
                  <Text style={[styles.thCell, { width: 130 }]}>Ref #</Text>
                  <Text style={[styles.thCell, { width: 120 }]}>Transaction Type</Text>
                  <Text style={[styles.thCell, { width: 180 }]}>Party</Text>
                  <Text style={[styles.thCell, { width: 180 }]}>Particulars</Text>
                  <Text style={[styles.thCell, { width: 110 }]}>Payment Mode</Text>
                  <Text style={[styles.thCell, { width: 110, textAlign: 'right' }]}>Receipt (In)</Text>
                  <Text style={[styles.thCell, { width: 110, textAlign: 'right' }]}>Payment (Out)</Text>
                  <Text style={[styles.thCell, { width: 120, textAlign: 'right' }]}>Cumulative Bal.</Text>
                </View>

                {/* Table Body */}
                {saleReceipts.length === 0 ? (
                  <View style={styles.tableEmptyRow}>
                    <Text style={styles.tableEmptyText}>No Sale Receipts recorded in selected date range.</Text>
                  </View>
                ) : (
                  saleReceipts.map((sr, idx) => (
                    <View key={idx} style={[styles.tableDataRow, idx % 2 === 1 && styles.tableRowAlt]}>
                      <Text style={[styles.tdCell, { width: 50, fontWeight: '700' }]}>{sr.sl_no}</Text>
                      <Text style={[styles.tdCell, { width: 95 }]}>{sr.date}</Text>
                      <Text style={[styles.tdCell, { width: 140, fontWeight: '700', color: '#2563EB' }]}>{sr.voucher}</Text>
                      <Text style={[styles.tdCell, { width: 130 }]}>{sr.ref_no}</Text>
                      <Text style={[styles.tdCell, { width: 120 }]}>{sr.transaction_type}</Text>
                      <Text style={[styles.tdCell, { width: 180, fontWeight: '600' }]} numberOfLines={1}>{sr.party}</Text>
                      <Text style={[styles.tdCell, { width: 180 }]} numberOfLines={1}>{sr.particulars}</Text>
                      <View style={{ width: 110, paddingHorizontal: 6, justifyContent: 'center' }}>
                        <View style={styles.modeBadge}>
                          <Text style={styles.modeBadgeText}>{sr.payment_mode}</Text>
                        </View>
                      </View>
                      <Text style={[styles.tdCell, { width: 110, textAlign: 'right', fontWeight: '800', color: '#059669' }]}>
                        {inr(sr.receipt_in)}
                      </Text>
                      <Text style={[styles.tdCell, { width: 110, textAlign: 'right', color: '#64748B' }]}>
                        {sr.payment_out > 0 ? inr(sr.payment_out) : '—'}
                      </Text>
                      <Text style={[styles.tdCell, { width: 120, textAlign: 'right', fontWeight: '800', color: '#0F172A' }]}>
                        {inr(sr.cumulative_bal)}
                      </Text>
                    </View>
                  ))
                )}

                {/* Table Footer */}
                <View style={styles.tableFooterRow}>
                  <Text style={[styles.tfCell, { width: 885 }]}>Total Receipt Amount against Sale Vouchers:</Text>
                  <Text style={[styles.tfCell, { width: 110, textAlign: 'right', color: '#059669' }]}>
                    {inr(data?.total_sale_receipts || 0)}
                  </Text>
                  <Text style={[styles.tfCell, { width: 110, textAlign: 'right' }]}>₹0.00</Text>
                  <Text style={[styles.tfCell, { width: 120, textAlign: 'right', color: '#059669' }]}>
                    {inr(data?.total_sale_receipts || 0)}
                  </Text>
                </View>
              </View>
            </ScrollView>
          </View>

          {/* ============================================================== */}
          {/* 3. Receipt Amount From Payment In Table                        */}
          {/* ============================================================== */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="arrow-down-circle-outline" size={20} color="#7C3AED" />
                <Text style={styles.cardTitle}>Receipt Amount From Payment In:</Text>
              </View>
              <View style={{ backgroundColor: '#F3E8FF', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 }}>
                <Text style={{ color: '#7E22CE', fontSize: 11, fontWeight: '800' }}>
                  {paymentInReceipts.length} Receipts • Total: {inr(data?.total_payment_in_receipts || 0)}
                </Text>
              </View>
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={true} style={{ marginTop: 8 }}>
              <View>
                {/* Table Header */}
                <View style={styles.tableHeaderRow}>
                  <Text style={[styles.thCell, { width: 50 }]}>Sl. No.</Text>
                  <Text style={[styles.thCell, { width: 95 }]}>Date</Text>
                  <Text style={[styles.thCell, { width: 130 }]}>Voucher</Text>
                  <Text style={[styles.thCell, { width: 120 }]}>Ref #</Text>
                  <Text style={[styles.thCell, { width: 170 }]}>Previous Voucher Ref. against receipt Payment</Text>
                  <Text style={[styles.thCell, { width: 120 }]}>Transaction Type</Text>
                  <Text style={[styles.thCell, { width: 170 }]}>Party</Text>
                  <Text style={[styles.thCell, { width: 170 }]}>Particulars</Text>
                  <Text style={[styles.thCell, { width: 110 }]}>Payment Mode</Text>
                  <Text style={[styles.thCell, { width: 110, textAlign: 'right' }]}>Receipt (In)</Text>
                  <Text style={[styles.thCell, { width: 110, textAlign: 'right' }]}>Payment (Out)</Text>
                  <Text style={[styles.thCell, { width: 120, textAlign: 'right' }]}>Cumulative Bal.</Text>
                </View>

                {/* Table Body */}
                {paymentInReceipts.length === 0 ? (
                  <View style={styles.tableEmptyRow}>
                    <Text style={styles.tableEmptyText}>No Payment In receipts recorded in selected date range.</Text>
                  </View>
                ) : (
                  paymentInReceipts.map((pr, idx) => (
                    <View key={idx} style={[styles.tableDataRow, idx % 2 === 1 && styles.tableRowAlt]}>
                      <Text style={[styles.tdCell, { width: 50, fontWeight: '700' }]}>{pr.sl_no}</Text>
                      <Text style={[styles.tdCell, { width: 95 }]}>{pr.date}</Text>
                      <Text style={[styles.tdCell, { width: 130, fontWeight: '700', color: '#7C3AED' }]}>{pr.voucher}</Text>
                      <Text style={[styles.tdCell, { width: 120 }]}>{pr.ref_no}</Text>
                      <Text style={[styles.tdCell, { width: 170, color: '#2563EB', fontWeight: '600' }]} numberOfLines={1}>
                        {pr.previous_voucher_ref}
                      </Text>
                      <Text style={[styles.tdCell, { width: 120 }]}>{pr.transaction_type}</Text>
                      <Text style={[styles.tdCell, { width: 170, fontWeight: '600' }]} numberOfLines={1}>{pr.party}</Text>
                      <Text style={[styles.tdCell, { width: 170 }]} numberOfLines={1}>{pr.particulars}</Text>
                      <View style={{ width: 110, paddingHorizontal: 6, justifyContent: 'center' }}>
                        <View style={[styles.modeBadge, { backgroundColor: '#F3E8FF' }]}>
                          <Text style={[styles.modeBadgeText, { color: '#7E22CE' }]}>{pr.payment_mode}</Text>
                        </View>
                      </View>
                      <Text style={[styles.tdCell, { width: 110, textAlign: 'right', fontWeight: '800', color: '#059669' }]}>
                        {inr(pr.receipt_in)}
                      </Text>
                      <Text style={[styles.tdCell, { width: 110, textAlign: 'right', color: '#64748B' }]}>
                        {pr.payment_out > 0 ? inr(pr.payment_out) : '—'}
                      </Text>
                      <Text style={[styles.tdCell, { width: 120, textAlign: 'right', fontWeight: '800', color: '#0F172A' }]}>
                        {inr(pr.cumulative_bal)}
                      </Text>
                    </View>
                  ))
                )}

                {/* Table Footer */}
                <View style={styles.tableFooterRow}>
                  <Text style={[styles.tfCell, { width: 945 }]}>Total Receipt Amount from Payment In:</Text>
                  <Text style={[styles.tfCell, { width: 110, textAlign: 'right', color: '#059669' }]}>
                    {inr(data?.total_payment_in_receipts || 0)}
                  </Text>
                  <Text style={[styles.tfCell, { width: 110, textAlign: 'right' }]}>₹0.00</Text>
                  <Text style={[styles.tfCell, { width: 120, textAlign: 'right', color: '#059669' }]}>
                    {inr(data?.total_payment_in_receipts || 0)}
                  </Text>
                </View>
              </View>
            </ScrollView>
          </View>

          {/* Success banner if quick cash deposit just succeeded */}
          {depositSuccessMsg && (
            <View style={styles.successToast}>
              <Ionicons name="checkmark-circle" size={18} color="#059669" />
              <Text style={styles.successToastText}>{depositSuccessMsg}</Text>
            </View>
          )}

          {/* ============================================================== */}
          {/* 3.5. Cash Deposited to Bank (Contra Transfers) Table           */}
          {/* ============================================================== */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="swap-horizontal-outline" size={20} color="#2563EB" />
                <Text style={styles.cardTitle}>Cash Deposited to Bank (Contra Transfers):</Text>
              </View>
              <View style={{ backgroundColor: '#EFF6FF', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 }}>
                <Text style={{ color: '#1D4ED8', fontSize: 11, fontWeight: '800' }}>
                  {contraDeposits.length} Contra Transfers • Total: {inr(data?.total_contra_deposits || 0)}
                </Text>
              </View>
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={true} style={{ marginTop: 8 }}>
              <View>
                {/* Table Header */}
                <View style={styles.tableHeaderRow}>
                  <Text style={[styles.thCell, { width: 50 }]}>Sl. No.</Text>
                  <Text style={[styles.thCell, { width: 95 }]}>Date</Text>
                  <Text style={[styles.thCell, { width: 140 }]}>Voucher / Ref #</Text>
                  <Text style={[styles.thCell, { width: 140 }]}>Withdrawn From</Text>
                  <Text style={[styles.thCell, { width: 220 }]}>Deposited To Bank</Text>
                  <Text style={[styles.thCell, { width: 140 }]}>Deposited By</Text>
                  <Text style={[styles.thCell, { width: 120, textAlign: 'right' }]}>Amount (₹)</Text>
                  <Text style={[styles.thCell, { width: 140 }]}>Slip / Challan Ref</Text>
                  <Text style={[styles.thCell, { width: 220 }]}>Note / Remarks</Text>
                </View>

                {/* Table Body */}
                {contraDeposits.length === 0 ? (
                  <View style={styles.tableEmptyRow}>
                    <Text style={styles.tableEmptyText}>No Cash Deposited to Bank recorded in selected date range.</Text>
                  </View>
                ) : (
                  contraDeposits.map((cd, idx) => (
                    <View key={idx} style={[styles.tableDataRow, idx % 2 === 1 && styles.tableRowAlt]}>
                      <Text style={[styles.tdCell, { width: 50, fontWeight: '700' }]}>{cd.sl_no}</Text>
                      <Text style={[styles.tdCell, { width: 95 }]}>{cd.date}</Text>
                      <Text style={[styles.tdCell, { width: 140, fontWeight: '700', color: '#2563EB' }]}>{cd.voucher}</Text>
                      <Text style={[styles.tdCell, { width: 140, fontWeight: '600', color: '#B45309' }]}>{cd.withdrawn_from}</Text>
                      <Text style={[styles.tdCell, { width: 220, fontWeight: '700', color: '#1E293B' }]} numberOfLines={1}>
                        {cd.deposited_to_bank}
                      </Text>
                      <Text style={[styles.tdCell, { width: 140 }]} numberOfLines={1}>{cd.deposited_by}</Text>
                      <Text style={[styles.tdCell, { width: 120, textAlign: 'right', fontWeight: '800', color: '#2563EB' }]}>
                        {inr(cd.amount)}
                      </Text>
                      <Text style={[styles.tdCell, { width: 140, color: '#475569' }]} numberOfLines={1}>
                        {cd.attachment_name || '—'}
                      </Text>
                      <Text style={[styles.tdCell, { width: 220 }]} numberOfLines={1}>{cd.note}</Text>
                    </View>
                  ))
                )}

                {/* Table Footer */}
                <View style={styles.tableFooterRow}>
                  <Text style={[styles.tfCell, { width: 785 }]}>Total Cash Deposited into Bank (Contra):</Text>
                  <Text style={[styles.tfCell, { width: 120, textAlign: 'right', color: '#2563EB' }]}>
                    {inr(data?.total_contra_deposits || 0)}
                  </Text>
                  <Text style={[styles.tfCell, { width: 360 }]}></Text>
                </View>
              </View>
            </ScrollView>
          </View>

          {/* ============================================================== */}
          {/* 3.8. Payment Out / Expenses Detail Table                      */}
          {/* ============================================================== */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="card-outline" size={20} color="#DC2626" />
                <Text style={styles.cardTitle}>Payment Out / Expenses Detail:</Text>
              </View>
              <View style={{ backgroundColor: '#FEE2E2', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 }}>
                <Text style={{ color: '#B91C1C', fontSize: 11, fontWeight: '800' }}>
                  {expenseDetails.length} Expenses • Total: {inr(data?.total_expenses || 0)}
                </Text>
              </View>
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={true} style={{ marginTop: 8 }}>
              <View>
                {/* Table Header */}
                <View style={styles.tableHeaderRow}>
                  <Text style={[styles.thCell, { width: 50 }]}>Sl. No.</Text>
                  <Text style={[styles.thCell, { width: 95 }]}>Date</Text>
                  <Text style={[styles.thCell, { width: 120 }]}>Expense #</Text>
                  <Text style={[styles.thCell, { width: 160 }]}>Expense Category</Text>
                  <Text style={[styles.thCell, { width: 180 }]}>Particulars / Note</Text>
                  <Text style={[styles.thCell, { width: 160 }]}>Paid To (Vendor/Payee)</Text>
                  <Text style={[styles.thCell, { width: 110 }]}>Payment Mode</Text>
                  <Text style={[styles.thCell, { width: 110, textAlign: 'right' }]}>Receipt (In)</Text>
                  <Text style={[styles.thCell, { width: 110, textAlign: 'right' }]}>Payment (Out)</Text>
                  <Text style={[styles.thCell, { width: 120, textAlign: 'right' }]}>Cumulative Bal.</Text>
                </View>

                {/* Table Body */}
                {expenseDetails.length === 0 ? (
                  <View style={styles.tableEmptyRow}>
                    <Text style={styles.tableEmptyText}>No Expenses / Payment Out recorded in selected date range.</Text>
                  </View>
                ) : (
                  expenseDetails.map((exp: any, idx: number) => (
                    <View key={idx} style={[styles.tableDataRow, idx % 2 === 1 && styles.tableRowAlt]}>
                      <Text style={[styles.tdCell, { width: 50, fontWeight: '700' }]}>{exp.sl_no}</Text>
                      <Text style={[styles.tdCell, { width: 95 }]}>{exp.date}</Text>
                      <Text style={[styles.tdCell, { width: 120, fontWeight: '700', color: '#DC2626' }]}>{exp.voucher}</Text>
                      <Text style={[styles.tdCell, { width: 160, fontWeight: '600' }]} numberOfLines={1}>{exp.category}</Text>
                      <Text style={[styles.tdCell, { width: 180 }]} numberOfLines={1}>{exp.particulars}</Text>
                      <Text style={[styles.tdCell, { width: 160, fontWeight: '600' }]} numberOfLines={1}>{exp.paid_to}</Text>
                      <View style={{ width: 110, paddingHorizontal: 6, justifyContent: 'center' }}>
                        <View style={[styles.modeBadge, { backgroundColor: '#FEE2E2' }]}>
                          <Text style={[styles.modeBadgeText, { color: '#B91C1C' }]}>{exp.payment_mode}</Text>
                        </View>
                      </View>
                      <Text style={[styles.tdCell, { width: 110, textAlign: 'right', color: '#64748B' }]}>—</Text>
                      <Text style={[styles.tdCell, { width: 110, textAlign: 'right', fontWeight: '800', color: '#DC2626' }]}>
                        {inr(exp.payment_out)}
                      </Text>
                      <Text style={[styles.tdCell, { width: 120, textAlign: 'right', fontWeight: '800', color: '#0F172A' }]}>
                        {inr(exp.cumulative_bal)}
                      </Text>
                    </View>
                  ))
                )}

                {/* Table Footer */}
                <View style={styles.tableFooterRow}>
                  <Text style={[styles.tfCell, { width: 875 }]}>Total Payment Out (Expenses):</Text>
                  <Text style={[styles.tfCell, { width: 110, textAlign: 'right' }]}>₹0.00</Text>
                  <Text style={[styles.tfCell, { width: 110, textAlign: 'right', color: '#DC2626' }]}>
                    {inr(data?.total_expenses || 0)}
                  </Text>
                  <Text style={[styles.tfCell, { width: 120, textAlign: 'right', color: '#DC2626' }]}>
                    {inr(data?.total_expenses || 0)}
                  </Text>
                </View>
              </View>
            </ScrollView>
          </View>

          {/* ============================================================== */}
          {/* 4. Day Summary & Total O.B.                                    */}
          {/* ============================================================== */}
          <View style={[styles.card, { backgroundColor: '#F0FDF4', borderColor: '#BBF7D0' }]}>
            <View style={styles.cardHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="calculator-outline" size={20} color="#059669" />
                <Text style={[styles.cardTitle, { color: '#065F46' }]}>Total O.B =</Text>
              </View>
            </View>

            <View style={{ gap: 6, marginTop: 8 }}>
              <View style={styles.summaryItemRow}>
                <Text style={styles.summaryItemText}>
                  Total previous OB = (i)+(ii)+(iii)+(iv) + ... =
                </Text>
                <Text style={styles.summaryItemVal}>
                  Rs. {inr(data?.total_previous_ob || 0).replace('₹', '')}
                </Text>
              </View>
              <Text style={styles.summaryItemConj}>And</Text>
              <View style={styles.summaryItemRow}>
                <Text style={styles.summaryItemText}>
                  Total Receipt amount against Sale during the day in Rs.
                </Text>
                <Text style={[styles.summaryItemVal, { color: '#059669' }]}>
                  {inr(data?.total_sale_receipts || 0).replace('₹', '')}
                </Text>
              </View>
              <Text style={styles.summaryItemConj}>And</Text>
              <View style={styles.summaryItemRow}>
                <Text style={styles.summaryItemText}>
                  Total Receipt amount against Payment in during the day in Rs.
                </Text>
                <Text style={[styles.summaryItemVal, { color: '#059669' }]}>
                  {inr(data?.total_payment_in_receipts || 0).replace('₹', '')}
                </Text>
              </View>
            </View>

            <View style={[styles.sectionDivider, { borderColor: '#86EFAC' }]} />

            <View style={styles.summaryTotalRow}>
              <Text style={[styles.summaryTotalLabel, { color: '#065F46' }]}>
                Total O.B
              </Text>
              <Text style={[styles.summaryTotalValue, { color: '#059669', fontSize: 18 }]}>
                Rs. {inr(data?.total_ob_with_receipts || 0).replace('₹', '')}
              </Text>
            </View>
          </View>

          {/* ============================================================== */}
          {/* 5. Closing Balance Section                                     */}
          {/* ============================================================== */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="lock-closed-outline" size={20} color="#475569" />
                <Text style={styles.cardTitle}>Closing Balance:</Text>
              </View>
              <Text style={styles.cardPeriodBadge}>As of {toDate}</Text>
            </View>

            <View style={{ gap: 10, marginTop: 8 }}>
              {closingBalances.map((item, i) => (
                <View key={item.id || i} style={styles.balanceItemRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.balanceItemName}>
                      <Text style={{ fontWeight: '800', color: '#475569' }}>{item.index} </Text>
                      {item.name}
                    </Text>
                    {item.account_no && item.account_no !== '—' ? (
                      <Text style={styles.balanceItemSub}>
                        {item.bank_name} • A/c {item.account_no} • IFSC: {item.ifsc}
                      </Text>
                    ) : null}
                  </View>
                  <View style={styles.dottedLeader} />
                  <Text style={styles.balanceItemAmt}>
                    {item.id?.startsWith('exp_') ? 'Rs. ' : 'Current Balance in Rs. '}
                    <Text style={{ fontWeight: '800', color: item.id?.startsWith('exp_') ? '#DC2626' : '#0F172A' }}>
                      {inr(item.balance)}
                    </Text>
                  </Text>
                </View>
              ))}
            </View>

            <View style={styles.sectionDivider} />

            <View style={styles.summaryTotalRow}>
              <Text style={styles.summaryTotalLabel}>
                Total C.B = (i)+(ii)+(iii)+(iv)+(v)+(vi) =
              </Text>
              <Text style={[styles.summaryTotalValue, { color: '#0F172A' }]}>
                Rs. {inr(data?.total_closing_balance || 0).replace('₹', '')}
              </Text>
            </View>
          </View>

          {/* ============================================================== */}
          {/* 6. Verification / Audit Stamp                                  */}
          {/* ============================================================== */}
          <View style={[styles.auditStampCard, isBalanced ? { borderColor: '#A7F3D0', backgroundColor: '#ECFDF5' } : { borderColor: '#FECACA', backgroundColor: '#FEF2F2' }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons
                  name={isBalanced ? 'shield-checkmark' : 'warning'}
                  size={24}
                  color={isBalanced ? '#059669' : '#DC2626'}
                />
                <View>
                  <Text style={{ fontSize: 13, fontWeight: '800', color: isBalanced ? '#065F46' : '#991B1B' }}>
                    Reconciliation Status: {isBalanced ? 'Account is ok.' : 'Account Mismatch'}
                  </Text>
                  <Text style={{ fontSize: 11, color: isBalanced ? '#047857' : '#B91C1C', marginTop: 2 }}>
                    If Total O.B = Total C.B → Account is ok. | If Not match O.B = C.B → Message "Account Mismatch"
                  </Text>
                </View>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={{ fontSize: 11, fontWeight: '700', color: '#64748B' }}>
                  Diff: {inr(diffAmt)}
                </Text>
                <View style={[styles.stampPill, { backgroundColor: isBalanced ? '#059669' : '#DC2626' }]}>
                  <Text style={styles.stampPillText}>{isBalanced ? 'VERIFIED' : 'MISMATCH'}</Text>
                </View>
              </View>
            </View>
          </View>

        </ScrollView>
      )}

      {/* ============================================================== */}
      {/* Quick Modal: Deposit Cash into Bank (Contra Entry)              */}
      {/* ============================================================== */}
      <Modal visible={showDepositModal} transparent animationType="fade" onRequestClose={() => setShowDepositModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="arrow-up-circle" size={24} color="#059669" />
                <View>
                  <Text style={styles.modalTitle}>Deposit Cash into Bank</Text>
                  <Text style={styles.modalSubtitle}>Contra Transfer: Cash in Hand → Company Bank Account</Text>
                </View>
              </View>
              <Pressable onPress={() => setShowDepositModal(false)}>
                <Ionicons name="close-circle-outline" size={24} color="#64748B" />
              </Pressable>
            </View>

            <ScrollView style={{ padding: spacing.md, maxHeight: 500 }} contentContainerStyle={{ gap: 14 }}>
              {depositErr && (
                <View style={styles.errBox}>
                  <Ionicons name="alert-circle" size={16} color="#DC2626" />
                  <Text style={styles.errText}>{depositErr}</Text>
                </View>
              )}

              {/* Cash in Hand available preview */}
              <View style={styles.cashPreviewBox}>
                <Ionicons name="wallet" size={20} color="#059669" />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 11, color: '#047857', fontWeight: '700' }}>CURRENT CASH IN HAND</Text>
                  <Text style={{ fontSize: 18, color: '#065F46', fontWeight: '900' }}>{inr(cashInHandVal)}</Text>
                </View>
              </View>

              {/* Target Bank Account Selector */}
              <View style={{ gap: 6 }}>
                <Text style={styles.inputLabel}>Select Destination Bank Account <Text style={{ color: '#DC2626' }}>*</Text></Text>
                <View style={{ gap: 8 }}>
                  {banksList.map((b: any) => {
                    const isSelected = depositBankId === b.id;
                    return (
                      <Pressable
                        key={b.id}
                        onPress={() => setDepositBankId(b.id)}
                        style={[styles.bankChoiceCard, isSelected && styles.bankChoiceCardActive]}
                      >
                        <Ionicons
                          name={isSelected ? 'radio-button-on' : 'radio-button-off'}
                          size={18}
                          color={isSelected ? '#2563EB' : '#94A3B8'}
                        />
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.bankChoiceName, isSelected && { color: '#1D4ED8' }]}>{b.name}</Text>
                          <Text style={styles.bankChoiceSub}>
                            {b.bank_name} • A/c {b.account_no} • IFSC: {b.ifsc}
                          </Text>
                        </View>
                        <Text style={styles.bankChoiceBal}>{inr(b.opening_balance || 0)}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              {/* Amount input */}
              <View style={{ gap: 6 }}>
                <Text style={styles.inputLabel}>Deposit Amount (₹) <Text style={{ color: '#DC2626' }}>*</Text></Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="e.g. 40000"
                  keyboardType="numeric"
                  value={depositAmount}
                  onChangeText={setDepositAmount}
                />
              </View>

              {/* Date & Deposited By Row */}
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1, gap: 6 }}>
                  <Text style={styles.inputLabel}>Deposit Date</Text>
                  <TextInput
                    style={styles.modalInput}
                    placeholder="YYYY-MM-DD"
                    value={depositDate}
                    onChangeText={setDepositDate}
                  />
                </View>
                <View style={{ flex: 1, gap: 6 }}>
                  <Text style={styles.inputLabel}>Deposited By (Staff)</Text>
                  <TextInput
                    style={styles.modalInput}
                    placeholder="Staff name"
                    value={depositedBy}
                    onChangeText={setDepositedBy}
                  />
                </View>
              </View>

              {/* Slip Ref & Note */}
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1, gap: 6 }}>
                  <Text style={styles.inputLabel}>Deposit Slip / Challan #</Text>
                  <TextInput
                    style={styles.modalInput}
                    placeholder="e.g. SLIP-8942"
                    value={depositSlip}
                    onChangeText={setDepositSlip}
                  />
                </View>
                <View style={{ flex: 1, gap: 6 }}>
                  <Text style={styles.inputLabel}>Note / Remarks</Text>
                  <TextInput
                    style={styles.modalInput}
                    placeholder="e.g. Cash deposit to SBI"
                    value={depositNote}
                    onChangeText={setDepositNote}
                  />
                </View>
              </View>
            </ScrollView>

            <View style={styles.modalFooter}>
              <Pressable onPress={() => setShowDepositModal(false)} style={styles.cancelBtn}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={handleExecuteDeposit}
                disabled={depositBusy}
                style={[styles.confirmBtn, depositBusy && { opacity: 0.7 }]}
              >
                {depositBusy ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <>
                    <Ionicons name="checkmark-done" size={16} color="#FFF" />
                    <Text style={styles.confirmBtnText}>Confirm Deposit to Bank</Text>
                  </>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const webDateInputStyle: any = {
  border: '1px solid #CBD5E1',
  borderRadius: 6,
  padding: '6px 10px',
  fontSize: 13,
  backgroundColor: '#FFFFFF',
  fontFamily: 'inherit',
  color: '#0F172A',
  width: '100%',
  outline: 'none',
  boxSizing: 'border-box',
  cursor: 'pointer',
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F8FAFC' },
  printBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.md, backgroundColor: '#EFF6FF', borderWidth: 1, borderColor: '#BFDBFE' },
  printBtnTxt: { fontSize: 12, fontWeight: '700', color: '#2563EB' },
  filterCard: { padding: spacing.md, backgroundColor: '#FFF', borderBottomWidth: 1, borderBottomColor: colors.border, gap: 10 },
  presetRow: { flexDirection: 'row', gap: 8 },
  presetChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: '#F1F5F9' },
  presetChipActive: { backgroundColor: colors.brandPrimary },
  presetText: { fontSize: 11, fontWeight: '700', color: '#475569' },
  presetTextActive: { color: '#FFF' },
  dateInputsRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  dateLbl: { fontSize: 10, fontWeight: '700', color: '#64748B', marginBottom: 2 },
  dateInput: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 8, paddingVertical: 6, fontSize: font.sm, backgroundColor: '#FFF' },
  goBtn: { backgroundColor: colors.brandPrimary, padding: 8, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  scrollContent: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxxl },

  statusBanner: { padding: spacing.md, borderRadius: radius.md, borderWidth: 1 },
  statusBannerOk: { backgroundColor: '#ECFDF5', borderColor: '#A7F3D0' },
  statusBannerMismatch: { backgroundColor: '#FEF2F2', borderColor: '#FECACA' },
  statusBannerTitle: { fontSize: 16, fontWeight: '900' },
  statusBannerSub: { fontSize: 12, marginTop: 2 },

  card: { backgroundColor: '#FFF', borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, ...shadow.card },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { fontSize: 14, fontWeight: '800', color: '#0F172A' },
  cardPeriodBadge: { fontSize: 11, fontWeight: '700', color: '#64748B', backgroundColor: '#F1F5F9', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 },

  balanceItemRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  balanceItemName: { fontSize: 13, fontWeight: '700', color: '#1E293B' },
  balanceItemSub: { fontSize: 11, color: '#64748B', marginTop: 1 },
  dottedLeader: { flex: 1, height: 1, borderBottomWidth: 1, borderBottomColor: '#CBD5E1', borderStyle: 'dotted', marginHorizontal: 6 },
  balanceItemAmt: { fontSize: 12, color: '#475569' },

  sectionDivider: { height: 1, borderBottomWidth: 1, borderBottomColor: '#E2E8F0', marginVertical: 12 },

  summaryTotalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  summaryTotalLabel: { fontSize: 13, fontWeight: '800', color: '#1E293B' },
  summaryTotalValue: { fontSize: 16, fontWeight: '900' },

  tableHeaderRow: { flexDirection: 'row', backgroundColor: '#F8FAFC', borderBottomWidth: 2, borderBottomColor: '#CBD5E1', paddingVertical: 8 },
  thCell: { fontSize: 11, fontWeight: '800', color: '#334155', paddingHorizontal: 6 },
  tableDataRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#F1F5F9', paddingVertical: 8, alignItems: 'center' },
  tableRowAlt: { backgroundColor: '#F8FAFC' },
  tdCell: { fontSize: 12, color: '#1E293B', paddingHorizontal: 6 },
  modeBadge: { backgroundColor: '#ECFDF5', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, alignSelf: 'flex-start' },
  modeBadgeText: { fontSize: 10, fontWeight: '800', color: '#047857' },
  tableFooterRow: { flexDirection: 'row', backgroundColor: '#F1F5F9', borderTopWidth: 2, borderTopColor: '#CBD5E1', paddingVertical: 8, alignItems: 'center' },
  tfCell: { fontSize: 12, fontWeight: '800', color: '#0F172A', paddingHorizontal: 6 },
  tableEmptyRow: { padding: 24, alignItems: 'center', justifyContent: 'center' },
  tableEmptyText: { fontSize: 12, color: '#94A3B8', fontStyle: 'italic' },

  summaryItemRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  summaryItemText: { fontSize: 13, fontWeight: '600', color: '#166534' },
  summaryItemConj: { fontSize: 11, fontWeight: '800', color: '#059669', marginVertical: -2 },
  summaryItemVal: { fontSize: 13, fontWeight: '800', color: '#0F172A' },

  auditStampCard: { padding: spacing.md, borderRadius: radius.md, borderWidth: 1 },
  stampPill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4, marginTop: 4 },
  stampPillText: { fontSize: 10, fontWeight: '900', color: '#FFF', letterSpacing: 0.5 },

  depositBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.md, backgroundColor: '#ECFDF5', borderWidth: 1, borderColor: '#A7F3D0' },
  depositBtnTxt: { fontSize: 12, fontWeight: '800', color: '#059669' },

  successToast: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, backgroundColor: '#ECFDF5', borderRadius: radius.md, borderWidth: 1, borderColor: '#A7F3D0' },
  successToastText: { fontSize: 12, fontWeight: '700', color: '#065F46' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', alignItems: 'center', padding: spacing.md },
  modalCard: { width: '100%', maxWidth: 540, backgroundColor: '#FFFFFF', borderRadius: radius.lg, overflow: 'hidden', ...shadow.card },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.md, borderBottomWidth: 1, borderBottomColor: '#E2E8F0', backgroundColor: '#F8FAFC' },
  modalTitle: { fontSize: 15, fontWeight: '800', color: '#0F172A' },
  modalSubtitle: { fontSize: 11, color: '#64748B', marginTop: 2 },

  cashPreviewBox: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, backgroundColor: '#ECFDF5', borderRadius: radius.md, borderWidth: 1, borderColor: '#A7F3D0' },
  bankChoiceCard: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: radius.md, borderWidth: 1, borderColor: '#E2E8F0', backgroundColor: '#F8FAFC' },
  bankChoiceCardActive: { borderColor: '#2563EB', backgroundColor: '#EFF6FF' },
  bankChoiceName: { fontSize: 12, fontWeight: '800', color: '#1E293B' },
  bankChoiceSub: { fontSize: 11, color: '#64748B', marginTop: 2 },
  bankChoiceBal: { fontSize: 12, fontWeight: '800', color: '#059669' },

  inputLabel: { fontSize: 11, fontWeight: '700', color: '#475569' },
  modalInput: { borderWidth: 1, borderColor: '#CBD5E1', borderRadius: radius.md, paddingHorizontal: 10, paddingVertical: 8, fontSize: 13, backgroundColor: '#FFF' },

  modalFooter: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, padding: spacing.md, borderTopWidth: 1, borderTopColor: '#E2E8F0', backgroundColor: '#F8FAFC' },
  cancelBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.md, backgroundColor: '#F1F5F9' },
  cancelBtnText: { fontSize: 12, fontWeight: '700', color: '#475569' },
  confirmBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 8, borderRadius: radius.md, backgroundColor: '#059669' },
  confirmBtnText: { fontSize: 12, fontWeight: '800', color: '#FFF' },

  errBox: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 10, backgroundColor: '#FEF2F2', borderRadius: radius.md, borderWidth: 1, borderColor: '#FECACA' },
  errText: { fontSize: 11, color: '#DC2626', fontWeight: '700' },
});
