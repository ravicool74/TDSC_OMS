import React, { useEffect, useState, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, KeyboardAvoidingView, Platform,
  Pressable, ActivityIndicator, Alert, TextInput, Switch
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, font } from '@/src/theme';
import { ScreenHeader } from '@/src/ScreenHeader';
import { FormInput, OptionRow } from '@/src/forms';
import { PrimaryButton } from '@/src/ui';
import { api } from '@/src/api';
import { AttachmentsSection, Attachment } from '@/src/AttachmentsSection';
import { CustomerSearchModal, PickedParty } from '@/src/CustomerSearchModal';

const today = () => new Date().toISOString().slice(0, 10);

const parseDateFlexible = (d: string): string => {
  if (!d) return '';
  d = d.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  const dm = d.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dm) {
    const day = dm[1].padStart(2, '0');
    const month = dm[2].padStart(2, '0');
    const year = dm[3];
    return `${year}-${month}-${day}`;
  }
  const dt = new Date(d);
  if (!isNaN(dt.getTime())) return dt.toISOString().slice(0, 10);
  return d;
};

const inr = (n: any) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

type InvoicePassOnItem = {
  item_id?: string;
  name: string;
  fee_type: string;
  unit: string;
  qty: number;
  price: number;
  billed_amount: number;
  already_spent: number;
  remaining_balance: number;
};

type SplitRow = {
  id: string;
  mode: 'cash' | 'bank' | 'upi' | 'cheque';
  amount: string;
  bank_account_id?: string;
  reference_no?: string;
};

