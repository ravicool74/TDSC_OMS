import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, font } from '@/src/theme';
import { api } from '@/src/api';
import { Card, EmptyState, ScreenLoader } from '@/src/ui';
import { ScreenHeader } from '@/src/ScreenHeader';

export default function DocumentExpiryAlertsScreen() {
  const router = useRouter();
  const [data, setData] = useState<any | null>(null);
  const [filterLevel, setFilterLevel] = useState<string>('all');

  const load = useCallback(async () => {
    try {
      const res = await api.getExpiryAlerts();
      setData(res);
    } catch {
      setData({ total_alerts: 0, expired_count: 0, seven_days_count: 0, fifteen_days_count: 0, thirty_days_count: 0, alerts: [] });
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const filteredAlerts = (data?.alerts || []).filter((a: any) => {
    if (filterLevel === 'all') return true;
    return a.alert_level === filterLevel;
  });

  const getAlertColor = (level: string) => {
    switch (level) {
      case 'expired': return colors.error;
      case '7_days': return '#EA580C'; // orange-600
      case '15_days': return colors.warning;
      case '30_days': return colors.info;
      default: return colors.muted;
    }
  };

  return (
    <View style={styles.container}>
      <ScreenHeader title="Document Expiry Alerts" />

      {data === null ? (
        <ScreenLoader />
      ) : (
        <>
          {/* Summary Metric Counters */}
          <View style={styles.metricsRow}>
            <Pressable
              onPress={() => setFilterLevel('all')}
              style={[styles.metricCard, filterLevel === 'all' && styles.metricCardActive]}
            >
              <Text style={styles.metricVal}>{data.total_alerts}</Text>
              <Text style={styles.metricLabel}>Total</Text>
            </Pressable>

            <Pressable
              onPress={() => setFilterLevel('expired')}
              style={[styles.metricCard, filterLevel === 'expired' && { borderColor: colors.error, backgroundColor: colors.error + '10' }]}
            >
              <Text style={[styles.metricVal, { color: colors.error }]}>{data.expired_count}</Text>
              <Text style={styles.metricLabel}>Expired</Text>
            </Pressable>

            <Pressable
              onPress={() => setFilterLevel('7_days')}
              style={[styles.metricCard, filterLevel === '7_days' && { borderColor: '#EA580C', backgroundColor: '#EA580C10' }]}
            >
              <Text style={[styles.metricVal, { color: '#EA580C' }]}>{data.seven_days_count}</Text>
              <Text style={styles.metricLabel}>7 Days</Text>
            </Pressable>

            <Pressable
              onPress={() => setFilterLevel('15_days')}
              style={[styles.metricCard, filterLevel === '15_days' && { borderColor: colors.warning, backgroundColor: colors.warning + '10' }]}
            >
              <Text style={[styles.metricVal, { color: colors.warning }]}>{data.fifteen_days_count}</Text>
              <Text style={styles.metricLabel}>15 Days</Text>
            </Pressable>

            <Pressable
              onPress={() => setFilterLevel('30_days')}
              style={[styles.metricCard, filterLevel === '30_days' && { borderColor: colors.info, backgroundColor: colors.info + '10' }]}
            >
              <Text style={[styles.metricVal, { color: colors.info }]}>{data.thirty_days_count}</Text>
              <Text style={styles.metricLabel}>30 Days</Text>
            </Pressable>
          </View>

          {filteredAlerts.length === 0 ? (
            <EmptyState
              icon="checkmark-circle-outline"
              title="No Expiry Alerts"
              subtitle="All DSCs, contractor certificates, and customer documents are up to date."
            />
          ) : (
            <FlatList
              data={filteredAlerts}
              keyExtractor={(item, idx) => `${item.customer_id}_${idx}`}
              contentContainerStyle={styles.listContent}
              renderItem={({ item }) => {
                const badgeColor = getAlertColor(item.alert_level);
                return (
                  <Card>
                    <Pressable
                      onPress={() => router.push(`/customers/${item.customer_id}` as any)}
                      style={styles.alertCard}
                    >
                      <View style={[styles.alertIcon, { backgroundColor: badgeColor + '15' }]}>
                        <Ionicons
                          name={item.item_type === 'dsc' ? 'key-outline' : 'document-text-outline'}
                          size={22}
                          color={badgeColor}
                        />
                      </View>

                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                          <Text style={styles.itemTitle}>{item.title}</Text>
                          <View style={[styles.levelBadge, { backgroundColor: badgeColor + '15' }]}>
                            <Text style={[styles.levelBadgeText, { color: badgeColor }]}>
                              {item.days_left <= 0 ? 'EXPIRED' : `${item.days_left} DAYS LEFT`}
                            </Text>
                          </View>
                        </View>

                        <Text style={styles.custName}>{item.customer_name}</Text>
                        <Text style={styles.metaText}>
                          {item.customer_code} • Expiry Date: {item.expiry_date}
                        </Text>
                      </View>

                      <Ionicons name="chevron-forward" size={18} color={colors.muted} />
                    </Pressable>
                  </Card>
                );
              }}
            />
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surfaceSecondary },
  metricsRow: { flexDirection: 'row', padding: spacing.md, gap: 8, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  metricCard: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary },
  metricCardActive: { borderColor: colors.brandPrimary, backgroundColor: colors.brandPrimary + '10' },
  metricVal: { fontSize: font.lg, fontWeight: '800', color: colors.onSurface },
  metricLabel: { fontSize: 10, fontWeight: '600', color: colors.muted, marginTop: 2 },
  listContent: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxxl },
  alertCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  alertIcon: { width: 44, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  itemTitle: { fontSize: font.base, fontWeight: '700', color: colors.onSurface },
  levelBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  levelBadgeText: { fontSize: 10, fontWeight: '800' },
  custName: { fontSize: font.sm, fontWeight: '600', color: colors.brandPrimary, marginTop: 2 },
  metaText: { fontSize: font.xs, color: colors.muted, marginTop: 2 },
});
