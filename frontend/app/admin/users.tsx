import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, Modal, KeyboardAvoidingView, Platform, ScrollView, Alert, TextInput } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { colors, spacing, radius, font } from '@/src/theme';
import { api } from '@/src/api';
import { Card, EmptyState, ScreenLoader, PrimaryButton, SecondaryButton, Avatar } from '@/src/ui';
import { ScreenHeader } from '@/src/ScreenHeader';
import { FormInput } from '@/src/forms';

type UserForm = {
  user_id?: string;
  name: string;
  username: string;
  email: string;
  password?: string;
  mobile: string;
  address: string;
  status: string;
  branch_id: string;
  post_id: string;
  role_id: string;
};

const emptyUser: UserForm = {
  name: '',
  username: '',
  email: '',
  password: '',
  mobile: '',
  address: '',
  status: 'active',
  branch_id: '',
  post_id: '',
  role_id: 'employee',
};

export default function UserManagementScreen() {
  const [users, setUsers] = useState<any[] | null>(null);
  const [branches, setBranches] = useState<any[]>([]);
  const [posts, setPosts] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);

  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [selectedUserForDocs, setSelectedUserForDocs] = useState<any | null>(null);
  const [form, setForm] = useState<UserForm>(emptyUser);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      let url = '/manage-users';
      if (search.trim()) url += `?q=${encodeURIComponent(search.trim())}`;
      const [uData, bData, pData, rData] = await Promise.all([
        api.get<any[]>(url),
        api.get<any[]>('/branches').catch(() => []),
        api.get<any[]>('/posts').catch(() => []),
        api.get<any[]>('/roles').catch(() => []),
      ]);
      setUsers(uData);
      setBranches(bData);
      setPosts(pData);
      setRoles(rData);
    } catch {
      setUsers([]);
    }
  }, [search]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openNew = () => {
    setForm(emptyUser);
    setErr(null);
    setShowForm(true);
  };

  const openEdit = (u: any) => {
    setForm({
      user_id: u.user_id,
      name: u.name,
      username: u.username || '',
      email: u.email,
      password: '',
      mobile: u.mobile || '',
      address: u.address || '',
      status: u.status || 'active',
      branch_id: u.branch_id || '',
      post_id: u.post_id || '',
      role_id: u.role_id || 'employee',
    });
    setErr(null);
    setShowForm(true);
  };

  const save = async () => {
    if (!form.name.trim() || !form.email.trim()) {
      setErr('Name and Email are required');
      return;
    }
    if (!form.user_id && !form.password) {
      setErr('Password is required for new user');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const payload: any = {
        name: form.name.trim(),
        username: form.username.trim() || undefined,
        email: form.email.trim(),
        mobile: form.mobile.trim() || undefined,
        address: form.address.trim() || undefined,
        status: form.status,
        branch_id: form.branch_id || undefined,
        post_id: form.post_id || undefined,
        role_id: form.role_id || 'employee',
      };
      if (form.password) payload.password = form.password;

      if (form.user_id) {
        await api.patch(`/manage-users/${form.user_id}`, payload);
      } else {
        await api.post('/manage-users', payload);
      }
      setShowForm(false);
      await load();
    } catch (e: any) {
      setErr(e?.message || 'Failed to save user');
    } finally {
      setBusy(false);
    }
  };

  const pickAndUploadDocument = async (user_id: string) => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ['*/*'],
        copyToCacheDirectory: true,
      });
      if (res.canceled || !res.assets?.[0]) return;
      const file = res.assets[0];
      if ((file.size || 0) > 10 * 1024 * 1024) {
        Alert.alert('File too large', 'Maximum attachment size is 10 MB');
        return;
      }
      await api.uploadUserDoc(user_id, {
        uri: file.uri,
        name: file.name,
        type: file.mimeType || 'application/octet-stream'
      }, 'Identity', 'Supporting document');
      
      const refreshed = await api.get<any>(`/manage-users/${user_id}`);
      setSelectedUserForDocs(refreshed);
      await load();
    } catch (e: any) {
      Alert.alert('Upload Error', e?.message || 'Failed to upload');
    }
  };

  const deleteDoc = async (userId: string, docId: string) => {
    try {
      await api.del(`/manage-users/${userId}/documents/${docId}`);
      const refreshed = await api.get<any>(`/manage-users/${userId}`);
      setSelectedUserForDocs(refreshed);
      await load();
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Delete failed');
    }
  };

  return (
    <View style={styles.container}>
      <ScreenHeader
        title="User Management"
        right={
          <Pressable onPress={openNew} style={styles.addButton}>
            <Ionicons name="person-add" size={20} color={colors.onBrandPrimary} />
          </Pressable>
        }
      />

      <View style={styles.searchBarBox}>
        <View style={styles.searchBar}>
          <Ionicons name="search" size={18} color={colors.muted} />
          <TextInput
            placeholder="Search by name, ID, email, branch..."
            value={search}
            onChangeText={t => setSearch(t)}
            onSubmitEditing={load}
            style={styles.searchInput}
          />
        </View>
      </View>

      {users === null ? (
        <ScreenLoader />
      ) : users.length === 0 ? (
        <EmptyState
          icon="people-outline"
          title="No Users Found"
          subtitle="Add organization staff and map them to Branch, Post, and Role."
          actionLabel="+ Add User"
          onAction={openNew}
        />
      ) : (
        <FlatList
          data={users}
          keyExtractor={item => item.user_id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <Card>
              <View style={styles.cardHeader}>
                <Avatar name={item.name} size={44} />
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={styles.userName}>{item.name}</Text>
                    <View style={[styles.badge, item.status === 'active' ? styles.badgeActive : styles.badgeInactive]}>
                      <Text style={[styles.badgeText, { color: item.status === 'active' ? colors.success : colors.muted }]}>
                        {item.status.toUpperCase()}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.userCode}>{item.user_id} • {item.email}</Text>
                </View>

                <View style={styles.actionBtns}>
                  <Pressable onPress={() => openEdit(item)} style={styles.editBtn}>
                    <Ionicons name="pencil" size={18} color={colors.brandPrimary} />
                  </Pressable>
                </View>
              </View>

              {/* User Mapping Badge Row */}
              <View style={styles.mappingRow}>
                <View style={styles.mapPill}>
                  <Ionicons name="business" size={12} color={colors.brandPrimary} />
                  <Text style={styles.mapPillText}>{item.branch_name || 'No Branch'}</Text>
                </View>
                <Ionicons name="arrow-forward" size={12} color={colors.muted} />
                <View style={styles.mapPill}>
                  <Ionicons name="briefcase" size={12} color={colors.brandSecondary} />
                  <Text style={styles.mapPillText}>{item.post_title || 'No Post'}</Text>
                </View>
                <Ionicons name="arrow-forward" size={12} color={colors.muted} />
                <View style={[styles.mapPill, { backgroundColor: colors.success + '15' }]}>
                  <Ionicons name="shield-checkmark" size={12} color={colors.success} />
                  <Text style={[styles.mapPillText, { color: colors.success }]}>{item.role_name || item.role}</Text>
                </View>
              </View>

              {/* Documents Button */}
              <View style={styles.cardFooter}>
                <Pressable onPress={() => setSelectedUserForDocs(item)} style={styles.docButton}>
                  <Ionicons name="document-attach" size={16} color={colors.brandPrimary} />
                  <Text style={styles.docButtonText}>
                    Documents ({(item.documents || []).length})
                  </Text>
                </Pressable>
                {item.mobile ? (
                  <Text style={styles.mobileText}><Ionicons name="call-outline" size={13} color={colors.muted} /> {item.mobile}</Text>
                ) : null}
              </View>
            </Card>
          )}
        />
      )}

      {/* User Edit/Add Modal */}
      <Modal visible={showForm} animationType="slide" transparent>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{form.user_id ? `Edit ${form.user_id}` : 'Add New User'}</Text>
              <Pressable onPress={() => setShowForm(false)}>
                <Ionicons name="close" size={24} color={colors.muted} />
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
              {err ? <Text style={styles.errorText}>{err}</Text> : null}

              <FormInput label="Full Name *" value={form.name} onChangeText={t => setForm(p => ({ ...p, name: t }))} placeholder="Employee / User Full Name" />
              <FormInput label="Email ID *" value={form.email} onChangeText={t => setForm(p => ({ ...p, email: t }))} keyboardType="email-address" placeholder="user@triveni.com" />
              <FormInput label="Username" value={form.username} onChangeText={t => setForm(p => ({ ...p, username: t }))} placeholder="Unique username" />
              <FormInput label={form.user_id ? "Change Password (optional)" : "Password *"} value={form.password} onChangeText={t => setForm(p => ({ ...p, password: t }))} secureTextEntry placeholder="••••••••" />
              <FormInput label="Mobile Number" value={form.mobile} onChangeText={t => setForm(p => ({ ...p, mobile: t }))} keyboardType="phone-pad" placeholder="10-digit mobile" />
              <FormInput label="Address" value={form.address} onChangeText={t => setForm(p => ({ ...p, address: t }))} placeholder="Residential address" />

              {/* User Mapping Selectors */}
              <View style={styles.mappingSection}>
                <Text style={styles.sectionHeader}>User Mapping (User → Branch → Post → Role)</Text>
                
                {/* Branch */}
                <Text style={styles.fieldLabel}>Branch Office</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                  {branches.map(b => (
                    <Pressable
                      key={b.branch_id}
                      onPress={() => setForm(p => ({ ...p, branch_id: b.branch_id }))}
                      style={[styles.selectPill, form.branch_id === b.branch_id && styles.selectPillActive]}
                    >
                      <Text style={[styles.selectPillText, form.branch_id === b.branch_id && styles.selectPillTextActive]}>
                        {b.name}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>

                {/* Post */}
                <Text style={[styles.fieldLabel, { marginTop: 10 }]}>Post Designation</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                  {posts.map(pst => (
                    <Pressable
                      key={pst.post_id}
                      onPress={() => setForm(p => ({ ...p, post_id: pst.post_id }))}
                      style={[styles.selectPill, form.post_id === pst.post_id && styles.selectPillActive]}
                    >
                      <Text style={[styles.selectPillText, form.post_id === pst.post_id && styles.selectPillTextActive]}>
                        {pst.title}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>

                {/* Role */}
                <Text style={[styles.fieldLabel, { marginTop: 10 }]}>Assigned Role</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                  {roles.map(r => (
                    <Pressable
                      key={r.role_id}
                      onPress={() => setForm(p => ({ ...p, role_id: r.role_id }))}
                      style={[styles.selectPill, form.role_id === r.role_id && styles.selectPillActive]}
                    >
                      <Text style={[styles.selectPillText, form.role_id === r.role_id && styles.selectPillTextActive]}>
                        {r.name}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>

              <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg }}>
                <SecondaryButton title="Cancel" onPress={() => setShowForm(false)} style={{ flex: 1 }} />
                <PrimaryButton title={busy ? 'Saving...' : 'Save User'} onPress={save} disabled={busy} style={{ flex: 1 }} />
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* User Documents Modal */}
      <Modal visible={!!selectedUserForDocs} animationType="fade" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBox, { maxHeight: '80%', padding: spacing.lg }]}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>User Documents</Text>
                <Text style={styles.subText}>{selectedUserForDocs?.name} ({selectedUserForDocs?.user_id})</Text>
              </View>
              <Pressable onPress={() => setSelectedUserForDocs(null)}>
                <Ionicons name="close" size={24} color={colors.muted} />
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={{ gap: spacing.md, paddingVertical: spacing.md }}>
              {(selectedUserForDocs?.documents || []).length === 0 ? (
                <Text style={styles.emptyDocText}>No supporting documents attached yet (Max 10 MB per file).</Text>
              ) : (
                (selectedUserForDocs?.documents || []).map((d: any) => (
                  <View key={d.id} style={styles.docRow}>
                    <Ionicons name="document-text" size={24} color={colors.brandPrimary} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.docName}>{d.name}</Text>
                      <Text style={styles.docMeta}>
                        {d.doc_type} • {(d.size / 1024).toFixed(1)} KB
                      </Text>
                    </View>
                    <Pressable onPress={() => deleteDoc(selectedUserForDocs.user_id, d.id)} style={styles.delBtn}>
                      <Ionicons name="trash-outline" size={18} color={colors.error} />
                    </Pressable>
                  </View>
                ))
              )}

              <PrimaryButton
                title="+ Upload Document (Max 10 MB)"
                onPress={() => pickAndUploadDocument(selectedUserForDocs.user_id)}
                style={{ marginTop: spacing.md }}
              />
            </ScrollView>
          </View>
        </View>
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
  userName: { fontSize: font.lg, fontWeight: '700', color: colors.onSurface },
  userCode: { fontSize: font.xs, fontWeight: '700', color: colors.muted, marginTop: 2 },
  badge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  badgeActive: { backgroundColor: colors.success + '15' },
  badgeInactive: { backgroundColor: colors.muted + '20' },
  badgeText: { fontSize: 10, fontWeight: '800' },
  actionBtns: { flexDirection: 'row', gap: 8 },
  editBtn: { padding: 6, borderRadius: radius.sm, backgroundColor: colors.surfaceSecondary },
  mappingRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.md, flexWrap: 'wrap' },
  mapPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.sm, backgroundColor: colors.surfaceSecondary },
  mapPillText: { fontSize: 11, fontWeight: '600', color: colors.onSurface },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.divider },
  docButton: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.sm, backgroundColor: colors.brandPrimary + '10' },
  docButtonText: { fontSize: font.xs, fontWeight: '700', color: colors.brandPrimary },
  mobileText: { fontSize: font.xs, color: colors.muted },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalBox: { backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, maxHeight: '90%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border },
  modalTitle: { fontSize: font.lg, fontWeight: '700', color: colors.onSurface },
  subText: { fontSize: font.xs, color: colors.muted, marginTop: 2 },
  errorText: { color: colors.error, fontSize: font.sm, marginBottom: 8 },
  fieldLabel: { fontSize: font.sm, fontWeight: '600', color: colors.onSurface, marginBottom: 4 },
  mappingSection: { marginTop: spacing.sm, padding: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  sectionHeader: { fontSize: font.sm, fontWeight: '700', color: colors.brandPrimary, marginBottom: spacing.sm },
  selectPill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.full, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  selectPillActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  selectPillText: { fontSize: 12, fontWeight: '600', color: colors.onSurface },
  selectPillTextActive: { color: colors.onBrandPrimary },
  emptyDocText: { textAlign: 'center', color: colors.muted, fontSize: font.sm, marginVertical: 20 },
  docRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md },
  docName: { fontSize: font.sm, fontWeight: '600', color: colors.onSurface },
  docMeta: { fontSize: font.xs, color: colors.muted, marginTop: 2 },
  delBtn: { padding: 6, borderRadius: radius.sm, backgroundColor: colors.error + '10' },
});
