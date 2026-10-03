import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, Modal, KeyboardAvoidingView, Platform, ScrollView, Alert, TextInput } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, font } from '@/src/theme';
import { api } from '@/src/api';
import { Card, EmptyState, ScreenLoader, PrimaryButton, SecondaryButton } from '@/src/ui';
import { ScreenHeader } from '@/src/ScreenHeader';
import { FormInput } from '@/src/forms';

type ServiceForm = {
  id?: string;
  service_id?: string;
  name: string;
  description: string;
  rate: string;
  gst_percent: string;
  sac_hsn: string;
  status: string;
};

const emptyService: ServiceForm = {
  name: '',
  description: '',
  rate: '',
  gst_percent: '18',
  sac_hsn: '998313',
  status: 'active',
};

export default function ServicesScreen() {
  const [services, setServices] = useState<any[] | null>(null);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<ServiceForm>(emptyService);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      let url = '/services';
      if (search.trim()) url += `?q=${encodeURIComponent(search.trim())}`;
      const data = await api.get<any[]>(url);
      setServices(data);
    } catch {
      setServices([]);
    }
  }, [search]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openNew = () => {
    setForm(emptyService);
    setErr(null);
    setShowForm(true);
  };

  const openEdit = (s: any) => {
    setForm({
      id: s.id,
      service_id: s.service_id,
      name: s.name,
      description: s.description || '',
      rate: String(s.rate || 0),
      gst_percent: String(s.gst_percent || 18),
      sac_hsn: s.sac_hsn || '998313',
      status: s.status || 'active',
    });
    setErr(null);
    setShowForm(true);
  };

  const save = async () => {
    if (!form.name.trim()) {
      setErr('Service Name is required');
      return;
    }
    const rate = parseFloat(form.rate) || 0;
    const gst_percent = parseFloat(form.gst_percent) || 18;

    setBusy(true);
    setErr(null);
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim(),
        rate,
        gst_percent,
        sac_hsn: form.sac_hsn.trim(),
        status: form.status,
      };
      if (form.id) {
        await api.patch(`/services/${form.id}`, payload);
      } else {
        await api.post('/services', payload);
      }
      setShowForm(false);
      await load();
    } catch (e: any) {
      setErr(e?.message || 'Failed to save service');
    } finally {
      setBusy(false);
    }
  };

  const remove = (s: any) => {
    const doDelete = async () => {
      try {
        await api.del(`/services/${s.id}`);
        await load();
      } catch (e: any) {
        if (Platform.OS === 'web') window.alert(e?.message || 'Delete failed');
        else Alert.alert('Error', e?.message || 'Delete failed');
      }
    };

    if (Platform.OS === 'web') {
      if (window.confirm(`Delete service "${s.name}"?`)) doDelete();
    } else {
      Alert.alert('Delete Service?', `${s.name} will be removed.`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: doDelete },
      ]);
    }
  };

  return (
    <View style={styles.container}>
      <ScreenHeader
        title="Service Management"
        right={
          <Pressable onPress={openNew} style={styles.addButton}>
            <Ionicons name="add" size={24} color={colors.onBrandPrimary} />
          </Pressable>
        }
      />

      <View style={styles.searchBarBox}>
        <View style={styles.searchBar}>
          <Ionicons name="search" size={18} color={colors.muted} />
          <TextInput
            placeholder="Search services, SAC/HSN codes..."
            value={search}
            onChangeText={t => setSearch(t)}
            onSubmitEditing={load}
            style={styles.searchInput}
          />
        </View>
      </View>

      {services === null ? (
        <ScreenLoader />
      ) : services.length === 0 ? (
        <EmptyState
          icon="construct-outline"
          title="No Services Found"
          subtitle="Add service offerings such as Digital Signature, E-Tender, GST, etc."
          actionLabel="+ Add Service"
          onAction={openNew}
        />
      ) : (
        <FlatList
          data={services}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <Card>
              <View style={styles.cardHeader}>
                <View style={styles.serviceIcon}>
                  <Ionicons name="pricetag" size={20} color={colors.brandPrimary} />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={styles.serviceName}>{item.name}</Text>
                    <View style={[styles.badge, item.status === 'active' ? styles.badgeActive : styles.badgeInactive]}>
                      <Text style={[styles.badgeText, { color: item.status === 'active' ? colors.success : colors.muted }]}>
                        {item.status.toUpperCase()}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.serviceCode}>{item.service_id} • SAC/HSN: {item.sac_hsn || '998313'}</Text>
                </View>

                <View style={styles.priceBox}>
                  <Text style={styles.priceText}>₹ {Number(item.rate || 0).toLocaleString('en-IN')}</Text>
                  <Text style={styles.gstText}>+{item.gst_percent}% GST</Text>
                </View>

                <View style={styles.actionBtns}>
                  <Pressable onPress={() => openEdit(item)} style={styles.editBtn}>
                    <Ionicons name="pencil" size={18} color={colors.brandPrimary} />
                  </Pressable>
                  <Pressable onPress={() => remove(item)} style={styles.delBtn}>
                    <Ionicons name="trash-outline" size={18} color={colors.error} />
                  </Pressable>
                </View>
              </View>

              {item.description ? (
                <Text style={styles.descText}>{item.description}</Text>
              ) : null}
            </Card>
          )}
        />
      )}

      {/* Modal */}
      <Modal visible={showForm} animationType="slide" transparent>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{form.id ? `Edit ${form.service_id}` : 'Create New Service'}</Text>
              <Pressable onPress={() => setShowForm(false)}>
                <Ionicons name="close" size={24} color={colors.muted} />
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
              {err ? <Text style={styles.errorText}>{err}</Text> : null}

              <FormInput label="Service Name *" value={form.name} onChangeText={t => setForm(p => ({ ...p, name: t }))} placeholder="e.g. Digital Signature, Eproc2 Registration" />
              <FormInput label="Description" value={form.description} onChangeText={t => setForm(p => ({ ...p, description: t }))} placeholder="Service scope, deliverables" />

              <View style={{ flexDirection: 'row', gap: spacing.md }}>
                <View style={{ flex: 1 }}>
                  <FormInput label="Rate (₹) *" value={form.rate} onChangeText={t => setForm(p => ({ ...p, rate: t }))} keyboardType="numeric" placeholder="2500" />
                </View>
                <View style={{ flex: 1 }}>
                  <FormInput label="GST % *" value={form.gst_percent} onChangeText={t => setForm(p => ({ ...p, gst_percent: t }))} keyboardType="numeric" placeholder="18" />
                </View>
              </View>

              <FormInput label="SAC / HSN Code" value={form.sac_hsn} onChangeText={t => setForm(p => ({ ...p, sac_hsn: t }))} placeholder="998313" />

              <View>
                <Text style={styles.fieldLabel}>Status</Text>
                <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
                  {['active', 'inactive'].map(st => (
                    <Pressable
                      key={st}
                      onPress={() => setForm(p => ({ ...p, status: st }))}
                      style={[styles.statusOption, form.status === st && styles.statusOptionSelected]}
                    >
                      <Text style={[styles.statusOptionText, form.status === st && { color: colors.brandPrimary, fontWeight: '700' }]}>
                        {st.toUpperCase()}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg }}>
                <SecondaryButton title="Cancel" onPress={() => setShowForm(false)} style={{ flex: 1 }} />
                <PrimaryButton title={busy ? 'Saving...' : 'Save Service'} onPress={save} disabled={busy} style={{ flex: 1 }} />
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surfaceSecondary },
  addButton: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.brandPrimary, alignItems: 'center', justifyContent: 'center' },
  searchBarBox: { padding: spacing.md, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  searchInput: { flex: 1, fontSize: font.base, color: colors.onSurface },
  listContent: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxxl },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  serviceIcon: { width: 40, height: 40, borderRadius: 8, backgroundColor: colors.brandPrimary + '15', alignItems: 'center', justifyContent: 'center' },
  serviceName: { fontSize: font.lg, fontWeight: '700', color: colors.onSurface },
  serviceCode: { fontSize: font.xs, fontWeight: '700', color: colors.muted, marginTop: 2 },
  badge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  badgeActive: { backgroundColor: colors.success + '15' },
  badgeInactive: { backgroundColor: colors.muted + '20' },
  badgeText: { fontSize: 10, fontWeight: '800' },
  priceBox: { alignItems: 'flex-end', marginRight: 6 },
  priceText: { fontSize: font.base, fontWeight: '800', color: colors.brandPrimary },
  gstText: { fontSize: 10, color: colors.muted },
  actionBtns: { flexDirection: 'row', gap: 6 },
  editBtn: { padding: 6, borderRadius: radius.sm, backgroundColor: colors.surfaceSecondary },
  delBtn: { padding: 6, borderRadius: radius.sm, backgroundColor: colors.error + '10' },
  descText: { marginTop: spacing.sm, fontSize: font.sm, color: colors.muted },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalBox: { backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, maxHeight: '85%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border },
  modalTitle: { fontSize: font.lg, fontWeight: '700', color: colors.onSurface },
  errorText: { color: colors.error, fontSize: font.sm, marginBottom: 8 },
  fieldLabel: { fontSize: font.sm, fontWeight: '600', color: colors.onSurface, marginBottom: 4 },
  statusOption: { flex: 1, paddingVertical: 8, alignItems: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: radius.md },
  statusOptionSelected: { borderColor: colors.brandPrimary, backgroundColor: colors.brandPrimary + '10' },
  statusOptionText: { fontSize: font.sm, color: colors.muted },
});
