import React, { useCallback, useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Modal,
  TextInput,
  Linking,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, font } from '@/src/theme';
import { api } from '@/src/api';
import { notify, confirm } from '@/src/dialog';
import { useAuth } from '@/src/AuthContext';
import { ScreenLoader } from '@/src/ui';

const EXPENSE_HEADS = [
  'Tender Fee',
  'EMD / Security Deposit',
  'Processing Charge',
  'Travel & Fuel',
  'Notary / Affidavit',
  'Printing & Stationery',
  'Site Visit',
  'Document Legalization',
  'Portal Registration Fee',
  'Labour & Delivery',
  'Other Operational Expense',
];

export default function ExpenseApprovalDetailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id, edit } = useLocalSearchParams<{ id: string; edit?: string }>();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';

  const [voucher, setVoucher] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);

  // Multi-Selection State for Item-Level Approval
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);

  // Action Modal (Reject / Return)
  const [actionModal, setActionModal] = useState<{ open: boolean; type: 'reject' | 'return' | null }>({
    open: false,
    type: null,
  });
  const [remarks, setRemarks] = useState('');
  const [modalErr, setModalErr] = useState<string | null>(null);

  // Edit Voucher Modal
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editItems, setEditItems] = useState<Array<{ id: string; head: string; description: string; qty: string; rate: string; amount: number }>>([]);
  const [editNotes, setEditNotes] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [editErr, setEditErr] = useState<string | null>(null);
  const [loadingInvoiceItems, setLoadingInvoiceItems] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const data = await api.getExpenseApproval(String(id));
      setVoucher(data);
      if (data.approved_item_ids && data.approved_item_ids.length > 0) {
        setSelectedItemIds(data.approved_item_ids.map(String));
      } else {
        setSelectedItemIds((data.expenses || []).map((it: any, idx: number) => String(it.id || idx)));
      }
    } catch (e: any) {
      notify('Error', e?.message || 'Could not load expense voucher');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Selected items calculation
  const selectedExpenses = React.useMemo(() => {
    const expenses = voucher?.expenses || [];
    return expenses.filter((it: any, idx: number) => {
      const itemId = String(it.id || idx);
      return selectedItemIds.includes(itemId);
    });
  }, [voucher?.expenses, selectedItemIds]);

  const totalSelectedAmount = React.useMemo(() => {
    return selectedExpenses.reduce((sum: number, it: any) => sum + Number(it.amount || 0), 0);
  }, [selectedExpenses]);

  const handleToggleItem = (itemId: string) => {
    setSelectedItemIds(prev =>
      prev.includes(itemId) ? prev.filter(x => x !== itemId) : [...prev, itemId]
    );
  };

  const handleToggleSelectAll = () => {
    const allIds = (voucher?.expenses || []).map((it: any, idx: number) => String(it.id || idx));
    if (selectedItemIds.length === allIds.length) {
      setSelectedItemIds([]);
    } else {
      setSelectedItemIds(allIds);
    }
  };

  const printPdf = async () => {
    if (!voucher) return;
    try {
      const url = await api.expenseApprovalPdfUrl(voucher.id);
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.open(url, '_blank');
      } else {
        await Linking.openURL(url);
      }
    } catch (e: any) {
      notify('Failed', e?.message || 'Could not open PDF voucher');
    }
  };

  const currentUserId = (user as any)?.id || (user as any)?.user_id;
  const isCreator = currentUserId === voucher?.created_by?.user_id;
  const isAdminRole = user?.role === 'admin' || user?.role === 'super_admin';
  const isApproverRole = isAdminRole || user?.role === 'manager' || user?.role === 'accountant';
  const canApprove = isApproverRole && (isAdminRole || !isCreator);

  const handleApprove = async () => {
    if (!voucher) return;
    if (selectedItemIds.length === 0) {
      notify('Selection Required', 'Please select at least one expense item to approve.');
      return;
    }
    const count = selectedItemIds.length;
    const totalCount = voucher.expenses?.length || 0;
    const ok = await confirm(
      'Approve Expense?',
      `Confirm approval for ${count} of ${totalCount} selected expense item(s) totaling ₹${totalSelectedAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}. This will post to the accounting ledger and sync with All Expenses.`,
      { confirmText: 'Approve Expense', destructive: false }
    );
    if (!ok) return;

    setActing(true);
    try {
      await api.expenseApprovalAction(
        voucher.id,
        'approve',
        `Approved ${count} item(s) totaling ₹${totalSelectedAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`,
        { selected_item_ids: selectedItemIds, approved_amount: totalSelectedAmount }
      );
      notify('Approved', `Expense Voucher ${voucher.voucher_no} approved ✓`);
      await load();
    } catch (e: any) {
      notify('Error', e?.message || 'Approval failed');
    } finally {
      setActing(false);
    }
  };

  const handleVerify = async () => {
    if (!voucher) return;
    setActing(true);
    try {
      await api.expenseApprovalAction(voucher.id, 'verify', 'Verified by accounts team');
      notify('Verified', `Voucher ${voucher.voucher_no} verified ✓`);
      await load();
    } catch (e: any) {
      notify('Error', e?.message || 'Verification failed');
    } finally {
      setActing(false);
    }
  };

  const handleModalSubmit = async () => {
    if (!voucher || !actionModal.type) return;
    if (!remarks.trim()) {
      setModalErr('Remarks / reason is mandatory');
      return;
    }
    setActing(true);
    setModalErr(null);
    try {
      await api.expenseApprovalAction(voucher.id, actionModal.type, remarks.trim());
      notify(
        actionModal.type === 'reject' ? 'Rejected' : 'Returned',
        `Voucher ${voucher.voucher_no} ${actionModal.type === 'reject' ? 'rejected' : 'returned for correction'}`
      );
      setActionModal({ open: false, type: null });
      setRemarks('');
      await load();
    } catch (e: any) {
      setModalErr(e?.message || 'Action failed');
    } finally {
      setActing(false);
    }
  };

  const handleReopen = async () => {
    if (!voucher) return;
    const ok = await confirm(
      'Reopen Expense Voucher?',
      `Reopening voucher ${voucher.voucher_no} will change its status back to Submitted and automatically remove any posted ledger expense. Do you want to proceed?`,
      { confirmText: 'Reopen Voucher', destructive: false }
    );
    if (!ok) return;

    setActing(true);
    try {
      await api.reopenExpenseApproval(voucher.id, 'Reopened by Admin for correction / review');
      notify('Reopened', `Voucher ${voucher.voucher_no} is now reopened to Submitted`);
      await load();
    } catch (e: any) {
      notify('Error', e?.message || 'Failed to reopen voucher');
    } finally {
      setActing(false);
    }
  };

  const handleDelete = async () => {
    if (!voucher) return;
    const ok = await confirm(
      'Delete Expense Voucher?',
      `Are you sure you want to permanently delete voucher ${voucher.voucher_no}? Any linked expense posted in the accounting ledger will also be removed. This cannot be undone.`,
      { confirmText: 'Delete Permanently', destructive: true }
    );
    if (!ok) return;

    setActing(true);
    try {
      await api.deleteExpenseApproval(voucher.id);
      notify('Deleted', `Voucher ${voucher.voucher_no} deleted successfully`);
      router.back();
    } catch (e: any) {
      notify('Error', e?.message || 'Failed to delete voucher');
      setActing(false);
    }
  };

  const openEditModal = () => {
    if (!voucher) return;
    setEditItems(
      (voucher.expenses || []).map((it: any, idx: number) => ({
        id: it.id || String(idx + 1),
        head: it.head || 'Tender Fee',
        description: it.description || '',
        qty: String(it.qty ?? 1),
        rate: String(it.rate ?? 0),
        amount: Number(it.amount ?? 0),
      }))
    );
    setEditNotes(voucher.notes || '');
    setEditErr(null);
    setEditModalOpen(true);
  };

  const handleFetchPassOnItemsForEdit = async () => {
    if (!voucher?.sale_voucher_id) return;
    setLoadingInvoiceItems(true);
    setEditErr(null);
    try {
      const res = await api.get<any>(`/invoices/${voucher.sale_voucher_id}/passed-on-items`);
      const items = res?.passed_on_items || [];
      if (!items.length) {
        setEditErr(`No passed-on items found in voucher ${voucher.sale_voucher_no}`);
        return;
      }
      const mapped = items.map((poi: any, idx: number) => {
        const amt = poi.remaining_balance > 0 ? poi.remaining_balance : poi.billed_amount;
        return {
          id: poi.item_id || `poi_${idx}_${Date.now()}`,
          head: poi.name || 'Tender Fee',
          description: `Disbursement of client pass-on funds for ${poi.name} against Voucher ${voucher.sale_voucher_no}`,
          qty: '1',
          rate: String(amt || 0),
          amount: Number(amt || 0),
        };
      });
      setEditItems(mapped);
      notify('Imported', `Loaded ${mapped.length} passed-on items from ${voucher.sale_voucher_no}`);
    } catch (e: any) {
      setEditErr(e?.message || 'Failed to load passed-on items from invoice');
    } finally {
      setLoadingInvoiceItems(false);
    }
  };

  const updateEditItem = (itemId: string, field: 'head' | 'description' | 'qty' | 'rate', val: string) => {
    setEditItems(prev =>
      prev.map(it => {
        if (it.id !== itemId) return it;
        const updated = { ...it, [field]: val };
        const q = parseFloat(field === 'qty' ? val : it.qty) || 0;
        const r = parseFloat(field === 'rate' ? val : it.rate) || 0;
        updated.amount = Math.round(q * r * 100) / 100;
        return updated;
      })
    );
  };

  const addEditItem = () => {
    setEditItems(prev => [
      ...prev,
      { id: Date.now().toString(), head: 'Processing Charge', description: '', qty: '1', rate: '', amount: 0 },
    ]);
  };

  const removeEditItem = (itemId: string) => {
    if (editItems.length <= 1) return;
    setEditItems(prev => prev.filter(it => it.id !== itemId));
  };

  const handleSaveEdit = async () => {
    setEditErr(null);
    const total = editItems.reduce((acc, it) => acc + (it.amount || 0), 0);
    if (total <= 0) {
      setEditErr('Total expense must be greater than zero.');
      return;
    }
    const recAmt = Number(voucher.sale_received_amount || 0);
    if (total > recAmt) {
      setEditErr(`Expense cannot be greater than received amount (₹${recAmt.toLocaleString('en-IN')})`);
      return;
    }
    for (const it of editItems) {
      if (!it.head.trim()) {
        setEditErr('All line items must have a category head.');
        return;
      }
    }

    setSavingEdit(true);
    try {
      const payload = {
        customer_id: voucher.customer_id,
        customer_name: voucher.customer_name,
        customer_code: voucher.customer_code,
        customer_mobile: voucher.customer_mobile,
        customer_pan: voucher.customer_pan,
        customer_whatsapp: voucher.customer_whatsapp,
        sale_voucher_id: voucher.sale_voucher_id,
        sale_voucher_no: voucher.sale_voucher_no,
        sale_voucher_type: voucher.sale_voucher_type,
        sale_voucher_date: voucher.sale_voucher_date,
        sale_voucher_amount: voucher.sale_voucher_amount,
        sale_received_amount: voucher.sale_received_amount,
        sale_unpaid_amount: voucher.sale_unpaid_amount,
        expenses: editItems.map(it => ({
          id: it.id,
          head: it.head.trim(),
          description: it.description.trim(),
          qty: parseFloat(it.qty) || 1,
          rate: parseFloat(it.rate) || 0,
          amount: it.amount,
        })),
        notes: editNotes.trim(),
        status: voucher.status,
      };
      await api.updateExpenseApproval(voucher.id, payload);
      notify('Saved', 'Voucher updated successfully ✓');
      setEditModalOpen(false);
      await load();
    } catch (e: any) {
      setEditErr(e?.message || 'Failed to update voucher');
    } finally {
      setSavingEdit(false);
    }
  };

  useEffect(() => {
    if (voucher && (edit === 'true' || edit === '1')) {
      openEditModal();
    }
  }, [voucher?.id, edit]);

  if (loading || !voucher) {
    return <ScreenLoader />;
  }

  const status = voucher.status || 'submitted';
  const statusColor =
    status === 'approved'
      ? { bg: '#DCFCE7', text: '#15803D', border: '#86EFAC' }
      : status === 'rejected'
      ? { bg: '#FEE2E2', text: '#B91C1C', border: '#FCA5A5' }
      : status === 'returned'
      ? { bg: '#FEF3C7', text: '#B45309', border: '#FCD34D' }
      : status === 'verified'
      ? { bg: '#E0E7FF', text: '#4338CA', border: '#A5B4FC' }
      : { bg: '#EFF6FF', text: '#1D4ED8', border: '#93C5FD' };

  const recAmt = Number(voucher.sale_received_amount || 0);
  const totExp = Number(voucher.total_expense_amount || 0);
  const isCompliant = totExp <= recAmt;

  return (
    <SafeAreaView edges={['top']} style={styles.root} testID="expense-approval-detail-screen">
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={20} color="#0F172A" />
        </Pressable>
        <View style={{ flex: 1, marginLeft: 10 }}>
          <Text style={styles.h1}>{voucher.voucher_no}</Text>
          <Text style={styles.subTitle}>Date: {voucher.voucher_date || voucher.created_at}</Text>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: statusColor.bg, borderColor: statusColor.border }]}>
          <Text style={[styles.statusBadgeTxt, { color: statusColor.text }]}>{status.toUpperCase()}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 60 }]}>
        
        {/* Quick Contact & Action Toolbar */}
        <View style={styles.actionToolbar}>
          {voucher.customer_mobile ? (
            <Pressable
              onPress={() => Linking.openURL(`tel:${voucher.customer_mobile}`)}
              style={styles.toolbarBtn}
              testID="call-contractor-btn"
            >
              <Ionicons name="call" size={16} color={colors.brandPrimary} />
              <Text style={styles.toolbarBtnTxt}>Call</Text>
            </Pressable>
          ) : null}

          {voucher.customer_whatsapp || voucher.customer_mobile ? (
            <Pressable
              onPress={() => {
                const raw = voucher.customer_whatsapp || voucher.customer_mobile;
                const clean = raw.replace(/\D/g, '');
                const ph = clean.startsWith('91') ? clean : '91' + clean;
                const msg = encodeURIComponent(
                  `Hello ${voucher.customer_name}, regarding TDSC Expense Approval Voucher ${voucher.voucher_no} (linked to sale ref ${voucher.sale_voucher_no}). Current status: ${voucher.status}. Claimed amount: ₹${totExp.toLocaleString('en-IN')}.`
                );
                Linking.openURL(`https://wa.me/${ph}?text=${msg}`);
              }}
              style={[styles.toolbarBtn, { backgroundColor: '#DCFCE7', borderColor: '#BBF7D0' }]}
              testID="whatsapp-contractor-btn"
            >
              <Ionicons name="logo-whatsapp" size={16} color="#15803D" />
              <Text style={[styles.toolbarBtnTxt, { color: '#15803D' }]}>WhatsApp</Text>
            </Pressable>
          ) : null}

          <Pressable onPress={printPdf} style={styles.toolbarBtn} testID="print-voucher-btn">
            <Ionicons name="print-outline" size={16} color="#334155" />
            <Text style={[styles.toolbarBtnTxt, { color: '#334155' }]}>PDF</Text>
          </Pressable>

          {isAdmin || status === 'draft' || status === 'returned' ? (
            <Pressable
              onPress={openEditModal}
              style={[styles.toolbarBtn, { backgroundColor: '#F0FDFA', borderColor: '#99F6E4' }]}
              testID="edit-voucher-btn"
            >
              <Ionicons name="create-outline" size={16} color="#0D9488" />
              <Text style={[styles.toolbarBtnTxt, { color: '#0D9488' }]}>Edit</Text>
            </Pressable>
          ) : null}

          {isAdmin && (status === 'approved' || status === 'rejected' || status === 'verified') ? (
            <Pressable
              onPress={handleReopen}
              style={[styles.toolbarBtn, { backgroundColor: '#EFF6FF', borderColor: '#BFDBFE' }]}
              disabled={acting}
              testID="reopen-voucher-btn"
            >
              <Ionicons name="reload-outline" size={16} color="#2563EB" />
              <Text style={[styles.toolbarBtnTxt, { color: '#2563EB' }]}>Reopen</Text>
            </Pressable>
          ) : null}

          {isAdmin ? (
            <Pressable
              onPress={handleDelete}
              style={[styles.toolbarBtn, { backgroundColor: '#FEF2F2', borderColor: '#FECACA' }]}
              disabled={acting}
              testID="delete-voucher-btn"
            >
              <Ionicons name="trash-outline" size={16} color="#DC2626" />
              <Text style={[styles.toolbarBtnTxt, { color: '#DC2626' }]}>Delete</Text>
            </Pressable>
          ) : null}
        </View>

        {/* Section 1: Contractor Information */}
        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <Ionicons name="person-circle" size={20} color={colors.brandPrimary} />
            <Text style={styles.cardTitle}>Contractor Information</Text>
          </View>
          <View style={styles.infoRow}><Text style={styles.infoLbl}>Name:</Text><Text style={styles.infoVal}>{voucher.customer_name}</Text></View>
          <View style={styles.infoRow}><Text style={styles.infoLbl}>Customer Code:</Text><Text style={styles.infoVal}>{voucher.customer_code || voucher.customer_id}</Text></View>
          <View style={styles.infoRow}><Text style={styles.infoLbl}>Mobile:</Text><Text style={styles.infoVal}>{voucher.customer_mobile || '—'}</Text></View>
          <View style={styles.infoRow}><Text style={styles.infoLbl}>PAN No:</Text><Text style={styles.infoVal}>{voucher.customer_pan || '—'}</Text></View>
        </View>

        {/* Section 2: Linked Sale Voucher Details */}
        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <Ionicons name="receipt" size={20} color="#2563EB" />
            <Text style={styles.cardTitle}>Linked Sale Voucher & Settlement</Text>
          </View>
          <View style={styles.infoRow}><Text style={styles.infoLbl}>Sale Voucher Ref:</Text><Text style={[styles.infoVal, { fontWeight: '800' }]}>{voucher.sale_voucher_no} ({String(voucher.sale_voucher_type || 'Sale').toUpperCase()})</Text></View>
          <View style={styles.infoRow}><Text style={styles.infoLbl}>Sale Voucher Amount:</Text><Text style={styles.infoVal}>₹ {Number(voucher.sale_voucher_amount || 0).toLocaleString('en-IN')}</Text></View>
          <View style={styles.infoRow}><Text style={styles.infoLbl}>Amount Received:</Text><Text style={[styles.infoVal, { color: '#15803D', fontWeight: '800' }]}>₹ {recAmt.toLocaleString('en-IN')}</Text></View>
          <View style={styles.infoRow}><Text style={styles.infoLbl}>Unpaid Balance:</Text><Text style={styles.infoVal}>₹ {Number(voucher.sale_unpaid_amount || 0).toLocaleString('en-IN')}</Text></View>
          
          <View style={[styles.complianceBox, { backgroundColor: isCompliant ? '#F0FDF4' : '#FEF2F2', borderColor: isCompliant ? '#BBF7D0' : '#FECACA' }]}>
            <Ionicons name={isCompliant ? 'shield-checkmark' : 'alert-circle'} size={16} color={isCompliant ? '#15803D' : colors.error} />
            <Text style={[styles.complianceTxt, { color: isCompliant ? '#15803D' : colors.error }]}>
              {isCompliant
                ? `✓ Pass-On Rule Satisfied (Expense ₹${totExp.toLocaleString('en-IN')} ≤ Received ₹${recAmt.toLocaleString('en-IN')})`
                : '✕ Pass-On Rule Violation: Total expense exceeds received amount!'}
            </Text>
          </View>
        </View>

        {/* Section 3: Itemized Expenses */}
        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
              <Ionicons name="list" size={20} color="#7C3AED" />
              <Text style={styles.cardTitle}>Itemized Expense Breakdown</Text>
            </View>
            {canApprove && (status === 'submitted' || status === 'verified' || status === 'returned') ? (
              <View style={styles.multiSelectBadge}>
                <Ionicons name="checkbox-outline" size={13} color="#0D9488" />
                <Text style={styles.multiSelectBadgeTxt}>Multi-Select Active</Text>
              </View>
            ) : null}
          </View>

          <Text style={styles.sectionSubtitleTxt}>
            {canApprove && (status === 'submitted' || status === 'verified' || status === 'returned')
              ? 'Select individual expense items (or click "All" to select all) to calculate the combined approval total.'
              : 'Itemized list of expenses claimed against the linked sale voucher.'}
          </Text>

          {/* Table Header with Multi-Select Toggle */}
          <View style={styles.tableHeader}>
            {canApprove && (status === 'submitted' || status === 'verified' || status === 'returned') ? (
              <Pressable
                onPress={handleToggleSelectAll}
                style={styles.selectAllHeaderBtn}
                hitSlop={6}
                accessibilityLabel="Toggle select all items"
              >
                <Ionicons
                  name={
                    (voucher.expenses || []).length > 0 &&
                    selectedItemIds.length === (voucher.expenses || []).length
                      ? 'checkbox'
                      : selectedItemIds.length > 0
                        ? 'remove-circle-outline'
                        : 'square-outline'
                  }
                  size={18}
                  color="#0D9488"
                />
                <Text style={styles.selectAllHeaderTxt}>All</Text>
              </Pressable>
            ) : null}
            <Text style={[styles.thTxt, { flex: 2 }]}>Head / Particulars</Text>
            <Text style={[styles.thTxt, { width: 40, textAlign: 'center' }]}>Qty</Text>
            <Text style={[styles.thTxt, { width: 70, textAlign: 'right' }]}>Rate</Text>
            <Text style={[styles.thTxt, { width: 85, textAlign: 'right' }]}>Amount</Text>
          </View>

          {/* Item Rows */}
          {(voucher.expenses || []).map((it: any, idx: number) => {
            const itemId = String(it.id || idx);
            const isSelected = selectedItemIds.includes(itemId);
            const isApprovedItem = (voucher.approved_item_ids || []).includes(itemId);
            const isInteractable = canApprove && (status === 'submitted' || status === 'verified' || status === 'returned');

            return (
              <Pressable
                key={itemId}
                onPress={() => {
                  if (isInteractable) {
                    handleToggleItem(itemId);
                  }
                }}
                style={[
                  styles.tableRow,
                  isSelected && isInteractable && styles.tableRowSelected,
                ]}
              >
                {isInteractable ? (
                  <View style={styles.rowCheckCell}>
                    <Ionicons
                      name={isSelected ? 'checkbox' : 'square-outline'}
                      size={20}
                      color={isSelected ? '#0D9488' : '#94A3B8'}
                    />
                  </View>
                ) : status === 'approved' ? (
                  <View style={styles.rowCheckCell}>
                    <Ionicons
                      name={isApprovedItem || !(voucher.approved_item_ids?.length) ? 'checkmark-circle' : 'ellipse-outline'}
                      size={18}
                      color={isApprovedItem || !(voucher.approved_item_ids?.length) ? '#10B981' : '#CBD5E1'}
                    />
                  </View>
                ) : null}

                <View style={{ flex: 2 }}>
                  <Text style={[styles.itemHead, isSelected && isInteractable && { color: '#0F766E', fontWeight: '800' }]}>
                    {it.head}
                  </Text>
                  {it.description ? <Text style={styles.itemDesc}>{it.description}</Text> : null}
                </View>
                <Text style={[styles.tdTxt, { width: 40, textAlign: 'center' }]}>{it.qty || 1}</Text>
                <Text style={[styles.tdTxt, { width: 70, textAlign: 'right' }]}>
                  ₹ {Number(it.rate || 0).toLocaleString('en-IN')}
                </Text>
                <Text style={[styles.tdTxt, { width: 85, textAlign: 'right', fontWeight: '800', color: isSelected && isInteractable ? '#0F766E' : colors.onSurface }]}>
                  ₹ {Number(it.amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </Text>
              </Pressable>
            );
          })}

          {/* Jod Kar Total Row (Dedicated Total of Selected Items) */}
          <View style={styles.selectedTotalRow}>
            <View style={{ flex: 2, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View style={styles.totalBadge}>
                <Text style={styles.totalBadgeTxt}>
                  {selectedItemIds.length}/{(voucher.expenses || []).length} Selected
                </Text>
              </View>
              <View>
                <Text style={styles.selectedTotalLabel}>Total Selected for Approval</Text>
                <Text style={styles.selectedTotalSub}>Jod kar Total Amount</Text>
              </View>
            </View>
            <Text style={styles.selectedTotalVal}>
              ₹ {totalSelectedAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </Text>
          </View>

          {/* Voucher Total Claimed Row */}
          <View style={styles.voucherTotalRow}>
            <Text style={styles.voucherTotalLbl}>Voucher Total Claimed</Text>
            <Text style={styles.voucherTotalVal}>
              ₹ {totExp.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </Text>
          </View>

          {voucher.notes ? (
            <View style={styles.notesBox}>
              <Text style={styles.notesLbl}>Auditor / Submitter Notes:</Text>
              <Text style={styles.notesTxt}>{voucher.notes}</Text>
            </View>
          ) : null}
        </View>

        {/* Section 4: Workflow Audit Trail Timeline */}
        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <Ionicons name="time" size={20} color="#059669" />
            <Text style={styles.cardTitle}>Approval Workflow & Audit Timeline</Text>
          </View>

          <View style={{ gap: 12, marginTop: 4 }}>
            {(voucher.workflow_history || []).map((ev: any, idx: number) => (
              <View key={idx} style={styles.timelineItem}>
                <View style={styles.timelineDot} />
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={styles.timelineAction}>{String(ev.action).toUpperCase()}</Text>
                    <Text style={styles.timelineTime}>{ev.timestamp || '—'}</Text>
                  </View>
                  <Text style={styles.timelineActor}>
                    By: {ev.actor?.name || 'Staff'} ({ev.actor?.role || 'Staff'})
                  </Text>
                  {ev.remarks ? <Text style={styles.timelineRemarks}>"{ev.remarks}"</Text> : null}
                </View>
              </View>
            ))}
          </View>
        </View>

        {/* Approver Action Panel */}
        {status === 'submitted' || status === 'verified' || status === 'returned' ? (
          <View style={styles.approvalPanel}>
            <Text style={styles.panelTitle}>Approver Actions</Text>

            {isCreator && !isAdminRole ? (
              <View style={styles.selfApprovalWarning}>
                <Ionicons name="information-circle" size={18} color="#B45309" />
                <Text style={styles.selfApprovalWarningTxt}>
                  Self-approval restricted: You submitted this voucher. Another manager or admin must review and approve it.
                </Text>
              </View>
            ) : null}

            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              {canApprove && (status === 'submitted' || status === 'verified' || status === 'returned') ? (
                <Pressable
                  onPress={handleApprove}
                  style={[
                    styles.btnApprove,
                    (acting || selectedItemIds.length === 0) && { opacity: 0.5 },
                  ]}
                  disabled={acting || selectedItemIds.length === 0}
                  testID="action-approve-btn"
                >
                  <Ionicons name="checkmark-circle" size={16} color="#FFF" />
                  <Text style={styles.btnApproveTxt}>
                    {selectedItemIds.length === 0
                      ? 'Select Items to Approve'
                      : selectedItemIds.length === (voucher.expenses || []).length
                        ? `Approve All (₹${totalSelectedAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })})`
                        : `Approve Selected (${selectedItemIds.length}) (₹${totalSelectedAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })})`}
                  </Text>
                </Pressable>
              ) : null}

              {canApprove && status === 'submitted' ? (
                <Pressable
                  onPress={handleVerify}
                  style={[styles.btnVerify, acting && { opacity: 0.6 }]}
                  disabled={acting}
                  testID="action-verify-btn"
                >
                  <Ionicons name="shield-checkmark-outline" size={16} color="#4338CA" />
                  <Text style={styles.btnVerifyTxt}>Verify</Text>
                </Pressable>
              ) : null}

              {canApprove && status !== 'rejected' ? (
                <Pressable
                  onPress={() => { setRemarks(''); setModalErr(null); setActionModal({ open: true, type: 'return' }); }}
                  style={styles.btnReturn}
                  disabled={acting}
                  testID="action-return-btn"
                >
                  <Ionicons name="return-down-back" size={16} color="#B45309" />
                  <Text style={styles.btnReturnTxt}>Return</Text>
                </Pressable>
              ) : null}

              {canApprove && status !== 'rejected' ? (
                <Pressable
                  onPress={() => { setRemarks(''); setModalErr(null); setActionModal({ open: true, type: 'reject' }); }}
                  style={styles.btnReject}
                  disabled={acting}
                  testID="action-reject-btn"
                >
                  <Ionicons name="close-circle" size={16} color="#B91C1C" />
                  <Text style={styles.btnRejectTxt}>Reject</Text>
                </Pressable>
              ) : null}
            </View>

            {isAdmin ? (
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#F1F5F9' }}>
                <Pressable onPress={openEditModal} style={[styles.btnVerify, { backgroundColor: '#F0FDFA', borderColor: '#99F6E4' }]}>
                  <Ionicons name="create-outline" size={16} color="#0D9488" />
                  <Text style={[styles.btnVerifyTxt, { color: '#0D9488' }]}>Edit Voucher</Text>
                </Pressable>
                <Pressable onPress={handleDelete} style={[styles.btnReject, acting && { opacity: 0.6 }]} disabled={acting}>
                  <Ionicons name="trash-outline" size={16} color="#B91C1C" />
                  <Text style={styles.btnRejectTxt}>Delete Voucher</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        ) : null}

        {/* Admin Action Panel for approved / rejected */}
        {status === 'approved' || status === 'rejected' ? (
          <View style={styles.approvalPanel}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={styles.panelTitle}>
                {status === 'approved' ? '✓ Voucher Approved & Posted' : '✕ Voucher Rejected'}
              </Text>
              {isAdmin ? (
                <View style={{ backgroundColor: '#EFF6FF', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, borderWidth: 1, borderColor: '#BFDBFE' }}>
                  <Text style={{ fontSize: 11, fontWeight: '800', color: colors.brandPrimary }}>ADMIN LEVEL CONTROLS</Text>
                </View>
              ) : null}
            </View>
            <Text style={{ fontSize: 12, color: colors.muted }}>
              {status === 'approved'
                ? 'This voucher is currently approved and posted into the accounting ledger. As an Administrator, you can edit details, reopen it to Submitted status (which automatically removes/reverses the ledger expense), or delete it.'
                : 'This voucher was rejected. As an Administrator, you can edit its details, reopen it to Submitted status for review, or delete it.'}
            </Text>

            {isAdmin ? (
              <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
                <Pressable onPress={openEditModal} style={[styles.btnVerify, { backgroundColor: '#F0FDFA', borderColor: '#99F6E4' }]}>
                  <Ionicons name="create-outline" size={16} color="#0D9488" />
                  <Text style={[styles.btnVerifyTxt, { color: '#0D9488' }]}>Edit Voucher</Text>
                </Pressable>
                <Pressable onPress={handleReopen} style={[styles.btnVerify, { backgroundColor: '#EFF6FF', borderColor: '#BFDBFE' }]} disabled={acting}>
                  <Ionicons name="reload-outline" size={16} color="#2563EB" />
                  <Text style={[styles.btnVerifyTxt, { color: '#2563EB' }]}>Reopen Voucher</Text>
                </Pressable>
                <Pressable onPress={handleDelete} style={[styles.btnReject, acting && { opacity: 0.6 }]} disabled={acting}>
                  <Ionicons name="trash-outline" size={16} color="#B91C1C" />
                  <Text style={styles.btnRejectTxt}>Delete Voucher</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        ) : null}
      </ScrollView>

      {/* Action Dialog Modal (Reject / Return) */}
      <Modal visible={actionModal.open} transparent animationType="fade" onRequestClose={() => setActionModal({ open: false, type: null })}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard} testID="action-reason-modal">
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {actionModal.type === 'reject' ? 'Reject Expense Voucher' : 'Return for Correction'}
              </Text>
              <Pressable onPress={() => setActionModal({ open: false, type: null })}>
                <Ionicons name="close" size={22} color={colors.onSurface} />
              </Pressable>
            </View>

            <View style={{ padding: spacing.lg, gap: 10 }}>
              <Text style={styles.modalPrompt}>
                {actionModal.type === 'reject'
                  ? 'Please state the reason for rejecting this claim (mandatory):'
                  : 'Please state the corrections required before resubmission (mandatory):'}
              </Text>
              <TextInput
                value={remarks}
                onChangeText={setRemarks}
                placeholder="Enter detailed reason / instructions…"
                placeholderTextColor={colors.muted}
                style={[styles.modalInput, { height: 90 }]}
                multiline
                autoFocus
                testID="action-remarks-input"
              />

              {modalErr ? <Text style={styles.modalErrTxt}>{modalErr}</Text> : null}
            </View>

            <View style={styles.modalFooter}>
              <Pressable onPress={() => setActionModal({ open: false, type: null })} style={styles.cancelBtn}>
                <Text style={styles.cancelBtnTxt}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={handleModalSubmit}
                style={[
                  styles.confirmBtn,
                  { backgroundColor: actionModal.type === 'reject' ? colors.error : '#D97706' },
                  acting && { opacity: 0.6 }
                ]}
                disabled={acting}
                testID="action-submit-btn"
              >
                {acting ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <Text style={styles.confirmBtnTxt}>Confirm {actionModal.type === 'reject' ? 'Reject' : 'Return'}</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Edit Voucher Modal (Admin / Submitter) */}
      <Modal
        visible={editModalOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setEditModalOpen(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}
        >
          <View style={[styles.modalCard, { maxWidth: 640, maxHeight: '90%' }]} testID="edit-voucher-modal">
            <View style={styles.modalHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: '#EFF6FF', alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name="create" size={18} color={colors.brandPrimary} />
                </View>
                <View>
                  <Text style={styles.modalTitle}>Edit Voucher {voucher.voucher_no}</Text>
                  <Text style={{ fontSize: 11, color: colors.muted }}>Modify Line Items & Notes (Admin)</Text>
                </View>
              </View>
              <Pressable onPress={() => setEditModalOpen(false)} hitSlop={10}>
                <Ionicons name="close" size={22} color={colors.onSurface} />
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: 14 }}>
              {/* Pass-On Constraint Info */}
              <View style={{ backgroundColor: '#F8FAFC', padding: 10, borderRadius: radius.md, borderWidth: 1, borderColor: '#E2E8F0', gap: 4 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ fontSize: 12, color: colors.muted }}>Linked Sale Voucher:</Text>
                  <Text style={{ fontSize: 12, fontWeight: '700', color: colors.onSurface }}>{voucher.sale_voucher_no}</Text>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ fontSize: 12, color: colors.muted }}>Sale Received Amount (Max Limit):</Text>
                  <Text style={{ fontSize: 12, fontWeight: '800', color: '#15803D' }}>
                    ₹ {recAmt.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                  </Text>
                </View>

                {voucher.sale_voucher_id ? (
                  <Pressable
                    onPress={handleFetchPassOnItemsForEdit}
                    disabled={loadingInvoiceItems}
                    style={styles.fetchPassOnBtn}
                  >
                    {loadingInvoiceItems ? (
                      <ActivityIndicator size="small" color="#0D9488" />
                    ) : (
                      <>
                        <Ionicons name="cloud-download-outline" size={16} color="#0D9488" />
                        <Text style={styles.fetchPassOnBtnTxt}>
                          Load / Import All Passed-On Items from {voucher.sale_voucher_no}
                        </Text>
                      </>
                    )}
                  </Pressable>
                ) : null}
              </View>

              {/* Line Items List */}
              <Text style={{ fontSize: font.sm, fontWeight: '800', color: colors.onSurface }}>Itemized Expense Lines</Text>
              
              {editItems.map((item, idx) => (
                <View key={item.id || idx} style={styles.editItemBox}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={{ fontSize: 12, fontWeight: '800', color: colors.brandPrimary }}>Line #{idx + 1}</Text>
                    {editItems.length > 1 ? (
                      <Pressable onPress={() => removeEditItem(item.id)} hitSlop={8} style={{ padding: 4 }}>
                        <Ionicons name="trash-outline" size={16} color={colors.error} />
                      </Pressable>
                    ) : null}
                  </View>

                  {/* Category Head Selection */}
                  <View style={{ gap: 4 }}>
                    <Text style={styles.fieldLbl}>Expense Head / Category</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 2 }}>
                      {EXPENSE_HEADS.map(h => {
                        const sel = item.head === h;
                        return (
                          <Pressable
                            key={h}
                            onPress={() => updateEditItem(item.id, 'head', h)}
                            style={[styles.headPill, sel && styles.headPillSel]}
                          >
                            <Text style={[styles.headPillTxt, sel && styles.headPillTxtSel]}>{h}</Text>
                          </Pressable>
                        );
                      })}
                    </ScrollView>
                    {!EXPENSE_HEADS.includes(item.head) ? (
                      <TextInput
                        value={item.head}
                        onChangeText={(val) => updateEditItem(item.id, 'head', val)}
                        placeholder="Custom Expense Head"
                        placeholderTextColor={colors.muted}
                        style={styles.textInputSm}
                      />
                    ) : null}
                  </View>

                  {/* Description */}
                  <View style={{ gap: 4 }}>
                    <Text style={styles.fieldLbl}>Description / Particulars (Optional)</Text>
                    <TextInput
                      value={item.description}
                      onChangeText={(val) => updateEditItem(item.id, 'description', val)}
                      placeholder="Details of expense..."
                      placeholderTextColor={colors.muted}
                      style={styles.textInputSm}
                    />
                  </View>

                  {/* Qty, Rate, Amount */}
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <View style={{ flex: 1, gap: 4 }}>
                      <Text style={styles.fieldLbl}>Quantity</Text>
                      <TextInput
                        value={item.qty}
                        onChangeText={(val) => updateEditItem(item.id, 'qty', val)}
                        keyboardType="numeric"
                        placeholder="1"
                        placeholderTextColor={colors.muted}
                        style={styles.textInputSm}
                      />
                    </View>
                    <View style={{ flex: 1.5, gap: 4 }}>
                      <Text style={styles.fieldLbl}>Rate (₹)</Text>
                      <TextInput
                        value={item.rate}
                        onChangeText={(val) => updateEditItem(item.id, 'rate', val)}
                        keyboardType="numeric"
                        placeholder="0.00"
                        placeholderTextColor={colors.muted}
                        style={styles.textInputSm}
                      />
                    </View>
                    <View style={{ flex: 1.5, gap: 4 }}>
                      <Text style={styles.fieldLbl}>Amount (₹)</Text>
                      <View style={[styles.textInputSm, { backgroundColor: '#F1F5F9', justifyContent: 'center' }]}>
                        <Text style={{ fontWeight: '800', color: colors.onSurface }}>
                          ₹ {item.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </Text>
                      </View>
                    </View>
                  </View>
                </View>
              ))}

              <Pressable onPress={addEditItem} style={styles.addEditItemBtn}>
                <Ionicons name="add-circle-outline" size={16} color={colors.brandPrimary} />
                <Text style={styles.addEditItemBtnTxt}>+ Add Line Item</Text>
              </Pressable>

              {/* Total Summary & Pass-on check */}
              {(() => {
                const editTot = editItems.reduce((acc, it) => acc + (it.amount || 0), 0);
                const exceeds = editTot > recAmt;
                return (
                  <View style={[styles.editSummaryBox, exceeds && { borderColor: '#FCA5A5', backgroundColor: '#FEF2F2' }]}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text style={{ fontSize: 13, fontWeight: '800', color: colors.onSurface }}>New Total Amount:</Text>
                      <Text style={{ fontSize: 16, fontWeight: '900', color: exceeds ? colors.error : colors.brandPrimary }}>
                        ₹ {editTot.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </Text>
                    </View>
                    {exceeds ? (
                      <Text style={{ fontSize: 11, fontWeight: '700', color: colors.error, marginTop: 4 }}>
                        ✕ Pass-On Rule Violation: Total expense exceeds received amount (₹{recAmt.toLocaleString('en-IN')})
                      </Text>
                    ) : (
                      <Text style={{ fontSize: 11, fontWeight: '700', color: '#15803D', marginTop: 4 }}>
                        ✓ Pass-On Rule Compliant
                      </Text>
                    )}
                  </View>
                );
              })()}

              {/* Notes */}
              <View style={{ gap: 4 }}>
                <Text style={styles.fieldLbl}>Submitter / Auditor Notes</Text>
                <TextInput
                  value={editNotes}
                  onChangeText={setEditNotes}
                  placeholder="Add explanation or reason for modification..."
                  placeholderTextColor={colors.muted}
                  multiline
                  style={[styles.textInputSm, { height: 70, textAlignVertical: 'top' }]}
                />
              </View>

              {editErr ? <Text style={styles.modalErrTxt}>{editErr}</Text> : null}
            </ScrollView>

            <View style={styles.modalFooter}>
              <Pressable onPress={() => setEditModalOpen(false)} style={styles.cancelBtn} disabled={savingEdit}>
                <Text style={styles.cancelBtnTxt}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={handleSaveEdit}
                style={[styles.confirmBtn, { backgroundColor: colors.brandPrimary }, savingEdit && { opacity: 0.6 }]}
                disabled={savingEdit}
              >
                {savingEdit ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <Text style={styles.confirmBtnTxt}>Save Changes</Text>
                )}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceSecondary },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    backgroundColor: '#FFF',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  h1: { fontSize: font.lg, fontWeight: '900', color: colors.onSurface },
  subTitle: { fontSize: font.xs, color: colors.muted, marginTop: 1 },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  statusBadgeTxt: { fontSize: 11, fontWeight: '900' },
  body: { padding: spacing.lg, gap: 14 },

  actionToolbar: {
    flexDirection: 'row',
    gap: 8,
  },
  toolbarBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    paddingVertical: 10,
    borderRadius: radius.md,
  },
  toolbarBtnTxt: { fontSize: font.sm, fontWeight: '800', color: colors.brandPrimary },

  card: {
    backgroundColor: '#FFF',
    borderRadius: radius.xl,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 8,
  },
  cardHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  cardTitle: { fontSize: font.base, fontWeight: '800', color: colors.onSurface },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  infoLbl: { fontSize: font.sm, color: colors.muted, fontWeight: '600' },
  infoVal: { fontSize: font.sm, color: colors.onSurface, fontWeight: '600' },

  complianceBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    padding: 10,
    borderRadius: radius.md,
    borderWidth: 1,
    marginTop: 6,
  },
  complianceTxt: { fontSize: 11, fontWeight: '800', flex: 1 },

  // Table
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#F8FAFC',
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginTop: 4,
  },
  thTxt: { fontSize: 11, fontWeight: '800', color: '#475569' },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  itemHead: { fontSize: font.sm, fontWeight: '700', color: colors.onSurface },
  itemDesc: { fontSize: 10, color: colors.muted, marginTop: 1 },
  tdTxt: { fontSize: font.sm, color: colors.onSurface },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 10,
    marginTop: 6,
    borderTopWidth: 2,
    borderTopColor: colors.border,
  },
  totalLbl: { fontSize: font.base, fontWeight: '800', color: colors.onSurface },
  totalVal: { fontSize: font.lg, fontWeight: '900', color: colors.brandPrimary },

  notesBox: {
    backgroundColor: '#F8FAFC',
    padding: 10,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginTop: 4,
  },
  notesLbl: { fontSize: 10, fontWeight: '700', color: colors.muted },
  notesTxt: { fontSize: 11, color: colors.onSurface, marginTop: 2 },

  // Timeline
  timelineItem: {
    flexDirection: 'row',
    gap: 10,
    borderLeftWidth: 2,
    borderLeftColor: colors.brandPrimary,
    paddingLeft: 12,
    marginLeft: 6,
    paddingVertical: 4,
  },
  timelineDot: {
    position: 'absolute',
    left: -17,
    top: 6,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.brandPrimary,
  },
  timelineAction: { fontSize: 12, fontWeight: '900', color: colors.onSurface },
  timelineTime: { fontSize: 10, color: colors.muted },
  timelineActor: { fontSize: 11, color: '#475569', marginTop: 1 },
  timelineRemarks: { fontSize: 11, fontStyle: 'italic', color: '#334155', marginTop: 2 },

  // Approval Panel
  approvalPanel: {
    backgroundColor: '#FFF',
    borderRadius: radius.xl,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 10,
  },
  panelTitle: { fontSize: font.base, fontWeight: '800', color: colors.onSurface },
  selfApprovalWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FEF3C7',
    padding: 10,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  selfApprovalWarningTxt: { fontSize: 11, color: '#92400E', fontWeight: '700', flex: 1 },
  btnApprove: {
    flex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#15803D',
    paddingVertical: 12,
    borderRadius: radius.md,
  },
  btnApproveTxt: { color: '#FFF', fontWeight: '800', fontSize: font.sm },
  btnVerify: {
    flex: 1.2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: '#EEF2FF',
    borderWidth: 1,
    borderColor: '#C7D2FE',
    paddingVertical: 12,
    borderRadius: radius.md,
  },
  btnVerifyTxt: { color: '#4338CA', fontWeight: '800', fontSize: font.sm },
  btnReturn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FDE68A',
    paddingVertical: 12,
    borderRadius: radius.md,
  },
  btnReturnTxt: { color: '#B45309', fontWeight: '800', fontSize: font.sm },
  btnReject: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: '#FEE2E2',
    borderWidth: 1,
    borderColor: '#FECACA',
    paddingVertical: 12,
    borderRadius: radius.md,
  },
  btnRejectTxt: { color: '#B91C1C', fontWeight: '800', fontSize: font.sm },

  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  modalCard: {
    width: '100%',
    maxWidth: 440,
    backgroundColor: '#FFF',
    borderRadius: radius.xl,
    overflow: 'hidden',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  modalTitle: { fontSize: font.base, fontWeight: '800', color: colors.onSurface },
  modalPrompt: { fontSize: font.sm, color: colors.onSurface, fontWeight: '600' },
  modalInput: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 10,
    fontSize: font.sm,
    textAlignVertical: 'top',
    color: colors.onSurface,
  },
  modalErrTxt: { color: colors.error, fontSize: 11, fontWeight: '700' },
  modalFooter: {
    flexDirection: 'row',
    gap: 10,
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtnTxt: { color: colors.onSurface, fontWeight: '700', fontSize: font.sm },
  confirmBtn: {
    flex: 1.5,
    paddingVertical: 12,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmBtnTxt: { color: '#FFF', fontWeight: '800', fontSize: font.sm },

  // Edit Modal Styles
  editItemBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 10,
    gap: 8,
  },
  fieldLbl: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.muted,
  },
  headPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  headPillSel: {
    backgroundColor: colors.brandPrimary,
    borderColor: colors.brandPrimary,
  },
  headPillTxt: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
  },
  headPillTxtSel: {
    color: '#FFF',
  },
  textInputSm: {
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 6,
    fontSize: font.sm,
    color: colors.onSurface,
  },
  addEditItemBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#BFDBFE',
    backgroundColor: '#EFF6FF',
    borderStyle: 'dashed',
  },
  addEditItemBtnTxt: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.brandPrimary,
  },
  editSummaryBox: {
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    borderRadius: radius.md,
    padding: 10,
  },
  multiSelectBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#F0FDFA',
    borderWidth: 1,
    borderColor: '#99F6E4',
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginLeft: 'auto',
  },
  multiSelectBadgeTxt: {
    fontSize: 10,
    fontWeight: '800',
    color: '#0F766E',
  },
  sectionSubtitleTxt: {
    fontSize: 11,
    color: colors.muted,
    marginBottom: 8,
  },
  selectAllHeaderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingRight: 6,
  },
  selectAllHeaderTxt: {
    fontSize: 11,
    fontWeight: '800',
    color: '#0F766E',
  },
  rowCheckCell: {
    width: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 6,
  },
  tableRowSelected: {
    backgroundColor: '#F0FDFA',
    borderColor: '#99F6E4',
  },
  selectedTotalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: '#F0FDFA',
    borderTopWidth: 2,
    borderTopColor: '#0D9488',
    borderRadius: radius.sm,
    marginTop: 8,
  },
  selectedTotalLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#0F766E',
  },
  selectedTotalSub: {
    fontSize: 9,
    color: '#14B8A6',
    fontWeight: '700',
  },
  selectedTotalVal: {
    fontSize: font.base,
    fontWeight: '800',
    color: '#0F766E',
  },
  totalBadge: {
    backgroundColor: '#0D9488',
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  totalBadgeTxt: {
    color: '#FFF',
    fontSize: 10,
    fontWeight: '800',
  },
  voucherTotalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#F8FAFC',
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
  },
  voucherTotalLbl: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.muted,
  },
  voucherTotalVal: {
    fontSize: font.sm,
    fontWeight: '800',
    color: colors.onSurface,
  },
  fetchPassOnBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: '#F0FDFA',
    borderWidth: 1,
    borderColor: '#99F6E4',
    borderRadius: radius.md,
    marginTop: 6,
  },
  fetchPassOnBtnTxt: {
    fontSize: 12,
    fontWeight: '800',
    color: '#0F766E',
  },
});
