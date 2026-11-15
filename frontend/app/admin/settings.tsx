import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Alert } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, font } from '@/src/theme';
import { api } from '@/src/api';
import { Card, ScreenLoader, PrimaryButton } from '@/src/ui';
import { ScreenHeader } from '@/src/ScreenHeader';

export default function SystemSettingsScreen() {
  const [stats, setStats] = useState<any | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [lastBackup, setLastBackup] = useState<any | null>(null);

  const load = useCallback(async () => {
    try {
      const s = await api.getSystemStats();
      setStats(s);
    } catch {
      setStats(null);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const triggerBackup = async () => {
    setBackupBusy(true);
    try {
      const res = (await api.post('/system/backup', {})) as any;
      setLastBackup(res);
      Alert.alert('Backup Complete', `Database snapshot saved (${res?.total_records ?? 0} records across ${Object.keys(res?.collection_counts || {}).length} collections).`);
    } catch (e: any) {
      Alert.alert('Backup Failed', e?.message || 'Failed to generate snapshot');
    } finally {
      setBackupBusy(false);
    }
  };

  return (
    <View style={styles.container}>
      <ScreenHeader title="System Settings & Backup" />

      {stats === null ? (
        <ScreenLoader />
      ) : (
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {/* Indian Financial Year Card */}
          <Card>
            <View style={styles.cardHeader}>
              <View style={styles.iconBox}>
                <Ionicons name="calendar" size={22} color={colors.brandPrimary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>Financial Year Rules</Text>
                <Text style={styles.subText}>Indian Financial Year: 1 April to 31 March</Text>
              </View>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Active Fiscal Year:</Text>
              <Text style={styles.infoVal}>2026 - 2027</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Invoice Numbering Rule:</Text>
              <Text style={styles.infoVal}>TDSC/2026-27/000001 (Sequential)</Text>
            </View>
          </Card>

          {/* Database Backup Card */}
          <Card>
            <View style={styles.cardHeader}>
              <View style={[styles.iconBox, { backgroundColor: colors.success + '15' }]}>
                <Ionicons name="cloud-upload" size={22} color={colors.success} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>Database Backup Strategy</Text>
                <Text style={styles.subText}>Automated & on-demand snapshots (Section 50)</Text>
              </View>
            </View>

            <Text style={styles.descText}>
              Generates an immutable JSON snapshot of all 18 enterprise collections, preserving database integrity across MongoDB Atlas.
            </Text>

            {lastBackup ? (
              <View style={styles.backupReport}>
                <Ionicons name="checkmark-circle" size={18} color={colors.success} />
                <Text style={styles.backupText}>
                  Last Backup: {new Date(lastBackup.created_at).toLocaleTimeString()} • {lastBackup.total_records} records captured
                </Text>
              </View>
            ) : null}

            <PrimaryButton
              title={backupBusy ? 'Generating Snapshot...' : 'Trigger Database Backup Now'}
              onPress={triggerBackup}
              disabled={backupBusy}
              style={{ marginTop: spacing.md }}
            />
          </Card>

          {/* System Scale Overview */}
          <Card>
            <View style={styles.cardHeader}>
              <View style={[styles.iconBox, { backgroundColor: colors.brandSecondary + '15' }]}>
                <Ionicons name="server" size={22} color={colors.brandSecondary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>Enterprise Scale Overview</Text>
                <Text style={styles.subText}>Live collection counts</Text>
              </View>
            </View>

            <View style={styles.statGrid}>
              <View style={styles.statTile}>
                <Text style={styles.statNum}>{stats.total_branches}</Text>
                <Text style={styles.statLbl}>Branches</Text>
              </View>
              <View style={styles.statTile}>
                <Text style={styles.statNum}>{stats.total_employees}</Text>
                <Text style={styles.statLbl}>Employees</Text>
              </View>
              <View style={styles.statTile}>
                <Text style={styles.statNum}>{stats.total_customers}</Text>
                <Text style={styles.statLbl}>Customers</Text>
              </View>
              <View style={styles.statTile}>
                <Text style={styles.statNum}>{stats.total_services}</Text>
                <Text style={styles.statLbl}>Services</Text>
              </View>
              <View style={styles.statTile}>
                <Text style={styles.statNum}>{stats.total_tasks}</Text>
                <Text style={styles.statLbl}>Tasks</Text>
              </View>
              <View style={styles.statTile}>
                <Text style={styles.statNum}>{stats.total_invoices}</Text>
                <Text style={styles.statLbl}>Invoices</Text>
              </View>
            </View>
          </Card>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surfaceSecondary },
  scrollContent: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxxl },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  iconBox: { width: 44, height: 44, borderRadius: 10, backgroundColor: colors.brandPrimary + '15', alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: font.base, fontWeight: '700', color: colors.onSurface },
  subText: { fontSize: font.xs, color: colors.muted, marginTop: 2 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.md, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.divider },
  infoLabel: { fontSize: font.xs, color: colors.muted },
  infoVal: { fontSize: font.xs, fontWeight: '700', color: colors.onSurface },
  descText: { fontSize: font.xs, color: colors.muted, marginTop: spacing.md, lineHeight: 18 },
  backupReport: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.md, padding: spacing.sm, backgroundColor: colors.success + '10', borderRadius: radius.sm },
  backupText: { fontSize: font.xs, fontWeight: '600', color: colors.success },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: spacing.lg },
  statTile: { width: '31%', padding: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, alignItems: 'center' },
  statNum: { fontSize: font.lg, fontWeight: '800', color: colors.brandPrimary },
  statLbl: { fontSize: font.xs, color: colors.muted, marginTop: 2 },
});
