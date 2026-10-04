import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, Modal, KeyboardAvoidingView, Platform, ScrollView, Alert, TextInput } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, font } from '@/src/theme';
import { api } from '@/src/api';
import { Card, EmptyState, ScreenLoader, PrimaryButton, SecondaryButton } from '@/src/ui';
import { ScreenHeader } from '@/src/ScreenHeader';
import { FormInput } from '@/src/forms';

type PostForm = {
  id?: string;
  post_id?: string;
  title: string;
  department: string;
  description: string;
  status: string;
};

const emptyPost: PostForm = {
  title: '',
  department: 'Operations',
  description: '',
  status: 'active',
};

export default function PostsScreen() {
  const [posts, setPosts] = useState<any[] | null>(null);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<PostForm>(emptyPost);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Bulk selection state
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [busyBulk, setBusyBulk] = useState(false);

  const selectedCount = Object.values(selected).filter(Boolean).length;
  const toggleSelect = (id: string) => setSelected(p => ({ ...p, [id]: !p[id] }));
  const toggleSelectAll = () => {
    if (!posts) return;
    const all = posts.length > 0 && posts.every(p => selected[p.id]);
    if (all) { setSelected({}); return; }
    const next: Record<string, boolean> = {};
    posts.forEach(p => { next[p.id] = true; });
    setSelected(next);
  };
  const exitSelectMode = () => { setSelectMode(false); setSelected({}); };

  const handleBulkDelete = async () => {
    const ids = Object.keys(selected).filter(k => selected[k]);
    if (ids.length === 0) return;
    const ok = Platform.OS === 'web'
      ? window.confirm(`Delete ${ids.length} selected post designation(s)?`)
      : await new Promise(res => {
          Alert.alert('Delete Selected Posts?', `${ids.length} posts will be permanently removed.`, [
            { text: 'Cancel', style: 'cancel', onPress: () => res(false) },
            { text: 'Delete All', style: 'destructive', onPress: () => res(true) },
          ]);
        });
    if (!ok) return;

    setBusyBulk(true);
    try {
      const res: any = await api.post('/posts/bulk-delete', { ids });
      if (Platform.OS === 'web') window.alert(res?.message || 'Posts deleted');
      else Alert.alert('Success', res?.message || 'Posts deleted');
      exitSelectMode();
      await load();
    } catch (e: any) {
      if (Platform.OS === 'web') window.alert(e?.message || 'Failed to delete');
      else Alert.alert('Error', e?.message || 'Failed to delete');
    } finally {
      setBusyBulk(false);
    }
  };

  const load = useCallback(async () => {
    try {
      let url = '/posts';
      if (search.trim()) url += `?q=${encodeURIComponent(search.trim())}`;
      const data = await api.get<any[]>(url);
      setPosts(data);
    } catch {
      setPosts([]);
    }
  }, [search]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openNew = () => {
    setForm(emptyPost);
    setErr(null);
    setShowForm(true);
  };

  const openEdit = (p: any) => {
    setForm({
      id: p.id,
      post_id: p.post_id,
      title: p.title,
      department: p.department || 'Operations',
      description: p.description || '',
      status: p.status || 'active',
    });
    setErr(null);
    setShowForm(true);
  };

  const save = async () => {
    if (!form.title.trim()) {
      setErr('Post Title is required');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const payload = {
        title: form.title.trim(),
        department: form.department.trim(),
        description: form.description.trim(),
        status: form.status,
      };
      if (form.id) {
        await api.patch(`/posts/${form.id}`, payload);
      } else {
        await api.post('/posts', payload);
      }
      setShowForm(false);
      await load();
    } catch (e: any) {
      setErr(e?.message || 'Failed to save post');
    } finally {
      setBusy(false);
    }
  };

  const remove = (p: any) => {
    const doDelete = async () => {
      try {
        await api.del(`/posts/${p.id}`);
        await load();
      } catch (e: any) {
        if (Platform.OS === 'web') window.alert(e?.message || 'Delete failed');
        else Alert.alert('Error', e?.message || 'Delete failed');
      }
    };

    if (Platform.OS === 'web') {
      if (window.confirm(`Delete post designation "${p.title}" (${p.post_id})?`)) doDelete();
    } else {
      Alert.alert('Delete Post?', `${p.title} will be removed.`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: doDelete },
      ]);
    }
  };

  return (
    <View style={styles.container}>
      <ScreenHeader
        title="Post Management"
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
              <Ionicons name="add" size={24} color={colors.onBrandPrimary} />
            </Pressable>
          </View>
        }
      />

      <View style={styles.searchBarBox}>
        <View style={styles.searchBar}>
          <Ionicons name="search" size={18} color={colors.muted} />
          <TextInput
            placeholder="Search designations, departments..."
            value={search}
            onChangeText={t => setSearch(t)}
            onSubmitEditing={load}
            style={styles.searchInput}
          />
        </View>
      </View>

      {selectMode && (
        <View style={styles.bulkSubHeader}>
          <Pressable onPress={toggleSelectAll} style={styles.selectAllToggle}>
            <Ionicons
              name={posts && posts.length > 0 && posts.every(p => selected[p.id]) ? "checkbox" : "square-outline"}
              size={20}
              color={colors.brandPrimary}
            />
            <Text style={styles.selectAllToggleText}>
              {posts && posts.length > 0 && posts.every(p => selected[p.id]) ? "Deselect All" : "Select All"}
            </Text>
          </Pressable>
          <Text style={styles.selectedCountText}>{selectedCount} selected</Text>
        </View>
      )}

      {posts === null ? (
        <ScreenLoader />
      ) : posts.length === 0 ? (
        <EmptyState
          icon="ribbon-outline"
          title="No Posts Found"
          subtitle="Define organizational posts such as Branch Manager, Accountant, DEO, etc."
          actionLabel="+ Add Post"
          onAction={openNew}
        />
      ) : (
        <FlatList
          data={posts}
          keyExtractor={item => item.id}
          contentContainerStyle={[styles.listContent, { paddingBottom: selectMode ? 100 : 40 }]}
          renderItem={({ item }) => (
            <Card>
              <View style={styles.cardHeader}>
                {selectMode && (
                  <Pressable onPress={() => toggleSelect(item.id)} hitSlop={8} style={{ marginRight: 4 }}>
                    <Ionicons
                      name={selected[item.id] ? "checkbox" : "square-outline"}
                      size={22}
                      color={selected[item.id] ? colors.brandPrimary : colors.muted}
                    />
                  </Pressable>
                )}
                <View style={styles.postIcon}>
                  <Ionicons name="briefcase" size={20} color={colors.brandSecondary} />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={styles.postTitle}>{item.title}</Text>
                    <View style={[styles.badge, item.status === 'active' ? styles.badgeActive : styles.badgeInactive]}>
                      <Text style={[styles.badgeText, { color: item.status === 'active' ? colors.success : colors.muted }]}>
                        {item.status.toUpperCase()}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.postCode}>{item.post_id} • {item.department}</Text>
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

      {/* Bulk Delete Floating Bar */}
      {selectMode && (
        <View style={styles.bulkFloatingBar}>
          <Pressable
            disabled={selectedCount === 0 || busyBulk}
            onPress={handleBulkDelete}
            style={[styles.bulkDelBtn, { opacity: selectedCount === 0 || busyBulk ? 0.5 : 1 }]}
          >
            <Ionicons name="trash" size={16} color="#FFF" />
            <Text style={styles.bulkDelBtnText}>
              {busyBulk ? 'Deleting…' : `Delete Selected (${selectedCount})`}
            </Text>
          </Pressable>
          <Pressable onPress={exitSelectMode} style={styles.bulkCancelBtn}>
            <Text style={{ color: colors.onSurface, fontWeight: '700' }}>Cancel</Text>
          </Pressable>
        </View>
      )}

      {/* Modal */}
      <Modal visible={showForm} animationType="slide" transparent>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{form.id ? `Edit ${form.post_id}` : 'Create New Post'}</Text>
              <Pressable onPress={() => setShowForm(false)}>
                <Ionicons name="close" size={24} color={colors.muted} />
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
              {err ? <Text style={styles.errorText}>{err}</Text> : null}

              <FormInput label="Post Designation Title *" value={form.title} onChangeText={t => setForm(p => ({ ...p, title: t }))} placeholder="e.g. Branch Manager, Accountant" />
              <FormInput label="Department" value={form.department} onChangeText={t => setForm(p => ({ ...p, department: t }))} placeholder="e.g. Operations, Finance, Legal" />
              <FormInput label="Description / Duties" value={form.description} onChangeText={t => setForm(p => ({ ...p, description: t }))} placeholder="Brief summary of duties and responsibilities" />

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
                <SecondaryButton label="Cancel" onPress={() => setShowForm(false)} style={{ flex: 1 }} testID="btn-cancel-post" />
                <PrimaryButton label={busy ? 'Saving...' : form.id ? 'Update Post' : 'Create Post'} onPress={save} disabled={busy} loading={busy} style={{ flex: 1 }} testID="btn-save-post" />
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
  postIcon: { width: 40, height: 40, borderRadius: 8, backgroundColor: colors.brandSecondary + '15', alignItems: 'center', justifyContent: 'center' },
  postTitle: { fontSize: font.lg, fontWeight: '700', color: colors.onSurface },
  postCode: { fontSize: font.xs, fontWeight: '700', color: colors.muted, marginTop: 2 },
  badge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  badgeActive: { backgroundColor: colors.success + '15' },
  badgeInactive: { backgroundColor: colors.muted + '20' },
  badgeText: { fontSize: 10, fontWeight: '800' },
  actionBtns: { flexDirection: 'row', gap: 8 },
  editBtn: { padding: 6, borderRadius: radius.sm, backgroundColor: colors.surfaceSecondary },
  delBtn: { padding: 6, borderRadius: radius.sm, backgroundColor: colors.error + '10' },
  descText: { marginTop: spacing.sm, fontSize: font.sm, color: colors.muted, fontStyle: 'italic' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalBox: { backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, maxHeight: '80%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border },
  modalTitle: { fontSize: font.lg, fontWeight: '700', color: colors.onSurface },
  errorText: { color: colors.error, fontSize: font.sm, marginBottom: 8 },
  fieldLabel: { fontSize: font.sm, fontWeight: '600', color: colors.onSurface, marginBottom: 4 },
  statusOption: { flex: 1, paddingVertical: 8, alignItems: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: radius.md },
  statusOptionSelected: { borderColor: colors.brandPrimary, backgroundColor: colors.brandPrimary + '10' },
  statusOptionText: { fontSize: font.sm, color: colors.muted },

  // Bulk action styles
  selectHeaderBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  selectHeaderBtnActive: { borderColor: colors.brandPrimary, backgroundColor: colors.brandPrimary + '15' },
  selectHeaderBtnText: { fontSize: font.xs, fontWeight: '700', color: colors.onSurface },
  bulkSubHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingVertical: 10, backgroundColor: '#F8FAFC', borderBottomWidth: 1, borderBottomColor: colors.border },
  selectAllToggle: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  selectAllToggleText: { fontSize: font.sm, fontWeight: '700', color: colors.brandPrimary },
  selectedCountText: { fontSize: font.sm, fontWeight: '800', color: colors.onSurface },
  bulkFloatingBar: { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', gap: 8, padding: spacing.md, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border, shadowColor: '#000', shadowOffset: { width: 0, height: -3 }, shadowOpacity: 0.1, shadowRadius: 5, elevation: 8 },
  bulkDelBtn: { flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: radius.md, backgroundColor: colors.error },
  bulkDelBtnText: { color: '#FFF', fontWeight: '800', fontSize: font.sm },
  bulkCancelBtn: { flex: 1, paddingVertical: 12, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceSecondary },
});
