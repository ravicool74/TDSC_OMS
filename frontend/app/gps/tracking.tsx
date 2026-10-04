import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, TextInput, Alert, ScrollView, Modal } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, font } from '@/src/theme';
import { api, getCurrentLocation } from '@/src/api';
import { Card, EmptyState, ScreenLoader, PrimaryButton, SecondaryButton } from '@/src/ui';
import { ScreenHeader } from '@/src/ScreenHeader';
import { FormInput } from '@/src/forms';

export default function FieldGpsTrackingScreen() {
  const [livePings, setLivePings] = useState<any[] | null>(null);
  const [visits, setVisits] = useState<any[]>([]);
  const [pingBusy, setPingBusy] = useState(false);
  const [showVisitModal, setShowVisitModal] = useState(false);
  const [visitCustId, setVisitCustId] = useState('');
  const [visitPurpose, setVisitPurpose] = useState('');
  const [visitNotes, setVisitNotes] = useState('');
  const [visitBusy, setVisitBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [pings, vData] = await Promise.all([
        api.get<any[]>('/gps/live'),
        api.get<any[]>('/gps/visits').catch(() => []),
      ]);
      setLivePings(pings);
      setVisits(vData);
    } catch {
      setLivePings([]);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const sendManualPing = async () => {
    setPingBusy(true);
    try {
      const loc = await getCurrentLocation();
      await api.post('/gps/ping', {
        latitude: loc.lat,
        longitude: loc.lng,
        accuracy: loc.accuracy,
        activity: 'moving',
      });
      Alert.alert('GPS Updated', `Location ping registered at ${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}`);
      await load();
    } catch (e: any) {
      Alert.alert('Location Error', e?.message || 'Failed to acquire GPS coordinates');
    } finally {
      setPingBusy(false);
    }
  };

  const logVisit = async () => {
    if (!visitCustId.trim() || !visitPurpose.trim()) {
      Alert.alert('Validation', 'Customer ID and Purpose are required');
      return;
    }
    setVisitBusy(true);
    try {
      let coords: any = {};
      try { coords = await getCurrentLocation(); } catch {}
      await api.post('/gps/visits', {
        customer_id: visitCustId.trim(),
        purpose: visitPurpose.trim(),
        notes: visitNotes.trim(),
        latitude: coords.lat,
        longitude: coords.lng,
      });
      setShowVisitModal(false);
      setVisitCustId('');
      setVisitPurpose('');
      setVisitNotes('');
      await load();
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to log visit');
    } finally {
      setVisitBusy(false);
    }
  };

  return (
    <View style={styles.container}>
      <ScreenHeader
        title="Field Staff GPS Tracking"
        right={
          <Pressable onPress={sendManualPing} disabled={pingBusy} style={styles.pingBtn}>
            <Ionicons name="navigate" size={18} color={colors.onBrandPrimary} />
            <Text style={styles.pingBtnText}>{pingBusy ? 'Pinging...' : 'Send GPS'}</Text>
          </Pressable>
        }
      />

      <View style={styles.visitHeaderBar}>
        <Text style={styles.sectionTitle}>Active Field Executives</Text>
        <Pressable onPress={() => setShowVisitModal(true)} style={styles.logVisitBtn}>
          <Ionicons name="add-circle" size={16} color={colors.brandPrimary} />
          <Text style={styles.logVisitBtnText}>Log Client Visit</Text>
        </Pressable>
      </View>

      {livePings === null ? (
        <ScreenLoader />
      ) : livePings.length === 0 ? (
        <EmptyState
          icon="location-outline"
          title="No Field Pings Yet"
          subtitle="Field executives can send live GPS coordinates or log client visits during working hours."
          actionLabel="Send GPS Location"
          onAction={sendManualPing}
        />
      ) : (
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {livePings.map(item => (
            <Card key={item.id}>
              <View style={styles.cardHeader}>
                <View style={styles.gpsIcon}>
                  <Ionicons name="person" size={20} color={colors.brandPrimary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.userName}>{item.user_name}</Text>
                  <Text style={styles.userSub}>{item.user_id}</Text>
                </View>

                <View style={styles.activityBadge}>
                  <View style={styles.greenDot} />
                  <Text style={styles.activityText}>{(item.activity || 'LIVE').toUpperCase()}</Text>
                </View>
              </View>

              <View style={styles.coordBox}>
                <View style={styles.coordRow}>
                  <Ionicons name="compass-outline" size={16} color={colors.muted} />
                  <Text style={styles.coordText}>
                    Lat: {Number(item.latitude).toFixed(5)}, Lng: {Number(item.longitude).toFixed(5)}
                  </Text>
                </View>
                <View style={styles.coordRow}>
                  <Ionicons name="time-outline" size={16} color={colors.muted} />
                  <Text style={styles.timeText}>
                    Last Ping: {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </Text>
                </View>
              </View>
            </Card>
          ))}

          {/* Visits history */}
          {visits.length > 0 ? (
            <View style={{ marginTop: spacing.xl }}>
              <Text style={[styles.sectionTitle, { marginHorizontal: spacing.sm, marginBottom: spacing.md }]}>
                Recent Client Visits
              </Text>
              {visits.slice(0, 10).map(v => (
                <View key={v.id} style={styles.visitRow}>
                  <Ionicons name="briefcase-outline" size={20} color={colors.brandSecondary} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.visitCust}>{v.customer_name} ({v.customer_id})</Text>
                    <Text style={styles.visitPurpose}>{v.purpose}</Text>
                    {v.notes ? <Text style={styles.visitNotes}>"{v.notes}"</Text> : null}
                  </View>
                  <Text style={styles.visitTime}>
                    {new Date(v.visit_time).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        </ScrollView>
      )}

      {/* Log Visit Modal */}
      <Modal visible={showVisitModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Log Field Client Visit</Text>
              <Pressable onPress={() => setShowVisitModal(false)}>
                <Ionicons name="close" size={24} color={colors.muted} />
              </Pressable>
            </View>

            <View style={{ padding: spacing.lg, gap: spacing.md }}>
              <FormInput label="Customer ID or Code *" value={visitCustId} onChangeText={setVisitCustId} placeholder="e.g. TDSC-CUST-ID-00000001" />
              <FormInput label="Visit Purpose *" value={visitPurpose} onChangeText={setVisitPurpose} placeholder="e.g. Document collection, DSC verification" />
              <FormInput label="Visit Notes" value={visitNotes} onChangeText={setVisitNotes} placeholder="Outcome, discussion points, follow-up" />

              <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.md }}>
                <SecondaryButton label="Cancel" onPress={() => setShowVisitModal(false)} style={{ flex: 1 }} testID="btn-cancel-visit" />
                <PrimaryButton label={visitBusy ? 'Logging...' : 'Save Visit'} onPress={logVisit} disabled={visitBusy} loading={visitBusy} style={{ flex: 1 }} testID="btn-save-visit" />
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surfaceSecondary },
  pingBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.full, backgroundColor: colors.brandPrimary },
  pingBtnText: { color: colors.onBrandPrimary, fontSize: font.xs, fontWeight: '700' },
  visitHeaderBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.md, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  sectionTitle: { fontSize: font.sm, fontWeight: '700', color: colors.onSurface, textTransform: 'uppercase', letterSpacing: 0.5 },
  logVisitBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.sm, backgroundColor: colors.brandPrimary + '10' },
  logVisitBtnText: { fontSize: font.xs, fontWeight: '700', color: colors.brandPrimary },
  scrollContent: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxxl },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  gpsIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.brandPrimary + '15', alignItems: 'center', justifyContent: 'center' },
  userName: { fontSize: font.base, fontWeight: '700', color: colors.onSurface },
  userSub: { fontSize: font.xs, color: colors.muted },
  activityBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.full, backgroundColor: colors.success + '15' },
  greenDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.success },
  activityText: { fontSize: 10, fontWeight: '800', color: colors.success },
  coordBox: { marginTop: spacing.md, padding: spacing.sm, backgroundColor: colors.surfaceSecondary, borderRadius: radius.sm, gap: 4 },
  coordRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  coordText: { fontSize: font.xs, fontWeight: '600', color: colors.onSurface },
  timeText: { fontSize: font.xs, color: colors.muted },
  visitRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, padding: spacing.md, backgroundColor: colors.surface, borderRadius: radius.md, marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.border },
  visitCust: { fontSize: font.sm, fontWeight: '700', color: colors.onSurface },
  visitPurpose: { fontSize: font.xs, color: colors.brandPrimary, marginTop: 2 },
  visitNotes: { fontSize: font.xs, color: colors.muted, fontStyle: 'italic', marginTop: 2 },
  visitTime: { fontSize: 10, color: colors.muted },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalBox: { backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border },
  modalTitle: { fontSize: font.lg, fontWeight: '700', color: colors.onSurface },
});
