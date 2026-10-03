import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, TextInput, Alert, ActivityIndicator } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, font, shadow } from '@/src/theme';
import { api } from '@/src/api';
import { ScreenHeader } from '@/src/ScreenHeader';
import { confirm, notify } from '@/src/dialog';
import { useAuth } from '@/src/AuthContext';

const inr = (n: any) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export default function EstimatesList() {
  const router = useRouter();
  const { user } = useAuth();
  const [estimates, setEstimates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [convertingId, setConvertingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      let url = '/accounting/estimates';
      const params: string[] = [];
      if (search.trim()) params.push(`q=${encodeURIComponent(search.trim())}`);
      if (statusFilter !== 'all') params.push(`status=${encodeURIComponent(statusFilter)}`);
      if (params.length) url += `?${params.join('&')}`;

      const res = await api.get<any[]>(url);
      setEstimates(res || []);
    } catch {
      setEstimates([]);
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const convertToInvoice = async (item: any) => {
    const ok = await confirm(
      'Convert to Sale Invoice?',
      `Estimate "${item.estimate_no}" will be converted into a real Sale Invoice with an auto-generated invoice number.`,
      { confirmText: 'Convert', destructive: false }
    );
    if (!ok) return;

    setConvertingId(item.id);
    try {
      const res: any = await api.post(`/accounting/estimates/${item.id}/convert-to-invoice`, {});
      notify('Converted!', `Generated Invoice: ${res.invoice_number}`);
      await load();
      if (res.id) {
        router.push(`/accounting/invoices/${res.id}` as any);
      }
    } catch (e: any) {
      Alert.alert('Conversion Failed', e?.message || 'Try again');
    } finally {
      setConvertingId(null);
    }
  };

  const statuses = ['all', 'draft', 'sent', 'accepted', 'converted'];

  return (
    <View style={styles.root} testID="estimates-screen">
      <ScreenHeader
        title="Estimates / Quotations"
        right={(
          <Pressable
            style={styles.addBtn}
            onPress={() => router.push('/accounting/estimates/new' as any)}
            testID="new-estimate-btn"
          >
            <Ionicons name="add" size={18} color="#FFF" />
            <Text style={styles.addBtnText}>New Estimate</Text>
          </Pressable>
        )}
      />

      {/* Search & Status Filters */}
      <View style={styles.filterBar}>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={16} color={colors.muted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search estimate no, contractor..."
            value={search}
            onChangeText={setSearch}
            onSubmitEditing={load}
          />
          {search ? (
            <Pressable onPress={() => { setSearch(''); load(); }}>
              <Ionicons name="close-circle" size={16} color={colors.muted} />
            </Pressable>
          ) : null}
        </View>

        <View style={styles.statusRow}>
          {statuses.map(st => (
            <Pressable
              key={st}
              onPress={() => setStatusFilter(st)}
              style={[styles.statusChip, statusFilter === st && styles.statusChipActive]}
            >
              <Text style={[styles.statusChipText, statusFilter === st && styles.statusChipTextActive]}>
                {st.toUpperCase()}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={colors.brandPrimary} />
          <Text style={{ color: colors.muted, marginTop: 8 }}>Loading estimates...</Text>
        </View>
      ) : estimates.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Ionicons name="clipboard-outline" size={48} color={colors.muted} />
          <Text style={styles.emptyTitle}>No Estimates Found</Text>
          <Text style={styles.emptySub}>Create formal quotations and convert them to invoices in 1-click.</Text>
          <Pressable
            style={[styles.addBtn, { marginTop: 16 }]}
            onPress={() => router.push('/accounting/estimates/new' as any)}
          >
            <Ionicons name="add" size={18} color="#FFF" />
            <Text style={styles.addBtnText}>Create First Estimate</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={estimates}
          keyExtractor={item => item.id}
          contentContainerStyle={{ padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxxl }}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.estNo}>{item.estimate_no}</Text>
                  <Text style={styles.custName}>{item.customer_name}</Text>
                  {item.customer_code ? <Text style={styles.custCode}>{item.customer_code}</Text> : null}
                </View>
                <View style={[styles.statusBadge, {
                  backgroundColor: item.status === 'converted' ? '#DCFCE7' : item.status === 'accepted' ? '#DBEAFE' : '#FEF3C7'
                }]}>
                  <Text style={[styles.statusBadgeText, {
                    color: item.status === 'converted' ? '#059669' : item.status === 'accepted' ? '#2563EB' : '#D97706'
                  }]}>
                    {item.status.toUpperCase()}
                  </Text>
                </View>
              </View>

              <View style={styles.cardBody}>
                <View style={styles.infoRow}>
                  <Text style={styles.infoLbl}>Date</Text>
                  <Text style={styles.infoVal}>{item.date}</Text>
                </View>
                <View style={styles.infoRow}>
                  <Text style={styles.infoLbl}>Total Items</Text>
                  <Text style={styles.infoVal}>{(item.items || []).length} items</Text>
                </View>
                <View style={styles.infoRow}>
                  <Text style={styles.infoLbl}>Grand Total</Text>
                  <Text style={styles.grandTotalVal}>{inr(item.grand_total)}</Text>
                </View>
              </View>

              {/* Actions Footer */}
              <View style={styles.cardFooter}>
                {item.status !== 'converted' ? (
                  <Pressable
                    style={styles.convertBtn}
                    onPress={() => convertToInvoice(item)}
                    disabled={convertingId === item.id}
                  >
                    {convertingId === item.id ? (
                      <ActivityIndicator size="small" color="#FFF" />
                    ) : (
                      <>
                        <Ionicons name="arrow-forward-circle" size={16} color="#FFF" />
                        <Text style={styles.convertBtnText}>Convert to Sale Invoice</Text>
                      </>
                    )}
                  </Pressable>
                ) : (
                  <View style={styles.convertedTag}>
                    <Ionicons name="checkmark-circle" size={16} color="#059669" />
                    <Text style={styles.convertedTagText}>Converted to Invoice</Text>
                  </View>
                )}
              </View>
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F8FAFC' },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.brandPrimary, paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill },
  addBtnText: { color: '#FFF', fontWeight: '800', fontSize: 12 },
  filterBar: { padding: spacing.md, backgroundColor: '#FFF', borderBottomWidth: 1, borderBottomColor: colors.border, gap: 8 },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#F1F5F9', borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 6 },
  searchInput: { flex: 1, fontSize: font.sm, color: '#0F172A' },
  statusRow: { flexDirection: 'row', gap: 6 },
  statusChip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: '#F1F5F9' },
  statusChipActive: { backgroundColor: colors.brandPrimary },
  statusChipText: { fontSize: 10, fontWeight: '800', color: '#64748B' },
  statusChipTextActive: { color: '#FFF' },
  card: { backgroundColor: '#FFF', borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, ...shadow.card },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  estNo: { fontSize: 11, fontWeight: '800', color: colors.brandPrimary },
  custName: { fontSize: font.base, fontWeight: '800', color: '#0F172A', marginTop: 2 },
  custCode: { fontSize: 11, color: colors.muted, marginTop: 1 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4 },
  statusBadgeText: { fontSize: 9, fontWeight: '900' },
  cardBody: { marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: '#F1F5F9', gap: 4 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between' },
  infoLbl: { fontSize: 11, color: colors.muted, fontWeight: '600' },
  infoVal: { fontSize: 11, color: '#0F172A', fontWeight: '700' },
  grandTotalVal: { fontSize: font.base, color: '#059669', fontWeight: '900' },
  cardFooter: { marginTop: spacing.md, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: '#F1F5F9' },
  convertBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#2563EB', paddingVertical: 8, borderRadius: radius.md },
  convertBtnText: { color: '#FFF', fontWeight: '700', fontSize: 12 },
  convertedTag: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 6 },
  convertedTagText: { color: '#059669', fontWeight: '800', fontSize: 12 },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  emptyTitle: { fontSize: font.lg, fontWeight: '800', color: '#0F172A', marginTop: 12 },
  emptySub: { fontSize: font.sm, color: colors.muted, textAlign: 'center', marginTop: 4, maxWidth: 280 },
});
