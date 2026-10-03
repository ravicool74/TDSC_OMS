import React, { useCallback, useMemo, useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, FlatList, Pressable, RefreshControl,
  TextInput, ScrollView, Modal, Alert, Platform, Linking, ActivityIndicator
} from 'react-native';
import { useRouter, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, font } from '@/src/theme';
import { api } from '@/src/api';
import { Card, EmptyState, ScreenLoader, StatusBadge, PrimaryButton, SecondaryButton } from '@/src/ui';
import { ScreenHeader } from '@/src/ScreenHeader';
import { useAuth } from '@/src/AuthContext';
import TenderCallingView from './TenderCallingView';

type SubMenu = 'tenders' | 'contractors' | 'manage' | 'calling';
type ValueCategoryFilter = 'all' | '0_to_25_lacs' | '25_to_70_lacs' | '70_to_3_5_cr' | 'above_3_5_cr';

const VALUE_CATEGORIES: { id: ValueCategoryFilter; label: string; range: string; color: string }[] = [
  { id: 'all', label: 'All Values', range: 'All Tenders', color: colors.brandPrimary },
  { id: '0_to_25_lacs', label: '0 to 25 Lacs', range: '₹0 - ₹25 L', color: '#0ea5e9' },
  { id: '25_to_70_lacs', label: '25 to 70 Lacs', range: '₹25 L - ₹70 L', color: '#8b5cf6' },
  { id: '70_to_3_5_cr', label: '70L to 3.5 Cr', range: '₹70 L - ₹3.5 Cr', color: '#f59e0b' },
  { id: 'above_3_5_cr', label: '3.5 Cr & Above', range: '> ₹3.5 Crore', color: '#ef4444' },
];

const STANDARD_CLASSES = ['Class IV', 'Class III', 'Class II', 'Class I', 'Class C', 'Class B', 'Class A', 'Super Class'];
const STANDARD_DEPTS = [
  'Rural Works Department (RWD)',
  'Public Works Department (PWD)',
  'Central Public Works Department (CPWD)',
  'Building Construction Department (BCD)',
  'Public Health Engineering Department (PHED)',
  'Water Resources Department (WRD)',
  'Energy Department',
  'Road Construction Department (RCD)',
];

