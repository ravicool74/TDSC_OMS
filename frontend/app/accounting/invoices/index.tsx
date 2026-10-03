import React, { useCallback, useState, useMemo } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, TextInput, Platform, Linking } from 'react-native';
import { useFocusEffect, useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, font } from '@/src/theme';
import { api } from '@/src/api';
import { ScreenHeader } from '@/src/ScreenHeader';
import { useAuth } from '@/src/AuthContext';
import { confirm, notify } from '@/src/dialog';

const inr = (n: any) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export default function InvoicesList() {
  const router = useRouter();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const params = useLocalSearchParams<{ type?: string }>();
  const kind = params?.type === 'purchase' ? 'purchase' : 'sale';
  const [list, setList] = useState<any[] | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const load = useCallback(async () => {
    try { setList(await api.get<any[]>(`/invoices?invoice_type=${kind}`)); } catch { setList([]); }
  }, [kind]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const printPdf = async (inv: any) => {
    try {
      const url = await api.invoicePdfUrl(inv.id);
      if (Platform.OS === 'web' && typeof window !== 'undefined') window.open(url, '_blank');
      else await Linking.openURL(url);
    } catch (e: any) { notify('Failed', e?.message || 'Unable to open PDF'); }
  };
  const edit = (inv: any) => {
    router.push({ pathname: '/accounting/invoices/new', params: { edit_id: inv.id, type: inv.invoice_type } } as any);
  };
  const remove = async (inv: any) => {
    const ok = await confirm('Delete Invoice?', `Delete ${inv.invoice_no}? This cannot be undone.`, { confirmText: 'Delete', destructive: true });
    if (!ok) return;
    try { await api.del(`/invoices/${inv.id}`); await load(); }
    catch (e: any) { notify('Failed', e?.message || 'Try again'); }
  };

  // Comprehensive multi-criteria search
  const filteredList = useMemo(() => {
    if (!list) return null;
    const q = searchQuery.trim().toLowerCase();
    if (!q) return list;

    return list.filter(inv => {
      const invNo = String(inv.invoice_no || inv.invoice_number || '').toLowerCase();
      const partyName = String(inv.party_name || '').toLowerCase();
      const mobile = String(inv.party_mobile || inv.mobile || '').toLowerCase();
      const pan = String(inv.party_pan || inv.pan || '').toLowerCase();
      const gst = String(inv.party_gst || inv.party_gstin || inv.gst_no || '').toLowerCase();
      const code = String(inv.party_code || inv.customer_code || '').toLowerCase();
      const notes = String(inv.notes || '').toLowerCase();
      const date = String(inv.date || '').toLowerCase();
      const paymentMode = String(inv.payment_mode || '').toLowerCase();

      return (
        invNo.includes(q) ||
        partyName.includes(q) ||
        mobile.includes(q) ||
        pan.includes(q) ||
        gst.includes(q) ||
        code.includes(q) ||
        notes.includes(q) ||
        date.includes(q) ||
        paymentMode.includes(q)
      );
    });
  }, [list, searchQuery]);

  return (
    <View style={{ flex: 1, backgroundColor: '#F4F6FB' }}>
      <ScreenHeader
        title={kind === 'purchase' ? 'Purchase Bills' : 'Sale Invoices'}
        right={(
          <Pressable
            onPress={() => router.push({ pathname: '/accounting/invoices/new', params: kind === 'purchase' ? { type: 'purchase' } : undefined } as any)}
            testID="new-invoice-btn"
            style={styles.newBtn}
          >
            <Ionicons name="add" size={22} color="#FFF" />
          </Pressable>
        )}
      />

      {/* Search Voucher Section */}
      <View style={styles.searchSection}>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={18} color="#64748B" style={{ marginLeft: 4 }} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search Voucher (Voucher No., Name, Mobile, PAN, GST...)"
            placeholderTextColor="#94A3B8"
            value={searchQuery}
            onChangeText={setSearchQuery}
            returnKeyType="search"
            autoCapitalize="none"
            autoCorrect={false}
            testID="search-voucher-input"
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
          <View style={styles.chip}><Text style={styles.chipTxt}>Voucher No.</Text></View>
          <View style={styles.chip}><Text style={styles.chipTxt}>Name</Text></View>
          <View style={styles.chip}><Text style={styles.chipTxt}>Mobile</Text></View>
          <View style={styles.chip}><Text style={styles.chipTxt}>PAN</Text></View>
          <View style={styles.chip}><Text style={styles.chipTxt}>GST</Text></View>
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

      {list === null ? (
        <View style={{ padding: 24 }}><Text style={{ color: colors.muted }}>Loading…</Text></View>
      ) : list.length === 0 ? (
        <View style={{ padding: 32, alignItems: 'center' }}>
          <Ionicons name="receipt-outline" size={48} color={colors.muted} />
          <Text style={{ color: colors.muted, marginTop: 8 }}>No {kind === 'purchase' ? 'bills' : 'invoices'} yet</Text>
          <Pressable onPress={() => router.push('/accounting/invoices/new' as any)} style={[styles.newBtn, { marginTop: 12, paddingHorizontal: 20, borderRadius: radius.md, width: undefined, height: undefined }]}>
            <Text style={{ color: '#FFF', fontWeight: '800', padding: 10 }}>+ Create First</Text>
          </Pressable>
        </View>
      ) : filteredList && filteredList.length === 0 ? (
        <View style={styles.noMatchCard}>
          <Ionicons name="search-outline" size={42} color="#94A3B8" />
          <Text style={styles.noMatchTitle}>No vouchers match "{searchQuery}"</Text>
          <Text style={styles.noMatchSub}>
            Try searching by another Voucher No., Name, Mobile Number, PAN Number, or GST Number.
          </Text>
          <Pressable onPress={() => setSearchQuery('')} style={styles.clearSearchBtn}>
            <Ionicons name="close" size={16} color="#FFF" />
            <Text style={styles.clearSearchBtnTxt}>Reset Search</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={filteredList}
          keyExtractor={i => i.id}
          contentContainerStyle={{ padding: spacing.md, gap: 10, paddingBottom: spacing.xxxl }}
          renderItem={({ item }) => (
            <View style={styles.card} testID={`inv-${item.id}`}>
              <Pressable onPress={() => router.push(`/accounting/invoices/${item.id}` as any)} style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={styles.no}>{item.invoice_no}</Text>
                    <View style={[styles.badge, item.status === 'paid' ? { backgroundColor: '#DCFCE7' } : item.status === 'partial' ? { backgroundColor: '#FEF3C7' } : { backgroundColor: '#FEE2E2' }]}>
                      <Text style={[styles.badgeTxt, { color: item.status === 'paid' ? '#059669' : item.status === 'partial' ? '#B45309' : '#DC2626' }]}>{String(item.status).toUpperCase()}</Text>
                    </View>
                  </View>
                  <Text style={styles.party}>{item.party_name}</Text>

                  {/* Customer Search Metadata (Mobile, PAN, GST, Code) */}
                  {(item.party_mobile || item.party_pan || item.party_gst) ? (
                    <View style={styles.partyMetaRow}>
                      {item.party_mobile ? (
                        <View style={styles.metaBadge}>
                          <Ionicons name="call-outline" size={10} color="#0284C7" />
                          <Text style={styles.metaBadgeTxt}>{item.party_mobile}</Text>
                        </View>
                      ) : null}
                      {item.party_pan ? (
                        <View style={styles.metaBadge}>
                          <Text style={styles.metaBadgeLbl}>PAN:</Text>
                          <Text style={styles.metaBadgeTxt}>{item.party_pan}</Text>
                        </View>
                      ) : null}
                      {item.party_gst ? (
                        <View style={styles.metaBadge}>
                          <Text style={styles.metaBadgeLbl}>GST:</Text>
                          <Text style={styles.metaBadgeTxt}>{item.party_gst}</Text>
                        </View>
                      ) : null}
                    </View>
                  ) : null}

                  <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 4 }}>
                    <Text style={styles.meta}>{item.date}</Text>
                    {item.payment_mode ? <Text style={styles.meta}>• {String(item.payment_mode).replace('_', ' ').toUpperCase()}</Text> : null}
                    {(item.attachments?.length || 0) > 0 ? (
                      <View style={styles.attachChip}>
                        <Ionicons name="attach" size={12} color={colors.brandPrimary} />
                        <Text style={styles.attachTxt}>{item.attachments.length}</Text>
                      </View>
                    ) : null}
                  </View>
                </View>
                <View style={{ alignItems: 'flex-end', marginLeft: 8 }}>
                  <Text style={styles.amt}>{inr(item.total_amount)}</Text>
                  {item.balance > 0 ? <Text style={styles.bal}>Bal: {inr(item.balance)}</Text> : null}
                </View>
              </Pressable>

              <View style={styles.actions}>
                <Pressable onPress={() => printPdf(item)} testID={`print-${item.id}`} style={[styles.actBtn, { backgroundColor: '#EFF6FF' }]}>
                  <Ionicons name="print" size={16} color={colors.brandPrimary} />
                  <Text style={[styles.actTxt, { color: colors.brandPrimary }]}>Print</Text>
                </Pressable>
                {isAdmin ? (
                  <>
                    <Pressable onPress={() => edit(item)} testID={`edit-${item.id}`} style={[styles.actBtn, { backgroundColor: '#FEF3C7' }]}>
                      <Ionicons name="create-outline" size={16} color="#B45309" />
                      <Text style={[styles.actTxt, { color: '#B45309' }]}>Edit</Text>
                    </Pressable>
                    <Pressable onPress={() => remove(item)} testID={`del-${item.id}`} style={[styles.actBtn, { backgroundColor: '#FEE2E2' }]}>
                      <Ionicons name="trash-outline" size={16} color="#DC2626" />
                      <Text style={[styles.actTxt, { color: '#DC2626' }]}>Delete</Text>
                    </Pressable>
                  </>
                ) : null}
              </View>
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  newBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.brandPrimary, alignItems: 'center', justifyContent: 'center' },
  searchSection: {
    backgroundColor: '#FFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    gap: 8,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: radius.md,
    paddingHorizontal: 10,
    height: 42,
    gap: 6,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    color: '#0F172A',
    paddingVertical: 0,
    height: '100%',
    ...Platform.select({ web: { outlineStyle: 'none' } as any }),
  },
  clearBtn: {
    padding: 4,
  },
  criteriaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  criteriaLbl: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748B',
  },
  chip: {
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  chipTxt: {
    fontSize: 10,
    fontWeight: '700',
    color: '#1D4ED8',
  },
  resultBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 2,
  },
  resultTxt: {
    fontSize: 11,
    color: '#64748B',
  },
  resetLink: {
    fontSize: 11,
    fontWeight: '700',
    color: '#2563EB',
  },
  card: { backgroundColor: '#FFF', borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: 12, gap: 8 },
  actions: { flexDirection: 'row', gap: 6, borderTopWidth: 1, borderTopColor: '#F3F4F6', paddingTop: 8 },
  actBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 8, borderRadius: radius.sm },
  actTxt: { fontWeight: '800', fontSize: 12 },
  no: { color: '#111827', fontWeight: '800', fontSize: font.base },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill },
  badgeTxt: { fontSize: 9, fontWeight: '900', letterSpacing: 0.3 },
  party: { color: '#1E293B', fontWeight: '700', fontSize: 13, marginTop: 2 },
  partyMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
  },
  metaBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#F0F9FF',
    borderWidth: 1,
    borderColor: '#BAE6FD',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  metaBadgeLbl: {
    fontSize: 9,
    fontWeight: '800',
    color: '#0369A1',
  },
  metaBadgeTxt: {
    fontSize: 10,
    fontWeight: '700',
    color: '#0C4A6E',
  },
  meta: { color: colors.muted, fontSize: 11 },
  amt: { color: '#059669', fontWeight: '800', fontSize: font.base },
  bal: { color: '#DC2626', fontSize: 11, marginTop: 2 },
  attachChip: { flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: '#EFF6FF', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4 },
  attachTxt: { color: colors.brandPrimary, fontSize: 10, fontWeight: '800' },
  noMatchCard: {
    margin: 20,
    padding: 24,
    backgroundColor: '#FFF',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
    gap: 8,
  },
  noMatchTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
    marginTop: 4,
    textAlign: 'center',
  },
  noMatchSub: {
    fontSize: 12,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 18,
    maxWidth: 380,
  },
  clearSearchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#2563EB',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: radius.sm,
    marginTop: 8,
  },
  clearSearchBtnTxt: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '800',
  },
});
