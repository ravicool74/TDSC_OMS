import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, KeyboardAvoidingView, Platform,
  Pressable, ActivityIndicator, Alert
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
  const [selectedPassOnItem, setSelectedPassOnItem] = useState<InvoicePassOnItem | null>(null);

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

  // When invoice changes, load its passed-on items
  const handleSelectInvoice = async (inv: any) => {
    setSelectedInvoice(inv);
    setSelectedPassOnItem(null);
    setLoadingPassOnItems(true);
    try {
      const res = await api.get<any>(`/invoices/${inv.id}/passed-on-items`);
      const items = res?.passed_on_items || [];
      setPassOnItems(items);
      // Auto-select first item with remaining balance > 0
      const avail = items.find((x: InvoicePassOnItem) => x.remaining_balance > 0) || items[0];
      if (avail) {
        handlePickPassOnItem(avail);
      }
    } catch {
      setPassOnItems([]);
    } finally {
      setLoadingPassOnItems(false);
    }
  };

  // When pass-on item is picked from table
  const handlePickPassOnItem = (it: InvoicePassOnItem) => {
    setSelectedPassOnItem(it);
    setF(p => ({
      ...p,
      category: `${it.name} Expense`,
      description: `Disbursement of client pass-on funds for ${it.name} against Voucher ${selectedInvoice?.invoice_no || ''}`,
    }));
  };

  // Live balance validation
  const amtNum = parseFloat(f.amount) || 0;
  const isOverLimit =
    expenseMode === 'pass_on' &&
    selectedPassOnItem &&
    amtNum > selectedPassOnItem.remaining_balance;

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
      if (!selectedPassOnItem) {
        setErr('Please select a Passed On Money item from the table');
        return;
      }
      if (amt > selectedPassOnItem.remaining_balance) {
        setErr(
          `Expense amount ₹${amt.toLocaleString('en-IN', { minimumFractionDigits: 2 })} exceeds available Passed On Money balance ₹${selectedPassOnItem.remaining_balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })} for "${selectedPassOnItem.name}".`
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
      const payload: any = {
        date: f.date,
        category: f.category || (selectedPassOnItem ? `${selectedPassOnItem.name} Expense` : 'Operating Expense'),
        amount: amt,
        payment_mode: f.payment_mode,
        bank_account_id: f.payment_mode !== 'cash' ? (f.bank_account_id || null) : null,
        vendor: f.vendor || null,
        description: f.description || null,
      };

      if (expenseMode === 'pass_on' && selectedInvoice && selectedPassOnItem) {
        payload.customer_id = selectedParty?.id;
        payload.customer_name = selectedParty?.name;
        payload.customer_mobile = selectedParty?.mobile;
        payload.sale_invoice_id = selectedInvoice.id;
        payload.sale_invoice_no = selectedInvoice.invoice_no;
        payload.sale_invoice_date = selectedInvoice.date;
        payload.sale_item_name = selectedPassOnItem.name;
        payload.pass_on_item_type = 'passed_on_money';
        payload.pass_on_received_amount = selectedPassOnItem.billed_amount;
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

              {/* 3. Column and Multiple Rows Table of Passed On Money Items */}
              {selectedInvoice && (
                <View style={{ gap: 6, marginTop: 8 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={styles.sectionLabel}>
                      3. Passed On Money Items in Voucher ({passOnItems.length}) *
                    </Text>
                    <Text style={{ fontSize: 11, color: colors.muted }}>Select item to book against</Text>
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
                    <View style={styles.tableContainer}>
                      {/* Table Header */}
                      <View style={styles.tableHeaderRow}>
                        <Text style={[styles.thCell, { flex: 2 }]}>Fee Item Name</Text>
                        <Text style={[styles.thCell, { flex: 1.5, textAlign: 'right' }]}>Received</Text>
                        <Text style={[styles.thCell, { flex: 1.5, textAlign: 'right' }]}>Spent</Text>
                        <Text style={[styles.thCell, { flex: 1.5, textAlign: 'right' }]}>Balance</Text>
                        <Text style={[styles.thCell, { width: 60, textAlign: 'center' }]}>Select</Text>
                      </View>

                      {/* Multiple Rows */}
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
                              ₹{it.billed_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                            </Text>
                            <Text style={[styles.tdAmt, { flex: 1.5, textAlign: 'right', color: '#DC2626' }]}>
                              ₹{it.already_spent.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                            </Text>
                            <Text
                              style={[
                                styles.tdAmt,
                                { flex: 1.5, textAlign: 'right', fontWeight: '800' },
                                isZero ? { color: '#94A3B8' } : { color: '#059669' },
                              ]}
                            >
                              ₹{it.remaining_balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                            </Text>
                            <View style={{ width: 60, alignItems: 'center' }}>
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

                  {/* Active selected item highlight card */}
                  {selectedPassOnItem && (
                    <View style={styles.selectedItemBanner}>
                      <Ionicons name="checkmark-done-circle" size={20} color="#0D9488" />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.selectedItemBannerTxt}>
                          Booking against: <Text style={{ fontWeight: '800' }}>{selectedPassOnItem.name}</Text>
                        </Text>
                        <Text style={{ fontSize: 11, color: '#0F766E' }}>
                          Available Balance: <Text style={{ fontWeight: '800' }}>₹{selectedPassOnItem.remaining_balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</Text> (Max allowed)
                        </Text>
                      </View>
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
});
