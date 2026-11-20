import React, { useCallback, useState, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  TextInput,
  Modal,
  ScrollView,
  Platform,
  Linking,
  ActivityIndicator,
  KeyboardAvoidingView,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, font, shadow } from '@/src/theme';
import { api } from '@/src/api';
import { EmptyState, ScreenLoader, StatusBadge } from '@/src/ui';
import { ScreenHeader } from '@/src/ScreenHeader';
import { useAuth } from '@/src/AuthContext';
import { notify, confirm } from '@/src/dialog';
import { canWrite, canAction } from '@/src/rbac';

const inr = (n: any) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

const PAYMENT_MODES = ['cash', 'bank', 'upi', 'cheque'];
const EXPENSE_CATEGORIES = [
  'Office Rent',
  'Electricity',
  'Internet',
  'Travel',
  'Salary',
  'Office Consumables',
  'Printing & Stationery',
  'Audit & Legal Fees',
  'CA Fees',
  'Tender Fee',
  'Cost of BOQ',
  'EMD',
  'Registration Fee',
  'Software & Subscriptions',
  'Other Expenses',
];

const DATE_PRESETS = [
  { key: 'all', label: 'All Time' },
  { key: 'today', label: 'Today' },
  { key: 'this_week', label: 'This Week' },
  { key: 'this_month', label: 'This Month' },
  { key: 'custom', label: 'Custom Range' },
];

const SORT_OPTIONS = [
  { key: 'date_desc', label: 'Date: Newest First', icon: 'calendar' },
  { key: 'date_asc', label: 'Date: Oldest First', icon: 'calendar-outline' },
  { key: 'amount_desc', label: 'Amount: High to Low', icon: 'trending-down' },
  { key: 'amount_asc', label: 'Amount: Low to High', icon: 'trending-up' },
];

const getTodayStr = () => new Date().toISOString().slice(0, 10);
const getThisMonthStartStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
};
const getThisWeekStartStr = () => {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d.setDate(diff));
  return monday.toISOString().slice(0, 10);
};

