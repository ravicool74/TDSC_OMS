import React, { useCallback, useState, useMemo } from 'react';
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
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, font } from '@/src/theme';
import { api } from '@/src/api';
import { Card, EmptyState, ScreenLoader, StatusBadge } from '@/src/ui';
import { ScreenHeader } from '@/src/ScreenHeader';
import { useAuth } from '@/src/AuthContext';
import { notify, confirm } from '@/src/dialog';

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

export default function ExpensesList() {
  const router = useRouter();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const isManager = user?.role === 'manager';

  const [list, setList] = useState<any[] | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [printingId, setPrintingId] = useState<string | null>(null);

  // Edit / Update Modal State
  const [editingExp, setEditingExp] = useState<any | null>(null);
  const [editForm, setEditForm] = useState<{
    amount: string;
    category: string;
    date: string;
    payment_mode: string;
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
    vendor: '',
    description: '',
    customer_name: '',
    customer_mobile: '',
    customer_pan: '',
    customer_gst: '',
  });
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const canDelete = isAdmin || isManager || user?.role === 'accountant';

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
      Alert.alert('Delete Failed', e?.message || 'Could not delete expense');
    } finally {
      setDeletingId(null);
    }
  };

  const load = useCallback(async () => {
    try {
      setList(await api.get<any[]>('/expenses'));
    } catch {
      setList([]);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // Multi-criteria filter matching:
  // "EXP NO."; Name; Mobile No.; Pan no. ; GST NO. ; etc.
  const filteredList = useMemo(() => {
    if (!list) return null;
    const q = searchQuery.trim().toLowerCase();
    if (!q) return list;

    return list.filter((exp) => {
      const expNo = String(exp.expense_no || '').toLowerCase();
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
      const amt = String(exp.amount || '').toLowerCase();

      return (
        expNo.includes(q) ||
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
        amt.includes(q)
      );
    });
  }, [list, searchQuery]);

  // Print voucher PDF
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
    setEditForm({
      amount: String(item.amount || ''),
      category: item.category || 'Other Expenses',
      date: item.date || new Date().toISOString().slice(0, 10),
      payment_mode: item.payment_mode || 'cash',
      vendor: item.vendor || '',
      description: item.description || '',
      customer_name: item.customer_name || '',
      customer_mobile: item.customer_mobile || '',
      customer_pan: item.customer_pan || '',
      customer_gst: item.customer_gst || '',
    });
  };

  // Save / Update Expense
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
      await api.patch(`/expenses/${editingExp.id}`, {
        amount: numAmt,
        category: editForm.category.trim(),
        date: editForm.date.trim(),
        payment_mode: editForm.payment_mode,
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

  const decide = async (id: string, action: 'verify' | 'approve' | 'reject') => {
    try {
      await api.post(`/expenses/${id}/decision`, { action });
      await load();
    } catch (e: any) {
      notify('Action Failed', e?.message || 'Unable to update status');
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#F4F6FB' }} testID="expenses-list">
      <ScreenHeader
        title="Expenses"
        right={
          <Pressable
            onPress={() => router.push('/accounting/expenses/new' as any)}
            style={styles.addBtn}
            testID="new-expense-btn"
          >
            <Ionicons name="add" size={22} color="#FFF" />
          </Pressable>
        }
      />

      {/* Search Expences Section */}
      <View style={styles.searchSection}>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={18} color="#64748B" style={{ marginLeft: 4 }} />
          <TextInput
            style={styles.searchInput}
            placeholder='Search Expences (EXP NO., Name, Mobile, PAN, GST...)'
            placeholderTextColor="#94A3B8"
            value={searchQuery}
            onChangeText={setSearchQuery}
            returnKeyType="search"
            autoCapitalize="none"
            autoCorrect={false}
            testID="search-exp-input"
          />
          {searchQuery ? (
            <Pressable onPress={() => setSearchQuery('')} hitSlop={10} style={styles.clearBtn} testID="clear-search-btn">
              <Ionicons name="close-circle" size={18} color="#94A3B8" />
            </Pressable>
          ) : null}
        </View>

        {/* Criteria helper tags */}
        <View style={styles.criteriaRow}>
          <Text style={styles.criteriaLbl}>Criteria:</Text>
          <View style={styles.chip}><Text style={styles.chipTxt}>EXP NO.</Text></View>
          <View style={styles.chip}><Text style={styles.chipTxt}>Name</Text></View>
          <View style={styles.chip}><Text style={styles.chipTxt}>Mobile No.</Text></View>
          <View style={styles.chip}><Text style={styles.chipTxt}>Pan no.</Text></View>
          <View style={styles.chip}><Text style={styles.chipTxt}>GST NO.</Text></View>
          <View style={styles.chip}><Text style={styles.chipTxt}>Category</Text></View>
        </View>

        {/* Active search result indicator */}
        {searchQuery.trim() ? (
          <View style={styles.resultBar}>
            <Text style={styles.resultTxt}>
              Found <Text style={{ fontWeight: '800', color: '#0F172A' }}>{filteredList?.length || 0}</Text> of {list?.length || 0} expenses
            </Text>
            <Pressable onPress={() => setSearchQuery('')}>
              <Text style={styles.resetLink}>Clear</Text>
            </Pressable>
          </View>
        ) : null}
      </View>

      {/* Expense List Content */}
      {list === null ? (
        <ScreenLoader />
      ) : list.length === 0 ? (
        <EmptyState
          testID="expenses-empty"
          icon="wallet-outline"
          title="No expenses"
          subtitle="Track outflows and operating costs"
          actionLabel="Add Expense"
          onAction={() => router.push('/accounting/expenses/new' as any)}
        />
      ) : filteredList && filteredList.length === 0 ? (
        <View style={styles.noMatchCard}>
          <Ionicons name="search-outline" size={42} color="#94A3B8" />
          <Text style={styles.noMatchTitle}>No expenses match "{searchQuery}"</Text>
          <Text style={styles.noMatchSub}>
            Try searching by EXP NO., Payee/Customer Name, Mobile No., PAN No., GSTIN, or Category.
          </Text>
          <Pressable onPress={() => setSearchQuery('')} style={styles.clearSearchBtn}>
            <Ionicons name="close" size={16} color="#FFF" />
            <Text style={styles.clearSearchBtnTxt}>Reset Search</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={filteredList}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ padding: spacing.md, gap: spacing.md, paddingBottom: 90 }}
          renderItem={({ item }) => (
            <View style={styles.expCard} testID={`exp-card-${item.id}`}>
              {/* Card Top: EXP NO, Date, Attachments, Status, Amount */}
              <View style={styles.cardHeader}>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <Text style={styles.expNo}>{item.expense_no || 'EXP'}</Text>
                    <Text style={styles.dateTxt}>• {item.date}</Text>
                    {(item.attachments?.length || 0) > 0 ? (
                      <View style={styles.attachChip}>
                        <Ionicons name="attach" size={12} color={colors.brandPrimary} />
                        <Text style={styles.attachTxt}>{item.attachments.length}</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={styles.categoryTitle}>{item.category}</Text>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  <Text style={styles.amtTxt}>{inr(item.amount)}</Text>
                  <StatusBadge status={item.status} />
                </View>
              </View>

              {/* Vendor & Mode */}
              <View style={styles.vendorRow}>
                <Ionicons name="business-outline" size={14} color="#64748B" />
                <Text style={styles.vendorTxt}>
                  Paid To: <Text style={{ fontWeight: '700', color: '#1E293B' }}>{item.vendor || 'N/A'}</Text>
                </Text>
                <View style={styles.modeBadge}>
                  <Text style={styles.modeBadgeTxt}>{String(item.payment_mode || 'cash').toUpperCase()}</Text>
                </View>
              </View>

              {/* Customer / Job Metadata Badges (Name, Mobile, PAN, GST, Linked Invoice) */}
              {(item.customer_name || item.customer_mobile || item.customer_pan || item.customer_gst || item.sale_invoice_no) ? (
                <View style={styles.custMetaContainer}>
                  {item.customer_name ? (
                    <View style={styles.metaBadge}>
                      <Ionicons name="person-outline" size={12} color="#0284C7" />
                      <Text style={styles.metaBadgeTxt} numberOfLines={1}>{item.customer_name}</Text>
                    </View>
                  ) : null}
                  {item.customer_mobile ? (
                    <View style={styles.metaBadge}>
                      <Ionicons name="call-outline" size={12} color="#059669" />
                      <Text style={styles.metaBadgeTxt}>Mob: {item.customer_mobile}</Text>
                    </View>
                  ) : null}
                  {item.customer_pan ? (
                    <View style={[styles.metaBadge, { backgroundColor: '#FEF3C7', borderColor: '#FDE68A' }]}>
                      <Text style={[styles.metaBadgeTxt, { color: '#B45309', fontWeight: '800' }]}>PAN: {item.customer_pan}</Text>
                    </View>
                  ) : null}
                  {item.customer_gst ? (
                    <View style={[styles.metaBadge, { backgroundColor: '#F3E8FF', borderColor: '#E9D5FF' }]}>
                      <Text style={[styles.metaBadgeTxt, { color: '#7E22CE', fontWeight: '800' }]}>GST: {item.customer_gst}</Text>
                    </View>
                  ) : null}
                  {item.sale_invoice_no ? (
                    <View style={[styles.metaBadge, { backgroundColor: '#E0E7FF', borderColor: '#C7D2FE' }]}>
                      <Ionicons name="document-text-outline" size={12} color="#3730A3" />
                      <Text style={[styles.metaBadgeTxt, { color: '#3730A3', fontWeight: '800' }]}>
                        Sale: {item.sale_invoice_no} {item.sale_item_name ? `(${item.sale_item_name})` : ''}
                      </Text>
                    </View>
                  ) : null}
                </View>
              ) : null}

              {/* Narration / Description */}
              {item.description ? (
                <Text style={styles.descTxt} numberOfLines={2}>
                  {item.description}
                </Text>
              ) : null}

              {/* Action Buttons Row: Search, Edit, Update, Save, Print */}
              <View style={styles.cardActionsRow}>
                {/* Print Button */}
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

                {/* Edit & Update Button */}
                <Pressable
                  onPress={() => openEdit(item)}
                  style={styles.actionBtnEdit}
                  testID={`edit-exp-${item.id}`}
                >
                  <Ionicons name="create-outline" size={15} color="#4338CA" />
                  <Text style={styles.actionBtnEditTxt}>Edit</Text>
                </Pressable>

                {/* View Details Button */}
                <Pressable
                  onPress={() => router.push(`/accounting/expenses/${item.id}` as any)}
                  style={styles.actionBtnView}
                  testID={`view-exp-${item.id}`}
                >
                  <Ionicons name="eye-outline" size={15} color="#475569" />
                  <Text style={styles.actionBtnViewTxt}>View</Text>
                </Pressable>

                {/* Delete Button */}
                {canDelete ? (
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
                ) : null}
              </View>

              {/* Pending / Verification Workflow Actions for Admin & Manager */}
              {item.status === 'pending' && (isAdmin || isManager) ? (
                <View style={styles.workflowRow}>
                  <Pressable
                    onPress={() => decide(item.id, 'reject')}
                    testID={`reject-${item.id}`}
                    style={[styles.wfBtn, { backgroundColor: '#FEE2E2' }]}
                  >
                    <Text style={{ color: '#DC2626', fontWeight: '800', fontSize: font.sm }}>Reject</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => decide(item.id, 'verify')}
                    testID={`verify-${item.id}`}
                    style={[styles.wfBtn, { backgroundColor: '#FEF3C7' }]}
                  >
                    <Text style={{ color: '#B45309', fontWeight: '800', fontSize: font.sm }}>Verify</Text>
                  </Pressable>
                  {isAdmin ? (
                    <Pressable
                      onPress={() => decide(item.id, 'approve')}
                      testID={`approve-${item.id}`}
                      style={[styles.wfBtn, { backgroundColor: '#059669' }]}
                    >
                      <Text style={{ color: '#FFF', fontWeight: '800', fontSize: font.sm }}>Approve</Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}

              {item.status === 'verified' && isAdmin ? (
                <View style={styles.workflowRow}>
                  <Pressable
                    onPress={() => decide(item.id, 'approve')}
                    testID={`approve-${item.id}`}
                    style={[styles.wfBtn, { backgroundColor: '#059669', flex: 1 }]}
                  >
                    <Text style={{ color: '#FFF', fontWeight: '800', fontSize: font.sm, textAlign: 'center' }}>
                      Approve Voucher
                    </Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          )}
        />
      )}

      {/* ================= EDIT & UPDATE EXPENSE MODAL ================= */}
      <Modal
        visible={!!editingExp}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setEditingExp(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent} testID="edit-expense-modal">
            {/* Modal Header */}
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

            {/* Modal Form Scroll */}
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

                {/* Category Quick Picks */}
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginVertical: 4 }}>
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    {EXPENSE_CATEGORIES.slice(0, 7).map((c) => (
                      <Pressable
                        key={c}
                        onPress={() => setEditForm((p) => ({ ...p, category: c }))}
                        style={[
                          styles.catPill,
                          editForm.category === c && styles.catPillActive,
                        ]}
                      >
                        <Text style={[styles.catPillTxt, editForm.category === c && styles.catPillTxtActive]}>
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

                {/* Narration / Description */}
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

            {/* Modal Actions */}
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

  /* Search Section */
  searchSection: {
    backgroundColor: '#FFF',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    gap: 6,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
    borderRadius: radius.md,
    paddingHorizontal: 10,
    height: 44,
  },
  searchInput: {
    flex: 1,
    fontSize: font.sm,
    color: '#0F172A',
    marginLeft: 8,
    paddingVertical: 0,
  },
  clearBtn: {
    padding: 4,
  },
  criteriaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    paddingVertical: 2,
  },
  criteriaLbl: {
    fontSize: 11,
    fontWeight: '800',
    color: '#64748B',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  chip: {
    backgroundColor: '#EEF2F6',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  chipTxt: {
    fontSize: 10,
    fontWeight: '700',
    color: '#334155',
  },
  resultBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 2,
  },
  resultTxt: {
    fontSize: font.sm,
    color: '#64748B',
  },
  resetLink: {
    fontSize: font.sm,
    fontWeight: '700',
    color: colors.brandPrimary,
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
  attachChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  attachTxt: {
    color: colors.brandPrimary,
    fontSize: 10,
    fontWeight: '800',
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

  /* Card Actions: Search, Edit, Update, Save, Print */
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
    gap: 6,
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
  actionBtnEdit: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
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
  actionBtnView: {
    flex: 0.8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingVertical: 7,
    borderRadius: radius.md,
  },
  actionBtnViewTxt: {
    color: '#475569',
    fontWeight: '700',
    fontSize: font.sm,
  },
  actionBtnDelete: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
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

  /* Workflow decision row */
  workflowRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 4,
  },
  wfBtn: {
    flex: 1,
    paddingVertical: 7,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* Modal */
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
});
