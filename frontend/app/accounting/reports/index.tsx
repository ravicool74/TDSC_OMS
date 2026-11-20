import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, Share, Platform, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as SecureStore from 'expo-secure-store';
import { colors, spacing, radius, font, shadow } from '@/src/theme';
import { api } from '@/src/api';

const FAV_KEY = 'acc.report.favs';
const BLUE = '#2563EB';
const NAVY = '#00104A';

const inr = (n: any): string => {
  if (n === undefined || n === null || n === '') return '₹0.00';
  const str = String(n).trim();
  if (str.startsWith('₹') || str.startsWith('-₹')) {
    return str.replace(/^([+-]?)(₹)\s*/, '$1₹');
  }
  const num = Number(str.replace(/[^0-9.-]/g, ''));
  if (isNaN(num)) return `₹${n}`;
  const isNeg = num < 0;
  const absFormatted = Math.abs(num).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${isNeg ? '-' : ''}₹${absFormatted}`;
};

const formatCellValue = (colKey: string, val: any): string => {
  if (val === undefined || val === null || val === '') return '—';
  const str = String(val).trim();
  if (str.startsWith('₹') || str.startsWith('-₹')) {
    return str.replace(/^([+-]?)(₹)\s*/, '$1₹');
  }

  const moneyColKeywords = [
    'taxable', 'tax', 'gst', 'amount', 'amt', 'paid', 'balance', 'price',
    'total', 'subtotal', 'received', 'turnover', 'profit', 'debit', 'credit',
    'sales', 'purchases', 'expenses', 'discount', 'fee', 'charge', 'cost',
    'receivable', 'payable', 'opening', 'closing'
  ];
  const isMoneyCol = moneyColKeywords.some(kw => colKey.toLowerCase().includes(kw));
  const isNumericStr = /^-?\d+(\.\d+)?$/.test(str.replace(/,/g, ''));

  if (isMoneyCol || isNumericStr) {
    const num = Number(str.replace(/,/g, ''));
    if (!isNaN(num)) {
      const isNeg = num < 0;
      return `${isNeg ? '-' : ''}₹${Math.abs(num).toLocaleString('en-IN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;
    }
  }
  return str;
};

const getColWidth = (colKey: string): number => {
  const k = colKey.toLowerCase();
  if (k === '#' || k === 'sr' || k === 'sn') return 44;
  if (k === 'actions') return 110;
  if (k.includes('date')) return 100;
  if (k.includes('ref')) return 120;
  if (k.includes('inv') || k.includes('bill_no') || k.includes('voucher') || k.includes('order_no')) return 130;
  if (k.includes('mode') || k.includes('type')) return 85;
  if (k.includes('status')) return 105;
  if (k.includes('taxable')) return 110;
  if (k.includes('tax') || k.includes('gst')) return 95;
  if (k.includes('total') || k.includes('amount') || k.includes('amt') || k.includes('received') || k.includes('inflow') || k.includes('outflow')) return 125;
  if (k.includes('paid')) return 100;
  if (k.includes('balance')) return 110;
  if (k.includes('fee')) return 130;
  if (k.includes('party') || k.includes('client') || k.includes('vendor') || k.includes('customer') || k.includes('name')) return 170;
  if (k.includes('desc') || k.includes('narration') || k.includes('item')) return 170;
  if (k.includes('hsn') || k.includes('sac')) return 90;
  if (k.includes('qty') || k.includes('quantity')) return 70;
  if (k.includes('rate') || k.includes('price')) return 100;
  return 115;
};

interface ReportItem {
  id: string;
  name: string;
  icon: any;
  description: string;
}

interface ReportCategory {
  id: string;
  title: string;
  icon: any;
  color: string;
  reports: ReportItem[];
}

