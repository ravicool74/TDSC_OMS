import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, TextInput, Modal, ScrollView } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, font } from '@/src/theme';
import { api } from '@/src/api';
import { Card, EmptyState, ScreenLoader } from '@/src/ui';
import { ScreenHeader } from '@/src/ScreenHeader';

export default function AuditLogsScreen() {
  const [logs, setLogs] = useState<any[] | null>(null);
  const [moduleFilter, setModuleFilter] = useState('');
  const [selectedLog, setSelectedLog] = useState<any | null>(null);

  const load = useCallback(async () => {
    try {
      let url = '/audit-logs?limit=100';
      if (moduleFilter.trim()) url += `&module=${encodeURIComponent(moduleFilter.trim())}`;
      const data = await api.get<any[]>(url);
      setLogs(data);
    } catch {
      setLogs([]);
    }
  }, [moduleFilter]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={styles.container}>
      <ScreenHeader title="Security Audit Trail" />

      <View style={styles.searchBarBox}>
        <View style={styles.searchBar}>
          <Ionicons name="filter-outline" size={18} color={colors.muted} />
          <TextInput
            placeholder="Filter by module (e.g. customer_vault, branches, tasks)..."
            value={moduleFilter}
            onChangeText={t => setModuleFilter(t)}
            onSubmitEditing={load}
            style={styles.searchInput}
          />
          {moduleFilter ? (
            <Pressable onPress={() => { setModuleFilter(''); load(); }}>
              <Ionicons name="close-circle" size={18} color={colors.muted} />
            </Pressable>
          ) : null}
        </View>
      </View>

      {logs === null ? (
        <ScreenLoader />
      ) : logs.length === 0 ? (
        <EmptyState
          icon="shield-checkmark-outline"
          title="No Audit Records"
          subtitle="System changes and credential accesses are recorded here automatically."
        />
      ) : (
        <FlatList
          data={logs}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <Card>
              <Pressable onPress={() => setSelectedLog(item)} style={styles.logCard}>
                <View style={styles.logIcon}>
                  <Ionicons
                    name={item.module === 'customer_vault' ? 'key' : item.module === 'users' ? 'person' : 'document-text'}
                    size={20}
                    color={item.module === 'customer_vault' ? colors.warning : colors.brandPrimary}
                  />
                </View>

                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Text style={styles.logAction}>{item.action.toUpperCase()}</Text>
                    <Text style={styles.logTime}>
                      {new Date(item.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                    </Text>
                  </View>

                  <Text style={styles.logModule}>
                    Module: <Text style={{ fontWeight: '700', color: colors.onSurface }}>{item.module}</Text>
                    {item.record_id ? ` • ID: ${item.record_id}` : ''}
                  </Text>
                  <Text style={styles.logUser}>
                    By: {item.user_name || 'System'} ({item.user_role || 'staff'})
                  </Text>
                </View>

                <Ionicons name="chevron-forward" size={16} color={colors.muted} />
              </Pressable>
            </Card>
          )}
        />
      )}

      {/* Detail Inspector Modal */}
      <Modal visible={!!selectedLog} animationType="fade" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>Audit Event Detail</Text>
                <Text style={styles.subText}>{selectedLog?.id}</Text>
              </View>
              <Pressable onPress={() => setSelectedLog(null)}>
                <Ionicons name="close" size={24} color={colors.muted} />
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>Operator:</Text>
                <Text style={styles.metaVal}>{selectedLog?.user_name} ({selectedLog?.user_email})</Text>
              </View>
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>Module & Action:</Text>
                <Text style={styles.metaVal}>{selectedLog?.module} → {selectedLog?.action}</Text>
              </View>
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>Timestamp:</Text>
                <Text style={styles.metaVal}>{new Date(selectedLog?.created_at || '').toLocaleString()}</Text>
              </View>

              {selectedLog?.old_value != null ? (
                <View>
                  <Text style={styles.valHeading}>Previous State (Old Value):</Text>
                  <View style={styles.jsonBox}>
                    <Text style={styles.jsonText}>{JSON.stringify(selectedLog.old_value, null, 2)}</Text>
                  </View>
                </View>
              ) : null}

              {selectedLog?.new_value != null ? (
                <View>
                  <Text style={styles.valHeading}>Updated State (New Value):</Text>
                  <View style={styles.jsonBox}>
                    <Text style={styles.jsonText}>{JSON.stringify(selectedLog.new_value, null, 2)}</Text>
                  </View>
                </View>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surfaceSecondary },
  searchBarBox: { padding: spacing.md, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  searchInput: { flex: 1, fontSize: font.base, color: colors.onSurface },
  listContent: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxxl },
  logCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  logIcon: { width: 38, height: 38, borderRadius: 8, backgroundColor: colors.brandPrimary + '15', alignItems: 'center', justifyContent: 'center' },
  logAction: { fontSize: font.sm, fontWeight: '800', color: colors.brandPrimary },
  logTime: { fontSize: 10, color: colors.muted },
  logModule: { fontSize: font.xs, color: colors.muted, marginTop: 2 },
  logUser: { fontSize: font.xs, color: colors.muted, marginTop: 2 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: spacing.lg },
  modalBox: { backgroundColor: colors.surface, borderRadius: radius.xl, maxHeight: '85%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border },
  modalTitle: { fontSize: font.lg, fontWeight: '700', color: colors.onSurface },
  subText: { fontSize: 10, color: colors.muted },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between' },
  metaLabel: { fontSize: font.xs, color: colors.muted, fontWeight: '600' },
  metaVal: { fontSize: font.xs, color: colors.onSurface, fontWeight: '700' },
  valHeading: { fontSize: font.xs, fontWeight: '700', color: colors.onSurface, marginTop: spacing.sm, marginBottom: 4 },
  jsonBox: { padding: spacing.sm, backgroundColor: colors.surfaceSecondary, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border },
  jsonText: { fontSize: 10, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', color: colors.onSurface },
});
