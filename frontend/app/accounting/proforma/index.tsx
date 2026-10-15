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

  const editProforma = (item: any) => {
    router.push({ pathname: '/accounting/proforma/new', params: { edit_id: item.id } } as any);
  };

  const deleteProforma = async (item: any) => {
    const ok = await confirm(
      'Delete Proforma Invoice?',
      `Are you sure you want to delete proforma invoice "${item.proforma_no}"? This cannot be undone.`,
      { confirmText: 'Delete', destructive: true }
    );
    if (!ok) return;

    try {
      await api.del(`/accounting/proforma/${item.id}`);
      notify('Deleted', `Proforma invoice ${item.proforma_no} deleted successfully.`);
      await load();
    } catch (e: any) {
      Alert.alert('Delete Failed', e?.message || 'Unable to delete proforma invoice');
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
        <View style={styles.searchRow}>
          <View style={styles.searchBox}>
            <Ionicons name="search" size={16} color={colors.muted} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search proforma no, customer, mobile..."
              value={search}
              onChangeText={setSearch}
              onSubmitEditing={load}
              testID="search-proforma-input"
            />
            {search ? (
              <Pressable onPress={() => { setSearch(''); load(); }}>
                <Ionicons name="close-circle" size={16} color={colors.muted} />
              </Pressable>
            ) : null}
          </View>
          <Pressable style={styles.searchActionBtn} onPress={load} testID="search-proforma-btn">
            <Ionicons name="search" size={15} color="#FFF" />
            <Text style={styles.searchActionBtnTxt}>Search</Text>
          </Pressable>
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
            <View style={styles.card} testID={`prof-card-${item.id}`}>
              <View style={styles.cardHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.profNo}>{item.proforma_no}</Text>
                  <Text style={styles.custName}>{item.customer_name}</Text>
                  {item.customer_code ? <Text style={styles.custCode}>{item.customer_code}</Text> : null}
                  {item.customer_mobile ? <Text style={styles.custCode}>Mob: {item.customer_mobile}</Text> : null}
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

              {/* Actions Footer */}
              <View style={styles.cardFooter}>
                <View style={styles.actionBtnsRow}>
                  {/* Edit Button */}
                  <Pressable
                    style={styles.editBtn}
                    onPress={() => editProforma(item)}
                    testID={`edit-prof-${item.id}`}
                  >
                    <Ionicons name="create-outline" size={15} color="#4338CA" />
                    <Text style={styles.editBtnText}>Edit</Text>
                  </Pressable>

                  {/* Delete Button */}
                  <Pressable
                    style={styles.deleteBtn}
                    onPress={() => deleteProforma(item)}
                    testID={`del-prof-${item.id}`}
                  >
                    <Ionicons name="trash-outline" size={15} color="#DC2626" />
                    <Text style={styles.deleteBtnText}>Delete</Text>
                  </Pressable>

                  {/* Convert Action */}
                  {item.status !== 'converted' ? (
                    <Pressable
                      style={styles.convertBtn}
                      onPress={() => convertToInvoice(item)}
                      disabled={convertingId === item.id}
                      testID={`convert-prof-${item.id}`}
                    >
                      {convertingId === item.id ? (
                        <ActivityIndicator size="small" color="#FFF" />
                      ) : (
                        <>
                          <Ionicons name="arrow-forward-circle" size={15} color="#FFF" />
                          <Text style={styles.convertBtnText}>Convert to Invoice</Text>
                        </>
                      )}
                    </Pressable>
                  ) : (
                    <View style={styles.convertedTag}>
                      <Ionicons name="checkmark-circle" size={15} color="#059669" />
                      <Text style={styles.convertedTagText}>Converted</Text>
                    </View>
                  )}
                </View>
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
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchBox: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#F1F5F9', borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 6 },
  searchInput: { flex: 1, fontSize: font.sm, color: '#0F172A' },
  searchActionBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.brandPrimary, paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.md },
  searchActionBtnTxt: { color: '#FFF', fontWeight: '800', fontSize: 12 },
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
  actionBtnsRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  editBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: '#EEF2FF', paddingVertical: 7, borderRadius: radius.md, borderWidth: 1, borderColor: '#C7D2FE' },
  editBtnText: { color: '#4338CA', fontWeight: '800', fontSize: 12 },
  deleteBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: '#FEF2F2', paddingVertical: 7, borderRadius: radius.md, borderWidth: 1, borderColor: '#FECACA' },
  deleteBtnText: { color: '#DC2626', fontWeight: '800', fontSize: 12 },
  convertBtn: { flex: 1.6, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#D97706', paddingVertical: 7, borderRadius: radius.md },
  convertBtnText: { color: '#FFF', fontWeight: '700', fontSize: 12 },
  convertedTag: { flex: 1.6, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 6 },
  convertedTagText: { color: '#059669', fontWeight: '800', fontSize: 12 },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  emptyTitle: { fontSize: font.lg, fontWeight: '800', color: '#0F172A', marginTop: 12 },
  emptySub: { fontSize: font.sm, color: colors.muted, textAlign: 'center', marginTop: 4, maxWidth: 280 },
});
