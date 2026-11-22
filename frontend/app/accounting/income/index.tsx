import React, { useCallback, useState, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  TextInput,
  Modal,
  ScrollView,
  Platform,
  Linking,
  ActivityIndicator,
  KeyboardAvoidingView,
} from 'react-native';
import { useRouter, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, font, shadow } from '@/src/theme';
import { api } from '@/src/api';
import { ScreenLoader, EmptyState } from '@/src/ui';
import { ScreenHeader } from '@/src/ScreenHeader';
import { useAuth } from '@/src/AuthContext';
import { confirm, notify } from '@/src/dialog';

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

export default function IncomeList() {
  const router = useRouter();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ accounting?: string; is_old_accounting?: string }>();
  const isOldParam = params?.accounting === 'old' || params?.is_old_accounting === 'true';
  const [accountingFilter, setAccountingFilter] = useState<'all' | 'new' | 'old'>(isOldParam ? 'old' : 'all');

  useEffect(() => {
    if (params?.accounting === 'old' || params?.is_old_accounting === 'true') {
      setAccountingFilter('old');
    }
  }, [params?.accounting, params?.is_old_accounting]);

  const [list, setList] = useState<any[] | null>(null);
  const [banks, setBanks] = useState<any[]>([]);
  const [selectedBankFilter, setSelectedBankFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [printingId, setPrintingId] = useState<string | null>(null);

  const screenTitle = useMemo(() => {
    if (accountingFilter === 'old' || isOldParam) return 'All Old Payment-In Invoices';
    return 'All Payment-In';
  }, [accountingFilter, isOldParam]);

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

  // Edit & Update Modal State
  const [editingInc, setEditingInc] = useState<any | null>(null);
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

  const load = useCallback(async () => {
    try {
      let url = '/income';
      if (accountingFilter === 'old') url += '?is_old_accounting=true';
      else if (accountingFilter === 'new') url += '?is_old_accounting=false';
      const [incRes, bankRes] = await Promise.all([
        api.get<any[]>(url).catch(() => []),
        api.get<any[]>('/bank-accounts').catch(() => []),
      ]);
      setList(incRes);
      setBanks(bankRes || []);
    } catch {
      setList([]);
    }
  }, [accountingFilter]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

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

  // Multi-criteria filter matching:
  // "Payment In Voucher No."; Name; Mobile No.; Pan no. ; GST NO. ; Bank / Mode
  const filteredList = useMemo(() => {
    if (!list) return null;

    let res = list;

    // Filter by selected Bank / Payment Mode
    if (selectedBankFilter !== 'all') {
      res = res.filter((inc) => {
        const mode = String(inc.payment_mode || 'cash').toLowerCase();
        const bId = inc.bank_id || inc.bank_account_id;
        const acc = String(inc.account_no || '');
        const bName = String(inc.bank_name || '').toUpperCase();

        if (selectedBankFilter === 'cash') {
          return mode === 'cash';
        }
        if (selectedBankFilter === 'online') {
          return mode !== 'cash';
        }
        if (selectedBankFilter === 'bnk_sbi_01') {
          return bId === 'bnk_sbi_01' || acc.includes('42137607814') || bName.includes('SBI') || bName.includes('STATE');
        }
        if (selectedBankFilter === 'bnk_hdfc_02') {
          return bId === 'bnk_hdfc_02' || acc.includes('915020011528516') || bName.includes('AXIS') || bName.includes('ANJU');
        }
        return bId === selectedBankFilter;
      });
    }

    const q = searchQuery.trim().toLowerCase();
    if (!q) return res;

    return res.filter((inc) => {
      const vNo = String(inc.voucher_no || inc.income_no || '').toLowerCase();
      const clientName = String(inc.client_name || '').toLowerCase();
      const mobile = String(inc.client_mobile || '').toLowerCase();
      const pan = String(inc.client_pan || '').toLowerCase();
      const gst = String(inc.client_gst || '').toLowerCase();
      const code = String(inc.client_code || '').toLowerCase();
      const category = String(inc.service_category || '').toLowerCase();
      const service = String(inc.service_name || '').toLowerCase();
      const empName = String(inc.employee_name || '').toLowerCase();
      const remarks = String(inc.remarks || '').toLowerCase();
      const mode = String(inc.payment_mode || '').toLowerCase();
      const date = String(inc.date || '').toLowerCase();
      const amt = String(inc.amount || '').toLowerCase();
      const bName = String(inc.bank_name || '').toLowerCase();
      const accNo = String(inc.account_no || '').toLowerCase();

      // Check linked vouchers
      const linked = (inc.linked_vouchers || [])
        .map((lv: any) => String(lv.voucher_no || lv.invoice_no || '').toLowerCase())
        .join(' ');

      // Check items
      const items = (inc.items || [])
        .map((it: any) => String(it.item || it.name || '').toLowerCase())
        .join(' ');

      return (
        vNo.includes(q) ||
        clientName.includes(q) ||
        mobile.includes(q) ||
        pan.includes(q) ||
        gst.includes(q) ||
        code.includes(q) ||
        category.includes(q) ||
        service.includes(q) ||
        empName.includes(q) ||
        remarks.includes(q) ||
        mode.includes(q) ||
        date.includes(q) ||
        amt.includes(q) ||
        linked.includes(q) ||
        items.includes(q) ||
        bName.includes(q) ||
        accNo.includes(q)
      );
    });
  }, [list, selectedBankFilter, searchQuery]);

  // Print PDF Handler
  const handlePrint = async (item: any) => {
    try {
      setPrintingId(item.id);
      const url = await api.incomePdfUrl(item.id);
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.open(url, '_blank');
      } else {
        await Linking.openURL(url);
      }
    } catch (e: any) {
      notify('Print Failed', e?.message || 'Unable to open Payment-In Voucher PDF');
    } finally {
      setPrintingId(null);
    }
  };

  // Open Edit Modal
  const openEdit = (item: any) => {
    const sbi = banks.find(b => String(b.account_no || '').includes('42137607814'));
    const defaultBankId = item.bank_id || item.bank_account_id || sbi?.id || banks[0]?.id || '';
    setEditingInc(item);
    setEditForm({
      amount: String(item.amount || ''),
      date: item.date || new Date().toISOString().slice(0, 10),
      payment_mode: item.payment_mode || 'cash',
      bank_account_id: defaultBankId,
      service_category: item.service_category || 'Other Services',
      service_name: item.service_name || '',
      client_name: item.client_name || '',
      client_mobile: item.client_mobile || '',
      client_pan: item.client_pan || '',
      client_gst: item.client_gst || '',
      employee_name: item.employee_name || '',
      remarks: item.remarks || '',
    });
  };

  // Save / Update Handler
  const saveEdit = async () => {
    if (!editingInc) return;
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
      await api.patch(`/income/${editingInc.id}`, {
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

      notify('Saved', `Payment-In voucher ${editingInc.voucher_no || editingInc.income_no} updated successfully!`);
      setEditingInc(null);
      await load();
    } catch (e: any) {
      notify('Update Failed', e?.message || 'Failed to save changes');
    } finally {
      setSaving(false);
    }
  };

  // Delete Voucher Handler
  const handleDelete = async (item: any) => {
    const vNo = item.voucher_no || item.income_no || 'Payment-In';
    const ok = await confirm(
      'Delete Voucher',
      `Are you sure you want to delete ${vNo}? If linked to sale vouchers, balances will automatically be restored.`
    );
    if (!ok) return;

    try {
      await api.del(`/income/${item.id}`);
      notify('Deleted', `${vNo} deleted successfully.`);
      await load();
    } catch (e: any) {
      notify('Delete Failed', e?.message || 'Could not delete voucher');
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#F4F6FB' }} testID="income-list">
      <ScreenHeader
        title={screenTitle}
        right={
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Pressable
              onPress={() => router.push('/accounting/reports?report=consolidated_bank_book' as any)}
              style={styles.ledgerHeaderBtn}
              testID="btn-bank-book"
            >
              <Ionicons name="globe-outline" size={13} color="#00104A" />
              <Text style={styles.ledgerHeaderBtnTxt}>Bank Book</Text>
            </Pressable>
            <Pressable
              onPress={() => router.push('/accounting/reports?report=bank_ledger' as any)}
              style={[styles.ledgerHeaderBtn, { backgroundColor: '#EFF6FF', borderColor: '#BFDBFE' }]}
              testID="btn-bank-ledger"
            >
              <Ionicons name="business" size={13} color="#1E40AF" />
              <Text style={[styles.ledgerHeaderBtnTxt, { color: '#1E40AF' }]}>Bank Ledger</Text>
            </Pressable>
            <Pressable
              onPress={() => router.push('/accounting/reports?report=cash_ledger' as any)}
              style={[styles.ledgerHeaderBtn, { backgroundColor: '#F0FDF4', borderColor: '#BBF7D0' }]}
              testID="btn-cash-ledger"
            >
              <Ionicons name="wallet" size={13} color="#059669" />
              <Text style={[styles.ledgerHeaderBtnTxt, { color: '#059669' }]}>Cash</Text>
            </Pressable>
            <Pressable
              onPress={() => router.push(accountingFilter === 'old' ? ('/accounting/income/new?accounting=old' as any) : ('/accounting/income/new' as any))}
              style={styles.addBtn}
              testID="new-income-btn"
            >
              <Ionicons name="add" size={24} color="#FFF" />
            </Pressable>
          </View>
        }
      />

      {/* Old / New Accounting Scope Switcher */}
      <View style={{ flexDirection: 'row', backgroundColor: '#FFF', paddingHorizontal: 16, paddingVertical: 10, gap: 8, borderBottomWidth: 1, borderBottomColor: '#E2E8F0' }}>
        {[
          { key: 'all', label: 'All Payments-In (Consolidated)', icon: 'globe-outline' },
          { key: 'new', label: 'New Accounting', icon: 'flash' },
          { key: 'old', label: 'Old Accounting', icon: 'time' },
        ].map(opt => (
          <Pressable
            key={opt.key}
            onPress={() => setAccountingFilter(opt.key as any)}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: 5,
              paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
              backgroundColor: accountingFilter === opt.key ? (opt.key === 'old' ? '#7C3AED' : '#2563EB') : '#F1F5F9',
            }}
          >
            <Ionicons name={opt.icon as any} size={13} color={accountingFilter === opt.key ? '#FFF' : '#64748B'} />
            <Text style={{ fontSize: 12, fontWeight: '700', color: accountingFilter === opt.key ? '#FFF' : '#475569' }}>
              {opt.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Search Payment In Section */}
      <View style={styles.searchSection}>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={18} color="#64748B" style={{ marginLeft: 4 }} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search Payment In (Voucher No., Name, Mobile, PAN, GST...)"
            placeholderTextColor="#94A3B8"
            value={searchQuery}
            onChangeText={setSearchQuery}
            returnKeyType="search"
            autoCapitalize="none"
            autoCorrect={false}
            testID="search-payin-input"
          />
          {searchQuery ? (
            <Pressable onPress={() => setSearchQuery('')} hitSlop={10} style={styles.clearBtn} testID="clear-search-btn">
              <Ionicons name="close-circle" size={18} color="#94A3B8" />
            </Pressable>
          ) : null}
        </View>

        {/* Horizontal Bank / Mode Filter Pills */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.bankFilterScroll}>
          <View style={styles.bankFilterScrollInner}>
            <Pressable
              onPress={() => setSelectedBankFilter('all')}
              style={[styles.bankFilterPill, selectedBankFilter === 'all' && styles.bankFilterPillActive]}
            >
              <Ionicons name="apps-outline" size={13} color={selectedBankFilter === 'all' ? '#FFF' : '#334155'} />
              <Text style={[styles.bankFilterPillTxt, selectedBankFilter === 'all' && styles.bankFilterPillTxtActive]}>
                All
              </Text>
            </Pressable>

            {banks.map((b) => {
              const isSel = selectedBankFilter === b.id;
              const lbl = getBankShortLabel(b);
              return (
                <Pressable
                  key={b.id}
                  onPress={() => setSelectedBankFilter(selectedBankFilter === b.id ? 'all' : b.id)}
                  style={[styles.bankFilterPill, isSel && styles.bankFilterPillActive]}
                >
                  <Ionicons name="business" size={13} color={isSel ? '#FFF' : '#1E40AF'} />
                  <Text style={[styles.bankFilterPillTxt, isSel && styles.bankFilterPillTxtActive]}>
                    {lbl}
                  </Text>
                </Pressable>
              );
            })}

            <Pressable
              onPress={() => setSelectedBankFilter(selectedBankFilter === 'cash' ? 'all' : 'cash')}
              style={[styles.bankFilterPill, selectedBankFilter === 'cash' && styles.bankFilterPillActiveGreen]}
            >
              <Ionicons name="cash-outline" size={13} color={selectedBankFilter === 'cash' ? '#FFF' : '#059669'} />
              <Text style={[styles.bankFilterPillTxt, selectedBankFilter === 'cash' && styles.bankFilterPillTxtActive]}>
                Cash
              </Text>
            </Pressable>

            <Pressable
              onPress={() => setSelectedBankFilter(selectedBankFilter === 'online' ? 'all' : 'online')}
              style={[styles.bankFilterPill, selectedBankFilter === 'online' && styles.bankFilterPillActive]}
            >
              <Ionicons name="card-outline" size={13} color={selectedBankFilter === 'online' ? '#FFF' : '#1E40AF'} />
              <Text style={[styles.bankFilterPillTxt, selectedBankFilter === 'online' && styles.bankFilterPillTxtActive]}>
                Online / Bank
              </Text>
            </Pressable>
          </View>
        </ScrollView>

        {/* Criteria helper tags */}
        <View style={styles.criteriaRow}>
          <Text style={styles.criteriaLbl}>Criteria:</Text>
          <View style={styles.chip}><Text style={styles.chipTxt}>Payment In Voucher No.</Text></View>
          <View style={styles.chip}><Text style={styles.chipTxt}>Name</Text></View>
          <View style={styles.chip}><Text style={styles.chipTxt}>Mobile No.</Text></View>
          <View style={styles.chip}><Text style={styles.chipTxt}>Pan no.</Text></View>
          <View style={styles.chip}><Text style={styles.chipTxt}>GST NO.</Text></View>
        </View>

        {/* Active search result indicator */}
        {(searchQuery.trim() || selectedBankFilter !== 'all') ? (
          <View style={styles.resultBar}>
            <Text style={styles.resultTxt}>
              Found <Text style={{ fontWeight: '800', color: '#0F172A' }}>{filteredList?.length || 0}</Text> of {list?.length || 0} vouchers
            </Text>
            <Pressable onPress={() => { setSearchQuery(''); setSelectedBankFilter('all'); }}>
              <Text style={styles.resetLink}>Clear All</Text>
            </Pressable>
          </View>
        ) : null}
      </View>

      {/* Main List Area */}
      {list === null ? (
        <ScreenLoader />
      ) : list.length === 0 ? (
        <EmptyState
          testID="income-empty"
          icon="cash-outline"
          title="No Payment-In entries"
          subtitle="Record money received from clients"
          actionLabel="Add Payment-In"
          onAction={() => router.push('/accounting/income/new' as any)}
        />
      ) : filteredList && filteredList.length === 0 ? (
        <View style={styles.noMatchCard}>
          <Ionicons name="search-outline" size={42} color="#94A3B8" />
          <Text style={styles.noMatchTitle}>No payment-in vouchers match your criteria</Text>
          <Text style={styles.noMatchSub}>
            Try switching bank filter or searching with a different term (Voucher No., Customer Name, Mobile, PAN, or GSTIN).
          </Text>
          <Pressable onPress={() => { setSearchQuery(''); setSelectedBankFilter('all'); }} style={styles.clearSearchBtn}>
            <Ionicons name="close" size={16} color="#FFF" />
            <Text style={styles.clearSearchBtnTxt}>Reset All Filters</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={filteredList}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ padding: spacing.md, gap: spacing.md, paddingBottom: 90 }}
          renderItem={({ item }) => {
            const vNo = item.voucher_no || item.income_no || 'PAYIN';
            const badge = getIncomeBankBadge(item);
            return (
              <View style={styles.card} testID={`payin-card-${item.id}`}>
                {/* Header: Voucher No, Date, Status, Amount */}
                <View style={styles.cardHeader}>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <Text style={styles.vNo}>{vNo}</Text>
                      {item.is_old_accounting ? (
                        <View style={{ backgroundColor: '#F3E8FF', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, borderWidth: 1, borderColor: '#D8B4FE' }}>
                          <Text style={{ fontSize: 10, fontWeight: '700', color: '#7C3AED' }}>📜 Old</Text>
                        </View>
                      ) : null}
                      <Text style={styles.dateTxt}>• {item.date}</Text>
                      {(item.attachments?.length || 0) > 0 ? (
                        <View style={styles.attachChip}>
                          <Ionicons name="attach" size={12} color={colors.brandPrimary} />
                          <Text style={styles.attachTxt}>{item.attachments.length}</Text>
                        </View>
                      ) : null}
                    </View>
                    <Text style={styles.clientTitle}>{item.client_name}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 4 }}>
                    <Text style={styles.amtTxt}>{inr(item.amount)}</Text>
                    <View style={styles.receivedBadge}>
                      <Ionicons name="checkmark-circle" size={12} color="#059669" />
                      <Text style={styles.receivedBadgeTxt}>RECEIVED</Text>
                    </View>
                  </View>
                </View>

                {/* Service Category & Bank Name / Mode */}
                <View style={styles.metaRow}>
                  <View style={styles.categoryBadge}>
                    <Text style={styles.categoryBadgeTxt}>{item.service_category || 'General'}</Text>
                  </View>

                  {/* Bank Account / Cash Chip */}
                  {badge.isSplit ? (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
                      {badge.splits.map((sp: any, sIdx: number) => {
                        const spMode = String(sp.mode || sp.payment_mode || 'cash').toLowerCase();
                        const isCash = spMode === 'cash';
                        return (
                          <View
                            key={sIdx}
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
                      <Text style={[styles.modeBadgeTxt, { color: '#15803D', fontWeight: '800' }]}>CASH</Text>
                    </View>
                  ) : (
                    <View style={[styles.modeBadge, { backgroundColor: '#EFF6FF', borderColor: '#BFDBFE', borderWidth: 1 }]}>
                      <Ionicons name="business" size={12} color="#1E40AF" />
                      <Text style={[styles.modeBadgeTxt, { color: '#1E40AF', fontWeight: '800' }]}>
                        {badge.label}
                      </Text>
                    </View>
                  )}

                  {item.employee_name ? (
                    <Text style={styles.byEmpTxt}>by {item.employee_name}</Text>
                  ) : null}
                </View>

                {/* Customer Details Badges: Mobile, PAN, GST, Linked Invoices */}
                <View style={styles.custMetaContainer}>
                  {item.client_mobile ? (
                    <View style={styles.metaBadge}>
                      <Ionicons name="call-outline" size={12} color="#059669" />
                      <Text style={styles.metaBadgeTxt}>Mob: {item.client_mobile}</Text>
                    </View>
                  ) : null}
                  {item.client_pan ? (
                    <View style={[styles.metaBadge, { backgroundColor: '#FEF3C7', borderColor: '#FDE68A' }]}>
                      <Text style={[styles.metaBadgeTxt, { color: '#B45309', fontWeight: '800' }]}>PAN: {item.client_pan}</Text>
                    </View>
                  ) : null}
                  {item.client_gst ? (
                    <View style={[styles.metaBadge, { backgroundColor: '#F3E8FF', borderColor: '#E9D5FF' }]}>
                      <Text style={[styles.metaBadgeTxt, { color: '#7E22CE', fontWeight: '800' }]}>GST: {item.client_gst}</Text>
                    </View>
                  ) : null}
                  {item.linked_vouchers && item.linked_vouchers.length > 0 ? (
                    <View style={[styles.metaBadge, { backgroundColor: '#E0E7FF', borderColor: '#C7D2FE' }]}>
                      <Ionicons name="document-text-outline" size={12} color="#3730A3" />
                      <Text style={[styles.metaBadgeTxt, { color: '#3730A3', fontWeight: '800' }]}>
                        Linked: {item.linked_vouchers.map((lv: any) => lv.voucher_no || lv.invoice_no).join(', ')}
                      </Text>
                    </View>
                  ) : null}
                </View>

                {/* Remarks if present */}
                {item.remarks ? (
                  <Text style={styles.remarksTxt} numberOfLines={2}>
                    "{item.remarks}"
                  </Text>
                ) : null}

                {/* Action Buttons: Print, Edit, View, Ledger, Delete */}
                <View style={styles.cardActionsRow}>
                  {/* Print Button */}
                  <Pressable
                    onPress={() => handlePrint(item)}
                    style={styles.actionBtnPrint}
                    testID={`print-payin-${item.id}`}
                  >
                    {printingId === item.id ? (
                      <ActivityIndicator size="small" color="#047857" />
                    ) : (
                      <>
                        <Ionicons name="print-outline" size={15} color="#047857" />
                        <Text style={styles.actionBtnPrintTxt}>Print</Text>
                      </>
                    )}
                  </Pressable>

                  {/* Edit Button */}
                  <Pressable
                    onPress={() => openEdit(item)}
                    style={styles.actionBtnEdit}
                    testID={`edit-payin-${item.id}`}
                  >
                    <Ionicons name="create-outline" size={15} color="#4338CA" />
                    <Text style={styles.actionBtnEditTxt}>Edit</Text>
                  </Pressable>

                  {/* Ledger Button */}
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
                    style={styles.actionBtnLedger}
                    testID={`ledger-payin-${item.id}`}
                  >
                    <Ionicons name="book-outline" size={14} color="#1E40AF" />
                    <Text style={styles.actionBtnLedgerTxt}>Ledger</Text>
                  </Pressable>

                  {/* View Details Button */}
                  <Pressable
                    onPress={() => router.push(`/accounting/income/${item.id}` as any)}
                    style={styles.actionBtnView}
                    testID={`view-payin-${item.id}`}
                  >
                    <Ionicons name="eye-outline" size={15} color="#475569" />
                    <Text style={styles.actionBtnViewTxt}>View</Text>
                  </Pressable>

                  {/* Delete Button */}
                  <Pressable
                    onPress={() => handleDelete(item)}
                    style={styles.actionBtnDelete}
                    testID={`del-payin-${item.id}`}
                  >
                    <Ionicons name="trash-outline" size={15} color="#DC2626" />
                    <Text style={styles.actionBtnDeleteTxt}>Delete</Text>
                  </Pressable>
                </View>
              </View>
            );
          }}
        />
      )}

      {/* Edit Payment In Modal */}
      <Modal
        visible={!!editingInc}
        animationType="fade"
        transparent
        onRequestClose={() => setEditingInc(null)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}
        >
          <View style={styles.modalContent}>
            {/* Modal Header */}
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>Edit Payment-In</Text>
                <Text style={styles.modalSubtitle}>{editingInc?.voucher_no || editingInc?.income_no || 'PAYIN'}</Text>
              </View>
              <Pressable
                onPress={() => setEditingInc(null)}
                style={styles.modalCloseBtn}
                hitSlop={8}
                testID="close-edit-modal-btn"
              >
                <Ionicons name="close" size={20} color="#64748B" />
              </Pressable>
            </View>

            {/* Modal Form Scroll */}
            <ScrollView style={{ maxHeight: 460 }} showsVerticalScrollIndicator={false}>
              <View style={styles.formSection}>
                {/* Amount & Date */}
                <View style={styles.formRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.formLabel}>Amount Received (₹) *</Text>
                    <TextInput
                      style={[styles.formInput, { fontWeight: '800', color: '#059669', fontSize: 16 }]}
                      keyboardType="numeric"
                      value={editForm.amount}
                      onChangeText={(t) => setEditForm((p) => ({ ...p, amount: t }))}
                      placeholder="0.00"
                      testID="edit-payin-amount"
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.formLabel}>Date (YYYY-MM-DD) *</Text>
                    <TextInput
                      style={styles.formInput}
                      value={editForm.date}
                      onChangeText={(t) => setEditForm((p) => ({ ...p, date: t }))}
                      placeholder="YYYY-MM-DD"
                      testID="edit-payin-date"
                    />
                  </View>
                </View>

                {/* Payment Mode Selector */}
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

                {/* Service Category */}
                <View>
                  <Text style={styles.formLabel}>Service Category</Text>
                  <TextInput
                    style={styles.formInput}
                    value={editForm.service_category}
                    onChangeText={(t) => setEditForm((p) => ({ ...p, service_category: t }))}
                    placeholder="e.g. Tender Services, DSC"
                    testID="edit-payin-category"
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

                {/* Customer Information Card */}
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
                        testID="edit-payin-client-name"
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
                        testID="edit-payin-client-mobile"
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
                        testID="edit-payin-client-pan"
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
                        testID="edit-payin-client-gst"
                      />
                    </View>
                  </View>
                </View>

                {/* Received By */}
                <View>
                  <Text style={styles.formLabel}>Received By / Executive Name</Text>
                  <TextInput
                    style={styles.formInput}
                    value={editForm.employee_name}
                    onChangeText={(t) => setEditForm((p) => ({ ...p, employee_name: t }))}
                    placeholder="Staff / Executive Name"
                    testID="edit-payin-employee"
                  />
                </View>

                {/* Remarks / Narration */}
                <View>
                  <Text style={styles.formLabel}>Remarks / Narration</Text>
                  <TextInput
                    style={[styles.formInput, { minHeight: 64, textAlignVertical: 'top' }]}
                    value={editForm.remarks}
                    onChangeText={(t) => setEditForm((p) => ({ ...p, remarks: t }))}
                    placeholder="Payment details, cheque no., or notes..."
                    multiline
                    numberOfLines={3}
                    testID="edit-payin-remarks"
                  />
                </View>
              </View>
            </ScrollView>

            {/* Modal Footer Buttons */}
            <View style={styles.modalFooter}>
              <Pressable
                onPress={() => setEditingInc(null)}
                style={styles.cancelBtn}
                disabled={saving}
              >
                <Text style={styles.cancelBtnTxt}>Cancel</Text>
              </Pressable>

              <Pressable
                onPress={saveEdit}
                style={styles.saveBtn}
                disabled={saving}
                testID="save-payin-btn"
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

const styles = StyleSheet.create({
  addBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#059669',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  ledgerHeaderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  ledgerHeaderBtnTxt: {
    fontSize: 11.5,
    fontWeight: '800',
    color: '#1E40AF',
  },

  /* Search & Filter Bar */
  searchSection: {
    backgroundColor: '#FFF',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    gap: 8,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
    borderRadius: radius.md,
    paddingHorizontal: 10,
    height: 44,
  },
  searchInput: {
    flex: 1,
    fontSize: font.sm,
    color: '#0F172A',
    marginLeft: 8,
    paddingVertical: 0,
  },
  clearBtn: {
    padding: 4,
  },

  /* Bank Filter Scroll & Pills */
  bankFilterScroll: {
    marginVertical: 2,
  },
  bankFilterScrollInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 2,
  },
  bankFilterPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: '#F1F5F9',
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
  },
  bankFilterPillActive: {
    backgroundColor: '#1E40AF',
    borderColor: '#1E40AF',
  },
  bankFilterPillActiveGreen: {
    backgroundColor: '#059669',
    borderColor: '#059669',
  },
  bankFilterPillTxt: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#334155',
  },
  bankFilterPillTxtActive: {
    color: '#FFFFFF',
    fontWeight: '800',
  },

  criteriaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    paddingVertical: 2,
  },
  criteriaLbl: {
    fontSize: 11,
    fontWeight: '800',
    color: '#64748B',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  chip: {
    backgroundColor: '#EEF2F6',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  chipTxt: {
    fontSize: 10,
    fontWeight: '700',
    color: '#334155',
  },
  resultBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 2,
  },
  resultTxt: {
    fontSize: font.sm,
    color: '#64748B',
  },
  resetLink: {
    fontSize: font.sm,
    fontWeight: '700',
    color: colors.brandPrimary,
  },

  /* No match */
  noMatchCard: {
    margin: spacing.lg,
    padding: spacing.xl,
    backgroundColor: '#FFF',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
    gap: 10,
  },
  noMatchTitle: {
    fontSize: font.base,
    fontWeight: '800',
    color: '#0F172A',
    textAlign: 'center',
  },
  noMatchSub: {
    fontSize: font.sm,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 18,
  },
  clearSearchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.brandPrimary,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: radius.md,
    marginTop: 6,
  },
  clearSearchBtnTxt: {
    color: '#FFF',
    fontWeight: '700',
    fontSize: font.sm,
  },

  /* Card */
  card: {
    backgroundColor: '#FFF',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: spacing.md,
    gap: 8,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  vNo: {
    color: colors.brandPrimary,
    fontWeight: '800',
    fontSize: font.base,
    letterSpacing: 0.5,
  },
  dateTxt: {
    color: '#64748B',
    fontSize: font.sm,
  },
  clientTitle: {
    fontSize: font.base,
    fontWeight: '800',
    color: '#0F172A',
    marginTop: 2,
  },
  amtTxt: {
    fontSize: font.lg,
    fontWeight: '900',
    color: '#059669',
  },
  receivedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: radius.pill,
  },
  receivedBadgeTxt: {
    fontSize: 9,
    fontWeight: '800',
    color: '#059669',
    letterSpacing: 0.5,
  },
  attachChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  attachTxt: {
    color: colors.brandPrimary,
    fontSize: 10,
    fontWeight: '800',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  categoryBadge: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  categoryBadgeTxt: {
    fontSize: 11,
    fontWeight: '700',
    color: '#334155',
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
  byEmpTxt: {
    fontSize: 11,
    color: '#64748B',
  },
  custMetaContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingTop: 2,
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
  remarksTxt: {
    fontSize: font.sm,
    color: '#475569',
    backgroundColor: '#F8FAFC',
    padding: 8,
    borderRadius: 6,
    fontStyle: 'italic',
  },

  /* Card Actions: Print, Edit, Ledger, View, Delete */
  cardActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  actionBtnPrint: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    paddingVertical: 7,
    borderRadius: radius.md,
  },
  actionBtnPrintTxt: {
    color: '#047857',
    fontWeight: '800',
    fontSize: font.sm,
  },
  actionBtnEdit: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    backgroundColor: '#EEF2FF',
    borderWidth: 1,
    borderColor: '#C7D2FE',
    paddingVertical: 7,
    borderRadius: radius.md,
  },
  actionBtnEditTxt: {
    color: '#4338CA',
    fontWeight: '800',
    fontSize: font.sm,
  },
  actionBtnLedger: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    paddingVertical: 7,
    borderRadius: radius.md,
  },
  actionBtnLedgerTxt: {
    color: '#1E40AF',
    fontWeight: '800',
    fontSize: font.sm,
  },
  actionBtnView: {
    flex: 0.8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingVertical: 7,
    borderRadius: radius.md,
  },
  actionBtnViewTxt: {
    color: '#475569',
    fontWeight: '700',
    fontSize: font.sm,
  },
  actionBtnDelete: {
    flex: 0.8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    paddingVertical: 7,
    borderRadius: radius.md,
  },
  actionBtnDeleteTxt: {
    color: '#DC2626',
    fontWeight: '800',
    fontSize: font.sm,
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
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
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

  /* Bank selection chips in edit modal */
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

  /* Add Bank Modal Box */
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
