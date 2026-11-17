import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert, Pressable, TextInput, Modal, ActivityIndicator } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, font } from '@/src/theme';
import { ScreenHeader } from '@/src/ScreenHeader';
import { Card, PrimaryButton, ScreenLoader } from '@/src/ui';
import { api } from '@/src/api';

export const VOUCHER_CONFIG_TABS = [
  { key: 'sale_invoice', label: 'Sale Invoice', icon: 'receipt-outline', defaultPrefix: 'TDSC', digits: 6, hasFy: true, desc: 'Sale Invoice voucher auto-numbering and starting date' },
  { key: 'payment_in', label: 'Payment-In', icon: 'arrow-down-circle-outline', defaultPrefix: 'PAYIN', digits: 4, hasFy: false, desc: 'Payment received voucher auto-numbering and starting date' },
  { key: 'sale_return', label: 'Sale Return / Credit Note', icon: 'return-down-back-outline', defaultPrefix: 'CN', digits: 4, hasFy: false, desc: 'Credit Note / Sale Return voucher numbering and starting date' },
  { key: 'estimate', label: 'Estimate / Quotation', icon: 'clipboard-outline', defaultPrefix: 'TDSC-EST', digits: 4, hasFy: true, desc: 'Estimate and Quotation voucher numbering and starting date' },
  { key: 'proforma', label: 'Proforma Invoice', icon: 'document-text-outline', defaultPrefix: 'TDSC-PI', digits: 4, hasFy: true, desc: 'Proforma Invoice voucher numbering and starting date' },
  { key: 'sale_order', label: 'Sale Order', icon: 'cart-outline', defaultPrefix: 'TDSC-SO', digits: 4, hasFy: true, desc: 'Sale Order voucher numbering and starting date' },
  { key: 'delivery_challan', label: 'Delivery Challan', icon: 'car-outline', defaultPrefix: 'TDSC-DC', digits: 4, hasFy: true, desc: 'Delivery Challan voucher numbering and starting date' },
  { key: 'mobile_pos', label: 'Mobile POS', icon: 'phone-portrait-outline', defaultPrefix: 'POS', digits: 4, hasFy: false, desc: 'Counter / Mobile POS sale voucher numbering and starting date' },
  { key: 'new_expense_approval', label: 'New Expense Approval', icon: 'add-circle-outline', defaultPrefix: 'EXP-APP', digits: 4, hasFy: true, desc: 'Expense booking request voucher numbering and starting date' },
  { key: 'expense_approval', label: 'Expense Approval', icon: 'checkmark-done-circle-outline', defaultPrefix: 'EXP-APP', digits: 4, hasFy: true, desc: 'Final approved expense order voucher numbering and starting date' },
] as const;

export type VoucherConfigItem = {
  voucher_type: string;
  title: string;
  voucher_mode: 'auto' | 'manual';
  start_seq: string;
  date_start_from: string;
  prefix: string;
  next_no: string;
  current_seq: number;
  financial_year?: string;
};

const inr = (n: any) => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });

const CREATION_ROUTES: Record<string, { route: string; params?: any }> = {
  sale_invoice: { route: '/accounting/invoices/new' },
  payment_in: { route: '/accounting/income/new' },
  sale_return: { route: '/accounting/invoices/new', params: { type: 'sale_return' } },
  estimate: { route: '/accounting/estimates/new' },
  proforma: { route: '/accounting/proforma/new' },
  sale_order: { route: '/accounting/estimates/new', params: { type: 'order' } },
  delivery_challan: { route: '/accounting/delivery-challans' },
  mobile_pos: { route: '/accounting/invoices/new', params: { pos: '1' } },
  new_expense_approval: { route: '/accounting/expenses/approval/new' },
  expense_approval: { route: '/accounting/expenses/approval' },
};

