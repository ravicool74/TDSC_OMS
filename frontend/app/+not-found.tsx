import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { radius, spacing } from '@/src/theme';
import { useAuth } from '@/src/AuthContext';

export default function NotFoundScreen() {
  const router = useRouter();
  const { user } = useAuth();

  const handleReturn = () => {
    if (user) {
      if (user.role === 'customer') {
        router.replace('/customer/dashboard' as any);
      } else {
        router.replace('/(tabs)/dashboard');
      }
    } else {
      router.replace('/login');
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <View style={styles.iconCircle}>
          <Ionicons name="compass-outline" size={48} color="#2563EB" />
        </View>
        <Text style={styles.title}>Page Not Found</Text>
        <Text style={styles.subtitle}>
          The page you are looking for doesn't exist or has been moved.
        </Text>
        <Pressable onPress={handleReturn} style={styles.returnBtn}>
          <Ionicons name="home-outline" size={18} color="#FFF" />
          <Text style={styles.returnBtnText}>
            {user ? 'Go to Dashboard' : 'Go to Login'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: radius.lg,
    padding: spacing.xl,
    alignItems: 'center',
    maxWidth: 420,
    width: '100%',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 3,
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: spacing.xs,
  },
  subtitle: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: spacing.lg,
  },
  returnBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#2563EB',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: radius.md,
  },
  returnBtnText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '700',
  },
});
