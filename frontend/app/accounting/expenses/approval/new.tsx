import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  ActivityIndicator,
  Modal,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, font } from '@/src/theme';
import { api } from '@/src/api';
import { notify } from '@/src/dialog';

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

interface ExpenseItem {
  id: string;
  head: string;
  description: string;
  qty: string;
  rate: string;
  amount: number;
}

export default function NewExpenseApprovalScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  // Contractor Selection (Section 1)
  const [customers, setCustomers] = useState<any[]>([]);
  const [showCustomerModal, setShowCustomerModal] = useState(false);
  const [customerSearch, setCustomerSearch] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<any | null>(null);

  // Linked Sale Voucher (Section 2)
  const [saleVouchers, setSaleVouchers] = useState<any[]>([]);
  const [loadingSaleVouchers, setLoadingSaleVouchers] = useState(false);
  const [selectedSaleVoucher, setSelectedSaleVoucher] = useState<any | null>(null);

  // Pass-on money items multi-selection
  const [passOnItems, setPassOnItems] = useState<any[]>([]);
  const [loadingPassOnItems, setLoadingPassOnItems] = useState(false);
  const [selectedPassOnNames, setSelectedPassOnNames] = useState<string[]>([]);

  // Line Items (Section 3)
  const [items, setItems] = useState<ExpenseItem[]>([
    { id: '1', head: 'Tender Fee', description: '', qty: '1', rate: '', amount: 0 },
  ]);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Load customer directory on mount
  useEffect(() => {
    (async () => {
      try {
        const custs = await api.get<any[]>('/customers');
        if (Array.isArray(custs)) setCustomers(custs);
      } catch {}
    })();
  }, []);

  // Fetch sale vouchers whenever contractor is picked
  useEffect(() => {
    if (!selectedCustomer) {
      setSaleVouchers([]);
      setSelectedSaleVoucher(null);
      setPassOnItems([]);
      setSelectedPassOnNames([]);
      return;
    }
    (async () => {
      setLoadingSaleVouchers(true);
      try {
        const svs = await api.getCustomerSaleVouchers(selectedCustomer.id);
        setSaleVouchers(Array.isArray(svs) ? svs : []);
      } catch {
        setSaleVouchers([]);
      } finally {
        setLoadingSaleVouchers(false);
      }
    })();
  }, [selectedCustomer]);

  // Handle selecting a sale voucher and loading its passed-on items
  const handleSelectSaleVoucher = async (sv: any) => {
    setSelectedSaleVoucher(sv);
    setPassOnItems([]);
    setSelectedPassOnNames([]);
    setLoadingPassOnItems(true);
    try {
      const res = await api.get<any>(`/invoices/${sv.sale_voucher_id}/passed-on-items`);
      const poiList = res?.passed_on_items || [];
      setPassOnItems(poiList);
      const avail = poiList.filter((x: any) => x.remaining_balance > 0);
      if (avail.length > 0) {
        setSelectedPassOnNames(avail.map((x: any) => x.name));
        setItems(
          avail.map((it: any, idx: number) => {
            const amt = it.remaining_balance > 0 ? it.remaining_balance : it.billed_amount;
            return {
              id: it.item_id || `poi_${idx}_${Date.now()}`,
              head: it.name || 'Tender Fee',
              description: `Disbursement of client pass-on funds for ${it.name} against Voucher ${sv.sale_voucher_no || ''}`,
              qty: '1',
              rate: String(amt || 0),
              amount: Number(amt || 0),
            };
          })
        );
      }
    } catch {
      setPassOnItems([]);
    } finally {
      setLoadingPassOnItems(false);
    }
  };

  const handleTogglePassOnItem = (it: any) => {
    if (it.remaining_balance <= 0) return;
    const isChosen = selectedPassOnNames.includes(it.name);
    const nextNames = isChosen
      ? selectedPassOnNames.filter(x => x !== it.name)
      : [...selectedPassOnNames, it.name];
    setSelectedPassOnNames(nextNames);

    const chosen = passOnItems.filter(x => nextNames.includes(x.name));
    if (chosen.length > 0) {
      setItems(
        chosen.map((poi: any, idx: number) => {
          const amt = poi.remaining_balance > 0 ? poi.remaining_balance : poi.billed_amount;
          return {
            id: poi.item_id || `poi_${idx}_${Date.now()}`,
            head: poi.name || 'Tender Fee',
            description: `Disbursement of client pass-on funds for ${poi.name} against Voucher ${selectedSaleVoucher?.sale_voucher_no || ''}`,
            qty: '1',
            rate: String(amt || 0),
            amount: Number(amt || 0),
          };
        })
      );
    }
  };

  const handleToggleSelectAllPassOn = () => {
    const avail = passOnItems.filter(x => x.remaining_balance > 0);
    if (selectedPassOnNames.length === avail.length) {
      setSelectedPassOnNames([]);
    } else {
      setSelectedPassOnNames(avail.map(x => x.name));
      setItems(
        avail.map((poi: any, idx: number) => {
          const amt = poi.remaining_balance > 0 ? poi.remaining_balance : poi.billed_amount;
          return {
            id: poi.item_id || `poi_${idx}_${Date.now()}`,
            head: poi.name || 'Tender Fee',
            description: `Disbursement of client pass-on funds for ${poi.name} against Voucher ${selectedSaleVoucher?.sale_voucher_no || ''}`,
            qty: '1',
            rate: String(amt || 0),
            amount: Number(amt || 0),
          };
        })
      );
    }
  };

  // Line item manipulation
  const updateItem = (id: string, field: keyof ExpenseItem, val: string) => {
    setItems(prev =>
      prev.map(it => {
        if (it.id !== id) return it;
        const next = { ...it, [field]: val };
        const q = parseFloat(field === 'qty' ? val : it.qty) || 0;
        const r = parseFloat(field === 'rate' ? val : it.rate) || 0;
        next.amount = Math.round(q * r * 100) / 100;
        return next;
      })
    );
  };

  const addItem = () => {
    setItems(prev => [
      ...prev,
      { id: Date.now().toString(), head: 'Processing Charge', description: '', qty: '1', rate: '', amount: 0 },
    ]);
  };

  const removeItem = (id: string) => {
    if (items.length <= 1) return;
    setItems(prev => prev.filter(it => it.id !== id));
  };

  // Calculations
  const totalExpenseAmount = useMemo(() => {
    return items.reduce((sum, it) => sum + (it.amount || 0), 0);
  }, [items]);

  const receivedAmount = selectedSaleVoucher ? Number(selectedSaleVoucher.received_amount || 0) : 0;
  const alreadyClaimed = selectedSaleVoucher ? Number(selectedSaleVoucher.already_approved_expenses || 0) : 0;
  const cumulativeExpense = totalExpenseAmount + alreadyClaimed;
  const availableLimit = Math.max(0, receivedAmount - alreadyClaimed);

  // Critical Pass-On Validation
  const isRuleViolated = selectedSaleVoucher && cumulativeExpense > receivedAmount;

  const handleSubmit = async (asDraft = false) => {
    setErr(null);

    if (!selectedCustomer) {
      setErr('Please select a contractor / customer.');
      return;
    }
    if (!selectedSaleVoucher) {
      setErr('Please select a linked sale voucher / invoice.');
      return;
    }
    if (totalExpenseAmount <= 0) {
      setErr('Please add at least one line item with a valid rate.');
      return;
    }

    // Critical validation
    if (cumulativeExpense > receivedAmount) {
      setErr('Expense cannot be greater than received amount');
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        customer_id: selectedCustomer.id,
        customer_name: selectedCustomer.name,
        customer_code: selectedCustomer.customer_code,
        customer_mobile: selectedCustomer.mobile,
        customer_pan: selectedCustomer.pan,
        customer_whatsapp: selectedCustomer.whatsapp,
        sale_voucher_id: selectedSaleVoucher.sale_voucher_id,
        sale_voucher_no: selectedSaleVoucher.sale_voucher_no,
        sale_voucher_type: selectedSaleVoucher.sale_voucher_type,
        sale_voucher_date: selectedSaleVoucher.sale_voucher_date,
        sale_voucher_amount: selectedSaleVoucher.total_amount,
        sale_received_amount: selectedSaleVoucher.received_amount,
        sale_unpaid_amount: selectedSaleVoucher.unpaid_amount,
        expenses: items.map(it => ({
          head: it.head,
          description: it.description,
          qty: parseFloat(it.qty) || 1,
          rate: parseFloat(it.rate) || 0,
          amount: it.amount,
        })),
        notes,
        status: asDraft ? 'draft' : 'submitted',
      };

      const res: any = await api.createExpenseApproval(payload);
      notify('Success', `Expense Voucher ${res.voucher_no} created ✓`);
      setTimeout(() => router.replace(`/accounting/expenses/approval/${res.id}` as any), 600);
    } catch (e: any) {
      setErr(e?.message || 'Failed to submit expense voucher');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView edges={['top']} style={styles.root} testID="new-expense-approval-screen">
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={20} color="#0F172A" />
        </Pressable>
        <View style={{ flex: 1, marginLeft: 10 }}>
          <Text style={styles.h1}>New Expense Approval</Text>
          <Text style={styles.subTitle}>3-Section Pass-On Expense Claim Wizard</Text>
        </View>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 50 }]} keyboardShouldPersistTaps="handled">
          
          {/* SECTION 1: CONTRACTOR SELECTION */}
          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <View style={styles.stepBadge}><Text style={styles.stepBadgeTxt}>1</Text></View>
              <Text style={styles.sectionTitle}>Select Contractor / Client</Text>
            </View>

            {selectedCustomer ? (
              <View style={styles.selectedCustBox}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.custName}>{selectedCustomer.name}</Text>
                  <Text style={styles.custCode}>Code: {selectedCustomer.customer_code || selectedCustomer.id}</Text>
                  <Text style={styles.custMeta}>
                    📱 {selectedCustomer.mobile || '—'} • PAN: {selectedCustomer.pan || '—'}
                  </Text>
                  {selectedCustomer.branch_name ? (
                    <Text style={styles.custMeta}>Branch: {selectedCustomer.branch_name} • District: {selectedCustomer.district || '—'}</Text>
                  ) : null}
                </View>
                <Pressable
                  onPress={() => setShowCustomerModal(true)}
                  style={styles.changeBtn}
                  testID="change-contractor-btn"
                >
                  <Text style={styles.changeBtnTxt}>Change</Text>
                </Pressable>
              </View>
            ) : (
              <Pressable
                onPress={() => setShowCustomerModal(true)}
                style={styles.pickerTrigger}
                testID="select-contractor-btn"
              >
                <Ionicons name="person-add-outline" size={20} color={colors.brandPrimary} />
                <Text style={styles.pickerTriggerTxt}>Click to Select Contractor *</Text>
                <Ionicons name="chevron-forward" size={18} color={colors.muted} />
              </Pressable>
            )}
          </View>

          {/* SECTION 2: LINKED SALE VOUCHER SELECTION */}
          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <View style={styles.stepBadge}><Text style={styles.stepBadgeTxt}>2</Text></View>
              <Text style={styles.sectionTitle}>Linked Sale Voucher / Invoice</Text>
            </View>

            {!selectedCustomer ? (
              <Text style={styles.placeholderTxt}>Select a contractor above to view eligible sale vouchers.</Text>
            ) : loadingSaleVouchers ? (
              <ActivityIndicator size="small" color={colors.brandPrimary} style={{ marginVertical: 14 }} />
            ) : saleVouchers.length === 0 ? (
              <View style={styles.emptySaleBox}>
                <Ionicons name="receipt-outline" size={24} color={colors.muted} />
                <Text style={styles.emptySaleTxt}>No invoices or payment receipts found for this contractor.</Text>
              </View>
            ) : (
              <View style={{ gap: 8 }}>
                {saleVouchers.map(sv => {
                  const isSel = selectedSaleVoucher?.sale_voucher_id === sv.sale_voucher_id;
                  return (
                    <Pressable
                      key={sv.sale_voucher_id}
                      onPress={() => handleSelectSaleVoucher(sv)}
                      style={[styles.saleCard, isSel && styles.saleCardActive]}
                      testID={`sale-voucher-${sv.sale_voucher_id}`}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Ionicons
                            name={isSel ? 'radio-button-on' : 'radio-button-off'}
                            size={18}
                            color={isSel ? colors.brandPrimary : colors.muted}
                          />
                          <Text style={[styles.saleCardNo, isSel && { color: colors.brandPrimary }]}>
                            {sv.sale_voucher_no}
                          </Text>
                          <View style={styles.typeTag}>
                            <Text style={styles.typeTagTxt}>{String(sv.sale_voucher_type).toUpperCase()}</Text>
                          </View>
                        </View>
                        <Text style={styles.saleDate}>{sv.sale_voucher_date || '—'}</Text>
                      </View>

                      <View style={styles.saleFinancialGrid}>
                        <View>
                          <Text style={styles.finLbl}>Invoice Total</Text>
                          <Text style={styles.finVal}>₹ {sv.total_amount.toLocaleString('en-IN')}</Text>
                        </View>
                        <View>
                          <Text style={styles.finLbl}>Received Amt</Text>
                          <Text style={[styles.finVal, { color: '#15803D' }]}>₹ {sv.received_amount.toLocaleString('en-IN')}</Text>
                        </View>
                        <View>
                          <Text style={styles.finLbl}>Available Limit</Text>
                          <Text style={[styles.finVal, { color: colors.brandPrimary }]}>₹ {sv.available_expense_limit.toLocaleString('en-IN')}</Text>
                        </View>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            )}

            {/* Passed On Money Items in Voucher */}
            {selectedSaleVoucher && (
              <View style={{ gap: 6, marginTop: 12 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ fontSize: 13, fontWeight: '800', color: colors.onSurface }}>
                    Passed On Money Items in Voucher ({passOnItems.length}) *
                  </Text>
                  <Text style={{ fontSize: 11, color: colors.muted }}>
                    Multi-select items (1 by 1 or All together)
                  </Text>
                </View>

                {loadingPassOnItems ? (
                  <ActivityIndicator color="#0D9488" style={{ marginVertical: 12 }} />
                ) : passOnItems.length === 0 ? (
                  <View style={styles.alertBox}>
                    <Ionicons name="information-circle-outline" size={18} color="#0284C7" />
                    <Text style={[styles.alertTxt, { color: '#0369A1' }]}>
                      No specific Passed-On line items tagged in {selectedSaleVoucher.sale_voucher_no}. You can enter expense lines manually below.
                    </Text>
                  </View>
                ) : (
                  <View style={styles.poiTable}>
                    {/* Header with All Checkbox */}
                    <View style={styles.poiHeaderRow}>
                      <Text style={[styles.poiThTxt, { flex: 2 }]}>Fee Item Name</Text>
                      <Text style={[styles.poiThTxt, { flex: 1.2, textAlign: 'right' }]}>Received</Text>
                      <Text style={[styles.poiThTxt, { flex: 1.2, textAlign: 'right' }]}>Spent</Text>
                      <Text style={[styles.poiThTxt, { flex: 1.2, textAlign: 'right' }]}>Balance</Text>
                      <Pressable
                        onPress={handleToggleSelectAllPassOn}
                        style={{ width: 60, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 }}
                        hitSlop={6}
                      >
                        <Text style={{ fontSize: 11, fontWeight: '800', color: '#0F766E' }}>All</Text>
                        <Ionicons
                          name={
                            passOnItems.filter(x => x.remaining_balance > 0).length > 0 &&
                            passOnItems.filter(x => x.remaining_balance > 0).every(it => selectedPassOnNames.includes(it.name))
                              ? 'checkbox'
                              : selectedPassOnNames.length > 0
                                ? 'remove-circle-outline'
                                : 'square-outline'
                          }
                          size={16}
                          color="#0D9488"
                        />
                      </Pressable>
                    </View>

                    {/* Rows */}
                    {passOnItems.map(it => {
                      const isChosen = selectedPassOnNames.includes(it.name);
                      const isZero = it.remaining_balance <= 0;
                      return (
                        <Pressable
                          key={it.name}
                          onPress={() => !isZero && handleTogglePassOnItem(it)}
                          style={[
                            styles.poiDataRow,
                            isChosen && styles.poiDataRowChosen,
                            isZero && { opacity: 0.6, backgroundColor: '#F8FAFC' },
                          ]}
                        >
                          <View style={{ flex: 2 }}>
                            <Text style={[styles.poiName, isChosen && { color: '#0D9488', fontWeight: '800' }]}>{it.name}</Text>
                            <Text style={styles.poiFeeType}>{it.fee_type || 'Reimbursement'}</Text>
                          </View>
                          <Text style={[styles.poiAmt, { flex: 1.2, textAlign: 'right' }]}>
                            ₹{Number(it.billed_amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                          </Text>
                          <Text style={[styles.poiAmt, { flex: 1.2, textAlign: 'right', color: '#DC2626' }]}>
                            ₹{Number(it.already_spent || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                          </Text>
                          <Text
                            style={[
                              styles.poiAmt,
                              { flex: 1.2, textAlign: 'right', fontWeight: '800' },
                              isZero ? { color: '#94A3B8' } : { color: '#059669' },
                            ]}
                          >
                            ₹{Number(it.remaining_balance || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                          </Text>
                          <View style={{ width: 60, alignItems: 'center', justifyContent: 'center' }}>
                            <Ionicons
                              name={isChosen ? 'checkbox' : isZero ? 'close-circle-outline' : 'square-outline'}
                              size={20}
                              color={isChosen ? '#0D9488' : isZero ? '#94A3B8' : colors.muted}
                            />
                          </View>
                        </Pressable>
                      );
                    })}

                    {/* Total Row */}
                    <View style={styles.poiTotalRow}>
                      <View style={{ flex: 2 }}>
                        <Text style={{ fontSize: 11, fontWeight: '800', color: '#0F766E' }}>
                          Total Selected ({selectedPassOnNames.length}/{passOnItems.length} Selected)
                        </Text>
                        <Text style={{ fontSize: 9, color: '#14B8A6', fontWeight: '600' }}>Combined Sum</Text>
                      </View>
                      <Text style={{ flex: 1.2, textAlign: 'right', fontSize: 12, fontWeight: '800', color: '#0F172A' }}>
                        ₹{passOnItems.filter(x => selectedPassOnNames.includes(x.name)).reduce((sum, x) => sum + (x.billed_amount || 0), 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </Text>
                      <Text style={{ flex: 1.2, textAlign: 'right', fontSize: 12, fontWeight: '800', color: '#DC2626' }}>
                        ₹{passOnItems.filter(x => selectedPassOnNames.includes(x.name)).reduce((sum, x) => sum + (x.already_spent || 0), 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </Text>
                      <Text style={{ flex: 1.2, textAlign: 'right', fontSize: 13, fontWeight: '900', color: '#059669' }}>
                        ₹{passOnItems.filter(x => selectedPassOnNames.includes(x.name)).reduce((sum, x) => sum + (x.remaining_balance || 0), 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </Text>
                      <View style={{ width: 60 }} />
                    </View>
                  </View>
                )}
              </View>
            )}
          </View>

          {/* SECTION 3: LINE-ITEM EXPENSES */}
          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <View style={styles.stepBadge}><Text style={styles.stepBadgeTxt}>3</Text></View>
              <Text style={styles.sectionTitle}>Line-Item Expenses</Text>
            </View>

            <View style={{ gap: 12 }}>
              {items.map((it, idx) => (
                <View key={it.id} style={styles.itemBox}>
                  <View style={styles.itemBoxHeader}>
                    <Text style={styles.itemIdxTxt}>Item #{idx + 1}</Text>
                    {items.length > 1 ? (
                      <Pressable onPress={() => removeItem(it.id)} hitSlop={8}>
                        <Ionicons name="trash-outline" size={16} color={colors.error} />
                      </Pressable>
                    ) : null}
                  </View>

                  {/* Expense Head Selector */}
                  <View style={{ gap: 4 }}>
                    <Text style={styles.inputLbl}>Expense Head / Category *</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                      {EXPENSE_HEADS.map(h => {
                        const isHeadSel = it.head === h;
                        return (
                          <Pressable
                            key={h}
                            onPress={() => updateItem(it.id, 'head', h)}
                            style={[styles.headChip, isHeadSel && styles.headChipActive]}
                          >
                            <Text style={[styles.headChipTxt, isHeadSel && styles.headChipTxtActive]}>{h}</Text>
                          </Pressable>
                        );
                      })}
                    </ScrollView>
                  </View>

                  {/* Description Input */}
                  <View style={{ gap: 4 }}>
                    <Text style={styles.inputLbl}>Particulars / Description</Text>
                    <TextInput
                      value={it.description}
                      onChangeText={v => updateItem(it.id, 'description', v)}
                      placeholder="e.g. Affidavit stamp, travel toll charges, etc."
                      placeholderTextColor={colors.muted}
                      style={styles.textInput}
                    />
                  </View>

                  {/* Qty, Rate, Amount Row */}
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <View style={{ flex: 1, gap: 4 }}>
                      <Text style={styles.inputLbl}>Qty</Text>
                      <TextInput
                        value={it.qty}
                        onChangeText={v => updateItem(it.id, 'qty', v)}
                        keyboardType="numeric"
                        placeholder="1"
                        placeholderTextColor={colors.muted}
                        style={styles.textInput}
                      />
                    </View>
                    <View style={{ flex: 1.5, gap: 4 }}>
                      <Text style={styles.inputLbl}>Rate (₹) *</Text>
                      <TextInput
                        value={it.rate}
                        onChangeText={v => updateItem(it.id, 'rate', v)}
                        keyboardType="numeric"
                        placeholder="0.00"
                        placeholderTextColor={colors.muted}
                        style={styles.textInput}
                      />
                    </View>
                    <View style={{ flex: 1.5, gap: 4 }}>
                      <Text style={styles.inputLbl}>Amount (₹)</Text>
                      <View style={styles.computedAmtBox}>
                        <Text style={styles.computedAmtTxt}>
                          ₹ {it.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </Text>
                      </View>
                    </View>
                  </View>
                </View>
              ))}

              <Pressable onPress={addItem} style={styles.addItemBtn} testID="add-line-item-btn">
                <Ionicons name="add-circle-outline" size={18} color={colors.brandPrimary} />
                <Text style={styles.addItemBtnTxt}>+ Add Another Expense Head</Text>
              </Pressable>
            </View>

            {/* Notes */}
            <View style={{ gap: 4, marginTop: 10 }}>
              <Text style={styles.inputLbl}>Remarks / Audit Notes</Text>
              <TextInput
                value={notes}
                onChangeText={setNotes}
                placeholder="Optional explanation for accounts & approver"
                placeholderTextColor={colors.muted}
                style={[styles.textInput, { height: 60 }]}
                multiline
              />
            </View>
          </View>

          {/* FINANCIAL SUMMARY & PASS-ON RULE CARD */}
          <View style={[styles.summaryCard, isRuleViolated && styles.summaryCardError]}>
            <Text style={styles.summaryTitle}>Financial Validation & Pass-On Rule</Text>
            
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLbl}>Claimed Total Expense:</Text>
              <Text style={styles.summaryVal}>₹ {totalExpenseAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</Text>
            </View>

            <View style={styles.summaryRow}>
              <Text style={styles.summaryLbl}>Received Amount against Sale:</Text>
              <Text style={[styles.summaryVal, { color: '#15803D' }]}>₹ {receivedAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</Text>
            </View>

            {alreadyClaimed > 0 ? (
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLbl}>Prior Pass-on Claims on Voucher:</Text>
                <Text style={[styles.summaryVal, { color: '#B45309' }]}>₹ {alreadyClaimed.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</Text>
              </View>
            ) : null}

            <View style={[styles.summaryRow, { borderTopWidth: 1, borderTopColor: '#E2E8F0', paddingTop: 6 }]}>
              <Text style={[styles.summaryLbl, { fontWeight: '800' }]}>Available Expense Limit:</Text>
              <Text style={[styles.summaryVal, { color: colors.brandPrimary, fontWeight: '900' }]}>
                ₹ {availableLimit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </Text>
            </View>

            {/* Critical Financial Validation Warning */}
            {isRuleViolated ? (
              <View style={styles.errorBanner} testID="pass-on-error-banner">
                <Ionicons name="alert-circle" size={18} color="#B91C1C" />
                <Text style={styles.errorBannerTxt}>
                  Expense cannot be greater than received amount
                </Text>
              </View>
            ) : (
              <View style={styles.successBanner}>
                <Ionicons name="checkmark-circle" size={18} color="#15803D" />
                <Text style={styles.successBannerTxt}>
                  Compliant: Expense is within received amount (Margin ₹ {(receivedAmount - cumulativeExpense).toLocaleString('en-IN', { minimumFractionDigits: 2 })})
                </Text>
              </View>
            )}
          </View>

          {err ? (
            <View style={styles.errorBanner}>
              <Ionicons name="warning" size={16} color="#B91C1C" />
              <Text style={styles.errorBannerTxt}>{err}</Text>
            </View>
          ) : null}

          {/* Action Buttons */}
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
            <Pressable
              onPress={() => handleSubmit(true)}
              style={styles.draftBtn}
              disabled={submitting}
              testID="save-draft-btn"
            >
              <Text style={styles.draftBtnTxt}>Save Draft</Text>
            </Pressable>

            <Pressable
              onPress={() => handleSubmit(false)}
              style={[styles.submitBtn, (isRuleViolated || submitting) && { opacity: 0.6 }]}
              disabled={isRuleViolated || submitting}
              testID="submit-approval-btn"
            >
              {submitting ? (
                <ActivityIndicator size="small" color="#FFF" />
              ) : (
                <>
                  <Ionicons name="paper-plane" size={16} color="#FFF" />
                  <Text style={styles.submitBtnTxt}>Submit for Approval</Text>
                </>
              )}
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Contractor Search Modal */}
      <Modal visible={showCustomerModal} transparent animationType="slide" onRequestClose={() => setShowCustomerModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard} testID="select-contractor-modal">
            <View style={styles.modalHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View style={styles.modalHeaderIcon}><Ionicons name="person" size={18} color="#FFF" /></View>
                <View>
                  <Text style={styles.modalTitle}>Select Contractor</Text>
                  <Text style={styles.modalSub}>Link expense claim to contractor</Text>
                </View>
              </View>
              <Pressable onPress={() => setShowCustomerModal(false)} hitSlop={10}>
                <Ionicons name="close" size={22} color={colors.onSurface} />
              </Pressable>
            </View>

            <View style={{ padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider }}>
              <TextInput
                value={customerSearch}
                onChangeText={setCustomerSearch}
                placeholder="Search by contractor name, mobile, PAN, ID…"
                placeholderTextColor={colors.muted}
                style={styles.textInput}
                autoFocus
              />
            </View>

            <ScrollView contentContainerStyle={{ padding: spacing.md, gap: 6 }}>
              {customers
                .filter(c => {
                  const q = customerSearch.trim().toLowerCase();
                  if (!q) return true;
                  return (
                    (c.name && c.name.toLowerCase().includes(q)) ||
                    (c.customer_code && c.customer_code.toLowerCase().includes(q)) ||
                    (c.mobile && c.mobile.includes(q)) ||
                    (c.pan && c.pan.toLowerCase().includes(q))
                  );
                })
                .map(c => {
                  const isSel = selectedCustomer?.id === c.id;
                  return (
                    <Pressable
                      key={c.id}
                      onPress={() => {
                        setSelectedCustomer(c);
                        setShowCustomerModal(false);
                      }}
                      style={[styles.pickerItem, isSel && styles.pickerItemActive]}
                    >
                      <Ionicons name="person" size={16} color={isSel ? colors.brandPrimary : colors.muted} />
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.pickerItemTitle, isSel && { color: colors.brandPrimary }]}>
                          {c.name}
                        </Text>
                        <Text style={styles.pickerItemSub}>
                          Code: {c.customer_code || c.id} • 📱 {c.mobile || '—'} • PAN: {c.pan || '—'}
                        </Text>
                      </View>
                      {isSel ? <Ionicons name="checkmark-circle" size={18} color={colors.brandPrimary} /> : null}
                    </Pressable>
                  );
                })}
            </ScrollView>
          </View>
        </View>
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
  body: { padding: spacing.lg, gap: 14 },
  sectionCard: {
    backgroundColor: '#FFF',
    borderRadius: radius.xl,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 12,
  },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.brandPrimary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBadgeTxt: { color: '#FFF', fontSize: 11, fontWeight: '900' },
  sectionTitle: { fontSize: font.base, fontWeight: '800', color: colors.onSurface },

  // Contractor Selection
  pickerTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#F8FAFC',
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.brandPrimary,
    padding: 14,
    borderRadius: radius.md,
  },
  pickerTriggerTxt: { flex: 1, fontSize: font.sm, fontWeight: '700', color: colors.brandPrimary },
  selectedCustBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EFF6FF',
    padding: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  custName: { fontSize: font.base, fontWeight: '800', color: colors.onSurface },
  custCode: { fontSize: 11, color: colors.brandPrimary, fontWeight: '700', marginTop: 1 },
  custMeta: { fontSize: 11, color: colors.muted, marginTop: 2 },
  changeBtn: {
    backgroundColor: '#FFF',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  changeBtnTxt: { fontSize: 11, fontWeight: '800', color: colors.brandPrimary },
  placeholderTxt: { fontSize: font.sm, color: colors.muted, fontStyle: 'italic' },
  emptySaleBox: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    gap: 6,
    backgroundColor: '#F8FAFC',
    borderRadius: radius.md,
  },
  emptySaleTxt: { fontSize: font.sm, color: colors.muted, textAlign: 'center' },

  // Sale Voucher Cards
  saleCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: radius.md,
    padding: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 8,
  },
  saleCardActive: {
    backgroundColor: '#EFF6FF',
    borderColor: colors.brandPrimary,
    borderWidth: 1.5,
  },
  saleCardNo: { fontSize: font.sm, fontWeight: '800', color: colors.onSurface },
  saleDate: { fontSize: 10, color: colors.muted },
  typeTag: {
    backgroundColor: '#E2E8F0',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
  },
  typeTagTxt: { fontSize: 9, fontWeight: '800', color: '#475569' },
  saleFinancialGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#FFF',
    padding: 8,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: '#F1F5F9',
  },
  finLbl: { fontSize: 9, color: colors.muted, fontWeight: '600' },
  finVal: { fontSize: 11, fontWeight: '800', color: colors.onSurface, marginTop: 1 },

  // Line item styles
  itemBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: radius.md,
    padding: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 8,
  },
  itemBoxHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  itemIdxTxt: { fontSize: 11, fontWeight: '800', color: '#475569' },
  inputLbl: { fontSize: 11, fontWeight: '700', color: colors.onSurface },
  textInput: {
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 10,
    paddingVertical: 7,
    fontSize: font.sm,
    color: colors.onSurface,
  },
  headChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  headChipActive: {
    backgroundColor: colors.brandPrimary,
    borderColor: colors.brandPrimary,
  },
  headChipTxt: { fontSize: 10, fontWeight: '700', color: '#475569' },
  headChipTxtActive: { color: '#FFF' },
  computedAmtBox: {
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    borderRadius: radius.md,
    paddingHorizontal: 10,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  computedAmtTxt: { fontSize: font.sm, fontWeight: '800', color: colors.brandPrimary },
  addItemBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: radius.md,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.brandPrimary,
  },
  addItemBtnTxt: { color: colors.brandPrimary, fontWeight: '800', fontSize: font.sm },

  // Summary Card
  summaryCard: {
    backgroundColor: '#FFF',
    borderRadius: radius.xl,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 8,
  },
  summaryCardError: {
    borderColor: '#FECACA',
    backgroundColor: '#FFF5F5',
  },
  summaryTitle: { fontSize: font.base, fontWeight: '900', color: colors.onSurface },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  summaryLbl: { fontSize: font.sm, color: colors.muted, fontWeight: '600' },
  summaryVal: { fontSize: font.sm, fontWeight: '700', color: colors.onSurface },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FEE2E2',
    borderWidth: 1,
    borderColor: '#FCA5A5',
    padding: 10,
    borderRadius: radius.md,
  },
  errorBannerTxt: { fontSize: font.sm, fontWeight: '800', color: '#B91C1C', flex: 1 },
  successBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#DCFCE7',
    borderWidth: 1,
    borderColor: '#86EFAC',
    padding: 8,
    borderRadius: radius.md,
  },
  successBannerTxt: { fontSize: 11, fontWeight: '700', color: '#15803D', flex: 1 },

  // Action buttons
  draftBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFF',
  },
  draftBtnTxt: { color: colors.onSurface, fontWeight: '800', fontSize: font.base },
  submitBtn: {
    flex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: colors.brandPrimary,
    paddingVertical: 12,
    borderRadius: radius.md,
  },
  submitBtnTxt: { color: '#FFF', fontWeight: '800', fontSize: font.base },

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
    maxWidth: 480,
    maxHeight: '80%',
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  modalHeaderIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.brandPrimary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalTitle: { fontSize: font.lg, fontWeight: '800', color: colors.onSurface },
  modalSub: { fontSize: 10, color: colors.muted },
  pickerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: radius.md,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  pickerItemActive: {
    backgroundColor: '#EFF6FF',
    borderColor: colors.brandPrimary,
  },
  pickerItemTitle: { fontSize: font.sm, fontWeight: '700', color: colors.onSurface },
  pickerItemSub: { fontSize: 10, color: colors.muted, marginTop: 2 },
  alertBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#F0F9FF',
    borderWidth: 1,
    borderColor: '#BAE6FD',
    borderRadius: radius.md,
    padding: 10,
  },
  alertTxt: {
    fontSize: 12,
    color: '#0369A1',
    flex: 1,
  },
  poiTable: {
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  poiHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#CBD5E1',
  },
  poiThTxt: {
    fontSize: 11,
    fontWeight: '800',
    color: '#475569',
  },
  poiDataRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  poiDataRowChosen: {
    backgroundColor: '#F0FDFA',
  },
  poiName: {
    fontSize: font.sm,
    fontWeight: '700',
    color: colors.onSurface,
  },
  poiFeeType: {
    fontSize: 10,
    color: colors.muted,
  },
  poiAmt: {
    fontSize: 11,
    color: colors.onSurface,
  },
  poiTotalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 10,
    backgroundColor: '#F0FDFA',
    borderTopWidth: 2,
    borderTopColor: '#0D9488',
  },
});
