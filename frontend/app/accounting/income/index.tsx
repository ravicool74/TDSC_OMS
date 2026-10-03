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
import { ScreenLoader, EmptyState } from '@/src/ui';
import { ScreenHeader } from '@/src/ScreenHeader';
import { useAuth } from '@/src/AuthContext';
import { notify } from '@/src/dialog';

const inr = (n: any) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const PAYMENT_MODES = ['cash', 'bank', 'upi', 'cheque'];
const SERVICE_CATEGORIES = [
  'DSC Services',
  'Tender Services',
  'Income Tax Services',
  'GST Services',
  'Passed On Money',
  'Registration Services',
  'Accounting Services',
  'Other Services',
];

export default function IncomeList() {
  const router = useRouter();
  const { user } = useAuth();

  const [list, setList] = useState<any[] | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [printingId, setPrintingId] = useState<string | null>(null);

  // Edit & Update Modal State
  const [editingInc, setEditingInc] = useState<any | null>(null);
  const [editForm, setEditForm] = useState<{
    amount: string;
    date: string;
    payment_mode: string;
    service_category: string;
    service_name: string;
    client_name: string;
    client_mobile: string;
    client_pan: string;
    client_gst: string;
    employee_name: string;
    remarks: string;
  }>({
    amount: '',
    date: '',
    payment_mode: 'cash',
    service_category: 'Other Services',
    service_name: '',
    client_name: '',
    client_mobile: '',
    client_pan: '',
    client_gst: '',
    employee_name: '',
    remarks: '',
  });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setList(await api.get<any[]>('/income'));
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
  // "Payment In Voucher No."; Name; Mobile No.; Pan no. ; GST NO. ; etc.
  const filteredList = useMemo(() => {
    if (!list) return null;
    const q = searchQuery.trim().toLowerCase();
    if (!q) return list;

    return list.filter((inc) => {
      const vNo = String(inc.voucher_no || inc.income_no || '').toLowerCase();
      const clientName = String(inc.client_name || '').toLowerCase();
      const mobile = String(inc.client_mobile || '').toLowerCase();
      const pan = String(inc.client_pan || '').toLowerCase();
      const gst = String(inc.client_gst || '').toLowerCase();
      const code = String(inc.client_code || '').toLowerCase();
      const category = String(inc.service_category || '').toLowerCase();
      const service = String(inc.service_name || '').toLowerCase();
      const empName = String(inc.employee_name || '').toLowerCase();
      const remarks = String(inc.remarks || '').toLowerCase();
      const mode = String(inc.payment_mode || '').toLowerCase();
      const date = String(inc.date || '').toLowerCase();
      const amt = String(inc.amount || '').toLowerCase();

      // Check linked vouchers
      const linked = (inc.linked_vouchers || [])
        .map((lv: any) => String(lv.voucher_no || lv.invoice_no || '').toLowerCase())
        .join(' ');

      // Check items
      const items = (inc.items || [])
        .map((it: any) => String(it.item || it.name || '').toLowerCase())
        .join(' ');

      return (
        vNo.includes(q) ||
        clientName.includes(q) ||
        mobile.includes(q) ||
        pan.includes(q) ||
        gst.includes(q) ||
        code.includes(q) ||
        category.includes(q) ||
        service.includes(q) ||
        empName.includes(q) ||
        remarks.includes(q) ||
        mode.includes(q) ||
        date.includes(q) ||
        amt.includes(q) ||
        linked.includes(q) ||
        items.includes(q)
      );
    });
  }, [list, searchQuery]);

  // Print PDF Handler
  const handlePrint = async (item: any) => {
    try {
      setPrintingId(item.id);
      const url = await api.incomePdfUrl(item.id);
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.open(url, '_blank');
      } else {
        await Linking.openURL(url);
      }
    } catch (e: any) {
      notify('Print Failed', e?.message || 'Unable to open Payment-In Voucher PDF');
    } finally {
      setPrintingId(null);
    }
  };

  // Open Edit Modal
  const openEdit = (item: any) => {
    setEditingInc(item);
    setEditForm({
      amount: String(item.amount || ''),
      date: item.date || new Date().toISOString().slice(0, 10),
      payment_mode: item.payment_mode || 'cash',
      service_category: item.service_category || 'Other Services',
      service_name: item.service_name || '',
      client_name: item.client_name || '',
      client_mobile: item.client_mobile || '',
      client_pan: item.client_pan || '',
      client_gst: item.client_gst || '',
      employee_name: item.employee_name || '',
      remarks: item.remarks || '',
    });
  };

  // Save / Update Handler
  const saveEdit = async () => {
    if (!editingInc) return;
    const numAmt = parseFloat(editForm.amount);
    if (isNaN(numAmt) || numAmt <= 0) {
      notify('Invalid Amount', 'Please enter a valid payment amount greater than 0.');
      return;
    }
    if (!editForm.client_name.trim()) {
      notify('Client Name Required', 'Please enter customer / client name.');
      return;
    }
    if (!editForm.date.trim()) {
      notify('Date Required', 'Please enter a valid voucher date.');
      return;
    }

    try {
      setSaving(true);
      await api.patch(`/income/${editingInc.id}`, {
        amount: numAmt,
        date: editForm.date.trim(),
        payment_mode: editForm.payment_mode,
        service_category: editForm.service_category.trim() || 'Other Services',
        service_name: editForm.service_name.trim() || null,
        client_name: editForm.client_name.trim(),
        client_mobile: editForm.client_mobile.trim() || null,
        client_pan: editForm.client_pan.trim() || null,
        client_gst: editForm.client_gst.trim() || null,
        employee_name: editForm.employee_name.trim() || null,
        remarks: editForm.remarks.trim() || null,
      });

      notify('Saved', `Payment-In voucher ${editingInc.voucher_no || editingInc.income_no} updated successfully!`);
      setEditingInc(null);
      await load();
    } catch (e: any) {
      notify('Update Failed', e?.message || 'Failed to save changes');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#F4F6FB' }} testID="income-list">
      <ScreenHeader
        title="Payment-In"
        right={
          <Pressable
            onPress={() => router.push('/accounting/income/new' as any)}
            style={styles.addBtn}
            testID="new-income-btn"
          >
            <Ionicons name="add" size={22} color="#FFF" />
          </Pressable>
        }
      />

      {/* Search Payment In Section */}
      <View style={styles.searchSection}>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={18} color="#64748B" style={{ marginLeft: 4 }} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search Payment In (Voucher No., Name, Mobile, PAN, GST...)"
            placeholderTextColor="#94A3B8"
            value={searchQuery}
            onChangeText={setSearchQuery}
            returnKeyType="search"
            autoCapitalize="none"
            autoCorrect={false}
            testID="search-payin-input"
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
          <View style={styles.chip}><Text style={styles.chipTxt}>Payment In Voucher No.</Text></View>
          <View style={styles.chip}><Text style={styles.chipTxt}>Name</Text></View>
          <View style={styles.chip}><Text style={styles.chipTxt}>Mobile No.</Text></View>
          <View style={styles.chip}><Text style={styles.chipTxt}>Pan no.</Text></View>
          <View style={styles.chip}><Text style={styles.chipTxt}>GST NO.</Text></View>
        </View>

        {/* Active search result indicator */}
        {searchQuery.trim() ? (
          <View style={styles.resultBar}>
            <Text style={styles.resultTxt}>
              Found <Text style={{ fontWeight: '800', color: '#0F172A' }}>{filteredList?.length || 0}</Text> of {list?.length || 0} vouchers
            </Text>
            <Pressable onPress={() => setSearchQuery('')}>
              <Text style={styles.resetLink}>Clear</Text>
            </Pressable>
          </View>
        ) : null}
      </View>

      {/* Main List Area */}
      {list === null ? (
        <ScreenLoader />
      ) : list.length === 0 ? (
        <EmptyState
          testID="income-empty"
          icon="cash-outline"
          title="No Payment-In entries"
          subtitle="Record money received from clients"
          actionLabel="Add Payment-In"
          onAction={() => router.push('/accounting/income/new' as any)}
        />
      ) : filteredList && filteredList.length === 0 ? (
        <View style={styles.noMatchCard}>
          <Ionicons name="search-outline" size={42} color="#94A3B8" />
          <Text style={styles.noMatchTitle}>No payment-in vouchers match "{searchQuery}"</Text>
          <Text style={styles.noMatchSub}>
            Try searching by Voucher No. (e.g. PAYIN-0001), Customer Name, Mobile No., PAN, or GSTIN.
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
          renderItem={({ item }) => {
            const vNo = item.voucher_no || item.income_no || 'PAYIN';
            return (
              <View style={styles.card} testID={`payin-card-${item.id}`}>
                {/* Header: Voucher No, Date, Status, Amount */}
                <View style={styles.cardHeader}>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <Text style={styles.vNo}>{vNo}</Text>
                      <Text style={styles.dateTxt}>• {item.date}</Text>
                      {(item.attachments?.length || 0) > 0 ? (
                        <View style={styles.attachChip}>
                          <Ionicons name="attach" size={12} color={colors.brandPrimary} />
                          <Text style={styles.attachTxt}>{item.attachments.length}</Text>
                        </View>
                      ) : null}
                    </View>
                    <Text style={styles.clientTitle}>{item.client_name}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 4 }}>
                    <Text style={styles.amtTxt}>{inr(item.amount)}</Text>
                    <View style={styles.receivedBadge}>
                      <Ionicons name="checkmark-circle" size={12} color="#059669" />
                      <Text style={styles.receivedBadgeTxt}>RECEIVED</Text>
                    </View>
                  </View>
                </View>

                {/* Service Category & Payment Mode */}
                <View style={styles.metaRow}>
                  <View style={styles.categoryBadge}>
                    <Text style={styles.categoryBadgeTxt}>{item.service_category || 'General'}</Text>
                  </View>
                  <View style={styles.modeBadge}>
                    <Text style={styles.modeBadgeTxt}>{String(item.payment_mode || 'cash').toUpperCase()}</Text>
                  </View>
                  {item.employee_name ? (
                    <Text style={styles.byEmpTxt}>by {item.employee_name}</Text>
                  ) : null}
                </View>

                {/* Customer Details Badges: Mobile, PAN, GST, Linked Invoices */}
                <View style={styles.custMetaContainer}>
                  {item.client_mobile ? (
                    <View style={styles.metaBadge}>
                      <Ionicons name="call-outline" size={12} color="#059669" />
                      <Text style={styles.metaBadgeTxt}>Mob: {item.client_mobile}</Text>
                    </View>
                  ) : null}
                  {item.client_pan ? (
                    <View style={[styles.metaBadge, { backgroundColor: '#FEF3C7', borderColor: '#FDE68A' }]}>
                      <Text style={[styles.metaBadgeTxt, { color: '#B45309', fontWeight: '800' }]}>PAN: {item.client_pan}</Text>
                    </View>
                  ) : null}
                  {item.client_gst ? (
                    <View style={[styles.metaBadge, { backgroundColor: '#F3E8FF', borderColor: '#E9D5FF' }]}>
                      <Text style={[styles.metaBadgeTxt, { color: '#7E22CE', fontWeight: '800' }]}>GST: {item.client_gst}</Text>
                    </View>
                  ) : null}
                  {item.linked_vouchers && item.linked_vouchers.length > 0 ? (
                    <View style={[styles.metaBadge, { backgroundColor: '#E0E7FF', borderColor: '#C7D2FE' }]}>
                      <Ionicons name="document-text-outline" size={12} color="#3730A3" />
                      <Text style={[styles.metaBadgeTxt, { color: '#3730A3', fontWeight: '800' }]}>
                        Linked: {item.linked_vouchers.map((lv: any) => lv.voucher_no || lv.invoice_no).join(', ')}
                      </Text>
                    </View>
                  ) : null}
                </View>

                {/* Remarks if present */}
                {item.remarks ? (
                  <Text style={styles.remarksTxt} numberOfLines={2}>
                    "{item.remarks}"
                  </Text>
                ) : null}

                {/* Action Buttons: Print, Edit, View */}
                <View style={styles.cardActionsRow}>
                  {/* Print Button */}
                  <Pressable
                    onPress={() => handlePrint(item)}
                    style={styles.actionBtnPrint}
                    testID={`print-payin-${item.id}`}
                  >
                    {printingId === item.id ? (
                      <ActivityIndicator size="small" color="#047857" />
                    ) : (
                      <>
                        <Ionicons name="print-outline" size={15} color="#047857" />
                        <Text style={styles.actionBtnPrintTxt}>Print</Text>
                      </>
                    )}
                  </Pressable>

                  {/* Edit Button */}
                  <Pressable
                    onPress={() => openEdit(item)}
                    style={styles.actionBtnEdit}
                    testID={`edit-payin-${item.id}`}
                  >
                    <Ionicons name="create-outline" size={15} color="#4338CA" />
                    <Text style={styles.actionBtnEditTxt}>Edit</Text>
                  </Pressable>

                  {/* View Details Button */}
                  <Pressable
                    onPress={() => router.push(`/accounting/income/${item.id}` as any)}
                    style={styles.actionBtnView}
                    testID={`view-payin-${item.id}`}
                  >
                    <Ionicons name="eye-outline" size={15} color="#475569" />
                    <Text style={styles.actionBtnViewTxt}>View</Text>
                  </Pressable>
                </View>
              </View>
            );
          }}
        />
      )}

      {/* ================= EDIT & UPDATE PAYMENT-IN MODAL ================= */}
      <Modal
        visible={!!editingInc}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setEditingInc(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent} testID="edit-payin-modal">
            {/* Modal Header */}
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>Edit Payment-In Voucher</Text>
                <Text style={styles.modalSubtitle}>{editingInc?.voucher_no || editingInc?.income_no || 'PAYIN'}</Text>
              </View>
              <Pressable
                onPress={() => setEditingInc(null)}
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
                    <Text style={styles.formLabel}>Amount Received (₹) *</Text>
                    <TextInput
                      style={[styles.formInput, { fontWeight: '800', color: '#059669', fontSize: 16 }]}
                      keyboardType="numeric"
                      value={editForm.amount}
                      onChangeText={(t) => setEditForm((p) => ({ ...p, amount: t }))}
                      placeholder="0.00"
                      testID="edit-payin-amount"
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.formLabel}>Date (YYYY-MM-DD) *</Text>
                    <TextInput
                      style={styles.formInput}
                      value={editForm.date}
                      onChangeText={(t) => setEditForm((p) => ({ ...p, date: t }))}
                      placeholder="YYYY-MM-DD"
                      testID="edit-payin-date"
                    />
                  </View>
                </View>

                {/* Payment Mode Selector */}
                <View>
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

                {/* Service Category */}
                <View>
                  <Text style={styles.formLabel}>Service Category</Text>
                  <TextInput
                    style={styles.formInput}
                    value={editForm.service_category}
                    onChangeText={(t) => setEditForm((p) => ({ ...p, service_category: t }))}
                    placeholder="e.g. Tender Services, DSC"
                    testID="edit-payin-category"
                  />
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 6 }}>
                    <View style={{ flexDirection: 'row', gap: 6 }}>
                      {SERVICE_CATEGORIES.map((c) => (
                        <Pressable
                          key={c}
                          onPress={() => setEditForm((p) => ({ ...p, service_category: c }))}
                          style={[
                            styles.catPill,
                            editForm.service_category === c && styles.catPillActive,
                          ]}
                        >
                          <Text style={[styles.catPillTxt, editForm.service_category === c && styles.catPillTxtActive]}>
                            {c}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  </ScrollView>
                </View>

                {/* Customer Information Card */}
                <View style={styles.subCard}>
                  <Text style={styles.subCardTitle}>Customer / Client Details</Text>
                  <View style={styles.formRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.formLabel}>Client / Firm Name *</Text>
                      <TextInput
                        style={styles.formInput}
                        value={editForm.client_name}
                        onChangeText={(t) => setEditForm((p) => ({ ...p, client_name: t }))}
                        placeholder="Customer Name"
                        testID="edit-payin-client-name"
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.formLabel}>Mobile No.</Text>
                      <TextInput
                        style={styles.formInput}
                        value={editForm.client_mobile}
                        onChangeText={(t) => setEditForm((p) => ({ ...p, client_mobile: t }))}
                        placeholder="Mobile No."
                        keyboardType="phone-pad"
                        testID="edit-payin-client-mobile"
                      />
                    </View>
                  </View>

                  <View style={styles.formRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.formLabel}>PAN No.</Text>
                      <TextInput
                        style={[styles.formInput, { textTransform: 'uppercase' }]}
                        value={editForm.client_pan}
                        onChangeText={(t) => setEditForm((p) => ({ ...p, client_pan: t.toUpperCase() }))}
                        placeholder="ABCDE1234F"
                        autoCapitalize="characters"
                        testID="edit-payin-client-pan"
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.formLabel}>GST No.</Text>
                      <TextInput
                        style={[styles.formInput, { textTransform: 'uppercase' }]}
                        value={editForm.client_gst}
                        onChangeText={(t) => setEditForm((p) => ({ ...p, client_gst: t.toUpperCase() }))}
                        placeholder="15-digit GSTIN"
                        autoCapitalize="characters"
                        testID="edit-payin-client-gst"
                      />
                    </View>
                  </View>
                </View>

                {/* Received By */}
                <View>
                  <Text style={styles.formLabel}>Received By / Executive Name</Text>
                  <TextInput
                    style={styles.formInput}
                    value={editForm.employee_name}
                    onChangeText={(t) => setEditForm((p) => ({ ...p, employee_name: t }))}
                    placeholder="Staff / Executive Name"
                    testID="edit-payin-employee"
                  />
                </View>

                {/* Remarks / Narration */}
                <View>
                  <Text style={styles.formLabel}>Remarks / Narration</Text>
                  <TextInput
                    style={[styles.formInput, { minHeight: 64, textAlignVertical: 'top' }]}
                    value={editForm.remarks}
                    onChangeText={(t) => setEditForm((p) => ({ ...p, remarks: t }))}
                    placeholder="Payment details, cheque no., or notes..."
                    multiline
                    numberOfLines={3}
                    testID="edit-payin-remarks"
                  />
                </View>
              </View>
            </ScrollView>

            {/* Modal Footer Buttons */}
            <View style={styles.modalFooter}>
              <Pressable
                onPress={() => setEditingInc(null)}
                style={styles.cancelBtn}
                disabled={saving}
              >
                <Text style={styles.cancelBtnTxt}>Cancel</Text>
              </Pressable>

              <Pressable
                onPress={saveEdit}
                style={styles.saveBtn}
                disabled={saving}
                testID="save-payin-btn"
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

  /* Card */
  card: {
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
  vNo: {
    color: colors.brandPrimary,
    fontWeight: '800',
    fontSize: font.base,
    letterSpacing: 0.5,
  },
  dateTxt: {
    color: '#64748B',
    fontSize: font.sm,
  },
  clientTitle: {
    fontSize: font.base,
    fontWeight: '800',
    color: '#0F172A',
    marginTop: 2,
  },
  amtTxt: {
    fontSize: font.lg,
    fontWeight: '900',
    color: '#059669',
  },
  receivedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: radius.pill,
  },
  receivedBadgeTxt: {
    fontSize: 9,
    fontWeight: '800',
    color: '#059669',
    letterSpacing: 0.5,
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
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  categoryBadge: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  categoryBadgeTxt: {
    fontSize: 11,
    fontWeight: '700',
    color: '#334155',
  },
  modeBadge: {
    backgroundColor: '#EEF2FF',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#C7D2FE',
  },
  modeBadgeTxt: {
    fontSize: 10,
    fontWeight: '800',
    color: '#4338CA',
  },
  byEmpTxt: {
    fontSize: 11,
    color: '#64748B',
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
  remarksTxt: {
    fontSize: font.sm,
    color: '#475569',
    backgroundColor: '#F8FAFC',
    padding: 8,
    borderRadius: 6,
    fontStyle: 'italic',
  },

  /* Card Actions: Print, Edit, View */
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
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    paddingVertical: 7,
    borderRadius: radius.md,
  },
  actionBtnPrintTxt: {
    color: '#047857',
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
    backgroundColor: '#ECFDF5',
    borderColor: '#10B981',
  },
  catPillTxt: {
    fontSize: 11,
    color: '#475569',
    fontWeight: '600',
  },
  catPillTxtActive: {
    color: '#047857',
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
    backgroundColor: '#059669',
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnTxt: {
    color: '#FFF',
    fontWeight: '800',
    fontSize: font.sm,
  },
});
