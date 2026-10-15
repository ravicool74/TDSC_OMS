import React from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, Platform, useWindowDimensions, Image } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, usePathname } from 'expo-router';
import { colors, spacing, radius, font } from './theme';
import { useAuth } from './AuthContext';

interface CustomerLayoutProps {
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  activeTab?: 'dashboard' | 'profile' | 'tenders' | 'services' | 'requests' | 'new';
  rightAction?: React.ReactNode;
}

export const CustomerLayout: React.FC<CustomerLayoutProps> = ({
  title,
  subtitle,
  children,
  activeTab = 'dashboard',
  rightAction,
}) => {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const { width } = useWindowDimensions();
  const isDesktop = width >= 768;

  const navItems = [
    { key: 'dashboard', label: 'Dashboard', icon: 'grid-outline', route: '/customer/dashboard' },
    { key: 'profile', label: 'My Profile', icon: 'person-outline', route: '/customer/profile' },
    { key: 'tenders', label: 'My Tender', icon: 'document-text-outline', route: '/customer/tenders' },
    { key: 'services', label: 'Services Catalogue', icon: 'construct-outline', route: '/customer/services' },
    { key: 'requests', label: 'My Requests', icon: 'clipboard-outline', route: '/customer/requests' },
  ];

  const handleLogout = async () => {
    try {
      await logout();
      router.replace('/login');
    } catch {
      router.replace('/login');
    }
  };

  return (
    <SafeAreaView edges={['top']} style={styles.container}>
      {/* Top Header Bar */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Pressable onPress={() => router.push('/customer/dashboard' as any)} style={styles.brandRow}>
            <Image
              source={require('../assets/images/company-logo.jpg')}
              style={styles.logo}
              resizeMode="contain"
            />
            <View>
              <Text style={styles.brandTitle}>TDSC Customer Portal</Text>
              <Text style={styles.brandSub}>Triveni DSC & e-Tender Service</Text>
            </View>
          </Pressable>
        </View>

        {isDesktop && (
          <View style={styles.desktopNav}>
            {navItems.map((item) => {
              const isActive = activeTab === item.key;
              return (
                <Pressable
                  key={item.key}
                  onPress={() => router.push(item.route as any)}
                  style={[styles.desktopNavItem, isActive && styles.desktopNavItemActive]}
                >
                  <Ionicons
                    name={item.icon as any}
                    size={16}
                    color={isActive ? colors.brandPrimary : colors.muted}
                  />
                  <Text style={[styles.desktopNavText, isActive && styles.desktopNavTextActive]}>
                    {item.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}

        <View style={styles.headerRight}>
          <View style={styles.userBadge}>
            <Text style={styles.userName} numberOfLines={1}>
              {user?.name || user?.agency_name || 'Customer'}
            </Text>
            <View style={styles.idChip}>
              <Text style={styles.idChipText}>ID: {user?.user_id || '---'}</Text>
            </View>
          </View>
          <Pressable onPress={handleLogout} style={styles.logoutBtn} testID="customer-logout-btn">
            <Ionicons name="log-out-outline" size={20} color={colors.error} />
          </Pressable>
        </View>
      </View>

      {/* Mobile Sub-Navigation Bar */}
      {!isDesktop && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.mobileNavScroll} contentContainerStyle={styles.mobileNavContainer}>
          {navItems.map((item) => {
            const isActive = activeTab === item.key;
            return (
              <Pressable
                key={item.key}
                onPress={() => router.push(item.route as any)}
                style={[styles.mobileNavItem, isActive && styles.mobileNavItemActive]}
              >
                <Ionicons
                  name={item.icon as any}
                  size={15}
                  color={isActive ? colors.brandPrimary : colors.muted}
                />
                <Text style={[styles.mobileNavText, isActive && styles.mobileNavTextActive]}>
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      {/* Page Title & Action Bar (if provided) */}
      {(title || rightAction) && (
        <View style={styles.titleBar}>
          <View style={{ flex: 1 }}>
            {title && <Text style={styles.pageTitle}>{title}</Text>}
            {subtitle && <Text style={styles.pageSubtitle}>{subtitle}</Text>}
          </View>
          {rightAction}
        </View>
      )}

      {/* Main Content Area */}
      <View style={styles.content}>
        {children}
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    minHeight: 64,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  logo: {
    width: 38,
    height: 38,
    borderRadius: 8,
    backgroundColor: colors.surfaceSecondary,
  },
  brandTitle: {
    fontSize: font.base,
    fontWeight: '800',
    color: '#0F172A',
  },
  brandSub: {
    fontSize: font.sm - 2,
    color: colors.muted,
  },
  desktopNav: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  desktopNavItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
  },
  desktopNavItemActive: {
    backgroundColor: '#EFF6FF',
  },
  desktopNavText: {
    fontSize: font.base - 1,
    fontWeight: '600',
    color: colors.muted,
  },
  desktopNavTextActive: {
    color: colors.brandPrimary,
    fontWeight: '700',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  userBadge: {
    alignItems: 'flex-end',
    maxWidth: 160,
  },
  userName: {
    fontSize: font.sm,
    fontWeight: '700',
    color: '#1E293B',
  },
  idChip: {
    backgroundColor: '#E0E7FF',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
    marginTop: 2,
  },
  idChipText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#3730A3',
  },
  logoutBtn: {
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: '#FEE2E2',
  },
  mobileNavScroll: {
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    maxHeight: 46,
  },
  mobileNavContainer: {
    flexDirection: 'row',
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    gap: 6,
  },
  mobileNavItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSecondary,
  },
  mobileNavItemActive: {
    backgroundColor: '#DBEAFE',
  },
  mobileNavText: {
    fontSize: font.xs,
    fontWeight: '600',
    color: colors.muted,
  },
  mobileNavTextActive: {
    color: colors.brandPrimary,
    fontWeight: '700',
  },
  titleBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    backgroundColor: '#F8FAFC',
  },
  pageTitle: {
    fontSize: font.xl,
    fontWeight: '800',
    color: '#0F172A',
  },
  pageSubtitle: {
    fontSize: font.xs + 1,
    color: colors.muted,
    marginTop: 2,
  },
  content: {
    flex: 1,
  },
});
