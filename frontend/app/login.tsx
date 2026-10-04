import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, Pressable, KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, font } from '@/src/theme';
import { useAuth } from '@/src/AuthContext';
import { PrimaryButton } from '@/src/ui';

export default function LoginScreen() {
  const { loginEmail, loginGoogle } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!email.trim() || !password) {
      setErr('Please enter both email and password');
      return;
    }
    setErr(null); setBusy(true);
    try {
      await loginEmail(email.trim(), password);
    } catch (e: any) {
      setErr(e?.message || 'Login failed');
    } finally { setBusy(false); }
  };

  const google = async () => {
    setErr(null); setBusy(true);
    try { await loginGoogle(); } catch (e: any) { setErr(e?.message || 'Failed'); } finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']} testID="login-screen">
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
          <LinearGradient colors={[colors.brandSecondary, colors.brandPrimary]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.header}>
            <View style={styles.logo}>
              <Image source={require('../assets/images/company-logo.jpg')} style={styles.logoImg} resizeMode="contain" />
            </View>
            <Text style={styles.brand}>TDSC Office Management System</Text>
            <Text style={styles.brandSub}>Triveni DSC & e-Tender Service Pvt. Ltd.</Text>
          </LinearGradient>

          <View style={styles.card}>
            <View style={styles.field}>
              <Text style={styles.label}>Email</Text>
              <TextInput testID="input-email" value={email} onChangeText={setEmail} placeholder="you@triveni.com" autoCapitalize="none" keyboardType="email-address" style={styles.input} />
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>Password</Text>
              <TextInput testID="input-password" value={password} onChangeText={setPassword} placeholder="••••••••" secureTextEntry style={styles.input} />
            </View>

            {err ? <Text style={styles.err} testID="login-error">{err}</Text> : null}

            <PrimaryButton testID="submit-btn" label="Login" onPress={submit} loading={busy} />

            <View style={styles.divider}><View style={styles.line} /><Text style={styles.dividerText}>OR</Text><View style={styles.line} /></View>

            <Pressable testID="google-btn" onPress={google} style={styles.googleBtn}>
              <Ionicons name="logo-google" size={18} color={colors.onSurface} />
              <Text style={styles.googleText}>Continue with Google</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceSecondary },
  header: { paddingHorizontal: spacing.xl, paddingTop: spacing.xxxl, paddingBottom: spacing.xxxl, alignItems: 'center' },
  logo: { width: 88, height: 88, borderRadius: 16, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md, padding: 8 },
  logoImg: { width: '100%', height: '100%' },
  brand: { color: colors.onBrandPrimary, fontSize: font.xxl, fontWeight: '800' },
  brandSub: { color: colors.onBrandPrimary, opacity: 0.85, marginTop: 4, fontSize: font.base },
  card: { backgroundColor: colors.surface, marginHorizontal: spacing.lg, marginTop: -spacing.xl, borderRadius: radius.lg, padding: spacing.xl, gap: spacing.md, borderWidth: 1, borderColor: colors.border },
  field: { gap: 6 },
  label: { fontSize: font.sm, color: colors.muted, fontWeight: '600' },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 12, fontSize: font.lg, color: colors.onSurface, backgroundColor: colors.surface },
  err: { color: colors.error, fontSize: font.base, textAlign: 'center' },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  line: { flex: 1, height: 1, backgroundColor: colors.border },
  dividerText: { color: colors.muted, fontSize: font.sm },
  googleBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, minHeight: 48, backgroundColor: colors.surface },
  googleText: { color: colors.onSurface, fontWeight: '600', fontSize: font.lg },
});
