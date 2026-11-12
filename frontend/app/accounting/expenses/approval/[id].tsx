import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Modal,
  TextInput,
  Linking,
  Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, font } from '@/src/theme';
import { api } from '@/src/api';
import { notify, confirm } from '@/src/dialog';
import { useAuth } from '@/src/AuthContext';
import { ScreenLoader } from '@/src/ui';

export default function ExpenseApprovalDetailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();

  const [voucher, setVoucher] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);

  // Action Modal (Reject / Return)
  const [actionModal, setActionModal] = useState<{ open: boolean; type: 'reject' | 'return' | null }>({
    open: false,
    type: null,
  });
  const [remarks, setRemarks] = useState('');
  const [modalErr, setModalErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const data = await api.getExpenseApproval(String(id));
      setVoucher(data);
    } catch (e: any) {
      notify('Error', e?.message || 'Could not load expense voucher');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const printPdf = async () => {
    if (!voucher) return;
    try {
      const url = await api.expenseApprovalPdfUrl(voucher.id);
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.open(url, '_blank');
      } else {
        await Linking.openURL(url);
      }
    } catch (e: any) {
      notify('Failed', e?.message || 'Could not open PDF voucher');
    }
  };

  const isCreator = (user?.user_id && user.user_id === voucher?.created_by?.user_id) || ((user as any)?.id && (user as any).id === voucher?.created_by?.user_id);
  const isSuperAdmin = user?.role === 'super_admin';
  const isApproverRole = user?.role === 'admin' || user?.role === 'super_admin' || user?.role === 'manager';
  const canApprove = isApproverRole && (!isCreator || isSuperAdmin);

  const handleApprove = async () => {
    if (!voucher) return;
    const ok = await confirm(
      'Approve Expense Voucher?',
      `Confirm approval for voucher ${voucher.voucher_no} of amount ₹${Number(voucher.total_expense_amount || 0).toLocaleString('en-IN')}. This will post to the accounting ledger.`,
      { confirmText: 'Approve Voucher', destructive: false }
    );
    if (!ok) return;

    setActing(true);
    try {
      await api.expenseApprovalAction(voucher.id, 'approve', 'Approved by authorized personnel');
      notify('Approved', `Voucher ${voucher.voucher_no} approved ✓`);
      await load();
    } catch (e: any) {
      notify('Error', e?.message || 'Approval failed');
    } finally {
      setActing(false);
    }
  };

  const handleVerify = async () => {
    if (!voucher) return;
    setActing(true);
    try {
      await api.expenseApprovalAction(voucher.id, 'verify', 'Verified by accounts team');
      notify('Verified', `Voucher ${voucher.voucher_no} verified ✓`);
      await load();
    } catch (e: any) {
      notify('Error', e?.message || 'Verification failed');
    } finally {
      setActing(false);
    }
  };

  const handleModalSubmit = async () => {
    if (!voucher || !actionModal.type) return;
    if (!remarks.trim()) {
      setModalErr('Remarks / reason is mandatory');
      return;
    }
    setActing(true);
    setModalErr(null);
    try {
      await api.expenseApprovalAction(voucher.id, actionModal.type, remarks.trim());
      notify(
        actionModal.type === 'reject' ? 'Rejected' : 'Returned',
        `Voucher ${voucher.voucher_no} ${actionModal.type === 'reject' ? 'rejected' : 'returned for correction'}`
      );
      setActionModal({ open: false, type: null });
      setRemarks('');
      await load();
    } catch (e: any) {
      setModalErr(e?.message || 'Action failed');
    } finally {
      setActing(false);
    }
  };

  if (loading || !voucher) {
    return <ScreenLoader />;
  }

  const status = voucher.status || 'submitted';
  const statusColor =
    status === 'approved'
      ? { bg: '#DCFCE7', text: '#15803D', border: '#86EFAC' }
      : status === 'rejected'
      ? { bg: '#FEE2E2', text: '#B91C1C', border: '#FCA5A5' }
      : status === 'returned'
      ? { bg: '#FEF3C7', text: '#B45309', border: '#FCD34D' }
      : status === 'verified'
      ? { bg: '#E0E7FF', text: '#4338CA', border: '#A5B4FC' }
      : { bg: '#EFF6FF', text: '#1D4ED8', border: '#93C5FD' };

  const recAmt = Number(voucher.sale_received_amount || 0);
  const totExp = Number(voucher.total_expense_amount || 0);
  const isCompliant = totExp <= recAmt;

  return (
    <SafeAreaView edges={['top']} style={styles.root} testID="expense-approval-detail-screen">
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={20} color="#0F172A" />
        </Pressable>
        <View style={{ flex: 1, marginLeft: 10 }}>
          <Text style={styles.h1}>{voucher.voucher_no}</Text>
          <Text style={styles.subTitle}>Date: {voucher.voucher_date || voucher.created_at}</Text>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: statusColor.bg, borderColor: statusColor.border }]}>
          <Text style={[styles.statusBadgeTxt, { color: statusColor.text }]}>{status.toUpperCase()}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 60 }]}>
        
        {/* Quick Contact & Action Toolbar */}
        <View style={styles.actionToolbar}>
          {voucher.customer_mobile ? (
            <Pressable
              onPress={() => Linking.openURL(`tel:${voucher.customer_mobile}`)}
              style={styles.toolbarBtn}
              testID="call-contractor-btn"
            >
              <Ionicons name="call" size={16} color={colors.brandPrimary} />
              <Text style={styles.toolbarBtnTxt}>Call</Text>
            </Pressable>
          ) : null}

          {voucher.customer_whatsapp || voucher.customer_mobile ? (
            <Pressable
              onPress={() => {
                const raw = voucher.customer_whatsapp || voucher.customer_mobile;
                const clean = raw.replace(/\D/g, '');
                const ph = clean.startsWith('91') ? clean : '91' + clean;
                const msg = encodeURIComponent(
                  `Hello ${voucher.customer_name}, regarding TDSC Expense Approval Voucher ${voucher.voucher_no} (linked to sale ref ${voucher.sale_voucher_no}). Current status: ${voucher.status}. Claimed amount: ₹${totExp.toLocaleString('en-IN')}.`
                );
                Linking.openURL(`https://wa.me/${ph}?text=${msg}`);
              }}
              style={[styles.toolbarBtn, { backgroundColor: '#DCFCE7', borderColor: '#BBF7D0' }]}
              testID="whatsapp-contractor-btn"
            >
              <Ionicons name="logo-whatsapp" size={16} color="#15803D" />
              <Text style={[styles.toolbarBtnTxt, { color: '#15803D' }]}>WhatsApp</Text>
            </Pressable>
          ) : null}

          <Pressable onPress={printPdf} style={styles.toolbarBtn} testID="print-voucher-btn">
            <Ionicons name="print-outline" size={16} color="#334155" />
            <Text style={[styles.toolbarBtnTxt, { color: '#334155' }]}>Print PDF</Text>
          </Pressable>
        </View>

        {/* Section 1: Contractor Information */}
        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <Ionicons name="person-circle" size={20} color={colors.brandPrimary} />
            <Text style={styles.cardTitle}>Contractor Information</Text>
          </View>
          <View style={styles.infoRow}><Text style={styles.infoLbl}>Name:</Text><Text style={styles.infoVal}>{voucher.customer_name}</Text></View>
          <View style={styles.infoRow}><Text style={styles.infoLbl}>Customer Code:</Text><Text style={styles.infoVal}>{voucher.customer_code || voucher.customer_id}</Text></View>
          <View style={styles.infoRow}><Text style={styles.infoLbl}>Mobile:</Text><Text style={styles.infoVal}>{voucher.customer_mobile || '—'}</Text></View>
          <View style={styles.infoRow}><Text style={styles.infoLbl}>PAN No:</Text><Text style={styles.infoVal}>{voucher.customer_pan || '—'}</Text></View>
        </View>

        {/* Section 2: Linked Sale Voucher Details */}
        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <Ionicons name="receipt" size={20} color="#2563EB" />
            <Text style={styles.cardTitle}>Linked Sale Voucher & Settlement</Text>
          </View>
          <View style={styles.infoRow}><Text style={styles.infoLbl}>Sale Voucher Ref:</Text><Text style={[styles.infoVal, { fontWeight: '800' }]}>{voucher.sale_voucher_no} ({String(voucher.sale_voucher_type || 'Sale').toUpperCase()})</Text></View>
          <View style={styles.infoRow}><Text style={styles.infoLbl}>Sale Voucher Amount:</Text><Text style={styles.infoVal}>₹ {Number(voucher.sale_voucher_amount || 0).toLocaleString('en-IN')}</Text></View>
          <View style={styles.infoRow}><Text style={styles.infoLbl}>Amount Received:</Text><Text style={[styles.infoVal, { color: '#15803D', fontWeight: '800' }]}>₹ {recAmt.toLocaleString('en-IN')}</Text></View>
          <View style={styles.infoRow}><Text style={styles.infoLbl}>Unpaid Balance:</Text><Text style={styles.infoVal}>₹ {Number(voucher.sale_unpaid_amount || 0).toLocaleString('en-IN')}</Text></View>
          
          <View style={[styles.complianceBox, { backgroundColor: isCompliant ? '#F0FDF4' : '#FEF2F2', borderColor: isCompliant ? '#BBF7D0' : '#FECACA' }]}>
            <Ionicons name={isCompliant ? 'shield-checkmark' : 'alert-circle'} size={16} color={isCompliant ? '#15803D' : colors.error} />
            <Text style={[styles.complianceTxt, { color: isCompliant ? '#15803D' : colors.error }]}>
              {isCompliant
                ? `✓ Pass-On Rule Satisfied (Expense ₹${totExp.toLocaleString('en-IN')} ≤ Received ₹${recAmt.toLocaleString('en-IN')})`
                : '✕ Pass-On Rule Violation: Total expense exceeds received amount!'}
            </Text>
          </View>
        </View>

        {/* Section 3: Itemized Expenses */}
        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <Ionicons name="list" size={20} color="#7C3AED" />
            <Text style={styles.cardTitle}>Itemized Expense Breakdown</Text>
          </View>

          <View style={styles.tableHeader}>
            <Text style={[styles.thTxt, { flex: 2 }]}>Head / Particulars</Text>
            <Text style={[styles.thTxt, { width: 40, textAlign: 'center' }]}>Qty</Text>
            <Text style={[styles.thTxt, { width: 70, textAlign: 'right' }]}>Rate</Text>
            <Text style={[styles.thTxt, { width: 80, textAlign: 'right' }]}>Amount</Text>
          </View>

          {(voucher.expenses || []).map((it: any, idx: number) => (
            <View key={it.id || idx} style={styles.tableRow}>
              <View style={{ flex: 2 }}>
                <Text style={styles.itemHead}>{it.head}</Text>
                {it.description ? <Text style={styles.itemDesc}>{it.description}</Text> : null}
              </View>
              <Text style={[styles.tdTxt, { width: 40, textAlign: 'center' }]}>{it.qty || 1}</Text>
              <Text style={[styles.tdTxt, { width: 70, textAlign: 'right' }]}>₹ {Number(it.rate || 0).toLocaleString('en-IN')}</Text>
              <Text style={[styles.tdTxt, { width: 80, textAlign: 'right', fontWeight: '800' }]}>
                ₹ {Number(it.amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </Text>
            </View>
          ))}

          <View style={styles.totalRow}>
            <Text style={styles.totalLbl}>Total Claimed Amount</Text>
            <Text style={styles.totalVal}>₹ {totExp.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</Text>
          </View>

          {voucher.notes ? (
            <View style={styles.notesBox}>
              <Text style={styles.notesLbl}>Auditor / Submitter Notes:</Text>
              <Text style={styles.notesTxt}>{voucher.notes}</Text>
            </View>
          ) : null}
        </View>

        {/* Section 4: Workflow Audit Trail Timeline */}
        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <Ionicons name="time" size={20} color="#059669" />
            <Text style={styles.cardTitle}>Approval Workflow & Audit Timeline</Text>
          </View>

          <View style={{ gap: 12, marginTop: 4 }}>
            {(voucher.workflow_history || []).map((ev: any, idx: number) => (
              <View key={idx} style={styles.timelineItem}>
                <View style={styles.timelineDot} />
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={styles.timelineAction}>{String(ev.action).toUpperCase()}</Text>
                    <Text style={styles.timelineTime}>{ev.timestamp || '—'}</Text>
                  </View>
                  <Text style={styles.timelineActor}>
                    By: {ev.actor?.name || 'Staff'} ({ev.actor?.role || 'Staff'})
                  </Text>
                  {ev.remarks ? <Text style={styles.timelineRemarks}>"{ev.remarks}"</Text> : null}
                </View>
              </View>
            ))}
          </View>
        </View>

        {/* Approver Action Panel */}
        {status === 'submitted' || status === 'verified' || status === 'returned' ? (
          <View style={styles.approvalPanel}>
            <Text style={styles.panelTitle}>Approver Actions</Text>

            {isCreator && !isSuperAdmin ? (
              <View style={styles.selfApprovalWarning}>
                <Ionicons name="information-circle" size={18} color="#B45309" />
                <Text style={styles.selfApprovalWarningTxt}>
                  Self-approval restricted: You submitted this voucher. Another manager or admin must review and approve it.
                </Text>
              </View>
            ) : null}

            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              {canApprove && (status === 'submitted' || status === 'verified') ? (
                <Pressable
                  onPress={handleApprove}
                  style={[styles.btnApprove, acting && { opacity: 0.6 }]}
                  disabled={acting}
                  testID="action-approve-btn"
                >
                  <Ionicons name="checkmark-circle" size={16} color="#FFF" />
                  <Text style={styles.btnApproveTxt}>Approve Voucher</Text>
                </Pressable>
              ) : null}

              {canApprove && status === 'submitted' ? (
                <Pressable
                  onPress={handleVerify}
                  style={[styles.btnVerify, acting && { opacity: 0.6 }]}
                  disabled={acting}
                  testID="action-verify-btn"
                >
                  <Ionicons name="shield-checkmark-outline" size={16} color="#4338CA" />
                  <Text style={styles.btnVerifyTxt}>Verify</Text>
                </Pressable>
              ) : null}

              {canApprove && status !== 'rejected' ? (
                <Pressable
                  onPress={() => { setRemarks(''); setModalErr(null); setActionModal({ open: true, type: 'return' }); }}
                  style={styles.btnReturn}
                  disabled={acting}
                  testID="action-return-btn"
                >
                  <Ionicons name="return-down-back" size={16} color="#B45309" />
                  <Text style={styles.btnReturnTxt}>Return</Text>
                </Pressable>
              ) : null}

              {canApprove && status !== 'rejected' ? (
                <Pressable
                  onPress={() => { setRemarks(''); setModalErr(null); setActionModal({ open: true, type: 'reject' }); }}
                  style={styles.btnReject}
                  disabled={acting}
                  testID="action-reject-btn"
                >
                  <Ionicons name="close-circle" size={16} color="#B91C1C" />
                  <Text style={styles.btnRejectTxt}>Reject</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        ) : null}
      </ScrollView>

      {/* Action Dialog Modal (Reject / Return) */}
      <Modal visible={actionModal.open} transparent animationType="fade" onRequestClose={() => setActionModal({ open: false, type: null })}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard} testID="action-reason-modal">
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {actionModal.type === 'reject' ? 'Reject Expense Voucher' : 'Return for Correction'}
              </Text>
              <Pressable onPress={() => setActionModal({ open: false, type: null })}>
                <Ionicons name="close" size={22} color={colors.onSurface} />
              </Pressable>
            </View>

            <View style={{ padding: spacing.lg, gap: 10 }}>
              <Text style={styles.modalPrompt}>
                {actionModal.type === 'reject'
                  ? 'Please state the reason for rejecting this claim (mandatory):'
                  : 'Please state the corrections required before resubmission (mandatory):'}
              </Text>
              <TextInput
                value={remarks}
                onChangeText={setRemarks}
                placeholder="Enter detailed reason / instructions…"
                placeholderTextColor={colors.muted}
                style={[styles.modalInput, { height: 90 }]}
                multiline
                autoFocus
                testID="action-remarks-input"
              />

              {modalErr ? <Text style={styles.modalErrTxt}>{modalErr}</Text> : null}
            </View>

            <View style={styles.modalFooter}>
              <Pressable onPress={() => setActionModal({ open: false, type: null })} style={styles.cancelBtn}>
                <Text style={styles.cancelBtnTxt}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={handleModalSubmit}
                style={[
                  styles.confirmBtn,
                  { backgroundColor: actionModal.type === 'reject' ? colors.error : '#D97706' },
                  acting && { opacity: 0.6 }
                ]}
                disabled={acting}
                testID="action-submit-btn"
              >
                {acting ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <Text style={styles.confirmBtnTxt}>Confirm {actionModal.type === 'reject' ? 'Reject' : 'Return'}</Text>
                )}
              </Pressable>
            </View>
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
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  statusBadgeTxt: { fontSize: 11, fontWeight: '900' },
  body: { padding: spacing.lg, gap: 14 },

  actionToolbar: {
    flexDirection: 'row',
    gap: 8,
  },
  toolbarBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    paddingVertical: 10,
    borderRadius: radius.md,
  },
  toolbarBtnTxt: { fontSize: font.sm, fontWeight: '800', color: colors.brandPrimary },

  card: {
    backgroundColor: '#FFF',
    borderRadius: radius.xl,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 8,
  },
  cardHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  cardTitle: { fontSize: font.base, fontWeight: '800', color: colors.onSurface },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  infoLbl: { fontSize: font.sm, color: colors.muted, fontWeight: '600' },
  infoVal: { fontSize: font.sm, color: colors.onSurface, fontWeight: '600' },

  complianceBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    padding: 10,
    borderRadius: radius.md,
    borderWidth: 1,
    marginTop: 6,
  },
  complianceTxt: { fontSize: 11, fontWeight: '800', flex: 1 },

  // Table
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#F8FAFC',
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginTop: 4,
  },
  thTxt: { fontSize: 11, fontWeight: '800', color: '#475569' },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  itemHead: { fontSize: font.sm, fontWeight: '700', color: colors.onSurface },
  itemDesc: { fontSize: 10, color: colors.muted, marginTop: 1 },
  tdTxt: { fontSize: font.sm, color: colors.onSurface },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 10,
    marginTop: 6,
    borderTopWidth: 2,
    borderTopColor: colors.border,
  },
  totalLbl: { fontSize: font.base, fontWeight: '800', color: colors.onSurface },
  totalVal: { fontSize: font.lg, fontWeight: '900', color: colors.brandPrimary },

  notesBox: {
    backgroundColor: '#F8FAFC',
    padding: 10,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginTop: 4,
  },
  notesLbl: { fontSize: 10, fontWeight: '700', color: colors.muted },
  notesTxt: { fontSize: 11, color: colors.onSurface, marginTop: 2 },

  // Timeline
  timelineItem: {
    flexDirection: 'row',
    gap: 10,
    borderLeftWidth: 2,
    borderLeftColor: colors.brandPrimary,
    paddingLeft: 12,
    marginLeft: 6,
    paddingVertical: 4,
  },
  timelineDot: {
    position: 'absolute',
    left: -17,
    top: 6,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.brandPrimary,
  },
  timelineAction: { fontSize: 12, fontWeight: '900', color: colors.onSurface },
  timelineTime: { fontSize: 10, color: colors.muted },
  timelineActor: { fontSize: 11, color: '#475569', marginTop: 1 },
  timelineRemarks: { fontSize: 11, fontStyle: 'italic', color: '#334155', marginTop: 2 },

  // Approval Panel
  approvalPanel: {
    backgroundColor: '#FFF',
    borderRadius: radius.xl,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 10,
  },
  panelTitle: { fontSize: font.base, fontWeight: '800', color: colors.onSurface },
  selfApprovalWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FEF3C7',
    padding: 10,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  selfApprovalWarningTxt: { fontSize: 11, color: '#92400E', fontWeight: '700', flex: 1 },
  btnApprove: {
    flex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#15803D',
    paddingVertical: 12,
    borderRadius: radius.md,
  },
  btnApproveTxt: { color: '#FFF', fontWeight: '800', fontSize: font.sm },
  btnVerify: {
    flex: 1.2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: '#EEF2FF',
    borderWidth: 1,
    borderColor: '#C7D2FE',
    paddingVertical: 12,
    borderRadius: radius.md,
  },
  btnVerifyTxt: { color: '#4338CA', fontWeight: '800', fontSize: font.sm },
  btnReturn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FDE68A',
    paddingVertical: 12,
    borderRadius: radius.md,
  },
  btnReturnTxt: { color: '#B45309', fontWeight: '800', fontSize: font.sm },
  btnReject: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: '#FEE2E2',
    borderWidth: 1,
    borderColor: '#FECACA',
    paddingVertical: 12,
    borderRadius: radius.md,
  },
  btnRejectTxt: { color: '#B91C1C', fontWeight: '800', fontSize: font.sm },

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
    maxWidth: 440,
    backgroundColor: '#FFF',
    borderRadius: radius.xl,
    overflow: 'hidden',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  modalTitle: { fontSize: font.base, fontWeight: '800', color: colors.onSurface },
  modalPrompt: { fontSize: font.sm, color: colors.onSurface, fontWeight: '600' },
  modalInput: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 10,
    fontSize: font.sm,
    textAlignVertical: 'top',
    color: colors.onSurface,
  },
  modalErrTxt: { color: colors.error, fontSize: 11, fontWeight: '700' },
  modalFooter: {
    flexDirection: 'row',
    gap: 10,
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtnTxt: { color: colors.onSurface, fontWeight: '700', fontSize: font.sm },
  confirmBtn: {
    flex: 1.5,
    paddingVertical: 12,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmBtnTxt: { color: '#FFF', fontWeight: '800', fontSize: font.sm },
});
