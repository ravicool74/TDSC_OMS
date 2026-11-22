import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Alert, FlatList, Share } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as SecureStore from 'expo-secure-store';
import { colors, spacing, radius, font, shadow } from '@/src/theme';
import { api } from '@/src/api';

const HEADER_BG = '#FFFFFF';
const HEADER_FG = '#0F172A';
const NAVY = '#00104A';
const BLUE = '#2563EB';
const inr = (n: any) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

type Row = { icon: any; iconColor: string; iconBg: string; label: string; route: string; params?: any };
type Section = { title: string; rows: Row[]; defaultOpen?: boolean };

const BUSINESS: Section[] = [
  {
    title: 'SALE',
    defaultOpen: true,
    rows: [
      { icon: 'receipt', iconColor: '#059669', iconBg: '#DCFCE7', label: 'Sale Invoice', route: '/accounting/invoices/new' },
      { icon: 'list', iconColor: '#059669', iconBg: '#DCFCE7', label: 'All Sale Invoices', route: '/accounting/invoices' },
      { icon: 'arrow-down-circle', iconColor: '#2075FF', iconBg: '#DBEAFE', label: 'Payment-In', route: '/accounting/income/new' },
      { icon: 'list', iconColor: '#2075FF', iconBg: '#DBEAFE', label: 'All Payments-In', route: '/accounting/income' },
      { icon: 'return-down-back', iconColor: '#DC2626', iconBg: '#FEE2E2', label: 'Sale Return / Credit Note', route: '/accounting/invoices/new', params: { type: 'sale_return' } },
      { icon: 'list', iconColor: '#DC2626', iconBg: '#FEE2E2', label: 'All Sale Return / Credit Notes', route: '/accounting/invoices', params: { type: 'sale_return' } },
      { icon: 'clipboard', iconColor: '#7C3AED', iconBg: '#EDE9FE', label: 'Estimate / Quotation', route: '/accounting/estimates' },
      { icon: 'document-text', iconColor: '#F59E0B', iconBg: '#FEF3C7', label: 'Proforma Invoice', route: '/accounting/proforma' },
      { icon: 'cart', iconColor: '#0891B2', iconBg: '#CFFAFE', label: 'Sale Order', route: '/accounting/estimates', params: { type: 'order' } },
      { icon: 'car', iconColor: '#DB2777', iconBg: '#FCE7F3', label: 'Delivery Challan', route: '/accounting/delivery-challans' },
      { icon: 'phone-portrait', iconColor: '#059669', iconBg: '#DCFCE7', label: 'Mobile POS', route: '/accounting/invoices/new', params: { pos: '1' } },
    ],
  },
  {
    title: 'PURCHASE',
    rows: [
      { icon: 'file-tray-full', iconColor: '#DC2626', iconBg: '#FEE2E2', label: 'Purchase Bills', route: '/accounting/invoices/new', params: { type: 'purchase' } },
      { icon: 'list', iconColor: '#DC2626', iconBg: '#FEE2E2', label: 'All Purchase Bills', route: '/accounting/invoices', params: { type: 'purchase' } },
      { icon: 'arrow-up-circle', iconColor: '#F59E0B', iconBg: '#FEF3C7', label: 'Payment-Out', route: '/accounting/expenses/new' },
      { icon: 'list', iconColor: '#F59E0B', iconBg: '#FEF3C7', label: 'All Payments-Out', route: '/accounting/expenses' },
      { icon: 'return-up-forward', iconColor: '#2075FF', iconBg: '#DBEAFE', label: 'Purchase Return / Debit Note', route: '/accounting/invoices/new', params: { type: 'purchase_return' } },
      { icon: 'cart', iconColor: '#7C3AED', iconBg: '#EDE9FE', label: 'Purchase Order', route: '/accounting/proforma', params: { type: 'purchase_order' } },
    ],
  },
  {
    title: 'EXPENSE',
    rows: [
      { icon: 'wallet', iconColor: '#DC2626', iconBg: '#FEE2E2', label: 'Add Expense', route: '/accounting/expenses/new' },
      { icon: 'add-circle', iconColor: '#059669', iconBg: '#DCFCE7', label: 'New Expense Approval', route: '/accounting/expenses/approval/new' },
      { icon: 'checkmark-done-circle', iconColor: '#7C3AED', iconBg: '#EDE9FE', label: 'Expense Approval', route: '/accounting/expenses/approval' },
      { icon: 'grid', iconColor: '#F59E0B', iconBg: '#FEF3C7', label: 'Categories & Items', route: '/accounting/items' },
      { icon: 'list', iconColor: '#2075FF', iconBg: '#DBEAFE', label: 'All Expenses', route: '/accounting/expenses' },
    ],
  },
  {
    title: 'CASH & BANK',
    defaultOpen: true,
    rows: [
      { icon: 'business', iconColor: '#2563EB', iconBg: '#DBEAFE', label: 'Bank Accounts', route: '/accounting/cash-bank', params: { tab: 'banks' } },
      { icon: 'cash', iconColor: '#059669', iconBg: '#DCFCE7', label: 'Cash in Hand', route: '/accounting/cash-bank', params: { tab: 'cash' } },
      { icon: 'newspaper', iconColor: '#7C3AED', iconBg: '#EDE9FE', label: 'Cheques', route: '/accounting/cash-bank', params: { tab: 'cheques' } },
      { icon: 'wallet', iconColor: '#EA580C', iconBg: '#FFEDD5', label: 'Loan Accounts', route: '/accounting/cash-bank', params: { tab: 'loans' } },
    ],
  },
  {
    title: 'OLD ACCOUNTING AND BILLING SECTION',
    defaultOpen: true,
    rows: [
      { icon: 'receipt', iconColor: '#7C3AED', iconBg: '#EDE9FE', label: 'Old Sales Invoices entry', route: '/accounting/invoices/new', params: { type: 'sale', accounting: 'old' } },
      { icon: 'list', iconColor: '#7C3AED', iconBg: '#EDE9FE', label: 'All Old Sale Invoices', route: '/accounting/invoices', params: { type: 'sale', accounting: 'old' } },
      { icon: 'arrow-down-circle', iconColor: '#2563EB', iconBg: '#DBEAFE', label: 'Old Payment-In entry', route: '/accounting/income/new', params: { accounting: 'old' } },
      { icon: 'list', iconColor: '#2563EB', iconBg: '#DBEAFE', label: 'All Old Payment-In Invoices', route: '/accounting/income', params: { accounting: 'old' } },
      { icon: 'wallet', iconColor: '#EA580C', iconBg: '#FFEDD5', label: 'Add Old Expences entry', route: '/accounting/expenses/new', params: { accounting: 'old' } },
      { icon: 'checkmark-done-circle', iconColor: '#059669', iconBg: '#DCFCE7', label: 'Old Expences approval', route: '/accounting/expenses/approval', params: { accounting: 'old' } },
      { icon: 'list', iconColor: '#EA580C', iconBg: '#FFEDD5', label: 'All Old Expences', route: '/accounting/expenses', params: { accounting: 'old' } },
    ],
  },
];

