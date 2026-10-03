import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  Modal,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
  TextInput,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, font, shadow } from '@/src/theme';
import { api } from '@/src/api';
import { Card, EmptyState, ScreenLoader, PrimaryButton } from '@/src/ui';
import { ScreenHeader } from '@/src/ScreenHeader';
import { FormInput, OptionRow } from '@/src/forms';

const HEADER_BG = '#FFFFFF';
const HEADER_FG = '#0F172A';
const NAVY = '#00104A';
const BLUE = '#2563EB';
const GREEN = '#059669';
const RED = '#DC2626';

const inr = (n: any) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

type TabKey = 'banks' | 'cash' | 'cheques' | 'loans';

interface BankAccount {
  id: string;
  name: string;
  bank_name: string;
  account_no: string;
  ifsc?: string;
  opening_balance: number;
}

interface ChequeItem {
  id: string;
  cheque_no: string;
  cheque_date: string;
  customer_id?: string;
  customer_name: string;
  bank_name: string;
  amount: number;
  reference_no: string;
  status: 'open' | 'closed';
  deposit_date?: string;
  deposit_to?: string;
  deposit_to_name?: string;
  deposit_description?: string;
  description?: string;
}

interface LoanAccount {
  id: string;
  account_name: string;
  account_number: string;
  lender_bank: string;
  description?: string;
  opening_balance: number;
  current_balance?: number;
  balance_as_of: string;
  loan_received_in: string;
  loan_received_in_name?: string;
  interest_rate: number;
  duration_months: number;
  processing_fee: number;
  emi_amount?: number;
}

