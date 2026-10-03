import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, Pressable, TextInput, Modal, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { colors, spacing, radius, font, shadow } from '@/src/theme';
import { api } from '@/src/api';
import { useAuth } from '@/src/AuthContext';
import { Card, StatusBadge } from '@/src/ui';

const HERO = 'https://images.unsplash.com/photo-1715593949273-09009558300a?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjY2NzF8MHwxfHNlYXJjaHwxfHxwcm9mZXNzaW9uYWwlMjBpbmRpYW4lMjBvZmZpY2UlMjBiYWNrZ3JvdW5kfGVufDB8fHx8MTc4NzgwMjczMnww&ixlib=rb-4.1.0&q=85';
const inr = (n: any) => `₹ ${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

interface Summary {
  customers: number; employees: number; tasks_total: number; tasks_open: number;
  open_tenders: number; pending_leaves: number; accounts_pending: number;
  urgent_tenders: any[];
}

interface SystemStats {
  branches: number;
  employees: number;
  customers: number;
  pending_tasks: number;
  todays_sales: number;
  receivable: number;
  payable: number;
  expiring_documents_30_days: number;
}

export default function Dashboard() {
  const { user } = useAuth();
  const router = useRouter();
  const [data, setData] = useState<Summary | null>(null);
  const [sysStats, setSysStats] = useState<SystemStats | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Global search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchModal, setSearchModal] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<any | null>(null);

  const load = useCallback(async () => {
    try {
      const [sum, stats] = await Promise.all([
        api.get<Summary>('/dashboard/summary').catch(() => null),
        api.getSystemStats().catch(() => null),
      ]);
      if (sum) setData(sum);
      if (stats) setSysStats(stats);
    } catch {}
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const handleSearch = async (text: string) => {
    setSearchQuery(text);
    if (!text.trim()) {
      setSearchResults(null);
      return;
    }
    setSearching(true);
    try {
      const res = await api.globalSearch(text.trim());
      setSearchResults(res);
    } catch {
      setSearchResults(null);
    } finally {
      setSearching(false);
    }
  };

  const expiringCount = sysStats?.expiring_documents_30_days ?? 0;

  return (
    <View style={styles.root} testID="dashboard-screen">
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={{ paddingBottom: spacing.xxxl }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Hero Section */}
        <View style={styles.hero}>
          <Image source={{ uri: HERO }} style={StyleSheet.absoluteFillObject} contentFit="cover" />
          <LinearGradient colors={['transparent', 'rgba(9,9,11,0.88)']} style={StyleSheet.absoluteFillObject} />
          <SafeAreaView edges={['top']} style={styles.heroContent}>
            <View style={styles.brandRow}>
              <View style={styles.brandLogo}>
                <Image source={require('../../assets/images/company-logo.jpg')} style={{ width: '100%', height: '100%' }} contentFit="contain" />
              </View>
              <View>
                <Text style={styles.brandTitle}>TDSC-OMS</Text>
                <Text style={styles.companySub}>TRIVENI DSC & ETENDER SERVICE PVT. LTD.</Text>
              </View>
            </View>

            <Text style={styles.hello} testID="dashboard-hello">Namaste, {user?.name?.split(' ')[0] || 'User'}</Text>
            
            {/* Quick Search Launch Bar */}
            <Pressable
              style={styles.searchBar}
              onPress={() => setSearchModal(true)}
              testID="dashboard-search-trigger"
            >
              <Ionicons name="search" size={18} color="#94A3B8" />
              <Text style={styles.searchPlaceholder}>Search customers, tasks, invoices, branches...</Text>
            </Pressable>
          </SafeAreaView>
        </View>

        {/* Document Expiry Banner */}
        {expiringCount > 0 && (
          <Pressable
            style={styles.alertBanner}
            onPress={() => router.push('/customers/expiry-alerts' as any)}
            testID="dashboard-expiry-banner"
          >
            <View style={styles.alertIconBg}>
              <Ionicons name="warning" size={22} color="#D97706" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.alertTitle}>{expiringCount} Document{expiringCount > 1 ? 's' : ''} / DSC Expiring</Text>
              <Text style={styles.alertSubtitle}>Action required within 30 days. Tap to inspect alerts.</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#D97706" />
          </Pressable>
        )}

        {/* Financial KPI Summary (Vyapar-Style) */}
        <View style={styles.financialSection}>
          <Text style={styles.sectionHeaderTitle}>Financial Overview</Text>
          <View style={styles.financialRow}>
            <View style={[styles.finCard, { backgroundColor: '#ECFDF5', borderColor: '#A7F3D0' }]}>
              <Ionicons name="cash-outline" size={20} color="#059669" />
              <Text style={styles.finLabel}>Today's Sales</Text>
              <Text style={[styles.finValue, { color: '#059669' }]}>{inr(sysStats?.todays_sales ?? 0)}</Text>
            </View>
            <View style={[styles.finCard, { backgroundColor: '#EFF6FF', borderColor: '#BFDBFE' }]}>
              <Ionicons name="arrow-down-circle-outline" size={20} color="#2563EB" />
              <Text style={styles.finLabel}>To Receive</Text>
              <Text style={[styles.finValue, { color: '#2563EB' }]}>{inr(sysStats?.receivable ?? 0)}</Text>
            </View>
            <View style={[styles.finCard, { backgroundColor: '#FEF2F2', borderColor: '#FECACA' }]}>
              <Ionicons name="arrow-up-circle-outline" size={20} color="#DC2626" />
              <Text style={styles.finLabel}>To Pay</Text>
              <Text style={[styles.finValue, { color: '#DC2626' }]}>{inr(sysStats?.payable ?? 0)}</Text>
            </View>
          </View>
        </View>

        {/* Operational Metrics Grid */}
        <View style={styles.section}>
          <Text style={styles.sectionHeaderTitle}>Operations Metrics</Text>
          <View style={styles.grid}>
            <Pressable style={styles.statCard} onPress={() => router.push('/(tabs)/tasks' as any)} testID="stat-tasks">
              <View style={[styles.statIcon, { backgroundColor: '#DCFCE7' }]}>
                <Ionicons name="checkmark-done" size={20} color="#059669" />
              </View>
              <Text style={styles.statValue}>{sysStats?.pending_tasks ?? data?.tasks_open ?? 0}</Text>
              <Text style={styles.statLabel}>Pending Tasks</Text>
            </Pressable>

            <Pressable style={styles.statCard} onPress={() => router.push('/(tabs)/business' as any)} testID="stat-customers">
              <View style={[styles.statIcon, { backgroundColor: '#DBEAFE' }]}>
                <Ionicons name="people" size={20} color="#2563EB" />
              </View>
              <Text style={styles.statValue}>{sysStats?.customers ?? data?.customers ?? 0}</Text>
              <Text style={styles.statLabel}>Total Clients</Text>
            </Pressable>

            <Pressable style={styles.statCard} onPress={() => router.push('/employees' as any)} testID="stat-employees">
              <View style={[styles.statIcon, { backgroundColor: '#EDE9FE' }]}>
                <Ionicons name="briefcase" size={20} color="#7C3AED" />
              </View>
              <Text style={styles.statValue}>{sysStats?.employees ?? data?.employees ?? 0}</Text>
              <Text style={styles.statLabel}>Employees</Text>
            </Pressable>

            <Pressable style={styles.statCard} onPress={() => router.push('/admin/branches' as any)} testID="stat-branches">
              <View style={[styles.statIcon, { backgroundColor: '#FEE2E2' }]}>
                <Ionicons name="business" size={20} color="#DC2626" />
              </View>
              <Text style={styles.statValue}>{sysStats?.branches ?? 1}</Text>
              <Text style={styles.statLabel}>Branches</Text>
            </Pressable>

            <Pressable style={styles.statCard} onPress={() => router.push('/tenders' as any)} testID="stat-tenders">
              <View style={[styles.statIcon, { backgroundColor: '#FEF3C7' }]}>
                <Ionicons name="document-text" size={20} color="#D97706" />
              </View>
              <Text style={styles.statValue}>{data?.open_tenders ?? 0}</Text>
              <Text style={styles.statLabel}>Open Tenders</Text>
            </Pressable>

            <Pressable style={styles.statCard} onPress={() => router.push('/hr' as any)} testID="stat-leaves">
              <View style={[styles.statIcon, { backgroundColor: '#CFFAFE' }]}>
                <Ionicons name="calendar" size={20} color="#0891B2" />
              </View>
              <Text style={styles.statValue}>{data?.pending_leaves ?? 0}</Text>
              <Text style={styles.statLabel}>Leave Req.</Text>
            </Pressable>
          </View>
        </View>

        {/* Urgent Tenders */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionHeaderTitle}>Urgent Tenders</Text>
            <Pressable onPress={() => router.push('/tenders')}><Text style={styles.link}>View all</Text></Pressable>
          </View>
          {(data?.urgent_tenders || []).length === 0 ? (
            <Card><Text style={styles.mutedText}>No urgent tender deadlines right now.</Text></Card>
          ) : (
            (data!.urgent_tenders).map((t: any) => (
              <Pressable key={t.id} onPress={() => router.push(`/tenders/${t.id}` as any)}>
                <Card style={{ marginBottom: spacing.md }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <View style={{ flex: 1, paddingRight: spacing.md }}>
                      <Text style={styles.tenderTitle} numberOfLines={2}>{t.title}</Text>
                      <Text style={styles.mutedText}>Deadline: {t.submission_deadline || 'N/A'}</Text>
                    </View>
                    <StatusBadge status={t.status} />
                  </View>
                </Card>
              </Pressable>
            ))
          )}
        </View>

        {/* Enterprise Quick Actions */}
        <View style={styles.section}>
          <Text style={styles.sectionHeaderTitle}>Quick Actions</Text>
          <View style={styles.actionsRow}>
            <QuickAction icon="person-add" label="Add Customer" onPress={() => router.push('/customers/new' as any)} testID="qa-customer" />
            <QuickAction icon="add-circle" label="New Task" onPress={() => router.push('/tasks/new' as any)} testID="qa-task" />
          </View>
          <View style={styles.actionsRow}>
            <QuickAction icon="receipt" label="Sale Invoice" onPress={() => router.push('/accounting/invoices/new' as any)} testID="qa-invoice" />
            <QuickAction icon="navigate" label="Field GPS" onPress={() => router.push('/gps/tracking' as any)} testID="qa-gps" />
          </View>
          <View style={styles.actionsRow}>
            <QuickAction icon="document" label="New Tender" onPress={() => router.push('/tenders/new' as any)} testID="qa-tender" />
            <QuickAction icon="settings" label="Settings" onPress={() => router.push('/admin/settings' as any)} testID="qa-settings" />
          </View>
        </View>
      </ScrollView>

      {/* Global Search Modal */}
      <Modal visible={searchModal} animationType="slide" transparent onRequestClose={() => setSearchModal(false)}>
        <View style={styles.modalBackdrop}>
          <SafeAreaView edges={['top']} style={styles.searchModalCard}>
            <View style={styles.searchModalHeader}>
              <Ionicons name="search" size={22} color={colors.brandPrimary} />
              <TextInput
                style={styles.modalSearchInput}
                placeholder="Search across all modules..."
                placeholderTextColor="#94A3B8"
                value={searchQuery}
                onChangeText={handleSearch}
                autoFocus
              />
              <Pressable onPress={() => { setSearchModal(false); setSearchQuery(''); setSearchResults(null); }} hitSlop={10}>
                <Ionicons name="close-circle" size={24} color={colors.muted} />
              </Pressable>
            </View>

            {searching && (
              <View style={{ padding: spacing.xl, alignItems: 'center' }}>
                <ActivityIndicator size="small" color={colors.brandPrimary} />
                <Text style={{ color: colors.muted, marginTop: 6 }}>Searching...</Text>
              </View>
            )}

            <ScrollView contentContainerStyle={{ padding: spacing.md, gap: spacing.md }} keyboardShouldPersistTaps="handled">
              {searchResults ? (
                <>
                  {/* Customers */}
                  {(searchResults.customers || []).length > 0 && (
                    <View style={styles.searchGroup}>
                      <Text style={styles.searchGroupTitle}>CUSTOMERS ({searchResults.customers.length})</Text>
                      {searchResults.customers.map((c: any) => (
                        <Pressable
                          key={c.id}
                          style={styles.searchResultRow}
                          onPress={() => {
                            setSearchModal(false);
                            router.push(`/customers/${c.id}` as any);
                          }}
                        >
                          <Ionicons name="person" size={18} color="#2563EB" />
                          <View style={{ flex: 1 }}>
                            <Text style={styles.resultTitle}>{c.name}</Text>
                            <Text style={styles.resultSub}>{c.customer_code} • {c.mobile}</Text>
                          </View>
                          <Ionicons name="chevron-forward" size={16} color={colors.muted} />
                        </Pressable>
                      ))}
                    </View>
                  )}

                  {/* Tasks */}
                  {(searchResults.tasks || []).length > 0 && (
                    <View style={styles.searchGroup}>
                      <Text style={styles.searchGroupTitle}>TASKS ({searchResults.tasks.length})</Text>
                      {searchResults.tasks.map((t: any) => (
                        <Pressable
                          key={t.id}
                          style={styles.searchResultRow}
                          onPress={() => {
                            setSearchModal(false);
                            router.push(`/tasks/${t.id}` as any);
                          }}
                        >
                          <Ionicons name="checkbox-outline" size={18} color="#059669" />
                          <View style={{ flex: 1 }}>
                            <Text style={styles.resultTitle}>{t.title}</Text>
                            <Text style={styles.resultSub}>{t.task_id || t.id} • {t.status}</Text>
                          </View>
                          <Ionicons name="chevron-forward" size={16} color={colors.muted} />
                        </Pressable>
                      ))}
                    </View>
                  )}

                  {/* Invoices */}
                  {(searchResults.invoices || []).length > 0 && (
                    <View style={styles.searchGroup}>
                      <Text style={styles.searchGroupTitle}>INVOICES ({searchResults.invoices.length})</Text>
                      {searchResults.invoices.map((inv: any) => (
                        <Pressable
                          key={inv.id}
                          style={styles.searchResultRow}
                          onPress={() => {
                            setSearchModal(false);
                            router.push(`/accounting/invoices/${inv.id}` as any);
                          }}
                        >
                          <Ionicons name="receipt" size={18} color="#D97706" />
                          <View style={{ flex: 1 }}>
                            <Text style={styles.resultTitle}>{inv.invoice_number}</Text>
                            <Text style={styles.resultSub}>{inv.party_name} • ₹ {inv.total_amount}</Text>
                          </View>
                          <Ionicons name="chevron-forward" size={16} color={colors.muted} />
                        </Pressable>
                      ))}
                    </View>
                  )}

                  {/* Branches */}
                  {(searchResults.branches || []).length > 0 && (
                    <View style={styles.searchGroup}>
                      <Text style={styles.searchGroupTitle}>BRANCHES ({searchResults.branches.length})</Text>
                      {searchResults.branches.map((b: any) => (
                        <Pressable
                          key={b.id}
                          style={styles.searchResultRow}
                          onPress={() => {
                            setSearchModal(false);
                            router.push('/admin/branches' as any);
                          }}
                        >
                          <Ionicons name="business" size={18} color="#DC2626" />
                          <View style={{ flex: 1 }}>
                            <Text style={styles.resultTitle}>{b.name}</Text>
                            <Text style={styles.resultSub}>{b.branch_code} • {b.city}</Text>
                          </View>
                          <Ionicons name="chevron-forward" size={16} color={colors.muted} />
                        </Pressable>
                      ))}
                    </View>
                  )}

                  {searchResults.total === 0 && !searching && (
                    <View style={{ padding: spacing.xl, alignItems: 'center' }}>
                      <Ionicons name="search-outline" size={36} color={colors.muted} />
                      <Text style={{ color: colors.muted, marginTop: 8 }}>No results found for "{searchQuery}"</Text>
                    </View>
                  )}
                </>
              ) : searchQuery ? null : (
                <View style={{ padding: spacing.lg, alignItems: 'center' }}>
                  <Text style={{ color: colors.muted, fontSize: font.sm }}>Type name, customer ID, phone, task or invoice number</Text>
                </View>
              )}
            </ScrollView>
          </SafeAreaView>
        </View>
      </Modal>
    </View>
  );
}

const QuickAction: React.FC<{ icon: any; label: string; onPress: () => void; testID: string }> = ({ icon, label, onPress, testID }) => (
  <Pressable onPress={onPress} style={styles.qa} testID={testID}>
    <View style={styles.qaIcon}><Ionicons name={icon} size={22} color={colors.brandPrimary} /></View>
    <Text style={styles.qaLabel}>{label}</Text>
  </Pressable>
);

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F8FAFC' },
  hero: { height: 260, overflow: 'hidden' },
  heroContent: { flex: 1, padding: spacing.lg, justifyContent: 'flex-end' },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  brandLogo: { width: 38, height: 38, borderRadius: 8, backgroundColor: '#FFF', padding: 2, alignItems: 'center', justifyContent: 'center' },
  brandTitle: { color: '#FFF', fontWeight: '900', fontSize: font.lg, letterSpacing: 0.5 },
  companySub: { color: '#E2E8F0', fontSize: 10, fontWeight: '700', letterSpacing: 0.3 },
  hello: { color: '#FFF', fontSize: font.xl, fontWeight: '800', marginTop: 4 },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  searchPlaceholder: { color: '#64748B', fontSize: font.sm, flex: 1 },
  alertBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: '#FEF3C7',
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#FCD34D',
    ...shadow.card,
  },
  alertIconBg: { width: 40, height: 40, borderRadius: 10, backgroundColor: '#FDE68A', alignItems: 'center', justifyContent: 'center' },
  alertTitle: { color: '#92400E', fontWeight: '800', fontSize: font.base },
  alertSubtitle: { color: '#B45309', fontSize: 11, marginTop: 2 },
  financialSection: { paddingHorizontal: spacing.lg, marginTop: spacing.lg },
  sectionHeaderTitle: { fontSize: font.lg, fontWeight: '800', color: '#0F172A', marginBottom: spacing.sm },
  financialRow: { flexDirection: 'row', gap: spacing.sm },
  finCard: { flex: 1, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, ...shadow.card },
  finLabel: { fontSize: 11, fontWeight: '700', color: '#64748B', marginTop: 4 },
  finValue: { fontSize: font.lg, fontWeight: '900', marginTop: 2 },
  section: { paddingHorizontal: spacing.lg, marginTop: spacing.xl },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md },
  link: { color: colors.brandPrimary, fontWeight: '700' },
  mutedText: { color: colors.muted, fontSize: font.base },
  tenderTitle: { fontSize: font.lg, fontWeight: '700', color: colors.onSurface, marginBottom: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  statCard: { width: '31%', backgroundColor: '#FFF', borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, ...shadow.card },
  statIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm },
  statValue: { fontSize: font.xl, fontWeight: '900', color: colors.onSurface },
  statLabel: { fontSize: 11, color: colors.muted, marginTop: 2, fontWeight: '600' },
  actionsRow: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.md },
  qa: { flex: 1, backgroundColor: '#FFF', borderRadius: radius.md, padding: spacing.md, alignItems: 'center', borderWidth: 1, borderColor: colors.border, gap: 6, ...shadow.card },
  qaIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center' },
  qaLabel: { fontSize: font.sm, fontWeight: '700', color: colors.onSurface },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.6)' },
  searchModalCard: { flex: 1, backgroundColor: '#FFF', marginTop: 40, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg },
  searchModalHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  modalSearchInput: { flex: 1, fontSize: font.base, color: '#0F172A', paddingVertical: 6 },
  searchGroup: { marginBottom: spacing.md },
  searchGroupTitle: { fontSize: 11, fontWeight: '900', color: '#64748B', letterSpacing: 0.5, marginBottom: 6 },
  searchResultRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, backgroundColor: '#F8FAFC', borderRadius: radius.md, marginBottom: 6, borderWidth: 1, borderColor: colors.divider },
  resultTitle: { fontSize: font.base, fontWeight: '700', color: '#0F172A' },
  resultSub: { fontSize: 11, color: colors.muted, marginTop: 2 },
});
