import React, { useEffect, useState, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, RefreshControl, Modal, Platform, Switch } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { colors, spacing, radius, font, shadow } from '@/src/theme';
import { api } from '@/src/api';
import { useAuth } from '@/src/AuthContext';
import { ScreenLoader, PrimaryButton, SecondaryButton, EmptyState } from '@/src/ui';
import { notify } from '@/src/dialog';

export default function AdminServicesManagementScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const isAdmin = user?.role === 'super_admin' || user?.role === 'admin';

  const [services, setServices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');

  // Edit / Create Modal State
  const [editModal, setEditModal] = useState(false);
  const [editingService, setEditingService] = useState<any | null>(null);

  // Form Fields
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [category, setCategory] = useState('General Services');
  const [rate, setRate] = useState('0');
  const [description, setDescription] = useState('');
  const [mandatoryDocsStr, setMandatoryDocsStr] = useState('');
  const [optionalDocsStr, setOptionalDocsStr] = useState('');
  const [maxSizeMb, setMaxSizeMb] = useState('10');
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const loadServices = async () => {
    try {
      const data = await api.getAdminServices();
      setServices(Array.isArray(data) ? data : []);
    } catch (e: any) {
      notify(e?.message || 'Failed to load services catalogue');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadServices();
  }, []);

  const onRefresh = () => {
    setRefreshing(true);
    loadServices();
  };

  const categories = useMemo(() => {
    const s = new Set<string>();
    services.forEach((item) => {
      if (item.category) s.add(item.category);
    });
    return ['All', ...Array.from(s)];
  }, [services]);

  const filteredServices = useMemo(() => {
    return services.filter((s) => {
      const matchCat = selectedCategory === 'All' || s.category === selectedCategory;
      const q = search.trim().toLowerCase();
      const matchQ =
        !q ||
        (s.name && s.name.toLowerCase().includes(q)) ||
        (s.code && s.code.toLowerCase().includes(q)) ||
        (s.category && s.category.toLowerCase().includes(q));
      return matchCat && matchQ;
    });
  }, [services, selectedCategory, search]);

  const openCreateModal = () => {
    setEditingService(null);
    setName('');
    setCode('');
    setCategory('General Services');
    setRate('0');
    setDescription('');
    setMandatoryDocsStr('');
    setOptionalDocsStr('');
    setMaxSizeMb('10');
    setIsActive(true);
    setFormError(null);
    setEditModal(true);
  };

  const openEditModal = (svc: any) => {
    setEditingService(svc);
    setName(svc.name || '');
    setCode(svc.code || '');
    setCategory(svc.category || 'General Services');
    setRate(String(svc.rate ?? 0));
    setDescription(svc.description || '');
    setMandatoryDocsStr((svc.mandatory_docs || []).join('\n'));
    setOptionalDocsStr((svc.optional_docs || []).join('\n'));
    setMaxSizeMb(String(svc.max_file_size_mb ?? 10));
    setIsActive(svc.status === 'active');
    setFormError(null);
    setEditModal(true);
  };

  const handleSave = async () => {
    if (!name.trim()) {
      setFormError('Service Name is required');
      return;
    }
    setFormError(null);
    setSaving(true);

    const mDocs = mandatoryDocsStr
      .split('\n')
      .map((d) => d.trim())
      .filter(Boolean);
    const oDocs = optionalDocsStr
      .split('\n')
      .map((d) => d.trim())
      .filter(Boolean);

    const payload = {
      name: name.trim(),
      code: code.trim() || undefined,
      category: category.trim() || 'General Services',
      rate: parseFloat(rate) || 0,
      description: description.trim() || undefined,
      mandatory_docs: mDocs,
      optional_docs: oDocs,
      max_file_size_mb: parseInt(maxSizeMb, 10) || 10,
      status: isActive ? 'active' : 'inactive',
    };

    try {
      if (editingService) {
        await api.updateAdminService(editingService.id || editingService._id, payload);
        notify('Service updated successfully!');
      } else {
        await api.createAdminService(payload);
        notify('New service created successfully!');
      }
      setEditModal(false);
      loadServices();
    } catch (e: any) {
      setFormError(e?.message || 'Failed to save service');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleStatus = async (svc: any) => {
    const newStatus = svc.status === 'active' ? 'inactive' : 'active';
    try {
      await api.updateAdminService(svc.id || svc._id, { status: newStatus });
      notify(`Service ${svc.name} is now ${newStatus}`);
      loadServices();
    } catch (e: any) {
      notify(e?.message || 'Status update failed');
    }
  };

  return (
    <SafeAreaView edges={['top']} style={styles.root}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={22} color={colors.onSurface} />
          </Pressable>
          <View>
            <Text style={styles.headerTitle}>Services Catalogue Management</Text>
            <Text style={styles.headerSubtitle}>
              Master 27 services • Rates, document checklists & portal availability
            </Text>
          </View>
        </View>

        <PrimaryButton
          title="+ Add Service"
          icon="add"
          onPress={openCreateModal}
          style={{ height: 40, paddingHorizontal: 14 }}
        />
      </View>

      {/* Filter and Search */}
      <View style={styles.filterSection}>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={18} color={colors.muted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search service name, code, category..."
            value={search}
            onChangeText={setSearch}
          />
          {search ? (
            <Pressable onPress={() => setSearch('')}>
              <Ionicons name="close-circle" size={18} color={colors.muted} />
            </Pressable>
          ) : null}
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.catScroll} contentContainerStyle={styles.catScrollContent}>
          {categories.map((c) => {
            const isSel = selectedCategory === c;
            return (
              <Pressable
                key={c}
                style={[styles.catChip, isSel && styles.catChipActive]}
                onPress={() => setSelectedCategory(c)}
              >
                <Text style={[styles.catChipText, isSel && styles.catChipTextActive]}>{c}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* Services List */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {loading ? (
          <ScreenLoader label="Loading service catalogue..." />
        ) : filteredServices.length === 0 ? (
          <EmptyState
            icon="construct-outline"
            title="No Services Found"
            subtitle="No service matches your search or filter."
            actionLabel="+ Add New Service"
            onAction={openCreateModal}
          />
        ) : (
          filteredServices.map((svc, index) => {
            const mCount = (svc.mandatory_docs || []).length;
            const oCount = (svc.optional_docs || []).length;
            const isLive = svc.status === 'active';

            return (
              <View key={svc.id || svc._id || index} style={styles.card}>
                <View style={styles.cardHeader}>
                  <View style={{ flex: 1 }}>
                    <View style={styles.badgeRow}>
                      <View style={styles.indexBadge}>
                        <Text style={styles.indexBadgeText}>#{svc.display_order || index + 1}</Text>
                      </View>
                      <Text style={styles.categoryBadge}>{svc.category || 'General'}</Text>
                      <View style={[styles.statusBadge, isLive ? styles.statusBadgeActive : styles.statusBadgeInactive]}>
                        <Text style={[styles.statusBadgeText, isLive ? styles.statusBadgeTextActive : styles.statusBadgeTextInactive]}>
                          {isLive ? 'ACTIVE' : 'INACTIVE'}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.serviceName}>{svc.name}</Text>
                  </View>

                  <View style={styles.rateWrap}>
                    <Text style={styles.rateLabel}>Default Fee</Text>
                    <Text style={styles.rateValue}>₹{Number(svc.rate || 0).toLocaleString('en-IN')}</Text>
                  </View>
                </View>

                {svc.description && (
                  <Text style={styles.serviceDesc} numberOfLines={2}>{svc.description}</Text>
                )}

                <View style={styles.docStatsRow}>
                  <Text style={styles.docStatText}>
                    📋 Mandatory Docs: <Text style={{ fontWeight: '800', color: '#DC2626' }}>{mCount}</Text>
                  </Text>
                  <Text style={styles.docStatText}>
                    📎 Optional Docs: <Text style={{ fontWeight: '800', color: '#3B82F6' }}>{oCount}</Text>
                  </Text>
                  <Text style={styles.docStatText}>
                    ⚖️ Max Size: <Text style={{ fontWeight: '800' }}>{svc.max_file_size_mb || 10} MB</Text>
                  </Text>
                </View>

                <View style={styles.actionsRow}>
                  <Pressable
                    style={styles.toggleBtn}
                    onPress={() => handleToggleStatus(svc)}
                  >
                    <Ionicons
                      name={isLive ? 'pause-circle-outline' : 'play-circle-outline'}
                      size={16}
                      color={isLive ? '#DC2626' : '#059669'}
                    />
                    <Text style={[styles.toggleBtnText, { color: isLive ? '#DC2626' : '#059669' }]}>
                      {isLive ? 'Deactivate' : 'Activate'}
                    </Text>
                  </Pressable>

                  <Pressable
                    style={styles.editBtn}
                    onPress={() => openEditModal(svc)}
                  >
                    <Ionicons name="create-outline" size={16} color={colors.brandPrimary} />
                    <Text style={styles.editBtnText}>Edit Configuration</Text>
                  </Pressable>
                </View>
              </View>
            );
          })
        )}
      </ScrollView>

      {/* Edit / Create Service Modal */}
      <Modal visible={editModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {editingService ? `Edit ${editingService.name}` : 'Create New Service'}
              </Text>
              <Pressable onPress={() => setEditModal(false)}>
                <Ionicons name="close" size={24} color={colors.muted} />
              </Pressable>
            </View>

            {formError && (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle" size={18} color="#DC2626" />
                <Text style={styles.errorText}>{formError}</Text>
              </View>
            )}

            <ScrollView style={{ maxHeight: 440 }} contentContainerStyle={{ gap: spacing.md }}>
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Service Name *</Text>
                <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="E.g. Digital Signature" />
              </View>

              <View style={styles.formRow}>
                <View style={[styles.inputGroup, { flex: 1 }]}>
                  <Text style={styles.inputLabel}>Category</Text>
                  <TextInput style={styles.input} value={category} onChangeText={setCategory} placeholder="E.g. Registrations" />
                </View>

                <View style={[styles.inputGroup, { flex: 1 }]}>
                  <Text style={styles.inputLabel}>Default Rate (₹)</Text>
                  <TextInput style={styles.input} value={rate} onChangeText={setRate} keyboardType="numeric" placeholder="0" />
                </View>
              </View>

              <View style={styles.formRow}>
                <View style={[styles.inputGroup, { flex: 1 }]}>
                  <Text style={styles.inputLabel}>Service Code (Optional)</Text>
                  <TextInput style={styles.input} value={code} onChangeText={setCode} placeholder="E.g. SRV-DSC" />
                </View>

                <View style={[styles.inputGroup, { flex: 1 }]}>
                  <Text style={styles.inputLabel}>Max File Size (MB)</Text>
                  <TextInput style={styles.input} value={maxSizeMb} onChangeText={setMaxSizeMb} keyboardType="numeric" placeholder="10" />
                </View>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Description / Guidelines</Text>
                <TextInput
                  style={[styles.input, { height: 60, textAlignVertical: 'top' }]}
                  value={description}
                  onChangeText={setDescription}
                  placeholder="Service overview and instructions for customer..."
                  multiline
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Mandatory Documents (One per line)</Text>
                <TextInput
                  style={[styles.input, { height: 80, textAlignVertical: 'top' }]}
                  value={mandatoryDocsStr}
                  onChangeText={setMandatoryDocsStr}
                  placeholder="Aadhaar Card&#10;PAN Card&#10;Passport Photo"
                  multiline
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Optional Documents (One per line)</Text>
                <TextInput
                  style={[styles.input, { height: 70, textAlignVertical: 'top' }]}
                  value={optionalDocsStr}
                  onChangeText={setOptionalDocsStr}
                  placeholder="Partnership Deed&#10;Electricity Bill"
                  multiline
                />
              </View>

              <View style={styles.switchRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.inputLabel}>Active in Customer Portal</Text>
                  <Text style={{ fontSize: font.xs, color: colors.muted }}>
                    If enabled, customers can view and apply for this service
                  </Text>
                </View>
                <Switch value={isActive} onValueChange={setIsActive} trackColor={{ true: colors.brandPrimary }} />
              </View>
            </ScrollView>

            <View style={styles.modalActions}>
              <SecondaryButton title="Cancel" onPress={() => setEditModal(false)} style={{ flex: 1 }} />
              <PrimaryButton
                title={saving ? 'Saving...' : 'Save Service'}
                onPress={handleSave}
                loading={saving}
                style={{ flex: 1 }}
              />
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F8FAFC' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    flex: 1,
  },
  backBtn: {
    padding: 6,
    borderRadius: radius.sm,
    backgroundColor: '#F1F5F9',
  },
  headerTitle: {
    fontSize: font.lg,
    fontWeight: '800',
    color: '#0F172A',
  },
  headerSubtitle: {
    fontSize: font.xs,
    color: colors.muted,
    marginTop: 2,
  },
  filterSection: {
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    gap: 8,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#F1F5F9',
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    height: 42,
  },
  searchInput: {
    flex: 1,
    fontSize: font.base,
    color: '#0F172A',
  },
  catScroll: {
    maxHeight: 44,
  },
  catScrollContent: {
    flexDirection: 'row',
    gap: 6,
    paddingVertical: 4,
  },
  catChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: '#F1F5F9',
  },
  catChipActive: {
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  catChipText: {
    fontSize: font.xs,
    fontWeight: '700',
    color: '#475569',
  },
  catChipTextActive: {
    color: colors.brandPrimary,
  },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.lg, gap: spacing.md },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
    ...shadow.card,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  indexBadge: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  indexBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#475569',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  categoryBadge: {
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
    color: colors.brandPrimary,
  },
  statusBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  statusBadgeActive: {
    backgroundColor: '#DCFCE7',
  },
  statusBadgeInactive: {
    backgroundColor: '#FEE2E2',
  },
  statusBadgeText: {
    fontSize: 9,
    fontWeight: '800',
  },
  statusBadgeTextActive: {
    color: '#065F46',
  },
  statusBadgeTextInactive: {
    color: '#991B1B',
  },
  serviceName: {
    fontSize: font.base + 2,
    fontWeight: '800',
    color: '#0F172A',
  },
  rateWrap: {
    alignItems: 'flex-end',
  },
  rateLabel: {
    fontSize: 10,
    color: colors.muted,
    textTransform: 'uppercase',
    fontWeight: '600',
  },
  rateValue: {
    fontSize: font.base,
    fontWeight: '800',
    color: '#059669',
    marginTop: 2,
  },
  serviceDesc: {
    fontSize: font.xs + 1,
    color: colors.muted,
    lineHeight: 18,
  },
  docStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    backgroundColor: '#F8FAFC',
    padding: spacing.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  docStatText: {
    fontSize: font.xs,
    color: '#475569',
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  toggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.md,
    backgroundColor: '#F8FAFC',
  },
  toggleBtnText: {
    fontSize: font.xs,
    fontWeight: '700',
  },
  editBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.md,
    backgroundColor: '#EFF6FF',
  },
  editBtnText: {
    fontSize: font.xs,
    fontWeight: '700',
    color: colors.brandPrimary,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  modalCard: {
    width: '100%',
    maxWidth: 540,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    gap: spacing.md,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalTitle: {
    fontSize: font.lg,
    fontWeight: '800',
    color: '#0F172A',
  },
  inputGroup: {
    gap: 6,
  },
  formRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  inputLabel: {
    fontSize: font.sm,
    fontWeight: '600',
    color: '#334155',
  },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: font.base,
    color: '#0F172A',
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  errorBox: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    padding: spacing.md,
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  errorText: {
    color: '#991B1B',
    fontSize: font.sm,
    fontWeight: '600',
  },
  modalActions: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
});