export default function NewExpense() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Expense Type: Customer Pass-on Expense vs General Operating Expense
  const [expenseMode, setExpenseMode] = useState<'pass_on' | 'general'>('pass_on');

  // Customer & Sale Invoice State
  const [showPartyPick, setShowPartyPick] = useState(false);
  const [selectedParty, setSelectedParty] = useState<PickedParty | null>(null);

  const [loadingInvoices, setLoadingInvoices] = useState(false);
  const [saleInvoices, setSaleInvoices] = useState<any[]>([]);
  const [selectedInvoice, setSelectedInvoice] = useState<any | null>(null);

  // Scope: Whole Voucher vs Single Specific Item
  const [passOnTarget, setPassOnTarget] = useState<'whole_voucher' | 'single_item'>('whole_voucher');
  const [invoicePassOnSummary, setInvoicePassOnSummary] = useState<{
    total_pass_on_billed: number;
    total_already_spent: number;
    total_remaining_balance: number;
  }>({ total_pass_on_billed: 0, total_already_spent: 0, total_remaining_balance: 0 });

  const [loadingPassOnItems, setLoadingPassOnItems] = useState(false);
  const [passOnItems, setPassOnItems] = useState<InvoicePassOnItem[]>([]);
  const [selectedPassOnItem, setSelectedPassOnItem] = useState<InvoicePassOnItem | null>(null);

  const [meta, setMeta] = useState<any>({ expense_categories: [], payment_modes: ['cash', 'bank', 'upi', 'cheque'] });
  const [banks, setBanks] = useState<any[]>([]);
  const [f, setF] = useState({
    date: today(),
    category: '',
    amount: '',
    payment_mode: 'cash',
    bank_account_id: '',
    vendor: '',
    description: '',
  });

  // Multi-split payment state (Cash + Online)
  const [isSplitPayment, setIsSplitPayment] = useState(false);
  const [splitRows, setSplitRows] = useState<SplitRow[]>([
    { id: '1', mode: 'cash', amount: '', bank_account_id: '', reference_no: '' },
    { id: '2', mode: 'bank', amount: '', bank_account_id: '', reference_no: '' },
  ]);

  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const set = (k: string) => (v: string) => setF(p => ({ ...p, [k]: v }));

  useEffect(() => {
    (async () => {
      try {
        const [m, b] = await Promise.all([
          api.get<any>('/accounting/meta'),
          api.get<any[]>('/bank-accounts'),
        ]);
        setMeta(m);
        setBanks(b);
        if (m.expense_categories?.[0]) {
          setF(p => ({ ...p, category: m.expense_categories[0] }));
        }
      } catch {}
    })();
  }, []);

  // When customer changes, load customer's sale invoices
  const handleSelectCustomer = async (party: PickedParty) => {
    setSelectedParty(party);
    setSelectedInvoice(null);
    setPassOnItems([]);
    setSelectedPassOnItem(null);
    setLoadingInvoices(true);
    try {
      const invs = await api.get<any[]>(`/invoices?invoice_type=sale&party_id=${party.id}`);
      setSaleInvoices(invs || []);
      // If there's an invoice, auto-select first one
      if (invs && invs.length > 0) {
        handleSelectInvoice(invs[0]);
      }
    } catch {
      setSaleInvoices([]);
    } finally {
      setLoadingInvoices(false);
    }
  };

  // When invoice changes, load its passed-on items & voucher summary
  const handleSelectInvoice = async (inv: any) => {
    setSelectedInvoice(inv);
    setSelectedPassOnItem(null);
    setLoadingPassOnItems(true);
    try {
      const res = await api.get<any>(`/invoices/${inv.id}/passed-on-items`);
      const items: InvoicePassOnItem[] = res?.passed_on_items || [];
      setPassOnItems(items);

      const summary = {
        total_pass_on_billed: Number(res?.total_pass_on_billed || inv.total_amount || 0),
        total_already_spent: Number(res?.total_already_spent || 0),
        total_remaining_balance: Number(res?.total_remaining_balance ?? (inv.total_amount || 0)),
      };
      setInvoicePassOnSummary(summary);

      // Default to Whole Voucher
      setPassOnTarget('whole_voucher');
      const itemNames = items.map((x: any) => x.name).filter(Boolean);
      const label = itemNames.length > 0 ? itemNames.join(', ') : 'All Items';
      const bal = summary.total_remaining_balance;
      const initialAmtStr = bal > 0 ? String(bal) : '';

      setF(p => ({
        ...p,
        category: `Voucher Pass-on: ${inv.invoice_no || 'Whole Voucher'}`,
        amount: initialAmtStr || p.amount,
        description: `Disbursement of client pass-on funds for Voucher ${inv.invoice_no || ''}${label ? ` (${label})` : ''}`,
      }));

      // Pre-fill initial split row if amount present
      if (bal > 0) {
        setSplitRows([
          { id: '1', mode: 'cash', amount: String(bal), bank_account_id: '', reference_no: '' },
          { id: '2', mode: 'bank', amount: '', bank_account_id: '', reference_no: '' },
        ]);
      }
    } catch {
      setPassOnItems([]);
    } finally {
      setLoadingPassOnItems(false);
    }
  };

  // When a specific pass-on item is picked
  const handlePickPassOnItem = (it: InvoicePassOnItem) => {
    setSelectedPassOnItem(it);
    setPassOnTarget('single_item');
    setF(p => ({
      ...p,
      category: `${it.name} Expense`,
      amount: it.remaining_balance > 0 ? String(it.remaining_balance) : p.amount,
      description: `Disbursement of client pass-on funds for ${it.name} against Voucher ${selectedInvoice?.invoice_no || ''}`,
    }));
  };

  // Split payment helper methods
  const addSplitRow = () => {
    const curTotal = splitRows.reduce((sum, r) => sum + (parseFloat(r.amount) || 0), 0);
    const targetAmt = parseFloat(f.amount) || 0;
    const remainingToFill = Math.max(0, targetAmt - curTotal);

    setSplitRows(prev => {
      const hasCash = prev.some(r => r.mode === 'cash');
      const nextMode = hasCash ? 'bank' : 'cash';
      const updated = [
        ...prev,
        {
          id: String(Date.now()),
          mode: nextMode as any,
          amount: remainingToFill > 0 ? String(remainingToFill) : '',
          bank_account_id: banks[0]?.id || '',
          reference_no: '',
        }
      ];
      syncDescriptionFromSplit(updated);
      return updated;
    });
  };

  const removeSplitRow = (id: string) => {
    if (splitRows.length <= 1) return;
    setSplitRows(prev => {
      const updated = prev.filter(r => r.id !== id);
      syncDescriptionFromSplit(updated);
      return updated;
    });
  };

  const updateSplitRow = (id: string, field: string, val: string) => {
    setSplitRows(prev => {
      const updated = prev.map(r => r.id === id ? { ...r, [field]: val } : r);
      syncDescriptionFromSplit(updated);
      return updated;
    });
  };

  const syncDescriptionFromSplit = (rows: SplitRow[]) => {
    const parts: string[] = [];
    rows.forEach(r => {
      const a = parseFloat(r.amount) || 0;
      if (a > 0) {
        if (r.mode === 'cash') {
          parts.push(`CASH BY ${a}/-`);
        } else {
          const bank = banks.find(b => b.id === r.bank_account_id)?.name;
          const bname = bank ? ` (${bank})` : '';
          const ref = r.reference_no ? ` REF: ${r.reference_no}` : '';
          parts.push(`BY ONLINE${bname} ${a}/-${ref}`);
        }
      }
    });
    if (parts.length > 0) {
      setF(p => ({ ...p, description: parts.join('\n') }));
    }
  };

  const totalSplit = useMemo(() => {
    return splitRows.reduce((sum, r) => sum + (parseFloat(r.amount) || 0), 0);
  }, [splitRows]);

  const splitDifference = useMemo(() => {
    const target = parseFloat(f.amount) || 0;
    return target - totalSplit;
  }, [f.amount, totalSplit]);

  const amtNum = parseFloat(f.amount) || 0;
  const isOverLimit = useMemo(() => {
    if (expenseMode !== 'pass_on') return false;
    if (passOnTarget === 'whole_voucher') {
      return amtNum > invoicePassOnSummary.total_remaining_balance;
    }
    return selectedPassOnItem ? amtNum > selectedPassOnItem.remaining_balance : false;
  }, [expenseMode, passOnTarget, amtNum, invoicePassOnSummary, selectedPassOnItem]);

  const save = async () => {
    const amt = parseFloat(f.amount);
    if (Number.isNaN(amt) || amt <= 0) {
      setErr('Valid expense amount required');
      return;
    }

    if (expenseMode === 'pass_on') {
      if (!selectedParty) {
        setErr('Please select a customer from database');
        return;
      }
      if (!selectedInvoice) {
        setErr('Please choose a Sale Voucher to book expense against');
        return;
      }
      if (passOnTarget === 'single_item') {
        if (!selectedPassOnItem) {
          setErr('Please select a Passed On Money item from the table');
          return;
        }
        if (amt > selectedPassOnItem.remaining_balance) {
          setErr(
            `Expense amount ₹${amt.toLocaleString('en-IN', { minimumFractionDigits: 2 })} exceeds available balance ₹${selectedPassOnItem.remaining_balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })} for "${selectedPassOnItem.name}".`
          );
          return;
        }
      } else {
        if (amt > invoicePassOnSummary.total_remaining_balance) {
          setErr(
            `Expense amount ₹${amt.toLocaleString('en-IN', { minimumFractionDigits: 2 })} exceeds available whole voucher balance ₹${invoicePassOnSummary.total_remaining_balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })} for Voucher ${selectedInvoice.invoice_no}.`
          );
          return;
        }
      }
    } else {
      if (!f.category) {
        setErr('Expense category required');
        return;
      }
    }

    if (isSplitPayment) {
      if (Math.abs(totalSplit - amt) > 0.05) {
        setErr(
          `Total of split payments (₹${totalSplit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}) must match total expense amount (₹${amt.toLocaleString('en-IN', { minimumFractionDigits: 2 })}). Difference: ₹${Math.abs(splitDifference).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
        );
        return;
      }
    }

    setErr(null);
    setBusy(true);
    try {
      const payload: any = {
        date: parseDateFlexible(f.date) || f.date,
        category: f.category || (passOnTarget === 'whole_voucher' ? 'Voucher Pass-on Expense' : `${selectedPassOnItem?.name} Expense`),
        amount: amt,
        payment_mode: isSplitPayment ? 'split' : f.payment_mode,
        bank_account_id: (!isSplitPayment && f.payment_mode !== 'cash') ? (f.bank_account_id || null) : null,
        vendor: f.vendor || null,
        description: f.description || null,
      };

      if (isSplitPayment) {
        payload.split_payments = splitRows.map(r => ({
          mode: r.mode,
          amount: parseFloat(r.amount) || 0,
          bank_account_id: r.mode !== 'cash' ? (r.bank_account_id || null) : null,
          bank_name: r.mode !== 'cash' ? (banks.find(b => b.id === r.bank_account_id)?.name || null) : null,
          reference_no: r.reference_no || null,
        }));
      }

      if (expenseMode === 'pass_on' && selectedInvoice) {
        payload.customer_id = selectedParty?.id;
        payload.customer_name = selectedParty?.name;
        payload.customer_mobile = selectedParty?.mobile;
        payload.sale_invoice_id = selectedInvoice.id;
        payload.sale_invoice_no = selectedInvoice.invoice_no;
        payload.sale_invoice_date = selectedInvoice.date;

        if (passOnTarget === 'whole_voucher') {
          payload.is_whole_voucher = true;
          payload.sale_item_name = 'All Voucher Items';
          payload.pass_on_item_type = 'passed_on_money';
          payload.pass_on_received_amount = invoicePassOnSummary.total_pass_on_billed;
        } else if (selectedPassOnItem) {
          payload.is_whole_voucher = false;
          payload.sale_item_name = selectedPassOnItem.name;
          payload.pass_on_item_type = 'passed_on_money';
          payload.pass_on_received_amount = selectedPassOnItem.billed_amount;
        }
      }

      const created: any = await api.post('/expenses', payload);

      // Upload queued attachments (best-effort)
      for (const a of attachments) {
        if (a.pending && a.uri) {
          try {
            await api.uploadVoucherFile('expenses', created.id, {
              uri: a.uri,
              name: a.name,
              type: a.type || 'application/octet-stream',
            });
          } catch {}
        }
      }

      if (Platform.OS === 'web') {
        window.alert(`Expense ${created.expense_no || ''} booked successfully!`);
      } else {
        Alert.alert('Success', `Expense ${created.expense_no || ''} booked successfully!`);
      }
      router.back();
    } catch (e: any) {
      setErr(e?.message || 'Failed to book expense');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surfaceSecondary }} testID="new-expense">
      <ScreenHeader title="Add Expense" />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: 60 + insets.bottom }}>

          {/* Mode Switcher */}
          <View style={styles.modeContainer}>
            <Pressable
              testID="mode-passon"
              onPress={() => setExpenseMode('pass_on')}
              style={[styles.modeTab, expenseMode === 'pass_on' && styles.modeTabActivePassOn]}
            >
              <Ionicons
                name="swap-vertical"
                size={18}
                color={expenseMode === 'pass_on' ? '#0D9488' : colors.muted}
              />
              <View style={{ flex: 1 }}>
                <Text style={[styles.modeTitle, expenseMode === 'pass_on' && { color: '#0D9488' }]}>
                  Customer Pass-on Expense
                </Text>
                <Text style={styles.modeSub}>Linked to Customer & Sale Voucher (EMD, BOQ, Fees)</Text>
              </View>
            </Pressable>

            <Pressable
              testID="mode-general"
              onPress={() => setExpenseMode('general')}
              style={[styles.modeTab, expenseMode === 'general' && styles.modeTabActiveGeneral]}
            >
              <Ionicons
                name="card-outline"
                size={18}
                color={expenseMode === 'general' ? colors.brandPrimary : colors.muted}
              />
              <View style={{ flex: 1 }}>
                <Text style={[styles.modeTitle, expenseMode === 'general' && { color: colors.brandPrimary }]}>
                  General Business Expense
                </Text>
                <Text style={styles.modeSub}>Rent, Salary, Travel, Office Utilities</Text>
              </View>
            </Pressable>
          </View>

          {/* ========================================================================= */}
          {/* CUSTOMER PASS-ON SECTION */}
          {/* ========================================================================= */}
          {expenseMode === 'pass_on' && (
            <View style={styles.passOnBox}>
              <View style={styles.boxHeader}>
                <Ionicons name="link" size={18} color="#0D9488" />
                <Text style={styles.boxTitle}>Pass-on Money Booking & Voucher Link</Text>
              </View>

              {/* 1. Customer Search & Choose */}
              <View style={{ gap: 6 }}>
                <Text style={styles.sectionLabel}>1. Select Customer (From Database) *</Text>
                <Pressable
                  testID="btn-choose-customer"
                  onPress={() => setShowPartyPick(true)}
                  style={styles.customerSelector}
                >
                  <View style={[styles.avatar, { backgroundColor: selectedParty ? '#CCFBF1' : '#F1F5F9' }]}>
                    <Ionicons name="person" size={20} color={selectedParty ? '#0D9488' : colors.muted} />
                  </View>
                  <View style={{ flex: 1 }}>
                    {selectedParty ? (
                      <>
                        <Text style={styles.customerName}>{selectedParty.name}</Text>
                        <Text style={styles.customerSub}>
                          {selectedParty.customer_code || 'Customer'} • 📱 {selectedParty.mobile}
                          {selectedParty.gst_no ? ` • GST: ${selectedParty.gst_no}` : ''}
                        </Text>
                      </>
                    ) : (
                      <Text style={{ color: colors.muted, fontSize: font.base }}>
                        Tap to search and choose customer from database…
                      </Text>
                    )}
                  </View>
                  <View style={styles.chooseBadge}>
                    <Text style={styles.chooseBadgeTxt}>{selectedParty ? 'Change' : 'Search'}</Text>
                  </View>
                </Pressable>
              </View>

              {/* 2. Sale Voucher (Invoice) Picker */}
              {selectedParty && (
                <View style={{ gap: 6, marginTop: 4 }}>
                  <Text style={styles.sectionLabel}>2. Choose Sale Voucher (Invoice) *</Text>
                  {loadingInvoices ? (
                    <ActivityIndicator color="#0D9488" style={{ marginVertical: 8 }} />
                  ) : saleInvoices.length === 0 ? (
                    <View style={styles.alertBox}>
                      <Ionicons name="warning-outline" size={18} color="#D97706" />
                      <Text style={styles.alertTxt}>
                        No Sale Invoices found for this customer. Please create a Sale Invoice first.
                      </Text>
                    </View>
                  ) : (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
                      {saleInvoices.map(inv => {
                        const isSel = selectedInvoice?.id === inv.id;
                        return (
                          <Pressable
                            key={inv.id}
                            testID={`pick-inv-${inv.id}`}
                            onPress={() => handleSelectInvoice(inv)}
                            style={[styles.invoiceChip, isSel && styles.invoiceChipActive]}
                          >
                            <Ionicons
                              name="receipt"
                              size={16}
                              color={isSel ? '#FFF' : '#0D9488'}
                            />
                            <View>
                              <Text style={[styles.invoiceChipNo, isSel && { color: '#FFF' }]}>
                                {inv.invoice_no || 'SI-—'}
                              </Text>
                              <Text style={[styles.invoiceChipMeta, isSel && { color: '#E6FFFA' }]}>
                                {inv.date} • ₹{Number(inv.total_amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                              </Text>
                            </View>
                          </Pressable>
                        );
                      })}
                    </ScrollView>
                  )}
                </View>
              )}

              {/* 3. Voucher Allocation Scope (Whole Voucher vs Specific Item) */}
              {selectedInvoice && (
                <View style={{ gap: 8, marginTop: 8 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={styles.sectionLabel}>
                      3. Allocation Scope in Voucher *
                    </Text>
                  </View>

                  {/* Scope Selector Tabs */}
                  <View style={styles.scopeTabs}>
                    <Pressable
                      style={[styles.scopeTab, passOnTarget === 'whole_voucher' && styles.scopeTabActive]}
                      onPress={() => {
                        setPassOnTarget('whole_voucher');
                        setSelectedPassOnItem(null);
                        const names = passOnItems.map(x => x.name).join(', ');
                        const bal = invoicePassOnSummary.total_remaining_balance;
                        setF(p => ({
                          ...p,
                          category: `Voucher Pass-on: ${selectedInvoice.invoice_no}`,
                          amount: bal > 0 ? String(bal) : p.amount,
                          description: `Disbursement of pass-on funds for entire Voucher ${selectedInvoice.invoice_no}${names ? ` (${names})` : ''}`,
                        }));
                        if (bal > 0) {
                          setSplitRows([
                            { id: '1', mode: 'cash', amount: String(bal), bank_account_id: '', reference_no: '' },
                            { id: '2', mode: 'bank', amount: '', bank_account_id: '', reference_no: '' },
                          ]);
                        }
                      }}
                    >
                      <Ionicons name="documents" size={16} color={passOnTarget === 'whole_voucher' ? '#FFF' : '#0D9488'} />
                      <Text style={[styles.scopeTabTxt, passOnTarget === 'whole_voucher' && styles.scopeTabTxtActive]}>
                        Entire Voucher ({inr(invoicePassOnSummary.total_remaining_balance)})
                      </Text>
                    </Pressable>

                    <Pressable
                      style={[styles.scopeTab, passOnTarget === 'single_item' && styles.scopeTabActive]}
                      onPress={() => {
                        setPassOnTarget('single_item');
                        if (passOnItems.length > 0) {
                          handlePickPassOnItem(passOnItems[0]);
                        }
                      }}
                    >
                      <Ionicons name="list" size={16} color={passOnTarget === 'single_item' ? '#FFF' : '#0D9488'} />
                      <Text style={[styles.scopeTabTxt, passOnTarget === 'single_item' && styles.scopeTabTxtActive]}>
                        Specific Item
                      </Text>
                    </Pressable>
                  </View>

                  {/* Scope: Whole Voucher Summary Card */}
                  {passOnTarget === 'whole_voucher' ? (
                    <View style={styles.voucherSummaryCard}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                        <Ionicons name="checkmark-done-circle" size={20} color="#0D9488" />
                        <Text style={styles.voucherSummaryTitle}>
                          WHOLE VOUCHER DISBURSEMENT: {selectedInvoice.invoice_no}
                        </Text>
                      </View>
                      <Text style={{ fontSize: 12, color: '#334155', marginBottom: 8 }}>
                        All passed-on items inside this sale voucher are grouped together into this single expense.
                      </Text>
                      <View style={styles.summaryStatsRow}>
                        <View style={styles.statBox}>
                          <Text style={styles.statLbl}>Voucher Funds</Text>
                          <Text style={styles.statVal}>{inr(invoicePassOnSummary.total_pass_on_billed)}</Text>
                        </View>
                        <View style={styles.statBox}>
                          <Text style={styles.statLbl}>Already Spent</Text>
                          <Text style={[styles.statVal, { color: '#DC2626' }]}>{inr(invoicePassOnSummary.total_already_spent)}</Text>
                        </View>
                        <View style={[styles.statBox, { backgroundColor: '#ECFDF5', borderColor: '#A7F3D0' }]}>
                          <Text style={[styles.statLbl, { color: '#047857' }]}>Available Balance</Text>
                          <Text style={[styles.statVal, { color: '#047857', fontWeight: '900' }]}>
                            {inr(invoicePassOnSummary.total_remaining_balance)}
                          </Text>
                        </View>
                      </View>

                      {/* Items list preview */}
                      {passOnItems.length > 0 && (
                        <View style={{ marginTop: 8, borderTopWidth: 1, borderTopColor: '#E2E8F0', paddingTop: 6 }}>
                          <Text style={{ fontSize: 11, fontWeight: '700', color: '#64748B', marginBottom: 4 }}>
                            Items Included in Voucher:
                          </Text>
                          {passOnItems.map(it => (
                            <View key={it.name} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 }}>
                              <Text style={{ fontSize: 12, color: '#334155' }}>• {it.name} ({it.fee_type || 'Pass-on'})</Text>
                              <Text style={{ fontSize: 12, fontWeight: '700', color: '#0F172A' }}>{inr(it.billed_amount)}</Text>
                            </View>
                          ))}
                        </View>
                      )}
                    </View>
                  ) : (
                    /* Scope: Single Specific Item Selector */
                    <View style={{ gap: 6 }}>
                      {loadingPassOnItems ? (
                        <ActivityIndicator color="#0D9488" style={{ marginVertical: 12 }} />
                      ) : passOnItems.length === 0 ? (
                        <View style={styles.alertBox}>
                          <Ionicons name="alert-circle-outline" size={18} color="#DC2626" />
                          <Text style={[styles.alertTxt, { color: '#DC2626' }]}>
                            No Passed On Money items exist in Sale Voucher {selectedInvoice.invoice_no}.
                          </Text>
                        </View>
                      ) : (
                        <View style={styles.tableContainer}>
                          <View style={styles.tableHeaderRow}>
                            <Text style={[styles.thCell, { flex: 2 }]}>Fee Item Name</Text>
                            <Text style={[styles.thCell, { flex: 1.5, textAlign: 'right' }]}>Received</Text>
                            <Text style={[styles.thCell, { flex: 1.5, textAlign: 'right' }]}>Spent</Text>
                            <Text style={[styles.thCell, { flex: 1.5, textAlign: 'right' }]}>Balance</Text>
                            <Text style={[styles.thCell, { width: 50, textAlign: 'center' }]}>Select</Text>
                          </View>
                          {passOnItems.map(it => {
                            const isChosen = selectedPassOnItem?.name === it.name;
                            const isZero = it.remaining_balance <= 0;
                            return (
                              <Pressable
                                key={it.name}
                                testID={`row-passon-${it.name}`}
                                onPress={() => !isZero && handlePickPassOnItem(it)}
                                style={[
                                  styles.tableDataRow,
                                  isChosen && styles.tableDataRowChosen,
                                  isZero && { opacity: 0.6, backgroundColor: '#F8FAFC' },
                                ]}
                              >
                                <View style={{ flex: 2 }}>
                                  <Text style={[styles.tdName, isChosen && { color: '#0D9488' }]}>{it.name}</Text>
                                  <Text style={styles.tdFeeType}>{it.fee_type || 'Reimbursement'}</Text>
                                </View>
                                <Text style={[styles.tdAmt, { flex: 1.5, textAlign: 'right' }]}>
                                  {inr(it.billed_amount)}
                                </Text>
                                <Text style={[styles.tdAmt, { flex: 1.5, textAlign: 'right', color: '#DC2626' }]}>
                                  {inr(it.already_spent)}
                                </Text>
                                <Text
                                  style={[
                                    styles.tdAmt,
                                    { flex: 1.5, textAlign: 'right', fontWeight: '800' },
                                    isZero ? { color: '#94A3B8' } : { color: '#059669' },
                                  ]}
                                >
                                  {inr(it.remaining_balance)}
                                </Text>
                                <View style={{ width: 50, alignItems: 'center' }}>
                                  <Ionicons
                                    name={isChosen ? 'checkmark-circle' : isZero ? 'close-circle-outline' : 'ellipse-outline'}
                                    size={20}
                                    color={isChosen ? '#0D9488' : isZero ? '#94A3B8' : colors.muted}
                                  />
                                </View>
                              </Pressable>
                            );
                          })}
                        </View>
                      )}

                      {selectedPassOnItem && (
                        <View style={styles.selectedItemBanner}>
                          <Ionicons name="checkmark-done-circle" size={20} color="#0D9488" />
                          <View style={{ flex: 1 }}>
                            <Text style={styles.selectedItemBannerTxt}>
                              Booking against: <Text style={{ fontWeight: '800' }}>{selectedPassOnItem.name}</Text>
                            </Text>
                            <Text style={{ fontSize: 11, color: '#0F766E' }}>
                              Available Balance: <Text style={{ fontWeight: '800' }}>{inr(selectedPassOnItem.remaining_balance)}</Text> (Max allowed)
                            </Text>
                          </View>
                        </View>
                      )}
                    </View>
                  )}
                </View>
              )}
            </View>
          )}

          {/* ========================================================================= */}
          {/* GENERAL EXPENSE CATEGORY (When general mode is selected) */}
          {/* ========================================================================= */}
          {expenseMode === 'general' && (
            <View style={{ gap: 6 }}>
              <Text style={styles.label}>Expense Category *</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {(meta.expense_categories || []).map((c: string) => (
                  <Pressable
                    key={c}
                    onPress={() => setF(p => ({ ...p, category: c }))}
                    style={[styles.chip, f.category === c && styles.chipActive]}
                  >
                    <Text style={[styles.chipText, f.category === c && { color: colors.onBrandPrimary }]}>
                      {c}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )}

          {/* Date */}
          <FormInput label="Date" value={f.date} onChangeText={set('date')} placeholder="YYYY-MM-DD" testID="in-date" />

          {/* Amount (₹) with Validation */}
          <View style={{ gap: 4 }}>
            <FormInput
              label={`Amount (₹) * ${selectedPassOnItem ? `(Max: ₹${selectedPassOnItem.remaining_balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })})` : ''}`}
              value={f.amount}
              onChangeText={set('amount')}
              keyboardType="numeric"
              testID="in-amount"
            />
            {isOverLimit && (
              <View style={styles.validationErrorBox}>
                <Ionicons name="alert-circle" size={18} color="#DC2626" />
                <Text style={styles.validationErrorTxt}>
                  ⚠️ Expense amount (₹{amtNum.toLocaleString('en-IN', { minimumFractionDigits: 2 })}) exceeds available Passed On Money balance ₹{selectedPassOnItem?.remaining_balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })} for &quot;{selectedPassOnItem?.name}&quot;!
                </Text>
              </View>
            )}
          </View>

          {/* Payment Method & Split Payment Section */}
          <View style={styles.paySectionCard}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <View>
                <Text style={styles.paySectionHead}>PAYMENT MODE & ALLOCATION</Text>
                <Text style={{ fontSize: 11, color: colors.muted }}>
                  {isSplitPayment ? 'Multi-mode payment (Cash + Online / Bank)' : 'Single payment mode'}
                </Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={{ fontSize: 12, fontWeight: '700', color: isSplitPayment ? '#0D9488' : '#64748B' }}>
                  Split Payment
                </Text>
                <Switch
                  value={isSplitPayment}
                  onValueChange={v => {
                    setIsSplitPayment(v);
                    if (v) {
                      const curAmt = parseFloat(f.amount) || 0;
                      if (curAmt > 0 && splitRows.length === 2 && !splitRows[0].amount) {
                        setSplitRows([
                          { id: '1', mode: 'cash', amount: '', bank_account_id: '', reference_no: '' },
                          { id: '2', mode: 'bank', amount: '', bank_account_id: banks[0]?.id || '', reference_no: '' },
                        ]);
                      }
                    }
                  }}
                  thumbColor={isSplitPayment ? '#0D9488' : '#CBD5E1'}
                  trackColor={{ false: '#E2E8F0', true: '#99F6E4' }}
                />
              </View>
            </View>

            {/* Standard Single Payment Mode */}
            {!isSplitPayment ? (
              <View style={{ gap: 10 }}>
                <OptionRow
                  label="Payment Mode"
                  options={meta.payment_modes || ['cash', 'bank', 'upi', 'cheque']}
                  value={f.payment_mode}
                  onChange={v => setF(p => ({ ...p, payment_mode: v }))}
                  testID="mode"
                />

                {/* Bank Account Selection (if not cash) */}
                {f.payment_mode !== 'cash' && banks.length > 0 ? (
                  <View style={{ gap: 6 }}>
                    <Text style={styles.label}>Bank Account</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                      {banks.map(b => (
                        <Pressable
                          key={b.id}
                          onPress={() => setF(p => ({ ...p, bank_account_id: b.id }))}
                          style={[styles.chip, f.bank_account_id === b.id && styles.chipActive]}
                        >
                          <Text style={[styles.chipText, f.bank_account_id === b.id && { color: colors.onBrandPrimary }]}>
                            {b.name}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                ) : null}
              </View>
            ) : (
              /* Split Payment UI (matching screenshot layout) */
              <View style={styles.splitBox}>
                <View style={styles.splitHeaderRow}>
                  <Text style={[styles.splitHeadTh, { flex: 1.8 }]}>Payment Type</Text>
                  <Text style={[styles.splitHeadTh, { flex: 1.8 }]}>Amount (₹)</Text>
                  <Text style={[styles.splitHeadTh, { width: 44, textAlign: 'center' }]}>Del</Text>
                </View>

                {splitRows.map((row, index) => {
                  const isCash = row.mode === 'cash';
                  return (
                    <View key={row.id} style={styles.splitRowWrapper}>
                      <View style={styles.splitRowInputs}>
                        {/* Payment Type Selector */}
                        <View style={{ flex: 1.8, gap: 4 }}>
                          <View style={styles.modePickerContainer}>
                            {(['cash', 'bank', 'upi', 'cheque'] as const).map(m => {
                              const active = row.mode === m;
                              return (
                                <Pressable
                                  key={m}
                                  onPress={() => updateSplitRow(row.id, 'mode', m)}
                                  style={[styles.miniModeBtn, active && styles.miniModeBtnActive]}
                                >
                                  <Text style={[styles.miniModeTxt, active && styles.miniModeTxtActive]}>
                                    {m === 'cash' ? 'Cash' : m === 'bank' ? 'Bank' : m.toUpperCase()}
                                  </Text>
                                </Pressable>
                              );
                            })}
                          </View>
                        </View>

                        {/* Amount Input */}
                        <View style={{ flex: 1.8 }}>
                          <TextInput
                            style={styles.splitAmtInput}
                            placeholder="0.00"
                            placeholderTextColor="#94A3B8"
                            keyboardType="numeric"
                            value={row.amount}
                            onChangeText={v => updateSplitRow(row.id, 'amount', v)}
                          />
                        </View>

                        {/* Delete Row Icon */}
                        <View style={{ width: 44, alignItems: 'center', justifyContent: 'center' }}>
                          <Pressable
                            onPress={() => removeSplitRow(row.id)}
                            disabled={splitRows.length <= 1}
                            style={{ opacity: splitRows.length <= 1 ? 0.3 : 1 }}
                          >
                            <Ionicons name="trash-outline" size={18} color="#DC2626" />
                          </Pressable>
                        </View>
                      </View>

                      {/* Bank & Ref Row if not cash */}
                      {!isCash && (
                        <View style={styles.splitExtraRow}>
                          {banks.length > 0 && (
                            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, flex: 2 }}>
                              {banks.map(b => (
                                <Pressable
                                  key={b.id}
                                  onPress={() => updateSplitRow(row.id, 'bank_account_id', b.id)}
                                  style={[styles.miniBankChip, row.bank_account_id === b.id && styles.miniBankChipActive]}
                                >
                                  <Text style={[styles.miniBankTxt, row.bank_account_id === b.id && { color: '#FFF' }]}>
                                    {b.name}
                                  </Text>
                                </Pressable>
                              ))}
                            </View>
                          )}
                          <TextInput
                            style={styles.splitRefInput}
                            placeholder="Reference / UTR / Cheque No."
                            placeholderTextColor="#94A3B8"
                            value={row.reference_no || ''}
                            onChangeText={v => updateSplitRow(row.id, 'reference_no', v)}
                          />
                        </View>
                      )}
                    </View>
                  );
                })}

                {/* Add Payment Type & Total Summary */}
                <View style={styles.splitFooter}>
                  <Pressable onPress={addSplitRow} style={styles.addPaymentTypeBtn}>
                    <Ionicons name="add-circle" size={18} color="#0D9488" />
                    <Text style={styles.addPaymentTypeTxt}>+ Add Payment type</Text>
                  </Pressable>

                  <View style={{ alignItems: 'flex-end', gap: 2 }}>
                    <Text style={styles.splitTotalLabel}>
                      Total payment: <Text style={styles.splitTotalVal}>{inr(totalSplit)}</Text>
                    </Text>

                    {/* Reconciliation Indicator */}
                    {Math.abs(splitDifference) < 0.05 && parseFloat(f.amount) > 0 ? (
                      <View style={styles.matchBadge}>
                        <Ionicons name="checkmark-circle" size={13} color="#059669" />
                        <Text style={styles.matchBadgeTxt}>Payment matches voucher amount</Text>
                      </View>
                    ) : splitDifference > 0 ? (
                      <Text style={{ fontSize: 11, color: '#D97706', fontWeight: '700' }}>
                        ⚠️ {inr(splitDifference)} remaining to allocate
                      </Text>
                    ) : splitDifference < 0 ? (
                      <Text style={{ fontSize: 11, color: '#DC2626', fontWeight: '700' }}>
                        ⚠️ Over-allocated by {inr(Math.abs(splitDifference))}
                      </Text>
                    ) : null}
                  </View>
                </View>
              </View>
            )}
          </View>

          {/* Vendor / Paid To */}
          <FormInput
            label={expenseMode === 'pass_on' ? 'Paid To / Authority / Department' : 'Vendor / Paid To'}
            placeholder={expenseMode === 'pass_on' ? 'e.g. Executive Engineer PWD, Bihar eProc2, SBI Portal' : 'Vendor / Payee Name'}
            value={f.vendor}
            onChangeText={set('vendor')}
            testID="in-vendor"
          />

          {/* Description */}
          <FormInput
            label="Description / Purpose"
            value={f.description}
            onChangeText={set('description')}
            multiline
            testID="in-desc"
          />

          {/* Attachments */}
          <AttachmentsSection
            attachments={attachments}
            onChange={setAttachments}
            title="Bill / Challan / Receipt Attachments"
            hint="EMD Receipt, BOQ Challan, Bank Debit Slip • Max 10 MB per file"
          />

          {err ? (
            <View style={styles.errorAlert}>
              <Ionicons name="alert-circle" size={18} color="#DC2626" />
              <Text style={styles.errorAlertTxt}>{err}</Text>
            </View>
          ) : null}

          <Text style={{ color: colors.muted, fontSize: font.sm, textAlign: 'center' }}>
            Expense will be marked as Pending. Accounts/Admin can verify & approve later.
          </Text>

          <PrimaryButton
            label={busy ? 'Saving...' : isOverLimit ? 'Cannot Book (Exceeds Balance)' : 'Save Expense'}
            onPress={save}
            loading={busy}
            disabled={isOverLimit || busy}
            testID="save-btn"
          />
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Customer Picker Modal */}
      {showPartyPick && (
        <CustomerSearchModal
          visible={showPartyPick}
          onClose={() => setShowPartyPick(false)}
          onPick={(party) => {
            setShowPartyPick(false);
            handleSelectCustomer(party);
          }}
          title="Select Customer / Party"
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { color: colors.muted, fontSize: font.sm, fontWeight: '600' },
  sectionLabel: { color: '#334155', fontSize: font.sm, fontWeight: '700' },

  // Mode Switcher
  modeContainer: {
    flexDirection: 'column',
    gap: 8,
  },
  modeTab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: spacing.md,
    backgroundColor: '#FFF',
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
  },
  modeTabActivePassOn: {
    borderColor: '#0D9488',
    backgroundColor: '#F0FDFA',
  },
  modeTabActiveGeneral: {
    borderColor: colors.brandPrimary,
    backgroundColor: '#EFF6FF',
  },
  modeTitle: { fontSize: font.base, fontWeight: '700', color: '#1E293B' },
  modeSub: { fontSize: font.xs, color: colors.muted, marginTop: 2 },

  // Pass-on Box
  passOnBox: {
    backgroundColor: '#FFF',
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#CCFBF1',
    gap: spacing.md,
  },
  boxHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F0FDFA',
    paddingBottom: 8,
  },
  boxTitle: { fontSize: font.sm, fontWeight: '800', color: '#0F766E' },

  // Customer Selector Card
  customerSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: spacing.md,
    backgroundColor: '#F8FAFC',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  avatar: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  customerName: { fontSize: font.base, fontWeight: '700', color: '#0F172A' },
  customerSub: { fontSize: font.xs, color: '#64748B', marginTop: 2 },
  chooseBadge: {
    backgroundColor: '#0D9488',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
  },
  chooseBadgeTxt: { color: '#FFF', fontSize: font.xs, fontWeight: '700' },

  // Sale Invoices Carousel
  invoiceChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: '#CCFBF1',
    backgroundColor: '#F0FDFA',
  },
  invoiceChipActive: {
    backgroundColor: '#0D9488',
    borderColor: '#0D9488',
  },
  invoiceChipNo: { fontSize: font.sm, fontWeight: '800', color: '#0F766E' },
  invoiceChipMeta: { fontSize: 10, color: '#115E59', marginTop: 1 },

  // Pass-on Items Table
  tableContainer: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  tableHeaderRow: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  thCell: { fontSize: 11, fontWeight: '800', color: '#475569' },
  tableDataRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    backgroundColor: '#FFF',
  },
  tableDataRowChosen: {
    backgroundColor: '#F0FDFA',
    borderLeftWidth: 3,
    borderLeftColor: '#0D9488',
  },
  tdName: { fontSize: font.sm, fontWeight: '700', color: '#0F172A' },
  tdFeeType: { fontSize: 10, color: '#64748B' },
  tdAmt: { fontSize: font.sm, color: '#334155' },

  // Selected Item Highlight
  selectedItemBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#CCFBF1',
    padding: 10,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#99F6E4',
  },
  selectedItemBannerTxt: { color: '#0F766E', fontSize: font.sm },

  // Alerts & Validation
  alertBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FEF3C7',
    padding: 10,
    borderRadius: radius.md,
  },
  alertTxt: { flex: 1, fontSize: font.xs, color: '#92400E' },
  validationErrorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FEE2E2',
    padding: 10,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#F87171',
    marginTop: 4,
  },
  validationErrorTxt: { flex: 1, fontSize: font.xs, color: '#DC2626', fontWeight: '700' },
  errorAlert: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FEE2E2',
    padding: 12,
    borderRadius: radius.md,
  },
  errorAlertTxt: { flex: 1, color: '#DC2626', fontSize: font.sm, fontWeight: '600' },

  // General Chips
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurface, fontWeight: '600', fontSize: font.sm },

  // Scope Tabs
  scopeTabs: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: '#F1F5F9',
    padding: 4,
    borderRadius: radius.md,
  },
  scopeTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    borderRadius: radius.sm,
  },
  scopeTabActive: {
    backgroundColor: '#0D9488',
    elevation: 1,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 2,
  },
  scopeTabTxt: { fontSize: 12, fontWeight: '700', color: '#475569' },
  scopeTabTxtActive: { color: '#FFF' },

  // Whole Voucher Summary Card
  voucherSummaryCard: {
    backgroundColor: '#F0FDFA',
    borderWidth: 1.5,
    borderColor: '#99F6E4',
    borderRadius: radius.md,
    padding: 12,
  },
  voucherSummaryTitle: { fontSize: 12, fontWeight: '900', color: '#0F766E', letterSpacing: 0.5 },
  summaryStatsRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  statBox: {
    flex: 1,
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: radius.sm,
    padding: 8,
    alignItems: 'center',
  },
  statLbl: { fontSize: 10, color: '#64748B', fontWeight: '600', textTransform: 'uppercase' },
  statVal: { fontSize: font.sm, fontWeight: '800', color: '#0F172A', marginTop: 2 },

  // Payment Section & Split Payment Card
  paySectionCard: {
    backgroundColor: '#FFF',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
  },
  paySectionHead: { fontSize: 12, fontWeight: '900', letterSpacing: 0.5, color: '#1E293B' },
  splitBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 10,
    gap: 10,
  },
  splitHeaderRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    paddingBottom: 6,
  },
  splitHeadTh: { fontSize: 11, fontWeight: '800', color: '#64748B' },
  splitRowWrapper: {
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: radius.sm,
    padding: 8,
    gap: 8,
  },
  splitRowInputs: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  modePickerContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  miniModeBtn: {
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 4,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  miniModeBtnActive: {
    backgroundColor: '#0D9488',
    borderColor: '#0D9488',
  },
  miniModeTxt: { fontSize: 10, fontWeight: '700', color: '#475569' },
  miniModeTxtActive: { color: '#FFF' },
  splitAmtInput: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 6,
    fontSize: font.sm,
    fontWeight: '700',
    color: '#0F172A',
    backgroundColor: '#FFF',
  },
  splitExtraRow: {
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingTop: 6,
    gap: 6,
  },
  miniBankChip: {
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 4,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  miniBankChipActive: {
    backgroundColor: '#4338CA',
    borderColor: '#4338CA',
  },
  miniBankTxt: { fontSize: 10, fontWeight: '600', color: '#475569' },
  splitRefInput: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 4,
    fontSize: 11,
    color: '#0F172A',
    backgroundColor: '#F8FAFC',
  },
  splitFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    paddingTop: 8,
  },
  addPaymentTypeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  addPaymentTypeTxt: { color: '#0D9488', fontWeight: '800', fontSize: 12 },
  splitTotalLabel: { fontSize: 12, fontWeight: '600', color: '#64748B' },
  splitTotalVal: { fontSize: font.base, fontWeight: '900', color: '#0F172A' },
  matchBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  matchBadgeTxt: { fontSize: 10, fontWeight: '700', color: '#059669' },
});
