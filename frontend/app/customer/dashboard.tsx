import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, RefreshControl, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { colors, spacing, radius, font, shadow } from '@/src/theme';
import { api } from '@/src/api';
import { useAuth } from '@/src/AuthContext';
import { CustomerLayout } from '@/src/CustomerLayout';
import { Card, StatusBadge, ScreenLoader, PrimaryButton } from '@/src/ui';

export default function CustomerDashboardScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [stats, setStats] = useState<any>(null);
  const [recentRequests, setRecentRequests] = useState<any[]>([]);
  const [recentTenders, setRecentTenders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [sData, rData, tData] = await Promise.all([
        api.getCustomerStats().catch(() => null),
        api.getCustomerServiceRequests({ limit: 5 }).catch(() => []),
        api.getCustomerTenders().catch(() => []),
      ]);
      setStats(sData);
      setRecentRequests(Array.isArray(rData) ? rData.slice(0, 5) : []);
      setRecentTenders(Array.isArray(tData) ? tData.slice(0, 3) : []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const onRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  if (loading) {
    return (
      <CustomerLayout activeTab="dashboard">
        <ScreenLoader label="Loading customer dashboard..." />
      </CustomerLayout>
    );
  }

  const mustChangePwd = user?.must_change_password;

  return (
    <CustomerLayout
      activeTab="dashboard"
      title="Customer Dashboard"
      subtitle={`Welcome back, ${user?.name || user?.agency_name || 'Customer'}`}
      rightAction={
        <PrimaryButton
          title="+ New Request"
          onPress={() => router.push('/customer/request-new' as any)}
          icon="add-circle"
          style={{ height: 40, paddingHorizontal: 16 }}
        />
      }
    >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Temporary Password Warning Banner */}
        {mustChangePwd && (
          <View style={styles.pwdWarningBox}>
            <View style={styles.pwdWarningLeft}>
              <Ionicons name="warning" size={24} color="#D97706" />
              <View style={{ flex: 1 }}>
                <Text style={styles.pwdWarningTitle}>Temporary Password Active</Text>
                <Text style={styles.pwdWarningDesc}>
                  You are currently logged in with a temporary password. For security, please update your password.
                </Text>
              </View>
            </View>
            <Pressable
              style={styles.pwdChangeBtn}
              onPress={() => router.push('/customer/profile?tab=password' as any)}
            >
              <Text style={styles.pwdChangeBtnText}>Change Password</Text>
            </Pressable>
          </View>
        )}

        {/* Overview Stats Cards */}
        <View style={styles.statsGrid}>
          <Pressable
            style={[styles.statCard, { borderLeftColor: '#3B82F6' }]}
            onPress={() => router.push('/customer/requests' as any)}
          >
            <View style={styles.statIconWrap}>
              <Ionicons name="clipboard" size={22} color="#3B82F6" />
            </View>
            <View>
              <Text style={styles.statCount}>{stats?.total_requests ?? 0}</Text>
              <Text style={styles.statLabel}>Total Service Requests</Text>
            </View>
          </Pressable>

          <Pressable
            style={[styles.statCard, { borderLeftColor: '#F59E0B' }]}
            onPress={() => router.push('/customer/requests?status=in_progress' as any)}
          >
            <View style={[styles.statIconWrap, { backgroundColor: '#FEF3C7' }]}>
              <Ionicons name="hourglass" size={22} color="#F59E0B" />
            </View>
            <View>
              <Text style={styles.statCount}>
                {(stats?.in_progress ?? 0) + (stats?.under_review ?? 0) + (stats?.assigned ?? 0)}
              </Text>
              <Text style={styles.statLabel}>In Progress / Review</Text>
            </View>
          </Pressable>

          <Pressable
            style={[styles.statCard, { borderLeftColor: '#10B981' }]}
            onPress={() => router.push('/customer/requests?status=completed' as any)}
          >
            <View style={[styles.statIconWrap, { backgroundColor: '#DCFCE7' }]}>
              <Ionicons name="checkmark-done" size={22} color="#10B981" />
            </View>
            <View>
              <Text style={styles.statCount}>{stats?.completed ?? 0}</Text>
              <Text style={styles.statLabel}>Completed Services</Text>
            </View>
          </Pressable>

          <Pressable
            style={[styles.statCard, { borderLeftColor: '#8B5CF6' }]}
            onPress={() => router.push('/customer/tenders' as any)}
          >
            <View style={[styles.statIconWrap, { backgroundColor: '#EDE9FE' }]}>
              <Ionicons name="document-text" size={22} color="#8B5CF6" />
            </View>
            <View>
              <Text style={styles.statCount}>{recentTenders.length}</Text>
              <Text style={styles.statLabel}>Published Tenders</Text>
            </View>
          </Pressable>
        </View>

        {/* Quick Menu Hub */}
        <Text style={styles.sectionHeader}>Customer Portal Hub</Text>
        <View style={styles.hubGrid}>
          <Pressable
            style={styles.hubCard}
            onPress={() => router.push('/customer/profile' as any)}
          >
            <View style={[styles.hubIconWrap, { backgroundColor: '#E0E7FF' }]}>
              <Ionicons name="person" size={24} color="#4338CA" />
            </View>
            <Text style={styles.hubTitle}>My Profile</Text>
            <Text style={styles.hubSubtitle}>
              Contractor details, registration numbers & password settings
            </Text>
          </Pressable>

          <Pressable
            style={styles.hubCard}
            onPress={() => router.push('/customer/tenders' as any)}
          >
            <View style={[styles.hubIconWrap, { backgroundColor: '#FEF3C7' }]}>
              <Ionicons name="documents" size={24} color="#D97706" />
            </View>
            <Text style={styles.hubTitle}>My Tender</Text>
            <Text style={styles.hubSubtitle}>
              Latest Tenders, Tender Requests, Filling in Progress & Submissions
            </Text>
          </Pressable>

          <Pressable
            style={styles.hubCard}
            onPress={() => router.push('/customer/services' as any)}
          >
            <View style={[styles.hubIconWrap, { backgroundColor: '#DCFCE7' }]}>
              <Ionicons name="construct" size={24} color="#059669" />
            </View>
            <Text style={styles.hubTitle}>Services Catalogue</Text>
            <Text style={styles.hubSubtitle}>
              Browse all 27 services, document checklists & instant applications
            </Text>
          </Pressable>

          <Pressable
            style={styles.hubCard}
            onPress={() => router.push('/customer/requests' as any)}
          >
            <View style={[styles.hubIconWrap, { backgroundColor: '#FCE7F3' }]}>
              <Ionicons name="time" size={24} color="#DB2777" />
            </View>
            <Text style={styles.hubTitle}>My Service Requests</Text>
            <Text style={styles.hubSubtitle}>
              Real-time workflow tracker, status timeline & certificates download
            </Text>
          </Pressable>
        </View>

        {/* Recent Service Requests Section */}
        <View style={styles.sectionCard}>
          <View style={styles.sectionTitleRow}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Ionicons name="clipboard" size={20} color={colors.brandPrimary} />
              <Text style={styles.sectionTitle}>Recent Service Requests</Text>
            </View>
            <Pressable onPress={() => router.push('/customer/requests' as any)}>
              <Text style={styles.viewAllText}>View All ({stats?.total_requests ?? 0}) →</Text>
            </Pressable>
          </View>

          {recentRequests.length === 0 ? (
            <View style={styles.emptyCard}>
              <Ionicons name="file-tray-outline" size={36} color={colors.muted} />
              <Text style={styles.emptyText}>No service requests placed yet.</Text>
              <Pressable
                style={styles.emptyActionBtn}
                onPress={() => router.push('/customer/request-new' as any)}
              >
                <Text style={styles.emptyActionText}>Apply for your first service</Text>
              </Pressable>
            </View>
          ) : (
            recentRequests.map((req) => (
              <Pressable
                key={req.id}
                style={styles.requestRow}
                onPress={() => router.push(`/customer/requests/${req.id}` as any)}
              >
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={styles.reqNo}>{req.request_no}</Text>
                    <StatusBadge status={req.status} />
                  </View>
                  <Text style={styles.reqService}>{req.service_name}</Text>
                  <Text style={styles.reqDate}>
                    Applied: {new Date(req.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                    {req.assigned_to_name ? ` • Assigned to: ${req.assigned_to_name}` : ''}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.muted} />
              </Pressable>
            ))
          )}
        </View>

        {/* Latest Published Tenders Section */}
        <View style={styles.sectionCard}>
          <View style={styles.sectionTitleRow}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Ionicons name="document-text" size={20} color="#D97706" />
              <Text style={styles.sectionTitle}>Latest Available Tenders</Text>
            </View>
            <Pressable onPress={() => router.push('/customer/tenders' as any)}>
              <Text style={styles.viewAllText}>Explore All Tenders →</Text>
            </Pressable>
          </View>

          {recentTenders.length === 0 ? (
            <View style={styles.emptyCard}>
              <Ionicons name="document-text-outline" size={36} color={colors.muted} />
              <Text style={styles.emptyText}>No published tenders available currently.</Text>
            </View>
          ) : (
            recentTenders.map((t) => (
              <Pressable
                key={t.id || t._id}
                style={styles.tenderRow}
                onPress={() => router.push('/customer/tenders' as any)}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.tenderTitle} numberOfLines={2}>
                    {t.title || t.name || 'Government Tender Notice'}
                  </Text>
                  <Text style={styles.tenderSub}>
                    {t.department ? `${t.department} • ` : ''}
                    {t.tender_no ? `Ref: ${t.tender_no}` : ''}
                  </Text>
                  {t.submission_deadline && (
                    <Text style={styles.tenderDeadline}>
                      ⏰ Deadline: {new Date(t.submission_deadline).toLocaleDateString('en-IN')}
                    </Text>
                  )}
                </View>
                <View style={styles.bidBtnWrap}>
                  <Text style={styles.bidBtnText}>Details</Text>
                </View>
              </Pressable>
            ))
          )}
        </View>
      </ScrollView>
    </CustomerLayout>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  pwdWarningBox: {
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FCD34D',
    borderRadius: radius.md,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  pwdWarningLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flex: 1,
    minWidth: 260,
  },
  pwdWarningTitle: {
    fontSize: font.base,
    fontWeight: '700',
    color: '#92400E',
  },
  pwdWarningDesc: {
    fontSize: font.xs,
    color: '#B45309',
    marginTop: 2,
  },
  pwdChangeBtn: {
    backgroundColor: '#F59E0B',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.md,
  },
  pwdChangeBtnText: {
    color: '#FFFFFF',
    fontSize: font.xs + 1,
    fontWeight: '700',
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  statCard: {
    flex: 1,
    minWidth: 160,
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    ...shadow.card,
  },
  statIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statCount: {
    fontSize: font.xxl,
    fontWeight: '800',
    color: '#0F172A',
  },
  statLabel: {
    fontSize: font.xs,
    color: colors.muted,
    fontWeight: '600',
    marginTop: 2,
  },
  sectionHeader: {
    fontSize: font.lg,
    fontWeight: '800',
    color: '#0F172A',
    marginTop: 4,
  },
  hubGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  hubCard: {
    flex: 1,
    minWidth: 220,
    backgroundColor: colors.surface,
    padding: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 8,
    ...shadow.card,
  },
  hubIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  hubTitle: {
    fontSize: font.base + 1,
    fontWeight: '700',
    color: '#0F172A',
  },
  hubSubtitle: {
    fontSize: font.xs,
    color: colors.muted,
    lineHeight: 16,
  },
  sectionCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
    ...shadow.card,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  sectionTitle: {
    fontSize: font.base + 1,
    fontWeight: '800',
    color: '#0F172A',
  },
  viewAllText: {
    fontSize: font.xs + 1,
    fontWeight: '700',
    color: colors.brandPrimary,
  },
  emptyCard: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl,
    gap: spacing.sm,
  },
  emptyText: {
    fontSize: font.base,
    color: colors.muted,
  },
  emptyActionBtn: {
    marginTop: 4,
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.md,
  },
  emptyActionText: {
    color: colors.brandPrimary,
    fontWeight: '700',
    fontSize: font.xs + 1,
  },
  requestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  reqNo: {
    fontSize: font.sm,
    fontWeight: '800',
    color: colors.brandPrimary,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  reqService: {
    fontSize: font.base,
    fontWeight: '600',
    color: '#1E293B',
    marginTop: 3,
  },
  reqDate: {
    fontSize: font.xs,
    color: colors.muted,
    marginTop: 2,
  },
  tenderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    gap: spacing.md,
  },
  tenderTitle: {
    fontSize: font.base,
    fontWeight: '700',
    color: '#1E293B',
  },
  tenderSub: {
    fontSize: font.xs,
    color: colors.muted,
    marginTop: 2,
  },
  tenderDeadline: {
    fontSize: font.xs,
    color: '#DC2626',
    fontWeight: '600',
    marginTop: 4,
  },
  bidBtnWrap: {
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.sm,
  },
  bidBtnText: {
    fontSize: font.xs,
    fontWeight: '700',
    color: '#374151',
  },
});