// Reports with star support via async-storage (favourites) - All 9 Categories & 37 Sub-Reports
const REPORT_SECTIONS: Section[] = [
  {
    title: '1. CORE FINANCIAL REPORTS',
    defaultOpen: true,
    rows: [
      { icon: 'journal', iconColor: '#00104A', iconBg: '#E0E7FF', label: 'Consolidated Bank Book', route: '/accounting/reports', params: { report: 'consolidated_bank_book' } },
      { icon: 'business', iconColor: '#1E40AF', iconBg: '#DBEAFE', label: 'Bank Report Ledger', route: '/accounting/reports', params: { report: 'bank_ledger' } },
      { icon: 'trending-up', iconColor: '#059669', iconBg: '#DCFCE7', label: 'Sale Report', route: '/accounting/reports', params: { report: 'sale_report' } },
      { icon: 'trending-down', iconColor: '#DC2626', iconBg: '#FEE2E2', label: 'Purchase Report', route: '/accounting/reports', params: { report: 'purchase_report' } },
      { icon: 'book', iconColor: '#2075FF', iconBg: '#DBEAFE', label: 'Day Book (Cash / Bank)', route: '/accounting/reports', params: { report: 'day_book' } },
      { icon: 'reader', iconColor: '#7C3AED', iconBg: '#EDE9FE', label: 'All Transactions', route: '/accounting/reports', params: { report: 'all_transactions' } },
      { icon: 'analytics', iconColor: '#0891B2', iconBg: '#CFFAFE', label: 'Bill Wise Profit', route: '/accounting/reports', params: { report: 'bill_profit' } },
      { icon: 'stats-chart', iconColor: '#059669', iconBg: '#DCFCE7', label: 'Profit & Loss', route: '/accounting/reports', params: { report: 'pnl' } },
      { icon: 'time', iconColor: '#F59E0B', iconBg: '#FEF3C7', label: 'Sale Aging Report', route: '/accounting/reports', params: { report: 'sale_aging' } },
      { icon: 'hourglass', iconColor: '#DB2777', iconBg: '#FCE7F3', label: 'Purchase Aging Report', route: '/accounting/reports', params: { report: 'purchase_aging' } },
      { icon: 'water', iconColor: '#0891B2', iconBg: '#CFFAFE', label: 'Cashflow', route: '/accounting/reports', params: { report: 'cashflow' } },
      { icon: 'grid', iconColor: '#7C3AED', iconBg: '#EDE9FE', label: 'Balance Sheet', route: '/accounting/reports', params: { report: 'balance_sheet' } },
    ],
  },
  {
    title: '2. PARTY REPORTS',
    rows: [
      { icon: 'people', iconColor: '#2075FF', iconBg: '#DBEAFE', label: 'Party Statement', route: '/accounting/reports', params: { report: 'party_statement' } },
      { icon: 'pie-chart', iconColor: '#7C3AED', iconBg: '#EDE9FE', label: 'Party wise profit & Loss', route: '/accounting/reports', params: { report: 'party_pnl' } },
      { icon: 'list', iconColor: '#059669', iconBg: '#DCFCE7', label: 'All Parties Report', route: '/accounting/reports', params: { report: 'all_parties' } },
      { icon: 'cube', iconColor: '#F59E0B', iconBg: '#FEF3C7', label: 'Party Report by Items', route: '/accounting/reports', params: { report: 'party_items' } },
      { icon: 'swap-horizontal', iconColor: '#DB2777', iconBg: '#FCE7F3', label: 'Sale/Purchase by Party', route: '/accounting/reports', params: { report: 'sale_purchase_party' } },
      { icon: 'people-circle', iconColor: '#0891B2', iconBg: '#CFFAFE', label: 'Sale/Purchase By Party Groups', route: '/accounting/reports', params: { report: 'party_groups' } },
    ],
  },
  {
    title: '3. GST REPORTS',
    rows: [
      { icon: 'document-attach', iconColor: '#059669', iconBg: '#DCFCE7', label: 'GSTR-1', route: '/accounting/reports', params: { report: 'gstr1' } },
      { icon: 'document-text', iconColor: '#DC2626', iconBg: '#FEE2E2', label: 'GSTR-2', route: '/accounting/reports', params: { report: 'gstr2' } },
      { icon: 'calculator', iconColor: '#2075FF', iconBg: '#DBEAFE', label: 'GSTR-3B', route: '/accounting/reports', params: { report: 'gstr3b' } },
      { icon: 'list-circle', iconColor: '#7C3AED', iconBg: '#EDE9FE', label: 'GST Transaction Report', route: '/accounting/reports', params: { report: 'gst_transactions' } },
      { icon: 'calendar', iconColor: '#F59E0B', iconBg: '#FEF3C7', label: 'GSTR-9', route: '/accounting/reports', params: { report: 'gstr9' } },
      { icon: 'pricetags', iconColor: '#0891B2', iconBg: '#CFFAFE', label: 'Sale Summary by HSN SAC Report', route: '/accounting/reports', params: { report: 'hsn_sac_summary' } },
    ],
  },
  {
    title: '4. ITEM / STOCK REPORTS',
    rows: [
      { icon: 'cube-outline', iconColor: '#0891B2', iconBg: '#CFFAFE', label: 'Stock Summary Report', route: '/accounting/reports', params: { report: 'stock_summary' } },
      { icon: 'share-social', iconColor: '#2075FF', iconBg: '#DBEAFE', label: 'Item Report Party', route: '/accounting/reports', params: { report: 'item_report_party' } },
      { icon: 'cash', iconColor: '#059669', iconBg: '#DCFCE7', label: 'Item Wise Profit & Loss', route: '/accounting/reports', params: { report: 'item_pnl' } },
      { icon: 'warning', iconColor: '#DC2626', iconBg: '#FEE2E2', label: 'Low Stock Summary Report', route: '/accounting/reports', params: { report: 'low_stock' } },
      { icon: 'information-circle', iconColor: '#7C3AED', iconBg: '#EDE9FE', label: 'Item Details Report', route: '/accounting/reports', params: { report: 'item_details' } },
      { icon: 'shapes', iconColor: '#DB2777', iconBg: '#FCE7F3', label: 'Sale/Purchase by Item Category', route: '/accounting/reports', params: { report: 'sale_purchase_item_cat' } },
      { icon: 'file-tray-stacked', iconColor: '#0891B2', iconBg: '#CFFAFE', label: 'Stock Summary By Item Category', route: '/accounting/reports', params: { report: 'stock_by_category' } },
      { icon: 'layers', iconColor: '#F59E0B', iconBg: '#FEF3C7', label: 'Item Batch Report', route: '/accounting/reports', params: { report: 'item_batch' } },
      { icon: 'barcode', iconColor: '#2075FF', iconBg: '#DBEAFE', label: 'Item Serial Report', route: '/accounting/reports', params: { report: 'item_serial' } },
      { icon: 'pricetag', iconColor: '#059669', iconBg: '#DCFCE7', label: 'Item Wise Discount', route: '/accounting/reports', params: { report: 'item_discount' } },
    ],
  },
  {
    title: '5. BUSINESS STATUS',
    rows: [
      { icon: 'business', iconColor: '#2563EB', iconBg: '#DBEAFE', label: 'Bank Statement', route: '/accounting/reports', params: { report: 'bank_statement' } },
      { icon: 'gift', iconColor: '#D97706', iconBg: '#FEF3C7', label: 'Discount Report', route: '/accounting/reports', params: { report: 'discount_report' } },
    ],
  },
  {
    title: '6. TAXES',
    rows: [
      { icon: 'checkmark-circle', iconColor: '#059669', iconBg: '#DCFCE7', label: 'GST Report', route: '/accounting/reports', params: { report: 'gst_report' } },
      { icon: 'speedometer', iconColor: '#2563EB', iconBg: '#DBEAFE', label: 'GST Rate Report', route: '/accounting/reports', params: { report: 'gst_rate_report' } },
      { icon: 'document', iconColor: '#7C3AED', iconBg: '#EDE9FE', label: 'Form No. 27EQ', route: '/accounting/reports', params: { report: 'form_27eq' } },
      { icon: 'wallet', iconColor: '#0891B2', iconBg: '#CFFAFE', label: 'TCS Receivable', route: '/accounting/reports', params: { report: 'tcs_receivable' } },
      { icon: 'arrow-up-circle', iconColor: '#DC2626', iconBg: '#FEE2E2', label: 'TDS Payable', route: '/accounting/reports', params: { report: 'tds_payable' } },
      { icon: 'arrow-down-circle', iconColor: '#059669', iconBg: '#DCFCE7', label: 'TDS Receivable', route: '/accounting/reports', params: { report: 'tds_receivable' } },
    ],
  },
  {
    title: '7. EXPENSE REPORTS',
    rows: [
      { icon: 'receipt-outline', iconColor: '#DC2626', iconBg: '#FEE2E2', label: 'Expense Transaction Report', route: '/accounting/reports', params: { report: 'expense_transaction' } },
      { icon: 'pie-chart-outline', iconColor: '#EA580C', iconBg: '#FFEDD5', label: 'Expense Category Report', route: '/accounting/reports', params: { report: 'expense_category' } },
      { icon: 'basket', iconColor: '#2075FF', iconBg: '#DBEAFE', label: 'Expense Item Report', route: '/accounting/reports', params: { report: 'expense_item' } },
    ],
  },
  {
    title: '8. SALE / PURCHASE ORDER REPORTS',
    rows: [
      { icon: 'cart-outline', iconColor: '#4F46E5', iconBg: '#EEF2FF', label: 'Sale/Purchase Order Transaction Report', route: '/accounting/reports', params: { report: 'order_transaction' } },
      { icon: 'reorder-four', iconColor: '#7C3AED', iconBg: '#EDE9FE', label: 'Sale/Purchase Order Item Report', route: '/accounting/reports', params: { report: 'order_item' } },
    ],
  },
  {
    title: '9. LONE STATEMENT',
    rows: [
      { icon: 'wallet-outline', iconColor: '#0284C7', iconBg: '#E0F2FE', label: 'Loan Statement', route: '/accounting/reports', params: { report: 'loan_statement' } },
    ],
  },
  {
    title: '10. OLD ACCOUNTING LEDGERS & REPORTS',
    defaultOpen: true,
    rows: [
      { icon: 'receipt', iconColor: '#7C3AED', iconBg: '#EDE9FE', label: 'Old Sales Invoices Ledger', route: '/accounting/reports', params: { report: 'old_sales_ledger' } },
      { icon: 'arrow-down-circle', iconColor: '#2563EB', iconBg: '#DBEAFE', label: 'Old Payment-In Ledger', route: '/accounting/reports', params: { report: 'old_payment_in_ledger' } },
      { icon: 'wallet', iconColor: '#EA580C', iconBg: '#FFEDD5', label: 'Old Expenses Ledger', route: '/accounting/reports', params: { report: 'old_expenses_ledger' } },
      { icon: 'book', iconColor: '#059669', iconBg: '#DCFCE7', label: 'Old Day Book (Cash / Bank)', route: '/accounting/reports', params: { report: 'old_day_book' } },
    ],
  },
];

