import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, RefreshControl, TextInput, Platform, Linking } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, font } from '@/src/theme';
import { api } from '@/src/api';
import { Avatar, Card, EmptyState, ScreenLoader, StatusBadge } from '@/src/ui';
import { useAuth } from '@/src/AuthContext';
import { confirm, notify } from '@/src/dialog';
import { canView, canWrite } from '@/src/rbac';

type Segment = 'customers' | 'accounts';

const daysUntil = (dateStr?: string | null): number | null => {
  if (!dateStr) return null;
  // accept YYYY-MM-DD or DD-MM-YYYY
  let iso = dateStr.trim();
  if (/^\d{2}[-/]\d{2}[-/]\d{4}$/.test(iso)) {
    const [d, m, y] = iso.split(/[-/]/);
    iso = `${y}-${m}-${d}`;
  }
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const diff = t - Date.now();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
};

export default function BusinessScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';
  const canViewCustomers = canView(user, 'business', 'customers');
  const canViewAccounts = canView(user, 'business', 'accounts');
  const canWriteCustomers = canWrite(user, 'business', 'customers');
  const canWriteAccounts = canWrite(user, 'business', 'accounts');
  const canEdit = canWriteCustomers;

  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [busyBulk, setBusyBulk] = useState(false);
  const selectedCount = useMemo(() => Object.values(selected).filter(Boolean).length, [selected]);
  const toggleSel = (id: string) => setSelected(p => ({ ...p, [id]: !p[id] }));
  const exitSelect = () => { setSelectMode(false); setSelected({}); };
  const printCustomer = async (c: any) => {
    try {
      const url = await api.customerPdfUrl(c.id);
      if (Platform.OS === 'web' && typeof window !== 'undefined') window.open(url, '_blank');
      else await Linking.openURL(url);
    } catch (e: any) { notify('Failed', e?.message || 'Try again'); }
  };
  const deleteCustomer = async (c: any) => {
    if (!canWriteCustomers) {
      notify('Permission Denied', 'Aapke pass customer delete karne ka right nahi hai.');
      return;
    }
    const ok = await confirm('Delete Customer?', `${c.name} delete kar diya jayega. Yeh action undo nahi ho sakta.`, { confirmText: 'Delete', destructive: true });
    if (!ok) return;
    try { await api.del(`/customers/${c.id}`); await load(); }
    catch (e: any) { notify('Failed', e?.message || 'Try again'); }
  };
  const bulkDelete = async () => {
    if (!canWriteCustomers) {
      notify('Permission Denied', 'Aapke pass bulk delete karne ka right nahi hai.');
      return;
    }
    const ids = Object.keys(selected).filter(k => selected[k]);
    if (ids.length === 0) return;
    const ok = await confirm('Delete Selected?', `${ids.length} customers permanently delete kar diye jayenge.`, { confirmText: 'Delete All', destructive: true });
    if (!ok) return;
    setBusyBulk(true);
    try { const res: any = await api.post('/customers/bulk-delete', { ids }); notify('Deleted', `${res?.deleted || 0} customers deleted`); exitSelect(); await load(); }
    catch (e: any) { notify('Failed', e?.message || 'Try again'); }
    finally { setBusyBulk(false); }
  };
  const defaultSeg: Segment = canViewCustomers ? 'customers' : (canViewAccounts ? 'accounts' : 'customers');
  const [seg, setSeg] = useState<Segment>(defaultSeg);

  React.useEffect(() => {
    if (!canViewCustomers && canViewAccounts && seg === 'customers') {
      setSeg('accounts');
    } else if (canViewCustomers && !canViewAccounts && seg === 'accounts') {
      setSeg('customers');
    }
  }, [canViewCustomers, canViewAccounts]);

  const [customers, setCustomers] = useState<any[] | null>(null);
  const [accounts, setAccounts] = useState<any[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    try {
      const [c, a] = await Promise.all([
        canViewCustomers ? api.get<any[]>('/customers') : Promise.resolve([]),
        canViewAccounts ? api.get<any[]>('/accounts') : Promise.resolve([]),
      ]);
      setCustomers(c); setAccounts(a);
    } catch { setCustomers([]); setAccounts([]); }
  }, [canViewCustomers, canViewAccounts]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const filteredCustomers = useMemo(() => {
    if (!customers) return null;
    const s = q.trim().toLowerCase();
    if (!s) return customers;
    return customers.filter(c =>
      (c.name || '').toLowerCase().includes(s) ||
      (c.mobile || '').toLowerCase().includes(s) ||
      (c.whatsapp || '').toLowerCase().includes(s) ||
      (c.pan || '').toLowerCase().includes(s) ||
      (c.aadhar || '').toLowerCase().includes(s) ||
      (c.email || '').toLowerCase().includes(s) ||
      (c.customer_code || '').toLowerCase().includes(s) ||
      (c.contractor_reg_no || '').toLowerCase().includes(s) ||
      (c.gst_no || '').toLowerCase().includes(s)
    );
  }, [customers, q]);

  const filteredAccounts = useMemo(() => {
    if (!accounts) return null;
    const s = q.trim().toLowerCase();
    if (!s) return accounts;
    return accounts.filter(a => (a.title || '').toLowerCase().includes(s) || (a.party || '').toLowerCase().includes(s));
  }, [accounts, q]);

  if (!canViewCustomers && !canViewAccounts) {
    return (
      <SafeAreaView edges={['top']} style={styles.root} testID="business-screen">
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl }}>
          <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: '#FEF2F2', alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md }}>
            <Ionicons name="lock-closed" size={36} color={colors.error} />
          </View>
          <Text style={[styles.h1, { fontSize: 20, textAlign: 'center' }]}>Business Access Restricted</Text>
          <Text style={[styles.muted, { textAlign: 'center', marginTop: spacing.sm, maxWidth: 320, lineHeight: 20 }]}>
            Administrator ne aapke account ke liye Business module (Customers aur Accounts) view karne ki permission disable ki hui hai.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <>
    <SafeAreaView edges={['top']} style={styles.root} testID="business-screen">
      <View style={styles.header}>
        {selectMode ? (
          <>
            <Pressable onPress={exitSelect} testID="exit-select" hitSlop={10}><Ionicons name="close" size={26} color={colors.onSurface} /></Pressable>
            <Text style={[styles.h1, { flex: 1, marginLeft: 12 }]}>{selectedCount} selected</Text>
            <Pressable onPress={() => {
              if (!filteredCustomers) return;
              const all = filteredCustomers.every(c => selected[c.id]);
              if (all) { setSelected({}); return; }
              const next: Record<string, boolean> = {};
              filteredCustomers.forEach(c => { next[c.id] = true; });
              setSelected(next);
            }} testID="select-all" style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20, backgroundColor: '#EFF6FF' }}>
              <Ionicons name={filteredCustomers && filteredCustomers.every(c => selected[c.id]) ? 'checkbox' : 'square-outline'} size={18} color={colors.brandPrimary} />
              <Text style={{ color: colors.brandPrimary, fontWeight: '800', fontSize: 12 }}>{filteredCustomers && filteredCustomers.every(c => selected[c.id]) ? 'Deselect' : 'Select All'}</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Text style={styles.h1}>Business</Text>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              {canWriteCustomers && seg === 'customers' ? (
                <Pressable testID="enter-select" onPress={() => setSelectMode(true)} style={[styles.addBtn, { backgroundColor: '#EFF6FF' }]}>
                  <Ionicons name="checkbox-outline" size={22} color={colors.brandPrimary} />
                </Pressable>
              ) : null}
              {((seg === 'customers' && canWriteCustomers) || (seg === 'accounts' && canWriteAccounts)) ? (
                <Pressable
                  testID="add-btn"
                  style={styles.addBtn}
                  onPress={() => router.push(seg === 'customers' ? '/customers/new' as any : '/accounts/new' as any)}
                >
                  <Ionicons name="add" size={22} color={colors.onBrandPrimary} />
                </Pressable>
              ) : null}
            </View>
          </>
        )}
      </View>
      {canViewCustomers && canViewAccounts && (
        <View style={styles.segments}>
          <Pressable testID="seg-customers" onPress={() => setSeg('customers')} style={[styles.seg, seg === 'customers' && styles.segActive]}>
            <Text style={[styles.segText, seg === 'customers' && styles.segTextActive]}>Customers</Text>
          </Pressable>
          <Pressable testID="seg-accounts" onPress={() => setSeg('accounts')} style={[styles.seg, seg === 'accounts' && styles.segActive]}>
            <Text style={[styles.segText, seg === 'accounts' && styles.segTextActive]}>Accounts</Text>
          </Pressable>
        </View>
      )}

      <View style={styles.searchBar}>
        <Ionicons name="search" size={18} color={colors.muted} />
        <TextInput
          testID="search-input"
          value={q}
          onChangeText={setQ}
          placeholder={seg === 'customers' ? 'Search by ID / Mobile / PAN / Aadhar / Email / GST / Reg No…' : 'Search title or party…'}
          placeholderTextColor={colors.muted}
          style={styles.searchInput}
        />
        {q ? (
          <Pressable onPress={() => setQ('')} hitSlop={10} testID="search-clear">
            <Ionicons name="close-circle" size={18} color={colors.muted} />
          </Pressable>
        ) : null}
      </View>

      {seg === 'customers' ? (
        filteredCustomers === null ? <ScreenLoader /> : filteredCustomers.length === 0 ? (
          q ? (
            <EmptyState testID="customers-nomatch" icon="search-outline" title="No matches" subtitle={`Nothing found for "${q}"`} />
          ) : (
            <EmptyState
              testID="customers-empty"
              icon="people-outline"
              title="No customers yet"
              subtitle={canWriteCustomers ? "Add your first client to get started" : "No client records registered yet"}
              actionLabel={canWriteCustomers ? "Add Customer" : undefined}
              onAction={canWriteCustomers ? () => router.push('/customers/new' as any) : undefined}
            />
          )
        ) : (
          <FlatList
            testID="customer-list"
            data={filteredCustomers}
            keyExtractor={(i) => i.id}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
            contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxxl }}
            renderItem={({ item }) => {
              const dscDays = daysUntil(item.dsc_expired_date);
              const dscWarn = dscDays !== null && dscDays <= 30;
              const dscExpired = dscDays !== null && dscDays < 0;
              return (
                <Pressable
                  onPress={() => selectMode ? toggleSel(item.id) : router.push(`/customers/${item.id}` as any)}
                  onLongPress={() => { if (isAdmin) { setSelectMode(true); setSelected({ [item.id]: true }); } }}
                  testID={`customer-${item.id}`}
                >
                  <Card style={selectMode && selected[item.id] ? { borderColor: colors.brandPrimary, borderWidth: 2 } : (dscWarn ? { borderColor: dscExpired ? colors.error : colors.warning, borderWidth: 2 } : undefined)}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                      {selectMode ? (
                        <Pressable onPress={() => toggleSel(item.id)} testID={`check-${item.id}`} hitSlop={8}>
                          <Ionicons name={selected[item.id] ? 'checkbox' : 'square-outline'} size={24} color={selected[item.id] ? colors.brandPrimary : colors.muted} />
                        </Pressable>
                      ) : (
                        <Avatar name={item.name} />
                      )}
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <Text style={styles.itemTitle}>{item.name}</Text>
                          {item.registration_class ? (
                            <View style={{ backgroundColor: '#EEF2FF', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, borderWidth: 1, borderColor: '#C7D2FE' }}>
                              <Text style={{ fontSize: 10, fontWeight: '800', color: '#4338CA' }}>{item.registration_class}</Text>
                            </View>
                          ) : null}
                        </View>
                        {item.customer_code ? <Text style={[styles.muted, { color: colors.brandPrimary, fontWeight: '700' }]}>{item.customer_code}</Text> : null}
                        {item.contractor_reg_no ? <Text style={[styles.muted, { color: '#0F172A', fontWeight: '600' }]}>Reg: {item.contractor_reg_no}</Text> : null}
                        {item.departments ? <Text style={[styles.muted, { color: '#047857' }]} numberOfLines={1}>Depts: {item.departments}</Text> : null}
                        {item.mobile ? (
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
                            <Text style={styles.muted}>📱 {item.mobile}</Text>
                            <Pressable
                              hitSlop={6}
                              onPress={(e) => { e?.stopPropagation?.(); Linking.openURL(`tel:${item.mobile}`); }}
                              style={{ paddingHorizontal: 6, paddingVertical: 2, backgroundColor: '#EFF6FF', borderRadius: 4 }}
                            >
                              <Ionicons name="call" size={12} color={colors.brandPrimary} />
                            </Pressable>
                            {item.whatsapp ? (
                              <Pressable
                                hitSlop={6}
                                onPress={(e) => {
                                  e?.stopPropagation?.();
                                  const clean = item.whatsapp.replace(/\D/g, '');
                                  Linking.openURL(`https://wa.me/${clean.startsWith('91') ? clean : '91' + clean}`);
                                }}
                                style={{ paddingHorizontal: 6, paddingVertical: 2, backgroundColor: '#DCFCE7', borderRadius: 4 }}
                              >
                                <Ionicons name="logo-whatsapp" size={12} color="#15803D" />
                              </Pressable>
                            ) : null}
                          </View>
                        ) : null}
                        {item.pan ? <Text style={styles.muted}>PAN: {item.pan}{item.gst_no ? ` • GST: ${item.gst_no}` : ''}</Text> : null}
                        {dscWarn ? (
                          <Text style={[styles.muted, { color: dscExpired ? colors.error : colors.warning, fontWeight: '700' }]}>
                            {dscExpired ? `⚠ DSC expired ${-dscDays!}d ago` : `⚠ DSC expires in ${dscDays}d`}
                          </Text>
                        ) : null}
                      </View>
                      {(item.attachments || []).length > 0 ? (
                        <View style={styles.attachTag}><Ionicons name="attach" size={12} color={colors.onBrandTertiary} /><Text style={styles.attachText}>{item.attachments.length}</Text></View>
                      ) : null}
                      {item.gst_no ? <View style={styles.gstTag}><Text style={styles.gstText}>GST</Text></View> : null}
                    </View>
                    {(canEdit || isAdmin) && !selectMode ? (
                      <View style={{ flexDirection: 'row', gap: 6, marginTop: 10, borderTopWidth: 1, borderTopColor: '#F3F4F6', paddingTop: 8 }}>
                        <Pressable testID={`view-${item.id}`} onPress={(e) => { e?.stopPropagation?.(); router.push(`/customers/${item.id}` as any); }}
                          style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: '#EFF6FF', paddingVertical: 8, borderRadius: 6 }}>
                          <Ionicons name="eye-outline" size={14} color={colors.brandPrimary} />
                          <Text style={{ color: colors.brandPrimary, fontWeight: '800', fontSize: 12 }}>Details</Text>
                        </Pressable>
                        {canEdit ? (
                          <Pressable testID={`edit-${item.id}`} onPress={(e) => { e?.stopPropagation?.(); router.push({ pathname: '/customers/new', params: { edit_id: item.id } } as any); }}
                            style={{ flex: 1.2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: '#FEF3C7', paddingVertical: 8, borderRadius: 6 }}>
                            <Ionicons name="create-outline" size={14} color="#B45309" />
                            <Text style={{ color: '#B45309', fontWeight: '800', fontSize: 12 }}>Edit Profile</Text>
                          </Pressable>
                        ) : null}
                        <Pressable testID={`print-${item.id}`} onPress={(e) => { e?.stopPropagation?.(); printCustomer(item); }}
                          style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: '#F1F5F9', paddingVertical: 8, borderRadius: 6 }}>
                          <Ionicons name="print-outline" size={14} color="#334155" />
                          <Text style={{ color: '#334155', fontWeight: '800', fontSize: 12 }}>Print</Text>
                        </Pressable>
                        {canWriteCustomers ? (
                          <Pressable testID={`del-${item.id}`} onPress={(e) => { e?.stopPropagation?.(); deleteCustomer(item); }}
                            style={{ flex: 0.8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: '#FEE2E2', paddingVertical: 8, borderRadius: 6 }}>
                            <Ionicons name="trash-outline" size={14} color={colors.error} />
                            <Text style={{ color: colors.error, fontWeight: '800', fontSize: 12 }}>Del</Text>
                          </Pressable>
                        ) : null}
                      </View>
                    ) : null}
                  </Card>
                </Pressable>
              );
            }}
          />
        )
      ) : (
        filteredAccounts === null ? <ScreenLoader /> : filteredAccounts.length === 0 ? (
          q ? (
            <EmptyState testID="accounts-nomatch" icon="search-outline" title="No matches" subtitle={`Nothing found for "${q}"`} />
          ) : (
            <EmptyState
              testID="accounts-empty"
              icon="cash-outline"
              title="No account entries"
              subtitle="Track invoices and expenses"
              actionLabel={canWriteAccounts ? "Add Entry" : undefined}
              onAction={canWriteAccounts ? () => router.push('/accounts/new' as any) : undefined}
            />
          )
        ) : (
          <FlatList
            testID="accounts-list"
            data={filteredAccounts}
            keyExtractor={(i) => i.id}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
            contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxxl }}
            renderItem={({ item }) => (
              <Card>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemTitle}>{item.title}</Text>
                    <Text style={styles.muted}>{item.party || '-'} • {item.type}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 4 }}>
                    <Text style={[styles.amount, { color: item.status === 'paid' ? colors.success : colors.error }]}>₹ {Number(item.amount).toLocaleString('en-IN')}</Text>
                    <StatusBadge status={item.status} />
                  </View>
                </View>
              </Card>
            )}
          />
        )
      )}
    </SafeAreaView>
      {selectMode ? (
        <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', gap: 8, padding: 16, paddingBottom: Math.max(insets.bottom, 16), backgroundColor: '#FFF', borderTopWidth: 1, borderTopColor: colors.border }} testID="bulk-bar">
          <Pressable onPress={exitSelect} testID="bulk-cancel" style={{ flex: 1, paddingVertical: 14, borderRadius: 8, alignItems: 'center', backgroundColor: colors.surfaceSecondary }}>
            <Text style={{ color: colors.onSurface, fontWeight: '700' }}>Cancel</Text>
          </Pressable>
          <Pressable
            testID="bulk-delete"
            disabled={selectedCount === 0 || busyBulk}
            onPress={bulkDelete}
            style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 14, borderRadius: 8, backgroundColor: colors.error, opacity: selectedCount === 0 || busyBulk ? 0.5 : 1 }}
          >
            <Ionicons name="trash" size={16} color="#FFF" />
            <Text style={{ color: '#FFF', fontWeight: '800' }}>{busyBulk ? 'Deleting…' : `Delete Selected (${selectedCount})`}</Text>
          </Pressable>
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceSecondary },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm },
  h1: { fontSize: font.display, fontWeight: '800', color: colors.onSurface },
  addBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.brandPrimary, alignItems: 'center', justifyContent: 'center' },
  segments: { flexDirection: 'row', backgroundColor: colors.surfaceSecondary, marginHorizontal: spacing.lg, marginBottom: spacing.sm, padding: 4, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  seg: { flex: 1, paddingVertical: 10, borderRadius: radius.sm, alignItems: 'center' },
  segActive: { backgroundColor: colors.surface },
  segText: { color: colors.muted, fontWeight: '600' },
  segTextActive: { color: colors.brandPrimary },
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: spacing.lg, marginBottom: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: 10, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  searchInput: { flex: 1, color: colors.onSurface, fontSize: font.base, paddingVertical: 0 },
  itemTitle: { fontSize: font.lg, fontWeight: '700', color: colors.onSurface },
  muted: { color: colors.muted, fontSize: font.sm, marginTop: 2 },
  amount: { fontWeight: '800', fontSize: font.lg },
  gstTag: { backgroundColor: colors.brandTertiary, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  gstText: { color: colors.onBrandTertiary, fontSize: 10, fontWeight: '800' },
  attachTag: { flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: colors.brandTertiary, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 6 },
  attachText: { color: colors.onBrandTertiary, fontSize: 10, fontWeight: '800' },
});
