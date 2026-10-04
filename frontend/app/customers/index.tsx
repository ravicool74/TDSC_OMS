import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  RefreshControl,
  TextInput,
  Platform,
  Linking,
  ScrollView,
  Modal,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, font } from '@/src/theme';
import { api } from '@/src/api';
import { Avatar, Card, EmptyState, ScreenLoader } from '@/src/ui';
import { useAuth } from '@/src/AuthContext';
import { confirm, notify } from '@/src/dialog';

const DEPARTMENTS = ['All', 'RWD', 'RCD', 'WRD', 'BCD', 'PHED', 'CPWD', 'Railway', 'NHAI', 'PMGSY'];
const REG_CLASSES = ['All', 'Class-I', 'Class-II', 'Class-III', 'Class-IV', 'Class A', 'Class B'];
const DSC_FILTERS = ['All', 'Expiring Soon (≤30d)', 'Expired', 'Active DSC'];

const daysUntil = (dateStr?: string | null): number | null => {
  if (!dateStr) return null;
  let iso = dateStr.trim();
  if (/^\d{2}[-/]\d{2}[-/]\d{4}$/.test(iso)) {
    const [d, m, y] = iso.split(/[-/]/);
    iso = `${y}-${m}-${d}`;
  }
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const diff = t - Date.now();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
};