const SETTINGS_SECTIONS: Section[] = [
  {
    title: 'AUTOMATION',
    defaultOpen: true,
    rows: [
      { icon: 'flash', iconColor: '#059669', iconBg: '#DCFCE7', label: 'Service-wise Task Assignment', route: '/accounting/settings/service-tasks' },
    ],
  },
  {
    title: 'SETTINGS',
    defaultOpen: true,
    rows: [
      { icon: 'options', iconColor: '#2075FF', iconBg: '#DBEAFE', label: 'General Settings', route: '/admin/settings' },
      { icon: 'swap-horizontal', iconColor: '#7C3AED', iconBg: '#EDE9FE', label: 'Transaction Settings', route: '/admin/settings' },
      { icon: 'print', iconColor: '#059669', iconBg: '#DCFCE7', label: 'Invoice Print Settings', route: '/admin/settings' },
      { icon: 'receipt', iconColor: '#DC2626', iconBg: '#FEE2E2', label: 'Taxes & GST Center', route: '/accounting/reports/gst' },
      { icon: 'people', iconColor: '#F59E0B', iconBg: '#FEF3C7', label: 'User Directory & Roles', route: '/admin/users' },
      { icon: 'chatbubbles', iconColor: '#0891B2', iconBg: '#CFFAFE', label: 'Transaction SMS', route: '/admin/settings' },
      { icon: 'notifications', iconColor: '#DB2777', iconBg: '#FCE7F3', label: 'Document Expiry Reminders', route: '/customers/expiry-alerts' },
      { icon: 'person', iconColor: '#7C3AED', iconBg: '#EDE9FE', label: 'Parties Directory', route: '/(tabs)/business' },
      { icon: 'cube', iconColor: '#059669', iconBg: '#DCFCE7', label: 'Item Master Catalog', route: '/accounting/items' },
    ],
  },
];

