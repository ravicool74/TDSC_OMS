import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, TextInput, ActivityIndicator } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, font, shadow } from '@/src/theme';
import { api } from '@/src/api';
import { ScreenHeader } from '@/src/ScreenHeader';

const inr = (n: any) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (d: number) => {
  const dt = new Date();
  dt.setDate(dt.getDate() - d);
  return dt.toISOString().slice(0, 10);
};

export default function DayBookReport() {
  const router = useRouter();
  const [fromDate, setFromDate] = useState(daysAgo(7));
  const [toDate, setToDate] = useState(today());
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<any>(`/system/reports/day-book?from_date=${fromDate}&to_date=${toDate}`);
      setData(res);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const setPreset = (days: number) => {
    if (days === 0) {
      setFromDate(today());
      setToDate(today());
    } else {
      setFromDate(daysAgo(days));
      setToDate(today());
    }
  };

  const transactions: any[] = data?.transactions || [];

  return (
    <View style={styles.root} testID="day-book-screen">
      <ScreenHeader title="Day Book (Cash / Bank)" />

      {/* Date Filter Bar */}
      <View style={styles.filterCard}>
        <View style={styles.presetRow}>
          <Pressable onPress={() => setPreset(0)} style={[styles.presetChip, fromDate === today() && styles.presetChipActive]}>
            <Text style={[styles.presetText, fromDate === today() && styles.presetTextActive]}>Today</Text>
          </Pressable>
          <Pressable onPress={() => setPreset(7)} style={[styles.presetChip, fromDate === daysAgo(7) && styles.presetChipActive]}>
            <Text style={[styles.presetText, fromDate === daysAgo(7) && styles.presetTextActive]}>Last 7 Days</Text>
          </Pressable>
          <Pressable onPress={() => setPreset(30)} style={[styles.presetChip, fromDate === daysAgo(30) && styles.presetChipActive]}>
            <Text style={[styles.presetText, fromDate === daysAgo(30) && styles.presetTextActive]}>Last 30 Days</Text>
          </Pressable>
        </View>

        <View style={styles.dateInputsRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.dateLbl}>From</Text>
            <TextInput style={styles.dateInput} value={fromDate} onChangeText={setFromDate} placeholder="YYYY-MM-DD" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.dateLbl}>To</Text>
            <TextInput style={styles.dateInput} value={toDate} onChangeText={setToDate} placeholder="YYYY-MM-DD" />
          </View>
          <Pressable onPress={load} style={styles.goBtn}>
            <Ionicons name="refresh" size={18} color="#FFF" />
          </Pressable>
        </View>
      </View>

      {/* Financial Summary KPI Cards */}
      <View style={styles.kpiRow}>
        <View style={[styles.kpiCard, { backgroundColor: '#ECFDF5', borderColor: '#A7F3D0' }]}>
          <Text style={styles.kpiLabel}>Total In (Receipts)</Text>
          <Text style={[styles.kpiValue, { color: '#059669' }]}>{inr(data?.total_debit ?? 0)}</Text>
        </View>
        <View style={[styles.kpiCard, { backgroundColor: '#FEF2F2', borderColor: '#FECACA' }]}>
          <Text style={styles.kpiLabel}>Total Out (Payments)</Text>
          <Text style={[styles.kpiValue, { color: '#DC2626' }]}>{inr(data?.total_credit ?? 0)}</Text>
        </View>
        <View style={[styles.kpiCard, { backgroundColor: '#EFF6FF', borderColor: '#BFDBFE' }]}>
          <Text style={styles.kpiLabel}>Net Flow</Text>
          <Text style={[styles.kpiValue, { color: (data?.net_flow ?? 0) >= 0 ? '#059669' : '#DC2626' }]}>
            {inr(data?.net_flow ?? 0)}
          </Text>
        </View>
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={colors.brandPrimary} />
          <Text style={{ color: colors.muted, marginTop: 8 }}>Loading day book transactions...</Text>
        </View>
      ) : transactions.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Ionicons name="book-outline" size={48} color={colors.muted} />
          <Text style={styles.emptyTitle}>No Transactions Recorded</Text>
          <Text style={styles.emptySub}>No sales, purchases, or expenses recorded between {fromDate} and {toDate}.</Text>
        </View>
      ) : (
        <FlatList
          data={transactions}
          keyExtractor={(item, idx) => `${item.reference || idx}_${idx}`}
          contentContainerStyle={{ padding: spacing.md, gap: spacing.sm, paddingBottom: spacing.xxxl }}
          renderItem={({ item }) => {
            const isIn = item.debit > 0;
            return (
              <View style={styles.txRow}>
                <View style={[styles.typeIcon, { backgroundColor: isIn ? '#DCFCE7' : '#FEE2E2' }]}>
                  <Ionicons
                    name={isIn ? 'arrow-down' : 'arrow-up'}
                    size={16}
                    color={isIn ? '#059669' : '#DC2626'}
                  />
                </View>

                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={styles.txType}>{item.type}</Text>
                    {item.mode ? (
                      <View style={styles.modeBadge}><Text style={styles.modeText}>{item.mode.toUpperCase()}</Text></View>
                    ) : null}
                  </View>
                  <Text style={styles.txParty} numberOfLines={1}>{item.party || 'General'}</Text>
                  <Text style={styles.txMeta}>{item.date} • Ref: {item.reference || '—'}</Text>
                </View>

                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={[styles.txAmount, { color: isIn ? '#059669' : '#DC2626' }]}>
                    {isIn ? '+' : '-'}{inr(isIn ? item.debit : item.credit)}
                  </Text>
                </View>
              </View>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F8FAFC' },
  filterCard: { padding: spacing.md, backgroundColor: '#FFF', borderBottomWidth: 1, borderBottomColor: colors.border, gap: 10 },
  presetRow: { flexDirection: 'row', gap: 8 },
  presetChip: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: radius.pill, backgroundColor: '#F1F5F9' },
  presetChipActive: { backgroundColor: colors.brandPrimary },
  presetText: { fontSize: 11, fontWeight: '700', color: '#475569' },
  presetTextActive: { color: '#FFF' },
  dateInputsRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  dateLbl: { fontSize: 10, fontWeight: '700', color: '#64748B', marginBottom: 2 },
  dateInput: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 8, paddingVertical: 6, fontSize: font.sm, backgroundColor: '#FFF' },
  goBtn: { backgroundColor: colors.brandPrimary, padding: 8, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  kpiRow: { flexDirection: 'row', gap: 6, padding: spacing.md, paddingBottom: 0 },
  kpiCard: { flex: 1, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, ...shadow.card },
  kpiLabel: { fontSize: 10, fontWeight: '700', color: '#64748B' },
  kpiValue: { fontSize: font.sm, fontWeight: '900', marginTop: 2 },
  txRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: spacing.md, backgroundColor: '#FFF', borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, ...shadow.card },
  typeIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  txType: { fontSize: 11, fontWeight: '800', color: '#0F172A' },
  modeBadge: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4, backgroundColor: '#F1F5F9' },
  modeText: { fontSize: 8, fontWeight: '800', color: '#64748B' },
  txParty: { fontSize: font.sm, fontWeight: '700', color: '#1E293B', marginTop: 1 },
  txMeta: { fontSize: 10, color: colors.muted, marginTop: 2 },
  txAmount: { fontSize: font.base, fontWeight: '900' },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  emptyTitle: { fontSize: font.lg, fontWeight: '800', color: '#0F172A', marginTop: 12 },
  emptySub: { fontSize: font.sm, color: colors.muted, textAlign: 'center', marginTop: 4, maxWidth: 280 },
});
