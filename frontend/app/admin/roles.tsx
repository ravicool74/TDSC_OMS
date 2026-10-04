import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, Modal, KeyboardAvoidingView, Platform, ScrollView, Alert, TextInput } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, font } from '@/src/theme';
import { api } from '@/src/api';
import { Card, EmptyState, ScreenLoader, PrimaryButton, SecondaryButton } from '@/src/ui';
import { ScreenHeader } from '@/src/ScreenHeader';
import { FormInput } from '@/src/forms';

export default function RolesScreen() {
  const [roles, setRoles] = useState<any[] | null>(null);
  const [meta, setMeta] = useState<{ modules: string[]; actions: string[] } | null>(null);
  const [selectedRole, setSelectedRole] = useState<any | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newRoleName, setNewRoleName] = useState('');
  const [newRoleDesc, setNewRoleDesc] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [rData, mData] = await Promise.all([
        api.get<any[]>('/roles'),
        api.get<any>('/roles/meta'),
      ]);
      setRoles(rData);
      setMeta(mData);
    } catch {
      setRoles([]);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const saveCustomRole = async () => {
    if (!newRoleName.trim()) {
      Alert.alert('Validation', 'Role Name is required');
      return;
    }
    setBusy(true);
    try {
      await api.post('/roles', {
        name: newRoleName.trim(),
        description: newRoleDesc.trim(),
        permissions: {},
      });
      setShowCreateModal(false);
      setNewRoleName('');
      setNewRoleDesc('');
      await load();
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to create role');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.container}>
      <ScreenHeader
        title="Roles & Permissions (RBAC)"
        right={
          <Pressable onPress={() => setShowCreateModal(true)} style={styles.addButton}>
            <Ionicons name="add" size={24} color={colors.onBrandPrimary} />
          </Pressable>
        }
      />

      {roles === null ? (
        <ScreenLoader />
      ) : (
        <FlatList
          data={roles}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <Card>
              <View style={styles.cardHeader}>
                <View style={styles.roleIcon}>
                  <Ionicons name="shield-checkmark" size={22} color={colors.brandPrimary} />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={styles.roleName}>{item.name}</Text>
                    {item.is_system ? (
                      <View style={styles.systemBadge}>
                        <Text style={styles.systemBadgeText}>SYSTEM</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={styles.roleDesc}>{item.description || 'Custom organizational role'}</Text>
                </View>

                <Pressable onPress={() => setSelectedRole(item)} style={styles.viewPermsBtn}>
                  <Ionicons name="eye-outline" size={16} color={colors.brandPrimary} />
                  <Text style={styles.viewPermsText}>Matrix</Text>
                </Pressable>
              </View>
            </Card>
          )}
        />
      )}

      {/* Permissions Matrix Inspector Modal */}
      <Modal visible={!!selectedRole} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBox, { maxHeight: '90%' }]}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>{selectedRole?.name} Permissions</Text>
                <Text style={styles.subText}>{selectedRole?.role_id}</Text>
              </View>
              <Pressable onPress={() => setSelectedRole(null)}>
                <Ionicons name="close" size={24} color={colors.muted} />
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={{ padding: spacing.md, gap: spacing.sm }}>
              {(meta?.modules || []).map(mod => {
                const perms = (selectedRole?.permissions || {})[mod] || [];
                const hasAll = perms.length === (meta?.actions || []).length;
                return (
                  <View key={mod} style={styles.modRow}>
                    <View style={styles.modHeader}>
                      <Text style={styles.modTitle}>{mod.toUpperCase().replace('_', ' ')}</Text>
                      <Text style={[styles.permCount, hasAll ? { color: colors.success } : { color: colors.muted }]}>
                        {hasAll ? 'Full Access' : `${perms.length} Actions`}
                      </Text>
                    </View>
                    <View style={styles.actionTags}>
                      {(meta?.actions || []).map(act => {
                        const active = perms.includes(act);
                        return (
                          <View key={act} style={[styles.actionTag, active && styles.actionTagActive]}>
                            <Text style={[styles.actionTagText, active && styles.actionTagTextActive]}>
                              {act}
                            </Text>
                          </View>
                        );
                      })}
                    </View>
                  </View>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Create Custom Role Modal */}
      <Modal visible={showCreateModal} animationType="slide" transparent>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>New Custom Role</Text>
              <Pressable onPress={() => setShowCreateModal(false)}>
                <Ionicons name="close" size={24} color={colors.muted} />
              </Pressable>
            </View>

            <View style={{ padding: spacing.lg, gap: spacing.md }}>
              <FormInput label="Role Name *" value={newRoleName} onChangeText={setNewRoleName} placeholder="e.g. Audit Inspector, Field Supervisor" />
              <FormInput label="Description" value={newRoleDesc} onChangeText={setNewRoleDesc} placeholder="Role scope and authority description" />

              <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.md }}>
                <SecondaryButton label="Cancel" onPress={() => setShowCreateModal(false)} style={{ flex: 1 }} testID="btn-cancel-role" />
                <PrimaryButton label={busy ? 'Creating...' : 'Create Role'} onPress={saveCustomRole} disabled={busy} loading={busy} style={{ flex: 1 }} testID="btn-save-role" />
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surfaceSecondary },
  addButton: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.brandPrimary, alignItems: 'center', justifyContent: 'center' },
  listContent: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxxl },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  roleIcon: { width: 44, height: 44, borderRadius: 10, backgroundColor: colors.brandPrimary + '15', alignItems: 'center', justifyContent: 'center' },
  roleName: { fontSize: font.lg, fontWeight: '700', color: colors.onSurface },
  roleDesc: { fontSize: font.xs, color: colors.muted, marginTop: 2 },
  systemBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: colors.brandSecondary + '20' },
  systemBadgeText: { fontSize: 9, fontWeight: '800', color: colors.brandSecondary },
  viewPermsBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.sm, backgroundColor: colors.brandPrimary + '10' },
  viewPermsText: { fontSize: font.xs, fontWeight: '700', color: colors.brandPrimary },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalBox: { backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border },
  modalTitle: { fontSize: font.lg, fontWeight: '700', color: colors.onSurface },
  subText: { fontSize: font.xs, color: colors.muted, marginTop: 2 },
  modRow: { padding: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, gap: 6 },
  modHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  modTitle: { fontSize: font.sm, fontWeight: '700', color: colors.onSurface },
  permCount: { fontSize: font.xs, fontWeight: '700' },
  actionTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  actionTag: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  actionTagActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  actionTagText: { fontSize: 10, color: colors.muted, textTransform: 'uppercase' },
  actionTagTextActive: { color: colors.onBrandPrimary, fontWeight: '700' },
});
