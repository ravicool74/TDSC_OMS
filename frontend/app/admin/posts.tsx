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
          <Pressable onPress={openNew} style={styles.addButton}>
            <Ionicons name="add" size={24} color={colors.onBrandPrimary} />
          </Pressable>
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
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <Card>
              <View style={styles.cardHeader}>
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
                <SecondaryButton title="Cancel" onPress={() => setShowForm(false)} style={{ flex: 1 }} />
                <PrimaryButton title={busy ? 'Saving...' : 'Save Post'} onPress={save} disabled={busy} style={{ flex: 1 }} />
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
});
