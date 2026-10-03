import React, { useState } from 'react';
import { View, StyleSheet, ScrollView, KeyboardAvoidingView, Platform, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { colors, spacing } from '@/src/theme';
import { ScreenHeader } from '@/src/ScreenHeader';
import { FormInput, OptionRow } from '@/src/forms';
import { PrimaryButton } from '@/src/ui';
import { api } from '@/src/api';

export default function NewTender() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState({
    name_of_work: '',
    tender_id: '',
    reference_no: '',
    department: 'Rural Works Department (RWD)',
    estimated_cost: '',
    contractor_class: 'Class II',
    district: 'Patna',
    date_of_start: new Date().toISOString().split('T')[0],
    end_date: '',
    status: 'open',
    tender_description: '',
  });
  const set = (k: string) => (v: string) => setF(p => ({ ...p, [k]: v }));

  const save = async () => {
    if (!f.name_of_work.trim()) { setErr('Name of Work is required'); return; }
    if (!f.end_date.trim()) { setErr('End Date / Submission Deadline is required (e.g. 2026-10-15 15:00)'); return; }
    setErr(null); setBusy(true);
    try {
      const est = f.estimated_cost ? parseFloat(f.estimated_cost) : 0.0;
      const created = await api.createTenderItem({
        name_of_work: f.name_of_work.trim(),
        tender_id: f.tender_id.trim() || undefined,
        reference_no: f.reference_no.trim() || undefined,
        department: f.department.trim(),
        estimated_cost: est,
        contractor_class: f.contractor_class.trim() || undefined,
        district: f.district.trim() || undefined,
        date_of_start: f.date_of_start.trim() || undefined,
        end_date: f.end_date.trim(),
        tender_description: f.tender_description.trim() || undefined,
        status: f.status,
      });
      router.replace(`/tenders/${created.id}` as any);
    } catch (e: any) { setErr(e?.message || 'Failed to create tender'); } finally { setBusy(false); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surfaceSecondary }} testID="new-tender">
      <ScreenHeader title="New Tender" />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <View style={styles.notice}>
            <Text style={styles.noticeText}>
              System auto-classifies into 4 Value Categories (0-25L, 25-70L, 70L-3.5Cr, 3.5Cr+) and activates live DD:HH:MM countdown timer.
            </Text>
          </View>

          <FormInput label="Name of Work *" value={f.name_of_work} onChangeText={set('name_of_work')} placeholder="Construction of…" multiline testID="in-work" />
          <FormInput label="Tender / RFQ ID" value={f.tender_id} onChangeText={set('tender_id')} placeholder="e.g. NIT-2026-RWD-012" testID="in-tid" />
          <FormInput label="Reference No." value={f.reference_no} onChangeText={set('reference_no')} placeholder="e.g. REF/TND/2026/89" testID="in-ref" />
          <FormInput label="Department *" value={f.department} onChangeText={set('department')} placeholder="e.g. Rural Works Department (RWD)" testID="in-dept" />
          <FormInput label="Estimated Cost (₹) *" value={f.estimated_cost} onChangeText={set('estimated_cost')} placeholder="e.g. 4500000 (45 Lakhs)" keyboardType="numeric" testID="in-cost" />
          <FormInput label="Required Contractor Class" value={f.contractor_class} onChangeText={set('contractor_class')} placeholder="e.g. Class I / Class II / Class III" testID="in-class" />
          <FormInput label="District" value={f.district} onChangeText={set('district')} placeholder="e.g. Patna, Muzaffarpur" testID="in-dist" />
          <FormInput label="Date of Start" value={f.date_of_start} onChangeText={set('date_of_start')} placeholder="YYYY-MM-DD" testID="in-start" />
          <FormInput label="End Date / Submission Deadline *" value={f.end_date} onChangeText={set('end_date')} placeholder="YYYY-MM-DD HH:MM (e.g. 2026-10-15 15:00)" testID="in-end" />
          <OptionRow label="Status" options={['open', 'submitted', 'awarded', 'lost']} value={f.status} onChange={(v) => setF(p => ({ ...p, status: v }))} testID="status" />
          <FormInput label="Tender Description" value={f.tender_description} onChangeText={set('tender_description')} placeholder="Scope of work, specifications…" multiline testID="in-desc" />
          
          {err ? <Text style={{ color: colors.error, textAlign: 'center' }}>{err}</Text> : null}
          <PrimaryButton label="Create Tender" onPress={save} loading={busy} testID="save-btn" />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxxl },
  notice: { padding: spacing.md, borderRadius: 12, backgroundColor: colors.brandTertiary },
  noticeText: { color: colors.onBrandTertiary, fontSize: 13, lineHeight: 18 },
});