const OLD_ACCOUNTING_SECTIONS: Section[] = [
  {
    title: 'OLD ACCOUNTING AND BILLING SECTION',
    defaultOpen: true,
    rows: [
      { icon: 'receipt', iconColor: '#7C3AED', iconBg: '#EDE9FE', label: '1. Old Sales Invoices entry', route: '/accounting/invoices/new', params: { type: 'sale', accounting: 'old' } },
      { icon: 'list', iconColor: '#7C3AED', iconBg: '#EDE9FE', label: '2. All Old Sale Invoices', route: '/accounting/invoices', params: { type: 'sale', accounting: 'old' } },
      { icon: 'arrow-down-circle', iconColor: '#2563EB', iconBg: '#DBEAFE', label: '3. Old Payment-In entry', route: '/accounting/income/new', params: { accounting: 'old' } },
      { icon: 'list', iconColor: '#2563EB', iconBg: '#DBEAFE', label: '4. All Old Payment-In Invoices', route: '/accounting/income', params: { accounting: 'old' } },
      { icon: 'wallet', iconColor: '#EA580C', iconBg: '#FFEDD5', label: '5. Add Old Expences entry', route: '/accounting/expenses/new', params: { accounting: 'old' } },
      { icon: 'checkmark-done-circle', iconColor: '#059669', iconBg: '#DCFCE7', label: '6. Old Expences approval', route: '/accounting/expenses/approval', params: { accounting: 'old' } },
      { icon: 'list', iconColor: '#EA580C', iconBg: '#FFEDD5', label: '7. All Old Expences', route: '/accounting/expenses', params: { accounting: 'old' } },
    ],
  },
  {
    title: 'CASH & BANK (COMMON TO NEW & OLD ACCOUNTING)',
    defaultOpen: true,
    rows: [
      { icon: 'journal', iconColor: '#00104A', iconBg: '#E0E7FF', label: 'Consolidated Bank Book', route: '/accounting/reports', params: { report: 'consolidated_bank_book' } },
      { icon: 'business', iconColor: '#1E40AF', iconBg: '#DBEAFE', label: 'Bank Accounts (SBI & Axis Bank)', route: '/accounting/cash-bank', params: { tab: 'banks' } },
      { icon: 'cash', iconColor: '#059669', iconBg: '#DCFCE7', label: 'Cash in Hand (Cash Register)', route: '/accounting/cash-bank', params: { tab: 'cash' } },
      { icon: 'swap-vertical', iconColor: '#059669', iconBg: '#D1FAE5', label: 'Contra Deposit & Transfers', route: '/accounting/cash-bank' },
    ],
  },
  {
    title: 'PURCHASE (COMMON TO NEW & OLD ACCOUNTING)',
    defaultOpen: false,
    rows: [
      { icon: 'file-tray-full', iconColor: '#DC2626', iconBg: '#FEE2E2', label: 'Purchase Bills', route: '/accounting/invoices/new', params: { type: 'purchase' } },
      { icon: 'list', iconColor: '#DC2626', iconBg: '#FEE2E2', label: 'All Purchase Bills', route: '/accounting/invoices', params: { type: 'purchase' } },
      { icon: 'arrow-up-circle', iconColor: '#F59E0B', iconBg: '#FEF3C7', label: 'Payment-Out', route: '/accounting/expenses/new' },
      { icon: 'list', iconColor: '#F59E0B', iconBg: '#FEF3C7', label: 'All Payments-Out', route: '/accounting/expenses' },
    ],
  },
  {
    title: 'OLD ACCOUNTING DEDICATED LEDGERS & REPORTS',
    defaultOpen: true,
    rows: [
      { icon: 'receipt', iconColor: '#7C3AED', iconBg: '#EDE9FE', label: 'Old Sales Invoices Ledger', route: '/accounting/reports', params: { report: 'old_sales_ledger' } },
      { icon: 'arrow-down-circle', iconColor: '#2563EB', iconBg: '#DBEAFE', label: 'Old Payment-In Ledger', route: '/accounting/reports', params: { report: 'old_payment_in_ledger' } },
      { icon: 'wallet', iconColor: '#EA580C', iconBg: '#FFEDD5', label: 'Old Expenses Ledger', route: '/accounting/reports', params: { report: 'old_expenses_ledger' } },
      { icon: 'book', iconColor: '#059669', iconBg: '#DCFCE7', label: 'Old Day Book (Independent Ledger)', route: '/accounting/reports', params: { report: 'old_day_book' } },
      { icon: 'book-outline', iconColor: '#2075FF', iconBg: '#DBEAFE', label: 'Consolidated Day Book (All Entries)', route: '/accounting/reports', params: { report: 'day_book' } },
    ],
  },
];

