import React from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, Image, Alert, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { colors, spacing, radius, font, roleColor } from '@/src/theme';
import { useAuth } from '@/src/AuthContext';
import { Avatar } from '@/src/ui';

export default function MoreScreen() {
  const { user, logout, deleteAccount } = useAuth();
  const router = useRouter();

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
    { icon: 'wallet', label: 'Accounting & Invoices', route: '/accounting/menu', color: colors.success, testID: 'row-accounting' },
    { icon: 'bar-chart', label: 'Financial & Accounting Reports', route: '/accounting/reports', color: '#2563EB', testID: 'row-reports' },
    { icon: 'construct', label: 'Service Master', route: '/services', color: colors.brandPrimary, testID: 'row-services' },
    { icon: 'alert-circle', label: 'Document Expiry Alerts', route: '/customers/expiry-alerts', color: colors.warning, testID: 'row-expiry' },
    { icon: 'navigate', label: 'Field Staff GPS Tracking', route: '/gps/tracking', color: colors.info, testID: 'row-gps' },
    { icon: 'folder-open', label: 'Document Library', route: '/documents', color: colors.warning, testID: 'row-documents' },
    { icon: 'document-text', label: 'Tender Management', route: '/tenders', color: colors.error, testID: 'row-tenders' },
    { icon: 'call', label: 'Tender Calling & Follow-up', route: '/tenders?tab=calling', color: '#ea580c', testID: 'row-tender-calling' },
    { icon: 'cash', label: 'Simple Accounts', route: '/(tabs)/business', color: colors.brandSecondary, testID: 'row-accounts' },
  ];

  const hrRows = [
    { icon: 'people', label: 'Employees Directory', route: '/employees', color: colors.brandPrimary, testID: 'row-employees' },
    { icon: 'calendar', label: 'Attendance & Leaves', route: '/hr', color: colors.success, testID: 'row-hr' },
    { icon: 'card', label: 'Payroll', route: '/payroll', color: colors.brandSecondary, testID: 'row-payroll' },
    { icon: 'time', label: 'Attendance Settings', route: '/attendance-settings', color: colors.info, testID: 'row-att-settings' },
  ];

  const adminRows = (user?.role === 'admin' || user?.role === 'manager') ? [
    { icon: 'business', label: 'Branch Management', route: '/admin/branches', color: colors.brandSecondary, testID: 'row-branches' },
    { icon: 'ribbon', label: 'Post / Designations', route: '/admin/posts', color: colors.warning, testID: 'row-posts' },
    { icon: 'person-add', label: 'System User Directory', route: '/admin/users', color: colors.brandPrimary, testID: 'row-users' },
    { icon: 'shield-checkmark', label: 'Roles & RBAC Matrix', route: '/admin/roles', color: colors.info, testID: 'row-roles' },
    { icon: 'finger-print', label: 'Security Audit Trail', route: '/admin/audit-logs', color: colors.error, testID: 'row-audit' },
    { icon: 'settings', label: 'System Settings & Backup', route: '/admin/settings', color: colors.muted, testID: 'row-settings' },
  ] : [];

  return (
    <SafeAreaView edges={['top']} style={styles.root} testID="more-screen">
      <ScrollView contentContainerStyle={{ paddingBottom: spacing.xxxl }}>
        <View style={styles.profile}>
          <Avatar name={user?.name || 'U'} size={64} />
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{user?.name}</Text>
            <Text style={styles.email}>{user?.email}</Text>
            <View style={[styles.roleBadge, { backgroundColor: roleColor(user?.role || 'employee') + '20' }]}>
              <Text style={[styles.roleText, { color: roleColor(user?.role || 'employee') }]}>{(user?.role || 'employee').toUpperCase()}</Text>
            </View>
          </View>
        </View>

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
          <Text style={styles.sectionTitle}>About</Text>
          <View style={styles.row}>
            <View style={[styles.rowIcon, { backgroundColor: colors.surface, padding: 2, borderWidth: 1, borderColor: colors.border }]}>
              <Image source={require('../../assets/images/company-logo.jpg')} style={{ width: '100%', height: '100%' }} resizeMode="contain" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>TDSC Office Management System</Text>
              <Text style={styles.muted}>Triveni DSC & e-Tender Service Pvt. Ltd.</Text>
            </View>
          </View>
        </View>

        <Pressable testID="logout-btn" style={styles.logout} onPress={logout}>
          <Ionicons name="log-out-outline" size={20} color={colors.error} />
          <Text style={styles.logoutText}>Logout</Text>
        </Pressable>

        {user?.role !== 'admin' && (
          <Pressable testID="delete-account-btn" style={styles.deleteAcc} onPress={confirmDelete}>
            <Ionicons name="trash-outline" size={18} color={colors.muted} />
            <Text style={styles.deleteAccText}>Delete My Account</Text>
          </Pressable>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceSecondary },
  profile: { flexDirection: 'row', gap: spacing.lg, padding: spacing.xl, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border, alignItems: 'center' },
  name: { fontSize: font.xl, fontWeight: '800', color: colors.onSurface },
  email: { color: colors.muted, fontSize: font.base, marginTop: 2 },
  roleBadge: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, marginTop: 6 },
  roleText: { fontWeight: '800', fontSize: 10, letterSpacing: 0.4 },
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
});
