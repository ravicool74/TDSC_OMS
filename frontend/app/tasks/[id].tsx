import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Modal, TextInput, KeyboardAvoidingView, Platform, Alert, ActivityIndicator, FlatList } from 'react-native';
import { useLocalSearchParams, useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { colors, spacing, radius, font } from '@/src/theme';
import { api, tokenStore } from '@/src/api';
import { Card, PrimaryButton, ScreenLoader, SecondaryButton, StatusBadge } from '@/src/ui';
import { ScreenHeader } from '@/src/ScreenHeader';
import { useAuth } from '@/src/AuthContext';
import { confirm, notify } from '@/src/dialog';
import { canWrite, canAction } from '@/src/rbac';

const MAX = 10 * 1024 * 1024;
const humanSize = (b: number) => b < 1024 ? `${b} B` : b < 1024 * 1024 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1024 / 1024).toFixed(2)} MB`;

const DEFAULT_STAGES = [
  { index: 0, order: 0, name: 'Data Entry Operator', short: 'DEO', role: 'DEO' },
  { index: 1, order: 1, name: 'Accountant', short: 'Accountant', role: 'Accountant' },
  { index: 2, order: 2, name: 'Manager', short: 'Manager', role: 'Manager' },
  { index: 3, order: 3, name: 'Admin', short: 'Admin', role: 'Admin' },
];

const fmtCurr = (v: number | string | null | undefined) => {
  const n = Number(v || 0);
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

export default function TaskDetail() {
  const { id, openChat } = useLocalSearchParams<{ id: string; openChat?: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';

  const [t, setT] = useState<any | null>(null);
  const [employees, setEmployees] = useState<any[]>([]);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Workflow Action State
  const [actionModal, setActionModal] = useState<string | null>(null); // 'approve' | 'forward' | 'return' | 'reject'
  const [actionRemarks, setActionRemarks] = useState('');
  const [actionTargetStage, setActionTargetStage] = useState<number | null>(null);
  const [actionTargetAssignee, setActionTargetAssignee] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  // Online Chat / Chatbot Thread State
  const [chatMessages, setChatMessages] = useState<any[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatSending, setChatSending] = useState(false);
  const [chatLoading, setChatLoading] = useState(false);

  // Admin Manage Chat Participants State
  const [participantsModal, setParticipantsModal] = useState(false);
  const [chatParticipants, setChatParticipants] = useState<string[]>([]);
  const [savingParticipants, setSavingParticipants] = useState(false);

  const scrollViewRef = useRef<ScrollView>(null);
  const chatScrollRef = useRef<ScrollView>(null);

  const load = useCallback(async () => {
    try {
      const [task, emps] = await Promise.all([
        api.get<any>(`/tasks/${id}`),
        api.get<any[]>('/employees').catch(() => []),
      ]);
      setT(task);
      setEmployees(emps);
      setChatParticipants(task.chat_participants || []);
    } catch {}
  }, [id]);

  const loadChat = useCallback(async () => {
    if (!id) return;
    try {
      const msgs = await api.getTaskChat(String(id));
      setChatMessages(msgs || []);
    } catch (e) {
      // User might not have chat access
    }
  }, [id]);

  useFocusEffect(useCallback(() => {
    load();
    loadChat();
  }, [load, loadChat]));

  // Auto-poll chat every 4 seconds
  useEffect(() => {
    const timer = setInterval(() => {
      loadChat();
    }, 4000);
    return () => clearInterval(timer);
  }, [loadChat]);

  // Scroll to chat if opened with openChat=true
  useEffect(() => {
    if (openChat === 'true' && scrollViewRef.current) {
      setTimeout(() => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
      }, 500);
    }
  }, [openChat]);

  const canEdit = isAdmin || user?.role === 'manager' || t?.created_by === user?.user_id || t?.assigned_user === user?.user_id || canWrite(user, 'tasks') || canAction(user, 'tasks', 'edit');

  // Resolve service workflow stages dynamically
  const pipelineStages = useMemo(() => {
    if (!t) return DEFAULT_STAGES;
    const stages = t.workflow_stages || t.stages;
    if (stages && stages.length > 0) {
      return stages.map((s: any, idx: number) => ({
        index: idx,
        order: s.order ?? idx,
        name: s.name,
        short: s.role || s.name.slice(0, 10),
        role: s.role || 'Team',
        description: s.description,
      }));
    }
    return DEFAULT_STAGES;
  }, [t]);

  const currentStageIdx = t?.current_stage_index ?? 0;
  const isCompleted = t?.status === 'completed';
  const isRejected = t?.status === 'rejected';

  const performWorkflowAction = async (actionType: string) => {
    if ((actionType === 'reject' || actionType === 'return') && !actionRemarks.trim()) {
      Alert.alert('Remarks Required', `Please enter a mandatory reason/remarks to ${actionType} this task.`);
      return;
    }
    setActionBusy(true);
    try {
      const payload: any = { action: actionType, remarks: actionRemarks.trim() || undefined };
      if (actionTargetStage !== null) payload.target_stage_index = actionTargetStage;
      if (actionTargetAssignee) payload.assigned_user_id = actionTargetAssignee;

      await api.post(`/tasks-workflow/${id}/action`, payload);
      setActionModal(null);
      setActionRemarks('');
      setActionTargetStage(null);
      setActionTargetAssignee(null);
      await Promise.all([load(), loadChat()]);
      notify('Success', `Task ${actionType.toUpperCase()} action executed.`);
    } catch (e: any) {
      Alert.alert('Action Failed', e?.message || 'Try again');
    } finally {
      setActionBusy(false);
    }
  };

  const sendChatMessage = async () => {
    if (!chatInput.trim() || chatSending) return;
    const text = chatInput.trim();
    setChatSending(true);
    try {
      await api.sendTaskChatMessage(String(id), text);
      setChatInput('');
      await loadChat();
      setTimeout(() => chatScrollRef.current?.scrollToEnd({ animated: true }), 100);
    } catch (e: any) {
      Alert.alert('Chat Failed', e?.message || 'Unable to send message');
    } finally {
      setChatSending(false);
    }
  };

  const toggleParticipant = (empId: string) => {
    setChatParticipants(prev =>
      prev.includes(empId) ? prev.filter(x => x !== empId) : [...prev, empId]
    );
  };

  const saveParticipants = async () => {
    setSavingParticipants(true);
    try {
      await api.updateTaskChatParticipants(String(id), chatParticipants);
      notify('Participants Updated', 'Admin has fixed the employee chat participants for this task.');
      setParticipantsModal(false);
      await Promise.all([load(), loadChat()]);
    } catch (e: any) {
      Alert.alert('Failed', e?.message || 'Could not update participants');
    } finally {
      setSavingParticipants(false);
    }
  };

  const toggleSub = async (subId: string) => {
    const subs = (t.sub_tasks || []).map((s: any) => s.id === subId ? { ...s, done: !s.done } : s);
    try {
      const u = await api.patch<any>(`/tasks/${id}`, { sub_tasks: subs });
      setT(u);
    } catch {}
  };

  const pickAndUpload = async () => {
    setErr(null);
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true, multiple: true });
      if (res.canceled || !res.assets?.length) return;
      setUploading(true);
      let updated: any = t;
      for (const asset of res.assets) {
        if (asset.size && asset.size > MAX) { setErr(`"${asset.name}" > 10 MB. Skipped.`); continue; }
        try {
          updated = await api.uploadTaskFile(String(id), { uri: asset.uri, name: asset.name, type: asset.mimeType || 'application/octet-stream' });
        } catch (e: any) { setErr(e?.message || `Upload failed`); }
      }
      if (updated) setT(updated);
    } finally { setUploading(false); }
  };

  const removeAttachment = async (path: string) => {
    try {
      const u = await api.del<any>(`/tasks/${id}/attachments?path=${encodeURIComponent(path)}`);
      setT(u);
    } catch {}
  };

  const openFile = async (path: string) => {
    const token = await tokenStore.get();
    const url = `${api.base}/api/files/${path}?token=${encodeURIComponent(token || '')}`;
    if (Platform.OS === 'web') window.open(url, '_blank');
    else {
      const Linking = await import('expo-linking');
      await Linking.openURL(url);
    }
  };

  if (!t) return (
    <View style={{ flex: 1, backgroundColor: colors.surfaceSecondary }}>
      <ScreenHeader title="Task Details" />
      <ScreenLoader />
    </View>
  );

  const workflowHistory: any[] = t.workflow_history || [];
  const attachments: any[] = t.attachments || [];
  const subs: any[] = t.sub_tasks || [];
  const doneSubs = subs.filter(s => s.done).length;
  const isPayTask = t.task_category === 'payment_followup' || t.title?.toLowerCase().includes('payment follow-up');

  return (
    <View style={{ flex: 1, backgroundColor: colors.surfaceSecondary }} testID="task-detail">
      <ScreenHeader
        title={t.task_id || t.task_no || 'Task'}
        right={(
          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
            {isAdmin ? (
              <Pressable
                testID="btn-manage-participants"
                hitSlop={8}
                onPress={() => setParticipantsModal(true)}
                style={styles.headerParticipantBtn}
              >
                <Ionicons name="people" size={16} color="#FFF" />
                <Text style={styles.headerParticipantBtnText}>Chat Users</Text>
              </Pressable>
            ) : null}

            {canEdit ? (
              <Pressable
                testID="edit-task-hdr"
                hitSlop={8}
                onPress={() => router.push({ pathname: '/tasks/new', params: { edit_id: id } } as any)}
              >
                <Ionicons name="create-outline" size={22} color="#B45309" />
              </Pressable>
            ) : null}

            {isAdmin ? (
              <Pressable
                testID="del-task-hdr"
                hitSlop={8}
                onPress={async () => {
                  const ok = await confirm('Delete Task?', `${t.task_id || t.title} delete kar diya jayega.`, { confirmText: 'Delete', destructive: true });
                  if (!ok) return;
                  try { await api.del(`/tasks/${id}`); router.back(); }
                  catch (e: any) { notify('Failed', e?.message || 'Try again'); }
                }}
              >
                <Ionicons name="trash-outline" size={22} color={colors.error} />
              </Pressable>
            ) : null}
          </View>
        )}
      />

      <ScrollView ref={scrollViewRef} contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxxl }}>
        {/* Task Basic Overview Card */}
        <Card style={isPayTask ? styles.payTaskBorder : undefined}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <View style={{ flex: 1, paddingRight: spacing.md }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <Text style={[styles.taskNo, isPayTask && { color: '#B45309' }]}>
                  {t.task_id || t.task_no || 'TASK'}
                </Text>
                <View style={[styles.categoryBadge, isPayTask ? { backgroundColor: '#FEF3C7' } : { backgroundColor: '#DBEAFE' }]}>
                  <Text style={[styles.categoryBadgeText, isPayTask ? { color: '#B45309' } : { color: colors.brandPrimary }]}>
                    {isPayTask ? 'Payment Follow-up' : 'Service Workflow'}
                  </Text>
                </View>
                {t.service_name || t.project ? (
                  <View style={styles.serviceTag}><Text style={styles.serviceTagText}>{t.service_name || t.project}</Text></View>
                ) : null}
              </View>

              <Text style={styles.title}>{t.title}</Text>
              {t.description ? <Text style={styles.desc}>{t.description}</Text> : null}
            </View>
            <StatusBadge status={t.status} />
          </View>

          <View style={styles.metaRow}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Ionicons name="person" size={14} color={colors.brandPrimary} />
              <Text style={styles.metaTextBold}>{t.assigned_name || t.assignee_name || 'Unassigned'}</Text>
            </View>
            {t.due_date || t.deadline ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Ionicons name="calendar" size={14} color={colors.muted} />
                <Text style={styles.metaText}>{t.due_date || t.deadline}</Text>
              </View>
            ) : null}
            {t.voucher_no ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Ionicons name="receipt-outline" size={14} color={colors.muted} />
                <Text style={styles.metaText}>Bill: {t.voucher_no}</Text>
              </View>
            ) : null}
          </View>

          {/* Monetary Amounts Bar strictly formatted as Display as: ₹<amount> */}
          {((t.total_amount || 0) > 0 || (t.dues_amount || 0) > 0 || isPayTask) && (
            <View style={styles.amountsRow}>
              <View style={styles.amount}>
                <Text style={styles.amountLbl}>Total</Text>
                <Text style={styles.amountVal}>{fmtCurr(t.total_amount)}</Text>
              </View>
              <View style={styles.amount}>
                <Text style={styles.amountLbl}>Paid</Text>
                <Text style={[styles.amountVal, { color: colors.success }]}>{fmtCurr(t.paid_amount)}</Text>
              </View>
              <View style={[styles.amount, (t.dues_amount || 0) > 0 && { backgroundColor: '#FEF2F2' }]}>
                <Text style={[styles.amountLbl, (t.dues_amount || 0) > 0 && { color: colors.error }]}>Dues Balance</Text>
                <Text style={[styles.amountVal, { color: (t.dues_amount || 0) > 0 ? colors.error : colors.success }]}>
                  {fmtCurr(t.dues_amount)}
                </Text>
              </View>
            </View>
          )}
        </Card>

        {/* ============================================================== */}
        {/* Per-Service Defined Workflow Stepper Chart Engine              */}
        {/* ============================================================== */}
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm }}>
            <View style={{ flex: 1 }}>
              <Text style={styles.sectionTitle}>
                {t.service_name || 'Service'} Workflow Stepper Chart
              </Text>
              <Text style={styles.muted}>
                Current Stage: <Text style={{ fontWeight: '800', color: colors.brandPrimary }}>{pipelineStages[currentStageIdx]?.name || 'Completed'}</Text>
              </Text>
            </View>
            <View style={[styles.stageBadge, { backgroundColor: isCompleted ? '#DCFCE7' : isRejected ? '#FEE2E2' : '#FEF3C7' }]}>
              <Text style={[styles.stageBadgeText, { color: isCompleted ? '#059669' : isRejected ? '#DC2626' : '#B45309' }]}>
                {isCompleted ? 'Completed ✓' : isRejected ? 'Rejected ✕' : `Stage ${currentStageIdx + 1} of ${pipelineStages.length}`}
              </Text>
            </View>
          </View>

          {/* Visual Workflow Chart Graphic */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.workflowScroll}>
            <View style={styles.stepperContainer}>
              {pipelineStages.map((s: any, idx: number) => {
                const isCurrent = idx === currentStageIdx && !isCompleted && !isRejected;
                const isPassed = (idx < currentStageIdx) || isCompleted;
                const isRejectNode = isRejected && idx === currentStageIdx;

                return (
                  <React.Fragment key={idx}>
                    <View style={styles.stageCol}>
                      <View style={[
                        styles.stageNode,
                        isPassed && styles.nodePassed,
                        isCurrent && styles.nodeCurrent,
                        isRejectNode && styles.nodeRejected,
                      ]}>
                        {isPassed ? (
                          <Ionicons name="checkmark" size={16} color="#FFF" />
                        ) : isRejectNode ? (
                          <Ionicons name="close" size={16} color="#FFF" />
                        ) : (
                          <Text style={[styles.nodeNum, isCurrent && { color: '#FFF' }]}>{idx + 1}</Text>
                        )}
                      </View>
                      <Text style={[styles.stageName, isCurrent && styles.stageNameCurrent]} numberOfLines={2}>
                        {s.name}
                      </Text>
                      <View style={styles.roleTag}>
                        <Text style={styles.roleTagText}>{s.role || 'Team'}</Text>
                      </View>
                    </View>
                    {idx < pipelineStages.length - 1 && (
                      <View style={[styles.connector, isPassed && styles.connectorPassed]} />
                    )}
                  </React.Fragment>
                );
              })}
            </View>
          </ScrollView>

          {/* Workflow Action Buttons (Approved to Next, Forward, Back, Edit, Reject) */}
          {canEdit && !isCompleted && !isRejected && (
            <View style={styles.workflowActionRow}>
              {/* (1) Approved to Next */}
              <Pressable
                testID="btn-action-approve"
                style={[styles.workflowBtn, { backgroundColor: '#059669' }]}
                onPress={() => setActionModal('approve')}
              >
                <Ionicons name="checkmark-circle" size={16} color="#FFF" />
                <Text style={styles.workflowBtnText}>
                  {currentStageIdx === pipelineStages.length - 1 ? 'Final Approve' : 'Approved to Next'}
                </Text>
              </Pressable>

              {/* (2) Forward to Next / Target Stage */}
              <Pressable
                testID="btn-action-forward"
                style={[styles.workflowBtn, { backgroundColor: '#2563EB' }]}
                onPress={() => setActionModal('forward')}
              >
                <Ionicons name="arrow-forward-circle" size={16} color="#FFF" />
                <Text style={styles.workflowBtnText}>Forward</Text>
              </Pressable>

              {/* (3) Back / Return to Previous Stage */}
              {currentStageIdx > 0 && (
                <Pressable
                  testID="btn-action-back"
                  style={[styles.workflowBtn, { backgroundColor: '#D97706' }]}
                  onPress={() => setActionModal('return')}
                >
                  <Ionicons name="return-down-back" size={16} color="#FFF" />
                  <Text style={styles.workflowBtnText}>Back</Text>
                </Pressable>
              )}

              {/* (4) Edit Task Details */}
              <Pressable
                testID="btn-action-edit"
                style={[styles.workflowBtn, { backgroundColor: '#6366F1' }]}
                onPress={() => router.push({ pathname: '/tasks/new', params: { edit_id: id } } as any)}
              >
                <Ionicons name="create-outline" size={16} color="#FFF" />
                <Text style={styles.workflowBtnText}>Edit</Text>
              </Pressable>

              {/* (5) Reject Task with Mandatory Remarks */}
              <Pressable
                testID="btn-action-reject"
                style={[styles.workflowBtn, { backgroundColor: '#DC2626' }]}
                onPress={() => setActionModal('reject')}
              >
                <Ionicons name="close-circle" size={16} color="#FFF" />
                <Text style={styles.workflowBtnText}>Reject</Text>
              </Pressable>
            </View>
          )}
        </Card>

        {/* ============================================================== */}
        {/* Real-time Online Chat & Chatbot Collaborative Thread           */}
        {/* ============================================================== */}
        <Card style={styles.chatSectionCard}>
          <View style={styles.chatHeader}>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Ionicons name="chatbubbles" size={20} color={isPayTask ? '#D97706' : colors.brandPrimary} />
                <Text style={styles.sectionTitle}>
                  {isPayTask ? 'Payment Follow-up Online Chat' : 'Task Follow-up Collaborative Chat'}
                </Text>
              </View>
              <Text style={styles.chatSubtitle}>
                {isAdmin
                  ? 'Admin oversight active: all assigned employees and messages visible.'
                  : 'Chat active between assigned employees and Admin.'}
              </Text>
            </View>

            {isAdmin && (
              <Pressable onPress={() => setParticipantsModal(true)} style={styles.participantsBadge}>
                <Ionicons name="people" size={14} color="#FFF" />
                <Text style={styles.participantsBadgeText}>
                  {chatParticipants.length} Fixed {chatParticipants.length === 1 ? 'User' : 'Users'}
                </Text>
              </Pressable>
            )}
          </View>

          {/* Chat Messages List */}
          <ScrollView
            ref={chatScrollRef}
            style={styles.chatScroll}
            contentContainerStyle={{ padding: spacing.sm, gap: 10 }}
            nestedScrollEnabled
          >
            {chatMessages.length === 0 ? (
              <View style={styles.emptyChatBox}>
                <Ionicons name="chatbubble-ellipses-outline" size={32} color={colors.muted} />
                <Text style={{ color: colors.muted, fontSize: font.sm, textAlign: 'center' }}>
                  No messages yet. Start the conversation with assigned team members.
                </Text>
              </View>
            ) : (
              chatMessages.map((msg: any) => {
                const isMine = msg.sender_id === user?.user_id;
                const isSys = msg.is_system;

                if (isSys) {
                  return (
                    <View key={msg.id} style={styles.systemChatBubble}>
                      <Ionicons name="information-circle" size={14} color={colors.brandPrimary} />
                      <Text style={styles.systemChatText}>{msg.message}</Text>
                      <Text style={styles.systemChatTime}>{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
                    </View>
                  );
                }

                return (
                  <View key={msg.id} style={[styles.chatBubbleRow, isMine ? styles.chatRowMine : styles.chatRowOther]}>
                    <View style={[styles.chatBubble, isMine ? styles.chatBubbleMine : styles.chatBubbleOther]}>
                      {/* Sender details */}
                      <View style={styles.senderHeader}>
                        <Text style={[styles.senderName, isMine && { color: '#FFF' }]}>
                          {isMine ? 'You' : msg.sender_name}
                        </Text>
                        <View style={[styles.roleBadge, msg.sender_role === 'admin' ? styles.roleBadgeAdmin : styles.roleBadgeEmp]}>
                          <Text style={styles.roleBadgeText}>{(msg.sender_role || 'user').toUpperCase()}</Text>
                        </View>
                      </View>

                      {/* Message Text */}
                      <Text style={[styles.messageText, isMine && { color: '#FFF' }]}>{msg.message}</Text>

                      {/* Timestamp */}
                      <Text style={[styles.msgTime, isMine ? { color: '#E0E7FF' } : { color: colors.muted }]}>
                        {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </Text>
                    </View>
                  </View>
                );
              })
            )}
          </ScrollView>

          {/* Chat Input Bar */}
          <View style={styles.chatInputBar}>
            <TextInput
              style={styles.chatTextInput}
              placeholder="Type message or follow-up note..."
              value={chatInput}
              onChangeText={setChatInput}
              multiline
              maxLength={1000}
            />
            <Pressable
              testID="btn-send-chat"
              disabled={!chatInput.trim() || chatSending}
              onPress={sendChatMessage}
              style={[styles.sendBtn, (!chatInput.trim() || chatSending) && { opacity: 0.5 }]}
            >
              {chatSending ? (
                <ActivityIndicator size="small" color="#FFF" />
              ) : (
                <Ionicons name="send" size={16} color="#FFF" />
              )}
            </Pressable>
          </View>
        </Card>

        {/* Customer Information if linked */}
        {(t.customer_name || t.customer_code) && (
          <Card>
            <Text style={styles.sectionTitle}>Client Master Link</Text>
            <View style={{ gap: 4, marginTop: 6 }}>
              <View style={styles.custRow}><Text style={styles.custLbl}>Customer ID</Text><Text style={styles.custVal}>{t.customer_code || '—'}</Text></View>
              <View style={styles.custRow}><Text style={styles.custLbl}>Name</Text><Text style={styles.custVal}>{t.customer_name || '—'}</Text></View>
              {t.customer_mobile ? <View style={styles.custRow}><Text style={styles.custLbl}>Mobile</Text><Text style={styles.custVal}>{t.customer_mobile}</Text></View> : null}
              {t.customer_pan ? <View style={styles.custRow}><Text style={styles.custLbl}>PAN</Text><Text style={styles.custVal}>{t.customer_pan}</Text></View> : null}
            </View>
          </Card>
        )}

        {/* Sub-tasks */}
        {subs.length > 0 ? (
          <Card>
            <Text style={styles.sectionTitle}>Sub-tasks • {doneSubs} / {subs.length}</Text>
            <View style={{ marginTop: spacing.sm, gap: 6 }}>
              {subs.map((s: any) => (
                <Pressable key={s.id} testID={`sub-${s.id}`} onPress={() => toggleSub(s.id)} style={styles.subRow}>
                  <View style={[styles.check, s.done && { backgroundColor: colors.success, borderColor: colors.success }]}>
                    {s.done ? <Ionicons name="checkmark" size={14} color={colors.onSuccess} /> : null}
                  </View>
                  <Text style={[{ flex: 1, color: colors.onSurface }, s.done && { textDecorationLine: 'line-through', color: colors.muted }]}>{s.title}</Text>
                </Pressable>
              ))}
            </View>
          </Card>
        ) : null}

        {/* Attachments */}
        <Card>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <View style={{ flex: 1 }}>
              <Text style={styles.sectionTitle}>Task Documents</Text>
              <Text style={styles.muted}>{attachments.length} file{attachments.length === 1 ? '' : 's'} • Max 10 MB each</Text>
            </View>
            <Pressable testID="add-attachment" onPress={pickAndUpload} disabled={uploading} style={[styles.smallAdd, uploading && { opacity: 0.6 }]}>
              <Ionicons name="cloud-upload" size={16} color="#FFF" />
              <Text style={styles.smallAddText}>{uploading ? '…' : 'Add File'}</Text>
            </Pressable>
          </View>
          {err ? <Text style={{ color: colors.error, marginTop: spacing.sm }}>{err}</Text> : null}
          {attachments.length === 0 ? (
            <View style={styles.emptySlot}>
              <Ionicons name="cloud-upload-outline" size={24} color={colors.muted} />
              <Text style={styles.muted}>No documents attached yet.</Text>
            </View>
          ) : (
            <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
              {attachments.map((a: any, i: number) => (
                <View key={a.path || i} style={styles.fileSlot}>
                  <View style={styles.fileIcon}><Ionicons name={a.content_type?.includes('image') ? 'image' : 'document'} size={18} color={colors.brandPrimary} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.onSurface, fontWeight: '600' }} numberOfLines={1}>{a.name}</Text>
                    <Text style={styles.muted}>{humanSize(a.size)}</Text>
                  </View>
                  <Pressable onPress={() => openFile(a.path)} style={styles.iconBtn}><Ionicons name="eye-outline" size={18} color={colors.brandPrimary} /></Pressable>
                  <Pressable onPress={() => removeAttachment(a.path)} style={styles.iconBtn}><Ionicons name="trash-outline" size={18} color={colors.error} /></Pressable>
                </View>
              ))}
            </View>
          )}
        </Card>

        {/* Workflow History Audit Trail */}
        {workflowHistory.length > 0 && (
          <Card>
            <Text style={styles.sectionTitle}>Approval & Action History</Text>
            <View style={{ marginTop: spacing.md, gap: spacing.md }}>
              {workflowHistory.slice().reverse().map((h: any, idx: number) => (
                <View key={h.id || idx} style={styles.historyRow}>
                  <View style={[styles.historyBadge, {
                    backgroundColor: h.action === 'approve' ? '#DCFCE7' : h.action === 'reject' ? '#FEE2E2' : h.action === 'return' ? '#FEF3C7' : '#EFF6FF'
                  }]}>
                    <Text style={[styles.historyBadgeText, {
                      color: h.action === 'approve' ? '#059669' : h.action === 'reject' ? '#DC2626' : h.action === 'return' ? '#D97706' : '#2563EB'
                    }]}>
                      {h.action.toUpperCase()}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.historyActor}>
                      {h.action_by_name} <Text style={{ color: colors.muted, fontWeight: '500' }}>({h.action_by_role})</Text>
                    </Text>
                    <Text style={styles.historyTransition}>
                      {h.from_stage} → {h.to_stage}
                    </Text>
                    {h.remarks ? <Text style={styles.historyRemarks}>"{h.remarks}"</Text> : null}
                    <Text style={styles.historyTime}>{new Date(h.timestamp).toLocaleString()}</Text>
                  </View>
                </View>
              ))}
            </View>
          </Card>
        )}
      </ScrollView>

      {/* ============================================================== */}
      {/* Workflow Action Modal (Approve, Forward, Back, Reject)          */}
      {/* ============================================================== */}
      <Modal visible={!!actionModal} animationType="fade" transparent onRequestClose={() => setActionModal(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.actionModalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {actionModal === 'approve' ? 'Approved to Next Stage' :
                 actionModal === 'forward' ? 'Forward Task' :
                 actionModal === 'return' ? 'Back / Return to Previous Stage' :
                 'Reject Task'}
              </Text>
              <Pressable onPress={() => setActionModal(null)} hitSlop={10}>
                <Ionicons name="close" size={22} color={colors.onSurface} />
              </Pressable>
            </View>

            <View style={{ padding: spacing.lg, gap: spacing.md }}>
              {/* Optional: Target stage picker if forward */}
              {actionModal === 'forward' && (
                <View>
                  <Text style={styles.formLabel}>Select Target Stage</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginTop: 6 }}>
                    {pipelineStages.map((stg: any, sIdx: number) => (
                      <Pressable
                        key={sIdx}
                        onPress={() => setActionTargetStage(sIdx)}
                        style={[styles.stagePickChip, actionTargetStage === sIdx && styles.stagePickChipActive]}
                      >
                        <Text style={[styles.stagePickChipText, actionTargetStage === sIdx && { color: '#FFF' }]}>
                          {sIdx + 1}. {stg.name}
                        </Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                </View>
              )}

              {/* Optional: Re-assign employee if forward */}
              {actionModal === 'forward' && employees.length > 0 && (
                <View>
                  <Text style={styles.formLabel}>Forward to Employee (Optional)</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginTop: 6 }}>
                    {employees.map((emp: any) => (
                      <Pressable
                        key={emp.id}
                        onPress={() => setActionTargetAssignee(actionTargetAssignee === emp.id ? null : emp.id)}
                        style={[styles.empPickChip, actionTargetAssignee === emp.id && styles.empPickChipActive]}
                      >
                        <Text style={[styles.empPickChipText, actionTargetAssignee === emp.id && { color: '#FFF' }]}>
                          {emp.name}
                        </Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                </View>
              )}

              <Text style={styles.formLabel}>
                {actionModal === 'reject' || actionModal === 'return'
                  ? 'Reason / Remarks (Mandatory) *'
                  : 'Remarks / Notes (Optional)'}
              </Text>
              <TextInput
                style={styles.modalTextInput}
                placeholder={
                  actionModal === 'reject'
                    ? 'State reasons for rejection...'
                    : actionModal === 'return'
                    ? 'Explain why task is sent back for correction...'
                    : 'Enter approval or forward remarks...'
                }
                multiline
                numberOfLines={3}
                value={actionRemarks}
                onChangeText={setActionRemarks}
                autoFocus
              />

              <View style={{ flexDirection: 'row', gap: 10, marginTop: spacing.sm }}>
                <SecondaryButton label="Cancel" onPress={() => setActionModal(null)} style={{ flex: 1 }} />
                <PrimaryButton
                  label={actionBusy ? 'Processing...' : 'Confirm Action'}
                  onPress={() => performWorkflowAction(actionModal!)}
                  loading={actionBusy}
                  style={{ flex: 1 }}
                />
              </View>
            </View>
          </View>
        </View>
      </Modal>

      {/* ============================================================== */}
      {/* Admin Manage Chat Participants Modal                           */}
      {/* ============================================================== */}
      <Modal visible={participantsModal} animationType="slide" transparent onRequestClose={() => setParticipantsModal(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.actionModalCard}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>Manage Chat Participants</Text>
                <Text style={styles.chatSubtitle}>Admin fix employees allowed to chat on this task</Text>
              </View>
              <Pressable onPress={() => setParticipantsModal(false)} hitSlop={10}>
                <Ionicons name="close" size={22} color={colors.onSurface} />
              </Pressable>
            </View>

            <ScrollView style={{ maxHeight: 350, padding: spacing.md }}>
              <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 8 }}>
                Select employees who can communicate in this task's online chat. (Admin is automatically included with full visibility).
              </Text>

              <View style={{ gap: 8 }}>
                {employees.map((emp: any) => {
                  const isChecked = chatParticipants.includes(emp.id) || chatParticipants.includes(emp.user_id);
                  return (
                    <Pressable
                      key={emp.id}
                      onPress={() => toggleParticipant(emp.id || emp.user_id)}
                      style={[styles.participantSelectRow, isChecked && styles.participantSelectRowActive]}
                    >
                      <Ionicons
                        name={isChecked ? 'checkbox' : 'square-outline'}
                        size={22}
                        color={isChecked ? colors.brandPrimary : colors.muted}
                      />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.participantName}>{emp.name}</Text>
                        <Text style={styles.participantRole}>{emp.role || 'Employee'}</Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>

            <View style={{ flexDirection: 'row', gap: 10, padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.border }}>
              <SecondaryButton label="Cancel" onPress={() => setParticipantsModal(false)} style={{ flex: 1 }} />
              <PrimaryButton
                label={savingParticipants ? 'Saving...' : 'Save Participants'}
                onPress={saveParticipants}
                loading={savingParticipants}
                style={{ flex: 1.5 }}
              />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  headerParticipantBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#0F172A', paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill },
  headerParticipantBtnText: { color: '#FFF', fontSize: 11, fontWeight: '800' },

  payTaskBorder: { borderLeftWidth: 4, borderLeftColor: '#F59E0B' },
  taskNo: { color: colors.brandPrimary, fontWeight: '800', fontSize: font.sm, letterSpacing: 0.4 },
  categoryBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  categoryBadgeText: { fontSize: 10, fontWeight: '800' },
  serviceTag: { backgroundColor: '#F1F5F9', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  serviceTagText: { color: '#334155', fontSize: 11, fontWeight: '700' },

  title: { fontSize: font.xl, fontWeight: '800', color: colors.onSurface, marginTop: 4 },
  desc: { color: colors.onSurfaceSecondary, marginTop: spacing.xs, fontSize: font.sm },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: spacing.md, flexWrap: 'wrap' },
  metaText: { color: colors.muted, fontSize: font.xs },
  metaTextBold: { color: colors.onSurface, fontSize: font.xs, fontWeight: '700' },

  amountsRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  amount: { flex: 1, padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, alignItems: 'center' },
  amountLbl: { color: colors.muted, fontSize: 11, fontWeight: '600' },
  amountVal: { fontWeight: '800', fontSize: font.sm, marginTop: 2, color: colors.onSurface },

  sectionTitle: { fontSize: font.base, fontWeight: '800', color: colors.onSurface },
  stageBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.pill },
  stageBadgeText: { fontSize: 11, fontWeight: '800' },

  // Stepper Graphic
  workflowScroll: { paddingVertical: spacing.sm },
  stepperContainer: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm },
  stageCol: { alignItems: 'center', width: 90 },
  stageNode: { width: 36, height: 36, borderRadius: 18, borderWidth: 2, borderColor: '#CBD5E1', backgroundColor: '#F8FAFC', alignItems: 'center', justifyContent: 'center' },
  nodePassed: { backgroundColor: '#059669', borderColor: '#059669' },
  nodeCurrent: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  nodeRejected: { backgroundColor: '#DC2626', borderColor: '#DC2626' },
  nodeNum: { fontSize: 12, fontWeight: '800', color: '#64748B' },
  stageName: { fontSize: 11, color: '#64748B', fontWeight: '700', textAlign: 'center', marginTop: 4 },
  stageNameCurrent: { color: colors.brandPrimary, fontWeight: '900' },
  roleTag: { backgroundColor: '#F1F5F9', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4, marginTop: 2 },
  roleTagText: { fontSize: 9, color: '#475569', fontWeight: '700' },
  connector: { width: 30, height: 3, backgroundColor: '#E2E8F0', marginTop: -24 },
  connectorPassed: { backgroundColor: '#059669' },

  // Workflow Action Row
  workflowActionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.divider },
  workflowBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 9, borderRadius: radius.md },
  workflowBtnText: { color: '#FFF', fontWeight: '800', fontSize: 11 },

  // Chat Section
  chatSectionCard: { borderRadius: radius.lg, padding: spacing.md, backgroundColor: '#FFF' },
  chatHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.divider, paddingBottom: spacing.sm },
  chatSubtitle: { fontSize: 11, color: colors.muted, marginTop: 2 },
  participantsBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.brandPrimary, paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.pill },
  participantsBadgeText: { color: '#FFF', fontSize: 11, fontWeight: '700' },

  chatScroll: { maxHeight: 300, minHeight: 140, marginTop: spacing.sm },
  emptyChatBox: { alignItems: 'center', justifyContent: 'center', paddingVertical: 30, gap: 6 },
  chatBubbleRow: { flexDirection: 'row', width: '100%', marginVertical: 2 },
  chatRowMine: { justifyContent: 'flex-end' },
  chatRowOther: { justifyContent: 'flex-start' },
  chatBubble: { maxWidth: '82%', borderRadius: radius.lg, padding: 10 },
  chatBubbleMine: { backgroundColor: colors.brandPrimary, borderBottomRightRadius: 2 },
  chatBubbleOther: { backgroundColor: '#F1F5F9', borderBottomLeftRadius: 2 },
  senderHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  senderName: { fontSize: 11, fontWeight: '800', color: '#1E293B' },
  roleBadge: { paddingHorizontal: 4, paddingVertical: 1, borderRadius: 3 },
  roleBadgeAdmin: { backgroundColor: '#FEF3C7' },
  roleBadgeEmp: { backgroundColor: '#E2E8F0' },
  roleBadgeText: { fontSize: 8, fontWeight: '800', color: '#334155' },
  messageText: { fontSize: font.sm, color: '#1E293B', marginTop: 2 },
  msgTime: { fontSize: 9, marginTop: 4, alignSelf: 'flex-end' },

  systemChatBubble: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#EFF6FF', padding: 8, borderRadius: radius.md, alignSelf: 'center', maxWidth: '90%', marginVertical: 4 },
  systemChatText: { flex: 1, fontSize: 11, color: '#1E40AF', fontWeight: '600' },
  systemChatTime: { fontSize: 9, color: '#60A5FA' },

  chatInputBar: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  chatTextInput: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 8, fontSize: font.sm, backgroundColor: '#F8FAFC', maxHeight: 80 },
  sendBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.brandPrimary, alignItems: 'center', justifyContent: 'center' },

  custRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3, gap: 12 },
  custLbl: { color: colors.muted, fontSize: font.xs, fontWeight: '600', width: 90 },
  custVal: { color: colors.onSurface, fontWeight: '700', fontSize: font.xs, flex: 1, textAlign: 'right' },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary },
  check: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center' },
  smallAdd: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.brandPrimary, paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill },
  smallAddText: { color: '#FFF', fontWeight: '700', fontSize: 11 },
  emptySlot: { marginTop: spacing.md, padding: spacing.lg, borderRadius: radius.md, borderWidth: 2, borderColor: colors.border, borderStyle: 'dashed', alignItems: 'center', gap: 6 },
  fileSlot: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  fileIcon: { width: 34, height: 34, borderRadius: 8, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center' },
  iconBtn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  historyRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start', paddingBottom: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.divider },
  historyBadge: { paddingHorizontal: 6, paddingVertical: 3, borderRadius: 4, marginTop: 2 },
  historyBadgeText: { fontSize: 9, fontWeight: '900' },
  historyActor: { fontSize: font.sm, fontWeight: '800', color: '#0F172A' },
  historyTransition: { fontSize: 11, fontWeight: '700', color: colors.brandPrimary, marginTop: 1 },
  historyRemarks: { fontSize: font.xs, fontStyle: 'italic', color: '#334155', marginTop: 3, backgroundColor: '#F8FAFC', padding: 6, borderRadius: 4 },
  historyTime: { fontSize: 10, color: colors.muted, marginTop: 3 },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.6)', justifyContent: 'center', padding: spacing.lg },
  actionModalCard: { backgroundColor: '#FFF', borderRadius: radius.lg, overflow: 'hidden' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  modalTitle: { fontSize: font.base, fontWeight: '800', color: '#0F172A', flex: 1 },
  formLabel: { fontSize: font.xs, fontWeight: '700', color: '#475569' },
  modalTextInput: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, fontSize: font.sm, backgroundColor: '#F8FAFC', minHeight: 70, textAlignVertical: 'top' },
  muted: { color: colors.muted, fontSize: font.xs, marginTop: 2 },

  stagePickChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: '#F1F5F9' },
  stagePickChipActive: { backgroundColor: colors.brandPrimary },
  stagePickChipText: { fontSize: 11, fontWeight: '700', color: '#475569' },

  empPickChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: '#F1F5F9' },
  empPickChipActive: { backgroundColor: '#059669' },
  empPickChipText: { fontSize: 11, fontWeight: '700', color: '#475569' },

  participantSelectRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: radius.md, backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: colors.border },
  participantSelectRowActive: { borderColor: colors.brandPrimary, backgroundColor: '#EFF6FF' },
  participantName: { fontSize: 13, fontWeight: '700', color: '#0F172A' },
  participantRole: { fontSize: 11, color: colors.muted },
});
