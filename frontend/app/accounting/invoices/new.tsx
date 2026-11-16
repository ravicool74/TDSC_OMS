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

const today = () => new Date().toISOString().slice(0, 10);
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
  const params = useLocalSearchParams<{ type?: string; edit_id?: string }>();
  const initialType = params?.type || 'sale';
  const editId = params?.edit_id || null;

  const [actualInvoiceType, setActualInvoiceType] = useState<string>(initialType);
  const isPurchase = actualInvoiceType === 'purchase';

  const [paymentType, setPaymentType] = useState<'credit' | 'cash'>('credit');
  const [activePickingSplitId, setActivePickingSplitId] = useState<string | null>(null);

  // Multi-Payment Mode Splits State
  const [paymentSplits, setPaymentSplits] = useState<PaymentSplit[]>([
    { id: 'pay_1', mode: 'cash', amount: '', reference: '' }
  ]);

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
          if (Array.isArray(ex.payment_splits) && ex.payment_splits.length > 0) {
            setPaymentSplits(ex.payment_splits.map((s: any, idx: number) => ({
              id: `pay_${idx + 1}`,
              mode: s.mode || s.payment_mode || 'cash',
              amount: String(s.amount || ''),
              reference: s.reference || s.ref || '',
            })));
          } else if (Array.isArray(ex.payments) && ex.payments.length > 0) {
            setPaymentSplits(ex.payments.map((p: any, idx: number) => ({
              id: `pay_${idx + 1}`,
              mode: p.payment_mode || 'cash',
              amount: String(p.amount || ''),
              reference: p.reference || p.ref || '',
            })));
          } else if (ex.paid_amount) {
            setPaymentSplits([{
              id: 'pay_1',
              mode: ex.payment_mode || 'cash',
              amount: String(ex.paid_amount || ''),
              reference: '',
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
        const next = await api.get<any>(`/invoices/next-no?invoice_type=${actualInvoiceType}&date=${date}`);
        if (next) {
          if (next.next_no) {
            setInvoiceNo(next.voucher_mode === 'manual' ? next.next_no : `${next.next_no} (preview)`);
          }
          if (next.voucher_mode) {
            setIsManualVoucherNo(next.voucher_mode === 'manual');
          }
          if (next.date_start_from && !dateInitializedRef.current) {
            setDate(next.date_start_from);
            dateInitializedRef.current = true;
          }
        } else {
          setInvoiceNo(
            actualInvoiceType === 'purchase' ? 'PB-0001 (preview)' :
            actualInvoiceType === 'sale_return' ? 'CN-0001 (preview)' :
            actualInvoiceType === 'purchase_return' ? 'DN-0001 (preview)' :
            'TDSC/2026-27/000001 (preview)'
          );
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
      }
    ]);
  };

  const handleUpdatePaymentSplit = (id: string, field: 'mode' | 'amount' | 'reference', val: string) => {
    setPaymentSplits(prev => prev.map(s => s.id === id ? { ...s, [field]: val } : s));
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
        .map(s => ({
          mode: s.mode,
          amount: parseFloat(s.amount) || 0,
          reference: s.reference ? s.reference.trim() : '',
        }))
        .filter(s => s.amount > 0);

      const dominantMode = validSplits.length > 0 ? validSplits.map(s => s.mode).join(', ') : 'cash';

      const body = {
        invoice_type: actualInvoiceType,
        invoice_no: invoiceNo && !invoiceNo.includes('preview') && invoiceNo !== 'AUTO' ? invoiceNo.trim() : undefined,
        payment_type: paymentType,
        payment_mode: dominantMode,
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
            <Text style={styles.headerTitle}>{headerTitle}</Text>
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
                const currentModeObj = PAY_MODES.find(m => m.key === sp.mode) || PAY_MODES[0];
                return (
                  <View key={sp.id} style={styles.splitCard}>
                    <View style={styles.splitHeaderRow}>
                      <Pressable
                        onPress={() => setActivePickingSplitId(sp.id)}
                        style={styles.splitModeBtn}
                      >
                        <Ionicons name={currentModeObj.icon as any} size={18} color={colors.brandPrimary} />
                        <Text style={styles.splitModeTxt}>{currentModeObj.label}</Text>
                        <Ionicons name="chevron-down" size={14} color={colors.muted} />
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
            {paymentType !== 'cash' ? (
              <Pressable onPress={handleAddPaymentSplit} style={styles.addSplitBtn}>
                <Ionicons name="add-circle-outline" size={18} color={colors.brandPrimary} />
                <Text style={styles.addSplitTxt}>+ Add Payment Mode (Online / Cheque / Cash / UPI)</Text>
              </Pressable>
            ) : null}
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
          <View style={styles.termsSheet}>
            <Text style={styles.termsTitle}>Select Payment Mode</Text>
            {PAY_MODES.map(m => {
              const currentSplit = paymentSplits.find(s => s.id === activePickingSplitId);
              const isSelected = currentSplit?.mode === m.key;
              return (
                <Pressable
                  key={m.key}
                  onPress={() => {
                    handleUpdatePaymentSplit(activePickingSplitId, 'mode', m.key);
                    setActivePickingSplitId(null);
                  }}
                  style={styles.termsRow}
                  testID={`pm-${m.key}`}
                >
                  <Ionicons name={m.icon as any} size={20} color={colors.brandPrimary} />
                  <Text style={{ flex: 1, color: '#111827', fontWeight: '600', marginLeft: 10 }}>{m.label}</Text>
                  {isSelected ? <Ionicons name="checkmark" size={20} color={colors.brandPrimary} /> : null}
                </Pressable>
              );
            })}
          </View>
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
});
