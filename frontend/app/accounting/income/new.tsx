import React, { useEffect, useState, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, KeyboardAvoidingView, Platform,
  Pressable, TextInput, ActivityIndicator, Alert, Modal, Linking
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, font } from '@/src/theme';
import { ScreenHeader } from '@/src/ScreenHeader';
import { FormInput, OptionRow } from '@/src/forms';
import { PrimaryButton } from '@/src/ui';
import { api } from '@/src/api';
import { useAuth } from '@/src/AuthContext';
import { AttachmentsSection, Attachment } from '@/src/AttachmentsSection';
import { CustomerSearchModal, AddPartyModal, EditPartyModal, PickedParty } from '@/src/CustomerSearchModal';

const today = () => new Date().toISOString().slice(0, 10);

const inr = (n: any) => {
  const val = Number(n || 0);
  return `₹${val.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

export type PaymentInItem = {
  sl: number;
  item: string;
  qty: number;
  rate: number;
  amount: number;
  voucher_id?: string;
};

export type LinkedVoucher = {
  voucher_id: string;
  voucher_no: string;
  voucher_date: string;
  total_amount: number;
  previous_paid: number;
  outstanding_balance: number;
  allocated_amount: number;
  payment_mode: string;
  payment_type: string;
  remarks?: string;
};

export type PaymentSplit = {
  id: string;
  mode: string;
  amount: string;
  reference: string;
  bank_account_id?: string;
};

const PAY_MODES = [
  { key: 'cash', label: 'Cash', icon: 'cash-outline' },
  { key: 'bank_transfer', label: 'Bank Transfer / Online', icon: 'card-outline' },
  { key: 'cheque', label: 'Cheque', icon: 'document-text-outline' },
  { key: 'upi', label: 'UPI / QR', icon: 'qr-code-outline' },
  { key: 'other', label: 'Other', icon: 'ellipsis-horizontal-circle-outline' },
];

export default function NewPaymentIn() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ customer_id?: string; accounting?: string; is_old_accounting?: string }>();
  const isOldAccounting = params?.accounting === 'old' || params?.is_old_accounting === 'true';

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Voucher details
  const [voucherNo, setVoucherNo] = useState<string>(isOldAccounting ? 'OLD-PAYIN-0001' : 'PAYIN-0001 (preview)');
  const [date, setDate] = useState<string>(today());
  const [isManualVoucher, setIsManualVoucher] = useState(isOldAccounting);

  // Customer State & Modals
  const [showPartyPick, setShowPartyPick] = useState(false);
  const [showAddParty, setShowAddParty] = useState(false);
  const [showEditParty, setShowEditParty] = useState(false);
  const [selectedParty, setSelectedParty] = useState<PickedParty | null>(null);

  // Previous Sale Vouchers
  const [loadingVouchers, setLoadingVouchers] = useState(false);
  const [saleVouchers, setSaleVouchers] = useState<any[]>([]);

  // Itemized Particulars (Sl., Item, Qty, Rate, Amount)
  const [items, setItems] = useState<PaymentInItem[]>([
    { sl: 1, item: '', qty: 1, rate: 0, amount: 0 }
  ]);
  const [customTotalAmount, setCustomTotalAmount] = useState<string>('');

  // Linked Vouchers state
  const [linkedVouchers, setLinkedVouchers] = useState<LinkedVoucher[]>([]);

  // Multi-Mode Payment Splits state
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';

  const [paymentSplits, setPaymentSplits] = useState<PaymentSplit[]>([
    { id: 'pay_1', mode: 'cash', amount: '', reference: '', bank_account_id: '' }
  ]);
  const [activePickingSplitId, setActivePickingSplitId] = useState<string | null>(null);
  const [showAddCategoryModal, setShowAddCategoryModal] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [savingCategory, setSavingCategory] = useState(false);

  // "Link Voucher" Modal State
  const [linkModalVisible, setLinkModalVisible] = useState(false);
  const [linkingVoucher, setLinkingVoucher] = useState<any | null>(null);
  const [linkAllocatedAmount, setLinkAllocatedAmount] = useState<string>('');
  const [linkPaymentMode, setLinkPaymentMode] = useState<string>('bank');
  const [linkPaymentType, setLinkPaymentType] = useState<string>('Part Payment');
  const [linkRemarks, setLinkRemarks] = useState<string>('');
  const [linkErr, setLinkErr] = useState<string | null>(null);

  // "View Link History" Modal State
  const [historyModalVisible, setHistoryModalVisible] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyData, setHistoryData] = useState<any | null>(null);

  // Success & Print Modal State
  const [createdVoucher, setCreatedVoucher] = useState<any | null>(null);
  const [successModalVisible, setSuccessModalVisible] = useState(false);

  // Metadata & Options
  const [meta, setMeta] = useState<any>({
    income_categories: ['DSC Services', 'E-Tender Services', 'Railway Registration', 'Contractor Registration', 'GST/Tax Services', 'Other Services'],
    payment_modes: ['cash', 'bank', 'upi', 'cheque']
  });
  const [banks, setBanks] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [serviceCategory, setServiceCategory] = useState<string>('Other Services');
  const [serviceName, setServiceName] = useState<string>('');
  const [paymentMode, setPaymentMode] = useState<string>('cash');
  const [bankAccountId, setBankAccountId] = useState<string>('');
  const [employeeId, setEmployeeId] = useState<string>('');
  const [employeeName, setEmployeeName] = useState<string>('');
  const [remarks, setRemarks] = useState<string>('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);

  // Load next voucher number and meta on mount
  useEffect(() => {
    (async () => {
      try {
        const [nextRes, m, b, e] = await Promise.all([
          api.get<any>(`/income/next-no${isOldAccounting ? '?is_old_accounting=true' : ''}`).catch(() => null),
          api.get<any>('/accounting/meta').catch(() => null),
          api.get<any[]>('/bank-accounts').catch(() => []),
          api.get<any[]>('/employees').catch(() => []),
        ]);
        if (nextRes) {
          if (nextRes.next_no) {
            setVoucherNo(nextRes.voucher_mode === 'manual' || isOldAccounting ? nextRes.next_no : `${nextRes.next_no} (preview)`);
          }
          if (nextRes.voucher_mode || isOldAccounting) {
            setIsManualVoucher(isOldAccounting || nextRes.voucher_mode === 'manual');
          }
          if (nextRes.date_start_from) {
            setDate(nextRes.date_start_from);
          }
        } else if (isOldAccounting) {
          setVoucherNo('OLD-PAYIN-0001');
          setIsManualVoucher(true);
        }
        if (m) setMeta(m);
        if (b) setBanks(b);
        if (e) setEmployees(e);
      } catch {}
    })();
  }, [isOldAccounting]);

  // Fetch sale vouchers for selected customer
  const loadCustomerVouchers = async (partyId: string) => {
    setLoadingVouchers(true);
    try {
      const invs = await api.get<any[]>(`/invoices?invoice_type=sale&party_id=${partyId}${isOldAccounting ? '&is_old_accounting=true' : ''}`);
      setSaleVouchers(invs || []);
    } catch {
      setSaleVouchers([]);
    } finally {
      setLoadingVouchers(false);
    }
  };

  const handleSelectCustomer = (party: PickedParty) => {
    setSelectedParty(party);
    setLinkedVouchers([]);
    loadCustomerVouchers(party.id);
  };

  const handleDeleteCustomer = () => {
    if (!selectedParty) return;
    Alert.alert(
      'Delete Customer?',
      `Are you sure you want to delete customer "${selectedParty.name}"? This action cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.del(`/customers/${selectedParty.id}`);
              setSelectedParty(null);
              setSaleVouchers([]);
              setLinkedVouchers([]);
              Alert.alert('Deleted', 'Customer was deleted successfully.');
            } catch (e: any) {
              Alert.alert('Cannot Delete', e?.message || 'Failed to delete customer.');
            }
          }
        }
      ]
    );
  };

  // Itemized particulars manipulation
  const updateItem = (index: number, field: keyof PaymentInItem, val: any) => {
    setItems(prev => {
      const next = [...prev];
      const cur = { ...next[index], [field]: val };
      if (field === 'qty' || field === 'rate') {
        const q = parseFloat(field === 'qty' ? val : cur.qty) || 0;
        const r = parseFloat(field === 'rate' ? val : cur.rate) || 0;
        cur.amount = Math.round(q * r * 100) / 100;
      } else if (field === 'amount') {
        const a = parseFloat(val) || 0;
        cur.amount = a;
        const q = parseFloat(cur.qty as any) || 1;
        if (q > 0) {
          cur.rate = Math.round((a / q) * 100) / 100;
        }
      }
      next[index] = cur;
      return next;
    });
  };

  const addItemRow = () => {
    setItems(prev => [
      ...prev,
      { sl: prev.length + 1, item: '', qty: 1, rate: 0, amount: 0 }
    ]);
  };

  const removeItemRow = (index: number) => {
    if (items.length <= 1) return;
    setItems(prev => prev.filter((_, i) => i !== index).map((it, idx) => ({ ...it, sl: idx + 1 })));
  };

  // Calculate items total
  const itemsSum = useMemo(() => {
    return items.reduce((acc, it) => acc + (Number(it.amount) || 0), 0);
  }, [items]);

  // Total allocated to linked vouchers
  const totalAllocated = useMemo(() => {
    return linkedVouchers.reduce((acc, lv) => acc + (Number(lv.allocated_amount) || 0), 0);
  }, [linkedVouchers]);

  // Combined sum of all entered payment modes
  const totalSplitPaid = useMemo(() => {
    return paymentSplits.reduce((sum, ps) => sum + (parseFloat(ps.amount) || 0), 0);
  }, [paymentSplits]);

  // Target required amount (from line items or linked vouchers)
  const targetRequiredAmount = useMemo(() => {
    if (itemsSum > 0) return itemsSum;
    if (totalAllocated > 0) return totalAllocated;
    if (customTotalAmount && !Number.isNaN(parseFloat(customTotalAmount))) {
      return parseFloat(customTotalAmount);
    }
    return 0;
  }, [itemsSum, totalAllocated, customTotalAmount]);

  const duesNum = useMemo(() => {
    return Math.max(0, Math.round((targetRequiredAmount - totalSplitPaid) * 100) / 100);
  }, [targetRequiredAmount, totalSplitPaid]);

  // Effective payment in amount
  const effectiveTotalAmount = useMemo(() => {
    if (customTotalAmount && !Number.isNaN(parseFloat(customTotalAmount))) {
      return parseFloat(customTotalAmount);
    }
    if (totalSplitPaid > 0) return totalSplitPaid;
    if (itemsSum > 0) return itemsSum;
    if (totalAllocated > 0) return totalAllocated;
    return 0;
  }, [customTotalAmount, totalSplitPaid, itemsSum, totalAllocated]);

  // Auto sync single split with required target amount
  useEffect(() => {
    if (paymentSplits.length === 1 && (!paymentSplits[0].amount || parseFloat(paymentSplits[0].amount) === 0)) {
      if (targetRequiredAmount > 0) {
        setPaymentSplits([{ ...paymentSplits[0], amount: String(targetRequiredAmount) }]);
      }
    }
  }, [targetRequiredAmount]);

  const handleAddPaymentSplit = () => {
    const usedModes = paymentSplits.map(s => s.mode);
    const availableMode = PAY_MODES.find(m => !usedModes.includes(m.key))?.key || 'other';
    setPaymentSplits(prev => [
      ...prev,
      {
        id: `pay_${Date.now()}`,
        mode: availableMode,
        amount: '',
        reference: '',
        bank_account_id: bankAccountId || '',
      }
    ]);
  };

  const handleUpdatePaymentSplit = (id: string, field: keyof PaymentSplit, val: string) => {
    setPaymentSplits(prev => prev.map(s => s.id === id ? { ...s, [field]: val } : s));
  };

  const handleRemovePaymentSplit = (id: string) => {
    if (paymentSplits.length <= 1) {
      setPaymentSplits([{ id: 'pay_1', mode: 'cash', amount: '', reference: '', bank_account_id: '' }]);
      return;
    }
    setPaymentSplits(prev => prev.filter(s => s.id !== id));
  };

  const handleAutoFillRemaining = (id: string) => {
    const otherSum = paymentSplits.filter(s => s.id !== id).reduce((acc, s) => acc + (parseFloat(s.amount) || 0), 0);
    const remaining = Math.max(0, Math.round((targetRequiredAmount - otherSum) * 100) / 100);
    handleUpdatePaymentSplit(id, 'amount', remaining > 0 ? String(remaining) : '');
  };

  // Open "Link Voucher" modal
  const openLinkModal = (voucher: any) => {
    setLinkingVoucher(voucher);
    const prevAlloc = linkedVouchers.find(l => l.voucher_id === voucher.id);
    const baseOutstanding = voucher.balance ?? Math.max(0, (voucher.total_amount || 0) - (voucher.paid_amount || 0));
    // If already linked, outstanding should add back prevAlloc
    const availableToAllocate = prevAlloc ? (baseOutstanding + prevAlloc.allocated_amount) : baseOutstanding;
    setLinkAllocatedAmount(prevAlloc ? String(prevAlloc.allocated_amount) : String(availableToAllocate));
    setLinkPaymentMode(paymentMode || 'bank');
    setLinkPaymentType('Part Payment');
    setLinkRemarks('');
    setLinkErr(null);
    setLinkModalVisible(true);
  };

  // Save linked voucher allocation with live validation & dynamic balance reduction
  const handleSaveLinkVoucher = () => {
    if (!linkingVoucher) return;
    const alloc = parseFloat(linkAllocatedAmount);
    const prevAlloc = linkedVouchers.find(l => l.voucher_id === linkingVoucher.id);
    const baseOutstanding = linkingVoucher.balance ?? Math.max(0, (linkingVoucher.total_amount || 0) - (linkingVoucher.paid_amount || 0));
    const maxAvailable = prevAlloc ? (baseOutstanding + prevAlloc.allocated_amount) : baseOutstanding;

    if (Number.isNaN(alloc) || alloc <= 0) {
      setLinkErr('Please enter a valid allocated payment amount.');
      return;
    }
    if (alloc > maxAvailable) {
      setLinkErr(`Allocated amount (${inr(alloc)}) cannot exceed the outstanding balance (${inr(maxAvailable)}).`);
      return;
    }

    const newLink: LinkedVoucher = {
      voucher_id: linkingVoucher.id,
      voucher_no: linkingVoucher.invoice_no,
      voucher_date: linkingVoucher.date || today(),
      total_amount: linkingVoucher.total_amount || 0,
      previous_paid: linkingVoucher.paid_amount || 0,
      outstanding_balance: maxAvailable,
      allocated_amount: alloc,
      payment_mode: linkPaymentMode,
      payment_type: linkPaymentType,
      remarks: linkRemarks || undefined,
    };

    setLinkedVouchers(prev => {
      const filtered = prev.filter(l => l.voucher_id !== linkingVoucher.id);
      return [...filtered, newLink];
    });

    // Dynamically update saleVouchers state so the balance decreases immediately on screen
    setSaleVouchers(prev => prev.map(sv => {
      if (sv.id === linkingVoucher.id) {
        const remaining = Math.max(0, Math.round((maxAvailable - alloc) * 100) / 100);
        const originalPaid = prevAlloc ? (sv.paid_amount - prevAlloc.allocated_amount) : (sv.paid_amount || 0);
        const newPaid = Math.round((originalPaid + alloc) * 100) / 100;
        return {
          ...sv,
          balance: remaining,
          paid_amount: newPaid,
          status: remaining <= 0 ? 'paid' : 'partial'
        };
      }
      return sv;
    }));

    // Auto-populate Item Breakdown PARTICULAR-WISE from linked voucher
    const rawVoucherItems = Array.isArray(linkingVoucher.items) ? linkingVoucher.items : [];
    const validVItems = rawVoucherItems.filter((it: any) => it && (it.name || it.item));

    let newItemsForVoucher: PaymentInItem[] = [];

    if (validVItems.length > 0) {
      // Total amount across all items in the voucher
      const itemsRawTotal = validVItems.reduce((acc: number, it: any) => {
        const lineAmt = Number(it.amount != null ? it.amount : ((Number(it.qty) || 1) * (Number(it.price) || 0))) || 0;
        return acc + lineAmt;
      }, 0);

      // Proportion ratio if allocated differs from voucher total
      const ratio = itemsRawTotal > 0 ? (alloc / itemsRawTotal) : (1 / validVItems.length);

      let runningAlloc = 0;
      newItemsForVoucher = validVItems.map((it: any, idx: number) => {
        const itName = String(it.name || it.item || 'Item').trim();
        const itQty = Number(it.qty) || 1;
        const itOrigPrice = Number(it.price != null ? it.price : it.rate) || 0;
        const itOrigAmt = Number(it.amount != null ? it.amount : (itQty * itOrigPrice)) || 0;

        let itAllocAmt: number;
        if (Math.abs(alloc - itemsRawTotal) < 0.01) {
          itAllocAmt = itOrigAmt;
        } else if (idx === validVItems.length - 1) {
          itAllocAmt = Math.max(0, Math.round((alloc - runningAlloc) * 100) / 100);
        } else {
          itAllocAmt = Math.round(itOrigAmt * ratio * 100) / 100;
          runningAlloc += itAllocAmt;
        }

        const itRate = itQty > 0 ? Math.round((itAllocAmt / itQty) * 100) / 100 : itAllocAmt;

        return {
          sl: idx + 1,
          item: itName,
          qty: itQty,
          rate: itRate,
          amount: itAllocAmt,
          voucher_id: linkingVoucher.id,
        };
      });
    } else {
      const vDesc = linkingVoucher.invoice_no
        ? `Payment against Voucher ${linkingVoucher.invoice_no}`
        : 'Payment Receipt';
      newItemsForVoucher = [{
        sl: 1,
        item: vDesc,
        qty: 1,
        rate: alloc,
        amount: alloc,
        voucher_id: linkingVoucher.id,
      }];
    }

    setItems(prev => {
      // Remove any previously linked items for this same voucher (if re-linking/editing link)
      const filteredPrev = prev.filter(r => r.voucher_id !== linkingVoucher.id);
      const isBlankOrZero = filteredPrev.length === 0 || (
        filteredPrev.length === 1 &&
        (!filteredPrev[0].item.trim() || !filteredPrev[0].rate || filteredPrev[0].rate === 0 || !filteredPrev[0].amount || filteredPrev[0].amount === 0)
      );

      const baseList = isBlankOrZero ? [] : filteredPrev;
      const combined = [...baseList, ...newItemsForVoucher];
      return combined.map((it, idx) => ({ ...it, sl: idx + 1 }));
    });

    // Auto-sync single split amount if empty/0
    setPaymentSplits(prev => {
      if (prev.length <= 1 && (!prev[0].amount || parseFloat(prev[0].amount) === 0)) {
        return [{
          ...prev[0],
          amount: String(alloc),
        }];
      }
      return prev;
    });

    setLinkModalVisible(false);
  };

  const handleRemoveLinkedVoucher = (voucherId: string) => {
    const toRemove = linkedVouchers.find(l => l.voucher_id === voucherId);
    if (toRemove) {
      setSaleVouchers(prev => prev.map(sv => {
        if (sv.id === voucherId) {
          const restoredBal = Math.round(((sv.balance || 0) + toRemove.allocated_amount) * 100) / 100;
          const restoredPaid = Math.max(0, Math.round(((sv.paid_amount || 0) - toRemove.allocated_amount) * 100) / 100);
          return {
            ...sv,
            balance: restoredBal,
            paid_amount: restoredPaid,
            status: restoredBal <= 0 ? 'paid' : (restoredPaid > 0 ? 'partial' : 'unpaid')
          };
        }
        return sv;
      }));
    }
    setLinkedVouchers(prev => prev.filter(l => l.voucher_id !== voucherId));

    // Also remove items corresponding to this unlinked voucher
    setItems(prev => {
      const remaining = prev.filter(it => it.voucher_id !== voucherId);
      if (remaining.length === 0) {
        return [{ sl: 1, item: '', qty: 1, rate: 0, amount: 0 }];
      }
      return remaining.map((it, idx) => ({ ...it, sl: idx + 1 }));
    });
  };

  // Open "View Link History" modal
  const openHistoryModal = async (voucher: any) => {
    setHistoryModalVisible(true);
    setHistoryLoading(true);
    setHistoryData(null);
    try {
      const data = await api.get<any>(`/invoices/${voucher.id}/payment-history`);
      setHistoryData(data);
    } catch {
      // Fallback
      setHistoryData({
        invoice_no: voucher.invoice_no,
        invoice_date: voucher.date,
        party_name: selectedParty?.name || voucher.party_name,
        total_amount: voucher.total_amount || 0,
        paid_amount: voucher.paid_amount || 0,
        balance: voucher.balance ?? Math.max(0, (voucher.total_amount || 0) - (voucher.paid_amount || 0)),
        status: voucher.status || 'unpaid',
        payments: voucher.payments || [
          {
            date: voucher.date || 'Initial',
            payment_no: `INITIAL-${voucher.invoice_no}`,
            amount: voucher.paid_amount || 0,
            payment_mode: voucher.payment_mode || 'cash',
            payment_type: 'Initial Payment',
            balance_after: voucher.balance || 0,
          }
        ]
      });
    } finally {
      setHistoryLoading(false);
    }
  };

  // Print Payment-In voucher as official PDF
  const printIncomePdf = async (incomeId?: string) => {
    const targetId = incomeId || createdVoucher?.id;
    if (!targetId) return;
    try {
      const url = await api.incomePdfUrl(targetId);
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.open(url, '_blank');
      } else {
        await Linking.openURL(url);
      }
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Unable to open PDF voucher');
    }
  };

  // Save Payment-In voucher
  const savePaymentIn = async (printAfterSave = false) => {
    if (!selectedParty?.name?.trim()) {
      setErr('Customer / Party selection is required.');
      return;
    }
    const finalAmount = effectiveTotalAmount;
    if (finalAmount <= 0) {
      setErr('Please specify payment amount or add line items / linked vouchers.');
      return;
    }

    setErr(null);
    setBusy(true);

    try {
      const validSplits = paymentSplits
        .map(s => ({
          mode: s.mode,
          amount: parseFloat(s.amount) || 0,
          reference: s.reference ? s.reference.trim() : '',
          bank_account_id: s.bank_account_id || bankAccountId || null,
        }))
        .filter(s => s.amount > 0);

      const dominantMode = validSplits.length > 0 ? validSplits.map(s => s.mode).join(', ') : paymentMode;
      const splitSum = validSplits.reduce((acc, s) => acc + s.amount, 0);
      const computedFinalAmount = splitSum > 0 ? splitSum : finalAmount;

      const payload = {
        voucher_no: voucherNo.includes('preview') ? undefined : voucherNo,
        date,
        client_id: selectedParty.id,
        client_name: selectedParty.name.trim(),
        client_mobile: selectedParty.mobile || null,
        service_category: serviceCategory,
        service_name: serviceName || (items[0]?.item ? items[0].item : 'Payment-In Receipt'),
        amount: computedFinalAmount,
        payment_mode: dominantMode,
        payment_splits: validSplits.length > 0 ? validSplits : undefined,
        bank_account_id: bankAccountId || null,
        employee_id: employeeId || null,
        employee_name: employeeName || null,
        remarks: remarks || null,
        items: items.filter(it => it.item.trim() || it.amount > 0),
        linked_vouchers: linkedVouchers,
        is_old_accounting: isOldAccounting,
      };

      const created: any = await api.post('/income', payload);

      // Upload any attachments
      for (const a of attachments) {
        if (a.pending && a.uri) {
          try {
            await api.uploadVoucherFile('income', created.id, {
              uri: a.uri,
              name: a.name,
              type: a.type || 'application/octet-stream'
            });
          } catch {}
        }
      }

      setCreatedVoucher(created);
      setSuccessModalVisible(true);

      if (printAfterSave) {
        printIncomePdf(created.id);
      }
    } catch (e: any) {
      setErr(e?.message || 'Failed to save Payment-In');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surfaceSecondary }} testID="new-payment-in">
      <ScreenHeader
        title={isOldAccounting ? "Old Payment-In entry" : "Payment-In (Add Income)"}
        subtitle={isOldAccounting ? "📜 Old Accounting Stream" : undefined}
      />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: spacing.md, gap: spacing.md, paddingBottom: 60 + insets.bottom }}>

          {/* Section 1: Auto-Generated Voucher Number & Date */}
          <View style={styles.card}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Ionicons name="document-text-outline" size={20} color="#2563EB" />
                <Text style={styles.sectionTitle}>PAYMENT-IN VOUCHER NUMBER & DATE</Text>
              </View>
              <View style={styles.autoBadge}>
                <Ionicons name="flash" size={12} color="#2563EB" />
                <Text style={styles.autoBadgeTxt}>Auto Numbering</Text>
              </View>
            </View>

            <View style={{ flexDirection: 'row', gap: 12, marginTop: 4 }}>
              <View style={{ flex: 1 }}>
                <FormInput
                  label={isManualVoucher ? "Payment-In Voucher No. (Manual Entry) *" : "Payment-In Voucher No. (Auto) *"}
                  value={voucherNo}
                  onChangeText={isManualVoucher ? setVoucherNo : (() => {})}
                  placeholder={isManualVoucher ? "e.g. PAYIN-0001" : "PAYIN-0001"}
                  testID="voucher-no"
                />
              </View>
              <View style={{ flex: 1 }}>
                <FormInput
                  label="Voucher Date *"
                  value={date}
                  onChangeText={setDate}
                  placeholder="YYYY-MM-DD"
                  testID="voucher-date"
                />
              </View>
            </View>
          </View>

          {/* Section 2: Customer Details Search & CRUD */}
          <View style={styles.card}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Ionicons name="person-circle-outline" size={20} color="#059669" />
                <Text style={styles.sectionTitle}>CUSTOMER DETAILS & MASTER</Text>
              </View>
              <Pressable
                testID="btn-search-customer"
                onPress={() => setShowPartyPick(true)}
                style={styles.searchPartyBtn}
              >
                <Ionicons name="search" size={15} color="#FFF" />
                <Text style={styles.searchPartyBtnTxt}>Customer Search</Text>
              </Pressable>
            </View>

            {selectedParty ? (
              <View style={styles.customerCard}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.customerName}>{selectedParty.name}</Text>
                    {selectedParty.customer_code ? (
                      <Text style={styles.customerCode}>{selectedParty.customer_code}</Text>
                    ) : null}
                    <Text style={styles.customerMeta}>📱 Mobile: <Text style={{ fontWeight: '700', color: '#1E293B' }}>{selectedParty.mobile}</Text></Text>
                    {selectedParty.gst_no ? <Text style={styles.customerMeta}>🏛 GSTIN: {selectedParty.gst_no}</Text> : null}
                    {selectedParty.pan ? <Text style={styles.customerMeta}>💳 PAN: {selectedParty.pan}</Text> : null}
                    {selectedParty.address ? <Text style={styles.customerMeta}>📍 Address: {selectedParty.address}</Text> : null}
                  </View>

                  <View style={styles.customerActions}>
                    <Pressable
                      testID="btn-edit-customer"
                      onPress={() => setShowEditParty(true)}
                      style={styles.actionChipEdit}
                    >
                      <Ionicons name="pencil" size={13} color="#2563EB" />
                      <Text style={styles.actionChipEditTxt}>Edit</Text>
                    </Pressable>
                    <Pressable
                      testID="btn-delete-customer"
                      onPress={handleDeleteCustomer}
                      style={styles.actionChipDelete}
                    >
                      <Ionicons name="trash-outline" size={13} color="#DC2626" />
                      <Text style={styles.actionChipDeleteTxt}>Delete</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => setShowAddParty(true)}
                      style={styles.actionChipNew}
                    >
                      <Ionicons name="add" size={14} color="#059669" />
                      <Text style={styles.actionChipNewTxt}>New</Text>
                    </Pressable>
                  </View>
                </View>
              </View>
            ) : (
              <View style={styles.noCustomerBox}>
                <Ionicons name="people-outline" size={32} color="#94A3B8" />
                <Text style={styles.noCustomerTxt}>No customer selected yet.</Text>
                <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
                  <Pressable
                    onPress={() => setShowPartyPick(true)}
                    style={styles.pickPartyBtn}
                  >
                    <Ionicons name="search" size={16} color="#FFF" />
                    <Text style={styles.pickPartyBtnTxt}>Search Customer</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setShowAddParty(true)}
                    style={styles.addPartyBtn}
                  >
                    <Ionicons name="add-circle-outline" size={16} color="#059669" />
                    <Text style={styles.addPartyBtnTxt}>+ Add New Customer</Text>
                  </Pressable>
                </View>
              </View>
            )}
          </View>

          {/* Section 3: Previous Sale Vouchers Search & Dynamic Balance Reduction */}
          {selectedParty ? (
            <View style={styles.card}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Ionicons name="newspaper-outline" size={20} color="#7C3AED" />
                  <Text style={styles.sectionTitle}>PREVIOUS SALE VOUCHERS</Text>
                </View>
                <Pressable
                  onPress={() => loadCustomerVouchers(selectedParty.id)}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
                >
                  <Ionicons name="refresh" size={14} color="#64748B" />
                  <Text style={{ fontSize: 11, color: '#64748B', fontWeight: '600' }}>Refresh</Text>
                </Pressable>
              </View>

              {loadingVouchers ? (
                <View style={{ padding: 20, alignItems: 'center' }}>
                  <ActivityIndicator color={colors.brandPrimary} />
                  <Text style={{ color: '#64748B', fontSize: 12, marginTop: 6 }}>Loading sale vouchers…</Text>
                </View>
              ) : saleVouchers.length === 0 ? (
                <View style={styles.emptyVoucherBox}>
                  <Ionicons name="receipt-outline" size={28} color="#94A3B8" />
                  <Text style={{ color: '#64748B', fontSize: 12, textAlign: 'center' }}>
                    No previous Sale Vouchers found for this customer.
                  </Text>
                </View>
              ) : (
                <View style={{ gap: 8 }}>
                  <Text style={{ fontSize: 11, color: '#64748B', fontWeight: '600' }}>
                    Customer ke pichle Sale Vouchers me se choose karein aur Link karein:
                  </Text>

                  {saleVouchers.map(v => {
                    const isLinked = linkedVouchers.find(l => l.voucher_id === v.id);
                    const allocatedNow = isLinked ? Number(isLinked.allocated_amount || 0) : 0;
                    const curOutstanding = Number(v.balance ?? Math.max(0, (v.total_amount || 0) - (v.paid_amount || 0)));
                    const isFullyPaid = curOutstanding <= 0;

                    return (
                      <View key={v.id} style={[styles.saleVoucherRow, isLinked && styles.saleVoucherRowLinked]}>
                        <View style={{ flex: 1 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <Text style={styles.svNo}>{v.invoice_no}</Text>
                            <View style={[styles.svStatusBadge, isFullyPaid ? styles.bgPaid : (isLinked ? styles.bgPartialLinked : styles.bgUnpaid)]}>
                              <Text style={[styles.svStatusTxt, isFullyPaid ? styles.txtPaid : (isLinked ? styles.txtPartialLinked : styles.txtUnpaid)]}>
                                {isFullyPaid ? 'PAID (CLEARED)' : (isLinked ? 'PARTIAL (LINKED)' : (v.status || 'unpaid').toUpperCase())}
                              </Text>
                            </View>
                            <Text style={styles.svDate}>📅 {v.date}</Text>
                          </View>

                          <View style={styles.svAmountsRow}>
                            <Text style={styles.svAmtTxt}>Total: <Text style={{ fontWeight: '700' }}>{inr(v.total_amount)}</Text></Text>
                            <Text style={styles.svAmtTxt}>
                              • Paid: <Text style={{ fontWeight: '700', color: '#059669' }}>{inr(v.paid_amount)}</Text>
                              {allocatedNow > 0 ? (
                                <Text style={{ fontSize: 11, color: '#059669', fontWeight: '700' }}> (+{inr(allocatedNow)} linked)</Text>
                              ) : null}
                            </Text>
                            <Text style={styles.svAmtTxt}>
                              • Outstanding Balance:{' '}
                              {isFullyPaid ? (
                                <Text style={{ fontWeight: '900', color: '#059669' }}>
                                  ₹0.00 (Balance Cleared / Settled ✅)
                                </Text>
                              ) : (
                                <Text style={{ fontWeight: '900', color: '#DC2626' }}>
                                  {inr(curOutstanding)}
                                  {allocatedNow > 0 ? (
                                    <Text style={{ fontSize: 10, color: '#059669', fontWeight: '700' }}> (Reduced)</Text>
                                  ) : null}
                                </Text>
                              )}
                            </Text>
                          </View>
                        </View>

                        <View style={styles.svBtnGroup}>
                          <Pressable
                            testID={`btn-link-sv-${v.invoice_no}`}
                            onPress={() => openLinkModal(v)}
                            style={[styles.linkBtn, isLinked && styles.linkBtnActive]}
                          >
                            <Ionicons name={isLinked ? 'checkmark-circle' : 'link'} size={14} color="#FFF" />
                            <Text style={styles.linkBtnTxt}>{isLinked ? 'Edit Link' : 'Link Voucher'}</Text>
                          </Pressable>

                          <Pressable
                            testID={`btn-history-sv-${v.invoice_no}`}
                            onPress={() => openHistoryModal(v)}
                            style={styles.historyBtn}
                          >
                            <Ionicons name="time-outline" size={14} color="#0F172A" />
                            <Text style={styles.historyBtnTxt}>View Link History</Text>
                          </Pressable>
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}
            </View>
          ) : null}

          {/* Section 4: Linked Vouchers & Date-wise Allocations */}
          {linkedVouchers.length > 0 && (
            <View style={[styles.card, { borderColor: '#86EFAC', backgroundColor: '#F0FDF4' }]}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Ionicons name="checkmark-done-circle" size={20} color="#059669" />
                  <Text style={[styles.sectionTitle, { color: '#065F46' }]}>LINKED SALE VOUCHERS ({linkedVouchers.length})</Text>
                </View>
                <Text style={{ fontWeight: '800', color: '#059669', fontSize: 13 }}>
                  Total Linked: {inr(totalAllocated)}
                </Text>
              </View>

              <View style={{ gap: 6, marginTop: 4 }}>
                {linkedVouchers.map((lv, idx) => {
                  const rem = Math.max(0, lv.outstanding_balance - lv.allocated_amount);
                  return (
                    <View key={lv.voucher_id} style={styles.linkedRowCard}>
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Text style={{ fontWeight: '800', color: '#0F172A', fontSize: 14 }}>{lv.voucher_no}</Text>
                          <View style={styles.typePill}><Text style={styles.typePillTxt}>{lv.payment_type}</Text></View>
                          <Text style={{ fontSize: 11, color: '#64748B' }}>Mode: {lv.payment_mode.toUpperCase()}</Text>
                        </View>

                        <Text style={{ fontSize: 12, color: '#334155', marginTop: 2 }}>
                          Allocated Payment: <Text style={{ fontWeight: '800', color: '#059669' }}>{inr(lv.allocated_amount)}</Text>
                          {' '}(Previous Balance: {inr(lv.outstanding_balance)} → Remaining: <Text style={{ fontWeight: '800', color: rem > 0 ? '#DC2626' : '#059669' }}>{inr(rem)}</Text>)
                        </Text>
                      </View>

                      <Pressable
                        onPress={() => handleRemoveLinkedVoucher(lv.voucher_id)}
                        hitSlop={6}
                        style={{ padding: 4 }}
                      >
                        <Ionicons name="close-circle" size={20} color="#DC2626" />
                      </Pressable>
                    </View>
                  );
                })}
              </View>
            </View>
          )}

          {/* Section 5: Itemized Particulars Table (Sl., Item, Qty, Rate, Amount) */}
          <View style={styles.card}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Ionicons name="list-outline" size={20} color="#0284C7" />
                <Text style={styles.sectionTitle}>PARTICULARS / ITEMS BREAKDOWN</Text>
              </View>
              <Pressable
                testID="btn-add-item-row"
                onPress={addItemRow}
                style={styles.addItemBtn}
              >
                <Ionicons name="add" size={14} color="#FFF" />
                <Text style={styles.addItemBtnTxt}>+ Add Item Row</Text>
              </Pressable>
            </View>

            {/* Table Header */}
            <View style={styles.itemTableHeader}>
              <Text style={[styles.colHdr, { width: 32 }]}>Sl.</Text>
              <Text style={[styles.colHdr, { flex: 2 }]}>Item / Particulars</Text>
              <Text style={[styles.colHdr, { width: 50, textAlign: 'center' }]}>Qty</Text>
              <Text style={[styles.colHdr, { width: 75, textAlign: 'right' }]}>Rate (₹)</Text>
              <Text style={[styles.colHdr, { width: 85, textAlign: 'right' }]}>Amount (₹)</Text>
              <Text style={[styles.colHdr, { width: 30 }]}></Text>
            </View>

            {/* Rows */}
            {items.map((row, idx) => (
              <View key={idx} style={styles.itemTableRow}>
                <Text style={[styles.cellTxt, { width: 32, textAlign: 'center', fontWeight: '700' }]}>{row.sl}</Text>
                <TextInput
                  value={row.item}
                  onChangeText={v => updateItem(idx, 'item', v)}
                  placeholder="Service / Particulars"
                  placeholderTextColor="#94A3B8"
                  style={[styles.tableInput, { flex: 2 }]}
                  testID={`item-name-${idx}`}
                />
                <TextInput
                  value={String(row.qty)}
                  onChangeText={v => updateItem(idx, 'qty', v)}
                  keyboardType="numeric"
                  style={[styles.tableInput, { width: 50, textAlign: 'center' }]}
                  testID={`item-qty-${idx}`}
                />
                <TextInput
                  value={String(row.rate || '')}
                  onChangeText={v => updateItem(idx, 'rate', v)}
                  placeholder="0.00"
                  keyboardType="numeric"
                  style={[styles.tableInput, { width: 75, textAlign: 'right' }]}
                  testID={`item-rate-${idx}`}
                />
                <TextInput
                  value={String(row.amount || '')}
                  onChangeText={v => updateItem(idx, 'amount', v)}
                  placeholder="0.00"
                  keyboardType="numeric"
                  style={[styles.tableInput, { width: 85, textAlign: 'right', fontWeight: '800', color: '#059669' }]}
                  testID={`item-amount-${idx}`}
                />
                <Pressable
                  onPress={() => removeItemRow(idx)}
                  hitSlop={6}
                  style={{ width: 30, alignItems: 'center' }}
                  disabled={items.length <= 1}
                >
                  <Ionicons name="trash-outline" size={16} color={items.length <= 1 ? '#CBD5E1' : '#DC2626'} />
                </Pressable>
              </View>
            ))}

            {/* Total Footer */}
            <View style={styles.itemTableFooter}>
              <Text style={{ fontSize: 13, fontWeight: '700', color: '#334155' }}>Total Line Items Amount:</Text>
              <Text style={{ fontSize: 16, fontWeight: '900', color: '#059669' }}>{inr(itemsSum)}</Text>
            </View>
          </View>

          {/* Section 6: Payment Details, Bank Account & Service Category (Multi-Mode Split) */}
          <View style={styles.card}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Ionicons name="wallet-outline" size={20} color="#D97706" />
                <Text style={styles.sectionTitle}>PAYMENT MODE & BANK ACCOUNT</Text>
              </View>
              <View style={{ backgroundColor: '#D1FAE5', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 }}>
                <Text style={{ color: '#047857', fontSize: 11, fontWeight: '800' }}>Multi-Mode Support</Text>
              </View>
            </View>

            {/* Total Paid & Remaining Dues Banner */}
            <View style={styles.splitSummaryBanner}>
              <View style={styles.splitSumCol}>
                <Text style={styles.splitSumLbl}>Total Paid (Auto Sum)</Text>
                <Text style={[styles.splitSumVal, { color: '#059669' }]}>{inr(totalSplitPaid)}</Text>
              </View>
              <View style={[styles.splitSumCol, { alignItems: 'flex-end' }]}>
                <Text style={styles.splitSumLbl}>Remaining Balance (Dues)</Text>
                <Text style={[styles.splitSumVal, { color: duesNum > 0 ? '#DC2626' : '#059669' }]}>
                  {duesNum > 0 ? inr(duesNum) : '₹0.00 (Cleared)'}
                </Text>
              </View>
            </View>

            {/* Payment Splits List */}
            <View style={{ gap: 8 }}>
              {paymentSplits.map((sp, idx) => {
                const currentModeObj = PAY_MODES.find(m => m.key === sp.mode) || PAY_MODES[0];
                const isBankOrCheque = ['bank_transfer', 'upi', 'cheque', 'bank', 'online'].includes(sp.mode);
                return (
                  <View key={sp.id} style={styles.splitCard}>
                    <View style={styles.splitHeaderRow}>
                      <Pressable
                        onPress={() => setActivePickingSplitId(sp.id)}
                        style={styles.splitModeBtn}
                      >
                        <Ionicons name={currentModeObj.icon as any} size={18} color="#059669" />
                        <Text style={styles.splitModeTxt}>{currentModeObj.label}</Text>
                        <Ionicons name="chevron-down" size={14} color="#64748B" />
                      </Pressable>

                      <View style={styles.splitAmtBox}>
                        <Text style={styles.splitCurrency}>₹</Text>
                        <TextInput
                          keyboardType="numeric"
                          value={sp.amount}
                          onChangeText={v => handleUpdatePaymentSplit(sp.id, 'amount', v)}
                          style={styles.splitAmtInput}
                          placeholder="0.00"
                          placeholderTextColor="#94A3B8"
                        />
                      </View>

                      {paymentSplits.length > 1 ? (
                        <Pressable onPress={() => handleRemovePaymentSplit(sp.id)} hitSlop={6} style={{ padding: 4 }}>
                          <Ionicons name="trash-outline" size={18} color="#DC2626" />
                        </Pressable>
                      ) : null}
                    </View>

                    {/* Bank Account Selection (if Bank/Cheque/Online) */}
                    {isBankOrCheque && banks.length > 0 && (
                      <View style={{ gap: 4, marginTop: 4, paddingHorizontal: 4 }}>
                        <Text style={{ fontSize: 11, fontWeight: '700', color: '#475569' }}>Deposit into Bank Account:</Text>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                          {banks.map(b => {
                            const isSel = (sp.bank_account_id || bankAccountId) === b.id;
                            return (
                              <Pressable
                                key={b.id}
                                onPress={() => {
                                  handleUpdatePaymentSplit(sp.id, 'bank_account_id', b.id);
                                  setBankAccountId(b.id);
                                }}
                                style={[styles.chip, isSel && styles.chipActive]}
                              >
                                <Text style={[styles.chipText, isSel && { color: '#FFF' }]}>{b.name}</Text>
                              </Pressable>
                            );
                          })}
                        </View>
                      </View>
                    )}

                    {/* Reference / UTR / Cheque / Notes input */}
                    <View style={styles.splitRefRow}>
                      <Ionicons name="bookmark-outline" size={14} color="#64748B" />
                      <TextInput
                        value={sp.reference}
                        onChangeText={v => handleUpdatePaymentSplit(sp.id, 'reference', v)}
                        style={styles.splitRefInput}
                        placeholder={
                          sp.mode === 'cheque' ? 'Cheque No. & Bank Name' :
                          sp.mode === 'upi' ? 'UPI Transaction ID / Ref No.' :
                          sp.mode === 'bank_transfer' ? 'UTR / IMPS / NEFT Reference' :
                          'Payment Note / Ref (optional)'
                        }
                        placeholderTextColor="#94A3B8"
                      />
                      {duesNum > 0 && (parseFloat(sp.amount) || 0) === 0 ? (
                        <Pressable onPress={() => handleAutoFillRemaining(sp.id)} style={styles.quickFillBtn}>
                          <Text style={styles.quickFillTxt}>Fill Remaining</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  </View>
                );
              })}
            </View>

            {/* Add More Split Button */}
            <Pressable onPress={handleAddPaymentSplit} style={styles.addSplitBtn}>
              <Ionicons name="add-circle-outline" size={18} color="#059669" />
              <Text style={styles.addSplitTxt}>+ Add Payment Mode (Online / Cheque / Cash / UPI)</Text>
            </Pressable>

            <View style={{ gap: 6, marginTop: 8 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={styles.fieldLabel}>Service Category</Text>
                {isAdmin && (
                  <Pressable
                    onPress={() => setShowAddCategoryModal(true)}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4, backgroundColor: '#EFF6FF', borderWidth: 1, borderColor: '#BFDBFE' }}
                  >
                    <Ionicons name="add" size={14} color="#2563EB" />
                    <Text style={{ fontSize: 11, fontWeight: '800', color: '#2563EB' }}>+ Add Category</Text>
                  </Pressable>
                )}
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {(meta.income_categories || []).map((cat: string) => (
                  <Pressable
                    key={cat}
                    onPress={() => setServiceCategory(cat)}
                    style={[styles.chip, serviceCategory === cat && styles.chipActive]}
                  >
                    <Text style={[styles.chipText, serviceCategory === cat && { color: '#FFF' }]}>{cat}</Text>
                  </Pressable>
                ))}
              </View>
            </View>

            {employees.length > 0 && (
              <View style={{ gap: 6, marginTop: 4 }}>
                <Text style={styles.fieldLabel}>Received By (Employee) — {employees.length} Staff Available</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, maxHeight: 180, overflow: 'scroll' }}>
                  {employees.map(e => (
                    <Pressable
                      key={e.id}
                      onPress={() => { setEmployeeId(e.id); setEmployeeName(e.name); }}
                      style={[styles.chip, employeeId === e.id && styles.chipActive]}
                    >
                      <Text style={[styles.chipText, employeeId === e.id && { color: '#FFF' }]}>{e.name}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            )}

            <FormInput
              label="Remarks / Notes (optional)"
              value={remarks}
              onChangeText={setRemarks}
              placeholder="e.g. Part payment against tender consultation"
              multiline
              testID="in-remarks"
            />
          </View>

          {/* Section 7: Final Amount Summary Card */}
          <View style={[styles.card, { backgroundColor: '#F8FAFC', borderWidth: 2, borderColor: '#CBD5E1' }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ fontSize: 13, fontWeight: '800', color: '#0F172A' }}>TOTAL PAYMENT-IN RECEIVED:</Text>
              <Text style={{ fontSize: 20, fontWeight: '900', color: '#059669' }}>
                {inr(effectiveTotalAmount)}
              </Text>
            </View>

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 11, color: '#64748B' }}>
                  Override Amount (if different from sum):
                </Text>
                <TextInput
                  value={customTotalAmount}
                  onChangeText={setCustomTotalAmount}
                  placeholder={String(effectiveTotalAmount || '0.00')}
                  keyboardType="numeric"
                  style={styles.overrideInput}
                  testID="in-amount-override"
                />
              </View>
              <View style={{ flex: 1, justifyContent: 'center' }}>
                <Text style={{ fontSize: 11, color: '#64748B' }}>
                  Linked Vouchers: <Text style={{ fontWeight: '700', color: '#059669' }}>{inr(totalAllocated)}</Text>
                </Text>
                <Text style={{ fontSize: 11, color: '#64748B' }}>
                  Line Items: <Text style={{ fontWeight: '700', color: '#0284C7' }}>{inr(itemsSum)}</Text>
                </Text>
              </View>
            </View>
          </View>

          {/* Section 8: Attachments */}
          <AttachmentsSection
            attachments={attachments}
            onChange={setAttachments}
            title="Receipt / Bank Slip Attachments"
            hint="Receipt / bank counterfoil / UPI confirmation • Max 10 MB per file"
          />

          {err ? (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle" size={16} color="#DC2626" />
              <Text style={styles.errorTxt}>{err}</Text>
            </View>
          ) : null}

          {/* Section 9: Action Buttons (Save & Print PDF Option) */}
          <View style={{ gap: 10, marginTop: 4 }}>
            <Pressable
              testID="btn-save-and-print"
              onPress={() => savePaymentIn(true)}
              disabled={busy}
              style={[styles.saveAndPrintBtn, busy && { opacity: 0.6 }]}
            >
              {busy ? (
                <ActivityIndicator color="#FFF" size="small" />
              ) : (
                <>
                  <Ionicons name="print" size={18} color="#FFF" />
                  <Text style={styles.saveAndPrintBtnTxt}>Save & Print Official Voucher (PDF)</Text>
                </>
              )}
            </Pressable>

            <PrimaryButton
              label={`Save Payment-In (${inr(effectiveTotalAmount)})`}
              onPress={() => savePaymentIn(false)}
              loading={busy}
              testID="save-payment-in-btn"
            />
          </View>

        </ScrollView>
      </KeyboardAvoidingView>

      {/* Customer Search Modal */}
      <CustomerSearchModal
        visible={showPartyPick}
        onClose={() => setShowPartyPick(false)}
        onPick={handleSelectCustomer}
        onAddNew={p => { handleSelectCustomer(p); }}
        title="Select Customer / Party"
      />

      {/* Add Customer Modal */}
      <AddPartyModal
        visible={showAddParty}
        onClose={() => setShowAddParty(false)}
        onCreated={p => { setShowAddParty(false); handleSelectCustomer(p); }}
      />

      {/* Edit Customer Modal */}
      <EditPartyModal
        visible={showEditParty}
        party={selectedParty}
        onClose={() => setShowEditParty(false)}
        onUpdated={p => { setShowEditParty(false); setSelectedParty(p); }}
      />

      {/* ============================================================== */}
      {/* Modal: "Link Voucher" (वाउचर लिंक करें)                         */}
      {/* ============================================================== */}
      <Modal
        visible={linkModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setLinkModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHead}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="link" size={20} color="#2563EB" />
                <Text style={styles.modalTitle}>Link Payment to Sale Voucher</Text>
              </View>
              <Pressable onPress={() => setLinkModalVisible(false)}>
                <Ionicons name="close" size={22} color="#111827" />
              </Pressable>
            </View>

            {linkingVoucher && (
              <ScrollView contentContainerStyle={{ gap: 12, paddingVertical: 6 }}>
                <View style={styles.linkingSummaryBox}>
                  <Text style={{ fontWeight: '800', color: '#0F172A', fontSize: 14 }}>
                    Voucher: {linkingVoucher.invoice_no} ({linkingVoucher.date})
                  </Text>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
                    <Text style={{ fontSize: 12, color: '#475569' }}>Total Bill: <Text style={{ fontWeight: '700' }}>{inr(linkingVoucher.total_amount)}</Text></Text>
                    <Text style={{ fontSize: 12, color: '#475569' }}>Already Paid: <Text style={{ fontWeight: '700', color: '#059669' }}>{inr(linkingVoucher.paid_amount)}</Text></Text>
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 2, borderTopWidth: 1, borderTopColor: '#E2E8F0', paddingTop: 4 }}>
                    <Text style={{ fontSize: 13, fontWeight: '800', color: '#0F172A' }}>Outstanding Balance:</Text>
                    <Text style={{ fontSize: 15, fontWeight: '900', color: '#DC2626' }}>
                      {inr(linkingVoucher.balance ?? Math.max(0, (linkingVoucher.total_amount || 0) - (linkingVoucher.paid_amount || 0)))}
                    </Text>
                  </View>
                </View>

                <FormInput
                  label="Allocated Payment Amount (₹) *"
                  value={linkAllocatedAmount}
                  onChangeText={setLinkAllocatedAmount}
                  keyboardType="numeric"
                  placeholder="0.00"
                  testID="link-allocated-amount"
                />

                <OptionRow
                  label="Payment Mode"
                  options={['cash', 'bank', 'upi', 'cheque']}
                  value={linkPaymentMode}
                  onChange={setLinkPaymentMode}
                  testID="link-payment-mode"
                />

                <View style={{ gap: 6 }}>
                  <Text style={styles.fieldLabel}>Type of Payment</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    {['Part Payment', 'Balance Cleared', 'Full Settlement', 'Advance Adjustment'].map(t => (
                      <Pressable
                        key={t}
                        onPress={() => setLinkPaymentType(t)}
                        style={[styles.chip, linkPaymentType === t && styles.chipActive]}
                      >
                        <Text style={[styles.chipText, linkPaymentType === t && { color: '#FFF' }]}>{t}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>

                <FormInput
                  label="Remarks / Notes (optional)"
                  value={linkRemarks}
                  onChangeText={setLinkRemarks}
                  placeholder="e.g. Paid via NEFT ref #987654"
                  testID="link-remarks"
                />

                {linkErr ? (
                  <View style={styles.errorBox}>
                    <Ionicons name="alert-circle" size={15} color="#DC2626" />
                    <Text style={styles.errorTxt}>{linkErr}</Text>
                  </View>
                ) : null}

                <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 6 }}>
                  <Pressable
                    onPress={() => setLinkModalVisible(false)}
                    style={styles.modalCancelBtn}
                  >
                    <Text style={styles.modalCancelTxt}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    testID="btn-save-link"
                    onPress={handleSaveLinkVoucher}
                    style={styles.modalSaveBtn}
                  >
                    <Text style={styles.modalSaveTxt}>Confirm Link</Text>
                  </Pressable>
                </View>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* ============================================================== */}
      {/* Modal: "View Link History" (लिंक इतिहास देखें)                   */}
      {/* ============================================================== */}
      <Modal
        visible={historyModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setHistoryModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { maxWidth: 520 }]}>
            <View style={styles.modalHead}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="time" size={20} color="#7C3AED" />
                <Text style={styles.modalTitle}>Sale Voucher Payment History</Text>
              </View>
              <Pressable onPress={() => setHistoryModalVisible(false)}>
                <Ionicons name="close" size={22} color="#111827" />
              </Pressable>
            </View>

            {historyLoading ? (
              <View style={{ padding: 30, alignItems: 'center' }}>
                <ActivityIndicator color={colors.brandPrimary} />
                <Text style={{ marginTop: 8, color: '#64748B', fontSize: 12 }}>Loading payment timeline…</Text>
              </View>
            ) : historyData ? (
              <ScrollView contentContainerStyle={{ gap: 12, paddingVertical: 6 }}>
                {/* Header Summary */}
                <View style={styles.historySummaryBox}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={{ fontWeight: '900', color: '#0F172A', fontSize: 15 }}>
                      {historyData.invoice_no}
                    </Text>
                    <View style={[styles.svStatusBadge, historyData.status === 'paid' ? styles.bgPaid : styles.bgUnpaid]}>
                      <Text style={[styles.svStatusTxt, historyData.status === 'paid' ? styles.txtPaid : styles.txtUnpaid]}>
                        {(historyData.status || 'unpaid').toUpperCase()}
                      </Text>
                    </View>
                  </View>
                  <Text style={{ fontSize: 12, color: '#64748B', marginTop: 2 }}>
                    Customer: <Text style={{ fontWeight: '700', color: '#1E293B' }}>{historyData.party_name}</Text> • Date: {historyData.invoice_date}
                  </Text>

                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8, paddingTop: 6, borderTopWidth: 1, borderTopColor: '#E2E8F0' }}>
                    <View>
                      <Text style={{ fontSize: 11, color: '#64748B' }}>Total Bill</Text>
                      <Text style={{ fontSize: 14, fontWeight: '800', color: '#0F172A' }}>{inr(historyData.total_amount)}</Text>
                    </View>
                    <View>
                      <Text style={{ fontSize: 11, color: '#64748B' }}>Cumulative Paid</Text>
                      <Text style={{ fontSize: 14, fontWeight: '800', color: '#059669' }}>{inr(historyData.paid_amount)}</Text>
                    </View>
                    <View>
                      <Text style={{ fontSize: 11, color: '#64748B' }}>Balance Due</Text>
                      <Text style={{ fontSize: 14, fontWeight: '800', color: (historyData.balance || 0) > 0 ? '#DC2626' : '#059669' }}>
                        {inr(historyData.balance)}
                      </Text>
                    </View>
                  </View>
                </View>

                {/* Timeline / Payments Table */}
                <Text style={{ fontSize: 12, fontWeight: '800', color: '#334155', letterSpacing: 0.5 }}>
                  DATE-WISE PAYMENT BREAKDOWN:
                </Text>

                {(historyData.payments || []).length === 0 ? (
                  <View style={{ padding: 16, alignItems: 'center' }}>
                    <Text style={{ color: '#94A3B8', fontSize: 12 }}>No payments recorded yet.</Text>
                  </View>
                ) : (
                  <View style={{ gap: 8 }}>
                    {(historyData.payments || []).map((p: any, pidx: number) => (
                      <View key={pidx} style={styles.historyItemCard}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <Ionicons name="checkmark-circle" size={16} color="#059669" />
                            <Text style={{ fontWeight: '800', color: '#0F172A', fontSize: 13 }}>
                              {p.payment_no || `REC-${pidx + 1}`}
                            </Text>
                            <View style={{ backgroundColor: '#F1F5F9', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }}>
                              <Text style={{ fontSize: 10, fontWeight: '700', color: '#475569' }}>{p.date}</Text>
                            </View>
                          </View>
                          <Text style={{ fontSize: 14, fontWeight: '900', color: '#059669' }}>
                            + {inr(p.amount)}
                          </Text>
                        </View>

                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                          <Text style={{ fontSize: 11, color: '#64748B' }}>
                            Mode: <Text style={{ fontWeight: '700', color: '#1E293B' }}>{String(p.payment_mode || 'cash').toUpperCase()}</Text> • Type: <Text style={{ fontWeight: '600' }}>{p.payment_type || 'Part Payment'}</Text>
                          </Text>
                          <Text style={{ fontSize: 11, color: '#64748B' }}>
                            Remaining Balance: <Text style={{ fontWeight: '700', color: (p.balance_after || 0) > 0 ? '#DC2626' : '#059669' }}>{inr(p.balance_after)}</Text>
                          </Text>
                        </View>

                        {p.remarks ? (
                          <Text style={{ fontSize: 11, color: '#64748B', fontStyle: 'italic', marginTop: 2 }}>
                            "{p.remarks}"
                          </Text>
                        ) : null}
                      </View>
                    ))}
                  </View>
                )}

                <Pressable
                  onPress={() => setHistoryModalVisible(false)}
                  style={[styles.modalSaveBtn, { alignSelf: 'flex-end', marginTop: 8 }]}
                >
                  <Text style={styles.modalSaveTxt}>Close History</Text>
                </Pressable>
              </ScrollView>
            ) : null}
          </View>
        </View>
      </Modal>

      {/* ============================================================== */}
      {/* Modal: Payment-In Saved Successfully & Print Voucher           */}
      {/* ============================================================== */}
      <Modal
        visible={successModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setSuccessModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { maxWidth: 460, alignItems: 'center' }]}>
            <View style={styles.successIconCircle}>
              <Ionicons name="checkmark" size={32} color="#059669" />
            </View>
            <Text style={styles.successModalTitle}>Payment-In Saved Successfully!</Text>
            <Text style={styles.successModalSub}>भुगतान वाउचर सफलतापूर्वक सहेजा गया है।</Text>

            {createdVoucher && (
              <View style={styles.successDetailsBox}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ color: '#64748B', fontSize: 12 }}>Voucher No:</Text>
                  <Text style={{ fontWeight: '800', color: '#0F172A', fontSize: 13 }}>
                    {createdVoucher.voucher_no || createdVoucher.income_no}
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
                  <Text style={{ color: '#64748B', fontSize: 12 }}>Customer:</Text>
                  <Text style={{ fontWeight: '700', color: '#0F172A', fontSize: 13 }}>
                    {createdVoucher.client_name}
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
                  <Text style={{ color: '#64748B', fontSize: 12 }}>Amount Received:</Text>
                  <Text style={{ fontWeight: '900', color: '#059669', fontSize: 16 }}>
                    {inr(createdVoucher.amount)}
                  </Text>
                </View>
                {createdVoucher.linked_vouchers?.length ? (
                  <View style={{ marginTop: 8, paddingTop: 6, borderTopWidth: 1, borderTopColor: '#E2E8F0' }}>
                    <Text style={{ fontSize: 11, fontWeight: '700', color: '#475569', marginBottom: 4 }}>
                      Reconciled Sale Vouchers:
                    </Text>
                    {createdVoucher.linked_vouchers.map((lv: any, idx: number) => {
                      const rem = Math.max(0, (lv.total_amount || 0) - ((lv.previous_paid || 0) + (lv.allocated_amount || 0)));
                      return (
                        <Text key={idx} style={{ fontSize: 11, color: '#059669', marginTop: 2 }}>
                          ✔ {lv.voucher_no}: Linked +{inr(lv.allocated_amount)} (Balance: {inr(rem)})
                        </Text>
                      );
                    })}
                  </View>
                ) : null}
              </View>
            )}

            <View style={{ width: '100%', gap: 8, marginTop: 12 }}>
              <Pressable
                testID="btn-print-saved-voucher"
                onPress={() => printIncomePdf(createdVoucher?.id)}
                style={styles.modalPrintBtn}
              >
                <Ionicons name="print" size={18} color="#FFF" />
                <Text style={styles.modalPrintBtnTxt}>Print Official Voucher / Receipt (PDF)</Text>
              </Pressable>

              <Pressable
                onPress={() => {
                  setSuccessModalVisible(false);
                  if (createdVoucher?.id) router.push(`/accounting/income/${createdVoucher.id}` as any);
                }}
                style={styles.modalViewBtn}
              >
                <Ionicons name="eye-outline" size={16} color="#0F172A" />
                <Text style={styles.modalViewBtnTxt}>View Voucher Details</Text>
              </Pressable>

              <Pressable
                onPress={() => {
                  setSuccessModalVisible(false);
                  router.back();
                }}
                style={styles.modalDoneBtn}
              >
                <Text style={styles.modalDoneBtnTxt}>Done / Back to Accounting</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>


      {/* ============================================================== */}
      {/* Modal: Payment Mode Picker                                     */}
      {/* ============================================================== */}
      <Modal
        visible={activePickingSplitId !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setActivePickingSplitId(null)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setActivePickingSplitId(null)}>
          <Pressable style={[styles.modalCard, { maxWidth: 420 }]} onPress={e => e.stopPropagation()}>
            <View style={styles.modalHead}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="wallet-outline" size={20} color="#059669" />
                <Text style={styles.modalTitle}>Choose Payment Mode</Text>
              </View>
              <Pressable onPress={() => setActivePickingSplitId(null)}>
                <Ionicons name="close" size={22} color="#111827" />
              </Pressable>
            </View>
            <View style={{ gap: 8, paddingVertical: 10 }}>
              {PAY_MODES.map(m => (
                <Pressable
                  key={m.key}
                  onPress={() => {
                    if (activePickingSplitId) {
                      handleUpdatePaymentSplit(activePickingSplitId, 'mode', m.key);
                    }
                    setActivePickingSplitId(null);
                  }}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                    padding: 12,
                    borderRadius: 8,
                    borderWidth: 1,
                    borderColor: '#E2E8F0',
                    backgroundColor: '#F8FAFC'
                  }}
                >
                  <Ionicons name={m.icon as any} size={20} color="#059669" />
                  <Text style={{ fontSize: 14, fontWeight: '700', color: '#1E293B', flex: 1 }}>{m.label}</Text>
                  <Ionicons name="chevron-forward" size={16} color="#94A3B8" />
                </Pressable>
              ))}
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ============================================================== */}
      {/* Modal: Add Service Category (Admin Only)                       */}
      {/* ============================================================== */}
      <Modal
        visible={showAddCategoryModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowAddCategoryModal(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setShowAddCategoryModal(false)}>
          <Pressable style={[styles.modalCard, { maxWidth: 420 }]} onPress={e => e.stopPropagation()}>
            <View style={styles.modalHead}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="add-circle" size={20} color="#2563EB" />
                <Text style={styles.modalTitle}>Add Custom Service Category</Text>
              </View>
              <Pressable onPress={() => setShowAddCategoryModal(false)}>
                <Ionicons name="close" size={22} color="#111827" />
              </Pressable>
            </View>
            <View style={{ gap: 12, paddingVertical: 12 }}>
              <Text style={{ fontSize: 13, color: '#64748B' }}>
                Enter custom service category name to be added to system:
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
                placeholder="e.g. Gem Registration, Trademark Services"
                placeholderTextColor="#94A3B8"
                value={newCategoryName}
                onChangeText={setNewCategoryName}
              />
              <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
                <Pressable
                  onPress={() => setShowAddCategoryModal(false)}
                  style={{ paddingHorizontal: 16, paddingVertical: 8, borderRadius: 6, backgroundColor: '#F1F5F9' }}
                >
                  <Text style={{ fontWeight: '700', color: '#475569' }}>Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={async () => {
                    const trimmed = newCategoryName.trim();
                    if (!trimmed) return;
                    setSavingCategory(true);
                    try {
                      const res = await api.post<any>('/settings/service-categories', { name: trimmed });
                      if (res?.categories) {
                        setMeta((p: any) => ({ ...p, income_categories: res.categories }));
                      } else {
                        setMeta((p: any) => ({ ...p, income_categories: [...(p.income_categories || []), trimmed] }));
                      }
                      setServiceCategory(trimmed);
                      setNewCategoryName('');
                      setShowAddCategoryModal(false);
                      Alert.alert('Category Added', `Service category "${trimmed}" added successfully.`);
                    } catch (err: any) {
                      Alert.alert('Error', err?.message || 'Failed to add category');
                    } finally {
                      setSavingCategory(false);
                    }
                  }}
                  disabled={savingCategory}
                  style={{ paddingHorizontal: 16, paddingVertical: 8, borderRadius: 6, backgroundColor: '#2563EB' }}
                >
                  <Text style={{ fontWeight: '700', color: '#FFF' }}>{savingCategory ? 'Saving...' : 'Add Category'}</Text>
                </Pressable>
              </View>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFF',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: 10,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '900',
    color: '#334155',
    letterSpacing: 0.8,
  },
  autoBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  autoBadgeTxt: {
    fontSize: 10,
    fontWeight: '800',
    color: '#2563EB',
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipActive: {
    backgroundColor: colors.brandPrimary,
    borderColor: colors.brandPrimary,
  },
  chipText: {
    color: colors.onSurface,
    fontWeight: '600',
    fontSize: 12,
  },

  // Customer Section
  searchPartyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#059669',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.sm,
  },
  searchPartyBtnTxt: {
    color: '#FFF',
    fontSize: 11,
    fontWeight: '800',
  },
  customerCard: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: radius.sm,
    padding: spacing.md,
  },
  customerName: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
  },
  customerCode: {
    fontSize: 11,
    fontWeight: '700',
    color: '#2563EB',
    marginTop: 1,
  },
  customerMeta: {
    fontSize: 12,
    color: '#475569',
    marginTop: 2,
  },
  customerActions: {
    flexDirection: 'column',
    gap: 6,
    alignItems: 'flex-end',
  },
  actionChipEdit: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  actionChipEditTxt: {
    fontSize: 11,
    fontWeight: '700',
    color: '#2563EB',
  },
  actionChipDelete: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FEF2F2',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  actionChipDeleteTxt: {
    fontSize: 11,
    fontWeight: '700',
    color: '#DC2626',
  },
  actionChipNew: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  actionChipNewTxt: {
    fontSize: 11,
    fontWeight: '700',
    color: '#059669',
  },
  noCustomerBox: {
    alignItems: 'center',
    padding: spacing.md,
    gap: 4,
  },
  noCustomerTxt: {
    fontSize: 12,
    color: '#64748B',
  },
  pickPartyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#059669',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.sm,
  },
  pickPartyBtnTxt: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '700',
  },
  addPartyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#059669',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.sm,
  },
  addPartyBtnTxt: {
    color: '#059669',
    fontSize: 12,
    fontWeight: '700',
  },

  // Previous Sale Vouchers
  emptyVoucherBox: {
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#F8FAFC',
    borderRadius: radius.sm,
  },
  saleVoucherRow: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: radius.sm,
    padding: 10,
    gap: 8,
  },
  saleVoucherRowLinked: {
    borderColor: '#86EFAC',
    backgroundColor: '#F0FDF4',
  },
  svNo: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
  },
  svDate: {
    fontSize: 11,
    color: '#64748B',
  },
  svStatusBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  bgPaid: { backgroundColor: '#DCFCE7' },
  bgUnpaid: { backgroundColor: '#FEE2E2' },
  bgPartialLinked: { backgroundColor: '#FEF3C7' },
  svStatusTxt: { fontSize: 9, fontWeight: '900' },
  txtPaid: { color: '#166534' },
  txtUnpaid: { color: '#991B1B' },
  txtPartialLinked: { color: '#B45309' },
  svAmountsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  svAmtTxt: {
    fontSize: 12,
    color: '#334155',
  },
  svBtnGroup: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'flex-end',
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    paddingTop: 8,
  },
  linkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#2563EB',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.sm,
  },
  linkBtnActive: {
    backgroundColor: '#059669',
  },
  linkBtnTxt: {
    color: '#FFF',
    fontSize: 11,
    fontWeight: '700',
  },
  historyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.sm,
  },
  historyBtnTxt: {
    color: '#0F172A',
    fontSize: 11,
    fontWeight: '700',
  },

  // Linked Rows Card
  linkedRowCard: {
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    borderRadius: radius.sm,
    padding: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  typePill: {
    backgroundColor: '#E0E7FF',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  typePillTxt: {
    fontSize: 10,
    fontWeight: '700',
    color: '#3730A3',
  },

  // Table Particulars
  addItemBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#0284C7',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.sm,
  },
  addItemBtnTxt: {
    color: '#FFF',
    fontSize: 11,
    fontWeight: '800',
  },
  itemTableHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: radius.sm,
    gap: 6,
  },
  colHdr: {
    fontSize: 11,
    fontWeight: '800',
    color: '#475569',
  },
  itemTableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    gap: 6,
  },
  cellTxt: {
    fontSize: 12,
    color: '#1E293B',
  },
  tableInput: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 4,
    fontSize: 12,
    color: '#0F172A',
    backgroundColor: '#FFF',
  },
  itemTableFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#CBD5E1',
  },

  // Overrides & Summary
  overrideInput: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
    backgroundColor: '#FFF',
    marginTop: 4,
  },

  // Error Box
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: radius.sm,
    padding: 10,
  },
  errorTxt: {
    color: '#DC2626',
    fontSize: 12,
    fontWeight: '600',
    flex: 1,
  },

  // Footer Buttons
  saveAndPrintBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#047857',
    paddingVertical: 14,
    borderRadius: radius.md,
  },
  saveAndPrintBtnTxt: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '800',
  },

  // Modals
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalCard: {
    width: '100%',
    maxWidth: 460,
    backgroundColor: '#FFF',
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: 10,
    maxHeight: '90%',
  },
  modalHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    paddingBottom: 10,
  },
  modalTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
  },
  modalCancelBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: radius.sm,
  },
  modalCancelTxt: {
    color: '#64748B',
    fontWeight: '700',
    fontSize: 13,
  },
  modalSaveBtn: {
    backgroundColor: '#2563EB',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: radius.sm,
  },
  modalSaveTxt: {
    color: '#FFF',
    fontWeight: '700',
    fontSize: 13,
  },
  linkingSummaryBox: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: radius.sm,
    padding: 10,
    gap: 2,
  },
  historySummaryBox: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: radius.sm,
    padding: 12,
    gap: 2,
  },
  historyItemCard: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: radius.sm,
    padding: 10,
    gap: 2,
  },

  // Success Modal
  successIconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#DCFCE7',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  successModalTitle: {
    fontSize: 16,
    fontWeight: '900',
    color: '#0F172A',
    textAlign: 'center',
  },
  successModalSub: {
    fontSize: 12,
    color: '#64748B',
    textAlign: 'center',
  },
  successDetailsBox: {
    width: '100%',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: radius.sm,
    padding: 12,
    marginTop: 8,
  },
  modalPrintBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#047857',
    paddingVertical: 12,
    borderRadius: radius.md,
  },
  modalPrintBtnTxt: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '800',
  },
  modalViewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    paddingVertical: 10,
    borderRadius: radius.md,
  },
  modalViewBtnTxt: {
    color: '#0F172A',
    fontSize: 13,
    fontWeight: '700',
  },
  modalDoneBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
  },
  modalDoneBtnTxt: {
    color: '#64748B',
    fontSize: 12,
    fontWeight: '700',
  },

  // Split Payment Styles
  splitSummaryBanner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#F8FAFC',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 10,
    marginTop: 6,
    marginBottom: 8,
  },
  splitSumCol: { flex: 1 },
  splitSumLbl: {
    fontSize: 10,
    fontWeight: '700',
    color: '#64748B',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  splitSumVal: {
    fontSize: 15,
    fontWeight: '900',
    marginTop: 2,
  },
  splitCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 10,
    gap: 8,
  },
  splitHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  splitModeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  splitModeTxt: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1E293B',
  },
  splitAmtBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: radius.sm,
    paddingHorizontal: 10,
  },
  splitCurrency: {
    fontSize: 14,
    fontWeight: '800',
    color: '#059669',
    marginRight: 4,
  },
  splitAmtInput: {
    flex: 1,
    fontSize: 15,
    fontWeight: '800',
    color: '#059669',
    paddingVertical: 6,
  },
  splitRefRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  splitRefInput: {
    flex: 1,
    fontSize: 12,
    color: '#334155',
    paddingVertical: 2,
  },
  quickFillBtn: {
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  quickFillTxt: {
    fontSize: 10,
    fontWeight: '800',
    color: '#0284C7',
  },
  addSplitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    borderStyle: 'dashed',
    borderRadius: radius.md,
    paddingVertical: 10,
    marginTop: 4,
  },
  addSplitTxt: {
    color: '#16A34A',
    fontWeight: '800',
    fontSize: 13,
  },
  termsOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  termsSheet: {
    backgroundColor: '#FFF',
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: 20,
  },
  termsTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 12,
  },
  termsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
  },
});
