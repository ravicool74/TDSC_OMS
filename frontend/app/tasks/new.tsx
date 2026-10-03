import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, KeyboardAvoidingView, Platform, Pressable, TextInput, Modal, Alert } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, font } from '@/src/theme';
import { ScreenHeader } from '@/src/ScreenHeader';
import { FormInput, OptionRow } from '@/src/forms';
import { PrimaryButton, SecondaryButton, Chip } from '@/src/ui';
import { api } from '@/src/api';
import { CustomerSearchModal, PickedParty } from '@/src/CustomerSearchModal';

type Sub = { id: string; title: string };

const fmtCurr = (v: number | string | null | undefined) => {
  const n = Number(v || 0);
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

export default function NewTask() {
  const router = useRouter();
  const params = useLocalSearchParams<{ edit_id?: string; category?: string }>();
  const editId = params?.edit_id || null;
  const isEdit = !!editId;

  // Category: 'payment_followup' | 'task_followup'
  const [category, setCategory] = useState<'payment_followup' | 'task_followup'>(
    (params?.category as any) === 'payment_followup' ? 'payment_followup' : 'task_followup'
  );

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [types, setTypes] = useState<any[]>([]);
  const [serviceWorkflows, setServiceWorkflows] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [selectedService, setSelectedService] = useState<any | null>(null);
  const [typeId, setTypeId] = useState<string>('');
  const [showNewType, setShowNewType] = useState(false);
  const [newTypeName, setNewTypeName] = useState('');
  const [creatingType, setCreatingType] = useState(false);

  const [subs, setSubs] = useState<Sub[]>([]);
  const [subInput, setSubInput] = useState('');

  const [voucherNo, setVoucherNo] = useState('');
  const [voucherDate, setVoucherDate] = useState('');
  const [total, setTotal] = useState('');
  const [paid, setPaid] = useState('');
  const [deadline, setDeadline] = useState('');
  const [assigneeId, setAssigneeId] = useState<string>('');
  const [assigneeName, setAssigneeName] = useState<string>('');
  const [chatParticipants, setChatParticipants] = useState<string[]>([]);
  const [priority, setPriority] = useState('medium');
  const [customer, setCustomer] = useState<PickedParty | null>(null);
  const [showPartyPick, setShowPartyPick] = useState(false);

  const reloadTypes = async () => {
    try { setTypes(await api.get<any[]>('/task-types')); } catch {}
  };

  const loadServiceWorkflows = async () => {
    try {
      const swfs = await api.getServiceWorkflows();
      setServiceWorkflows(swfs || []);
    } catch {}
  };

  useEffect(() => {
    (async () => {
      await Promise.all([reloadTypes(), loadServiceWorkflows()]);
      try { setEmployees(await api.get<any[]>('/employees')); } catch {}
      if (editId) {
        try {
          const t: any = await api.get(`/tasks/${editId}`);
          setTitle(t.title || '');
          setDescription(t.description || '');
          if (t.task_category) setCategory(t.task_category);
          setTypeId(t.task_type_id || '');
          setSubs((t.sub_tasks || []).map((s: any) => ({ id: s.id || Math.random().toString(36).slice(2), title: s.title })));
          setVoucherNo(t.voucher_no || '');
          setVoucherDate(t.voucher_date || '');
          setTotal(String(t.total_amount ?? ''));
          setPaid(String(t.paid_amount ?? ''));
          setDeadline(t.deadline || '');
          setAssigneeId(t.assignee_id || '');
          setAssigneeName(t.assignee_name || '');
          setChatParticipants(t.chat_participants || []);
          setPriority(t.priority || 'medium');
          if (t.service_name) {
            setSelectedService({ service_name: t.service_name, stages: t.workflow_stages });
          }
          if (t.customer_id || t.customer_name) {
            setCustomer({
              id: t.customer_id, name: t.customer_name || '', mobile: t.customer_mobile || '',
              customer_code: t.customer_code || null, pan: t.customer_pan || '', aadhar: '',
              address: t.customer_address || null,
            } as any);
          }
        } catch (e: any) { Alert.alert('Load failed', e?.message || 'Unable to load'); }
      }
    })();
  }, [editId]);

  const dues = useMemo(() => {
    const t = parseFloat(total || '0'), p = parseFloat(paid || '0');
    return (Number.isFinite(t) ? t : 0) - (Number.isFinite(p) ? p : 0);
  }, [total, paid]);

  const addSub = () => {
    if (!subInput.trim()) return;
    setSubs(prev => [...prev, { id: Math.random().toString(36).slice(2), title: subInput.trim() }]);
    setSubInput('');
  };
  const removeSub = (id: string) => setSubs(prev => prev.filter(s => s.id !== id));

  const toggleParticipant = (empId: string) => {
    setChatParticipants(prev =>
      prev.includes(empId) ? prev.filter(x => x !== empId) : [...prev, empId]
    );
  };

  const handleSelectService = (swf: any) => {
    setSelectedService(swf);
    if (!title.trim() || title.startsWith('Service —') || title.startsWith('Task —')) {
      setTitle(`${swf.service_name}${customer ? ` — ${customer.name}` : ''}`);
    }
  };

  const createType = async () => {
    if (!newTypeName.trim()) return;
    setCreatingType(true);
    try {
      const created = await api.post<any>('/task-types', { name: newTypeName.trim() });
      await reloadTypes();
      setTypeId(created.id);
      setShowNewType(false); setNewTypeName('');
    } catch (e: any) { Alert.alert('Failed', e?.message || 'Try again'); }
    finally { setCreatingType(false); }
  };

  const save = async () => {
    if (!title.trim()) { setErr('Title is required'); return; }
    setErr(null); setOk(null); setBusy(true);
    try {
      const participants = Array.from(new Set([
        ...chatParticipants,
        ...(assigneeId ? [assigneeId] : [])
      ]));

      const body = {
        title: title.trim(),
        description,
        task_category: category,
        task_type_id: typeId || null,
        service_id: selectedService?.service_id || null,
        service_name: selectedService?.service_name || null,
        chat_participants: participants,
        sub_tasks: subs.map(s => ({ title: s.title, done: false })),
        voucher_no: voucherNo || null,
        voucher_date: voucherDate || null,
        total_amount: parseFloat(total || '0') || 0,
        paid_amount: parseFloat(paid || '0') || 0,
        deadline: deadline || null,
        assignee_id: assigneeId || null,
        assignee_name: assigneeName || null,
        priority,
        customer_id: customer?.id || null,
        customer_code: customer?.customer_code || null,
        customer_name: customer?.name || null,
        customer_mobile: customer?.mobile || null,
        customer_pan: customer?.pan || null,
        customer_address: customer?.address || null,
      };

      const saved: any = isEdit ? await api.patch(`/tasks/${editId}`, body) : await api.post('/tasks', body);
      setOk(`Saved ✓ ${saved.task_no || saved.task_id}`);
      setTimeout(() => router.replace(`/tasks/${saved.id}` as any), 600);
    } catch (e: any) { setErr(e?.message || 'Failed'); } finally { setBusy(false); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surfaceSecondary }} testID="new-task">
      <ScreenHeader title={isEdit ? 'Edit Task' : 'Create New Task'} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">

          {/* Section Category Picker: Payment Follow-up vs Task Follow-up */}
          <View style={styles.categoryCard}>
            <Text style={styles.sectionTitle}>Task Category</Text>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
              <Pressable
                testID="pick-cat-pay"
                onPress={() => setCategory('payment_followup')}
                style={[styles.categoryChoice, category === 'payment_followup' && styles.categoryChoicePayActive]}
              >
                <Ionicons
                  name={category === 'payment_followup' ? 'cash' : 'cash-outline'}
                  size={20}
                  color={category === 'payment_followup' ? '#B45309' : colors.muted}
                />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.categoryChoiceTitle, category === 'payment_followup' && { color: '#B45309' }]}>
                    (i) Payment Follow-up
                  </Text>
                  <Text style={styles.categoryChoiceSub}>Invoice balance collection & client dues</Text>
                </View>
              </Pressable>

              <Pressable
                testID="pick-cat-task"
                onPress={() => setCategory('task_followup')}
                style={[styles.categoryChoice, category === 'task_followup' && styles.categoryChoiceTaskActive]}
              >
                <Ionicons
                  name={category === 'task_followup' ? 'git-network' : 'git-network-outline'}
                  size={20}
                  color={category === 'task_followup' ? colors.brandPrimary : colors.muted}
                />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.categoryChoiceTitle, category === 'task_followup' && { color: colors.brandPrimary }]}>
                    (ii) Task Follow-up
                  </Text>
                  <Text style={styles.categoryChoiceSub}>Service operational workflow chart</Text>
                </View>
              </Pressable>
            </View>
          </View>

          {/* Per-Service Workflow Picker if Task Follow-up */}
          {category === 'task_followup' && serviceWorkflows.length > 0 && (
            <View style={styles.card}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={styles.sectionTitle}>Link Service Workflow Chart</Text>
                <Text style={styles.muted}>{serviceWorkflows.length} services configured</Text>
              </View>
              <Text style={{ fontSize: 11, color: colors.muted }}>
                Select service to auto-assign its defined workflow chart stages:
              </Text>

              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 6 }}>
                {serviceWorkflows.map(swf => {
                  const isSelected = selectedService?.service_name === swf.service_name;
                  return (
                    <Pressable
                      key={swf.id || swf.service_name}
                      testID={`service-chip-${swf.service_name}`}
                      onPress={() => handleSelectService(swf)}
                      style={[styles.serviceChip, isSelected && styles.serviceChipActive]}
                    >
                      <Ionicons
                        name={isSelected ? 'checkmark-circle' : 'layers-outline'}
                        size={14}
                        color={isSelected ? '#FFF' : colors.brandPrimary}
                      />
                      <Text style={[styles.serviceChipText, isSelected && { color: '#FFF' }]}>
                        {swf.service_name}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>

              {/* Preview of stages */}
              {selectedService && selectedService.stages && (
                <View style={styles.stagesPreviewBox}>
                  <Text style={{ fontSize: 11, fontWeight: '800', color: colors.brandPrimary, marginBottom: 4 }}>
                    Workflow Stages Preview ({selectedService.stages.length} Stages):
                  </Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    {selectedService.stages.map((stg: any, sIdx: number) => (
                      <View key={sIdx} style={styles.previewStageBadge}>
                        <Text style={styles.previewStageText}>
                          {sIdx + 1}. {stg.name} ({stg.role || 'Any'})
                        </Text>
                      </View>
                    ))}
                  </View>
                </View>
              )}
            </View>
          )}

          <FormInput
            label="Task Title *"
            value={title}
            onChangeText={setTitle}
            placeholder={category === 'payment_followup' ? 'e.g. Payment Follow-up — M/S Sharma Builders' : 'e.g. DSC Class 3 — Rakesh Kumar'}
            testID="in-title"
          />

          <FormInput
            label="Description & Instructions"
            value={description}
            onChangeText={setDescription}
            placeholder="Details, special instructions, required docs..."
            multiline
            testID="in-desc"
          />

          {/* Customer Selection */}
          <View style={styles.card}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={styles.sectionTitle}>Customer Details</Text>
              <View style={{ flex: 1 }} />
              <Pressable testID="pick-cust" onPress={() => setShowPartyPick(true)} style={styles.custPick}>
                <Ionicons name="search" size={14} color="#FFF" />
                <Text style={{ color: '#FFF', fontWeight: '800', fontSize: 12 }}>{customer ? 'Change' : 'Search'}</Text>
              </Pressable>
            </View>
            {customer ? (
              <View style={{ gap: 4, marginTop: 8 }}>
                <View style={styles.custRow}><Text style={styles.custLbl}>Customer ID</Text><Text style={styles.custVal}>{customer.customer_code || '—'}</Text></View>
                <View style={styles.custRow}><Text style={styles.custLbl}>Name</Text><Text style={styles.custVal}>{customer.name}</Text></View>
                <View style={styles.custRow}><Text style={styles.custLbl}>Mobile</Text><Text style={styles.custVal}>{customer.mobile}</Text></View>
                <View style={styles.custRow}><Text style={styles.custLbl}>PAN</Text><Text style={styles.custVal}>{customer.pan || '—'}</Text></View>
                <View style={styles.custRow}><Text style={styles.custLbl}>Address</Text><Text style={[styles.custVal, { flex: 1, textAlign: 'right' }]} numberOfLines={2}>{customer.address || '—'}</Text></View>
                <Pressable onPress={() => setCustomer(null)} style={{ alignSelf: 'flex-start', paddingVertical: 6 }}>
                  <Text style={{ color: colors.error, fontWeight: '700', fontSize: 12 }}>Remove customer</Text>
                </Pressable>
              </View>
            ) : (
              <Pressable onPress={() => setShowPartyPick(true)} style={styles.custEmpty}>
                <Ionicons name="person-add-outline" size={22} color={colors.brandPrimary} />
                <Text style={{ color: colors.muted, marginTop: 4, fontSize: font.sm }}>Search by ID / Name / Mobile / PAN / Aadhar / EPFO / GST / Reg No</Text>
              </Pressable>
            )}
          </View>

          {/* Sub-tasks */}
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Checklist / Sub-tasks ({subs.length})</Text>
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
              <TextInput style={[styles.input, { flex: 1 }]} value={subInput} onChangeText={setSubInput} placeholder="Add checklist item and press +" onSubmitEditing={addSub} returnKeyType="done" testID="sub-input" />
              <Pressable onPress={addSub} style={styles.addBtn} testID="sub-add">
                <Ionicons name="add" size={20} color={colors.onBrandPrimary} />
              </Pressable>
            </View>
            <View style={{ marginTop: spacing.md, gap: 6 }}>
              {subs.map((s, i) => (
                <View key={s.id} style={styles.subRow}>
                  <Text style={styles.subIdx}>{i + 1}.</Text>
                  <Text style={{ flex: 1, color: colors.onSurface }}>{s.title}</Text>
                  <Pressable onPress={() => removeSub(s.id)} hitSlop={10}>
                    <Ionicons name="close-circle" size={20} color={colors.error} />
                  </Pressable>
                </View>
              ))}
            </View>
          </View>

          {/* Voucher & Amounts (Strict Display as: ₹<amount>) */}
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>
              {category === 'payment_followup' ? 'Invoice Bill & Recovery Amounts *' : 'Voucher & Amounts (Optional)'}
            </Text>
            <FormInput label="Voucher / Invoice No." value={voucherNo} onChangeText={setVoucherNo} testID="in-voucher" />
            <FormInput label="Voucher Date" value={voucherDate} onChangeText={setVoucherDate} placeholder="YYYY-MM-DD" testID="in-vdate" />
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <View style={{ flex: 1 }}><FormInput label="Total Amount (₹)" value={total} onChangeText={setTotal} keyboardType="numeric" testID="in-total" /></View>
              <View style={{ flex: 1 }}><FormInput label="Paid Amount (₹)" value={paid} onChangeText={setPaid} keyboardType="numeric" testID="in-paid" /></View>
            </View>
            <View style={[styles.duesBox, { backgroundColor: dues > 0 ? '#FEF2F2' : '#F0FDF4' }]}>
              <Text style={{ color: colors.muted, fontWeight: '700' }}>Balance Dues:</Text>
              <Text style={{ color: dues > 0 ? colors.error : colors.success, fontWeight: '900', fontSize: font.base }} testID="dues">
                {fmtCurr(dues)}
              </Text>
            </View>
          </View>

          {/* Assign Employee & Fixed Chat Employees */}
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Assignee & Chat Employees</Text>
            <FormInput label="Deadline / Target Completion Date" value={deadline} onChangeText={setDeadline} placeholder="YYYY-MM-DD" testID="in-deadline" />

            {employees.length > 0 ? (
              <View style={{ marginTop: spacing.sm }}>
                <Text style={{ color: colors.muted, fontSize: font.xs, fontWeight: '700', marginBottom: 6 }}>
                  Primary Assignee (Lead Follow-up):
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {employees.map(e => (
                    <Pressable
                      key={e.id}
                      testID={`assn-${e.id}`}
                      onPress={() => { setAssigneeId(e.id); setAssigneeName(e.name); }}
                      style={[styles.assn, assigneeId === e.id && styles.assnActive]}
                    >
                      <Text style={[{ fontWeight: '600', color: colors.onSurface }, assigneeId === e.id && { color: colors.onBrandPrimary }]}>
                        {e.name}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                {/* Additional fixed employees for Online Chat */}
                <Text style={{ color: colors.muted, fontSize: font.xs, fontWeight: '700', marginTop: 12, marginBottom: 6 }}>
                  Fixed Chat Participants (Admin + Selected Employees):
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {employees.map(e => {
                    const isFixed = chatParticipants.includes(e.id) || assigneeId === e.id;
                    return (
                      <Pressable
                        key={e.id}
                        onPress={() => toggleParticipant(e.id)}
                        style={[styles.chatPartChip, isFixed && styles.chatPartChipActive]}
                      >
                        <Ionicons
                          name={isFixed ? 'checkbox' : 'square-outline'}
                          size={14}
                          color={isFixed ? colors.brandPrimary : colors.muted}
                        />
                        <Text style={[styles.chatPartChipText, isFixed && { color: colors.brandPrimary, fontWeight: '800' }]}>
                          {e.name}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ) : null}

            <OptionRow label="Priority" options={['low', 'medium', 'high']} value={priority} onChange={setPriority} testID="prio" />
          </View>

          {err ? <Text style={{ color: colors.error, textAlign: 'center' }}>{err}</Text> : null}
          {ok ? <Text style={{ color: colors.success, textAlign: 'center', fontWeight: '700' }}>{ok}</Text> : null}

          <PrimaryButton
            label={isEdit ? 'Save Changes' : category === 'payment_followup' ? 'Create Payment Follow-up' : 'Create Task'}
            onPress={save}
            loading={busy}
            testID="save-btn"
          />
        </ScrollView>
      </KeyboardAvoidingView>

      <CustomerSearchModal visible={showPartyPick} onClose={() => setShowPartyPick(false)} onPick={setCustomer} title="Search / Add Customer" />
    </View>
  );
}

const styles = StyleSheet.create({
  body: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxxl },

  categoryCard: { backgroundColor: '#FFF', padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border },
  categoryChoice: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: radius.md, borderWidth: 1.5, borderColor: '#E2E8F0', backgroundColor: '#F8FAFC' },
  categoryChoicePayActive: { borderColor: '#F59E0B', backgroundColor: '#FFFBEB' },
  categoryChoiceTaskActive: { borderColor: colors.brandPrimary, backgroundColor: '#EFF6FF' },
  categoryChoiceTitle: { fontSize: 12, fontWeight: '800', color: colors.onSurface },
  categoryChoiceSub: { fontSize: 10, color: colors.muted, marginTop: 2 },

  card: { backgroundColor: colors.surface, padding: spacing.lg, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, gap: spacing.sm },
  sectionTitle: { fontSize: font.base, fontWeight: '800', color: colors.onSurface },
  muted: { color: colors.muted, fontSize: 11 },

  serviceChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: '#F8FAFC' },
  serviceChipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  serviceChipText: { fontSize: 11, fontWeight: '700', color: colors.onSurface },

  stagesPreviewBox: { backgroundColor: '#EFF6FF', padding: 8, borderRadius: radius.md, marginTop: 4 },
  previewStageBadge: { backgroundColor: '#FFF', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: '#BFDBFE' },
  previewStageText: { fontSize: 10, color: '#1E40AF', fontWeight: '700' },

  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 10, fontSize: font.base, backgroundColor: colors.surface },
  addBtn: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.brandPrimary, alignItems: 'center', justifyContent: 'center' },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  subIdx: { color: colors.muted, fontWeight: '700', width: 22 },

  duesBox: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.md, borderRadius: radius.md, marginTop: spacing.sm },
  assn: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  assnActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },

  chatPartChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 6, borderWidth: 1, borderColor: colors.border, backgroundColor: '#F8FAFC' },
  chatPartChipActive: { backgroundColor: '#EFF6FF', borderColor: colors.brandPrimary },
  chatPartChipText: { fontSize: 11, color: colors.onSurface },

  custPick: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.brandPrimary, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill },
  custRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, gap: 12 },
  custLbl: { color: colors.muted, fontSize: font.xs, fontWeight: '600', width: 90 },
  custVal: { color: colors.onSurface, fontWeight: '700', fontSize: font.xs, flex: 1, textAlign: 'right' },
  custEmpty: { alignItems: 'center', padding: 16, borderRadius: radius.md, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border, backgroundColor: colors.surfaceSecondary, marginTop: 8 },
});
