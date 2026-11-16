import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Alert, TextInput, Platform } from 'react-native';
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

  // Sale Invoice Voucher Numbering & Date Settings
  const [invSettings, setInvSettings] = useState<{
    voucher_mode: 'auto' | 'manual';
    start_seq: string;
    date_start_from: string;
    prefix: string;
    next_no: string;
    current_seq: number;
    financial_year: string;
  }>({
    voucher_mode: 'auto',
    start_seq: '1',
    date_start_from: '',
    prefix: 'TDSC',
    next_no: 'TDSC/2026-27/000001',
    current_seq: 0,
    financial_year: '2026-27',
  });
  const [savingInvSettings, setSavingInvSettings] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, invConf] = await Promise.all([
        api.getSystemStats(),
        api.get<any>('/settings/sale-invoice').catch(() => null),
      ]);
      setStats(s);
      if (invConf) {
        setInvSettings({
          voucher_mode: invConf.voucher_mode === 'manual' ? 'manual' : 'auto',
          start_seq: String(invConf.start_seq || 1),
          date_start_from: invConf.date_start_from || '',
          prefix: invConf.prefix || 'TDSC',
          next_no: invConf.next_no || 'TDSC/2026-27/000001',
          current_seq: invConf.current_seq || 0,
          financial_year: invConf.financial_year || '2026-27',
        });
      }
    } catch {
      setStats(null);
    }
  }, []);

  const handleSaveInvoiceSettings = async (resetCounter = false) => {
    setSavingInvSettings(true);
    try {
      const payload = {
        voucher_mode: invSettings.voucher_mode,
        start_seq: parseInt(invSettings.start_seq) || 1,
        date_start_from: invSettings.date_start_from.trim() || null,
        prefix: invSettings.prefix.trim().toUpperCase() || 'TDSC',
        reset_counter_now: resetCounter,
      };
      const res = await api.put<any>('/settings/sale-invoice', payload);
      setInvSettings(prev => ({
        ...prev,
        voucher_mode: res.voucher_mode,
        start_seq: String(res.start_seq),
        date_start_from: res.date_start_from || '',
        prefix: res.prefix,
        next_no: res.next_no,
        current_seq: resetCounter ? Math.max(0, parseInt(invSettings.start_seq) - 1) : prev.current_seq,
      }));
      Alert.alert(
        'Settings Saved',
        `Sale Invoice settings saved successfully!
Next Voucher: ${res.next_no}` +
        (res.date_start_from ? `
Start Date: ${res.date_start_from}` : '')
      );
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to update voucher settings');
    } finally {
      setSavingInvSettings(false);
    }
  };

  const handleResetSequenceConfirm = () => {
    Alert.alert(
      'Reset Voucher Number Sequence?',
      `Are you sure you want to reset the voucher sequence? The next voucher will start from #${invSettings.start_seq || 1}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Reset to Start', style: 'destructive', onPress: () => handleSaveInvoiceSettings(true) },
      ]
    );
  };

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
              <Text style={styles.infoVal}>
                {invSettings.prefix}/{invSettings.financial_year}/{String(parseInt(invSettings.start_seq) || 1).padStart(6, '0')} ({invSettings.voucher_mode === 'auto' ? 'Automatic from 1' : 'Manual / Custom'})
              </Text>
            </View>
          </Card>

          {/* Sale Invoice Voucher Settings Card */}
          <Card>
            <View style={styles.cardHeader}>
              <View style={[styles.iconBox, { backgroundColor: '#0D948815' }]}>
                <Ionicons name="receipt-outline" size={22} color="#0D9488" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>Sale Invoice Voucher Settings</Text>
                <Text style={styles.subText}>Configure Voucher No. Auto Start from 1 / Manual & Start Date</Text>
              </View>
            </View>

            {/* 1. Voucher Mode Selector */}
            <View style={styles.settingBlock}>
              <Text style={styles.settingLabel}>1. Voucher Numbering Mode</Text>
              <View style={styles.modeToggleRow}>
                <Pressable
                  onPress={() => setInvSettings(p => ({ ...p, voucher_mode: 'auto', start_seq: '1' }))}
                  style={[styles.modeToggleBtn, invSettings.voucher_mode === 'auto' && styles.modeToggleBtnActive]}
                >
                  <Ionicons
                    name={invSettings.voucher_mode === 'auto' ? 'radio-button-on' : 'radio-button-off'}
                    size={18}
                    color={invSettings.voucher_mode === 'auto' ? '#0D9488' : '#64748B'}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.modeToggleTxt, invSettings.voucher_mode === 'auto' && styles.modeToggleTxtActive]}>
                      Automatic (Start from 1)
                    </Text>
                    <Text style={styles.modeToggleSub}>
                      Sequential auto-numbering starting from 000001
                    </Text>
                  </View>
                </Pressable>

                <Pressable
                  onPress={() => setInvSettings(p => ({ ...p, voucher_mode: 'manual' }))}
                  style={[styles.modeToggleBtn, invSettings.voucher_mode === 'manual' && styles.modeToggleBtnActive]}
                >
                  <Ionicons
                    name={invSettings.voucher_mode === 'manual' ? 'radio-button-on' : 'radio-button-off'}
                    size={18}
                    color={invSettings.voucher_mode === 'manual' ? '#0D9488' : '#64748B'}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.modeToggleTxt, invSettings.voucher_mode === 'manual' && styles.modeToggleTxtActive]}>
                      Manual / Custom Sequence
                    </Text>
                    <Text style={styles.modeToggleSub}>
                      Editable voucher number with custom starting number
                    </Text>
                  </View>
                </Pressable>
              </View>
            </View>

            {/* 2. Starting Sequence Number */}
            <View style={styles.settingBlock}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={styles.settingLabel}>2. Voucher Number Starts From</Text>
                <Text style={{ fontSize: 11, color: '#0D9488', fontWeight: '700' }}>
                  Next Seq: #{invSettings.start_seq || '1'}
                </Text>
              </View>
              <View style={styles.inputRow}>
                <View style={styles.prefixPill}>
                  <Text style={styles.prefixTxt}>{invSettings.prefix}/{invSettings.financial_year}/</Text>
                </View>
                <TextInput
                  value={invSettings.start_seq}
                  onChangeText={(val) => setInvSettings(p => ({ ...p, start_seq: val.replace(/[^0-9]/g, '') }))}
                  keyboardType="numeric"
                  placeholder="1"
                  placeholderTextColor="#94A3B8"
                  style={styles.settingInput}
                />
              </View>
              <Text style={styles.helperTxt}>
                Format preview: {invSettings.prefix}/{invSettings.financial_year}/{String(parseInt(invSettings.start_seq) || 1).padStart(6, '0')}
              </Text>
            </View>

            {/* 3. Date Start From Option */}
            <View style={styles.settingBlock}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={styles.settingLabel}>3. Voucher Date Start From</Text>
                {invSettings.date_start_from ? (
                  <Pressable onPress={() => setInvSettings(p => ({ ...p, date_start_from: '' }))}>
                    <Text style={{ fontSize: 11, color: '#DC2626', fontWeight: '700' }}>Clear (Use Current Date)</Text>
                  </Pressable>
                ) : null}
              </View>
              <TextInput
                value={invSettings.date_start_from}
                onChangeText={(val) => setInvSettings(p => ({ ...p, date_start_from: val }))}
                placeholder="YYYY-MM-DD (e.g. 2026-11-16)"
                placeholderTextColor="#94A3B8"
                style={styles.dateInput}
              />
              <View style={styles.quickDateRow}>
                <Pressable
                  onPress={() => setInvSettings(p => ({ ...p, date_start_from: new Date().toISOString().slice(0, 10) }))}
                  style={styles.quickDateChip}
                >
                  <Text style={styles.quickDateTxt}>Set to Today</Text>
                </Pressable>
                <Pressable
                  onPress={() => setInvSettings(p => ({ ...p, date_start_from: '2026-04-01' }))}
                  style={styles.quickDateChip}
                >
                  <Text style={styles.quickDateTxt}>Set to 1 April 2026</Text>
                </Pressable>
              </View>
              <Text style={styles.helperTxt}>
                {invSettings.date_start_from
                  ? `💡 New Sale Vouchers will automatically initialize from: ${invSettings.date_start_from}`
                  : '💡 Leave blank to default to the current real-time date.'}
              </Text>
            </View>

            {/* Preview Box */}
            <View style={styles.voucherPreviewBanner}>
              <Ionicons name="sparkles" size={20} color="#0D9488" />
              <View style={{ flex: 1 }}>
                <Text style={styles.previewTitle}>Live Voucher Number Preview</Text>
                <Text style={styles.previewValue}>
                  {invSettings.prefix}/{invSettings.financial_year}/{String(parseInt(invSettings.start_seq) || 1).padStart(6, '0')}
                </Text>
                <Text style={styles.previewDate}>
                  📅 Initial Date: {invSettings.date_start_from || new Date().toISOString().slice(0, 10)}
                </Text>
              </View>
            </View>

            {/* Action Buttons */}
            <View style={{ gap: 8, marginTop: spacing.md }}>
              <PrimaryButton
                title={savingInvSettings ? 'Saving Settings...' : 'Save Voucher Settings'}
                onPress={() => handleSaveInvoiceSettings(false)}
                disabled={savingInvSettings}
              />
              <Pressable
                onPress={handleResetSequenceConfirm}
                disabled={savingInvSettings}
                style={styles.resetSeqBtn}
              >
                <Ionicons name="refresh" size={16} color="#DC2626" />
                <Text style={styles.resetSeqBtnTxt}>
                  Reset Sequence to #{invSettings.start_seq || '1'} Now
                </Text>
              </Pressable>
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

  /* Sale Invoice Settings Styles */
  settingBlock: {
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    gap: 8,
  },
  settingLabel: {
    fontSize: font.xs,
    fontWeight: '800',
    color: '#0F172A',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  modeToggleRow: {
    gap: 8,
    marginTop: 4,
  },
  modeToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#F8FAFC',
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    borderRadius: radius.md,
    padding: 10,
  },
  modeToggleBtnActive: {
    borderColor: '#0D9488',
    backgroundColor: '#F0FDFA',
  },
  modeToggleTxt: {
    fontSize: font.sm,
    fontWeight: '700',
    color: '#334155',
  },
  modeToggleTxtActive: {
    color: '#0D9488',
    fontWeight: '800',
  },
  modeToggleSub: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF',
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  prefixPill: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRightWidth: 1,
    borderRightColor: '#E2E8F0',
  },
  prefixTxt: {
    fontSize: font.sm,
    fontWeight: '800',
    color: '#475569',
  },
  settingInput: {
    flex: 1,
    fontSize: font.base,
    fontWeight: '800',
    color: '#0F172A',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  dateInput: {
    backgroundColor: '#FFF',
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: font.sm,
    fontWeight: '700',
    color: '#0F172A',
  },
  quickDateRow: {
    flexDirection: 'row',
    gap: 8,
  },
  quickDateChip: {
    backgroundColor: '#F0FDFA',
    borderWidth: 1,
    borderColor: '#99F6E4',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  quickDateTxt: {
    fontSize: 11,
    color: '#0F766E',
    fontWeight: '700',
  },
  helperTxt: {
    fontSize: 11,
    color: colors.muted,
    lineHeight: 16,
  },
  voucherPreviewBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: spacing.md,
    backgroundColor: '#F0FDFA',
    borderWidth: 1.5,
    borderColor: '#99F6E4',
    borderRadius: radius.md,
    padding: spacing.md,
  },
  previewTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0F766E',
    textTransform: 'uppercase',
  },
  previewValue: {
    fontSize: font.lg,
    fontWeight: '900',
    color: '#0D9488',
    letterSpacing: 0.5,
    marginTop: 2,
  },
  previewDate: {
    fontSize: 11,
    fontWeight: '600',
    color: '#0F766E',
    marginTop: 2,
  },
  resetSeqBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    backgroundColor: '#FEF2F2',
    borderWidth: 1.5,
    borderColor: '#FECACA',
    borderRadius: radius.md,
  },
  resetSeqBtnTxt: {
    fontSize: font.xs,
    fontWeight: '800',
    color: '#DC2626',
  },
});