export default function SettingsScreen() {
  const router = useRouter();
  const [stats, setStats] = useState<any>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [lastBackup, setLastBackup] = useState<any>(null);

  // Active Voucher Configuration Hub State
  const [activeTabKey, setActiveTabKey] = useState<string>('sale_invoice');
  const [vouchersMap, setVouchersMap] = useState<Record<string, VoucherConfigItem>>({});
  const [savingVoucher, setSavingVoucher] = useState(false);

  // Existing Vouchers State for Active Tab
  const [existingVouchers, setExistingVouchers] = useState<any[]>([]);
  const [loadingExisting, setLoadingExisting] = useState<boolean>(false);
  const [voucherSearch, setVoucherSearch] = useState<string>('');

  // Quick Edit Modal State
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editingVoucher, setEditingVoucher] = useState<any>(null);
  const [editVoucherNo, setEditVoucherNo] = useState('');
  const [editVoucherDate, setEditVoucherDate] = useState('');
  const [editRemarks, setEditRemarks] = useState('');
  const [updatingVoucher, setUpdatingVoucher] = useState(false);

  const activeTabMeta = useMemo(() => {
    return VOUCHER_CONFIG_TABS.find(t => t.key === activeTabKey) || VOUCHER_CONFIG_TABS[0];
  }, [activeTabKey]);

  const activeVoucherConfig = useMemo(() => {
    return vouchersMap[activeTabKey] || {
      voucher_type: activeTabKey,
      title: activeTabMeta.label,
      voucher_mode: 'auto',
      start_seq: '1',
      date_start_from: '',
      prefix: activeTabMeta.defaultPrefix,
      next_no: `${activeTabMeta.defaultPrefix}-0001`,
      current_seq: 0,
      financial_year: '2026-27',
    };
  }, [vouchersMap, activeTabKey, activeTabMeta]);

  const updateActiveField = (field: keyof VoucherConfigItem, val: any) => {
    setVouchersMap(prev => ({
      ...prev,
      [activeTabKey]: {
        ...activeVoucherConfig,
        [field]: val,
      }
    }));
  };

  const load = useCallback(async () => {
    try {
      const [s, vList] = await Promise.all([
        api.getSystemStats(),
        api.get<any[]>('/settings/vouchers').catch(() => []),
      ]);
      setStats(s);

      const map: Record<string, VoucherConfigItem> = {};
      if (Array.isArray(vList) && vList.length > 0) {
        vList.forEach((item: any) => {
          if (item?.voucher_type) {
            map[item.voucher_type] = {
              voucher_type: item.voucher_type,
              title: item.title || item.voucher_type,
              voucher_mode: item.voucher_mode === 'manual' ? 'manual' : 'auto',
              start_seq: String(item.start_seq || 1),
              date_start_from: item.date_start_from || '',
              prefix: item.prefix || '',
              next_no: item.next_no || '',
              current_seq: item.current_seq || 0,
              financial_year: item.financial_year || '2026-27',
            };
          }
        });
      }
      // Fill defaults for any missing tab
      VOUCHER_CONFIG_TABS.forEach(t => {
        if (!map[t.key]) {
          map[t.key] = {
            voucher_type: t.key,
            title: t.label,
            voucher_mode: 'auto',
            start_seq: '1',
            date_start_from: '',
            prefix: t.defaultPrefix,
            next_no: `${t.defaultPrefix}-0001`,
            current_seq: 0,
            financial_year: '2026-27',
          };
        }
      });
      setVouchersMap(map);
    } catch {
      setStats(null);
    }
  }, []);

  const loadExistingVouchers = useCallback(async (tabKey: string, query?: string) => {
    setLoadingExisting(true);
    try {
      const url = `/settings/vouchers/${tabKey}/existing` + (query ? `?search=${encodeURIComponent(query)}` : '');
      const list = await api.get<any[]>(url);
      setExistingVouchers(Array.isArray(list) ? list : []);
    } catch {
      setExistingVouchers([]);
    } finally {
      setLoadingExisting(false);
    }
  }, []);

  useEffect(() => {
    loadExistingVouchers(activeTabKey, voucherSearch);
  }, [activeTabKey, voucherSearch, loadExistingVouchers]);

  const openQuickEdit = (voucher: any) => {
    setEditingVoucher(voucher);
    setEditVoucherNo(voucher.voucher_no || '');
    setEditVoucherDate(voucher.date || '');
    setEditRemarks('');
    setEditModalVisible(true);
  };

  const handleSaveQuickEdit = async () => {
    if (!editingVoucher) return;
    if (!editVoucherNo.trim()) {
      Alert.alert('Required', 'Voucher number cannot be empty.');
      return;
    }
    if (!editVoucherDate.trim()) {
      Alert.alert('Required', 'Voucher date cannot be empty.');
      return;
    }
    setUpdatingVoucher(true);
    try {
      const res = await api.put<any>(`/settings/vouchers/${activeTabKey}/${editingVoucher.id}/edit`, {
        voucher_no: editVoucherNo.trim(),
        voucher_date: editVoucherDate.trim(),
        remarks: editRemarks.trim() || undefined,
      });
      Alert.alert('Voucher Updated', res?.message || 'Voucher updated successfully!');
      setEditModalVisible(false);
      setEditingVoucher(null);
      loadExistingVouchers(activeTabKey, voucherSearch);
    } catch (e: any) {
      Alert.alert('Update Failed', e?.message || 'Could not update voucher');
    } finally {
      setUpdatingVoucher(false);
    }
  };

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleSaveVoucherSettings = async (resetCounter = false) => {
    setSavingVoucher(true);
    try {
      const payload = {
        voucher_type: activeTabKey,
        voucher_mode: activeVoucherConfig.voucher_mode,
        start_seq: parseInt(activeVoucherConfig.start_seq) || 1,
        date_start_from: activeVoucherConfig.date_start_from.trim() || null,
        prefix: activeVoucherConfig.prefix.trim().toUpperCase() || activeTabMeta.defaultPrefix,
        reset_counter_now: resetCounter,
      };
      const res = await api.put<any>(`/settings/voucher/${activeTabKey}`, payload);
      setVouchersMap(prev => ({
        ...prev,
        [activeTabKey]: {
          ...activeVoucherConfig,
          voucher_mode: res.voucher_mode,
          start_seq: String(res.start_seq),
          date_start_from: res.date_start_from || '',
          prefix: res.prefix,
          next_no: res.next_no,
          current_seq: resetCounter ? Math.max(0, parseInt(activeVoucherConfig.start_seq) - 1) : res.current_seq,
        }
      }));
      Alert.alert(
        'Settings Saved',
        `${activeTabMeta.label} settings saved successfully!\nNext Voucher: ${res.next_no}` +
        (res.date_start_from ? `\nStart Date: ${res.date_start_from}` : '')
      );
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to update voucher settings');
    } finally {
      setSavingVoucher(false);
    }
  };

  const handleResetSequenceConfirm = () => {
    Alert.alert(
      'Reset Voucher Number Sequence?',
      `Are you sure you want to reset the sequence for "${activeTabMeta.label}"? The next voucher will start from #${activeVoucherConfig.start_seq || 1}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Reset to Start', style: 'destructive', onPress: () => handleSaveVoucherSettings(true) },
      ]
    );
  };

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

  // Live computed preview code
  const computedPreviewNo = useMemo(() => {
    const pfx = activeVoucherConfig.prefix || activeTabMeta.defaultPrefix;
    const seq = parseInt(activeVoucherConfig.start_seq) || 1;
    const fy = activeVoucherConfig.financial_year || '2026-27';
    if (activeTabMeta.hasFy) {
      const pad = activeTabMeta.digits === 6 ? String(seq).padStart(6, '0') : String(seq).padStart(4, '0');
      return `${pfx}/${fy}/${pad}`;
    } else {
      return `${pfx}-${String(seq).padStart(4, '0')}`;
    }
  }, [activeVoucherConfig, activeTabMeta]);

  return (
    <View style={styles.container}>
      <ScreenHeader title="System Settings & Voucher Hub" />

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
              <Text style={styles.infoLabel}>Active Voucher Type:</Text>
              <Text style={styles.infoVal}>
                {activeTabMeta.label} ({activeVoucherConfig.voucher_mode === 'auto' ? 'Auto Start from 1' : 'Manual Entry'})
              </Text>
            </View>
          </Card>

          {/* Unified Voucher Numbering & Starting Date Configuration Hub */}
          <Card>
            <View style={styles.cardHeader}>
              <View style={[styles.iconBox, { backgroundColor: '#0D948815' }]}>
                <Ionicons name="layers-outline" size={22} color="#0D9488" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>Voucher Numbering & Starting Date Hub</Text>
                <Text style={styles.subText}>Configure Auto Start from 1, Manual Mode & Start Date for all 10 menus</Text>
              </View>
            </View>

            {/* Horizontal Scrollable Tabs for all 10 Vouchers */}
            <View style={{ marginTop: spacing.md }}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabScrollRow}>
                {VOUCHER_CONFIG_TABS.map(tab => {
                  const isSelected = tab.key === activeTabKey;
                  const cfg = vouchersMap[tab.key];
                  const isManual = cfg?.voucher_mode === 'manual';
                  return (
                    <Pressable
                      key={tab.key}
                      onPress={() => setActiveTabKey(tab.key)}
                      style={[styles.tabChip, isSelected && styles.tabChipActive]}
                    >
                      <Ionicons
                        name={tab.icon as any}
                        size={16}
                        color={isSelected ? '#FFF' : '#475569'}
                      />
                      <Text style={[styles.tabChipTxt, isSelected && styles.tabChipTxtActive]}>
                        {tab.label}
                      </Text>
                      <View style={[styles.chipBadge, isSelected ? styles.chipBadgeActive : (isManual ? styles.chipBadgeManual : styles.chipBadgeAuto)]}>
                        <Text style={[styles.chipBadgeTxt, isSelected && { color: '#FFF' }]}>
                          {isManual ? 'MAN' : 'AUTO'}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>

            {/* Active Voucher Detail Header Banner */}
            <View style={styles.voucherSubHeader}>
              <Ionicons name={activeTabMeta.icon as any} size={20} color="#0D9488" />
              <View style={{ flex: 1 }}>
                <Text style={styles.voucherSubTitle}>{activeTabMeta.label} Configuration</Text>
                <Text style={styles.voucherSubDesc}>{activeTabMeta.desc}</Text>
              </View>
            </View>

            {/* 1. Voucher Mode Selector */}
            <View style={styles.settingBlock}>
              <Text style={styles.settingLabel}>1. Voucher Numbering Mode</Text>
              <View style={styles.modeToggleRow}>
                <Pressable
                  onPress={() => updateActiveField('voucher_mode', 'auto')}
                  style={[styles.modeToggleBtn, activeVoucherConfig.voucher_mode === 'auto' && styles.modeToggleBtnActive]}
                >
                  <Ionicons
                    name={activeVoucherConfig.voucher_mode === 'auto' ? 'radio-button-on' : 'radio-button-off'}
                    size={18}
                    color={activeVoucherConfig.voucher_mode === 'auto' ? '#0D9488' : '#64748B'}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.modeToggleTxt, activeVoucherConfig.voucher_mode === 'auto' && styles.modeToggleTxtActive]}>
                      Automatic (Start from 1)
                    </Text>
                    <Text style={styles.modeToggleSub}>
                      Sequential auto-numbering starting from 1 (or configured start sequence)
                    </Text>
                  </View>
                </Pressable>

                <Pressable
                  onPress={() => updateActiveField('voucher_mode', 'manual')}
                  style={[styles.modeToggleBtn, activeVoucherConfig.voucher_mode === 'manual' && styles.modeToggleBtnActive]}
                >
                  <Ionicons
                    name={activeVoucherConfig.voucher_mode === 'manual' ? 'radio-button-on' : 'radio-button-off'}
                    size={18}
                    color={activeVoucherConfig.voucher_mode === 'manual' ? '#0D9488' : '#64748B'}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.modeToggleTxt, activeVoucherConfig.voucher_mode === 'manual' && styles.modeToggleTxtActive]}>
                      Manual / Custom Sequence
                    </Text>
                    <Text style={styles.modeToggleSub}>
                      Voucher number is editable on voucher creation screen
                    </Text>
                  </View>
                </Pressable>
              </View>
            </View>

            {/* 2. Starting Sequence Number & Prefix */}
            <View style={styles.settingBlock}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={styles.settingLabel}>2. Voucher Number Starts From</Text>
                <Text style={{ fontSize: 11, color: '#0D9488', fontWeight: '700' }}>
                  Next Seq: #{activeVoucherConfig.start_seq || '1'}
                </Text>
              </View>
              <View style={styles.inputRow}>
                <View style={styles.prefixPill}>
                  <Text style={styles.prefixTxt}>
                    {activeVoucherConfig.prefix || activeTabMeta.defaultPrefix}
                    {activeTabMeta.hasFy ? `/${activeVoucherConfig.financial_year || '2026-27'}/` : '-'}
                  </Text>
                </View>
                <TextInput
                  value={activeVoucherConfig.start_seq}
                  onChangeText={(val) => updateActiveField('start_seq', val.replace(/[^0-9]/g, ''))}
                  keyboardType="numeric"
                  placeholder="1"
                  placeholderTextColor="#94A3B8"
                  style={styles.settingInput}
                />
              </View>
              <Text style={styles.helperTxt}>
                Format preview: {computedPreviewNo}
              </Text>
            </View>

            {/* 3. Date Start From Option */}
            <View style={styles.settingBlock}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={styles.settingLabel}>3. Voucher Date Start From</Text>
                {activeVoucherConfig.date_start_from ? (
                  <Pressable onPress={() => updateActiveField('date_start_from', '')}>
                    <Text style={{ fontSize: 11, color: '#DC2626', fontWeight: '700' }}>Clear (Use Current Date)</Text>
                  </Pressable>
                ) : null}
              </View>
              <TextInput
                value={activeVoucherConfig.date_start_from}
                onChangeText={(val) => updateActiveField('date_start_from', val)}
                placeholder="YYYY-MM-DD (e.g. 2026-11-16)"
                placeholderTextColor="#94A3B8"
                style={styles.dateInput}
              />
              <View style={styles.quickDateRow}>
                <Pressable
                  onPress={() => updateActiveField('date_start_from', new Date().toISOString().slice(0, 10))}
                  style={styles.quickDateChip}
                >
                  <Text style={styles.quickDateTxt}>Set to Today</Text>
                </Pressable>
                <Pressable
                  onPress={() => updateActiveField('date_start_from', '2026-04-01')}
                  style={styles.quickDateChip}
                >
                  <Text style={styles.quickDateTxt}>Set to 1 April 2026</Text>
                </Pressable>
              </View>
              <Text style={styles.helperTxt}>
                {activeVoucherConfig.date_start_from
                  ? `💡 New ${activeTabMeta.label} vouchers will automatically initialize from: ${activeVoucherConfig.date_start_from}`
                  : '💡 Leave blank to default to the current real-time date.'}
              </Text>
            </View>

            {/* Live Preview Box */}
            <View style={styles.voucherPreviewBanner}>
              <Ionicons name="sparkles" size={20} color="#0D9488" />
              <View style={{ flex: 1 }}>
                <Text style={styles.previewTitle}>Live Voucher Number Preview ({activeTabMeta.label})</Text>
                <Text style={styles.previewValue}>
                  {computedPreviewNo}
                </Text>
                <Text style={styles.previewDate}>
                  📅 Initial Date: {activeVoucherConfig.date_start_from || new Date().toISOString().slice(0, 10)} • Mode: {activeVoucherConfig.voucher_mode === 'auto' ? 'Automatic' : 'Manual Entry'}
                </Text>
              </View>
            </View>

            {/* Action Buttons */}
            <View style={{ gap: 8, marginTop: spacing.md }}>
              <PrimaryButton
                title={savingVoucher ? 'Saving Settings...' : `Save ${activeTabMeta.label} Settings`}
                onPress={() => handleSaveVoucherSettings(false)}
                disabled={savingVoucher}
              />
              <Pressable
                onPress={handleResetSequenceConfirm}
                disabled={savingVoucher}
                style={styles.resetSeqBtn}
              >
                <Ionicons name="refresh" size={16} color="#DC2626" />
                <Text style={styles.resetSeqBtnTxt}>
                  Reset {activeTabMeta.label} Sequence to #{activeVoucherConfig.start_seq || '1'} Now
                </Text>
              </Pressable>
            </View>
          </Card>

          {/* ================= EXISTING VOUCHERS LIST & DIRECT EDIT SECTION ================= */}
          <Card>
            <View style={styles.cardHeader}>
              <View style={[styles.iconBox, { backgroundColor: '#3B82F615' }]}>
                <Ionicons name="documents-outline" size={22} color="#2563EB" />
              </View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={styles.title}>Existing {activeTabMeta.label} Vouchers</Text>
                  <View style={styles.countBadge}>
                    <Text style={styles.countBadgeTxt}>{existingVouchers.length}</Text>
                  </View>
                </View>
                <Text style={styles.subText}>View, edit voucher number, edit date, or launch full editor</Text>
              </View>
              <Pressable
                onPress={() => loadExistingVouchers(activeTabKey, voucherSearch)}
                style={styles.refreshIconBtn}
                hitSlop={8}
              >
                <Ionicons name="reload" size={18} color="#2563EB" />
              </Pressable>
            </View>

            {/* Search Bar & Create Shortcut */}
            <View style={styles.searchRow}>
              <View style={styles.searchInputBox}>
                <Ionicons name="search" size={16} color="#94A3B8" />
                <TextInput
                  value={voucherSearch}
                  onChangeText={setVoucherSearch}
                  placeholder={`Search ${activeTabMeta.label} by No or Party...`}
                  placeholderTextColor="#94A3B8"
                  style={styles.searchTextInput}
                />
                {voucherSearch ? (
                  <Pressable onPress={() => setVoucherSearch('')} hitSlop={6}>
                    <Ionicons name="close-circle" size={16} color="#94A3B8" />
                  </Pressable>
                ) : null}
              </View>
              {CREATION_ROUTES[activeTabKey] ? (
                <Pressable
                  onPress={() => {
                    const c = CREATION_ROUTES[activeTabKey];
                    router.push({ pathname: c.route, params: c.params } as any);
                  }}
                  style={styles.newVoucherShortcutBtn}
                >
                  <Ionicons name="add" size={16} color="#FFF" />
                  <Text style={styles.newVoucherShortcutTxt}>New</Text>
                </Pressable>
              ) : null}
            </View>

            {/* Voucher List Content */}
            {loadingExisting ? (
              <View style={{ paddingVertical: spacing.xl, alignItems: 'center' }}>
                <ActivityIndicator size="small" color="#2563EB" />
                <Text style={[styles.mutedText, { marginTop: spacing.sm }]}>Loading existing vouchers...</Text>
              </View>
            ) : existingVouchers.length === 0 ? (
              <View style={styles.emptyVoucherBox}>
                <Ionicons name="folder-open-outline" size={36} color="#94A3B8" />
                <Text style={styles.emptyVoucherTitle}>No {activeTabMeta.label} Vouchers Found</Text>
                <Text style={styles.emptyVoucherDesc}>
                  {voucherSearch
                    ? 'No vouchers matched your search filter.'
                    : `No ${activeTabMeta.label} vouchers have been created yet. Any new vouchers will automatically initialize according to the configuration above.`}
                </Text>
                {CREATION_ROUTES[activeTabKey] ? (
                  <Pressable
                    onPress={() => {
                      const c = CREATION_ROUTES[activeTabKey];
                      router.push({ pathname: c.route, params: c.params } as any);
                    }}
                    style={styles.emptyCreateBtn}
                  >
                    <Ionicons name="add-circle-outline" size={16} color="#0D9488" />
                    <Text style={styles.emptyCreateBtnTxt}>Create First {activeTabMeta.label}</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : (
              <View style={{ gap: 10, marginTop: spacing.sm }}>
                {existingVouchers.map((v: any) => {
                  const isPaid = v.status === 'paid' || v.status === 'cleared' || v.status === 'approved';
                  const isPartial = v.status === 'partial';
                  return (
                    <View key={v.id || v.voucher_no} style={styles.voucherItemCard}>
                      <View style={styles.voucherItemHeader}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
                          <Text style={styles.voucherItemNo}>#{v.voucher_no}</Text>
                          <View style={[styles.statusPill, isPaid ? styles.statusPillPaid : isPartial ? styles.statusPillPartial : styles.statusPillDefault]}>
                            <Text style={[styles.statusPillTxt, isPaid ? styles.statusPillTxtPaid : isPartial ? styles.statusPillTxtPartial : styles.statusPillTxtDefault]}>
                              {String(v.status || 'Active').toUpperCase()}
                            </Text>
                          </View>
                        </View>
                        <Text style={styles.voucherItemDate}>📅 {v.date || 'No Date'}</Text>
                      </View>

                      <View style={styles.voucherItemBody}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.voucherItemParty} numberOfLines={1}>
                            {v.party_name || 'No Party Assigned'}
                          </Text>
                          {v.balance > 0 ? (
                            <Text style={styles.voucherItemBal}>Due Balance: {inr(v.balance)}</Text>
                          ) : null}
                        </View>
                        <Text style={styles.voucherItemAmount}>{inr(v.amount)}</Text>
                      </View>

                      {/* Action Buttons Row */}
                      <View style={styles.voucherActionRow}>
                        <Pressable
                          onPress={() => openQuickEdit(v)}
                          style={styles.quickEditBtn}
                        >
                          <Ionicons name="pencil-outline" size={14} color="#0D9488" />
                          <Text style={styles.quickEditBtnTxt}>Edit No & Date</Text>
                        </Pressable>

                        {v.edit_route ? (
                          <Pressable
                            onPress={() => router.push(v.edit_route as any)}
                            style={styles.fullEditBtn}
                          >
                            <Ionicons name="create-outline" size={14} color="#2563EB" />
                            <Text style={styles.fullEditBtnTxt}>Edit Full Voucher</Text>
                          </Pressable>
                        ) : null}

                        {v.view_route ? (
                          <Pressable
                            onPress={() => router.push(v.view_route as any)}
                            style={styles.viewVoucherBtn}
                          >
                            <Ionicons name="eye-outline" size={14} color="#475569" />
                            <Text style={styles.viewVoucherBtnTxt}>View</Text>
                          </Pressable>
                        ) : null}
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
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
                <Text style={styles.statNum}>{stats.total_tenders}</Text>
                <Text style={styles.statLbl}>Tenders</Text>
              </View>
              <View style={styles.statTile}>
                <Text style={styles.statNum}>{stats.total_tasks}</Text>
                <Text style={styles.statLbl}>Active Tasks</Text>
              </View>
              <View style={styles.statTile}>
                <Text style={styles.statNum}>{stats.total_invoices}</Text>
                <Text style={styles.statLbl}>Invoices</Text>
              </View>
            </View>
          </Card>
        </ScrollView>
      )}

      {/* ================= QUICK EDIT VOUCHER MODAL ================= */}
      <Modal
        visible={editModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setEditModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>Edit Existing Voucher</Text>
                <Text style={styles.modalSubTitle}>
                  {activeTabMeta.label} • Currently: #{editingVoucher?.voucher_no}
                </Text>
              </View>
              <Pressable onPress={() => setEditModalVisible(false)} hitSlop={8}>
                <Ionicons name="close" size={22} color="#64748B" />
              </Pressable>
            </View>

            <View style={{ gap: 12, marginTop: spacing.md }}>
              <View>
                <Text style={styles.modalFieldLabel}>Voucher Number</Text>
                <TextInput
                  value={editVoucherNo}
                  onChangeText={setEditVoucherNo}
                  placeholder="e.g. TDSC/2026-27/004632"
                  placeholderTextColor="#94A3B8"
                  style={styles.modalTextInput}
                  autoCapitalize="characters"
                />
              </View>

              <View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={styles.modalFieldLabel}>Voucher Date</Text>
                  <Pressable
                    onPress={() => setEditVoucherDate(new Date().toISOString().slice(0, 10))}
                    style={styles.quickTodayPill}
                  >
                    <Text style={styles.quickTodayPillTxt}>Set Today</Text>
                  </Pressable>
                </View>
                <TextInput
                  value={editVoucherDate}
                  onChangeText={setEditVoucherDate}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor="#94A3B8"
                  style={styles.modalTextInput}
                />
              </View>

              <View>
                <Text style={styles.modalFieldLabel}>Remarks / Note (Optional)</Text>
                <TextInput
                  value={editRemarks}
                  onChangeText={setEditRemarks}
                  placeholder="Reason for modifying voucher number or date..."
                  placeholderTextColor="#94A3B8"
                  style={styles.modalTextInput}
                />
              </View>
            </View>

            <View style={styles.modalActionRow}>
              <Pressable
                onPress={() => setEditModalVisible(false)}
                disabled={updatingVoucher}
                style={styles.modalCancelBtn}
              >
                <Text style={styles.modalCancelBtnTxt}>Cancel</Text>
              </Pressable>

              <Pressable
                onPress={handleSaveQuickEdit}
                disabled={updatingVoucher}
                style={[styles.modalSubmitBtn, updatingVoucher && { opacity: 0.6 }]}
              >
                {updatingVoucher ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <>
                    <Ionicons name="checkmark-circle-outline" size={18} color="#FFF" />
                    <Text style={styles.modalSubmitBtnTxt}>Save Changes</Text>
                  </>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
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

  /* Voucher Hub Styles */
  tabScrollRow: {
    gap: 8,
    paddingVertical: 4,
  },
  tabChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  tabChipActive: {
    backgroundColor: '#0D9488',
    borderColor: '#0D9488',
  },
  tabChipTxt: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
  },
  tabChipTxtActive: {
    color: '#FFF',
  },
  chipBadge: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
    marginLeft: 2,
  },
  chipBadgeActive: {
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  chipBadgeAuto: {
    backgroundColor: '#DCFCE7',
  },
  chipBadgeManual: {
    backgroundColor: '#FEF3C7',
  },
  chipBadgeTxt: {
    fontSize: 9,
    fontWeight: '800',
    color: '#0F766E',
  },
  voucherSubHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: spacing.md,
    backgroundColor: '#F0FDFA',
    borderWidth: 1,
    borderColor: '#CCFBF1',
    borderRadius: radius.md,
    padding: 10,
  },
  voucherSubTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0F766E',
  },
  voucherSubDesc: {
    fontSize: 11,
    color: '#115E59',
    marginTop: 1,
  },
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
  mutedText: { fontSize: font.xs, color: colors.muted },
  countBadge: { backgroundColor: '#DBEAFE', paddingHorizontal: 7, paddingVertical: 2, borderRadius: radius.pill },
  countBadgeTxt: { fontSize: 11, fontWeight: '800', color: '#1D4ED8' },
  refreshIconBtn: { width: 32, height: 32, borderRadius: 8, backgroundColor: '#EFF6FF', alignItems: 'center', justifyContent: 'center' },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: spacing.md },
  searchInputBox: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: radius.md, paddingHorizontal: 10, paddingVertical: 6 },
  searchTextInput: { flex: 1, fontSize: 12, color: '#0F172A', padding: 0 },
  newVoucherShortcutBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#0D9488', paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.md },
  newVoucherShortcutTxt: { fontSize: 12, fontWeight: '800', color: '#FFF' },
  emptyVoucherBox: { padding: spacing.xl, alignItems: 'center', backgroundColor: '#F8FAFC', borderRadius: radius.md, borderWidth: 1, borderColor: '#E2E8F0', marginTop: spacing.md },
  emptyVoucherTitle: { fontSize: 13, fontWeight: '800', color: '#334155', marginTop: spacing.sm },
  emptyVoucherDesc: { fontSize: 11, color: '#64748B', textAlign: 'center', marginTop: 4, lineHeight: 16, maxWidth: 360 },
  emptyCreateBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.md, backgroundColor: '#F0FDFA', borderWidth: 1, borderColor: '#99F6E4', paddingHorizontal: 14, paddingVertical: 7, borderRadius: radius.pill },
  emptyCreateBtnTxt: { fontSize: 12, fontWeight: '800', color: '#0D9488' },
  voucherItemCard: { backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: radius.md, padding: 12, gap: 8 },
  voucherItemHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  voucherItemNo: { fontSize: 13, fontWeight: '800', color: '#0F172A', letterSpacing: 0.3 },
  statusPill: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  statusPillPaid: { backgroundColor: '#DCFCE7' },
  statusPillPartial: { backgroundColor: '#FEF3C7' },
  statusPillDefault: { backgroundColor: '#F1F5F9' },
  statusPillTxt: { fontSize: 9, fontWeight: '800' },
  statusPillTxtPaid: { color: '#15803D' },
  statusPillTxtPartial: { color: '#B45309' },
  statusPillTxtDefault: { color: '#475569' },
  voucherItemDate: { fontSize: 11, color: '#64748B', fontWeight: '600' },
  voucherItemBody: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  voucherItemParty: { fontSize: 12, fontWeight: '700', color: '#334155' },
  voucherItemBal: { fontSize: 10, color: '#DC2626', fontWeight: '700', marginTop: 2 },
  voucherItemAmount: { fontSize: 14, fontWeight: '800', color: '#0F172A' },
  voucherActionRow: { flexDirection: 'row', gap: 6, marginTop: 4, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#E2E8F0' },
  quickEditBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: '#F0FDFA', borderWidth: 1, borderColor: '#99F6E4', paddingVertical: 6, borderRadius: radius.sm },
  quickEditBtnTxt: { fontSize: 11, fontWeight: '800', color: '#0D9488' },
  fullEditBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: '#EFF6FF', borderWidth: 1, borderColor: '#BFDBFE', paddingVertical: 6, borderRadius: radius.sm },
  fullEditBtnTxt: { fontSize: 11, fontWeight: '800', color: '#2563EB' },
  viewVoucherBtn: { paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: '#F1F5F9', borderWidth: 1, borderColor: '#CBD5E1', paddingVertical: 6, borderRadius: radius.sm },
  viewVoucherBtnTxt: { fontSize: 11, fontWeight: '700', color: '#475569' },

  /* Modal Styles */
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: spacing.lg },
  modalCard: { width: '100%', maxWidth: 440, backgroundColor: '#FFF', borderRadius: radius.lg, padding: spacing.lg, gap: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 12, elevation: 8 },
  modalHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  modalTitle: { fontSize: font.base, fontWeight: '800', color: '#0F172A' },
  modalSubTitle: { fontSize: 11, color: '#0D9488', fontWeight: '700', marginTop: 2 },
  modalFieldLabel: { fontSize: 11, fontWeight: '800', color: '#334155', textTransform: 'uppercase', marginBottom: 4 },
  modalTextInput: { backgroundColor: '#F8FAFC', borderWidth: 1.5, borderColor: '#CBD5E1', borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 8, fontSize: font.sm, color: '#0F172A', fontWeight: '700' },
  quickTodayPill: { backgroundColor: '#F0FDFA', borderWidth: 1, borderColor: '#99F6E4', paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill },
  quickTodayPillTxt: { fontSize: 10, fontWeight: '700', color: '#0D9488' },
  modalActionRow: { flexDirection: 'row', gap: 10, marginTop: spacing.md },
  modalCancelBtn: { flex: 1, paddingVertical: 10, borderRadius: radius.md, borderWidth: 1, borderColor: '#CBD5E1', alignItems: 'center', justifyContent: 'center', backgroundColor: '#F8FAFC' },
  modalCancelBtnTxt: { fontSize: font.xs, fontWeight: '700', color: '#64748B' },
  modalSubmitBtn: { flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: radius.md, backgroundColor: '#0D9488' },
  modalSubmitBtnTxt: { fontSize: font.xs, fontWeight: '800', color: '#FFF' },
});
