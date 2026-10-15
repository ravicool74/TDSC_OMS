import React, { useEffect, useState, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, RefreshControl, Modal, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, font, shadow } from '@/src/theme';
import { api } from '@/src/api';
import { CustomerLayout } from '@/src/CustomerLayout';
import { Card, StatusBadge, ScreenLoader, PrimaryButton, SecondaryButton, EmptyState } from '@/src/ui';
import { notify } from '@/src/dialog';

type TenderTab = 'latest' | 'requested' | 'in_progress' | 'submitted';

export default function CustomerTendersScreen() {
  const [activeTab, setActiveTab] = useState<TenderTab>('latest');
  const [tenders, setTenders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');

  // Tender Request Modal
  const [selectedTender, setSelectedTender] = useState<any | null>(null);
  const [requestNotes, setRequestNotes] = useState('');
  const [requesting, setRequesting] = useState(false);

  // Detail Modal
  const [detailModal, setDetailModal] = useState<any | null>(null);

  const loadTenders = async () => {
    try {
      const data = await api.getCustomerTenders({ search: search.trim() });
      setTenders(Array.isArray(data) ? data : []);
    } catch (e: any) {
      notify(e?.message || 'Failed to fetch tenders');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadTenders();
  }, [search]);

  const onRefresh = () => {
    setRefreshing(true);
    loadTenders();
  };

  // Filter tenders based on tab
  const filteredTenders = useMemo(() => {
    return tenders.filter((t) => {
      const reqStatus = (t.customer_request_status || t.status || '').toLowerCase();
      if (activeTab === 'latest') return true;
      if (activeTab === 'requested') return reqStatus === 'requested' || t.customer_requested === true;
      if (activeTab === 'in_progress') return reqStatus === 'in_progress' || reqStatus === 'filling' || reqStatus === 'assigned';
      if (activeTab === 'submitted') return reqStatus === 'submitted' || reqStatus === 'completed' || reqStatus === 'awarded';
      return true;
    });
  }, [tenders, activeTab]);

  const handleRequestTender = async () => {
    if (!selectedTender) return;
    setRequesting(true);
    try {
      await api.requestTenderFilling(selectedTender.id || selectedTender._id, requestNotes);
      notify('Tender bid preparation request submitted successfully!');
      setSelectedTender(null);
      setRequestNotes('');
      loadTenders();
    } catch (e: any) {
      notify(e?.message || 'Failed to request tender preparation');
    } finally {
      setRequesting(false);
    }
  };

  const tabs: { key: TenderTab; label: string; count: number }[] = [
    { key: 'latest', label: '1. Latest Tender', count: tenders.length },
    {
      key: 'requested',
      label: '2. Tender Request',
      count: tenders.filter((t) => t.customer_requested || (t.customer_request_status || '').toLowerCase() === 'requested').length,
    },
    {
      key: 'in_progress',
      label: '3. Tender Filling in Progress',
      count: tenders.filter((t) => ['in_progress', 'filling', 'assigned'].includes((t.customer_request_status || '').toLowerCase())).length,
    },
    {
      key: 'submitted',
      label: '4. Submitted Tender',
      count: tenders.filter((t) => ['submitted', 'completed', 'awarded'].includes((t.customer_request_status || '').toLowerCase())).length,
    },
  ];

  if (loading) {
    return (
      <CustomerLayout activeTab="tenders">
        <ScreenLoader label="Loading tenders..." />
      </CustomerLayout>
    );
  }

  return (
    <CustomerLayout
      activeTab="tenders"
      title="My Tender Portal"
      subtitle="Track verified government tenders, bid preparation & filing progress"
    >
      <View style={styles.container}>
        {/* Search Bar */}
        <View style={styles.searchBarWrap}>
          <View style={styles.searchBox}>
            <Ionicons name="search" size={18} color={colors.muted} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search tenders by title, ref no, department..."
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

        {/* 4 Required Submenu Tabs */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabScroll} contentContainerStyle={styles.tabScrollContainer}>
          {tabs.map((tab) => {
            const isActive = activeTab === tab.key;
            return (
              <Pressable
                key={tab.key}
                style={[styles.tabButton, isActive && styles.tabButtonActive]}
                onPress={() => setActiveTab(tab.key)}
              >
                <Text style={[styles.tabButtonText, isActive && styles.tabButtonTextActive]}>
                  {tab.label}
                </Text>
                <View style={[styles.badgeCount, isActive && styles.badgeCountActive]}>
                  <Text style={[styles.badgeCountText, isActive && styles.badgeCountTextActive]}>
                    {tab.count}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* Tenders List */}
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          {filteredTenders.length === 0 ? (
            <EmptyState
              icon="document-text-outline"
              title="No tenders found"
              subtitle={
                activeTab === 'latest'
                  ? 'No published tenders matching your search query'
                  : `No tenders under "${tabs.find((t) => t.key === activeTab)?.label}"`
              }
            />
          ) : (
            filteredTenders.map((item) => {
              const tid = item.id || item._id;
              const hasRequested = item.customer_requested || item.customer_request_status;
              const deadlineDate = item.submission_deadline
                ? new Date(item.submission_deadline).toLocaleDateString('en-IN', {
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric',
                  })
                : null;

              return (
                <View key={tid} style={styles.tenderCard}>
                  <View style={styles.cardHeader}>
                    <View style={{ flex: 1 }}>
                      <View style={styles.refRow}>
                        <Text style={styles.refNo}>{item.tender_no || item.reference_no || 'TDR-REF'}</Text>
                        {item.customer_request_status ? (
                          <StatusBadge status={item.customer_request_status} />
                        ) : (
                          <View style={styles.publishedBadge}>
                            <Text style={styles.publishedBadgeText}>PUBLISHED</Text>
                          </View>
                        )}
                      </View>
                      <Text style={styles.tenderTitle}>{item.title || item.name || 'Tender Notice'}</Text>
                    </View>
                  </View>

                  <View style={styles.metaGrid}>
                    {item.department && (
                      <View style={styles.metaItem}>
                        <Text style={styles.metaLabel}>Department</Text>
                        <Text style={styles.metaValue}>{item.department}</Text>
                      </View>
                    )}
                    {item.estimated_cost && (
                      <View style={styles.metaItem}>
                        <Text style={styles.metaLabel}>Est. Value</Text>
                        <Text style={styles.metaValue}>₹{Number(item.estimated_cost).toLocaleString('en-IN')}</Text>
                      </View>
                    )}
                    {item.emd_amount && (
                      <View style={styles.metaItem}>
                        <Text style={styles.metaLabel}>EMD Amount</Text>
                        <Text style={styles.metaValue}>₹{Number(item.emd_amount).toLocaleString('en-IN')}</Text>
                      </View>
                    )}
                    {deadlineDate && (
                      <View style={styles.metaItem}>
                        <Text style={styles.metaLabel}>Submission Deadline</Text>
                        <Text style={[styles.metaValue, { color: '#DC2626' }]}>⏰ {deadlineDate}</Text>
                      </View>
                    )}
                  </View>

                  <View style={styles.cardActions}>
                    <Pressable style={styles.viewDetailBtn} onPress={() => setDetailModal(item)}>
                      <Ionicons name="eye-outline" size={16} color="#334155" />
                      <Text style={styles.viewDetailText}>View Details</Text>
                    </Pressable>

                    {!hasRequested ? (
                      <Pressable style={styles.requestBtn} onPress={() => setSelectedTender(item)}>
                        <Ionicons name="paper-plane" size={16} color="#FFFFFF" />
                        <Text style={styles.requestBtnText}>Request Bid Preparation</Text>
                      </Pressable>
                    ) : (
                      <View style={styles.requestedIndicator}>
                        <Ionicons name="checkmark-circle" size={16} color="#059669" />
                        <Text style={styles.requestedIndicatorText}>
                          {item.customer_request_status?.toUpperCase() || 'REQUESTED'}
                        </Text>
                      </View>
                    )}
                  </View>
                </View>
              );
            })
          )}
        </ScrollView>
      </View>

      {/* Tender Details Modal */}
      <Modal visible={!!detailModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle} numberOfLines={1}>
                {detailModal?.tender_no || 'Tender Details'}
              </Text>
              <Pressable onPress={() => setDetailModal(null)}>
                <Ionicons name="close" size={24} color={colors.muted} />
              </Pressable>
            </View>

            <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ gap: spacing.md }}>
              <Text style={{ fontSize: font.base + 1, fontWeight: '700', color: '#0F172A' }}>
                {detailModal?.title}
              </Text>
              <View style={styles.metaGrid}>
                <View style={styles.metaItem}>
                  <Text style={styles.metaLabel}>Department</Text>
                  <Text style={styles.metaValue}>{detailModal?.department || '---'}</Text>
                </View>
                <View style={styles.metaItem}>
                  <Text style={styles.metaLabel}>Tender / Ref No</Text>
                  <Text style={styles.metaValue}>{detailModal?.tender_no || '---'}</Text>
                </View>
                <View style={styles.metaItem}>
                  <Text style={styles.metaLabel}>Estimated Cost</Text>
                  <Text style={styles.metaValue}>₹{Number(detailModal?.estimated_cost || 0).toLocaleString('en-IN')}</Text>
                </View>
                <View style={styles.metaItem}>
                  <Text style={styles.metaLabel}>Submission Deadline</Text>
                  <Text style={[styles.metaValue, { color: '#DC2626' }]}>
                    {detailModal?.submission_deadline ? new Date(detailModal.submission_deadline).toLocaleDateString('en-IN') : '---'}
                  </Text>
                </View>
              </View>

              {detailModal?.description ? (
                <View style={{ gap: 4 }}>
                  <Text style={styles.metaLabel}>Description / Scope</Text>
                  <Text style={{ fontSize: font.sm, color: '#334155', lineHeight: 20 }}>
                    {detailModal.description}
                  </Text>
                </View>
              ) : null}
            </ScrollView>

            <View style={styles.modalActions}>
              <SecondaryButton title="Close" onPress={() => setDetailModal(null)} style={{ flex: 1 }} />
              {!detailModal?.customer_requested && (
                <PrimaryButton
                  title="Request Bid Preparation"
                  onPress={() => {
                    const t = detailModal;
                    setDetailModal(null);
                    setSelectedTender(t);
                  }}
                  style={{ flex: 1 }}
                />
              )}
            </View>
          </View>
        </View>
      </Modal>

      {/* Request Bid Preparation Modal */}
      <Modal visible={!!selectedTender} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Request Tender Preparation</Text>
              <Pressable onPress={() => setSelectedTender(null)}>
                <Ionicons name="close" size={24} color={colors.muted} />
              </Pressable>
            </View>

            <View style={{ gap: spacing.sm }}>
              <Text style={{ fontSize: font.sm, color: colors.muted }}>
                Request Triveni DSC technical team to evaluate and prepare your bid submission for:
              </Text>
              <View style={{ backgroundColor: '#F8FAFC', padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: '#E2E8F0' }}>
                <Text style={{ fontSize: font.sm, fontWeight: '700', color: '#0F172A' }}>
                  {selectedTender?.title}
                </Text>
                <Text style={{ fontSize: font.xs, color: colors.muted, marginTop: 4 }}>
                  Ref: {selectedTender?.tender_no} • {selectedTender?.department}
                </Text>
              </View>

              <Text style={[styles.metaLabel, { marginTop: spacing.sm }]}>Special Instructions / Remarks (Optional)</Text>
              <TextInput
                style={[styles.input, { height: 80, textAlignVertical: 'top' }]}
                placeholder="E.g. We have Class I license, prepare bid under Joint Venture or Sole Proprietor..."
                value={requestNotes}
                onChangeText={setRequestNotes}
                multiline
              />
            </View>

            <View style={styles.modalActions}>
              <SecondaryButton title="Cancel" onPress={() => setSelectedTender(null)} style={{ flex: 1 }} />
              <PrimaryButton
                title="Submit Request"
                onPress={handleRequestTender}
                loading={requesting}
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
  tabScroll: {
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    maxHeight: 52,
  },
  tabScrollContainer: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    paddingVertical: 8,
    gap: 8,
  },
  tabButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: '#F1F5F9',
  },
  tabButtonActive: {
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  tabButtonText: {
    fontSize: font.sm,
    fontWeight: '600',
    color: '#475569',
  },
  tabButtonTextActive: {
    color: colors.brandPrimary,
    fontWeight: '700',
  },
  badgeCount: {
    backgroundColor: '#E2E8F0',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: radius.pill,
  },
  badgeCountActive: {
    backgroundColor: colors.brandPrimary,
  },
  badgeCountText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#475569',
  },
  badgeCountTextActive: {
    color: '#FFFFFF',
  },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.lg, gap: spacing.md },
  tenderCard: {
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
  refRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  refNo: {
    fontSize: font.xs + 1,
    fontWeight: '800',
    color: colors.brandPrimary,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  publishedBadge: {
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  publishedBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#065F46',
  },
  tenderTitle: {
    fontSize: font.base + 1,
    fontWeight: '700',
    color: '#0F172A',
    lineHeight: 22,
  },
  metaGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    backgroundColor: '#F8FAFC',
    padding: spacing.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  metaItem: {
    flex: 1,
    minWidth: 140,
  },
  metaLabel: {
    fontSize: font.xs,
    color: colors.muted,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  metaValue: {
    fontSize: font.sm,
    fontWeight: '700',
    color: '#1E293B',
    marginTop: 2,
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
  viewDetailBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.md,
    backgroundColor: '#F1F5F9',
  },
  viewDetailText: {
    fontSize: font.xs + 1,
    fontWeight: '700',
    color: '#334155',
  },
  requestBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.md,
    backgroundColor: colors.brandPrimary,
  },
  requestBtnText: {
    fontSize: font.xs + 1,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  requestedIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.md,
    backgroundColor: '#ECFDF5',
  },
  requestedIndicatorText: {
    fontSize: font.xs + 1,
    fontWeight: '700',
    color: '#065F46',
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
    maxWidth: 520,
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
  input: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: font.base,
    color: '#0F172A',
  },
  modalActions: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
});