export default function TenderManagementScreen() {
  const router = useRouter();
  const searchParams = useLocalSearchParams<{ tab?: string }>();
  const { user } = useAuth();
  const isAdminOrManager = user?.role === 'admin' || user?.role === 'manager';

  const [activeMenu, setActiveMenu] = useState<SubMenu>(searchParams.tab === 'calling' ? 'calling' : 'tenders');
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (searchParams.tab === 'calling') setActiveMenu('calling');
  }, [searchParams.tab]);

  // --- Sub-menu 1: Tenders State ---
  const [tenders, setTenders] = useState<any[] | null>(null);
  const [valFilter, setValFilter] = useState<ValueCategoryFilter>('all');
  const [deptFilter, setDeptFilter] = useState<string>('all');
  const [tenderSearch, setTenderSearch] = useState('');
  const [selectedTenderForMatch, setSelectedTenderForMatch] = useState<any | null>(null);
  const [matchingContractors, setMatchingContractors] = useState<any[] | null>(null);
  const [loadingMatch, setLoadingMatch] = useState(false);

  // Web Sources & Scraper Modal
  const [sourcesModalVisible, setSourcesModalVisible] = useState(false);
  const [sourcesList, setSourcesList] = useState<any[]>([]);
  const [collectingSourceId, setCollectingSourceId] = useState<string | null>(null);
  const [newSourceUrl, setNewSourceUrl] = useState('');
  const [newSourceName, setNewSourceName] = useState('');
  const [newSourceDept, setNewSourceDept] = useState('');
  const [addingSource, setAddingSource] = useState(false);

  // --- Sub-menu 2: Contractor State ---
  const [contractors, setContractors] = useState<any[] | null>(null);
  const [contractorSearch, setContractorSearch] = useState('');
  const [syncingCustomers, setSyncingCustomers] = useState(false);
  const [contractorModalVisible, setContractorModalVisible] = useState(false);
  const [editingContractor, setEditingContractor] = useState<any | null>(null);
  const [conForm, setConForm] = useState({
    name: '', mobile: '', registration_class: 'Class II',
    departments: ['RWD', 'PWD'], whatsapp: '', email: '', district: '', validity: '2028-12-31'
  });

  // --- Sub-menu 3: Manage Tender & Contractor State ---
  const [mappingMatrix, setMappingMatrix] = useState<Record<string, string[]>>({});
  const [subscriptions, setSubscriptions] = useState<any[] | null>(null);
  const [savingMapping, setSavingMapping] = useState(false);
  const [subModalVisible, setSubModalVisible] = useState(false);
  const [subForm, setSubForm] = useState({
    contractor_id: '',
    subscribed_departments: ['RWD', 'PWD'],
    subscribed_value_categories: ['0_to_25_lacs', '25_to_70_lacs', '70_to_3_5_cr'],
    alert_channels: ['whatsapp', 'sms'],
    status: 'active',
    valid_until: '2027-12-31',
    notes: 'Standard Tender Alert Subscription',
  });

  // Load functions
  const loadTenders = useCallback(async () => {
    try {
      const data = await api.getTendersList();
      setTenders(data);
    } catch {
      setTenders([]);
    }
  }, []);

  const loadContractors = useCallback(async () => {
    try {
      const data = await api.getContractors();
      setContractors(data);
    } catch {
      setContractors([]);
    }
  }, []);

  const loadManageData = useCallback(async () => {
    try {
      const [maps, subs] = await Promise.all([
        api.getTenderMappings(),
        api.getContractorSubscriptions(),
      ]);
      if (maps && maps.value_class_mapping) {
        setMappingMatrix(maps.value_class_mapping);
      }
      setSubscriptions(subs || []);
    } catch {
      setSubscriptions([]);
    }
  }, []);

  const loadSources = useCallback(async () => {
    try {
      const s = await api.getTenderSources();
      setSourcesList(s || []);
    } catch {
      setSourcesList([]);
    }
  }, []);

  const reloadAll = useCallback(async () => {
    if (activeMenu === 'tenders') await loadTenders();
    else if (activeMenu === 'contractors') await loadContractors();
    else if (activeMenu === 'manage') await loadManageData();
  }, [activeMenu, loadTenders, loadContractors, loadManageData]);

  useFocusEffect(useCallback(() => { reloadAll(); }, [reloadAll]));

  const onRefresh = async () => {
    setRefreshing(true);
    await reloadAll();
    setRefreshing(false);
  };

  // --- Sub-menu 1: Filtered Tenders ---
  const filteredTenders = useMemo(() => {
    if (!tenders) return null;
    return tenders.filter(t => {
      if (valFilter !== 'all' && t.value_category !== valFilter) return false;
      if (deptFilter !== 'all' && !(t.department || '').toLowerCase().includes(deptFilter.toLowerCase())) return false;
      if (tenderSearch.trim()) {
        const s = tenderSearch.trim().toLowerCase();
        const match = (
          (t.name_of_work || t.title || '').toLowerCase().includes(s) ||
          (t.tender_id || t.tender_code || '').toLowerCase().includes(s) ||
          (t.reference_no || t.nit_no || '').toLowerCase().includes(s) ||
          (t.department || '').toLowerCase().includes(s) ||
          (t.tender_description || t.description || '').toLowerCase().includes(s)
        );
        if (!match) return false;
      }
      return true;
    });
  }, [tenders, valFilter, deptFilter, tenderSearch]);

  // Trigger web scraping / collection
  const handleCollectTenders = async (sourceId: string, customUrl?: string) => {
    setCollectingSourceId(sourceId);
    try {
      const res = await api.collectTendersFromSource(sourceId, customUrl);
      Alert.alert('Tenders Collected!', res?.message || 'Extracted and sorted new tenders.');
      await loadTenders();
      await loadSources();
      setSourcesModalVisible(false);
    } catch (e: any) {
      Alert.alert('Collection Error', e?.message || 'Failed to collect tenders from web page.');
    } finally {
      setCollectingSourceId(null);
    }
  };

  const handleAddSource = async () => {
    if (!newSourceUrl.trim() || !newSourceName.trim()) {
      Alert.alert('Error', 'Please provide portal name and valid URL.');
      return;
    }
    setAddingSource(true);
    try {
      await api.addTenderSource({
        name: newSourceName.trim(),
        url: newSourceUrl.trim(),
        department: newSourceDept.trim() || 'General',
        notes: 'Attached open web page address by Admin',
        status: 'active',
      });
      setNewSourceName('');
      setNewSourceUrl('');
      setNewSourceDept('');
      await loadSources();
      Alert.alert('Success', 'Web Source attached successfully.');
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to add source.');
    } finally {
      setAddingSource(false);
    }
  };

  // Tender-Contractor Matching modal
  const openTenderMatchModal = async (tender: any) => {
    setSelectedTenderForMatch(tender);
    setLoadingMatch(true);
    setMatchingContractors(null);
    try {
      const res = await api.getMatchingContractorsForTender(tender.id);
      setMatchingContractors(res?.matched_contractors || []);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to match contractors.');
      setMatchingContractors([]);
    } finally {
      setLoadingMatch(false);
    }
  };

  // --- Sub-menu 2: Contractor Actions ---
  const handleSyncCustomers = async () => {
    setSyncingCustomers(true);
    try {
      const res = await api.syncContractorsFromCustomers();
      Alert.alert('Contractor Database Synced', res?.message || 'Contractors auto-populated from customer database.');
      await loadContractors();
    } catch (e: any) {
      Alert.alert('Sync Failed', e?.message || 'Could not sync from customers.');
    } finally {
      setSyncingCustomers(false);
    }
  };

  const handleSaveContractor = async () => {
    if (!conForm.name.trim() || !conForm.mobile.trim()) {
      Alert.alert('Validation Error', 'Contractor name and mobile number are mandatory.');
      return;
    }
    try {
      if (editingContractor) {
        await api.updateContractor(editingContractor.id, conForm);
        Alert.alert('Success', 'Contractor updated successfully.');
      } else {
        await api.createContractor(conForm);
        Alert.alert('Success', 'New contractor registered.');
      }
      setContractorModalVisible(false);
      setEditingContractor(null);
      await loadContractors();
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to save contractor.');
    }
  };

  const openEditContractor = (c: any) => {
    setEditingContractor(c);
    setConForm({
      name: c.name || '',
      mobile: c.mobile || '',
      registration_class: c.registration_class || 'Class II',
      departments: c.departments || ['RWD', 'PWD'],
      whatsapp: c.whatsapp || c.mobile || '',
      email: c.email || '',
      district: c.district || '',
      validity: c.validity || '2028-12-31',
    });
    setContractorModalVisible(true);
  };

  const handleDeleteContractor = (c: any) => {
    Alert.alert(
      'Delete Contractor?',
      `Are you sure you want to remove ${c.name}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.deleteContractor(c.id);
              await loadContractors();
            } catch (e: any) {
              Alert.alert('Error', e?.message || 'Delete failed.');
            }
          },
        },
      ]
    );
  };

  const filteredContractors = useMemo(() => {
    if (!contractors) return null;
    if (!contractorSearch.trim()) return contractors;
    const s = contractorSearch.trim().toLowerCase();
    return contractors.filter(c =>
      (c.name || '').toLowerCase().includes(s) ||
      (c.mobile || '').toLowerCase().includes(s) ||
      (c.registration_class || '').toLowerCase().includes(s) ||
      (c.departments || []).some((d: string) => d.toLowerCase().includes(s))
    );
  }, [contractors, contractorSearch]);

  // --- Sub-menu 3: Manage Actions ---
  const toggleMapping = (valueCat: string, className: string) => {
    setMappingMatrix(prev => {
      const currentList = prev[valueCat] || [];
      const updated = currentList.includes(className)
        ? currentList.filter(c => c !== className)
        : [...currentList, className];
      return { ...prev, [valueCat]: updated };
    });
  };

  const saveMappingRules = async () => {
    setSavingMapping(true);
    try {
      await api.updateTenderMappings({ value_class_mapping: mappingMatrix });
      Alert.alert('Success', 'Tender Value to Contractor Class mapping matrix saved successfully.');
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to save mapping matrix.');
    } finally {
      setSavingMapping(false);
    }
  };

  const handleSaveSubscription = async () => {
    if (!subForm.contractor_id) {
      Alert.alert('Error', 'Please select a contractor.');
      return;
    }
    try {
      await api.saveContractorSubscription(subForm);
      Alert.alert('Success', 'Contractor subscription updated.');
      setSubModalVisible(false);
      await loadManageData();
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to save subscription.');
    }
  };

  const sendWhatsAppAlert = (mobile: string, message: string) => {
    const cleanMobile = mobile.replace(/[^0-9]/g, '');
    const phone = cleanMobile.startsWith('91') ? cleanMobile : `91${cleanMobile}`;
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
    if (Platform.OS === 'web') {
      window.open(url, '_blank');
    } else {
      Linking.openURL(url);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surfaceSecondary }} testID="tender-management-screen">
      <ScreenHeader
        title="Tender Management"
        right={(
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {activeMenu === 'tenders' && (
              <Pressable
                testID="open-sources-btn"
                onPress={() => { loadSources(); setSourcesModalVisible(true); }}
                style={styles.headerBtn}
              >
                <Ionicons name="globe-outline" size={20} color="#fff" />
              </Pressable>
            )}
            <Pressable
              testID="add-tender-btn"
              onPress={() => {
                if (activeMenu === 'tenders') router.push('/tenders/new' as any);
                else if (activeMenu === 'contractors') {
                  setEditingContractor(null);
                  setConForm({
                    name: '', mobile: '', registration_class: 'Class II',
                    departments: ['RWD', 'PWD'], whatsapp: '', email: '', district: '', validity: '2028-12-31'
                  });
                  setContractorModalVisible(true);
                }
              }}
              style={styles.addBtn}
            >
              <Ionicons name="add" size={22} color={colors.onBrandPrimary} />
            </Pressable>
          </View>
        )}
      />

      {/* --- THREE SUB-MENUS TABS BAR --- */}
      <View style={styles.tabBar}>
        <Pressable
          testID="tab-tenders"
          style={[styles.tabItem, activeMenu === 'tenders' && styles.tabItemActive]}
          onPress={() => setActiveMenu('tenders')}
        >
          <Ionicons
            name="document-text"
            size={18}
            color={activeMenu === 'tenders' ? colors.brandPrimary : colors.muted}
          />
          <Text style={[styles.tabLabel, activeMenu === 'tenders' && styles.tabLabelActive]}>
            1. Tenders
          </Text>
          {tenders && (
            <View style={[styles.tabBadge, activeMenu === 'tenders' && styles.tabBadgeActive]}>
              <Text style={[styles.tabBadgeText, activeMenu === 'tenders' && styles.tabBadgeTextActive]}>
                {tenders.length}
              </Text>
            </View>
          )}
        </Pressable>

        <Pressable
          testID="tab-contractors"
          style={[styles.tabItem, activeMenu === 'contractors' && styles.tabItemActive]}
          onPress={() => setActiveMenu('contractors')}
        >
          <Ionicons
            name="people"
            size={18}
            color={activeMenu === 'contractors' ? colors.brandPrimary : colors.muted}
          />
          <Text style={[styles.tabLabel, activeMenu === 'contractors' && styles.tabLabelActive]}>
            2. Contractor
          </Text>
          {contractors && (
            <View style={[styles.tabBadge, activeMenu === 'contractors' && styles.tabBadgeActive]}>
              <Text style={[styles.tabBadgeText, activeMenu === 'contractors' && styles.tabBadgeTextActive]}>
                {contractors.length}
              </Text>
            </View>
          )}
        </Pressable>

        <Pressable
          testID="tab-manage"
          style={[styles.tabItem, activeMenu === 'manage' && styles.tabItemActive]}
          onPress={() => setActiveMenu('manage')}
        >
          <Ionicons
            name="git-compare"
            size={18}
            color={activeMenu === 'manage' ? colors.brandPrimary : colors.muted}
          />
          <Text style={[styles.tabLabel, activeMenu === 'manage' && styles.tabLabelActive]}>
            3. Manage
          </Text>
        </Pressable>

        <Pressable
          testID="tab-calling"
          style={[styles.tabItem, activeMenu === 'calling' && styles.tabItemActive]}
          onPress={() => setActiveMenu('calling')}
        >
          <Ionicons
            name="call"
            size={18}
            color={activeMenu === 'calling' ? colors.brandPrimary : colors.muted}
          />
          <Text style={[styles.tabLabel, activeMenu === 'calling' && styles.tabLabelActive]}>
            4. Tender Calling
          </Text>
        </Pressable>
      </View>

      {/* ========================================================================= */}
      {/* 1. SUB-MENU: TENDERS                                                      */}
      {/* ========================================================================= */}
      {activeMenu === 'tenders' && (
        <View style={{ flex: 1 }}>
          {/* VALUE CATEGORY CHIPS BAR (Sorted by computer in 4 Value categories) */}
          <View style={styles.valueFilterBar}>
            <Text style={styles.valueFilterTitle}>Category by Value:</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {VALUE_CATEGORIES.map(vc => {
                const active = valFilter === vc.id;
                return (
                  <Pressable
                    key={vc.id}
                    onPress={() => setValFilter(vc.id)}
                    style={[styles.valueChip, active && { backgroundColor: vc.color, borderColor: vc.color }]}
                  >
                    <Text style={[styles.valueChipLabel, active && { color: '#fff', fontWeight: '800' }]}>
                      {vc.label}
                    </Text>
                    <Text style={[styles.valueChipRange, active && { color: '#ffffffdd' }]}>
                      {vc.range}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>

          {/* SEARCH & DEPARTMENT FILTER BAR */}
          <View style={styles.searchBarContainer}>
            <View style={styles.searchBox}>
              <Ionicons name="search" size={18} color={colors.muted} />
              <TextInput
                placeholder="Search Name of work, Tender ID, Ref No, Dept…"
                value={tenderSearch}
                onChangeText={setTenderSearch}
                style={styles.searchInput}
                placeholderTextColor={colors.muted}
              />
              {tenderSearch.length > 0 && (
                <Pressable onPress={() => setTenderSearch('')}>
                  <Ionicons name="close-circle" size={18} color={colors.muted} />
                </Pressable>
              )}
            </View>

            {/* Department Quick Filter */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, marginTop: 8 }}>
              <Pressable
                onPress={() => setDeptFilter('all')}
                style={[styles.deptChip, deptFilter === 'all' && styles.deptChipActive]}
              >
                <Text style={[styles.deptChipText, deptFilter === 'all' && styles.deptChipTextActive]}>All Depts</Text>
              </Pressable>
              {['RWD', 'PWD', 'CPWD', 'Building', 'PHED', 'WRD'].map(d => (
                <Pressable
                  key={d}
                  onPress={() => setDeptFilter(deptFilter === d ? 'all' : d)}
                  style={[styles.deptChip, deptFilter === d && styles.deptChipActive]}
                >
                  <Text style={[styles.deptChipText, deptFilter === d && styles.deptChipTextActive]}>{d}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>

          {/* TENDERS LIST */}
          {filteredTenders === null ? (
            <ScreenLoader />
          ) : filteredTenders.length === 0 ? (
            <EmptyState
              icon="document-text-outline"
              title="No tenders found"
              subtitle="No tenders match the selected value category or filters. Click below to add or collect from web pages."
              actionLabel="Collect from Web Sources"
              onAction={() => { loadSources(); setSourcesModalVisible(true); }}
            />
          ) : (
            <FlatList
              data={filteredTenders}
              keyExtractor={item => item.id}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
              contentContainerStyle={{ padding: spacing.md, gap: spacing.md, paddingBottom: 100 }}
              renderItem={({ item }) => {
                const tl = item.time_left || {};
                const urgency = tl.urgency || 'none';
                const isUrgent = urgency === 'critical';
                const isWarning = urgency === 'warning';
                const isExpired = tl.is_expired;

                return (
                  <Card style={styles.tenderCard}>
                    {/* Top Row: IDs & Status */}
                    <View style={styles.cardHeader}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap', flex: 1 }}>
                        <View style={styles.tenderIdBadge}>
                          <Text style={styles.tenderIdText}>{item.tender_id || item.tender_code}</Text>
                        </View>
                        {item.reference_no && (
                          <View style={styles.refBadge}>
                            <Text style={styles.refText}>Ref: {item.reference_no}</Text>
                          </View>
                        )}
                        {item.source_name && (
                          <View style={styles.sourceTag}>
                            <Ionicons name="link" size={11} color={colors.muted} />
                            <Text style={styles.sourceText} numberOfLines={1}>{item.source_name}</Text>
                          </View>
                        )}
                      </View>
                      <StatusBadge status={item.status || 'open'} />
                    </View>

                    {/* Work Title */}
                    <Text style={styles.workTitle}>{item.name_of_work || item.title}</Text>

                    {/* Department */}
                    <View style={styles.deptRow}>
                      <Ionicons name="business" size={14} color={colors.brandPrimary} />
                      <Text style={styles.deptText}>{item.department || 'Government Works'}</Text>
                    </View>

                    {/* Cost & Value Category */}
                    <View style={styles.costRow}>
                      <View>
                        <Text style={styles.costLabel}>Estimated Cost</Text>
                        <Text style={styles.costValue}>
                          ₹ {Number(item.estimated_cost || item.value || 0).toLocaleString('en-IN')}
                        </Text>
                      </View>
                      <View style={[styles.valCatBadge, { backgroundColor: getCategoryColor(item.value_category) + '18', borderColor: getCategoryColor(item.value_category) }]}>
                        <Text style={[styles.valCatText, { color: getCategoryColor(item.value_category) }]}>
                          {item.value_category_label || item.value_category}
                        </Text>
                      </View>
                    </View>

                    {/* Description preview */}
                    {item.tender_description ? (
                      <Text style={styles.descText} numberOfLines={2}>{item.tender_description}</Text>
                    ) : null}

                    {/* Dates & Dynamic Live Countdown Timer (DD:HH:MM) */}
                    <View style={styles.datesContainer}>
                      <View style={styles.dateBlock}>
                        <Text style={styles.dateLabel}>Start Date</Text>
                        <Text style={styles.dateValue}>{item.date_of_start || 'N/A'}</Text>
                      </View>
                      <View style={styles.dateBlock}>
                        <Text style={styles.dateLabel}>End Date (Due)</Text>
                        <Text style={styles.dateValue}>{item.end_date || item.last_date || 'N/A'}</Text>
                      </View>
                    </View>

                    {/* Live Time Left Badge */}
                    <View style={[
                      styles.countdownBanner,
                      isUrgent && styles.countdownUrgent,
                      isWarning && styles.countdownWarning,
                      isExpired && styles.countdownExpired,
                    ]}>
                      <Ionicons
                        name={isExpired ? "alert-circle" : isUrgent ? "flame" : "hourglass-outline"}
                        size={16}
                        color={isExpired ? colors.muted : isUrgent ? '#b91c1c' : isWarning ? '#b45309' : '#047857'}
                      />
                      <Text style={[
                        styles.countdownText,
                        isUrgent && { color: '#b91c1c', fontWeight: '800' },
                        isWarning && { color: '#b45309', fontWeight: '800' },
                        isExpired && { color: colors.muted },
                      ]}>
                        Time Left: {item.time_left_formatted || '00d:00h:00m'}
                      </Text>
                    </View>

                    {/* Card Actions */}
                    <View style={styles.cardActionsRow}>
                      <Pressable
                        style={styles.actionBtnSecondary}
                        onPress={() => router.push(`/tenders/${item.id}` as any)}
                      >
                        <Ionicons name="document-attach-outline" size={16} color={colors.brandPrimary} />
                        <Text style={styles.actionBtnSecondaryText}>Details & Docs</Text>
                      </Pressable>

                      <Pressable
                        style={styles.actionBtnPrimary}
                        onPress={() => openTenderMatchModal(item)}
                      >
                        <Ionicons name="people" size={16} color="#fff" />
                        <Text style={styles.actionBtnPrimaryText}>Match Contractors</Text>
                      </Pressable>
                    </View>
                  </Card>
                );
              }}
            />
          )}
        </View>
      )}

      {/* ========================================================================= */}
      {/* 2. SUB-MENU: CONTRACTOR                                                  */}
      {/* ========================================================================= */}
      {activeMenu === 'contractors' && (
        <View style={{ flex: 1 }}>
          {/* Top Action Bar */}
          <View style={styles.contractorHeaderBar}>
            <View style={{ flex: 1 }}>
              <Text style={styles.sectionHeaderTitle}>Contractor Database</Text>
              <Text style={styles.sectionHeaderSubtitle}>Auto-populated from Customers database</Text>
            </View>

            <Pressable
              testID="sync-customers-btn"
              style={[styles.syncBtn, syncingCustomers && { opacity: 0.6 }]}
              onPress={handleSyncCustomers}
              disabled={syncingCustomers}
            >
              {syncingCustomers ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Ionicons name="sync" size={16} color="#fff" />
                  <Text style={styles.syncBtnText}>Auto-Populate</Text>
                </>
              )}
            </Pressable>
          </View>

          {/* Contractor Search */}
          <View style={{ paddingHorizontal: spacing.md, paddingBottom: spacing.sm }}>
            <View style={styles.searchBox}>
              <Ionicons name="search" size={18} color={colors.muted} />
              <TextInput
                placeholder="Search contractor name, mobile, registration class, depts…"
                value={contractorSearch}
                onChangeText={setContractorSearch}
                style={styles.searchInput}
                placeholderTextColor={colors.muted}
              />
              {contractorSearch.length > 0 && (
                <Pressable onPress={() => setContractorSearch('')}>
                  <Ionicons name="close-circle" size={18} color={colors.muted} />
                </Pressable>
              )}
            </View>
          </View>

          {/* Contractors List */}
          {filteredContractors === null ? (
            <ScreenLoader />
          ) : filteredContractors.length === 0 ? (
            <EmptyState
              icon="people-outline"
              title="No contractors in database"
              subtitle="Click 'Auto-Populate' to automatically import registered contractors from the Customer database."
              actionLabel="Auto-Populate from Customers"
              onAction={handleSyncCustomers}
            />
          ) : (
            <FlatList
              data={filteredContractors}
              keyExtractor={item => item.id}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
              contentContainerStyle={{ padding: spacing.md, gap: spacing.md, paddingBottom: 100 }}
              renderItem={({ item }) => (
                <Card style={styles.contractorCard}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <View style={{ flex: 1, paddingRight: 8 }}>
                      <Text style={styles.contractorName}>{item.name}</Text>
                      {item.contractor_reg_no ? (
                        <Text style={styles.regNoText}>Reg No: {item.contractor_reg_no}</Text>
                      ) : null}
                    </View>
                    <View style={styles.classBadge}>
                      <Ionicons name="ribbon" size={13} color="#fff" />
                      <Text style={styles.classBadgeText}>{item.registration_class || 'Class II'}</Text>
                    </View>
                  </View>

                  {/* Mobile & Direct Communication */}
                  <View style={styles.commRow}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Ionicons name="call" size={15} color={colors.success} />
                      <Text style={styles.mobileText}>{item.mobile}</Text>
                    </View>

                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <Pressable
                        style={styles.commIconBtn}
                        onPress={() => Linking.openURL(`tel:${item.mobile}`)}
                      >
                        <Ionicons name="call" size={15} color={colors.brandPrimary} />
                      </Pressable>
                      <Pressable
                        style={[styles.commIconBtn, { backgroundColor: '#25D36622' }]}
                        onPress={() => sendWhatsAppAlert(item.mobile, `Namaste ${item.name} ji, from Triveni DSC & e-Tender Services.`)}
                      >
                        <Ionicons name="logo-whatsapp" size={16} color="#25D366" />
                      </Pressable>
                    </View>
                  </View>

                  {/* Departments */}
                  <View style={{ marginTop: 8 }}>
                    <Text style={styles.fieldHeaderLabel}>Departments Registered:</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                      {(item.departments || []).map((dept: string, i: number) => (
                        <View key={i} style={styles.contractorDeptChip}>
                          <Text style={styles.contractorDeptText}>{dept}</Text>
                        </View>
                      ))}
                    </View>
                  </View>

                  {/* Edit / Delete footer */}
                  <View style={styles.contractorFooter}>
                    <Text style={styles.validityText}>Validity: {item.validity || 'Active'}</Text>
                    <View style={{ flexDirection: 'row', gap: 12 }}>
                      <Pressable onPress={() => openEditContractor(item)}>
                        <Text style={styles.linkActionText}>Edit</Text>
                      </Pressable>
                      <Pressable onPress={() => handleDeleteContractor(item)}>
                        <Text style={[styles.linkActionText, { color: colors.error }]}>Delete</Text>
                      </Pressable>
                    </View>
                  </View>
                </Card>
              )}
            />
          )}
        </View>
      )}

      {/* ========================================================================= */}
      {/* 3. SUB-MENU: MANAGE TENDER & CONTRACTOR (Mapping & Subscriptions)        */}
      {/* ========================================================================= */}
      {activeMenu === 'manage' && (
        <ScrollView contentContainerStyle={{ padding: spacing.md, gap: spacing.lg, paddingBottom: 100 }}>
          {/* SECTION 1: VALUE <-> CLASS MAPPING MATRIX */}
          <Card>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sectionHeaderTitle}>Value of Tender & Contractor Class Mapping</Text>
                <Text style={styles.sectionHeaderSubtitle}>
                  Admin can configure allowed registration class for each tender value tier
                </Text>
              </View>
              <Pressable
                style={[styles.saveMatrixBtn, savingMapping && { opacity: 0.6 }]}
                onPress={saveMappingRules}
                disabled={savingMapping}
              >
                {savingMapping ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <Ionicons name="checkmark-done" size={16} color="#fff" />
                    <Text style={styles.saveMatrixBtnText}>Save Rules</Text>
                  </>
                )}
              </Pressable>
            </View>

            {VALUE_CATEGORIES.filter(vc => vc.id !== 'all').map(vc => {
              const currentClasses = mappingMatrix[vc.id] || [];
              return (
                <View key={vc.id} style={styles.matrixRow}>
                  <View style={styles.matrixTierHeader}>
                    <View style={[styles.matrixTierBadge, { backgroundColor: vc.color }]}>
                      <Text style={styles.matrixTierBadgeText}>{vc.label}</Text>
                    </View>
                    <Text style={styles.matrixTierRange}>{vc.range}</Text>
                  </View>

                  <Text style={styles.matrixInstructions}>Allowed Contractor Classes:</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                    {STANDARD_CLASSES.map(cls => {
                      const selected = currentClasses.includes(cls);
                      return (
                        <Pressable
                          key={cls}
                          style={[styles.classToggleChip, selected && styles.classToggleChipActive]}
                          onPress={() => toggleMapping(vc.id, cls)}
                        >
                          <Ionicons
                            name={selected ? "checkbox" : "square-outline"}
                            size={14}
                            color={selected ? colors.brandPrimary : colors.muted}
                          />
                          <Text style={[styles.classToggleChipText, selected && styles.classToggleChipTextActive]}>
                            {cls}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              );
            })}
          </Card>

          {/* SECTION 2: CONTRACTOR SUBSCRIPTIONS */}
          <Card>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sectionHeaderTitle}>Contractor Subscriptions</Text>
                <Text style={styles.sectionHeaderSubtitle}>
                  Manage departments and value tiers allowed for contractor alerts
                </Text>
              </View>

              <Pressable
                style={styles.addSubscriptionBtn}
                onPress={() => {
                  if (contractors && contractors.length > 0) {
                    setSubForm({
                      contractor_id: contractors[0].id,
                      subscribed_departments: ['RWD', 'PWD'],
                      subscribed_value_categories: ['0_to_25_lacs', '25_to_70_lacs', '70_to_3_5_cr'],
                      alert_channels: ['whatsapp', 'sms'],
                      status: 'active',
                      valid_until: '2027-12-31',
                      notes: 'Tender alert subscription',
                    });
                    setSubModalVisible(true);
                  } else {
                    Alert.alert('Notice', 'Please populate contractors first.');
                  }
                }}
              >
                <Ionicons name="add" size={16} color="#fff" />
                <Text style={styles.addSubscriptionBtnText}>Add Sub</Text>
              </Pressable>
            </View>

            {subscriptions === null ? (
              <ActivityIndicator size="small" color={colors.brandPrimary} />
            ) : subscriptions.length === 0 ? (
              <Text style={styles.mutedText}>No active subscriptions found.</Text>
            ) : (
              subscriptions.map(sub => (
                <View key={sub.id} style={styles.subscriptionItem}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.subContractorName}>{sub.contractor_name}</Text>
                      <Text style={styles.subContractorMobile}>📱 {sub.contractor_mobile} • Class: {sub.contractor_class}</Text>
                    </View>
                    <View style={[styles.subStatusBadge, { backgroundColor: sub.status === 'active' ? '#10b98122' : '#f59e0b22' }]}>
                      <Text style={[styles.subStatusText, { color: sub.status === 'active' ? '#059669' : '#d97706' }]}>
                        {sub.status.toUpperCase()}
                      </Text>
                    </View>
                  </View>

                  <View style={{ marginTop: 6 }}>
                    <Text style={styles.fieldHeaderLabel}>Subscribed Departments:</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 2 }}>
                      {(sub.subscribed_departments || []).map((d: string, i: number) => (
                        <View key={i} style={styles.subDeptTag}>
                          <Text style={styles.subDeptTagText}>{d}</Text>
                        </View>
                      ))}
                    </View>
                  </View>

                  <View style={{ marginTop: 6 }}>
                    <Text style={styles.fieldHeaderLabel}>Subscribed Value Brackets:</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 2 }}>
                      {(sub.subscribed_value_categories || []).map((cat: string, i: number) => (
                        <View key={i} style={[styles.subDeptTag, { backgroundColor: getCategoryColor(cat) + '20' }]}>
                          <Text style={[styles.subDeptTagText, { color: getCategoryColor(cat) }]}>
                            {cat.replace(/_/g, ' ')}
                          </Text>
                        </View>
                      ))}
                    </View>
                  </View>
                </View>
              ))
            )}
          </Card>
        </ScrollView>
      )}

      {/* ========================================================================= */}
      {/* 4. SUB-MENU: TENDER CALLING & FOLLOW-UP                                    */}
      {/* ========================================================================= */}
      {activeMenu === 'calling' && (
        <TenderCallingView
          user={user}
          isAdminOrManager={isAdminOrManager}
          contractors={contractors}
          onNavigateToBilling={() => router.push('/accounting/invoices' as any)}
          onNavigateToTasks={() => router.push('/tasks' as any)}
        />
      )}

      {/* ========================================================================= */}
      {/* MODAL 1: OPEN WEB SOURCES & SCRAPER ATTACHMENT                           */}
      {/* ========================================================================= */}
      <Modal visible={sourcesModalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>Attached Web Pages & Collector</Text>
                <Text style={styles.modalSubtitle}>
                  Admin can attach open web page addresses to collect tenders
                </Text>
              </View>
              <Pressable onPress={() => setSourcesModalVisible(false)}>
                <Ionicons name="close" size={24} color={colors.onSurface} />
              </Pressable>
            </View>

            <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ gap: 12 }}>
              {/* Add New Source Section */}
              <View style={styles.addSourceBox}>
                <Text style={styles.addSourceBoxTitle}>+ Attach New Open Web Page URL</Text>
                <TextInput
                  placeholder="Portal Name (e.g. CPWD Patna, eProc2 Bihar)"
                  value={newSourceName}
                  onChangeText={setNewSourceName}
                  style={styles.modalInput}
                  placeholderTextColor={colors.muted}
                />
                <TextInput
                  placeholder="Web Page Address (e.g. https://eproc2.bihar.gov.in)"
                  value={newSourceUrl}
                  onChangeText={setNewSourceUrl}
                  style={styles.modalInput}
                  placeholderTextColor={colors.muted}
                  autoCapitalize="none"
                />
                <TextInput
                  placeholder="Department (e.g. Rural Works, Building, PHED)"
                  value={newSourceDept}
                  onChangeText={setNewSourceDept}
                  style={styles.modalInput}
                  placeholderTextColor={colors.muted}
                />
                <PrimaryButton
                  label={addingSource ? "Attaching…" : "Attach Open Web Page"}
                  onPress={handleAddSource}
                  loading={addingSource}
                />
              </View>

              {/* Existing Sources List */}
              <Text style={[styles.fieldHeaderLabel, { marginTop: 8 }]}>Configured Web Sources:</Text>
              {sourcesList.map(src => (
                <View key={src.id} style={styles.sourceCardItem}>
                  <View style={{ flex: 1, paddingRight: 8 }}>
                    <Text style={styles.sourceCardTitle}>{src.name}</Text>
                    <Text style={styles.sourceCardUrl} numberOfLines={1}>{src.url}</Text>
                    <Text style={styles.sourceCardDept}>Dept: {src.department} • Collected: {src.tenders_collected || 0}</Text>
                  </View>

                  <Pressable
                    style={[styles.collectBtn, collectingSourceId === src.id && { opacity: 0.6 }]}
                    onPress={() => handleCollectTenders(src.id)}
                    disabled={collectingSourceId !== null}
                  >
                    {collectingSourceId === src.id ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <>
                        <Ionicons name="download" size={14} color="#fff" />
                        <Text style={styles.collectBtnText}>Collect Tenders</Text>
                      </>
                    )}
                  </Pressable>
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ========================================================================= */}
      {/* MODAL 2: TENDER MATCHING CONTRACTORS (Auto-match Hub)                    */}
      {/* ========================================================================= */}
      <Modal visible={selectedTenderForMatch !== null} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>Matching Contractors</Text>
                <Text style={styles.modalSubtitle} numberOfLines={1}>
                  {selectedTenderForMatch?.name_of_work}
                </Text>
              </View>
              <Pressable onPress={() => setSelectedTenderForMatch(null)}>
                <Ionicons name="close" size={24} color={colors.onSurface} />
              </Pressable>
            </View>

            {loadingMatch ? (
              <ActivityIndicator size="large" color={colors.brandPrimary} style={{ marginVertical: 40 }} />
            ) : matchingContractors && matchingContractors.length === 0 ? (
              <EmptyState
                icon="people-outline"
                title="No matching contractors found"
                subtitle="Ensure contractors are registered with matching classes and departments in Sub-menu 2 & 3."
              />
            ) : (
              <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ gap: 10 }}>
                <View style={styles.tenderMatchSummaryBox}>
                  <Text style={styles.tenderMatchSummaryDept}>Dept: {selectedTenderForMatch?.department}</Text>
                  <Text style={styles.tenderMatchSummaryCost}>
                    ₹ {Number(selectedTenderForMatch?.estimated_cost || 0).toLocaleString('en-IN')} ({selectedTenderForMatch?.value_category_label})
                  </Text>
                </View>

                {matchingContractors?.map((con, idx) => (
                  <Card key={idx} style={styles.matchConCard}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.matchConName}>{con.contractor_name}</Text>
                        <Text style={styles.matchConClass}>Class: {con.registration_class} • 📱 {con.contractor_mobile}</Text>
                      </View>
                      <View style={styles.scoreBadge}>
                        <Text style={styles.scoreBadgeText}>{con.match_score}% Match</Text>
                      </View>
                    </View>

                    <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                      <Pressable
                        style={styles.whatsAppDispatchBtn}
                        onPress={() => sendWhatsAppAlert(con.contractor_mobile, con.whatsapp_alert_text)}
                      >
                        <Ionicons name="logo-whatsapp" size={16} color="#fff" />
                        <Text style={styles.whatsAppDispatchBtnText}>Send WhatsApp Notice</Text>
                      </Pressable>
                    </View>
                  </Card>
                ))}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* ========================================================================= */}
      {/* MODAL 3: ADD / EDIT CONTRACTOR MODAL                                     */}
      {/* ========================================================================= */}
      <Modal visible={contractorModalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{editingContractor ? 'Edit Contractor' : 'New Contractor'}</Text>
              <Pressable onPress={() => setContractorModalVisible(false)}>
                <Ionicons name="close" size={24} color={colors.onSurface} />
              </Pressable>
            </View>

            <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ gap: 12 }}>
              <TextInput
                placeholder="Name of Contractor / Firm *"
                value={conForm.name}
                onChangeText={t => setConForm(p => ({ ...p, name: t }))}
                style={styles.modalInput}
                placeholderTextColor={colors.muted}
              />
              <TextInput
                placeholder="Mobile Number *"
                value={conForm.mobile}
                onChangeText={t => setConForm(p => ({ ...p, mobile: t }))}
                keyboardType="phone-pad"
                style={styles.modalInput}
                placeholderTextColor={colors.muted}
              />
              <TextInput
                placeholder="Registration Class (e.g. Class I, Class II, Class III, Class IV)"
                value={conForm.registration_class}
                onChangeText={t => setConForm(p => ({ ...p, registration_class: t }))}
                style={styles.modalInput}
                placeholderTextColor={colors.muted}
              />
              <TextInput
                placeholder="Departments (comma separated e.g. RWD, PWD, Building)"
                value={conForm.departments.join(', ')}
                onChangeText={t => setConForm(p => ({ ...p, departments: t.split(',').map(x => x.trim()).filter(Boolean) }))}
                style={styles.modalInput}
                placeholderTextColor={colors.muted}
              />
              <TextInput
                placeholder="WhatsApp Number"
                value={conForm.whatsapp}
                onChangeText={t => setConForm(p => ({ ...p, whatsapp: t }))}
                keyboardType="phone-pad"
                style={styles.modalInput}
                placeholderTextColor={colors.muted}
              />
              <TextInput
                placeholder="Validity Date (YYYY-MM-DD)"
                value={conForm.validity}
                onChangeText={t => setConForm(p => ({ ...p, validity: t }))}
                style={styles.modalInput}
                placeholderTextColor={colors.muted}
              />

              <PrimaryButton
                label="Save Contractor"
                onPress={handleSaveContractor}
              />
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ========================================================================= */}
      {/* MODAL 4: ADD CONTRACTOR SUBSCRIPTION MODAL                                */}
      {/* ========================================================================= */}
      <Modal visible={subModalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Grant Contractor Subscription</Text>
              <Pressable onPress={() => setSubModalVisible(false)}>
                <Ionicons name="close" size={24} color={colors.onSurface} />
              </Pressable>
            </View>

            <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ gap: 12 }}>
              <Text style={styles.fieldHeaderLabel}>Select Contractor:</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                {(contractors || []).map(c => {
                  const sel = subForm.contractor_id === c.id;
                  return (
                    <Pressable
                      key={c.id}
                      style={[styles.contractorSelectChip, sel && styles.contractorSelectChipActive]}
                      onPress={() => setSubForm(p => ({ ...p, contractor_id: c.id }))}
                    >
                      <Text style={[styles.contractorSelectChipText, sel && { color: '#fff', fontWeight: '800' }]}>
                        {c.name}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>

              <Text style={styles.fieldHeaderLabel}>Subscribed Departments:</Text>
              <TextInput
                placeholder="Departments (comma separated)"
                value={subForm.subscribed_departments.join(', ')}
                onChangeText={t => setSubForm(p => ({ ...p, subscribed_departments: t.split(',').map(x => x.trim()).filter(Boolean) }))}
                style={styles.modalInput}
                placeholderTextColor={colors.muted}
              />

              <Text style={styles.fieldHeaderLabel}>Valid Until (YYYY-MM-DD):</Text>
              <TextInput
                placeholder="Valid Until"
                value={subForm.valid_until}
                onChangeText={t => setSubForm(p => ({ ...p, valid_until: t }))}
                style={styles.modalInput}
                placeholderTextColor={colors.muted}
              />

              <PrimaryButton
                label="Save Subscription"
                onPress={handleSaveSubscription}
              />
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function getCategoryColor(cat?: string): string {
  switch (cat) {
    case '0_to_25_lacs': return '#0ea5e9';
    case '25_to_70_lacs': return '#8b5cf6';
    case '70_to_3_5_cr': return '#f59e0b';
    case 'above_3_5_cr': return '#ef4444';
    default: return colors.brandPrimary;
  }
}

const styles = StyleSheet.create({
  headerBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.brandSecondary,
    alignItems: 'center', justifyContent: 'center',
  },
  addBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.brandPrimary,
    alignItems: 'center', justifyContent: 'center',
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: spacing.sm,
  },
  tabItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderBottomWidth: 3,
    borderBottomColor: 'transparent',
  },
  tabItemActive: {
    borderBottomColor: colors.brandPrimary,
  },
  tabLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.muted,
  },
  tabLabelActive: {
    color: colors.brandPrimary,
    fontWeight: '800',
  },
  tabBadge: {
    backgroundColor: colors.surfaceSecondary,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
  },
  tabBadgeActive: {
    backgroundColor: colors.brandPrimary + '20',
  },
  tabBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.muted,
  },
  tabBadgeTextActive: {
    color: colors.brandPrimary,
  },
  valueFilterBar: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: 4,
    backgroundColor: colors.surface,
  },
  valueFilterTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  valueChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  valueChipLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.onSurface,
  },
  valueChipRange: {
    fontSize: 10,
    color: colors.muted,
    marginTop: 1,
  },
  searchBarContainer: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    height: 40,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    color: colors.onSurface,
  },
  deptChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 14,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  deptChipActive: {
    backgroundColor: colors.brandPrimary + '15',
    borderColor: colors.brandPrimary,
  },
  deptChipText: {
    fontSize: 11,
    color: colors.muted,
    fontWeight: '600',
  },
  deptChipTextActive: {
    color: colors.brandPrimary,
    fontWeight: '800',
  },
  tenderCard: {
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: 8,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8,
  },
  tenderIdBadge: {
    backgroundColor: colors.brandPrimary + '15',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  tenderIdText: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.brandPrimary,
  },
  refBadge: {
    backgroundColor: colors.surfaceSecondary,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
  },
  refText: {
    fontSize: 11,
    color: colors.muted,
    fontWeight: '600',
  },
  sourceTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.surfaceSecondary,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
  },
  sourceText: {
    fontSize: 10,
    color: colors.muted,
    maxWidth: 120,
  },
  workTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.onSurface,
    lineHeight: 20,
  },
  deptRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  deptText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.brandPrimary,
  },
  costRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.surfaceSecondary + '70',
    padding: spacing.sm,
    borderRadius: radius.md,
  },
  costLabel: {
    fontSize: 10,
    color: colors.muted,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  costValue: {
    fontSize: 16,
    fontWeight: '900',
    color: colors.brandPrimary,
  },
  valCatBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
  },
  valCatText: {
    fontSize: 11,
    fontWeight: '800',
  },
  descText: {
    fontSize: 12,
    color: colors.muted,
    lineHeight: 16,
  },
  datesContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: colors.border + '50',
    paddingTop: 8,
  },
  dateBlock: {
    flex: 1,
  },
  dateLabel: {
    fontSize: 10,
    color: colors.muted,
    fontWeight: '600',
  },
  dateValue: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.onSurface,
    marginTop: 2,
  },
  countdownBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#ecfdf5',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#a7f3d0',
  },
  countdownUrgent: {
    backgroundColor: '#fef2f2',
    borderColor: '#fca5a5',
  },
  countdownWarning: {
    backgroundColor: '#fffbeb',
    borderColor: '#fde68a',
  },
  countdownExpired: {
    backgroundColor: '#f3f4f6',
    borderColor: '#e5e7eb',
  },
  countdownText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#047857',
  },
  cardActionsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  actionBtnSecondary: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 9,
    borderRadius: radius.md,
    backgroundColor: colors.brandPrimary + '15',
  },
  actionBtnSecondaryText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.brandPrimary,
  },
  actionBtnPrimary: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 9,
    borderRadius: radius.md,
    backgroundColor: colors.brandPrimary,
  },
  actionBtnPrimaryText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#fff',
  },

  // Contractor Tab Styles
  contractorHeaderBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.md,
    backgroundColor: colors.surface,
  },
  sectionHeaderTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.onSurface,
  },
  sectionHeaderSubtitle: {
    fontSize: 11,
    color: colors.muted,
    marginTop: 2,
  },
  syncBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.brandSecondary,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
  },
  syncBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#fff',
  },
  contractorCard: {
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: 6,
  },
  contractorName: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.onSurface,
  },
  regNoText: {
    fontSize: 11,
    color: colors.muted,
    marginTop: 2,
  },
  classBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.brandPrimary,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  classBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#fff',
  },
  commRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.surfaceSecondary + '50',
    padding: 8,
    borderRadius: 8,
    marginTop: 4,
  },
  mobileText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.onSurface,
  },
  commIconBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: colors.brandPrimary + '15',
    alignItems: 'center', justifyContent: 'center',
  },
  fieldHeaderLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.muted,
  },
  contractorDeptChip: {
    backgroundColor: colors.brandPrimary + '12',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  contractorDeptText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.brandPrimary,
  },
  contractorFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: colors.border + '50',
    paddingTop: 8,
    marginTop: 4,
  },
  validityText: {
    fontSize: 11,
    color: colors.muted,
  },
  linkActionText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.brandPrimary,
  },

  // Manage Tab Styles
  saveMatrixBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.success,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
  },
  saveMatrixBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#fff',
  },
  matrixRow: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border + '60',
    paddingVertical: 12,
    gap: 6,
  },
  matrixTierHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  matrixTierBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  matrixTierBadgeText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#fff',
  },
  matrixTierRange: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.muted,
  },
  matrixInstructions: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.muted,
    marginTop: 4,
  },
  classToggleChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  classToggleChipActive: {
    backgroundColor: colors.brandPrimary + '15',
    borderColor: colors.brandPrimary,
  },
  classToggleChipText: {
    fontSize: 11,
    color: colors.muted,
    fontWeight: '600',
  },
  classToggleChipTextActive: {
    color: colors.brandPrimary,
    fontWeight: '800',
  },
  addSubscriptionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.brandPrimary,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  addSubscriptionBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#fff',
  },
  subscriptionItem: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border + '50',
    paddingVertical: 10,
  },
  subContractorName: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.onSurface,
  },
  subContractorMobile: {
    fontSize: 11,
    color: colors.muted,
    marginTop: 2,
  },
  subStatusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  subStatusText: {
    fontSize: 10,
    fontWeight: '800',
  },
  subDeptTag: {
    backgroundColor: colors.surfaceSecondary,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  subDeptTagText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.onSurface,
  },
  mutedText: {
    fontSize: 12,
    color: colors.muted,
  },

  // Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: '#00000070',
    justifyContent: 'center',
    padding: spacing.md,
  },
  modalContent: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    maxHeight: '85%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.onSurface,
  },
  modalSubtitle: {
    fontSize: 11,
    color: colors.muted,
    marginTop: 2,
  },
  modalInput: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: 13,
    color: colors.onSurface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  addSourceBox: {
    backgroundColor: colors.brandPrimary + '08',
    padding: spacing.md,
    borderRadius: radius.md,
    gap: 8,
    borderWidth: 1,
    borderColor: colors.brandPrimary + '30',
  },
  addSourceBoxTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.brandPrimary,
  },
  sourceCardItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.surfaceSecondary,
    padding: spacing.md,
    borderRadius: radius.md,
  },
  sourceCardTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.onSurface,
  },
  sourceCardUrl: {
    fontSize: 11,
    color: colors.brandPrimary,
    marginTop: 2,
  },
  sourceCardDept: {
    fontSize: 10,
    color: colors.muted,
    marginTop: 2,
  },
  collectBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.brandSecondary,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 6,
  },
  collectBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#fff',
  },
  tenderMatchSummaryBox: {
    backgroundColor: colors.brandPrimary + '10',
    padding: spacing.sm,
    borderRadius: radius.md,
  },
  tenderMatchSummaryDept: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.brandPrimary,
  },
  tenderMatchSummaryCost: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.onSurface,
    marginTop: 2,
  },
  matchConCard: {
    borderRadius: radius.md,
    padding: spacing.md,
    borderLeftWidth: 4,
    borderLeftColor: colors.brandPrimary,
  },
  matchConName: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.onSurface,
  },
  matchConClass: {
    fontSize: 11,
    color: colors.muted,
    marginTop: 2,
  },
  scoreBadge: {
    backgroundColor: '#10b98125',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  scoreBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#059669',
  },
  whatsAppDispatchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#25D366',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 6,
  },
  whatsAppDispatchBtnText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#fff',
  },
  contractorSelectChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  contractorSelectChipActive: {
    backgroundColor: colors.brandPrimary,
    borderColor: colors.brandPrimary,
  },
  contractorSelectChipText: {
    fontSize: 11,
    color: colors.onSurface,
    fontWeight: '600',
  },
});