const FAV_KEY = 'acc.report.favs';

export default function AccountingMenu() {
  const router = useRouter();
  const searchParams = useLocalSearchParams();
  const initialTab = searchParams?.tab === 'old' ? 'old' : searchParams?.tab === 'reports' ? 'reports' : searchParams?.tab === 'bank' ? 'bank' : searchParams?.tab === 'settings' ? 'settings' : 'home';
  const [tab, setTab] = useState<'home' | 'old' | 'reports' | 'bank' | 'settings'>(initialTab);
  const [favs, setFavs] = useState<Record<string, boolean>>({});
  const [reconciling, setReconciling] = useState(false);

  useEffect(() => {
    if (searchParams?.tab === 'old') setTab('old');
  }, [searchParams?.tab]);

  useFocusEffect(useCallback(() => {
    (async () => { try { const s = await SecureStore.getItemAsync(FAV_KEY); if (s) setFavs(JSON.parse(s)); } catch {} })();
  }, []));

  const toggleFav = async (label: string) => {
    const next = { ...favs, [label]: !favs[label] };
    setFavs(next);
    try { await SecureStore.setItemAsync(FAV_KEY, JSON.stringify(next)); } catch {}
  };

  const go = (r: Row) => {
    if (r.route) router.push({ pathname: r.route, params: r.params } as any);
  };

  const handleRunReconcile = async () => {
    setReconciling(true);
    try {
      const res = await api.reconcileSalesPayments();
      Alert.alert('Reconciliation Complete', res.message || 'All sale vouchers and payments are 100% synchronized.');
    } catch (e: any) {
      Alert.alert('Reconciliation Status', e?.message || 'Could not run reconciliation.');
    } finally {
      setReconciling(false);
    }
  };

  return (
    <View style={styles.root} testID="acc-menu">
      <SafeAreaView edges={['top']} style={{ backgroundColor: HEADER_BG, borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <View style={styles.header}>
          {/* Prominent Circular Back Button */}
          <Pressable onPress={() => router.back()} style={styles.headerBackBtn} hitSlop={8} testID="menu-back-btn">
            <Ionicons name="arrow-back" size={20} color={HEADER_FG} />
          </Pressable>
          <View style={{ flex: 1, marginLeft: 8 }}>
            <Text style={styles.headerTitle}>Accounting & Billing</Text>
            <Text style={styles.headerSub}>TDSC • Vyapar-Style Financial Suite</Text>
          </View>
          <Pressable onPress={() => router.push('/accounting' as any)} hitSlop={10} style={styles.headerBtn}>
            <Ionicons name="stats-chart" size={18} color={HEADER_FG} />
          </Pressable>
        </View>
      </SafeAreaView>

      {/* Tabs - 5 Primary Sections */}
      <View style={styles.tabRow}>
        {(['home', 'old', 'reports', 'bank', 'settings'] as const).map(t => (
          <Pressable key={t} testID={`tab-${t}`} onPress={() => setTab(t)} style={[styles.tabItem, tab === t && (t === 'old' ? { borderBottomColor: '#7C3AED' } : styles.tabItemActive)]}>
            <Ionicons
              name={t === 'home' ? 'briefcase' : t === 'old' ? 'time' : t === 'reports' ? 'bar-chart' : t === 'bank' ? 'business' : 'settings'}
              size={17}
              color={tab === t ? (t === 'old' ? '#7C3AED' : BLUE) : colors.muted} />
            <Text style={[styles.tabText, tab === t && (t === 'old' ? { color: '#7C3AED', fontWeight: '800' } : styles.tabTextActive)]}>
              {t === 'home' ? 'My Business' : t === 'old' ? 'Old Accounting' : t === 'reports' ? 'Reports' : t === 'bank' ? 'Bank' : 'Settings'}
            </Text>
          </Pressable>
        ))}
      </View>

      {tab === 'bank' ? (
        <BankPanel />
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: spacing.xxxl }}>
          {tab === 'old' && (
            <View style={{ backgroundColor: '#EDE9FE', borderColor: '#C4B5FD', borderWidth: 1.5, margin: spacing.md, padding: 14, borderRadius: 10, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: '#7C3AED', alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="time" size={22} color="#FFF" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: '#4C1D95', fontWeight: '900', fontSize: 14.5 }}>Old Accounting & Billing Section</Text>
                <Text style={{ color: '#6D28D9', fontSize: 11, marginTop: 2, lineHeight: 15 }}>
                  Independent historical bookkeeping • 7 Dedicated Sub-menus • Auto-populated in Day Book & Ledgers
                </Text>
              </View>
            </View>
          )}
          {tab === 'reports' && (
            <Pressable
              onPress={() => router.push('/accounting/reports' as any)}
              style={styles.masterReportsBanner}
              testID="master-reports-banner"
            >
              <View style={styles.masterReportsIcon}>
                <Ionicons name="bar-chart" size={20} color="#FFF" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.masterReportsTitle}>Open Master Reports Hub</Text>
                <Text style={styles.masterReportsSub}>All 9 Categories, Live Search, Date Filters & Export</Text>
              </View>
              <Ionicons name="arrow-forward-circle" size={24} color={BLUE} />
            </Pressable>
          )}
          {tab === 'settings' && (
            <Pressable
              onPress={handleRunReconcile}
              disabled={reconciling}
              style={{
                backgroundColor: '#FFFFFF',
                borderWidth: 1.5,
                borderColor: '#2563EB',
                borderRadius: 8,
                marginHorizontal: spacing.md,
                marginTop: spacing.md,
                marginBottom: 6,
                padding: 14,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
              }}
              testID="reconcile-all-btn"
            >
              <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: '#EFF6FF', alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name={reconciling ? "hourglass" : "sync"} size={20} color="#2563EB" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: '800', color: '#1E40AF', fontSize: 13.5 }}>
                  {reconciling ? 'Auditing & Reconciling...' : 'Reconcile All Sales & Payments'}
                </Text>
                <Text style={{ color: '#64748B', fontSize: 11, marginTop: 2 }}>
                  1-Click audit: sync invoice balances, payment histories, and bank inflows
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#2563EB" />
            </Pressable>
          )}
          {(tab === 'home' ? BUSINESS : tab === 'old' ? OLD_ACCOUNTING_SECTIONS : tab === 'reports' ? REPORT_SECTIONS : SETTINGS_SECTIONS).map(s => (
            <SectionBlock key={s.title} section={s} onPress={go} showStar={tab === 'reports'} favs={favs} onFav={toggleFav} />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const SectionBlock: React.FC<{ section: Section; onPress: (r: Row) => void; showStar?: boolean; favs?: Record<string, boolean>; onFav?: (l: string) => void }>
  = ({ section, onPress, showStar, favs = {}, onFav }) => {
  const [open, setOpen] = useState<boolean>(!!section.defaultOpen);
  return (
    <View style={styles.section}>
      <Pressable onPress={() => setOpen(o => !o)} style={styles.sectionHeader} testID={`sec-${section.title}`}>
        <Text style={styles.sectionTitle}>{section.title}</Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.muted} />
      </Pressable>
      {open ? (
        <View>
          {section.rows.map(r => (
            <Pressable key={r.label} onPress={() => onPress(r)} style={styles.row} testID={`row-${r.label}`}>
              <View style={[styles.rowIcon, { backgroundColor: r.iconBg }]}>
                <Ionicons name={r.icon} size={20} color={r.iconColor} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowLabel}>{r.label}</Text>
              </View>
              {showStar ? (
                <Pressable onPress={() => onFav?.(r.label)} hitSlop={8} style={{ padding: 6 }} testID={`fav-${r.label}`}>
                  <Ionicons name={favs[r.label] ? 'star' : 'star-outline'} size={18} color={favs[r.label] ? '#F59E0B' : '#9CA3AF'} />
                </Pressable>
              ) : null}
              <Ionicons name="chevron-forward" size={18} color={colors.muted} />
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
};

const BankPanel: React.FC = () => {
  const router = useRouter();
  const [banks, setBanks] = useState<any[] | null>(null);
  const [balances, setBalances] = useState<Record<string, number>>({});
  const [cashBalance, setCashBalance] = useState<number>(0);

  const load = useCallback(async () => {
    try {
      const [b, dash, cashInfo] = await Promise.all([
        api.get<any[]>('/bank-accounts').catch(() => []),
        api.get<any>('/accounting/dashboard').catch(() => null),
        api.get<any>('/cash-bank/cash-in-hand').catch(() => null),
      ]);
      setBanks(b || []);
      const map: Record<string, number> = {};
      for (const x of b || []) map[x.id] = Number(x.opening_balance || 0);
      if (dash?.bank_balances) {
        if (Array.isArray(dash.bank_balances)) {
          for (const item of dash.bank_balances) {
            if (item?.id) map[item.id] = Number(item.balance || 0);
          }
        } else {
          Object.assign(map, dash.bank_balances);
        }
      }
      setBalances(map);
      if (cashInfo?.cash_in_hand !== undefined) {
        setCashBalance(Number(cashInfo.cash_in_hand));
      } else if (dash?.cash_in_hand !== undefined) {
        setCashBalance(Number(dash.cash_in_hand));
      }
    } catch { setBanks([]); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const shareCard = async (b: any) => {
    const bal = balances[b.id] ?? Number(b.opening_balance || 0);
    const msg = `TDSC • ${b.name}\n${b.bank_name} • A/c ${b.account_no}\nIFSC: ${b.ifsc || '—'}\nCurrent Balance: ${inr(bal)}`;
    try { await Share.share({ message: msg }); } catch {}
  };

  if (banks === null) {
    return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: colors.muted }}>Loading…</Text></View>;
  }

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.bankHeader}>
        <Text style={styles.bankTitle}>Bank Accounts & Cash</Text>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          <Pressable testID="open-consolidated-book" onPress={() => router.push('/accounting/reports?report=consolidated_bank_book' as any)} style={[styles.bankAdd, { backgroundColor: '#00104A' }]}>
            <Ionicons name="journal-outline" size={14} color="#FFF" />
            <Text style={{ color: '#FFF', fontWeight: '800', fontSize: 12 }}>Consolidated Book</Text>
          </Pressable>
          <Pressable testID="open-cash-bank-hub" onPress={() => router.push('/accounting/cash-bank' as any)} style={[styles.bankAdd, { backgroundColor: NAVY }]}>
            <Ionicons name="swap-vertical" size={14} color="#FFF" />
            <Text style={{ color: '#FFF', fontWeight: '800', fontSize: 12 }}>Cash & Bank Hub</Text>
          </Pressable>
          <Pressable testID="add-bank-btn" onPress={() => router.push('/accounting/banks' as any)} style={styles.bankAdd}>
            <Ionicons name="add" size={16} color="#FFF" />
            <Text style={{ color: '#FFF', fontWeight: '800', fontSize: 12 }}>Add Bank</Text>
          </Pressable>
        </View>
      </View>
      {banks.length === 0 ? (
        <View style={{ alignItems: 'center', padding: 32 }}>
          <Ionicons name="business-outline" size={48} color={colors.muted} />
          <Text style={{ color: colors.muted, marginTop: 8 }}>No bank accounts yet</Text>
          <Pressable onPress={() => router.push('/accounting/banks' as any)} style={[styles.bankAdd, { marginTop: 12 }]}>
            <Ionicons name="add" size={16} color="#FFF" />
            <Text style={{ color: '#FFF', fontWeight: '800' }}>Add First Bank</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={banks}
          keyExtractor={i => i.id}
          contentContainerStyle={{ padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxxl }}
          ListFooterComponent={
            <View style={[styles.bankCard, { borderColor: '#A7F3D0', backgroundColor: '#F0FDF4', marginTop: 4 }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View style={[styles.bankLogo, { backgroundColor: '#059669' }]}>
                  <Ionicons name="cash" size={22} color="#FFF" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.bankName, { color: '#064E3B' }]}>Cash in Hand (Cash Ledger)</Text>
                  <Text style={[styles.bankSub, { color: '#047857' }]}>Physical Cash Register • Primary Cash Account</Text>
                </View>
                <View style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12, backgroundColor: '#D1FAE5' }}>
                  <Text style={{ fontSize: 11, fontWeight: '800', color: '#065F46' }}>CASH REGISTER</Text>
                </View>
              </View>
              <View style={styles.bankBody}>
                <Text style={[styles.bankLbl, { color: '#047857' }]}>Current Cash Balance</Text>
                <Text style={[styles.bankBal, { color: cashBalance >= 0 ? '#059669' : '#DC2626' }]}>
                  {cashBalance < 0 ? '-' : ''}{inr(Math.abs(cashBalance))}
                </Text>
              </View>
              <View style={{ flexDirection: 'row', gap: 6, marginTop: 8 }}>
                <Pressable
                  testID="cash-book-btn"
                  onPress={() => router.push('/accounting/books?tab=cash' as any)}
                  style={[styles.bankBtn, { backgroundColor: '#FFF', borderColor: '#10B981', borderWidth: 1 }]}
                >
                  <Ionicons name="book" size={14} color="#059669" />
                  <Text style={[styles.bankBtnTxt, { color: '#059669' }]}>Cash Book</Text>
                </Pressable>
                <Pressable
                  testID="cash-ledger-btn"
                  onPress={() => router.push('/accounting/reports?report=cash_ledger' as any)}
                  style={[styles.bankBtn, { backgroundColor: '#ECFDF5', borderColor: '#059669', borderWidth: 1 }]}
                >
                  <Ionicons name="document-text" size={14} color="#047857" />
                  <Text style={[styles.bankBtnTxt, { color: '#047857', fontWeight: '800' }]}>Cash Ledger</Text>
                </Pressable>
                <Pressable
                  testID="cash-contra-btn"
                  onPress={() => router.push('/accounting/cash-bank' as any)}
                  style={[styles.bankBtn, { backgroundColor: '#FFF' }]}
                >
                  <Ionicons name="swap-vertical" size={14} color="#059669" />
                  <Text style={[styles.bankBtnTxt, { color: '#059669' }]}>Contra Deposit</Text>
                </Pressable>
              </View>
            </View>
          }
          renderItem={({ item }) => {
            const bal = balances[item.id] ?? Number(item.opening_balance || 0);
            const pos = bal >= 0;
            return (
              <View style={styles.bankCard}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <View style={styles.bankLogo}><Ionicons name="business" size={22} color="#FFF" /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.bankName}>{item.name}</Text>
                    <Text style={styles.bankSub}>{item.bank_name} • ****{String(item.account_no).slice(-4)}</Text>
                  </View>
                  <Pressable onPress={() => shareCard(item)} hitSlop={8} testID={`share-${item.id}`}>
                    <Ionicons name="share-social" size={22} color={colors.brandPrimary} />
                  </Pressable>
                </View>
                <View style={styles.bankBody}>
                  <Text style={styles.bankLbl}>Current Balance</Text>
                  <Text style={[styles.bankBal, { color: pos ? '#059669' : '#DC2626' }]}>{pos ? '' : '-'}{inr(Math.abs(bal))}</Text>
                </View>
                <View style={{ flexDirection: 'row', gap: 6, marginTop: 8 }}>
                  <Pressable onPress={() => router.push({ pathname: '/accounting/books', params: { bank: item.id } } as any)} style={styles.bankBtn}>
                    <Ionicons name="book" size={14} color={colors.brandPrimary} />
                    <Text style={styles.bankBtnTxt}>Bank Book</Text>
                  </Pressable>
                  <Pressable onPress={() => router.push({ pathname: '/accounting/reports', params: { report: 'bank_ledger', bank: item.id } } as any)} style={[styles.bankBtn, { backgroundColor: '#EFF6FF', borderColor: '#BFDBFE', borderWidth: 1 }]}>
                    <Ionicons name="document-text" size={14} color="#1E40AF" />
                    <Text style={[styles.bankBtnTxt, { color: '#1E40AF' }]}>Bank Ledger</Text>
                  </Pressable>
                  <Pressable onPress={() => router.push('/accounting/banks' as any)} style={styles.bankBtn}>
                    <Ionicons name="create-outline" size={14} color={colors.brandPrimary} />
                    <Text style={styles.bankBtnTxt}>Manage</Text>
                  </Pressable>
                </View>
              </View>
            );
          }}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F4F6FB' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: 10 },
  headerBackBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#F1F5F9', borderWidth: 1, borderColor: '#CBD5E1', alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 2, elevation: 2 },
  headerTitle: { color: HEADER_FG, fontSize: font.lg, fontWeight: '900' },
  headerSub: { color: colors.muted, fontSize: 11, fontWeight: '600', marginTop: 1 },
  headerBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#F1F5F9', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border },
  tabRow: { flexDirection: 'row', backgroundColor: '#FFF', borderBottomWidth: 1, borderBottomColor: colors.border },
  tabItem: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 12, borderBottomWidth: 3, borderBottomColor: 'transparent', gap: 4 },
  tabItemActive: { borderBottomColor: BLUE },
  tabText: { color: colors.muted, fontWeight: '700', fontSize: 11 },
  tabTextActive: { color: BLUE },
  section: { backgroundColor: '#FFF', marginTop: spacing.md, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.border },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: 10, backgroundColor: '#F9FAFB' },
  sectionTitle: { fontSize: 11, fontWeight: '900', color: '#374151', letterSpacing: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: 12, borderTopWidth: 1, borderTopColor: '#F3F4F6' },
  rowIcon: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { fontSize: font.base, color: '#111827', fontWeight: '600' },
  bankHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingVertical: spacing.md, backgroundColor: '#FFF', borderBottomWidth: 1, borderBottomColor: colors.border },
  bankTitle: { fontSize: font.lg, fontWeight: '800', color: '#111827' },
  bankAdd: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: BLUE, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill },
  bankCard: { backgroundColor: '#FFF', borderRadius: radius.md, padding: spacing.lg, borderWidth: 1, borderColor: colors.border },
  bankLogo: { width: 44, height: 44, borderRadius: 22, backgroundColor: NAVY, alignItems: 'center', justifyContent: 'center' },
  bankName: { color: '#111827', fontWeight: '800', fontSize: font.lg },
  bankSub: { color: colors.muted, fontSize: font.sm, marginTop: 2 },
  bankBody: { marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: '#F3F4F6' },
  bankLbl: { color: colors.muted, fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  bankBal: { fontSize: font.xxl, fontWeight: '900', marginTop: 4 },
  bankBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: '#EFF6FF', paddingVertical: 8, borderRadius: radius.md },
  bankBtnTxt: { color: colors.brandPrimary, fontWeight: '700', fontSize: 12 },
  masterReportsBanner: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#EFF6FF', marginHorizontal: spacing.lg, marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: '#BFDBFE', gap: 12 },
  masterReportsIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: BLUE, alignItems: 'center', justifyContent: 'center' },
  masterReportsTitle: { fontSize: font.base, fontWeight: '800', color: '#1E3A8A' },
  masterReportsSub: { fontSize: 11, color: '#3B82F6', marginTop: 2 },
});
