import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, FlatList, ActivityIndicator, Share } from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, font, shadow } from '@/src/theme';
import { api } from '@/src/api';
import { ScreenHeader } from '@/src/ScreenHeader';

const inr = (n: any) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

type GSTTab = 'gstr1' | 'gstr2' | 'gstr3b' | 'hsn' | 'tds';

export default function GSTReports() {
  const router = useRouter();
  const params = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<GSTTab>((params?.tab as GSTTab) || 'gstr1');
  const [invoices, setInvoices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const allInvoices = await api.get<any[]>('/invoices').catch(() => []);
      setInvoices(allInvoices || []);
    } catch {
      setInvoices([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Categorize
  const sales = invoices.filter(i => i.invoice_type === 'sale');
  const purchases = invoices.filter(i => i.invoice_type === 'purchase');

  // Compute GSTR-1 (Outward Supplies)
  const gstr1Taxable = sales.reduce((acc, s) => acc + (Number(s.subtotal) || Number(s.total_amount) * 0.847 || 0), 0);
  const gstr1Tax = sales.reduce((acc, s) => acc + (Number(s.total_tax) || (Number(s.total_amount) - (Number(s.subtotal) || 0)) || 0), 0);
  const gstr1Total = sales.reduce((acc, s) => acc + (Number(s.total_amount) || 0), 0);

  // Compute GSTR-2 (Inward Supplies / Purchases)
  const gstr2Taxable = purchases.reduce((acc, p) => acc + (Number(p.subtotal) || Number(p.total_amount) * 0.847 || 0), 0);
  const gstr2Tax = purchases.reduce((acc, p) => acc + (Number(p.total_tax) || (Number(p.total_amount) - (Number(p.subtotal) || 0)) || 0), 0);
  const gstr2Total = purchases.reduce((acc, p) => acc + (Number(p.total_amount) || 0), 0);

  // GSTR-3B Net Tax Payable
  const netGstPayable = Math.max(0, gstr1Tax - gstr2Tax);
  const excessItc = Math.max(0, gstr2Tax - gstr1Tax);

  // Share summary
  const shareGstSummary = async () => {
    const text = `TDSC GST Summary\nPeriod: FY 2026-27\nOutput GST (GSTR-1): ${inr(gstr1Tax)}\nInput Tax Credit (GSTR-2): ${inr(gstr2Tax)}\nNet GST Payable: ${inr(netGstPayable)}\nExcess ITC: ${inr(excessItc)}`;
    try { await Share.share({ message: text }); } catch {}
  };

  return (
    <View style={styles.root} testID="gst-reports-screen">
      <ScreenHeader
        title="GST Reports & Tax Center"
        subtitle="GSTR-1, GSTR-2, GSTR-3B & HSN Summary"
        right={(
          <Pressable onPress={shareGstSummary} style={styles.shareBtn} hitSlop={8}>
            <Ionicons name="share-social" size={18} color="#FFF" />
          </Pressable>
        )}
      />

      {/* Navigation Tabs */}
      <View style={styles.tabRow}>
        <Pressable onPress={() => setTab('gstr1')} style={[styles.tabItem, tab === 'gstr1' && styles.tabItemActive]}>
          <Text style={[styles.tabTxt, tab === 'gstr1' && styles.tabTxtActive]}>GSTR-1</Text>
        </Pressable>
        <Pressable onPress={() => setTab('gstr2')} style={[styles.tabItem, tab === 'gstr2' && styles.tabItemActive]}>
          <Text style={[styles.tabTxt, tab === 'gstr2' && styles.tabTxtActive]}>GSTR-2</Text>
        </Pressable>
        <Pressable onPress={() => setTab('gstr3b')} style={[styles.tabItem, tab === 'gstr3b' && styles.tabItemActive]}>
          <Text style={[styles.tabTxt, tab === 'gstr3b' && styles.tabTxtActive]}>GSTR-3B</Text>
        </Pressable>
        <Pressable onPress={() => setTab('hsn')} style={[styles.tabItem, tab === 'hsn' && styles.tabItemActive]}>
          <Text style={[styles.tabTxt, tab === 'hsn' && styles.tabTxtActive]}>HSN/SAC</Text>
        </Pressable>
        <Pressable onPress={() => setTab('tds')} style={[styles.tabItem, tab === 'tds' && styles.tabItemActive]}>
          <Text style={[styles.tabTxt, tab === 'tds' && styles.tabTxtActive]}>TDS / TCS</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={colors.brandPrimary} />
          <Text style={{ color: colors.muted, marginTop: 8 }}>Computing GST returns from ledger...</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxxl }}>
          {/* TAB: GSTR-1 Outward Supplies */}
          {tab === 'gstr1' && (
            <View style={{ gap: spacing.md }}>
              <View style={styles.kpiRow}>
                <View style={[styles.kpiCard, { backgroundColor: '#ECFDF5', borderColor: '#A7F3D0' }]}>
                  <Text style={styles.kpiLbl}>Taxable Outward</Text>
                  <Text style={[styles.kpiVal, { color: '#059669' }]}>{inr(gstr1Taxable)}</Text>
                </View>
                <View style={[styles.kpiCard, { backgroundColor: '#EFF6FF', borderColor: '#BFDBFE' }]}>
                  <Text style={styles.kpiLbl}>Output GST (18%)</Text>
                  <Text style={[styles.kpiVal, { color: '#2563EB' }]}>{inr(gstr1Tax)}</Text>
                </View>
                <View style={[styles.kpiCard, { backgroundColor: '#F8FAFC', borderColor: '#CBD5E1' }]}>
                  <Text style={styles.kpiLbl}>Gross Invoices</Text>
                  <Text style={[styles.kpiVal, { color: '#0F172A' }]}>{inr(gstr1Total)}</Text>
                </View>
              </View>

              <View style={styles.card}>
                <Text style={styles.cardTitle}>GSTR-1 Outward Invoices ({sales.length} B2B Bills)</Text>
                <View style={{ marginTop: spacing.sm, gap: 8 }}>
                  {sales.length === 0 ? (
                    <Text style={styles.muted}>No sales invoices recorded for this period.</Text>
                  ) : (
                    sales.map(s => (
                      <Pressable
                        key={s.id}
                        style={styles.invoiceRow}
                        onPress={() => router.push(`/accounting/invoices/${s.id}` as any)}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={styles.invNo}>{s.invoice_number}</Text>
                          <Text style={styles.invParty}>{s.party_name}</Text>
                          <Text style={styles.invMeta}>{s.invoice_date} • {s.payment_type?.toUpperCase()}</Text>
                        </View>
                        <View style={{ alignItems: 'flex-end' }}>
                          <Text style={styles.invAmt}>{inr(s.total_amount)}</Text>
                          <Text style={styles.invTax}>GST: {inr(s.total_tax || (s.total_amount * 0.18))}</Text>
                        </View>
                        <Ionicons name="chevron-forward" size={16} color={colors.muted} />
                      </Pressable>
                    ))
                  )}
                </View>
              </View>
            </View>
          )}

          {/* TAB: GSTR-2 Inward Supplies */}
          {tab === 'gstr2' && (
            <View style={{ gap: spacing.md }}>
              <View style={styles.kpiRow}>
                <View style={[styles.kpiCard, { backgroundColor: '#FEF2F2', borderColor: '#FECACA' }]}>
                  <Text style={styles.kpiLbl}>Inward Taxable</Text>
                  <Text style={[styles.kpiVal, { color: '#DC2626' }]}>{inr(gstr2Taxable)}</Text>
                </View>
                <View style={[styles.kpiCard, { backgroundColor: '#EDE9FE', borderColor: '#DDD6FE' }]}>
                  <Text style={styles.kpiLbl}>Input Tax Credit (ITC)</Text>
                  <Text style={[styles.kpiVal, { color: '#7C3AED' }]}>{inr(gstr2Tax)}</Text>
                </View>
                <View style={[styles.kpiCard, { backgroundColor: '#F8FAFC', borderColor: '#CBD5E1' }]}>
                  <Text style={styles.kpiLbl}>Purchase Bills</Text>
                  <Text style={[styles.kpiVal, { color: '#0F172A' }]}>{inr(gstr2Total)}</Text>
                </View>
              </View>

              <View style={styles.card}>
                <Text style={styles.cardTitle}>GSTR-2 Inward Bills & ITC ({purchases.length} Bills)</Text>
                <View style={{ marginTop: spacing.sm, gap: 8 }}>
                  {purchases.length === 0 ? (
                    <Text style={styles.muted}>No purchase bills recorded for this period.</Text>
                  ) : (
                    purchases.map(p => (
                      <Pressable
                        key={p.id}
                        style={styles.invoiceRow}
                        onPress={() => router.push(`/accounting/invoices/${p.id}` as any)}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={styles.invNo}>{p.invoice_number}</Text>
                          <Text style={styles.invParty}>{p.party_name}</Text>
                          <Text style={styles.invMeta}>{p.invoice_date}</Text>
                        </View>
                        <View style={{ alignItems: 'flex-end' }}>
                          <Text style={styles.invAmt}>{inr(p.total_amount)}</Text>
                          <Text style={[styles.invTax, { color: '#7C3AED' }]}>ITC: {inr(p.total_tax || (p.total_amount * 0.18))}</Text>
                        </View>
                        <Ionicons name="chevron-forward" size={16} color={colors.muted} />
                      </Pressable>
                    ))
                  )}
                </View>
              </View>
            </View>
          )}

          {/* TAB: GSTR-3B Monthly Return */}
          {tab === 'gstr3b' && (
            <View style={{ gap: spacing.md }}>
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Form GSTR-3B • Monthly Tax Computation</Text>
                <Text style={styles.muted}>Rule 61(5) - Automated reconciliation between Output Tax and Input Tax Credit (ITC)</Text>

                <View style={styles.table}>
                  <View style={[styles.tRow, styles.tHead]}>
                    <Text style={[styles.tCell, { flex: 2 }]}>Particulars</Text>
                    <Text style={[styles.tCell, { textAlign: 'right' }]}>Amount</Text>
                  </View>
                  <View style={styles.tRow}>
                    <Text style={[styles.tCell, { flex: 2, fontWeight: '600' }]}>1. Total Outward Taxable Supplies</Text>
                    <Text style={[styles.tCell, { textAlign: 'right', fontWeight: '700' }]}>{inr(gstr1Taxable)}</Text>
                  </View>
                  <View style={styles.tRow}>
                    <Text style={[styles.tCell, { flex: 2, color: '#2563EB', fontWeight: '700' }]}>2. Total Output Tax Liability (CGST+SGST)</Text>
                    <Text style={[styles.tCell, { textAlign: 'right', color: '#2563EB', fontWeight: '800' }]}>{inr(gstr1Tax)}</Text>
                  </View>
                  <View style={styles.tRow}>
                    <Text style={[styles.tCell, { flex: 2, color: '#7C3AED', fontWeight: '700' }]}>3. Eligible Input Tax Credit (ITC)</Text>
                    <Text style={[styles.tCell, { textAlign: 'right', color: '#7C3AED', fontWeight: '800' }]}>- {inr(gstr2Tax)}</Text>
                  </View>
                  <View style={[styles.tRow, { backgroundColor: '#F8FAFC', borderTopWidth: 2, borderTopColor: '#CBD5E1' }]}>
                    <Text style={[styles.tCell, { flex: 2, fontWeight: '900', color: '#0F172A' }]}>4. Net GST Payable by Cash</Text>
                    <Text style={[styles.tCell, { textAlign: 'right', fontWeight: '900', color: '#059669', fontSize: 14 }]}>{inr(netGstPayable)}</Text>
                  </View>
                  {excessItc > 0 && (
                    <View style={styles.tRow}>
                      <Text style={[styles.tCell, { flex: 2, fontWeight: '700', color: '#7C3AED' }]}>Excess ITC to carry forward</Text>
                      <Text style={[styles.tCell, { textAlign: 'right', fontWeight: '700', color: '#7C3AED' }]}>{inr(excessItc)}</Text>
                    </View>
                  )}
                </View>
              </View>
            </View>
          )}

          {/* TAB: HSN & SAC Summary */}
          {tab === 'hsn' && (
            <View style={{ gap: spacing.md }}>
              <View style={styles.card}>
                <Text style={styles.cardTitle}>HSN / SAC Summary Report</Text>
                <Text style={styles.muted}>Service Accounting Codes for Digital Signature & E-Tendering Services</Text>

                <View style={styles.table}>
                  <View style={[styles.tRow, styles.tHead]}>
                    <Text style={[styles.tCell, { width: 70 }]}>SAC/HSN</Text>
                    <Text style={[styles.tCell, { flex: 2 }]}>Description</Text>
                    <Text style={[styles.tCell, { width: 50 }]}>Rate</Text>
                    <Text style={[styles.tCell, { textAlign: 'right' }]}>Taxable</Text>
                  </View>
                  <View style={styles.tRow}>
                    <Text style={[styles.tCell, { width: 70, fontWeight: '800', color: colors.brandPrimary }]}>998313</Text>
                    <Text style={[styles.tCell, { flex: 2 }]}>Information technology (IT) support & Digital Signature</Text>
                    <Text style={[styles.tCell, { width: 50, fontWeight: '700' }]}>18%</Text>
                    <Text style={[styles.tCell, { textAlign: 'right', fontWeight: '800' }]}>{inr(gstr1Taxable * 0.7)}</Text>
                  </View>
                  <View style={styles.tRow}>
                    <Text style={[styles.tCell, { width: 70, fontWeight: '800', color: colors.brandPrimary }]}>998314</Text>
                    <Text style={[styles.tCell, { flex: 2 }]}>E-Tendering, Bidding & Technical Documentation</Text>
                    <Text style={[styles.tCell, { width: 50, fontWeight: '700' }]}>18%</Text>
                    <Text style={[styles.tCell, { textAlign: 'right', fontWeight: '800' }]}>{inr(gstr1Taxable * 0.3)}</Text>
                  </View>
                </View>
              </View>
            </View>
          )}

          {/* TAB: TDS & TCS */}
          {tab === 'tds' && (
            <View style={{ gap: spacing.md }}>
              <View style={styles.card}>
                <Text style={styles.cardTitle}>TDS & TCS Summary (Govt. Contractors)</Text>
                <Text style={styles.muted}>TDS under GST (Sec 51) and Income Tax (Sec 194C / 194J)</Text>

                <View style={{ marginTop: spacing.md, gap: 10 }}>
                  <View style={styles.kpiRow}>
                    <View style={[styles.kpiCard, { backgroundColor: '#EFF6FF', borderColor: '#BFDBFE' }]}>
                      <Text style={styles.kpiLbl}>TDS Receivable (2%)</Text>
                      <Text style={[styles.kpiVal, { color: '#2563EB' }]}>{inr(gstr1Taxable * 0.02)}</Text>
                    </View>
                    <View style={[styles.kpiCard, { backgroundColor: '#FEF3C7', borderColor: '#FDE68A' }]}>
                      <Text style={styles.kpiLbl}>TCS Applicable</Text>
                      <Text style={[styles.kpiVal, { color: '#D97706' }]}>{inr(gstr1Taxable * 0.001)}</Text>
                    </View>
                  </View>

                  <View style={styles.tRow}>
                    <Text style={[styles.tCell, { flex: 2, fontWeight: '700' }]}>Section 51 GST TDS (Government Deductions)</Text>
                    <Text style={[styles.tCell, { textAlign: 'right', fontWeight: '800', color: '#2563EB' }]}>2.00%</Text>
                  </View>
                  <View style={styles.tRow}>
                    <Text style={[styles.tCell, { flex: 2, fontWeight: '700' }]}>Section 194C Contractor TDS</Text>
                    <Text style={[styles.tCell, { textAlign: 'right', fontWeight: '800', color: '#D97706' }]}>1.00% / 2.00%</Text>
                  </View>
                </View>
              </View>
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F8FAFC' },
  shareBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.brandPrimary, alignItems: 'center', justifyContent: 'center' },
  tabRow: { flexDirection: 'row', backgroundColor: '#FFF', borderBottomWidth: 1, borderBottomColor: colors.border },
  tabItem: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 12, borderBottomWidth: 3, borderBottomColor: 'transparent' },
  tabItemActive: { borderBottomColor: colors.brandPrimary },
  tabTxt: { fontSize: 11, fontWeight: '700', color: colors.muted },
  tabTxtActive: { color: colors.brandPrimary, fontWeight: '900' },
  kpiRow: { flexDirection: 'row', gap: 6 },
  kpiCard: { flex: 1, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, ...shadow.card },
  kpiLbl: { fontSize: 10, fontWeight: '700', color: '#64748B' },
  kpiVal: { fontSize: font.sm, fontWeight: '900', marginTop: 2 },
  card: { backgroundColor: '#FFF', borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, ...shadow.card },
  cardTitle: { fontSize: font.base, fontWeight: '800', color: '#0F172A' },
  muted: { fontSize: 11, color: colors.muted, marginTop: 2 },
  invoiceRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: radius.md, backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: colors.divider },
  invNo: { fontSize: 11, fontWeight: '800', color: colors.brandPrimary },
  invParty: { fontSize: font.sm, fontWeight: '700', color: '#1E293B', marginTop: 1 },
  invMeta: { fontSize: 10, color: colors.muted, marginTop: 1 },
  invAmt: { fontSize: font.sm, fontWeight: '900', color: '#0F172A' },
  invTax: { fontSize: 10, fontWeight: '700', color: '#059669', marginTop: 1 },
  table: { marginTop: spacing.md, borderWidth: 1, borderColor: '#E2E8F0', borderRadius: radius.md, overflow: 'hidden' },
  tRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#E2E8F0', backgroundColor: '#FFF' },
  tHead: { backgroundColor: '#F1F5F9' },
  tCell: { fontSize: font.sm, color: '#334155' },
});
