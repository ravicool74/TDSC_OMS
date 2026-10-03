import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, RefreshControl, ScrollView, Modal, TextInput, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { colors, spacing, radius, font } from '@/src/theme';
import { api } from '@/src/api';
import { Card, Chip, EmptyState, ScreenLoader, StatusBadge, PrimaryButton, SecondaryButton } from '@/src/ui';
import { useAuth } from '@/src/AuthContext';
import { confirm, notify } from '@/src/dialog';

const TASK_STATUSES = ['all', 'todo', 'doing', 'done'];
const PAYMENT_STATUSES = ['all', 'pending_dues', 'cleared'];

const fmtCurr = (v: number | string | null | undefined) => {
  const n = Number(v || 0);
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

export default function TasksScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const canEdit = isAdmin || user?.role === 'manager';

  // Two Main Parts: (i) Payment Follow-up & (ii) Task Follow-up
  const [activeTab, setActiveTab] = useState<'payment_followup' | 'task_followup'>('payment_followup');
  const [tasks, setTasks] = useState<any[] | null>(null);
  const [filter, setFilter] = useState<string>('all');
  const [refreshing, setRefreshing] = useState(false);

  // Bulk select mode
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [busyBulk, setBusyBulk] = useState(false);

  // Service Workflow Configuration Modal for Admin
  const [workflowModal, setWorkflowModal] = useState(false);
  const [workflows, setWorkflows] = useState<any[]>([]);
  const [loadingWorkflows, setLoadingWorkflows] = useState(false);
  const [selectedService, setSelectedService] = useState<any | null>(null);
  const [newStageName, setNewStageName] = useState('');
  const [newStageRole, setNewStageRole] = useState('DEO');
  const [savingWorkflow, setSavingWorkflow] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.get<any[]>('/tasks');
      setTasks(data || []);
    } catch {
      setTasks([]);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Categorize tasks
  const paymentTasks = useMemo(() => {
    if (!tasks) return [];
    return tasks.filter(t => {
      const cat = t.task_category;
      if (cat) return cat === 'payment_followup';
      return (t.title && t.title.toLowerCase().includes('payment follow-up')) || ((t.dues_amount || 0) > 0 && !t.service_name);
    });
  }, [tasks]);

  const serviceTasks = useMemo(() => {
    if (!tasks) return [];
    return tasks.filter(t => {
      const cat = t.task_category;
      if (cat) return cat === 'task_followup';
      return !(t.title && t.title.toLowerCase().includes('payment follow-up')) && (!((t.dues_amount || 0) > 0 && !t.service_name));
    });
  }, [tasks]);

  const currentTabTasks = activeTab === 'payment_followup' ? paymentTasks : serviceTasks;

  const filtered = useMemo(() => {
    if (!tasks) return null;
    let list = currentTabTasks;
    if (activeTab === 'payment_followup') {
      if (filter === 'pending_dues') {
        list = list.filter(t => (t.dues_amount || 0) > 0);
      } else if (filter === 'cleared') {
        list = list.filter(t => (t.dues_amount || 0) <= 0);
      }
    } else {
      if (filter !== 'all') {
        list = list.filter(t => t.status === filter);
      }
    }
    return list;
  }, [tasks, currentTabTasks, activeTab, filter]);

  const selectedCount = useMemo(() => Object.values(selected).filter(Boolean).length, [selected]);
  const allSelected = useMemo(() => filtered && filtered.length > 0 && filtered.every(t => selected[t.id]), [filtered, selected]);

  const toggleSelect = (id: string) => setSelected(p => ({ ...p, [id]: !p[id] }));
  const enterSelectMode = (initialId?: string) => {
    if (!isAdmin) return;
    setSelectMode(true);
    if (initialId) setSelected({ [initialId]: true });
  };
  const exitSelectMode = () => { setSelectMode(false); setSelected({}); };
  const toggleSelectAll = () => {
    if (!filtered) return;
    if (allSelected) { setSelected({}); return; }
    const next: Record<string, boolean> = {};
    filtered.forEach(t => { next[t.id] = true; });
    setSelected(next);
  };

  const bulkDelete = async () => {
    const ids = Object.keys(selected).filter(k => selected[k]);
    if (ids.length === 0) return;
    const ok = await confirm('Delete Selected Tasks?', `${ids.length} task${ids.length > 1 ? 's' : ''} permanently delete kar diye jayenge. Kya aap sure hain?`, { confirmText: 'Delete All', destructive: true });
    if (!ok) return;
    setBusyBulk(true);
    try {
      const res: any = await api.post('/tasks/bulk-delete', { ids });
      notify('Deleted', `${res?.deleted || 0} tasks deleted`);
      exitSelectMode();
      await load();
    } catch (e: any) { notify('Failed', e?.message || 'Try again'); }
    finally { setBusyBulk(false); }
  };

  const deleteOne = async (id: string, taskNo: string) => {
    const ok = await confirm('Delete Task?', `${taskNo} delete kar diya jayega. Yeh action undo nahi ho sakta.`, { confirmText: 'Delete', destructive: true });
    if (!ok) return;
    try { await api.del(`/tasks/${id}`); await load(); }
    catch (e: any) { notify('Failed', e?.message || 'Try again'); }
  };

  const openWorkflowConfig = async () => {
    setWorkflowModal(true);
    setLoadingWorkflows(true);
    try {
      const list = await api.getServiceWorkflows();
      setWorkflows(list || []);
      if (list && list.length > 0) setSelectedService(list[0]);
    } catch (e: any) {
      notify('Failed to load workflows', e?.message);
    } finally {
      setLoadingWorkflows(false);
    }
  };

  const addStageToSelected = () => {
    if (!newStageName.trim() || !selectedService) return;
    const currentStages = selectedService.stages || [];
    const newStage = {
      order: currentStages.length,
      name: newStageName.trim(),
      role: newStageRole,
      description: `Stage for ${selectedService.service_name}`,
      color: '#3B82F6'
    };
    setSelectedService({
      ...selectedService,
      stages: [...currentStages, newStage]
    });
    setNewStageName('');
  };

  const removeStageFromSelected = (idx: number) => {
    if (!selectedService) return;
    const updated = (selectedService.stages || []).filter((_: any, i: number) => i !== idx);
    setSelectedService({
      ...selectedService,
      stages: updated.map((s: any, i: number) => ({ ...s, order: i }))
    });
  };

  const saveSelectedWorkflow = async () => {
    if (!selectedService) return;
    setSavingWorkflow(true);
    try {
      await api.saveServiceWorkflow({
        service_id: selectedService.service_id,
        service_name: selectedService.service_name,
        stages: selectedService.stages || []
      });
      notify('Saved', `Workflow for ${selectedService.service_name} updated successfully!`);
      const list = await api.getServiceWorkflows();
      setWorkflows(list || []);
    } catch (e: any) {
      Alert.alert('Save Failed', e?.message || 'Try again');
    } finally {
      setSavingWorkflow(false);
    }
  };

  return (
    <SafeAreaView edges={['top']} style={styles.root} testID="tasks-screen">
      {/* Top Header */}
      <View style={styles.header}>
        {selectMode ? (
          <>
            <Pressable onPress={exitSelectMode} testID="exit-select" hitSlop={10}>
              <Ionicons name="close" size={26} color={colors.onSurface} />
            </Pressable>
            <Text style={styles.h1}>{selectedCount} selected</Text>
            <Pressable onPress={toggleSelectAll} testID="select-all" style={styles.selBtn}>
              <Ionicons name={allSelected ? 'checkbox' : 'square-outline'} size={20} color={colors.brandPrimary} />
              <Text style={styles.selBtnTxt}>{allSelected ? 'Deselect All' : 'Select All'}</Text>
            </Pressable>
          </>
        ) : (
          <>
            <View>
              <Text style={styles.h1}>Tasks & Workflows</Text>
              <Text style={styles.subTitle}>Follow-ups, Online Chat & Service Engine</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              {isAdmin && activeTab === 'task_followup' ? (
                <Pressable testID="btn-service-workflows" style={styles.workflowConfigBtn} onPress={openWorkflowConfig}>
                  <Ionicons name="git-network-outline" size={18} color="#FFF" />
                  <Text style={styles.workflowConfigBtnText}>Workflows</Text>
                </Pressable>
              ) : null}
              {isAdmin ? (
                <Pressable testID="enter-select" style={styles.iconBtn} onPress={() => enterSelectMode()} hitSlop={8}>
                  <Ionicons name="checkbox-outline" size={22} color={colors.brandPrimary} />
                </Pressable>
              ) : null}
              <Pressable
                testID="add-task"
                style={styles.addBtn}
                onPress={() => router.push({ pathname: '/tasks/new', params: { category: activeTab } } as any)}
              >
                <Ionicons name="add" size={24} color={colors.onBrandPrimary} />
              </Pressable>
            </View>
          </>
        )}
      </View>

      {/* Two-Part Menu Division Segment Control */}
      {!selectMode && (
        <View style={styles.segmentedContainer}>
          <Pressable
            testID="tab-payment-followup"
            style={[styles.segmentBtn, activeTab === 'payment_followup' && styles.segmentBtnActivePay]}
            onPress={() => { setActiveTab('payment_followup'); setFilter('all'); }}
          >
            <Ionicons
              name={activeTab === 'payment_followup' ? 'cash' : 'cash-outline'}
              size={18}
              color={activeTab === 'payment_followup' ? '#B45309' : colors.muted}
            />
            <Text style={[styles.segmentText, activeTab === 'payment_followup' && styles.segmentTextActivePay]}>
              (i) Payment Follow-up
            </Text>
            <View style={[styles.segmentBadge, activeTab === 'payment_followup' ? { backgroundColor: '#FEF3C7' } : { backgroundColor: '#F1F5F9' }]}>
              <Text style={[styles.segmentBadgeText, activeTab === 'payment_followup' ? { color: '#B45309' } : { color: colors.muted }]}>
                {paymentTasks.length}
              </Text>
            </View>
          </Pressable>

          <Pressable
            testID="tab-task-followup"
            style={[styles.segmentBtn, activeTab === 'task_followup' && styles.segmentBtnActiveTask]}
            onPress={() => { setActiveTab('task_followup'); setFilter('all'); }}
          >
            <Ionicons
              name={activeTab === 'task_followup' ? 'git-commit' : 'git-commit-outline'}
              size={18}
              color={activeTab === 'task_followup' ? colors.brandPrimary : colors.muted}
            />
            <Text style={[styles.segmentText, activeTab === 'task_followup' && styles.segmentTextActiveTask]}>
              (ii) Task Follow-up
            </Text>
            <View style={[styles.segmentBadge, activeTab === 'task_followup' ? { backgroundColor: '#DBEAFE' } : { backgroundColor: '#F1F5F9' }]}>
              <Text style={[styles.segmentBadgeText, activeTab === 'task_followup' ? { color: colors.brandPrimary } : { color: colors.muted }]}>
                {serviceTasks.length}
              </Text>
            </View>
          </Pressable>
        </View>
      )}

      {/* Filter Chips */}
      {!selectMode && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
          {(activeTab === 'payment_followup' ? PAYMENT_STATUSES : TASK_STATUSES).map(s => {
            const label = s === 'all' ? 'All' :
                          s === 'pending_dues' ? 'Pending Dues' :
                          s === 'cleared' ? 'Cleared' : s.toUpperCase();
            return (
              <Chip
                key={s}
                label={label}
                selected={filter === s}
                onPress={() => setFilter(s)}
                testID={`filter-${s}`}
              />
            );
          })}
        </ScrollView>
      )}

      {/* Task List */}
      {filtered === null ? (
        <ScreenLoader />
      ) : filtered.length === 0 ? (
        <EmptyState
          testID="tasks-empty"
          icon={activeTab === 'payment_followup' ? 'cash-outline' : 'git-network-outline'}
          title={activeTab === 'payment_followup' ? 'No Payment Follow-ups' : 'No Service Tasks'}
          subtitle={
            activeTab === 'payment_followup'
              ? 'Invoices with pending balance and payment follow-ups will appear here.'
              : 'Create service operational workflow tasks or configure service stages.'
          }
          actionLabel={activeTab === 'payment_followup' ? 'New Payment Follow-up' : 'Create Task'}
          onAction={() => router.push({ pathname: '/tasks/new', params: { category: activeTab } } as any)}
        />
      ) : (
        <FlatList
          testID="task-list"
          data={filtered}
          keyExtractor={(i) => i.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: selectMode ? 120 : spacing.xxxl }}
          renderItem={({ item }) => {
            const isPay = activeTab === 'payment_followup';
            const stagesLen = (item.workflow_stages || item.stages || []).length;
            const idx = item.current_stage_index ?? (item.stages || []).findIndex((s: any) => s.id === item.current_stage_id);
            const progress = stagesLen > 0 ? Math.max(0, (idx + 1) / stagesLen) : 0;
            const isSelected = !!selected[item.id];
            const hasDues = (item.dues_amount || 0) > 0;

            return (
              <Pressable
                testID={`task-${item.id}`}
                onLongPress={() => enterSelectMode(item.id)}
                onPress={() => selectMode ? toggleSelect(item.id) : router.push(`/tasks/${item.id}` as any)}
              >
                <Card style={[
                  styles.taskCard,
                  isPay && styles.paymentCardBorder,
                  selectMode && isSelected && { borderColor: colors.brandPrimary, borderWidth: 2 }
                ]}>
                  {/* Card Header */}
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    {selectMode ? (
                      <Pressable onPress={() => toggleSelect(item.id)} testID={`check-${item.id}`} hitSlop={8} style={{ marginRight: 10, marginTop: 2 }}>
                        <Ionicons name={isSelected ? 'checkbox' : 'square-outline'} size={24} color={isSelected ? colors.brandPrimary : colors.muted} />
                      </Pressable>
                    ) : null}

                    <View style={{ flex: 1, paddingRight: spacing.sm }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <Text style={[styles.taskNo, isPay && { color: '#B45309' }]}>
                          {item.task_id || item.task_no || 'TSK'}
                        </Text>
                        {item.service_name || item.task_type_name ? (
                          <View style={styles.serviceTag}>
                            <Text style={styles.serviceTagText}>{item.service_name || item.task_type_name}</Text>
                          </View>
                        ) : null}
                      </View>

                      <Text style={styles.title} numberOfLines={2}>{item.title}</Text>

                      {/* Customer / Party details */}
                      {item.customer_name ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 }}>
                          <Ionicons name="business" size={13} color={colors.muted} />
                          <Text style={styles.customerName}>{item.customer_name}</Text>
                          {item.customer_mobile ? <Text style={styles.muted}>• {item.customer_mobile}</Text> : null}
                        </View>
                      ) : null}

                      {/* Assigned Employee (Fixed for chat / follow-up) */}
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 }}>
                        <Ionicons name="person-circle-outline" size={14} color={colors.brandPrimary} />
                        <Text style={styles.assigneeText}>
                          {item.assigned_name || item.assignee_name || 'Unassigned'}
                        </Text>
                        {item.deadline || item.due_date ? (
                          <>
                            <Ionicons name="calendar-outline" size={13} color={colors.muted} style={{ marginLeft: 8 }} />
                            <Text style={styles.muted}>Due: {item.deadline || item.due_date}</Text>
                          </>
                        ) : null}
                      </View>
                    </View>

                    <StatusBadge status={item.status} />
                  </View>

                  {/* Workflow Stepper Bar for Service Tasks */}
                  {!isPay && stagesLen > 0 && (
                    <View style={styles.progressWrap}>
                      <View style={styles.progressBar}>
                        <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
                      </View>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Text style={styles.progressLabel}>
                          Stage {Math.max(idx + 1, 1)}/{stagesLen}: <Text style={{ fontWeight: '800', color: colors.brandPrimary }}>{item.current_stage_name || 'In Progress'}</Text>
                        </Text>
                        <Text style={styles.progressPercent}>{Math.round(progress * 100)}%</Text>
                      </View>
                    </View>
                  )}

                  {/* Amounts Row (Strict formatting Display as: ₹<amount>) */}
                  {((item.total_amount || 0) > 0 || (item.dues_amount || 0) > 0 || isPay) && (
                    <View style={styles.amountBar}>
                      <View style={styles.amountPill}>
                        <Text style={styles.amountLbl}>Total:</Text>
                        <Text style={styles.amountVal}>{fmtCurr(item.total_amount)}</Text>
                      </View>
                      <View style={styles.amountPill}>
                        <Text style={styles.amountLbl}>Paid:</Text>
                        <Text style={[styles.amountVal, { color: colors.success }]}>{fmtCurr(item.paid_amount)}</Text>
                      </View>
                      <View style={[styles.amountPill, hasDues && styles.duesAlertPill]}>
                        <Text style={[styles.amountLbl, hasDues && { color: colors.error }]}>Dues:</Text>
                        <Text style={[styles.amountVal, { color: hasDues ? colors.error : colors.success }]}>
                          {fmtCurr(item.dues_amount)}
                        </Text>
                      </View>
                    </View>
                  )}

                  {/* Action Bar: Online Chat Button + Stage Transitions + Admin Controls */}
                  <View style={styles.bottomRow}>
                    <View style={[styles.priority, {
                      backgroundColor: item.priority === 'high' ? colors.error + '20' : item.priority === 'low' ? colors.success + '20' : colors.warning + '20'
                    }]}>
                      <Text style={{
                        color: item.priority === 'high' ? colors.error : item.priority === 'low' ? colors.success : colors.warning,
                        fontSize: 10,
                        fontWeight: '800'
                      }}>
                        {(item.priority || 'medium').toUpperCase()}
                      </Text>
                    </View>

                    {/* Online Chat Button - User requested chat option replacing comment */}
                    <Pressable
                      testID={`chat-${item.id}`}
                      style={[styles.chatBtn, isPay ? styles.chatBtnPay : styles.chatBtnTask]}
                      onPress={(e) => {
                        e?.stopPropagation?.();
                        router.push({ pathname: `/tasks/${item.id}`, params: { openChat: 'true' } } as any);
                      }}
                    >
                      <Ionicons name="chatbubbles" size={15} color="#FFF" />
                      <Text style={styles.chatBtnText}>
                        {isPay ? 'Online Chat' : 'Chat & Notes'}
                      </Text>
                    </Pressable>

                    {!selectMode ? (
                      <View style={{ flex: 1, flexDirection: 'row', justifyContent: 'flex-end', gap: 6 }}>
                        <Pressable
                          testID={`view-${item.id}`}
                          onPress={(e) => { e?.stopPropagation?.(); router.push(`/tasks/${item.id}` as any); }}
                          style={styles.viewBtn}
                        >
                          <Ionicons name="chevron-forward-circle-outline" size={15} color={colors.brandPrimary} />
                          <Text style={styles.viewBtnText}>Workflow</Text>
                        </Pressable>

                        {canEdit ? (
                          <Pressable
                            testID={`edit-${item.id}`}
                            onPress={(e) => { e?.stopPropagation?.(); router.push({ pathname: '/tasks/new', params: { edit_id: item.id } } as any); }}
                            style={styles.rowActBtn}
                          >
                            <Ionicons name="create-outline" size={14} color="#B45309" />
                          </Pressable>
                        ) : null}

                        {isAdmin ? (
                          <Pressable
                            testID={`del-${item.id}`}
                            onPress={(e) => { e?.stopPropagation?.(); deleteOne(item.id, item.task_no || item.task_id); }}
                            style={[styles.rowActBtn, { backgroundColor: '#FEE2E2' }]}
                          >
                            <Ionicons name="trash-outline" size={14} color={colors.error} />
                          </Pressable>
                        ) : null}
                      </View>
                    ) : null}
                  </View>
                </Card>
              </Pressable>
            );
          }}
        />
      )}

      {/* Bulk-action bar */}
      {selectMode ? (
        <View style={styles.bulkBar} testID="bulk-bar">
          <Pressable testID="bulk-cancel" onPress={exitSelectMode} style={[styles.bulkBtn, { backgroundColor: colors.surfaceSecondary }]}>
            <Text style={{ color: colors.onSurface, fontWeight: '700' }}>Cancel</Text>
          </Pressable>
          <Pressable
            testID="bulk-delete"
            disabled={selectedCount === 0 || busyBulk}
            onPress={bulkDelete}
            style={[styles.bulkBtn, { backgroundColor: selectedCount === 0 ? '#CA5F5F' : colors.error, opacity: selectedCount === 0 || busyBulk ? 0.5 : 1 }]}
          >
            <Ionicons name="trash" size={16} color="#FFF" />
            <Text style={{ color: '#FFF', fontWeight: '800' }}>{busyBulk ? 'Deleting…' : `Delete Selected (${selectedCount})`}</Text>
          </Pressable>
        </View>
      ) : null}

      {/* Admin Service Workflow Configuration Modal */}
      <Modal visible={workflowModal} animationType="slide" transparent onRequestClose={() => setWorkflowModal(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.wfModalCard}>
            <View style={styles.wfModalHeader}>
              <View>
                <Text style={styles.wfModalTitle}>Service Workflow Chart Engine</Text>
                <Text style={styles.wfModalSubtitle}>Har Service ke liye custom workflow stages define karein</Text>
              </View>
              <Pressable onPress={() => setWorkflowModal(false)} hitSlop={10}>
                <Ionicons name="close" size={24} color={colors.onSurface} />
              </Pressable>
            </View>

            {loadingWorkflows ? (
              <ActivityIndicator size="large" color={colors.brandPrimary} style={{ marginVertical: 40 }} />
            ) : (
              <View style={{ flex: 1 }}>
                {/* Horizontal Service Selector */}
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.wfServiceRow}>
                  {workflows.map((wf) => (
                    <Pressable
                      key={wf.id || wf.service_name}
                      onPress={() => setSelectedService(wf)}
                      style={[styles.wfServiceChip, selectedService?.service_name === wf.service_name && styles.wfServiceChipActive]}
                    >
                      <Text style={[styles.wfServiceChipText, selectedService?.service_name === wf.service_name && { color: '#FFF' }]}>
                        {wf.service_name}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>

                {/* Stages List for Selected Service */}
                {selectedService && (
                  <ScrollView style={{ flex: 1, padding: spacing.md }}>
                    <Text style={styles.sectionHeader}>
                      {selectedService.service_name} — Defined Workflow Stages:
                    </Text>

                    <View style={{ gap: 8, marginTop: 8 }}>
                      {(selectedService.stages || []).map((stg: any, sIdx: number) => (
                        <View key={sIdx} style={styles.stageItemCard}>
                          <View style={styles.stageNumCircle}>
                            <Text style={styles.stageNumText}>{sIdx + 1}</Text>
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.stageItemTitle}>{stg.name}</Text>
                            <Text style={styles.stageItemRole}>Required Role: {stg.role || 'Any'}</Text>
                            {stg.description ? <Text style={styles.stageItemDesc}>{stg.description}</Text> : null}
                          </View>
                          <Pressable onPress={() => removeStageFromSelected(sIdx)} hitSlop={8} style={{ padding: 4 }}>
                            <Ionicons name="trash-outline" size={18} color={colors.error} />
                          </Pressable>
                        </View>
                      ))}
                    </View>

                    {/* Add Stage Row */}
                    <View style={styles.addStageBox}>
                      <Text style={{ fontWeight: '700', fontSize: 13, color: colors.onSurface }}>+ Add New Stage to Workflow</Text>
                      <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
                        <TextInput
                          style={[styles.input, { flex: 2 }]}
                          placeholder="Stage name (e.g. Document Verification)"
                          value={newStageName}
                          onChangeText={setNewStageName}
                        />
                        <TextInput
                          style={[styles.input, { flex: 1 }]}
                          placeholder="Role (DEO/Accountant/Manager/Admin)"
                          value={newStageRole}
                          onChangeText={setNewStageRole}
                        />
                        <Pressable onPress={addStageToSelected} style={styles.addStageBtn}>
                          <Ionicons name="add" size={20} color="#FFF" />
                        </Pressable>
                      </View>
                    </View>
                  </ScrollView>
                )}

                {/* Footer Save */}
                <View style={styles.wfModalFooter}>
                  <SecondaryButton label="Close" onPress={() => setWorkflowModal(false)} style={{ flex: 1 }} />
                  <PrimaryButton
                    label={savingWorkflow ? 'Saving...' : 'Save Workflow'}
                    onPress={saveSelectedWorkflow}
                    loading={savingWorkflow}
                    style={{ flex: 2 }}
                  />
                </View>
              </View>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceSecondary },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm, gap: 12 },
  h1: { fontSize: font.xl, fontWeight: '900', color: colors.onSurface, letterSpacing: -0.5 },
  subTitle: { fontSize: font.xs, color: colors.muted, marginTop: 1 },
  addBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.brandPrimary, alignItems: 'center', justifyContent: 'center' },
  iconBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#EFF6FF', alignItems: 'center', justifyContent: 'center' },
  workflowConfigBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#1E293B', paddingHorizontal: 12, paddingVertical: 9, borderRadius: radius.pill },
  workflowConfigBtnText: { color: '#FFF', fontWeight: '800', fontSize: 12 },
  selBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: '#EFF6FF' },
  selBtnTxt: { color: colors.brandPrimary, fontWeight: '800', fontSize: 12 },

  // Two Part Segmented Control
  segmentedContainer: { flexDirection: 'row', paddingHorizontal: spacing.lg, gap: 10, marginTop: 4, marginBottom: 4 },
  segmentBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, paddingHorizontal: 8, borderRadius: radius.lg, backgroundColor: '#FFF', borderWidth: 1.5, borderColor: '#E2E8F0' },
  segmentBtnActivePay: { borderColor: '#F59E0B', backgroundColor: '#FFFBEB' },
  segmentBtnActiveTask: { borderColor: colors.brandPrimary, backgroundColor: '#EFF6FF' },
  segmentText: { fontSize: 12, fontWeight: '700', color: colors.muted },
  segmentTextActivePay: { color: '#B45309', fontWeight: '900' },
  segmentTextActiveTask: { color: colors.brandPrimary, fontWeight: '900' },
  segmentBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.pill },
  segmentBadgeText: { fontSize: 11, fontWeight: '800' },

  chipsRow: { paddingHorizontal: spacing.lg, gap: spacing.sm, paddingVertical: spacing.sm, alignItems: 'center' },

  taskCard: { borderRadius: radius.lg, padding: spacing.md, backgroundColor: '#FFF' },
  paymentCardBorder: { borderLeftWidth: 4, borderLeftColor: '#F59E0B' },
  taskNo: { color: colors.brandPrimary, fontWeight: '800', fontSize: font.sm },
  serviceTag: { backgroundColor: '#F1F5F9', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  serviceTagText: { color: '#475569', fontSize: 11, fontWeight: '700' },
  title: { fontSize: font.base, fontWeight: '800', color: colors.onSurface, marginTop: 4 },
  customerName: { color: '#1E293B', fontWeight: '700', fontSize: 12 },
  assigneeText: { color: colors.brandPrimary, fontWeight: '700', fontSize: 12 },
  muted: { color: colors.muted, fontSize: 12 },

  progressWrap: { marginTop: spacing.sm, gap: 4, backgroundColor: '#F8FAFC', padding: 8, borderRadius: radius.md },
  progressBar: { height: 6, borderRadius: 3, backgroundColor: '#E2E8F0', overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: colors.brandPrimary, borderRadius: 3 },
  progressLabel: { color: '#475569', fontSize: 11 },
  progressPercent: { color: colors.brandPrimary, fontSize: 11, fontWeight: '800' },

  amountBar: { flexDirection: 'row', gap: 6, marginTop: spacing.sm, flexWrap: 'wrap' },
  amountPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E2E8F0' },
  duesAlertPill: { backgroundColor: '#FEF2F2', borderColor: '#FECACA' },
  amountLbl: { color: colors.muted, fontSize: 11, fontWeight: '600' },
  amountVal: { color: colors.onSurface, fontWeight: '800', fontSize: 12 },

  bottomRow: { flexDirection: 'row', gap: 8, marginTop: spacing.md, alignItems: 'center' },
  priority: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  chatBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill },
  chatBtnPay: { backgroundColor: '#D97706' },
  chatBtnTask: { backgroundColor: colors.brandPrimary },
  chatBtnText: { color: '#FFF', fontWeight: '800', fontSize: 11 },
  viewBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: '#EFF6FF' },
  viewBtnText: { color: colors.brandPrimary, fontWeight: '700', fontSize: 11 },
  rowActBtn: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FEF3C7' },

  bulkBar: { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', gap: 8, padding: spacing.lg, backgroundColor: '#FFF', borderTopWidth: 1, borderTopColor: colors.border },
  bulkBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 14, borderRadius: radius.md },

  // Workflow Modal
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.6)', justifyContent: 'center', padding: spacing.md },
  wfModalCard: { backgroundColor: '#FFF', borderRadius: radius.xl, maxHeight: '90%', overflow: 'hidden', flex: 1 },
  wfModalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border },
  wfModalTitle: { fontSize: font.lg, fontWeight: '800', color: '#0F172A' },
  wfModalSubtitle: { fontSize: font.xs, color: colors.muted, marginTop: 2 },
  wfServiceRow: { padding: spacing.md, gap: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
  wfServiceChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: '#F1F5F9' },
  wfServiceChipActive: { backgroundColor: colors.brandPrimary },
  wfServiceChipText: { fontSize: 12, fontWeight: '700', color: '#475569' },
  sectionHeader: { fontSize: 13, fontWeight: '800', color: '#0F172A', marginBottom: 6 },
  stageItemCard: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: radius.md, backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E2E8F0' },
  stageNumCircle: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.brandPrimary, alignItems: 'center', justifyContent: 'center' },
  stageNumText: { color: '#FFF', fontWeight: '800', fontSize: 12 },
  stageItemTitle: { fontSize: 13, fontWeight: '800', color: '#0F172A' },
  stageItemRole: { fontSize: 11, fontWeight: '700', color: colors.brandPrimary },
  stageItemDesc: { fontSize: 11, color: colors.muted, marginTop: 2 },
  addStageBox: { marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: '#F1F5F9', gap: 4 },
  input: { backgroundColor: '#FFF', borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 10, paddingVertical: 6, fontSize: 12 },
  addStageBtn: { width: 36, height: 36, borderRadius: radius.md, backgroundColor: colors.brandPrimary, alignItems: 'center', justifyContent: 'center' },
  wfModalFooter: { flexDirection: 'row', gap: 10, padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.border },
});
