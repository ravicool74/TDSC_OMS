import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Alert,
  Pressable,
  Platform,
  Linking,
  Modal,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, font } from '@/src/theme';
import { api } from '@/src/api';
import { ScreenHeader } from '@/src/ScreenHeader';
import { AttachmentsSection, Attachment } from '@/src/AttachmentsSection';
import { useAuth } from '@/src/AuthContext';
import { notify } from '@/src/dialog';

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

export default function ExpenseDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const [exp, setExp] = useState<any | null>(null);
  const [printing, setPrinting] = useState(false);

  // Edit Modal State
  const [editModalVisible, setEditModalVisible] = useState(false);
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

  const load = useCallback(async () => {
    try {
      setExp(await api.get<any>(`/expenses/${id}`));
    } catch {}
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onAttachmentsChange = (list: Attachment[]) =>
    setExp((p: any) => (p ? { ...p, attachments: list } : p));

  const remove = () =>
    Alert.alert('Delete Expense?', `Delete ${exp?.expense_no}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.del(`/expenses/${id}`);
            router.back();
          } catch (e: any) {
            Alert.alert('Failed', e?.message || 'Try again');
          }
        },
      },
    ]);

  const decide = async (action: 'verify' | 'approve' | 'reject') => {
    try {
      await api.post(`/expenses/${id}/decision`, { action });
      await load();
    } catch (e: any) {
      Alert.alert('Failed', e?.message || 'Try again');
    }
  };

  const handlePrint = async () => {
    try {
      setPrinting(true);
      const url = await api.expensePdfUrl(id as string);
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.open(url, '_blank');
      } else {
        await Linking.openURL(url);
      }
    } catch (e: any) {
      notify('Print Failed', e?.message || 'Unable to open Expense Voucher PDF');
    } finally {
      setPrinting(false);
    }
  };

  const openEdit = () => {
    if (!exp) return;
    setEditForm({
      amount: String(exp.amount || ''),
      category: exp.category || 'Other Expenses',
      date: exp.date || new Date().toISOString().slice(0, 10),
      payment_mode: exp.payment_mode || 'cash',
      vendor: exp.vendor || '',
      description: exp.description || '',
      customer_name: exp.customer_name || '',
      customer_mobile: exp.customer_mobile || '',
      customer_pan: exp.customer_pan || '',
      customer_gst: exp.customer_gst || '',
    });
    setEditModalVisible(true);
  };

  const saveEdit = async () => {
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
      await api.patch(`/expenses/${id}`, {
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

      notify('Saved', `Expense ${exp.expense_no} updated successfully!`);
      setEditModalVisible(false);
      await load();
    } catch (e: any) {
      notify('Update Failed', e?.message || 'Failed to save expense changes');
    } finally {
      setSaving(false);
    }
  };

  if (!exp) {
    return (
      <View style={{ flex: 1, backgroundColor: '#F4F6FB' }}>
        <ScreenHeader title="Expense" />
        <View style={{ padding: 24 }}>
          <Text style={{ color: colors.muted }}>Loading…</Text>
        </View>
      </View>
    );
  }

  const statusColor =
    exp.status === 'approved'
      ? '#059669'
      : exp.status === 'rejected'
      ? '#DC2626'
      : exp.status === 'verified'
      ? '#F59E0B'
      : colors.muted;
  const statusBg =
    exp.status === 'approved'
      ? '#DCFCE7'
      : exp.status === 'rejected'
      ? '#FEE2E2'
      : exp.status === 'verified'
      ? '#FEF3C7'
      : '#F3F4F6';

  return (
    <View style={{ flex: 1, backgroundColor: '#F4F6FB' }} testID="expense-detail">
      <ScreenHeader
        title="Expense Voucher"
        right={
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            {/* Print Header Button */}
            <Pressable
              onPress={handlePrint}
              hitSlop={8}
              style={styles.hdrBtn}
              testID="detail-print-btn"
            >
              <Ionicons name="print-outline" size={20} color="#0369A1" />
            </Pressable>

            {/* Edit Header Button */}
            <Pressable
              onPress={openEdit}
              hitSlop={8}
              style={styles.hdrBtn}
              testID="detail-edit-btn"
            >
              <Ionicons name="create-outline" size={20} color="#4338CA" />
            </Pressable>

            {user?.role === 'admin' ? (
              <Pressable onPress={remove} hitSlop={8} style={styles.hdrBtn}>
                <Ionicons name="trash-outline" size={20} color={colors.error} />
              </Pressable>
            ) : null}
          </View>
        }
      />

      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxxl }}>
        {/* Main Expense Details Card */}
        <View style={styles.card}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={styles.no}>{exp.expense_no || 'EXP'}</Text>
            <View style={[styles.badge, { backgroundColor: statusBg }]}>
              <Text style={[styles.badgeTxt, { color: statusColor }]}>{String(exp.status).toUpperCase()}</Text>
            </View>
          </View>
          <Text style={styles.title}>{exp.category}</Text>
          <Text style={styles.meta}>
            Date: <Text style={{ fontWeight: '700', color: '#1E293B' }}>{exp.date}</Text> • Mode:{' '}
            <Text style={{ fontWeight: '700', color: '#1E293B' }}>{String(exp.payment_mode).toUpperCase()}</Text>
          </Text>

          {exp.vendor ? (
            <Text style={styles.meta}>
              Paid To / Vendor: <Text style={{ fontWeight: '700', color: '#1E293B' }}>{exp.vendor}</Text>
            </Text>
          ) : null}

          {exp.description ? (
            <View style={styles.descBox}>
              <Text style={{ color: '#475569', fontSize: font.sm, lineHeight: 20 }}>{exp.description}</Text>
            </View>
          ) : null}

          <View style={styles.divider} />

          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ color: colors.muted, fontSize: font.base, fontWeight: '600' }}>Voucher Amount</Text>
            <Text style={styles.amt}>{inr(exp.amount)}</Text>
          </View>

          {/* Quick Action Buttons Row: Print & Edit */}
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
            <Pressable onPress={handlePrint} style={styles.actPrintBtn} testID="detail-card-print-btn">
              {printing ? (
                <ActivityIndicator size="small" color="#0369A1" />
              ) : (
                <>
                  <Ionicons name="print-outline" size={16} color="#0369A1" />
                  <Text style={styles.actPrintBtnTxt}>Print Voucher PDF</Text>
                </>
              )}
            </Pressable>

            <Pressable onPress={openEdit} style={styles.actEditBtn} testID="detail-card-edit-btn">
              <Ionicons name="create-outline" size={16} color="#4338CA" />
              <Text style={styles.actEditBtnTxt}>Edit Expense</Text>
            </Pressable>
          </View>
        </View>

        {/* Customer / Job / Passed On Details Card */}
        {(exp.customer_name || exp.customer_mobile || exp.customer_pan || exp.customer_gst || exp.sale_invoice_no) ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>CLIENT & LINKED SALE DETAILS</Text>

            {exp.customer_name ? (
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Client Name:</Text>
                <Text style={styles.detailVal}>{exp.customer_name}</Text>
              </View>
            ) : null}

            {exp.customer_mobile ? (
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Mobile No:</Text>
                <Text style={styles.detailVal}>{exp.customer_mobile}</Text>
              </View>
            ) : null}

            {exp.customer_pan ? (
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>PAN No:</Text>
                <Text style={[styles.detailVal, { color: '#B45309', fontWeight: '800' }]}>{exp.customer_pan}</Text>
              </View>
            ) : null}

            {exp.customer_gst ? (
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>GSTIN:</Text>
                <Text style={[styles.detailVal, { color: '#7E22CE', fontWeight: '800' }]}>{exp.customer_gst}</Text>
              </View>
            ) : null}

            {exp.sale_invoice_no ? (
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Linked Sale Invoice:</Text>
                <Text style={[styles.detailVal, { color: '#2563EB', fontWeight: '800' }]}>
                  {exp.sale_invoice_no} {exp.sale_item_name ? `(${exp.sale_item_name})` : ''}
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}

        {/* Workflow Approval / Verification */}
        {exp.status === 'pending' && (user?.role === 'admin' || user?.role === 'manager') ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>APPROVAL WORKFLOW</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Pressable
                testID="rej-btn"
                onPress={() => decide('reject')}
                style={[styles.wfBtn, { backgroundColor: '#FEE2E2' }]}
              >
                <Text style={{ color: '#DC2626', fontWeight: '800' }}>Reject</Text>
              </Pressable>
              <Pressable
                testID="ver-btn"
                onPress={() => decide('verify')}
                style={[styles.wfBtn, { backgroundColor: '#FEF3C7' }]}
              >
                <Text style={{ color: '#B45309', fontWeight: '800' }}>Verify</Text>
              </Pressable>
              {user?.role === 'admin' ? (
                <Pressable
                  testID="app-btn"
                  onPress={() => decide('approve')}
                  style={[styles.wfBtn, { backgroundColor: '#059669' }]}
                >
                  <Text style={{ color: '#FFF', fontWeight: '800' }}>Approve</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        ) : null}

        {exp.status === 'verified' && user?.role === 'admin' ? (
          <View style={styles.card}>
            <Pressable
              onPress={() => decide('approve')}
              style={[styles.wfBtn, { backgroundColor: '#059669' }]}
            >
              <Text style={{ color: '#FFF', fontWeight: '800' }}>Final Approve Voucher</Text>
            </Pressable>
          </View>
        ) : null}

        <AttachmentsSection
          attachments={exp.attachments || []}
          onChange={onAttachmentsChange}
          voucherKind="expenses"
          oid={exp.id}
          title="Bill / Receipt Attachments"
        />
      </ScrollView>

      {/* ================= EDIT & UPDATE MODAL ================= */}
      <Modal
        visible={editModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setEditModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent} testID="detail-edit-modal">
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>Edit Expense Voucher</Text>
                <Text style={styles.modalSubtitle}>{exp.expense_no || 'EXP'}</Text>
              </View>
              <Pressable
                onPress={() => setEditModalVisible(false)}
                style={styles.modalCloseBtn}
                hitSlop={8}
              >
                <Ionicons name="close" size={20} color="#64748B" />
              </Pressable>
            </View>

            <ScrollView style={{ maxHeight: 460 }} showsVerticalScrollIndicator={false}>
              <View style={styles.formSection}>
                <View style={styles.formRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.formLabel}>Amount (₹) *</Text>
                    <TextInput
                      style={[styles.formInput, { fontWeight: '800', color: '#DC2626' }]}
                      keyboardType="numeric"
                      value={editForm.amount}
                      onChangeText={(t) => setEditForm((p) => ({ ...p, amount: t }))}
                      placeholder="0.00"
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.formLabel}>Date (YYYY-MM-DD) *</Text>
                    <TextInput
                      style={styles.formInput}
                      value={editForm.date}
                      onChangeText={(t) => setEditForm((p) => ({ ...p, date: t }))}
                      placeholder="YYYY-MM-DD"
                    />
                  </View>
                </View>

                <View style={styles.formRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.formLabel}>Category *</Text>
                    <TextInput
                      style={styles.formInput}
                      value={editForm.category}
                      onChangeText={(t) => setEditForm((p) => ({ ...p, category: t }))}
                      placeholder="Category"
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

                <View>
                  <Text style={styles.formLabel}>Paid To / Vendor Name</Text>
                  <TextInput
                    style={styles.formInput}
                    value={editForm.vendor}
                    onChangeText={(t) => setEditForm((p) => ({ ...p, vendor: t }))}
                    placeholder="Vendor Name"
                  />
                </View>

                <View style={styles.subCard}>
                  <Text style={styles.subCardTitle}>Client / Customer Details</Text>
                  <View style={styles.formRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.formLabel}>Customer Name</Text>
                      <TextInput
                        style={styles.formInput}
                        value={editForm.customer_name}
                        onChangeText={(t) => setEditForm((p) => ({ ...p, customer_name: t }))}
                        placeholder="Customer Name"
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.formLabel}>Mobile No.</Text>
                      <TextInput
                        style={styles.formInput}
                        value={editForm.customer_mobile}
                        onChangeText={(t) => setEditForm((p) => ({ ...p, customer_mobile: t }))}
                        placeholder="Mobile"
                        keyboardType="phone-pad"
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
                        placeholder="PAN"
                        autoCapitalize="characters"
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.formLabel}>GST No.</Text>
                      <TextInput
                        style={[styles.formInput, { textTransform: 'uppercase' }]}
                        value={editForm.customer_gst}
                        onChangeText={(t) => setEditForm((p) => ({ ...p, customer_gst: t.toUpperCase() }))}
                        placeholder="GSTIN"
                        autoCapitalize="characters"
                      />
                    </View>
                  </View>
                </View>

                <View>
                  <Text style={styles.formLabel}>Narration / Description</Text>
                  <TextInput
                    style={[styles.formInput, { minHeight: 64, textAlignVertical: 'top' }]}
                    value={editForm.description}
                    onChangeText={(t) => setEditForm((p) => ({ ...p, description: t }))}
                    placeholder="Narration..."
                    multiline
                    numberOfLines={3}
                  />
                </View>
              </View>
            </ScrollView>

            <View style={styles.modalFooter}>
              <Pressable
                onPress={() => setEditModalVisible(false)}
                style={styles.cancelBtn}
                disabled={saving}
              >
                <Text style={styles.cancelBtnTxt}>Cancel</Text>
              </Pressable>

              <Pressable
                onPress={saveEdit}
                style={styles.saveBtn}
                disabled={saving}
                testID="detail-save-btn"
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
  hdrBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  no: { fontSize: font.xl, fontWeight: '900', color: '#111827' },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill },
  badgeTxt: { fontSize: 10, fontWeight: '900', letterSpacing: 0.5 },
  title: { fontSize: font.lg, fontWeight: '700', color: '#111827', marginTop: 4 },
  meta: { color: colors.muted, fontSize: font.sm, marginTop: 2 },
  descBox: {
    backgroundColor: '#F8FAFC',
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginTop: 4,
  },
  divider: { height: 1, backgroundColor: '#F1F5F9', marginVertical: 6 },
  amt: { fontSize: font.xl, fontWeight: '900', color: '#DC2626' },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 3,
  },
  detailLabel: {
    fontSize: font.sm,
    color: '#64748B',
  },
  detailVal: {
    fontSize: font.sm,
    fontWeight: '700',
    color: '#1E293B',
  },
  actPrintBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#F0F9FF',
    borderWidth: 1,
    borderColor: '#BAE6FD',
    paddingVertical: 10,
    borderRadius: radius.md,
  },
  actPrintBtnTxt: {
    color: '#0369A1',
    fontWeight: '800',
    fontSize: font.sm,
  },
  actEditBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#EEF2FF',
    borderWidth: 1,
    borderColor: '#C7D2FE',
    paddingVertical: 10,
    borderRadius: radius.md,
  },
  actEditBtnTxt: {
    color: '#4338CA',
    fontWeight: '800',
    fontSize: font.sm,
  },
  wfBtn: {
    flex: 1,
    paddingVertical: 10,
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
    maxWidth: 560,
    maxHeight: '92%',
    padding: spacing.lg,
    gap: 12,
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