export default function AccountingReportsHub() {
  const router = useRouter();
  const params = useLocalSearchParams<{ report?: string; tab?: string; bank?: string }>();

  const [categories, setCategories] = useState<ReportCategory[]>([]);
  const [summary, setSummary] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCatId, setSelectedCatId] = useState<string>('all');
  const [openCats, setOpenCats] = useState<Record<string, boolean>>({ core_financial: true, party_reports: true, gst_reports: true, passed_on_money: true });
  const [favs, setFavs] = useState<Record<string, boolean>>({});

  const rawReportParam = Array.isArray(params?.report) ? params.report[0] : params?.report;
  const rawBankParam = Array.isArray(params?.bank) ? params.bank[0] : params?.bank;

  // Active Report Viewer State
  const [activeReportId, setActiveReportId] = useState<string | null>(rawReportParam || null);
  const [reportData, setReportData] = useState<any | null>(null);
  const [reportLoading, setReportLoading] = useState(!!rawReportParam);
  const [reportError, setReportError] = useState<string | null>(null);
  const [dateFilter, setDateFilter] = useState<'today' | 'yesterday' | 'month' | 'quarter' | 'fy' | 'all' | 'custom'>('month');
  const [customFromDate, setCustomFromDate] = useState<string>(() => {
    const d = new Date();
    return d.toISOString().split('T')[0];
  });
  const [customToDate, setCustomToDate] = useState<string>(() => {
    const d = new Date();
    return d.toISOString().split('T')[0];
  });
  const [tableSearch, setTableSearch] = useState('');
  const [selectedBankId, setSelectedBankId] = useState<string>(rawBankParam || '');
  const [editingContraModal, setEditingContraModal] = useState<any | null>(null);
  const [contraForm, setContraForm] = useState({ amount: '', particulars: '', date: '' });
  const [savingContra, setSavingContra] = useState(false);
  const [viewingContra, setViewingContra] = useState<any | null>(null);

  // Load Catalog & Summary
  const loadCatalog = useCallback(async () => {
    setLoading(true);
    try {
      const [catRes, sumRes] = await Promise.all([
        api.getAccountingReportsCatalog().catch(() => null),
        api.getAccountingReportsSummary().catch(() => null),
      ]);
      if (catRes?.categories) setCategories(catRes.categories);
      if (sumRes) setSummary(sumRes);

      const savedFavs = await SecureStore.getItemAsync(FAV_KEY).catch(() => null);
      if (savedFavs) setFavs(JSON.parse(savedFavs));
    } catch {
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { loadCatalog(); }, [loadCatalog]));

  // Auto-open report if passed in params
  useEffect(() => {
    const rId = Array.isArray(params?.report) ? params.report[0] : params?.report;
    const bId = Array.isArray(params?.bank) ? params.bank[0] : params?.bank;
    if (rId) {
      if (bId) setSelectedBankId(bId);
      openReport(rId, undefined, undefined, undefined, bId);
    }
  }, [params?.report, params?.bank]);

  // Inject native @media print style for web so Ctrl+P prints cleanly with full-width table
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const styleId = 'tdsc-native-print-rules';
    let styleTag = document.getElementById(styleId);
    if (!styleTag) {
      styleTag = document.createElement('style');
      styleTag.id = styleId;
      styleTag.innerHTML = `
        @media print {
          @page {
            size: A4 landscape;
            margin: 8mm;
          }
          body {
            background: #FFFFFF !important;
            color: #000000 !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          [data-testid="rep-back-btn"], nav, header, .no-print, [role="banner"], [testID="rep-back-btn"] {
            display: none !important;
          }
          div[style*="overflow: hidden"], div[style*="overflow-x: scroll"], div[style*="overflow: auto"] {
            overflow: visible !important;
            width: 100% !important;
            max-width: 100% !important;
          }
          table {
            width: 100% !important;
            page-break-inside: auto !important;
          }
          thead {
            display: table-header-group !important;
          }
          tr {
            page-break-inside: avoid !important;
          }
        }
      `;
      document.head.appendChild(styleTag);
    }
  }, []);

  const toggleFav = async (reportId: string) => {
    const next = { ...favs, [reportId]: !favs[reportId] };
    setFavs(next);
    try { await SecureStore.setItemAsync(FAV_KEY, JSON.stringify(next)); } catch {}
  };

  const toggleCategory = (catId: string) => {
    setOpenCats(prev => ({ ...prev, [catId]: !prev[catId] }));
  };

  // Open specific report
  const openReport = async (
    repId: string,
    customDateFilter?: 'today' | 'yesterday' | 'month' | 'quarter' | 'fy' | 'all' | 'custom',
    fromDateOverride?: string,
    toDateOverride?: string,
    selectedBankIdOverride?: string
  ) => {
    const cleanRepId = Array.isArray(repId) ? repId[0] : repId;
    setActiveReportId(cleanRepId);
    setReportLoading(true);
    setReportError(null);
    setTableSearch('');
    const dFilter = customDateFilter || dateFilter;

    let fromDate: string | undefined = undefined;
    let toDate: string | undefined = undefined;
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];

    if (dFilter === 'today') {
      fromDate = todayStr;
      toDate = todayStr;
    } else if (dFilter === 'yesterday') {
      const y = new Date();
      y.setDate(y.getDate() - 1);
      const yStr = y.toISOString().split('T')[0];
      fromDate = yStr;
      toDate = yStr;
    } else if (dFilter === 'custom') {
      fromDate = fromDateOverride || customFromDate || todayStr;
      toDate = toDateOverride || customToDate || todayStr;
    } else if (dFilter === 'month') {
      fromDate = `${todayStr.slice(0, 7)}-01`;
      toDate = todayStr;
    } else if (dFilter === 'quarter') {
      const qMonth = Math.floor(now.getMonth() / 3) * 3 + 1;
      fromDate = `${now.getFullYear()}-${String(qMonth).padStart(2, '0')}-01`;
      toDate = todayStr;
    } else if (dFilter === 'fy') {
      const startYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
      fromDate = `${startYear}-04-01`;
      toDate = todayStr;
    }

    const bId = selectedBankIdOverride !== undefined ? selectedBankIdOverride : selectedBankId;

    try {
      const res = await api.getAccountingReportData(cleanRepId, {
        from_date: fromDate,
        to_date: toDate,
        bank_id: bId || undefined,
      });
      setReportData(res);
      setReportError(null);
      if (res?.selected_bank_id) {
        setSelectedBankId(res.selected_bank_id);
      }
    } catch (err: any) {
      console.error('Failed to load report:', err);
      setReportData(null);
      setReportError(err?.message || 'Could not load report statement. Please check connection and try again.');
    } finally {
      setReportLoading(false);
    }
  };

  const handleViewVoucher = (row: any) => {
    if (!row.voucher_id) return;
    if (row.voucher_type === 'sale_invoice') {
      router.push(`/accounting/invoices/${row.voucher_id}` as any);
    } else if (row.voucher_type === 'payment_in') {
      router.push(`/accounting/income/${row.voucher_id}` as any);
    } else if (row.voucher_type === 'expense') {
      router.push(`/accounting/expenses/${row.voucher_id}` as any);
    } else if (row.voucher_type === 'contra') {
      setViewingContra(row);
    }
  };

  const handleEditVoucher = (row: any) => {
    if (!row.voucher_id) return;
    if (row.voucher_type === 'sale_invoice') {
      router.push({ pathname: '/accounting/invoices/new', params: { edit_id: row.voucher_id, type: 'sale' } } as any);
    } else if (row.voucher_type === 'payment_in') {
      router.push({ pathname: '/accounting/income/new', params: { edit_id: row.voucher_id } } as any);
    } else if (row.voucher_type === 'expense') {
      router.push({ pathname: '/accounting/expenses/new', params: { edit_id: row.voucher_id } } as any);
    } else if (row.voucher_type === 'contra') {
      setEditingContraModal(row);
      setContraForm({
        amount: String(row.receipt_raw || row.payment_raw || ''),
        particulars: String(row.particulars || ''),
        date: String(row.date || ''),
      });
    }
  };

  const handleDeleteVoucher = async (row: any) => {
    if (!row.voucher_id) return;
    const vName = row.voucher_no || row.trans_type || 'this transaction';
    const confirmed = Platform.OS === 'web'
      ? window.confirm(`Are you sure you want to delete ${vName}? This action will permanently remove the voucher and update all balances.`)
      : true;

    if (!confirmed) return;
    try {
      if (row.voucher_type === 'sale_invoice') {
        await api.deleteInvoice(row.voucher_id);
      } else if (row.voucher_type === 'payment_in') {
        await api.deleteIncome(row.voucher_id);
      } else if (row.voucher_type === 'expense') {
        await api.deleteExpense(row.voucher_id);
      } else if (row.voucher_type === 'contra') {
        await api.deleteContraTransaction(row.voucher_id);
      }
      if (Platform.OS === 'web') {
        alert(`${vName} deleted successfully.`);
      }
      if (activeReportId) {
        openReport(activeReportId, dateFilter, customFromDate, customToDate, selectedBankId);
      }
    } catch (e: any) {
      const msg = e?.message || 'Delete failed';
      if (Platform.OS === 'web') alert(msg);
    }
  };

  const handleSaveContraEdit = async () => {
    if (!editingContraModal?.voucher_id) return;
    setSavingContra(true);
    try {
      await api.updateContraTransaction(editingContraModal.voucher_id, {
        amount: parseFloat(contraForm.amount) || 0,
        particulars: contraForm.particulars,
        date: contraForm.date,
      });
      setEditingContraModal(null);
      if (activeReportId) {
        openReport(activeReportId, dateFilter, customFromDate, customToDate, selectedBankId);
      }
    } catch (e: any) {
      if (Platform.OS === 'web') alert(e?.message || 'Update failed');
    } finally {
      setSavingContra(false);
    }
  };

  const changeDateFilter = (filter: 'today' | 'yesterday' | 'month' | 'quarter' | 'fy' | 'all' | 'custom') => {
    setDateFilter(filter);
    if (activeReportId) {
      openReport(activeReportId, filter);
    }
  };

  // Filtered categories and reports
  const filteredCategories = useMemo(() => {
    return categories.map(cat => {
      let filteredReports = cat.reports;
      if (selectedCatId !== 'all' && cat.id !== selectedCatId) {
        return null;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        filteredReports = cat.reports.filter(r =>
          r.name.toLowerCase().includes(q) ||
          r.description.toLowerCase().includes(q) ||
          cat.title.toLowerCase().includes(q)
        );
      }
      if (filteredReports.length === 0) return null;
      return { ...cat, reports: filteredReports };
    }).filter(Boolean) as ReportCategory[];
  }, [categories, selectedCatId, searchQuery]);

  // Filtered in-report table rows
  const filteredReportRows = useMemo(() => {
    if (!reportData?.rows) return [];
    if (!tableSearch.trim()) return reportData.rows;
    const q = tableSearch.toLowerCase().trim();
    return reportData.rows.filter((row: any) =>
      Object.values(row).some(val => String(val || '').toLowerCase().includes(q))
    );
  }, [reportData, tableSearch]);

  const shareReport = async () => {
    if (!reportData) return;
    let text = `*TDSC Office Management System*\n`;
    text += `*Report:* ${reportData.report_title}\n`;
    text += `*Category:* ${reportData.category}\n`;
    text += `*Generated On:* ${new Date().toLocaleDateString('en-IN')}\n\n`;

    if (reportData.kpis && reportData.kpis.length > 0) {
      text += `*KEY METRICS:*\n`;
      reportData.kpis.forEach((k: any) => {
        text += `• ${k.label}: ${k.value}\n`;
      });
      text += `\n`;
    }

    if (reportData.rows && reportData.rows.length > 0) {
      text += `*TOTAL RECORDS:* ${reportData.rows.length} entries\n`;
    }

    try {
      await Share.share({ message: text });
    } catch {}
  };

  const handlePrint = () => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') {
      shareReport();
      return;
    }

    const title = reportData?.report_title || 'Financial Summary Report';
    const category = reportData?.category || 'Accounting & Billing';
    const dateLabel = dateFilter === 'today'
      ? 'Today'
      : dateFilter === 'yesterday'
      ? 'Yesterday'
      : dateFilter === 'custom'
      ? `${customFromDate} to ${customToDate}`
      : dateFilter === 'month'
      ? 'This Month'
      : dateFilter === 'quarter'
      ? 'Quarter'
      : dateFilter === 'fy'
      ? 'FY 2026-27'
      : 'All Time';
    const generatedOn = new Date().toLocaleString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: true,
    });
    const logoUrl = `${api.base}/api/system/logo`;
    const cols = (reportData?.columns || []).filter((c: any) => c.key !== 'actions');
    const rows = filteredReportRows || [];
    const kpis = reportData?.kpis || [];
    const isLandscape = cols.length > 6;

    const obList = reportData?.opening_balances || [];
    const cbList = reportData?.closing_balances || [];

    let obHtml = '';
    if (obList.length > 0) {
      obHtml = `
        <div style="margin-bottom: 12px; border: 1px solid #CBD5E1; border-radius: 4px; padding: 8px 12px; background: #F8FAFC;">
          <div style="font-weight: 800; font-size: 10.5px; color: #00104A; margin-bottom: 6px; letter-spacing: 0.3px;">OPENING BALANCE:</div>
          <table style="width: 100%; font-size: 9px; border-collapse: collapse;">
            ${obList.map((b: any) => `
              <tr style="border-bottom: 1px dashed #E2E8F0;">
                <td style="width: 32px; font-weight: 700; padding: 3px 4px;">${b.index}</td>
                <td style="padding: 3px 4px;"><strong>${b.name}</strong> ${b.account_no && b.account_no !== '—' ? `<span style="color: #64748B;">(${b.bank_name} &bull; A/c ${b.account_no} &bull; IFSC: ${b.ifsc})</span>` : ''}</td>
                <td style="width: 170px; text-align: right; font-weight: 700; padding: 3px 4px;">Current Balance in ${inr(b.balance)}</td>
              </tr>
            `).join('')}
            <tr style="border-top: 1.5px solid #00104A; font-weight: 800; color: #00104A; background: #F1F5F9;">
              <td colspan="2" style="padding: 5px 4px;">Total OB = (i)+(ii)+(iii)+(iv)+... =</td>
              <td style="text-align: right; padding: 5px 4px; font-weight: 900; color: #059669;">${inr(reportData?.total_previous_ob || 0)}</td>
            </tr>
          </table>
        </div>
      `;
    }

    let cbHtml = '';
    if (cbList.length > 0) {
      cbHtml = `
        <div style="margin-top: 12px; margin-bottom: 12px; border: 1px solid #CBD5E1; border-radius: 4px; padding: 8px 12px; background: #F8FAFC;">
          <div style="font-weight: 800; font-size: 10.5px; color: #00104A; margin-bottom: 6px; letter-spacing: 0.3px;">CLOSING BALANCE:</div>
          <table style="width: 100%; font-size: 9px; border-collapse: collapse;">
            ${cbList.map((b: any) => {
              const isExp = b.id?.startsWith('exp_');
              return `
              <tr style="border-bottom: 1px dashed #E2E8F0;">
                <td style="width: 32px; font-weight: 700; padding: 3px 4px;">${b.index}</td>
                <td style="padding: 3px 4px;"><strong>${b.name}</strong> ${b.account_no && b.account_no !== '—' ? `<span style="color: #64748B;">(${b.bank_name} &bull; A/c ${b.account_no} &bull; IFSC: ${b.ifsc})</span>` : ''}</td>
                <td style="width: 170px; text-align: right; font-weight: 700; padding: 3px 4px; color: ${isExp ? '#DC2626' : '#0F172A'};">
                  ${isExp ? `Total: ${inr(b.balance)}` : `Current Balance in ${inr(b.balance)}`}
                </td>
              </tr>
              `;
            }).join('')}
            <tr style="border-top: 1.5px solid #00104A; font-weight: 800; color: #00104A; background: #F1F5F9;">
              <td colspan="2" style="padding: 5px 4px;">Total CB = (i)+(ii)+(iii)+(iv)+(v)+(vi) =</td>
              <td style="text-align: right; padding: 5px 4px; font-weight: 900; color: #00104A;">${inr(reportData?.total_closing_balance || 0)}</td>
            </tr>
          </table>
          <div style="margin-top: 6px; padding: 5px 8px; border-radius: 4px; font-weight: 800; font-size: 9.5px; background: ${reportData?.is_balanced !== false ? '#ECFDF5' : '#FEF2F2'}; color: ${reportData?.is_balanced !== false ? '#065F46' : '#DC2626'}; border: 1px solid ${reportData?.is_balanced !== false ? '#A7F3D0' : '#FECACA'};">
            ${reportData?.is_balanced !== false ? '&#10004; Account is ok. Total O.B matches Total C.B perfectly.' : '&#9888; Account Mismatch - Difference: ' + inr(reportData?.difference || 0)}
          </div>
        </div>
      `;
    }

    const kpiHtml = kpis.length > 0 ? `
      <div class="kpi-grid">
        ${kpis.map((k: any) => `
          <div class="kpi-card" style="border-left-color: ${k.color || '#2563EB'};">
            <div class="kpi-lbl">${k.label}</div>
            <div class="kpi-val" style="color: ${k.color || '#0F172A'};">${inr(k.value)}</div>
          </div>
        `).join('')}
      </div>
    ` : '';

    const theadHtml = `
      <thead>
        <tr>
          <th style="width: 32px; text-align: center;">#</th>
          ${cols.map((c: any) => {
            const isColAmount = ['taxable', 'tax', 'gst', 'amount', 'amt', 'total', 'paid', 'balance', 'price', 'debit', 'credit', 'rate'].some((k: string) => c.key.toLowerCase().includes(k));
            return `<th style="${isColAmount ? 'text-align: right;' : 'text-align: left;'}">${c.label}</th>`;
          }).join('')}
        </tr>
      </thead>
    `;

    const tbodyHtml = rows.length > 0 ? `
      <tbody>
        ${rows.map((row: any, idx: number) => {
          const isBold = !!row.is_bold;
          return `
            <tr class="${isBold ? 'bold-row' : ''}">
              <td style="text-align: center; color: #64748B;">${idx + 1}</td>
              ${cols.map((c: any) => {
                const val = row[c.key];
                const formattedStr = formatCellValue(c.key, val);
                const isNumeric = formattedStr.startsWith('₹') || formattedStr.startsWith('-₹') || /^-?\d+(\.\d+)?%?$/.test(formattedStr.replace(/,/g, ''));
                const isAlert = formattedStr.includes('LOW') || formattedStr.includes('OVERDUE') || formattedStr.includes('Unpaid');
                return `
                  <td class="${isNumeric ? 'cell-numeric' : ''}" style="${isAlert ? 'color: #DC2626; font-weight: bold;' : ''}">
                    ${formattedStr}
                  </td>
                `;
              }).join('')}
            </tr>
          `;
        }).join('')}
      </tbody>
    ` : `
      <tbody>
        <tr>
          <td colspan="${cols.length + 1}" style="text-align: center; padding: 20px; color: #64748B;">
            No records found for this period.
          </td>
        </tr>
      </tbody>
    `;

    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>${title} - Triveni DSC</title>
  <style>
    @page {
      size: A4 ${isLandscape ? 'landscape' : 'portrait'};
      margin: 8mm 8mm 12mm 8mm;
    }
    @media print {
      body {
        margin: 0;
        padding: 0;
        background: #FFF;
        color: #000;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      .no-print {
        display: none !important;
      }
      table {
        page-break-inside: auto;
      }
      thead {
        display: table-header-group;
      }
      tr {
        page-break-inside: avoid;
        page-break-after: auto;
      }
    }
    * {
      box-sizing: border-box;
      -webkit-font-smoothing: antialiased;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      margin: 0;
      padding: 12px;
      color: #1E293B;
      background: #FFFFFF;
      font-size: 10px;
    }
    .print-wrapper {
      width: 100%;
      margin: 0 auto;
      background: #FFFFFF;
      padding: 12px;
    }
    .action-bar {
      position: sticky;
      top: 10px;
      margin-bottom: 14px;
      background: #00104A;
      color: #FFF;
      padding: 10px 16px;
      border-radius: 6px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      box-shadow: 0 4px 10px rgba(0,0,0,0.15);
      z-index: 1000;
    }
    .print-btn {
      background: #2563EB;
      color: #FFF;
      border: none;
      padding: 8px 16px;
      font-size: 13px;
      font-weight: 700;
      border-radius: 4px;
      cursor: pointer;
    }
    .print-btn:hover { background: #1D4ED8; }
    .close-btn {
      background: #475569;
      color: #FFF;
      border: none;
      padding: 8px 14px;
      font-size: 13px;
      font-weight: 600;
      border-radius: 4px;
      cursor: pointer;
      margin-left: 8px;
    }

    /* Company Header */
    .company-header {
      display: flex;
      align-items: center;
      gap: 12px;
      padding-bottom: 10px;
      border-bottom: 2px solid #00104A;
      margin-bottom: 10px;
    }
    .company-logo {
      width: 64px;
      height: 64px;
      object-fit: contain;
      border-radius: 6px;
      flex-shrink: 0;
    }
    .company-info {
      flex: 1;
    }
    .company-name {
      font-size: 14px;
      font-weight: 900;
      color: #00104A;
      letter-spacing: 0.3px;
      margin: 0 0 2px 0;
    }
    .company-addr {
      font-size: 9px;
      color: #475569;
      line-height: 1.3;
      margin: 0 0 3px 0;
    }
    .company-meta-tags {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      font-size: 9px;
      color: #334155;
    }

    /* Report Banner */
    .report-banner {
      background: #F1F5F9;
      border-left: 4px solid #2563EB;
      padding: 8px 12px;
      border-radius: 4px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }
    .report-title-txt {
      font-size: 14px;
      font-weight: 900;
      color: #0F172A;
      text-transform: uppercase;
      margin: 0;
    }
    .report-category-txt {
      font-size: 9.5px;
      font-weight: 600;
      color: #475569;
      margin-top: 1px;
    }
    .report-meta-right {
      text-align: right;
      font-size: 9px;
      color: #334155;
      line-height: 1.35;
    }

    /* KPI Grid */
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 8px;
      margin-bottom: 14px;
    }
    .kpi-card {
      background: #F8FAFC;
      border: 1px solid #E2E8F0;
      border-left: 3px solid #2563EB;
      border-radius: 4px;
      padding: 8px 10px;
    }
    .kpi-lbl {
      font-size: 8.5px;
      font-weight: 700;
      color: #64748B;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }
    .kpi-val {
      font-size: 12.5px;
      font-weight: 800;
      color: #0F172A;
      margin-top: 2px;
      white-space: nowrap;
    }

    /* Table Auto Adjust */
    table.report-table {
      width: 100%;
      border-collapse: collapse;
      table-layout: auto;
      font-size: 9px;
      margin-bottom: 14px;
    }
    table.report-table th {
      background: #00104A !important;
      color: #FFFFFF !important;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
      padding: 6px 6px;
      font-weight: 700;
      border: 1px solid #00104A;
      white-space: nowrap;
      font-size: 8.5px;
    }
    table.report-table td {
      padding: 5px 6px;
      border: 1px solid #CBD5E1;
      vertical-align: middle;
      word-break: break-word;
    }
    table.report-table tbody tr:nth-child(even) td {
      background: #F8FAFC;
    }
    table.report-table tr.bold-row td {
      font-weight: 800;
      background: #E2E8F0;
      color: #0F172A;
    }
    .cell-numeric {
      text-align: right;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
      font-weight: 600;
    }

    /* Footer */
    .report-footer {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      padding-top: 12px;
      border-top: 1px solid #CBD5E1;
      margin-top: 12px;
    }
    .footer-left {
      font-size: 8.5px;
      color: #64748B;
      line-height: 1.35;
    }
    .signatory-box {
      border: 1px dashed #94A3B8;
      border-radius: 4px;
      padding: 6px 12px;
      text-align: center;
      background: #FAFAFA;
      min-width: 180px;
    }
    .signatory-stamp {
      color: #059669;
      font-weight: 800;
      font-size: 9px;
      margin-bottom: 2px;
    }
    .signatory-title {
      font-size: 10px;
      font-weight: 700;
      color: #0F172A;
    }
    .signatory-desig {
      font-size: 8px;
      color: #475569;
    }
  </style>
</head>
<body>
  <div class="no-print action-bar">
    <div>
      <strong>TRIVENI DSC REPORT PRINT ENGINE</strong> &bull; ${title} (${rows.length} records)
    </div>
    <div>
      <button class="print-btn" onclick="window.print()">Print Report / Save PDF</button>
      <button class="close-btn" onclick="window.close()">Close</button>
    </div>
  </div>

  <div class="print-wrapper">
    <div class="company-header">
      <img src="${logoUrl}" alt="TDSC Logo" class="company-logo" onerror="this.src='/assets/assets/images/company-logo.b43290140700e1432dbc6d9050ee67da.jpg'; this.onerror=null;"/>
      <div class="company-info">
        <h1 class="company-name">TRIVENI DSC AND ETENDER SERVICE PVT. LTD</h1>
        <div class="company-addr">MOH-BHAISHASUR HOSPITAL MORE NEAR EYE CARE HOSPITAL SRI DILCHANDRA MAHTO WARD NO-17 RANCHI ROAD BIHARSHARIF</div>
        <div class="company-meta-tags">
          <span><strong>GSTIN:</strong> 10AAGCT3865R1ZU</span>
          <span><strong>State:</strong> 10-Bihar</span>
          <span><strong>Phone:</strong> 9334344708</span>
          <span><strong>Email:</strong> tdscservice@gmail.com</span>
        </div>
      </div>
    </div>

    <div class="report-banner">
      <div>
        <h2 class="report-title-txt">${title}</h2>
        <div class="report-category-txt">${category} &bull; Official Management Ledger</div>
      </div>
      <div class="report-meta-right">
        <div><strong>Period:</strong> ${dateLabel}</div>
        <div><strong>Printed On:</strong> ${generatedOn}</div>
        <div><strong>Total Entries:</strong> ${rows.length}</div>
      </div>
    </div>

    ${kpiHtml}

    ${obHtml}

    <table class="report-table">
      ${theadHtml}
      ${tbodyHtml}
    </table>

    ${cbHtml}

    <div class="report-footer">
      <div class="footer-left">
        <div><strong>Triveni DSC & E-Tender Management System</strong></div>
        <div>Computer generated financial statement. Page layout automatically adjusted for multi-page export.</div>
        <div>Generated on: ${generatedOn}</div>
      </div>
      <div class="signatory-box">
        <div class="signatory-stamp">&#10004; DIGITALLY VERIFIED</div>
        <div class="signatory-title">अंजू कुमारी</div>
        <div class="signatory-desig">Authorized Signatory<br/>For TRIVENI DSC AND ETENDER SERVICE PVT. LTD</div>
      </div>
    </div>
  </div>

  <script>
    window.onload = function() {
      setTimeout(function() {
        window.print();
      }, 400);
    };
  </script>
</body>
</html>
    `;

    // Zero-Popup-Blocker: Render into a hidden iframe
    try {
      let iframe = document.getElementById('tdsc-report-print-frame') as HTMLIFrameElement;
      if (!iframe) {
        iframe = document.createElement('iframe');
        iframe.id = 'tdsc-report-print-frame';
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
        doc.write(htmlContent);
        doc.close();
        setTimeout(() => {
          try {
            iframe.contentWindow?.focus();
            iframe.contentWindow?.print();
          } catch {
            const printWin = window.open('', '_blank');
            if (printWin) {
              printWin.document.open();
              printWin.document.write(htmlContent);
              printWin.document.close();
              printWin.focus();
            } else {
              window.print();
            }
          }
        }, 400);
        return;
      }
    } catch {
      // Fallback
    }

    const printWin = window.open('', '_blank');
    if (printWin) {
      printWin.document.open();
      printWin.document.write(htmlContent);
      printWin.document.close();
      printWin.focus();
    } else {
      window.print();
    }
  };

  return (
    <View style={styles.root} testID="accounting-reports-hub">
      {/* Top Header */}
      <SafeAreaView edges={['top']} style={styles.headerSafe}>
        <View style={styles.header}>
          <Pressable onPress={() => {
            if (activeReportId) setActiveReportId(null);
            else router.push('/accounting/menu' as any);
          }} style={styles.headerBackBtn} hitSlop={8} testID="rep-back-btn">
            <Ionicons name="arrow-back" size={20} color="#0F172A" />
          </Pressable>

          <View style={{ flex: 1, marginLeft: 8 }}>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {activeReportId && reportData ? reportData.report_title : 'Reports & Financial Statements'}
            </Text>
            <Text style={styles.headerSub} numberOfLines={1}>
              {activeReportId && reportData ? reportData.category : 'TDSC • Accounting & Billing Suite (37 Reports)'}
            </Text>
          </View>

          {activeReportId ? (
            <View style={{ flexDirection: 'row', gap: 6 }}>
              <Pressable onPress={handlePrint} hitSlop={6} style={styles.headerActionBtn}>
                <Ionicons name="print-outline" size={18} color="#0F172A" />
              </Pressable>
              <Pressable onPress={shareReport} hitSlop={6} style={styles.headerActionBtn}>
                <Ionicons name="share-social-outline" size={18} color="#0F172A" />
              </Pressable>
              <Pressable onPress={() => setActiveReportId(null)} hitSlop={6} style={styles.headerActionBtn}>
                <Ionicons name="close" size={18} color="#0F172A" />
              </Pressable>
            </View>
          ) : (
            <Pressable onPress={() => router.push('/accounting' as any)} hitSlop={8} style={styles.headerActionBtn}>
              <Ionicons name="pie-chart-outline" size={18} color="#0F172A" />
            </Pressable>
          )}
        </View>
      </SafeAreaView>

      {/* VIEW: REPORT VIEWER (When a specific report is active) */}
      {activeReportId ? (
        <View style={{ flex: 1, backgroundColor: '#F8FAFC' }}>
          {/* Date Filter Bar */}
          <View style={styles.dateFilterBar}>
            {(['today', 'yesterday', 'month', 'quarter', 'fy', 'all', 'custom'] as const).map(df => (
              <Pressable
                key={df}
                onPress={() => changeDateFilter(df)}
                style={[styles.dateChip, dateFilter === df && styles.dateChipActive]}
              >
                <Text style={[styles.dateChipTxt, dateFilter === df && styles.dateChipTxtActive]}>
                  {df === 'today' ? 'Today' : df === 'yesterday' ? 'Yesterday' : df === 'month' ? 'This Month' : df === 'quarter' ? 'Quarter' : df === 'fy' ? 'FY 2026-27' : df === 'all' ? 'All Time' : 'Custom Date'}
                </Text>
              </Pressable>
            ))}
          </View>

          {/* Custom Date Input Bar with Native Calendar Pickers */}
          {dateFilter === 'custom' && (
            <View style={styles.customDateBar}>
              <View style={{ flex: 1 }}>
                <Text style={styles.customDateLbl}>From Date (Calendar)</Text>
                {Platform.OS === 'web' ? (
                  <input
                    type="date"
                    value={customFromDate}
                    onChange={(e: any) => setCustomFromDate(e.target.value)}
                    style={webDateInputStyle}
                  />
                ) : (
                  <TextInput
                    style={styles.customDateInput}
                    value={customFromDate}
                    onChangeText={setCustomFromDate}
                    placeholder="YYYY-MM-DD"
                  />
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.customDateLbl}>To Date (Calendar)</Text>
                {Platform.OS === 'web' ? (
                  <input
                    type="date"
                    value={customToDate}
                    onChange={(e: any) => setCustomToDate(e.target.value)}
                    style={webDateInputStyle}
                  />
                ) : (
                  <TextInput
                    style={styles.customDateInput}
                    value={customToDate}
                    onChangeText={setCustomToDate}
                    placeholder="YYYY-MM-DD"
                  />
                )}
              </View>
              <Pressable
                onPress={() => {
                  if (activeReportId) openReport(activeReportId, 'custom', customFromDate, customToDate);
                }}
                style={styles.customApplyBtn}
              >
                <Ionicons name="refresh" size={16} color="#FFF" />
                <Text style={styles.customApplyBtnTxt}>Apply Range</Text>
              </Pressable>
            </View>
          )}

          {reportLoading ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator size="large" color={BLUE} />
              <Text style={styles.loadingTxt}>Generating real-time statement & calculating metrics...</Text>
            </View>
          ) : reportData ? (
            <ScrollView contentContainerStyle={{ padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxxl }}>
              {/* Report Header Title Badge */}
              <View style={styles.reportHeroCard}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.heroTitle}>{reportData.report_title}</Text>
                  <Text style={styles.heroSub}>{reportData.category} • Automated Financial Ledger</Text>
                </View>
                <Pressable onPress={() => toggleFav(reportData.report_type)} hitSlop={8} style={styles.heroStarBtn}>
                  <Ionicons name={favs[reportData.report_type] ? 'star' : 'star-outline'} size={22} color={favs[reportData.report_type] ? '#F59E0B' : '#94A3B8'} />
                </Pressable>
              </View>

              {/* Bank Selector Bar (For Bank Report Ledger) */}
              {activeReportId === 'bank_ledger' && reportData?.available_banks && reportData.available_banks.length > 0 && (
                <View style={styles.bankSelectBarCard}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                    <Ionicons name="business" size={16} color="#00104A" />
                    <Text style={styles.bankSelectBarLbl}>Select Bank Account Ledger:</Text>
                  </View>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                    {reportData.available_banks.map((b: any) => {
                      const isSel = (selectedBankId || reportData.selected_bank_id) === b.id;
                      return (
                        <Pressable
                          key={b.id}
                          onPress={() => {
                            setSelectedBankId(b.id);
                            openReport('bank_ledger', dateFilter, customFromDate, customToDate, b.id);
                          }}
                          style={[styles.bankTabChip, isSel && styles.bankTabChipActive]}
                        >
                          <Ionicons name="wallet-outline" size={14} color={isSel ? '#FFF' : '#00104A'} />
                          <Text style={[styles.bankTabChipTxt, isSel && styles.bankTabChipTxtActive]}>
                            {b.name} ({b.account_no && b.account_no !== '—' ? b.account_no : 'A/C'})
                          </Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                </View>
              )}

              {/* KPI Summary Grid */}
              {reportData.kpis && reportData.kpis.length > 0 && (
                <View style={styles.kpiGrid}>
                  {reportData.kpis.map((kpi: any, idx: number) => (
                    <View key={idx} style={[styles.kpiCard, { borderLeftColor: kpi.color || BLUE }]}>
                      <Text style={styles.kpiLbl}>{kpi.label}</Text>
                      <Text style={[styles.kpiVal, { color: kpi.color || '#0F172A' }]}>
                        {kpi.label.toLowerCase().includes('count') ||
                        kpi.label.toLowerCase().includes('entries') ||
                        kpi.label.toLowerCase().includes('margin') ||
                        kpi.label.toLowerCase().includes('percent') ||
                        String(kpi.value).includes('%')
                          ? kpi.value
                          : inr(kpi.value)}
                      </Text>
                    </View>
                  ))}
                </View>
              )}

              {/* In-Table Search Input */}
              <View style={styles.tableSearchRow}>
                <Ionicons name="search" size={16} color="#94A3B8" />
                <TextInput
                  placeholder={`Search ${reportData.rows?.length || 0} records in this report...`}
                  placeholderTextColor="#94A3B8"
                  value={tableSearch}
                  onChangeText={setTableSearch}
                  style={styles.tableSearchInput}
                />
                {tableSearch ? (
                  <Pressable onPress={() => setTableSearch('')}>
                    <Ionicons name="close-circle" size={16} color="#94A3B8" />
                  </Pressable>
                ) : null}
              </View>

              {/* Account Start Date & Fixed Initial Balances Banner */}
              {reportData.initial_balances && reportData.initial_balances.length > 0 && (
                <View style={[styles.obCbCard, { borderLeftColor: '#00104A', borderLeftWidth: 4 }]}>
                  <View style={styles.obCbHeader}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <Ionicons name="calendar-outline" size={16} color="#00104A" />
                      <Text style={[styles.obCbTitle, { color: '#00104A' }]}>
                        Account Started on date: <Text style={{ fontWeight: '900' }}>{reportData.account_start_date || '17-11-2026'}</Text>
                        {'  '}|{'  '}as on date: <Text style={{ color: BLUE, fontWeight: '800' }}>{reportData.as_on_date || reportData.from_date || ''}</Text>
                      </Text>
                    </View>
                    <Text style={styles.obCbBadge}>Rule: Today CB = Tomorrow OB</Text>
                  </View>
                  <View style={{ gap: 6, marginTop: 8 }}>
                    {reportData.initial_balances.map((b: any, idx: number) => (
                      <View key={idx} style={styles.obCbRow}>
                        <Text style={[styles.obCbIdx, { color: '#00104A' }]}>{b.index}</Text>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.obCbName}>
                            {b.account_no && b.account_no !== '—' ? `Account No : ${b.account_no} (${b.bank_name || b.name})` : b.name}
                          </Text>
                        </View>
                        <View style={styles.dottedLeader} />
                        <Text style={styles.obCbVal}>
                          Opening Balance is on {reportData.account_start_date || '17-11-2026'}: <Text style={{ fontWeight: '800', color: '#00104A' }}>{inr(b.initial_balance ?? b.balance)}</Text>
                        </Text>
                      </View>
                    ))}
                  </View>
                </View>
              )}

              {/* Opening Balance (For Day Book & Ledger Statements) */}
              {reportData.opening_balances && reportData.opening_balances.length > 0 && (
                <View style={styles.obCbCard}>
                  <View style={styles.obCbHeader}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Ionicons name="wallet-outline" size={16} color={BLUE} />
                      <Text style={styles.obCbTitle}>Opening Balance</Text>
                    </View>
                    <Text style={styles.obCbBadge}>Initial Balance as of {reportData.from_date || 'Period Start'}</Text>
                  </View>
                  <View style={{ gap: 6, marginTop: 8 }}>
                    {reportData.opening_balances.map((b: any, idx: number) => (
                      <View key={idx} style={styles.obCbRow}>
                        <Text style={styles.obCbIdx}>{b.index}</Text>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.obCbName}>{b.name}</Text>
                          {b.account_no && b.account_no !== '—' && (
                            <Text style={styles.obCbSub}>{b.bank_name} • A/c {b.account_no} • IFSC: {b.ifsc}</Text>
                          )}
                        </View>
                        <View style={styles.dottedLeader} />
                        <Text style={styles.obCbVal}>Current Balance in {inr(b.balance)}</Text>
                      </View>
                    ))}
                    <View style={styles.obCbTotalRow}>
                      <Text style={styles.obCbTotalLabel}>Total OB = (i)+(ii)+(iii)+(iv)+... =</Text>
                      <Text style={[styles.obCbTotalValue, { color: '#059669' }]}>{inr(reportData.total_previous_ob)}</Text>
                    </View>
                  </View>
                </View>
              )}

              {/* Tabular Statement View */}
              <View style={styles.tableCard}>
                <ScrollView horizontal showsHorizontalScrollIndicator={true}>
                  <View>
                    {/* Header Row */}
                    <View style={styles.tHeadRow}>
                      <View style={[styles.tHeadCell, { width: 44 }]}>
                        <Text style={[styles.tHeadTxt, { textAlign: 'center' }]}>#</Text>
                      </View>
                      {reportData.columns?.map((col: any) => {
                        const colW = getColWidth(col.key);
                        const isColAmount = ['taxable', 'tax', 'gst', 'amount', 'amt', 'total', 'paid', 'balance', 'price', 'debit', 'credit', 'rate'].some((k: string) => col.key.toLowerCase().includes(k));
                        return (
                          <View key={col.key} style={[styles.tHeadCell, { width: colW }]}>
                            <Text style={[styles.tHeadTxt, isColAmount && { textAlign: 'right' }]} numberOfLines={1}>{col.label}</Text>
                          </View>
                        );
                      })}
                    </View>

                    {/* Data Rows */}
                    {filteredReportRows.length === 0 ? (
                      <View style={styles.emptyTableBox}>
                        <Ionicons name="file-tray-outline" size={32} color="#CBD5E1" />
                        <Text style={styles.emptyTableTxt}>No matching records found for this period.</Text>
                      </View>
                    ) : (
                      filteredReportRows.map((row: any, rIdx: number) => {
                        const isEven = rIdx % 2 === 0;
                        const isBold = !!row.is_bold;
                        return (
                          <View key={rIdx} style={[styles.tDataRow, isEven && styles.tDataRowAlt, isBold && styles.tDataRowBold]}>
                            <View style={[styles.tDataCell, { width: 44 }]}>
                              <Text style={[styles.tDataTxt, { color: '#94A3B8', fontSize: 11, textAlign: 'center' }]}>{rIdx + 1}</Text>
                            </View>
                            {reportData.columns?.map((col: any) => {
                              const colW = getColWidth(col.key);
                              if (col.key === 'actions') {
                                return (
                                  <View key={col.key} style={[styles.tDataCell, { width: colW, flexDirection: 'row', gap: 6, justifyContent: 'center', alignItems: 'center' }]}>
                                    {row.can_view && (
                                      <Pressable
                                        onPress={() => handleViewVoucher(row)}
                                        hitSlop={6}
                                        style={styles.actionBtnView}
                                        testID={`btn-view-${row.voucher_id || rIdx}`}
                                      >
                                        <Ionicons name="eye" size={13} color="#0284C7" />
                                      </Pressable>
                                    )}
                                    {row.can_edit && (
                                      <Pressable
                                        onPress={() => handleEditVoucher(row)}
                                        hitSlop={6}
                                        style={styles.actionBtnEdit}
                                        testID={`btn-edit-${row.voucher_id || rIdx}`}
                                      >
                                        <Ionicons name="pencil" size={13} color="#D97706" />
                                      </Pressable>
                                    )}
                                    {row.can_delete && (
                                      <Pressable
                                        onPress={() => handleDeleteVoucher(row)}
                                        hitSlop={6}
                                        style={styles.actionBtnDelete}
                                        testID={`btn-delete-${row.voucher_id || rIdx}`}
                                      >
                                        <Ionicons name="trash" size={13} color="#DC2626" />
                                      </Pressable>
                                    )}
                                  </View>
                                );
                              }
                              const val = formatCellValue(col.key, row[col.key]);
                              const isAmount = String(val).startsWith('₹') || String(val).startsWith('-₹');
                              const isAlert = String(val).includes('LOW') || String(val).includes('OVERDUE') || String(val).includes('Unpaid');
                              return (
                                <View key={col.key} style={[styles.tDataCell, { width: colW }]}>
                                  <Text
                                    numberOfLines={2}
                                    style={[
                                      styles.tDataTxt,
                                      isBold && { fontWeight: '800', color: '#0F172A' },
                                      isAmount && { fontWeight: '700', color: '#0F172A', textAlign: 'right' },
                                      isAlert && { color: '#DC2626', fontWeight: '800' }
                                    ]}
                                  >
                                    {val}
                                  </Text>
                                </View>
                              );
                            })}
                          </View>
                        );
                      })
                    )}
                  </View>
                </ScrollView>
              </View>

              {/* Closing Balance (For Day Book & Ledger Statements) */}
              {reportData.closing_balances && reportData.closing_balances.length > 0 && (
                <View style={styles.obCbCard}>
                  <View style={styles.obCbHeader}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Ionicons name="lock-closed-outline" size={16} color="#059669" />
                      <Text style={styles.obCbTitle}>Closing Balance</Text>
                    </View>
                    <Text style={styles.obCbBadge}>Reconciled Balance as of {reportData.to_date || 'Period End'}</Text>
                  </View>
                  <View style={{ gap: 6, marginTop: 8 }}>
                    {reportData.closing_balances.map((b: any, idx: number) => {
                      const isExp = b.id?.startsWith('exp_');
                      return (
                        <View key={idx} style={styles.obCbRow}>
                          <Text style={styles.obCbIdx}>{b.index}</Text>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.obCbName}>{b.name}</Text>
                            {b.account_no && b.account_no !== '—' && (
                              <Text style={styles.obCbSub}>{b.bank_name} • A/c {b.account_no} • IFSC: {b.ifsc}</Text>
                            )}
                          </View>
                          <View style={styles.dottedLeader} />
                          <Text style={[styles.obCbVal, isExp && { color: '#DC2626' }]}>
                            {isExp ? `Total: ${inr(b.balance)}` : `Current Balance in ${inr(b.balance)}`}
                          </Text>
                        </View>
                      );
                    })}
                    <View style={styles.obCbTotalRow}>
                      <Text style={styles.obCbTotalLabel}>Total CB = (i)+(ii)+(iii)+(iv)+(v)+(vi) =</Text>
                      <Text style={[styles.obCbTotalValue, { color: '#00104A' }]}>{inr(reportData.total_closing_balance)}</Text>
                    </View>
                  </View>

                  {/* Reconciliation Banner */}
                  <View style={[
                    styles.recBanner,
                    reportData.is_balanced !== false ? styles.recBannerOk : styles.recBannerErr
                  ]}>
                    <Ionicons
                      name={reportData.is_balanced !== false ? "checkmark-circle" : "alert-circle"}
                      size={18}
                      color={reportData.is_balanced !== false ? "#059669" : "#DC2626"}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={[
                        styles.recBannerTitle,
                        { color: reportData.is_balanced !== false ? "#065F46" : "#DC2626" }
                      ]}>
                        {reportData.is_balanced !== false ? "Account is ok." : "Account Mismatch"}
                      </Text>
                      <Text style={[
                        styles.recBannerSub,
                        { color: reportData.is_balanced !== false ? "#047857" : "#B91C1C" }
                      ]}>
                        {reportData.is_balanced !== false
                          ? "Total O.B matches Total C.B perfectly."
                          : `Difference: ${inr(reportData.difference || 0)}`}
                      </Text>
                    </View>
                  </View>
                </View>
              )}

              {/* Action Toolbar */}
              <View style={styles.reportActionsRow}>
                <Pressable onPress={shareReport} style={[styles.btnAction, { backgroundColor: '#059669' }]}>
                  <Ionicons name="logo-whatsapp" size={16} color="#FFF" />
                  <Text style={styles.btnActionTxt}>WhatsApp Summary</Text>
                </Pressable>
                <Pressable onPress={handlePrint} style={[styles.btnAction, { backgroundColor: BLUE }]}>
                  <Ionicons name="print" size={16} color="#FFF" />
                  <Text style={styles.btnActionTxt}>Print / Export PDF</Text>
                </Pressable>
              </View>
            </ScrollView>
          ) : (
            <View style={[styles.loadingBox, { padding: 32 }]}>
              <Ionicons name="alert-circle-outline" size={48} color="#DC2626" />
              <Text style={{ color: '#0F172A', fontWeight: '800', fontSize: 16, marginTop: 12 }}>Unable to load report</Text>
              <Text style={{ color: '#64748B', fontSize: 13, textAlign: 'center', marginTop: 4, maxWidth: 360 }}>
                {reportError || 'Could not fetch statement data from server. Please check connection and retry.'}
              </Text>
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
                <Pressable
                  onPress={() => activeReportId && openReport(activeReportId)}
                  style={[styles.btnAction, { backgroundColor: BLUE, paddingHorizontal: 16 }]}
                >
                  <Ionicons name="refresh" size={16} color="#FFF" />
                  <Text style={styles.btnActionTxt}>Retry / Reload</Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    setActiveReportId(null);
                    setReportError(null);
                  }}
                  style={[styles.btnAction, { backgroundColor: '#F1F5F9', borderWidth: 1, borderColor: '#CBD5E1', paddingHorizontal: 16 }]}
                >
                  <Ionicons name="arrow-back" size={16} color="#0F172A" />
                  <Text style={[styles.btnActionTxt, { color: '#0F172A' }]}>All Reports</Text>
                </Pressable>
              </View>
            </View>
          )}
        </View>
      ) : (
        /* VIEW: MASTER REPORTS HUB (Catalog of 9 Categories & 37 Reports) */
        <ScrollView contentContainerStyle={{ paddingBottom: spacing.xxxl }}>
          {/* Quick Search Bar */}
          <View style={styles.searchBarWrapper}>
            <View style={styles.searchBar}>
              <Ionicons name="search" size={18} color="#64748B" />
              <TextInput
                placeholder="Search across all 37 financial reports..."
                placeholderTextColor="#94A3B8"
                value={searchQuery}
                onChangeText={setSearchQuery}
                style={styles.searchInput}
              />
              {searchQuery ? (
                <Pressable onPress={() => setSearchQuery('')}>
                  <Ionicons name="close-circle" size={18} color="#94A3B8" />
                </Pressable>
              ) : null}
            </View>
          </View>

          {/* High-Level Overview Metrics Banner */}
          {summary && (
            <View style={styles.summaryBanner}>
              <View style={styles.sumMetric}>
                <Text style={styles.sumMetricLbl}>Gross Turnover</Text>
                <Text style={[styles.sumMetricVal, { color: '#059669' }]}>{inr(summary.total_sales)}</Text>
              </View>
              <View style={styles.sumDivider} />
              <View style={styles.sumMetric}>
                <Text style={styles.sumMetricLbl}>Gross Profit</Text>
                <Text style={[styles.sumMetricVal, { color: '#2563EB' }]}>{inr(summary.gross_profit)}</Text>
              </View>
              <View style={styles.sumDivider} />
              <View style={styles.sumMetric}>
                <Text style={styles.sumMetricLbl}>Bank Liquidity</Text>
                <Text style={[styles.sumMetricVal, { color: '#7C3AED' }]}>{inr(summary.total_bank_balance)}</Text>
              </View>
              <View style={styles.sumDivider} />
              <View style={styles.sumMetric}>
                <Text style={styles.sumMetricLbl}>Receivables</Text>
                <Text style={[styles.sumMetricVal, { color: '#DC2626' }]}>{inr(summary.total_receivables)}</Text>
              </View>
            </View>
          )}

          {/* Category Filter Chips */}
          <View style={styles.catChipsScroll}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: spacing.md, gap: 6 }}>
              <Pressable
                onPress={() => setSelectedCatId('all')}
                style={[styles.catChip, selectedCatId === 'all' && styles.catChipActive]}
              >
                <Text style={[styles.catChipTxt, selectedCatId === 'all' && styles.catChipTxtActive]}>All Reports (37)</Text>
              </Pressable>
              {categories.map(cat => (
                <Pressable
                  key={cat.id}
                  onPress={() => setSelectedCatId(cat.id)}
                  style={[styles.catChip, selectedCatId === cat.id && styles.catChipActive]}
                >
                  <Text style={[styles.catChipTxt, selectedCatId === cat.id && styles.catChipTxtActive]}>
                    {cat.title} ({cat.reports.length})
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>

          {/* 9 Report Categories with Accordion Collapse */}
          {loading ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator size="large" color={BLUE} />
              <Text style={styles.loadingTxt}>Loading financial reports directory...</Text>
            </View>
          ) : (
            <View style={{ paddingHorizontal: spacing.md, gap: spacing.md, marginTop: spacing.md }}>
              {filteredCategories.map(cat => {
                const isOpen = openCats[cat.id] ?? true;
                return (
                  <View key={cat.id} style={styles.categoryCard}>
                    <Pressable
                      onPress={() => toggleCategory(cat.id)}
                      style={styles.categoryHeader}
                      testID={`cat-hdr-${cat.id}`}
                    >
                      <View style={[styles.catIconBox, { backgroundColor: cat.color + '15' }]}>
                        <Ionicons name={cat.icon as any} size={20} color={cat.color} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.categoryTitle}>{cat.title}</Text>
                        <Text style={styles.categorySub}>{cat.reports.length} Sub-Reports Available</Text>
                      </View>
                      <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={18} color="#94A3B8" />
                    </Pressable>

                    {isOpen && (
                      <View style={styles.reportsList}>
                        {cat.reports.map((rep, rIdx) => {
                          const isFav = !!favs[rep.id];
                          return (
                            <Pressable
                              key={rep.id}
                              onPress={() => openReport(rep.id)}
                              style={[styles.reportRow, rIdx > 0 && styles.reportRowBorder]}
                              testID={`report-item-${rep.id}`}
                            >
                              <View style={[styles.repIconBox, { backgroundColor: cat.color + '12' }]}>
                                <Ionicons name={rep.icon as any} size={18} color={cat.color} />
                              </View>
                              <View style={{ flex: 1 }}>
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                                  <Text style={styles.repName}>{rep.name}</Text>
                                  {isFav ? <Ionicons name="star" size={13} color="#F59E0B" /> : null}
                                </View>
                                <Text style={styles.repDesc} numberOfLines={2}>{rep.description}</Text>
                              </View>
                              <Pressable
                                onPress={(e) => {
                                  e.stopPropagation?.();
                                  toggleFav(rep.id);
                                }}
                                hitSlop={8}
                                style={{ padding: 6 }}
                              >
                                <Ionicons name={isFav ? 'star' : 'star-outline'} size={18} color={isFav ? '#F59E0B' : '#CBD5E1'} />
                              </Pressable>
                              <Ionicons name="chevron-forward" size={16} color="#CBD5E1" />
                            </Pressable>
                          );
                        })}
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          )}
        </ScrollView>
      )}

      {/* VIEW CONTRA DETAILS MODAL */}
      <Modal visible={!!viewingContra} transparent animationType="fade" onRequestClose={() => setViewingContra(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="document-text" size={20} color="#00104A" />
                <Text style={styles.modalTitle}>Contra Voucher Details</Text>
              </View>
              <Pressable onPress={() => setViewingContra(null)} style={styles.modalCloseBtn}>
                <Ionicons name="close" size={20} color="#64748B" />
              </Pressable>
            </View>
            <View style={styles.modalBody}>
              <View style={styles.contraDetailRow}>
                <Text style={styles.contraDetailLbl}>Voucher / Tx Ref:</Text>
                <Text style={styles.contraDetailVal}>{viewingContra?.voucher_no || viewingContra?.voucher_id || '—'}</Text>
              </View>
              <View style={styles.contraDetailRow}>
                <Text style={styles.contraDetailLbl}>Date:</Text>
                <Text style={styles.contraDetailVal}>{viewingContra?.date || '—'}</Text>
              </View>
              <View style={styles.contraDetailRow}>
                <Text style={styles.contraDetailLbl}>Transaction Type:</Text>
                <Text style={[styles.contraDetailVal, { color: '#00104A', fontWeight: '800' }]}>{viewingContra?.trans_type || 'Contra'}</Text>
              </View>
              <View style={styles.contraDetailRow}>
                <Text style={styles.contraDetailLbl}>Particulars / Description:</Text>
                <Text style={styles.contraDetailVal}>{viewingContra?.particulars || '—'}</Text>
              </View>
              <View style={styles.contraDetailRow}>
                <Text style={styles.contraDetailLbl}>Amount:</Text>
                <Text style={[styles.contraDetailVal, { fontSize: 16, fontWeight: '900', color: '#059669' }]}>
                  {inr(viewingContra?.receipt_raw || viewingContra?.payment_raw || 0)}
                </Text>
              </View>
            </View>
            <View style={styles.modalFooter}>
              <Pressable onPress={() => setViewingContra(null)} style={styles.modalCancelBtn}>
                <Text style={styles.modalCancelBtnTxt}>Close</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* EDIT CONTRA MODAL */}
      <Modal visible={!!editingContraModal} transparent animationType="fade" onRequestClose={() => setEditingContraModal(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="pencil" size={20} color="#2563EB" />
                <Text style={styles.modalTitle}>Edit Contra Transaction</Text>
              </View>
              <Pressable onPress={() => setEditingContraModal(null)} style={styles.modalCloseBtn}>
                <Ionicons name="close" size={20} color="#64748B" />
              </Pressable>
            </View>
            <View style={styles.modalBody}>
              <View style={styles.modalField}>
                <Text style={styles.modalLabel}>Date (YYYY-MM-DD):</Text>
                <TextInput
                  style={styles.modalInput}
                  value={contraForm.date}
                  onChangeText={(t) => setContraForm(prev => ({ ...prev, date: t }))}
                  placeholder="YYYY-MM-DD"
                />
              </View>
              <View style={styles.modalField}>
                <Text style={styles.modalLabel}>Amount (₹):</Text>
                <TextInput
                  style={styles.modalInput}
                  value={contraForm.amount}
                  onChangeText={(t) => setContraForm(prev => ({ ...prev, amount: t }))}
                  keyboardType="numeric"
                  placeholder="0.00"
                />
              </View>
              <View style={styles.modalField}>
                <Text style={styles.modalLabel}>Particulars / Note:</Text>
                <TextInput
                  style={[styles.modalInput, { minHeight: 60 }]}
                  value={contraForm.particulars}
                  onChangeText={(t) => setContraForm(prev => ({ ...prev, particulars: t }))}
                  multiline
                  placeholder="Narration / reason"
                />
              </View>
            </View>
            <View style={styles.modalFooter}>
              <Pressable onPress={() => setEditingContraModal(null)} style={styles.modalCancelBtn} disabled={savingContra}>
                <Text style={styles.modalCancelBtnTxt}>Cancel</Text>
              </Pressable>
              <Pressable onPress={handleSaveContraEdit} style={styles.modalSaveBtn} disabled={savingContra}>
                {savingContra ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <Text style={styles.modalSaveBtnTxt}>Save Changes</Text>
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
  root: { flex: 1, backgroundColor: '#F1F5F9' },
  headerSafe: { backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: '#E2E8F0' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: 10 },
  headerBackBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#F1F5F9', borderWidth: 1, borderColor: '#CBD5E1', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: '#0F172A', fontSize: font.base, fontWeight: '900' },
  headerSub: { color: '#64748B', fontSize: 11, fontWeight: '600', marginTop: 1 },
  headerActionBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E2E8F0', alignItems: 'center', justifyContent: 'center' },

  searchBarWrapper: { paddingHorizontal: spacing.md, paddingTop: spacing.md },
  searchBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF', borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: '#E2E8F0', gap: 8, ...shadow.card },
  searchInput: { flex: 1, fontSize: font.sm, color: '#0F172A', padding: 0 },

  summaryBanner: { flexDirection: 'row', backgroundColor: '#FFF', marginHorizontal: spacing.md, marginTop: spacing.sm, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: '#E2E8F0', ...shadow.card },
  sumMetric: { flex: 1, alignItems: 'center' },
  sumMetricLbl: { fontSize: 9, fontWeight: '800', color: '#64748B', textTransform: 'uppercase' },
  sumMetricVal: { fontSize: 12, fontWeight: '900', marginTop: 3 },
  sumDivider: { width: 1, backgroundColor: '#E2E8F0', marginVertical: 2 },

  catChipsScroll: { marginTop: spacing.sm },
  catChip: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: '#FFF', borderWidth: 1, borderColor: '#CBD5E1' },
  catChipActive: { backgroundColor: BLUE, borderColor: BLUE },
  catChipTxt: { fontSize: 11, fontWeight: '700', color: '#475569' },
  catChipTxtActive: { color: '#FFF' },

  categoryCard: { backgroundColor: '#FFF', borderRadius: radius.md, borderWidth: 1, borderColor: '#E2E8F0', overflow: 'hidden', ...shadow.card },
  categoryHeader: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, backgroundColor: '#F8FAFC', gap: 10 },
  catIconBox: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  categoryTitle: { fontSize: font.sm, fontWeight: '900', color: '#0F172A' },
  categorySub: { fontSize: 10, color: '#64748B', marginTop: 1 },

  reportsList: { backgroundColor: '#FFF' },
  reportRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: 11, gap: 10 },
  reportRowBorder: { borderTopWidth: 1, borderTopColor: '#F1F5F9' },
  repIconBox: { width: 34, height: 34, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  repName: { fontSize: font.sm, fontWeight: '800', color: '#1E293B' },
  repDesc: { fontSize: 10, color: '#64748B', marginTop: 2, lineHeight: 14 },

  dateFilterBar: { flexDirection: 'row', backgroundColor: '#FFF', paddingHorizontal: spacing.md, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#E2E8F0', gap: 6 },
  dateChip: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: radius.pill, backgroundColor: '#F1F5F9' },
  dateChipActive: { backgroundColor: BLUE },
  dateChipTxt: { fontSize: 11, fontWeight: '700', color: '#64748B' },
  dateChipTxtActive: { color: '#FFF' },

  reportHeroCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF', borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: '#E2E8F0', ...shadow.card },
  heroTitle: { fontSize: font.lg, fontWeight: '900', color: '#0F172A' },
  heroSub: { fontSize: 11, color: '#64748B', marginTop: 2 },
  heroStarBtn: { padding: 4 },

  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 4 },
  kpiCard: { flex: 1, minWidth: '47%', backgroundColor: '#FFF', borderRadius: radius.md, padding: 14, borderWidth: 1, borderColor: '#E2E8F0', borderLeftWidth: 4, overflow: 'visible', ...shadow.card },
  kpiLbl: { fontSize: 10, fontWeight: '800', color: '#64748B', textTransform: 'uppercase', letterSpacing: 0.4 },
  kpiVal: { fontSize: font.lg, fontWeight: '900', marginTop: 4, lineHeight: 26, paddingTop: 2 },

  tableSearchRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF', borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: '#E2E8F0', gap: 8 },
  tableSearchInput: { flex: 1, fontSize: font.sm, color: '#0F172A', padding: 0 },

  tableCard: { backgroundColor: '#FFF', borderRadius: radius.md, borderWidth: 1, borderColor: '#CBD5E1', overflow: 'hidden', ...shadow.card },
  tHeadRow: { flexDirection: 'row', backgroundColor: '#00104A', borderBottomWidth: 1, borderBottomColor: '#00104A' },
  tHeadCell: { paddingHorizontal: 8, paddingVertical: 10, justifyContent: 'center' },
  tHeadTxt: { fontSize: 10.5, fontWeight: '800', color: '#FFFFFF', textTransform: 'uppercase', letterSpacing: 0.3 },
  tDataRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#E2E8F0' },
  tDataRowAlt: { backgroundColor: '#F8FAFC' },
  tDataRowBold: { backgroundColor: '#EFF6FF', borderTopWidth: 1, borderTopColor: '#BFDBFE', borderBottomWidth: 1, borderBottomColor: '#BFDBFE' },
  tDataCell: { paddingHorizontal: 8, paddingVertical: 9, justifyContent: 'center' },
  tDataTxt: { fontSize: 11, color: '#1E293B' },

  emptyTableBox: { padding: 32, alignItems: 'center', justifyContent: 'center', gap: 8 },
  emptyTableTxt: { fontSize: font.sm, color: '#94A3B8', fontWeight: '600' },

  reportActionsRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  btnAction: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 12, borderRadius: radius.md, gap: 6, ...shadow.card },
  btnActionTxt: { color: '#FFF', fontWeight: '800', fontSize: font.sm },

  loadingBox: { padding: 48, alignItems: 'center', justifyContent: 'center', gap: 10 },
  loadingTxt: { color: '#64748B', fontSize: font.sm, fontWeight: '600' },

  customDateBar: { flexDirection: 'row', backgroundColor: '#FFF', paddingHorizontal: spacing.md, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#E2E8F0', alignItems: 'flex-end', gap: 8 },
  customDateLbl: { fontSize: 10, fontWeight: '700', color: '#64748B', marginBottom: 2 },
  customDateInput: { borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 6, fontSize: 13, backgroundColor: '#FFF' },
  customApplyBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: BLUE, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 6, height: 34 },
  customApplyBtnTxt: { fontSize: 12, fontWeight: '700', color: '#FFF' },

  obCbCard: { backgroundColor: '#FFF', borderRadius: radius.md, borderWidth: 1, borderColor: '#CBD5E1', padding: spacing.md, ...shadow.card },
  obCbHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#E2E8F0', paddingBottom: 8 },
  obCbTitle: { fontSize: 14, fontWeight: '800', color: '#0F172A' },
  obCbBadge: { fontSize: 11, fontWeight: '600', color: '#64748B', backgroundColor: '#F1F5F9', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 },
  obCbRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6, paddingVertical: 3 },
  obCbIdx: { width: 28, fontSize: 12, fontWeight: '700', color: '#475569' },
  obCbName: { fontSize: 12, fontWeight: '700', color: '#1E293B' },
  obCbSub: { fontSize: 10, color: '#64748B', marginTop: 1 },
  dottedLeader: { flex: 1, height: 1, borderBottomWidth: 1, borderBottomColor: '#CBD5E1', borderStyle: 'dotted', marginHorizontal: 6 },
  obCbVal: { fontSize: 12, fontWeight: '700', color: '#0F172A' },
  obCbTotalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderTopColor: '#CBD5E1', paddingTop: 8, marginTop: 4 },
  obCbTotalLabel: { fontSize: 12, fontWeight: '800', color: '#1E293B' },
  obCbTotalValue: { fontSize: 15, fontWeight: '900' },

  recBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: 6, borderWidth: 1, marginTop: 10 },
  recBannerOk: { backgroundColor: '#ECFDF5', borderColor: '#A7F3D0' },
  recBannerErr: { backgroundColor: '#FEF2F2', borderColor: '#FECACA' },
  recBannerTitle: { fontSize: 13, fontWeight: '800' },
  recBannerSub: { fontSize: 11, marginTop: 1 },

  /* Bank Selector in Bank Report Ledger */
  bankSelectBarCard: { backgroundColor: '#FFFFFF', borderRadius: radius.md, borderWidth: 1, borderColor: '#CBD5E1', padding: 12, ...shadow.card },
  bankSelectBarLbl: { fontSize: 11.5, fontWeight: '800', color: '#00104A' },
  bankTabChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, backgroundColor: '#F1F5F9', borderWidth: 1, borderColor: '#CBD5E1' },
  bankTabChipActive: { backgroundColor: '#00104A', borderColor: '#00104A' },
  bankTabChipTxt: { fontSize: 11.5, fontWeight: '700', color: '#00104A' },
  bankTabChipTxtActive: { color: '#FFFFFF' },

  /* Action Buttons in Ledger Table */
  actionBtnView: { width: 26, height: 26, borderRadius: 5, backgroundColor: '#E0F2FE', alignItems: 'center', justifyContent: 'center' },
  actionBtnEdit: { width: 26, height: 26, borderRadius: 5, backgroundColor: '#FEF3C7', alignItems: 'center', justifyContent: 'center' },
  actionBtnDelete: { width: 26, height: 26, borderRadius: 5, backgroundColor: '#FEE2E2', alignItems: 'center', justifyContent: 'center' },

  /* Modals */
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 16 },
  modalContainer: { width: '100%', maxWidth: 440, backgroundColor: '#FFFFFF', borderRadius: 12, borderWidth: 1, borderColor: '#CBD5E1', overflow: 'hidden', ...shadow.card },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#E2E8F0', backgroundColor: '#F8FAFC' },
  modalTitle: { fontSize: 14, fontWeight: '800', color: '#0F172A' },
  modalCloseBtn: { padding: 4 },
  modalBody: { padding: 16, gap: 12 },
  contraDetailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  contraDetailLbl: { fontSize: 12, fontWeight: '600', color: '#64748B' },
  contraDetailVal: { fontSize: 12, fontWeight: '700', color: '#1E293B', maxWidth: '60%', textAlign: 'right' },
  modalField: { gap: 4 },
  modalLabel: { fontSize: 12, fontWeight: '700', color: '#334155' },
  modalInput: { borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 8, fontSize: 13, backgroundColor: '#FFFFFF', color: '#0F172A' },
  modalFooter: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: '#E2E8F0', backgroundColor: '#F8FAFC' },
  modalCancelBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 6, borderWidth: 1, borderColor: '#CBD5E1', backgroundColor: '#FFFFFF' },
  modalCancelBtnTxt: { fontSize: 12, fontWeight: '700', color: '#475569' },
  modalSaveBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 6, backgroundColor: BLUE, minWidth: 100, alignItems: 'center', justifyContent: 'center' },
  modalSaveBtnTxt: { fontSize: 12, fontWeight: '700', color: '#FFFFFF' },
});
