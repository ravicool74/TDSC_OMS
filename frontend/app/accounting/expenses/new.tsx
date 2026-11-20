import React, { useEffect, useState, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, KeyboardAvoidingView, Platform,
  Pressable, ActivityIndicator, Alert, TextInput, Modal
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, font, shadow } from '@/src/theme';
import { ScreenHeader } from '@/src/ScreenHeader';
import { FormInput, OptionRow } from '@/src/forms';
import { PrimaryButton } from '@/src/ui';
import { api } from '@/src/api';
import { useAuth } from '@/src/AuthContext';
import { AttachmentsSection, Attachment } from '@/src/AttachmentsSection';
import { CustomerSearchModal, PickedParty } from '@/src/CustomerSearchModal';

const today = () => new Date().toISOString().slice(0, 10);

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

  const [loadingPassOnItems, setLoadingPassOnItems] = useState(false);
  const [passOnItems, setPassOnItems] = useState<InvoicePassOnItem[]>([]);
  const [selectedPassOnItems, setSelectedPassOnItems] = useState<InvoicePassOnItem[]>([]);

  // Itemwise editable spent amount: { [itemName]: "amountString" }
  const [itemSpentAmounts, setItemSpentAmounts] = useState<Record<string, string>>({});

  // Computed totals for selected pass-on items
  const totalSelectedReceived = useMemo(
    () => selectedPassOnItems.reduce((sum, it) => sum + (it.billed_amount || 0), 0),
    [selectedPassOnItems]
  );
  const totalSelectedPrevSpent = useMemo(
    () => selectedPassOnItems.reduce((sum, it) => sum + (it.already_spent || 0), 0),
    [selectedPassOnItems]
  );
  const totalSelectedBalance = useMemo(
    () => selectedPassOnItems.reduce((sum, it) => sum + (it.remaining_balance || 0), 0),
    [selectedPassOnItems]
  );

  // Live item-wise spent sum currently entered by user
  const totalSelectedSpentNow = useMemo(() => {
    return selectedPassOnItems.reduce((sum, it) => {
      const val = parseFloat(itemSpentAmounts[it.name] ?? String(it.remaining_balance || 0)) || 0;
      return sum + val;
    }, 0);
  }, [selectedPassOnItems, itemSpentAmounts]);

  // Check if any selected item exceeds its individual balance
  const anyItemExceedsBalance = useMemo(() => {
    return selectedPassOnItems.some(it => {
      const val = parseFloat(itemSpentAmounts[it.name] ?? String(it.remaining_balance || 0)) || 0;
      return val > (it.remaining_balance || 0);
    });
  }, [selectedPassOnItems, itemSpentAmounts]);

  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';
  const [showAddCatModal, setShowAddCatModal] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [savingCat, setSavingCat] = useState(false);
  const [meta, setMeta] = useState<any>({ expense_categories: [], payment_modes: ['cash', 'bank', 'upi', 'cheque'] });
  const [banks, setBanks] = useState<any[]>([]);
  const [f, setF] = useState({
    date: today(),
    category: '',
    amount: '',
    payment_mode: 'bank',
    bank_account_id: '',
    vendor: '',
    description: '',
  });
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const set = (k: string) => (v: string) => setF(p => ({ ...p, [k]: v }));

  // Add Bank Account modal state
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
      setF(p => ({ ...p, bank_account_id: created.id }));
      setShowAddBankModal(false);
      setNewBankForm({ name: '', bank_name: '', account_no: '', ifsc: '', opening_balance: '0' });
    } catch (e: any) {
      setBankSaveErr(e?.message || 'Failed to save bank account');
    } finally {
      setSavingNewBank(false);
    }
  };

  useEffect(() => {
    (async () => {
      try {
        const [m, b] = await Promise.all([
          api.get<any>('/accounting/meta'),
          api.get<any[]>('/bank-accounts'),
        ]);
        setMeta(m);
        setBanks(b);
        const sbi = (b || []).find((x: any) => String(x.account_no || '').includes('42137607814') || (x.name || '').toUpperCase().includes('TRIVENI'));
        const defaultBankId = sbi?.id || b?.[0]?.id || '';
        setF(p => ({
          ...p,
          bank_account_id: p.bank_account_id || defaultBankId,
          ...(m.expense_categories?.[0] ? { category: m.expense_categories[0] } : {})
        }));
      } catch {}
    })();
  }, []);

  // When customer changes, load customer's sale invoices
  const handleSelectCustomer = async (party: PickedParty) => {
    setSelectedParty(party);
    setSelectedInvoice(null);
    setPassOnItems([]);
    setSelectedPassOnItems([]);
    setItemSpentAmounts({});
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

  // When invoice changes, load its passed-on items
  const handleSelectInvoice = async (inv: any) => {
    setSelectedInvoice(inv);
    setSelectedPassOnItems([]);
    setItemSpentAmounts({});
    setLoadingPassOnItems(true);
    try {
      const res = await api.get<any>(`/invoices/${inv.id}/passed-on-items`);
      const items = res?.passed_on_items || [];
      setPassOnItems(items);
      // Auto-select all available items with balance > 0
      const avail = items.filter((x: InvoicePassOnItem) => x.remaining_balance > 0);
      if (avail.length > 0) {
        setSelectedPassOnItems(avail);
        const initSpent: Record<string, string> = {};
        avail.forEach((x: InvoicePassOnItem) => {
          initSpent[x.name] = String(x.remaining_balance || 0);
        });
        setItemSpentAmounts(initSpent);
        const sumBal = avail.reduce((sum: number, x: InvoicePassOnItem) => sum + (x.remaining_balance || 0), 0);
        setF(p => ({
          ...p,
          amount: String(sumBal),
          category: avail.length === 1 ? `${avail[0].name} Expense` : `Pass-on Expense (${avail.length} Items)`,
          description: `Disbursement of client pass-on funds for ${avail.map((x: InvoicePassOnItem) => x.name).join(', ')} against Voucher ${inv.invoice_no || ''}`,
        }));
      }
    } catch {
      setPassOnItems([]);
    } finally {
      setLoadingPassOnItems(false);
    }
  };

  // Handle live edit of spent amount for a specific item
  const handleItemSpentChange = (itemName: string, val: string) => {
    const clean = val.replace(/[^0-9.]/g, '');
    setItemSpentAmounts(prev => {
      const next = { ...prev, [itemName]: clean };
      // Recalculate total spent from all currently selected items
      const newTotal = selectedPassOnItems.reduce((sum, it) => {
        const itVal = it.name === itemName ? clean : (next[it.name] ?? String(it.remaining_balance || 0));
        return sum + (parseFloat(itVal) || 0);
      }, 0);
      setF(p => ({
        ...p,
        amount: newTotal > 0 ? String(newTotal) : '',
      }));
      return next;
    });
  };

  // Toggle single item in/out of selection
  const handleTogglePassOnItem = (it: InvoicePassOnItem) => {
    if (it.remaining_balance <= 0) return;
    setSelectedPassOnItems(prev => {
      const exists = prev.some(x => x.name === it.name);
      const next = exists ? prev.filter(x => x.name !== it.name) : [...prev, it];
      
      let nextSpent = { ...itemSpentAmounts };
      if (!exists && (!nextSpent[it.name] || parseFloat(nextSpent[it.name]) <= 0)) {
        nextSpent[it.name] = String(it.remaining_balance);
        setItemSpentAmounts(nextSpent);
      }

      const sumSpent = next.reduce((sum, x) => {
        const val = parseFloat(nextSpent[x.name] ?? String(x.remaining_balance || 0)) || 0;
        return sum + val;
      }, 0);

      setF(p => ({
        ...p,
        amount: sumSpent > 0 ? String(sumSpent) : '',
        category: next.length === 1 ? `${next[0].name} Expense` : next.length > 1 ? `Pass-on Expense (${next.length} Items)` : '',
        description: next.length > 0
          ? `Disbursement of client pass-on funds for ${next.map(x => x.name).join(', ')} against Voucher ${selectedInvoice?.invoice_no || ''}`
          : '',
      }));
      return next;
    });
  };

  // Toggle Select All
  const handleToggleSelectAll = () => {
    const eligible = passOnItems.filter(x => x.remaining_balance > 0);
    if (eligible.length === 0) return;
    const allSelected = eligible.every(it => selectedPassOnItems.some(x => x.name === it.name));
    if (allSelected) {
      setSelectedPassOnItems([]);
      setF(p => ({ ...p, amount: '', category: '', description: '' }));
    } else {
      setSelectedPassOnItems(eligible);
      const nextSpent: Record<string, string> = { ...itemSpentAmounts };
      eligible.forEach(x => {
        if (!nextSpent[x.name] || parseFloat(nextSpent[x.name]) <= 0) {
          nextSpent[x.name] = String(x.remaining_balance);
        }
      });
      setItemSpentAmounts(nextSpent);
      const sumSpent = eligible.reduce((sum, x) => sum + (parseFloat(nextSpent[x.name] ?? String(x.remaining_balance || 0)) || 0), 0);
      setF(p => ({
        ...p,
        amount: String(sumSpent),
        category: eligible.length === 1 ? `${eligible[0].name} Expense` : `Pass-on Expense (${eligible.length} Items)`,
        description: `Disbursement of client pass-on funds for ${eligible.map(x => x.name).join(', ')} against Voucher ${selectedInvoice?.invoice_no || ''}`,
      }));
    }
  };

  // Live balance validation
  const amtNum = parseFloat(f.amount) || 0;
  const isOverLimit =
    expenseMode === 'pass_on' &&
    (anyItemExceedsBalance || (selectedPassOnItems.length > 0 && amtNum > totalSelectedBalance));

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
      if (selectedPassOnItems.length === 0) {
        setErr('Please select at least one Passed On Money item from the table');
        return;
      }
      if (anyItemExceedsBalance) {
        setErr('One or more selected items have a spent amount exceeding their available balance.');
        return;
      }
      if (amt > totalSelectedBalance) {
        setErr(
          `Expense amount ₹${amt.toLocaleString('en-IN', { minimumFractionDigits: 2 })} exceeds available combined Passed On Money balance ₹${totalSelectedBalance.toLocaleString('en-IN', { minimumFractionDigits: 2 })} for selected items.`
        );
        return;
      }
    } else {
      if (!f.category) {
        setErr('Expense category required');
        return;
      }
    }

    setErr(null);
    setBusy(true);
    try {
      const chosenBank = banks.find(b => b.id === f.bank_account_id) || banks[0];
      const payload: any = {
        date: f.date,
        category: f.category || (selectedPassOnItems.length === 1 ? `${selectedPassOnItems[0].name} Expense` : 'Pass-on Expense'),
        amount: amt,
        payment_mode: f.payment_mode,
        bank_account_id: f.payment_mode !== 'cash' ? (chosenBank?.id || null) : null,
        bank_id: f.payment_mode !== 'cash' ? (chosenBank?.id || null) : null,
        bank_name: f.payment_mode !== 'cash' ? (chosenBank?.bank_name || chosenBank?.name || null) : null,
        account_no: f.payment_mode !== 'cash' ? (chosenBank?.account_no || null) : null,
        vendor: f.vendor || null,
        description: f.description || null,
      };

      if (expenseMode === 'pass_on' && selectedInvoice && selectedPassOnItems.length > 0) {
        payload.customer_id = selectedParty?.id;
        payload.customer_name = selectedParty?.name;
        payload.customer_mobile = selectedParty?.mobile;
        payload.sale_invoice_id = selectedInvoice.id;
        payload.sale_invoice_no = selectedInvoice.invoice_no;
        payload.sale_invoice_date = selectedInvoice.date;
        payload.sale_item_names = selectedPassOnItems.map(x => x.name);
        payload.sale_item_name = selectedPassOnItems.map(x => x.name).join(', ');
        payload.pass_on_item_type = 'passed_on_money';
        payload.pass_on_received_amount = totalSelectedReceived;
        payload.amount = amt;
        payload.selected_items = selectedPassOnItems.map(x => {
          const sAmt = parseFloat(itemSpentAmounts[x.name] ?? String(x.remaining_balance || 0)) || 0;
          return {
            name: x.name,
            fee_type: x.fee_type,
            billed_amount: x.billed_amount,
            already_spent: x.already_spent,
            remaining_balance: x.remaining_balance,
            spent_amount: sAmt,
            amount: sAmt,
          };
        });
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
        window.alert(`Expense ${created.expense_no || ''} saved and forwarded for approval successfully!`);
      } else {
        Alert.alert('Success', `Expense ${created.expense_no || ''} saved and forwarded for approval successfully!`);
      }
      const targetApprovalId = created.linked_approval_id || created.linked_voucher_no;
      if (targetApprovalId) {
        router.replace(`/accounting/expenses/approval/${targetApprovalId}` as any);
      } else {
        router.replace('/accounting/expenses/approval' as any);
      }
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

              {/* 3. Column and Multiple Rows Table of Passed On Money Items */}
              {selectedInvoice && (
                <View style={{ gap: 6, marginTop: 8 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={styles.sectionLabel}>
                      3. Passed On Money Items in Voucher ({passOnItems.length}) *
                    </Text>
                    <Text style={{ fontSize: 11, color: colors.muted }}>
                      Multi-select items (1 by 1 or All together)
                    </Text>
                  </View>

                  {loadingPassOnItems ? (
                    <ActivityIndicator color="#0D9488" style={{ marginVertical: 12 }} />
                  ) : passOnItems.length === 0 ? (
                    <View style={styles.alertBox}>
                      <Ionicons name="alert-circle-outline" size={18} color="#DC2626" />
                      <Text style={[styles.alertTxt, { color: '#DC2626' }]}>
                        No Passed On Money items (EMD, Cost of BOQ, Tender Fee, etc.) exist in Sale Voucher {selectedInvoice.invoice_no}.
                      </Text>
                    </View>
                  ) : (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ minWidth: '100%' }}>
                      <View style={[styles.tableContainer, { minWidth: 640, flex: 1 }]}>
                        {/* Table Header with Select All */}
                        <View style={styles.tableHeaderRow}>
                          <Text style={[styles.thCell, { flex: 2.2, minWidth: 150 }]}>Fee Item Name</Text>
                          <Text style={[styles.thCell, { flex: 1.1, minWidth: 90, textAlign: 'right', paddingRight: 12 }]}>Received</Text>
                          <Text style={[styles.thCell, { flex: 1.1, minWidth: 90, textAlign: 'right', paddingRight: 12 }]}>Balance</Text>
                          <View style={{ width: 145, alignItems: 'flex-end', paddingRight: 12 }}>
                            <Text style={[styles.thCellTxt, { fontSize: 11, fontWeight: '800', color: '#0F766E' }]}>
                              Spent (₹) * ✏️
                            </Text>
                          </View>
                          <Pressable
                            onPress={handleToggleSelectAll}
                            style={{ width: 60, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 }}
                            hitSlop={6}
                          >
                            <Text style={[styles.thCellTxt, { fontSize: 11, fontWeight: '800', color: '#0F766E' }]}>All</Text>
                            <Ionicons
                              name={
                                passOnItems.filter(x => x.remaining_balance > 0).length > 0 &&
                                passOnItems.filter(x => x.remaining_balance > 0).every(it => selectedPassOnItems.some(x => x.name === it.name))
                                  ? 'checkbox'
                                  : selectedPassOnItems.length > 0
                                    ? 'remove-circle-outline'
                                    : 'square-outline'
                              }
                              size={16}
                              color="#0D9488"
                            />
                          </Pressable>
                        </View>

                        {/* Multiple Rows */}
                        {passOnItems.map(it => {
                          const isChosen = selectedPassOnItems.some(x => x.name === it.name);
                          const isZero = it.remaining_balance <= 0;
                          const currentSpentStr = itemSpentAmounts[it.name] ?? (isChosen ? String(it.remaining_balance) : '0');
                          const currentSpentVal = parseFloat(currentSpentStr) || 0;
                          const isItemOver = isChosen && currentSpentVal > it.remaining_balance;

                          return (
                            <View
                              key={it.name}
                              testID={`row-passon-${it.name}`}
                              style={[
                                styles.tableDataRow,
                                isChosen && styles.tableDataRowChosen,
                                isZero && { opacity: 0.6, backgroundColor: '#F8FAFC' },
                              ]}
                            >
                              <Pressable
                                onPress={() => !isZero && handleTogglePassOnItem(it)}
                                style={{ flex: 2.2, minWidth: 150 }}
                              >
                                <Text style={[styles.tdName, isChosen && { color: '#0D9488', fontWeight: '800' }]}>{it.name}</Text>
                                <Text style={styles.tdFeeType}>{it.fee_type || 'Reimbursement'}</Text>
                                {it.already_spent > 0 ? (
                                  <Text style={{ fontSize: 10, color: '#DC2626' }}>
                                    Prev Spent: ₹{it.already_spent.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                                  </Text>
                                ) : null}
                              </Pressable>

                              <Text style={[styles.tdAmt, { flex: 1.1, minWidth: 90, textAlign: 'right', paddingRight: 12 }]}>
                                ₹{it.billed_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                              </Text>

                              <Text
                                style={[
                                  styles.tdAmt,
                                  { flex: 1.1, minWidth: 90, textAlign: 'right', paddingRight: 12, fontWeight: '800' },
                                  isZero ? { color: '#94A3B8' } : { color: '#059669' },
                                ]}
                              >
                                ₹{it.remaining_balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                              </Text>

                              {/* Editable Spent Amount Input Box */}
                              <View style={{ width: 145, alignItems: 'flex-end', justifyContent: 'center', paddingRight: 12 }}>
                                <View
                                  style={[
                                    styles.spentInputContainer,
                                    isChosen && styles.spentInputContainerActive,
                                    isItemOver && styles.spentInputContainerError,
                                    !isChosen && { opacity: 0.45, backgroundColor: '#F1F5F9' },
                                  ]}
                                >
                                  <Text style={[styles.rupeePrefix, isChosen && { color: '#0D9488' }]}>₹</Text>
                                  <TextInput
                                    value={isChosen ? currentSpentStr : ''}
                                    onChangeText={(val: string) => handleItemSpentChange(it.name, val)}
                                    keyboardType="numeric"
                                    editable={isChosen && !isZero}
                                    placeholder={isChosen ? '0.00' : '—'}
                                    placeholderTextColor="#94A3B8"
                                    style={[
                                      styles.spentTextInput,
                                      isItemOver && { color: '#DC2626', fontWeight: '800' },
                                    ]}
                                    testID={`input-spent-${it.name}`}
                                  />
                                </View>
                                {isChosen && isItemOver ? (
                                  <Text style={styles.overLimitTxt}>
                                    Max: ₹{it.remaining_balance.toLocaleString('en-IN')}
                                  </Text>
                                ) : null}
                              </View>

                              <Pressable
                                onPress={() => !isZero && handleTogglePassOnItem(it)}
                                style={{ width: 60, alignItems: 'center', justifyContent: 'center' }}
                                hitSlop={8}
                              >
                                <Ionicons
                                  name={isChosen ? 'checkbox' : isZero ? 'close-circle-outline' : 'square-outline'}
                                  size={22}
                                  color={isChosen ? '#0D9488' : isZero ? '#94A3B8' : colors.muted}
                                />
                              </Pressable>
                            </View>
                          );
                        })}

                        {/* Jod kar Total Row (Dedicated Total Row in Table) */}
                        <View style={styles.tableTotalRow}>
                          <View style={{ flex: 2.2, minWidth: 150 }}>
                            <Text style={styles.tableTotalLabel}>
                              Total ({selectedPassOnItems.length}/{passOnItems.length} Selected)
                            </Text>
                            <Text style={styles.tableTotalSub}>Jod kar Total Spent</Text>
                          </View>
                          <Text style={[styles.tableTotalVal, { flex: 1.1, minWidth: 90, textAlign: 'right', paddingRight: 12, color: '#0F172A' }]}>
                            ₹{totalSelectedReceived.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                          </Text>
                          <Text style={[styles.tableTotalVal, { flex: 1.1, minWidth: 90, textAlign: 'right', paddingRight: 12, color: '#059669' }]}>
                            ₹{totalSelectedBalance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                          </Text>
                          <View style={{ width: 145, alignItems: 'flex-end', paddingRight: 12 }}>
                            <Text style={[styles.tableTotalVal, { color: '#0D9488', fontSize: 13, fontWeight: '900' }]}>
                              ₹{totalSelectedSpentNow.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                            </Text>
                            <Text style={{ fontSize: 9, color: '#0F766E', fontWeight: '700' }}>Auto-calculated</Text>
                          </View>
                          <View style={{ width: 60, alignItems: 'center', justifyContent: 'center' }}>
                            <View style={styles.totalBadge}>
                              <Text style={styles.totalBadgeTxt}>{selectedPassOnItems.length}</Text>
                            </View>
                          </View>
                        </View>
                      </View>
                    </ScrollView>
                  )}

                  {/* Active selected item highlight card */}
                  {selectedPassOnItems.length > 0 ? (
                    <View style={styles.selectedItemBanner}>
                      <Ionicons name="checkmark-done-circle" size={22} color="#0D9488" />
                      <View style={{ flex: 1, gap: 4 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                          <Text style={styles.selectedItemBannerTxt}>
                            Booking against: <Text style={{ fontWeight: '800' }}>{selectedPassOnItems.length} Item{selectedPassOnItems.length > 1 ? 's' : ''}</Text>
                          </Text>
                          <Text style={{ fontSize: 11, fontWeight: '800', color: '#0F766E' }}>
                            Total Spent: ₹{totalSelectedSpentNow.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                          </Text>
                        </View>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 }}>
                          {selectedPassOnItems.map(it => {
                            const itVal = parseFloat(itemSpentAmounts[it.name] ?? String(it.remaining_balance || 0)) || 0;
                            return (
                              <View key={it.name} style={styles.selectedPill}>
                                <Text style={styles.selectedPillTxt}>
                                  {it.name}: Spent <Text style={{ fontWeight: '800' }}>₹{itVal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</Text>
                                  <Text style={{ fontSize: 10, color: colors.muted }}> (Max: ₹{it.remaining_balance.toLocaleString('en-IN')})</Text>
                                </Text>
                              </View>
                            );
                          })}
                        </View>
                        <Text style={{ fontSize: 11, color: '#0F766E', marginTop: 2 }}>
                          💡 Itemwise spent amounts are auto-summed and forwarded for Expense Approval.
                        </Text>
                      </View>
                    </View>
                  ) : (
                    <View style={styles.noSelectionBanner}>
                      <Ionicons name="information-circle-outline" size={18} color="#D97706" />
                      <Text style={{ fontSize: 12, color: '#B45309', flex: 1 }}>
                        Please select one or more Passed On Money items from the table above to book expense approval against.
                      </Text>
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
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={styles.label}>Expense Category *</Text>
                {isAdmin && (
                  <Pressable
                    onPress={() => setShowAddCatModal(true)}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4, backgroundColor: '#EFF6FF', borderWidth: 1, borderColor: '#BFDBFE' }}
                  >
                    <Ionicons name="add" size={14} color="#2563EB" />
                    <Text style={{ fontSize: 11, fontWeight: '800', color: '#2563EB' }}>+ Add Category</Text>
                  </Pressable>
                )}
              </View>
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
              label={`Amount (₹) * ${selectedPassOnItems.length > 0 ? `(Max: ₹${totalSelectedBalance.toLocaleString('en-IN', { minimumFractionDigits: 2 })})` : ''}`}
              value={f.amount}
              onChangeText={set('amount')}
              keyboardType="numeric"
              testID="in-amount"
            />
            {isOverLimit && (
              <View style={styles.validationErrorBox}>
                <Ionicons name="alert-circle" size={18} color="#DC2626" />
                <Text style={styles.validationErrorTxt}>
                  ⚠️ Expense amount (₹{amtNum.toLocaleString('en-IN', { minimumFractionDigits: 2 })}) exceeds available Passed On Money balance ₹{totalSelectedBalance.toLocaleString('en-IN', { minimumFractionDigits: 2 })} for selected items!
                </Text>
              </View>
            )}
          </View>

          {/* Payment Mode */}
          <OptionRow
            label="Payment Mode"
            options={meta.payment_modes || ['cash', 'bank', 'upi', 'cheque']}
            value={f.payment_mode}
            onChange={v => setF(p => ({ ...p, payment_mode: v }))}
            testID="mode"
          />

          {/* Bank Account Selection (if not cash) */}
          {f.payment_mode !== 'cash' && banks.length > 0 ? (
            <View style={{ gap: 6, marginVertical: 4 }}>
              <Text style={styles.label}>Bank Account</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                {banks.map(b => {
                  const isSelected = (f.bank_account_id || banks[0]?.id) === b.id;
                  const lbl = getBankShortLabel(b);
                  return (
                    <Pressable
                      key={b.id}
                      onPress={() => setF(p => ({ ...p, bank_account_id: b.id }))}
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

                <Pressable
                  onPress={() => setShowAddBankModal(true)}
                  style={styles.addBankBtn}
                  testID="btn-add-bank-account"
                >
                  <Ionicons name="add-circle" size={16} color="#2563EB" />
                  <Text style={styles.addBankTxt}>+ Add Account</Text>
                </Pressable>
              </View>
            </View>
          ) : null}

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
            Expense will be forwarded to the Expense Approval section for itemwise verification & approval.
          </Text>

          <PrimaryButton
            label={busy ? 'Saving & Forwarding...' : isOverLimit ? 'Cannot Book (Exceeds Balance)' : 'Save Expense and Forward for Approval'}
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

      {/* Modal: Add Custom Expense Category (Admin Only) */}
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
                      setMeta((p: any) => ({ ...p, expense_categories: res.categories }));
                    } else {
                      setMeta((p: any) => ({ ...p, expense_categories: [...(p.expense_categories || []), trimmed] }));
                    }
                    setF(p => ({ ...p, category: trimmed }));
                    setNewCatName('');
                    setShowAddCatModal(false);
                    Alert.alert('Category Added', `Expense category "${trimmed}" added successfully.`);
                  } catch (err: any) {
                    Alert.alert('Error', err?.message || 'Failed to add category');
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
          <Pressable style={styles.termsOverlay} onPress={() => setShowAddBankModal(false)}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ width: '100%', alignItems: 'center' }}>
              <Pressable style={styles.addBankModalBox} onPress={e => e.stopPropagation()}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <Text style={styles.modalTitle}>Add New Bank Account</Text>
                  <Pressable onPress={() => setShowAddBankModal(false)}>
                    <Ionicons name="close" size={20} color="#64748B" />
                  </Pressable>
                </View>
                <Text style={styles.modalSubtitle}>Create a new bank ledger for recording receipts & disbursements.</Text>

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
                      style={styles.modalInput}
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
                        style={styles.modalInput}
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
                        style={styles.modalInput}
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
                        style={styles.modalInput}
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
                        style={styles.modalInput}
                      />
                    </View>
                  </View>

                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                    <Pressable
                      onPress={() => setShowAddBankModal(false)}
                      style={styles.modalCancelBtn}
                    >
                      <Text style={styles.modalCancelBtnTxt}>Cancel</Text>
                    </Pressable>
                    <Pressable
                      onPress={handleSaveNewBank}
                      disabled={savingNewBank}
                      style={[styles.modalSaveBtn, savingNewBank && { opacity: 0.7 }]}
                    >
                      <Text style={styles.modalSaveBtnTxt}>{savingNewBank ? 'Saving...' : 'Save & Select Bank'}</Text>
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
  spentInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF',
    borderWidth: 1.5,
    borderColor: '#99F6E4',
    borderRadius: radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 2,
    width: 120,
    maxWidth: 120,
    height: 32,
    overflow: 'hidden',
  },
  spentInputContainerActive: {
    borderColor: '#0D9488',
    backgroundColor: '#F0FDFA',
  },
  spentInputContainerError: {
    borderColor: '#DC2626',
    backgroundColor: '#FEF2F2',
  },
  rupeePrefix: {
    fontSize: 12,
    fontWeight: '800',
    color: '#0D9488',
    marginRight: 4,
  },
  spentTextInput: {
    flex: 1,
    width: '100%',
    minWidth: 0,
    fontSize: font.sm,
    fontWeight: '800',
    color: '#0F172A',
    textAlign: 'right',
    padding: 0,
    margin: 0,
    height: 26,
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none', borderStyle: 'none' } as any) : {}),
  },
  overLimitTxt: {
    fontSize: 9,
    fontWeight: '700',
    color: '#DC2626',
    marginTop: 2,
    textAlign: 'right',
  },

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
  tableTotalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 10,
    backgroundColor: '#F0FDFA',
    borderTopWidth: 2,
    borderTopColor: '#0D9488',
  },
  tableTotalLabel: { fontSize: 11, fontWeight: '800', color: '#0F766E' },
  tableTotalSub: { fontSize: 9, color: '#14B8A6', fontWeight: '600' },
  tableTotalVal: { fontSize: font.sm, fontWeight: '800' },
  totalBadge: {
    backgroundColor: '#0D9488',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  totalBadgeTxt: { color: '#FFF', fontSize: 10, fontWeight: '800' },
  selectedPill: {
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#99F6E4',
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  selectedPillTxt: { fontSize: 11, color: '#0F766E' },
  noSelectionBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFFBEB',
    padding: 10,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  thCellTxt: { fontSize: 11, fontWeight: '800', color: '#475569' },

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

  // Bank Chips & Modal Styles
  bankChipBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
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
    paddingVertical: 7,
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
  termsOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.md,
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
  modalTitle: {
    fontSize: 16,
    fontWeight: '800',
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
