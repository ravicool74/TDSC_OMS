import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  TextInput,
  FlatList,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, font, shadow } from './theme';
import { api } from './api';

export type PickedEmployee = {
  id: string;
  employee_code?: string | null;
  name: string;
  mobile?: string | null;
  emergency_mobile?: string | null;
  email: string;
  address?: string | null;
  pan?: string | null;
  aadhar?: string | null;
  date_of_joining?: string | null;
  date_of_birth?: string | null;
  designation?: string | null;
  posting_branch?: string | null;
  office_id?: string | null;
  role?: string | null;
  photo_path?: string | null;
  bank_account_no?: string | null;
  bank_ifsc?: string | null;
  bank_name?: string | null;
};

export const EmployeeSearchModal: React.FC<{
  visible: boolean;
  onClose: () => void;
  onPick: (emp: PickedEmployee) => void;
  title?: string;
}> = ({ visible, onClose, onPick, title = 'Select Employee' }) => {
  const [q, setQ] = useState('');
  const [employees, setEmployees] = useState<PickedEmployee[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedFilter, setSelectedFilter] = useState<'all' | 'pan' | 'aadhar'>('all');

  useEffect(() => {
    if (!visible) {
      setQ('');
      setSelectedFilter('all');
      return;
    }
    let cancelled = false;
    setLoading(true);

    const timer = setTimeout(async () => {
      try {
        const queryParam = q.trim() ? `?q=${encodeURIComponent(q.trim())}` : '';
        const res = await api.get<PickedEmployee[]>(`/employees${queryParam}`);
        if (!cancelled) {
          setEmployees(Array.isArray(res) ? res : []);
        }
      } catch {
        if (!cancelled) setEmployees([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 200);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q, visible]);

  // Client-side quick filter
  const filteredList = useMemo(() => {
    if (!employees) return [];
    return employees.filter(emp => {
      if (selectedFilter === 'pan' && (!emp.pan || emp.pan.trim() === '')) return false;
      if (selectedFilter === 'aadhar' && (!emp.aadhar || emp.aadhar.trim() === '')) return false;
      return true;
    });
  }, [employees, selectedFilter]);

  return (
    <Modal transparent animationType="slide" visible={visible} onRequestClose={onClose}>
      <SafeAreaView edges={['top']} style={styles.root}>
        {/* Header */}
        <View style={styles.header}>
          <Pressable onPress={onClose} hitSlop={10} style={styles.closeBtn}>
            <Ionicons name="close" size={24} color={colors.onSurface} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.subtitle}>Staff Directory & Employee Profile Lookup</Text>
          </View>
        </View>

        {/* Search Bar */}
        <View style={styles.searchSection}>
          <View style={styles.searchWrap}>
            <Ionicons name="search" size={18} color={colors.muted} />
            <TextInput
              testID="employee-search-input"
              autoFocus
              placeholder="Search by Name, PAN, Aadhar, Mobile, Employee ID..."
              placeholderTextColor={colors.muted}
              value={q}
              onChangeText={setQ}
              style={styles.searchInput}
              returnKeyType="search"
            />
            {q ? (
              <Pressable onPress={() => setQ('')} hitSlop={8}>
                <Ionicons name="close-circle" size={18} color={colors.muted} />
              </Pressable>
            ) : null}
          </View>

          {/* Quick Filter Chips */}
          <View style={styles.chipRow}>
            <Pressable
              onPress={() => setSelectedFilter('all')}
              style={[styles.chip, selectedFilter === 'all' && styles.chipActive]}
            >
              <Text style={[styles.chipText, selectedFilter === 'all' && styles.chipTextActive]}>
                All Staff ({employees.length})
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setSelectedFilter('pan')}
              style={[styles.chip, selectedFilter === 'pan' && styles.chipActive]}
            >
              <Ionicons
                name="card-outline"
                size={12}
                color={selectedFilter === 'pan' ? '#FFF' : colors.brandPrimary}
              />
              <Text style={[styles.chipText, selectedFilter === 'pan' && styles.chipTextActive]}>
                With PAN
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setSelectedFilter('aadhar')}
              style={[styles.chip, selectedFilter === 'aadhar' && styles.chipActive]}
            >
              <Ionicons
                name="finger-print-outline"
                size={12}
                color={selectedFilter === 'aadhar' ? '#FFF' : colors.brandPrimary}
              />
              <Text style={[styles.chipText, selectedFilter === 'aadhar' && styles.chipTextActive]}>
                With Aadhar
              </Text>
            </Pressable>
          </View>
        </View>

        {/* Body / List */}
        {loading ? (
          <View style={styles.centerBox}>
            <ActivityIndicator size="large" color={colors.brandPrimary} />
            <Text style={styles.loadingTxt}>Searching staff directory...</Text>
          </View>
        ) : filteredList.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="person-remove-outline" size={48} color={colors.muted} />
            <Text style={styles.emptyTitle}>
              {q ? `No employee found matching "${q}"` : 'No employees in staff directory'}
            </Text>
            <Text style={styles.emptySub}>
              Try searching by PAN card number, Aadhar number, 10-digit mobile number, or full name.
            </Text>
          </View>
        ) : (
          <FlatList
            data={filteredList}
            keyExtractor={item => item.id}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => (
              <Pressable
                testID={`employee-item-${item.id}`}
                onPress={() => {
                  onPick(item);
                  onClose();
                }}
                style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}
              >
                <View style={styles.cardHeader}>
                  <View style={styles.avatar}>
                    <Text style={styles.avatarTxt}>
                      {item.name ? item.name.charAt(0).toUpperCase() : 'E'}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <Text style={styles.name}>{item.name}</Text>
                      {item.employee_code ? (
                        <View style={styles.codeBadge}>
                          <Text style={styles.codeBadgeText}>{item.employee_code}</Text>
                        </View>
                      ) : null}
                    </View>
                    <Text style={styles.metaDesignation}>
                      {item.designation || 'Staff'} {item.posting_branch ? `• ${item.posting_branch}` : ''}
                    </Text>
                  </View>
                  <View style={styles.selectBtn}>
                    <Text style={styles.selectBtnTxt}>Select</Text>
                    <Ionicons name="arrow-forward" size={14} color="#FFF" />
                  </View>
                </View>

                {/* Details Pills */}
                <View style={styles.pillsRow}>
                  {item.mobile ? (
                    <View style={styles.pill}>
                      <Ionicons name="call" size={11} color="#0284C7" />
                      <Text style={[styles.pillText, { color: '#0369A1' }]}>{item.mobile}</Text>
                    </View>
                  ) : null}
                  {item.email ? (
                    <View style={styles.pill}>
                      <Ionicons name="mail" size={11} color="#475569" />
                      <Text style={styles.pillText}>{item.email}</Text>
                    </View>
                  ) : null}
                  {item.pan ? (
                    <View style={[styles.pill, { backgroundColor: '#EEF2FF', borderColor: '#C7D2FE' }]}>
                      <Ionicons name="card" size={11} color="#4F46E5" />
                      <Text style={[styles.pillText, { color: '#4338CA', fontWeight: '800' }]}>
                        PAN: {item.pan}
                      </Text>
                    </View>
                  ) : null}
                  {item.aadhar ? (
                    <View style={[styles.pill, { backgroundColor: '#FDF2F8', borderColor: '#FBCFE8' }]}>
                      <Ionicons name="finger-print" size={11} color="#DB2777" />
                      <Text style={[styles.pillText, { color: '#BE185D', fontWeight: '800' }]}>
                        Aadhar: {item.aadhar}
                      </Text>
                    </View>
                  ) : null}
                  {item.date_of_joining ? (
                    <View style={[styles.pill, { backgroundColor: '#F0FDF4', borderColor: '#BBF7D0' }]}>
                      <Ionicons name="calendar" size={11} color="#16A34A" />
                      <Text style={[styles.pillText, { color: '#15803D' }]}>
                        Joined: {item.date_of_joining}
                      </Text>
                    </View>
                  ) : null}
                </View>

                {item.address ? (
                  <View style={styles.addressRow}>
                    <Ionicons name="location-outline" size={12} color={colors.muted} />
                    <Text style={styles.addressText} numberOfLines={1}>
                      {item.address}
                    </Text>
                  </View>
                ) : null}
              </Pressable>
            )}
          />
        )}
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F8FAFC' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: '#FFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: font.lg, fontWeight: '800', color: colors.onSurface },
  subtitle: { fontSize: 11, color: colors.muted, marginTop: 1 },
  searchSection: {
    backgroundColor: '#FFF',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    gap: 8,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 10 : 8,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  searchInput: { flex: 1, fontSize: font.base, color: colors.onSurface, padding: 0 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { fontSize: 11, fontWeight: '700', color: '#475569' },
  chipTextActive: { color: '#FFF' },
  centerBox: { padding: spacing.xxl, alignItems: 'center', gap: 10 },
  loadingTxt: { fontSize: font.sm, color: colors.muted, fontWeight: '600' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl, gap: 8 },
  emptyTitle: { fontSize: font.base, fontWeight: '700', color: colors.onSurface, textAlign: 'center' },
  emptySub: { fontSize: font.sm, color: colors.muted, textAlign: 'center', maxWidth: 320 },
  listContent: { padding: spacing.md, gap: 10, paddingBottom: 60 },
  card: {
    backgroundColor: '#FFF',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: spacing.md,
    gap: 8,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#EFF6FF',
    borderWidth: 1.5,
    borderColor: '#BFDBFE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarTxt: { fontSize: 16, fontWeight: '800', color: colors.brandPrimary },
  name: { fontSize: font.base, fontWeight: '800', color: colors.onSurface },
  codeBadge: {
    backgroundColor: '#EEF2FF',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#C7D2FE',
  },
  codeBadgeText: { fontSize: 10, fontWeight: '800', color: '#4338CA' },
  metaDesignation: { fontSize: 12, color: '#64748B', marginTop: 2, fontWeight: '600' },
  selectBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.brandPrimary,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.pill,
  },
  selectBtnTxt: { color: '#FFF', fontSize: 11, fontWeight: '800' },
  pillsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
  },
  pillText: { fontSize: 10, color: '#475569', fontWeight: '600' },
  addressRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  addressText: { fontSize: 11, color: colors.muted, flex: 1 },
});
