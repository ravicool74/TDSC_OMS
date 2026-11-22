import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, KeyboardAvoidingView, Platform, Pressable, TextInput } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, font } from '@/src/theme';
import { api } from '@/src/api';
import { CustomerSearchModal, PickedParty } from '@/src/CustomerSearchModal';
import { ItemSearchModal, PickedItem } from '@/src/ItemSearchModal';
import { AttachmentsSection, Attachment } from '@/src/AttachmentsSection';
import { notify } from '@/src/dialog';

const today = () => {
  const d = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istDate = new Date(d.getTime() + istOffset + (d.getTimezoneOffset() * 60 * 1000));
  return istDate.toISOString().slice(0, 10);
};
const addDays = (d: string, days: number) => { const t = new Date(d); t.setDate(t.getDate() + days); return t.toISOString().slice(0, 10); };
const inr = (n: any) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

const TERMS = [
  { label: 'Net 15 days', days: 15 },
  { label: 'Net 30 days', days: 30 },
  { label: 'Net 45 days', days: 45 },
  { label: 'Net 60 days', days: 60 },
  { label: 'Net 90 days', days: 90 },
  { label: 'Custom', days: 0 },
];

export const PAY_MODES = [
  { key: 'cash', label: 'Cash', icon: 'cash' },
  { key: 'bank_transfer', label: 'Bank Transfer / Online', icon: 'business' },
  { key: 'cheque', label: 'Cheque', icon: 'document-text' },
  { key: 'upi', label: 'UPI / QR', icon: 'phone-portrait' },
  { key: 'other', label: 'Other Mode', icon: 'ellipsis-horizontal' },
] as const;

export type PaymentSplit = {
  id: string;
  mode: string;
  amount: string;
  reference: string;
  bank_id?: string;
  bank_account_id?: string;
  bank_name?: string;
  account_no?: string;
};

type LineItem = {
  key: string;
  item_id?: string;
  name: string;
  unit: string;
  qty: string;
  price: string;
  tax_rate: string;
  discount: string;
  item_type?: 'passed_on_money' | 'actual_service';
  fee_type?: string | null;
};

