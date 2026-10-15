import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  RefreshControl,
  TextInput,
  Platform,
  Linking,
  ScrollView,
  Modal,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, font } from '@/src/theme';
import { api } from '@/src/api';
import { EmptyState, ScreenLoader } from '@/src/ui';
import { useAuth } from '@/src/AuthContext';
import { notify } from '@/src/dialog';

const TABS = [
  { id: 'all', label: 'All Vouchers' },
  { id: 'submitted', label: 'Pending Approval' },
  { id: 'verified', label: 'Verified' },
  { id: 'approved', label: 'Approved' },
  { id: 'returned', label: 'Returned' },
  { id: 'rejected', label: 'Rejected' },
];

export default function ExpenseApprovalListScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';

  const [vouchers, setVouchers] = useState<any[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState('all');
  const [q, setQ] = useState('');

  // Workflow Config Modal
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [config, setConfig] = useState<any>(null);
  const [savingConfig, setSavingConfig] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.getExpenseApprovals();
      setVouchers(Array.isArray(data) ? data : []);
    } catch {
      setVouchers([]);
    }
  }, []);

  const loadConfig = useCallback(async () => {
    try {
      const cfg = await api.getExpenseApprovalConfig();
      setConfig(cfg);
    } catch {}
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
      loadConfig();
    }, [load, loadConfig])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const handleSaveConfig = async () => {
    if (!config) return;
    setSavingConfig(true);
    try {
      await api.updateExpenseApprovalConfig(config);
      notify('Updated', 'Workflow configuration saved successfully');
      setShowConfigModal(false);
    } catch (e: any) {
      notify('Error', e?.message || 'Failed to update workflow configuration');
    } finally {
      setSavingConfig(false);
    }
  };

  const printVoucher = async (v: any) => {
    try {
      const url = await api.expenseApprovalPdfUrl(v.id);
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.open(url, '_blank');
      } else {
        await Linking.openURL(url);
      }
    } catch (e: any) {
      notify('Failed', e?.message || 'Could not open PDF voucher');
    }
  };

  const filtered = useMemo(() => {
    if (!vouchers) return null;
    const query = q.trim().toLowerCase();
    return vouchers.filter(v => {
      if (activeTab !== 'all' && v.status !== activeTab) return false;
      if (query) {
        const matchesVoucher = (v.voucher_no || '').toLowerCase().includes(query);
        const matchesCustomer = (v.customer_name || '').toLowerCase().includes(query);
        const matchesCode = (v.customer_code || '').toLowerCase().includes(query);
        const matchesSale = (v.sale_voucher_no || '').toLowerCase().includes(query);
        if (!matchesVoucher && !matchesCustomer && !matchesCode && !matchesSale) return false;
      }
      return true;
    });
  }, [vouchers, activeTab, q]);

  const stats = useMemo(() => {
    if (!vouchers) return { total: 0, pending: 0, approved: 0, returned: 0, rejected: 0, sumTotal: 0 };
    let pending = 0;
    let approved = 0;
    let returned = 0;
    let rejected = 0;
    let sumTotal = 0;

    vouchers.forEach(v => {
      const amt = Number(v.total_expense_amount || 0);
      sumTotal += amt;
      if (v.status === 'submitted' || v.status === 'verified') pending++;
      else if (v.status === 'approved') approved++;
      else if (v.status === 'returned') returned++;
      else if (v.status === 'rejected') rejected++;
    });

    return { total: vouchers.length, pending, approved, returned, rejected, sumTotal };
  }, [vouchers]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'approved': return { bg: '#DCFCE7', text: '#15803D', border: '#86EFAC' };
      case 'rejected': return { bg: '#FEE2E2', text: '#B91C1C', border: '#FCA5A5' };
      case 'returned': return { bg: '#FEF3C7', text: '#B45309', border: '#FCD34D' };
      case 'verified': return { bg: '#E0E7FF', text: '#4338CA', border: '#A5B4FC' };
      case 'draft': return { bg: '#F1F5F9', text: '#475569', border: '#CBD5E1' };
      default: return { bg: '#EFF6FF', text: '#1D4ED8', border: '#93C5FD' };
    }
  };

  return (
    <SafeAreaView edges={['top']} style={styles.root} testID="expense-approval-list-screen">
      {/* Top Header */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Pressable onPress={() => router.back()} hitSlop={8} style={styles.backBtn}>
              <Ionicons name="arrow-back" size={20} color="#0F172A" />
            </Pressable>
            <Text style={styles.h1}>Expense Approval</Text>
          </View>
          <Text style={styles.subTitle}>TDSC • Vyapar-Style Financial Suite Multi-Stage Approval</Text>
        </View>

        <View style={{ flexDirection: 'row', gap: 8 }}>
          {isAdmin ? (
            <Pressable
              onPress={() => setShowConfigModal(true)}
              style={styles.configBtn}
              testID="workflow-config-btn"
            >
              <Ionicons name="settings-outline" size={20} color={colors.brandPrimary} />
            </Pressable>
          ) : null}
          <Pressable
            testID="new-expense-approval-btn"
            style={styles.addBtn}
            onPress={() => router.push('/accounting/expenses/approval/new' as any)}
          >
            <Ionicons name="add" size={22} color="#FFF" />
          </Pressable>
        </View>
      </View>

      {/* Stats Summary Bar */}
      <View style={styles.statsBar}>
        <View style={styles.statPill}>
          <Text style={styles.statVal}>{stats.total}</Text>
          <Text style={styles.statLbl}>Vouchers</Text>
        </View>
        <View style={[styles.statPill, { backgroundColor: '#EFF6FF' }]}>
          <Text style={[styles.statVal, { color: '#1D4ED8' }]}>{stats.pending}</Text>
          <Text style={[styles.statLbl, { color: '#1D4ED8' }]}>Pending</Text>
        </View>
        <View style={[styles.statPill, { backgroundColor: '#DCFCE7' }]}>
          <Text style={[styles.statVal, { color: '#15803D' }]}>{stats.approved}</Text>
          <Text style={[styles.statLbl, { color: '#15803D' }]}>Approved</Text>
        </View>
        <View style={[styles.statPill, { backgroundColor: '#FEF3C7' }]}>
          <Text style={[styles.statVal, { color: '#B45309' }]}>{stats.returned}</Text>
          <Text style={[styles.statLbl, { color: '#B45309' }]}>Returned</Text>
        </View>
        <View style={[styles.statPill, { backgroundColor: '#FEE2E2' }]}>
          <Text style={[styles.statVal, { color: '#B91C1C' }]}>{stats.rejected}</Text>
          <Text style={[styles.statLbl, { color: '#B91C1C' }]}>Rejected</Text>
        </View>
      </View>

      {/* Search Input */}
      <View style={styles.searchBar}>
        <Ionicons name="search" size={18} color={colors.muted} />
        <TextInput
          testID="approval-search-input"
          value={q}
          onChangeText={setQ}
          placeholder="Search by Voucher No, Contractor, Sale Ref…"
          placeholderTextColor={colors.muted}
          style={styles.searchInput}
        />
        {q ? (
          <Pressable onPress={() => setQ('')} hitSlop={10}>
            <Ionicons name="close-circle" size={18} color={colors.muted} />
          </Pressable>
        ) : null}
      </View>

      {/* Filter Tabs */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabRow}>
        {TABS.map(t => {
          const isSel = activeTab === t.id;
          return (
            <Pressable
              key={t.id}
              onPress={() => setActiveTab(t.id)}
              style={[styles.tab, isSel && styles.tabActive]}
              testID={`tab-${t.id}`}
            >
              <Text style={[styles.tabTxt, isSel && styles.tabTxtActive]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* List */}
      {filtered === null ? (
        <ScreenLoader />
      ) : filtered.length === 0 ? (
        <EmptyState
          testID="expense-approval-empty"
          icon="document-text-outline"
          title="No vouchers found"
          subtitle={q ? 'No records matching search query' : 'Create your first expense approval claim voucher'}
          actionLabel="+ New Expense Approval"
          onAction={() => router.push('/accounting/expenses/approval/new' as any)}
        />
      ) : (
        <FlatList
          testID="expense-approval-list"
          data={filtered}
          keyExtractor={item => item.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          contentContainerStyle={{
            padding: spacing.lg,
            gap: spacing.md,
            paddingBottom: insets.bottom + 40,
          }}
          renderItem={({ item }) => {
            const sc = getStatusColor(item.status);
            const totAmt = Number(item.total_expense_amount || 0);
            const recAmt = Number(item.sale_received_amount || 0);
            const isCompliant = totAmt <= recAmt;

            return (
              <Pressable
                onPress={() => router.push(`/accounting/expenses/approval/${item.id}` as any)}
                testID={`approval-card-${item.id}`}
              >
                <View style={styles.card}>
                  {/* Top Bar: Voucher No & Status Badge */}
                  <View style={styles.cardHeader}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.cardVoucherNo}>{item.voucher_no}</Text>
                      <Text style={styles.cardDate}>Claim Date: {item.voucher_date || item.created_at}</Text>
                    </View>
                    <View style={[styles.statusBadge, { backgroundColor: sc.bg, borderColor: sc.border }]}>
                      <Text style={[styles.statusBadgeTxt, { color: sc.text }]}>
                        {String(item.status).toUpperCase()}
                      </Text>
                    </View>
                  </View>

                  {/* Contractor Row */}
                  <View style={styles.contractorRow}>
                    <Ionicons name="person-circle-outline" size={20} color={colors.brandPrimary} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.contractorName}>{item.customer_name}</Text>
                      {item.customer_code ? (
                        <Text style={styles.contractorCode}>ID: {item.customer_code}</Text>
                      ) : null}
                    </View>
                    {item.customer_mobile ? (
                      <View style={{ flexDirection: 'row', gap: 6 }}>
                        <Pressable
                          hitSlop={8}
                          onPress={(e) => {
                            e.stopPropagation();
                            Linking.openURL(`tel:${item.customer_mobile}`);
                          }}
                          style={styles.contactBtn}
                        >
                          <Ionicons name="call" size={13} color={colors.brandPrimary} />
                        </Pressable>
                        {item.customer_whatsapp ? (
                          <Pressable
                            hitSlop={8}
                            onPress={(e) => {
                              e.stopPropagation();
                              const clean = item.customer_whatsapp.replace(/\D/g, '');
                              const ph = clean.startsWith('91') ? clean : '91' + clean;
                              const msg = encodeURIComponent(
                                `Hello ${item.customer_name}, regarding Expense Voucher ${item.voucher_no} linked to ${item.sale_voucher_no}. Current status: ${item.status}.`
                              );
                              Linking.openURL(`https://wa.me/${ph}?text=${msg}`);
                            }}
                            style={[styles.contactBtn, { backgroundColor: '#DCFCE7' }]}
                          >
                            <Ionicons name="logo-whatsapp" size={13} color="#15803D" />
                          </Pressable>
                        ) : null}
                      </View>
                    ) : null}
                  </View>

                  {/* Linked Sale Voucher & Pass-On Rule */}
                  <View style={styles.saleBox}>
                    <View style={styles.saleRow}>
                      <Text style={styles.saleLbl}>Linked Sale Ref:</Text>
                      <Text style={styles.saleVal}>{item.sale_voucher_no} ({String(item.sale_voucher_type || 'Sale').toUpperCase()})</Text>
                    </View>
                    <View style={styles.saleRow}>
                      <Text style={styles.saleLbl}>Sale Received Amt:</Text>
                      <Text style={[styles.saleVal, { color: '#15803D', fontWeight: '800' }]}>
                        ₹ {recAmt.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                      </Text>
                    </View>
                    <View style={styles.saleRow}>
                      <Text style={styles.saleLbl}>Claimed Expense:</Text>
                      <Text style={[styles.saleVal, { color: colors.brandPrimary, fontWeight: '800' }]}>
                        ₹ {totAmt.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                      </Text>
                    </View>
                    <View style={styles.complianceRow}>
                      <Ionicons
                        name={isCompliant ? 'shield-checkmark' : 'alert-circle'}
                        size={14}
                        color={isCompliant ? '#15803D' : colors.error}
                      />
                      <Text style={[styles.complianceTxt, { color: isCompliant ? '#15803D' : colors.error }]}>
                        {isCompliant
                          ? 'Pass-On Rule Satisfied (Expense ≤ Received)'
                          : 'Exceeds Received Amount!'}
                      </Text>
                    </View>
                  </View>

                  {/* Line Item count summary */}
                  <View style={styles.itemCountRow}>
                    <Text style={styles.itemCountTxt}>
                      Line Items: {item.expenses?.length || 0} category heads
                    </Text>
                    <Text style={styles.prepTxt}>
                      Prepared by: {item.created_by?.name || 'Staff'}
                    </Text>
                  </View>

                  {/* Action Buttons */}
                  <View style={styles.cardActions}>
                    <Pressable
                      onPress={() => router.push(`/accounting/expenses/approval/${item.id}` as any)}
                      style={styles.btnDetails}
                    >
                      <Ionicons name="eye-outline" size={14} color={colors.brandPrimary} />
                      <Text style={styles.btnDetailsTxt}>View & Approve</Text>
                    </Pressable>

                    <Pressable onPress={() => printVoucher(item)} style={styles.btnPrint}>
                      <Ionicons name="print-outline" size={14} color="#334155" />
                      <Text style={styles.btnPrintTxt}>Voucher PDF</Text>
                    </Pressable>
                  </View>
                </View>
              </Pressable>
            );
          }}
        />
      )}

      {/* Admin Workflow Config Modal */}
      <Modal visible={showConfigModal} animationType="slide" transparent onRequestClose={() => setShowConfigModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard} testID="workflow-config-modal">
            <View style={styles.modalHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View style={styles.modalHeaderIcon}>
                  <Ionicons name="settings" size={18} color="#FFF" />
                </View>
                <View>
                  <Text style={styles.modalTitle}>Workflow Configuration</Text>
                  <Text style={styles.modalSub}>Stages & Self-Approval Policies</Text>
                </View>
              </View>
              <Pressable onPress={() => setShowConfigModal(false)} hitSlop={10}>
                <Ionicons name="close" size={22} color={colors.onSurface} />
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: 14 }}>
              <Text style={styles.cfgSectionTitle}>Approval Stages</Text>
              <Pressable
                onPress={() => setConfig((p: any) => ({ ...p, allow_verification_stage: !p?.allow_verification_stage }))}
                style={styles.cfgToggleRow}
              >
                <Ionicons
                  name={config?.allow_verification_stage ? 'checkbox' : 'square-outline'}
                  size={20}
                  color={colors.brandPrimary}
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.cfgToggleTitle}>Enable Verification Stage</Text>
                  <Text style={styles.cfgToggleSub}>Requires 2-level review: Submitted ➔ Verified ➔ Approved</Text>
                </View>
              </Pressable>

              <Text style={styles.cfgSectionTitle}>Fraud Prevention & Controls</Text>
              <Pressable
                onPress={() => setConfig((p: any) => ({ ...p, allow_self_approval: !p?.allow_self_approval }))}
                style={styles.cfgToggleRow}
              >
                <Ionicons
                  name={config?.allow_self_approval ? 'checkbox' : 'square-outline'}
                  size={20}
                  color={colors.brandPrimary}
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.cfgToggleTitle}>Allow Self-Approval</Text>
                  <Text style={styles.cfgToggleSub}>
                    {config?.allow_self_approval
                      ? 'Users can approve vouchers they created themselves'
                      : 'RESTRICTED (Recommended): A different approver must sign off on submitted claims'}
                  </Text>
                </View>
              </Pressable>
            </ScrollView>

            <View style={styles.modalFooter}>
              <Pressable onPress={() => setShowConfigModal(false)} style={styles.cancelBtn}>
                <Text style={styles.cancelBtnTxt}>Cancel</Text>
              </Pressable>
              <Pressable onPress={handleSaveConfig} style={styles.saveBtn} disabled={savingConfig}>
                {savingConfig ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <Text style={styles.saveBtnTxt}>Save Settings</Text>
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
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  backBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  h1: { fontSize: font.xl, fontWeight: '900', color: colors.onSurface, letterSpacing: -0.3 },
  subTitle: { fontSize: font.xs, color: colors.muted, marginTop: 2, marginLeft: 38 },
  addBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.brandPrimary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  configBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  statsBar: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    paddingVertical: 8,
    gap: 6,
  },
  statPill: {
    flex: 1,
    backgroundColor: '#FFF',
    paddingVertical: 6,
    paddingHorizontal: 4,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  statVal: { fontSize: 13, fontWeight: '900', color: colors.onSurface },
  statLbl: { fontSize: 9, color: colors.muted, marginTop: 1, fontWeight: '600' },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFF',
    marginHorizontal: spacing.lg,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchInput: { flex: 1, fontSize: font.sm, color: colors.onSurface },
  tabRow: {
    paddingHorizontal: spacing.lg,
    paddingVertical: 8,
    gap: 6,
  },
  tab: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  tabActive: {
    backgroundColor: colors.brandPrimary,
    borderColor: colors.brandPrimary,
  },
  tabTxt: { fontSize: 11, fontWeight: '700', color: '#475569' },
  tabTxtActive: { color: '#FFF' },

  // Card Styles
  card: {
    backgroundColor: '#FFF',
    borderRadius: radius.xl,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 10,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  cardVoucherNo: { fontSize: font.base, fontWeight: '800', color: colors.onSurface },
  cardDate: { fontSize: 11, color: colors.muted, marginTop: 1 },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  statusBadgeTxt: { fontSize: 10, fontWeight: '900' },
  contractorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#F8FAFC',
    padding: 8,
    borderRadius: radius.md,
  },
  contractorName: { fontSize: font.sm, fontWeight: '800', color: colors.onSurface },
  contractorCode: { fontSize: 10, color: colors.muted },
  contactBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  saleBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: radius.md,
    padding: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 4,
  },
  saleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  saleLbl: { fontSize: 11, color: colors.muted, fontWeight: '600' },
  saleVal: { fontSize: 11, color: colors.onSurface, fontWeight: '700' },
  complianceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
  },
  complianceTxt: { fontSize: 10, fontWeight: '700' },
  itemCountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
  },
  itemCountTxt: { fontSize: 11, color: '#475569', fontWeight: '600' },
  prepTxt: { fontSize: 10, color: colors.muted },
  cardActions: {
    flexDirection: 'row',
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingTop: 8,
  },
  btnDetails: {
    flex: 1.3,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: '#EFF6FF',
    paddingVertical: 8,
    borderRadius: 6,
  },
  btnDetailsTxt: { color: colors.brandPrimary, fontWeight: '800', fontSize: 12 },
  btnPrint: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: '#F1F5F9',
    paddingVertical: 8,
    borderRadius: 6,
  },
  btnPrintTxt: { color: '#334155', fontWeight: '800', fontSize: 12 },

  // Config Modal
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
  cfgSectionTitle: { fontSize: 12, fontWeight: '800', color: '#475569', textTransform: 'uppercase' },
  cfgToggleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: '#F8FAFC',
    padding: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  cfgToggleTitle: { fontSize: font.sm, fontWeight: '700', color: colors.onSurface },
  cfgToggleSub: { fontSize: 11, color: colors.muted, marginTop: 2 },
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
  cancelBtnTxt: { color: colors.onSurface, fontWeight: '700', fontSize: font.base },
  saveBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brandPrimary,
    paddingVertical: 12,
    borderRadius: radius.md,
  },
  saveBtnTxt: { color: '#FFF', fontWeight: '800', fontSize: font.base },
});
