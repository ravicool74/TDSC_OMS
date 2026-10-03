import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, TextInput, Alert, ActivityIndicator } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, font, shadow } from '@/src/theme';
import { api } from '@/src/api';
import { ScreenHeader } from '@/src/ScreenHeader';
import { confirm, notify } from '@/src/dialog';

const inr = (n: any) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export default function ProformaList() {
  const router = useRouter();
  const [proformas, setProformas] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [convertingId, setConvertingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      let url = '/accounting/proforma';
      if (search.trim()) url += `?q=${encodeURIComponent(search.trim())}`;
      const res = await api.get<any[]>(url);
      setProformas(res || []);
    } catch {
      setProformas([]);
    } finally {
      setLoading(false);
    }
  }, [search]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const convertToInvoice = async (item: any) => {
    const ok = await confirm(
      'Convert to Sale Invoice?',
      `Proforma Invoice "${item.proforma_no}" will be converted into a final Tax Sale Invoice.`,
      { confirmText: 'Convert', destructive: false }
    );
    if (!ok) return;

    setConvertingId(item.id);
    try {
      const res: any = await api.post(`/accounting/proforma/${item.id}/convert-to-invoice`, {});
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

  return (
    <View style={styles.root} testID="proforma-screen">
      <ScreenHeader
        title="Proforma Invoices"
        right={(
          <Pressable
            style={styles.addBtn}
            onPress={() => router.push('/accounting/proforma/new' as any)}
            testID="new-proforma-btn"
          >
            <Ionicons name="add" size={18} color="#FFF" />
            <Text style={styles.addBtnText}>New Proforma</Text>
          </Pressable>
        )}
      />

      <View style={styles.filterBar}>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={16} color={colors.muted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search proforma no, contractor..."
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
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={colors.brandPrimary} />
          <Text style={{ color: colors.muted, marginTop: 8 }}>Loading proforma invoices...</Text>
        </View>
      ) : proformas.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Ionicons name="document-text-outline" size={48} color={colors.muted} />
          <Text style={styles.emptyTitle}>No Proforma Invoices</Text>
          <Text style={styles.emptySub}>Issue provisional commercial invoices prior to final billing.</Text>
          <Pressable
            style={[styles.addBtn, { marginTop: 16 }]}
            onPress={() => router.push('/accounting/proforma/new' as any)}
          >
            <Ionicons name="add" size={18} color="#FFF" />
            <Text style={styles.addBtnText}>Create Proforma</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={proformas}
          keyExtractor={item => item.id}
          contentContainerStyle={{ padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxxl }}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.profNo}>{item.proforma_no}</Text>
                  <Text style={styles.custName}>{item.customer_name}</Text>
                  {item.customer_code ? <Text style={styles.custCode}>{item.customer_code}</Text> : null}
                </View>
                <View style={[styles.statusBadge, {
                  backgroundColor: item.status === 'converted' ? '#DCFCE7' : '#FEF3C7'
                }]}>
                  <Text style={[styles.statusBadgeText, {
                    color: item.status === 'converted' ? '#059669' : '#D97706'
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
                        <Text style={styles.convertBtnText}>Convert to Tax Invoice</Text>
                      </>
                    )}
                  </Pressable>
                ) : (
                  <View style={styles.convertedTag}>
                    <Ionicons name="checkmark-circle" size={16} color="#059669" />
                    <Text style={styles.convertedTagText}>Converted to Tax Invoice</Text>
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
  filterBar: { padding: spacing.md, backgroundColor: '#FFF', borderBottomWidth: 1, borderBottomColor: colors.border },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#F1F5F9', borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 6 },
  searchInput: { flex: 1, fontSize: font.sm, color: '#0F172A' },
  card: { backgroundColor: '#FFF', borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, ...shadow.card },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  profNo: { fontSize: 11, fontWeight: '800', color: '#D97706' },
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
  convertBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#D97706', paddingVertical: 8, borderRadius: radius.md },
  convertBtnText: { color: '#FFF', fontWeight: '700', fontSize: 12 },
  convertedTag: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 6 },
  convertedTagText: { color: '#059669', fontWeight: '800', fontSize: 12 },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  emptyTitle: { fontSize: font.lg, fontWeight: '800', color: '#0F172A', marginTop: 12 },
  emptySub: { fontSize: font.sm, color: colors.muted, textAlign: 'center', marginTop: 4, maxWidth: 280 },
});
