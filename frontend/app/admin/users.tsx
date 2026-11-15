import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, Modal, KeyboardAvoidingView, Platform, ScrollView, Alert, TextInput } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { colors, spacing, radius, font } from '@/src/theme';
import { api } from '@/src/api';
import { Card, EmptyState, ScreenLoader, PrimaryButton, SecondaryButton, Avatar } from '@/src/ui';
import { ScreenHeader } from '@/src/ScreenHeader';
import { FormInput } from '@/src/forms';
import { useAuth } from '@/src/AuthContext';
import { confirm, notify } from '@/src/dialog';
import { EmployeeSearchModal, PickedEmployee } from '@/src/EmployeeSearchModal';

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
  employee_id?: string;
  employee_code?: string;
  pan?: string;
  aadhar?: string;
  date_of_joining?: string;
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
  employee_id: '',
  employee_code: '',
  pan: '',
  aadhar: '',
  date_of_joining: '',
};

export default function UserManagementScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'super_admin';
  const isAdmin = user?.role === 'admin' || isSuperAdmin;

  const [users, setUsers] = useState<any[] | null>(null);
  const [branches, setBranches] = useState<any[]>([]);
  const [posts, setPosts] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);

  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [selectedUserForDocs, setSelectedUserForDocs] = useState<any | null>(null);
  const [form, setForm] = useState<UserForm>(emptyUser);
  const [showEmployeeSearch, setShowEmployeeSearch] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<PickedEmployee | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Bulk action states
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [busyBulk, setBusyBulk] = useState(false);
  const [bulkModalType, setBulkModalType] = useState<'status' | 'branch' | 'post' | null>(null);
  const [bulkSelectedOption, setBulkSelectedOption] = useState<string>('');
  const [includeCustomers, setIncludeCustomers] = useState<boolean>(false);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      let url = '/manage-users';
      const params: string[] = [];
      if (search.trim()) params.push(`q=${encodeURIComponent(search.trim())}`);
      if (includeCustomers) params.push('include_customers=true');
      if (params.length > 0) url += `?${params.join('&')}`;
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
    } catch (e: any) {
      setLoadError(e?.message || 'Failed to load user directory');
      setUsers([]);
    }
  }, [search, includeCustomers]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handlePickEmployee = (emp: PickedEmployee) => {
    setSelectedEmployee(emp);

    // Auto match branch
    let matchedBranchId = form.branch_id;
    if (emp.posting_branch || emp.office_id) {
      const bFound = branches.find(b =>
        (emp.office_id && (b.branch_id === emp.office_id || b.id === emp.office_id)) ||
        (emp.posting_branch && b.name && b.name.toLowerCase().includes(emp.posting_branch.toLowerCase())) ||
        (emp.posting_branch && b.name && emp.posting_branch.toLowerCase().includes(b.name.toLowerCase()))
      );
      if (bFound) matchedBranchId = bFound.branch_id;
    }

    // Auto match post designation
    let matchedPostId = form.post_id;
    if (emp.designation) {
      const pFound = posts.find(p =>
        (p.title && p.title.toLowerCase().includes(emp.designation!.toLowerCase())) ||
        (p.title && emp.designation!.toLowerCase().includes(p.title.toLowerCase()))
      );
      if (pFound) matchedPostId = pFound.post_id;
    }

    // Auto generate suggested username from employee code or email prefix
    let suggestedUsername = form.username;
    if (!suggestedUsername) {
      if (emp.employee_code) {
        suggestedUsername = emp.employee_code.toLowerCase().replace(/[^a-z0-9]/g, '');
      } else if (emp.email) {
        suggestedUsername = emp.email.split('@')[0].toLowerCase().replace(/[^a-z0-9._-]/g, '');
      }
    }

    setForm(p => ({
      ...p,
      name: emp.name || p.name,
      email: emp.email || p.email,
      mobile: emp.mobile || p.mobile,
      address: emp.address || p.address,
      pan: emp.pan || p.pan || '',
      aadhar: emp.aadhar || p.aadhar || '',
      date_of_joining: emp.date_of_joining || p.date_of_joining || '',
      employee_id: emp.id,
      employee_code: emp.employee_code || emp.id,
      branch_id: matchedBranchId,
      post_id: matchedPostId,
      username: suggestedUsername,
    }));
  };

  const openNew = () => {
    setForm(emptyUser);
    setSelectedEmployee(null);
    setErr(null);
    setShowForm(true);
  };

  const openEdit = (u: any) => {
    const targetIsSuperAdmin = u.role === 'super_admin' || u.role_id === 'super_admin';
    if (targetIsSuperAdmin && !isSuperAdmin) {
      Alert.alert('Access Denied', 'Administrators cannot modify a Super Admin profile.');
      return;
    }
    setSelectedEmployee(u.employee_id ? {
      id: u.employee_id,
      employee_code: u.employee_code,
      name: u.name,
      email: u.email,
      mobile: u.mobile,
      pan: u.pan,
      aadhar: u.aadhar,
      date_of_joining: u.date_of_joining,
    } : null);
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
      role_id: u.role_id || u.role || 'employee',
      employee_id: u.employee_id || '',
      employee_code: u.employee_code || '',
      pan: u.pan || '',
      aadhar: u.aadhar || '',
      date_of_joining: u.date_of_joining || '',
    });
    setErr(null);
    setShowForm(true);
  };

  const handleDeleteUser = async (u: any) => {
    const targetIsSuperAdmin = u.role === 'super_admin' || u.role_id === 'super_admin';
    if (targetIsSuperAdmin && !isSuperAdmin) {
      Alert.alert('Access Denied', 'Administrators cannot remove a Super Admin account.');
      return;
    }
    if (u.user_id === user?.user_id) {
      Alert.alert('Action Not Allowed', 'You cannot delete your own logged-in account.');
      return;
    }
    const ok = await confirm(
      'Delete User',
      `Are you sure you want to permanently delete user "${u.name}" (${u.email})? This action cannot be undone.`,
      { confirmText: 'Delete', destructive: true }
    );
    if (!ok) return;

    try {
      await api.del(`/manage-users/${u.user_id}`);
      notify('User deleted successfully');
      await load();
    } catch (e: any) {
      Alert.alert('Delete Failed', e?.message || 'Failed to delete user');
    }
  };

  const selectedCount = Object.values(selected).filter(Boolean).length;
  const toggleSelect = (uid: string) => setSelected(p => ({ ...p, [uid]: !p[uid] }));
  const toggleSelectAll = () => {
    if (!users) return;
    const all = users.length > 0 && users.every(u => selected[u.user_id]);
    if (all) { setSelected({}); return; }
    const next: Record<string, boolean> = {};
    users.forEach(u => { next[u.user_id] = true; });
    setSelected(next);
  };
  const exitSelectMode = () => { setSelectMode(false); setSelected({}); };

  const handleBulkDelete = async () => {
    const ids = Object.keys(selected).filter(k => selected[k]);
    if (ids.length === 0) return;
    if (user?.user_id && ids.includes(user.user_id)) {
      Alert.alert('Action Denied', 'You cannot delete your own logged-in account in a bulk action.');
      return;
    }
    const ok = await confirm(
      'Bulk Delete Users',
      `Are you sure you want to permanently delete ${ids.length} selected user(s)? This action cannot be undone.`,
      { confirmText: 'Delete All', destructive: true }
    );
    if (!ok) return;
    setBusyBulk(true);
    try {
      const res: any = await api.post('/manage-users/bulk-action', { user_ids: ids, action: 'delete' });
      notify(res?.message || 'Users deleted');
      exitSelectMode();
      await load();
    } catch (e: any) {
      Alert.alert('Bulk Delete Failed', e?.message || 'Failed to delete users');
    } finally {
      setBusyBulk(false);
    }
  };

  const handleExecuteBulkAction = async () => {
    const ids = Object.keys(selected).filter(k => selected[k]);
    if (ids.length === 0 || !bulkModalType) return;
    setBusyBulk(true);
    try {
      let payload: any = { user_ids: ids };
      if (bulkModalType === 'status') {
        payload.action = 'set_status';
        payload.status = bulkSelectedOption || 'active';
      } else if (bulkModalType === 'branch') {
        payload.action = 'set_branch';
        payload.branch_id = bulkSelectedOption;
      } else if (bulkModalType === 'post') {
        payload.action = 'set_post';
        payload.post_id = bulkSelectedOption;
      }
      const res: any = await api.post('/manage-users/bulk-action', payload);
      notify(res?.message || 'Users updated');
      setBulkModalType(null);
      exitSelectMode();
      await load();
    } catch (e: any) {
      Alert.alert('Bulk Update Failed', e?.message || 'Failed to update users');
    } finally {
      setBusyBulk(false);
    }
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
    if (form.role_id === 'super_admin' && !isSuperAdmin) {
      setErr('Only Super Admin can assign the Super Admin role');
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
        employee_id: form.employee_id || undefined,
        employee_code: form.employee_code || undefined,
        pan: form.pan?.trim().toUpperCase() || undefined,
        aadhar: form.aadhar?.trim() || undefined,
        date_of_joining: form.date_of_joining?.trim() || undefined,
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
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <Pressable
              onPress={() => {
                if (selectMode) exitSelectMode();
                else setSelectMode(true);
              }}
              style={[styles.selectHeaderBtn, selectMode && styles.selectHeaderBtnActive]}
            >
              <Ionicons
                name={selectMode ? "close-circle" : "checkbox-outline"}
                size={18}
                color={selectMode ? colors.brandPrimary : colors.onSurface}
              />
              <Text style={[styles.selectHeaderBtnText, selectMode && { color: colors.brandPrimary }]}>
                {selectMode ? 'Cancel' : 'Select'}
              </Text>
            </Pressable>
            <Pressable onPress={openNew} style={styles.addButton}>
              <Ionicons name="person-add" size={20} color={colors.onBrandPrimary} />
            </Pressable>
          </View>
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
        <View style={styles.tabFilterRow}>
          <Pressable
            style={[styles.tabFilterPill, !includeCustomers && styles.tabFilterPillActive]}
            onPress={() => setIncludeCustomers(false)}
          >
            <Ionicons name="people" size={14} color={!includeCustomers ? '#FFFFFF' : colors.muted} />
            <Text style={[styles.tabFilterPillText, !includeCustomers && styles.tabFilterPillTextActive]}>
              Staff Directory
            </Text>
          </Pressable>
          <Pressable
            style={[styles.tabFilterPill, includeCustomers && styles.tabFilterPillActive]}
            onPress={() => setIncludeCustomers(true)}
          >
            <Ionicons name="globe-outline" size={14} color={includeCustomers ? '#FFFFFF' : colors.muted} />
            <Text style={[styles.tabFilterPillText, includeCustomers && styles.tabFilterPillTextActive]}>
              All Users (Inc. Portal)
            </Text>
          </Pressable>
        </View>
      </View>

      {selectMode && (
        <View style={styles.bulkSubHeader}>
          <Pressable onPress={toggleSelectAll} style={styles.selectAllToggle}>
            <Ionicons
              name={users && users.length > 0 && users.every(u => selected[u.user_id]) ? "checkbox" : "square-outline"}
              size={20}
              color={colors.brandPrimary}
            />
            <Text style={styles.selectAllToggleText}>
              {users && users.length > 0 && users.every(u => selected[u.user_id]) ? "Deselect All" : "Select All"}
            </Text>
          </Pressable>
          <Text style={styles.selectedCountText}>{selectedCount} selected</Text>
        </View>
      )}

      {users === null ? (
        <ScreenLoader />
      ) : loadError ? (
        <EmptyState
          icon="alert-circle-outline"
          title="Unable to Load Users"
          subtitle={`Error: ${loadError}`}
          actionLabel="Retry"
          onAction={load}
        />
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
          contentContainerStyle={[styles.listContent, { paddingBottom: (selectMode ? 120 : 60) + insets.bottom }]}
          renderItem={({ item }) => (
            <Card>
              <View style={styles.cardHeader}>
                {selectMode && (
                  <Pressable onPress={() => toggleSelect(item.user_id)} hitSlop={8} style={{ marginRight: 4 }}>
                    <Ionicons
                      name={selected[item.user_id] ? "checkbox" : "square-outline"}
                      size={22}
                      color={selected[item.user_id] ? colors.brandPrimary : colors.muted}
                    />
                  </Pressable>
                )}
                <Avatar name={item.name} size={44} />
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
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
                  {(item.role === 'super_admin' || item.role_id === 'super_admin') && !isSuperAdmin ? (
                    <View style={styles.protectedBadge}>
                      <Ionicons name="shield" size={13} color={colors.warning} />
                      <Text style={styles.protectedText}>Protected</Text>
                    </View>
                  ) : (
                    <>
                      <Pressable onPress={() => openEdit(item)} style={styles.editBtn}>
                        <Ionicons name="pencil" size={17} color={colors.brandPrimary} />
                      </Pressable>
                      {item.user_id !== user?.user_id && (
                        <Pressable onPress={() => handleDeleteUser(item)} style={styles.delBtn}>
                          <Ionicons name="trash-outline" size={17} color={colors.error} />
                        </Pressable>
                      )}
                    </>
                  )}
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
                <View style={[
                  styles.mapPill,
                  (item.role_id === 'super_admin' || item.role === 'super_admin')
                    ? { backgroundColor: colors.brandPrimary + '15' }
                    : { backgroundColor: colors.success + '15' }
                ]}>
                  <Ionicons
                    name={(item.role_id === 'super_admin' || item.role === 'super_admin') ? "shield" : "shield-checkmark"}
                    size={12}
                    color={(item.role_id === 'super_admin' || item.role === 'super_admin') ? colors.brandPrimary : colors.success}
                  />
                  <Text style={[
                    styles.mapPillText,
                    { color: (item.role_id === 'super_admin' || item.role === 'super_admin') ? colors.brandPrimary : colors.success, fontWeight: '700' }
                  ]}>
                    {item.role_name || item.role}
                  </Text>
                </View>
                {item.employee_code ? (
                  <View style={[styles.mapPill, { backgroundColor: '#EEF2FF', borderWidth: 1, borderColor: '#C7D2FE' }]}>
                    <Ionicons name="id-card-outline" size={12} color="#4338CA" />
                    <Text style={[styles.mapPillText, { color: '#4338CA', fontWeight: '800' }]}>{item.employee_code}</Text>
                  </View>
                ) : null}
                {item.pan ? (
                  <View style={[styles.mapPill, { backgroundColor: '#F0FDF4', borderWidth: 1, borderColor: '#BBF7D0' }]}>
                    <Text style={[styles.mapPillText, { color: '#15803D', fontWeight: '800' }]}>PAN: {item.pan}</Text>
                  </View>
                ) : null}
              </View>

              {/* Documents & Rights Buttons */}
              <View style={styles.cardFooter}>
                <Pressable onPress={() => setSelectedUserForDocs(item)} style={styles.docButton}>
                  <Ionicons name="document-attach" size={16} color={colors.brandPrimary} />
                  <Text style={styles.docButtonText}>
                    Documents ({(item.documents || []).length})
                  </Text>
                </Pressable>

                <Pressable
                  onPress={() => router.push({ pathname: '/admin/roles', params: { view: 'users', user_id: item.user_id } } as any)}
                  style={[styles.docButton, { borderColor: colors.brandPrimary + '40', backgroundColor: colors.brandPrimary + '10' }]}
                  testID={`btn-user-rights-${item.user_id}`}
                >
                  <Ionicons name="shield-checkmark-outline" size={15} color={colors.brandPrimary} />
                  <Text style={[styles.docButtonText, { color: colors.brandPrimary, fontWeight: '700' }]}>
                    Rights & Menus
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

      {/* Floating Bulk Action Bar */}
      {selectMode && (
        <View style={[styles.bulkFloatingBar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <View style={styles.bulkActionsRow}>
            <Pressable
              disabled={selectedCount === 0 || busyBulk}
              onPress={() => { setBulkSelectedOption('active'); setBulkModalType('status'); }}
              style={[styles.bulkActionButton, { backgroundColor: '#F0FDF4', borderColor: '#BBF7D0' }]}
            >
              <Ionicons name="swap-horizontal" size={15} color="#15803D" />
              <Text style={[styles.bulkActionText, { color: '#15803D' }]}>Status</Text>
            </Pressable>

            <Pressable
              disabled={selectedCount === 0 || busyBulk}
              onPress={() => { setBulkSelectedOption(branches[0]?.branch_id || ''); setBulkModalType('branch'); }}
              style={[styles.bulkActionButton, { backgroundColor: '#EFF6FF', borderColor: '#BFDBFE' }]}
            >
              <Ionicons name="business-outline" size={15} color={colors.brandPrimary} />
              <Text style={[styles.bulkActionText, { color: colors.brandPrimary }]}>Branch</Text>
            </Pressable>

            <Pressable
              disabled={selectedCount === 0 || busyBulk}
              onPress={() => { setBulkSelectedOption(posts[0]?.post_id || ''); setBulkModalType('post'); }}
              style={[styles.bulkActionButton, { backgroundColor: '#F5F3FF', borderColor: '#DDD6FE' }]}
            >
              <Ionicons name="briefcase-outline" size={15} color="#6D28D9" />
              <Text style={[styles.bulkActionText, { color: "#6D28D9" }]}>Post</Text>
            </Pressable>

            <Pressable
              disabled={selectedCount === 0 || busyBulk}
              onPress={handleBulkDelete}
              style={[styles.bulkActionButton, { backgroundColor: '#FEF2F2', borderColor: '#FECACA' }]}
            >
              <Ionicons name="trash-outline" size={15} color={colors.error} />
              <Text style={[styles.bulkActionText, { color: colors.error }]}>Delete ({selectedCount})</Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* Bulk Action Options Modal */}
      <Modal visible={!!bulkModalType} animationType="fade" transparent onRequestClose={() => setBulkModalType(null)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBox, { maxHeight: '80%', padding: spacing.lg }]}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>
                  {bulkModalType === 'status' ? 'Bulk Update Status' :
                   bulkModalType === 'branch' ? 'Bulk Assign Branch' : 'Bulk Assign Post'}
                </Text>
                <Text style={styles.subText}>Applying to {selectedCount} selected user(s)</Text>
              </View>
              <Pressable onPress={() => setBulkModalType(null)}>
                <Ionicons name="close" size={24} color={colors.muted} />
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={{ gap: spacing.sm, paddingVertical: spacing.md }}>
              {bulkModalType === 'status' && (
                ['active', 'inactive'].map(st => (
                  <Pressable
                    key={st}
                    onPress={() => setBulkSelectedOption(st)}
                    style={[styles.modalOptionCard, bulkSelectedOption === st && styles.modalOptionCardActive]}
                  >
                    <Ionicons
                      name={bulkSelectedOption === st ? 'radio-button-on' : 'radio-button-off'}
                      size={20}
                      color={bulkSelectedOption === st ? colors.brandPrimary : colors.muted}
                    />
                    <Text style={[styles.modalOptionText, bulkSelectedOption === st && styles.modalOptionTextActive]}>
                      {st.toUpperCase()}
                    </Text>
                  </Pressable>
                ))
              )}

              {bulkModalType === 'branch' && (
                branches.map(b => (
                  <Pressable
                    key={b.branch_id}
                    onPress={() => setBulkSelectedOption(b.branch_id)}
                    style={[styles.modalOptionCard, bulkSelectedOption === b.branch_id && styles.modalOptionCardActive]}
                  >
                    <Ionicons
                      name={bulkSelectedOption === b.branch_id ? 'radio-button-on' : 'radio-button-off'}
                      size={20}
                      color={bulkSelectedOption === b.branch_id ? colors.brandPrimary : colors.muted}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.modalOptionText, bulkSelectedOption === b.branch_id && styles.modalOptionTextActive]}>
                        {b.name}
                      </Text>
                      {b.address ? <Text style={styles.subText}>{b.address}</Text> : null}
                    </View>
                  </Pressable>
                ))
              )}

              {bulkModalType === 'post' && (
                posts.map(p => (
                  <Pressable
                    key={p.post_id}
                    onPress={() => setBulkSelectedOption(p.post_id)}
                    style={[styles.modalOptionCard, bulkSelectedOption === p.post_id && styles.modalOptionCardActive]}
                  >
                    <Ionicons
                      name={bulkSelectedOption === p.post_id ? 'radio-button-on' : 'radio-button-off'}
                      size={20}
                      color={bulkSelectedOption === p.post_id ? colors.brandPrimary : colors.muted}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.modalOptionText, bulkSelectedOption === p.post_id && styles.modalOptionTextActive]}>
                        {p.title}
                      </Text>
                      <Text style={styles.subText}>{p.department}</Text>
                    </View>
                  </Pressable>
                ))
              )}
            </ScrollView>

            <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.md }}>
              <SecondaryButton label="Cancel" onPress={() => setBulkModalType(null)} style={{ flex: 1 }} />
              <PrimaryButton
                label={busyBulk ? 'Updating...' : 'Apply Bulk Change'}
                onPress={handleExecuteBulkAction}
                disabled={busyBulk}
                loading={busyBulk}
                style={{ flex: 2 }}
              />
            </View>
          </View>
        </View>
      </Modal>

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

            <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: Math.max(insets.bottom, spacing.xl) }}>
              {err ? <Text style={styles.errorText}>{err}</Text> : null}

              {/* Select Employee from Staff Directory Banner */}
              {!form.user_id && (
                <Pressable
                  testID="btn-open-employee-search"
                  onPress={() => setShowEmployeeSearch(true)}
                  style={styles.selectEmployeeBanner}
                >
                  <View style={styles.selectEmployeeIconWrap}>
                    <Ionicons name="search" size={20} color="#FFF" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.selectEmployeeBannerTitle}>
                      {selectedEmployee ? 'Employee Profile Linked' : 'Select Employee from Staff Directory'}
                    </Text>
                    <Text style={styles.selectEmployeeBannerSub}>
                      {selectedEmployee
                        ? `${selectedEmployee.name} (${selectedEmployee.employee_code || selectedEmployee.id}) • Tap to Change`
                        : 'Search by PAN, Aadhar, Mobile No., or Name to auto-fill details'}
                    </Text>
                  </View>
                  <View style={styles.selectEmployeeArrowBtn}>
                    <Ionicons
                      name={selectedEmployee ? "checkmark-circle" : "search"}
                      size={20}
                      color={selectedEmployee ? colors.success : colors.brandPrimary}
                    />
                  </View>
                </Pressable>
              )}

              {/* Mapped Employee Info Card */}
              {selectedEmployee ? (
                <View style={styles.selectedEmpCard}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Ionicons name="shield-checkmark" size={16} color={colors.brandPrimary} />
                      <Text style={styles.selectedEmpHeading}>Staff Record: {selectedEmployee.name}</Text>
                    </View>
                    <Pressable
                      onPress={() => {
                        setSelectedEmployee(null);
                        setForm(p => ({
                          ...p,
                          employee_id: undefined,
                          employee_code: undefined,
                          pan: '',
                          aadhar: '',
                          date_of_joining: '',
                        }));
                      }}
                      hitSlop={8}
                    >
                      <Text style={styles.clearEmpBtnText}>Unlink / Clear</Text>
                    </Pressable>
                  </View>

                  <View style={styles.empInfoGrid}>
                    <View style={styles.empInfoItem}>
                      <Text style={styles.empInfoLabel}>Employee ID / Code</Text>
                      <Text style={styles.empInfoVal}>{selectedEmployee.employee_code || selectedEmployee.id}</Text>
                    </View>
                    {selectedEmployee.pan ? (
                      <View style={styles.empInfoItem}>
                        <Text style={styles.empInfoLabel}>PAN No.</Text>
                        <Text style={[styles.empInfoVal, { color: '#4338CA' }]}>{selectedEmployee.pan}</Text>
                      </View>
                    ) : null}
                    {selectedEmployee.aadhar ? (
                      <View style={styles.empInfoItem}>
                        <Text style={styles.empInfoLabel}>Aadhar No.</Text>
                        <Text style={[styles.empInfoVal, { color: '#BE185D' }]}>{selectedEmployee.aadhar}</Text>
                      </View>
                    ) : null}
                    {selectedEmployee.date_of_joining ? (
                      <View style={styles.empInfoItem}>
                        <Text style={styles.empInfoLabel}>Date of Joining</Text>
                        <Text style={[styles.empInfoVal, { color: '#15803D' }]}>{selectedEmployee.date_of_joining}</Text>
                      </View>
                    ) : null}
                    {selectedEmployee.posting_branch ? (
                      <View style={styles.empInfoItem}>
                        <Text style={styles.empInfoLabel}>Posting Branch</Text>
                        <Text style={styles.empInfoVal}>{selectedEmployee.posting_branch}</Text>
                      </View>
                    ) : null}
                    {selectedEmployee.designation ? (
                      <View style={styles.empInfoItem}>
                        <Text style={styles.empInfoLabel}>Designation</Text>
                        <Text style={styles.empInfoVal}>{selectedEmployee.designation}</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={styles.empNoteText}>
                    ✓ Staff details loaded. Please assign Username/User ID, Password, and Role below.
                  </Text>
                </View>
              ) : null}

              <FormInput label="Full Name *" value={form.name} onChangeText={t => setForm(p => ({ ...p, name: t }))} placeholder="Employee / User Full Name" />
              <FormInput label="Email ID *" value={form.email} onChangeText={t => setForm(p => ({ ...p, email: t }))} keyboardType="email-address" placeholder="user@triveni.com" />
              <FormInput label="Username / User ID" value={form.username} onChangeText={t => setForm(p => ({ ...p, username: t }))} placeholder="Unique username or user ID (optional)" />
              <FormInput label={form.user_id ? "Change Password (optional)" : "Password *"} value={form.password || ''} onChangeText={t => setForm(p => ({ ...p, password: t }))} secureTextEntry placeholder="••••••••" />
              <FormInput label="Mobile Number" value={form.mobile} onChangeText={t => setForm(p => ({ ...p, mobile: t }))} keyboardType="phone-pad" placeholder="10-digit mobile" />
              <FormInput label="Address" value={form.address} onChangeText={t => setForm(p => ({ ...p, address: t }))} placeholder="Residential address" />

              {/* Extra Employee Attributes */}
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <FormInput label="PAN Card No." value={form.pan || ''} onChangeText={t => setForm(p => ({ ...p, pan: t.toUpperCase() }))} placeholder="AAAAA0000A" autoCapitalize="characters" />
                </View>
                <View style={{ flex: 1 }}>
                  <FormInput label="Aadhar No." value={form.aadhar || ''} onChangeText={t => setForm(p => ({ ...p, aadhar: t }))} placeholder="XXXX XXXX XXXX" keyboardType="number-pad" />
                </View>
              </View>
              <FormInput label="Date of Joining" value={form.date_of_joining || ''} onChangeText={t => setForm(p => ({ ...p, date_of_joining: t }))} placeholder="DD-MM-YYYY or YYYY-MM-DD" />

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
                  {roles
                    .filter(r => isSuperAdmin || (r.role_id !== 'super_admin' && r.id !== 'rol_super_admin'))
                    .map(r => (
                    <Pressable
                      key={r.role_id || r.id}
                      onPress={() => setForm(p => ({ ...p, role_id: r.role_id }))}
                      style={[styles.selectPill, form.role_id === r.role_id && styles.selectPillActive]}
                    >
                      <Text style={[styles.selectPillText, form.role_id === r.role_id && styles.selectPillTextActive]}>
                        {r.name}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>

                {/* Role Info Preview */}
                {(() => {
                  const currentSelectedRole = roles.find(r => r.role_id === form.role_id);
                  if (!currentSelectedRole) return null;
                  const menuCount = (currentSelectedRole.allowed_menus || []).length;
                  return (
                    <View style={{ marginTop: 8, padding: 10, backgroundColor: '#F8FAFC', borderRadius: 8, borderWidth: 1, borderColor: '#E2E8F0', gap: 4 }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Text style={{ fontSize: 12, fontWeight: '700', color: colors.onSurface }}>
                          {currentSelectedRole.name} Authority
                        </Text>
                        <Text style={{ fontSize: 11, fontWeight: '700', color: colors.brandPrimary }}>
                          {currentSelectedRole.role_id === 'super_admin' ? 'All Menus Visible' : `${menuCount} Menus Allowed`}
                        </Text>
                      </View>
                      <Text style={{ fontSize: 11, color: colors.muted }}>
                        {currentSelectedRole.description || 'Organizational role with configured access'}
                      </Text>
                    </View>
                  );
                })()}
              </View>

              <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg }}>
                <SecondaryButton label="Cancel" onPress={() => setShowForm(false)} style={{ flex: 1 }} testID="btn-cancel-user" />
                <PrimaryButton
                  label={form.user_id ? (busy ? 'Updating...' : 'Update User') : (busy ? 'Creating...' : 'Create User')}
                  onPress={save}
                  disabled={busy}
                  loading={busy}
                  style={{ flex: 1 }}
                  testID="btn-save-user"
                />
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

      {/* Employee Search & Selection Modal */}
      <EmployeeSearchModal
        visible={showEmployeeSearch}
        onClose={() => setShowEmployeeSearch(false)}
        onPick={handlePickEmployee}
        title="Select Employee"
      />
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
  protectedBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.sm, backgroundColor: colors.warning + '15' },
  protectedText: { fontSize: 11, fontWeight: '700', color: colors.warning },

  // Bulk action styles
  selectHeaderBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  selectHeaderBtnActive: { borderColor: colors.brandPrimary, backgroundColor: colors.brandPrimary + '15' },
  selectHeaderBtnText: { fontSize: font.xs, fontWeight: '700', color: colors.onSurface },
  bulkSubHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingVertical: 10, backgroundColor: '#F8FAFC', borderBottomWidth: 1, borderBottomColor: colors.border },
  selectAllToggle: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  selectAllToggleText: { fontSize: font.sm, fontWeight: '700', color: colors.brandPrimary },
  selectedCountText: { fontSize: font.sm, fontWeight: '800', color: colors.onSurface },
  bulkFloatingBar: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border, paddingHorizontal: spacing.md, paddingTop: spacing.sm, shadowColor: '#000', shadowOffset: { width: 0, height: -3 }, shadowOpacity: 0.1, shadowRadius: 5, elevation: 8 },
  bulkActionsRow: { flexDirection: 'row', gap: 8 },
  bulkActionButton: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 10, borderRadius: radius.md, borderWidth: 1 },
  bulkActionText: { fontSize: 12, fontWeight: '800' },
  modalOptionCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  modalOptionCardActive: { borderColor: colors.brandPrimary, backgroundColor: colors.brandPrimary + '10' },
  modalOptionText: { fontSize: font.base, fontWeight: '700', color: colors.onSurface },
  modalOptionTextActive: { color: colors.brandPrimary },

  // Select Employee Banner & Card
  selectEmployeeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#EFF6FF',
    borderWidth: 1.5,
    borderColor: '#93C5FD',
    borderRadius: radius.md,
    padding: 12,
    marginBottom: spacing.xs,
  },
  selectEmployeeIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.brandPrimary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectEmployeeBannerTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#1E3A8A',
  },
  selectEmployeeBannerSub: {
    fontSize: 11,
    color: '#2563EB',
    marginTop: 2,
    fontWeight: '600',
  },
  selectEmployeeArrowBtn: {
    padding: 4,
  },
  selectedEmpCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    padding: 12,
    gap: 10,
    marginBottom: spacing.xs,
  },
  selectedEmpHeading: {
    fontSize: 12,
    fontWeight: '800',
    color: '#0F172A',
  },
  clearEmpBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.error,
  },
  empInfoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  empInfoItem: {
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  empInfoLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: colors.muted,
    textTransform: 'uppercase',
  },
  empInfoVal: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.onSurface,
    marginTop: 1,
  },
  tabFilterRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  tabFilterPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tabFilterPillActive: {
    backgroundColor: colors.brandPrimary,
    borderColor: colors.brandPrimary,
  },
  tabFilterPillText: {
    fontSize: font.xs,
    fontWeight: '700',
    color: colors.muted,
  },
  tabFilterPillTextActive: {
    color: '#FFFFFF',
  },
  empNoteText: {
    fontSize: 11,
    color: '#16A34A',
    fontWeight: '600',
    lineHeight: 15,
  },
});
