import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, Platform, Share } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, font, shadow } from '@/src/theme';
import { api } from '@/src/api';
import { ScreenHeader } from '@/src/ScreenHeader';

const inr = (n: any) => {
  const val = Number(n || 0);
  return `₹${val.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const todayKolkata = (): string => {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istDate = new Date(now.getTime() + istOffset + (now.getTimezoneOffset() * 60 * 1000));
  return istDate.toISOString().slice(0, 10);
};

const daysAgo = (d: number) => {
  const dt = new Date();
  dt.setDate(dt.getDate() - d);
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istDate = new Date(dt.getTime() + istOffset + (dt.getTimezoneOffset() * 60 * 1000));
  return istDate.toISOString().slice(0, 10);
};

export default function DayBookReport() {
  const router = useRouter();
  const [fromDate, setFromDate] = useState(todayKolkata());
  const [toDate, setToDate] = useState(todayKolkata());
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<any>(`/system/reports/day-book?from_date=${fromDate}&to_date=${toDate}`);
      setData(res);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const setPreset = (days: number) => {
    if (days === 0) {
      setFromDate(todayKolkata());
      setToDate(todayKolkata());
    } else if (days === 1) {
      setFromDate(daysAgo(1));
      setToDate(daysAgo(1));
    } else {
      setFromDate(daysAgo(days));
      setToDate(todayKolkata());
    }
  };

  const handlePrint = () => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.print();
    } else {
      Share.share({
        message: `TRIVENI DSC & ETENDER SERVICE PVT. LTD. - Day Book Report (${fromDate} to ${toDate})\nTotal OB: ${inr(data?.total_ob_with_receipts)}\nTotal CB: ${inr(data?.total_cb)}\nStatus: ${data?.reconciliation_message || 'OK'}`,
        title: 'Day Book Report',
      });
    }
  };

  const openingBalances: any[] = data?.opening_balances || [];
  const saleReceipts: any[] = data?.sale_receipts || [];
  const paymentInReceipts: any[] = data?.payment_in_receipts || [];
  const closingBalances: any[] = data?.closing_balances || [];
  const isBalanced: boolean = data?.is_balanced !== false;
  const diffAmt = data?.difference || 0;

  return (
    <View style={styles.root} testID="day-book-screen">
      <ScreenHeader
        title="Day Book Report"
        right={
          <Pressable onPress={handlePrint} style={styles.printBtn} testID="btn-print-day-book">
            <Ionicons name="print-outline" size={18} color="#2563EB" />
            <Text style={styles.printBtnTxt}>Print / PDF</Text>
          </Pressable>
        }
      />

      {/* Date Filter Bar */}
      <View style={styles.filterCard}>
        <View style={styles.presetRow}>
          <Pressable onPress={() => setPreset(0)} style={[styles.presetChip, fromDate === todayKolkata() && toDate === todayKolkata() && styles.presetChipActive]}>
            <Text style={[styles.presetText, fromDate === todayKolkata() && toDate === todayKolkata() && styles.presetTextActive]}>Today</Text>
          </Pressable>
          <Pressable onPress={() => setPreset(1)} style={[styles.presetChip, fromDate === daysAgo(1) && toDate === daysAgo(1) && styles.presetChipActive]}>
            <Text style={[styles.presetText, fromDate === daysAgo(1) && toDate === daysAgo(1) && styles.presetTextActive]}>Yesterday</Text>
          </Pressable>
          <Pressable onPress={() => setPreset(7)} style={[styles.presetChip, fromDate === daysAgo(7) && styles.presetChipActive]}>
            <Text style={[styles.presetText, fromDate === daysAgo(7) && styles.presetTextActive]}>Last 7 Days</Text>
          </Pressable>
          <Pressable onPress={() => setPreset(30)} style={[styles.presetChip, fromDate === daysAgo(30) && styles.presetChipActive]}>
            <Text style={[styles.presetText, fromDate === daysAgo(30) && styles.presetTextActive]}>Last 30 Days</Text>
          </Pressable>
        </View>

        <View style={styles.dateInputsRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.dateLbl}>From Date</Text>
            <TextInput style={styles.dateInput} value={fromDate} onChangeText={setFromDate} placeholder="YYYY-MM-DD" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.dateLbl}>To Date</Text>
            <TextInput style={styles.dateInput} value={toDate} onChangeText={setToDate} placeholder="YYYY-MM-DD" />
          </View>
          <Pressable onPress={load} style={styles.goBtn}>
            <Ionicons name="refresh" size={18} color="#FFF" />
          </Pressable>
        </View>
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={colors.brandPrimary} />
          <Text style={{ color: colors.muted, marginTop: 8 }}>Compiling Day Book Ledger...</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scrollContent}>

          {/* Reconciliation Status Alert Banner */}
          <View style={[styles.statusBanner, isBalanced ? styles.statusBannerOk : styles.statusBannerMismatch]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Ionicons
                name={isBalanced ? 'checkmark-circle' : 'alert-circle'}
                size={28}
                color={isBalanced ? '#059669' : '#DC2626'}
              />
              <View style={{ flex: 1 }}>
                <Text style={[styles.statusBannerTitle, { color: isBalanced ? '#065F46' : '#991B1B' }]}>
                  {isBalanced ? 'Account is ok.' : 'Account Mismatch'}
                </Text>
                <Text style={[styles.statusBannerSub, { color: isBalanced ? '#047857' : '#B91C1C' }]}>
                  {isBalanced
                    ? `Total O.B (${inr(data?.total_ob_with_receipts)}) matches Total C.B (${inr(data?.total_cb)}) perfectly.`
                    : `Discrepancy of ${inr(diffAmt)} between Total O.B (${inr(data?.total_ob_with_receipts)}) and Total C.B (${inr(data?.total_cb)}).`}
                </Text>
              </View>
            </View>
          </View>

          {/* ============================================================== */}
          {/* 1. Opening Balance Section                                     */}
          {/* ============================================================== */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="wallet-outline" size={20} color="#2563EB" />
                <Text style={styles.cardTitle}>Opening Balance:-</Text>
              </View>
              <Text style={styles.cardPeriodBadge}>As of {fromDate}</Text>
            </View>

            <View style={{ gap: 10, marginTop: 8 }}>
              {openingBalances.map((acc, i) => (
                <View key={acc.id || i} style={styles.balanceItemRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.balanceItemName}>
                      <Text style={{ fontWeight: '800', color: '#2563EB' }}>{acc.index} </Text>
                      {acc.name}
                    </Text>
                    {acc.account_no && acc.account_no !== '—' ? (
                      <Text style={styles.balanceItemSub}>
                        {acc.bank_name} • A/c {acc.account_no} • IFSC: {acc.ifsc}
                      </Text>
                    ) : null}
                  </View>
                  <View style={styles.dottedLeader} />
                  <Text style={styles.balanceItemAmt}>
                    Current Balance in Rs. <Text style={{ fontWeight: '800', color: '#0F172A' }}>{inr(acc.balance)}</Text>
                  </Text>
                </View>
              ))}
            </View>

            <View style={styles.sectionDivider} />

            <View style={styles.summaryTotalRow}>
              <Text style={styles.summaryTotalLabel}>
                Total OB = (i)+(ii)+(iii)+(iv) + ... =
              </Text>
              <Text style={[styles.summaryTotalValue, { color: '#2563EB' }]}>
                Rs. {inr(data?.total_previous_ob || 0).replace('₹', '')}
              </Text>
            </View>
          </View>

          {/* ============================================================== */}
          {/* 2. Receipt Amount from Sale Voucher Table                     */}
          {/* ============================================================== */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="receipt-outline" size={20} color="#059669" />
                <Text style={styles.cardTitle}>Receipt Amount from Sale Voucher:</Text>
              </View>
              <View style={{ backgroundColor: '#D1FAE5', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 }}>
                <Text style={{ color: '#047857', fontSize: 11, fontWeight: '800' }}>
                  {saleReceipts.length} Vouchers • Total: {inr(data?.total_sale_receipts || 0)}
                </Text>
              </View>
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={true} style={{ marginTop: 8 }}>
              <View>
                {/* Table Header */}
                <View style={styles.tableHeaderRow}>
                  <Text style={[styles.thCell, { width: 50 }]}>Sl. No.</Text>
                  <Text style={[styles.thCell, { width: 95 }]}>Date</Text>
                  <Text style={[styles.thCell, { width: 140 }]}>Voucher</Text>
                  <Text style={[styles.thCell, { width: 130 }]}>Ref #</Text>
                  <Text style={[styles.thCell, { width: 120 }]}>Transaction Type</Text>
                  <Text style={[styles.thCell, { width: 180 }]}>Party</Text>
                  <Text style={[styles.thCell, { width: 180 }]}>Particulars</Text>
                  <Text style={[styles.thCell, { width: 110 }]}>Payment Mode</Text>
                  <Text style={[styles.thCell, { width: 110, textAlign: 'right' }]}>Receipt (In)</Text>
                  <Text style={[styles.thCell, { width: 110, textAlign: 'right' }]}>Payment (Out)</Text>
                  <Text style={[styles.thCell, { width: 120, textAlign: 'right' }]}>Cumulative Bal.</Text>
                </View>

                {/* Table Body */}
                {saleReceipts.length === 0 ? (
                  <View style={styles.tableEmptyRow}>
                    <Text style={styles.tableEmptyText}>No Sale Receipts recorded in selected date range.</Text>
                  </View>
                ) : (
                  saleReceipts.map((sr, idx) => (
                    <View key={idx} style={[styles.tableDataRow, idx % 2 === 1 && styles.tableRowAlt]}>
                      <Text style={[styles.tdCell, { width: 50, fontWeight: '700' }]}>{sr.sl_no}</Text>
                      <Text style={[styles.tdCell, { width: 95 }]}>{sr.date}</Text>
                      <Text style={[styles.tdCell, { width: 140, fontWeight: '700', color: '#2563EB' }]}>{sr.voucher}</Text>
                      <Text style={[styles.tdCell, { width: 130 }]}>{sr.ref_no}</Text>
                      <Text style={[styles.tdCell, { width: 120 }]}>{sr.transaction_type}</Text>
                      <Text style={[styles.tdCell, { width: 180, fontWeight: '600' }]} numberOfLines={1}>{sr.party}</Text>
                      <Text style={[styles.tdCell, { width: 180 }]} numberOfLines={1}>{sr.particulars}</Text>
                      <View style={{ width: 110, paddingHorizontal: 6, justifyContent: 'center' }}>
                        <View style={styles.modeBadge}>
                          <Text style={styles.modeBadgeText}>{sr.payment_mode}</Text>
                        </View>
                      </View>
                      <Text style={[styles.tdCell, { width: 110, textAlign: 'right', fontWeight: '800', color: '#059669' }]}>
                        {inr(sr.receipt_in)}
                      </Text>
                      <Text style={[styles.tdCell, { width: 110, textAlign: 'right', color: '#64748B' }]}>
                        {sr.payment_out > 0 ? inr(sr.payment_out) : '—'}
                      </Text>
                      <Text style={[styles.tdCell, { width: 120, textAlign: 'right', fontWeight: '800', color: '#0F172A' }]}>
                        {inr(sr.cumulative_bal)}
                      </Text>
                    </View>
                  ))
                )}

                {/* Table Footer */}
                <View style={styles.tableFooterRow}>
                  <Text style={[styles.tfCell, { width: 885 }]}>Total Receipt Amount against Sale Vouchers:</Text>
                  <Text style={[styles.tfCell, { width: 110, textAlign: 'right', color: '#059669' }]}>
                    {inr(data?.total_sale_receipts || 0)}
                  </Text>
                  <Text style={[styles.tfCell, { width: 110, textAlign: 'right' }]}>₹0.00</Text>
                  <Text style={[styles.tfCell, { width: 120, textAlign: 'right', color: '#059669' }]}>
                    {inr(data?.total_sale_receipts || 0)}
                  </Text>
                </View>
              </View>
            </ScrollView>
          </View>

          {/* ============================================================== */}
          {/* 3. Receipt Amount From Payment In Table                        */}
          {/* ============================================================== */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="arrow-down-circle-outline" size={20} color="#7C3AED" />
                <Text style={styles.cardTitle}>Receipt Amount From Payment In:</Text>
              </View>
              <View style={{ backgroundColor: '#F3E8FF', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 }}>
                <Text style={{ color: '#7E22CE', fontSize: 11, fontWeight: '800' }}>
                  {paymentInReceipts.length} Receipts • Total: {inr(data?.total_payment_in_receipts || 0)}
                </Text>
              </View>
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={true} style={{ marginTop: 8 }}>
              <View>
                {/* Table Header */}
                <View style={styles.tableHeaderRow}>
                  <Text style={[styles.thCell, { width: 50 }]}>Sl. No.</Text>
                  <Text style={[styles.thCell, { width: 95 }]}>Date</Text>
                  <Text style={[styles.thCell, { width: 130 }]}>Voucher</Text>
                  <Text style={[styles.thCell, { width: 120 }]}>Ref #</Text>
                  <Text style={[styles.thCell, { width: 170 }]}>Previous Voucher Ref. against receipt Payment</Text>
                  <Text style={[styles.thCell, { width: 120 }]}>Transaction Type</Text>
                  <Text style={[styles.thCell, { width: 170 }]}>Party</Text>
                  <Text style={[styles.thCell, { width: 170 }]}>Particulars</Text>
                  <Text style={[styles.thCell, { width: 110 }]}>Payment Mode</Text>
                  <Text style={[styles.thCell, { width: 110, textAlign: 'right' }]}>Receipt (In)</Text>
                  <Text style={[styles.thCell, { width: 110, textAlign: 'right' }]}>Payment (Out)</Text>
                  <Text style={[styles.thCell, { width: 120, textAlign: 'right' }]}>Cumulative Bal.</Text>
                </View>

                {/* Table Body */}
                {paymentInReceipts.length === 0 ? (
                  <View style={styles.tableEmptyRow}>
                    <Text style={styles.tableEmptyText}>No Payment In receipts recorded in selected date range.</Text>
                  </View>
                ) : (
                  paymentInReceipts.map((pr, idx) => (
                    <View key={idx} style={[styles.tableDataRow, idx % 2 === 1 && styles.tableRowAlt]}>
                      <Text style={[styles.tdCell, { width: 50, fontWeight: '700' }]}>{pr.sl_no}</Text>
                      <Text style={[styles.tdCell, { width: 95 }]}>{pr.date}</Text>
                      <Text style={[styles.tdCell, { width: 130, fontWeight: '700', color: '#7C3AED' }]}>{pr.voucher}</Text>
                      <Text style={[styles.tdCell, { width: 120 }]}>{pr.ref_no}</Text>
                      <Text style={[styles.tdCell, { width: 170, color: '#2563EB', fontWeight: '600' }]} numberOfLines={1}>
                        {pr.previous_voucher_ref}
                      </Text>
                      <Text style={[styles.tdCell, { width: 120 }]}>{pr.transaction_type}</Text>
                      <Text style={[styles.tdCell, { width: 170, fontWeight: '600' }]} numberOfLines={1}>{pr.party}</Text>
                      <Text style={[styles.tdCell, { width: 170 }]} numberOfLines={1}>{pr.particulars}</Text>
                      <View style={{ width: 110, paddingHorizontal: 6, justifyContent: 'center' }}>
                        <View style={[styles.modeBadge, { backgroundColor: '#F3E8FF' }]}>
                          <Text style={[styles.modeBadgeText, { color: '#7E22CE' }]}>{pr.payment_mode}</Text>
                        </View>
                      </View>
                      <Text style={[styles.tdCell, { width: 110, textAlign: 'right', fontWeight: '800', color: '#059669' }]}>
                        {inr(pr.receipt_in)}
                      </Text>
                      <Text style={[styles.tdCell, { width: 110, textAlign: 'right', color: '#64748B' }]}>
                        {pr.payment_out > 0 ? inr(pr.payment_out) : '—'}
                      </Text>
                      <Text style={[styles.tdCell, { width: 120, textAlign: 'right', fontWeight: '800', color: '#0F172A' }]}>
                        {inr(pr.cumulative_bal)}
                      </Text>
                    </View>
                  ))
                )}

                {/* Table Footer */}
                <View style={styles.tableFooterRow}>
                  <Text style={[styles.tfCell, { width: 945 }]}>Total Receipt Amount from Payment In:</Text>
                  <Text style={[styles.tfCell, { width: 110, textAlign: 'right', color: '#059669' }]}>
                    {inr(data?.total_payment_in_receipts || 0)}
                  </Text>
                  <Text style={[styles.tfCell, { width: 110, textAlign: 'right' }]}>₹0.00</Text>
                  <Text style={[styles.tfCell, { width: 120, textAlign: 'right', color: '#059669' }]}>
                    {inr(data?.total_payment_in_receipts || 0)}
                  </Text>
                </View>
              </View>
            </ScrollView>
          </View>

          {/* ============================================================== */}
          {/* 4. Day Summary & Total O.B.                                    */}
          {/* ============================================================== */}
          <View style={[styles.card, { backgroundColor: '#F0FDF4', borderColor: '#BBF7D0' }]}>
            <View style={styles.cardHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="calculator-outline" size={20} color="#059669" />
                <Text style={[styles.cardTitle, { color: '#065F46' }]}>Total O.B =</Text>
              </View>
            </View>

            <View style={{ gap: 6, marginTop: 8 }}>
              <View style={styles.summaryItemRow}>
                <Text style={styles.summaryItemText}>
                  Total previous OB = (i)+(ii)+(iii)+(iv) + ... =
                </Text>
                <Text style={styles.summaryItemVal}>
                  Rs. {inr(data?.total_previous_ob || 0).replace('₹', '')}
                </Text>
              </View>
              <Text style={styles.summaryItemConj}>And</Text>
              <View style={styles.summaryItemRow}>
                <Text style={styles.summaryItemText}>
                  Total Receipt amount against Sale during the day in Rs.
                </Text>
                <Text style={[styles.summaryItemVal, { color: '#059669' }]}>
                  {inr(data?.total_sale_receipts || 0).replace('₹', '')}
                </Text>
              </View>
              <Text style={styles.summaryItemConj}>And</Text>
              <View style={styles.summaryItemRow}>
                <Text style={styles.summaryItemText}>
                  Total Receipt amount against Payment in during the day in Rs.
                </Text>
                <Text style={[styles.summaryItemVal, { color: '#059669' }]}>
                  {inr(data?.total_payment_in_receipts || 0).replace('₹', '')}
                </Text>
              </View>
            </View>

            <View style={[styles.sectionDivider, { borderColor: '#86EFAC' }]} />

            <View style={styles.summaryTotalRow}>
              <Text style={[styles.summaryTotalLabel, { color: '#065F46' }]}>
                Total O.B
              </Text>
              <Text style={[styles.summaryTotalValue, { color: '#059669', fontSize: 18 }]}>
                Rs. {inr(data?.total_ob_with_receipts || 0).replace('₹', '')}
              </Text>
            </View>
          </View>

          {/* ============================================================== */}
          {/* 5. Closing Balance Section                                     */}
          {/* ============================================================== */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="lock-closed-outline" size={20} color="#475569" />
                <Text style={styles.cardTitle}>Closing Balance:</Text>
              </View>
              <Text style={styles.cardPeriodBadge}>As of {toDate}</Text>
            </View>

            <View style={{ gap: 10, marginTop: 8 }}>
              {closingBalances.map((item, i) => (
                <View key={item.id || i} style={styles.balanceItemRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.balanceItemName}>
                      <Text style={{ fontWeight: '800', color: '#475569' }}>{item.index} </Text>
                      {item.name}
                    </Text>
                    {item.account_no && item.account_no !== '—' ? (
                      <Text style={styles.balanceItemSub}>
                        {item.bank_name} • A/c {item.account_no} • IFSC: {item.ifsc}
                      </Text>
                    ) : null}
                  </View>
                  <View style={styles.dottedLeader} />
                  <Text style={styles.balanceItemAmt}>
                    {item.id?.startsWith('exp_') ? 'Rs. ' : 'Current Balance in Rs. '}
                    <Text style={{ fontWeight: '800', color: item.id?.startsWith('exp_') ? '#DC2626' : '#0F172A' }}>
                      {inr(item.balance)}
                    </Text>
                  </Text>
                </View>
              ))}
            </View>

            <View style={styles.sectionDivider} />

            <View style={styles.summaryTotalRow}>
              <Text style={styles.summaryTotalLabel}>
                Total C.B = (i)+(ii)+(iii)+(iv)+(v)+(vi) =
              </Text>
              <Text style={[styles.summaryTotalValue, { color: '#0F172A' }]}>
                Rs. {inr(data?.total_closing_balance || 0).replace('₹', '')}
              </Text>
            </View>
          </View>

          {/* ============================================================== */}
          {/* 6. Verification / Audit Stamp                                  */}
          {/* ============================================================== */}
          <View style={[styles.auditStampCard, isBalanced ? { borderColor: '#A7F3D0', backgroundColor: '#ECFDF5' } : { borderColor: '#FECACA', backgroundColor: '#FEF2F2' }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons
                  name={isBalanced ? 'shield-checkmark' : 'warning'}
                  size={24}
                  color={isBalanced ? '#059669' : '#DC2626'}
                />
                <View>
                  <Text style={{ fontSize: 13, fontWeight: '800', color: isBalanced ? '#065F46' : '#991B1B' }}>
                    Reconciliation Status: {isBalanced ? 'Account is ok.' : 'Account Mismatch'}
                  </Text>
                  <Text style={{ fontSize: 11, color: isBalanced ? '#047857' : '#B91C1C', marginTop: 2 }}>
                    If Total O.B = Total C.B → Account is ok. | If Not match O.B = C.B → Message "Account Mismatch"
                  </Text>
                </View>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={{ fontSize: 11, fontWeight: '700', color: '#64748B' }}>
                  Diff: {inr(diffAmt)}
                </Text>
                <View style={[styles.stampPill, { backgroundColor: isBalanced ? '#059669' : '#DC2626' }]}>
                  <Text style={styles.stampPillText}>{isBalanced ? 'VERIFIED' : 'MISMATCH'}</Text>
                </View>
              </View>
            </View>
          </View>

        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F8FAFC' },
  printBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.md, backgroundColor: '#EFF6FF', borderWidth: 1, borderColor: '#BFDBFE' },
  printBtnTxt: { fontSize: 12, fontWeight: '700', color: '#2563EB' },
  filterCard: { padding: spacing.md, backgroundColor: '#FFF', borderBottomWidth: 1, borderBottomColor: colors.border, gap: 10 },
  presetRow: { flexDirection: 'row', gap: 8 },
  presetChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: '#F1F5F9' },
  presetChipActive: { backgroundColor: colors.brandPrimary },
  presetText: { fontSize: 11, fontWeight: '700', color: '#475569' },
  presetTextActive: { color: '#FFF' },
  dateInputsRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  dateLbl: { fontSize: 10, fontWeight: '700', color: '#64748B', marginBottom: 2 },
  dateInput: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 8, paddingVertical: 6, fontSize: font.sm, backgroundColor: '#FFF' },
  goBtn: { backgroundColor: colors.brandPrimary, padding: 8, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  scrollContent: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxxl },

  statusBanner: { padding: spacing.md, borderRadius: radius.md, borderWidth: 1 },
  statusBannerOk: { backgroundColor: '#ECFDF5', borderColor: '#A7F3D0' },
  statusBannerMismatch: { backgroundColor: '#FEF2F2', borderColor: '#FECACA' },
  statusBannerTitle: { fontSize: 16, fontWeight: '900' },
  statusBannerSub: { fontSize: 12, marginTop: 2 },

  card: { backgroundColor: '#FFF', borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, ...shadow.card },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { fontSize: 14, fontWeight: '800', color: '#0F172A' },
  cardPeriodBadge: { fontSize: 11, fontWeight: '700', color: '#64748B', backgroundColor: '#F1F5F9', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 },

  balanceItemRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  balanceItemName: { fontSize: 13, fontWeight: '700', color: '#1E293B' },
  balanceItemSub: { fontSize: 11, color: '#64748B', marginTop: 1 },
  dottedLeader: { flex: 1, height: 1, borderBottomWidth: 1, borderBottomColor: '#CBD5E1', borderStyle: 'dotted', marginHorizontal: 6 },
  balanceItemAmt: { fontSize: 12, color: '#475569' },

  sectionDivider: { height: 1, borderBottomWidth: 1, borderBottomColor: '#E2E8F0', marginVertical: 12 },

  summaryTotalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  summaryTotalLabel: { fontSize: 13, fontWeight: '800', color: '#1E293B' },
  summaryTotalValue: { fontSize: 16, fontWeight: '900' },

  tableHeaderRow: { flexDirection: 'row', backgroundColor: '#F8FAFC', borderBottomWidth: 2, borderBottomColor: '#CBD5E1', paddingVertical: 8 },
  thCell: { fontSize: 11, fontWeight: '800', color: '#334155', paddingHorizontal: 6 },
  tableDataRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#F1F5F9', paddingVertical: 8, alignItems: 'center' },
  tableRowAlt: { backgroundColor: '#F8FAFC' },
  tdCell: { fontSize: 12, color: '#1E293B', paddingHorizontal: 6 },
  modeBadge: { backgroundColor: '#ECFDF5', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, alignSelf: 'flex-start' },
  modeBadgeText: { fontSize: 10, fontWeight: '800', color: '#047857' },
  tableFooterRow: { flexDirection: 'row', backgroundColor: '#F1F5F9', borderTopWidth: 2, borderTopColor: '#CBD5E1', paddingVertical: 8, alignItems: 'center' },
  tfCell: { fontSize: 12, fontWeight: '800', color: '#0F172A', paddingHorizontal: 6 },
  tableEmptyRow: { padding: 24, alignItems: 'center', justifyContent: 'center' },
  tableEmptyText: { fontSize: 12, color: '#94A3B8', fontStyle: 'italic' },

  summaryItemRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  summaryItemText: { fontSize: 13, fontWeight: '600', color: '#166534' },
  summaryItemConj: { fontSize: 11, fontWeight: '800', color: '#059669', marginVertical: -2 },
  summaryItemVal: { fontSize: 13, fontWeight: '800', color: '#0F172A' },

  auditStampCard: { padding: spacing.md, borderRadius: radius.md, borderWidth: 1 },
  stampPill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4, marginTop: 4 },
  stampPillText: { fontSize: 10, fontWeight: '900', color: '#FFF', letterSpacing: 0.5 },
});