export default function NewInvoice() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ type?: string; edit_id?: string; accounting?: string; is_old_accounting?: string }>();
  const initialType = params?.type || 'sale';
  const editId = params?.edit_id || null;
  const isOldAccounting = params?.accounting === 'old' || params?.is_old_accounting === 'true';

  const [actualInvoiceType, setActualInvoiceType] = useState<string>(initialType);
  const isPurchase = actualInvoiceType === 'purchase';

  const [paymentType, setPaymentType] = useState<'credit' | 'cash'>('credit');
  const [activePickingSplitId, setActivePickingSplitId] = useState<string | null>(null);

  // Multi-Payment Mode Splits State
  const [paymentSplits, setPaymentSplits] = useState<PaymentSplit[]>([
    { id: 'pay_1', mode: 'cash', amount: '', reference: '' }
  ]);

  // Bank Accounts & Dropdown Selection State
  const [banks, setBanks] = useState<any[]>([]);
  const [activePickingBankSplitId, setActivePickingBankSplitId] = useState<string | null>(null);
  const [showAddBankModal, setShowAddBankModal] = useState(false);
  const [targetSplitIdForNewBank, setTargetSplitIdForNewBank] = useState<string | null>(null);
  const [newBankForm, setNewBankForm] = useState({
    name: '',
    bank_name: '',
    account_no: '',
    ifsc: '',
    opening_balance: '0',
  });
  const [savingNewBank, setSavingNewBank] = useState(false);
  const [bankSaveErr, setBankSaveErr] = useState<string | null>(null);

  // Fetch active bank accounts
  useEffect(() => {
    (async () => {
      try {
        const b = await api.get<any[]>('/bank-accounts');
        if (Array.isArray(b) && b.length > 0) {
          setBanks(b);
        } else {
          setBanks([
            { id: 'bnk_sbi_01', name: 'TRIVENI DSC AND ETENDER SERVICE PRIVATE LIMITED', bank_name: 'State Bank of India', account_no: '42137607814', ifsc: 'SBIN0063706' },
            { id: 'bnk_hdfc_02', name: 'ANJU KUMARI (AXIS BANK)', bank_name: 'AXIS BANK', account_no: '915020011528516', ifsc: 'UTIB0000873' },
          ]);
        }
      } catch {
        setBanks([
          { id: 'bnk_sbi_01', name: 'TRIVENI DSC AND ETENDER SERVICE PRIVATE LIMITED', bank_name: 'State Bank of India', account_no: '42137607814', ifsc: 'SBIN0063706' },
          { id: 'bnk_hdfc_02', name: 'ANJU KUMARI (AXIS BANK)', bank_name: 'AXIS BANK', account_no: '915020011528516', ifsc: 'UTIB0000873' },
        ]);
      }
    })();
  }, []);

  const [date, setDate] = useState(today());
  const dateInitializedRef = React.useRef(false);
  const [isManualVoucherNo, setIsManualVoucherNo] = useState(false);

  const [terms, setTerms] = useState<string>('Net 60 days');
  const [dueDate, setDueDate] = useState(addDays(today(), 60));
  const [showTerms, setShowTerms] = useState(false);

  const [party, setParty] = useState<PickedParty | null>(null);
  const [showPartyPick, setShowPartyPick] = useState(false);

  const [items, setItems] = useState<LineItem[]>([]);
  const [showItemPick, setShowItemPick] = useState(false);

  const [notes, setNotes] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [signatoryName, setSignatoryName] = useState('अंजू कुमारी');
  const [includeSignature, setIncludeSignature] = useState(true);
  const [signatureUrl, setSignatureUrl] = useState<string | null>(null);
  const [invoiceNo, setInvoiceNo] = useState<string>('AUTO');
  const [busy, setBusy] = useState(false);

  // Recompute due date when date or terms change
  useEffect(() => {
    const t = TERMS.find(x => x.label === terms);
    if (t && t.days > 0) setDueDate(addDays(date, t.days));
  }, [date, terms]);

  // Preview counter or load existing (edit mode)
  useEffect(() => {
    (async () => {
      if (editId) {
        try {
          const ex = await api.get<any>(`/invoices/${editId}`);
          setInvoiceNo(ex.invoice_no || 'EDIT');
          if (ex.invoice_type) setActualInvoiceType(ex.invoice_type);
          setPaymentType(ex.payment_type || 'credit');
          const splitsSum = (Array.isArray(ex.payment_splits) ? ex.payment_splits : []).reduce((acc: number, s: any) => acc + (parseFloat(s?.amount) || 0), 0);
          const paymentsSum = (Array.isArray(ex.payments) ? ex.payments : []).reduce((acc: number, p: any) => acc + (parseFloat(p?.amount) || 0), 0);

          if (Array.isArray(ex.payments) && ex.payments.length > 0 && (paymentsSum >= splitsSum || !ex.payment_splits || ex.payment_splits.length === 0)) {
            setPaymentSplits(ex.payments.map((p: any, idx: number) => ({
              id: `pay_${idx + 1}`,
              mode: p.payment_mode || p.mode || 'cash',
              amount: String(p.amount || ''),
              reference: p.payment_no || p.reference || p.ref || '',
              bank_id: p.bank_id || p.bank_account_id || ex.bank_id || '',
              bank_name: p.bank_name || ex.bank_name || '',
              account_no: p.account_no || ex.account_no || '',
            })));
          } else if (Array.isArray(ex.payment_splits) && ex.payment_splits.length > 0) {
            setPaymentSplits(ex.payment_splits.map((s: any, idx: number) => ({
              id: `pay_${idx + 1}`,
              mode: s.mode || s.payment_mode || 'cash',
              amount: String(s.amount || ''),
              reference: s.reference || s.ref || '',
              bank_id: s.bank_id || s.bank_account_id || ex.bank_id || '',
              bank_name: s.bank_name || ex.bank_name || '',
              account_no: s.account_no || ex.account_no || '',
            })));
          } else if (Array.isArray(ex.payments) && ex.payments.length > 0) {
            setPaymentSplits(ex.payments.map((p: any, idx: number) => ({
              id: `pay_${idx + 1}`,
              mode: p.payment_mode || p.mode || 'cash',
              amount: String(p.amount || ''),
              reference: p.payment_no || p.reference || p.ref || '',
              bank_id: p.bank_id || p.bank_account_id || ex.bank_id || '',
              bank_name: p.bank_name || ex.bank_name || '',
              account_no: p.account_no || ex.account_no || '',
            })));
          } else if (ex.paid_amount) {
            setPaymentSplits([{
              id: 'pay_1',
              mode: ex.payment_mode || 'cash',
              amount: String(ex.paid_amount || ''),
              reference: '',
              bank_id: ex.bank_id || '',
              bank_name: ex.bank_name || '',
              account_no: ex.account_no || '',
            }]);
          }
          setDate(ex.date || today());
          setTerms(ex.payment_terms || 'Custom');
          setDueDate(ex.due_date || today());
          setParty({ id: ex.party_id, name: ex.party_name, mobile: ex.party_mobile || '', pan: '', aadhar: '', gst_no: ex.party_gst || null, customer_code: null } as any);
          setItems((ex.items || []).map((it: any, idx: number) => ({
            key: `${it.item_id || idx}-${idx}`, item_id: it.item_id || undefined,
            name: it.name, unit: it.unit || 'PCS', qty: String(it.qty || 1),
            price: String(it.price || 0), tax_rate: String(it.tax_rate || 0), discount: String(it.discount || 0),
            item_type: it.item_type || 'actual_service', fee_type: it.fee_type || undefined,
          })));
          setNotes(ex.notes || '');
          setAttachments(ex.attachments || []);
          setSignatoryName(ex.signatory_name || 'अंजू कुमारी');
          setIncludeSignature(ex.include_signature !== false);
          setSignatureUrl(ex.signature_url || null);
        } catch (e: any) { notify('Load failed', String(e?.message || 'Unable to load')); }
        return;
      }
      try {
        const next = await api.get<any>(`/invoices/next-no?invoice_type=${actualInvoiceType}&date=${date}${isOldAccounting ? '&is_old_accounting=true' : ''}`);
        if (next) {
          if (next.next_no) {
            setInvoiceNo(next.voucher_mode === 'manual' || isOldAccounting ? next.next_no : `${next.next_no} (preview)`);
          }
          if (next.voucher_mode || isOldAccounting) {
            setIsManualVoucherNo(isOldAccounting || next.voucher_mode === 'manual');
          }
          if (next.server_date && !dateInitializedRef.current) {
            setDate(next.server_date);
            dateInitializedRef.current = true;
          }
        } else {
          setInvoiceNo(
            isOldAccounting ? 'OLD-SI-0001' :
            actualInvoiceType === 'purchase' ? 'PB-0001 (preview)' :
            actualInvoiceType === 'sale_return' ? 'CN-0001 (preview)' :
            actualInvoiceType === 'purchase_return' ? 'DN-0001 (preview)' :
            'TDSC/2026-27/000001 (preview)'
          );
          if (isOldAccounting) setIsManualVoucherNo(true);
        }
      } catch {
        setInvoiceNo(
          actualInvoiceType === 'purchase' ? 'PB-0001 (preview)' :
          actualInvoiceType === 'sale_return' ? 'CN-0001 (preview)' :
          actualInvoiceType === 'purchase_return' ? 'DN-0001 (preview)' :
          'TDSC/2026-27/000001 (preview)'
        );
      }
    })();
  }, [actualInvoiceType, editId, date]);

  const addItem = (i: PickedItem) => {
    setItems(p => [...p, {
      key: `${i.id}-${Date.now()}`,
      item_id: i.id,
      name: i.name,
      unit: i.unit || 'PCS',
      qty: '1',
      price: String(i.sale_price || i.purchase_price || 0),
      tax_rate: String(i.tax_rate || 0),
      discount: '0',
      item_type: (i as any).item_type || 'actual_service',
      fee_type: (i as any).fee_type || null,
    }]);
  };

  const updateItem = (key: string, k: keyof LineItem, v: string) => {
    setItems(p => p.map(x => x.key === key ? { ...x, [k]: v } : x));
  };
  const removeItem = (key: string) => setItems(p => p.filter(x => x.key !== key));

  const totals = useMemo(() => {
    let subtotal = 0, discount = 0, tax = 0, total = 0;
    let passedOnTotal = 0, actualServiceTotal = 0;
    for (const it of items) {
      const q = parseFloat(it.qty) || 0;
      const pr = parseFloat(it.price) || 0;
      const d = parseFloat(it.discount) || 0;
      const t = parseFloat(it.tax_rate) || 0;
      const line = q * pr;
      const after = Math.max(0, line - d);
      const taxAmt = (after * t) / 100;
      const lineTotal = after + taxAmt;
      subtotal += line; discount += d; tax += taxAmt; total += lineTotal;
      if (it.item_type === 'passed_on_money') {
        passedOnTotal += lineTotal;
      } else {
        actualServiceTotal += lineTotal;
      }
    }
    return { subtotal, discount, tax, total, passedOnTotal, actualServiceTotal };
  }, [items]);

  // Combined sum of all entered payment modes
  const totalSplitPaid = useMemo(() => {
    return paymentSplits.reduce((sum, ps) => sum + (parseFloat(ps.amount) || 0), 0);
  }, [paymentSplits]);

  const paidNum = useMemo(() => {
    if (paymentType === 'cash') return totals.total;
    return totalSplitPaid;
  }, [paymentType, totals.total, totalSplitPaid]);

  const duesNum = useMemo(() => Math.max(0, Math.round((totals.total - paidNum) * 100) / 100), [totals.total, paidNum]);

  // Sync cash payment mode full amount
  useEffect(() => {
    if (paymentType === 'cash') {
      setPaymentSplits([{ id: 'pay_1', mode: 'cash', amount: totals.total > 0 ? String(totals.total) : '', reference: '' }]);
    }
  }, [totals.total, paymentType]);

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

  const getBankDisplayName = (bankId?: string) => {
    const b = banks.find(x => x.id === bankId) || banks[0];
    if (!b) return 'Select Bank Account';
    return getBankShortLabel(b);
  };

  const handleSetBankForSplit = (splitId: string, bank: any) => {
    setPaymentSplits(prev => prev.map(s => s.id === splitId ? {
      ...s,
      bank_id: bank.id,
      bank_account_id: bank.id,
      bank_name: bank.bank_name || bank.name,
      account_no: bank.account_no,
    } : s));
  };

  const handleSelectBankMode = (splitId: string, mode: 'bank_transfer' | 'cheque' | 'upi', bank: any) => {
    setPaymentSplits(prev => prev.map(s => s.id === splitId ? {
      ...s,
      mode,
      bank_id: bank.id,
      bank_account_id: bank.id,
      bank_name: bank.bank_name || bank.name,
      account_no: bank.account_no,
    } : s));
  };

  const getSplitDisplay = (sp: PaymentSplit) => {
    const b = banks.find(x => x.id === (sp.bank_id || banks[0]?.id)) || banks[0];
    const bLbl = getBankShortLabel(b);
    if (sp.mode === 'cash') {
      return { label: 'Cash (Cash Ledger)', icon: 'cash', color: '#059669', bg: '#DCFCE7' };
    }
    if (sp.mode === 'bank_transfer') {
      return { label: `Online — ${bLbl}`, icon: 'business', color: '#1E40AF', bg: '#DBEAFE' };
    }
    if (sp.mode === 'cheque') {
      return { label: `Cheque — ${bLbl}`, icon: 'document-text', color: '#7C3AED', bg: '#EDE9FE' };
    }
    if (sp.mode === 'upi') {
      return { label: `UPI / QR — ${bLbl}`, icon: 'phone-portrait', color: '#0284C7', bg: '#E0F2FE' };
    }
    return { label: 'Other Mode', icon: 'ellipsis-horizontal', color: '#64748B', bg: '#F1F5F9' };
  };

  const handleSaveNewBank = async () => {
    if (!newBankForm.name.trim() || !newBankForm.bank_name.trim() || !newBankForm.account_no.trim()) {
      setBankSaveErr('Account Nickname, Bank Name, and Account Number are required.');
      return;
    }
    setSavingNewBank(true);
    setBankSaveErr(null);
    try {
      const created: any = await api.post('/bank-accounts', {
        name: newBankForm.name.trim(),
        bank_name: newBankForm.bank_name.trim(),
        account_no: newBankForm.account_no.trim(),
        ifsc: newBankForm.ifsc.trim() || null,
        opening_balance: parseFloat(newBankForm.opening_balance) || 0,
        is_active: true,
      });
      const newBankObj = {
        id: created?.id || `bnk_${Date.now()}`,
        name: newBankForm.name.trim(),
        bank_name: newBankForm.bank_name.trim(),
        account_no: newBankForm.account_no.trim(),
        ifsc: newBankForm.ifsc.trim() || '—',
        opening_balance: parseFloat(newBankForm.opening_balance) || 0,
      };
      setBanks(prev => [...prev, newBankObj]);
      if (targetSplitIdForNewBank) {
        handleSetBankForSplit(targetSplitIdForNewBank, newBankObj);
      }
      setShowAddBankModal(false);
      setNewBankForm({ name: '', bank_name: '', account_no: '', ifsc: '', opening_balance: '0' });
      notify('Bank Account Added', `${newBankObj.name} (${newBankObj.bank_name}) ledger created and selected.`);
    } catch (e: any) {
      setBankSaveErr(e?.message || 'Failed to save bank account');
    } finally {
      setSavingNewBank(false);
    }
  };

  const handleAddPaymentSplit = () => {
    const usedModes = paymentSplits.map(s => s.mode);
    const availableMode = PAY_MODES.find(m => !usedModes.includes(m.key))?.key || 'other';
    const defaultB = banks[0];
    setPaymentSplits(prev => [
      ...prev,
      {
        id: `pay_${Date.now()}`,
        mode: availableMode,
        amount: '',
        reference: '',
        bank_id: ['bank_transfer', 'cheque', 'upi'].includes(availableMode) ? defaultB?.id : undefined,
        bank_account_id: ['bank_transfer', 'cheque', 'upi'].includes(availableMode) ? defaultB?.id : undefined,
        bank_name: ['bank_transfer', 'cheque', 'upi'].includes(availableMode) ? (defaultB?.bank_name || defaultB?.name) : undefined,
        account_no: ['bank_transfer', 'cheque', 'upi'].includes(availableMode) ? defaultB?.account_no : undefined,
      }
    ]);
  };

  const handleUpdatePaymentSplit = (id: string, field: 'mode' | 'amount' | 'reference' | 'bank_id', val: string) => {
    setPaymentSplits(prev => prev.map(s => {
      if (s.id !== id) return s;
      const updated = { ...s, [field]: val };
      if (field === 'mode' && ['bank_transfer', 'cheque', 'upi'].includes(val) && !updated.bank_id) {
        const defaultB = banks[0];
        if (defaultB) {
          updated.bank_id = defaultB.id;
          updated.bank_account_id = defaultB.id;
          updated.bank_name = defaultB.bank_name || defaultB.name;
          updated.account_no = defaultB.account_no;
        }
      }
      return updated;
    }));
  };

  const handleRemovePaymentSplit = (id: string) => {
    if (paymentSplits.length <= 1) {
      setPaymentSplits([{ id: 'pay_1', mode: 'cash', amount: '', reference: '' }]);
      return;
    }
    setPaymentSplits(prev => prev.filter(s => s.id !== id));
  };

  const handleAutoFillRemaining = (id: string) => {
    const otherSum = paymentSplits.filter(s => s.id !== id).reduce((acc, s) => acc + (parseFloat(s.amount) || 0), 0);
    const remaining = Math.max(0, Math.round((totals.total - otherSum) * 100) / 100);
    handleUpdatePaymentSplit(id, 'amount', remaining > 0 ? String(remaining) : '');
  };

  const save = async (andNew: boolean) => {
    if (!party) return notify('Customer required', 'Please select or add a customer first');
    if (items.length === 0 && totals.total === 0) {
      return notify('Add at least one item', 'You can add items or enter a total-only invoice');
    }
    setBusy(true);
    try {
      const validSplits = paymentSplits
        .map(s => {
          const isBankMode = ['bank_transfer', 'cheque', 'upi'].includes(s.mode);
          const resolvedBankId = s.bank_id || (isBankMode ? (banks[0]?.id || 'bnk_sbi_01') : undefined);
          const resolvedBank = banks.find(b => b.id === resolvedBankId);
          return {
            mode: s.mode,
            amount: parseFloat(s.amount) || 0,
            reference: s.reference ? s.reference.trim() : '',
            bank_id: resolvedBankId,
            bank_account_id: resolvedBankId,
            bank_name: s.bank_name || resolvedBank?.bank_name || resolvedBank?.name || undefined,
            account_no: s.account_no || resolvedBank?.account_no || undefined,
          };
        })
        .filter(s => s.amount > 0);

      const dominantMode = validSplits.length > 0 ? validSplits.map(s => s.mode).join(', ') : 'cash';
      const primaryBank = validSplits.find(s => s.bank_id);

      const body = {
        invoice_type: actualInvoiceType,
        invoice_no: invoiceNo && !invoiceNo.includes('preview') && invoiceNo !== 'AUTO' ? invoiceNo.trim() : undefined,
        payment_type: paymentType,
        payment_mode: dominantMode,
        bank_id: primaryBank?.bank_id,
        bank_name: primaryBank?.bank_name,
        account_no: primaryBank?.account_no,
        payment_splits: validSplits.length > 0 ? validSplits : undefined,
        date, payment_terms: terms, due_date: paymentType === 'cash' ? date : dueDate,
        party_id: party.id, party_name: party.name, party_mobile: party.mobile || null, party_gst: party.gst_no || null,
        items: items.map(it => ({
          item_id: it.item_id || null, name: it.name, unit: it.unit,
          qty: parseFloat(it.qty) || 1, price: parseFloat(it.price) || 0,
          tax_rate: parseFloat(it.tax_rate) || 0, discount: parseFloat(it.discount) || 0,
          amount: 0,
          item_type: it.item_type || 'actual_service',
          fee_type: it.fee_type || null,
        })),
        total_amount: totals.total,
        paid_amount: paidNum,
        notes: notes || null,
        signatory_name: signatoryName || 'अंजू कुमारी',
        include_signature: includeSignature,
        signature_url: signatureUrl,
        is_old_accounting: isOldAccounting,
      };
      const inv: any = editId ? await api.patch(`/invoices/${editId}`, body) : await api.post('/invoices', body);
      // Upload queued attachments (best-effort)
      let attachErrors = 0;
      for (const a of attachments) {
        if (a.pending && a.uri) {
          try {
            await api.uploadVoucherFile('invoices', inv.id, { uri: a.uri, name: a.name, type: a.type || 'application/octet-stream' });
          } catch { attachErrors++; }
        }
      }
      const suffix = attachErrors ? ` (${attachErrors} attachment upload failed)` : '';
      // Check if auto-tasks are enabled to show hint
      let autoHint = '';
      if (actualInvoiceType === 'sale') {
        try {
          const t = await api.get<{ enabled: boolean }>('/settings/auto-task-toggle');
          if (t?.enabled) autoHint = '\n\n✅ 2 tasks auto-created (Service + Follow-up). Check Tasks tab.';
        } catch {}
      }
      if (andNew) {
        setParty(null); setItems([]); setNotes(''); setAttachments([]); setPaymentType('credit'); setDate(today()); setTerms('Net 60 days');
        setPaymentSplits([{ id: 'pay_1', mode: 'cash', amount: '', reference: '' }]);
        notify('Saved', `${inv.invoice_no} saved successfully${suffix}${autoHint}`);
      } else {
        notify('Saved', `${inv.invoice_no} saved successfully${suffix}${autoHint}`);
        router.replace(`/accounting/invoices/${inv.id}` as any);
      }
    } catch (e: any) {
      const msg = String(e?.message || 'Failed');
      notify('Failed', msg);
    } finally { setBusy(false); }
  };

  const headerTitle =
    isOldAccounting ? 'Old Sales Invoices entry' :
    actualInvoiceType === 'purchase' ? 'Purchase Bill' :
    actualInvoiceType === 'sale_return' ? 'Sale Return / Credit Note' :
    actualInvoiceType === 'purchase_return' ? 'Purchase Return / Debit Note' :
    'Sale Invoice';

  return (
    <View style={styles.root} testID="new-invoice">
      <SafeAreaView edges={['top']} style={{ backgroundColor: '#FFF' }}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
            <Ionicons name="arrow-back" size={20} color="#0F172A" />
          </Pressable>
          <View style={{ flex: 1, marginLeft: 6 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={styles.headerTitle}>{headerTitle}</Text>
              {isOldAccounting && (
                <View style={{ backgroundColor: '#F3E8FF', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, borderWidth: 1, borderColor: '#D8B4FE' }}>
                  <Text style={{ fontSize: 10, fontWeight: '700', color: '#7C3AED' }}>📜 Old Accounting</Text>
                </View>
              )}
            </View>
            <Text style={styles.headerSub}>{invoiceNo}</Text>
          </View>
          <View style={styles.segWrap}>
            <Pressable onPress={() => setPaymentType('credit')} style={[styles.seg, paymentType === 'credit' && styles.segActive]}>
              <Text style={[styles.segTxt, paymentType === 'credit' && styles.segTxtActive]}>Credit</Text>
            </Pressable>
            <Pressable onPress={() => setPaymentType('cash')} style={[styles.seg, paymentType === 'cash' && styles.segActive]}>
              <Text style={[styles.segTxt, paymentType === 'cash' && styles.segTxtActive]}>Cash</Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: 170 + Math.max(insets.bottom, 12) }} keyboardShouldPersistTaps="handled">
          <View style={styles.rowGrid}>
            <Cell
              label={isManualVoucherNo ? "Invoice No (Manual Entry)" : "Invoice No (Auto)"}
              value={invoiceNo}
              onChangeText={isManualVoucherNo ? setInvoiceNo : undefined}
              disabled={!isManualVoucherNo}
              placeholder={isManualVoucherNo ? "e.g. TDSC/2026-27/000001" : undefined}
            />
            <Cell label="Date" value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" testID="in-date" />
          </View>
          <View style={styles.rowGrid}>
            <Pressable style={styles.cell} onPress={() => setShowTerms(true)} testID="pick-terms">
              <Text style={styles.cellLbl}>Payment Terms</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Text style={styles.cellVal}>{terms}</Text>
                <Ionicons name="chevron-down" size={16} color={colors.muted} />
              </View>
            </Pressable>
            <Cell label="Due On" value={paymentType === 'cash' ? date : dueDate} onChangeText={setDueDate} placeholder="YYYY-MM-DD" testID="in-due" />
          </View>

          {/* Party */}
          <Pressable style={styles.partyRow} onPress={() => setShowPartyPick(true)} testID="pick-party">
            <View style={styles.partyIcon}><Ionicons name={party ? 'person' : 'person-add'} size={22} color={party ? '#FFF' : '#111827'} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.partyLbl}>Customer *</Text>
              {party ? (
                <>
                  <Text style={styles.partyName}>{party.name}</Text>
                  <Text style={styles.muted}>{party.customer_code || ''} • 📱 {party.mobile}</Text>
                </>
              ) : (
                <Text style={[styles.partyName, { color: colors.muted }]}>Tap to search / add customer</Text>
              )}
            </View>
            <Ionicons name="search" size={20} color={colors.brandPrimary} />
          </Pressable>
          {party ? (
            <View style={styles.phoneRow}>
              <Ionicons name="call" size={16} color={colors.muted} />
              <Text style={{ flex: 1, color: '#111827' }}>{party.mobile}</Text>
              <Pressable onPress={() => setParty(null)}><Text style={{ color: colors.error, fontWeight: '700' }}>Change</Text></Pressable>
            </View>
          ) : null}

          {/* Items */}
          <View style={styles.itemsHeader}>
            <Text style={styles.itemsTitle}>Add Items <Text style={{ color: colors.muted, fontWeight: '500' }}>(Optional)</Text></Text>
            <Pressable onPress={() => setShowItemPick(true)} style={styles.itemsAdd} testID="add-item">
              <Ionicons name="add" size={16} color="#FFF" />
              <Text style={{ color: '#FFF', fontWeight: '800' }}>Add Item</Text>
            </Pressable>
          </View>
          {items.length === 0 ? (
            <Pressable style={styles.itemsEmpty} onPress={() => setShowItemPick(true)}>
              <Ionicons name="scan" size={26} color={colors.brandPrimary} />
              <Text style={{ color: colors.muted, marginTop: 4 }}>Search / scan barcode or tap “Add Item”</Text>
            </Pressable>
          ) : (
            items.map(it => (
              <View key={it.key} style={styles.itemCard} testID={`li-${it.key}`}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={{ flex: 1, fontWeight: '800', color: '#111827' }}>{it.name}</Text>
                  {it.item_type === 'passed_on_money' ? (
                    <View style={{ backgroundColor: '#CCFBF1', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }}>
                      <Text style={{ color: '#0F766E', fontSize: 10, fontWeight: '800' }}>Passed On Money</Text>
                    </View>
                  ) : (
                    <View style={{ backgroundColor: '#EDE9FE', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }}>
                      <Text style={{ color: '#6D28D9', fontSize: 10, fontWeight: '800' }}>Actual Service</Text>
                    </View>
                  )}
                  <Pressable onPress={() => removeItem(it.key)} hitSlop={8}><Ionicons name="close-circle" size={20} color={colors.error} /></Pressable>
                </View>
                <View style={styles.itemGrid}>
                  <NumCell label="Qty" value={it.qty} onChange={v => updateItem(it.key, 'qty', v)} />
                  <NumCell label={`Price (₹)`} value={it.price} onChange={v => updateItem(it.key, 'price', v)} />
                  <NumCell label={`GST %`} value={it.tax_rate} onChange={v => updateItem(it.key, 'tax_rate', v)} />
                  <NumCell label="Disc" value={it.discount} onChange={v => updateItem(it.key, 'discount', v)} />
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={styles.lineTotal}>{inr(((parseFloat(it.qty) || 0) * (parseFloat(it.price) || 0) - (parseFloat(it.discount) || 0)) * (1 + (parseFloat(it.tax_rate) || 0) / 100))}</Text>
                </View>
              </View>
            ))
          )}

          {/* Payment details: Multi-Mode Split Payments & Dues */}
          <View style={styles.payCard} testID="pay-details">
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={styles.payHead}>PAYMENT MODE & SPLIT BREAKDOWN</Text>
              {paymentType === 'cash' ? (
                <View style={{ backgroundColor: '#D1FAE5', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 }}>
                  <Text style={{ color: '#047857', fontSize: 11, fontWeight: '800' }}>Cash Full Paid</Text>
                </View>
              ) : null}
            </View>

            {/* Total Paid & Remaining Dues Banner */}
            <View style={styles.splitSummaryBanner}>
              <View style={styles.splitSumCol}>
                <Text style={styles.splitSumLbl}>Total Paid (Auto Sum)</Text>
                <Text style={[styles.splitSumVal, { color: '#059669' }]}>{inr(paidNum)}</Text>
              </View>
              <View style={[styles.splitSumCol, { alignItems: 'flex-end' }]}>
                <Text style={styles.splitSumLbl}>Remaining Balance (Dues)</Text>
                <Text style={[styles.splitSumVal, { color: duesNum > 0 ? '#DC2626' : '#059669' }]}>
                  {duesNum > 0 ? inr(duesNum) : '₹0.00 (Cleared)'}
                </Text>
              </View>
            </View>

            {/* Split Payment Rows */}
            <View style={{ gap: 8 }}>
              {paymentSplits.map((sp, idx) => {
                const disp = getSplitDisplay(sp);
                return (
                  <View key={sp.id} style={styles.splitCard}>
                    <View style={styles.splitHeaderRow}>
                      <Pressable
                        onPress={() => setActivePickingSplitId(sp.id)}
                        style={[styles.splitModeBtn, { backgroundColor: disp.bg, borderColor: disp.color + '40' }]}
                      >
                        <Ionicons name={disp.icon as any} size={18} color={disp.color} />
                        <Text style={[styles.splitModeTxt, { color: disp.color, fontWeight: '800' }]}>{disp.label}</Text>
                        <Ionicons name="chevron-down" size={14} color={disp.color} />
                      </Pressable>

                      <View style={styles.splitAmtBox}>
                        <Text style={styles.splitCurrency}>₹</Text>
                        <TextInput
                          keyboardType="numeric"
                          value={sp.amount}
                          onChangeText={v => handleUpdatePaymentSplit(sp.id, 'amount', v)}
                          style={styles.splitAmtInput}
                          placeholder="0.00"
                          placeholderTextColor={colors.muted}
                        />
                      </View>

                      {paymentSplits.length > 1 ? (
                        <Pressable onPress={() => handleRemovePaymentSplit(sp.id)} hitSlop={6} style={{ padding: 4 }}>
                          <Ionicons name="trash-outline" size={18} color={colors.error} />
                        </Pressable>
                      ) : null}
                    </View>

                    {/* Bank Account Selection for Bank Transfer / Cheque / UPI */}
                    {['bank_transfer', 'cheque', 'upi'].includes(sp.mode) ? (
                      <View style={styles.splitBankRow}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <Ionicons name="business" size={15} color="#1E40AF" />
                            <Text style={styles.splitBankLabel}>Select Bank Account / Ledger:</Text>
                          </View>
                          <Pressable
                            onPress={() => {
                              setTargetSplitIdForNewBank(sp.id);
                              setShowAddBankModal(true);
                            }}
                            style={styles.splitAddBankBtn}
                            testID="btn-add-bank-account"
                          >
                            <Ionicons name="add-circle" size={14} color={colors.brandPrimary} />
                            <Text style={styles.splitAddBankTxt}>+ Add Account</Text>
                          </Pressable>
                        </View>

                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                          {banks.map(b => {
                            const isSelected = (sp.bank_id || banks[0]?.id) === b.id;
                            const lbl = getBankShortLabel(b);
                            return (
                              <Pressable
                                key={b.id}
                                onPress={() => handleSetBankForSplit(sp.id, b)}
                                style={[
                                  styles.bankChipBtn,
                                  isSelected && styles.bankChipBtnActive
                                ]}
                                testID={`bank-chip-${b.id}`}
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
                        </View>
                      </View>
                    ) : sp.mode === 'cash' ? (
                      <View style={[styles.splitBankRow, { backgroundColor: '#F0FDF4', borderColor: '#BBF7D0' }]}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <Ionicons name="wallet" size={15} color="#059669" />
                            <Text style={[styles.splitBankLabel, { color: '#059669' }]}>
                              Auto-records to Cash in Hand Ledger
                            </Text>
                          </View>
                          {banks.length > 0 && (
                            <Pressable
                              onPress={() => handleSelectBankMode(sp.id, 'bank_transfer', banks[0])}
                              style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#DBEAFE', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 }}
                            >
                              <Ionicons name="swap-horizontal" size={12} color="#1E40AF" />
                              <Text style={{ fontSize: 11, fontWeight: '700', color: '#1E40AF' }}>
                                Switch to Bank ({getBankShortLabel(banks[0])})
                              </Text>
                            </Pressable>
                          )}
                        </View>
                      </View>
                    ) : null}

                    {/* Reference / UTR / Cheque / Notes input */}
                    <View style={styles.splitRefRow}>
                      <Ionicons name="bookmark-outline" size={14} color={colors.muted} />
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
                        placeholderTextColor={colors.muted}
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
              <Ionicons name="add-circle-outline" size={18} color={colors.brandPrimary} />
              <Text style={styles.addSplitTxt}>+ Add Payment Mode (Online / Cheque / Cash / UPI)</Text>
            </Pressable>
          </View>

          {/* Attachments */}
          <AttachmentsSection attachments={attachments} onChange={setAttachments} title="Attachments" hint="Bills, PO, POD, GST notes • Max 10 MB per file" />

          {/* Notes */}
          <View style={styles.notesWrap}>
            <Text style={styles.cellLbl}>Notes (optional)</Text>
            <TextInput multiline value={notes} onChangeText={setNotes} style={styles.notesInput} placeholder="Any notes / description…" placeholderTextColor={colors.muted} />
          </View>

          {/* Authorized Signatory */}
          <View style={styles.notesWrap}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <Text style={styles.cellLbl}>Authorized Signatory</Text>
              <Pressable
                onPress={() => setIncludeSignature(!includeSignature)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
              >
                <Ionicons name={includeSignature ? 'checkbox' : 'square-outline'} size={18} color={includeSignature ? colors.brandPrimary : colors.muted} />
                <Text style={{ fontSize: 12, color: colors.onSurface, fontWeight: '600' }}>Include on Voucher</Text>
              </Pressable>
            </View>
            <TextInput
              value={signatoryName}
              onChangeText={setSignatoryName}
              style={[styles.notesInput, { minHeight: 40, height: 42 }]}
              placeholder="Signatory Name (e.g. अंजू कुमारी)"
              placeholderTextColor={colors.muted}
            />
          </View>
        </ScrollView>

        {/* Bottom totals + save bar */}
        <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <View style={styles.totalRow}>
            <View>
              <Text style={styles.totalLbl}>Total Amount</Text>
              {totals.passedOnTotal > 0 && totals.actualServiceTotal > 0 ? (
                <Text style={styles.taxLbl}>
                  Services: {inr(totals.actualServiceTotal)} | Pass-on: {inr(totals.passedOnTotal)}
                </Text>
              ) : null}
            </View>
            <Text style={styles.totalVal}>{inr(totals.total)}</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable style={styles.btnSecondary} onPress={() => save(true)} disabled={busy}>
              <Text style={styles.btnSecondaryTxt}>Save & New</Text>
            </Pressable>
            <Pressable style={styles.btnPrimary} onPress={() => save(false)} disabled={busy} testID="btn-save-invoice">
              <Text style={styles.btnPrimaryTxt}>{busy ? 'Saving…' : 'Save Invoice'}</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>

      <CustomerSearchModal
        visible={showPartyPick}
        title={isPurchase ? 'Select Vendor' : 'Select Customer'}
        onPick={(p: PickedParty) => { setParty(p); setShowPartyPick(false); }}
        onClose={() => setShowPartyPick(false)}
      />

      <ItemSearchModal
        visible={showItemPick}
        title="Select Item / Service"
        onPick={(it: PickedItem) => { addItem(it); setShowItemPick(false); }}
        onClose={() => setShowItemPick(false)}
      />

      {/* Payment Terms Sheet */}
      {showTerms ? (
        <Pressable style={styles.termsOverlay} onPress={() => setShowTerms(false)}>
          <View style={styles.termsSheet}>
            <Text style={styles.termsTitle}>Payment Terms</Text>
            {TERMS.map(t => (
              <Pressable key={t.label} onPress={() => { setTerms(t.label); setShowTerms(false); }} style={styles.termsRow}>
                <Text style={{ flex: 1, color: '#111827', fontWeight: '600' }}>{t.label}</Text>
                {terms === t.label ? <Ionicons name="checkmark" size={20} color={colors.brandPrimary} /> : null}
              </Pressable>
            ))}
          </View>
        </Pressable>
      ) : null}

      {/* Payment Mode Selector Modal for Multi-Mode Splits */}
      {activePickingSplitId ? (
        <Pressable style={styles.termsOverlay} onPress={() => setActivePickingSplitId(null)}>
          <View style={[styles.termsSheet, { maxHeight: '85%' }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <View>
                <Text style={styles.termsTitle}>Select Payment Mode & Account</Text>
                <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>
                  Choose Cash or Bank Account for receipt auto-posting
                </Text>
              </View>
              <Pressable
                onPress={() => {
                  setTargetSplitIdForNewBank(activePickingSplitId);
                  setActivePickingSplitId(null);
                  setShowAddBankModal(true);
                }}
                style={styles.quickAddBankBtn}
              >
                <Ionicons name="add-circle" size={16} color="#FFF" />
                <Text style={styles.quickAddBankTxt}>+ Add Bank</Text>
              </Pressable>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 420 }}>
              {/* Option 1: Cash */}
              <Text style={styles.modalSectionHdr}>CASH PAYMENT</Text>
              {(() => {
                const currentSplit = paymentSplits.find(s => s.id === activePickingSplitId);
                const isSelected = currentSplit?.mode === 'cash';
                return (
                  <Pressable
                    onPress={() => {
                      handleUpdatePaymentSplit(activePickingSplitId, 'mode', 'cash');
                      setActivePickingSplitId(null);
                    }}
                    style={[styles.termsRow, isSelected && styles.termsRowSelected]}
                    testID="pm-cash"
                  >
                    <View style={[styles.modeIconCircle, { backgroundColor: '#DCFCE7' }]}>
                      <Ionicons name="cash" size={20} color="#059669" />
                    </View>
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <Text style={{ color: '#111827', fontWeight: '800', fontSize: 13.5 }}>Cash</Text>
                      <Text style={{ color: '#059669', fontSize: 11.5, fontWeight: '600' }}>Direct Cash in Hand Ledger</Text>
                    </View>
                    {isSelected ? <Ionicons name="checkmark-circle" size={22} color="#059669" /> : null}
                  </Pressable>
                );
              })()}

              {/* Option 2: Bank Transfer / Online with each Bank Account */}
              <Text style={[styles.modalSectionHdr, { marginTop: 12 }]}>BANK TRANSFER / ONLINE (SELECT ACCOUNT)</Text>
              {banks.map(b => {
                const currentSplit = paymentSplits.find(s => s.id === activePickingSplitId);
                const isSelected = currentSplit?.mode === 'bank_transfer' && (currentSplit?.bank_id || banks[0]?.id) === b.id;
                const shortLbl = getBankShortLabel(b);
                return (
                  <Pressable
                    key={`bt-${b.id}`}
                    onPress={() => {
                      handleSelectBankMode(activePickingSplitId, 'bank_transfer', b);
                      setActivePickingSplitId(null);
                    }}
                    style={[styles.termsRow, isSelected && styles.termsRowSelected]}
                    testID={`pm-bank-${b.id}`}
                  >
                    <View style={[styles.modeIconCircle, { backgroundColor: '#DBEAFE' }]}>
                      <Ionicons name="business" size={20} color="#1E40AF" />
                    </View>
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <Text style={{ color: '#111827', fontWeight: '800', fontSize: 13.5 }}>{shortLbl}</Text>
                      <Text style={{ color: '#1E40AF', fontSize: 11.5, fontWeight: '600' }}>
                        Online Transfer • {b.name} (IFSC: {b.ifsc || '—'})
                      </Text>
                    </View>
                    {isSelected ? <Ionicons name="checkmark-circle" size={22} color="#1E40AF" /> : null}
                  </Pressable>
                );
              })}

              {/* Option 3: Cheque with Bank Accounts */}
              <Text style={[styles.modalSectionHdr, { marginTop: 12 }]}>CHEQUE (SELECT DEPOSIT BANK)</Text>
              {banks.map(b => {
                const currentSplit = paymentSplits.find(s => s.id === activePickingSplitId);
                const isSelected = currentSplit?.mode === 'cheque' && (currentSplit?.bank_id || banks[0]?.id) === b.id;
                const shortLbl = getBankShortLabel(b);
                return (
                  <Pressable
                    key={`chq-${b.id}`}
                    onPress={() => {
                      handleSelectBankMode(activePickingSplitId, 'cheque', b);
                      setActivePickingSplitId(null);
                    }}
                    style={[styles.termsRow, isSelected && styles.termsRowSelected]}
                    testID={`pm-chq-${b.id}`}
                  >
                    <View style={[styles.modeIconCircle, { backgroundColor: '#EDE9FE' }]}>
                      <Ionicons name="document-text" size={20} color="#7C3AED" />
                    </View>
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <Text style={{ color: '#111827', fontWeight: '800', fontSize: 13.5 }}>Cheque — {shortLbl}</Text>
                      <Text style={{ color: '#7C3AED', fontSize: 11.5, fontWeight: '600' }}>Deposit to {b.bank_name || 'Bank'}</Text>
                    </View>
                    {isSelected ? <Ionicons name="checkmark-circle" size={22} color="#7C3AED" /> : null}
                  </Pressable>
                );
              })}

              {/* Option 4: UPI / QR with Bank Accounts */}
              <Text style={[styles.modalSectionHdr, { marginTop: 12 }]}>UPI / QR (SELECT RECEIVING BANK)</Text>
              {banks.map(b => {
                const currentSplit = paymentSplits.find(s => s.id === activePickingSplitId);
                const isSelected = currentSplit?.mode === 'upi' && (currentSplit?.bank_id || banks[0]?.id) === b.id;
                const shortLbl = getBankShortLabel(b);
                return (
                  <Pressable
                    key={`upi-${b.id}`}
                    onPress={() => {
                      handleSelectBankMode(activePickingSplitId, 'upi', b);
                      setActivePickingSplitId(null);
                    }}
                    style={[styles.termsRow, isSelected && styles.termsRowSelected]}
                    testID={`pm-upi-${b.id}`}
                  >
                    <View style={[styles.modeIconCircle, { backgroundColor: '#E0F2FE' }]}>
                      <Ionicons name="phone-portrait" size={20} color="#0284C7" />
                    </View>
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <Text style={{ color: '#111827', fontWeight: '800', fontSize: 13.5 }}>UPI / QR — {shortLbl}</Text>
                      <Text style={{ color: '#0284C7', fontSize: 11.5, fontWeight: '600' }}>Receive via UPI to {b.bank_name || 'Bank'}</Text>
                    </View>
                    {isSelected ? <Ionicons name="checkmark-circle" size={22} color="#0284C7" /> : null}
                  </Pressable>
                );
              })}

              {/* Option 5: Other Mode */}
              <Text style={[styles.modalSectionHdr, { marginTop: 12 }]}>OTHER</Text>
              {(() => {
                const currentSplit = paymentSplits.find(s => s.id === activePickingSplitId);
                const isSelected = currentSplit?.mode === 'other';
                return (
                  <Pressable
                    onPress={() => {
                      handleUpdatePaymentSplit(activePickingSplitId, 'mode', 'other');
                      setActivePickingSplitId(null);
                    }}
                    style={[styles.termsRow, isSelected && styles.termsRowSelected]}
                    testID="pm-other"
                  >
                    <View style={[styles.modeIconCircle, { backgroundColor: '#F1F5F9' }]}>
                      <Ionicons name="ellipsis-horizontal" size={20} color="#64748B" />
                    </View>
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <Text style={{ color: '#111827', fontWeight: '800', fontSize: 13.5 }}>Other Mode</Text>
                      <Text style={{ color: '#64748B', fontSize: 11.5 }}>Unspecified / Custom Payment</Text>
                    </View>
                    {isSelected ? <Ionicons name="checkmark-circle" size={22} color="#64748B" /> : null}
                  </Pressable>
                );
              })()}
            </ScrollView>
          </View>
        </Pressable>
      ) : null}

      {/* Bank Account Selector Modal for Split Payments */}
      {activePickingBankSplitId ? (
        <Pressable style={styles.termsOverlay} onPress={() => setActivePickingBankSplitId(null)}>
          <View style={styles.termsSheet}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <Text style={styles.termsTitle}>Select Bank Account / Ledger</Text>
              <Pressable
                onPress={() => {
                  setTargetSplitIdForNewBank(activePickingBankSplitId);
                  setActivePickingBankSplitId(null);
                  setShowAddBankModal(true);
                }}
                style={styles.quickAddBankBtn}
              >
                <Ionicons name="add-circle" size={16} color="#FFF" />
                <Text style={styles.quickAddBankTxt}>+ Add New Bank</Text>
              </Pressable>
            </View>
            <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 10 }}>
              Payment will be credited directly to this account's ledger
            </Text>
            {banks.map(b => {
              const currentSplit = paymentSplits.find(s => s.id === activePickingBankSplitId);
              const isSelected = (currentSplit?.bank_id || banks[0]?.id) === b.id;
              return (
                <Pressable
                  key={b.id}
                  onPress={() => {
                    handleSetBankForSplit(activePickingBankSplitId, b);
                    setActivePickingBankSplitId(null);
                  }}
                  style={[styles.termsRow, { justifyContent: 'space-between' }]}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                    <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: '#EFF6FF', alignItems: 'center', justifyContent: 'center' }}>
                      <Ionicons name="business" size={18} color={colors.brandPrimary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 13, fontWeight: '800', color: '#1E293B' }}>{getBankShortLabel(b)}</Text>
                      <Text style={{ fontSize: 11, color: colors.muted, marginTop: 2 }}>
                        {b.name} • IFSC: {b.ifsc || '—'}
                      </Text>
                    </View>
                  </View>
                  {isSelected ? <Ionicons name="checkmark-circle" size={22} color={colors.brandPrimary} /> : null}
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      ) : null}

      {/* Modal: Add New Bank Account */}
      {showAddBankModal ? (
        <Pressable style={styles.termsOverlay} onPress={() => setShowAddBankModal(false)}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ width: '100%' }}>
            <Pressable style={styles.addBankModalBox} onPress={e => e.stopPropagation()}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <Text style={styles.modalTitle}>Add New Bank Account</Text>
                <Pressable onPress={() => setShowAddBankModal(false)} hitSlop={8}>
                  <Ionicons name="close" size={20} color="#64748B" />
                </Pressable>
              </View>
              <Text style={styles.modalSubtitle}>Create a new bank ledger for auto-posting receipts</Text>

              {bankSaveErr ? (
                <View style={styles.errBanner}>
                  <Ionicons name="alert-circle" size={16} color="#DC2626" />
                  <Text style={styles.errBannerTxt}>{bankSaveErr}</Text>
                </View>
              ) : null}

              <ScrollView contentContainerStyle={{ gap: 10, paddingVertical: 10 }}>
                <View>
                  <Text style={styles.inputLbl}>Account Holder / Nickname *</Text>
                  <TextInput
                    value={newBankForm.name}
                    onChangeText={v => setNewBankForm(p => ({ ...p, name: v }))}
                    placeholder="e.g. TRIVENI DSC AND ETENDER SERVICE PRIVATE LIMITED"
                    placeholderTextColor="#94A3B8"
                    style={styles.modalInput}
                  />
                </View>

                <View>
                  <Text style={styles.inputLbl}>Bank Name *</Text>
                  <TextInput
                    value={newBankForm.bank_name}
                    onChangeText={v => setNewBankForm(p => ({ ...p, bank_name: v }))}
                    placeholder="e.g. State Bank of India, Axis Bank, HDFC Bank"
                    placeholderTextColor="#94A3B8"
                    style={styles.modalInput}
                  />
                </View>

                <View>
                  <Text style={styles.inputLbl}>Account Number *</Text>
                  <TextInput
                    value={newBankForm.account_no}
                    onChangeText={v => setNewBankForm(p => ({ ...p, account_no: v }))}
                    placeholder="e.g. 42137607814"
                    placeholderTextColor="#94A3B8"
                    style={styles.modalInput}
                  />
                </View>

                <View>
                  <Text style={styles.inputLbl}>IFSC Code (optional)</Text>
                  <TextInput
                    value={newBankForm.ifsc}
                    onChangeText={v => setNewBankForm(p => ({ ...p, ifsc: v.toUpperCase() }))}
                    placeholder="e.g. SBIN0063706"
                    placeholderTextColor="#94A3B8"
                    autoCapitalize="characters"
                    style={styles.modalInput}
                  />
                </View>

                <View>
                  <Text style={styles.inputLbl}>Opening Balance (₹)</Text>
                  <TextInput
                    value={newBankForm.opening_balance}
                    onChangeText={v => setNewBankForm(p => ({ ...p, opening_balance: v }))}
                    keyboardType="numeric"
                    placeholder="0.00"
                    placeholderTextColor="#94A3B8"
                    style={styles.modalInput}
                  />
                </View>
              </ScrollView>

              <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
                <Pressable
                  onPress={() => setShowAddBankModal(false)}
                  style={styles.modalCancelBtn}
                  disabled={savingNewBank}
                >
                  <Text style={styles.modalCancelBtnTxt}>Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={handleSaveNewBank}
                  style={styles.modalSaveBtn}
                  disabled={savingNewBank}
                >
                  <Text style={styles.modalSaveBtnTxt}>{savingNewBank ? 'Saving...' : 'Save & Select Bank'}</Text>
                </Pressable>
              </View>
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      ) : null}
    </View>
  );
}

const Cell: React.FC<{ label: string; value: string; onChangeText?: (v: string) => void; placeholder?: string; disabled?: boolean; testID?: string }>
  = ({ label, value, onChangeText, placeholder, disabled, testID }) => (
  <View style={styles.cell}>
    <Text style={styles.cellLbl}>{label}</Text>
    <TextInput
      testID={testID}
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      editable={!disabled}
      placeholderTextColor={colors.muted}
      style={[styles.cellInput, disabled && { color: colors.muted }]}
    />
  </View>
);

const NumCell: React.FC<{ label: string; value: string; onChange: (v: string) => void }> = ({ label, value, onChange }) => (
  <View style={styles.numCell}>
    <Text style={styles.cellLbl}>{label}</Text>
    <TextInput value={value} onChangeText={onChange} keyboardType="numeric" style={styles.cellInput} />
  </View>
);

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F4F6FB' },
  header: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, gap: 8 },
  backBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#F1F5F9', borderWidth: 1, borderColor: '#CBD5E1', alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 2, elevation: 2 },
  headerTitle: { fontSize: font.xl, fontWeight: '800', color: '#111827' },
  headerSub: { color: colors.muted, fontSize: font.sm },
  segWrap: { flexDirection: 'row', backgroundColor: '#F3F4F6', borderRadius: radius.pill, padding: 3 },
  seg: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill },
  segActive: { backgroundColor: colors.brandPrimary },
  segTxt: { color: colors.muted, fontWeight: '700', fontSize: 12 },
  segTxtActive: { color: '#FFF' },
  rowGrid: { flexDirection: 'row', gap: 8 },
  cell: { flex: 1, backgroundColor: '#FFF', borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 8 },
  cellLbl: { color: colors.muted, fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  cellVal: { color: '#111827', fontSize: font.base, fontWeight: '700', paddingVertical: 6 },
  cellInput: { color: '#111827', fontSize: font.base, fontWeight: '700', paddingVertical: 6, padding: 0 },
  partyRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#FFF', borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: 12 },
  partyIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center' },
  partyLbl: { color: colors.muted, fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  partyName: { color: '#111827', fontSize: font.lg, fontWeight: '800', marginTop: 2 },
  muted: { color: colors.muted, fontSize: font.sm, marginTop: 2 },
  phoneRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#FFF', borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: 12 },
  itemsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  itemsTitle: { color: '#111827', fontWeight: '800', fontSize: font.lg },
  itemsAdd: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.brandPrimary, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill },
  itemsEmpty: { alignItems: 'center', padding: 20, borderStyle: 'dashed', borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: '#FFF' },
  itemCard: { backgroundColor: '#FFF', borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: 12, gap: 8 },
  itemGrid: { flexDirection: 'row', gap: 6 },
  numCell: { flex: 1, backgroundColor: '#F9FAFB', borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 4 },
  lineTotal: { color: '#059669', fontWeight: '800' },
  notesWrap: { backgroundColor: '#FFF', borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: 12 },
  notesInput: { color: '#111827', fontSize: font.base, minHeight: 60, textAlignVertical: 'top' },
  bottomBar: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: '#FFF', borderTopWidth: 1, borderTopColor: colors.border, padding: 12, gap: 8 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  totalLbl: { color: colors.muted, fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  taxLbl: { color: colors.muted, fontSize: 10 },
  totalVal: { color: '#059669', fontSize: font.xxl, fontWeight: '900' },
  btnSecondary: { flex: 1, backgroundColor: '#EFF6FF', paddingVertical: 12, borderRadius: radius.md, alignItems: 'center' },
  btnSecondaryTxt: { color: colors.brandPrimary, fontWeight: '800' },
  btnPrimary: { flex: 1, backgroundColor: colors.brandPrimary, paddingVertical: 12, borderRadius: radius.md, alignItems: 'center' },
  btnPrimaryTxt: { color: '#FFF', fontWeight: '800' },
  termsOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  termsSheet: { backgroundColor: '#FFF', borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg },
  termsTitle: { fontSize: font.lg, fontWeight: '800', color: '#111827', marginBottom: 8 },
  termsRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderTopWidth: 1, borderTopColor: '#F3F4F6' },
  payCard: { backgroundColor: '#FFF', borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: 14, gap: 12 },
  payHead: { fontSize: 11, fontWeight: '900', letterSpacing: 0.8, color: '#374151' },
  splitSummaryBanner: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: '#F8FAFC', borderRadius: radius.md, borderWidth: 1, borderColor: '#E2E8F0', padding: 10 },
  splitSumCol: { flex: 1 },
  splitSumLbl: { fontSize: 10, fontWeight: '700', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.5 },
  splitSumVal: { fontSize: font.base, fontWeight: '900', marginTop: 2 },
  splitCard: { backgroundColor: '#F8FAFC', borderRadius: radius.md, borderWidth: 1, borderColor: '#E2E8F0', padding: 10, gap: 8 },
  splitHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  splitModeBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#FFF', borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 8 },
  splitModeTxt: { fontSize: 13, fontWeight: '700', color: '#1E293B' },
  splitAmtBox: { flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF', borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 10 },
  splitCurrency: { fontSize: 14, fontWeight: '800', color: '#059669', marginRight: 4 },
  splitAmtInput: { flex: 1, fontSize: font.base, fontWeight: '800', color: '#059669', paddingVertical: 6 },
  splitRefRow: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#FFF', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 4 },
  splitRefInput: { flex: 1, fontSize: 12, color: '#334155', paddingVertical: 2 },
  quickFillBtn: { backgroundColor: '#EFF6FF', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4, borderWidth: 1, borderColor: '#BFDBFE' },
  quickFillTxt: { fontSize: 10, fontWeight: '800', color: colors.brandPrimary },
  addSplitBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#F0FDF4', borderWidth: 1, borderColor: '#BBF7D0', borderStyle: 'dashed', borderRadius: radius.md, paddingVertical: 10 },
  addSplitTxt: { color: '#16A34A', fontWeight: '800', fontSize: 13 },
  splitBankRow: {
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 6,
  },
  splitBankLabel: {
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
  splitBankSelectBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#93C5FD',
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  splitBankSelectTxt: {
    flex: 1,
    fontSize: 12,
    fontWeight: '700',
    color: '#1E293B',
  },
  splitAddBankBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#DBEAFE',
    borderWidth: 1,
    borderColor: '#93C5FD',
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  splitAddBankTxt: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.brandPrimary,
  },
  quickAddBankBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.brandPrimary,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  quickAddBankTxt: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '800',
  },
  addBankModalBox: {
    backgroundColor: '#FFF',
    borderRadius: radius.lg,
    padding: spacing.lg,
    width: '94%',
    maxWidth: 500,
    alignSelf: 'center',
    marginVertical: 40,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '900',
    color: '#0F172A',
  },
  modalSubtitle: {
    fontSize: 12,
    color: colors.muted,
    marginBottom: 8,
  },
  modalInput: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
    color: '#0F172A',
    fontWeight: '600',
  },
  inputLbl: {
    fontSize: 11,
    fontWeight: '800',
    color: '#334155',
    marginBottom: 3,
  },
  modalCancelBtn: {
    flex: 1,
    backgroundColor: '#F1F5F9',
    paddingVertical: 10,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  modalCancelBtnTxt: {
    fontWeight: '800',
    color: '#475569',
    fontSize: 13,
  },
  modalSaveBtn: {
    flex: 2,
    backgroundColor: colors.brandPrimary,
    paddingVertical: 10,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  modalSaveBtnTxt: {
    fontWeight: '800',
    color: '#FFF',
    fontSize: 13,
  },
  errBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FEE2E2',
    borderWidth: 1,
    borderColor: '#FCA5A5',
    borderRadius: radius.sm,
    padding: 8,
    marginBottom: 8,
  },
  errBannerTxt: {
    color: '#B91C1C',
    fontSize: 12,
    fontWeight: '700',
    flex: 1,
  },
  modalSectionHdr: {
    fontSize: 10.5,
    fontWeight: '900',
    color: '#64748B',
    letterSpacing: 0.8,
    marginTop: 10,
    marginBottom: 4,
    paddingHorizontal: 4,
  },
  modeIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  termsRowSelected: {
    backgroundColor: '#F1F5F9',
    borderRadius: radius.md,
  },
});
