import React, { useEffect, useState, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, RefreshControl, Modal, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { colors, spacing, radius, font, shadow } from '@/src/theme';
import { api } from '@/src/api';
import { CustomerLayout } from '@/src/CustomerLayout';
import { Card, ScreenLoader, PrimaryButton, SecondaryButton, EmptyState } from '@/src/ui';
import { notify } from '@/src/dialog';

export default function CustomerServicesScreen() {
  const router = useRouter();
  const [services, setServices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [checklistService, setChecklistService] = useState<any | null>(null);

  const loadServices = async () => {
    try {
      const data = await api.getServiceCatalogue();
      setServices(Array.isArray(data) ? data : []);
    } catch (e: any) {
      notify(e?.message || 'Failed to fetch services catalogue');
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
    const set = new Set<string>();
    services.forEach((s) => {
      if (s.category) set.add(s.category);
    });
    return ['All', ...Array.from(set)];
  }, [services]);

  const filteredServices = useMemo(() => {
    return services.filter((s) => {
      const matchCat = selectedCategory === 'All' || s.category === selectedCategory;
      const q = search.trim().toLowerCase();
      const matchSearch =
        !q ||
        (s.name && s.name.toLowerCase().includes(q)) ||
        (s.description && s.description.toLowerCase().includes(q)) ||
        (s.code && s.code.toLowerCase().includes(q));
      return matchCat && matchSearch;
    });
  }, [services, selectedCategory, search]);

  if (loading) {
    return (
      <CustomerLayout activeTab="services">
        <ScreenLoader label="Loading service catalogue..." />
      </CustomerLayout>
    );
  }

  return (
    <CustomerLayout
      activeTab="services"
      title="Complete Service Catalogue"
      subtitle="Explore all 27 specialized government & corporate services with standard checklists"
      rightAction={
        <PrimaryButton
          title="+ Apply for Service"
          icon="add-circle"
          onPress={() => router.push('/customer/request-new' as any)}
          style={{ height: 40, paddingHorizontal: 16 }}
        />
      }
    >
      <View style={styles.container}>
        {/* Search Input */}
        <View style={styles.searchBarWrap}>
          <View style={styles.searchBox}>
            <Ionicons name="search" size={18} color={colors.muted} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search services (e.g. GST, eproc2, Digital Signature, ISO...)"
              value={search}
              onChangeText={setSearch}
            />
            {search ? (
              <Pressable onPress={() => setSearch('')}>
                <Ionicons name="close-circle" size={18} color={colors.muted} />
              </Pressable>
            ) : null}
          </View>
        </View>

        {/* Category Filter Chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.categoryScroll}
          contentContainerStyle={styles.categoryContainer}
        >
          {categories.map((cat) => {
            const isSel = selectedCategory === cat;
            return (
              <Pressable
                key={cat}
                style={[styles.categoryChip, isSel && styles.categoryChipActive]}
                onPress={() => setSelectedCategory(cat)}
              >
                <Text style={[styles.categoryChipText, isSel && styles.categoryChipTextActive]}>
                  {cat}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* Services List / Grid */}
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          {filteredServices.length === 0 ? (
            <EmptyState
              icon="construct-outline"
              title="No services found"
              subtitle="No service matches your search or category filter"
            />
          ) : (
            filteredServices.map((svc, index) => {
              const mandatoryDocs: string[] = svc.mandatory_docs || [];
              const optionalDocs: string[] = svc.optional_docs || [];
              const totalDocs = mandatoryDocs.length + optionalDocs.length;

              return (
                <View key={svc.id || svc.code || index} style={styles.serviceCard}>
                  <View style={styles.serviceHeaderRow}>
                    <View style={styles.serviceIndexBadge}>
                      <Text style={styles.serviceIndexText}>#{svc.display_order || index + 1}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.serviceCategoryBadge}>{svc.category || 'General Service'}</Text>
                      <Text style={styles.serviceTitle}>{svc.name}</Text>
                    </View>
                    <View style={styles.rateBadge}>
                      <Text style={styles.rateLabel}>Service Fee</Text>
                      <Text style={styles.rateValue}>
                        {svc.rate > 0 ? `₹${Number(svc.rate).toLocaleString('en-IN')}` : 'As Applicable'}
                      </Text>
                    </View>
                  </View>

                  {svc.description ? (
                    <Text style={styles.serviceDesc} numberOfLines={2}>
                      {svc.description}
                    </Text>
                  ) : null}

                  {/* Document Requirements Preview */}
                  <View style={styles.docReqPreview}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Ionicons name="document-attach-outline" size={16} color={colors.muted} />
                      <Text style={styles.docReqTitle}>
                        Required Documents ({mandatoryDocs.length} Mandatory
                        {optionalDocs.length > 0 ? `, ${optionalDocs.length} Optional` : ''})
                      </Text>
                    </View>
                    <Pressable onPress={() => setChecklistService(svc)}>
                      <Text style={styles.viewChecklistText}>View Full Checklist →</Text>
                    </Pressable>
                  </View>

                  <View style={styles.docChipsRow}>
                    {mandatoryDocs.slice(0, 3).map((doc, dIdx) => (
                      <View key={dIdx} style={styles.docChipMandatory}>
                        <Text style={styles.docChipMandatoryText} numberOfLines={1}>
                          * {doc}
                        </Text>
                      </View>
                    ))}
                    {mandatoryDocs.length > 3 && (
                      <View style={styles.docChipMore}>
                        <Text style={styles.docChipMoreText}>+{mandatoryDocs.length - 3} more</Text>
                      </View>
                    )}
                  </View>

                  {/* Actions */}
                  <View style={styles.cardActions}>
                    <Pressable
                      style={styles.checklistBtn}
                      onPress={() => setChecklistService(svc)}
                    >
                      <Ionicons name="list-outline" size={16} color="#334155" />
                      <Text style={styles.checklistBtnText}>Checklist</Text>
                    </Pressable>

                    <Pressable
                      style={styles.applyBtn}
                      onPress={() => router.push(`/customer/request-new?service_id=${svc.id || svc.code}` as any)}
                    >
                      <Ionicons name="flash-outline" size={16} color="#FFFFFF" />
                      <Text style={styles.applyBtnText}>Apply Now</Text>
                    </Pressable>
                  </View>
                </View>
              );
            })
          )}
        </ScrollView>
      </View>

      {/* Document Checklist Modal */}
      <Modal visible={!!checklistService} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalCategory}>{checklistService?.category}</Text>
                <Text style={styles.modalTitle}>{checklistService?.name}</Text>
              </View>
              <Pressable onPress={() => setChecklistService(null)}>
                <Ionicons name="close" size={24} color={colors.muted} />
              </Pressable>
            </View>

            <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ gap: spacing.md }}>
              {checklistService?.description ? (
                <Text style={{ fontSize: font.sm, color: colors.muted }}>
                  {checklistService.description}
                </Text>
              ) : null}

              {/* Mandatory Documents */}
              <View style={styles.modalSection}>
                <View style={styles.modalSectionHeader}>
                  <Ionicons name="alert-circle" size={18} color="#DC2626" />
                  <Text style={[styles.modalSectionTitle, { color: '#DC2626' }]}>
                    Mandatory Documents (Required for submission)
                  </Text>
                </View>
                {(checklistService?.mandatory_docs || []).length === 0 ? (
                  <Text style={styles.emptyDocText}>No mandatory documents required for this service.</Text>
                ) : (
                  (checklistService?.mandatory_docs || []).map((doc: string, idx: number) => (
                    <View key={idx} style={styles.docListItem}>
                      <Ionicons name="checkmark-circle" size={16} color="#DC2626" />
                      <Text style={styles.docListItemText}>{doc}</Text>
                    </View>
                  ))
                )}
              </View>

              {/* Optional Documents */}
              {(checklistService?.optional_docs || []).length > 0 && (
                <View style={styles.modalSection}>
                  <View style={styles.modalSectionHeader}>
                    <Ionicons name="information-circle" size={18} color="#3B82F6" />
                    <Text style={[styles.modalSectionTitle, { color: '#1D4ED8' }]}>
                      Optional Supporting Documents
                    </Text>
                  </View>
                  {(checklistService?.optional_docs || []).map((doc: string, idx: number) => (
                    <View key={idx} style={styles.docListItem}>
                      <Ionicons name="document-text-outline" size={16} color="#64748B" />
                      <Text style={styles.docListItemText}>{doc}</Text>
                    </View>
                  ))}
                </View>
              )}

              <View style={styles.specBox}>
                <Text style={styles.specText}>
                  📁 Allowed Formats: {(checklistService?.allowed_file_types || ['pdf', 'jpg', 'jpeg', 'png']).join(', ').toUpperCase()}
                </Text>
                <Text style={styles.specText}>
                  ⚖️ Max File Size: {checklistService?.max_file_size_mb || 10} MB per file
                </Text>
              </View>
            </ScrollView>

            <View style={styles.modalActions}>
              <SecondaryButton title="Close" onPress={() => setChecklistService(null)} style={{ flex: 1 }} />
              <PrimaryButton
                title="Apply for this Service"
                onPress={() => {
                  const s = checklistService;
                  setChecklistService(null);
                  router.push(`/customer/request-new?service_id=${s.id || s.code}` as any);
                }}
                style={{ flex: 1 }}
              />
            </View>
          </View>
        </View>
      </Modal>
    </CustomerLayout>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  searchBarWrap: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
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
  categoryScroll: {
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    maxHeight: 50,
  },
  categoryContainer: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    paddingVertical: 8,
    gap: 8,
  },
  categoryChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: '#F1F5F9',
  },
  categoryChipActive: {
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  categoryChipText: {
    fontSize: font.xs + 1,
    fontWeight: '600',
    color: '#475569',
  },
  categoryChipTextActive: {
    color: colors.brandPrimary,
    fontWeight: '700',
  },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.lg, gap: spacing.md },
  serviceCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
    ...shadow.card,
  },
  serviceHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  serviceIndexBadge: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.sm,
  },
  serviceIndexText: {
    fontSize: font.xs,
    fontWeight: '800',
    color: '#475569',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  serviceCategoryBadge: {
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
    color: colors.brandPrimary,
    letterSpacing: 0.5,
  },
  serviceTitle: {
    fontSize: font.base + 2,
    fontWeight: '800',
    color: '#0F172A',
    marginTop: 2,
  },
  rateBadge: {
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
  docReqPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  docReqTitle: {
    fontSize: font.xs,
    fontWeight: '600',
    color: '#334155',
  },
  viewChecklistText: {
    fontSize: font.xs,
    fontWeight: '700',
    color: colors.brandPrimary,
  },
  docChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  docChipMandatory: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.sm,
    maxWidth: 200,
  },
  docChipMandatoryText: {
    fontSize: font.xs - 1,
    fontWeight: '600',
    color: '#991B1B',
  },
  docChipMore: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.sm,
  },
  docChipMoreText: {
    fontSize: font.xs - 1,
    fontWeight: '600',
    color: colors.muted,
  },
  cardActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  checklistBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.md,
    backgroundColor: '#F1F5F9',
  },
  checklistBtnText: {
    fontSize: font.xs + 1,
    fontWeight: '700',
    color: '#334155',
  },
  applyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: radius.md,
    backgroundColor: colors.brandPrimary,
  },
  applyBtnText: {
    fontSize: font.xs + 1,
    fontWeight: '700',
    color: '#FFFFFF',
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
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalCategory: {
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
    color: colors.brandPrimary,
  },
  modalTitle: {
    fontSize: font.lg,
    fontWeight: '800',
    color: '#0F172A',
    marginTop: 2,
  },
  modalSection: {
    backgroundColor: '#F8FAFC',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: spacing.md,
    gap: 8,
  },
  modalSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  modalSectionTitle: {
    fontSize: font.xs + 1,
    fontWeight: '700',
  },
  docListItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  docListItemText: {
    fontSize: font.sm,
    color: '#1E293B',
    flex: 1,
  },
  emptyDocText: {
    fontSize: font.xs,
    color: colors.muted,
  },
  specBox: {
    backgroundColor: '#EFF6FF',
    padding: spacing.md,
    borderRadius: radius.md,
    gap: 4,
  },
  specText: {
    fontSize: font.xs,
    color: '#1E40AF',
    fontWeight: '600',
  },
  modalActions: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
});