export default function CashBankScreen() {
  const router = useRouter();
  const searchParams = useLocalSearchParams();
  const initialTab = (searchParams.tab as TabKey) || 'banks';

  const [activeTab, setActiveTab] = useState<TabKey>(initialTab);

  useEffect(() => {
    if (searchParams.tab && ['banks', 'cash', 'cheques', 'loans'].includes(searchParams.tab as string)) {
      setActiveTab(searchParams.tab as TabKey);
    }
  }, [searchParams.tab]);

  // Data states
  const [banks, setBanks] = useState<BankAccount[]>([]);
  const [cashSummary, setCashSummary] = useState<any>(null);
  const [cheques, setCheques] = useState<ChequeItem[]>([]);
  const [chequeCounts, setChequeCounts] = useState({ open_count: 0, closed_count: 0, total_count: 0, open_amount: 0 });
  const [chequeFilter, setChequeFilter] = useState<'open' | 'closed' | 'all'>('all');
  const [loans, setLoans] = useState<LoanAccount[]>([]);
  const [loanSummary, setLoanSummary] = useState({ total_sanctioned: 0, total_outstanding: 0, active_loans_count: 0 });

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Modals
  const [showAddBank, setShowAddBank] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [transferModalMode, setTransferModalMode] = useState<'bank_to_cash' | 'cash_to_bank' | 'bank_to_bank' | 'adjust_balance'>('bank_to_cash');

  // Cheque Deposit Modal
  const [showChequeDepositModal, setShowChequeDepositModal] = useState(false);
  const [selectedCheque, setSelectedCheque] = useState<ChequeItem | null>(null);
  const [chequeDepositDate, setChequeDepositDate] = useState(new Date().toISOString().split('T')[0]);
  const [chequeDepositTarget, setChequeDepositTarget] = useState<string>('cash');
  const [chequeDepositDesc, setChequeDepositDesc] = useState('');
  const [chequeBusy, setChequeBusy] = useState(false);

  // Add Loan Account Modal
  const [showAddLoanModal, setShowAddLoanModal] = useState(false);
  const [loanForm, setLoanForm] = useState({
    account_name: '',
    account_number: '',
    lender_bank: '',
    description: '',
    opening_balance: '',
    balance_as_of: new Date().toISOString().split('T')[0],
    loan_received_in: 'cash',
    interest_rate: '8.5',
    duration_months: '36',
    processing_fee: '0',
  });
  const [loanBusy, setLoanBusy] = useState(false);
  const [loanErr, setLoanErr] = useState<string | null>(null);

  // Add Bank Form state
  const [bankForm, setBankForm] = useState({
    name: '',
    bank_name: '',
    account_no: '',
    ifsc: '',
    opening_balance: '0',
  });
  const [bankBusy, setBankBusy] = useState(false);
  const [bankErr, setBankErr] = useState<string | null>(null);

  // Transfer Form state
  const [transferForm, setTransferForm] = useState<{
    transfer_type: 'bank_to_cash' | 'cash_to_bank' | 'bank_to_bank' | 'adjust_balance';
    direction: 'deposit' | 'withdraw';
    adjust_action: 'increase' | 'reduce';
    transfer_date: string;
    deposit_to: string;
    withdraw_from: string;
    account_id: string;
    amount: string;
    description: string;
    attachment_url?: string;
    attachment_name?: string;
  }>({
    transfer_type: 'bank_to_cash',
    direction: 'deposit',
    adjust_action: 'increase',
    transfer_date: new Date().toISOString().split('T')[0],
    deposit_to: '',
    withdraw_from: '',
    account_id: '',
    amount: '',
    description: '',
  });
  const [transferBusy, setTransferBusy] = useState(false);
  const [transferErr, setTransferErr] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);

  // Load all Cash & Bank Data
  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [banksRes, cashRes, chqRes, loansRes] = await Promise.all([
        api.getCashBankAccounts().catch(() => []),
        api.getCashSummary().catch(() => null),
        api.getCheques('all').catch(() => ({ cheques: [], open_count: 0, closed_count: 0, total_count: 0, open_amount: 0 })),
        api.getLoanAccounts().catch(() => ({ loans: [], total_sanctioned: 0, total_outstanding: 0, active_loans_count: 0 })),
      ]);

      setBanks(banksRes || []);
      setCashSummary(cashRes);
      setCheques(chqRes?.cheques || []);
      setChequeCounts({
        open_count: chqRes?.open_count || 0,
        closed_count: chqRes?.closed_count || 0,
        total_count: chqRes?.total_count || 0,
        open_amount: chqRes?.open_amount || 0,
      });
      setLoans(loansRes?.loans || []);
      setLoanSummary({
        total_sanctioned: loansRes?.total_sanctioned || 0,
        total_outstanding: loansRes?.total_outstanding || 0,
        active_loans_count: loansRes?.active_loans_count || 0,
      });

      // Default selector values for transfer
      if (banksRes && banksRes.length > 0) {
        setTransferForm(prev => ({
          ...prev,
          withdraw_from: prev.withdraw_from || banksRes[0].id,
          deposit_to: prev.deposit_to || (banksRes[1] ? banksRes[1].id : banksRes[0].id),
          account_id: prev.account_id || banksRes[0].id,
        }));
      }
    } catch (err: any) {
      console.error('Failed to load cash bank data', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    loadData();
  }, [loadData]));

  // Image Upload Handler
  const handleUploadImage = async () => {
    if (Platform.OS === 'web') {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*,application/pdf';
      input.onchange = async (e: any) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const objectUrl = URL.createObjectURL(file);
        try {
          setUploadingImage(true);
          const res = await api.uploadCashBankAttachment({ uri: objectUrl, name: file.name, type: file.type });
          setTransferForm(prev => ({
            ...prev,
            attachment_url: res.attachment_url,
            attachment_name: res.attachment_name,
          }));
        } catch (err: any) {
          Alert.alert('Upload Error', err?.message || 'Could not upload attachment');
        } finally {
          setUploadingImage(false);
        }
      };
      input.click();
    } else {
      Alert.alert('Attachment', 'Please select attachment on web or modern browser.');
    }
  };

  const handleClearImage = () => {
    setTransferForm(prev => ({
      ...prev,
      attachment_url: undefined,
      attachment_name: undefined,
    }));
  };

  // Open Deposit/Withdraw Modal
  const openTransferModal = (mode: 'bank_to_cash' | 'cash_to_bank' | 'bank_to_bank' | 'adjust_balance') => {
    setTransferModalMode(mode);
    setTransferErr(null);
    setTransferForm({
      transfer_type: mode,
      direction: 'deposit',
      adjust_action: 'increase',
      transfer_date: new Date().toISOString().split('T')[0],
      deposit_to: mode === 'cash_to_bank' ? (banks[0]?.id || '') : (banks[1]?.id || banks[0]?.id || ''),
      withdraw_from: mode === 'cash_to_bank' ? 'Cash in Hand' : (banks[0]?.id || ''),
      account_id: banks[0]?.id || '',
      amount: '',
      description: '',
      attachment_url: undefined,
      attachment_name: undefined,
    });
    setShowTransferModal(true);
  };

  // Execute Transfer
  const handleSaveTransfer = async () => {
    const amt = parseFloat(transferForm.amount);
    if (isNaN(amt) || amt <= 0) {
      setTransferErr('Please enter a valid positive amount.');
      return;
    }

    setTransferBusy(true);
    setTransferErr(null);
    try {
      const payload: any = {
        transfer_type: transferModalMode,
        transfer_date: transferForm.transfer_date,
        amount: amt,
        description: transferForm.description || undefined,
        attachment_path: transferForm.attachment_url,
        attachment_name: transferForm.attachment_name,
      };

      if (transferModalMode === 'bank_to_cash') {
        payload.direction = transferForm.direction;
        if (transferForm.direction === 'deposit') {
          payload.deposit_to = 'Cash in Hand';
          payload.withdraw_from = transferForm.withdraw_from || banks[0]?.id;
        } else {
          payload.deposit_to = transferForm.withdraw_from || banks[0]?.id;
          payload.withdraw_from = 'Cash in Hand';
        }
      } else if (transferModalMode === 'cash_to_bank') {
        payload.direction = transferForm.direction;
        payload.withdraw_from = 'Cash in Hand';
        payload.deposit_to = transferForm.deposit_to || banks[0]?.id;
      } else if (transferModalMode === 'bank_to_bank') {
        if (transferForm.withdraw_from === transferForm.deposit_to) {
          setTransferErr('Source and Destination banks must be different.');
          setTransferBusy(false);
          return;
        }
        payload.withdraw_from = transferForm.withdraw_from;
        payload.deposit_to = transferForm.deposit_to;
      } else if (transferModalMode === 'adjust_balance') {
        payload.adjust_action = transferForm.adjust_action;
        payload.account_id = transferForm.account_id || banks[0]?.id;
      }

      await api.executeCashBankTransfer(payload);
      setShowTransferModal(false);
      await loadData();
      Alert.alert('Success', 'Transaction recorded successfully!');
    } catch (e: any) {
      setTransferErr(e?.message || 'Transaction failed');
    } finally {
      setTransferBusy(false);
    }
  };

  // Add Bank Account
  const handleSaveBank = async () => {
    if (!bankForm.name.trim() || !bankForm.bank_name.trim() || !bankForm.account_no.trim()) {
      setBankErr('Account Nickname, Bank Name, and Account Number are required.');
      return;
    }
    setBankBusy(true);
    setBankErr(null);
    try {
      await api.post('/bank-accounts', {
        name: bankForm.name.trim(),
        bank_name: bankForm.bank_name.trim(),
        account_no: bankForm.account_no.trim(),
        ifsc: bankForm.ifsc.trim() || null,
        opening_balance: parseFloat(bankForm.opening_balance) || 0,
        is_active: true,
      });
      setShowAddBank(false);
      setBankForm({ name: '', bank_name: '', account_no: '', ifsc: '', opening_balance: '0' });
      await loadData();
      Alert.alert('Success', 'Bank account added successfully!');
    } catch (e: any) {
      setBankErr(e?.message || 'Failed to add bank');
    } finally {
      setBankBusy(false);
    }
  };

  // Cheque Deposit Action
  const handleOpenChequeDeposit = (chq: ChequeItem) => {
    setSelectedCheque(chq);
    setChequeDepositDate(new Date().toISOString().split('T')[0]);
    setChequeDepositTarget(banks[0]?.id || 'cash');
    setChequeDepositDesc(`Cheque cleared #${chq.cheque_no}`);
    setShowChequeDepositModal(true);
  };

  const handleConfirmChequeDeposit = async () => {
    if (!selectedCheque) return;
    setChequeBusy(true);
    try {
      await api.depositCheque(selectedCheque.id, {
        transfer_date: chequeDepositDate,
        deposit_to: chequeDepositTarget,
        description: chequeDepositDesc,
      });
      setShowChequeDepositModal(false);
      setSelectedCheque(null);
      await loadData();
      Alert.alert('Cheque Deposited', `Cheque #${selectedCheque.cheque_no} deposited and marked Closed.`);
    } catch (e: any) {
      Alert.alert('Deposit Error', e?.message || 'Failed to deposit cheque');
    } finally {
      setChequeBusy(false);
    }
  };

  // Add Loan Account
  const handleSaveLoan = async () => {
    if (!loanForm.account_name.trim() || !loanForm.account_number.trim() || !loanForm.lender_bank.trim()) {
      setLoanErr('Account Name, Account Number, and Lender Bank are required.');
      return;
    }
    const openBal = parseFloat(loanForm.opening_balance);
    if (isNaN(openBal) || openBal <= 0) {
      setLoanErr('Please enter a valid loan amount.');
      return;
    }

    setLoanBusy(true);
    setLoanErr(null);
    try {
      await api.createLoanAccount({
        account_name: loanForm.account_name.trim(),
        account_number: loanForm.account_number.trim(),
        lender_bank: loanForm.lender_bank.trim(),
        description: loanForm.description.trim() || null,
        opening_balance: openBal,
        balance_as_of: loanForm.balance_as_of,
        loan_received_in: loanForm.loan_received_in,
        interest_rate: parseFloat(loanForm.interest_rate) || 8.5,
        duration_months: parseInt(loanForm.duration_months, 10) || 36,
        processing_fee: parseFloat(loanForm.processing_fee) || 0,
      });
      setShowAddLoanModal(false);
      setLoanForm({
        account_name: '',
        account_number: '',
        lender_bank: '',
        description: '',
        opening_balance: '',
        balance_as_of: new Date().toISOString().split('T')[0],
        loan_received_in: 'cash',
        interest_rate: '8.5',
        duration_months: '36',
        processing_fee: '0',
      });
      await loadData();
      Alert.alert('Loan Account Created', 'Loan account added successfully!');
    } catch (e: any) {
      setLoanErr(e?.message || 'Failed to create loan account');
    } finally {
      setLoanBusy(false);
    }
  };

  // Filtered Cheques list
  const filteredCheques = useMemo(() => {
    if (chequeFilter === 'open') return cheques.filter(c => c.status === 'open');
    if (chequeFilter === 'closed') return cheques.filter(c => c.status === 'closed');
    return cheques;
  }, [cheques, chequeFilter]);

  // Total Bank Balances
  const totalBankBalance = useMemo(() => {
    return banks.reduce((acc, b) => acc + Number(b.opening_balance || 0), 0);
  }, [banks]);

  return (
    <View style={styles.root} testID="cash-bank-screen">
      {/* Top Header */}
      <SafeAreaView edges={['top']} style={{ backgroundColor: HEADER_BG, borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.headerBackBtn} hitSlop={8} testID="cash-bank-back-btn">
            <Ionicons name="arrow-back" size={20} color={HEADER_FG} />
          </Pressable>
          <View style={{ flex: 1, marginLeft: 8 }}>
            <Text style={styles.headerTitle}>Cash & Bank</Text>
            <Text style={styles.headerSub}>My Business • Vyapar Financial Management</Text>
          </View>
          <Pressable onPress={loadData} hitSlop={10} style={styles.headerRefreshBtn}>
            <Ionicons name="refresh" size={18} color={BLUE} />
          </Pressable>
        </View>
      </SafeAreaView>

      {/* 4 Sub Menus Tab Row */}
      <View style={styles.tabBar}>
        {[
          { key: 'banks', label: 'Bank Accounts', icon: 'business' },
          { key: 'cash', label: 'Cash in Hand', icon: 'cash' },
          { key: 'cheques', label: `Cheques (${chequeCounts.open_count})`, icon: 'newspaper' },
          { key: 'loans', label: 'Loan Accounts', icon: 'wallet' },
        ].map(t => {
          const isActive = activeTab === t.key;
          return (
            <Pressable
              key={t.key}
              testID={`subtab-${t.key}`}
              onPress={() => setActiveTab(t.key as TabKey)}
              style={[styles.tabButton, isActive && styles.tabButtonActive]}
            >
              <Ionicons name={t.icon as any} size={16} color={isActive ? BLUE : colors.muted} />
              <Text style={[styles.tabButtonText, isActive && styles.tabButtonTextActive]}>
                {t.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {loading ? (
        <ScreenLoader />
      ) : (
        <ScrollView contentContainerStyle={styles.contentContainer}>
          {/* ========================================================================= */}
          {/* 1. BANK ACCOUNTS SUB MENU */}
          {/* ========================================================================= */}
          {activeTab === 'banks' && (
            <View testID="tab-banks-content">
              {/* Top Banner */}
              <View style={styles.overviewCard}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.overviewLabel}>TOTAL BANK BALANCE</Text>
                  <Text style={[styles.overviewVal, { color: totalBankBalance >= 0 ? GREEN : RED }]}>
                    {inr(totalBankBalance)}
                  </Text>
                  <Text style={styles.overviewSub}>{banks.length} Connected Accounts</Text>
                </View>
                <View style={styles.headerActionRow}>
                  {/* Add Bank Button */}
                  <Pressable
                    testID="btn-add-bank"
                    onPress={() => { setBankErr(null); setShowAddBank(true); }}
                    style={styles.addBankBtn}
                  >
                    <Ionicons name="add-circle" size={16} color="#FFF" />
                    <Text style={styles.btnTextWhite}>Add Bank</Text>
                  </Pressable>

                  {/* Deposit / Withdraw Button */}
                  <Pressable
                    testID="btn-deposit-withdraw"
                    onPress={() => openTransferModal('bank_to_cash')}
                    style={styles.depWithBtn}
                  >
                    <Ionicons name="swap-vertical" size={16} color="#FFF" />
                    <Text style={styles.btnTextWhite}>Deposit / Withdraw</Text>
                  </Pressable>
                </View>
              </View>

              {/* Transfer Shortcut Cards */}
              <View style={styles.shortcutRow}>
                <Pressable
                  testID="shortcut-bank-cash"
                  style={styles.shortcutCard}
                  onPress={() => openTransferModal('bank_to_cash')}
                >
                  <View style={[styles.shortcutIconWrap, { backgroundColor: '#DCFCE7' }]}>
                    <Ionicons name="arrow-down-outline" size={18} color={GREEN} />
                  </View>
                  <Text style={styles.shortcutTitle}>Bank to Cash</Text>
                  <Text style={styles.shortcutDesc}>Withdraw counter cash</Text>
                </Pressable>

                <Pressable
                  testID="shortcut-cash-bank"
                  style={styles.shortcutCard}
                  onPress={() => openTransferModal('cash_to_bank')}
                >
                  <View style={[styles.shortcutIconWrap, { backgroundColor: '#DBEAFE' }]}>
                    <Ionicons name="arrow-up-outline" size={18} color={BLUE} />
                  </View>
                  <Text style={styles.shortcutTitle}>Cash to Bank</Text>
                  <Text style={styles.shortcutDesc}>Deposit store cash</Text>
                </Pressable>

                <Pressable
                  testID="shortcut-bank-bank"
                  style={styles.shortcutCard}
                  onPress={() => openTransferModal('bank_to_bank')}
                >
                  <View style={[styles.shortcutIconWrap, { backgroundColor: '#EDE9FE' }]}>
                    <Ionicons name="swap-horizontal" size={18} color="#7C3AED" />
                  </View>
                  <Text style={styles.shortcutTitle}>Bank to Bank</Text>
                  <Text style={styles.shortcutDesc}>Inter-account transfer</Text>
                </Pressable>

                <Pressable
                  testID="shortcut-adjust-balance"
                  style={styles.shortcutCard}
                  onPress={() => openTransferModal('adjust_balance')}
                >
                  <View style={[styles.shortcutIconWrap, { backgroundColor: '#FEF3C7' }]}>
                    <Ionicons name="options-outline" size={18} color="#D97706" />
                  </View>
                  <Text style={styles.shortcutTitle}>Adjust Balance</Text>
                  <Text style={styles.shortcutDesc}>Fix bank ledger diff</Text>
                </Pressable>
              </View>

              {/* Bank Accounts List */}
              <Text style={styles.sectionHeading}>Your Bank Accounts</Text>
              {banks.length === 0 ? (
                <EmptyState
                  testID="empty-banks"
                  icon="business-outline"
                  title="No Bank Accounts"
                  actionLabel="Add Bank Account"
                  onAction={() => setShowAddBank(true)}
                />
              ) : (
                banks.map(b => (
                  <View key={b.id} style={styles.bankItemCard} testID={`bank-card-${b.id}`}>
                    <View style={styles.bankItemHeader}>
                      <View style={styles.bankItemAvatar}>
                        <Ionicons name="business" size={20} color={BLUE} />
                      </View>
                      <View style={{ flex: 1, marginLeft: 10 }}>
                        <Text style={styles.bankItemName}>{b.name}</Text>
                        <Text style={styles.bankItemSub}>{b.bank_name} • A/c {b.account_no}</Text>
                        {b.ifsc ? <Text style={styles.bankItemSub}>IFSC: {b.ifsc}</Text> : null}
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={styles.bankItemBalLabel}>Current Balance</Text>
                        <Text style={[styles.bankItemBal, { color: b.opening_balance >= 0 ? GREEN : RED }]}>
                          {inr(b.opening_balance)}
                        </Text>
                      </View>
                    </View>
                  </View>
                ))
              )}
            </View>
          )}

          {/* ========================================================================= */}
          {/* 2. CASH IN HAND SUB MENU */}
          {/* ========================================================================= */}
          {activeTab === 'cash' && (
            <View testID="tab-cash-content">
              {/* Cash Summary Banner */}
              <View style={[styles.overviewCard, { backgroundColor: '#F0FDF4', borderColor: '#BBF7D0' }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.overviewLabel, { color: GREEN }]}>CASH IN HAND (CURRENT)</Text>
                  <Text style={[styles.overviewVal, { color: GREEN }]}>
                    {inr(cashSummary?.cash_in_hand || 0)}
                  </Text>
                  <Text style={styles.overviewSub}>
                    Opening Cash: {inr(cashSummary?.opening_cash || 25000)}
                  </Text>
                </View>

                {/* Bank Transfer Button on Cash in Hand */}
                <Pressable
                  testID="btn-cash-transfer"
                  onPress={() => openTransferModal('bank_to_cash')}
                  style={[styles.depWithBtn, { backgroundColor: GREEN }]}
                >
                  <Ionicons name="swap-horizontal" size={16} color="#FFF" />
                  <Text style={styles.btnTextWhite}>Bank Transfer</Text>
                </Pressable>
              </View>

              {/* Inflow vs Outflow Mini-Stats */}
              <View style={styles.statGrid}>
                <View style={styles.statCard}>
                  <Text style={styles.statLabel}>Cash Sales & Receipts</Text>
                  <Text style={[styles.statVal, { color: GREEN }]}>
                    +{inr(cashSummary?.total_cash_sales || 0)}
                  </Text>
                </View>
                <View style={styles.statCard}>
                  <Text style={styles.statLabel}>Cash Expenses & Outflows</Text>
                  <Text style={[styles.statVal, { color: RED }]}>
                    -{inr(cashSummary?.total_cash_expenses || 0)}
                  </Text>
                </View>
                <View style={styles.statCard}>
                  <Text style={styles.statLabel}>Withdrawn from Banks</Text>
                  <Text style={[styles.statVal, { color: BLUE }]}>
                    +{inr(cashSummary?.cash_from_banks || 0)}
                  </Text>
                </View>
                <View style={styles.statCard}>
                  <Text style={styles.statLabel}>Deposited to Banks</Text>
                  <Text style={[styles.statVal, { color: '#7C3AED' }]}>
                    -{inr(cashSummary?.cash_to_banks || 0)}
                  </Text>
                </View>
              </View>

              {/* Recent Cash Ledger */}
              <Text style={styles.sectionHeading}>Recent Cash & Contra Transactions</Text>
              {cashSummary?.recent_entries && cashSummary.recent_entries.length > 0 ? (
                cashSummary.recent_entries.map((tx: any) => (
                  <View key={tx.id} style={styles.txRowCard}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.txParticulars}>{tx.particulars}</Text>
                      <Text style={styles.txDate}>{tx.date} • {tx.mode}</Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      {tx.inflow !== '—' && (
                        <Text style={[styles.txAmount, { color: GREEN }]}>+{tx.inflow}</Text>
                      )}
                      {tx.outflow !== '—' && (
                        <Text style={[styles.txAmount, { color: RED }]}>-{tx.outflow}</Text>
                      )}
                    </View>
                  </View>
                ))
              ) : (
                <View style={styles.emptyCard}>
                  <Ionicons name="document-text-outline" size={32} color={colors.muted} />
                  <Text style={{ color: colors.muted, marginTop: 6 }}>No recent contra cash entries recorded.</Text>
                </View>
              )}
            </View>
          )}

          {/* ========================================================================= */}
          {/* 3. CHEQUES SUB MENU */}
          {/* ========================================================================= */}
          {activeTab === 'cheques' && (
            <View testID="tab-cheques-content">
              {/* Cheques Filter Pills */}
              <View style={styles.chequeFilterRow}>
                {(['open', 'closed', 'all'] as const).map(tab => {
                  const isActive = chequeFilter === tab;
                  const label = tab === 'open'
                    ? `Open Cheques (${chequeCounts.open_count})`
                    : tab === 'closed'
                    ? `Closed Cheques (${chequeCounts.closed_count})`
                    : `All Cheques (${chequeCounts.total_count})`;
                  return (
                    <Pressable
                      key={tab}
                      testID={`chq-filter-${tab}`}
                      onPress={() => setChequeFilter(tab)}
                      style={[styles.chequeFilterPill, isActive && styles.chequeFilterPillActive]}
                    >
                      <Text style={[styles.chequeFilterText, isActive && styles.chequeFilterTextActive]}>
                        {label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {/* Open Cheques Total Value Banner */}
              <View style={[styles.overviewCard, { backgroundColor: '#EFF6FF', borderColor: '#BFDBFE' }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.overviewLabel, { color: BLUE }]}>TOTAL OPEN CHEQUES AMOUNT</Text>
                  <Text style={[styles.overviewVal, { color: BLUE }]}>
                    {inr(chequeCounts.open_amount)}
                  </Text>
                  <Text style={styles.overviewSub}>{chequeCounts.open_count} Cheques awaiting deposit</Text>
                </View>
              </View>

              {/* Cheques Listing */}
              <Text style={styles.sectionHeading}>Cheques Received from Parties</Text>
              {filteredCheques.length === 0 ? (
                <View style={styles.emptyCard}>
                  <Ionicons name="newspaper-outline" size={36} color={colors.muted} />
                  <Text style={{ color: colors.muted, marginTop: 8 }}>No cheques found in this section.</Text>
                </View>
              ) : (
                filteredCheques.map(c => {
                  const isOpen = c.status === 'open';
                  return (
                    <View key={c.id} style={styles.chequeCard} testID={`cheque-card-${c.id}`}>
                      <View style={styles.chequeHeader}>
                        <View>
                          <Text style={styles.chequeNo}>{c.cheque_no}</Text>
                          <Text style={styles.chequeDate}>Date: {c.cheque_date}</Text>
                        </View>
                        <View style={{ alignItems: 'flex-end' }}>
                          <Text style={styles.chequeAmount}>{inr(c.amount)}</Text>
                          <View style={[styles.statusBadge, { backgroundColor: isOpen ? '#FEF3C7' : '#DCFCE7' }]}>
                            <Text style={[styles.statusBadgeText, { color: isOpen ? '#D97706' : GREEN }]}>
                              {isOpen ? 'OPEN' : 'CLOSED / DEPOSITED'}
                            </Text>
                          </View>
                        </View>
                      </View>

                      <View style={styles.chequeDetails}>
                        <Text style={styles.chequeParty}>Party: <Text style={{ fontWeight: '700' }}>{c.customer_name}</Text></Text>
                        <Text style={styles.chequeSub}>Drawn Bank: {c.bank_name}</Text>
                        <Text style={styles.chequeSub}>Ref No: {c.reference_no}</Text>
                        {c.description ? <Text style={styles.chequeDesc}>Note: {c.description}</Text> : null}

                        {c.status === 'closed' && (
                          <View style={styles.clearedBanner}>
                            <Ionicons name="checkmark-done-circle" size={16} color={GREEN} />
                            <Text style={styles.clearedBannerText}>
                              Cleared to {c.deposit_to_name || c.deposit_to} on {c.deposit_date}
                            </Text>
                          </View>
                        )}
                      </View>

                      {isOpen && (
                        <View style={styles.chequeActionRow}>
                          <Pressable
                            testID={`deposit-btn-${c.id}`}
                            onPress={() => handleOpenChequeDeposit(c)}
                            style={styles.depositBtn}
                          >
                            <Ionicons name="cloud-upload" size={16} color="#FFF" />
                            <Text style={styles.btnTextWhite}>Deposit</Text>
                          </Pressable>
                        </View>
                      )}
                    </View>
                  );
                })
              )}
            </View>
          )}

          {/* ========================================================================= */}
          {/* 4. LOAN ACCOUNTS SUB MENU */}
          {/* ========================================================================= */}
          {activeTab === 'loans' && (
            <View testID="tab-loans-content">
              {/* Loans Overview Banner */}
              <View style={[styles.overviewCard, { backgroundColor: '#FFF7ED', borderColor: '#FED7AA' }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.overviewLabel, { color: '#EA580C' }]}>OUTSTANDING LOAN LIABILITY</Text>
                  <Text style={[styles.overviewVal, { color: '#EA580C' }]}>
                    {inr(loanSummary.total_outstanding)}
                  </Text>
                  <Text style={styles.overviewSub}>
                    Sanctioned: {inr(loanSummary.total_sanctioned)} • {loanSummary.active_loans_count} Loans
                  </Text>
                </View>

                {/* Add Loan Account Button */}
                <Pressable
                  testID="btn-add-loan"
                  onPress={() => { setLoanErr(null); setShowAddLoanModal(true); }}
                  style={[styles.depWithBtn, { backgroundColor: '#EA580C' }]}
                >
                  <Ionicons name="add-circle" size={16} color="#FFF" />
                  <Text style={styles.btnTextWhite}>Add Loan Account</Text>
                </Pressable>
              </View>

              {/* Loans Listing */}
              <Text style={styles.sectionHeading}>Business Loan Accounts</Text>
              {loans.length === 0 ? (
                <EmptyState
                  testID="empty-loans"
                  icon="wallet-outline"
                  title="No Loan Accounts"
                  actionLabel="Add Loan Account"
                  onAction={() => setShowAddLoanModal(true)}
                />
              ) : (
                loans.map(l => (
                  <View key={l.id} style={styles.loanCard} testID={`loan-card-${l.id}`}>
                    <View style={styles.loanCardHeader}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.loanName}>{l.account_name}</Text>
                        <Text style={styles.loanSub}>{l.lender_bank} • A/c {l.account_number}</Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={styles.loanBalLabel}>Outstanding</Text>
                        <Text style={styles.loanBalVal}>{inr(l.current_balance ?? l.opening_balance)}</Text>
                      </View>
                    </View>

                    <View style={styles.loanDetailsGrid}>
                      <View style={styles.loanDetailItem}>
                        <Text style={styles.loanDetailLabel}>Sanctioned</Text>
                        <Text style={styles.loanDetailVal}>{inr(l.opening_balance)}</Text>
                      </View>
                      <View style={styles.loanDetailItem}>
                        <Text style={styles.loanDetailLabel}>Interest Rate</Text>
                        <Text style={styles.loanDetailVal}>{l.interest_rate}% p.a.</Text>
                      </View>
                      <View style={styles.loanDetailItem}>
                        <Text style={styles.loanDetailLabel}>Duration</Text>
                        <Text style={styles.loanDetailVal}>{l.duration_months} Months</Text>
                      </View>
                      <View style={styles.loanDetailItem}>
                        <Text style={styles.loanDetailLabel}>Est. Monthly EMI</Text>
                        <Text style={[styles.loanDetailVal, { color: GREEN, fontWeight: '800' }]}>
                          {inr(l.emi_amount)}
                        </Text>
                      </View>
                    </View>

                    <View style={styles.loanFooter}>
                      <Text style={styles.loanFooterText}>
                        Disbursed into: <Text style={{ fontWeight: '600' }}>{l.loan_received_in_name || l.loan_received_in}</Text> • As of: {l.balance_as_of}
                      </Text>
                      {l.processing_fee ? (
                        <Text style={styles.loanFooterText}>Processing Fee: {inr(l.processing_fee)}</Text>
                      ) : null}
                    </View>
                  </View>
                ))
              )}
            </View>
          )}
        </ScrollView>
      )}

      {/* ========================================================================= */}
      {/* MODAL 1: ADD BANK ACCOUNT */}
      {/* ========================================================================= */}
      <Modal transparent visible={showAddBank} animationType="slide" onRequestClose={() => setShowAddBank(false)}>
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ width: '100%', maxWidth: 540 }}>
            <View style={styles.modalCard}>
              <View style={styles.modalHeader}>
                <View>
                  <Text style={styles.modalTitle}>Add Bank Account</Text>
                  <Text style={styles.modalSubtitle}>Register company current or savings bank account</Text>
                </View>
                <Pressable onPress={() => setShowAddBank(false)} hitSlop={10} testID="close-add-bank">
                  <Ionicons name="close" size={22} color={colors.onSurface} />
                </Pressable>
              </View>

              <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
                <FormInput
                  label="Account Nickname *"
                  value={bankForm.name}
                  onChangeText={v => setBankForm(p => ({ ...p, name: v }))}
                  placeholder="e.g. SBI Main Current A/c"
                  testID="in-bank-nickname"
                />
                <FormInput
                  label="Bank Name *"
                  value={bankForm.bank_name}
                  onChangeText={v => setBankForm(p => ({ ...p, bank_name: v }))}
                  placeholder="e.g. State Bank of India"
                  testID="in-bank-bankname"
                />
                <FormInput
                  label="Account Number *"
                  value={bankForm.account_no}
                  onChangeText={v => setBankForm(p => ({ ...p, account_no: v }))}
                  placeholder="e.g. 39485720192"
                  keyboardType="number-pad"
                  testID="in-bank-accno"
                />
                <FormInput
                  label="IFSC Code"
                  value={bankForm.ifsc}
                  onChangeText={v => setBankForm(p => ({ ...p, ifsc: v }))}
                  placeholder="e.g. SBIN0001234"
                  testID="in-bank-ifsc"
                />
                <FormInput
                  label="Opening Balance (₹)"
                  value={bankForm.opening_balance}
                  onChangeText={v => setBankForm(p => ({ ...p, opening_balance: v }))}
                  keyboardType="numeric"
                  testID="in-bank-openbal"
                />

                {bankErr && <Text style={styles.errorText}>{bankErr}</Text>}

                <PrimaryButton label="Save Bank Account" onPress={handleSaveBank} loading={bankBusy} testID="submit-add-bank" />
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* ========================================================================= */}
      {/* MODAL 2: DEPOSIT / WITHDRAW MODAL (4 TABS) */}
      {/* ========================================================================= */}
      <Modal transparent visible={showTransferModal} animationType="slide" onRequestClose={() => setShowTransferModal(false)}>
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ width: '100%', maxWidth: 580 }}>
            <View style={styles.modalCard}>
              <View style={styles.modalHeader}>
                <View>
                  <Text style={styles.modalTitle}>Deposit / Withdraw</Text>
                  <Text style={styles.modalSubtitle}>Contra & Transfer Financial Entry</Text>
                </View>
                <Pressable onPress={() => setShowTransferModal(false)} hitSlop={10} testID="close-transfer-modal">
                  <Ionicons name="close" size={22} color={colors.onSurface} />
                </Pressable>
              </View>

              {/* 4 Transfer Mode Selector Tabs */}
              <View style={styles.transferModeTabRow}>
                {[
                  { key: 'bank_to_cash', label: 'Bank to Cash' },
                  { key: 'cash_to_bank', label: 'Cash to Bank' },
                  { key: 'bank_to_bank', label: 'Bank to Bank' },
                  { key: 'adjust_balance', label: 'Adjust Balance' },
                ].map(m => {
                  const isActive = transferModalMode === m.key;
                  return (
                    <Pressable
                      key={m.key}
                      testID={`mode-${m.key}`}
                      onPress={() => {
                        setTransferModalMode(m.key as any);
                        setTransferErr(null);
                        setTransferForm(prev => ({
                          ...prev,
                          transfer_type: m.key as any,
                          direction: 'deposit',
                          withdraw_from: m.key === 'cash_to_bank' ? 'Cash in Hand' : (banks[0]?.id || ''),
                          deposit_to: m.key === 'cash_to_bank' ? (banks[0]?.id || '') : (banks[1]?.id || banks[0]?.id || ''),
                          account_id: banks[0]?.id || '',
                        }));
                      }}
                      style={[styles.transferModeTab, isActive && styles.transferModeTabActive]}
                    >
                      <Text style={[styles.transferModeTabText, isActive && styles.transferModeTabTextActive]}>
                        {m.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, maxHeight: 520 }}>
                {/* ---------------------------------------------------- */}
                {/* OPTION (i): Bank to Cash Transfer */}
                {/* ---------------------------------------------------- */}
                {transferModalMode === 'bank_to_cash' && (
                  <View style={{ gap: spacing.md }}>
                    {/* Radio Button: Deposit / Withdraw */}
                    <View style={styles.formGroup}>
                      <Text style={styles.formLabel}>Direction</Text>
                      <View style={styles.radioGroupRow}>
                        <Pressable
                          testID="radio-b2c-deposit"
                          onPress={() => setTransferForm(p => ({ ...p, direction: 'deposit' }))}
                          style={[styles.radioBtn, transferForm.direction === 'deposit' && styles.radioBtnActive]}
                        >
                          <Ionicons
                            name={transferForm.direction === 'deposit' ? 'radio-button-on' : 'radio-button-off'}
                            size={18}
                            color={transferForm.direction === 'deposit' ? BLUE : colors.muted}
                          />
                          <Text style={styles.radioText}>Deposit (Cash In from Bank)</Text>
                        </Pressable>

                        <Pressable
                          testID="radio-b2c-withdraw"
                          onPress={() => setTransferForm(p => ({ ...p, direction: 'withdraw' }))}
                          style={[styles.radioBtn, transferForm.direction === 'withdraw' && styles.radioBtnActive]}
                        >
                          <Ionicons
                            name={transferForm.direction === 'withdraw' ? 'radio-button-on' : 'radio-button-off'}
                            size={18}
                            color={transferForm.direction === 'withdraw' ? BLUE : colors.muted}
                          />
                          <Text style={styles.radioText}>Withdraw (Cash Out to Bank)</Text>
                        </Pressable>
                      </View>
                    </View>

                    {/* Transfer Date */}
                    <FormInput
                      label="Transfer Date *"
                      value={transferForm.transfer_date}
                      onChangeText={v => setTransferForm(p => ({ ...p, transfer_date: v }))}
                      placeholder="YYYY-MM-DD"
                      testID="in-b2c-date"
                    />

                    {/* Deposit To & Withdraw From */}
                    <View style={styles.formGroup}>
                      <Text style={styles.formLabel}>Deposit To</Text>
                      <View style={styles.readOnlyBox}>
                        <Text style={styles.readOnlyText}>
                          {transferForm.direction === 'deposit' ? 'Cash in Hand' : (banks.find(b => b.id === transferForm.withdraw_from)?.name || 'Select Bank')}
                        </Text>
                      </View>
                    </View>

                    <View style={styles.formGroup}>
                      <Text style={styles.formLabel}>Withdraw From (Bank)</Text>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexDirection: 'row', gap: 8 }}>
                        {banks.map(b => (
                          <Pressable
                            key={b.id}
                            testID={`sel-bank-${b.id}`}
                            onPress={() => setTransferForm(p => ({ ...p, withdraw_from: b.id }))}
                            style={[styles.pillSelect, transferForm.withdraw_from === b.id && styles.pillSelectActive]}
                          >
                            <Text style={[styles.pillSelectText, transferForm.withdraw_from === b.id && styles.pillSelectTextActive]}>
                              {b.name} ({b.bank_name})
                            </Text>
                          </Pressable>
                        ))}
                      </ScrollView>
                    </View>
                  </View>
                )}

                {/* ---------------------------------------------------- */}
                {/* OPTION (ii): Cash to Bank Transfer */}
                {/* ---------------------------------------------------- */}
                {transferModalMode === 'cash_to_bank' && (
                  <View style={{ gap: spacing.md }}>
                    {/* Radio Button: Deposit / Withdraw */}
                    <View style={styles.formGroup}>
                      <Text style={styles.formLabel}>Direction</Text>
                      <View style={styles.radioGroupRow}>
                        <Pressable
                          testID="radio-c2b-deposit"
                          onPress={() => setTransferForm(p => ({ ...p, direction: 'deposit' }))}
                          style={[styles.radioBtn, transferForm.direction === 'deposit' && styles.radioBtnActive]}
                        >
                          <Ionicons
                            name={transferForm.direction === 'deposit' ? 'radio-button-on' : 'radio-button-off'}
                            size={18}
                            color={transferForm.direction === 'deposit' ? BLUE : colors.muted}
                          />
                          <Text style={styles.radioText}>Deposit</Text>
                        </Pressable>

                        <Pressable
                          testID="radio-c2b-withdraw"
                          onPress={() => setTransferForm(p => ({ ...p, direction: 'withdraw' }))}
                          style={[styles.radioBtn, transferForm.direction === 'withdraw' && styles.radioBtnActive]}
                        >
                          <Ionicons
                            name={transferForm.direction === 'withdraw' ? 'radio-button-on' : 'radio-button-off'}
                            size={18}
                            color={transferForm.direction === 'withdraw' ? BLUE : colors.muted}
                          />
                          <Text style={styles.radioText}>Withdraw</Text>
                        </Pressable>
                      </View>
                    </View>

                    {/* Transfer Date */}
                    <FormInput
                      label="Transfer Date *"
                      value={transferForm.transfer_date}
                      onChangeText={v => setTransferForm(p => ({ ...p, transfer_date: v }))}
                      placeholder="YYYY-MM-DD"
                      testID="in-c2b-date"
                    />

                    {/* Deposit To (Bank) */}
                    <View style={styles.formGroup}>
                      <Text style={styles.formLabel}>Deposit To (Bank)</Text>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexDirection: 'row', gap: 8 }}>
                        {banks.map(b => (
                          <Pressable
                            key={b.id}
                            testID={`sel-deposit-bank-${b.id}`}
                            onPress={() => setTransferForm(p => ({ ...p, deposit_to: b.id }))}
                            style={[styles.pillSelect, transferForm.deposit_to === b.id && styles.pillSelectActive]}
                          >
                            <Text style={[styles.pillSelectText, transferForm.deposit_to === b.id && styles.pillSelectTextActive]}>
                              {b.name} ({b.bank_name})
                            </Text>
                          </Pressable>
                        ))}
                      </ScrollView>
                    </View>

                    {/* Withdraw From - Locked to "Cash in Hand" as requested */}
                    <View style={styles.formGroup}>
                      <Text style={styles.formLabel}>Withdraw From (Locked)</Text>
                      <View style={styles.readOnlyBox}>
                        <Ionicons name="lock-closed" size={16} color={colors.muted} />
                        <Text style={[styles.readOnlyText, { marginLeft: 6 }]}>Cash in Hand</Text>
                      </View>
                    </View>
                  </View>
                )}

                {/* ---------------------------------------------------- */}
                {/* OPTION (iii): Bank to Bank Transfer */}
                {/* ---------------------------------------------------- */}
                {transferModalMode === 'bank_to_bank' && (
                  <View style={{ gap: spacing.md }}>
                    {/* Transfer Date */}
                    <FormInput
                      label="Transfer Date *"
                      value={transferForm.transfer_date}
                      onChangeText={v => setTransferForm(p => ({ ...p, transfer_date: v }))}
                      placeholder="YYYY-MM-DD"
                      testID="in-b2b-date"
                    />

                    {/* Withdraw From (Bank Selection) */}
                    <View style={styles.formGroup}>
                      <Text style={styles.formLabel}>Withdraw From (Source Bank)</Text>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexDirection: 'row', gap: 8 }}>
                        {banks.map(b => (
                          <Pressable
                            key={b.id}
                            testID={`sel-from-${b.id}`}
                            onPress={() => setTransferForm(p => ({ ...p, withdraw_from: b.id }))}
                            style={[styles.pillSelect, transferForm.withdraw_from === b.id && styles.pillSelectActive]}
                          >
                            <Text style={[styles.pillSelectText, transferForm.withdraw_from === b.id && styles.pillSelectTextActive]}>
                              {b.name}
                            </Text>
                          </Pressable>
                        ))}
                      </ScrollView>
                    </View>

                    {/* Deposit To (Bank Selection) */}
                    <View style={styles.formGroup}>
                      <Text style={styles.formLabel}>Deposit To (Destination Bank)</Text>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexDirection: 'row', gap: 8 }}>
                        {banks.map(b => (
                          <Pressable
                            key={b.id}
                            testID={`sel-to-${b.id}`}
                            onPress={() => setTransferForm(p => ({ ...p, deposit_to: b.id }))}
                            style={[styles.pillSelect, transferForm.deposit_to === b.id && styles.pillSelectActive]}
                          >
                            <Text style={[styles.pillSelectText, transferForm.deposit_to === b.id && styles.pillSelectTextActive]}>
                              {b.name}
                            </Text>
                          </Pressable>
                        ))}
                      </ScrollView>
                    </View>
                  </View>
                )}

                {/* ---------------------------------------------------- */}
                {/* OPTION (iv): Adjust Bank Balance */}
                {/* ---------------------------------------------------- */}
                {transferModalMode === 'adjust_balance' && (
                  <View style={{ gap: spacing.md }}>
                    {/* Radio Button: Increase Balance / Reduce Balance */}
                    <View style={styles.formGroup}>
                      <Text style={styles.formLabel}>Adjustment Type</Text>
                      <View style={styles.radioGroupRow}>
                        <Pressable
                          testID="radio-adjust-increase"
                          onPress={() => setTransferForm(p => ({ ...p, adjust_action: 'increase' }))}
                          style={[styles.radioBtn, transferForm.adjust_action === 'increase' && styles.radioBtnActive]}
                        >
                          <Ionicons
                            name={transferForm.adjust_action === 'increase' ? 'radio-button-on' : 'radio-button-off'}
                            size={18}
                            color={transferForm.adjust_action === 'increase' ? GREEN : colors.muted}
                          />
                          <Text style={styles.radioText}>Increase Balance (+)</Text>
                        </Pressable>

                        <Pressable
                          testID="radio-adjust-reduce"
                          onPress={() => setTransferForm(p => ({ ...p, adjust_action: 'reduce' }))}
                          style={[styles.radioBtn, transferForm.adjust_action === 'reduce' && styles.radioBtnActive]}
                        >
                          <Ionicons
                            name={transferForm.adjust_action === 'reduce' ? 'radio-button-on' : 'radio-button-off'}
                            size={18}
                            color={transferForm.adjust_action === 'reduce' ? RED : colors.muted}
                          />
                          <Text style={styles.radioText}>Reduce Balance (-)</Text>
                        </Pressable>
                      </View>
                    </View>

                    {/* Transfer Date */}
                    <FormInput
                      label="Transfer Date *"
                      value={transferForm.transfer_date}
                      onChangeText={v => setTransferForm(p => ({ ...p, transfer_date: v }))}
                      placeholder="YYYY-MM-DD"
                      testID="in-adj-date"
                    />

                    {/* Account Name (Bank Name & A/c No. Selection) */}
                    <View style={styles.formGroup}>
                      <Text style={styles.formLabel}>Account Name (Bank Name & A/c No.)</Text>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexDirection: 'row', gap: 8 }}>
                        {banks.map(b => (
                          <Pressable
                            key={b.id}
                            testID={`sel-adj-bank-${b.id}`}
                            onPress={() => setTransferForm(p => ({ ...p, account_id: b.id }))}
                            style={[styles.pillSelect, transferForm.account_id === b.id && styles.pillSelectActive]}
                          >
                            <Text style={[styles.pillSelectText, transferForm.account_id === b.id && styles.pillSelectTextActive]}>
                              {b.bank_name} • {b.account_no}
                            </Text>
                          </Pressable>
                        ))}
                      </ScrollView>
                    </View>
                  </View>
                )}

                {/* Common Fields: Enter Amount */}
                <FormInput
                  label="Enter Amount (₹) *"
                  value={transferForm.amount}
                  onChangeText={v => setTransferForm(p => ({ ...p, amount: v }))}
                  placeholder="0.00"
                  keyboardType="numeric"
                  testID="in-transfer-amount"
                />

                {/* Enter Description (optional) */}
                <FormInput
                  label="Enter Description (optional)"
                  value={transferForm.description}
                  onChangeText={v => setTransferForm(p => ({ ...p, description: v }))}
                  placeholder="Remark / Transaction notes..."
                  multiline
                  testID="in-transfer-desc"
                />

                {/* Attached Image: Upload, Edit/Replace, Delete */}
                <View style={styles.formGroup}>
                  <Text style={styles.formLabel}>Attached Image / Slip</Text>
                  {transferForm.attachment_url ? (
                    <View style={styles.attachmentPreviewCard}>
                      <Ionicons name="document-attach" size={24} color={BLUE} />
                      <View style={{ flex: 1, marginLeft: 8 }}>
                        <Text style={styles.attachmentName} numberOfLines={1}>
                          {transferForm.attachment_name || 'Receipt Attachment'}
                        </Text>
                        <Text style={styles.attachmentUploaded}>Attached successfully</Text>
                      </View>
                      {/* Edit / Replace Button */}
                      <Pressable
                        testID="btn-replace-attachment"
                        onPress={handleUploadImage}
                        style={styles.attachmentActionBtn}
                      >
                        <Ionicons name="pencil" size={16} color={BLUE} />
                        <Text style={{ color: BLUE, fontSize: 12, fontWeight: '700', marginLeft: 4 }}>Edit</Text>
                      </Pressable>
                      {/* Delete Button */}
                      <Pressable
                        testID="btn-delete-attachment"
                        onPress={handleClearImage}
                        style={[styles.attachmentActionBtn, { backgroundColor: '#FEE2E2' }]}
                      >
                        <Ionicons name="trash" size={16} color={RED} />
                        <Text style={{ color: RED, fontSize: 12, fontWeight: '700', marginLeft: 4 }}>Delete</Text>
                      </Pressable>
                    </View>
                  ) : (
                    <Pressable
                      testID="btn-upload-attachment"
                      onPress={handleUploadImage}
                      style={styles.uploadBox}
                    >
                      <Ionicons name="cloud-upload-outline" size={24} color={BLUE} />
                      <Text style={styles.uploadBoxText}>
                        {uploadingImage ? 'Uploading Image...' : 'Click to Upload Slip / Image'}
                      </Text>
                    </Pressable>
                  )}
                </View>

                {transferErr && <Text style={styles.errorText}>{transferErr}</Text>}

                {/* Save Button */}
                <PrimaryButton
                  label="Save Transfer"
                  onPress={handleSaveTransfer}
                  loading={transferBusy}
                  testID="submit-transfer-btn"
                />
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* ========================================================================= */}
      {/* MODAL 3: CHEQUE DEPOSIT MODAL */}
      {/* ========================================================================= */}
      <Modal transparent visible={showChequeDepositModal} animationType="slide" onRequestClose={() => setShowChequeDepositModal(false)}>
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ width: '100%', maxWidth: 520 }}>
            <View style={styles.modalCard}>
              <View style={styles.modalHeader}>
                <View>
                  <Text style={styles.modalTitle}>Deposit Cheque</Text>
                  <Text style={styles.modalSubtitle}>Credit funds to Cash or Bank Account</Text>
                </View>
                <Pressable onPress={() => setShowChequeDepositModal(false)} hitSlop={10} testID="close-cheque-modal">
                  <Ionicons name="close" size={22} color={colors.onSurface} />
                </Pressable>
              </View>

              <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
                {/* Withdraw From (Read-only prefilled customer details) */}
                <View style={styles.formGroup}>
                  <Text style={styles.formLabel}>Withdraw From (Customer / Party)</Text>
                  <View style={styles.readOnlyBox}>
                    <Text style={styles.readOnlyTextBold}>{selectedCheque?.customer_name}</Text>
                    <Text style={styles.readOnlyTextSub}>
                      Amount: {inr(selectedCheque?.amount)} • Ref No: {selectedCheque?.reference_no}
                    </Text>
                  </View>
                </View>

                {/* Transfer Date */}
                <FormInput
                  label="Transfer Date *"
                  value={chequeDepositDate}
                  onChangeText={setChequeDepositDate}
                  placeholder="YYYY-MM-DD"
                  testID="in-chq-dep-date"
                />

                {/* Deposit To: Multiple selection for Cash or Bank */}
                <View style={styles.formGroup}>
                  <Text style={styles.formLabel}>Deposit To (Select Cash or Bank)</Text>
                  <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                    <Pressable
                      testID="chq-deposit-target-cash"
                      onPress={() => setChequeDepositTarget('cash')}
                      style={[styles.pillSelect, chequeDepositTarget === 'cash' && styles.pillSelectActive]}
                    >
                      <Ionicons name="cash" size={16} color={chequeDepositTarget === 'cash' ? '#FFF' : colors.onSurface} />
                      <Text style={[styles.pillSelectText, chequeDepositTarget === 'cash' && styles.pillSelectTextActive, { marginLeft: 4 }]}>
                        Cash in Hand
                      </Text>
                    </Pressable>

                    {banks.map(b => (
                      <Pressable
                        key={b.id}
                        testID={`chq-deposit-target-${b.id}`}
                        onPress={() => setChequeDepositTarget(b.id)}
                        style={[styles.pillSelect, chequeDepositTarget === b.id && styles.pillSelectActive]}
                      >
                        <Ionicons name="business" size={16} color={chequeDepositTarget === b.id ? '#FFF' : colors.onSurface} />
                        <Text style={[styles.pillSelectText, chequeDepositTarget === b.id && styles.pillSelectTextActive, { marginLeft: 4 }]}>
                          {b.name}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>

                {/* Description (Optional) */}
                <FormInput
                  label="Description (Optional)"
                  value={chequeDepositDesc}
                  onChangeText={setChequeDepositDesc}
                  placeholder="e.g. Clearing note, bank slip ref"
                  testID="in-chq-dep-desc"
                />

                {/* Save Button */}
                <PrimaryButton
                  label="Save & Clear Cheque"
                  onPress={handleConfirmChequeDeposit}
                  loading={chequeBusy}
                  testID="submit-cheque-deposit"
                />
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* ========================================================================= */}
      {/* MODAL 4: ADD LOAN ACCOUNT (10 EXACT FIELDS) */}
      {/* ========================================================================= */}
      <Modal transparent visible={showAddLoanModal} animationType="slide" onRequestClose={() => setShowAddLoanModal(false)}>
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ width: '100%', maxWidth: 560 }}>
            <View style={styles.modalCard}>
              <View style={styles.modalHeader}>
                <View>
                  <Text style={styles.modalTitle}>Add Loan Account</Text>
                  <Text style={styles.modalSubtitle}>Register business bank loan or overdraft facility</Text>
                </View>
                <Pressable onPress={() => setShowAddLoanModal(false)} hitSlop={10} testID="close-loan-modal">
                  <Ionicons name="close" size={22} color={colors.onSurface} />
                </Pressable>
              </View>

              <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, maxHeight: 520 }}>
                {/* 1. Account Name */}
                <FormInput
                  label="(i) Account Name *"
                  value={loanForm.account_name}
                  onChangeText={v => setLoanForm(p => ({ ...p, account_name: v }))}
                  placeholder="e.g. SBI MSME Business Expansion Loan"
                  testID="in-loan-name"
                />

                {/* 2. Account Number */}
                <FormInput
                  label="(ii) Account Number *"
                  value={loanForm.account_number}
                  onChangeText={v => setLoanForm(p => ({ ...p, account_number: v }))}
                  placeholder="e.g. LOAN-SBI-2024-9981"
                  testID="in-loan-number"
                />

                {/* 3. Lender Bank */}
                <FormInput
                  label="(iii) Lender Bank *"
                  value={loanForm.lender_bank}
                  onChangeText={v => setLoanForm(p => ({ ...p, lender_bank: v }))}
                  placeholder="e.g. State Bank of India, Boring Road Branch"
                  testID="in-loan-lender"
                />

                {/* 4. Description */}
                <FormInput
                  label="(iv) Description (Optional)"
                  value={loanForm.description}
                  onChangeText={v => setLoanForm(p => ({ ...p, description: v }))}
                  placeholder="Purpose of loan, hypothecated assets..."
                  multiline
                  testID="in-loan-desc"
                />

                {/* 5. Opening Balance */}
                <FormInput
                  label="(v) Opening Balance / Sanctioned Amount (₹) *"
                  value={loanForm.opening_balance}
                  onChangeText={v => setLoanForm(p => ({ ...p, opening_balance: v }))}
                  placeholder="e.g. 500000"
                  keyboardType="numeric"
                  testID="in-loan-openbal"
                />

                {/* 6. Balance as of */}
                <FormInput
                  label="(vi) Balance as of (Date) *"
                  value={loanForm.balance_as_of}
                  onChangeText={v => setLoanForm(p => ({ ...p, balance_as_of: v }))}
                  placeholder="YYYY-MM-DD"
                  testID="in-loan-date"
                />

                {/* 7. Loan received in (Cash, Add Bank A/c, or select Bank) */}
                <View style={styles.formGroup}>
                  <Text style={styles.formLabel}>(vii) Loan received in</Text>
                  <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                    <Pressable
                      testID="sel-loan-rcv-cash"
                      onPress={() => setLoanForm(p => ({ ...p, loan_received_in: 'cash' }))}
                      style={[styles.pillSelect, loanForm.loan_received_in === 'cash' && styles.pillSelectActive]}
                    >
                      <Ionicons name="cash" size={16} color={loanForm.loan_received_in === 'cash' ? '#FFF' : colors.onSurface} />
                      <Text style={[styles.pillSelectText, loanForm.loan_received_in === 'cash' && styles.pillSelectTextActive, { marginLeft: 4 }]}>
                        Cash in Hand
                      </Text>
                    </Pressable>

                    {banks.map(b => (
                      <Pressable
                        key={b.id}
                        testID={`sel-loan-rcv-${b.id}`}
                        onPress={() => setLoanForm(p => ({ ...p, loan_received_in: b.id }))}
                        style={[styles.pillSelect, loanForm.loan_received_in === b.id && styles.pillSelectActive]}
                      >
                        <Ionicons name="business" size={16} color={loanForm.loan_received_in === b.id ? '#FFF' : colors.onSurface} />
                        <Text style={[styles.pillSelectText, loanForm.loan_received_in === b.id && styles.pillSelectTextActive, { marginLeft: 4 }]}>
                          {b.name}
                        </Text>
                      </Pressable>
                    ))}

                    <Pressable
                      testID="sel-loan-rcv-add-bank"
                      onPress={() => {
                        setShowAddLoanModal(false);
                        setShowAddBank(true);
                      }}
                      style={[styles.pillSelect, { borderColor: BLUE, borderStyle: 'dashed' }]}
                    >
                      <Ionicons name="add" size={16} color={BLUE} />
                      <Text style={[styles.pillSelectText, { color: BLUE, marginLeft: 2 }]}>+ Add Bank A/c</Text>
                    </Pressable>
                  </View>
                </View>

                {/* 8. Interest Rate in % */}
                <FormInput
                  label="(viii) Interest Rate in %"
                  value={loanForm.interest_rate}
                  onChangeText={v => setLoanForm(p => ({ ...p, interest_rate: v }))}
                  placeholder="e.g. 8.75"
                  keyboardType="numeric"
                  testID="in-loan-interest"
                />

                {/* 9. Duration (Months) */}
                <FormInput
                  label="(ix) Duration (Months)"
                  value={loanForm.duration_months}
                  onChangeText={v => setLoanForm(p => ({ ...p, duration_months: v }))}
                  placeholder="e.g. 36"
                  keyboardType="number-pad"
                  testID="in-loan-duration"
                />

                {/* 10. Processing Fee */}
                <FormInput
                  label="(x) Processing Fee (₹)"
                  value={loanForm.processing_fee}
                  onChangeText={v => setLoanForm(p => ({ ...p, processing_fee: v }))}
                  placeholder="e.g. 5000"
                  keyboardType="numeric"
                  testID="in-loan-fee"
                />

                {loanErr && <Text style={styles.errorText}>{loanErr}</Text>}

                {/* Save Button */}
                <PrimaryButton
                  label="Save Loan Account"
                  onPress={handleSaveLoan}
                  loading={loanBusy}
                  testID="submit-loan-account"
                />
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceSecondary },
  header: {
    height: 54,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerBackBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { fontSize: font.lg, fontWeight: '800', color: HEADER_FG },
  headerSub: { fontSize: 11, color: colors.muted },
  headerRefreshBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tabButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    gap: 6,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabButtonActive: {
    borderBottomColor: BLUE,
  },
  tabButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.muted,
  },
  tabButtonTextActive: {
    color: BLUE,
    fontWeight: '800',
  },
  contentContainer: {
    padding: spacing.md,
    gap: spacing.md,
    paddingBottom: spacing.xxxl,
  },
  overviewCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: radius.lg,
    padding: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.sm,
  },
  overviewLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.muted,
    letterSpacing: 0.5,
  },
  overviewVal: {
    fontSize: font.xxl,
    fontWeight: '900',
    marginVertical: 4,
  },
  overviewSub: {
    fontSize: 12,
    color: colors.muted,
  },
  headerActionRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
  },
  addBankBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: BLUE,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.md,
    gap: 4,
  },
  depWithBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: NAVY,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.md,
    gap: 4,
  },
  btnTextWhite: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '700',
  },
  shortcutRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  shortcutCard: {
    flex: 1,
    minWidth: 130,
    backgroundColor: '#FFFFFF',
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    ...shadow.xs,
  },
  shortcutIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  shortcutTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.onSurface,
    textAlign: 'center',
  },
  shortcutDesc: {
    fontSize: 11,
    color: colors.muted,
    textAlign: 'center',
    marginTop: 2,
  },
  sectionHeading: {
    fontSize: font.md,
    fontWeight: '800',
    color: colors.onSurface,
    marginTop: 8,
    marginBottom: 4,
  },
  bankItemCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.xs,
  },
  bankItemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  bankItemAvatar: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#DBEAFE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bankItemName: {
    fontSize: font.md,
    fontWeight: '800',
    color: colors.onSurface,
  },
  bankItemSub: {
    fontSize: 12,
    color: colors.muted,
    marginTop: 1,
  },
  bankItemBalLabel: {
    fontSize: 10,
    color: colors.muted,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  bankItemBal: {
    fontSize: font.lg,
    fontWeight: '900',
    marginTop: 2,
  },
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  statCard: {
    flex: 1,
    minWidth: 140,
    backgroundColor: '#FFFFFF',
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  statLabel: {
    fontSize: 11,
    color: colors.muted,
    fontWeight: '600',
  },
  statVal: {
    fontSize: font.md,
    fontWeight: '800',
    marginTop: 4,
  },
  txRowCard: {
    backgroundColor: '#FFFFFF',
    padding: spacing.md,
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  txParticulars: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.onSurface,
  },
  txDate: {
    fontSize: 11,
    color: colors.muted,
    marginTop: 2,
  },
  txAmount: {
    fontSize: 14,
    fontWeight: '900',
  },
  emptyCard: {
    backgroundColor: '#FFFFFF',
    padding: 28,
    borderRadius: radius.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  chequeFilterRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  chequeFilterPill: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: colors.border,
  },
  chequeFilterPillActive: {
    backgroundColor: BLUE,
    borderColor: BLUE,
  },
  chequeFilterText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.muted,
  },
  chequeFilterTextActive: {
    color: '#FFF',
    fontWeight: '800',
  },
  chequeCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 8,
    ...shadow.xs,
  },
  chequeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  chequeNo: {
    fontSize: font.md,
    fontWeight: '800',
    color: colors.onSurface,
  },
  chequeDate: {
    fontSize: 11,
    color: colors.muted,
    marginTop: 2,
  },
  chequeAmount: {
    fontSize: font.lg,
    fontWeight: '900',
    color: BLUE,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.sm,
    marginTop: 4,
  },
  statusBadgeText: {
    fontSize: 10,
    fontWeight: '800',
  },
  chequeDetails: {
    backgroundColor: '#F8FAFC',
    padding: 10,
    borderRadius: radius.sm,
    gap: 2,
  },
  chequeParty: {
    fontSize: 13,
    color: colors.onSurface,
  },
  chequeSub: {
    fontSize: 11,
    color: colors.muted,
  },
  chequeDesc: {
    fontSize: 11,
    color: colors.muted,
    fontStyle: 'italic',
    marginTop: 2,
  },
  clearedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  clearedBannerText: {
    fontSize: 11,
    color: GREEN,
    fontWeight: '700',
  },
  chequeActionRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 8,
  },
  depositBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: GREEN,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: radius.md,
    gap: 6,
  },
  loanCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
    ...shadow.xs,
  },
  loanCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  loanName: {
    fontSize: font.md,
    fontWeight: '800',
    color: colors.onSurface,
  },
  loanSub: {
    fontSize: 12,
    color: colors.muted,
    marginTop: 2,
  },
  loanBalLabel: {
    fontSize: 10,
    color: colors.muted,
    fontWeight: '700',
  },
  loanBalVal: {
    fontSize: font.lg,
    fontWeight: '900',
    color: '#EA580C',
  },
  loanDetailsGrid: {
    flexDirection: 'row',
    backgroundColor: '#FFF7ED',
    borderRadius: radius.md,
    padding: 10,
    gap: 8,
  },
  loanDetailItem: {
    flex: 1,
    alignItems: 'center',
  },
  loanDetailLabel: {
    fontSize: 10,
    color: colors.muted,
    fontWeight: '600',
  },
  loanDetailVal: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.onSurface,
    marginTop: 2,
  },
  loanFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 6,
  },
  loanFooterText: {
    fontSize: 11,
    color: colors.muted,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.md,
  },
  modalCard: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: radius.lg,
    overflow: 'hidden',
    ...shadow.md,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: '#F8FAFC',
  },
  modalTitle: {
    fontSize: font.lg,
    fontWeight: '800',
    color: colors.onSurface,
  },
  modalSubtitle: {
    fontSize: 11,
    color: colors.muted,
    marginTop: 2,
  },
  transferModeTabRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: '#F1F5F9',
  },
  transferModeTab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  transferModeTabActive: {
    borderBottomColor: BLUE,
    backgroundColor: '#FFFFFF',
  },
  transferModeTabText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.muted,
  },
  transferModeTabTextActive: {
    color: BLUE,
    fontWeight: '800',
  },
  formGroup: {
    gap: 6,
  },
  formLabel: {
    fontSize: font.sm,
    color: colors.muted,
    fontWeight: '600',
  },
  radioGroupRow: {
    flexDirection: 'row',
    gap: 12,
  },
  radioBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#FFFFFF',
    gap: 6,
  },
  radioBtnActive: {
    borderColor: BLUE,
    backgroundColor: '#EFF6FF',
  },
  radioText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.onSurface,
  },
  readOnlyBox: {
    backgroundColor: '#F1F5F9',
    padding: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
  },
  readOnlyText: {
    fontSize: font.md,
    color: colors.onSurface,
    fontWeight: '600',
  },
  readOnlyTextBold: {
    fontSize: font.md,
    color: colors.onSurface,
    fontWeight: '800',
  },
  readOnlyTextSub: {
    fontSize: 12,
    color: colors.muted,
    marginTop: 2,
  },
  pillSelect: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
  },
  pillSelectActive: {
    backgroundColor: BLUE,
    borderColor: BLUE,
  },
  pillSelectText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.onSurface,
  },
  pillSelectTextActive: {
    color: '#FFFFFF',
    fontWeight: '800',
  },
  uploadBox: {
    borderWidth: 1,
    borderColor: '#93C5FD',
    borderStyle: 'dashed',
    borderRadius: radius.md,
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EFF6FF',
    gap: 6,
  },
  uploadBoxText: {
    fontSize: 12,
    fontWeight: '700',
    color: BLUE,
  },
  attachmentPreviewCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: radius.md,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  attachmentName: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.onSurface,
  },
  attachmentUploaded: {
    fontSize: 10,
    color: GREEN,
    fontWeight: '600',
  },
  attachmentActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.sm,
    backgroundColor: '#DBEAFE',
    marginLeft: 6,
  },
  errorText: {
    color: RED,
    fontSize: 12,
    fontWeight: '600',
  },
});
