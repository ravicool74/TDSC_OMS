import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '@/src/theme';
import { useAuth } from '@/src/AuthContext';
import { canView } from '@/src/rbac';

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const showDashboard = canView(user, 'dashboard');
  const showBusiness = canView(user, 'business');
  const showTasks = canView(user, 'task');
  const showMore = canView(user, 'more');

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brandPrimary,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          height: 56 + Math.max(insets.bottom, 10),
          paddingTop: 6,
          paddingBottom: Math.max(insets.bottom, 8),
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      <Tabs.Screen
        name="dashboard"
        options={{
          href: showDashboard ? undefined : null,
          title: 'Dashboard',
          tabBarIcon: ({ color, size }) => <Ionicons name="grid" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="business"
        options={{
          href: showBusiness ? undefined : null,
          title: 'Business',
          tabBarIcon: ({ color, size }) => <Ionicons name="briefcase" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="tasks"
        options={{
          href: showTasks ? undefined : null,
          title: 'Tasks',
          tabBarIcon: ({ color, size }) => <Ionicons name="checkmark-done" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          href: showMore ? undefined : null,
          title: 'More',
          tabBarIcon: ({ color, size }) => <Ionicons name="ellipsis-horizontal-circle" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
