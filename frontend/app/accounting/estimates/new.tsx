import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, Alert, ActivityIndicator } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, font, shadow } from '@/src/theme';
import { api } from '@/src/api';
import { ScreenHeader } from '@/src/ScreenHeader';
import { PrimaryButton } from '@/src/ui';
import { CustomerSearchModal, PickedParty } from '@/src/CustomerSearchModal';
import { ItemSearchModal, PickedItem } from '@/src/ItemSearchModal';

const today = () => new Date().toISOString().slice(0, 10);
const inr = (n: any) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

interface ItemRow {
  key: string;
  item_id?: string;
  name: string;
  qty: string;
  rate: string;
  discount: string;
  tax_rate: string;
}

export default function NewEstimate() {
  const router = useRouter();
  const params = useLocalSearchParams<{ edit_id?: string }>();
  const editId = params?.edit_id || null;

  const [date, setDate] = useState(today());
  const [party, setParty] = useState<PickedParty | null>(null);
  const [showPartyPick, setShowPartyPick] = useState(false);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [showItemPick, setShowItemPick] = useState(false);
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState('draft');
  const [saving, setSaving] = useState(false);
  const [loadingExisting, setLoadingExisting] = useState(false);
  const [estimateNo, setEstimateNo] = useState('');
  const [isManual, setIsManual] = useState(false);

  useEffect(() => {
    if (!editId) {
      (async () => {
        try {
          const nextRes = await api.get<any>('/accounting/estimates/next-no');
          if (nextRes) {
            if (nextRes.date_start_from) setDate(nextRes.date_start_from);
            if (nextRes.voucher_mode) setIsManual(nextRes.voucher_mode === 'manual');
            if (nextRes.next_no) setEstimateNo(nextRes.voucher_mode === 'manual' ? nextRes.next_no : `${nextRes.next_no} (preview)`);
          }
        } catch {}
      })();
      return;
    }
    (async () => {
      setLoadingExisting(true);
      try {
        const ex = await api.get<any>(`/accounting/estimates/${editId}`);
        if (ex) {
          setEstimateNo(ex.estimate_no || '');
          setDate(ex.date || today());
          setParty({
            id: ex.customer_id,
            name: ex.customer_name,
            mobile: ex.customer_mobile || '',
            pan: '',
            aadhar: '',
            gst_no: null,
            customer_code: ex.customer_code || null,
          } as any);
          setItems((ex.items || []).map((it: any, idx: number) => ({
            key: `${it.item_id || idx}_${idx}`,
            item_id: it.item_id,
            name: it.name || '',
            qty: String(it.qty ?? 1),
            rate: String(it.rate ?? 0),
            discount: String(it.discount ?? 0),
            tax_rate: String(it.tax_rate ?? 18),
          })));
          setNotes(ex.notes || '');
          setStatus(ex.status || 'draft');
        }
      } catch (e: any) {
        Alert.alert('Load Error', e?.message || 'Unable to load estimate');
      } finally {
        setLoadingExisting(false);
      }
    })();
  }, [editId]);

  const addItemFromCatalog = (item: PickedItem) => {
    setItems(prev => [
      ...prev,
      {
        key: `${Date.now()}_${Math.random()}`,
        item_id: item.id,
        name: item.name,
        qty: '1',
        rate: String(item.sale_price || 0),
        discount: '0',
        tax_rate: String(item.tax_rate ?? 18),
      },
    ]);
  };

  const addManualItem = () => {
    setItems(prev => [
      ...prev,
      {
        key: `${Date.now()}_${Math.random()}`,
        name: '',
        qty: '1',
        rate: '0',
        discount: '0',
        tax_rate: '18',
      },
    ]);
  };

  const updateItem = (key: string, patch: Partial<ItemRow>) => {
    setItems(prev => prev.map(it => it.key === key ? { ...it, ...patch } : it));
  };

  const removeItem = (key: string) => {
    setItems(prev => prev.filter(it => it.key !== key));
  };

  // Calculations
  const calculated = items.map(it => {
    const q = Number(it.qty || 0);
    const r = Number(it.rate || 0);
    const d = Number(it.discount || 0);
    const tx = Number(it.tax_rate || 0);
    const amt = q * r;
    const taxable = Math.max(0, amt - d);
    const taxAmt = taxable * (tx / 100);
    const tot = taxable + taxAmt;
    return { amt, d, taxAmt, tot };
  });

  const subtotal = calculated.reduce((s, x) => s + x.amt, 0);
  const totalDiscount = calculated.reduce((s, x) => s + x.d, 0);
  const totalTax = calculated.reduce((s, x) => s + x.taxAmt, 0);
  const grandTotal = calculated.reduce((s, x) => s + x.tot, 0);

  const save = async () => {
    if (!party) {
      Alert.alert('Customer Required', 'Please select a customer for this estimate.');
      return;
    }
    if (items.length === 0) {
      Alert.alert('Items Required', 'Please add at least one line item to the quotation.');
      return;
    }
    for (const it of items) {
      if (!it.name.trim()) {
        Alert.alert('Item Name Required', 'Please provide a name for all line items.');
        return;
      }
    }

    setSaving(true);
    try {
      const payload = {
        estimate_no: isManual && estimateNo && !estimateNo.includes('preview') ? estimateNo.trim() : undefined,
        date,
        customer_id: party.id,
        items: items.map(it => ({
          item_id: it.item_id,
          name: it.name,
          qty: Number(it.qty || 1),
          rate: Number(it.rate || 0),
          discount: Number(it.discount || 0),
          tax_rate: Number(it.tax_rate || 18),
        })),
        notes: notes.trim() || undefined,
        status: status || 'draft',
      };

      if (editId) {
        const res: any = await api.patch(`/accounting/estimates/${editId}`, payload);
        Alert.alert('Estimate Updated', `Quotation ${res.estimate_no || estimateNo} updated successfully.`);
      } else {
        const res: any = await api.post('/accounting/estimates', payload);
        Alert.alert('Estimate Created', `Quotation ${res.estimate_no} saved successfully.`);
      }
      router.replace('/accounting/estimates' as any);
    } catch (e: any) {
      Alert.alert('Failed', e?.message || 'Unable to save estimate');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.root}>
      <ScreenHeader title={editId ? `Edit Estimate (${estimateNo || 'Quotation'})` : "New Estimate / Quotation"} />

      {loadingExisting ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={colors.brandPrimary} />
          <Text style={{ color: colors.muted, marginTop: 8 }}>Loading estimate details...</Text>
        </View>
      ) : (
      <ScrollView contentContainerStyle={{ padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxxl }}>
        {/* Basic Meta */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Customer & Date</Text>
          <View style={{ marginTop: spacing.sm }}>
            <Text style={styles.lbl}>{isManual ? "Quotation No. (Manual Entry)" : "Quotation No. (Auto)"}</Text>
            <TextInput
              style={[styles.input, !isManual && { backgroundColor: '#F1F5F9', color: '#64748B' }]}
              value={estimateNo}
              onChangeText={isManual ? setEstimateNo : undefined}
              editable={isManual}
              placeholder="e.g. TDSC-EST/2026-27/0001"
            />
          </View>

          <View style={{ marginTop: spacing.sm }}>
            <Text style={styles.lbl}>Quotation Date</Text>
            <TextInput style={styles.input} value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" />
          </View>

          <View style={{ marginTop: spacing.sm }}>
            <Text style={styles.lbl}>Customer / Contractor *</Text>
            {party ? (
              <View style={styles.partyPicked}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.partyName}>{party.name}</Text>
                  <Text style={styles.partySub}>{party.mobile || party.pan || 'Selected Client'}</Text>
                </View>
                <Pressable onPress={() => setShowPartyPick(true)} style={styles.changePartyBtn}>
                  <Text style={styles.changePartyTxt}>Change</Text>
                </Pressable>
              </View>
            ) : (
              <Pressable onPress={() => setShowPartyPick(true)} style={styles.pickPartyBtn}>
                <Ionicons name="person-add" size={18} color={colors.brandPrimary} />
                <Text style={styles.pickPartyTxt}>Select Customer / Party</Text>
              </Pressable>
            )}
          </View>
        </View>

        {/* Line Items */}
        <View style={styles.card}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={styles.cardTitle}>Items & Services</Text>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              <Pressable onPress={() => setShowItemPick(true)} style={styles.addItemBtn}>
                <Ionicons name="cart" size={14} color="#FFF" />
                <Text style={styles.addItemTxt}>From Catalog</Text>
              </Pressable>
              <Pressable onPress={addManualItem} style={[styles.addItemBtn, { backgroundColor: '#475569' }]}>
                <Ionicons name="add" size={14} color="#FFF" />
                <Text style={styles.addItemTxt}>Manual Item</Text>
              </Pressable>
            </View>
          </View>

          {items.length === 0 ? (
            <View style={styles.emptyItems}>
              <Ionicons name="clipboard-outline" size={32} color={colors.muted} />
              <Text style={styles.muted}>No items added. Pick services from catalog or add manually.</Text>
            </View>
          ) : (
            <View style={{ marginTop: spacing.md, gap: spacing.md }}>
              {items.map((it, idx) => {
                const cal = calculated[idx];
                return (
                  <View key={it.key} style={styles.itemBox}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text style={styles.itemIndex}>#{idx + 1}</Text>
                      <Pressable onPress={() => removeItem(it.key)}>
                        <Ionicons name="trash-outline" size={18} color={colors.error} />
                      </Pressable>
                    </View>

                    <TextInput
                      style={[styles.input, { fontWeight: '700' }]}
                      placeholder="Item name / Service description *"
                      value={it.name}
                      onChangeText={v => updateItem(it.key, { name: v })}
                    />

                    <View style={styles.itemGrid}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.gridLbl}>Qty</Text>
                        <TextInput
                          style={styles.gridInput}
                          keyboardType="numeric"
                          value={it.qty}
                          onChangeText={v => updateItem(it.key, { qty: v })}
                        />
                      </View>
                      <View style={{ flex: 1.5 }}>
                        <Text style={styles.gridLbl}>Rate (₹)</Text>
                        <TextInput
                          style={styles.gridInput}
                          keyboardType="numeric"
                          value={it.rate}
                          onChangeText={v => updateItem(it.key, { rate: v })}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.gridLbl}>Disc (₹)</Text>
                        <TextInput
                          style={styles.gridInput}
                          keyboardType="numeric"
                          value={it.discount}
                          onChangeText={v => updateItem(it.key, { discount: v })}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.gridLbl}>GST %</Text>
                        <TextInput
                          style={styles.gridInput}
                          keyboardType="numeric"
                          value={it.tax_rate}
                          onChangeText={v => updateItem(it.key, { tax_rate: v })}
                        />
                      </View>
                    </View>

                    <View style={styles.itemTotalRow}>
                      <Text style={styles.itemTotalLbl}>Item Total (inc. Tax)</Text>
                      <Text style={styles.itemTotalVal}>{inr(cal?.tot || 0)}</Text>
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </View>

        {/* Totals Summary */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Bill Summary</Text>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLbl}>Subtotal</Text>
            <Text style={styles.summaryVal}>{inr(subtotal)}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLbl}>Total Discount</Text>
            <Text style={styles.summaryVal}>- {inr(totalDiscount)}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLbl}>GST Tax Amount</Text>
            <Text style={styles.summaryVal}>+ {inr(totalTax)}</Text>
          </View>
          <View style={[styles.summaryRow, styles.grandRow]}>
            <Text style={styles.grandLbl}>Grand Total</Text>
            <Text style={styles.grandVal}>{inr(grandTotal)}</Text>
          </View>
        </View>

        {/* Notes */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Terms & Notes</Text>
          <TextInput
            style={[styles.input, { minHeight: 60, marginTop: 8 }]}
            multiline
            placeholder="Payment terms, quotation validity, or specific terms..."
            value={notes}
            onChangeText={setNotes}
          />
        </View>

        <PrimaryButton label={editId ? "Update Estimate / Quotation" : "Save Estimate / Quotation"} onPress={save} loading={saving} />
      </ScrollView>
      )}

      <CustomerSearchModal
        visible={showPartyPick}
        onClose={() => setShowPartyPick(false)}
        onPick={p => { setParty(p); setShowPartyPick(false); }}
      />

      <ItemSearchModal
        visible={showItemPick}
        onClose={() => setShowItemPick(false)}
        onPick={it => { addItemFromCatalog(it); setShowItemPick(false); }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F8FAFC' },
  card: { backgroundColor: '#FFF', borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, ...shadow.card },
  cardTitle: { fontSize: font.base, fontWeight: '800', color: '#0F172A' },
  lbl: { fontSize: 11, fontWeight: '700', color: '#475569', marginBottom: 4 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 8, fontSize: font.sm, backgroundColor: '#FFF' },
  pickPartyBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.brandPrimary, borderStyle: 'dashed', backgroundColor: '#EFF6FF', justifyContent: 'center' },
  pickPartyTxt: { color: colors.brandPrimary, fontWeight: '700', fontSize: font.sm },
  partyPicked: { flexDirection: 'row', alignItems: 'center', padding: 10, borderRadius: radius.md, backgroundColor: '#F1F5F9' },
  partyName: { fontSize: font.sm, fontWeight: '800', color: '#0F172A' },
  partySub: { fontSize: 11, color: colors.muted, marginTop: 1 },
  changePartyBtn: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: '#E2E8F0' },
  changePartyTxt: { fontSize: 11, fontWeight: '700', color: '#334155' },
  addItemBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.brandPrimary, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill },
  addItemTxt: { color: '#FFF', fontWeight: '700', fontSize: 11 },
  emptyItems: { alignItems: 'center', padding: spacing.xl, gap: 6 },
  muted: { color: colors.muted, fontSize: font.sm, textAlign: 'center' },
  itemBox: { padding: spacing.md, borderRadius: radius.md, backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: colors.divider, gap: 8 },
  itemIndex: { fontSize: 11, fontWeight: '900', color: colors.brandPrimary },
  itemGrid: { flexDirection: 'row', gap: 8 },
  gridLbl: { fontSize: 10, fontWeight: '700', color: '#64748B' },
  gridInput: { borderWidth: 1, borderColor: colors.border, borderRadius: 6, padding: 6, fontSize: font.sm, backgroundColor: '#FFF', marginTop: 2 },
  itemTotalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  itemTotalLbl: { fontSize: 11, fontWeight: '700', color: '#64748B' },
  itemTotalVal: { fontSize: font.sm, fontWeight: '900', color: '#059669' },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  summaryLbl: { fontSize: font.sm, color: '#475569' },
  summaryVal: { fontSize: font.sm, fontWeight: '700', color: '#0F172A' },
  grandRow: { marginTop: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: '#E2E8F0' },
  grandLbl: { fontSize: font.base, fontWeight: '900', color: '#0F172A' },
  grandVal: { fontSize: font.lg, fontWeight: '900', color: '#059669' },
});
