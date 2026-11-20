import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, FlatList, Pressable } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, font } from '@/src/theme';
import { api } from '@/src/api';
import { Card, ScreenLoader } from '@/src/ui';
import { ScreenHeader } from '@/src/ScreenHeader';

const inr = (n: any) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export default function BooksScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ bank?: string; mode?: string }>();
  const initialMode = params?.mode === 'bank' || params?.bank ? 'bank' : 'cash';
  const initialBank = params?.bank || 'all';

  const [mode, setMode] = useState<'cash' | 'bank'>(initialMode);
  const [banks, setBanks] = useState<any[]>([]);
  const [bankId, setBankId] = useState<string>(initialBank);
  const [data, setData] = useState<any | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const b = await api.get<any[]>('/bank-accounts');
        setBanks(b || []);
      } catch {}
    })();
  }, []);

  useEffect(() => {
    if (params?.bank) {
      setBankId(params.bank);
      setMode('bank');
    } else if (params?.mode) {
      setMode(params.mode as any);
    }
  }, [params?.bank, params?.mode]);

  const load = useCallback(async () => {
    setData(null);
    try {
      if (mode === 'cash') {
        setData(await api.get<any>('/accounting/cash-book'));
      } else {
        const targetId = bankId || 'all';
        setData(await api.get<any>(`/accounting/bank-book?bank_id=${targetId}`));
      }
    } catch (e) {
      console.error('Failed to load book data:', e);
    }
  }, [mode, bankId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const rows = data?.rows || data?.entries || [];
  const isConsolidated = bankId === 'all' || !bankId;

  return (
    <View style={{ flex: 1, backgroundColor: colors.surfaceSecondary }} testID="books-screen">
      <ScreenHeader title="Books" />
      <View style={styles.tabs}>
        <Pressable testID="tab-cash" onPress={() => setMode('cash')} style={[styles.tab, mode === 'cash' && styles.tabActive]}>
          <Text style={[styles.tabText, mode === 'cash' && styles.tabTextActive]}>Cash Book</Text>
        </Pressable>
        <Pressable testID="tab-bank" onPress={() => setMode('bank')} style={[styles.tab, mode === 'bank' && styles.tabActive]}>
          <Text style={[styles.tabText, mode === 'bank' && styles.tabTextActive]}>Bank Book</Text>
        </Pressable>
      </View>

      {mode === 'bank' && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.bankChips}>
          <Pressable
            onPress={() => setBankId('all')}
            style={[styles.chip, isConsolidated && styles.chipActive]}
          >
            <Ionicons name="globe-outline" size={14} color={isConsolidated ? '#FFF' : '#00104A'} style={{ marginRight: 4 }} />
            <Text style={[styles.chipText, isConsolidated && { color: colors.onBrandPrimary }]}>
              🌐 Consolidated (All Banks)
            </Text>
          </Pressable>
          {banks.map(b => {
            const isSel = bankId === b.id;
            return (
              <Pressable
                key={b.id}
                onPress={() => setBankId(b.id)}
                style={[styles.chip, isSel && styles.chipActive]}
              >
                <Ionicons name="business-outline" size={14} color={isSel ? '#FFF' : '#00104A'} style={{ marginRight: 4 }} />
                <Text style={[styles.chipText, isSel && { color: colors.onBrandPrimary }]}>
                  {b.name} ({b.account_no ? b.account_no.slice(-4).padStart(b.account_no.length, '•') : 'A/c'})
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      {data === null ? (
        <ScreenLoader />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(_, i) => String(i)}
          ListHeaderComponent={(
            <View style={{ gap: spacing.md, marginBottom: spacing.md }}>
              {/* Header Statement Banner */}
              <Card style={{ marginHorizontal: spacing.lg, marginTop: spacing.md, padding: spacing.md }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                  <View style={{ flex: 1, minWidth: 200 }}>
                    <Text style={{ fontSize: 16, fontWeight: '900', color: '#00104A' }}>
                      {mode === 'cash'
                        ? 'Cash in Hand Book'
                        : isConsolidated
                        ? 'Consolidated Bank Book (All Linked Accounts)'
                        : `${data.bank?.name || 'Bank Account'} (${data.bank?.bank_name || 'Bank'})`}
                    </Text>
                    <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>
                      {mode === 'cash'
                        ? 'Cash in Hand Register & Bank Deposits'
                        : isConsolidated
                        ? 'Consolidated Multi-Bank Statement • Official Management Ledger'
                        : `A/c ${data.bank?.account_no || '—'} • IFSC: ${data.bank?.ifsc || '—'}`}
                    </Text>
                  </View>

                  <Pressable
                    onPress={() => {
                      if (mode === 'cash') {
                        router.push('/accounting/reports?report=cash_ledger' as any);
                      } else if (isConsolidated) {
                        router.push('/accounting/reports?report=consolidated_bank_book' as any);
                      } else {
                        router.push(`/accounting/reports?report=bank_ledger&bank=${bankId}` as any);
                      }
                    }}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 6,
                      backgroundColor: '#EFF6FF',
                      borderColor: '#BFDBFE',
                      borderWidth: 1,
                      paddingVertical: 6,
                      paddingHorizontal: 12,
                      borderRadius: radius.md,
                    }}
                  >
                    <Ionicons name="print-outline" size={15} color="#2563EB" />
                    <Text style={{ color: '#2563EB', fontWeight: '800', fontSize: 12 }}>Print / PDF Ledger</Text>
                  </Pressable>
                </View>

                {/* KPIs Row */}
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderColor: '#F1F5F9' }}>
                  <View>
                    <Text style={styles.muted}>Total Inflow</Text>
                    <Text style={[styles.mv, { color: colors.success }]}>
                      {inr(data.kpis?.[0]?.value || data.kpis?.[1]?.value || data.total_in || 0)}
                    </Text>
                  </View>
                  <View>
                    <Text style={styles.muted}>Total Outflow</Text>
                    <Text style={[styles.mv, { color: colors.error }]}>
                      {inr(data.kpis?.[1]?.value || data.kpis?.[2]?.value || data.total_out || 0)}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={styles.muted}>Closing Balance</Text>
                    <Text style={[styles.mv, { color: '#00104A' }]}>{inr(data.total_closing_balance || data.closing || 0)}</Text>
                  </View>
                </View>
              </Card>

              {/* Opening Balance Multi-Bank Breakdown (When available) */}
              {data.opening_balances && data.opening_balances.length > 0 && (
                <Card style={{ marginHorizontal: spacing.lg, padding: spacing.md, backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#CBD5E1' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                    <Ionicons name="wallet-outline" size={15} color="#2563EB" />
                    <Text style={{ fontSize: 12, fontWeight: '800', color: '#00104A', textTransform: 'uppercase' }}>Opening Balance Breakdown:</Text>
                  </View>
                  {data.opening_balances.map((b: any, idx: number) => (
                    <View key={idx} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3, borderBottomWidth: idx < data.opening_balances.length - 1 ? 1 : 0, borderColor: '#E2E8F0' }}>
                      <Text style={{ fontSize: 11, fontWeight: '700', color: '#334155', flex: 1 }}>
                        {b.index} {b.name} {b.account_no && b.account_no !== '—' ? `(${b.bank_name} • A/c ${b.account_no})` : ''}
                      </Text>
                      <Text style={{ fontSize: 11, fontWeight: '800', color: '#059669' }}>
                        Current Balance in {inr(b.balance)}
                      </Text>
                    </View>
                  ))}
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6, paddingTop: 6, borderTopWidth: 1.5, borderColor: '#00104A' }}>
                    <Text style={{ fontSize: 11.5, fontWeight: '900', color: '#00104A' }}>Total OB = (i)+(ii)+(iii)+... =</Text>
                    <Text style={{ fontSize: 12, fontWeight: '900', color: '#059669' }}>{inr(data.total_previous_ob || 0)}</Text>
                  </View>
                </Card>
              )}

              {/* Closing Balance Multi-Bank Breakdown (When available) */}
              {data.closing_balances && data.closing_balances.length > 0 && (
                <Card style={{ marginHorizontal: spacing.lg, padding: spacing.md, backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#CBD5E1' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                    <Ionicons name="lock-closed-outline" size={15} color="#059669" />
                    <Text style={{ fontSize: 12, fontWeight: '800', color: '#00104A', textTransform: 'uppercase' }}>Closing Balance Breakdown:</Text>
                  </View>
                  {data.closing_balances.map((b: any, idx: number) => {
                    const isExp = b.id?.startsWith('exp_');
                    return (
                      <View key={idx} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3, borderBottomWidth: idx < data.closing_balances.length - 1 ? 1 : 0, borderColor: '#E2E8F0' }}>
                        <Text style={{ fontSize: 11, fontWeight: '700', color: '#334155', flex: 1 }}>
                          {b.index} {b.name} {b.account_no && b.account_no !== '—' ? `(${b.bank_name} • A/c ${b.account_no})` : ''}
                        </Text>
                        <Text style={{ fontSize: 11, fontWeight: '800', color: isExp ? '#DC2626' : '#00104A' }}>
                          {isExp ? `Total: ${inr(b.balance)}` : `Current Balance in ${inr(b.balance)}`}
                        </Text>
                      </View>
                    );
                  })}
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6, paddingTop: 6, borderTopWidth: 1.5, borderColor: '#00104A' }}>
                    <Text style={{ fontSize: 11.5, fontWeight: '900', color: '#00104A' }}>Total CB = (i)+(ii)+(iii)+(iv)+(v) =</Text>
                    <Text style={{ fontSize: 12, fontWeight: '900', color: '#00104A' }}>{inr(data.total_closing_balance || 0)}</Text>
                  </View>
                  <View style={{ marginTop: 8, padding: 6, borderRadius: 4, backgroundColor: '#ECFDF5', borderWidth: 1, borderColor: '#A7F3D0', flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Ionicons name="checkmark-circle" size={16} color="#059669" />
                    <Text style={{ fontSize: 11.5, fontWeight: '800', color: '#065F46' }}>
                      {data.reconciliation_message || 'Account is ok. Total O.B matches Total C.B perfectly.'}
                    </Text>
                  </View>
                </Card>
              )}
            </View>
          )}
          contentContainerStyle={{ padding: spacing.lg, gap: 6, paddingBottom: spacing.xxxl }}
          renderItem={({ item }) => {
            const inAmt = item.receipt_raw !== undefined ? item.receipt_raw : (item.type === 'in' || item.type === 'credit' ? item.amount : 0);
            const outAmt = item.payment_raw !== undefined ? item.payment_raw : (item.type === 'out' || item.type === 'debit' ? item.amount : 0);
            const isCredit = inAmt > 0;
            const amtVal = isCredit ? inAmt : outAmt;

            return (
              <View style={styles.row}>
                <Text style={styles.date}>{item.date || '—'}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.title}>{item.party || item.party_name || 'Direct Customer / Payee'}</Text>
                  <Text style={styles.muted}>
                    {item.ref_no || item.voucher_no || item.no || '—'} • {item.trans_type || item.type || item.category || 'Transaction'}
                    {item.mode ? ` • ${item.mode}` : ''}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={[styles.amt, { color: isCredit ? colors.success : colors.error }]}>
                    {isCredit ? '+' : '-'} {inr(amtVal)}
                  </Text>
                  <Text style={styles.muted}>Bal {item.balance || inr(item.running || 0)}</Text>
                </View>
              </View>
            );
          }}
          ListEmptyComponent={<Text style={{ padding: spacing.xl, textAlign: 'center', color: colors.muted }}>No records found for this period.</Text>}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', backgroundColor: colors.surfaceSecondary, margin: spacing.lg, marginBottom: 0, padding: 4, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  tab: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: radius.sm },
  tabActive: { backgroundColor: colors.surface },
  tabText: { color: colors.muted, fontWeight: '600' },
  tabTextActive: { color: colors.brandPrimary },
  bankChips: { padding: spacing.lg, gap: 8, paddingBottom: 0 },
  chip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurface, fontWeight: '600' },
  row: { flexDirection: 'row', gap: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  date: { color: colors.muted, fontSize: font.sm, width: 80 },
  title: { color: colors.onSurface, fontWeight: '700' },
  muted: { color: colors.muted, fontSize: font.sm, marginTop: 2 },
  amt: { fontWeight: '800' },
  mv: { fontSize: font.lg, fontWeight: '800', color: colors.onSurface, marginTop: 2 },
});

