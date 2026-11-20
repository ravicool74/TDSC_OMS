import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Alert,
  Pressable,
  Platform,
  Linking,
  Image,
  Modal,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
} from 'react-native';
import { useLocalSearchParams, useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, font, shadow } from '@/src/theme';
import { api } from '@/src/api';
import { ScreenHeader } from '@/src/ScreenHeader';
import { AttachmentsSection, Attachment } from '@/src/AttachmentsSection';
import { useAuth } from '@/src/AuthContext';
import { notify } from '@/src/dialog';

const inr = (n: any) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const PAYMENT_MODES = ['cash', 'bank', 'upi', 'cheque'];
const SERVICE_CATEGORIES = [
  'DSC Services',
  'Tender Services',
  'Income Tax Services',
  'GST Services',
  'Passed On Money',
  'Registration Services',
  'Accounting Services',
  'Other Services',
];

export default function IncomeDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const [inc, setInc] = useState<any | null>(null);
  const [banks, setBanks] = useState<any[]>([]);
  const [printing, setPrinting] = useState(false);

  // Edit Modal State
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editForm, setEditForm] = useState<{
    amount: string;
    date: string;
    payment_mode: string;
    bank_account_id: string;
    service_category: string;
    service_name: string;
    client_name: string;
    client_mobile: string;
    client_pan: string;
    client_gst: string;
    employee_name: string;
    remarks: string;
  }>({
    amount: '',
    date: '',
    payment_mode: 'cash',
    bank_account_id: '',
    service_category: 'Other Services',
    service_name: '',
    client_name: '',
    client_mobile: '',
    client_pan: '',
    client_gst: '',
    employee_name: '',
    remarks: '',
  });
  const [saving, setSaving] = useState(false);

  // New Bank Modal State
  const [showAddBankModal, setShowAddBankModal] = useState(false);
  const [newBankForm, setNewBankForm] = useState({
    name: '',
    bank_name: '',
    account_no: '',
    ifsc: '',
    opening_balance: '0',
  });
  const [savingNewBank, setSavingNewBank] = useState(false);
  const [bankSaveErr, setBankSaveErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [incRes, bankRes] = await Promise.all([
        api.get<any>(`/income/${id}`),
        api.get<any[]>('/bank-accounts').catch(() => []),
      ]);
      setInc(incRes);
      setBanks(bankRes || []);
    } catch {}
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const getBankShortLabel = (b: any) => {
    if (!b) return 'Bank Account';
    const acc = String(b.account_no || '');
    const bankName = (b.bank_name || '').toUpperCase();
    const name = (b.name || '').toUpperCase();
    const ifsc = (b.ifsc || '').toUpperCase();

    if (acc.includes('42137607814') || ifsc.startsWith('SBIN') || bankName.includes('STATE') || name.includes('STATE') || name.includes('TRIVENI')) {
      return `SBI (${b.account_no || '42137607814'})`;
    }
    if (acc.includes('915020011528516') || ifsc.startsWith('UTIB') || bankName.includes('AXIS') || name.includes('AXIS') || name.includes('ANJU')) {
      return `Axis Bank (${b.account_no || '915020011528516'})`;
    }
    return `${b.bank_name || b.name} (${b.account_no})`;
  };

  const getIncomeBankBadge = (item: any) => {
    if (!item) return { isSplit: false, mode: 'cash', label: 'CASH', bankId: null };
    const mode = String(item.payment_mode || 'cash').toLowerCase();

    // Check if multi-mode splits exist
    if (item.payment_splits && Array.isArray(item.payment_splits)) {
      const activeSplits = item.payment_splits.filter((ps: any) => Number(ps.amount || 0) > 0);
      if (activeSplits.length > 1) {
        return {
          isSplit: true,
          splits: activeSplits,
          label: 'Split Payment',
          mode: 'split',
          bankId: null,
        };
      }
    }

    if (mode === 'cash') {
      return { isSplit: false, mode: 'cash', label: 'CASH', bankId: null };
    }

    const bId = item.bank_id || item.bank_account_id;
    if (bId) {
      const match = banks.find(b => b.id === bId);
      if (match) return { isSplit: false, mode: 'bank', bankId: match.id, label: getBankShortLabel(match) };
    }

    const acc = String(item.account_no || '');
    const bName = String(item.bank_name || '').toUpperCase();
    if (acc.includes('42137607814') || bName.includes('STATE') || bName.includes('TRIVENI') || bName.includes('SBI')) {
      const sbi = banks.find(b => String(b.account_no || '').includes('42137607814'));
      return { isSplit: false, mode: 'bank', bankId: sbi?.id || 'bnk_sbi_01', label: `SBI (${acc || '42137607814'})` };
    }
    if (acc.includes('915020011528516') || bName.includes('AXIS') || bName.includes('ANJU')) {
      const axis = banks.find(b => String(b.account_no || '').includes('915020011528516'));
      return { isSplit: false, mode: 'bank', bankId: axis?.id || 'bnk_hdfc_02', label: `Axis Bank (${acc || '915020011528516'})` };
    }

    const sbi = banks.find(b => String(b.account_no || '').includes('42137607814'));
    if (sbi) return { isSplit: false, mode: 'bank', bankId: sbi.id, label: getBankShortLabel(sbi) };
    return { isSplit: false, mode: 'bank', bankId: banks[0]?.id || '', label: banks[0] ? getBankShortLabel(banks[0]) : 'SBI (42137607814)' };
  };

  const handleSaveNewBank = async () => {
    if (!newBankForm.name.trim() || !newBankForm.bank_name.trim() || !newBankForm.account_no.trim()) {
      setBankSaveErr('Account Nickname, Bank Name, and Account Number are required.');
      return;
    }
    setSavingNewBank(true);
    setBankSaveErr(null);
    try {
      const created = await api.post<any>('/bank-accounts', {
        name: newBankForm.name.trim(),
        bank_name: newBankForm.bank_name.trim(),
        account_no: newBankForm.account_no.trim(),
        ifsc: newBankForm.ifsc.trim() || undefined,
        opening_balance: parseFloat(newBankForm.opening_balance) || 0,
      });
      setShowAddBankModal(false);
      setNewBankForm({ name: '', bank_name: '', account_no: '', ifsc: '', opening_balance: '0' });
      const bRes = await api.get<any[]>('/bank-accounts').catch(() => []);
      setBanks(bRes || []);
      setEditForm(p => ({ ...p, bank_account_id: created.id }));
      notify('Bank Added', `${created.name} (${created.bank_name}) was successfully added.`);
    } catch (e: any) {
      setBankSaveErr(e?.message || 'Failed to save bank account');
    } finally {
      setSavingNewBank(false);
    }
  };

  const onAttachmentsChange = (list: Attachment[]) => setInc((p: any) => p ? { ...p, attachments: list } : p);

  const printPdf = async () => {
    try {
      setPrinting(true);
      const url = await api.incomePdfUrl(inc.id);
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.open(url, '_blank');
      } else {
        await Linking.openURL(url);
      }
    } catch (e: any) {
      notify('Print Failed', e?.message || 'Unable to open PDF');
    } finally {
      setPrinting(false);
    }
  };

  const openEdit = () => {
    if (!inc) return;
    const sbi = banks.find(b => String(b.account_no || '').includes('42137607814'));
    const defaultBankId = inc.bank_id || inc.bank_account_id || sbi?.id || banks[0]?.id || '';
    setEditForm({
      amount: String(inc.amount || ''),
      date: inc.date || new Date().toISOString().slice(0, 10),
      payment_mode: inc.payment_mode || 'cash',
      bank_account_id: defaultBankId,
      service_category: inc.service_category || 'Other Services',
      service_name: inc.service_name || '',
      client_name: inc.client_name || '',
      client_mobile: inc.client_mobile || '',
      client_pan: inc.client_pan || '',
      client_gst: inc.client_gst || '',
      employee_name: inc.employee_name || '',
      remarks: inc.remarks || '',
    });
    setEditModalVisible(true);
  };

  const saveEdit = async () => {
    const numAmt = parseFloat(editForm.amount);
    if (isNaN(numAmt) || numAmt <= 0) {
      notify('Invalid Amount', 'Please enter a valid payment amount greater than 0.');
      return;
    }
    if (!editForm.client_name.trim()) {
      notify('Client Name Required', 'Please enter customer / client name.');
      return;
    }
    if (!editForm.date.trim()) {
      notify('Date Required', 'Please enter a valid voucher date.');
      return;
    }

    const chosenBank = banks.find(b => b.id === editForm.bank_account_id) || banks[0];

    try {
      setSaving(true);
      await api.patch(`/income/${id}`, {
        amount: numAmt,
        date: editForm.date.trim(),
        payment_mode: editForm.payment_mode,
        bank_account_id: editForm.payment_mode !== 'cash' ? (chosenBank?.id || null) : null,
        service_category: editForm.service_category.trim() || 'Other Services',
        service_name: editForm.service_name.trim() || null,
        client_name: editForm.client_name.trim(),
        client_mobile: editForm.client_mobile.trim() || null,
        client_pan: editForm.client_pan.trim() || null,
        client_gst: editForm.client_gst.trim() || null,
        employee_name: editForm.employee_name.trim() || null,
        remarks: editForm.remarks.trim() || null,
      });

      notify('Saved', `Payment-In voucher ${inc.voucher_no || inc.income_no} updated successfully!`);
      setEditModalVisible(false);
      await load();
    } catch (e: any) {
      notify('Update Failed', e?.message || 'Failed to save changes');
    } finally {
      setSaving(false);
    }
  };

  const remove = () => Alert.alert('Delete Payment-In Voucher?', `Delete ${inc.voucher_no || inc.income_no}? This cannot be undone.`, [
    { text: 'Cancel', style: 'cancel' },
    {
      text: 'Delete',
      style: 'destructive',
      onPress: async () => {
        try {
          await api.del(`/income/${id}`);
          router.back();
        } catch (e: any) {
          Alert.alert('Failed', e?.message || 'Try again');
        }
      }
    },
  ]);

  if (!inc) {
    return (
      <View style={{ flex: 1, backgroundColor: '#F4F6FB' }}>
        <ScreenHeader title="Payment-In Voucher" />
        <View style={{ padding: 24, alignItems: 'center' }}>
          <Text style={{ color: colors.muted }}>Loading voucher details…</Text>
        </View>
      </View>
    );
  }

  const canDelete = user?.role === 'admin' || user?.role === 'manager';
  const vNo = inc.voucher_no || inc.income_no || 'PAYIN-0001';
  const badge = getIncomeBankBadge(inc);

  return (
    <View style={{ flex: 1, backgroundColor: '#F4F6FB' }} testID="income-detail">
      <ScreenHeader
        title="Payment-In Voucher"
        right={
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            {/* Print Header Button */}
            <Pressable onPress={printPdf} hitSlop={8} style={styles.topActionBtn} testID="detail-print-btn">
              <Ionicons name="print-outline" size={20} color="#047857" />
            </Pressable>

            {/* Edit Header Button */}
            <Pressable onPress={openEdit} hitSlop={8} style={styles.topActionBtn} testID="detail-edit-btn">
              <Ionicons name="create-outline" size={20} color="#4338CA" />
            </Pressable>

            {canDelete && (
              <Pressable onPress={remove} hitSlop={8} style={styles.topActionBtn}>
                <Ionicons name="trash-outline" size={20} color={colors.error} />
              </Pressable>
            )}
          </View>
        }
      />

      <ScrollView contentContainerStyle={{ padding: spacing.md, gap: spacing.md, paddingBottom: 60 }}>

        {/* Company Header Card */}
        <View style={styles.companyHeaderCard}>
          <Image source={require('@/assets/images/company-logo.jpg')} style={styles.tdscLogo} resizeMode="contain" />
          <View style={{ flex: 1 }}>
            <Text style={styles.companyName}>TRIVENI DSC AND ETENDER SERVICE PRIVATE LIMITED</Text>
            <Text style={styles.companySub}>CIN: U74999BR2016PTC032483 • GSTIN: 10AAHCT4956K1Z1</Text>
            <Text style={styles.companySub}>Registered Office: Triveni Campus, Patna, Bihar - 800001</Text>
          </View>
        </View>

        {/* Voucher Main Information Card */}
        <View style={styles.card}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <View>
              <Text style={styles.voucherLabel}>PAYMENT-IN / MONEY RECEIPT</Text>
              <Text style={styles.no}>{vNo}</Text>
            </View>
            <View style={styles.statusBadge}>
              <Ionicons name="checkmark-circle" size={14} color="#059669" />
              <Text style={styles.statusBadgeTxt}>RECEIVED</Text>
            </View>
          </View>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 4 }}>
            <Text style={styles.meta}>📅 Date: <Text style={{ fontWeight: '700', color: '#0F172A' }}>{inc.date}</Text></Text>
            {inc.employee_name ? (
              <Text style={styles.meta}>👤 Received By: <Text style={{ fontWeight: '700', color: '#0F172A' }}>{inc.employee_name}</Text></Text>
            ) : null}
          </View>

          {/* Deposited To Bank / Cash Badge */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
            <Text style={[styles.meta, { fontWeight: '700' }]}>💳 Mode & Deposit:</Text>
            {badge.isSplit ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
                {badge.splits.map((sp: any, idx: number) => {
                  const spMode = String(sp.mode || sp.payment_mode || 'cash').toLowerCase();
                  const isCash = spMode === 'cash';
                  return (
                    <View
                      key={idx}
                      style={[
                        styles.modeBadge,
                        isCash
                          ? { backgroundColor: '#F0FDF4', borderColor: '#BBF7D0', borderWidth: 1 }
                          : { backgroundColor: '#EFF6FF', borderColor: '#BFDBFE', borderWidth: 1 }
                      ]}
                    >
                      <Ionicons name={isCash ? "cash-outline" : "business"} size={11} color={isCash ? "#15803D" : "#1E40AF"} />
                      <Text style={[styles.modeBadgeTxt, { color: isCash ? "#15803D" : "#1E40AF", fontWeight: '800' }]}>
                        {spMode.toUpperCase()}: {inr(sp.amount)}
                      </Text>
                    </View>
                  );
                })}
              </View>
            ) : badge.mode === 'cash' ? (
              <View style={[styles.modeBadge, { backgroundColor: '#F0FDF4', borderColor: '#BBF7D0', borderWidth: 1 }]}>
                <Ionicons name="cash-outline" size={12} color="#15803D" />
                <Text style={[styles.modeBadgeTxt, { color: '#15803D', fontWeight: '800' }]}>CASH IN HAND</Text>
              </View>
            ) : (
              <View style={[styles.modeBadge, { backgroundColor: '#EFF6FF', borderColor: '#BFDBFE', borderWidth: 1 }]}>
                <Ionicons name="business" size={12} color="#1E40AF" />
                <Text style={[styles.modeBadgeTxt, { color: '#1E40AF', fontWeight: '800' }]}>
                  {badge.label}
                </Text>
              </View>
            )}
          </View>

          {/* Quick Action Buttons Row: Print, Edit, View in Ledger */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
            <Pressable onPress={printPdf} style={styles.actPrintBtn} testID="detail-card-print-btn">
              {printing ? (
                <ActivityIndicator size="small" color="#047857" />
              ) : (
                <>
                  <Ionicons name="print-outline" size={16} color="#047857" />
                  <Text style={styles.actPrintBtnTxt}>Print PDF</Text>
                </>
              )}
            </Pressable>

            <Pressable onPress={openEdit} style={styles.actEditBtn} testID="detail-card-edit-btn">
              <Ionicons name="create-outline" size={16} color="#4338CA" />
              <Text style={styles.actEditBtnTxt}>Edit Voucher</Text>
            </Pressable>

            <Pressable
              onPress={() => {
                if (badge.mode === 'cash') {
                  router.push('/accounting/reports?report=cash_ledger' as any);
                } else if (badge.bankId) {
                  router.push(`/accounting/reports?report=bank_ledger&bank=${badge.bankId}` as any);
                } else {
                  router.push('/accounting/reports?report=consolidated_bank_book' as any);
                }
              }}
              style={styles.actLedgerBtn}
              testID="detail-card-ledger-btn"
            >
              <Ionicons name="book-outline" size={15} color="#1E40AF" />
              <Text style={styles.actLedgerBtnTxt}>View in Bank Ledger ➔</Text>
            </Pressable>
          </View>
        </View>

        {/* Customer Info Card with PAN & GST */}
        <View style={styles.card}>
          <Text style={styles.sectionHeader}>RECEIVED WITH THANKS FROM (CUSTOMER)</Text>
          <Text style={styles.title}>{inc.client_name}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
            {inc.client_mobile ? (
              <View style={styles.metaBadge}>
                <Ionicons name="call-outline" size={12} color="#059669" />
                <Text style={styles.metaBadgeTxt}>Mob: {inc.client_mobile}</Text>
              </View>
            ) : null}
            {inc.client_pan ? (
              <View style={[styles.metaBadge, { backgroundColor: '#FEF3C7', borderColor: '#FDE68A' }]}>
                <Text style={[styles.metaBadgeTxt, { color: '#B45309', fontWeight: '800' }]}>PAN: {inc.client_pan}</Text>
              </View>
            ) : null}
            {inc.client_gst ? (
              <View style={[styles.metaBadge, { backgroundColor: '#F3E8FF', borderColor: '#E9D5FF' }]}>
                <Text style={[styles.metaBadgeTxt, { color: '#7E22CE', fontWeight: '800' }]}>GST: {inc.client_gst}</Text>
              </View>
            ) : null}
            <View style={styles.metaBadge}>
              <Text style={styles.metaBadgeTxt}>Category: {inc.service_category}</Text>
            </View>
          </View>

          {inc.remarks ? (
            <Text style={{ marginTop: 6, color: '#475569', fontStyle: 'italic', fontSize: 12 }}>
              Remarks: "{inc.remarks}"
            </Text>
          ) : null}
        </View>

        {/* Line Items / Particulars Card */}
        {inc.items && inc.items.length > 0 ? (
          <View style={styles.card}>
            <Text style={styles.sectionHeader}>PARTICULARS / PAYMENT BREAKDOWN</Text>
            {inc.items.map((it: any, idx: number) => (
              <View key={idx} style={styles.itemRow}>
                <View style={styles.itemIndexBox}>
                  <Text style={styles.itemIndexTxt}>{it.sl || idx + 1}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: '700', color: '#0F172A', fontSize: 13 }}>
                    {it.item || it.name || 'Particulars'}
                  </Text>
                  <Text style={{ fontSize: 11, color: '#64748B' }}>
                    Qty: {it.qty || 1} × ₹{it.rate || it.price || 0}
                  </Text>
                </View>
                <Text style={{ fontWeight: '800', color: '#059669', fontSize: 14 }}>
                  {inr(it.amount)}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        {/* Linked Sales Vouchers Card */}
        {inc.linked_vouchers && inc.linked_vouchers.length > 0 ? (
          <View style={styles.card}>
            <Text style={styles.sectionHeader}>LINKED SALE INVOICES & SETTLEMENTS</Text>
            {inc.linked_vouchers.map((lv: any, idx: number) => {
              const invNo = lv.voucher_no || lv.invoice_no || `INV-${idx + 1}`;
              const tot = floatNum(lv.total_amount);
              const alloc = floatNum(lv.allocated_amount);
              const rem = Math.max(0, tot - alloc);
              return (
                <View key={idx} style={styles.linkedRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: '800', color: '#0F172A', fontSize: 13 }}>{invNo}</Text>
                    <Text style={{ fontSize: 11, color: '#64748B' }}>
                      Invoice Total: {inr(tot)} • Allocated: {inr(alloc)}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={{ fontSize: 10, color: '#64748B' }}>Remaining Balance:</Text>
                    <Text style={{ fontWeight: '900', color: rem === 0 ? '#059669' : '#DC2626', fontSize: 13 }}>
                      {inr(rem)}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
        ) : null}

        {/* Voucher Total Card */}
        <View style={[styles.card, { backgroundColor: '#F8FAFC' }]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ fontSize: 14, fontWeight: '800', color: '#0F172A' }}>TOTAL AMOUNT RECEIVED (NET):</Text>
            <Text style={styles.amt}>{inr(inc.amount)}</Text>
          </View>
        </View>

        {/* Authorized Signatory Card */}
        <View style={styles.card}>
          <Text style={styles.sectionHeader}>AUTHORIZED SIGNATORY & VERIFICATION</Text>
          <View style={styles.stampBox}>
            <Ionicons name="shield-checkmark" size={24} color="#059669" />
            <Text style={{ fontWeight: '900', color: '#059669', fontSize: 12, marginTop: 2 }}>
              ✔ OFFICIAL PAYMENT RECEIPT
            </Text>
            <Text style={{ fontSize: 10, color: '#065F46' }}>Secured by TDSC Verification System</Text>
          </View>
          <View style={{ alignItems: 'center', marginTop: 4 }}>
            <Text style={{ fontWeight: '900', color: '#0F172A', fontSize: 14 }}>अंजू कुमारी</Text>
            <Text style={{ fontSize: 11, color: '#64748B', fontWeight: '700' }}>Authorized Signatory</Text>
            <Text style={{ fontSize: 10, color: '#94A3B8' }}>For TRIVENI DSC AND ETENDER SERVICE PVT. LTD</Text>
          </View>
        </View>

        {/* Voucher Attachments Section */}
        <AttachmentsSection
          attachments={inc.attachments || []}
          onChange={onAttachmentsChange}
          voucherKind="income"
          oid={inc.id}
          title="Receipt / Bank Slip Attachments"
        />

        {/* Print Button Footer */}
        <View style={{ marginTop: 8 }}>
          <Pressable onPress={printPdf} style={styles.footerPrintBtn}>
            <Ionicons name="print" size={20} color="#FFF" />
            <Text style={styles.footerPrintTxt}>Print Official Payment-In Voucher (PDF)</Text>
          </Pressable>
        </View>

      </ScrollView>

      {/* ================= EDIT & UPDATE PAYMENT-IN MODAL ================= */}
      <Modal
        visible={editModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setEditModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}
        >
          <View style={styles.modalContent} testID="detail-edit-modal">
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>Edit Payment-In Voucher</Text>
                <Text style={styles.modalSubtitle}>{vNo}</Text>
              </View>
              <Pressable
                onPress={() => setEditModalVisible(false)}
                style={styles.modalCloseBtn}
                hitSlop={8}
              >
                <Ionicons name="close" size={20} color="#64748B" />
              </Pressable>
            </View>

            <ScrollView style={{ maxHeight: 460 }} showsVerticalScrollIndicator={false}>
              <View style={styles.formSection}>
                <View style={styles.formRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.formLabel}>Amount Received (₹) *</Text>
                    <TextInput
                      style={[styles.formInput, { fontWeight: '800', color: '#059669', fontSize: 16 }]}
                      keyboardType="numeric"
                      value={editForm.amount}
                      onChangeText={(t) => setEditForm((p) => ({ ...p, amount: t }))}
                      placeholder="0.00"
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.formLabel}>Date (YYYY-MM-DD) *</Text>
                    <TextInput
                      style={styles.formInput}
                      value={editForm.date}
                      onChangeText={(t) => setEditForm((p) => ({ ...p, date: t }))}
                      placeholder="YYYY-MM-DD"
                    />
                  </View>
                </View>

                {/* Payment Mode */}
                <View>
                  <Text style={styles.formLabel}>Payment Mode</Text>
                  <View style={styles.modeSelector}>
                    {PAYMENT_MODES.map((m) => (
                      <Pressable
                        key={m}
                        onPress={() => setEditForm((p) => ({ ...p, payment_mode: m }))}
                        style={[
                          styles.modeChoice,
                          editForm.payment_mode === m && styles.modeChoiceActive,
                        ]}
                      >
                        <Text
                          style={[
                            styles.modeChoiceTxt,
                            editForm.payment_mode === m && styles.modeChoiceTxtActive,
                          ]}
                        >
                          {m.toUpperCase()}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>

                {/* Bank Account Selection Chips (Visible if mode is bank, upi, cheque) */}
                {editForm.payment_mode !== 'cash' && (
                  <View style={{ marginTop: 4 }}>
                    <Text style={styles.formLabel}>Deposit into Bank Account *</Text>
                    <View style={styles.bankChipsRow}>
                      {banks.map((b) => {
                        const isSelected = (editForm.bank_account_id || banks[0]?.id) === b.id;
                        const lbl = getBankShortLabel(b);
                        return (
                          <Pressable
                            key={b.id}
                            onPress={() => setEditForm(p => ({ ...p, bank_account_id: b.id }))}
                            style={[styles.bankChip, isSelected && styles.bankChipSelected]}
                          >
                            <Ionicons
                              name={isSelected ? 'checkmark-circle' : 'ellipse-outline'}
                              size={14}
                              color={isSelected ? '#1D4ED8' : '#64748B'}
                            />
                            <Text style={[styles.bankChipTxt, isSelected && styles.bankChipTxtSelected]}>
                              {lbl}
                            </Text>
                          </Pressable>
                        );
                      })}
                      <Pressable
                        onPress={() => setShowAddBankModal(true)}
                        style={styles.addBankBtnChip}
                      >
                        <Ionicons name="add-circle-outline" size={14} color="#1E40AF" />
                        <Text style={styles.addBankBtnChipTxt}>+ Add Account</Text>
                      </Pressable>
                    </View>
                  </View>
                )}

                <View>
                  <Text style={styles.formLabel}>Service Category</Text>
                  <TextInput
                    style={styles.formInput}
                    value={editForm.service_category}
                    onChangeText={(t) => setEditForm((p) => ({ ...p, service_category: t }))}
                    placeholder="e.g. Tender Services"
                  />
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 6 }}>
                    <View style={{ flexDirection: 'row', gap: 6 }}>
                      {SERVICE_CATEGORIES.map((c) => (
                        <Pressable
                          key={c}
                          onPress={() => setEditForm((p) => ({ ...p, service_category: c }))}
                          style={[
                            styles.catPill,
                            editForm.service_category === c && styles.catPillActive,
                          ]}
                        >
                          <Text style={[styles.catPillTxt, editForm.service_category === c && styles.catPillTxtActive]}>
                            {c}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  </ScrollView>
                </View>

                <View style={styles.subCard}>
                  <Text style={styles.subCardTitle}>Customer / Client Details</Text>
                  <View style={styles.formRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.formLabel}>Client / Firm Name *</Text>
                      <TextInput
                        style={styles.formInput}
                        value={editForm.client_name}
                        onChangeText={(t) => setEditForm((p) => ({ ...p, client_name: t }))}
                        placeholder="Customer Name"
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.formLabel}>Mobile No.</Text>
                      <TextInput
                        style={styles.formInput}
                        value={editForm.client_mobile}
                        onChangeText={(t) => setEditForm((p) => ({ ...p, client_mobile: t }))}
                        placeholder="Mobile No."
                        keyboardType="phone-pad"
                      />
                    </View>
                  </View>

                  <View style={styles.formRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.formLabel}>PAN No.</Text>
                      <TextInput
                        style={[styles.formInput, { textTransform: 'uppercase' }]}
                        value={editForm.client_pan}
                        onChangeText={(t) => setEditForm((p) => ({ ...p, client_pan: t.toUpperCase() }))}
                        placeholder="ABCDE1234F"
                        autoCapitalize="characters"
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.formLabel}>GST No.</Text>
                      <TextInput
                        style={[styles.formInput, { textTransform: 'uppercase' }]}
                        value={editForm.client_gst}
                        onChangeText={(t) => setEditForm((p) => ({ ...p, client_gst: t.toUpperCase() }))}
                        placeholder="15-digit GSTIN"
                        autoCapitalize="characters"
                      />
                    </View>
                  </View>
                </View>

                <View>
                  <Text style={styles.formLabel}>Received By / Executive Name</Text>
                  <TextInput
                    style={styles.formInput}
                    value={editForm.employee_name}
                    onChangeText={(t) => setEditForm((p) => ({ ...p, employee_name: t }))}
                    placeholder="Staff / Executive Name"
                  />
                </View>

                <View>
                  <Text style={styles.formLabel}>Remarks / Narration</Text>
                  <TextInput
                    style={[styles.formInput, { minHeight: 64, textAlignVertical: 'top' }]}
                    value={editForm.remarks}
                    onChangeText={(t) => setEditForm((p) => ({ ...p, remarks: t }))}
                    placeholder="Payment details, cheque no., or notes..."
                    multiline
                    numberOfLines={3}
                  />
                </View>
              </View>
            </ScrollView>

            <View style={styles.modalFooter}>
              <Pressable
                onPress={() => setEditModalVisible(false)}
                style={styles.cancelBtn}
                disabled={saving}
              >
                <Text style={styles.cancelBtnTxt}>Cancel</Text>
              </Pressable>

              <Pressable
                onPress={saveEdit}
                style={styles.saveBtn}
                disabled={saving}
                testID="detail-save-payin-btn"
              >
                {saving ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <>
                    <Ionicons name="checkmark-done" size={18} color="#FFF" />
                    <Text style={styles.saveBtnTxt}>Save & Update</Text>
                  </>
                )}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Inline Modal: + Add Bank Account */}
      <Modal
        visible={showAddBankModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowAddBankModal(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}
        >
          <View style={styles.addBankModalBox}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Ionicons name="business" size={18} color="#1E40AF" />
                <Text style={{ fontSize: 16, fontWeight: '800', color: '#0F172A' }}>Add Bank Account</Text>
              </View>
              <Pressable onPress={() => setShowAddBankModal(false)} hitSlop={8}>
                <Ionicons name="close" size={20} color="#64748B" />
              </Pressable>
            </View>

            {bankSaveErr && (
              <View style={{ backgroundColor: '#FEF2F2', padding: 8, borderRadius: 6, marginBottom: 10, borderWidth: 1, borderColor: '#FECACA' }}>
                <Text style={{ fontSize: 12, color: '#DC2626', fontWeight: '700' }}>{bankSaveErr}</Text>
              </View>
            )}

            <ScrollView style={{ maxHeight: 380 }} showsVerticalScrollIndicator={false}>
              <View style={{ gap: 10 }}>
                <View>
                  <Text style={styles.inputLbl}>Account Nickname / Display Name *</Text>
                  <TextInput
                    style={styles.modalInput}
                    placeholder="e.g. Axis Bank, SBI Current"
                    value={newBankForm.name}
                    onChangeText={t => setNewBankForm(p => ({ ...p, name: t }))}
                  />
                </View>
                <View>
                  <Text style={styles.inputLbl}>Bank Name *</Text>
                  <TextInput
                    style={styles.modalInput}
                    placeholder="e.g. State Bank of India, Axis Bank Ltd"
                    value={newBankForm.bank_name}
                    onChangeText={t => setNewBankForm(p => ({ ...p, bank_name: t }))}
                  />
                </View>
                <View>
                  <Text style={styles.inputLbl}>Account Number *</Text>
                  <TextInput
                    style={styles.modalInput}
                    placeholder="e.g. 915020011528516"
                    keyboardType="number-pad"
                    value={newBankForm.account_no}
                    onChangeText={t => setNewBankForm(p => ({ ...p, account_no: t }))}
                  />
                </View>
                <View>
                  <Text style={styles.inputLbl}>IFSC Code</Text>
                  <TextInput
                    style={[styles.modalInput, { textTransform: 'uppercase' }]}
                    placeholder="e.g. UTIB0000000"
                    autoCapitalize="characters"
                    value={newBankForm.ifsc}
                    onChangeText={t => setNewBankForm(p => ({ ...p, ifsc: t.toUpperCase() }))}
                  />
                </View>
                <View>
                  <Text style={styles.inputLbl}>Opening Balance (₹)</Text>
                  <TextInput
                    style={styles.modalInput}
                    placeholder="0.00"
                    keyboardType="numeric"
                    value={newBankForm.opening_balance}
                    onChangeText={t => setNewBankForm(p => ({ ...p, opening_balance: t }))}
                  />
                </View>
              </View>
            </ScrollView>

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
              <Pressable
                onPress={() => setShowAddBankModal(false)}
                style={{ flex: 1, paddingVertical: 10, borderRadius: 8, backgroundColor: '#F1F5F9', alignItems: 'center' }}
              >
                <Text style={{ fontWeight: '700', color: '#475569' }}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={handleSaveNewBank}
                disabled={savingNewBank}
                style={{ flex: 1, paddingVertical: 10, borderRadius: 8, backgroundColor: '#1E40AF', alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6 }}
              >
                {savingNewBank ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <>
                    <Ionicons name="checkmark-circle-outline" size={16} color="#FFF" />
                    <Text style={{ fontWeight: '800', color: '#FFF' }}>Save Bank</Text>
                  </>
                )}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function floatNum(val: any): number {
  const n = parseFloat(val);
  return Number.isNaN(n) ? 0 : n;
}

const styles = StyleSheet.create({
  companyHeaderCard: {
    backgroundColor: '#FFF',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  tdscLogo: { width: 56, height: 56, borderRadius: 8 },
  companyName: { fontSize: 12, fontWeight: '900', color: '#00104A', letterSpacing: 0.3 },
  companySub: { fontSize: 10, color: '#475569', marginTop: 1 },

  card: {
    backgroundColor: '#FFF',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: 8,
  },
  voucherLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#059669',
    letterSpacing: 0.8,
  },
  no: { fontSize: font.xl, fontWeight: '900', color: '#111827' },
  title: { fontSize: font.lg, fontWeight: '700', color: '#111827', marginTop: 2 },
  meta: { color: '#475569', fontSize: 12 },
  sectionHeader: { fontSize: 11, fontWeight: '900', color: '#374151', letterSpacing: 0.8 },
  amt: { fontSize: 20, fontWeight: '900', color: '#059669' },

  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  statusBadgeTxt: {
    fontSize: 10,
    fontWeight: '900',
    color: '#059669',
    letterSpacing: 0.6,
  },

  modeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  modeBadgeTxt: {
    fontSize: 11,
    fontWeight: '800',
    color: '#1E40AF',
  },

  metaBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#F0F9FF',
    borderWidth: 1,
    borderColor: '#BAE6FD',
    paddingHorizontal: 8,
    paddingVertical: 2.5,
    borderRadius: 6,
  },
  metaBadgeTxt: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0369A1',
  },

  topActionBtn: {
    padding: 6,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
  },

  /* Action Buttons inside Card */
  actPrintBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.md,
  },
  actPrintBtnTxt: {
    color: '#047857',
    fontWeight: '800',
    fontSize: font.sm,
  },
  actEditBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#EEF2FF',
    borderWidth: 1,
    borderColor: '#C7D2FE',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.md,
  },
  actEditBtnTxt: {
    color: '#4338CA',
    fontWeight: '800',
    fontSize: font.sm,
  },
  actLedgerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.md,
  },
  actLedgerBtnTxt: {
    color: '#1E40AF',
    fontWeight: '800',
    fontSize: font.sm,
  },

  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  itemIndexBox: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemIndexTxt: {
    fontSize: 10,
    fontWeight: '800',
    color: '#64748B',
  },

  linkedRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },

  stampBox: {
    backgroundColor: '#F0FDF4',
    borderWidth: 1.5,
    borderColor: '#86EFAC',
    borderStyle: 'dashed',
    borderRadius: radius.md,
    padding: 10,
    alignItems: 'center',
    marginTop: 4,
  },

  footerPrintBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#059669',
    paddingVertical: 12,
    borderRadius: radius.md,
  },
  footerPrintTxt: {
    color: '#FFF',
    fontWeight: '800',
    fontSize: font.md,
  },

  /* Modal */
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.md,
  },
  modalContent: {
    backgroundColor: '#FFF',
    borderRadius: radius.xl,
    width: '100%',
    maxWidth: 580,
    maxHeight: '92%',
    padding: spacing.lg,
    gap: 12,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 8,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    paddingBottom: spacing.sm,
  },
  modalTitle: {
    fontSize: font.lg,
    fontWeight: '900',
    color: '#0F172A',
  },
  modalSubtitle: {
    fontSize: font.sm,
    color: colors.brandPrimary,
    fontWeight: '800',
  },
  modalCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  formSection: {
    gap: 10,
    paddingVertical: 4,
  },
  formRow: {
    flexDirection: 'row',
    gap: 10,
  },
  formLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
    marginBottom: 4,
  },
  formInput: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
    borderRadius: radius.md,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: font.sm,
    color: '#0F172A',
  },
  modeSelector: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    borderRadius: radius.md,
    padding: 2,
    height: 40,
    alignItems: 'center',
  },
  modeChoice: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    borderRadius: 6,
  },
  modeChoiceActive: {
    backgroundColor: '#FFF',
  },
  modeChoiceTxt: {
    fontSize: 10,
    fontWeight: '700',
    color: '#64748B',
  },
  modeChoiceTxtActive: {
    color: colors.brandPrimary,
    fontWeight: '900',
  },

  bankChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  bankChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: radius.md,
    backgroundColor: '#F8FAFC',
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
  },
  bankChipSelected: {
    backgroundColor: '#EFF6FF',
    borderColor: '#2563EB',
  },
  bankChipTxt: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#475569',
  },
  bankChipTxtSelected: {
    color: '#1D4ED8',
    fontWeight: '800',
  },
  addBankBtnChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: radius.md,
    backgroundColor: '#EFF6FF',
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#93C5FD',
  },
  addBankBtnChipTxt: {
    fontSize: 11.5,
    fontWeight: '800',
    color: '#1E40AF',
  },

  catPill: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  catPillActive: {
    backgroundColor: '#ECFDF5',
    borderColor: '#10B981',
  },
  catPillTxt: {
    fontSize: 11,
    color: '#475569',
    fontWeight: '600',
  },
  catPillTxtActive: {
    color: '#047857',
    fontWeight: '800',
  },
  subCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: spacing.sm,
    gap: 8,
  },
  subCardTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: '#334155',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  modalFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    paddingTop: spacing.sm,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: radius.md,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtnTxt: {
    color: '#475569',
    fontWeight: '700',
    fontSize: font.sm,
  },
  saveBtn: {
    flex: 2,
    flexDirection: 'row',
    gap: 6,
    paddingVertical: 10,
    borderRadius: radius.md,
    backgroundColor: '#059669',
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnTxt: {
    color: '#FFF',
    fontWeight: '800',
    fontSize: font.sm,
  },

  addBankModalBox: {
    width: '100%',
    maxWidth: 480,
    backgroundColor: '#FFF',
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 6,
  },
  inputLbl: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
    marginBottom: 4,
  },
  modalInput: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
    borderRadius: radius.md,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: font.sm,
    color: '#0F172A',
  },
});
