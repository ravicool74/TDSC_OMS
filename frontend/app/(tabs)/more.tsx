import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, Image, Alert, Platform, ActivityIndicator, Modal, KeyboardAvoidingView } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { colors, spacing, radius, font, roleColor } from '@/src/theme';
import { useAuth } from '@/src/AuthContext';
import { Avatar, PrimaryButton, SecondaryButton } from '@/src/ui';
import { FormInput } from '@/src/forms';
import { api } from '@/src/api';
import { notify } from '@/src/dialog';
import { useAppUpdate, LOCAL_APP_VERSION, LOCAL_APP_VERSION_CODE } from '@/src/AppUpdateModal';
import { isMenuAllowed, canView, canWrite } from '@/src/rbac';

export default function MoreScreen() {
  const insets = useSafeAreaInsets();
  const { user, logout, deleteAccount } = useAuth();
  const router = useRouter();
  const { checkForUpdates, isChecking } = useAppUpdate();

  // Change Password state
  const [showChangePwdModal, setShowChangePwdModal] = useState(false);
  const [curPassword, setCurPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwdBusy, setPwdBusy] = useState(false);
  const [pwdErr, setPwdErr] = useState<string | null>(null);

  const handleChangePassword = async () => {
    if (!curPassword || !newPassword) {
      setPwdErr('Please fill in current and new password');
      return;
    }
    if (newPassword.length < 6) {
      setPwdErr('New password must be at least 6 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwdErr('New password and confirm password do not match');
      return;
    }
    setPwdBusy(true);
    setPwdErr(null);
    try {
      const res: any = await api.changePassword(curPassword, newPassword);
      notify(res?.message || 'Password changed successfully');
      setShowChangePwdModal(false);
      setCurPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (e: any) {
      setPwdErr(e?.message || 'Failed to change password');
    } finally {
      setPwdBusy(false);
    }
  };

  const confirmDelete = () => {
    const doDelete = async () => {
      try {
        await deleteAccount();
      } catch (e: any) {
        const msg = e?.message || 'Failed to delete account. Please try again.';
        if (Platform.OS === 'web') window.alert(msg);
        else Alert.alert('Delete failed', msg);
      }
    };
    const title = 'Delete Account?';
    const message = 'This will permanently delete your account and sign you out. Your business data (tasks, invoices you created) will be retained by the organisation but your personal login will be removed. This action cannot be undone.';
    if (Platform.OS === 'web') {
      if (window.confirm(`${title}\n\n${message}`)) doDelete();
      return;
    }
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: doDelete },
    ]);
  };

  const operationalRows = [
    { key: 'customers', id: 'customers', icon: 'people', label: 'Contractors & Customers Database', route: '/customers', color: '#0A5CFF', testID: 'row-contractors' },
    { key: 'accounting', id: 'sales_invoices', icon: 'wallet', label: 'Accounting & Invoices', route: '/accounting/menu', color: colors.success, testID: 'row-accounting' },
    { key: 'reports', id: 'accounting_reports', icon: 'bar-chart', label: 'Financial & Accounting Reports', route: '/accounting/reports', color: '#2563EB', testID: 'row-reports' },
    { key: 'customer_requests', id: 'task_followup', icon: 'clipboard', label: 'Service Request by Customer (Queue)', route: '/tasks/service-requests', color: '#059669', testID: 'row-customer-requests' },
    { key: 'services', id: 'services', icon: 'construct', label: 'Service Master', route: '/services', color: colors.brandPrimary, testID: 'row-services' },
    { key: 'expiry_alerts', id: 'expiry_alerts', icon: 'alert-circle', label: 'Document Expiry Alerts', route: '/customers/expiry-alerts', color: colors.warning, testID: 'row-expiry' },
    { key: 'gps_tracking', id: 'gps_tracking', icon: 'navigate', label: 'Field Staff GPS Tracking', route: '/gps/tracking', color: colors.info, testID: 'row-gps' },
    { key: 'documents', id: 'documents', icon: 'folder-open', label: 'Document Library', route: '/documents', color: colors.warning, testID: 'row-documents' },
    { key: 'tenders', id: 'tenders', icon: 'document-text', label: 'Tender Management', route: '/tenders', color: colors.error, testID: 'row-tenders' },
    { key: 'tender_calling', id: 'tender_calling', icon: 'call', label: 'Tender Calling & Follow-up', route: '/tenders?tab=calling', color: '#ea580c', testID: 'row-tender-calling' },
    { key: 'simple_accounts', id: 'cash_bank', icon: 'cash', label: 'Simple Accounts', route: '/(tabs)/business', color: colors.brandSecondary, testID: 'row-accounts' },
  ].filter(r => canView(user, 'more', 'operations_services', r.key) || isMenuAllowed(user, r.id));

  const hrRows = [
    { key: 'employees', id: 'employees', icon: 'people', label: 'Employees Directory', route: '/employees', color: colors.brandPrimary, testID: 'row-employees' },
    { key: 'attendance_leaves', id: 'attendance_leaves', icon: 'calendar', label: 'Attendance & Leaves', route: '/hr', color: colors.success, testID: 'row-hr' },
    { key: 'payroll', id: 'payroll', icon: 'card', label: 'Payroll', route: '/payroll', color: colors.brandSecondary, testID: 'row-payroll' },
    { key: 'attendance_settings', id: 'attendance_leaves', icon: 'time', label: 'Attendance Settings', route: '/attendance-settings', color: colors.info, testID: 'row-att-settings' },
  ].filter(r => canView(user, 'more', 'human_resources', r.key) || isMenuAllowed(user, r.id));

  const adminRows = [
    { key: 'admin_services', id: 'services', icon: 'grid', label: 'Customer Services Catalogue (Master)', route: '/admin/services', color: '#059669', testID: 'row-admin-services' },
    { key: 'branches', id: 'branches', icon: 'business', label: 'Branch Management', route: '/admin/branches', color: colors.brandSecondary, testID: 'row-branches' },
    { key: 'posts', id: 'posts', icon: 'ribbon', label: 'Post / Designations', route: '/admin/posts', color: colors.warning, testID: 'row-posts' },
    { key: 'users', id: 'user_management', icon: 'person-add', label: 'System User Directory', route: '/admin/users', color: colors.brandPrimary, testID: 'row-users' },
    { key: 'roles', id: 'roles_permissions', icon: 'shield-checkmark', label: 'Roles & RBAC Matrix', route: '/admin/roles', color: colors.info, testID: 'row-roles' },
    { key: 'audit_logs', id: 'audit_logs', icon: 'finger-print', label: 'Security Audit Trail', route: '/admin/audit-logs', color: colors.error, testID: 'row-audit' },
    { key: 'settings', id: 'settings', icon: 'settings', label: 'System Settings & Backup', route: '/admin/settings', color: colors.muted, testID: 'row-settings' },
  ].filter(r => canView(user, 'more', 'enterprise_administration', r.key) || ((user?.role === 'super_admin' || user?.role === 'admin') && isMenuAllowed(user, r.id)));

  if (!canView(user, 'more')) {
    return (
      <SafeAreaView edges={['top']} style={styles.root} testID="more-screen">
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl }}>
          <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: '#FEF2F2', alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md }}>
            <Ionicons name="lock-closed" size={36} color={colors.error} />
          </View>
          <Text style={[styles.name, { fontSize: 20, textAlign: 'center' }]}>More Menu Access Restricted</Text>
          <Text style={[{ color: colors.muted, textAlign: 'center', marginTop: spacing.sm, maxWidth: 320, lineHeight: 20 }]}>
            Administrator ne aapke account ke liye More module view karne ki permission disable ki hui hai.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top']} style={styles.root} testID="more-screen">
      <ScrollView contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 16) + spacing.xxxl }}>
        <View style={styles.profile}>
          <Avatar name={user?.name || 'U'} size={64} />
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{user?.name}</Text>
            <Text style={styles.email}>{user?.email}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
              <View style={[styles.roleBadge, { backgroundColor: roleColor(user?.role || 'employee') + '20' }]}>
                <Text style={[styles.roleText, { color: roleColor(user?.role || 'employee') }]}>{(user?.role || 'employee').toUpperCase()}</Text>
              </View>
              <Pressable
                testID="btn-open-change-pwd"
                onPress={() => {
                  setPwdErr(null);
                  setCurPassword('');
                  setNewPassword('');
                  setConfirmPassword('');
                  setShowChangePwdModal(true);
                }}
                style={styles.changePwdBtn}
              >
                <Ionicons name="key-outline" size={13} color={colors.brandPrimary} />
                <Text style={styles.changePwdBtnText}>Change Password</Text>
              </Pressable>
            </View>
          </View>
        </View>

        {operationalRows.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Operations & Services</Text>
            {operationalRows.map(r => (
              <Pressable key={r.label} testID={r.testID} style={styles.row} onPress={() => router.push(r.route as any)}>
                <View style={[styles.rowIcon, { backgroundColor: r.color + '20' }]}>
                  <Ionicons name={r.icon as any} size={20} color={r.color} />
                </View>
                <Text style={styles.rowLabel}>{r.label}</Text>
                <Ionicons name="chevron-forward" size={18} color={colors.muted} />
              </Pressable>
            ))}
          </View>
        )}

        {hrRows.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Human Resources</Text>
            {hrRows.map(r => (
              <Pressable key={r.label} testID={r.testID} style={styles.row} onPress={() => router.push(r.route as any)}>
                <View style={[styles.rowIcon, { backgroundColor: r.color + '20' }]}>
                  <Ionicons name={r.icon as any} size={20} color={r.color} />
                </View>
                <Text style={styles.rowLabel}>{r.label}</Text>
                <Ionicons name="chevron-forward" size={18} color={colors.muted} />
              </Pressable>
            ))}
          </View>
        )}

        {adminRows.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Enterprise Administration</Text>
            {adminRows.map(r => (
              <Pressable key={r.label} testID={r.testID} style={styles.row} onPress={() => router.push(r.route as any)}>
                <View style={[styles.rowIcon, { backgroundColor: r.color + '20' }]}>
                  <Ionicons name={r.icon as any} size={20} color={r.color} />
                </View>
                <Text style={styles.rowLabel}>{r.label}</Text>
                <Ionicons name="chevron-forward" size={18} color={colors.muted} />
              </Pressable>
            ))}
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>About & Updates</Text>
          <View style={styles.row}>
            <View style={[styles.rowIcon, { backgroundColor: colors.surface, padding: 2, borderWidth: 1, borderColor: colors.border }]}>
              <Image source={require('../../assets/images/company-logo.jpg')} style={{ width: '100%', height: '100%' }} resizeMode="contain" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>TDSC Office Management System</Text>
              <Text style={styles.muted}>Version {LOCAL_APP_VERSION} (Build {LOCAL_APP_VERSION_CODE})</Text>
            </View>
          </View>
          <Pressable
            testID="check-updates-btn"
            style={styles.row}
            onPress={() => checkForUpdates(false)}
            disabled={isChecking}
          >
            <View style={[styles.rowIcon, { backgroundColor: colors.brandTertiary }]}>
              {isChecking ? (
                <ActivityIndicator size="small" color={colors.brandPrimary} />
              ) : (
                <Ionicons name="cloud-download-outline" size={20} color={colors.brandPrimary} />
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>Check for App Updates</Text>
              <Text style={styles.muted}>{isChecking ? 'Checking update server...' : 'Verify latest features & improvements'}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.muted} />
          </Pressable>
        </View>

        <Pressable testID="logout-btn" style={styles.logout} onPress={logout}>
          <Ionicons name="log-out-outline" size={20} color={colors.error} />
          <Text style={styles.logoutText}>Logout</Text>
        </Pressable>

        {user?.role !== 'admin' && user?.role !== 'super_admin' && (
          <Pressable testID="delete-account-btn" style={styles.deleteAcc} onPress={confirmDelete}>
            <Ionicons name="trash-outline" size={18} color={colors.muted} />
            <Text style={styles.deleteAccText}>Delete My Account</Text>
          </Pressable>
        )}
      </ScrollView>

      {/* Change Password Modal */}
      <Modal visible={showChangePwdModal} animationType="slide" transparent onRequestClose={() => setShowChangePwdModal(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>Change Password</Text>
                <Text style={styles.modalSubTitle}>Update your login credentials securely</Text>
              </View>
              <Pressable onPress={() => setShowChangePwdModal(false)} hitSlop={10}>
                <Ionicons name="close" size={24} color={colors.muted} />
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
              {pwdErr ? <Text style={styles.pwdErr}>{pwdErr}</Text> : null}

              <FormInput
                label="Current Password *"
                value={curPassword}
                onChangeText={setCurPassword}
                secureTextEntry
                placeholder="Enter current password"
              />

              <FormInput
                label="New Password *"
                value={newPassword}
                onChangeText={setNewPassword}
                secureTextEntry
                placeholder="At least 6 characters"
              />

              <FormInput
                label="Confirm New Password *"
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secureTextEntry
                placeholder="Re-enter new password"
              />

              <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.md }}>
                <SecondaryButton
                  label="Cancel"
                  onPress={() => setShowChangePwdModal(false)}
                  style={{ flex: 1 }}
                />
                <PrimaryButton
                  label={pwdBusy ? 'Updating...' : 'Update Password'}
                  onPress={handleChangePassword}
                  loading={pwdBusy}
                  disabled={pwdBusy}
                  style={{ flex: 1.5 }}
                />
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceSecondary },
  profile: { flexDirection: 'row', gap: spacing.lg, padding: spacing.xl, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border, alignItems: 'center' },
  name: { fontSize: font.xl, fontWeight: '800', color: colors.onSurface },
  email: { color: colors.muted, fontSize: font.base, marginTop: 2 },
  roleBadge: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  roleText: { fontWeight: '800', fontSize: 10, letterSpacing: 0.4 },
  changePwdBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  changePwdBtnText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.brandPrimary,
  },
  section: { marginTop: spacing.xl, marginHorizontal: spacing.lg, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  sectionTitle: { fontSize: font.sm, color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.5, padding: spacing.md, paddingBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.divider },
  rowIcon: { width: 36, height: 36, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { flex: 1, fontSize: font.lg, color: colors.onSurface, fontWeight: '600' },
  muted: { color: colors.muted, fontSize: font.sm, marginTop: 2 },
  logout: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginHorizontal: spacing.lg, marginTop: spacing.xl, padding: spacing.lg, borderRadius: radius.md, backgroundColor: colors.error + '10', borderWidth: 1, borderColor: colors.error + '30' },
  logoutText: { color: colors.error, fontWeight: '700', fontSize: font.lg },
  deleteAcc: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginHorizontal: spacing.lg, marginTop: spacing.md, padding: spacing.md },
  deleteAccText: { color: colors.muted, fontWeight: '600', fontSize: font.sm, textDecorationLine: 'underline' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalBox: { backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, maxHeight: '85%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border },
  modalTitle: { fontSize: font.lg, fontWeight: '700', color: colors.onSurface },
  modalSubTitle: { fontSize: font.xs, color: colors.muted, marginTop: 2 },
  pwdErr: { color: colors.error, fontSize: font.sm, fontWeight: '600' },
});
