import React, { useCallback, useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, Modal, KeyboardAvoidingView, Platform, ScrollView, Alert, TextInput, ActivityIndicator } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, font } from '@/src/theme';
import { api, getCurrentLocation } from '@/src/api';
import { Card, EmptyState, ScreenLoader, PrimaryButton, SecondaryButton } from '@/src/ui';
import { ScreenHeader } from '@/src/ScreenHeader';
import { FormInput } from '@/src/forms';

type BranchForm = {
  id?: string;
  branch_id?: string;
  name: string;
  address: string;
  mobile: string;
  email: string;
  branch_head: string;
  status: string;
  lat: string;
  lng: string;
  radius_m: string;
};

const emptyBranch: BranchForm = {
  name: '',
  address: '',
  mobile: '',
  email: '',
  branch_head: '',
  status: 'active',
  lat: '',
  lng: '',
  radius_m: '200',
};

export default function BranchesScreen() {
  const router = useRouter();
  const [branches, setBranches] = useState<any[] | null>(null);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<BranchForm>(emptyBranch);
  const [busy, setBusy] = useState(false);
  const [locBusy, setLocBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [branchToDelete, setBranchToDelete] = useState<any | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);

  // Auto-hide toast after 4 seconds
  useEffect(() => {
    if (toastMsg) {
      const timer = setTimeout(() => setToastMsg(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [toastMsg]);

  const load = useCallback(async () => {
    try {
      let url = '/branches';
      const params = [];
      if (search.trim()) params.push(`q=${encodeURIComponent(search.trim())}`);
      if (filterStatus !== 'all') params.push(`status=${filterStatus}`);
      if (params.length) url += `?${params.join('&')}`;
      const data = await api.get<any[]>(url);
      setBranches(data || []);
    } catch (e: any) {
      setBranches([]);
    }
  }, [search, filterStatus]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openNew = () => {
    setForm(emptyBranch);
    setErr(null);
    setShowForm(true);
  };

  const openEdit = (b: any) => {
    setForm({
      id: b.id || b.branch_id,
      branch_id: b.branch_id,
      name: b.name || '',
      address: b.address || '',
      mobile: b.mobile || '',
      email: b.email || '',
      branch_head: b.branch_head || '',
      status: b.status || 'active',
      lat: b.lat != null ? String(b.lat) : '',
      lng: b.lng != null ? String(b.lng) : '',
      radius_m: String(b.radius_m || 200),
    });
    setErr(null);
    setShowForm(true);
  };

  const useMyLocation = async () => {
    setLocBusy(true);
    try {
      const loc = await getCurrentLocation();
      setForm(p => ({ ...p, lat: loc.lat.toFixed(6), lng: loc.lng.toFixed(6) }));
    } catch (e: any) {
      setErr(e?.message || 'Location acquisition failed');
    } finally {
      setLocBusy(false);
    }
  };

  const save = async () => {
    if (!form.name.trim()) {
      setErr('Branch Name is required');
      return;
    }
    const lat = form.lat && !isNaN(parseFloat(form.lat)) ? parseFloat(form.lat) : undefined;
    const lng = form.lng && !isNaN(parseFloat(form.lng)) ? parseFloat(form.lng) : undefined;
    const radius_m = form.radius_m && !isNaN(parseInt(form.radius_m, 10)) ? parseInt(form.radius_m, 10) : 200;

    setBusy(true);
    setErr(null);
    try {
      const payload: Record<string, any> = {
        name: form.name.trim(),
        address: form.address.trim() || undefined,
        mobile: form.mobile.trim() || undefined,
        email: form.email.trim() || undefined,
        branch_head: form.branch_head.trim() || undefined,
        status: form.status,
        lat,
        lng,
        radius_m,
      };

      const targetId = form.id || form.branch_id;
      if (targetId) {
        await api.patch(`/branches/${targetId}`, payload);
        setToastMsg(`Branch "${form.name.trim()}" updated successfully!`);
      } else {
        await api.post('/branches', payload);
        setToastMsg(`New Branch "${form.name.trim()}" created successfully!`);
      }
      setShowForm(false);
      await load();
    } catch (e: any) {
      setErr(e?.message || 'Failed to save branch. Please check input values.');
    } finally {
      setBusy(false);
    }
  };

  const executeDelete = async () => {
    if (!branchToDelete) return;
    const targetId = branchToDelete.id || branchToDelete.branch_id;
    const bName = branchToDelete.name;
    setDeleteBusy(true);
    setDeleteErr(null);
    try {
      await api.del(`/branches/${targetId}`);
      setBranchToDelete(null);
      setToastMsg(`Branch "${bName}" deleted successfully!`);
      await load();
    } catch (e: any) {
      setDeleteErr(e?.message || 'Delete failed. Please try again.');
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <View style={styles.container}>
      <ScreenHeader
        title="Branch Management"
        subtitle="Manage TDSC company offices & geofences"
        right={
          <Pressable onPress={openNew} style={styles.addHeaderBtn} accessibilityLabel="Add Branch" accessibilityRole="button">
            <Ionicons name="add-circle" size={18} color={colors.onBrandPrimary} />
            <Text style={styles.addHeaderBtnText}>+ Add Branch</Text>
          </Pressable>
        }
      />

      {/* Success Notification Banner */}
      {toastMsg ? (
        <View style={styles.toastBanner}>
          <Ionicons name="checkmark-circle" size={20} color="#15803D" />
          <Text style={styles.toastText}>{toastMsg}</Text>
          <Pressable onPress={() => setToastMsg(null)}>
            <Ionicons name="close" size={18} color="#15803D" />
          </Pressable>
        </View>
      ) : null}

      <View style={styles.filterRow}>
        <View style={styles.searchBar}>
          <Ionicons name="search" size={18} color={colors.muted} />
          <TextInput
            placeholder="Search branches by name, city, code..."
            placeholderTextColor={colors.muted}
            value={search}
            onChangeText={t => { setSearch(t); }}
            onSubmitEditing={load}
            style={styles.searchInput}
          />
          {search ? (
            <Pressable onPress={() => { setSearch(''); load(); }}>
              <Ionicons name="close-circle" size={18} color={colors.muted} />
            </Pressable>
          ) : null}
        </View>

        <View style={styles.statusChips}>
          {['all', 'active', 'inactive'].map(st => (
            <Pressable
              key={st}
              onPress={() => setFilterStatus(st)}
              style={[styles.chip, filterStatus === st && styles.chipActive]}
            >
              <Text style={[styles.chipText, filterStatus === st && styles.chipTextActive]}>
                {st.toUpperCase()}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {branches === null ? (
        <ScreenLoader />
      ) : branches.length === 0 ? (
        <EmptyState
          icon="business-outline"
          title="No Branches Found"
          subtitle="Add an office branch to manage staff, geofences, and operations."
          actionLabel="+ Add Branch"
          onAction={openNew}
        />
      ) : (
        <FlatList
          data={branches}
          keyExtractor={item => item.id || item.branch_id || String(Math.random())}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <Card style={styles.branchCard}>
              <View style={styles.cardHeader}>
                <View style={styles.branchIcon}>
                  <Ionicons name="business" size={22} color={colors.brandPrimary} />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <Text style={styles.branchName}>{item.name}</Text>
                    <View style={[styles.badge, item.status === 'active' ? styles.badgeActive : styles.badgeInactive]}>
                      <Text style={[styles.badgeText, { color: item.status === 'active' ? colors.success : colors.muted }]}>
                        {item.status ? item.status.toUpperCase() : 'ACTIVE'}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.branchCode}>{item.branch_id}</Text>
                </View>

                {/* Prominent Edit and Delete Buttons */}
                <View style={styles.actionBtns}>
                  <Pressable
                    onPress={() => openEdit(item)}
                    style={({ pressed }) => [styles.editBtn, pressed && styles.btnPressed]}
                    accessibilityLabel={`Edit ${item.name}`}
                    accessibilityRole="button"
                  >
                    <Ionicons name="create-outline" size={15} color={colors.brandPrimary} />
                    <Text style={styles.editBtnText}>Edit</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      setDeleteErr(null);
                      setBranchToDelete(item);
                    }}
                    style={({ pressed }) => [styles.delBtn, pressed && styles.btnPressed]}
                    accessibilityLabel={`Delete ${item.name}`}
                    accessibilityRole="button"
                  >
                    <Ionicons name="trash-outline" size={15} color={colors.error} />
                    <Text style={styles.delBtnText}>Delete</Text>
                  </Pressable>
                </View>
              </View>

              <View style={styles.detailsGrid}>
                {item.address ? (
                  <View style={styles.detailItem}>
                    <Ionicons name="location-outline" size={15} color={colors.muted} />
                    <Text style={styles.detailText}>{item.address}</Text>
                  </View>
                ) : null}
                {item.mobile ? (
                  <View style={styles.detailItem}>
                    <Ionicons name="call-outline" size={15} color={colors.muted} />
                    <Text style={styles.detailText}>{item.mobile}</Text>
                  </View>
                ) : null}
                {item.email ? (
                  <View style={styles.detailItem}>
                    <Ionicons name="mail-outline" size={15} color={colors.muted} />
                    <Text style={styles.detailText}>{item.email}</Text>
                  </View>
                ) : null}
                {item.branch_head ? (
                  <View style={styles.detailItem}>
                    <Ionicons name="person-outline" size={15} color={colors.muted} />
                    <Text style={styles.detailText}>Head: {item.branch_head}</Text>
                  </View>
                ) : null}
                <View style={styles.detailItem}>
                  <Ionicons name="people-outline" size={15} color={colors.muted} />
                  <Text style={styles.detailText}>{item.total_employees || 0} Assigned Employees</Text>
                </View>
                {item.lat && item.lng ? (
                  <View style={styles.detailItem}>
                    <Ionicons name="navigate-circle-outline" size={15} color={colors.brandSecondary} />
                    <Text style={[styles.detailText, { color: colors.brandSecondary }]}>
                      GPS: {item.lat}, {item.lng} (Radius: {item.radius_m || 200}m)
                    </Text>
                  </View>
                ) : null}
              </View>
            </Card>
          )}
        />
      )}

      {/* Add / Edit Branch Modal */}
      <Modal visible={showForm} animationType="slide" transparent onRequestClose={() => setShowForm(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>
                  {form.id ? `Edit Branch Office` : 'Add New Branch Office'}
                </Text>
                {form.branch_id ? (
                  <Text style={styles.modalSubTitle}>{form.branch_id}</Text>
                ) : null}
              </View>
              <Pressable onPress={() => setShowForm(false)} hitSlop={8}>
                <Ionicons name="close" size={24} color={colors.muted} />
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
              {err ? (
                <View style={styles.errorBox}>
                  <Ionicons name="alert-circle" size={18} color={colors.error} />
                  <Text style={styles.errorText}>{err}</Text>
                </View>
              ) : null}

              <FormInput label="Branch Name *" value={form.name} onChangeText={t => setForm(p => ({ ...p, name: t }))} placeholder="e.g. Patna Regional Branch" />
              <FormInput label="Address" value={form.address} onChangeText={t => setForm(p => ({ ...p, address: t }))} placeholder="Street, City, State" />
              <FormInput label="Contact Mobile" value={form.mobile} onChangeText={t => setForm(p => ({ ...p, mobile: t }))} keyboardType="phone-pad" placeholder="10-digit mobile number" />
              <FormInput label="Email ID" value={form.email} onChangeText={t => setForm(p => ({ ...p, email: t }))} keyboardType="email-address" placeholder="branch@triveni.com" />
              <FormInput label="Branch Head / Manager" value={form.branch_head} onChangeText={t => setForm(p => ({ ...p, branch_head: t }))} placeholder="Name of branch manager" />

              <View>
                <Text style={styles.fieldLabel}>Branch Status</Text>
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

              <View style={styles.geoSection}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={styles.geoTitle}>Geofence Settings (GPS Punch-in)</Text>
                  <Pressable onPress={useMyLocation} disabled={locBusy} style={styles.myLocBtn}>
                    <Ionicons name="navigate-outline" size={16} color={colors.brandPrimary} />
                    <Text style={styles.myLocText}>{locBusy ? 'Locating...' : 'Use My GPS'}</Text>
                  </Pressable>
                </View>
                <View style={{ flexDirection: 'row', gap: spacing.md }}>
                  <View style={{ flex: 1 }}>
                    <FormInput label="Latitude" value={form.lat} onChangeText={t => setForm(p => ({ ...p, lat: t }))} keyboardType="numeric" placeholder="25.6093" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <FormInput label="Longitude" value={form.lng} onChangeText={t => setForm(p => ({ ...p, lng: t }))} keyboardType="numeric" placeholder="85.1235" />
                  </View>
                </View>
                <FormInput label="Geofence Radius (meters)" value={form.radius_m} onChangeText={t => setForm(p => ({ ...p, radius_m: t }))} keyboardType="numeric" placeholder="200" />
              </View>

              <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg }}>
                <SecondaryButton title="Cancel" onPress={() => setShowForm(false)} style={{ flex: 1 }} />
                <PrimaryButton
                  title={form.id ? (busy ? 'Updating Branch...' : 'Update Branch') : (busy ? 'Saving Branch...' : 'Save Branch')}
                  onPress={save}
                  disabled={busy}
                  style={{ flex: 1 }}
                />
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* In-App Delete Confirmation Modal (Cross-Platform) */}
      <Modal visible={!!branchToDelete} transparent animationType="fade" onRequestClose={() => setBranchToDelete(null)}>
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmBox}>
            <View style={styles.confirmIconContainer}>
              <Ionicons name="warning" size={32} color={colors.error} />
            </View>
            <Text style={styles.confirmTitle}>Delete Branch?</Text>
            <Text style={styles.confirmMessage}>
              Are you sure you want to delete <Text style={{ fontWeight: '700' }}>"{branchToDelete?.name}"</Text> ({branchToDelete?.branch_id})?
            </Text>
            <Text style={styles.confirmSubtext}>
              This will remove the branch office configuration and its geofence settings.
            </Text>

            {deleteErr ? (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle" size={16} color={colors.error} />
                <Text style={styles.errorText}>{deleteErr}</Text>
              </View>
            ) : null}

            <View style={styles.confirmButtons}>
              <SecondaryButton
                title="Cancel"
                onPress={() => setBranchToDelete(null)}
                disabled={deleteBusy}
                style={{ flex: 1 }}
              />
              <Pressable
                onPress={executeDelete}
                disabled={deleteBusy}
                style={[styles.deleteConfirmBtn, deleteBusy && { opacity: 0.6 }]}
                accessibilityLabel="Confirm Delete"
                accessibilityRole="button"
              >
                {deleteBusy ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <>
                    <Ionicons name="trash" size={16} color="#FFFFFF" />
                    <Text style={styles.deleteConfirmBtnText}>Yes, Delete</Text>
                  </>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surfaceSecondary },
  addHeaderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.md,
    backgroundColor: colors.brandPrimary,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 2,
  },
  addHeaderBtnText: {
    color: colors.onBrandPrimary,
    fontSize: font.sm,
    fontWeight: '700',
  },
  toastBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#DCFCE7',
    borderBottomWidth: 1,
    borderBottomColor: '#86EFAC',
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    gap: 8,
  },
  toastText: {
    flex: 1,
    fontSize: font.sm,
    fontWeight: '600',
    color: '#15803D',
  },
  filterRow: { padding: spacing.md, gap: spacing.sm, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  searchInput: { flex: 1, fontSize: font.base, color: colors.onSurface },
  statusChips: { flexDirection: 'row', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: radius.full, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { fontSize: font.xs, fontWeight: '700', color: colors.muted },
  chipTextActive: { color: colors.onBrandPrimary },
  listContent: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxxl },
  branchCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  branchIcon: { width: 44, height: 44, borderRadius: 10, backgroundColor: colors.brandPrimary + '15', alignItems: 'center', justifyContent: 'center' },
  branchName: { fontSize: font.base, fontWeight: '700', color: colors.onSurface, flexShrink: 1 },
  branchCode: { fontSize: font.xs, fontWeight: '700', color: colors.brandSecondary, marginTop: 2 },
  badge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  badgeActive: { backgroundColor: colors.success + '15' },
  badgeInactive: { backgroundColor: colors.muted + '20' },
  badgeText: { fontSize: 10, fontWeight: '800' },
  actionBtns: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  editBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.md,
    backgroundColor: colors.brandPrimary + '12',
    borderWidth: 1,
    borderColor: colors.brandPrimary + '35',
  },
  editBtnText: {
    fontSize: font.xs,
    fontWeight: '700',
    color: colors.brandPrimary,
  },
  delBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.md,
    backgroundColor: colors.error + '12',
    borderWidth: 1,
    borderColor: colors.error + '35',
  },
  delBtnText: {
    fontSize: font.xs,
    fontWeight: '700',
    color: colors.error,
  },
  btnPressed: {
    opacity: 0.7,
    transform: [{ scale: 0.96 }],
  },
  detailsGrid: { marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.divider, gap: 6 },
  detailItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  detailText: { fontSize: font.sm, color: colors.muted, flex: 1 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalBox: { backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, maxHeight: '90%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border },
  modalTitle: { fontSize: font.lg, fontWeight: '700', color: colors.onSurface },
  modalSubTitle: { fontSize: font.xs, fontWeight: '700', color: colors.brandSecondary, marginTop: 2 },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FEE2E2',
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#FCA5A5',
    marginBottom: 8,
  },
  errorText: { color: colors.error, fontSize: font.sm, flex: 1, fontWeight: '600' },
  fieldLabel: { fontSize: font.sm, fontWeight: '600', color: colors.onSurface, marginBottom: 4 },
  statusOption: { flex: 1, paddingVertical: 8, alignItems: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: radius.md },
  statusOptionSelected: { borderColor: colors.brandPrimary, backgroundColor: colors.brandPrimary + '10' },
  statusOptionText: { fontSize: font.sm, color: colors.muted },
  geoSection: { marginTop: spacing.md, padding: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, gap: spacing.sm },
  geoTitle: { fontSize: font.sm, fontWeight: '700', color: colors.onSurface },
  myLocBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  myLocText: { fontSize: font.xs, fontWeight: '700', color: colors.brandPrimary },

  /* Confirm Modal Styles */
  confirmOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  confirmBox: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.xl,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 8,
  },
  confirmIconContainer: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#FEE2E2',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  confirmTitle: {
    fontSize: font.xl,
    fontWeight: '800',
    color: colors.onSurface,
    marginBottom: spacing.xs,
  },
  confirmMessage: {
    fontSize: font.base,
    color: colors.onSurface,
    textAlign: 'center',
    marginBottom: spacing.xs,
    lineHeight: 22,
  },
  confirmSubtext: {
    fontSize: font.xs,
    color: colors.muted,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  confirmButtons: {
    flexDirection: 'row',
    gap: spacing.md,
    width: '100%',
  },
  deleteConfirmBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: colors.error,
    paddingVertical: 12,
    borderRadius: radius.md,
  },
  deleteConfirmBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: font.base,
  },
});
