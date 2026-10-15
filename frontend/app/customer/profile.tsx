import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, Alert, Platform, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { colors, spacing, radius, font, shadow } from '@/src/theme';
import { api } from '@/src/api';
import { useAuth } from '@/src/AuthContext';
import { CustomerLayout } from '@/src/CustomerLayout';
import { Card, ScreenLoader, PrimaryButton, SecondaryButton } from '@/src/ui';
import { notify } from '@/src/dialog';

export default function CustomerProfileScreen() {
  const { user } = useAuth();
  const params = useLocalSearchParams();
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // Masking toggles
  const [showPan, setShowPan] = useState(false);
  const [showAadhaar, setShowAadhaar] = useState(false);

  // Edit Profile Modal
  const [editModal, setEditModal] = useState(false);
  const [agencyName, setAgencyName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [address, setAddress] = useState('');
  const [mobile, setMobile] = useState('');
  const [email, setEmail] = useState('');
  const [regNo, setRegNo] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  // Change Password state
  const [activeTab, setActiveTab] = useState<'details' | 'password'>(params.tab === 'password' ? 'password' : 'details');
  const [currentPwd, setCurrentPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [pwdBusy, setPwdBusy] = useState(false);
  const [pwdError, setPwdError] = useState<string | null>(null);
  const [pwdSuccess, setPwdSuccess] = useState<string | null>(null);

  const loadProfile = async () => {
    try {
      const data = await api.getCustomerProfile();
      setProfile(data);
      setAgencyName(data.agency_name || data.name || '');
      setCompanyName(data.company_name || data.name || '');
      setAddress(data.address || '');
      setMobile(data.mobile || '');
      setEmail(data.email || '');
      setRegNo(data.registration_number || '');
    } catch (e: any) {
      notify(e?.message || 'Failed to load profile');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProfile();
  }, []);

  const maskPan = (pan?: string) => {
    if (!pan) return 'Not Provided';
    if (showPan) return pan;
    if (pan.length >= 10) return `${pan.slice(0, 4)}••••${pan.slice(-2)}`;
    return '••••••••';
  };

  const maskAadhaar = (aadhaar?: string) => {
    if (!aadhaar) return 'Not Provided';
    if (showAadhaar) return aadhaar;
    if (aadhaar.length >= 12) return `•••• •••• ${aadhaar.slice(-4)}`;
    return '•••• •••• ••••';
  };

  const handleSaveProfile = async () => {
    if (!mobile || mobile.length < 10) {
      setProfileError('Please enter a valid 10-digit mobile number');
      return;
    }
    setProfileError(null);
    setSavingProfile(true);
    try {
      const updated = await api.updateCustomerProfile({
        agency_name: agencyName.trim(),
        company_name: companyName.trim(),
        address: address.trim(),
        mobile: mobile.trim(),
        email: email.trim(),
        registration_number: regNo.trim(),
      });
      setProfile(updated);
      setEditModal(false);
      notify('Profile updated successfully');
    } catch (e: any) {
      setProfileError(e?.message || 'Failed to update profile');
    } finally {
      setSavingProfile(false);
    }
  };

  const handleChangePassword = async () => {
    if (!currentPwd || !newPwd) {
      setPwdError('Please enter both current and new password');
      return;
    }
    if (newPwd.length < 6) {
      setPwdError('New password must be at least 6 characters');
      return;
    }
    if (newPwd !== confirmPwd) {
      setPwdError('New password and confirmation do not match');
      return;
    }
    setPwdError(null);
    setPwdBusy(true);
    try {
      const res = await api.changeCustomerPassword(currentPwd, newPwd);
      setPwdSuccess(res?.message || 'Password changed successfully!');
      setCurrentPwd('');
      setNewPwd('');
      setConfirmPwd('');
      notify('Password changed successfully');
    } catch (e: any) {
      setPwdError(e?.message || 'Failed to change password');
    } finally {
      setPwdBusy(false);
    }
  };

  if (loading) {
    return (
      <CustomerLayout activeTab="profile">
        <ScreenLoader label="Loading profile..." />
      </CustomerLayout>
    );
  }

  return (
    <CustomerLayout
      activeTab="profile"
      title="My Contractor Profile"
      subtitle="View and manage your verified account & compliance details"
      rightAction={
        <PrimaryButton
          title="Edit Profile"
          icon="create-outline"
          onPress={() => setEditModal(true)}
          style={{ height: 40, paddingHorizontal: 16 }}
        />
      }
    >
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {/* Navigation Tabs */}
        <View style={styles.tabBar}>
          <Pressable
            style={[styles.tabItem, activeTab === 'details' && styles.tabItemActive]}
            onPress={() => setActiveTab('details')}
          >
            <Ionicons
              name="person-circle-outline"
              size={18}
              color={activeTab === 'details' ? colors.brandPrimary : colors.muted}
            />
            <Text style={[styles.tabText, activeTab === 'details' && styles.tabTextActive]}>
              Contractor Identity
            </Text>
          </Pressable>
          <Pressable
            style={[styles.tabItem, activeTab === 'password' && styles.tabItemActive]}
            onPress={() => setActiveTab('password')}
          >
            <Ionicons
              name="key-outline"
              size={18}
              color={activeTab === 'password' ? colors.brandPrimary : colors.muted}
            />
            <Text style={[styles.tabText, activeTab === 'password' && styles.tabTextActive]}>
              Security & Password
            </Text>
          </Pressable>
        </View>

        {activeTab === 'details' ? (
          <>
            {/* Identity Header Card */}
            <View style={styles.card}>
              <View style={styles.profileHeaderRow}>
                <View style={styles.avatarWrap}>
                  <Ionicons name="business" size={32} color={colors.brandPrimary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.contractorName}>{profile?.name || 'Contractor'}</Text>
                  <Text style={styles.contractorSub}>{profile?.company_name || profile?.agency_name || 'Agency'}</Text>
                  <View style={styles.idChipRow}>
                    <View style={styles.idChip}>
                      <Text style={styles.idChipText}>User ID: {profile?.numeric_user_id || user?.user_id}</Text>
                    </View>
                    {profile?.customer_code && (
                      <View style={[styles.idChip, { backgroundColor: '#E0F2FE' }]}>
                        <Text style={[styles.idChipText, { color: '#0369A1' }]}>{profile?.customer_code}</Text>
                      </View>
                    )}
                  </View>
                </View>
              </View>
            </View>

            {/* Profile Fields Grid */}
            <View style={styles.card}>
              <Text style={styles.cardSectionHeader}>Official Details</Text>
              <View style={styles.fieldsGrid}>
                <View style={styles.fieldItem}>
                  <Text style={styles.fieldLabel}>Numeric Customer ID</Text>
                  <Text style={[styles.fieldValue, { color: colors.brandPrimary, fontWeight: '800' }]}>
                    {profile?.numeric_user_id || user?.user_id || '---'}
                  </Text>
                </View>

                <View style={styles.fieldItem}>
                  <Text style={styles.fieldLabel}>Name of Agency</Text>
                  <Text style={styles.fieldValue}>{profile?.agency_name || profile?.name || '---'}</Text>
                </View>

                <View style={styles.fieldItem}>
                  <Text style={styles.fieldLabel}>Company Name</Text>
                  <Text style={styles.fieldValue}>{profile?.company_name || profile?.name || '---'}</Text>
                </View>

                <View style={styles.fieldItem}>
                  <Text style={styles.fieldLabel}>Registration Number</Text>
                  <Text style={styles.fieldValue}>{profile?.registration_number || 'Not Registered'}</Text>
                </View>

                <View style={styles.fieldItem}>
                  <Text style={styles.fieldLabel}>Mobile Number</Text>
                  <Text style={styles.fieldValue}>{profile?.mobile || '---'}</Text>
                </View>

                <View style={styles.fieldItem}>
                  <Text style={styles.fieldLabel}>Email Address</Text>
                  <Text style={styles.fieldValue}>{profile?.email || '---'}</Text>
                </View>

                <View style={[styles.fieldItem, { width: '100%' }]}>
                  <Text style={styles.fieldLabel}>Complete Address</Text>
                  <Text style={styles.fieldValue}>{profile?.address || 'Address not updated'}</Text>
                </View>
              </View>
            </View>

            {/* Compliance & Sensitive Identifiers Card */}
            <View style={styles.card}>
              <Text style={styles.cardSectionHeader}>Sensitive Compliance Identifiers</Text>
              <Text style={styles.cardSectionSub}>
                Identity numbers are masked for data privacy. Click the eye icon to preview.
              </Text>

              <View style={styles.sensitiveRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>PAN Number</Text>
                  <Text style={styles.sensitiveValue}>{maskPan(profile?.pan)}</Text>
                </View>
                <Pressable style={styles.maskToggleBtn} onPress={() => setShowPan(!showPan)}>
                  <Ionicons name={showPan ? 'eye-off' : 'eye'} size={18} color={colors.brandPrimary} />
                  <Text style={styles.maskToggleText}>{showPan ? 'Mask' : 'Reveal'}</Text>
                </Pressable>
              </View>

              <View style={[styles.sensitiveRow, { borderBottomWidth: 0 }]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>Aadhaar Number</Text>
                  <Text style={styles.sensitiveValue}>{maskAadhaar(profile?.aadhar)}</Text>
                </View>
                <Pressable style={styles.maskToggleBtn} onPress={() => setShowAadhaar(!showAadhaar)}>
                  <Ionicons name={showAadhaar ? 'eye-off' : 'eye'} size={18} color={colors.brandPrimary} />
                  <Text style={styles.maskToggleText}>{showAadhaar ? 'Mask' : 'Reveal'}</Text>
                </Pressable>
              </View>
            </View>
          </>
        ) : (
          /* Change Password Screen */
          <View style={styles.card}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: spacing.md }}>
              <Ionicons name="shield-checkmark" size={24} color={colors.brandPrimary} />
              <View>
                <Text style={styles.cardSectionHeader}>Change Account Password</Text>
                <Text style={styles.cardSectionSub}>
                  Ensure your account is protected with a strong password.
                </Text>
              </View>
            </View>

            {pwdSuccess && (
              <View style={styles.successBox}>
                <Ionicons name="checkmark-circle" size={18} color="#059669" />
                <Text style={styles.successText}>{pwdSuccess}</Text>
              </View>
            )}

            {pwdError && (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle" size={18} color="#DC2626" />
                <Text style={styles.errorText}>{pwdError}</Text>
              </View>
            )}

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Current Password *</Text>
              <TextInput
                style={styles.input}
                value={currentPwd}
                onChangeText={setCurrentPwd}
                secureTextEntry
                placeholder="Enter current password"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>New Password *</Text>
              <TextInput
                style={styles.input}
                value={newPwd}
                onChangeText={setNewPwd}
                secureTextEntry
                placeholder="Minimum 6 characters"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Confirm New Password *</Text>
              <TextInput
                style={styles.input}
                value={confirmPwd}
                onChangeText={setConfirmPwd}
                secureTextEntry
                placeholder="Re-enter new password"
              />
            </View>

            <PrimaryButton
              title="Update Password"
              onPress={handleChangePassword}
              loading={pwdBusy}
              style={{ marginTop: spacing.md }}
            />
          </View>
        )}
      </ScrollView>

      {/* Edit Profile Modal */}
      <Modal visible={editModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Edit Profile Information</Text>
              <Pressable onPress={() => setEditModal(false)}>
                <Ionicons name="close" size={24} color={colors.muted} />
              </Pressable>
            </View>

            {profileError && (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle" size={18} color="#DC2626" />
                <Text style={styles.errorText}>{profileError}</Text>
              </View>
            )}

            <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ gap: spacing.md }}>
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Name of Agency</Text>
                <TextInput style={styles.input} value={agencyName} onChangeText={setAgencyName} />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Company Name</Text>
                <TextInput style={styles.input} value={companyName} onChangeText={setCompanyName} />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Mobile Number *</Text>
                <TextInput style={styles.input} value={mobile} onChangeText={setMobile} keyboardType="phone-pad" />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Email Address</Text>
                <TextInput style={styles.input} value={email} onChangeText={setEmail} keyboardType="email-address" />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Registration Number</Text>
                <TextInput style={styles.input} value={regNo} onChangeText={setRegNo} />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Address</Text>
                <TextInput
                  style={[styles.input, { height: 70, textAlignVertical: 'top' }]}
                  value={address}
                  onChangeText={setAddress}
                  multiline
                />
              </View>
            </ScrollView>

            <View style={styles.modalActions}>
              <SecondaryButton title="Cancel" onPress={() => setEditModal(false)} style={{ flex: 1 }} />
              <PrimaryButton title="Save Changes" onPress={handleSaveProfile} loading={savingProfile} style={{ flex: 1 }} />
            </View>
          </View>
        </View>
      </Modal>
    </CustomerLayout>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.lg, gap: spacing.lg },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#E2E8F0',
    borderRadius: radius.md,
    padding: 4,
    gap: 4,
  },
  tabItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: radius.sm,
  },
  tabItemActive: {
    backgroundColor: colors.surface,
    ...shadow.card,
  },
  tabText: {
    fontSize: font.base,
    fontWeight: '600',
    color: colors.muted,
  },
  tabTextActive: {
    color: colors.brandPrimary,
    fontWeight: '700',
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
    ...shadow.card,
  },
  profileHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
  },
  avatarWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  contractorName: {
    fontSize: font.xl,
    fontWeight: '800',
    color: '#0F172A',
  },
  contractorSub: {
    fontSize: font.base,
    color: colors.muted,
    marginTop: 2,
  },
  idChipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
  },
  idChip: {
    backgroundColor: '#EEF2FF',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.sm,
  },
  idChipText: {
    fontSize: font.xs,
    fontWeight: '800',
    color: '#4338CA',
  },
  cardSectionHeader: {
    fontSize: font.lg,
    fontWeight: '800',
    color: '#0F172A',
  },
  cardSectionSub: {
    fontSize: font.xs,
    color: colors.muted,
    marginTop: -4,
  },
  fieldsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginTop: 4,
  },
  fieldItem: {
    flex: 1,
    minWidth: 220,
    backgroundColor: '#F8FAFC',
    padding: spacing.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  fieldLabel: {
    fontSize: font.xs,
    color: colors.muted,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  fieldValue: {
    fontSize: font.base,
    color: '#1E293B',
    fontWeight: '700',
    marginTop: 4,
  },
  sensitiveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  sensitiveValue: {
    fontSize: font.base + 1,
    fontWeight: '800',
    color: '#0F172A',
    marginTop: 4,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    letterSpacing: 1,
  },
  maskToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.sm,
    backgroundColor: '#EFF6FF',
  },
  maskToggleText: {
    fontSize: font.xs,
    fontWeight: '700',
    color: colors.brandPrimary,
  },
  inputGroup: {
    gap: 6,
  },
  inputLabel: {
    fontSize: font.sm,
    fontWeight: '600',
    color: '#334155',
  },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: font.base,
    color: '#0F172A',
  },
  successBox: {
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    padding: spacing.md,
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  successText: {
    color: '#065F46',
    fontSize: font.sm,
    fontWeight: '600',
  },
  errorBox: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    padding: spacing.md,
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  errorText: {
    color: '#991B1B',
    fontSize: font.sm,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  modalCard: {
    width: '100%',
    maxWidth: 520,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    gap: spacing.md,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalTitle: {
    fontSize: font.lg,
    fontWeight: '800',
    color: '#0F172A',
  },
  modalActions: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
});
