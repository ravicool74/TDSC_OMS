import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, RefreshControl, Modal, Platform, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import { colors, spacing, radius, font, shadow } from '@/src/theme';
import { api } from '@/src/api';
import { useAuth } from '@/src/AuthContext';
import { canWrite, canAction } from '@/src/rbac';
import { Card, StatusBadge, ScreenLoader, PrimaryButton, SecondaryButton, EmptyState } from '@/src/ui';
import { notify } from '@/src/dialog';

const STATUS_OPTIONS = ['all', 'SUBMITTED', 'ASSIGNED', 'IN_PROGRESS', 'UNDER_REVIEW', 'COMPLETED', 'WAITING_FOR_CUSTOMER', 'ON_HOLD', 'CANCELLED'];

export default function ServiceRequestsQueueScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const isAdminOrManager = user?.role === 'super_admin' || user?.role === 'admin' || user?.role === 'manager' || canWrite(user, 'tasks') || canAction(user, 'tasks', 'edit');

  const [queue, setQueue] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('all');
  const [staffList, setStaffList] = useState<any[]>([]);

  // Action states
  const [claimingId, setClaimingId] = useState<string | null>(null);

  // Transition Modal
  const [transitionItem, setTransitionItem] = useState<any | null>(null);
  const [nextStatus, setNextStatus] = useState<string>('IN_PROGRESS');
  const [customerRemarks, setCustomerRemarks] = useState('');
  const [internalNotes, setInternalNotes] = useState('');
  const [transitioning, setTransitioning] = useState(false);

  // Completed Deliverable Upload inside Transition Modal
  const [selectedCertificate, setSelectedCertificate] = useState<any | null>(null);
  const [uploadingCert, setUploadingCert] = useState(false);

  // Reassign Modal
  const [reassignItem, setReassignItem] = useState<any | null>(null);
  const [newEmployeeId, setNewEmployeeId] = useState('');
  const [reassignReason, setReassignReason] = useState('');
  const [reassigning, setReassigning] = useState(false);

  const loadQueue = useCallback(async () => {
    try {
      const data = await api.getServiceRequestQueue({
        status: selectedStatus !== 'all' ? selectedStatus : undefined,
        search: search.trim() || undefined,
      });
      setQueue(Array.isArray(data) ? data : []);
    } catch (e: any) {
      notify(e?.message || 'Failed to load service request queue');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedStatus, search]);

  useEffect(() => {
    loadQueue();
  }, [loadQueue]);

  useEffect(() => {
    // Load staff list for reassignment
    const loadStaff = async () => {
      try {
        const users = await api.get<any[]>('/users');
        const activeStaff = (users || []).filter((u: any) => u.status === 'active' && u.role !== 'customer');
        setStaffList(activeStaff);
        if (activeStaff.length > 0 && !newEmployeeId) {
          setNewEmployeeId(activeStaff[0].user_id);
        }
      } catch {
        // ignore
      }
    };
    if (isAdminOrManager) {
      loadStaff();
    }
  }, [isAdminOrManager]);

  const onRefresh = () => {
    setRefreshing(true);
    loadQueue();
  };

  // Concurrency-safe "Assign to Me"
  const handleAssignToMe = async (item: any) => {
    const reqId = item.id || item.request_no;
    setClaimingId(reqId);
    try {
      const res = await api.assignServiceRequestToMe(reqId);
      notify(`Successfully claimed ${item.request_no}! Primary task created.`);
      loadQueue();
    } catch (e: any) {
      // Handles 409 Conflict gracefully
      const msg = e?.message || 'Could not assign request';
      if (Platform.OS === 'web') {
        window.alert(msg);
      } else {
        Alert.alert('Assignment Notice', msg);
      }
      loadQueue();
    } finally {
      setClaimingId(null);
    }
  };

  // Open Transition Modal
  const openTransitionModal = (item: any) => {
    setTransitionItem(item);
    setCustomerRemarks(item.customer_remarks || '');
    setInternalNotes('');
    setSelectedCertificate(null);

    // Pick a sensible default next status based on current
    const cur = item.status;
    if (cur === 'SUBMITTED' || cur === 'ASSIGNED') setNextStatus('IN_PROGRESS');
    else if (cur === 'IN_PROGRESS') setNextStatus('UNDER_REVIEW');
    else if (cur === 'UNDER_REVIEW') setNextStatus('COMPLETED');
    else setNextStatus('COMPLETED');
  };

  // Pick Completed Certificate file
  const handlePickCertificate = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'image/jpeg', 'image/png'],
        copyToCacheDirectory: true,
      });
      if (res.canceled || !res.assets?.[0]) return;
      const asset = res.assets[0];
      if (asset.size && asset.size > 10 * 1024 * 1024) {
        notify('File exceeds 10 MB limit');
        return;
      }
      setSelectedCertificate(asset);
    } catch (e: any) {
      notify(e?.message || 'File selection failed');
    }
  };

  // Execute Workflow State Transition
  const handleSaveTransition = async () => {
    if (!transitionItem) return;
    setTransitioning(true);
    const reqId = transitionItem.id || transitionItem.request_no;

    try {
      // 1. If certificate selected, upload it as completed deliverable
      if (selectedCertificate) {
        setUploadingCert(true);
        try {
          await api.uploadServiceRequestDoc(reqId, 'Completed Deliverable / Final Certificate', {
            uri: selectedCertificate.uri,
            name: selectedCertificate.name || 'deliverable.pdf',
            type: selectedCertificate.mimeType,
          }, 'Final Deliverable');
        } catch (upErr: any) {
          console.error('Failed to upload deliverable:', upErr);
        } finally {
          setUploadingCert(false);
        }
      }

      // 2. Perform transition
      await api.transitionServiceRequest(reqId, {
        status: nextStatus,
        remarks: customerRemarks.trim() || undefined,
        internal_notes: internalNotes.trim() || undefined,
      });

      notify(`Service request transitioned to ${nextStatus.replace(/_/g, ' ')}`);
      setTransitionItem(null);
      loadQueue();
    } catch (e: any) {
      notify(e?.message || 'Failed to update workflow status');
    } finally {
      setTransitioning(false);
    }
  };

  // Execute Reassignment
  const handleReassign = async () => {
    if (!reassignItem || !newEmployeeId) return;
    if (!reassignReason.trim()) {
      notify('Please enter a reason for reassignment');
      return;
    }
    setReassigning(true);
    const reqId = reassignItem.id || reassignItem.request_no;
    try {
      await api.reassignServiceRequest(reqId, {
        new_employee_id: newEmployeeId,
        reason: reassignReason.trim(),
      });
      notify(`Reassigned ${reassignItem.request_no} successfully`);
      setReassignItem(null);
      setReassignReason('');
      loadQueue();
    } catch (e: any) {
      notify(e?.message || 'Failed to reassign request');
    } finally {
      setReassigning(false);
    }
  };

  // Available status options for current item
  const validNextStatuses = useMemo(() => {
    if (!transitionItem) return [];
    const cur = transitionItem.status;
    const map: Record<string, string[]> = {
      SUBMITTED: ['ASSIGNED', 'CANCELLED', 'REJECTED'],
      ASSIGNED: ['IN_PROGRESS', 'WAITING_FOR_CUSTOMER', 'ON_HOLD', 'CANCELLED'],
      IN_PROGRESS: ['UNDER_REVIEW', 'COMPLETED', 'WAITING_FOR_CUSTOMER', 'ON_HOLD', 'CANCELLED'],
      UNDER_REVIEW: ['COMPLETED', 'IN_PROGRESS', 'REJECTED', 'CANCELLED'],
      WAITING_FOR_CUSTOMER: ['IN_PROGRESS', 'UNDER_REVIEW', 'CANCELLED'],
      ON_HOLD: ['IN_PROGRESS', 'ASSIGNED', 'CANCELLED'],
      COMPLETED: [],
      REJECTED: [],
      CANCELLED: [],
    };
    return map[cur] || ['IN_PROGRESS', 'UNDER_REVIEW', 'COMPLETED'];
  }, [transitionItem]);

  return (
    <SafeAreaView edges={['top']} style={styles.root}>
      {/* Header Bar */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={22} color={colors.onSurface} />
          </Pressable>
          <View>
            <Text style={styles.headerTitle}>Service Requests by Customer</Text>
            <Text style={styles.headerSubtitle}>
              Live customer queue • Concurrency-safe assignment & task linking
            </Text>
          </View>
        </View>

        <Pressable style={styles.refreshBtn} onPress={onRefresh}>
          <Ionicons name="refresh" size={20} color={colors.brandPrimary} />
        </Pressable>
      </View>

      {/* Filter and Search Bar */}
      <View style={styles.filterSection}>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={18} color={colors.muted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search by SR No, Customer Name, Agency, Mobile, Service..."
            value={search}
            onChangeText={setSearch}
          />
          {search ? (
            <Pressable onPress={() => setSearch('')}>
              <Ionicons name="close-circle" size={18} color={colors.muted} />
            </Pressable>
          ) : null}
        </View>

        {/* Status Scroll Filter */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.statusScroll} contentContainerStyle={styles.statusScrollContent}>
          {STATUS_OPTIONS.map((st) => {
            const isSel = selectedStatus === st;
            return (
              <Pressable
                key={st}
                style={[styles.statusChip, isSel && styles.statusChipActive]}
                onPress={() => setSelectedStatus(st)}
              >
                <Text style={[styles.statusChipText, isSel && styles.statusChipTextActive]}>
                  {st.replace(/_/g, ' ').toUpperCase()}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* Queue Content */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {loading ? (
          <ScreenLoader label="Loading customer service requests..." />
        ) : queue.length === 0 ? (
          <EmptyState
            icon="clipboard-outline"
            title="No Service Requests"
            subtitle={
              selectedStatus !== 'all'
                ? `No requests currently in "${selectedStatus}" status.`
                : 'No customer service requests match your search criteria.'
            }
          />
        ) : (
          queue.map((item) => {
            const isUnassigned = !item.assigned_to_id || item.status === 'SUBMITTED';
            const isAssignedToMe = item.assigned_to_id === user?.user_id;
            const canManage = isAssignedToMe || isAdminOrManager;
            const subDate = new Date(item.created_at).toLocaleDateString('en-IN', {
              day: '2-digit',
              month: 'short',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            });

            return (
              <View key={item.id} style={styles.card}>
                {/* Header Row */}
                <View style={styles.cardHeader}>
                  <View style={{ flex: 1 }}>
                    <View style={styles.rowTop}>
                      <Text style={styles.requestNo}>{item.request_no}</Text>
                      <StatusBadge status={item.status} />
                      {item.priority === 'urgent' && (
                        <View style={styles.urgentBadge}>
                          <Text style={styles.urgentBadgeText}>URGENT</Text>
                        </View>
                      )}
                      {item.task_id && (
                        <View style={styles.linkedTaskBadge}>
                          <Ionicons name="link" size={12} color="#4338CA" />
                          <Text style={styles.linkedTaskText}>{item.task_id}</Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.serviceTitle}>{item.service_name}</Text>
                  </View>
                </View>

                {/* Customer Information Box */}
                <View style={styles.customerBox}>
                  <View style={styles.customerBoxRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.customerName}>
                        🏢 {item.customer_name || 'Customer'}
                      </Text>
                      <Text style={styles.customerAgency}>
                        Agency: {item.agency_name || item.customer_name || '---'}
                      </Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={styles.customerIdChip}>ID: {item.customer_numeric_id || item.customer_id}</Text>
                      {item.customer_mobile && (
                        <Text style={styles.customerPhone}>📞 {item.customer_mobile}</Text>
                      )}
                    </View>
                  </View>
                </View>

                {/* Submission and Assignment Meta */}
                <View style={styles.metaRow}>
                  <View style={styles.metaCol}>
                    <Text style={styles.metaLabel}>Submitted</Text>
                    <Text style={styles.metaValue}>{subDate}</Text>
                  </View>
                  <View style={styles.metaCol}>
                    <Text style={styles.metaLabel}>Assignee</Text>
                    <Text style={[styles.metaValue, isUnassigned && { color: '#DC2626' }]}>
                      {item.assigned_to_name ? `👤 ${item.assigned_to_name}` : '⚠️ Unassigned'}
                    </Text>
                  </View>
                  <View style={styles.metaCol}>
                    <Text style={styles.metaLabel}>Documents</Text>
                    <Text style={styles.metaValue}>📎 {(item.documents || []).length} uploaded</Text>
                  </View>
                </View>

                {/* Customer Remarks / Instructions */}
                {item.remarks ? (
                  <View style={styles.remarksBox}>
                    <Text style={styles.remarksLabel}>Customer Note:</Text>
                    <Text style={styles.remarksText}>{item.remarks}</Text>
                  </View>
                ) : null}

                {/* Action Buttons Row */}
                <View style={styles.actionRow}>
                  {isUnassigned ? (
                    <Pressable
                      style={[styles.claimBtn, claimingId === item.id && { opacity: 0.6 }]}
                      onPress={() => handleAssignToMe(item)}
                      disabled={claimingId === item.id}
                    >
                      {claimingId === item.id ? (
                        <ActivityIndicator color="#FFFFFF" size="small" />
                      ) : (
                        <>
                          <Ionicons name="hand-right" size={16} color="#FFFFFF" />
                          <Text style={styles.claimBtnText}>Assign to Me</Text>
                        </>
                      )}
                    </Pressable>
                  ) : null}

                  {canManage ? (
                    <Pressable
                      style={styles.transitionBtn}
                      onPress={() => openTransitionModal(item)}
                    >
                      <Ionicons name="git-branch-outline" size={16} color={colors.brandPrimary} />
                      <Text style={styles.transitionBtnText}>Update Workflow Status</Text>
                    </Pressable>
                  ) : null}

                  {isAdminOrManager && (
                    <Pressable
                      style={styles.reassignBtn}
                      onPress={() => setReassignItem(item)}
                    >
                      <Ionicons name="swap-horizontal-outline" size={16} color="#4B5563" />
                      <Text style={styles.reassignBtnText}>Reassign</Text>
                    </Pressable>
                  )}
                </View>
              </View>
            );
          })
        )}
      </ScrollView>

      {/* Workflow Transition Modal */}
      <Modal visible={!!transitionItem} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>Workflow Status Transition</Text>
                <Text style={styles.modalSub}>{transitionItem?.request_no} • {transitionItem?.service_name}</Text>
              </View>
              <Pressable onPress={() => setTransitionItem(null)}>
                <Ionicons name="close" size={24} color={colors.muted} />
              </Pressable>
            </View>

            <ScrollView style={{ maxHeight: 440 }} contentContainerStyle={{ gap: spacing.md }}>
              <View style={styles.currentStatusBox}>
                <Text style={styles.metaLabel}>Current Status</Text>
                <StatusBadge status={transitionItem?.status} />
              </View>

              {/* Next Status Selector */}
              <View style={{ gap: 6 }}>
                <Text style={styles.inputLabel}>Select Next Workflow Status *</Text>
                <View style={styles.nextStatusGrid}>
                  {validNextStatuses.length === 0 ? (
                    <Text style={{ fontSize: font.sm, color: colors.muted }}>
                      This request is in a terminal status ({transitionItem?.status}). No further transitions.
                    </Text>
                  ) : (
                    validNextStatuses.map((st) => (
                      <Pressable
                        key={st}
                        style={[styles.nextStatusChip, nextStatus === st && styles.nextStatusChipActive]}
                        onPress={() => setNextStatus(st)}
                      >
                        <Text style={[styles.nextStatusChipText, nextStatus === st && styles.nextStatusChipTextActive]}>
                          {st.replace(/_/g, ' ')}
                        </Text>
                      </Pressable>
                    ))
                  )}
                </View>
              </View>

              {/* Upload Final Deliverable / Certificate */}
              <View style={styles.certUploadSection}>
                <Text style={styles.inputLabel}>Upload Final Certificate / Output Document (Optional)</Text>
                <Pressable style={styles.certPickerBox} onPress={handlePickCertificate}>
                  <Ionicons name="cloud-upload" size={24} color="#059669" />
                  <Text style={styles.certPickerText}>
                    {selectedCertificate ? selectedCertificate.name : 'Click to attach output file for customer'}
                  </Text>
                </Pressable>
              </View>

              {/* Customer Remarks */}
              <View style={{ gap: 4 }}>
                <Text style={styles.inputLabel}>Customer Remarks (Visible on Customer Portal)</Text>
                <TextInput
                  style={[styles.input, { height: 60, textAlignVertical: 'top' }]}
                  placeholder="E.g. Application submitted on portal, ack number is 987654..."
                  value={customerRemarks}
                  onChangeText={setCustomerRemarks}
                  multiline
                />
              </View>

              {/* Internal Notes */}
              <View style={{ gap: 4 }}>
                <Text style={styles.inputLabel}>Internal Team Notes (Staff Only)</Text>
                <TextInput
                  style={[styles.input, { height: 60, textAlignVertical: 'top' }]}
                  placeholder="Notes for Triveni team only..."
                  value={internalNotes}
                  onChangeText={setInternalNotes}
                  multiline
                />
              </View>
            </ScrollView>

            <View style={styles.modalActions}>
              <SecondaryButton title="Cancel" onPress={() => setTransitionItem(null)} style={{ flex: 1 }} />
              <PrimaryButton
                title="Save Transition"
                onPress={handleSaveTransition}
                loading={transitioning}
                style={{ flex: 1 }}
              />
            </View>
          </View>
        </View>
      </Modal>

      {/* Reassign Modal */}
      <Modal visible={!!reassignItem} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>Reassign Service Request</Text>
                <Text style={styles.modalSub}>{reassignItem?.request_no} • {reassignItem?.service_name}</Text>
              </View>
              <Pressable onPress={() => setReassignItem(null)}>
                <Ionicons name="close" size={24} color={colors.muted} />
              </Pressable>
            </View>

            <View style={{ gap: spacing.md }}>
              <View style={{ gap: 6 }}>
                <Text style={styles.inputLabel}>Select New Assignee *</Text>
                <ScrollView style={{ maxHeight: 160 }} contentContainerStyle={{ gap: 4 }}>
                  {staffList.map((st) => {
                    const isSel = newEmployeeId === st.user_id;
                    return (
                      <Pressable
                        key={st.user_id}
                        style={[styles.staffSelectRow, isSel && styles.staffSelectRowActive]}
                        onPress={() => setNewEmployeeId(st.user_id)}
                      >
                        <Ionicons
                          name={isSel ? 'radio-button-on' : 'radio-button-off'}
                          size={18}
                          color={isSel ? colors.brandPrimary : colors.muted}
                        />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.staffName}>{st.name || st.email}</Text>
                          <Text style={styles.staffSub}>{st.role} • {st.user_id}</Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>

              <View style={{ gap: 4 }}>
                <Text style={styles.inputLabel}>Reason for Reassignment *</Text>
                <TextInput
                  style={[styles.input, { height: 60, textAlignVertical: 'top' }]}
                  placeholder="Reason for changing assignee..."
                  value={reassignReason}
                  onChangeText={setReassignReason}
                  multiline
                />
              </View>
            </View>

            <View style={styles.modalActions}>
              <SecondaryButton title="Cancel" onPress={() => setReassignItem(null)} style={{ flex: 1 }} />
              <PrimaryButton
                title="Confirm Reassign"
                onPress={handleReassign}
                loading={reassigning}
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
  refreshBtn: {
    padding: 8,
    borderRadius: radius.md,
    backgroundColor: '#EFF6FF',
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
  statusScroll: {
    maxHeight: 44,
  },
  statusScrollContent: {
    flexDirection: 'row',
    gap: 6,
    paddingVertical: 4,
  },
  statusChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: '#F1F5F9',
  },
  statusChipActive: {
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  statusChipText: {
    fontSize: font.xs,
    fontWeight: '700',
    color: '#475569',
  },
  statusChipTextActive: {
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
  rowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
    marginBottom: 4,
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
  linkedTaskBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#EEF2FF',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  linkedTaskText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#4338CA',
  },
  serviceTitle: {
    fontSize: font.base + 2,
    fontWeight: '800',
    color: '#0F172A',
  },
  customerBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: spacing.md,
  },
  customerBoxRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  customerName: {
    fontSize: font.sm,
    fontWeight: '700',
    color: '#0F172A',
  },
  customerAgency: {
    fontSize: font.xs,
    color: colors.muted,
    marginTop: 2,
  },
  customerIdChip: {
    fontSize: font.xs,
    fontWeight: '800',
    color: '#3B82F6',
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  customerPhone: {
    fontSize: font.xs,
    color: '#475569',
    marginTop: 2,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
  },
  metaCol: {
    gap: 2,
  },
  metaLabel: {
    fontSize: font.xs - 1,
    color: colors.muted,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  metaValue: {
    fontSize: font.xs + 1,
    fontWeight: '700',
    color: '#1E293B',
  },
  remarksBox: {
    backgroundColor: '#FEF9C3',
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: '#FEF08A',
    padding: spacing.sm,
    gap: 2,
  },
  remarksLabel: {
    fontSize: font.xs - 1,
    fontWeight: '700',
    color: '#854D0E',
  },
  remarksText: {
    fontSize: font.xs + 1,
    color: '#713F12',
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    flexWrap: 'wrap',
  },
  claimBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#059669',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.md,
  },
  claimBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: font.xs + 1,
  },
  transitionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.md,
  },
  transitionBtnText: {
    color: colors.brandPrimary,
    fontWeight: '700',
    fontSize: font.xs + 1,
  },
  reassignBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: radius.md,
  },
  reassignBtnText: {
    color: '#475569',
    fontWeight: '600',
    fontSize: font.xs,
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
  modalTitle: {
    fontSize: font.lg,
    fontWeight: '800',
    color: '#0F172A',
  },
  modalSub: {
    fontSize: font.xs,
    color: colors.muted,
    marginTop: 2,
  },
  currentStatusBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F8FAFC',
    padding: spacing.md,
    borderRadius: radius.sm,
  },
  inputLabel: {
    fontSize: font.xs + 1,
    fontWeight: '700',
    color: '#334155',
  },
  nextStatusGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  nextStatusChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.md,
    backgroundColor: '#F1F5F9',
  },
  nextStatusChipActive: {
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: colors.brandPrimary,
  },
  nextStatusChipText: {
    fontSize: font.xs + 1,
    fontWeight: '600',
    color: '#475569',
  },
  nextStatusChipTextActive: {
    color: colors.brandPrimary,
    fontWeight: '700',
  },
  certUploadSection: {
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    padding: spacing.md,
    borderRadius: radius.md,
    gap: 6,
  },
  certPickerBox: {
    borderWidth: 1,
    borderColor: '#86EFAC',
    borderStyle: 'dashed',
    backgroundColor: '#FFFFFF',
    borderRadius: radius.sm,
    padding: spacing.md,
    alignItems: 'center',
    gap: 4,
  },
  certPickerText: {
    fontSize: font.xs + 1,
    fontWeight: '600',
    color: '#065F46',
  },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    fontSize: font.sm,
    color: '#0F172A',
  },
  staffSelectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  staffSelectRowActive: {
    backgroundColor: '#EFF6FF',
    borderColor: '#BFDBFE',
  },
  staffName: {
    fontSize: font.sm,
    fontWeight: '700',
    color: '#1E293B',
  },
  staffSub: {
    fontSize: font.xs,
    color: colors.muted,
  },
  modalActions: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
});
