import React, { useCallback, useMemo, useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, FlatList, Pressable, RefreshControl,
  TextInput, ScrollView, Modal, Alert, Platform, Linking, ActivityIndicator
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius } from '@/src/theme';
import { api } from '@/src/api';
import { Card, EmptyState, ScreenLoader, PrimaryButton, SecondaryButton } from '@/src/ui';

type CallingSection = 'calling_day' | 'followup' | 'converted';

const STATEMENTS = [
  { id: 'Interested', label: 'Interested', color: '#3b82f6', bg: '#eff6ff', icon: 'thumbs-up' },
  { id: 'Low Interested', label: 'Low Interested', color: '#eab308', bg: '#fefce8', icon: 'alert-circle-outline' },
  { id: 'Medium Interested', label: 'Medium Interested', color: '#f97316', bg: '#fff7ed', icon: 'flame-outline' },
  { id: 'Highly Interested', label: 'Highly Interested', color: '#2563eb', bg: '#dbeafe', icon: 'star' },
  { id: 'Not Interested', label: 'Not Interested', color: '#ef4444', bg: '#fef2f2', icon: 'close-circle' },
  { id: 'Lead Converted', label: 'Lead Converted', color: '#16a34a', bg: '#f0fdf4', icon: 'checkmark-circle' },
];

function getStatusStyle(st: string) {
  const found = STATEMENTS.find(s => s.id === st);
  if (found) return found;
  return { id: st, label: st, color: colors.brandPrimary, bg: colors.surfaceSecondary, icon: 'help-circle' };
}

interface TenderCallingViewProps {
  user: any;
  isAdminOrManager: boolean;
  contractors: any[] | null;
  onNavigateToBilling: () => void;
  onNavigateToTasks: () => void;
}

