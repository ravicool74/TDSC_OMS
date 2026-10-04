import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert, Platform, Pressable, Linking, Modal, TextInput, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { colors, spacing, radius, font, shadow } from '@/src/theme';
import { api, tokenStore } from '@/src/api';
import { Card, PrimaryButton, ScreenLoader, SecondaryButton } from '@/src/ui';
import { ScreenHeader } from '@/src/ScreenHeader';
import { useAuth } from '@/src/AuthContext';
import { confirm, notify } from '@/src/dialog';

const MAX_BYTES = 10 * 1024 * 1024;
const humanSize = (b: number) => b < 1024 ? `${b} B` : b < 1024 * 1024 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1024 / 1024).toFixed(2)} MB`;

const daysUntil = (dateStr?: string | null): number | null => {
  if (!dateStr) return null;
  let iso = dateStr.trim();
  if (/^\d{2}[-/]\d{2}[-/]\d{4}$/.test(iso)) {
    const [d, m, y] = iso.split(/[-/]/);
    iso = `${y}-${m}-${d}`;
  }
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const diff = t - Date.now();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
};

const DOC_CATEGORIES = ['PAN', 'Aadhar', 'GST Certificate', 'DSC Certificate', 'Contractor Registration', 'Bank Statement', 'Tender BoQ', 'Other'];

export default function CustomerDetail() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';
  const canEdit = isAdmin || user?.role === 'manager';

  const [c, setC] = useState<any | null>(null);
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [revealingField, setRevealingField] = useState<string | null>(null);

  // Upload modal state
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [selectedFile, setSelectedFile] = useState<any | null>(null);
  const [docCategory, setDocCategory] = useState<string>('PAN');
  const [docDate, setDocDate] = useState<string>('');
  const [docExpiryDate, setDocExpiryDate] = useState<string>('');
  const [docRemarks, setDocRemarks] = useState<string>('');
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [customFieldsList, setCustomFieldsList] = useState<any[]>([]);

  const load = useCallback(async () => {
    try {
      const [cust, cfs] = await Promise.all([
        api.get<any>(`/customers/${id}`),
        api.get<any>('/customers/custom-fields').catch(() => []),
      ]);
      setC(cust);
      setCustomFieldsList(Array.isArray(cfs) ? cfs : []);
    } catch {}
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleReveal = async (fieldName: string, fieldTitle: string) => {
    if (revealed[fieldName]) {
      // Toggle hide
      setRevealed(prev => {
        const copy = { ...prev };
        delete copy[fieldName];
        return copy;
      });
      return;
    }

    const ok = await confirm(
      `Reveal ${fieldTitle}?`,
      'This action will be permanently recorded in the TDSC Security Audit Trail with your user ID and timestamp.',
      { confirmText: 'Reveal', destructive: false }
    );
    if (!ok) return;

    setRevealingField(fieldName);
    try {
      const res = await api.revealCredential(String(id), fieldName);
      setRevealed(prev => ({ ...prev, [fieldName]: res.value || '(Empty)' }));
    } catch (e: any) {
      notify('Reveal Failed', e?.message || 'Unauthorized or failed');
    } finally {
      setRevealingField(null);
    }
  };

  const pickFile = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
      if (res.canceled || !res.assets?.length) return;
      const asset = res.assets[0];
      if (asset.size && asset.size > MAX_BYTES) {
        Alert.alert('File too large', `"${asset.name}" is ${humanSize(asset.size)}. Maximum allowed is 10 MB.`);
        return;
      }
      setSelectedFile(asset);
    } catch {}
  };

  const submitUploadDoc = async () => {
    if (!selectedFile) {
      Alert.alert('Required', 'Please choose a document file first.');
      return;
    }
    setUploading(true);
    setErr(null);
    try {
      await api.uploadCustomerDoc(
        String(id),
        { uri: selectedFile.uri, name: selectedFile.name, type: selectedFile.mimeType || 'application/octet-stream' },
        docCategory,
        docDate || undefined,
        docExpiryDate || undefined,
        docRemarks || undefined
      );
      setShowUploadModal(false);
      setSelectedFile(null);
      setDocExpiryDate('');
      setDocRemarks('');
      await load();
      notify('Success', 'Document uploaded and expiry alert configured.');
    } catch (e: any) {
      setErr(e?.message || 'Failed uploading document');
    } finally {
      setUploading(false);
    }
  };

  const removeDoc = async (docId: string) => {
    const ok = await confirm('Delete Document?', 'This document attachment will be permanently removed.', { confirmText: 'Delete', destructive: true });
    if (!ok) return;
    try {
      await api.del(`/customers/${id}/documents/${docId}`);
      await load();
    } catch (e: any) {
      notify('Failed', e?.message || 'Unable to delete');
    }
  };

  const openFile = async (filePath: string) => {
    const token = await tokenStore.get();
    const url = `${api.base}/api/files/${filePath}?token=${encodeURIComponent(token || '')}`;
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.open(url, '_blank');
    } else {
      await Linking.openURL(url);
    }
  };

  if (!c) return (
    <View style={{ flex: 1, backgroundColor: colors.surfaceSecondary }}>
      <ScreenHeader title="Customer Master" />
      <ScreenLoader />
    </View>
  );

  const documents: any[] = c.documents || [];
  const legacyAttachments: any[] = c.attachments || [];

  return (
    <View style={{ flex: 1, backgroundColor: colors.surfaceSecondary }} testID="customer-detail">
      <ScreenHeader
        title={c.customer_code || 'Customer'}
        right={(
          <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
            <Pressable
              testID="print-cust-hdr"
              hitSlop={8}
              onPress={async () => {
                try {
                  const url = await api.customerPdfUrl(id);
                  if (Platform.OS === 'web' && typeof window !== 'undefined') window.open(url, '_blank');
                  else await Linking.openURL(url);
                } catch (e: any) { notify('Failed', e?.message || 'Try again'); }
              }}
            >
              <Ionicons name="print" size={22} color={colors.brandPrimary} />
            </Pressable>
            {canEdit ? (
              <Pressable testID="edit-cust-hdr" hitSlop={8} onPress={() => router.push({ pathname: '/customers/new', params: { edit_id: id } } as any)}>
                <Ionicons name="create-outline" size={22} color="#B45309" />
              </Pressable>
            ) : null}
            {isAdmin ? (
              <Pressable
                testID="del-cust-hdr"
                hitSlop={8}
                onPress={async () => {
                  const ok = await confirm('Delete Customer?', `${c.name} delete kar diya jayega. Yeh action undo nahi ho sakta.`, { confirmText: 'Delete', destructive: true });
                  if (!ok) return;
                  try { await api.del(`/customers/${id}`); router.back(); }
                  catch (e: any) { notify('Failed', e?.message || 'Try again'); }
                }}
              >
                <Ionicons name="trash-outline" size={22} color={colors.error} />
              </Pressable>
            ) : null}
          </View>
        )}
      />

      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: Math.max(insets.bottom + 40, spacing.xxxl) }}>
        {/* Header Summary Card */}
        <Card>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <Text style={styles.name}>{c.name}</Text>
                {c.registration_class ? (
                  <View style={{ backgroundColor: '#EEF2FF', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1, borderColor: '#C7D2FE' }}>
                    <Text style={{ fontSize: 11, fontWeight: '800', color: '#4338CA' }}>{c.registration_class}</Text>
                  </View>
                ) : null}
              </View>
              <Text style={styles.code}>{c.customer_code || c.id}</Text>
              {c.contractor_reg_no ? (
                <Text style={{ fontSize: 12, fontWeight: '700', color: '#1E293B', marginTop: 4 }}>
                  Contractor Reg: <Text style={{ color: colors.brandPrimary }}>{c.contractor_reg_no}</Text>
                  {c.registration_validity ? ` (Valid: ${c.registration_validity})` : ''}
                </Text>
              ) : null}
              {c.departments ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                  {c.departments.split(',').map((d: string) => d.trim()).filter(Boolean).map((d: string) => (
                    <View key={d} style={{ backgroundColor: '#DCFCE7', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }}>
                      <Text style={{ fontSize: 10, fontWeight: '800', color: '#15803D' }}>{d}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
          </View>

          {/* Prominent Action Bar */}
          <View style={{ marginTop: spacing.md, gap: 8, borderTopWidth: 1, borderTopColor: '#F1F5F9', paddingTop: spacing.md }}>
            {canEdit ? (
              <Pressable
                testID="btn-edit-contractor-main"
                onPress={() => router.push({ pathname: '/customers/new', params: { edit_id: id } } as any)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  backgroundColor: '#D97706',
                  paddingVertical: 12,
                  borderRadius: radius.md,
                }}
              >
                <Ionicons name="create" size={18} color="#FFF" />
                <Text style={{ color: '#FFF', fontWeight: '800', fontSize: 14 }}>Edit Contractor Profile</Text>
              </Pressable>
            ) : null}

            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Pressable
                testID="print-cust-card"
                onPress={async () => {
                  try {
                    const url = await api.customerPdfUrl(id);
                    if (Platform.OS === 'web' && typeof window !== 'undefined') window.open(url, '_blank');
                    else await Linking.openURL(url);
                  } catch (e: any) { notify('Failed', e?.message || 'Try again'); }
                }}
                style={{
                  flex: 1,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  backgroundColor: '#EFF6FF',
                  paddingVertical: 10,
                  borderRadius: radius.md,
                  borderWidth: 1,
                  borderColor: '#BFDBFE',
                }}
              >
                <Ionicons name="print-outline" size={16} color={colors.brandPrimary} />
                <Text style={{ color: colors.brandPrimary, fontWeight: '700', fontSize: 12 }}>Print PDF</Text>
              </Pressable>

              {c.mobile ? (
                <Pressable
                  onPress={() => Linking.openURL(`tel:${c.mobile}`)}
                  style={{
                    flex: 1,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    backgroundColor: '#F0FDF4',
                    paddingVertical: 10,
                    borderRadius: radius.md,
                    borderWidth: 1,
                    borderColor: '#BBF7D0',
                  }}
                >
                  <Ionicons name="call" size={16} color="#15803D" />
                  <Text style={{ color: '#15803D', fontWeight: '700', fontSize: 12 }}>Call</Text>
                </Pressable>
              ) : null}

              {c.whatsapp || c.mobile ? (
                <Pressable
                  onPress={() => {
                    const clean = (c.whatsapp || c.mobile).replace(/\D/g, '');
                    Linking.openURL(`https://wa.me/${clean.startsWith('91') ? clean : '91' + clean}`);
                  }}
                  style={{
                    flex: 1,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    backgroundColor: '#ECFDF5',
                    paddingVertical: 10,
                    borderRadius: radius.md,
                    borderWidth: 1,
                    borderColor: '#A7F3D0',
                  }}
                >
                  <Ionicons name="logo-whatsapp" size={16} color="#059669" />
                  <Text style={{ color: '#059669', fontWeight: '700', fontSize: 12 }}>WhatsApp</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        </Card>

        {/* 1. Basic Details & KYC */}
        <Card>
          <Text style={styles.sectionTitle}>Basic Details & KYC</Text>
          <Row label="Mobile" value={c.mobile} />
          <Row label="WhatsApp" value={c.whatsapp} />
          {c.alternate_mobile ? <Row label="Alt Mobile" value={c.alternate_mobile} /> : null}
          {c.email ? <Row label="Email" value={c.email} /> : null}
          <Row label="PAN" value={c.pan} />
          <Row label="Aadhar" value={c.aadhar} />
          {c.address ? <Row label="Address" value={c.address} /> : null}
          {c.gst_no ? <Row label="GST No." value={c.gst_no} /> : null}
        </Card>

        {/* 2. Contractor Enlistment & Registration */}
        {(c.contractor_reg_no || c.registration_class || c.registration_validity || c.departments) && (
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Ionicons name="ribbon-outline" size={20} color={colors.brandPrimary} />
              <Text style={styles.sectionTitle}>Contractor Registration & Enlistment</Text>
            </View>
            <Row label="Registration No." value={c.contractor_reg_no || '—'} />
            <Row label="Reg. Class" value={c.registration_class || '—'} />
            <Row label="Validity Date" value={c.registration_validity || '—'} />
            <Row label="Departments" value={c.departments || '—'} />
          </Card>
        )}

        {/* Custom Fields Card */}
        {(customFieldsList.length > 0 || (c.custom_fields && Object.keys(c.custom_fields).length > 0)) && (
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Ionicons name="layers" size={20} color={colors.brandPrimary} />
              <Text style={styles.sectionTitle}>Additional Custom Fields</Text>
            </View>
            <View style={{ gap: spacing.xs, marginTop: spacing.sm }}>
              {customFieldsList.map((cf: any) => {
                const val = c.custom_fields?.[cf.field_key];
                return (
                  <Row
                    key={cf.id}
                    label={cf.label}
                    value={val !== undefined && val !== null && String(val).trim() !== '' ? String(val) : '—'}
                  />
                );
              })}
              {Object.entries(c.custom_fields || {}).map(([k, v]) => {
                const mapped = customFieldsList.some((cf: any) => cf.field_key === k);
                if (mapped) return null;
                return (
                  <Row
                    key={k}
                    label={k.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                    value={v !== undefined && v !== null && String(v).trim() !== '' ? String(v) : '—'}
                  />
                );
              })}
            </View>
          </Card>
        )}

        {/* 3. Digital Signature (DSC) & Encryption Expiry */}
        <Card>
          <Text style={styles.sectionTitle}>Digital Signature Certificates (DSC)</Text>
          {(() => {
            const signDays = daysUntil(c.dsc_expired_date);
            const signExpired = signDays !== null && signDays < 0;
            const signWarn = signDays !== null && signDays <= 30;
            const encDays = daysUntil(c.encryption_expired_date);
            const encExpired = encDays !== null && encDays < 0;
            const encWarn = encDays !== null && encDays <= 30;
            return (
              <>
                <View style={[styles.dscBlock, signWarn && { borderColor: signExpired ? colors.error : colors.warning, borderWidth: 1.5 }]}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={styles.dscHeading}>DSC Signing</Text>
                    {signDays !== null ? (
                      <View style={{ backgroundColor: signExpired ? '#FEE2E2' : signWarn ? '#FEF3C7' : '#DCFCE7', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 }}>
                        <Text style={{ fontSize: 10, fontWeight: '800', color: signExpired ? colors.error : signWarn ? '#B45309' : '#15803D' }}>
                          {signExpired ? `Expired (${-signDays}d ago)` : signWarn ? `Expiring in ${signDays}d` : `Active (${signDays}d left)`}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  <Row label="Serial No." value={c.dsc_serial_no || '—'} />
                  <Row label="Issued Date" value={c.dsc_issued_date || '—'} />
                  <Row label="Expiry Date" value={c.dsc_expired_date || '—'} />
                </View>
                <View style={[styles.dscBlock, { marginTop: spacing.md }, encWarn && { borderColor: encExpired ? colors.error : colors.warning, borderWidth: 1.5 }]}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={styles.dscHeading}>DSC Encryption</Text>
                    {encDays !== null ? (
                      <View style={{ backgroundColor: encExpired ? '#FEE2E2' : encWarn ? '#FEF3C7' : '#DCFCE7', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 }}>
                        <Text style={{ fontSize: 10, fontWeight: '800', color: encExpired ? colors.error : encWarn ? '#B45309' : '#15803D' }}>
                          {encExpired ? `Expired (${-encDays}d ago)` : encWarn ? `Expiring in ${encDays}d` : `Active (${encDays}d left)`}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  <Row label="Serial No." value={c.encryption_serial_no || '—'} />
                  <Row label="Issued Date" value={c.encryption_issued_date || '—'} />
                  <Row label="Expiry Date" value={c.encryption_expired_date || '—'} />
                </View>
              </>
            );
          })()}
        </Card>

        {/* 4. Credential Vault (Encrypted with Reveal Eye) */}
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Ionicons name="shield-checkmark" size={20} color={colors.brandPrimary} />
            <Text style={styles.sectionTitle}>Credential Vault (AES-256)</Text>
          </View>
          <Text style={styles.muted}>Passwords are encrypted at rest. Revealing credentials is audit-logged.</Text>

          <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
            <VaultRow
              portalName="eProc2 Portal"
              userId={c.eproc2_user_id}
              email={c.eproc2_email}
              fieldName="eproc2_password"
              hasPass={!!c.eproc2_password}
              revealedVal={revealed['eproc2_password']}
              loading={revealingField === 'eproc2_password'}
              onReveal={() => handleReveal('eproc2_password', 'eProc2 Password')}
            />
            <VaultRow
              portalName="Railway (IREPS) Portal"
              userId={c.railway_user_id}
              email={c.railway_email}
              fieldName="railway_password"
              hasPass={!!c.railway_password}
              revealedVal={revealed['railway_password']}
              loading={revealingField === 'railway_password'}
              onReveal={() => handleReveal('railway_password', 'Railway Password')}
            />
            <VaultRow
              portalName="CPP Portal"
              userId={c.cpp_user_id}
              email={c.cpp_email}
              fieldName="cpp_password"
              hasPass={!!c.cpp_password}
              revealedVal={revealed['cpp_password']}
              loading={revealingField === 'cpp_password'}
              onReveal={() => handleReveal('cpp_password', 'CPP Password')}
            />
            <VaultRow
              portalName="GST Portal"
              userId={c.gst_no}
              email={c.gst_email}
              fieldName="gst_password"
              hasPass={!!c.gst_password}
              revealedVal={revealed['gst_password']}
              loading={revealingField === 'gst_password'}
              onReveal={() => handleReveal('gst_password', 'GST Password')}
            />
            <VaultRow
              portalName="EPFO Portal"
              userId={c.epfo_user_id}
              email={c.epfo_email}
              fieldName="epfo_password"
              hasPass={!!c.epfo_password}
              revealedVal={revealed['epfo_password']}
              loading={revealingField === 'epfo_password'}
              onReveal={() => handleReveal('epfo_password', 'EPFO Password')}
            />
            <VaultRow
              portalName="GeM Portal"
              userId={c.gem_user_id}
              email={c.gem_email}
              fieldName="gem_password"
              extraInfo={c.gem_seller_id ? `Seller ID: ${c.gem_seller_id}` : undefined}
              hasPass={!!c.gem_password}
              revealedVal={revealed['gem_password']}
              loading={revealingField === 'gem_password'}
              onReveal={() => handleReveal('gem_password', 'GeM Password')}
            />
            <VaultRow
              portalName="PMGSY Site"
              userId={c.pmgsy_user_id}
              email={c.pmgsy_email}
              fieldName="pmgsy_password"
              hasPass={!!c.pmgsy_password}
              revealedVal={revealed['pmgsy_password']}
              loading={revealingField === 'pmgsy_password'}
              onReveal={() => handleReveal('pmgsy_password', 'PMGSY Password')}
            />
            <VaultRow
              portalName="ISO Portal"
              userId={c.iso_user_id}
              fieldName="iso_password"
              extraInfo={c.iso_other_details ? `Scope/Details: ${c.iso_other_details}` : undefined}
              hasPass={!!c.iso_password}
              revealedVal={revealed['iso_password']}
              loading={revealingField === 'iso_password'}
              onReveal={() => handleReveal('iso_password', 'ISO Password')}
            />
            <VaultRow
              portalName="Other Portal"
              userId={c.other_portal_user_id}
              email={c.other_portal_email}
              fieldName="other_portal_password"
              hasPass={!!c.other_portal_password}
              revealedVal={revealed['other_portal_password']}
              loading={revealingField === 'other_portal_password'}
              onReveal={() => handleReveal('other_portal_password', 'Other Portal Password')}
            />
          </View>
        </Card>

        {/* 5. Office Notes & Remarks */}
        {c.notes ? (
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Ionicons name="document-text-outline" size={20} color={colors.brandPrimary} />
              <Text style={styles.sectionTitle}>Office Notes & Remarks</Text>
            </View>
            <Text style={{ color: '#334155', fontSize: font.base, marginTop: 8, lineHeight: 22, backgroundColor: '#F8FAFC', padding: 12, borderRadius: radius.sm, borderWidth: 1, borderColor: '#E2E8F0' }}>
              {c.notes}
            </Text>
          </Card>
        ) : null}

        {/* 4. Document Manager with Expiry Tracking */}
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flex: 1 }}>
              <Text style={styles.sectionTitle}>Documents & Expiry Tracking</Text>
              <Text style={styles.muted}>{documents.length + legacyAttachments.length} total files • Max 10 MB each</Text>
            </View>
            <Pressable
              testID="add-doc-btn"
              onPress={() => setShowUploadModal(true)}
              style={styles.addBtn}
            >
              <Ionicons name="cloud-upload" size={18} color="#FFF" />
              <Text style={styles.addBtnText}>Upload Doc</Text>
            </Pressable>
          </View>

          {documents.length === 0 && legacyAttachments.length === 0 ? (
            <View style={styles.emptySlot}>
              <Ionicons name="document-attach-outline" size={32} color={colors.muted} />
              <Text style={styles.muted}>No documents uploaded yet. Tap "Upload Doc" to add with category and expiry alert.</Text>
            </View>
          ) : (
            <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
              {documents.map((doc: any) => (
                <View key={doc.id} style={styles.docRow}>
                  <View style={styles.docIconBg}>
                    <Ionicons name="document-text" size={20} color={colors.brandPrimary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={styles.docName} numberOfLines={1}>{doc.name}</Text>
                      <View style={styles.catBadge}><Text style={styles.catBadgeText}>{doc.category}</Text></View>
                    </View>
                    <Text style={styles.docMeta}>
                      {humanSize(doc.size)}
                      {doc.expiry_date ? ` • Exp: ${doc.expiry_date}` : ''}
                    </Text>
                  </View>
                  <Pressable onPress={() => openFile(doc.file_path)} style={styles.iconBtn} hitSlop={10}>
                    <Ionicons name="eye-outline" size={20} color={colors.brandPrimary} />
                  </Pressable>
                  {canEdit && (
                    <Pressable onPress={() => removeDoc(doc.id)} style={styles.iconBtn} hitSlop={10}>
                      <Ionicons name="trash-outline" size={20} color={colors.error} />
                    </Pressable>
                  )}
                </View>
              ))}

              {/* Legacy attachments */}
              {legacyAttachments.map((a: any, i: number) => (
                <View key={a.path || i} style={styles.docRow}>
                  <View style={styles.docIconBg}><Ionicons name="attach" size={20} color={colors.brandSecondary} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.docName} numberOfLines={1}>{a.name}</Text>
                    <Text style={styles.docMeta}>{humanSize(a.size)} • Attachment</Text>
                  </View>
                  <Pressable onPress={() => openFile(a.path)} style={styles.iconBtn} hitSlop={10}>
                    <Ionicons name="eye-outline" size={20} color={colors.brandPrimary} />
                  </Pressable>
                </View>
              ))}
            </View>
          )}
        </Card>
      </ScrollView>

      {/* Upload Document Modal */}
      <Modal visible={showUploadModal} animationType="slide" transparent onRequestClose={() => setShowUploadModal(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Upload Customer Document</Text>
              <Pressable onPress={() => setShowUploadModal(false)} hitSlop={10}>
                <Ionicons name="close" size={22} color={colors.onSurface} />
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
              <Pressable onPress={pickFile} style={styles.filePickerBox}>
                <Ionicons name={selectedFile ? 'checkmark-circle' : 'cloud-upload-outline'} size={28} color={selectedFile ? colors.success : colors.brandPrimary} />
                <Text style={styles.filePickerText}>{selectedFile ? selectedFile.name : 'Choose PDF, Image or Office Doc (Max 10 MB)'}</Text>
              </Pressable>

              <Text style={styles.inputLabel}>Document Category</Text>
              <View style={styles.chipRow}>
                {DOC_CATEGORIES.map(cat => {
                  const sel = docCategory === cat;
                  return (
                    <Pressable key={cat} onPress={() => setDocCategory(cat)} style={[styles.catChip, sel && styles.catChipActive]}>
                      <Text style={[styles.catChipText, sel && styles.catChipTextActive]}>{cat}</Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={styles.inputLabel}>Document Date (Optional)</Text>
              <TextInput style={styles.textInput} placeholder="YYYY-MM-DD" value={docDate} onChangeText={setDocDate} />

              <Text style={styles.inputLabel}>Expiry Alert Date (Optional - For 30-Day Notifications)</Text>
              <TextInput style={styles.textInput} placeholder="YYYY-MM-DD (e.g. 2026-12-31)" value={docExpiryDate} onChangeText={setDocExpiryDate} />

              <Text style={styles.inputLabel}>Remarks</Text>
              <TextInput style={styles.textInput} placeholder="Optional notes" value={docRemarks} onChangeText={setDocRemarks} />

              {err ? <Text style={styles.errText}>{err}</Text> : null}

              <PrimaryButton label={uploading ? 'Uploading...' : 'Save & Track Expiry'} onPress={submitUploadDoc} loading={uploading} />
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const VaultRow: React.FC<{
  portalName: string;
  userId?: string | null;
  email?: string | null;
  extraInfo?: string | null;
  fieldName: string;
  hasPass: boolean;
  revealedVal?: string;
  loading: boolean;
  onReveal: () => void;
}> = ({ portalName, userId, email, extraInfo, hasPass, revealedVal, loading, onReveal }) => {
  if (!userId && !hasPass && !email && !extraInfo) return null;
  return (
    <View style={styles.vaultCard}>
      <View style={{ flex: 1 }}>
        <Text style={styles.vaultPortal}>{portalName}</Text>
        <Text style={styles.vaultId}>User ID: <Text style={{ fontWeight: '700' }}>{userId || '—'}</Text></Text>
        {email ? <Text style={styles.vaultSub}>Email: {email}</Text> : null}
        {extraInfo ? <Text style={[styles.vaultSub, { color: colors.brandPrimary, fontWeight: '600' }]}>{extraInfo}</Text> : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4, gap: 6 }}>
          <Text style={styles.vaultSub}>Password: </Text>
          <Text style={[styles.vaultPass, revealedVal && { color: '#059669', fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' }]}>
            {revealedVal ? revealedVal : (hasPass ? '••••••••••••' : '(Not Set)')}
          </Text>
        </View>
      </View>
      {hasPass && (
        <Pressable onPress={onReveal} style={styles.revealBtn} hitSlop={10} testID={`reveal-${portalName}`}>
          {loading ? (
            <ActivityIndicator size="small" color={colors.brandPrimary} />
          ) : (
            <Ionicons name={revealedVal ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.brandPrimary} />
          )}
        </Pressable>
      )}
    </View>
  );
};

const Row: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <View style={{ flexDirection: 'row', marginTop: spacing.sm, gap: spacing.md }}>
    <Text style={{ color: colors.muted, width: 110, fontWeight: '600', fontSize: font.sm }}>{label}</Text>
    <Text style={{ flex: 1, color: colors.onSurface, fontSize: font.sm, fontWeight: '500' }}>{value}</Text>
  </View>
);

const styles = StyleSheet.create({
  name: { fontSize: font.xl, fontWeight: '800', color: colors.onSurface },
  code: { color: colors.brandPrimary, fontWeight: '800', marginTop: 4, fontSize: font.sm },
  depts: { color: '#059669', fontWeight: '700', fontSize: 11, marginTop: 4 },
  sectionTitle: { fontSize: font.lg, fontWeight: '800', color: colors.onSurface },
  muted: { color: colors.muted, fontSize: font.sm, marginTop: 2 },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.brandPrimary, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill },
  addBtnText: { color: '#FFF', fontWeight: '700', fontSize: 12 },
  dscBlock: { backgroundColor: '#F8FAFC', padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.divider },
  dscHeading: { fontSize: font.sm, fontWeight: '800', color: colors.brandPrimary, marginBottom: 2 },
  vaultCard: { padding: spacing.md, backgroundColor: '#F8FAFC', borderRadius: radius.md, borderWidth: 1, borderColor: colors.divider, flexDirection: 'row', alignItems: 'center' },
  vaultPortal: { fontSize: font.sm, fontWeight: '800', color: '#0F172A' },
  vaultId: { fontSize: 11, color: '#334155', marginTop: 2 },
  vaultSub: { fontSize: 11, color: colors.muted, marginTop: 2 },
  vaultPass: { fontSize: 11, fontWeight: '700', color: '#64748B' },
  revealBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#EFF6FF', alignItems: 'center', justifyContent: 'center' },
  emptySlot: { marginTop: spacing.md, padding: spacing.xl, borderRadius: radius.md, borderWidth: 2, borderColor: colors.border, borderStyle: 'dashed', alignItems: 'center', gap: 6, backgroundColor: colors.surfaceSecondary },
  docRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  docIconBg: { width: 38, height: 38, borderRadius: 10, backgroundColor: '#EFF6FF', alignItems: 'center', justifyContent: 'center' },
  docName: { color: colors.onSurface, fontWeight: '700', fontSize: font.sm },
  catBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: '#DCFCE7' },
  catBadgeText: { fontSize: 9, fontWeight: '800', color: '#059669' },
  docMeta: { color: colors.muted, fontSize: 11, marginTop: 2 },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.6)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: '#FFF', borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, maxHeight: '85%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  modalTitle: { fontSize: font.lg, fontWeight: '800', color: '#0F172A' },
  filePickerBox: { padding: spacing.lg, borderRadius: radius.md, borderWidth: 2, borderColor: colors.brandPrimary, borderStyle: 'dashed', alignItems: 'center', gap: 6, backgroundColor: '#F8FAFC' },
  filePickerText: { fontSize: font.sm, fontWeight: '700', color: colors.brandPrimary, textAlign: 'center' },
  inputLabel: { fontSize: 11, fontWeight: '700', color: '#475569', marginTop: 4 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  catChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: '#F1F5F9', borderWidth: 1, borderColor: '#CBD5E1' },
  catChipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  catChipText: { fontSize: 11, fontWeight: '700', color: '#475569' },
  catChipTextActive: { color: '#FFF' },
  textInput: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, fontSize: font.sm, backgroundColor: '#FFF' },
  errText: { color: colors.error, fontSize: font.sm, textAlign: 'center' },
});