export default function ContractorsDirectoryScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';
  const canEdit = isAdmin || user?.role === 'manager';

  const [customers, setCustomers] = useState<any[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [q, setQ] = useState('');
  const [selectedDept, setSelectedDept] = useState('All');
  const [selectedClass, setSelectedClass] = useState('All');
  const [selectedDscFilter, setSelectedDscFilter] = useState('All');

  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [busyBulk, setBusyBulk] = useState(false);
  const [bulkDeptModal, setBulkDeptModal] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.get<any[]>('/customers');
      setCustomers(Array.isArray(data) ? data : []);
    } catch {
      setCustomers([]);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const selectedCount = useMemo(() => Object.values(selected).filter(Boolean).length, [selected]);
  const toggleSel = (id: string) => setSelected(p => ({ ...p, [id]: !p[id] }));
  const exitSelect = () => { setSelectMode(false); setSelected({}); };

  const printCustomer = async (c: any) => {
    try {
      const url = await api.customerPdfUrl(c.id);
      if (Platform.OS === 'web' && typeof window !== 'undefined') window.open(url, '_blank');
      else await Linking.openURL(url);
    } catch (e: any) {
      notify('Failed', e?.message || 'Try again');
    }
  };

  const deleteCustomer = async (c: any) => {
    const ok = await confirm(
      'Delete Contractor?',
      `"${c.name}" will be permanently removed from the database. This action cannot be undone.`,
      { confirmText: 'Delete', destructive: true }
    );
    if (!ok) return;
    try {
      await api.del(`/customers/${c.id}`);
      await load();
      notify('Deleted', `${c.name} deleted`);
    } catch (e: any) {
      notify('Failed', e?.message || 'Try again');
    }
  };

  const bulkDelete = async () => {
    const ids = Object.keys(selected).filter(k => selected[k]);
    if (ids.length === 0) return;
    const ok = await confirm(
      'Delete Selected?',
      `${ids.length} contractor(s) will be permanently deleted.`,
      { confirmText: 'Delete All', destructive: true }
    );
    if (!ok) return;
    setBusyBulk(true);
    try {
      const res: any = await api.post('/customers/bulk-delete', { ids });
      notify('Deleted', `${res?.deleted || 0} contractor(s) deleted`);
      exitSelect();
      await load();
    } catch (e: any) {
      notify('Failed', e?.message || 'Try again');
    } finally {
      setBusyBulk(false);
    }
  };

  const handleBulkSetDept = async (dept: string) => {
    const ids = Object.keys(selected).filter(k => selected[k]);
    if (ids.length === 0) return;
    setBusyBulk(true);
    try {
      const res: any = await api.post('/customers/bulk-action', {
        customer_ids: ids,
        action: 'set_department',
        department: dept,
      });
      notify('Department Updated', `${res?.modified || 0} contractor(s) updated`);
      setBulkDeptModal(false);
      exitSelect();
      await load();
    } catch (e: any) {
      notify('Failed', e?.message || 'Try again');
    } finally {
      setBusyBulk(false);
    }
  };

  const bulkExportCsv = () => {
    if (!customers) return;
    const ids = Object.keys(selected).filter(k => selected[k]);
    const targetCustomers = ids.length > 0 ? customers.filter(c => selected[c.id]) : customers;
    if (targetCustomers.length === 0) {
      notify('No Records', 'No contractors to export');
      return;
    }

    const headers = [
      'Customer Code', 'Name', 'Mobile', 'WhatsApp', 'Alternate Mobile',
      'Email', 'PAN', 'Aadhar', 'GST No', 'Reg Class', 'Departments',
      'Contractor Reg No', 'Reg Valid Upto', 'DSC Expiry', 'Address', 'Bank Name', 'Account No', 'IFSC Code'
    ];

    const escapeCsv = (val: any) => {
      const str = String(val == null ? '' : val).replace(/"/g, '""');
      return `"${str}"`;
    };

    const rows = targetCustomers.map(c => [
      escapeCsv(c.customer_code),
      escapeCsv(c.name),
      escapeCsv(c.mobile),
      escapeCsv(c.whatsapp),
      escapeCsv(c.alternate_mobile),
      escapeCsv(c.email),
      escapeCsv(c.pan),
      escapeCsv(c.aadhar),
      escapeCsv(c.gst_no),
      escapeCsv(c.registration_class),
      escapeCsv(c.departments),
      escapeCsv(c.contractor_reg_no),
      escapeCsv(c.registration_valid_upto),
      escapeCsv(c.dsc_expired_date),
      escapeCsv(c.address),
      escapeCsv(c.bank_name),
      escapeCsv(c.bank_account_no),
      escapeCsv(c.bank_ifsc),
    ].join(','));

    const csvContent = [headers.join(','), ...rows].join('\n');

    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `contractors_${Date.now()}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      notify('Export Successful', `Exported ${targetCustomers.length} contractors to CSV`);
    } else {
      notify('Export Ready', `${targetCustomers.length} contractors prepared for export`);
    }
  };

  const stats = useMemo(() => {
    if (!customers) return { total: 0, dscExpiring: 0, dscExpired: 0, dscActive: 0 };
    let expiring = 0;
    let expired = 0;
    let active = 0;
    customers.forEach(c => {
      const days = daysUntil(c.dsc_expired_date);
      if (days !== null) {
        if (days < 0) expired++;
        else if (days <= 30) expiring++;
        else active++;
      }
    });
    return { total: customers.length, dscExpiring: expiring, dscExpired: expired, dscActive: active };
  }, [customers]);

  const filtered = useMemo(() => {
    if (!customers) return null;
    const s = q.trim().toLowerCase();

    return customers.filter(c => {
      // 1. Text Search matching
      if (s) {
        const matchesName = (c.name || '').toLowerCase().includes(s);
        const matchesCode = (c.customer_code || '').toLowerCase().includes(s);
        const matchesMobile = (c.mobile || '').toLowerCase().includes(s);
        const matchesWhatsapp = (c.whatsapp || '').toLowerCase().includes(s);
        const matchesAltMobile = (c.alternate_mobile || '').toLowerCase().includes(s);
        const matchesPan = (c.pan || '').toLowerCase().includes(s);
        const matchesAadhar = (c.aadhar || '').toLowerCase().includes(s);
        const matchesEmail = (c.email || '').toLowerCase().includes(s);
        const matchesGst = (c.gst_no || '').toLowerCase().includes(s);
        const matchesRegNo = (c.contractor_reg_no || '').toLowerCase().includes(s);
        const matchesAddress = (c.address || '').toLowerCase().includes(s);
        const matchesNumeric = s.match(/^\d+$/) && (c.customer_code || '').toLowerCase().includes(s.padStart(8, '0'));

        if (!matchesName && !matchesCode && !matchesMobile && !matchesWhatsapp && !matchesAltMobile &&
            !matchesPan && !matchesAadhar && !matchesEmail && !matchesGst && !matchesRegNo &&
            !matchesAddress && !matchesNumeric) {
          return false;
        }
      }

      // 2. Department Filter
      if (selectedDept !== 'All') {
        const depts = (c.departments || '').toLowerCase();
        if (!depts.includes(selectedDept.toLowerCase())) return false;
      }

      // 3. Class Filter
      if (selectedClass !== 'All') {
        const cls = (c.registration_class || '').toLowerCase();
        if (!cls.includes(selectedClass.toLowerCase())) return false;
      }

      // 4. DSC Filter
      if (selectedDscFilter !== 'All') {
        const days = daysUntil(c.dsc_expired_date);
        if (selectedDscFilter === 'Expiring Soon (≤30d)') {
          if (days === null || days < 0 || days > 30) return false;
        } else if (selectedDscFilter === 'Expired') {
          if (days === null || days >= 0) return false;
        } else if (selectedDscFilter === 'Active DSC') {
          if (days === null || days <= 30) return false;
        }
      }

      return true;
    });
  }, [customers, q, selectedDept, selectedClass, selectedDscFilter]);

  return (
    <SafeAreaView edges={['top']} style={styles.root} testID="contractor-database-screen">
      {/* Header */}
      <View style={styles.header}>
        {selectMode ? (
          <>
            <Pressable onPress={exitSelect} testID="exit-select" hitSlop={10}>
              <Ionicons name="close" size={26} color={colors.onSurface} />
            </Pressable>
            <Text style={[styles.h1, { flex: 1, marginLeft: 12 }]}>{selectedCount} selected</Text>
            <Pressable
              onPress={() => {
                if (!filtered) return;
                const all = filtered.every(c => selected[c.id]);
                if (all) { setSelected({}); return; }
                const next: Record<string, boolean> = {};
                filtered.forEach(c => { next[c.id] = true; });
                setSelected(next);
              }}
              testID="select-all"
              style={styles.selectAllBtn}
            >
              <Ionicons
                name={filtered && filtered.every(c => selected[c.id]) ? 'checkbox' : 'square-outline'}
                size={18}
                color={colors.brandPrimary}
              />
              <Text style={styles.selectAllTxt}>
                {filtered && filtered.every(c => selected[c.id]) ? 'Deselect All' : 'Select All'}
              </Text>
            </Pressable>
          </>
        ) : (
          <>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Pressable onPress={() => router.back()} hitSlop={8} style={styles.backBtn}>
                  <Ionicons name="arrow-back" size={20} color="#0F172A" />
                </Pressable>
                <Text style={styles.h1}>Contractors Directory</Text>
              </View>
              <Text style={styles.subTitle}>Comprehensive Contractor Master & Credentials Vault</Text>
            </View>

            <View style={{ flexDirection: 'row', gap: 8 }}>
              {isAdmin ? (
                <Pressable
                  testID="enter-select"
                  onPress={() => setSelectMode(true)}
                  style={[styles.addBtn, { backgroundColor: '#EFF6FF' }]}
                >
                  <Ionicons name="checkbox-outline" size={22} color={colors.brandPrimary} />
                </Pressable>
              ) : null}
              <Pressable
                testID="add-contractor-btn"
                style={styles.addBtn}
                onPress={() => router.push('/customers/new' as any)}
              >
                <Ionicons name="add" size={22} color={colors.onBrandPrimary} />
              </Pressable>
            </View>
          </>
        )}
      </View>

      {/* Stats Summary Bar */}
      <View style={styles.statsBar}>
        <View style={styles.statPill}>
          <Text style={styles.statVal}>{stats.total}</Text>
          <Text style={styles.statLbl}>Total Contractors</Text>
        </View>
        <View style={[styles.statPill, { backgroundColor: '#DCFCE7' }]}>
          <Text style={[styles.statVal, { color: '#15803D' }]}>{stats.dscActive}</Text>
          <Text style={[styles.statLbl, { color: '#15803D' }]}>Active DSC</Text>
        </View>
        <View style={[styles.statPill, { backgroundColor: '#FEF3C7' }]}>
          <Text style={[styles.statVal, { color: '#B45309' }]}>{stats.dscExpiring}</Text>
          <Text style={[styles.statLbl, { color: '#B45309' }]}>Expiring Soon</Text>
        </View>
        <View style={[styles.statPill, { backgroundColor: '#FEE2E2' }]}>
          <Text style={[styles.statVal, { color: colors.error }]}>{stats.dscExpired}</Text>
          <Text style={[styles.statLbl, { color: colors.error }]}>Expired DSC</Text>
        </View>
      </View>

      {/* Multi-Criteria Search Bar */}
      <View style={styles.searchBar}>
        <Ionicons name="search" size={18} color={colors.muted} />
        <TextInput
          testID="contractor-search-input"
          value={q}
          onChangeText={setQ}
          placeholder="Search by Name, Reg No, GST, Mobile, PAN, ID, Dept…"
          placeholderTextColor={colors.muted}
          style={styles.searchInput}
        />
        {q ? (
          <Pressable onPress={() => setQ('')} hitSlop={10} testID="search-clear">
            <Ionicons name="close-circle" size={18} color={colors.muted} />
          </Pressable>
        ) : null}
      </View>

      {/* Filter Chips Horizontal Rows */}
      <View style={{ marginBottom: 4 }}>
        {/* Department Filters */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterChipRow}>
          <Text style={styles.filterChipRowLbl}>Dept:</Text>
          {DEPARTMENTS.map(d => (
            <Pressable
              key={d}
              onPress={() => setSelectedDept(d)}
              style={[styles.filterChip, selectedDept === d && styles.filterChipActive]}
            >
              <Text style={[styles.filterChipTxt, selectedDept === d && styles.filterChipTxtActive]}>{d}</Text>
            </Pressable>
          ))}
        </ScrollView>

        {/* Class & DSC Filters */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.filterChipRow, { marginTop: 4 }]}>
          <Text style={styles.filterChipRowLbl}>Class:</Text>
          {REG_CLASSES.map(c => (
            <Pressable
              key={c}
              onPress={() => setSelectedClass(c)}
              style={[styles.filterChip, selectedClass === c && styles.filterChipActive]}
            >
              <Text style={[styles.filterChipTxt, selectedClass === c && styles.filterChipTxtActive]}>{c}</Text>
            </Pressable>
          ))}
          <View style={{ width: 1, backgroundColor: colors.border, marginHorizontal: 4 }} />
          <Text style={styles.filterChipRowLbl}>DSC:</Text>
          {DSC_FILTERS.map(df => (
            <Pressable
              key={df}
              onPress={() => setSelectedDscFilter(df)}
              style={[styles.filterChip, selectedDscFilter === df && styles.filterChipActive]}
            >
              <Text style={[styles.filterChipTxt, selectedDscFilter === df && styles.filterChipTxtActive]}>{df}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {/* Contractor List */}
      {filtered === null ? (
        <ScreenLoader />
      ) : filtered.length === 0 ? (
        q || selectedDept !== 'All' || selectedClass !== 'All' || selectedDscFilter !== 'All' ? (
          <EmptyState
            testID="contractors-nomatch"
            icon="search-outline"
            title="No matching contractors"
            subtitle="Try adjusting your search criteria or filter chips"
            actionLabel="Clear Filters"
            onAction={() => { setQ(''); setSelectedDept('All'); setSelectedClass('All'); setSelectedDscFilter('All'); }}
          />
        ) : (
          <EmptyState
            testID="contractors-empty"
            icon="people-outline"
            title="No contractors yet"
            subtitle="Add your first contractor with all 42 registration and portal fields"
            actionLabel="+ Add Contractor"
            onAction={() => router.push('/customers/new' as any)}
          />
        )
      ) : (
        <FlatList
          testID="contractors-list"
          data={filtered}
          keyExtractor={(item) => item.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          contentContainerStyle={{
            padding: spacing.lg,
            gap: spacing.md,
            paddingBottom: Math.max(insets.bottom + (selectMode ? 80 : 30), spacing.xxxl),
          }}
          renderItem={({ item }) => {
            const dscDays = daysUntil(item.dsc_expired_date);
            const dscWarn = dscDays !== null && dscDays <= 30;
            const dscExpired = dscDays !== null && dscDays < 0;

            const encDays = daysUntil(item.encryption_expired_date);
            const encWarn = encDays !== null && encDays <= 30;
            const encExpired = encDays !== null && encDays < 0;

            const deptsList = (item.departments || '').split(',').map((d: string) => d.trim()).filter(Boolean);

            // Vault portals configured count
            const vaultPortals = [
              item.eproc2_user_id || item.eproc2_password ? 'eProc' : null,
              item.railway_user_id || item.railway_password ? 'IREPS' : null,
              item.cpp_user_id || item.cpp_password ? 'CPP' : null,
              item.gst_no || item.gst_password ? 'GST' : null,
              item.epfo_user_id || item.epfo_password ? 'EPFO' : null,
              item.gem_user_id || item.gem_password ? 'GeM' : null,
              item.pmgsy_user_id || item.pmgsy_password ? 'PMGSY' : null,
              item.iso_user_id || item.iso_password ? 'ISO' : null,
            ].filter(Boolean);

            return (
              <Pressable
                onPress={() => selectMode ? toggleSel(item.id) : router.push(`/customers/${item.id}` as any)}
                onLongPress={() => { if (isAdmin) { setSelectMode(true); setSelected({ [item.id]: true }); } }}
                testID={`contractor-card-${item.id}`}
              >
                <Card
                  style={[
                    styles.contractorCard,
                    selectMode && selected[item.id] && { borderColor: colors.brandPrimary, borderWidth: 2 },
                    dscWarn && { borderColor: dscExpired ? colors.error : colors.warning, borderWidth: 1.5 },
                  ]}
                >
                  {/* Top Row: Avatar, Name, Reg Class Badge, Customer Code */}
                  <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md }}>
                    {selectMode ? (
                      <Pressable onPress={() => toggleSel(item.id)} testID={`check-${item.id}`} hitSlop={8} style={{ marginTop: 6 }}>
                        <Ionicons
                          name={selected[item.id] ? 'checkbox' : 'square-outline'}
                          size={24}
                          color={selected[item.id] ? colors.brandPrimary : colors.muted}
                        />
                      </Pressable>
                    ) : (
                      <Avatar name={item.name} />
                    )}

                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <Text style={styles.contractorName}>{item.name}</Text>
                        {item.registration_class ? (
                          <View style={styles.classBadge}>
                            <Text style={styles.classBadgeTxt}>{item.registration_class}</Text>
                          </View>
                        ) : null}
                      </View>

                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2, flexWrap: 'wrap' }}>
                        <Text style={styles.codeBadgeTxt}>{item.customer_code || item.id}</Text>
                        {item.contractor_reg_no ? (
                          <Text style={styles.regNoTxt}>• Reg No: <Text style={{ fontWeight: '700' }}>{item.contractor_reg_no}</Text></Text>
                        ) : null}
                      </View>
                    </View>
                  </View>

                  {/* Department Pills */}
                  {deptsList.length > 0 ? (
                    <View style={styles.deptsRow}>
                      <Text style={styles.deptsLbl}>Depts:</Text>
                      {deptsList.map((d: string) => (
                        <View key={d} style={styles.deptChip}>
                          <Text style={styles.deptChipTxt}>{d}</Text>
                        </View>
                      ))}
                    </View>
                  ) : null}

                  {/* Contact & Address Bar */}
                  <View style={styles.metaBox}>
                    {/* Mobile & Call / WhatsApp actions */}
                    {item.mobile ? (
                      <View style={styles.metaRow}>
                        <Ionicons name="call-outline" size={14} color="#0284C7" />
                        <Text style={styles.metaTxt}>📱 {item.mobile}</Text>
                        <Pressable
                          hitSlop={6}
                          onPress={(e) => { e?.stopPropagation?.(); Linking.openURL(`tel:${item.mobile}`); }}
                          style={styles.contactIconBtn}
                        >
                          <Ionicons name="call" size={12} color={colors.brandPrimary} />
                        </Pressable>
                        {item.whatsapp ? (
                          <Pressable
                            hitSlop={6}
                            onPress={(e) => {
                              e?.stopPropagation?.();
                              const clean = item.whatsapp.replace(/\D/g, '');
                              Linking.openURL(`https://wa.me/${clean.startsWith('91') ? clean : '91' + clean}`);
                            }}
                            style={[styles.contactIconBtn, { backgroundColor: '#DCFCE7' }]}
                          >
                            <Ionicons name="logo-whatsapp" size={12} color="#15803D" />
                          </Pressable>
                        ) : null}
                      </View>
                    ) : null}

                    {/* Tax & Identification Tags */}
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                      {item.pan ? (
                        <View style={styles.idTag}>
                          <Text style={styles.idTagLbl}>PAN: </Text>
                          <Text style={styles.idTagVal}>{item.pan}</Text>
                        </View>
                      ) : null}
                      {item.gst_no ? (
                        <View style={[styles.idTag, { backgroundColor: '#EFF6FF', borderColor: '#BFDBFE' }]}>
                          <Text style={[styles.idTagLbl, { color: '#1D4ED8' }]}>GST: </Text>
                          <Text style={[styles.idTagVal, { color: '#1D4ED8' }]}>{item.gst_no}</Text>
                        </View>
                      ) : null}
                      {item.aadhar ? (
                        <View style={styles.idTag}>
                          <Text style={styles.idTagLbl}>Aadhar: </Text>
                          <Text style={styles.idTagVal}>{item.aadhar}</Text>
                        </View>
                      ) : null}
                    </View>

                    {item.address ? (
                      <View style={[styles.metaRow, { marginTop: 4 }]}>
                        <Ionicons name="location-outline" size={14} color={colors.muted} />
                        <Text style={styles.metaTxt} numberOfLines={1}>{item.address}</Text>
                      </View>
                    ) : null}
                  </View>

                  {/* DSC Expiry Badges */}
                  {(dscDays !== null || encDays !== null) && (
                    <View style={styles.dscRow}>
                      {dscDays !== null ? (
                        <View style={[styles.dscBadge, { backgroundColor: dscExpired ? '#FEE2E2' : dscWarn ? '#FEF3C7' : '#DCFCE7' }]}>
                          <Ionicons
                            name={dscExpired ? 'alert-circle' : dscWarn ? 'time' : 'checkmark-circle'}
                            size={12}
                            color={dscExpired ? colors.error : dscWarn ? '#B45309' : '#15803D'}
                          />
                          <Text style={[styles.dscBadgeTxt, { color: dscExpired ? colors.error : dscWarn ? '#B45309' : '#15803D' }]}>
                            Signing: {dscExpired ? `Expired (${-dscDays}d ago)` : dscWarn ? `Expires in ${dscDays}d` : `Valid (${dscDays}d)`}
                          </Text>
                        </View>
                      ) : null}
                      {encDays !== null ? (
                        <View style={[styles.dscBadge, { backgroundColor: encExpired ? '#FEE2E2' : encWarn ? '#FEF3C7' : '#DCFCE7' }]}>
                          <Text style={[styles.dscBadgeTxt, { color: encExpired ? colors.error : encWarn ? '#B45309' : '#15803D' }]}>
                            Enc: {encExpired ? 'Expired' : encWarn ? `${encDays}d` : 'Valid'}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                  )}

                  {/* Vault Badges */}
                  {vaultPortals.length > 0 ? (
                    <View style={styles.vaultPillRow}>
                      <Ionicons name="shield-checkmark" size={13} color="#059669" />
                      <Text style={styles.vaultPillLbl}>Vault Portals:</Text>
                      {vaultPortals.map(p => (
                        <View key={p} style={styles.portalMiniBadge}>
                          <Text style={styles.portalMiniBadgeTxt}>{p}</Text>
                        </View>
                      ))}
                    </View>
                  ) : null}

                  {/* Action Buttons Row */}
                  <View style={styles.actionRow}>
                    <Pressable
                      testID={`view-btn-${item.id}`}
                      onPress={(e) => { e?.stopPropagation?.(); router.push(`/customers/${item.id}` as any); }}
                      style={styles.btnViewDetails}
                    >
                      <Ionicons name="eye-outline" size={15} color={colors.brandPrimary} />
                      <Text style={styles.btnViewDetailsTxt}>Full Profile</Text>
                    </Pressable>

                    {canEdit ? (
                      <Pressable
                        testID={`edit-btn-${item.id}`}
                        onPress={(e) => {
                          e?.stopPropagation?.();
                          router.push({ pathname: '/customers/new', params: { edit_id: item.id } } as any);
                        }}
                        style={styles.btnEdit}
                      >
                        <Ionicons name="create-outline" size={15} color="#B45309" />
                        <Text style={styles.btnEditTxt}>Edit Details</Text>
                      </Pressable>
                    ) : null}

                    <Pressable
                      testID={`print-btn-${item.id}`}
                      onPress={(e) => { e?.stopPropagation?.(); printCustomer(item); }}
                      style={styles.btnPrint}
                    >
                      <Ionicons name="print-outline" size={15} color="#334155" />
                      <Text style={styles.btnPrintTxt}>Print</Text>
                    </Pressable>

                    {isAdmin ? (
                      <Pressable
                        testID={`del-btn-${item.id}`}
                        onPress={(e) => { e?.stopPropagation?.(); deleteCustomer(item); }}
                        style={styles.btnDel}
                      >
                        <Ionicons name="trash-outline" size={15} color={colors.error} />
                      </Pressable>
                    ) : null}
                  </View>
                </Card>
              </Pressable>
            );
          }}
        />
      )}

      {/* Bulk Action Bar */}
      {selectMode ? (
        <View style={[styles.bulkBar, { paddingBottom: Math.max(insets.bottom, 14) }]} testID="bulk-bar">
          <Pressable
            disabled={selectedCount === 0 || busyBulk}
            onPress={() => setBulkDeptModal(true)}
            style={[styles.bulkBtnExtra, { backgroundColor: '#EFF6FF', borderColor: '#BFDBFE' }]}
          >
            <Ionicons name="business-outline" size={15} color={colors.brandPrimary} />
            <Text style={{ color: colors.brandPrimary, fontWeight: '800', fontSize: 12 }}>Dept</Text>
          </Pressable>

          <Pressable
            disabled={selectedCount === 0 || busyBulk}
            onPress={bulkExportCsv}
            style={[styles.bulkBtnExtra, { backgroundColor: '#F0FDF4', borderColor: '#BBF7D0' }]}
          >
            <Ionicons name="download-outline" size={15} color="#15803D" />
            <Text style={{ color: '#15803D', fontWeight: '800', fontSize: 12 }}>CSV</Text>
          </Pressable>

          <Pressable
            testID="bulk-delete"
            disabled={selectedCount === 0 || busyBulk}
            onPress={bulkDelete}
            style={[
              styles.bulkDelBtn,
              { opacity: selectedCount === 0 || busyBulk ? 0.5 : 1, flex: 1.4 },
            ]}
          >
            <Ionicons name="trash" size={15} color="#FFF" />
            <Text style={{ color: '#FFF', fontWeight: '800', fontSize: 12 }}>
              {busyBulk ? 'Deleting…' : `Delete (${selectedCount})`}
            </Text>
          </Pressable>

          <Pressable onPress={exitSelect} testID="bulk-cancel" style={[styles.bulkCancelBtn, { flex: 0.8 }]}>
            <Text style={{ color: colors.onSurface, fontWeight: '700', fontSize: 12 }}>Cancel</Text>
          </Pressable>
        </View>
      ) : null}

      {/* Bulk Department Assignment Modal */}
      <Modal visible={bulkDeptModal} animationType="fade" transparent onRequestClose={() => setBulkDeptModal(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: spacing.lg }}>
          <View style={{ backgroundColor: '#FFF', borderRadius: radius.xl, padding: spacing.lg, maxHeight: '80%' }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md }}>
              <View>
                <Text style={{ fontSize: font.lg, fontWeight: '800', color: colors.onSurface }}>Assign Department</Text>
                <Text style={{ fontSize: font.xs, color: colors.muted, marginTop: 2 }}>Apply to {selectedCount} selected contractor(s)</Text>
              </View>
              <Pressable onPress={() => setBulkDeptModal(false)} hitSlop={10}>
                <Ionicons name="close" size={24} color={colors.muted} />
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={{ gap: 8, paddingVertical: spacing.sm }}>
              {DEPARTMENTS.filter(d => d !== 'All').map(d => (
                <Pressable
                  key={d}
                  onPress={() => handleBulkSetDept(d)}
                  style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14, borderRadius: radius.md, backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E2E8F0' }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Ionicons name="business" size={16} color={colors.brandPrimary} />
                    <Text style={{ fontSize: 14, fontWeight: '700', color: colors.onSurface }}>{d}</Text>
                  </View>
                  <Ionicons name="arrow-forward" size={16} color={colors.muted} />
                </Pressable>
              ))}
            </ScrollView>

            <Pressable
              onPress={() => setBulkDeptModal(false)}
              style={{ marginTop: spacing.md, paddingVertical: 12, alignItems: 'center', borderRadius: radius.md, backgroundColor: '#F1F5F9' }}
            >
              <Text style={{ color: colors.onSurface, fontWeight: '700' }}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceSecondary },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  backBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  h1: { fontSize: font.xl, fontWeight: '900', color: colors.onSurface, letterSpacing: -0.3 },
  subTitle: { fontSize: font.xs, color: colors.muted, marginTop: 2, marginLeft: 38 },
  addBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.brandPrimary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: '#EFF6FF',
  },
  selectAllTxt: { color: colors.brandPrimary, fontWeight: '800', fontSize: 12 },

  statsBar: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: spacing.lg,
    marginTop: 8,
    marginBottom: 6,
  },
  statPill: {
    flex: 1,
    backgroundColor: '#FFF',
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  statVal: { fontSize: 14, fontWeight: '900', color: '#0F172A' },
  statLbl: { fontSize: 9, fontWeight: '700', color: colors.muted, marginTop: 1 },

  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: spacing.lg,
    marginTop: 4,
    marginBottom: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchInput: { flex: 1, color: colors.onSurface, fontSize: font.base, paddingVertical: 0 },

  filterChipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.lg,
  },
  filterChipRowLbl: { fontSize: 11, fontWeight: '800', color: colors.muted, marginRight: 2 },
  filterChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  filterChipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  filterChipTxt: { fontSize: 11, fontWeight: '700', color: '#475569' },
  filterChipTxtActive: { color: '#FFF' },

  contractorCard: { padding: spacing.md, borderRadius: radius.lg, gap: 8 },
  contractorName: { fontSize: font.lg, fontWeight: '800', color: '#0F172A' },
  classBadge: {
    backgroundColor: '#EEF2FF',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#C7D2FE',
  },
  classBadgeTxt: { fontSize: 10, fontWeight: '800', color: '#4338CA' },
  codeBadgeTxt: { fontSize: 12, fontWeight: '800', color: colors.brandPrimary },
  regNoTxt: { fontSize: 11, color: '#334155' },

  deptsRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 4, marginTop: 2 },
  deptsLbl: { fontSize: 10, fontWeight: '700', color: colors.muted },
  deptChip: { backgroundColor: '#DCFCE7', paddingHorizontal: 6, paddingVertical: 1.5, borderRadius: 4 },
  deptChipTxt: { fontSize: 10, fontWeight: '800', color: '#15803D' },

  metaBox: { backgroundColor: '#F8FAFC', borderRadius: radius.md, padding: 8, gap: 4 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaTxt: { fontSize: 12, color: '#334155', fontWeight: '500' },
  contactIconBtn: { paddingHorizontal: 6, paddingVertical: 2, backgroundColor: '#EFF6FF', borderRadius: 4 },

  idTag: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  idTagLbl: { fontSize: 10, color: colors.muted, fontWeight: '700' },
  idTagVal: { fontSize: 10, fontWeight: '800', color: '#1E293B' },

  dscRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  dscBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  dscBadgeTxt: { fontSize: 10, fontWeight: '800' },

  vaultPillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexWrap: 'wrap',
    backgroundColor: '#F0FDF4',
    padding: 6,
    borderRadius: 6,
  },
  vaultPillLbl: { fontSize: 10, fontWeight: '800', color: '#166534' },
  portalMiniBadge: { backgroundColor: '#BBF7D0', paddingHorizontal: 5, paddingVertical: 1.5, borderRadius: 3 },
  portalMiniBadgeTxt: { fontSize: 9, fontWeight: '800', color: '#14532D' },

  actionRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingTop: 8,
  },
  btnViewDetails: {
    flex: 1.2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: '#EFF6FF',
    paddingVertical: 8,
    borderRadius: 6,
  },
  btnViewDetailsTxt: { color: colors.brandPrimary, fontWeight: '800', fontSize: 12 },
  btnEdit: {
    flex: 1.3,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: '#FEF3C7',
    paddingVertical: 8,
    borderRadius: 6,
  },
  btnEditTxt: { color: '#B45309', fontWeight: '800', fontSize: 12 },
  btnPrint: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: '#F1F5F9',
    paddingVertical: 8,
    borderRadius: 6,
  },
  btnPrintTxt: { color: '#334155', fontWeight: '800', fontSize: 12 },
  btnDel: {
    width: 36,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FEE2E2',
    borderRadius: 6,
  },

  bulkBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    gap: 8,
    padding: 16,
    backgroundColor: '#FFF',
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  bulkCancelBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    backgroundColor: colors.surfaceSecondary,
  },
  bulkDelBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
    borderRadius: 8,
    backgroundColor: colors.error,
  },
  bulkBtnExtra: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 14,
    borderRadius: 8,
    borderWidth: 1,
  },
});
