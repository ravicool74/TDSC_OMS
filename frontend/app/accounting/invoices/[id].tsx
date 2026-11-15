import React, { useCallback, useState, useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert, Pressable, Platform, Linking, Image, Modal, TextInput, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { colors, spacing, radius, font } from '@/src/theme';
import { api } from '@/src/api';
import { ScreenHeader } from '@/src/ScreenHeader';
import { AttachmentsSection, Attachment } from '@/src/AttachmentsSection';
import { useAuth } from '@/src/AuthContext';
import { confirm, notify } from '@/src/dialog';

const inr = (n: any) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export default function InvoiceDetail() {
  const { id, showProfit } = useLocalSearchParams<{ id: string; showProfit?: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const [inv, setInv] = useState<any | null>(null);
  const isAdmin = user?.role === 'admin' || user?.role === 'manager' || user?.role === 'super_admin';
  const canEdit =
    isAdmin ||
    user?.role === 'branch_manager' ||
    user?.role === 'assistant_branch_manager' ||
    user?.role === 'accountant' ||
    user?.role === 'custom_accounts_assistant' ||
    user?.role === 'data_entry_operator' ||
    (!!inv?.created_by && (inv?.created_by === (user as any)?.id || inv?.created_by === user?.user_id));

  // Edit Signatory Modal State
  const [signModalVisible, setSignModalVisible] = useState(false);
  const [editSignatoryName, setEditSignatoryName] = useState('');
  const [updatingSign, setUpdatingSign] = useState(false);

  // Bill-Wise Profit Analysis Modal State
  const [profitModalVisible, setProfitModalVisible] = useState(false);
  const [profitData, setProfitData] = useState<any | null>(null);
  const [loadingProfit, setLoadingProfit] = useState(false);

  const openProfitModal = async () => {
    setProfitModalVisible(true);
    setLoadingProfit(true);
    try {
      const data = await api.getInvoiceProfitAnalysis(id);
      setProfitData(data);
    } catch (e: any) {
      notify('Profit Error', e?.message || 'Failed to load voucher profit');
    } finally {
      setLoadingProfit(false);
    }
  };

  useEffect(() => {
    if (showProfit === 'true' && id) {
      openProfitModal();
    }
  }, [showProfit, id]);

  const quickPassOnAmount = useMemo(() => {
    if (!inv?.items) return 0;
    return inv.items.reduce((acc: number, it: any) => {
      const isPasson =
        it.item_type === 'passed_on_money' ||
        (it.item_type !== 'actual_service' && (
          ['EMD', 'Cost of BOQ', 'Tender Processing Fee', 'Registration Fee', 'Other Fee'].includes(it.fee_type) ||
          ['emd', 'cost of boq', 'pass-on', 'passed on'].some((k: string) => (it.name || '').toLowerCase().includes(k))
        ));
      return isPasson ? acc + Number(it.amount || 0) : acc;
    }, 0);
  }, [inv]);

  const load = useCallback(async () => {
    try {
      const data = await api.get<any>(`/invoices/${id}`);
      setInv(data);
      setEditSignatoryName(data?.signatory_name || 'अंजू कुमारी');
    } catch {}
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onAttachmentsChange = (list: Attachment[]) => setInv((p: any) => p ? { ...p, attachments: list } : p);

  const printPdf = async () => {
    try {
      const url = await api.invoicePdfUrl(inv.id);
      if (Platform.OS === 'web' && typeof window !== 'undefined') window.open(url, '_blank');
      else await Linking.openURL(url);
    } catch (e: any) { notify('Failed', e?.message || 'Unable to open PDF'); }
  };

  const edit = () => router.push({ pathname: '/accounting/invoices/new', params: { edit_id: inv.id, type: inv.invoice_type } } as any);

  const remove = async () => {
    const ok = await confirm('Delete Invoice?', `Delete ${inv.invoice_no}? This cannot be undone.`, { confirmText: 'Delete', destructive: true });
    if (!ok) return;
    try { await api.del(`/invoices/${id}`); router.back(); }
    catch (e: any) { notify('Failed', e?.message || 'Try again'); }
  };

  // Upload custom signature image
  const handleUploadSignature = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ['image/png', 'image/jpeg', 'image/webp'],
        copyToCacheDirectory: true,
      });
      if (res.canceled || !res.assets?.[0]) return;
      const file = res.assets[0];
      setUpdatingSign(true);
      const uploaded = await api.uploadInvoiceSignature({
        uri: file.uri,
        name: file.name || 'signature.png',
        type: file.mimeType || 'image/png',
      });
      // Patch invoice with new signature URL
      const updated = await api.patch(`/invoices/${inv.id}`, {
        ...inv,
        signature_url: uploaded.signature_url,
        include_signature: true,
      });
      setInv(updated);
      notify('Signature Added', 'Voucher signature uploaded successfully.');
    } catch (err: any) {
      notify('Error', err?.message || 'Failed to upload signature.');
    } finally {
      setUpdatingSign(false);
    }
  };

  // Toggle signature inclusion
  const handleToggleSignature = async () => {
    try {
      const nextState = !inv.include_signature;
      const updated = await api.patch(`/invoices/${inv.id}`, {
        ...inv,
        include_signature: nextState,
      });
      setInv(updated);
      notify('Signature Updated', nextState ? 'Signature enabled on voucher' : 'Signature hidden from voucher');
    } catch (err: any) {
      notify('Error', err?.message || 'Failed to update signature preference');
    }
  };

  // Save signatory name
  const handleSaveSignatoryName = async () => {
    if (!editSignatoryName.trim()) {
      notify('Required', 'Please enter signatory name');
      return;
    }
    try {
      setUpdatingSign(true);
      const updated = await api.patch(`/invoices/${inv.id}`, {
        ...inv,
        signatory_name: editSignatoryName.trim(),
      });
      setInv(updated);
      setSignModalVisible(false);
      notify('Success', 'Signatory name updated successfully');
    } catch (err: any) {
      notify('Error', err?.message || 'Failed to update signatory name');
    } finally {
      setUpdatingSign(false);
    }
  };

  if (!inv) return (
    <View style={{ flex: 1, backgroundColor: '#F4F6FB' }}>
      <ScreenHeader title="Invoice Voucher" />
      <View style={{ padding: 24 }}><Text style={{ color: colors.muted }}>Loading…</Text></View>
    </View>
  );

  const signatoryDisplayName = inv.signatory_name || 'अंजू कुमारी';
  const hasCustomSig = !!inv.signature_url;
  const isSigEnabled = inv.include_signature !== false;

  return (
    <View style={{ flex: 1, backgroundColor: '#F4F6FB' }} testID="invoice-detail">
      <ScreenHeader title={inv.invoice_type === 'purchase' ? 'Purchase Bill Voucher' : 'Sale Invoice Voucher'} right={(
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <Pressable onPress={openProfitModal} hitSlop={8} testID="profit-hdr" style={[styles.topIconBtn, { backgroundColor: '#ECFDF5' }]}>
            <Ionicons name="trending-up" size={20} color="#059669" />
          </Pressable>
          <Pressable onPress={printPdf} hitSlop={8} testID="print-hdr" style={styles.topIconBtn}>
            <Ionicons name="print" size={20} color={colors.brandPrimary} />
          </Pressable>
          {canEdit ? (
            <Pressable onPress={edit} hitSlop={8} testID="edit-hdr" style={styles.topIconBtn}>
              <Ionicons name="create-outline" size={20} color="#B45309" />
            </Pressable>
          ) : null}
          {isAdmin ? (
            <Pressable onPress={remove} hitSlop={8} testID="del-hdr" style={styles.topIconBtn}>
              <Ionicons name="trash-outline" size={20} color={colors.error} />
            </Pressable>
          ) : null}
        </View>
      )} />

      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxxl }}>
        
        {/* TDSC Official Company Header Card */}
        <View style={styles.companyHeaderCard}>
          <Image
            source={require('@/assets/images/company-logo.jpg')}
            style={styles.tdscLogo}
            resizeMode="contain"
          />
          <View style={{ flex: 1 }}>
            <Text style={styles.companyName}>TRIVENI DSC AND ETENDER SERVICE PVT. LTD</Text>
            <Text style={styles.companySub}>MOH-BHAISHASUR HOSPITAL MORE, NEAR EYE CARE HOSPITAL, BIHARSHARIF</Text>
            <View style={styles.companyMetaRow}>
              <Text style={styles.companyMetaTxt}><Text style={{ fontWeight: '700' }}>GSTIN:</Text> 10AAGCT3865R1ZU</Text>
              <Text style={styles.companyMetaTxt}><Text style={{ fontWeight: '700' }}>Ph:</Text> 9334344708</Text>
              <Text style={styles.companyMetaTxt}><Text style={{ fontWeight: '700' }}>Email:</Text> tdscservice@gmail.com</Text>
            </View>
          </View>
        </View>

        {/* Voucher & Party Metadata Card */}
        <View style={styles.card}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <View>
              <Text style={styles.voucherLabel}>{inv.invoice_type === 'purchase' ? 'PURCHASE VOUCHER' : 'TAX INVOICE VOUCHER'}</Text>
              <Text style={styles.invNo}>{inv.invoice_no}</Text>
            </View>
            <View style={[styles.badge, inv.status === 'paid' ? { backgroundColor: '#DCFCE7' } : inv.status === 'partial' ? { backgroundColor: '#FEF3C7' } : { backgroundColor: '#FEE2E2' }]}>
              <Text style={[styles.badgeTxt, { color: inv.status === 'paid' ? '#059669' : inv.status === 'partial' ? '#B45309' : '#DC2626' }]}>{String(inv.status).toUpperCase()}</Text>
            </View>
          </View>
          
          <View style={styles.divider} />
          
          <Text style={styles.partyLabel}>BILLED TO:</Text>
          <Text style={styles.party}>{inv.party_name}</Text>
          <Text style={styles.meta}>📱 {inv.party_mobile || '—'} • {inv.party_gst ? `GSTIN: ${inv.party_gst}` : 'Unregistered'}</Text>
          <Text style={styles.meta}>📅 Voucher Date: <Text style={{ fontWeight: '700', color: '#1E293B' }}>{inv.date}</Text> • Payment: <Text style={{ fontWeight: '700', color: '#1E293B' }}>{inv.payment_type?.toUpperCase()}</Text> • Due: <Text style={{ fontWeight: '700', color: '#1E293B' }}>{inv.due_date || '—'}</Text></Text>
          {inv.payment_mode ? <Text style={styles.meta}>💳 Mode of Payment: <Text style={{ fontWeight: '700', color: '#1E293B' }}>{String(inv.payment_mode).replace('_', ' ').toUpperCase()}</Text></Text> : null}
        </View>

        {/* Line Items Table Card */}
        {inv.items?.length ? (
          <View style={styles.card}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <Text style={styles.section}>ITEMIZED PARTICULARS</Text>
              <Text style={styles.itemCountTxt}>{inv.items.length} {inv.items.length === 1 ? 'item' : 'items'}</Text>
            </View>
            {inv.items.map((it: any, i: number) => (
              <View key={i} style={styles.itemRow}>
                <View style={styles.itemIndexBox}>
                  <Text style={styles.itemIndexTxt}>{i + 1}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemName}>{it.name}</Text>
                  <Text style={styles.meta}>
                    {it.qty} {it.unit || 'PCS'} × <Text style={{ fontWeight: '700', color: '#0F172A' }}>₹{it.price}</Text> 
                    {it.tax_rate ? ` • GST ${it.tax_rate}%` : ''} 
                    {it.discount ? ` • Disc ₹${it.discount}` : ''}
                  </Text>
                </View>
                <Text style={styles.itemAmt}>{inr(it.amount)}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {/* Voucher Value Totals Card */}
        <View style={styles.card}>
          <Text style={styles.section}>VOUCHER AMOUNT & TOTALS</Text>
          <Row label="Subtotal Value" value={inr(inv.subtotal)} />
          {inv.total_discount ? <Row label="Total Discount" value={`- ${inr(inv.total_discount)}`} color="#DC2626" /> : null}
          {inv.total_tax ? <Row label="Applicable GST" value={inr(inv.total_tax)} /> : null}
          <View style={styles.divider} />
          <Row label="Total Voucher Value (Net)" value={inr(inv.total_amount)} bold size={16} />
          <Row label="Amount Paid / Received" value={inr(inv.paid_amount)} color="#059669" />
          <Row label="Balance Due" value={inr(inv.balance)} bold color={inv.balance > 0 ? '#DC2626' : '#059669'} size={15} />
        </View>

        {/* Bill-Wise Profit & Margin Banner Card */}
        <View style={styles.profitBannerCard}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
              <View style={styles.profitIconBadge}>
                <Ionicons name="trending-up" size={18} color="#059669" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.profitCardTitle}>BILL-WISE PROFIT & MARGIN</Text>
                <Text style={styles.profitCardSub}>Voucher Profit = Bill Total Amount − Linked Expenses</Text>
              </View>
            </View>
            <Pressable onPress={openProfitModal} style={styles.viewProfitBtn}>
              <Ionicons name="calculator" size={15} color="#FFF" />
              <Text style={styles.viewProfitBtnTxt}>View Total Profit</Text>
            </Pressable>
          </View>

          <View style={styles.profitQuickRow}>
            <View style={styles.profitQuickCol}>
              <Text style={styles.profitQuickLbl}>VOUCHER TOTAL</Text>
              <Text style={styles.profitQuickVal}>{inr(inv.total_amount)}</Text>
            </View>
            <View style={styles.profitQuickDivider} />
            <View style={styles.profitQuickCol}>
              <Text style={styles.profitQuickLbl}>PASSED-ON MONEY</Text>
              <Text style={[styles.profitQuickVal, { color: '#0D9488' }]}>{inr(quickPassOnAmount)}</Text>
            </View>
            <View style={styles.profitQuickDivider} />
            <View style={styles.profitQuickCol}>
              <Text style={styles.profitQuickLbl}>SERVICE REVENUE</Text>
              <Text style={[styles.profitQuickVal, { color: '#2563EB' }]}>
                {inr(Math.max(0, (inv.total_amount || 0) - quickPassOnAmount))}
              </Text>
            </View>
          </View>

          <Pressable onPress={openProfitModal} style={styles.profitFormulaTap}>
            <Ionicons name="sparkles" size={15} color="#059669" />
            <Text style={styles.profitFormulaTapTxt}>
              Check profit calculation logic: (Total Profit × 100) / Total Voucher Amount
            </Text>
            <Ionicons name="chevron-forward" size={14} color="#059669" />
          </Pressable>
        </View>

        {/* Payment Receipts & Link History Card */}
        {((inv.payments && inv.payments.length > 0) || inv.paid_amount > 0) ? (
          <View style={styles.card}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Ionicons name="receipt-outline" size={18} color="#059669" />
                <Text style={styles.section}>PAYMENT RECEIPTS & LINK HISTORY</Text>
              </View>
              <Text style={styles.itemCountTxt}>{(inv.payments?.length || 1)} {(inv.payments?.length || 1) === 1 ? 'receipt' : 'receipts'}</Text>
            </View>

            {(inv.payments && inv.payments.length > 0 ? inv.payments : [
              {
                date: inv.date || 'Initial',
                payment_no: `INITIAL-${inv.invoice_no}`,
                payment_mode: inv.payment_mode || 'cash',
                payment_type: 'Initial Payment',
                amount: inv.paid_amount,
                balance_after: inv.balance,
              }
            ]).map((p: any, idx: number) => (
              <View key={idx} style={styles.itemRow}>
                <View style={[styles.itemIndexBox, { backgroundColor: '#ECFDF5' }]}>
                  <Ionicons name="checkmark-done" size={14} color="#059669" />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={{ fontWeight: '700', color: '#0F172A', fontSize: 13 }}>{p.payment_no || `REC-${idx + 1}`}</Text>
                    <View style={{ backgroundColor: '#F1F5F9', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }}>
                      <Text style={{ fontSize: 10, fontWeight: '700', color: '#475569' }}>{p.date}</Text>
                    </View>
                  </View>
                  <Text style={styles.meta}>
                    Mode: <Text style={{ fontWeight: '700', color: '#1E293B' }}>{String(p.payment_mode || 'cash').toUpperCase()}</Text> • Type: <Text style={{ fontWeight: '600' }}>{p.payment_type || 'Part Payment'}</Text>
                  </Text>
                  {p.remarks ? <Text style={{ fontSize: 11, color: '#64748B', fontStyle: 'italic', marginTop: 2 }}>"{p.remarks}"</Text> : null}
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={[styles.itemAmt, { fontSize: 14 }]}>+ {inr(p.amount)}</Text>
                  <Text style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>Bal: <Text style={{ fontWeight: '700', color: (p.balance_after || 0) > 0 ? '#DC2626' : '#059669' }}>{inr(p.balance_after)}</Text></Text>
                </View>
              </View>
            ))}
          </View>
        ) : null}

        {/* Authorized Signatory Card (User Request: Voucher me Sign Add karne ka option) */}
        <View style={styles.card}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Ionicons name="ribbon-outline" size={18} color="#2563EB" />
              <Text style={styles.section}>AUTHORIZED SIGNATORY & STAMP</Text>
            </View>
            {isAdmin && (
              <Pressable onPress={handleToggleSignature} hitSlop={6} style={[styles.togglePill, isSigEnabled ? styles.togglePillActive : styles.togglePillInactive]}>
                <Ionicons name={isSigEnabled ? 'checkmark-circle' : 'close-circle'} size={14} color={isSigEnabled ? '#059669' : '#64748B'} />
                <Text style={[styles.togglePillTxt, { color: isSigEnabled ? '#059669' : '#64748B' }]}>{isSigEnabled ? 'Signature On' : 'Signature Off'}</Text>
              </Pressable>
            )}
          </View>

          <View style={styles.signatoryContainer}>
            <View style={styles.signatoryStampBox}>
              {isSigEnabled ? (
                hasCustomSig ? (
                  <View style={{ alignItems: 'center' }}>
                    <Image
                      source={{ uri: `${api.base}${inv.signature_url}` }}
                      style={styles.signatureImagePreview}
                      resizeMode="contain"
                    />
                    <Text style={styles.stampBadge}>✔ OFFICIAL SIGNATURE</Text>
                  </View>
                ) : (
                  <View style={styles.digitalStampBox}>
                    <Ionicons name="shield-checkmark" size={24} color="#059669" />
                    <Text style={styles.digitalStampTitle}>✔ DIGITALLY VERIFIED SIGNATORY</Text>
                    <Text style={styles.digitalStampSub}>Secured by TDSC Verification System</Text>
                  </View>
                )
              ) : (
                <View style={styles.digitalStampDisabled}>
                  <Ionicons name="eye-off-outline" size={20} color="#94A3B8" />
                  <Text style={{ color: '#94A3B8', fontSize: 12 }}>Signature display disabled for this voucher</Text>
                </View>
              )}

              <View style={styles.signatoryInfo}>
                <Text style={styles.signatoryName}>{signatoryDisplayName}</Text>
                <Text style={styles.signatoryRole}>Authorized Signatory</Text>
                <Text style={styles.signatoryCompany}>For TRIVENI DSC AND ETENDER SERVICE PVT. LTD</Text>
              </View>
            </View>

            {isAdmin && (
              <View style={styles.signActionsRow}>
                <Pressable onPress={handleUploadSignature} disabled={updatingSign} style={styles.signBtnPrimary}>
                  {updatingSign ? <ActivityIndicator size="small" color="#FFF" /> : <Ionicons name="cloud-upload-outline" size={16} color="#FFF" />}
                  <Text style={styles.signBtnPrimaryTxt}>{hasCustomSig ? 'Change Signature' : 'Upload Sign Image'}</Text>
                </Pressable>

                <Pressable onPress={() => setSignModalVisible(true)} style={styles.signBtnSecondary}>
                  <Ionicons name="pencil-outline" size={16} color="#0F172A" />
                  <Text style={styles.signBtnSecondaryTxt}>Edit Signatory Name</Text>
                </Pressable>
              </View>
            )}
          </View>
        </View>

        {/* Voucher Attachments Section */}
        <AttachmentsSection attachments={inv.attachments || []} onChange={onAttachmentsChange} voucherKind="invoices" oid={inv.id} title="Voucher Attachments" />

        {/* Notes & Terms */}
        {inv.notes ? (
          <View style={styles.card}>
            <Text style={styles.section}>VOUCHER REMARKS / NOTES</Text>
            <Text style={{ color: '#1E293B', fontSize: 13, lineHeight: 18 }}>{inv.notes}</Text>
          </View>
        ) : null}

        {/* Action Buttons Footer */}
        <View style={styles.actionFooter}>
          <Pressable onPress={printPdf} style={styles.footerPrintBtn}>
            <Ionicons name="print" size={18} color="#FFF" />
            <Text style={styles.footerPrintTxt}>Print Official Invoice Voucher (PDF)</Text>
          </Pressable>
        </View>

      </ScrollView>

      {/* Modal: Edit Signatory Name */}
      <Modal visible={signModalVisible} transparent animationType="fade" onRequestClose={() => setSignModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Ionicons name="ribbon-outline" size={22} color="#2563EB" />
              <Text style={styles.modalTitle}>Edit Authorized Signatory</Text>
            </View>
            <Text style={styles.modalSub}>Enter the name of the authorized person who signs this voucher.</Text>
            
            <TextInput
              value={editSignatoryName}
              onChangeText={setEditSignatoryName}
              placeholder="e.g. अंजू कुमारी"
              placeholderTextColor="#94A3B8"
              style={styles.modalInput}
            />

            <View style={styles.modalButtons}>
              <Pressable onPress={() => setSignModalVisible(false)} style={styles.modalCancelBtn}>
                <Text style={styles.modalCancelTxt}>Cancel</Text>
              </Pressable>
              <Pressable onPress={handleSaveSignatoryName} disabled={updatingSign} style={styles.modalSaveBtn}>
                {updatingSign ? <ActivityIndicator size="small" color="#FFF" /> : <Text style={styles.modalSaveTxt}>Save Signatory</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal: Bill-Wise Profit & Margin Analysis */}
      <Modal visible={profitModalVisible} transparent animationType="slide" onRequestClose={() => setProfitModalVisible(false)}>
        <View style={styles.profitModalOverlay}>
          <View style={styles.profitModalCard}>
            <View style={styles.profitModalHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={[styles.profitIconBadge, { width: 36, height: 36 }]}>
                  <Ionicons name="trending-up" size={20} color="#059669" />
                </View>
                <View>
                  <Text style={styles.profitModalTitle}>Voucher Total Profit & Margin</Text>
                  <Text style={styles.profitModalSub}>
                    {profitData?.invoice_no || inv.invoice_no} • {profitData?.party_name || inv.party_name}
                  </Text>
                </View>
              </View>
              <Pressable onPress={() => setProfitModalVisible(false)} hitSlop={10} style={styles.closeBtn}>
                <Ionicons name="close" size={22} color="#64748B" />
              </Pressable>
            </View>

            {loadingProfit ? (
              <View style={{ padding: 40, alignItems: 'center', gap: 12 }}>
                <ActivityIndicator size="large" color="#059669" />
                <Text style={{ color: '#64748B', fontSize: 13, fontWeight: '600' }}>Calculating voucher profit & margin…</Text>
              </View>
            ) : profitData ? (
              <ScrollView style={{ maxHeight: 520 }} contentContainerStyle={{ gap: 14, paddingBottom: 10 }}>
                
                {/* User Justified Formula Banner */}
                <View style={styles.formulaBannerBox}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <Ionicons name="information-circle" size={16} color="#047857" />
                    <Text style={styles.formulaBannerTitle}>JUSTIFIED PROFIT CALCULATION LOGIC</Text>
                  </View>
                  <Text style={styles.formulaLine}>• <Text style={{ fontWeight: '700' }}>Voucher Total Profit</Text> = Voucher Total Amount − Linked Total Expenses</Text>
                  <Text style={styles.formulaLine}>• <Text style={{ fontWeight: '700' }}>Percent of Profit (%)</Text> = (Total Profit × 100) / Total Voucher Amount</Text>
                </View>

                {/* Hero Profit Summary Box */}
                <View style={[styles.heroProfitBox, profitData.total_profit >= 0 ? styles.heroProfitPositive : styles.heroProfitNegative]}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.heroProfitLbl}>VOUCHER TOTAL PROFIT</Text>
                    <Text style={[styles.heroProfitVal, { color: profitData.total_profit >= 0 ? '#059669' : '#DC2626' }]}>
                      {inr(profitData.total_profit)}
                    </Text>
                    <Text style={styles.heroProfitEquation}>
                      {inr(profitData.total_amount)} (Bill) − {inr(profitData.total_expense)} (Expense)
                    </Text>
                  </View>
                  <View style={styles.heroMarginBadgeBox}>
                    <Text style={styles.heroMarginBadgeLbl}>PERCENT OF PROFIT</Text>
                    <Text style={styles.heroMarginBadgeVal}>{profitData.profit_percent}%</Text>
                    <Text style={styles.heroMarginBadgeSub}>
                      on {inr(profitData.total_amount)} total bill
                    </Text>
                  </View>
                </View>

                {/* Financial Breakdown Table */}
                <View style={styles.profitBreakdownBox}>
                  <Text style={styles.profitSubHeader}>FINANCIAL BREAKDOWN</Text>
                  <Row label="1. Total Voucher Amount (Gross)" value={inr(profitData.total_amount)} bold />
                  <Row label="2. Pass-On Money (0% Margin Reimbursement)" value={`- ${inr(profitData.passon_money)}`} color="#0D9488" />
                  <Row label="3. Voucher Amount (Excluding Pass-On)" value={inr(profitData.voucher_amount_ex_passon)} bold color="#2563EB" />
                  <Row label="4. Total Linked Expenses" value={`- ${inr(profitData.total_expense)}`} color="#DC2626" bold />
                  <View style={styles.divider} />
                  <Row label="VOUCHER NET PROFIT" value={inr(profitData.total_profit)} bold color={profitData.total_profit >= 0 ? '#059669' : '#DC2626'} size={16} />
                  <Row label="PROFIT MARGIN %" value={`${profitData.profit_percent}%`} bold color="#059669" size={15} />
                </View>

                {/* Line Items Classification */}
                <View style={styles.profitBreakdownBox}>
                  <Text style={styles.profitSubHeader}>VOUCHER ITEMS BREAKDOWN</Text>
                  {profitData.items?.map((it: any, idx: number) => (
                    <View key={idx} style={styles.profitItemRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.profitItemName}>{it.name}</Text>
                        <Text style={styles.profitItemSub}>
                          {it.qty} {it.unit || 'unit'} • Rate: ₹{it.price} • GST {it.tax_rate}%
                        </Text>
                      </View>
                      <View style={{ alignItems: 'flex-end', gap: 2 }}>
                        <Text style={styles.profitItemAmt}>{inr(it.amount)}</Text>
                        <View style={[styles.typeBadge, it.is_passon ? styles.typeBadgePasson : styles.typeBadgeService]}>
                          <Text style={[styles.typeBadgeTxt, it.is_passon ? styles.typeBadgeTxtPasson : styles.typeBadgeTxtService]}>
                            {it.is_passon ? 'Pass-On (0%)' : 'Service Item'}
                          </Text>
                        </View>
                      </View>
                    </View>
                  ))}
                </View>

                {/* Linked Expenses Breakdown */}
                <View style={styles.profitBreakdownBox}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={styles.profitSubHeader}>LINKED DIRECT EXPENSES ({profitData.expenses?.length || 0})</Text>
                    <Pressable
                      onPress={() => {
                        setProfitModalVisible(false);
                        router.push({
                          pathname: '/accounting/expenses/new',
                          params: {
                            sale_invoice_id: inv.id,
                            sale_invoice_no: inv.invoice_no,
                            customer_id: inv.party_id || '',
                            customer_name: inv.party_name || '',
                          },
                        } as any);
                      }}
                      style={styles.addExpLinkBtn}
                    >
                      <Ionicons name="add-circle-outline" size={14} color="#2563EB" />
                      <Text style={styles.addExpLinkTxt}>+ Add Expense</Text>
                    </Pressable>
                  </View>

                  {profitData.expenses && profitData.expenses.length > 0 ? (
                    profitData.expenses.map((exp: any, idx: number) => (
                      <View key={idx} style={styles.profitExpenseRow}>
                        <View style={{ flex: 1 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <Text style={styles.expenseCatTxt}>{exp.category || 'Expense'}</Text>
                            <Text style={styles.expenseNoTxt}>#{exp.expense_no || exp.id?.slice(0, 8)}</Text>
                          </View>
                          <Text style={styles.expenseDescTxt}>{exp.description || exp.paid_to || 'Direct expense'}</Text>
                          <Text style={styles.expenseDateTxt}>📅 {exp.date} • Mode: {String(exp.payment_mode || 'cash').toUpperCase()}</Text>
                        </View>
                        <Text style={styles.expenseAmtTxt}>- {inr(exp.amount)}</Text>
                      </View>
                    ))
                  ) : (
                    <View style={styles.emptyExpenseBox}>
                      <Ionicons name="receipt-outline" size={24} color="#94A3B8" />
                      <Text style={styles.emptyExpenseTxt}>No expenses linked to this voucher yet.</Text>
                      <Text style={styles.emptyExpenseSub}>When you record expenses (e.g. EMD paid, portal fees, filing charges) for this voucher, they will subtract here to give the true net profit.</Text>
                    </View>
                  )}
                </View>

              </ScrollView>
            ) : null}

            {/* Modal Bottom Actions */}
            <View style={styles.profitModalActions}>
              <Pressable
                onPress={() => {
                  setProfitModalVisible(false);
                  router.push('/accounting/reports?code=bill_profit' as any);
                }}
                style={styles.reportNavBtn}
              >
                <Ionicons name="bar-chart-outline" size={16} color="#00104A" />
                <Text style={styles.reportNavBtnTxt}>Bill-Wise Profit Report</Text>
              </Pressable>

              <Pressable onPress={() => setProfitModalVisible(false)} style={styles.profitCloseBtn}>
                <Text style={styles.profitCloseBtnTxt}>Close</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

    </View>
  );
}

const Row: React.FC<{ label: string; value: string; bold?: boolean; color?: string; size?: number }> = ({ label, value, bold, color, size }) => (
  <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 }}>
    <Text style={{ color: colors.muted, fontSize: font.sm }}>{label}</Text>
    <Text style={{ color: color || '#111827', fontWeight: bold ? '800' : '600', fontSize: size || font.base }}>{value}</Text>
  </View>
);

const styles = StyleSheet.create({
  card: { backgroundColor: '#FFF', borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: 8 },
  companyHeaderCard: { backgroundColor: '#FFF', borderRadius: radius.md, borderWidth: 1, borderColor: '#CBD5E1', padding: spacing.md, flexDirection: 'row', alignItems: 'center', gap: 14 },
  tdscLogo: { width: 64, height: 64, borderRadius: 8 },
  companyName: { fontSize: 13, fontWeight: '900', color: '#00104A', letterSpacing: 0.3 },
  companySub: { fontSize: 10, color: '#475569', marginTop: 2, lineHeight: 14 },
  companyMetaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  companyMetaTxt: { fontSize: 10, color: '#334155' },
  voucherLabel: { fontSize: 10, fontWeight: '800', color: '#64748B', letterSpacing: 1 },
  invNo: { fontSize: font.xl, fontWeight: '900', color: '#111827' },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill },
  badgeTxt: { fontSize: 10, fontWeight: '900', letterSpacing: 0.5 },
  partyLabel: { fontSize: 10, fontWeight: '800', color: '#64748B', letterSpacing: 0.8 },
  party: { fontSize: font.lg, fontWeight: '700', color: '#111827', marginTop: 2 },
  meta: { color: colors.muted, fontSize: font.sm, marginTop: 2 },
  section: { fontSize: 11, fontWeight: '900', color: '#374151', letterSpacing: 1 },
  itemCountTxt: { fontSize: 11, color: '#64748B', fontWeight: '600' },
  itemRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#F3F4F6', gap: 10 },
  itemIndexBox: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#F1F5F9', alignItems: 'center', justifyContent: 'center' },
  itemIndexTxt: { fontSize: 11, fontWeight: '800', color: '#475569' },
  itemName: { color: '#111827', fontWeight: '700', fontSize: font.base },
  itemAmt: { color: '#059669', fontWeight: '800', fontSize: font.base },
  divider: { height: 1, backgroundColor: '#F3F4F6', marginVertical: 4 },
  topIconBtn: { padding: 6, borderRadius: radius.sm, backgroundColor: '#EFF6FF' },

  // Profit Banner & Modal Styles
  profitBannerCard: {
    backgroundColor: '#F0FDF4',
    borderWidth: 1.5,
    borderColor: '#86EFAC',
    borderRadius: radius.md,
    padding: spacing.md,
    gap: 12,
  },
  profitIconBadge: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#DCFCE7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  profitCardTitle: {
    fontSize: 12,
    fontWeight: '900',
    color: '#065F46',
    letterSpacing: 0.5,
  },
  profitCardSub: {
    fontSize: 10,
    color: '#047857',
    marginTop: 1,
  },
  viewProfitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#059669',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.sm,
  },
  viewProfitBtnTxt: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '800',
  },
  profitQuickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF',
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: '#D1FAE5',
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  profitQuickCol: {
    flex: 1,
    alignItems: 'center',
  },
  profitQuickDivider: {
    width: 1,
    height: 24,
    backgroundColor: '#E2E8F0',
  },
  profitQuickLbl: {
    fontSize: 9,
    fontWeight: '800',
    color: '#64748B',
    marginBottom: 2,
  },
  profitQuickVal: {
    fontSize: 13,
    fontWeight: '900',
    color: '#0F172A',
  },
  profitFormulaTap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  profitFormulaTapTxt: {
    flex: 1,
    fontSize: 10.5,
    fontWeight: '700',
    color: '#065F46',
  },

  // Modal styles
  profitModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  profitModalCard: {
    width: '100%',
    maxWidth: 560,
    backgroundColor: '#FFF',
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: 12,
    maxHeight: '90%',
  },
  profitModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    paddingBottom: 10,
  },
  profitModalTitle: {
    fontSize: 16,
    fontWeight: '900',
    color: '#0F172A',
  },
  profitModalSub: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  closeBtn: {
    padding: 4,
    borderRadius: 6,
    backgroundColor: '#F8FAFC',
  },
  formulaBannerBox: {
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    borderRadius: radius.md,
    padding: 10,
  },
  formulaBannerTitle: {
    fontSize: 11,
    fontWeight: '900',
    color: '#065F46',
    letterSpacing: 0.5,
  },
  formulaLine: {
    fontSize: 11,
    color: '#047857',
    lineHeight: 16,
  },
  formulaNote: {
    fontSize: 10,
    color: '#059669',
    marginTop: 4,
    fontStyle: 'italic',
  },
  heroProfitBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.md,
    borderWidth: 1.5,
    padding: 14,
    gap: 12,
  },
  heroProfitPositive: {
    backgroundColor: '#F0FDF4',
    borderColor: '#86EFAC',
  },
  heroProfitNegative: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
  },
  heroProfitLbl: {
    fontSize: 10,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 0.8,
  },
  heroProfitVal: {
    fontSize: 22,
    fontWeight: '900',
    marginTop: 2,
  },
  heroProfitEquation: {
    fontSize: 10,
    color: '#475569',
    marginTop: 2,
  },
  heroMarginBadgeBox: {
    backgroundColor: '#059669',
    borderRadius: radius.md,
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  heroMarginBadgeLbl: {
    fontSize: 9,
    fontWeight: '800',
    color: '#D1FAE5',
    letterSpacing: 0.5,
  },
  heroMarginBadgeVal: {
    fontSize: 20,
    fontWeight: '900',
    color: '#FFF',
    marginVertical: 2,
  },
  heroMarginBadgeSub: {
    fontSize: 8.5,
    color: '#A7F3D0',
    fontWeight: '600',
  },
  profitBreakdownBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 12,
    gap: 6,
  },
  profitSubHeader: {
    fontSize: 10.5,
    fontWeight: '900',
    color: '#475569',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  profitItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  profitItemName: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0F172A',
  },
  profitItemSub: {
    fontSize: 10,
    color: '#64748B',
  },
  profitItemAmt: {
    fontSize: 12,
    fontWeight: '800',
    color: '#0F172A',
  },
  typeBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 4,
  },
  typeBadgePasson: {
    backgroundColor: '#CCFBF1',
  },
  typeBadgeService: {
    backgroundColor: '#DBEAFE',
  },
  typeBadgeTxt: {
    fontSize: 9,
    fontWeight: '800',
  },
  typeBadgeTxtPasson: {
    color: '#0F766E',
  },
  typeBadgeTxtService: {
    color: '#1E40AF',
  },
  addExpLinkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    backgroundColor: '#EFF6FF',
  },
  addExpLinkTxt: {
    fontSize: 11,
    fontWeight: '700',
    color: '#2563EB',
  },
  profitExpenseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  expenseCatTxt: {
    fontSize: 11.5,
    fontWeight: '800',
    color: '#0F172A',
  },
  expenseNoTxt: {
    fontSize: 10,
    color: '#64748B',
    fontWeight: '600',
  },
  expenseDescTxt: {
    fontSize: 10.5,
    color: '#475569',
  },
  expenseDateTxt: {
    fontSize: 9.5,
    color: '#94A3B8',
  },
  expenseAmtTxt: {
    fontSize: 12,
    fontWeight: '800',
    color: '#DC2626',
  },
  emptyExpenseBox: {
    alignItems: 'center',
    paddingVertical: 14,
    gap: 4,
  },
  emptyExpenseTxt: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748B',
  },
  emptyExpenseSub: {
    fontSize: 9.5,
    color: '#94A3B8',
    textAlign: 'center',
    lineHeight: 14,
    paddingHorizontal: 12,
  },
  profitModalActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingTop: 10,
    marginTop: 4,
  },
  reportNavBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.sm,
  },
  reportNavBtnTxt: {
    fontSize: 12,
    fontWeight: '700',
    color: '#00104A',
  },
  profitCloseBtn: {
    backgroundColor: '#0F172A',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: radius.sm,
  },
  profitCloseBtnTxt: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '800',
  },

  // Signatory styles
  signatoryContainer: { marginTop: 6, gap: 10 },
  signatoryStampBox: { backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: radius.md, padding: spacing.md, alignItems: 'center' },
  signatureImagePreview: { width: 140, height: 50, marginBottom: 4 },
  stampBadge: { fontSize: 9, fontWeight: '800', color: '#059669', letterSpacing: 0.5 },
  digitalStampBox: { backgroundColor: '#ECFDF5', borderWidth: 1, borderColor: '#A7F3D0', borderRadius: 8, paddingHorizontal: 16, paddingVertical: 10, alignItems: 'center', marginBottom: 8 },
  digitalStampTitle: { fontSize: 11, fontWeight: '900', color: '#059669', marginTop: 2 },
  digitalStampSub: { fontSize: 9, color: '#065F46', marginTop: 1 },
  digitalStampDisabled: { padding: 12, alignItems: 'center', gap: 4 },
  signatoryInfo: { alignItems: 'center', marginTop: 4 },
  signatoryName: { fontSize: 14, fontWeight: '900', color: '#0F172A' },
  signatoryRole: { fontSize: 11, fontWeight: '700', color: '#475569', marginTop: 1 },
  signatoryCompany: { fontSize: 10, color: '#64748B', marginTop: 1 },
  signActionsRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  signBtnPrimary: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#2563EB', paddingVertical: 9, borderRadius: radius.sm },
  signBtnPrimaryTxt: { color: '#FFF', fontSize: 12, fontWeight: '700' },
  signBtnSecondary: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#F1F5F9', borderWidth: 1, borderColor: '#CBD5E1', paddingVertical: 9, borderRadius: radius.sm },
  signBtnSecondaryTxt: { color: '#0F172A', fontSize: 12, fontWeight: '700' },
  togglePill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12, borderWidth: 1 },
  togglePillActive: { backgroundColor: '#ECFDF5', borderColor: '#A7F3D0' },
  togglePillInactive: { backgroundColor: '#F1F5F9', borderColor: '#CBD5E1' },
  togglePillTxt: { fontSize: 10, fontWeight: '700' },

  // Footer Print
  actionFooter: { marginTop: 4 },
  footerPrintBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#00104A', paddingVertical: 14, borderRadius: radius.md },
  footerPrintTxt: { color: '#FFF', fontSize: 14, fontWeight: '800' },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalCard: { width: '100%', maxWidth: 400, backgroundColor: '#FFF', borderRadius: radius.lg, padding: spacing.lg, gap: 12 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  modalTitle: { fontSize: 16, fontWeight: '800', color: '#0F172A' },
  modalSub: { fontSize: 12, color: '#64748B' },
  modalInput: { borderWidth: 1, borderColor: '#CBD5E1', borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: '#0F172A' },
  modalButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 6 },
  modalCancelBtn: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: radius.sm },
  modalCancelTxt: { color: '#64748B', fontWeight: '700', fontSize: 13 },
  modalSaveBtn: { backgroundColor: '#2563EB', paddingVertical: 8, paddingHorizontal: 16, borderRadius: radius.sm },
  modalSaveTxt: { color: '#FFF', fontWeight: '700', fontSize: 13 },
});
