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
import { useRouter, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, font } from '@/src/theme';
import { api } from '@/src/api';
import { EmptyState, ScreenLoader } from '@/src/ui';
import { useAuth } from '@/src/AuthContext';
import { notify, confirm } from '@/src/dialog';

const TABS = [
  { id: 'all', label: 'All Vouchers' },
  { id: 'submitted', label: 'Pending Approval' },
  { id: 'approved', label: 'Approved Expenses' },
  { id: 'verified', label: 'Verified' },
  { id: 'returned', label: 'Returned' },
  { id: 'rejected', label: 'Rejected' },
];

const AVAILABLE_ROLES = [
  { key: 'accountant', label: 'Accountant' },
  { key: 'manager', label: 'Manager' },
  { key: 'branch_manager', label: 'Branch Manager' },
  { key: 'admin', label: 'Admin' },
  { key: 'super_admin', label: 'Super Admin' },
];

export default function ExpenseApprovalListScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';
  const params = useLocalSearchParams<{ accounting?: string; is_old_accounting?: string }>();
  const isOldParam = params?.accounting === 'old' || params?.is_old_accounting === 'true';
  const [accountingFilter, setAccountingFilter] = useState<'all' | 'new' | 'old'>(isOldParam ? 'old' : 'all');

  useEffect(() => {
    if (params?.accounting === 'old' || params?.is_old_accounting === 'true') {
      setAccountingFilter('old');
    }
  }, [params?.accounting, params?.is_old_accounting]);

  const [vouchers, setVouchers] = useState<any[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState('all');
  const [q, setQ] = useState('');
  const [approvingId, setApprovingId] = useState<string | null>(null);

  // Workflow Config Modal
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [config, setConfig] = useState<any>(null);
  const [savingConfig, setSavingConfig] = useState(false);
  const [candidates, setCandidates] = useState<any[]>([]);
  const [candidateModal, setCandidateModal] = useState<{ open: boolean; stage: 1 | 2 | null }>({
    open: false,
    stage: null,
  });
  const [candidateQ, setCandidateQ] = useState('');

  const load = useCallback(async () => {
    try {
      const qry: any = {};
      if (accountingFilter === 'old') qry.is_old_accounting = true;
      else if (accountingFilter === 'new') qry.is_old_accounting = false;
      const data = await api.getExpenseApprovals(qry);
      setVouchers(Array.isArray(data) ? data : []);
    } catch {
      setVouchers([]);
    }
  }, [accountingFilter]);

  const loadConfig = useCallback(async () => {
    try {
      const [cfg, users] = await Promise.all([
        api.getExpenseApprovalConfig(),
        api.getApproverCandidates().catch(() => []),
      ]);
      setConfig(cfg || {});
      setCandidates(Array.isArray(users) ? users : []);
    } catch {}
  }, []);

  const toggleRoleInStage = (stage: 1 | 2, roleKey: string) => {
    setConfig((prev: any) => {
      const field = stage === 1 ? 'stage_1_roles' : 'stage_2_roles';
      const current = prev?.[field] || (stage === 1 ? ['accountant', 'manager', 'admin'] : ['admin', 'super_admin']);
      const next = current.includes(roleKey)
        ? current.filter((r: string) => r !== roleKey)
        : [...current, roleKey];
      return { ...prev, [field]: next };
    });
  };

  const addEmployeeToStage = (stage: 1 | 2, emp: any) => {
    setConfig((prev: any) => {
      const field = stage === 1 ? 'stage_1_users' : 'stage_2_users';
      const current: any[] = prev?.[field] || [];
      if (current.some(u => u.user_id === emp.user_id)) return prev;
      return {
        ...prev,
        [field]: [...current, { user_id: emp.user_id, name: emp.name, role: emp.role, department: emp.department }],
      };
    });
    setCandidateModal({ open: false, stage: null });
  };

  const removeEmployeeFromStage = (stage: 1 | 2, userId: string) => {
    setConfig((prev: any) => {
      const field = stage === 1 ? 'stage_1_users' : 'stage_2_users';
      const current: any[] = prev?.[field] || [];
      return {
        ...prev,
        [field]: current.filter(u => u.user_id !== userId),
      };
    });
  };

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

  const handleCardDelete = async (v: any) => {
    const ok = await confirm(
      'Delete Expense Voucher?',
      `Are you sure you want to delete voucher ${v.voucher_no}? Any linked expense posted in the accounting ledger will also be removed. This cannot be undone.`,
      { confirmText: 'Delete Permanently', destructive: true }
    );
    if (!ok) return;
    try {
      await api.deleteExpenseApproval(v.id);
      notify('Deleted', `Voucher ${v.voucher_no} deleted successfully`);
      load();
    } catch (e: any) {
      notify('Error', e?.message || 'Failed to delete voucher');
    }
  };

  const handleCardReopen = async (v: any) => {
    const ok = await confirm(
      'Reopen Expense Voucher?',
      `Reopening voucher ${v.voucher_no} will change its status back to Submitted and automatically remove any posted ledger expense. Continue?`,
      { confirmText: 'Reopen Voucher', destructive: false }
    );
    if (!ok) return;
    try {
      await api.reopenExpenseApproval(v.id, 'Reopened by Admin from Voucher List');
      notify('Reopened', `Voucher ${v.voucher_no} is now reopened and set to Submitted`);
      load();
    } catch (e: any) {
      notify('Error', e?.message || 'Failed to reopen voucher');
    }
  };

  const handleQuickApprove = async (v: any) => {
    const amtStr = Number(v.total_expense_amount || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
    const ok = await confirm(
      'Approve Expense?',
      `Are you sure you want to approve Expense Voucher "${v.voucher_no}" for ₹${amtStr}? This will automatically post to the accounting ledger and seed into All Expenses.`,
      { confirmText: 'Approve Expense', destructive: false }
    );
    if (!ok) return;

    setApprovingId(v.id);
    try {
      await api.expenseApprovalAction(v.id, 'approve', 'Approved from Expense Approval screen');
      notify('Approved', `Expense ${v.voucher_no} has been approved successfully ✓`);
      await load();
    } catch (e: any) {
      notify('Approval Failed', e?.message || 'Could not approve expense');
    } finally {
      setApprovingId(null);
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
            <Text style={styles.h1}>{accountingFilter === 'old' || isOldParam ? 'Old Expences approval' : 'Expense Approval'}</Text>
            {accountingFilter === 'old' && (
              <View style={{ backgroundColor: '#F3E8FF', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, borderWidth: 1, borderColor: '#D8B4FE' }}>
                <Text style={{ fontSize: 10, fontWeight: '700', color: '#7C3AED' }}>📜 Old Stream</Text>
              </View>
            )}
          </View>
          <Text style={styles.subTitle}>TDSC • Vyapar-Style Financial Suite Multi-Stage Approval</Text>
        </View>

        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <Pressable
            onPress={() => router.push('/accounting/expenses' as any)}
            style={styles.allExpShortcutBtn}
            testID="nav-all-expenses-btn"
          >
            <Ionicons name="list" size={16} color={colors.brandPrimary} />
            <Text style={styles.allExpShortcutBtnTxt}>All Expenses</Text>
          </Pressable>

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
            onPress={() => router.push(accountingFilter === 'old' ? ('/accounting/expenses/approval/new?accounting=old' as any) : ('/accounting/expenses/approval/new' as any))}
          >
            <Ionicons name="add" size={22} color="#FFF" />
          </Pressable>
        </View>
      </View>

      {/* Scope Switcher Pills */}
      <View style={{ flexDirection: 'row', backgroundColor: '#FFF', paddingHorizontal: 16, paddingVertical: 8, gap: 8, borderBottomWidth: 1, borderBottomColor: '#E2E8F0' }}>
        {[
          { key: 'all', label: 'All Approvals (Consolidated)', icon: 'globe-outline' },
          { key: 'new', label: 'New Approvals', icon: 'flash' },
          { key: 'old', label: 'Old Approvals', icon: 'time' },
        ].map(opt => (
          <Pressable
            key={opt.key}
            onPress={() => setAccountingFilter(opt.key as any)}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: 5,
              paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
              backgroundColor: accountingFilter === opt.key ? (opt.key === 'old' ? '#7C3AED' : '#2563EB') : '#F1F5F9',
            }}
          >
            <Ionicons name={opt.icon as any} size={13} color={accountingFilter === opt.key ? '#FFF' : '#64748B'} />
            <Text style={{ fontSize: 12, fontWeight: '700', color: accountingFilter === opt.key ? '#FFF' : '#475569' }}>
              {opt.label}
            </Text>
          </Pressable>
        ))}
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
          actionLabel={accountingFilter === 'old' ? "+ Old Expences approval" : "+ New Expense Approval"}
          onAction={() => router.push(accountingFilter === 'old' ? ('/accounting/expenses/approval/new?accounting=old' as any) : ('/accounting/expenses/approval/new' as any))}
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
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text style={styles.cardVoucherNo}>{item.voucher_no}</Text>
                        {item.is_old_accounting ? (
                          <View style={{ backgroundColor: '#F3E8FF', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, borderWidth: 1, borderColor: '#D8B4FE' }}>
                            <Text style={{ fontSize: 10, fontWeight: '700', color: '#7C3AED' }}>📜 Old</Text>
                          </View>
                        ) : null}
                      </View>
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
                    {(item.status === 'submitted' || item.status === 'verified') ? (
                      <Pressable
                        onPress={(e) => {
                          e.stopPropagation();
                          handleQuickApprove(item);
                        }}
                        style={styles.btnCardApprove}
                        disabled={approvingId === item.id}
                        testID={`approval-card-approve-${item.id}`}
                      >
                        {approvingId === item.id ? (
                          <ActivityIndicator size="small" color="#FFF" />
                        ) : (
                          <>
                            <Ionicons name="checkmark-circle" size={14} color="#FFF" />
                            <Text style={styles.btnCardApproveTxt}>Approve Expense</Text>
                          </>
                        )}
                      </Pressable>
                    ) : null}

                    {item.status === 'approved' ? (
                      <Pressable
                        onPress={(e) => {
                          e.stopPropagation();
                          router.push('/accounting/expenses' as any);
                        }}
                        style={styles.btnCardApproved}
                      >
                        <Ionicons name="checkmark-done-circle" size={14} color="#15803D" />
                        <Text style={styles.btnCardApprovedTxt}>Approved Expense</Text>
                      </Pressable>
                    ) : null}

                    <Pressable
                      onPress={() => router.push(`/accounting/expenses/approval/${item.id}` as any)}
                      style={styles.btnDetails}
                    >
                      <Ionicons name="eye-outline" size={14} color={colors.brandPrimary} />
                      <Text style={styles.btnDetailsTxt}>View Details</Text>
                    </Pressable>

                    <Pressable onPress={() => printVoucher(item)} style={styles.btnPrint}>
                      <Ionicons name="print-outline" size={14} color="#334155" />
                      <Text style={styles.btnPrintTxt}>PDF</Text>
                    </Pressable>

                    {isAdmin ? (
                      <>
                        <Pressable
                          onPress={() => router.push(`/accounting/expenses/approval/${item.id}?edit=true` as any)}
                          style={styles.btnCardEdit}
                          testID={`approval-card-edit-${item.id}`}
                        >
                          <Ionicons name="create-outline" size={14} color="#0D9488" />
                          <Text style={styles.btnCardEditTxt}>Edit</Text>
                        </Pressable>

                        {item.status === 'approved' || item.status === 'rejected' || item.status === 'verified' ? (
                          <Pressable
                            onPress={() => handleCardReopen(item)}
                            style={styles.btnCardReopen}
                            testID={`approval-card-reopen-${item.id}`}
                          >
                            <Ionicons name="reload-outline" size={14} color="#2563EB" />
                            <Text style={styles.btnCardReopenTxt}>Reopen</Text>
                          </Pressable>
                        ) : null}

                        <Pressable
                          onPress={() => handleCardDelete(item)}
                          style={styles.btnCardDelete}
                          testID={`approval-card-delete-${item.id}`}
                        >
                          <Ionicons name="trash-outline" size={14} color="#DC2626" />
                          <Text style={styles.btnCardDeleteTxt}>Delete</Text>
                        </Pressable>
                      </>
                    ) : null}
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
          <View style={[styles.modalCard, { maxWidth: 560, maxHeight: '90%' }]} testID="workflow-config-modal">
            <View style={styles.modalHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View style={styles.modalHeaderIcon}>
                  <Ionicons name="settings" size={18} color="#FFF" />
                </View>
                <View>
                  <Text style={styles.modalTitle}>Workflow & Approval Setup</Text>
                  <Text style={styles.modalSub}>Single / Multi-Stage & Designated Employees</Text>
                </View>
              </View>
              <Pressable onPress={() => setShowConfigModal(false)} hitSlop={10}>
                <Ionicons name="close" size={22} color={colors.onSurface} />
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: 16 }}>
              {/* 1. Workflow Mode: Single Stage vs Multi-Stage */}
              <View style={{ gap: 8 }}>
                <Text style={styles.cfgSectionTitle}>1. Approval Structure (Stage Count)</Text>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <Pressable
                    onPress={() => setConfig((p: any) => ({
                      ...p,
                      workflow_mode: 'single_stage',
                      stages_count: 1,
                      allow_verification_stage: false,
                    }))}
                    style={[
                      styles.modeSelectCard,
                      config?.workflow_mode === 'single_stage' && styles.modeSelectCardActive,
                    ]}
                  >
                    <Ionicons
                      name="flash"
                      size={20}
                      color={config?.workflow_mode === 'single_stage' ? colors.brandPrimary : '#64748B'}
                    />
                    <Text style={[styles.modeSelectTitle, config?.workflow_mode === 'single_stage' && styles.modeSelectTitleActive]}>
                      Single Stage
                    </Text>
                    <Text style={styles.modeSelectSub}>Submitted ➔ Final Approved. 1-step direct sign-off.</Text>
                  </Pressable>

                  <Pressable
                    onPress={() => setConfig((p: any) => ({
                      ...p,
                      workflow_mode: 'multi_stage',
                      stages_count: 2,
                      allow_verification_stage: true,
                    }))}
                    style={[
                      styles.modeSelectCard,
                      (config?.workflow_mode === 'multi_stage' || !config?.workflow_mode) && styles.modeSelectCardActive,
                    ]}
                  >
                    <Ionicons
                      name="shield-checkmark"
                      size={20}
                      color={(config?.workflow_mode === 'multi_stage' || !config?.workflow_mode) ? colors.brandPrimary : '#64748B'}
                    />
                    <Text style={[styles.modeSelectTitle, (config?.workflow_mode === 'multi_stage' || !config?.workflow_mode) && styles.modeSelectTitleActive]}>
                      Multi-Stage (2-Tier)
                    </Text>
                    <Text style={styles.modeSelectSub}>Submitted ➔ Verified ➔ Approved. Robust controls.</Text>
                  </Pressable>
                </View>
              </View>

              {/* 2. Fraud Prevention & Self-Approval */}
              <View style={{ gap: 8 }}>
                <Text style={styles.cfgSectionTitle}>2. Fraud Prevention & Self-Approval</Text>
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
                        ? 'Employees can approve vouchers created by themselves'
                        : 'RESTRICTED (Recommended): Another designated manager/admin must approve'}
                    </Text>
                  </View>
                </Pressable>
              </View>

              {/* 3. Stage 1 Configuration (if Multi-Stage) */}
              {config?.workflow_mode !== 'single_stage' ? (
                <View style={styles.stageBox}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <View style={[styles.stageBadge, { backgroundColor: '#EEF2FF' }]}>
                        <Text style={{ fontSize: 11, fontWeight: '900', color: '#4338CA' }}>STAGE 1</Text>
                      </View>
                      <Text style={styles.stageTitle}>Verification / Accounts Check</Text>
                    </View>
                  </View>

                  {/* Allowed Roles */}
                  <View style={{ gap: 6, marginTop: 4 }}>
                    <Text style={styles.subLbl}>Allowed Roles for Stage 1 Review:</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                      {AVAILABLE_ROLES.map(r => {
                        const sel = (config?.stage_1_roles || ['accountant', 'manager', 'admin']).includes(r.key);
                        return (
                          <Pressable
                            key={r.key}
                            onPress={() => toggleRoleInStage(1, r.key)}
                            style={[styles.rolePill, sel && styles.rolePillActive]}
                          >
                            <Ionicons name={sel ? "checkmark-circle" : "ellipse-outline"} size={13} color={sel ? "#FFF" : "#64748B"} />
                            <Text style={[styles.rolePillTxt, sel && styles.rolePillTxtActive]}>{r.label}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>

                  {/* Specific Employees */}
                  <View style={{ gap: 6, marginTop: 4 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text style={styles.subLbl}>Designated Employees for Stage 1:</Text>
                      <Pressable
                        onPress={() => { setCandidateQ(''); setCandidateModal({ open: true, stage: 1 }); }}
                        style={styles.addEmpBtn}
                      >
                        <Ionicons name="person-add-outline" size={12} color={colors.brandPrimary} />
                        <Text style={styles.addEmpBtnTxt}>+ Assign Employee</Text>
                      </Pressable>
                    </View>
                    {(config?.stage_1_users || []).length === 0 ? (
                      <Text style={styles.noEmpTxt}>No specific employee assigned (any user with allowed roles above can verify)</Text>
                    ) : (
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                        {(config?.stage_1_users || []).map((u: any) => (
                          <View key={u.user_id} style={styles.empChip}>
                            <Ionicons name="person" size={11} color="#4338CA" />
                            <Text style={styles.empChipTxt}>{u.name} ({u.role})</Text>
                            <Pressable onPress={() => removeEmployeeFromStage(1, u.user_id)} hitSlop={6}>
                              <Ionicons name="close-circle" size={14} color="#64748B" />
                            </Pressable>
                          </View>
                        ))}
                      </View>
                    )}
                  </View>
                </View>
              ) : null}

              {/* 4. Stage 2 (or Final Stage) Configuration */}
              <View style={styles.stageBox}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <View style={[styles.stageBadge, { backgroundColor: '#DCFCE7' }]}>
                      <Text style={{ fontSize: 11, fontWeight: '900', color: '#15803D' }}>
                        {config?.workflow_mode === 'single_stage' ? 'FINAL' : 'STAGE 2'}
                      </Text>
                    </View>
                    <Text style={styles.stageTitle}>Final Expenditure Approval</Text>
                  </View>
                </View>

                {/* Allowed Roles */}
                <View style={{ gap: 6, marginTop: 4 }}>
                  <Text style={styles.subLbl}>Allowed Roles for Final Approval:</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    {AVAILABLE_ROLES.map(r => {
                      const sel = (config?.stage_2_roles || ['admin', 'super_admin']).includes(r.key);
                      return (
                        <Pressable
                          key={r.key}
                          onPress={() => toggleRoleInStage(2, r.key)}
                          style={[styles.rolePill, sel && styles.rolePillActive]}
                        >
                          <Ionicons name={sel ? "checkmark-circle" : "ellipse-outline"} size={13} color={sel ? "#FFF" : "#64748B"} />
                          <Text style={[styles.rolePillTxt, sel && styles.rolePillTxtActive]}>{r.label}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>

                {/* Specific Employees */}
                <View style={{ gap: 6, marginTop: 4 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={styles.subLbl}>Designated Employees for Final Approval:</Text>
                    <Pressable
                      onPress={() => { setCandidateQ(''); setCandidateModal({ open: true, stage: 2 }); }}
                      style={styles.addEmpBtn}
                    >
                      <Ionicons name="person-add-outline" size={12} color={colors.brandPrimary} />
                      <Text style={styles.addEmpBtnTxt}>+ Assign Employee</Text>
                    </Pressable>
                  </View>
                  {(config?.stage_2_users || []).length === 0 ? (
                    <Text style={styles.noEmpTxt}>No specific employee assigned (any user with allowed roles above can approve)</Text>
                  ) : (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                      {(config?.stage_2_users || []).map((u: any) => (
                        <View key={u.user_id} style={[styles.empChip, { backgroundColor: '#DCFCE7', borderColor: '#BBF7D0' }]}>
                          <Ionicons name="person" size={11} color="#15803D" />
                          <Text style={[styles.empChipTxt, { color: '#15803D' }]}>{u.name} ({u.role})</Text>
                          <Pressable onPress={() => removeEmployeeFromStage(2, u.user_id)} hitSlop={6}>
                            <Ionicons name="close-circle" size={14} color="#64748B" />
                          </Pressable>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              </View>
            </ScrollView>

            <View style={styles.modalFooter}>
              <Pressable onPress={() => setShowConfigModal(false)} style={styles.cancelBtn}>
                <Text style={styles.cancelBtnTxt}>Cancel</Text>
              </Pressable>
              <Pressable onPress={handleSaveConfig} style={styles.saveBtn} disabled={savingConfig}>
                {savingConfig ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <Text style={styles.saveBtnTxt}>Save Workflow Configuration</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Employee Candidate Selection Modal */}
      <Modal visible={candidateModal.open} animationType="fade" transparent onRequestClose={() => setCandidateModal({ open: false, stage: null })}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { maxWidth: 440, maxHeight: 520 }]} testID="assign-employee-modal">
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>
                  Assign Employee to {candidateModal.stage === 1 ? 'Stage 1 (Verification)' : 'Stage 2 (Final Approval)'}
                </Text>
                <Text style={styles.modalSub}>Pick an active employee to authorize</Text>
              </View>
              <Pressable onPress={() => setCandidateModal({ open: false, stage: null })} hitSlop={10}>
                <Ionicons name="close" size={22} color={colors.onSurface} />
              </Pressable>
            </View>

            <View style={{ paddingHorizontal: spacing.lg, paddingTop: 10 }}>
              <TextInput
                value={candidateQ}
                onChangeText={setCandidateQ}
                placeholder="Search employee by name, email or role..."
                placeholderTextColor={colors.muted}
                style={styles.candidateSearchInput}
              />
            </View>

            <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: 6 }}>
              {candidates
                .filter(c => {
                  const q = candidateQ.trim().toLowerCase();
                  if (!q) return true;
                  return (
                    (c.name || '').toLowerCase().includes(q) ||
                    (c.email || '').toLowerCase().includes(q) ||
                    (c.role || '').toLowerCase().includes(q)
                  );
                })
                .map(c => {
                  const targetList: any[] = candidateModal.stage === 1 ? config?.stage_1_users || [] : config?.stage_2_users || [];
                  const isAssigned = targetList.some(u => u.user_id === c.user_id);
                  return (
                    <Pressable
                      key={c.user_id}
                      onPress={() => {
                        if (!isAssigned && candidateModal.stage) {
                          addEmployeeToStage(candidateModal.stage, c);
                        }
                      }}
                      style={[styles.candidateRow, isAssigned && { opacity: 0.5, backgroundColor: '#F1F5F9' }]}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.candidateName}>{c.name}</Text>
                        <Text style={styles.candidateSub}>{c.role} • {c.email || c.department || ''}</Text>
                      </View>
                      <Ionicons
                        name={isAssigned ? "checkmark-circle" : "add-circle-outline"}
                        size={20}
                        color={isAssigned ? "#15803D" : colors.brandPrimary}
                      />
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
    gap: 6,
    flexWrap: 'wrap',
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingTop: 8,
  },
  btnCardApprove: {
    flex: 1.4,
    minWidth: 125,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    backgroundColor: '#059669',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
    shadowColor: '#059669',
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 2,
  },
  btnCardApproveTxt: { color: '#FFF', fontWeight: '900', fontSize: 12 },
  btnCardApproved: {
    flex: 1.4,
    minWidth: 125,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: '#DCFCE7',
    borderWidth: 1,
    borderColor: '#86EFAC',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 6,
  },
  btnCardApprovedTxt: { color: '#15803D', fontWeight: '800', fontSize: 11 },
  allExpShortcutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    paddingHorizontal: 10,
    height: 40,
    borderRadius: radius.md,
  },
  allExpShortcutBtnTxt: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.brandPrimary,
  },
  btnDetails: {
    flex: 1.2,
    minWidth: 110,
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: '#F1F5F9',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 6,
  },
  btnPrintTxt: { color: '#334155', fontWeight: '800', fontSize: 12 },
  btnCardEdit: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    backgroundColor: '#F0FDFA',
    borderWidth: 1,
    borderColor: '#99F6E4',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 6,
  },
  btnCardEditTxt: { color: '#0D9488', fontWeight: '800', fontSize: 12 },
  btnCardReopen: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 6,
  },
  btnCardReopenTxt: { color: '#2563EB', fontWeight: '800', fontSize: 12 },
  btnCardDelete: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 6,
  },
  btnCardDeleteTxt: { color: '#DC2626', fontWeight: '800', fontSize: 12 },

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

  // Mode Selection Styles
  modeSelectCard: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    borderRadius: radius.md,
    padding: 12,
    gap: 4,
  },
  modeSelectCardActive: {
    backgroundColor: '#EFF6FF',
    borderColor: colors.brandPrimary,
  },
  modeSelectTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#334155',
  },
  modeSelectTitleActive: {
    color: colors.brandPrimary,
  },
  modeSelectSub: {
    fontSize: 10,
    color: colors.muted,
    lineHeight: 14,
  },

  // Stage Box Styles
  stageBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 12,
    gap: 8,
  },
  stageBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  stageTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.onSurface,
  },
  subLbl: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.muted,
  },
  rolePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  rolePillActive: {
    backgroundColor: colors.brandPrimary,
    borderColor: colors.brandPrimary,
  },
  rolePillTxt: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
  },
  rolePillTxtActive: {
    color: '#FFF',
  },
  addEmpBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: '#EFF6FF',
    borderRadius: 4,
  },
  addEmpBtnTxt: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.brandPrimary,
  },
  noEmpTxt: {
    fontSize: 10,
    fontStyle: 'italic',
    color: colors.muted,
  },
  empChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#EEF2FF',
    borderWidth: 1,
    borderColor: '#C7D2FE',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  empChipTxt: {
    fontSize: 11,
    fontWeight: '700',
    color: '#4338CA',
  },

  // Candidate Search Modal Styles
  candidateSearchInput: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: font.sm,
    color: colors.onSurface,
  },
  candidateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 10,
    borderRadius: radius.md,
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  candidateName: {
    fontSize: font.sm,
    fontWeight: '700',
    color: colors.onSurface,
  },
  candidateSub: {
    fontSize: 11,
    color: colors.muted,
    marginTop: 1,
  },
});