export default function ExpensesList() {
  const router = useRouter();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';
  const isManager = user?.role === 'manager';
  const canDelete = isAdmin || isManager || user?.role === 'accountant' || canAction(user, 'expenses', 'delete') || canAction(user, 'accounting', 'delete');
  const canCreate = isAdmin || isManager || user?.role === 'accountant' || canWrite(user, 'expenses') || canWrite(user, 'accounting');

  const [list, setList] = useState<any[] | null>(null);
  const [customers, setCustomers] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [printingId, setPrintingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Status Tab
  const [statusTab, setStatusTab] = useState<'approved' | 'all' | 'pending' | 'rejected'>('approved');

  // Search & Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('all');
  const [filterCustomerSearch, setFilterCustomerSearch] = useState('');
  const [datePreset, setDatePreset] = useState<string>('all');
  const [customFromDate, setCustomFromDate] = useState('');
  const [customToDate, setCustomToDate] = useState('');
  const [filterItemText, setFilterItemText] = useState('');
  const [filterVoucherText, setFilterVoucherText] = useState('');
  const [filterNameText, setFilterNameText] = useState('');
  const [selectedPaymentMode, setSelectedPaymentMode] = useState<string>('all');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  const [sortBy, setSortBy] = useState<string>('date_desc');

  // Modals
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [showSortModal, setShowSortModal] = useState(false);
  const [viewingExp, setViewingExp] = useState<any | null>(null);
  const [customCats, setCustomCats] = useState<string[]>([]);
  const [showAddCatModal, setShowAddCatModal] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [savingCat, setSavingCat] = useState(false);

  // Bank Accounts & Helpers
  const [banks, setBanks] = useState<any[]>([]);
  const [showAddBankModal, setShowAddBankModal] = useState(false);
  const [savingNewBank, setSavingNewBank] = useState(false);
  const [bankSaveErr, setBankSaveErr] = useState<string | null>(null);
  const [newBankForm, setNewBankForm] = useState({
    name: '',
    bank_name: '',
    account_no: '',
    ifsc: '',
    opening_balance: '0',
  });

  const getBankShortLabel = (b: any) => {
    if (!b) return 'Bank Account';
    const acc = String(b.account_no || '');
    const bankName = (b.bank_name || '').toUpperCase();
    const name = (b.name || '').toUpperCase();
    const ifsc = (b.ifsc || '').toUpperCase();

    if (acc.includes('42137607814') || ifsc.startsWith('SBIN') || bankName.includes('STATE') || name.includes('STATE') || name.includes('TRIVENI')) {
      return `SBI (${b.account_no || '42137607814'})`;
    }
    if (acc.includes('915020011528516') || ifsc.startsWith('UTIB') || bankName.includes('AXIS') || name.includes('AXIS') || name.includes('ANJU')) {
      return `Axis Bank (${b.account_no || '915020011528516'})`;
    }
    return `${b.bank_name || b.name} (${b.account_no})`;
  };

  const getExpenseBankLabel = (item: any) => {
    const mode = String(item.payment_mode || 'cash').toLowerCase();
    if (mode === 'cash') return 'Cash';
    const bId = item.bank_id || item.bank_account_id;
    if (bId) {
      const match = banks.find(b => b.id === bId);
      if (match) return getBankShortLabel(match);
    }
    const acc = String(item.account_no || '');
    const bName = String(item.bank_name || '').toUpperCase();
    if (acc.includes('42137607814') || bName.includes('STATE') || bName.includes('TRIVENI') || bName.includes('SBI')) {
      return `SBI (${acc || '42137607814'})`;
    }
    if (acc.includes('915020011528516') || bName.includes('AXIS') || bName.includes('ANJU')) {
      return `Axis Bank (${acc || '915020011528516'})`;
    }
    const sbi = banks.find(b => String(b.account_no || '').includes('42137607814'));
    if (sbi) return getBankShortLabel(sbi);
    return banks[0] ? getBankShortLabel(banks[0]) : 'SBI (42137607814)';
  };

  const handleSaveNewBank = async () => {
    if (!newBankForm.name.trim() || !newBankForm.bank_name.trim() || !newBankForm.account_no.trim()) {
      setBankSaveErr('Account Nickname, Bank Name, and Account Number are required.');
      return;
    }
    setSavingNewBank(true);
    setBankSaveErr(null);
    try {
      const created = await api.post<any>('/bank-accounts', {
        name: newBankForm.name.trim(),
        bank_name: newBankForm.bank_name.trim(),
        account_no: newBankForm.account_no.trim(),
        ifsc: (newBankForm.ifsc || '').trim().toUpperCase(),
        opening_balance: parseFloat(newBankForm.opening_balance) || 0,
      });
      setBanks(prev => [...prev, created]);
      setEditForm(p => ({ ...p, bank_account_id: created.id }));
      setShowAddBankModal(false);
      setNewBankForm({ name: '', bank_name: '', account_no: '', ifsc: '', opening_balance: '0' });
    } catch (e: any) {
      setBankSaveErr(e?.message || 'Failed to save bank account');
    } finally {
      setSavingNewBank(false);
    }
  };

  // Edit Form State
  const [editingExp, setEditingExp] = useState<any | null>(null);
  const [editForm, setEditForm] = useState<{
    amount: string;
    category: string;
    date: string;
    payment_mode: string;
    bank_account_id: string;
    vendor: string;
    description: string;
    customer_name: string;
    customer_mobile: string;
    customer_pan: string;
    customer_gst: string;
  }>({
    amount: '',
    category: 'Other Expenses',
    date: '',
    payment_mode: 'cash',
    bank_account_id: '',
    vendor: '',
    description: '',
    customer_name: '',
    customer_mobile: '',
    customer_pan: '',
    customer_gst: '',
  });
  const [saving, setSaving] = useState(false);

  // Load Data
  const load = useCallback(async () => {
    try {
      const meta = await api.get<any>('/settings/expense-categories').catch(() => null);
      if (meta?.categories) {
        setCustomCats(meta.categories);
      }
    } catch {}
    try {
      setLoading(true);
      const [expData, custList, bList] = await Promise.all([
        api.get<any[]>('/expenses'),
        api.get<any[]>('/customers').catch(() => []),
        api.get<any[]>('/bank-accounts').catch(() => []),
      ]);
      setList(Array.isArray(expData) ? expData : []);
      setCustomers(Array.isArray(custList) ? custList : []);
      setBanks(Array.isArray(bList) ? bList : []);
    } catch (err: any) {
      console.error('Failed to load expenses', err);
      setList([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // Active filters count
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (selectedCategory !== 'all') count++;
    if (selectedCustomerId !== 'all') count++;
    if (datePreset !== 'all') count++;
    if (filterItemText.trim()) count++;
    if (filterVoucherText.trim()) count++;
    if (filterNameText.trim()) count++;
    if (selectedPaymentMode !== 'all') count++;
    if (minAmount.trim()) count++;
    if (maxAmount.trim()) count++;
    return count;
  }, [
    selectedCategory,
    selectedCustomerId,
    datePreset,
    filterItemText,
    filterVoucherText,
    filterNameText,
    selectedPaymentMode,
    minAmount,
    maxAmount,
  ]);

  const resetAllFilters = () => {
    setSelectedCategory('all');
    setSelectedCustomerId('all');
    setDatePreset('all');
    setCustomFromDate('');
    setCustomToDate('');
    setFilterItemText('');
    setFilterVoucherText('');
    setFilterNameText('');
    setSelectedPaymentMode('all');
    setMinAmount('');
    setMaxAmount('');
    setSearchQuery('');
  };

  // Stats Counters
  const stats = useMemo(() => {
    if (!list) return { approvedAmt: 0, approvedCount: 0, pendingAmt: 0, pendingCount: 0, totalAmt: 0, totalCount: 0 };
    let approvedAmt = 0;
    let approvedCount = 0;
    let pendingAmt = 0;
    let pendingCount = 0;
    let totalAmt = 0;

    list.forEach((e) => {
      const amt = Number(e.amount || 0);
      totalAmt += amt;
      if (e.status === 'approved') {
        approvedAmt += amt;
        approvedCount++;
      } else if (e.status === 'pending' || e.status === 'submitted' || e.status === 'verified') {
        pendingAmt += amt;
        pendingCount++;
      }
    });

    return {
      approvedAmt,
      approvedCount,
      pendingAmt,
      pendingCount,
      totalAmt,
      totalCount: list.length,
    };
  }, [list]);

  // Combined Multi-Criteria Filtering & Sorting
  const filteredList = useMemo(() => {
    if (!list) return null;

    const q = searchQuery.trim().toLowerCase();
    const itemFilter = filterItemText.trim().toLowerCase();
    const voucherFilter = filterVoucherText.trim().toLowerCase();
    const nameFilter = filterNameText.trim().toLowerCase();
    const minNum = parseFloat(minAmount);
    const maxNum = parseFloat(maxAmount);
    const today = getTodayStr();
    const thisWeek = getThisWeekStartStr();
    const thisMonth = getThisMonthStartStr();

    let res = list.filter((exp) => {
      // 1. Status Tab Filter: Enforce rule that unapproved expenses do NOT show until approved
      if (statusTab === 'approved' || statusTab === 'all') {
        if (exp.status !== 'approved') return false;
      } else if (statusTab === 'pending') {
        if (!(exp.status === 'pending' || exp.status === 'submitted' || exp.status === 'verified')) return false;
      } else if (statusTab === 'rejected') {
        if (exp.status !== 'rejected') return false;
      }

      // 2. Category Filter
      if (selectedCategory !== 'all' && exp.category !== selectedCategory) return false;

      // 3. Customer Filter
      if (selectedCustomerId !== 'all') {
        const matchesId = exp.customer_id === selectedCustomerId;
        const custObj = customers.find((c) => c.id === selectedCustomerId);
        const matchesName = custObj && String(exp.customer_name || '').toLowerCase() === custObj.name?.toLowerCase();
        if (!matchesId && !matchesName) return false;
      }

      // 4. Payment Mode Filter
      if (selectedPaymentMode !== 'all' && exp.payment_mode !== selectedPaymentMode) return false;

      // 5. Amount Filter (Min - Max)
      const amt = Number(exp.amount || 0);
      if (!isNaN(minNum) && amt < minNum) return false;
      if (!isNaN(maxNum) && amt > maxNum) return false;

      // 6. Date Filter
      const expDate = String(exp.date || '');
      if (datePreset === 'today' && expDate !== today) return false;
      if (datePreset === 'this_week' && expDate < thisWeek) return false;
      if (datePreset === 'this_month' && expDate < thisMonth) return false;
      if (datePreset === 'custom') {
        if (customFromDate && expDate < customFromDate) return false;
        if (customToDate && expDate > customToDate) return false;
      }

      // 7. Item Wise Filter
      if (itemFilter) {
        const saleItem = String(exp.sale_item_name || '').toLowerCase();
        const desc = String(exp.description || '').toLowerCase();
        const cat = String(exp.category || '').toLowerCase();
        if (!saleItem.includes(itemFilter) && !desc.includes(itemFilter) && !cat.includes(itemFilter)) {
          return false;
        }
      }

      // 8. Voucher Wise Filter
      if (voucherFilter) {
        const expNo = String(exp.expense_no || '').toLowerCase();
        const linkedVoucher = String(exp.linked_voucher_no || '').toLowerCase();
        const saleInvoice = String(exp.sale_invoice_no || '').toLowerCase();
        if (!expNo.includes(voucherFilter) && !linkedVoucher.includes(voucherFilter) && !saleInvoice.includes(voucherFilter)) {
          return false;
        }
      }

      // 9. Name Wise Filter (Vendor, Customer, Submitter, Approver)
      if (nameFilter) {
        const vendor = String(exp.vendor || '').toLowerCase();
        const custName = String(exp.customer_name || '').toLowerCase();
        const approver = String(exp.approved_by || '').toLowerCase();
        const creator = String(exp.created_by_name || exp.created_by || '').toLowerCase();
        if (!vendor.includes(nameFilter) && !custName.includes(nameFilter) && !approver.includes(nameFilter) && !creator.includes(nameFilter)) {
          return false;
        }
      }

      // 10. Global Instant Search Query across all fields
      if (q) {
        const expNo = String(exp.expense_no || '').toLowerCase();
        const linkedVoucher = String(exp.linked_voucher_no || '').toLowerCase();
        const vendor = String(exp.vendor || '').toLowerCase();
        const custName = String(exp.customer_name || '').toLowerCase();
        const mobile = String(exp.customer_mobile || '').toLowerCase();
        const pan = String(exp.customer_pan || '').toLowerCase();
        const gst = String(exp.customer_gst || '').toLowerCase();
        const code = String(exp.customer_code || '').toLowerCase();
        const cat = String(exp.category || '').toLowerCase();
        const desc = String(exp.description || '').toLowerCase();
        const saleNo = String(exp.sale_invoice_no || '').toLowerCase();
        const saleItem = String(exp.sale_item_name || '').toLowerCase();
        const date = String(exp.date || '').toLowerCase();
        const mode = String(exp.payment_mode || '').toLowerCase();
        const amtStr = String(exp.amount || '').toLowerCase();
        const approver = String(exp.approved_by || '').toLowerCase();

        const matched =
          expNo.includes(q) ||
          linkedVoucher.includes(q) ||
          vendor.includes(q) ||
          custName.includes(q) ||
          mobile.includes(q) ||
          pan.includes(q) ||
          gst.includes(q) ||
          code.includes(q) ||
          cat.includes(q) ||
          desc.includes(q) ||
          saleNo.includes(q) ||
          saleItem.includes(q) ||
          date.includes(q) ||
          mode.includes(q) ||
          amtStr.includes(q) ||
          approver.includes(q);

        if (!matched) return false;
      }

      return true;
    });

    // Apply Sorting
    res.sort((a, b) => {
      if (sortBy === 'date_desc') return String(b.date || '').localeCompare(String(a.date || ''));
      if (sortBy === 'date_asc') return String(a.date || '').localeCompare(String(b.date || ''));
      if (sortBy === 'amount_desc') return Number(b.amount || 0) - Number(a.amount || 0);
      if (sortBy === 'amount_asc') return Number(a.amount || 0) - Number(b.amount || 0);
      return 0;
    });

    return res;
  }, [
    list,
    statusTab,
    selectedCategory,
    selectedCustomerId,
    selectedPaymentMode,
    minAmount,
    maxAmount,
    datePreset,
    customFromDate,
    customToDate,
    filterItemText,
    filterVoucherText,
    filterNameText,
    searchQuery,
    sortBy,
    customers,
  ]);

  // Delete Action
  const handleDeleteExpense = async (item: any) => {
    const ok = await confirm(
      'Delete Expense?',
      `Are you sure you want to delete Expense "${item.expense_no || 'EXP'}" (${item.category} - ${inr(item.amount)})? This cannot be undone.`,
      { confirmText: 'Delete', destructive: true }
    );
    if (!ok) return;

    setDeletingId(item.id);
    try {
      await api.deleteExpense(item.id);
      notify('Deleted', `Expense ${item.expense_no || ''} deleted successfully.`);
      await load();
    } catch (e: any) {
      notify('Delete Failed', e?.message || 'Could not delete expense');
    } finally {
      setDeletingId(null);
    }
  };

  // Print PDF
  const handlePrint = async (item: any) => {
    try {
      setPrintingId(item.id);
      const url = await api.expensePdfUrl(item.id);
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.open(url, '_blank');
      } else {
        await Linking.openURL(url);
      }
    } catch (e: any) {
      notify('Print Failed', e?.message || 'Unable to open Expense Voucher PDF');
    } finally {
      setPrintingId(null);
    }
  };

  // Open Edit Modal
  const openEdit = (item: any) => {
    setEditingExp(item);
    const sbi = banks.find((b: any) => String(b.account_no || '').includes('42137607814'));
    const defaultBankId = item.bank_id || item.bank_account_id || sbi?.id || banks[0]?.id || '';
    setEditForm({
      amount: String(item.amount || ''),
      category: item.category || 'Other Expenses',
      date: item.date || new Date().toISOString().slice(0, 10),
      payment_mode: item.payment_mode || 'cash',
      bank_account_id: defaultBankId,
      vendor: item.vendor || '',
      description: item.description || '',
      customer_name: item.customer_name || '',
      customer_mobile: item.customer_mobile || '',
      customer_pan: item.customer_pan || '',
      customer_gst: item.customer_gst || '',
    });
  };

  // Save Edit
  const saveEdit = async () => {
    if (!editingExp) return;
    const numAmt = parseFloat(editForm.amount);
    if (isNaN(numAmt) || numAmt <= 0) {
      notify('Invalid Amount', 'Please enter a valid expense amount greater than 0.');
      return;
    }
    if (!editForm.category.trim()) {
      notify('Category Required', 'Please select or enter an expense category.');
      return;
    }
    if (!editForm.date.trim()) {
      notify('Date Required', 'Please enter a valid voucher date.');
      return;
    }

    try {
      setSaving(true);
      const chosenBank = banks.find(b => b.id === editForm.bank_account_id) || banks[0];
      await api.patch(`/expenses/${editingExp.id}`, {
        amount: numAmt,
        category: editForm.category.trim(),
        date: editForm.date.trim(),
        payment_mode: editForm.payment_mode,
        bank_account_id: editForm.payment_mode !== 'cash' ? (chosenBank?.id || null) : null,
        bank_id: editForm.payment_mode !== 'cash' ? (chosenBank?.id || null) : null,
        bank_name: editForm.payment_mode !== 'cash' ? (chosenBank?.bank_name || chosenBank?.name || null) : null,
        account_no: editForm.payment_mode !== 'cash' ? (chosenBank?.account_no || null) : null,
        vendor: editForm.vendor.trim() || null,
        description: editForm.description.trim() || null,
        customer_name: editForm.customer_name.trim() || null,
        customer_mobile: editForm.customer_mobile.trim() || null,
        customer_pan: editForm.customer_pan.trim() || null,
        customer_gst: editForm.customer_gst.trim() || null,
      });

      notify('Saved', `Expense ${editingExp.expense_no} updated successfully!`);
      setEditingExp(null);
      await load();
    } catch (e: any) {
      notify('Update Failed', e?.message || 'Failed to save expense changes');
    } finally {
      setSaving(false);
    }
  };

  const selectedCustomerObj = customers.find((c) => c.id === selectedCustomerId);

  return (
    <View style={{ flex: 1, backgroundColor: '#F4F6FB' }} testID="expenses-list">
      <ScreenHeader
        title="All Expenses"
        right={
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Pressable
              onPress={() => router.push('/accounting/reports?report=bank_ledger' as any)}
              style={styles.ledgerHeaderBtn}
              testID="btn-bank-ledger"
            >
              <Ionicons name="business" size={14} color="#1E40AF" />
              <Text style={styles.ledgerHeaderBtnTxt}>Bank Ledger</Text>
            </Pressable>
            <Pressable
              onPress={() => router.push('/accounting/reports?report=cash_ledger' as any)}
              style={styles.ledgerHeaderBtn}
              testID="btn-cash-ledger"
            >
              <Ionicons name="wallet" size={14} color="#059669" />
              <Text style={[styles.ledgerHeaderBtnTxt, { color: '#059669' }]}>Cash Ledger</Text>
            </Pressable>
            <Pressable
              onPress={() => router.push('/accounting/expenses/new' as any)}
              style={styles.addBtn}
              testID="new-expense-btn"
            >
              <Ionicons name="add" size={24} color="#FFF" />
            </Pressable>
          </View>
        }
      />

      {/* Stats Summary Banner */}
      <View style={styles.statsBanner}>
        <View style={styles.statBox}>
          <Text style={styles.statLabel}>APPROVED OUTFLOW</Text>
          <Text style={[styles.statValue, { color: '#059669' }]}>{inr(stats.approvedAmt)}</Text>
          <Text style={styles.statSub}>{stats.approvedCount} Approved</Text>
        </View>
        <View style={styles.statDivider} />
        <Pressable
          onPress={() => router.push('/accounting/expenses/approval' as any)}
          style={styles.statBox}
        >
          <Text style={styles.statLabel}>PENDING APPROVAL ↗</Text>
          <Text style={[styles.statValue, { color: '#D97706' }]}>{inr(stats.pendingAmt)}</Text>
          <Text style={styles.statSub}>{stats.pendingCount} In Approval Section</Text>
        </Pressable>
        <View style={styles.statDivider} />
        <View style={styles.statBox}>
          <Text style={styles.statLabel}>TOTAL OUTFLOW</Text>
          <Text style={[styles.statValue, { color: '#0F172A' }]}>{inr(stats.totalAmt)}</Text>
          <Text style={styles.statSub}>{stats.totalCount} Vouchers</Text>
        </View>
      </View>

      {/* Status Segmented Tabs */}
      <View style={styles.tabBar}>
        <Pressable
          onPress={() => setStatusTab('approved')}
          style={[styles.tabItem, (statusTab === 'approved' || statusTab === 'all') && styles.tabItemActive]}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <View style={[styles.statusDot, { backgroundColor: '#059669' }]} />
            <Text style={[styles.tabItemTxt, (statusTab === 'approved' || statusTab === 'all') && styles.tabItemTxtActive]}>
              Approved Expenses ({stats.approvedCount})
            </Text>
          </View>
        </Pressable>
        <Pressable
          onPress={() => setStatusTab('pending')}
          style={[styles.tabItem, statusTab === 'pending' && styles.tabItemActive]}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <View style={[styles.statusDot, { backgroundColor: '#D97706' }]} />
            <Text style={[styles.tabItemTxt, statusTab === 'pending' && styles.tabItemTxtActive]}>
              Pending Approval ({stats.pendingCount})
            </Text>
          </View>
        </Pressable>
        <Pressable
          onPress={() => setStatusTab('rejected')}
          style={[styles.tabItem, statusTab === 'rejected' && styles.tabItemActive]}
        >
          <Text style={[styles.tabItemTxt, statusTab === 'rejected' && styles.tabItemTxtActive]}>
            Rejected
          </Text>
        </Pressable>
      </View>

      {/* Main Search & Control Bar */}
      <View style={styles.searchSection}>
        <View style={styles.searchRow}>
          <View style={styles.searchBox}>
            <Ionicons name="search" size={18} color="#64748B" style={{ marginLeft: 4 }} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search EXP, Voucher, Customer, Vendor, Mobile, PAN..."
              placeholderTextColor="#94A3B8"
              value={searchQuery}
              onChangeText={setSearchQuery}
              returnKeyType="search"
              autoCapitalize="none"
              autoCorrect={false}
              testID="search-exp-input"
            />
            {searchQuery ? (
              <Pressable onPress={() => setSearchQuery('')} hitSlop={10} style={styles.clearBtn}>
                <Ionicons name="close-circle" size={18} color="#94A3B8" />
              </Pressable>
            ) : null}
          </View>

          {/* Filters Modal Trigger */}
          <Pressable
            onPress={() => setShowFilterModal(true)}
            style={[styles.filterBtn, activeFilterCount > 0 && styles.filterBtnActive]}
          >
            <Ionicons
              name="options-outline"
              size={18}
              color={activeFilterCount > 0 ? '#FFF' : '#334155'}
            />
            <Text
              style={[
                styles.filterBtnTxt,
                activeFilterCount > 0 && { color: '#FFF', fontWeight: '800' },
              ]}
            >
              Filter{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
            </Text>
          </Pressable>

          {/* Sort Button Trigger */}
          <Pressable onPress={() => setShowSortModal(true)} style={styles.sortBtn}>
            <Ionicons name="swap-vertical" size={18} color="#334155" />
          </Pressable>
        </View>

        {/* Horizontal Category Quick-Pills */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.categoryScroll}>
          <View style={styles.categoryScrollInner}>
            <Pressable
              onPress={() => setSelectedCategory('all')}
              style={[styles.catPillItem, selectedCategory === 'all' && styles.catPillItemActive]}
            >
              <Text
                style={[
                  styles.catPillItemTxt,
                  selectedCategory === 'all' && styles.catPillItemTxtActive,
                ]}
              >
                All Categories
              </Text>
            </Pressable>
            {Array.from(new Set([...EXPENSE_CATEGORIES, ...customCats])).map((c) => (
              <Pressable
                key={c}
                onPress={() => setSelectedCategory(selectedCategory === c ? 'all' : c)}
                style={[styles.catPillItem, selectedCategory === c && styles.catPillItemActive]}
              >
                <Text
                  style={[
                    styles.catPillItemTxt,
                    selectedCategory === c && styles.catPillItemTxtActive,
                  ]}
                >
                  {c}
                </Text>
              </Pressable>
            ))}
            {isAdmin && (
              <Pressable
                onPress={() => setShowAddCatModal(true)}
                style={[styles.catPillItem, { backgroundColor: '#EFF6FF', borderColor: '#BFDBFE' }]}
              >
                <Ionicons name="add" size={14} color="#2563EB" />
                <Text style={[styles.catPillItemTxt, { color: '#2563EB', fontWeight: '800' }]}>+ Add Category</Text>
              </Pressable>
            )}
          </View>
        </ScrollView>

        {/* Active Filter Chips Bar */}
        {(activeFilterCount > 0 || searchQuery.trim()) && (
          <View style={styles.activeFiltersRow}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={styles.activeFiltersLabel}>Active:</Text>
                {searchQuery ? (
                  <View style={styles.activeChip}>
                    <Text style={styles.activeChipTxt}>"{searchQuery}"</Text>
                    <Pressable onPress={() => setSearchQuery('')} hitSlop={6}>
                      <Ionicons name="close" size={13} color="#0284C7" />
                    </Pressable>
                  </View>
                ) : null}
                {selectedCategory !== 'all' ? (
                  <View style={styles.activeChip}>
                    <Text style={styles.activeChipTxt}>Cat: {selectedCategory}</Text>
                    <Pressable onPress={() => setSelectedCategory('all')} hitSlop={6}>
                      <Ionicons name="close" size={13} color="#0284C7" />
                    </Pressable>
                  </View>
                ) : null}
                {selectedCustomerObj ? (
                  <View style={styles.activeChip}>
                    <Text style={styles.activeChipTxt}>Cust: {selectedCustomerObj.name}</Text>
                    <Pressable onPress={() => setSelectedCustomerId('all')} hitSlop={6}>
                      <Ionicons name="close" size={13} color="#0284C7" />
                    </Pressable>
                  </View>
                ) : null}
                {datePreset !== 'all' ? (
                  <View style={styles.activeChip}>
                    <Text style={styles.activeChipTxt}>
                      Date: {DATE_PRESETS.find((p) => p.key === datePreset)?.label}
                    </Text>
                    <Pressable onPress={() => setDatePreset('all')} hitSlop={6}>
                      <Ionicons name="close" size={13} color="#0284C7" />
                    </Pressable>
                  </View>
                ) : null}
                {filterItemText ? (
                  <View style={styles.activeChip}>
                    <Text style={styles.activeChipTxt}>Item: {filterItemText}</Text>
                    <Pressable onPress={() => setFilterItemText('')} hitSlop={6}>
                      <Ionicons name="close" size={13} color="#0284C7" />
                    </Pressable>
                  </View>
                ) : null}
                {filterVoucherText ? (
                  <View style={styles.activeChip}>
                    <Text style={styles.activeChipTxt}>Voucher: {filterVoucherText}</Text>
                    <Pressable onPress={() => setFilterVoucherText('')} hitSlop={6}>
                      <Ionicons name="close" size={13} color="#0284C7" />
                    </Pressable>
                  </View>
                ) : null}
                {filterNameText ? (
                  <View style={styles.activeChip}>
                    <Text style={styles.activeChipTxt}>Name: {filterNameText}</Text>
                    <Pressable onPress={() => setFilterNameText('')} hitSlop={6}>
                      <Ionicons name="close" size={13} color="#0284C7" />
                    </Pressable>
                  </View>
                ) : null}
                {minAmount || maxAmount ? (
                  <View style={styles.activeChip}>
                    <Text style={styles.activeChipTxt}>
                      ₹{minAmount || '0'} - ₹{maxAmount || '∞'}
                    </Text>
                    <Pressable
                      onPress={() => {
                        setMinAmount('');
                        setMaxAmount('');
                      }}
                      hitSlop={6}
                    >
                      <Ionicons name="close" size={13} color="#0284C7" />
                    </Pressable>
                  </View>
                ) : null}
                {selectedPaymentMode !== 'all' ? (
                  <View style={styles.activeChip}>
                    <Text style={styles.activeChipTxt}>Mode: {selectedPaymentMode.toUpperCase()}</Text>
                    <Pressable onPress={() => setSelectedPaymentMode('all')} hitSlop={6}>
                      <Ionicons name="close" size={13} color="#0284C7" />
                    </Pressable>
                  </View>
                ) : null}
                <Pressable onPress={resetAllFilters} style={styles.resetAllBtn}>
                  <Text style={styles.resetAllBtnTxt}>Reset All</Text>
                </Pressable>
              </View>
            </ScrollView>
          </View>
        )}
      </View>

      {/* Content List */}
      {list === null || loading ? (
        <ScreenLoader />
      ) : list.length === 0 ? (
        <EmptyState
          testID="expenses-empty"
          icon="wallet-outline"
          title="No expenses created yet"
          subtitle="Track outflows, create claims, and manage workflow approvals."
          actionLabel="Add Expense"
          onAction={() => router.push('/accounting/expenses/new' as any)}
        />
      ) : filteredList && filteredList.length === 0 ? (
        <View style={styles.noMatchCard}>
          <Ionicons name="search-outline" size={44} color="#94A3B8" />
          <Text style={styles.noMatchTitle}>No matching expenses found</Text>
          <Text style={styles.noMatchSub}>
            Try clearing active filters or searching with a different term (EXP No., Vendor, Customer,
            Amount, Date).
          </Text>
          <Pressable onPress={resetAllFilters} style={styles.clearSearchBtn}>
            <Ionicons name="refresh" size={16} color="#FFF" />
            <Text style={styles.clearSearchBtnTxt}>Reset All Filters</Text>
          </Pressable>
        </View>
      ) : (
        <>
          {statusTab === 'pending' && (
            <Pressable
              onPress={() => router.push('/accounting/expenses/approval' as any)}
              style={styles.pendingWorkflowBanner}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                <Ionicons name="git-pull-request-outline" size={24} color="#D97706" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.pendingWorkflowTitle}>
                    Pending Claims Awaiting Workflow Approval ({stats.pendingCount})
                  </Text>
                  <Text style={styles.pendingWorkflowSub}>
                    Expenses do not show in All Expenses until verified & approved. Tap here to approve itemwise in Expense Approval Section.
                  </Text>
                </View>
              </View>
              <View style={styles.pendingWorkflowBtn}>
                <Text style={styles.pendingWorkflowBtnTxt}>Open Approval Workflow ➔</Text>
              </View>
            </Pressable>
          )}

          {statusTab !== 'pending' && stats.pendingCount > 0 && (
            <Pressable
              onPress={() => setStatusTab('pending')}
              style={styles.pendingNoticePill}
            >
              <Ionicons name="information-circle-outline" size={16} color="#0D9488" />
              <Text style={styles.pendingNoticePillTxt}>
                Notice: {stats.pendingCount} expense claim(s) pending approval. They will show here once approved.
              </Text>
              <Text style={styles.pendingNoticePillLink}>View Pending</Text>
            </Pressable>
          )}

          <FlatList
            data={filteredList}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ padding: spacing.md, gap: spacing.md, paddingBottom: 100 }}
          renderItem={({ item }) => {
            const isPending =
              item.status === 'pending' || item.status === 'submitted' || item.status === 'verified';
            const linkedVoucher = item.linked_voucher_no;

            return (
              <View style={styles.expCard} testID={`exp-card-${item.id}`}>
                {/* Header Row */}
                <View style={styles.cardHeader}>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <Text style={styles.expNo}>{item.expense_no || 'EXP'}</Text>
                      <Text style={styles.dateTxt}>• {item.date}</Text>
                      {item.linked_voucher_no ? (
                        <Pressable
                          onPress={() =>
                            router.push(
                              `/accounting/expenses/approval/${item.linked_approval_id || item.linked_voucher_no}` as any
                            )
                          }
                          style={styles.linkedVoucherChip}
                        >
                          <Ionicons name="git-network-outline" size={11} color="#6366F1" />
                          <Text style={styles.linkedVoucherChipTxt}>{item.linked_voucher_no}</Text>
                        </Pressable>
                      ) : null}
                    </View>
                    <Text style={styles.categoryTitle}>{item.category}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 4 }}>
                    <Text style={styles.amtTxt}>{inr(item.amount)}</Text>
                    <StatusBadge status={item.status} />
                  </View>
                </View>

                {/* Paid To & Mode */}
                <View style={styles.vendorRow}>
                  <Ionicons name="business-outline" size={14} color="#64748B" />
                  <Text style={styles.vendorTxt}>
                    Paid To: <Text style={{ fontWeight: '700', color: '#1E293B' }}>{item.vendor || 'N/A'}</Text>
                  </Text>
                  {String(item.payment_mode || 'cash').toLowerCase() === 'cash' ? (
                    <View style={[styles.modeBadge, { backgroundColor: '#F0FDF4', borderColor: '#BBF7D0', borderWidth: 1 }]}>
                      <Ionicons name="cash-outline" size={12} color="#15803D" />
                      <Text style={[styles.modeBadgeTxt, { color: '#15803D', fontWeight: '800' }]}>CASH</Text>
                    </View>
                  ) : (
                    <View style={[styles.modeBadge, { backgroundColor: '#EFF6FF', borderColor: '#BFDBFE', borderWidth: 1 }]}>
                      <Ionicons name="business" size={12} color="#1E40AF" />
                      <Text style={[styles.modeBadgeTxt, { color: '#1E40AF', fontWeight: '800' }]}>
                        {getExpenseBankLabel(item)}
                      </Text>
                    </View>
                  )}
                </View>

                {/* Customer & Sale Metadata Badges */}
                {(item.customer_name ||
                  item.customer_mobile ||
                  item.customer_pan ||
                  item.customer_gst ||
                  item.sale_invoice_no) && (
                  <View style={styles.custMetaContainer}>
                    {item.customer_name ? (
                      <View style={styles.metaBadge}>
                        <Ionicons name="person-outline" size={12} color="#0284C7" />
                        <Text style={styles.metaBadgeTxt} numberOfLines={1}>
                          {item.customer_name}
                        </Text>
                      </View>
                    ) : null}
                    {item.customer_mobile ? (
                      <View style={styles.metaBadge}>
                        <Ionicons name="call-outline" size={12} color="#059669" />
                        <Text style={styles.metaBadgeTxt}>{item.customer_mobile}</Text>
                      </View>
                    ) : null}
                    {item.customer_pan ? (
                      <View style={[styles.metaBadge, { backgroundColor: '#FEF3C7', borderColor: '#FDE68A' }]}>
                        <Text style={[styles.metaBadgeTxt, { color: '#B45309', fontWeight: '800' }]}>
                          PAN: {item.customer_pan}
                        </Text>
                      </View>
                    ) : null}
                    {item.customer_gst ? (
                      <View style={[styles.metaBadge, { backgroundColor: '#F3E8FF', borderColor: '#E9D5FF' }]}>
                        <Text style={[styles.metaBadgeTxt, { color: '#7E22CE', fontWeight: '800' }]}>
                          GST: {item.customer_gst}
                        </Text>
                      </View>
                    ) : null}
                    {item.sale_invoice_no ? (
                      <View style={[styles.metaBadge, { backgroundColor: '#E0E7FF', borderColor: '#C7D2FE' }]}>
                        <Ionicons name="receipt-outline" size={12} color="#3730A3" />
                        <Text style={[styles.metaBadgeTxt, { color: '#3730A3', fontWeight: '800' }]}>
                          Sale: {item.sale_invoice_no} {item.sale_item_name ? `(${item.sale_item_name})` : ''}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                )}

                {/* Description */}
                {item.description ? (
                  <Text style={styles.descTxt} numberOfLines={2}>
                    {item.description}
                  </Text>
                ) : null}

                {/* Pending Approval Alert Bar */}
                {isPending && linkedVoucher ? (
                  <Pressable
                    onPress={() =>
                      router.push(
                        `/accounting/expenses/approval/${item.linked_approval_id || item.linked_voucher_no}` as any
                      )
                    }
                    style={styles.pendingBar}
                  >
                    <Ionicons name="time-outline" size={16} color="#D97706" />
                    <Text style={styles.pendingBarTxt}>
                      Workflow Approval in progress ({linkedVoucher}) • Tap to verify / approve
                    </Text>
                    <Ionicons name="arrow-forward" size={14} color="#D97706" />
                  </Pressable>
                ) : null}

                {/* Actions Row */}
                <View style={styles.cardActionsRow}>
                  {/* Print */}
                  <Pressable
                    onPress={() => handlePrint(item)}
                    style={styles.actionBtnPrint}
                    testID={`print-exp-${item.id}`}
                  >
                    {printingId === item.id ? (
                      <ActivityIndicator size="small" color="#0369A1" />
                    ) : (
                      <>
                        <Ionicons name="print-outline" size={15} color="#0369A1" />
                        <Text style={styles.actionBtnPrintTxt}>Print</Text>
                      </>
                    )}
                  </Pressable>

                  {/* View Full Details */}
                  <Pressable
                    onPress={() => setViewingExp(item)}
                    style={styles.actionBtnView}
                    testID={`view-exp-${item.id}`}
                  >
                    <Ionicons name="eye-outline" size={15} color="#475569" />
                    <Text style={styles.actionBtnViewTxt}>View</Text>
                  </Pressable>

                  {/* Edit */}
                  <Pressable
                    onPress={() => openEdit(item)}
                    style={styles.actionBtnEdit}
                    testID={`edit-exp-${item.id}`}
                  >
                    <Ionicons name="create-outline" size={15} color="#4338CA" />
                    <Text style={styles.actionBtnEditTxt}>Edit</Text>
                  </Pressable>

                  {/* Delete */}
                  {canDelete && (
                    <Pressable
                      onPress={() => handleDeleteExpense(item)}
                      style={styles.actionBtnDelete}
                      testID={`delete-exp-${item.id}`}
                      disabled={deletingId === item.id}
                    >
                      {deletingId === item.id ? (
                        <ActivityIndicator size="small" color="#DC2626" />
                      ) : (
                        <>
                          <Ionicons name="trash-outline" size={15} color="#DC2626" />
                          <Text style={styles.actionBtnDeleteTxt}>Delete</Text>
                        </>
                      )}
                    </Pressable>
                  )}
                </View>
              </View>
            );
          }}
          />
        </>
      )}

      {/* ================= VIEW DETAILS MODAL ================= */}
      <Modal
        visible={!!viewingExp}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setViewingExp(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>Expense Voucher Details</Text>
                <Text style={styles.modalSubtitle}>{viewingExp?.expense_no || 'EXP'}</Text>
              </View>
              <Pressable onPress={() => setViewingExp(null)} style={styles.modalCloseBtn} hitSlop={8}>
                <Ionicons name="close" size={20} color="#64748B" />
              </Pressable>
            </View>

            {viewingExp && (
              <ScrollView style={{ maxHeight: 480 }} showsVerticalScrollIndicator={false}>
                <View style={{ gap: 12, paddingVertical: 4 }}>
                  {/* Amount & Status Hero Card */}
                  <View style={styles.viewHeroCard}>
                    <View>
                      <Text style={styles.viewHeroLabel}>TOTAL AMOUNT</Text>
                      <Text style={styles.viewHeroAmount}>{inr(viewingExp.amount)}</Text>
                      <Text style={styles.viewHeroDate}>Voucher Date: {viewingExp.date}</Text>
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 6 }}>
                      <StatusBadge status={viewingExp.status} />
                      <View style={styles.modeBadge}>
                        <Text style={styles.modeBadgeTxt}>
                          {String(viewingExp.payment_mode || 'cash').toUpperCase()}
                        </Text>
                      </View>
                    </View>
                  </View>

                  {/* Category & Vendor */}
                  <View style={styles.detailBlock}>
                    <Text style={styles.detailBlockTitle}>EXPENSE PARTICULARS</Text>
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>Category:</Text>
                      <Text style={styles.detailValueBold}>{viewingExp.category}</Text>
                    </View>
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>Paid To (Vendor):</Text>
                      <Text style={styles.detailValueBold}>{viewingExp.vendor || 'N/A'}</Text>
                    </View>
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>Payment Mode:</Text>
                      <Text style={styles.detailValueBold}>{String(viewingExp.payment_mode || 'cash').toUpperCase()}</Text>
                    </View>
                    {String(viewingExp.payment_mode || 'cash').toLowerCase() !== 'cash' && (
                      <View style={styles.detailRow}>
                        <Text style={styles.detailLabel}>Bank Account:</Text>
                        <Text style={[styles.detailValueBold, { color: '#1E40AF' }]}>{getExpenseBankLabel(viewingExp)}</Text>
                      </View>
                    )}
                    {viewingExp.description ? (
                      <View style={{ marginTop: 4 }}>
                        <Text style={styles.detailLabel}>Narration / Remarks:</Text>
                        <Text style={styles.detailDescBox}>{viewingExp.description}</Text>
                      </View>
                    ) : null}
                  </View>

                  {/* Customer Information (if available) */}
                  {(viewingExp.customer_name || viewingExp.customer_mobile || viewingExp.customer_pan) && (
                    <View style={styles.detailBlock}>
                      <Text style={styles.detailBlockTitle}>CUSTOMER / CLIENT DETAILS</Text>
                      {viewingExp.customer_name ? (
                        <View style={styles.detailRow}>
                          <Text style={styles.detailLabel}>Customer Name:</Text>
                          <Text style={styles.detailValueBold}>{viewingExp.customer_name}</Text>
                        </View>
                      ) : null}
                      {viewingExp.customer_mobile ? (
                        <View style={styles.detailRow}>
                          <Text style={styles.detailLabel}>Mobile No:</Text>
                          <Text style={styles.detailValue}>{viewingExp.customer_mobile}</Text>
                        </View>
                      ) : null}
                      {viewingExp.customer_pan ? (
                        <View style={styles.detailRow}>
                          <Text style={styles.detailLabel}>PAN No:</Text>
                          <Text style={[styles.detailValue, { fontWeight: '800', color: '#B45309' }]}>
                            {viewingExp.customer_pan}
                          </Text>
                        </View>
                      ) : null}
                      {viewingExp.customer_gst ? (
                        <View style={styles.detailRow}>
                          <Text style={styles.detailLabel}>GSTIN:</Text>
                          <Text style={[styles.detailValue, { fontWeight: '800', color: '#7E22CE' }]}>
                            {viewingExp.customer_gst}
                          </Text>
                        </View>
                      ) : null}
                      {viewingExp.sale_invoice_no ? (
                        <View style={styles.detailRow}>
                          <Text style={styles.detailLabel}>Linked Sale Invoice:</Text>
                          <Text style={[styles.detailValueBold, { color: '#3730A3' }]}>
                            {viewingExp.sale_invoice_no} {viewingExp.sale_item_name ? `(${viewingExp.sale_item_name})` : ''}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                  )}

                  {/* Workflow & Approval Information */}
                  {viewingExp.linked_voucher_no ? (
                    <View style={[styles.detailBlock, { backgroundColor: '#F0F9FF', borderColor: '#BAE6FD' }]}>
                      <Text style={[styles.detailBlockTitle, { color: '#0369A1' }]}>
                        WORKFLOW APPROVAL INTEGRATION
                      </Text>
                      <View style={styles.detailRow}>
                        <Text style={styles.detailLabel}>Approval Voucher:</Text>
                        <Text style={[styles.detailValueBold, { color: '#0284C7' }]}>
                          {viewingExp.linked_voucher_no}
                        </Text>
                      </View>
                      {viewingExp.approved_by ? (
                        <View style={styles.detailRow}>
                          <Text style={styles.detailLabel}>Approved By:</Text>
                          <Text style={styles.detailValueBold}>{viewingExp.approved_by}</Text>
                        </View>
                      ) : null}
                      {viewingExp.approved_at ? (
                        <View style={styles.detailRow}>
                          <Text style={styles.detailLabel}>Approved At:</Text>
                          <Text style={styles.detailValue}>{viewingExp.approved_at}</Text>
                        </View>
                      ) : null}

                      <Pressable
                        onPress={() => {
                          const target = viewingExp.linked_approval_id || viewingExp.linked_voucher_no;
                          setViewingExp(null);
                          router.push(`/accounting/expenses/approval/${target}` as any);
                        }}
                        style={styles.viewWorkflowBtn}
                      >
                        <Ionicons name="git-network-outline" size={16} color="#FFF" />
                        <Text style={styles.viewWorkflowBtnTxt}>Open Workflow Approval Voucher</Text>
                      </Pressable>
                    </View>
                  ) : null}
                </View>
              </ScrollView>
            )}

            <View style={styles.modalFooter}>
              <Pressable
                onPress={() => {
                  const itm = viewingExp;
                  setViewingExp(null);
                  handlePrint(itm);
                }}
                style={styles.detailModalPrintBtn}
              >
                <Ionicons name="print-outline" size={18} color="#0369A1" />
                <Text style={{ color: '#0369A1', fontWeight: '800', fontSize: font.sm }}>Print PDF</Text>
              </Pressable>

              <Pressable
                onPress={() => {
                  const itm = viewingExp;
                  setViewingExp(null);
                  openEdit(itm);
                }}
                style={styles.detailModalEditBtn}
              >
                <Ionicons name="create-outline" size={18} color="#FFF" />
                <Text style={{ color: '#FFF', fontWeight: '800', fontSize: font.sm }}>Edit Expense</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* ================= CUSTOM FILTERS MODAL ================= */}
      <Modal
        visible={showFilterModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowFilterModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>Filter Expenses</Text>
                <Text style={styles.modalSubtitle}>Customize criteria & presets</Text>
              </View>
              <Pressable onPress={() => setShowFilterModal(false)} style={styles.modalCloseBtn} hitSlop={8}>
                <Ionicons name="close" size={20} color="#64748B" />
              </Pressable>
            </View>

            <ScrollView style={{ maxHeight: 480 }} showsVerticalScrollIndicator={false}>
              <View style={{ gap: 14, paddingVertical: 6 }}>
                {/* 1. Date Presets & Custom Range */}
                <View>
                  <Text style={styles.filterSectionLabel}>Date Range</Text>
                  <View style={styles.presetRow}>
                    {DATE_PRESETS.map((p) => (
                      <Pressable
                        key={p.key}
                        onPress={() => setDatePreset(p.key)}
                        style={[styles.presetChip, datePreset === p.key && styles.presetChipActive]}
                      >
                        <Text
                          style={[
                            styles.presetChipTxt,
                            datePreset === p.key && styles.presetChipTxtActive,
                          ]}
                        >
                          {p.label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>

                  {datePreset === 'custom' && (
                    <View style={[styles.formRow, { marginTop: 8 }]}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.formSubLabel}>From Date (YYYY-MM-DD)</Text>
                        <TextInput
                          style={styles.formInput}
                          placeholder="2026-01-01"
                          value={customFromDate}
                          onChangeText={setCustomFromDate}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.formSubLabel}>To Date (YYYY-MM-DD)</Text>
                        <TextInput
                          style={styles.formInput}
                          placeholder="2026-12-31"
                          value={customToDate}
                          onChangeText={setCustomToDate}
                        />
                      </View>
                    </View>
                  )}
                </View>

                {/* 2. Customer Wise Filter */}
                <View>
                  <Text style={styles.filterSectionLabel}>Customer / Client</Text>
                  <TextInput
                    style={[styles.formInput, { marginBottom: 6 }]}
                    placeholder="Search customer name..."
                    value={filterCustomerSearch}
                    onChangeText={setFilterCustomerSearch}
                  />
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <View style={{ flexDirection: 'row', gap: 6 }}>
                      <Pressable
                        onPress={() => setSelectedCustomerId('all')}
                        style={[
                          styles.customerPill,
                          selectedCustomerId === 'all' && styles.customerPillActive,
                        ]}
                      >
                        <Text
                          style={[
                            styles.customerPillTxt,
                            selectedCustomerId === 'all' && styles.customerPillTxtActive,
                          ]}
                        >
                          All Customers
                        </Text>
                      </Pressable>
                      {customers
                        .filter(
                          (c) =>
                            !filterCustomerSearch ||
                            c.name?.toLowerCase().includes(filterCustomerSearch.toLowerCase())
                        )
                        .slice(0, 15)
                        .map((c) => (
                          <Pressable
                            key={c.id}
                            onPress={() =>
                              setSelectedCustomerId(selectedCustomerId === c.id ? 'all' : c.id)
                            }
                            style={[
                              styles.customerPill,
                              selectedCustomerId === c.id && styles.customerPillActive,
                            ]}
                          >
                            <Text
                              style={[
                                styles.customerPillTxt,
                                selectedCustomerId === c.id && styles.customerPillTxtActive,
                              ]}
                            >
                              {c.name}
                            </Text>
                          </Pressable>
                        ))}
                    </View>
                  </ScrollView>
                </View>

                {/* 3. Amount Wise Filter */}
                <View>
                  <Text style={styles.filterSectionLabel}>Amount Range (₹)</Text>
                  <View style={styles.formRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.formSubLabel}>Min Amount (₹)</Text>
                      <TextInput
                        style={styles.formInput}
                        placeholder="0.00"
                        keyboardType="numeric"
                        value={minAmount}
                        onChangeText={setMinAmount}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.formSubLabel}>Max Amount (₹)</Text>
                      <TextInput
                        style={styles.formInput}
                        placeholder="Unlimited"
                        keyboardType="numeric"
                        value={maxAmount}
                        onChangeText={setMaxAmount}
                      />
                    </View>
                  </View>
                </View>

                {/* 4. Voucher Wise Filter */}
                <View>
                  <Text style={styles.filterSectionLabel}>Voucher / Reference No</Text>
                  <TextInput
                    style={styles.formInput}
                    placeholder="e.g. EXP-2026, EXP-APP, INV-1002..."
                    value={filterVoucherText}
                    onChangeText={setFilterVoucherText}
                  />
                </View>

                {/* 5. Item / Particulars Wise Filter */}
                <View>
                  <Text style={styles.filterSectionLabel}>Item Name / Description</Text>
                  <TextInput
                    style={styles.formInput}
                    placeholder="e.g. Rent, Hardware, Diesel, Service..."
                    value={filterItemText}
                    onChangeText={setFilterItemText}
                  />
                </View>

                {/* 6. Name Wise Filter (Vendor, Customer, Submitter) */}
                <View>
                  <Text style={styles.filterSectionLabel}>Person / Party Name</Text>
                  <TextInput
                    style={styles.formInput}
                    placeholder="Vendor, Submitter, Approver..."
                    value={filterNameText}
                    onChangeText={setFilterNameText}
                  />
                </View>

                {/* 7. Payment Mode Filter */}
                <View>
                  <Text style={styles.filterSectionLabel}>Payment Mode</Text>
                  <View style={styles.modeSelector}>
                    <Pressable
                      onPress={() => setSelectedPaymentMode('all')}
                      style={[
                        styles.modeChoice,
                        selectedPaymentMode === 'all' && styles.modeChoiceActive,
                      ]}
                    >
                      <Text
                        style={[
                          styles.modeChoiceTxt,
                          selectedPaymentMode === 'all' && styles.modeChoiceTxtActive,
                        ]}
                      >
                        ALL
                      </Text>
                    </Pressable>
                    {PAYMENT_MODES.map((m) => (
                      <Pressable
                        key={m}
                        onPress={() => setSelectedPaymentMode(m)}
                        style={[
                          styles.modeChoice,
                          selectedPaymentMode === m && styles.modeChoiceActive,
                        ]}
                      >
                        <Text
                          style={[
                            styles.modeChoiceTxt,
                            selectedPaymentMode === m && styles.modeChoiceTxtActive,
                          ]}
                        >
                          {m.toUpperCase()}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              </View>
            </ScrollView>

            <View style={styles.modalFooter}>
              <Pressable
                onPress={() => {
                  resetAllFilters();
                  setShowFilterModal(false);
                }}
                style={styles.cancelBtn}
              >
                <Text style={styles.cancelBtnTxt}>Reset All</Text>
              </Pressable>

              <Pressable onPress={() => setShowFilterModal(false)} style={styles.saveBtn}>
                <Ionicons name="checkmark" size={18} color="#FFF" />
                <Text style={styles.saveBtnTxt}>Apply Filters</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* ================= SORT MODAL ================= */}
      <Modal
        visible={showSortModal}
        animationType="fade"
        transparent={true}
        onRequestClose={() => setShowSortModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxWidth: 380 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Sort Expenses</Text>
              <Pressable onPress={() => setShowSortModal(false)} style={styles.modalCloseBtn}>
                <Ionicons name="close" size={20} color="#64748B" />
              </Pressable>
            </View>

            <View style={{ gap: 8, paddingVertical: 8 }}>
              {SORT_OPTIONS.map((opt) => (
                <Pressable
                  key={opt.key}
                  onPress={() => {
                    setSortBy(opt.key);
                    setShowSortModal(false);
                  }}
                  style={[styles.sortOptionRow, sortBy === opt.key && styles.sortOptionRowActive]}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <Ionicons
                      name={opt.icon as any}
                      size={20}
                      color={sortBy === opt.key ? colors.brandPrimary : '#64748B'}
                    />
                    <Text
                      style={[
                        styles.sortOptionTxt,
                        sortBy === opt.key && styles.sortOptionTxtActive,
                      ]}
                    >
                      {opt.label}
                    </Text>
                  </View>
                  {sortBy === opt.key && (
                    <Ionicons name="checkmark-circle" size={20} color={colors.brandPrimary} />
                  )}
                </Pressable>
              ))}
            </View>
          </View>
        </View>
      </Modal>

      {/* ================= EDIT MODAL ================= */}
      <Modal
        visible={!!editingExp}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setEditingExp(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent} testID="edit-expense-modal">
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>Edit Expense Voucher</Text>
                <Text style={styles.modalSubtitle}>{editingExp?.expense_no || 'EXP'}</Text>
              </View>
              <Pressable
                onPress={() => setEditingExp(null)}
                style={styles.modalCloseBtn}
                hitSlop={8}
                testID="close-edit-modal-btn"
              >
                <Ionicons name="close" size={20} color="#64748B" />
              </Pressable>
            </View>

            <ScrollView style={{ maxHeight: 460 }} showsVerticalScrollIndicator={false}>
              <View style={styles.formSection}>
                {/* Amount & Date */}
                <View style={styles.formRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.formLabel}>Amount (₹) *</Text>
                    <TextInput
                      style={[styles.formInput, { fontWeight: '800', color: '#DC2626' }]}
                      keyboardType="numeric"
                      value={editForm.amount}
                      onChangeText={(t) => setEditForm((p) => ({ ...p, amount: t }))}
                      placeholder="0.00"
                      testID="edit-exp-amount"
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.formLabel}>Date (YYYY-MM-DD) *</Text>
                    <TextInput
                      style={styles.formInput}
                      value={editForm.date}
                      onChangeText={(t) => setEditForm((p) => ({ ...p, date: t }))}
                      placeholder="YYYY-MM-DD"
                      testID="edit-exp-date"
                    />
                  </View>
                </View>

                {/* Category & Payment Mode */}
                <View style={styles.formRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.formLabel}>Category *</Text>
                    <TextInput
                      style={styles.formInput}
                      value={editForm.category}
                      onChangeText={(t) => setEditForm((p) => ({ ...p, category: t }))}
                      placeholder="e.g. Office Rent, Travel"
                      testID="edit-exp-category"
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.formLabel}>Payment Mode</Text>
                    <View style={styles.modeSelector}>
                      {PAYMENT_MODES.map((m) => (
                        <Pressable
                          key={m}
                          onPress={() => setEditForm((p) => ({ ...p, payment_mode: m }))}
                          style={[
                            styles.modeChoice,
                            editForm.payment_mode === m && styles.modeChoiceActive,
                          ]}
                        >
                          <Text
                            style={[
                              styles.modeChoiceTxt,
                              editForm.payment_mode === m && styles.modeChoiceTxtActive,
                            ]}
                          >
                            {m.toUpperCase()}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                </View>

                {/* Bank Account Selection (if not cash) */}
                {editForm.payment_mode !== 'cash' && banks.length > 0 ? (
                  <View style={{ gap: 6, marginVertical: 6 }}>
                    <Text style={styles.formLabel}>Bank Account</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                      {banks.map(b => {
                        const isSelected = (editForm.bank_account_id || banks[0]?.id) === b.id;
                        const lbl = getBankShortLabel(b);
                        return (
                          <Pressable
                            key={b.id}
                            onPress={() => setEditForm(p => ({ ...p, bank_account_id: b.id }))}
                            style={[
                              styles.bankChipBtn,
                              isSelected && styles.bankChipBtnActive
                            ]}
                            testID={`edit-bank-chip-${b.id}`}
                          >
                            <Ionicons
                              name={isSelected ? "checkmark-circle" : "ellipse-outline"}
                              size={15}
                              color={isSelected ? "#FFF" : "#2563EB"}
                            />
                            <Text style={[
                              styles.bankChipTxt,
                              isSelected && styles.bankChipTxtActive
                            ]}>
                              {lbl}
                            </Text>
                          </Pressable>
                        );
                      })}

                      <Pressable
                        onPress={() => setShowAddBankModal(true)}
                        style={styles.addBankBtn}
                        testID="btn-add-bank-account-edit"
                      >
                        <Ionicons name="add-circle" size={16} color="#2563EB" />
                        <Text style={styles.addBankTxt}>+ Add Account</Text>
                      </Pressable>
                    </View>
                  </View>
                ) : null}

                {/* Category Quick Picks */}
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginVertical: 4 }}>
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    {EXPENSE_CATEGORIES.slice(0, 7).map((c) => (
                      <Pressable
                        key={c}
                        onPress={() => setEditForm((p) => ({ ...p, category: c }))}
                        style={[styles.catPill, editForm.category === c && styles.catPillActive]}
                      >
                        <Text
                          style={[styles.catPillTxt, editForm.category === c && styles.catPillTxtActive]}
                        >
                          {c}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </ScrollView>

                {/* Paid To / Vendor */}
                <View>
                  <Text style={styles.formLabel}>Paid To / Vendor Name</Text>
                  <TextInput
                    style={styles.formInput}
                    value={editForm.vendor}
                    onChangeText={(t) => setEditForm((p) => ({ ...p, vendor: t }))}
                    placeholder="e.g. Landlord, Supplier, Contractor"
                    testID="edit-exp-vendor"
                  />
                </View>

                {/* Customer Details Section */}
                <View style={styles.subCard}>
                  <Text style={styles.subCardTitle}>Client / Customer Details (Optional)</Text>
                  <View style={styles.formRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.formLabel}>Customer Name</Text>
                      <TextInput
                        style={styles.formInput}
                        value={editForm.customer_name}
                        onChangeText={(t) => setEditForm((p) => ({ ...p, customer_name: t }))}
                        placeholder="Customer / Firm"
                        testID="edit-exp-cust-name"
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.formLabel}>Mobile No.</Text>
                      <TextInput
                        style={styles.formInput}
                        value={editForm.customer_mobile}
                        onChangeText={(t) => setEditForm((p) => ({ ...p, customer_mobile: t }))}
                        placeholder="10-digit Mobile"
                        keyboardType="phone-pad"
                        testID="edit-exp-cust-mobile"
                      />
                    </View>
                  </View>

                  <View style={styles.formRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.formLabel}>PAN No.</Text>
                      <TextInput
                        style={[styles.formInput, { textTransform: 'uppercase' }]}
                        value={editForm.customer_pan}
                        onChangeText={(t) => setEditForm((p) => ({ ...p, customer_pan: t.toUpperCase() }))}
                        placeholder="ABCDE1234F"
                        autoCapitalize="characters"
                        testID="edit-exp-cust-pan"
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.formLabel}>GST No.</Text>
                      <TextInput
                        style={[styles.formInput, { textTransform: 'uppercase' }]}
                        value={editForm.customer_gst}
                        onChangeText={(t) => setEditForm((p) => ({ ...p, customer_gst: t.toUpperCase() }))}
                        placeholder="15-digit GSTIN"
                        autoCapitalize="characters"
                        testID="edit-exp-cust-gst"
                      />
                    </View>
                  </View>
                </View>

                {/* Narration */}
                <View>
                  <Text style={styles.formLabel}>Narration / Description</Text>
                  <TextInput
                    style={[styles.formInput, { minHeight: 64, textAlignVertical: 'top' }]}
                    value={editForm.description}
                    onChangeText={(t) => setEditForm((p) => ({ ...p, description: t }))}
                    placeholder="Enter expense details or remarks..."
                    multiline
                    numberOfLines={3}
                    testID="edit-exp-description"
                  />
                </View>
              </View>
            </ScrollView>

            <View style={styles.modalFooter}>
              <Pressable
                onPress={() => setEditingExp(null)}
                style={styles.cancelBtn}
                disabled={saving}
              >
                <Text style={styles.cancelBtnTxt}>Cancel</Text>
              </Pressable>

              <Pressable
                onPress={saveEdit}
                style={styles.saveBtn}
                disabled={saving}
                testID="save-expense-btn"
              >
                {saving ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <>
                    <Ionicons name="checkmark-done" size={18} color="#FFF" />
                    <Text style={styles.saveBtnTxt}>Save & Update</Text>
                  </>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal: Add Expense Category (Admin Only) */}
      <Modal
        visible={showAddCatModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowAddCatModal(false)}
      >
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 16 }} onPress={() => setShowAddCatModal(false)}>
          <Pressable style={{ width: '100%', maxWidth: 420, backgroundColor: '#FFF', borderRadius: 12, padding: 20 }} onPress={e => e.stopPropagation()}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="add-circle" size={20} color="#2563EB" />
                <Text style={{ fontSize: 16, fontWeight: '800', color: '#0F172A' }}>Add Expense Category</Text>
              </View>
              <Pressable onPress={() => setShowAddCatModal(false)}>
                <Ionicons name="close" size={22} color="#111827" />
              </Pressable>
            </View>
            <Text style={{ fontSize: 13, color: '#64748B', marginBottom: 8 }}>
              Enter custom expense category name to add to the system:
            </Text>
            <TextInput
              style={{
                borderWidth: 1,
                borderColor: '#CBD5E1',
                borderRadius: 8,
                padding: 10,
                fontSize: 14,
                color: '#0F172A',
                backgroundColor: '#FFF'
              }}
              placeholder="e.g. Legal Retainer, Cloud Hosting"
              placeholderTextColor="#94A3B8"
              value={newCatName}
              onChangeText={setNewCatName}
            />
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <Pressable
                onPress={() => setShowAddCatModal(false)}
                style={{ paddingHorizontal: 16, paddingVertical: 8, borderRadius: 6, backgroundColor: '#F1F5F9' }}
              >
                <Text style={{ fontWeight: '700', color: '#475569' }}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={async () => {
                  const trimmed = newCatName.trim();
                  if (!trimmed) return;
                  setSavingCat(true);
                  try {
                    const res = await api.post<any>('/settings/expense-categories', { name: trimmed });
                    if (res?.categories) {
                      setCustomCats(res.categories);
                    } else {
                      setCustomCats((p: string[]) => [...p, trimmed]);
                    }
                    setSelectedCategory(trimmed);
                    setNewCatName('');
                    setShowAddCatModal(false);
                    notify('Category Added', `Expense category "${trimmed}" added successfully.`);
                  } catch (err: any) {
                    notify('Error', err?.message || 'Failed to add category');
                  } finally {
                    setSavingCat(false);
                  }
                }}
                disabled={savingCat}
                style={{ paddingHorizontal: 16, paddingVertical: 8, borderRadius: 6, backgroundColor: '#2563EB' }}
              >
                <Text style={{ fontWeight: '700', color: '#FFF' }}>{savingCat ? 'Saving...' : 'Add Category'}</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Modal: Add New Bank Account */}
      {showAddBankModal ? (
        <Modal visible={true} transparent={true} animationType="fade" onRequestClose={() => setShowAddBankModal(false)}>
          <Pressable style={styles.modalOverlay} onPress={() => setShowAddBankModal(false)}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ width: '100%', alignItems: 'center' }}>
              <Pressable style={styles.addBankModalBox} onPress={e => e.stopPropagation()}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <Text style={styles.modalTitle}>Add New Bank Account</Text>
                  <Pressable onPress={() => setShowAddBankModal(false)}>
                    <Ionicons name="close" size={20} color="#64748B" />
                  </Pressable>
                </View>
                <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 8 }}>
                  Create a new bank ledger for recording receipts & disbursements.
                </Text>

                {bankSaveErr ? (
                  <View style={styles.errBanner}>
                    <Ionicons name="alert-circle" size={16} color="#DC2626" />
                    <Text style={styles.errBannerTxt}>{bankSaveErr}</Text>
                  </View>
                ) : null}

                <View style={{ gap: 10, marginTop: 6 }}>
                  <View>
                    <Text style={styles.inputLbl}>Account Nickname / Ledger Name *</Text>
                    <TextInput
                      value={newBankForm.name}
                      onChangeText={t => setNewBankForm(p => ({ ...p, name: t }))}
                      placeholder="e.g. Current Account - SBI Main"
                      placeholderTextColor="#94A3B8"
                      style={styles.formInput}
                    />
                  </View>

                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.inputLbl}>Bank Name *</Text>
                      <TextInput
                        value={newBankForm.bank_name}
                        onChangeText={t => setNewBankForm(p => ({ ...p, bank_name: t }))}
                        placeholder="e.g. State Bank of India"
                        placeholderTextColor="#94A3B8"
                        style={styles.formInput}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.inputLbl}>Account Number *</Text>
                      <TextInput
                        value={newBankForm.account_no}
                        onChangeText={t => setNewBankForm(p => ({ ...p, account_no: t }))}
                        placeholder="e.g. 42137607814"
                        placeholderTextColor="#94A3B8"
                        keyboardType="numeric"
                        style={styles.formInput}
                      />
                    </View>
                  </View>

                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.inputLbl}>IFSC Code (Optional)</Text>
                      <TextInput
                        value={newBankForm.ifsc}
                        onChangeText={t => setNewBankForm(p => ({ ...p, ifsc: t.toUpperCase() }))}
                        placeholder="e.g. SBIN0063706"
                        placeholderTextColor="#94A3B8"
                        autoCapitalize="characters"
                        style={styles.formInput}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.inputLbl}>Opening Balance (₹)</Text>
                      <TextInput
                        value={newBankForm.opening_balance}
                        onChangeText={t => setNewBankForm(p => ({ ...p, opening_balance: t }))}
                        placeholder="0.00"
                        placeholderTextColor="#94A3B8"
                        keyboardType="numeric"
                        style={styles.formInput}
                      />
                    </View>
                  </View>

                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                    <Pressable
                      onPress={() => setShowAddBankModal(false)}
                      style={styles.cancelBtn}
                    >
                      <Text style={styles.cancelBtnTxt}>Cancel</Text>
                    </Pressable>
                    <Pressable
                      onPress={handleSaveNewBank}
                      disabled={savingNewBank}
                      style={[styles.saveBtn, savingNewBank && { opacity: 0.7 }]}
                    >
                      <Text style={styles.saveBtnTxt}>{savingNewBank ? 'Saving...' : 'Save & Select Bank'}</Text>
                    </Pressable>
                  </View>
                </View>
              </Pressable>
            </KeyboardAvoidingView>
          </Pressable>
        </Modal>
      ) : null}

    </View>
  );
}

