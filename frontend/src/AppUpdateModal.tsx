import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, Modal, Pressable, Linking, Platform, ActivityIndicator, Alert, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { colors, spacing, radius, font, shadow } from './theme';

export interface AppVersionInfo {
  version: string;
  version_code: number;
  apk_url: string;
  fallback_apk_url?: string;
  release_notes: string;
  mandatory?: boolean;
}

export const LOCAL_APP_VERSION = Constants.expoConfig?.version || '1.3.5';
export const LOCAL_APP_VERSION_CODE = Number(Constants.expoConfig?.android?.versionCode || 10);

const DISMISSED_KEY = 'tdsc_update_dismissed_timestamp';
const BASE_URL = process.env.EXPO_PUBLIC_BACKEND_URL || 'https://tdscoms.onrender.com';

interface AppUpdateContextType {
  checkForUpdates: (silent?: boolean) => Promise<void>;
  isChecking: boolean;
  updateInfo: AppVersionInfo | null;
}

const AppUpdateContext = createContext<AppUpdateContextType>({
  checkForUpdates: async () => {},
  isChecking: false,
  updateInfo: null,
});

export function useAppUpdate() {
  return useContext(AppUpdateContext);
}

export function AppUpdateProvider({ children }: { children: React.ReactNode }) {
  const [updateInfo, setUpdateInfo] = useState<AppVersionInfo | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

  const fetchVersionInfo = async (): Promise<AppVersionInfo | null> => {
    try {
      const res = await fetch(`${BASE_URL}/api/app/version`, {
        headers: { 'Cache-Control': 'no-cache' },
      });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  };

  const checkForUpdates = useCallback(async (silent = false) => {
    // Web application updates automatically on page reload; do not prompt web users to download an Android APK
    if (Platform.OS === 'web') {
      if (!silent) {
        showAlert('TDSC Web App', `You are running the Web App (v${LOCAL_APP_VERSION}). The web application automatically loads the latest version on refresh.`);
      }
      return;
    }

    setIsChecking(true);
    try {
      const remote = await fetchVersionInfo();
      if (!remote) {
        if (!silent) {
          showAlert('Update Check', 'Could not connect to update server. Please check your internet connection.');
        }
        return;
      }

      const hasNewVersion = remote.version_code > LOCAL_APP_VERSION_CODE;

      if (hasNewVersion) {
        setUpdateInfo(remote);
        // If not mandatory, check if user dismissed within last 24h
        if (silent && !remote.mandatory) {
          const dismissedAt = await AsyncStorage.getItem(DISMISSED_KEY);
          if (dismissedAt) {
            const hoursSince = (Date.now() - Number(dismissedAt)) / (1000 * 60 * 60);
            if (hoursSince < 24) return; // Don't nag user repeatedly
          }
        }
        setModalVisible(true);
      } else {
        if (!silent) {
          showAlert('You are up to date!', `TDSC Office Management System v${LOCAL_APP_VERSION} is the latest version available.`);
        }
      }
    } finally {
      setIsChecking(false);
    }
  }, []);

  const showAlert = (title: string, message: string) => {
    if (Platform.OS === 'web') {
      window.alert(`${title}\n\n${message}`);
    } else {
      Alert.alert(title, message);
    }
  };

  // Run a background check on app launch
  useEffect(() => {
    const timer = setTimeout(() => {
      checkForUpdates(true);
    }, 2000);
    return () => clearTimeout(timer);
  }, [checkForUpdates]);

  const handleUpdatePress = async () => {
    if (!updateInfo) return;
    setIsDownloading(true);
    try {
      const url = updateInfo.apk_url || `${BASE_URL}/download-apk`;
      const supported = await Linking.canOpenURL(url);
      if (supported) {
        await Linking.openURL(url);
      } else if (updateInfo.fallback_apk_url) {
        await Linking.openURL(updateInfo.fallback_apk_url);
      } else {
        showAlert('Download', `Please visit ${url} to download the update.`);
      }
    } catch (e: any) {
      if (updateInfo.fallback_apk_url) {
        Linking.openURL(updateInfo.fallback_apk_url);
      } else {
        showAlert('Update Error', e?.message || 'Could not launch download.');
      }
    } finally {
      setIsDownloading(false);
    }
  };

  const handleDismiss = async () => {
    if (updateInfo?.mandatory) return;
    await AsyncStorage.setItem(DISMISSED_KEY, String(Date.now()));
    setModalVisible(false);
  };

  return (
    <AppUpdateContext.Provider value={{ checkForUpdates, isChecking, updateInfo }}>
      {children}
      <Modal
        visible={modalVisible}
        transparent
        animationType="fade"
        onRequestClose={handleDismiss}
      >
        <View style={styles.overlay}>
          <View style={styles.card}>
            {/* Header Badge */}
            <View style={styles.badgeContainer}>
              <View style={styles.iconCircle}>
                <Ionicons name="cloud-download" size={32} color={colors.brandPrimary} />
              </View>
            </View>

            <Text style={styles.title}>Update Available!</Text>
            <View style={styles.versionRow}>
              <View style={styles.versionPillOld}>
                <Text style={styles.versionPillOldText}>Current: v{LOCAL_APP_VERSION}</Text>
              </View>
              <Ionicons name="arrow-forward" size={14} color={colors.muted} />
              <View style={styles.versionPillNew}>
                <Text style={styles.versionPillNewText}>New: v{updateInfo?.version || '1.1.0'}</Text>
              </View>
            </View>

            {/* Release Notes */}
            <Text style={styles.notesLabel}>What's New in this update:</Text>
            <ScrollView style={styles.notesBox} contentContainerStyle={{ padding: spacing.sm }}>
              <Text style={styles.notesText}>{updateInfo?.release_notes || 'Performance improvements and bug fixes.'}</Text>
            </ScrollView>

            {/* Actions */}
            <Pressable
              style={[styles.primaryBtn, isDownloading && { opacity: 0.7 }]}
              onPress={handleUpdatePress}
              disabled={isDownloading}
            >
              {isDownloading ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <>
                  <Ionicons name="download-outline" size={18} color="#FFFFFF" />
                  <Text style={styles.primaryBtnText}>Download & Update Now</Text>
                </>
              )}
            </Pressable>

            {!updateInfo?.mandatory && (
              <Pressable style={styles.secondaryBtn} onPress={handleDismiss} disabled={isDownloading}>
                <Text style={styles.secondaryBtnText}>Remind Me Later</Text>
              </Pressable>
            )}
          </View>
        </View>
      </Modal>
    </AppUpdateContext.Provider>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    alignItems: 'center',
    ...shadow.card,
  },
  badgeContainer: {
    marginTop: -48,
    marginBottom: spacing.md,
  },
  iconCircle: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: colors.brandTertiary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: colors.surface,
  },
  title: {
    fontSize: font.xl,
    fontWeight: '800',
    color: colors.onSurface,
    marginBottom: spacing.xs,
    textAlign: 'center',
  },
  versionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  versionPillOld: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSecondary,
  },
  versionPillOldText: {
    fontSize: font.sm,
    color: colors.muted,
    fontWeight: '600',
  },
  versionPillNew: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: '#DCFCE7',
  },
  versionPillNewText: {
    fontSize: font.sm,
    color: '#16A34A',
    fontWeight: '700',
  },
  notesLabel: {
    alignSelf: 'flex-start',
    fontSize: font.sm,
    fontWeight: '700',
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  notesBox: {
    width: '100%',
    maxHeight: 140,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.lg,
  },
  notesText: {
    fontSize: font.base,
    color: colors.onSurfaceSecondary,
    lineHeight: 20,
  },
  primaryBtn: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.brandPrimary,
    paddingVertical: spacing.md + 2,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontSize: font.lg,
    fontWeight: '700',
  },
  secondaryBtn: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  secondaryBtnText: {
    color: colors.muted,
    fontSize: font.base,
    fontWeight: '600',
  },
});
