import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, TextInput, Alert, Modal, ScrollView, ActivityIndicator } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, font, shadow } from '@/src/theme';
import { api } from '@/src/api';
import { ScreenHeader } from '@/src/ScreenHeader';
import { PrimaryButton, SecondaryButton } from '@/src/ui';
import { CustomerSearchModal, PickedParty } from '@/src/CustomerSearchModal';
import { confirm, notify } from '@/src/dialog';

const today = () => new Date().toISOString().slice(0, 10);

export default function DeliveryChallansList() {
  const router = useRouter();
  const [challans, setChallans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // Challan Modal (Create & Edit)
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingNo, setEditingNo] = useState<string | null>(null);
  const [isManual, setIsManual] = useState(false);
  const [party, setParty] = useState<PickedParty | null>(null);
  const [showPartyPick, setShowPartyPick] = useState(false);
  const [date, setDate] = useState(today());
  const [vehicleNo, setVehicleNo] = useState('');
  const [dispatchThrough, setDispatchThrough] = useState('');
  const [itemName, setItemName] = useState('');
  const [itemQty, setItemQty] = useState('1');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      let url = '/accounting/delivery-challans';
      if (search.trim()) url += `?q=${encodeURIComponent(search.trim())}`;
      const res = await api.get<any[]>(url);
      setChallans(res || []);
    } catch {
      setChallans([]);
    } finally {
      setLoading(false);
    }
  }, [search]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openNew = async () => {
    setEditingId(null);
    setEditingNo(null);
    setParty(null);
    setDate(today());
    setVehicleNo('');
    setDispatchThrough('');
    setItemName('');
    setItemQty('1');
    setNotes('');
    setShowModal(true);
    try {
      const nextRes = await api.get<any>('/accounting/challans/next-no');
      if (nextRes) {
        if (nextRes.date_start_from) setDate(nextRes.date_start_from);
        if (nextRes.voucher_mode) setIsManual(nextRes.voucher_mode === 'manual');
        if (nextRes.next_no) setEditingNo(nextRes.next_no);
      }
    } catch {}
  };

  const openEdit = (item: any) => {
    setEditingId(item.id);
    setEditingNo(item.challan_no || '');
    setParty({
      id: item.customer_id,
      name: item.customer_name,
      mobile: item.customer_mobile || '',
      pan: '',
      aadhar: '',
      gst_no: null,
      customer_code: null,
    } as any);
    setDate(item.date || today());
    setVehicleNo(item.vehicle_no || '');
    setDispatchThrough(item.dispatch_through || '');
    const firstItem = (item.items && item.items[0]) || {};
    setItemName(firstItem.name || '');
    setItemQty(String(firstItem.qty || 1));
    setNotes(item.notes || '');
    setShowModal(true);
  };

  const deleteChallan = async (item: any) => {
    const ok = await confirm(
      'Delete Delivery Challan?',
      `Are you sure you want to delete challan "${item.challan_no}"? This cannot be undone.`,
      { confirmText: 'Delete', destructive: true }
    );
    if (!ok) return;

    try {
      await api.del(`/accounting/delivery-challans/${item.id}`);
      notify('Deleted', `Delivery Challan ${item.challan_no} deleted successfully.`);
      await load();
    } catch (e: any) {
      Alert.alert('Delete Failed', e?.message || 'Unable to delete delivery challan');
    }
  };

  const saveChallan = async () => {
    if (!party) {
      Alert.alert('Required', 'Please select a customer.');
      return;
    }
    if (!itemName.trim()) {
      Alert.alert('Required', 'Please enter item/material description.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        challan_no: isManual && editingNo && !editingNo.includes('preview') ? editingNo.trim() : undefined,
        date,
        customer_id: party.id,
        vehicle_no: vehicleNo.trim() || undefined,
        dispatch_through: dispatchThrough.trim() || undefined,
        items: [{
          name: itemName.trim(),
          qty: Number(itemQty || 1),
          rate: 0,
          discount: 0,
          tax_rate: 0,
        }],
        notes: notes.trim() || undefined,
      };

      if (editingId) {
        await api.patch(`/accounting/delivery-challans/${editingId}`, payload);
        notify('Updated', `Delivery Challan ${editingNo || ''} updated successfully.`);
      } else {
        await api.post('/accounting/delivery-challans', payload);
        notify('Success', 'Delivery Challan created.');
      }

      setShowModal(false);
      setEditingId(null);
      setEditingNo(null);
      setParty(null);
      setItemName('');
      setItemQty('1');
      setVehicleNo('');
      setDispatchThrough('');
      setNotes('');
      await load();
    } catch (e: any) {
      Alert.alert('Failed', e?.message || 'Unable to save delivery challan');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.root} testID="delivery-challans-screen">
      <ScreenHeader
        title="Delivery Challans"
        right={(
          <Pressable
            style={styles.addBtn}
            onPress={openNew}
            testID="new-challan-btn"
          >
            <Ionicons name="add" size={18} color="#FFF" />
            <Text style={styles.addBtnText}>New Challan</Text>
          </Pressable>
        )}
      />

      <View style={styles.filterBar}>
        <View style={styles.searchRow}>
          <View style={styles.searchBox}>
            <Ionicons name="search" size={16} color={colors.muted} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search challan no, party, vehicle..."
              value={search}
              onChangeText={setSearch}
              onSubmitEditing={load}
              testID="search-challan-input"
            />
            {search ? (
              <Pressable onPress={() => { setSearch(''); load(); }}>
                <Ionicons name="close-circle" size={16} color={colors.muted} />
              </Pressable>
            ) : null}
          </View>
          <Pressable style={styles.searchActionBtn} onPress={load} testID="search-challan-btn">
            <Ionicons name="search" size={15} color="#FFF" />
            <Text style={styles.searchActionBtnTxt}>Search</Text>
          </Pressable>
        </View>
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={colors.brandPrimary} />
          <Text style={{ color: colors.muted, marginTop: 8 }}>Loading delivery challans...</Text>
        </View>
      ) : challans.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Ionicons name="car-outline" size={48} color={colors.muted} />
          <Text style={styles.emptyTitle}>No Delivery Challans</Text>
          <Text style={styles.emptySub}>Issue official dispatch documents and track physical delivery of tokens & documents.</Text>
          <Pressable
            style={[styles.addBtn, { marginTop: 16 }]}
            onPress={openNew}
          >
            <Ionicons name="add" size={18} color="#FFF" />
            <Text style={styles.addBtnText}>Create Delivery Challan</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={challans}
          keyExtractor={item => item.id}
          contentContainerStyle={{ padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxxl }}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.chNo}>{item.challan_no}</Text>
                  <Text style={styles.custName}>{item.customer_name}</Text>
                </View>
                <View style={styles.dateBadge}>
                  <Text style={styles.dateBadgeText}>{item.date}</Text>
                </View>
              </View>

              <View style={styles.cardBody}>
                {item.vehicle_no ? (
                  <View style={styles.infoRow}>
                    <Text style={styles.infoLbl}>Vehicle No.</Text>
                    <Text style={styles.infoVal}>{item.vehicle_no}</Text>
                  </View>
                ) : null}
                {item.dispatch_through ? (
                  <View style={styles.infoRow}>
                    <Text style={styles.infoLbl}>Dispatch Mode</Text>
                    <Text style={styles.infoVal}>{item.dispatch_through}</Text>
                  </View>
                ) : null}
                <View style={{ marginTop: 6 }}>
                  <Text style={styles.infoLbl}>Dispatched Items:</Text>
                  {(item.items || []).map((it: any, idx: number) => (
                    <Text key={idx} style={styles.itemLine}>• {it.name} (Qty: {it.qty})</Text>
                  ))}
                </View>
                {item.notes ? (
                  <Text style={styles.notesText}>Note: {item.notes}</Text>
                ) : null}
              </View>

              {/* Actions Footer */}
              <View style={styles.cardFooter}>
                <View style={styles.actionBtnsRow}>
                  <Pressable
                    style={styles.editBtn}
                    onPress={() => openEdit(item)}
                    testID={`edit-challan-${item.id}`}
                  >
                    <Ionicons name="create-outline" size={15} color="#4338CA" />
                    <Text style={styles.editBtnText}>Edit</Text>
                  </Pressable>

                  <Pressable
                    style={styles.deleteBtn}
                    onPress={() => deleteChallan(item)}
                    testID={`del-challan-${item.id}`}
                  >
                    <Ionicons name="trash-outline" size={15} color="#DC2626" />
                    <Text style={styles.deleteBtnText}>Delete</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          )}
        />
      )}

      {/* New / Edit Challan Modal */}
      <Modal visible={showModal} animationType="slide" transparent onRequestClose={() => setShowModal(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {editingId ? `Edit Delivery Challan (${editingNo || ''})` : 'New Delivery Challan'}
              </Text>
              <Pressable onPress={() => setShowModal(false)} hitSlop={10}>
                <Ionicons name="close" size={22} color={colors.onSurface} />
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
              <View>
                <Text style={styles.inputLbl}>{isManual ? "Challan No. (Manual Entry)" : "Challan No. (Auto)"}</Text>
                <TextInput
                  style={[styles.input, !isManual && { backgroundColor: '#F1F5F9', color: '#64748B' }]}
                  value={editingNo || ''}
                  onChangeText={isManual ? setEditingNo : undefined}
                  editable={isManual}
                  placeholder="e.g. TDSC-DC/2026-27/0001"
                />
              </View>

              <View>
                <Text style={styles.inputLbl}>Date</Text>
                <TextInput style={styles.input} value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" />
              </View>

              <View>
                <Text style={styles.inputLbl}>Customer / Consignee *</Text>
                {party ? (
                  <View style={styles.partyPicked}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.partyName}>{party.name}</Text>
                      <Text style={styles.partySub}>{party.mobile || 'Selected Client'}</Text>
                    </View>
                    <Pressable onPress={() => setShowPartyPick(true)} style={styles.changeBtn}>
                      <Text style={styles.changeTxt}>Change</Text>
                    </Pressable>
                  </View>
                ) : (
                  <Pressable onPress={() => setShowPartyPick(true)} style={styles.pickBtn}>
                    <Ionicons name="person-add" size={16} color={colors.brandPrimary} />
                    <Text style={styles.pickTxt}>Select Customer</Text>
                  </Pressable>
                )}
              </View>

              <View>
                <Text style={styles.inputLbl}>Vehicle No. / Transport Details</Text>
                <TextInput style={styles.input} value={vehicleNo} onChangeText={setVehicleNo} placeholder="e.g. BR-01-XX-1234 or By Hand" />
              </View>

              <View>
                <Text style={styles.inputLbl}>Dispatch Through</Text>
                <TextInput style={styles.input} value={dispatchThrough} onChangeText={setDispatchThrough} placeholder="e.g. Courier / Speed Post / Hand Delivery" />
              </View>

              <View>
                <Text style={styles.inputLbl}>Item / Material Description *</Text>
                <TextInput style={styles.input} value={itemName} onChangeText={setItemName} placeholder="e.g. Class-3 Combo USB Token DSC" />
              </View>

              <View>
                <Text style={styles.inputLbl}>Quantity</Text>
                <TextInput style={styles.input} value={itemQty} onChangeText={setItemQty} keyboardType="numeric" placeholder="1" />
              </View>

              <View>
                <Text style={styles.inputLbl}>Remarks / Notes</Text>
                <TextInput style={[styles.input, { minHeight: 60 }]} multiline value={notes} onChangeText={setNotes} placeholder="Delivery instructions..." />
              </View>

              <View style={{ flexDirection: 'row', gap: 10, marginTop: spacing.sm }}>
                <SecondaryButton label="Cancel" onPress={() => setShowModal(false)} style={{ flex: 1 }} />
                <PrimaryButton
                  label={editingId ? (saving ? 'Updating...' : 'Update Challan') : (saving ? 'Saving...' : 'Save Challan')}
                  onPress={saveChallan}
                  loading={saving}
                  style={{ flex: 1 }}
                />
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <CustomerSearchModal
        visible={showPartyPick}
        onClose={() => setShowPartyPick(false)}
        onPick={p => { setParty(p); setShowPartyPick(false); }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F8FAFC' },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#DB2777', paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill },
  addBtnText: { color: '#FFF', fontWeight: '800', fontSize: 12 },
  filterBar: { padding: spacing.md, backgroundColor: '#FFF', borderBottomWidth: 1, borderBottomColor: colors.border },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchBox: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#F1F5F9', borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 6 },
  searchInput: { flex: 1, fontSize: font.sm, color: '#0F172A' },
  searchActionBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#DB2777', paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.md },
  searchActionBtnTxt: { color: '#FFF', fontWeight: '800', fontSize: 12 },
  card: { backgroundColor: '#FFF', borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, ...shadow.card },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  chNo: { fontSize: 11, fontWeight: '800', color: '#DB2777' },
  custName: { fontSize: font.base, fontWeight: '800', color: '#0F172A', marginTop: 2 },
  dateBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4, backgroundColor: '#FCE7F3' },
  dateBadgeText: { fontSize: 9, fontWeight: '900', color: '#DB2777' },
  cardBody: { marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: '#F1F5F9', gap: 4 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between' },
  infoLbl: { fontSize: 11, color: colors.muted, fontWeight: '600' },
  infoVal: { fontSize: 11, color: '#0F172A', fontWeight: '700' },
  itemLine: { fontSize: 11, color: '#334155', fontWeight: '600', marginTop: 2 },
  notesText: { fontSize: 11, fontStyle: 'italic', color: colors.muted, marginTop: 4 },
  cardFooter: { marginTop: spacing.md, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: '#F1F5F9' },
  actionBtnsRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  editBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: '#EEF2FF', paddingVertical: 7, borderRadius: radius.md, borderWidth: 1, borderColor: '#C7D2FE' },
  editBtnText: { color: '#4338CA', fontWeight: '800', fontSize: 12 },
  deleteBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: '#FEF2F2', paddingVertical: 7, borderRadius: radius.md, borderWidth: 1, borderColor: '#FECACA' },
  deleteBtnText: { color: '#DC2626', fontWeight: '800', fontSize: 12 },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  emptyTitle: { fontSize: font.lg, fontWeight: '800', color: '#0F172A', marginTop: 12 },
  emptySub: { fontSize: font.sm, color: colors.muted, textAlign: 'center', marginTop: 4, maxWidth: 280 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.6)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: '#FFF', borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, maxHeight: '85%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  modalTitle: { fontSize: font.base, fontWeight: '800', color: '#0F172A' },
  inputLbl: { fontSize: 11, fontWeight: '700', color: '#475569', marginBottom: 4 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 8, fontSize: font.sm, backgroundColor: '#FFF' },
  pickBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.brandPrimary, borderStyle: 'dashed', backgroundColor: '#EFF6FF', justifyContent: 'center' },
  pickTxt: { color: colors.brandPrimary, fontWeight: '700', fontSize: font.sm },
  partyPicked: { flexDirection: 'row', alignItems: 'center', padding: 10, borderRadius: radius.md, backgroundColor: '#F1F5F9' },
  partyName: { fontSize: font.sm, fontWeight: '800', color: '#0F172A' },
  partySub: { fontSize: 11, color: colors.muted, marginTop: 1 },
  changeBtn: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: '#E2E8F0' },
  changeTxt: { fontSize: 11, fontWeight: '700', color: '#334155' },
});
