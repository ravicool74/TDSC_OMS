import React, { useEffect, useState, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, RefreshControl, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { colors, spacing, radius, font, shadow } from '@/src/theme';
import { api } from '@/src/api';
import { CustomerLayout } from '@/src/CustomerLayout';
import { StatusBadge, ScreenLoader, PrimaryButton, EmptyState } from '@/src/ui';
import { notify } from '@/src/dialog';

const STATUS_TABS = [
  { key: 'all', label: 'All Requests' },
  { key: 'SUBMITTED', label: 'Submitted' },
  { key: 'IN_PROGRESS', label: 'In Progress' },
  { key: 'UNDER_REVIEW', label: 'Under Review' },
  { key: 'COMPLETED', label: 'Completed' },
];

export default function CustomerRequestsListScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeStatus, setActiveStatus] = useState<string>((params.status as string) || 'all');
  const [search, setSearch] = useState('');

  const loadRequests = async () => {
    try {
      const data = await api.getCustomerServiceRequests({
        status: activeStatus !== 'all' ? activeStatus : undefined,
        search: search.trim() || undefined,
      });
      setRequests(Array.isArray(data) ? data : []);
    } catch (e: any) {
      notify(e?.message || 'Failed to fetch service requests');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadRequests();
  }, [activeStatus, search]);

  const onRefresh = () => {
    setRefreshing(true);
    loadRequests();
  };

  if (loading) {
    return (
      <CustomerLayout activeTab="requests">
        <ScreenLoader label="Loading service requests..." />
      </CustomerLayout>
    );
  }

  return (
    <CustomerLayout
      activeTab="requests"
      title="My Service Requests"
      subtitle="Track your applications, workflow progress & downloaded completed certificates"
      rightAction={
        <PrimaryButton
          title="+ New Request"
          icon="add-circle"
          onPress={() => router.push('/customer/request-new' as any)}
          style={{ height: 40, paddingHorizontal: 16 }}
        />
      }
    >
      <View style={styles.container}>
        {/* Search Bar */}
        <View style={styles.searchBarWrap}>
          <View style={styles.searchBox}>
            <Ionicons name="search" size={18} color={colors.muted} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search by Request No (SR-...), service name..."
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

        {/* Status Filter Tabs */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.tabScroll}
          contentContainerStyle={styles.tabScrollContainer}
        >
          {STATUS_TABS.map((tab) => {
            const isActive = activeStatus === tab.key;
            return (
              <Pressable
                key={tab.key}
                style={[styles.tabButton, isActive && styles.tabButtonActive]}
                onPress={() => setActiveStatus(tab.key)}
              >
                <Text style={[styles.tabButtonText, isActive && styles.tabButtonTextActive]}>
                  {tab.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* Requests List */}
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          {requests.length === 0 ? (
            <EmptyState
              icon="clipboard-outline"
              title="No service requests found"
              subtitle={
                activeStatus !== 'all'
                  ? `No requests currently in "${activeStatus.replace(/_/g, ' ')}" status`
                  : 'You have not submitted any service requests yet.'
              }
              actionLabel="Apply for a Service"
              onAction={() => router.push('/customer/request-new' as any)}
            />
          ) : (
            requests.map((item) => {
              const reqId = item.id || item.request_no;
              const docCount = (item.documents || []).length;
              const completedCount = (item.completed_documents || []).length;
              const subDate = new Date(item.created_at).toLocaleDateString('en-IN', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              });

              return (
                <Pressable
                  key={reqId}
                  style={styles.card}
                  onPress={() => router.push(`/customer/requests/${reqId}` as any)}
                >
                  <View style={styles.cardHeader}>
                    <View style={{ flex: 1 }}>
                      <View style={styles.refRow}>
                        <Text style={styles.requestNo}>{item.request_no}</Text>
                        <StatusBadge status={item.status} />
                        {item.priority === 'urgent' && (
                          <View style={styles.urgentBadge}>
                            <Text style={styles.urgentBadgeText}>URGENT</Text>
                          </View>
                        )}
                      </View>
                      <Text style={styles.serviceName}>{item.service_name}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={20} color={colors.muted} />
                  </View>

                  <View style={styles.detailsGrid}>
                    <View style={styles.detailItem}>
                      <Text style={styles.detailLabel}>Submitted On</Text>
                      <Text style={styles.detailValue}>{subDate}</Text>
                    </View>

                    <View style={styles.detailItem}>
                      <Text style={styles.detailLabel}>Assigned Staff</Text>
                      <Text style={styles.detailValue}>
                        {item.assigned_to_name ? `👤 ${item.assigned_to_name}` : 'Awaiting Assignment'}
                      </Text>
                    </View>

                    <View style={styles.detailItem}>
                      <Text style={styles.detailLabel}>Documents</Text>
                      <Text style={styles.detailValue}>
                        📎 {docCount} Uploaded
                        {completedCount > 0 ? ` • 🏆 ${completedCount} Final Cert.` : ''}
                      </Text>
                    </View>
                  </View>

                  {item.customer_remarks ? (
                    <View style={styles.remarksBox}>
                      <Text style={styles.remarksLabel}>Latest Update / Staff Remarks:</Text>
                      <Text style={styles.remarksText}>{item.customer_remarks}</Text>
                    </View>
                  ) : null}

                  <View style={styles.cardFooter}>
                    <Text style={styles.cardFooterHint}>Click to view full workflow history & files</Text>
                    <Text style={styles.viewDetailLink}>Open Details →</Text>
                  </View>
                </Pressable>
              );
            })
          )}
        </ScrollView>
      </View>
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
  refRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
    flexWrap: 'wrap',
  },
  requestNo: {
    fontSize: font.sm,
    fontWeight: '800',
    color: colors.brandPrimary,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  urgentBadge: {
    backgroundColor: '#FEE2E2',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  urgentBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#DC2626',
  },
  serviceName: {
    fontSize: font.base + 2,
    fontWeight: '800',
    color: '#0F172A',
  },
  detailsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    backgroundColor: '#F8FAFC',
    padding: spacing.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  detailItem: {
    flex: 1,
    minWidth: 140,
  },
  detailLabel: {
    fontSize: font.xs,
    color: colors.muted,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  detailValue: {
    fontSize: font.xs + 1,
    fontWeight: '700',
    color: '#1E293B',
    marginTop: 2,
  },
  remarksBox: {
    backgroundColor: '#FEF9C3',
    borderWidth: 1,
    borderColor: '#FEF08A',
    borderRadius: radius.sm,
    padding: spacing.sm,
    gap: 2,
  },
  remarksLabel: {
    fontSize: font.xs - 1,
    fontWeight: '700',
    color: '#854D0E',
    textTransform: 'uppercase',
  },
  remarksText: {
    fontSize: font.xs + 1,
    color: '#713F12',
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  cardFooterHint: {
    fontSize: font.xs,
    color: colors.muted,
  },
  viewDetailLink: {
    fontSize: font.xs + 1,
    fontWeight: '700',
    color: colors.brandPrimary,
  },
});