export default function TenderCallingView({
  user,
  isAdminOrManager,
  contractors,
  onNavigateToBilling,
  onNavigateToTasks,
}: TenderCallingViewProps) {
  const [section, setSection] = useState<CallingSection>('calling_day');
  const [calls, setCalls] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [analytics, setAnalytics] = useState<any | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [employeeFilter, setEmployeeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [staffUsers, setStaffUsers] = useState<any[]>([]);

  // Inline Row Edit state (Section A)
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editAgency, setEditAgency] = useState('');
  const [editMobile, setEditMobile] = useState('');
  const [editWorks, setEditWorks] = useState('');
  const [editRemarks, setEditRemarks] = useState('');
  const [editStatus, setEditStatus] = useState('Interested');
  const [addingBelowId, setAddingBelowId] = useState<string | null>(null);

  // Follow-up quick edit (Section B)
  const [followupRemarks, setFollowupRemarks] = useState<Record<string, string>>({});
  const [followupStatus, setFollowupStatus] = useState<Record<string, string>>({});

  // Modals for Section C (Lead Converted)
  const [assignModalVisible, setAssignModalVisible] = useState(false);
  const [assignTargetCall, setAssignTargetCall] = useState<any | null>(null);
  const [assigneeId, setAssigneeId] = useState('');
  const [assigneeName, setAssigneeName] = useState('');
  const [assignDeadline, setAssignDeadline] = useState('');
  const [assignInstructions, setAssignInstructions] = useState('');
  const [assignEstAmount, setAssignEstAmount] = useState('');
  const [submittingAssign, setSubmittingAssign] = useState(false);

  const [billModalVisible, setBillModalVisible] = useState(false);
  const [billTargetCall, setBillTargetCall] = useState<any | null>(null);
  const [billAmount, setBillAmount] = useState('');
  const [billDesc, setBillDesc] = useState('');
  const [billTaxRate, setBillTaxRate] = useState('18');
  const [submittingBill, setSubmittingBill] = useState(false);

  // Load Calls for current section
  const loadCalls = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getTenderCalls(section, {
        employee_id: employeeFilter !== 'all' ? employeeFilter : undefined,
        status: statusFilter !== 'all' ? statusFilter : undefined,
        search: search.trim() || undefined,
      });
      setCalls(data || []);
    } catch (e: any) {
      setCalls([]);
    } finally {
      setLoading(false);
    }
  }, [section, employeeFilter, statusFilter, search]);

  // Load Analytics
  const loadAnalytics = useCallback(async () => {
    try {
      const data = await api.getTenderCallsAnalytics();
      setAnalytics(data);
    } catch {
      // ignore
    }
  }, []);

  // Load Staff Users for Assignment & Filter
  const loadStaff = useCallback(async () => {
    try {
      const data = await api.getDocUsersList();
      setStaffUsers(data || []);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    loadCalls();
  }, [loadCalls]);

  useEffect(() => {
    loadAnalytics();
    loadStaff();
  }, [loadAnalytics, loadStaff]);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([loadCalls(), loadAnalytics()]);
    setRefreshing(false);
  };

  // Section (a): Add new calling line below clicked row ('+' sign)
  const handleInsertRowBelow = async (afterRowId?: string) => {
    setAddingBelowId(afterRowId || 'top');
    try {
      const res = await api.createTenderCall({
        agency_name: 'New Contractor / Agency',
        mobile: '',
        talking_about_works: 'Tender Work Discussion',
        remarks: 'New call entry',
        interest_status: 'Interested',
        insert_after_id: afterRowId,
      });
      await loadCalls();
      await loadAnalytics();
      // Auto-enter edit mode for newly created line
      setEditingId(res.id);
      setEditAgency(res.agency_name || '');
      setEditMobile(res.mobile || '');
      setEditWorks(res.talking_about_works || '');
      setEditRemarks(res.remarks || '');
      setEditStatus(res.interest_status || 'Interested');
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to insert row');
    } finally {
      setAddingBelowId(null);
    }
  };

  // Start inline editing
  const handleStartEdit = (item: any) => {
    setEditingId(item.id);
    setEditAgency(item.agency_name || '');
    setEditMobile(item.mobile || '');
    setEditWorks(item.talking_about_works || '');
    setEditRemarks(item.remarks || '');
    setEditStatus(item.interest_status || 'Interested');
  };

  // Update inline edited line
  const handleSaveEdit = async (id: string) => {
    try {
      await api.updateTenderCall(id, {
        agency_name: editAgency.trim() || 'Untitled Agency',
        mobile: editMobile.trim() || undefined,
        talking_about_works: editWorks.trim() || undefined,
        remarks: editRemarks.trim() || undefined,
        interest_status: editStatus,
      });
      setEditingId(null);
      await loadCalls();
      await loadAnalytics();
      Alert.alert('Updated', 'Calling record updated successfully.');
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to update row');
    }
  };

  // Quick 1-click status change
  const handleQuickStatusChange = async (id: string, newStatus: string) => {
    try {
      await api.updateTenderCall(id, { interest_status: newStatus });
      await loadCalls();
      await loadAnalytics();
      if (['Low Interested', 'Medium Interested', 'Highly Interested'].includes(newStatus)) {
        Alert.alert(
          'Follow-up Scheduled',
          `"${newStatus}" selected! This calling line is now automatically scheduled in the Employee Next-Day Follow-up section and visible to the Branch Manager & Assistant Manager.`
        );
      } else if (newStatus === 'Lead Converted') {
        Alert.alert(
          'Lead Converted!',
          'Congratulations! Calling line transferred to "New Lead Generated" section. You can now Create a Bill and Assign Work with an Automatic Task.'
        );
      }
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to change status');
    }
  };

  // Delete line
  const handleDeleteCall = (item: any) => {
    Alert.alert('Delete Calling Line?', `Are you sure you want to delete call with "${item.agency_name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.deleteTenderCall(item.id);
            await loadCalls();
            await loadAnalytics();
          } catch (e: any) {
            Alert.alert('Error', e?.message || 'Failed to delete row');
          }
        },
      },
    ]);
  };

  // Upload Call Recording (Audio)
  const handleUploadRecording = async (callId: string) => {
    try {
      const DocumentPicker = require('expo-document-picker');
      const res = await DocumentPicker.getDocumentAsync({
        type: ['audio/*', 'application/octet-stream'],
        copyToCacheDirectory: true,
      });
      if (res.canceled || !res.assets?.[0]) return;
      const asset = res.assets[0];
      await api.uploadCallRecording(callId, {
        uri: asset.uri,
        name: asset.name,
        type: asset.mimeType || 'audio/mpeg',
      });
      await loadCalls();
      Alert.alert('Success', 'Recording file attached successfully.');
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to upload audio recording');
    }
  };

  // Remove Recording
  const handleDeleteRecording = async (callId: string) => {
    try {
      await api.deleteCallRecording(callId);
      await loadCalls();
      Alert.alert('Removed', 'Recording attachment removed.');
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to remove recording');
    }
  };

  // Section (b): Mark Follow-up Completed
  const handleMarkFollowupDone = async (callId: string) => {
    const rem = followupRemarks[callId] || '';
    const st = followupStatus[callId];
    try {
      await api.updateTenderCall(callId, {
        followup_completed: true,
        followup_remarks: rem.trim() || undefined,
        interest_status: st || undefined,
      });
      await loadCalls();
      await loadAnalytics();
      Alert.alert('Follow-up Recorded', 'Follow-up call marked complete and updated in Admin count.');
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to complete follow-up');
    }
  };

  // Section (c): Assign Work Modal
  const handleOpenAssignModal = (call: any) => {
    setAssignTargetCall(call);
    setAssigneeId(staffUsers[0]?.id || user?.id || '');
    setAssigneeName(staffUsers[0]?.name || user?.name || '');
    setAssignDeadline('2026-10-15');
    setAssignInstructions('Prepare technical qualification documents, BOQ comparative analysis, and bid submission.');
    setAssignEstAmount(call.converted_amount ? String(call.converted_amount) : '25000');
    setAssignModalVisible(true);
  };

  const handleSubmitAssignWork = async () => {
    if (!assignTargetCall) return;
    setSubmittingAssign(true);
    try {
      const res = await api.assignCallWork(assignTargetCall.id, {
        assignee_id: assigneeId,
        assignee_name: assigneeName,
        deadline: assignDeadline.trim() || undefined,
        instructions: assignInstructions.trim() || undefined,
        estimated_amount: parseFloat(assignEstAmount) || 0,
      });
      setAssignModalVisible(false);
      await loadCalls();
      await loadAnalytics();
      Alert.alert('Task Created & Assigned!', `${res.message}\nTask ID: ${res.task_no}`);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to assign work');
    } finally {
      setSubmittingAssign(false);
    }
  };

  // Section (c): Create Bill Modal
  const handleOpenBillModal = (call: any) => {
    setBillTargetCall(call);
    setBillAmount(call.converted_amount ? String(call.converted_amount) : '15000');
    setBillDesc(`Tender Preparation & Bid Filing for ${call.talking_about_works || 'Tender Work'}`);
    setBillTaxRate('18');
    setBillModalVisible(true);
  };

  const handleSubmitCreateBill = async () => {
    if (!billTargetCall) return;
    const amt = parseFloat(billAmount);
    if (!amt || amt <= 0) {
      Alert.alert('Validation Error', 'Please enter a valid bill amount.');
      return;
    }
    setSubmittingBill(true);
    try {
      const res = await api.createCallBill(billTargetCall.id, {
        amount: amt,
        description: billDesc.trim() || undefined,
        tax_rate: parseFloat(billTaxRate) || 18.0,
      });
      setBillModalVisible(false);
      await loadCalls();
      await loadAnalytics();
      Alert.alert('Invoice Generated!', `${res.message}\nTotal Amount: ₹ ${res.total_amount}`);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to generate bill');
    } finally {
      setSubmittingBill(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* ========================================================================= */}
      {/* 3 SUB-SECTIONS TABS BAR                                                   */}
      {/* ========================================================================= */}
      <View style={styles.subSectionsBar}>
        <Pressable
          testID="subtab-calling-day"
          style={[styles.subTabItem, section === 'calling_day' && styles.subTabItemActive]}
          onPress={() => setSection('calling_day')}
        >
          <Ionicons
            name="call"
            size={16}
            color={section === 'calling_day' ? colors.brandPrimary : colors.muted}
          />
          <Text style={[styles.subTabLabel, section === 'calling_day' && styles.subTabLabelActive]}>
            (a) Tender Calling During the Day
          </Text>
          {analytics && analytics.total_calls_today > 0 && (
            <View style={styles.tabCountPill}>
              <Text style={styles.tabCountPillText}>{analytics.total_calls_today}</Text>
            </View>
          )}
        </Pressable>

        <Pressable
          testID="subtab-followup"
          style={[styles.subTabItem, section === 'followup' && styles.subTabItemActive]}
          onPress={() => setSection('followup')}
        >
          <Ionicons
            name="calendar"
            size={16}
            color={section === 'followup' ? '#d97706' : colors.muted}
          />
          <Text style={[styles.subTabLabel, section === 'followup' && styles.subTabLabelActive]}>
            (b) Tender Follow-up
          </Text>
          {analytics && analytics.total_followups_pending > 0 && (
            <View style={[styles.tabCountPill, { backgroundColor: '#fef3c7' }]}>
              <Text style={[styles.tabCountPillText, { color: '#b45309' }]}>
                {analytics.total_followups_pending}
              </Text>
            </View>
          )}
        </Pressable>

        <Pressable
          testID="subtab-converted"
          style={[styles.subTabItem, section === 'converted' && styles.subTabItemActive]}
          onPress={() => setSection('converted')}
        >
          <Ionicons
            name="trophy"
            size={16}
            color={section === 'converted' ? '#16a34a' : colors.muted}
          />
          <Text style={[styles.subTabLabel, section === 'converted' && styles.subTabLabelActive]}>
            (c) New Lead Generated
          </Text>
          {analytics && analytics.total_leads_converted > 0 && (
            <View style={[styles.tabCountPill, { backgroundColor: '#dcfce7' }]}>
              <Text style={[styles.tabCountPillText, { color: '#15803d' }]}>
                {analytics.total_leads_converted}
              </Text>
            </View>
          )}
        </Pressable>
      </View>

      {/* ========================================================================= */}
      {/* QUICK ANALYTICS METRIC CARDS                                              */}
      {/* ========================================================================= */}
      <View style={styles.statsRow}>
        <View style={[styles.statBox, { borderLeftColor: colors.brandPrimary }]}>
          <Text style={styles.statLabel}>Today's Calls</Text>
          <Text style={[styles.statVal, { color: colors.brandPrimary }]}>{analytics?.total_calls_today || 0}</Text>
        </View>

        <View style={[styles.statBox, { borderLeftColor: '#f59e0b' }]}>
          <Text style={styles.statLabel}>Follow-ups Due</Text>
          <Text style={[styles.statVal, { color: '#d97706' }]}>{analytics?.total_followups_due_today || 0}</Text>
        </View>

        <View style={[styles.statBox, { borderLeftColor: '#10b981' }]}>
          <Text style={styles.statLabel}>Completed Today</Text>
          <Text style={[styles.statVal, { color: '#059669' }]}>{analytics?.total_followups_completed_today || 0}</Text>
        </View>

        <View style={[styles.statBox, { borderLeftColor: '#8b5cf6' }]}>
          <Text style={styles.statLabel}>Leads Converted</Text>
          <Text style={[styles.statVal, { color: '#7c3aed' }]}>{analytics?.total_leads_converted || 0}</Text>
        </View>
      </View>

      {/* ========================================================================= */}
      {/* SECTION B ONLY: ADMIN LEVEL EMPLOYEE FOLLOW-UP LEADERBOARD BREAKDOWN      */}
      {/* ========================================================================= */}
      {section === 'followup' && isAdminOrManager && analytics?.employee_breakdown?.length > 0 && (
        <Card style={styles.adminCounterCard}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Ionicons name="bar-chart" size={16} color={colors.brandPrimary} />
              <Text style={styles.adminCounterTitle}>Admin Level Follow-up Counter by Employee</Text>
            </View>
            <Text style={styles.adminCounterSubtitle}>Real-time Staff Metrics</Text>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {analytics.employee_breakdown.map((emp: any, idx: number) => (
              <Pressable
                key={idx}
                onPress={() => setEmployeeFilter(employeeFilter === emp.user_id ? 'all' : emp.user_id)}
                style={[
                  styles.empBreakdownChip,
                  employeeFilter === emp.user_id && styles.empBreakdownChipActive,
                ]}
              >
                <Text style={styles.empBreakdownName}>{emp.name}</Text>
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
                  <Text style={styles.empMetricDone}>✅ {emp.followups_done} Done</Text>
                  <Text style={styles.empMetricPending}>⏳ {emp.followups_pending} Pending</Text>
                  <Text style={styles.empMetricConv}>🎯 {emp.leads_converted} Leads</Text>
                </View>
              </Pressable>
            ))}
          </ScrollView>
        </Card>
      )}

      {/* ========================================================================= */}
      {/* SEARCH & QUICK ACTION BAR                                                 */}
      {/* ========================================================================= */}
      <View style={styles.actionFilterBar}>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={16} color={colors.muted} />
          <TextInput
            placeholder="Search by Agency, Mobile, Works, Remarks…"
            value={search}
            onChangeText={setSearch}
            style={styles.searchInput}
            placeholderTextColor={colors.muted}
          />
          {search.length > 0 && (
            <Pressable onPress={() => setSearch('')}>
              <Ionicons name="close-circle" size={16} color={colors.muted} />
            </Pressable>
          )}
        </View>

        {section === 'calling_day' && (
          <Pressable
            testID="add-first-calling-line-btn"
            style={styles.addCallingLineBtn}
            onPress={() => handleInsertRowBelow(undefined)}
          >
            <Ionicons name="add" size={16} color="#fff" />
            <Text style={styles.addCallingLineBtnText}>+ Add Calling Line</Text>
          </Pressable>
        )}

        {section === 'converted' && (
          <Pressable
            testID="go-to-billing-btn"
            style={styles.goToBillingBtn}
            onPress={onNavigateToBilling}
          >
            <Ionicons name="receipt-outline" size={16} color="#fff" />
            <Text style={styles.goToBillingBtnText}>“+” Go to Account & Billing</Text>
          </Pressable>
        )}
      </View>

      {/* ========================================================================= */}
      {/* LIST / TABLE CONTENT FOR ALL 3 SUB-SECTIONS                               */}
      {/* ========================================================================= */}
      {loading ? (
        <ScreenLoader />
      ) : calls === null || calls.length === 0 ? (
        <EmptyState
          icon={section === 'calling_day' ? 'call-outline' : section === 'followup' ? 'calendar-outline' : 'trophy-outline'}
          title={
            section === 'calling_day'
              ? 'No Calling Records'
              : section === 'followup'
              ? 'No Follow-ups Pending'
              : 'No Converted Leads Yet'
          }
          subtitle={
            section === 'calling_day'
              ? 'Click "+ Add Calling Line" to log agency calls during the day.'
              : section === 'followup'
              ? 'Calls marked "Low", "Medium", or "Highly Interested" will appear here automatically.'
              : 'Select "Lead Converted" on any calling row to transfer leads here.'
          }
          actionLabel={section === 'calling_day' ? '+ Add Calling Line' : undefined}
          onAction={section === 'calling_day' ? () => handleInsertRowBelow(undefined) : undefined}
        />
      ) : (
        <FlatList
          data={calls}
          keyExtractor={item => item.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          contentContainerStyle={{ padding: spacing.md, paddingBottom: 100, gap: 12 }}
          renderItem={({ item, index }) => {
            const isEditing = editingId === item.id;
            const isInsertingBelow = addingBelowId === item.id;
            const stObj = getStatusStyle(item.interest_status);

            return (
              <Card key={item.id} style={[styles.callCard, isEditing && styles.callCardEditing]}>
                {/* Header Row: Sl. No., Agency Name, Caller info, and "+" Sign */}
                <View style={styles.callCardHeader}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                    <View style={styles.slBadge}>
                      <Text style={styles.slBadgeText}>Sl. {item.sl_no}</Text>
                    </View>

                    {isEditing ? (
                      <TextInput
                        value={editAgency}
                        onChangeText={setEditAgency}
                        style={styles.inlineEditInput}
                        placeholder="Name of Agency / Contractor"
                        autoFocus
                      />
                    ) : (
                      <View style={{ flex: 1 }}>
                        <Text style={styles.agencyNameText} numberOfLines={1}>
                          🏢 {item.agency_name}
                        </Text>
                        <Text style={styles.callerSubText}>
                          Caller: {item.caller_user_name} • Date: {item.call_date}
                        </Text>
                      </View>
                    )}
                  </View>

                  {/* Status Pill Badge */}
                  <View style={[styles.statusBadge, { backgroundColor: stObj.bg, borderColor: stObj.color }]}>
                    <Ionicons name={stObj.icon as any} size={11} color={stObj.color} />
                    <Text style={[styles.statusBadgeText, { color: stObj.color }]}>{stObj.label}</Text>
                  </View>

                  {/* "+" Button in Last Column to Add New Row Below */}
                  {section === 'calling_day' && (
                    <Pressable
                      testID={`add-call-below-${item.id}`}
                      style={[styles.plusBelowBtn, isInsertingBelow && { opacity: 0.5 }]}
                      onPress={() => handleInsertRowBelow(item.id)}
                      accessibilityLabel="Click + to Add New row below"
                    >
                      {isInsertingBelow ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Ionicons name="add" size={18} color="#fff" />
                      )}
                    </Pressable>
                  )}
                </View>

                {/* Mobile Row with Direct Call & WhatsApp */}
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Mobile No.:</Text>
                  {isEditing ? (
                    <TextInput
                      value={editMobile}
                      onChangeText={setEditMobile}
                      style={[styles.inlineEditInput, { flex: 1 }]}
                      placeholder="Mobile No."
                      keyboardType="phone-pad"
                    />
                  ) : (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Text style={styles.mobileText}>{item.mobile || 'Not specified'}</Text>
                      {item.mobile ? (
                        <>
                          <Pressable
                            style={styles.quickContactBtn}
                            onPress={() => Linking.openURL(`tel:${item.mobile}`)}
                            accessibilityLabel="Direct Call"
                          >
                            <Ionicons name="call" size={13} color="#2563eb" />
                            <Text style={styles.quickContactText}>Call</Text>
                          </Pressable>
                          <Pressable
                            style={[styles.quickContactBtn, { backgroundColor: '#dcfce7' }]}
                            onPress={() => Linking.openURL(`https://wa.me/91${item.mobile.replace(/\D/g, '')}`)}
                            accessibilityLabel="WhatsApp"
                          >
                            <Ionicons name="logo-whatsapp" size={13} color="#16a34a" />
                            <Text style={[styles.quickContactText, { color: '#16a34a' }]}>WhatsApp</Text>
                          </Pressable>
                        </>
                      ) : null}
                    </View>
                  )}
                </View>

                {/* Talking about works */}
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Talking about works:</Text>
                  {isEditing ? (
                    <TextInput
                      value={editWorks}
                      onChangeText={setEditWorks}
                      style={[styles.inlineEditInput, { flex: 1 }]}
                      placeholder="Work discussion, tender package, road, building..."
                    />
                  ) : (
                    <Text style={styles.worksText}>{item.talking_about_works || '—'}</Text>
                  )}
                </View>

                {/* Remarks */}
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Remarks:</Text>
                  {isEditing ? (
                    <TextInput
                      value={editRemarks}
                      onChangeText={setEditRemarks}
                      style={[styles.inlineEditInput, { flex: 1 }]}
                      placeholder="Discussion remarks, requirements, timeline..."
                      multiline
                    />
                  ) : (
                    <Text style={styles.remarksText}>{item.remarks || '—'}</Text>
                  )}
                </View>

                {/* Attached / Upload Recording File */}
                <View style={styles.recordingRow}>
                  <Text style={styles.detailLabel}>Attached Recording:</Text>
                  {item.recording_file_url ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Pressable
                        style={styles.recordingChip}
                        onPress={() => Linking.openURL(`http://localhost:8000${item.recording_file_url}`)}
                        accessibilityLabel="Play / Download Recording"
                      >
                        <Ionicons name="musical-notes" size={14} color={colors.brandPrimary} />
                        <Text style={styles.recordingChipText} numberOfLines={1}>
                          {item.recording_file_name || 'Audio Recording.mp3'}
                        </Text>
                      </Pressable>

                      <Pressable
                        style={styles.delRecordingBtn}
                        onPress={() => handleDeleteRecording(item.id)}
                        accessibilityLabel="Delete Recording"
                      >
                        <Ionicons name="trash-outline" size={14} color={colors.error} />
                      </Pressable>
                    </View>
                  ) : (
                    <Pressable
                      style={styles.uploadRecBtn}
                      onPress={() => handleUploadRecording(item.id)}
                      accessibilityLabel="Upload Audio File"
                    >
                      <Ionicons name="cloud-upload-outline" size={13} color={colors.brandPrimary} />
                      <Text style={styles.uploadRecBtnText}>Upload Recording File</Text>
                    </Pressable>
                  )}
                </View>

                {/* ========================================================================= */}
                {/* SECTION A: STATEMENT BUTTONS (Interested, Low, Med, High, Lead Converted)  */}
                {/* ========================================================================= */}
                {section === 'calling_day' && (
                  <View style={styles.statementButtonsContainer}>
                    <Text style={styles.statementTitle}>Select Interest Statement:</Text>
                    <View style={styles.statementPillsRow}>
                      {STATEMENTS.map(st => {
                        const active = item.interest_status === st.id;
                        return (
                          <Pressable
                            key={st.id}
                            testID={`status-btn-${st.id}-${item.id}`}
                            style={[
                              styles.statementPill,
                              { borderColor: st.color, backgroundColor: active ? st.bg : '#fff' },
                              active && { borderWidth: 2 },
                            ]}
                            onPress={() => handleQuickStatusChange(item.id, st.id)}
                          >
                            <Ionicons name={st.icon as any} size={11} color={st.color} />
                            <Text style={[styles.statementPillText, { color: st.color }]}>
                              {st.label}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                )}

                {/* ========================================================================= */}
                {/* SECTION B: FOLLOW-UP SPECIFIC (Date & Remarks & Mark Done)                */}
                {/* ========================================================================= */}
                {section === 'followup' && (
                  <View style={styles.followupBox}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <Text style={styles.followupBoxTitle}>
                        📅 Follow-up Due: <Text style={{ color: '#d97706', fontWeight: '800' }}>{item.followup_date || 'Tomorrow'}</Text>
                      </Text>
                      {item.followup_completed ? (
                        <View style={[styles.statusBadge, { backgroundColor: '#dcfce7', borderColor: '#16a34a' }]}>
                          <Ionicons name="checkmark-done" size={12} color="#16a34a" />
                          <Text style={[styles.statusBadgeText, { color: '#16a34a' }]}>Follow-up Done</Text>
                        </View>
                      ) : (
                        <View style={[styles.statusBadge, { backgroundColor: '#fef3c7', borderColor: '#d97706' }]}>
                          <Ionicons name="time-outline" size={12} color="#d97706" />
                          <Text style={[styles.statusBadgeText, { color: '#d97706' }]}>Pending</Text>
                        </View>
                      )}
                    </View>

                    <TextInput
                      placeholder="Type today's follow-up remarks / discussion notes…"
                      value={followupRemarks[item.id] !== undefined ? followupRemarks[item.id] : (item.followup_remarks || '')}
                      onChangeText={t => setFollowupRemarks(prev => ({ ...prev, [item.id]: t }))}
                      style={styles.followupInput}
                      multiline
                    />

                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
                      <View style={{ flexDirection: 'row', gap: 6 }}>
                        <Pressable
                          style={[styles.smallActionBtn, { backgroundColor: '#eff6ff', borderColor: '#3b82f6' }]}
                          onPress={() => handleQuickStatusChange(item.id, 'Highly Interested')}
                        >
                          <Text style={{ fontSize: 11, color: '#2563eb', fontWeight: '700' }}>★ Highly Interested</Text>
                        </Pressable>
                        <Pressable
                          style={[styles.smallActionBtn, { backgroundColor: '#f0fdf4', borderColor: '#16a34a' }]}
                          onPress={() => handleQuickStatusChange(item.id, 'Lead Converted')}
                        >
                          <Text style={{ fontSize: 11, color: '#16a34a', fontWeight: '700' }}>🎉 Lead Converted</Text>
                        </Pressable>
                      </View>

                      {!item.followup_completed && (
                        <Pressable
                          testID={`mark-followup-done-${item.id}`}
                          style={styles.markDoneBtn}
                          onPress={() => handleMarkFollowupDone(item.id)}
                        >
                          <Ionicons name="checkmark" size={14} color="#fff" />
                          <Text style={styles.markDoneBtnText}>Mark Follow-up Done</Text>
                        </Pressable>
                      )}
                    </View>
                  </View>
                )}

                {/* ========================================================================= */}
                {/* SECTION C: LEAD CONVERTED ACTIONS (Create Bill & Assign Work Task)        */}
                {/* ========================================================================= */}
                {section === 'converted' && (
                  <View style={styles.convertedActionsBox}>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                      {item.invoice_no ? (
                        <View style={[styles.linkedBadge, { backgroundColor: '#f0fdf4', borderColor: '#16a34a' }]}>
                          <Ionicons name="receipt" size={12} color="#16a34a" />
                          <Text style={[styles.linkedBadgeText, { color: '#16a34a' }]}>Bill: {item.invoice_no}</Text>
                        </View>
                      ) : null}

                      {item.task_no ? (
                        <View style={[styles.linkedBadge, { backgroundColor: '#eff6ff', borderColor: '#2563eb' }]}>
                          <Ionicons name="checkbox" size={12} color="#2563eb" />
                          <Text style={[styles.linkedBadgeText, { color: '#2563eb' }]}>Task: {item.task_no} ({item.assigned_employee_name || 'Assigned'})</Text>
                        </View>
                      ) : null}
                    </View>

                    <View style={styles.convertedBtnRow}>
                      <Pressable
                        testID={`create-bill-btn-${item.id}`}
                        style={styles.createBillActionBtn}
                        onPress={() => handleOpenBillModal(item)}
                      >
                        <Ionicons name="cash-outline" size={14} color="#fff" />
                        <Text style={styles.createBillActionBtnText}>Create Bill Against Work</Text>
                      </Pressable>

                      <Pressable
                        testID={`assign-work-btn-${item.id}`}
                        style={styles.assignWorkActionBtn}
                        onPress={() => handleOpenAssignModal(item)}
                      >
                        <Ionicons name="person-add-outline" size={14} color="#fff" />
                        <Text style={styles.assignWorkActionBtnText}>Assign Work & Auto-Generate Task</Text>
                      </Pressable>
                    </View>
                  </View>
                )}

                {/* Edit / Update / Delete Action Bar */}
                <View style={styles.cardFooterActions}>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    {isEditing ? (
                      <Pressable
                        style={styles.updateRowBtn}
                        onPress={() => handleSaveEdit(item.id)}
                        accessibilityLabel="Update (Save Changes)"
                      >
                        <Ionicons name="checkmark-circle" size={14} color="#fff" />
                        <Text style={styles.updateRowBtnText}>Update</Text>
                      </Pressable>
                    ) : (
                      <Pressable
                        style={styles.editRowBtn}
                        onPress={() => handleStartEdit(item)}
                        accessibilityLabel="Edit Calling Line"
                      >
                        <Ionicons name="pencil" size={14} color={colors.brandPrimary} />
                        <Text style={styles.editRowBtnText}>Edit</Text>
                      </Pressable>
                    )}

                    <Pressable
                      style={styles.deleteRowBtn}
                      onPress={() => handleDeleteCall(item)}
                      accessibilityLabel="Delete Calling Line"
                    >
                      <Ionicons name="trash-outline" size={14} color={colors.error} />
                      <Text style={styles.deleteRowBtnText}>Delete</Text>
                    </Pressable>
                  </View>
                </View>
              </Card>
            );
          }}
        />
      )}

      {/* ========================================================================= */}
      {/* MODAL 1: ASSIGN WORK & AUTO-GENERATE TASK IN TASK MANAGEMENT SYSTEM       */}
      {/* ========================================================================= */}
      <Modal visible={assignModalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>Assign Work & Auto-Generate Task</Text>
                <Text style={styles.modalSubtitle} numberOfLines={1}>
                  Agency: {assignTargetCall?.agency_name}
                </Text>
              </View>
              <Pressable onPress={() => setAssignModalVisible(false)}>
                <Ionicons name="close" size={24} color={colors.onSurface} />
              </Pressable>
            </View>

            <ScrollView style={{ padding: spacing.md }}>
              <Text style={styles.fieldLabel}>Select Assignee Employee:</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                {staffUsers.map((u: any) => {
                  const sel = assigneeId === u.id;
                  return (
                    <Pressable
                      key={u.id}
                      style={[styles.assigneeChip, sel && styles.assigneeChipActive]}
                      onPress={() => { setAssigneeId(u.id); setAssigneeName(u.name); }}
                    >
                      <Text style={[styles.assigneeChipText, sel && styles.assigneeChipTextActive]}>
                        👤 {u.name} ({u.role})
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={styles.fieldLabel}>Work Deadline (YYYY-MM-DD):</Text>
              <TextInput
                value={assignDeadline}
                onChangeText={setAssignDeadline}
                style={styles.modalInput}
                placeholder="2026-10-15"
              />

              <Text style={styles.fieldLabel}>Estimated Work Value (₹):</Text>
              <TextInput
                value={assignEstAmount}
                onChangeText={setAssignEstAmount}
                style={styles.modalInput}
                placeholder="25000"
                keyboardType="numeric"
              />

              <Text style={styles.fieldLabel}>Work Instructions & Task Notes:</Text>
              <TextInput
                value={assignInstructions}
                onChangeText={setAssignInstructions}
                style={[styles.modalInput, { minHeight: 80 }]}
                multiline
                placeholder="Specific instructions for bid preparation, NIT analysis, EMD deposit..."
              />

              <View style={{ marginTop: 12, gap: 8 }}>
                <PrimaryButton
                  label={submittingAssign ? "Generating Task…" : "Assign & Generate Task (TSK-xxxx)"}
                  onPress={handleSubmitAssignWork}
                  loading={submittingAssign}
                />
                <SecondaryButton
                  label="Cancel"
                  onPress={() => setAssignModalVisible(false)}
                />
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ========================================================================= */}
      {/* MODAL 2: CREATE A BILL AGAINST WORK (ACCOUNT & BILLING INTEGRATION)       */}
      {/* ========================================================================= */}
      <Modal visible={billModalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>Create Bill Against Work</Text>
                <Text style={styles.modalSubtitle} numberOfLines={1}>
                  Client: {billTargetCall?.agency_name}
                </Text>
              </View>
              <Pressable onPress={() => setBillModalVisible(false)}>
                <Ionicons name="close" size={24} color={colors.onSurface} />
              </Pressable>
            </View>

            <ScrollView style={{ padding: spacing.md }}>
              <Text style={styles.fieldLabel}>Bill Amount (₹):</Text>
              <TextInput
                value={billAmount}
                onChangeText={setBillAmount}
                style={styles.modalInput}
                placeholder="e.g. 15000"
                keyboardType="numeric"
              />

              <Text style={styles.fieldLabel}>GST / Tax Rate (%):</Text>
              <TextInput
                value={billTaxRate}
                onChangeText={setBillTaxRate}
                style={styles.modalInput}
                placeholder="18"
                keyboardType="numeric"
              />

              <Text style={styles.fieldLabel}>Service / Work Description:</Text>
              <TextInput
                value={billDesc}
                onChangeText={setBillDesc}
                style={[styles.modalInput, { minHeight: 60 }]}
                multiline
                placeholder="Tender Preparation & Bid Consultation"
              />

              <View style={styles.billCalcSummary}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={styles.billCalcText}>Subtotal:</Text>
                  <Text style={styles.billCalcVal}>₹ {(parseFloat(billAmount) || 0).toLocaleString()}</Text>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={styles.billCalcText}>GST ({(parseFloat(billTaxRate) || 18)}%):</Text>
                  <Text style={styles.billCalcVal}>
                    ₹ {(((parseFloat(billAmount) || 0) * (parseFloat(billTaxRate) || 18)) / 100).toLocaleString()}
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: '#e2e8f0', paddingTop: 4 }}>
                  <Text style={[styles.billCalcText, { fontWeight: '800' }]}>Total Invoice Value:</Text>
                  <Text style={[styles.billCalcVal, { fontWeight: '800', color: '#16a34a' }]}>
                    ₹ {(((parseFloat(billAmount) || 0) * (1 + (parseFloat(billTaxRate) || 18) / 100))).toLocaleString()}
                  </Text>
                </View>
              </View>

              <View style={{ marginTop: 12, gap: 8 }}>
                <PrimaryButton
                  label={submittingBill ? "Creating Bill…" : "Generate Invoice (INV-xxxx)"}
                  onPress={handleSubmitCreateBill}
                  loading={submittingBill}
                />
                <SecondaryButton
                  label="Cancel"
                  onPress={() => setBillModalVisible(false)}
                />
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  subSectionsBar: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    gap: 6,
  },
  subTabItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSecondary,
    gap: 6,
  },
  subTabItemActive: {
    backgroundColor: colors.brandPrimary + '15',
    borderWidth: 1,
    borderColor: colors.brandPrimary,
  },
  subTabLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.muted,
  },
  subTabLabelActive: {
    color: colors.brandPrimary,
    fontWeight: '800',
  },
  tabCountPill: {
    backgroundColor: colors.brandPrimary + '20',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
  },
  tabCountPillText: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.brandPrimary,
  },
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  statBox: {
    flex: 1,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.sm,
    padding: 8,
    borderLeftWidth: 3,
  },
  statLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.muted,
    textTransform: 'uppercase',
  },
  statVal: {
    fontSize: 16,
    fontWeight: '900',
    marginTop: 2,
  },
  adminCounterCard: {
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    padding: spacing.sm,
    backgroundColor: '#f8fafc',
    borderRadius: radius.md,
  },
  adminCounterTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.onSurface,
  },
  adminCounterSubtitle: {
    fontSize: 10,
    color: colors.muted,
    fontWeight: '600',
  },
  empBreakdownChip: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  empBreakdownChipActive: {
    borderColor: colors.brandPrimary,
    backgroundColor: colors.brandPrimary + '10',
  },
  empBreakdownName: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.onSurface,
  },
  empMetricDone: {
    fontSize: 10,
    color: '#16a34a',
    fontWeight: '700',
  },
  empMetricPending: {
    fontSize: 10,
    color: '#d97706',
    fontWeight: '700',
  },
  empMetricConv: {
    fontSize: 10,
    color: '#7c3aed',
    fontWeight: '700',
  },
  actionFilterBar: {
    flexDirection: 'row',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    gap: 8,
    alignItems: 'center',
  },
  searchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    height: 38,
    gap: 6,
  },
  searchInput: {
    flex: 1,
    fontSize: 12,
    color: colors.onSurface,
  },
  addCallingLineBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.brandPrimary,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: radius.md,
    gap: 4,
  },
  addCallingLineBtnText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#fff',
  },
  goToBillingBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#16a34a',
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: radius.md,
    gap: 4,
  },
  goToBillingBtnText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#fff',
  },
  callCard: {
    borderRadius: radius.md,
    padding: spacing.md,
    backgroundColor: '#fff',
    gap: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  callCardEditing: {
    borderColor: colors.brandPrimary,
    backgroundColor: '#f0fdf4',
  },
  callCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  slBadge: {
    backgroundColor: '#1e293b',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  slBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#fff',
  },
  agencyNameText: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.onSurface,
  },
  callerSubText: {
    fontSize: 10,
    color: colors.muted,
    marginTop: 1,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    borderWidth: 1,
    gap: 4,
  },
  statusBadgeText: {
    fontSize: 10,
    fontWeight: '800',
  },
  plusBelowBtn: {
    backgroundColor: '#10b981',
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
  },
  detailLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.muted,
    minWidth: 130,
  },
  mobileText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.onSurface,
  },
  quickContactBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#eff6ff',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    gap: 3,
  },
  quickContactText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#2563eb',
  },
  worksText: {
    fontSize: 12,
    color: colors.onSurface,
    flex: 1,
  },
  remarksText: {
    fontSize: 11,
    color: colors.muted,
    flex: 1,
  },
  recordingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  recordingChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    gap: 4,
    maxWidth: 220,
  },
  recordingChipText: {
    fontSize: 11,
    color: colors.brandPrimary,
    fontWeight: '600',
  },
  delRecordingBtn: {
    padding: 3,
  },
  uploadRecBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceSecondary,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 4,
  },
  uploadRecBtnText: {
    fontSize: 11,
    color: colors.brandPrimary,
    fontWeight: '700',
  },
  statementButtonsContainer: {
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  statementTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.muted,
    marginBottom: 6,
  },
  statementPillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  statementPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 14,
    borderWidth: 1,
    gap: 4,
  },
  statementPillText: {
    fontSize: 10,
    fontWeight: '800',
  },
  followupBox: {
    marginTop: 6,
    padding: spacing.sm,
    backgroundColor: '#fffbeb',
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: '#fde68a',
  },
  followupBoxTitle: {
    fontSize: 11,
    color: colors.onSurface,
  },
  followupInput: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#fde68a',
    borderRadius: radius.sm,
    padding: 6,
    fontSize: 11,
    color: colors.onSurface,
    minHeight: 40,
  },
  smallActionBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.sm,
    borderWidth: 1,
  },
  markDoneBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#16a34a',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.sm,
    gap: 4,
  },
  markDoneBtnText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#fff',
  },
  convertedActionsBox: {
    marginTop: 6,
    padding: spacing.sm,
    backgroundColor: '#f0fdf4',
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: '#bbf7d0',
  },
  linkedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.sm,
    borderWidth: 1,
    gap: 4,
  },
  linkedBadgeText: {
    fontSize: 11,
    fontWeight: '800',
  },
  convertedBtnRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  createBillActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#059669',
    paddingVertical: 8,
    borderRadius: radius.sm,
    gap: 4,
  },
  createBillActionBtnText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#fff',
  },
  assignWorkActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2563eb',
    paddingVertical: 8,
    borderRadius: radius.sm,
    gap: 4,
  },
  assignWorkActionBtnText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#fff',
  },
  cardFooterActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 6,
    marginTop: 2,
  },
  editRowBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.sm,
    backgroundColor: colors.brandPrimary + '15',
    gap: 4,
  },
  editRowBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.brandPrimary,
  },
  updateRowBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.sm,
    backgroundColor: '#16a34a',
    gap: 4,
  },
  updateRowBtnText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#fff',
  },
  deleteRowBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.sm,
    backgroundColor: '#fee2e2',
    gap: 4,
  },
  deleteRowBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.error,
  },
  inlineEditInput: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: colors.brandPrimary,
    borderRadius: radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 4,
    fontSize: 12,
    color: colors.onSurface,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.md,
  },
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: radius.lg,
    width: '100%',
    maxWidth: 550,
    maxHeight: '90%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.onSurface,
  },
  modalSubtitle: {
    fontSize: 12,
    color: colors.muted,
    marginTop: 2,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.onSurface,
    marginBottom: 4,
  },
  modalInput: {
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 13,
    color: colors.onSurface,
    marginBottom: 10,
  },
  assigneeChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  assigneeChipActive: {
    backgroundColor: colors.brandPrimary + '15',
    borderColor: colors.brandPrimary,
  },
  assigneeChipText: {
    fontSize: 11,
    color: colors.onSurface,
    fontWeight: '600',
  },
  assigneeChipTextActive: {
    color: colors.brandPrimary,
    fontWeight: '800',
  },
  billCalcSummary: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: 10,
    marginVertical: 10,
    gap: 4,
  },
  billCalcText: {
    fontSize: 12,
    color: colors.muted,
  },
  billCalcVal: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.onSurface,
  },
});