const styles = StyleSheet.create({
  addBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.brandPrimary,
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* Stats Banner */
  statsBanner: {
    flexDirection: 'row',
    backgroundColor: '#FFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
  },
  statBox: {
    flex: 1,
    alignItems: 'center',
  },
  statDivider: {
    width: 1,
    height: '80%',
    backgroundColor: '#E2E8F0',
    alignSelf: 'center',
  },
  statLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 0.5,
  },
  statValue: {
    fontSize: 15,
    fontWeight: '900',
    marginTop: 2,
  },
  statSub: {
    fontSize: 10,
    color: '#94A3B8',
    fontWeight: '600',
    marginTop: 1,
  },

  /* Segmented Status Tab Bar */
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    padding: 3,
    marginHorizontal: spacing.md,
    marginTop: 8,
    borderRadius: radius.md,
  },
  tabItem: {
    flex: 1,
    paddingVertical: 7,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
  },
  tabItemActive: {
    backgroundColor: '#FFF',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  tabItemTxt: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748B',
  },
  tabItemTxtActive: {
    color: colors.brandPrimary,
    fontWeight: '900',
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },

  /* Search & Controls */
  searchSection: {
    backgroundColor: '#FFF',
    paddingHorizontal: spacing.md,
    paddingTop: 8,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    gap: 8,
    marginTop: 6,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  searchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
    borderRadius: radius.md,
    paddingHorizontal: 10,
    height: 42,
  },
  searchInput: {
    flex: 1,
    fontSize: font.sm,
    color: '#0F172A',
    marginLeft: 6,
    paddingVertical: 0,
  },
  clearBtn: {
    padding: 4,
  },
  filterBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: radius.md,
    paddingHorizontal: 12,
    height: 42,
  },
  filterBtnActive: {
    backgroundColor: colors.brandPrimary,
    borderColor: colors.brandPrimary,
  },
  filterBtnTxt: {
    fontSize: font.sm,
    fontWeight: '700',
    color: '#334155',
  },
  sortBtn: {
    width: 42,
    height: 42,
    borderRadius: radius.md,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* Horizontal Category Scroll */
  categoryScroll: {
    marginVertical: 2,
  },
  categoryScrollInner: {
    flexDirection: 'row',
    gap: 6,
  },
  catPillItem: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  catPillItemActive: {
    backgroundColor: '#EEF2FF',
    borderColor: '#6366F1',
  },
  catPillItemTxt: {
    fontSize: 11,
    fontWeight: '600',
    color: '#475569',
  },
  catPillItemTxtActive: {
    color: '#4338CA',
    fontWeight: '800',
  },

  /* Active Filters Chips Bar */
  activeFiltersRow: {
    paddingTop: 4,
    paddingBottom: 2,
  },
  activeFiltersLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#64748B',
    textTransform: 'uppercase',
  },
  activeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#F0F9FF',
    borderWidth: 1,
    borderColor: '#BAE6FD',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  activeChipTxt: {
    fontSize: 10,
    fontWeight: '700',
    color: '#0369A1',
  },
  resetAllBtn: {
    backgroundColor: '#FEE2E2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  resetAllBtnTxt: {
    fontSize: 10,
    fontWeight: '800',
    color: '#DC2626',
  },

  /* No match */
  noMatchCard: {
    margin: spacing.lg,
    padding: spacing.xl,
    backgroundColor: '#FFF',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
    gap: 10,
  },
  noMatchTitle: {
    fontSize: font.base,
    fontWeight: '800',
    color: '#0F172A',
    textAlign: 'center',
  },
  noMatchSub: {
    fontSize: font.sm,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 18,
  },
  clearSearchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.brandPrimary,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: radius.md,
    marginTop: 6,
  },
  clearSearchBtnTxt: {
    color: '#FFF',
    fontWeight: '700',
    fontSize: font.sm,
  },

  /* Expense Card */
  expCard: {
    backgroundColor: '#FFF',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: spacing.md,
    gap: 8,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  expNo: {
    color: colors.brandPrimary,
    fontWeight: '800',
    fontSize: font.base,
    letterSpacing: 0.5,
  },
  dateTxt: {
    color: '#64748B',
    fontSize: font.sm,
  },
  linkedVoucherChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#EEF2FF',
    borderWidth: 1,
    borderColor: '#C7D2FE',
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 4,
  },
  linkedVoucherChipTxt: {
    fontSize: 10,
    fontWeight: '800',
    color: '#4F46E5',
  },
  categoryTitle: {
    fontSize: font.base,
    fontWeight: '800',
    color: '#0F172A',
    marginTop: 2,
  },
  amtTxt: {
    fontSize: font.lg,
    fontWeight: '900',
    color: '#DC2626',
  },
  vendorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  vendorTxt: {
    fontSize: font.sm,
    color: '#475569',
  },
  modeBadge: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    marginLeft: 4,
  },
  modeBadgeTxt: {
    fontSize: 9,
    fontWeight: '800',
    color: '#334155',
  },
  custMetaContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingTop: 2,
  },
  metaBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#F0F9FF',
    borderWidth: 1,
    borderColor: '#BAE6FD',
    paddingHorizontal: 8,
    paddingVertical: 2.5,
    borderRadius: 6,
  },
  metaBadgeTxt: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0369A1',
  },
  descTxt: {
    fontSize: font.sm,
    color: '#475569',
    backgroundColor: '#F8FAFC',
    padding: 8,
    borderRadius: 6,
    lineHeight: 18,
  },
  pendingBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FDE68A',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  pendingBarTxt: {
    flex: 1,
    fontSize: 11,
    fontWeight: '800',
    color: '#B45309',
  },

  /* Card Actions */
  cardActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  actionBtnPrint: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    backgroundColor: '#F0F9FF',
    borderWidth: 1,
    borderColor: '#BAE6FD',
    paddingVertical: 7,
    borderRadius: radius.md,
  },
  actionBtnPrintTxt: {
    color: '#0369A1',
    fontWeight: '800',
    fontSize: font.sm,
  },
  actionBtnView: {
    flex: 0.9,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    paddingVertical: 7,
    borderRadius: radius.md,
  },
  actionBtnViewTxt: {
    color: '#475569',
    fontWeight: '700',
    fontSize: font.sm,
  },
  actionBtnEdit: {
    flex: 0.9,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    backgroundColor: '#EEF2FF',
    borderWidth: 1,
    borderColor: '#C7D2FE',
    paddingVertical: 7,
    borderRadius: radius.md,
  },
  actionBtnEditTxt: {
    color: '#4338CA',
    fontWeight: '800',
    fontSize: font.sm,
  },
  actionBtnDelete: {
    flex: 0.9,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    paddingVertical: 7,
    borderRadius: radius.md,
  },
  actionBtnDeleteTxt: {
    color: '#DC2626',
    fontWeight: '800',
    fontSize: font.sm,
  },

  /* Modals Common */
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.md,
  },
  modalContent: {
    backgroundColor: '#FFF',
    borderRadius: radius.xl,
    width: '100%',
    maxWidth: 580,
    maxHeight: '92%',
    padding: spacing.lg,
    gap: 12,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 8,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    paddingBottom: spacing.sm,
  },
  modalTitle: {
    fontSize: font.lg,
    fontWeight: '900',
    color: '#0F172A',
  },
  modalSubtitle: {
    fontSize: font.sm,
    color: colors.brandPrimary,
    fontWeight: '800',
  },
  modalCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    paddingTop: spacing.sm,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: radius.md,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtnTxt: {
    color: '#475569',
    fontWeight: '700',
    fontSize: font.sm,
  },
  saveBtn: {
    flex: 2,
    flexDirection: 'row',
    gap: 6,
    paddingVertical: 10,
    borderRadius: radius.md,
    backgroundColor: colors.brandPrimary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnTxt: {
    color: '#FFF',
    fontWeight: '800',
    fontSize: font.sm,
  },

  /* View Details Modal Specifics */
  viewHeroCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  viewHeroLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 0.5,
  },
  viewHeroAmount: {
    fontSize: 22,
    fontWeight: '900',
    color: '#DC2626',
    marginVertical: 2,
  },
  viewHeroDate: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '600',
  },
  detailBlock: {
    backgroundColor: '#FFF',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: spacing.md,
    gap: 6,
  },
  detailBlockTitle: {
    fontSize: 11,
    fontWeight: '900',
    color: '#475569',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  detailLabel: {
    fontSize: font.sm,
    color: '#64748B',
  },
  detailValue: {
    fontSize: font.sm,
    color: '#1E293B',
  },
  detailValueBold: {
    fontSize: font.sm,
    fontWeight: '800',
    color: '#0F172A',
  },
  detailDescBox: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 8,
    borderRadius: 6,
    marginTop: 4,
    fontSize: font.sm,
    color: '#334155',
    lineHeight: 18,
  },
  viewWorkflowBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#0284C7',
    paddingVertical: 9,
    borderRadius: radius.md,
    marginTop: 8,
  },
  viewWorkflowBtnTxt: {
    color: '#FFF',
    fontWeight: '800',
    fontSize: font.sm,
  },
  detailModalPrintBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#F0F9FF',
    borderWidth: 1,
    borderColor: '#BAE6FD',
    paddingVertical: 10,
    borderRadius: radius.md,
  },
  detailModalEditBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: colors.brandPrimary,
    paddingVertical: 10,
    borderRadius: radius.md,
  },

  /* Filters Modal Specifics */
  filterSectionLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#334155',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  presetRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  presetChip: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  presetChipActive: {
    backgroundColor: '#EEF2FF',
    borderColor: '#6366F1',
  },
  presetChipTxt: {
    fontSize: 11,
    color: '#475569',
    fontWeight: '600',
  },
  presetChipTxtActive: {
    color: '#4338CA',
    fontWeight: '800',
  },
  customerPill: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  customerPillActive: {
    backgroundColor: '#F0F9FF',
    borderColor: '#0284C7',
  },
  customerPillTxt: {
    fontSize: 11,
    color: '#475569',
    fontWeight: '600',
  },
  customerPillTxtActive: {
    color: '#0369A1',
    fontWeight: '800',
  },
  formSubLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#64748B',
    marginBottom: 3,
  },

  /* Sort Modal Specifics */
  sortOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderRadius: radius.md,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  sortOptionRowActive: {
    backgroundColor: '#EFF6FF',
    borderColor: '#BFDBFE',
  },
  sortOptionTxt: {
    fontSize: font.sm,
    color: '#334155',
    fontWeight: '600',
  },
  sortOptionTxtActive: {
    color: colors.brandPrimary,
    fontWeight: '800',
  },

  /* Forms Common */
  formSection: {
    gap: 10,
    paddingVertical: 4,
  },
  formRow: {
    flexDirection: 'row',
    gap: 10,
  },
  formLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
    marginBottom: 4,
  },
  formInput: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
    borderRadius: radius.md,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: font.sm,
    color: '#0F172A',
  },
  modeSelector: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    borderRadius: radius.md,
    padding: 2,
    height: 40,
    alignItems: 'center',
  },
  modeChoice: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    borderRadius: 6,
  },
  modeChoiceActive: {
    backgroundColor: '#FFF',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  modeChoiceTxt: {
    fontSize: 10,
    fontWeight: '700',
    color: '#64748B',
  },
  modeChoiceTxtActive: {
    color: colors.brandPrimary,
    fontWeight: '900',
  },
  catPill: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  catPillActive: {
    backgroundColor: '#EEF2FF',
    borderColor: '#6366F1',
  },
  catPillTxt: {
    fontSize: 11,
    color: '#475569',
    fontWeight: '600',
  },
  catPillTxtActive: {
    color: '#4338CA',
    fontWeight: '800',
  },
  subCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: spacing.sm,
    gap: 8,
  },
  subCardTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: '#334155',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  pendingWorkflowBanner: {
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    marginBottom: 4,
    backgroundColor: '#FFFBEB',
    borderWidth: 1.5,
    borderColor: '#FDE68A',
    borderRadius: radius.md,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    flexWrap: 'wrap',
  },
  pendingWorkflowTitle: {
    fontSize: font.sm,
    fontWeight: '800',
    color: '#92400E',
  },
  pendingWorkflowSub: {
    fontSize: 11,
    color: '#B45309',
    marginTop: 2,
    lineHeight: 15,
  },
  pendingWorkflowBtn: {
    backgroundColor: '#D97706',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.pill,
  },
  pendingWorkflowBtnTxt: {
    color: '#FFF',
    fontSize: 11,
    fontWeight: '800',
  },
  pendingNoticePill: {
    marginHorizontal: spacing.md,
    marginTop: spacing.xs,
    marginBottom: 4,
    backgroundColor: '#F0FDFA',
    borderWidth: 1,
    borderColor: '#99F6E4',
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 7,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pendingNoticePillTxt: {
    fontSize: 11,
    color: '#0F766E',
    fontWeight: '600',
    flex: 1,
  },
  pendingNoticePillLink: {
    fontSize: 11,
    color: '#0D9488',
    fontWeight: '800',
    textDecorationLine: 'underline',
  },
  ledgerHeaderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  ledgerHeaderBtnTxt: {
    fontSize: 11.5,
    fontWeight: '800',
    color: '#1E40AF',
  },
  bankChipBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#93C5FD',
  },
  bankChipBtnActive: {
    backgroundColor: '#1E40AF',
    borderColor: '#1E40AF',
  },
  bankChipTxt: {
    fontSize: 12,
    fontWeight: '800',
    color: '#1E40AF',
  },
  bankChipTxtActive: {
    color: '#FFFFFF',
  },
  addBankBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: '#EFF6FF',
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#93C5FD',
  },
  addBankTxt: {
    fontSize: 12,
    fontWeight: '700',
    color: '#2563EB',
  },
  addBankModalBox: {
    width: '100%',
    maxWidth: 480,
    backgroundColor: '#FFF',
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    ...shadow.md,
  },
  inputLbl: {
    fontSize: 11,
    fontWeight: '800',
    color: '#334155',
    marginBottom: 3,
  },
  errBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FCA5A5',
    borderRadius: radius.sm,
    padding: 8,
    marginBottom: 4,
  },
  errBannerTxt: {
    color: '#DC2626',
    fontSize: 12,
    fontWeight: '600',
    flex: 1,
  },
});
