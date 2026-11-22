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
import { daysUntil, formatDscDateTime } from '@/src/dateUtils';
import { canWrite, canAction } from '@/src/rbac';

const MAX_BYTES = 10 * 1024 * 1024;
const humanSize = (b: number) => b < 1024 ? `${b} B` : b < 1024 * 1024 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1024 / 1024).toFixed(2)} MB`;

const VALIDITY_DOC_CATEGORIES = [
  'Contractor Registration',
  'DSC Certificate',
  'Trade License',
  'Labour License',
  'Factory License',
  'Pollution Certificate',
  'EPF/ESIC Certificate',
  'GST Certificate',
  'Tax Exemption Certificate',
  'Other Validity Document',
];

const GENERAL_DOC_CATEGORIES = [
  'PAN Card',
  'Aadhar Card',
  'Bank Statement',
  'Tender BoQ',
  'Agreement / Contract',
  'Company Profile',
  'Invoice / Bill Copy',
  'Registration Certificate',
  'Other General Document',
];

export default function CustomerDetail() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || (user?.role as string) === 'super_admin';
  const canEdit = isAdmin || user?.role === 'manager' || canWrite(user, 'customers') || canAction(user, 'customers', 'edit');
  const canDelete = isAdmin || canAction(user, 'customers', 'delete');

  const [c, setC] = useState<any | null>(null);
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [revealingField, setRevealingField] = useState<string | null>(null);

  // Upload & Document Management Modal States
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [modalTab, setModalTab] = useState<'validity' | 'general'>('validity');

  // Section 1: Validity Draft Line
  const [validityCategory, setValidityCategory] = useState<string>('Contractor Registration');
  const [validityDocNo, setValidityDocNo] = useState<string>('');
  const [validityIssueDate, setValidityIssueDate] = useState<string>('');
  const [validityExpiryDate, setValidityExpiryDate] = useState<string>('');
  const [validityRemarks, setValidityRemarks] = useState<string>('');
  const [validityFile, setValidityFile] = useState<any | null>(null);
  const [showAddValidityForm, setShowAddValidityForm] = useState(false);

  // Section 2: General Draft Line
  const [generalCategory, setGeneralCategory] = useState<string>('Other General Document');
  const [generalDescription, setGeneralDescription] = useState<string>('');
  const [generalRemarks, setGeneralRemarks] = useState<string>('');
  const [generalFile, setGeneralFile] = useState<any | null>(null);
  const [showAddGeneralForm, setShowAddGeneralForm] = useState(false);

  // Edit Line State
  const [editingDocId, setEditingDocId] = useState<string | null>(null);
  const [editDocType, setEditDocType] = useState<'validity' | 'general'>('validity');
  const [editCategory, setEditCategory] = useState<string>('Other');
  const [editDocNo, setEditDocNo] = useState<string>('');
  const [editIssueDate, setEditIssueDate] = useState<string>('');
  const [editExpiryDate, setEditExpiryDate] = useState<string>('');
  const [editDescription, setEditDescription] = useState<string>('');
  const [editRemarks, setEditRemarks] = useState<string>('');
  const [editFile, setEditFile] = useState<any | null>(null);
  const [updatingDoc, setUpdatingDoc] = useState(false);

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

  const pickDocument = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
      if (res.canceled || !res.assets?.length) return null;
      const asset = res.assets[0];
      if (asset.size && asset.size > MAX_BYTES) {
        Alert.alert('File Too Large', `"${asset.name}" is ${humanSize(asset.size)}. Maximum allowed file volume is 10 MB.`);
        return null;
      }
      return asset;
    } catch {
      return null;
    }
  };

  const handlePickValidityFile = async () => {
    const asset = await pickDocument();
    if (asset) setValidityFile(asset);
  };

  const handlePickGeneralFile = async () => {
    const asset = await pickDocument();
    if (asset) {
      setGeneralFile(asset);
      if (!generalDescription) {
        setGeneralDescription(asset.name.replace(/\.[^/.]+$/, ''));
      }
    }
  };

  const handlePickEditFile = async () => {
    const asset = await pickDocument();
    if (asset) setEditFile(asset);
  };

  const setQuickExpiry = (years: number, isEdit = false) => {
    const baseStr = isEdit ? (editIssueDate || '') : (validityIssueDate || '');
    let d = baseStr && /^\d{4}-\d{2}-\d{2}$/.test(baseStr.trim()) ? new Date(baseStr.trim()) : new Date();
    d.setFullYear(d.getFullYear() + years);
    const iso = d.toISOString().slice(0, 10);
    if (isEdit) {
      setEditExpiryDate(iso);
    } else {
      setValidityExpiryDate(iso);
    }
  };

  const submitNewValidityDoc = async () => {
    if (!validityFile) {
      Alert.alert('File Required', 'Please attach a document file in the Attachment Slot (Max 10 MB).');
      return;
    }
    if (!validityDocNo.trim()) {
      Alert.alert('Document No Required', 'Please enter Document No (e.g. Registration No, License No, or Serial No).');
      return;
    }
    setUploading(true);
    setErr(null);
    try {
      const res = await api.uploadCustomerDoc(
        String(id),
        { uri: validityFile.uri, name: validityFile.name, type: validityFile.mimeType || 'application/octet-stream' },
        validityCategory,
        validityIssueDate || undefined,
        validityExpiryDate || undefined,
        validityRemarks || undefined,
        'validity',
        validityDocNo.trim(),
        `${validityCategory}${validityDocNo ? ` - ${validityDocNo}` : ''}`
      );
      if (res?.document) {
        setC((prev: any) => {
          if (!prev) return prev;
          const prevDocs = prev.documents || [];
          return { ...prev, documents: [...prevDocs, res.document] };
        });
      }
      setValidityFile(null);
      setValidityDocNo('');
      setValidityIssueDate('');
      setValidityExpiryDate('');
      setValidityRemarks('');
      setShowAddValidityForm(false);
      setShowUploadModal(false);
      await load();
      notify('Success', 'Validity document uploaded and expiry alert configured.');
    } catch (e: any) {
      Alert.alert('Upload Failed', e?.message || 'Failed uploading document');
    } finally {
      setUploading(false);
    }
  };

  const submitNewGeneralDoc = async () => {
    if (!generalFile) {
      Alert.alert('File Required', 'Please attach a document file in the Attachment Slot (Max 10 MB).');
      return;
    }
    if (!generalDescription.trim()) {
      Alert.alert('Description Required', 'Please enter a Document Description.');
      return;
    }
    setUploading(true);
    setErr(null);
    try {
      const res = await api.uploadCustomerDoc(
        String(id),
        { uri: generalFile.uri, name: generalFile.name, type: generalFile.mimeType || 'application/octet-stream' },
        generalCategory,
        undefined,
        undefined,
        generalRemarks || undefined,
        'general',
        undefined,
        generalDescription.trim()
      );
      if (res?.document) {
        setC((prev: any) => {
          if (!prev) return prev;
          const prevDocs = prev.documents || [];
          return { ...prev, documents: [...prevDocs, res.document] };
        });
      }
      setGeneralFile(null);
      setGeneralDescription('');
      setGeneralRemarks('');
      setShowAddGeneralForm(false);
      setShowUploadModal(false);
      await load();
      notify('Success', 'General document uploaded successfully.');
    } catch (e: any) {
      Alert.alert('Upload Failed', e?.message || 'Failed uploading document');
    } finally {
      setUploading(false);
    }
  };

  const startEditDoc = (doc: any) => {
    const isVal = doc.doc_type === 'validity' || !!doc.expiry_date || ['Contractor Registration', 'DSC Certificate', 'Trade License', 'Labour License'].includes(doc.category);
    setEditingDocId(doc.id);
    setEditDocType(isVal ? 'validity' : 'general');
    setEditCategory(doc.category || (isVal ? 'Contractor Registration' : 'Other General Document'));
    setEditDocNo(doc.document_no || '');
    setEditIssueDate(doc.issue_date || doc.document_date || '');
    setEditExpiryDate(doc.expiry_date || '');
    setEditDescription(doc.description || doc.name || '');
    setEditRemarks(doc.remarks || '');
    setEditFile(null);
  };

  const submitUpdateDoc = async (docId: string) => {
    setUpdatingDoc(true);
    try {
      const fileToUpload = editFile
        ? { uri: editFile.uri, name: editFile.name, type: editFile.mimeType || 'application/octet-stream' }
        : null;

      const res = await api.updateCustomerDoc(
        String(id),
        docId,
        fileToUpload,
        editCategory,
        editIssueDate || undefined,
        editDocType === 'validity' ? (editExpiryDate || undefined) : undefined,
        editRemarks || undefined,
        editDocType,
        editDocNo || undefined,
        editDescription || undefined
      );

      if (res?.document) {
        setC((prev: any) => {
          if (!prev) return prev;
          const prevDocs = (prev.documents || []).map((d: any) => d.id === docId ? res.document : d);
          return { ...prev, documents: prevDocs };
        });
      }

      setEditingDocId(null);
      setEditFile(null);
      await load();
      notify('Success', 'Document updated successfully.');
    } catch (e: any) {
      Alert.alert('Update Failed', e?.message || 'Could not update document');
    } finally {
      setUpdatingDoc(false);
    }
  };

  const handleDownloadDoc = async (doc: any) => {
    try {
      const token = await tokenStore.get();
      const downloadUrl = `${api.base}/api/customers/${id}/documents/${doc.id}/download?token=${encodeURIComponent(token || '')}`;
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = doc.name || 'document';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      } else {
        await Linking.openURL(downloadUrl);
      }
    } catch (e: any) {
      openFile(doc.file_path);
    }
  };

  const removeDoc = async (docId: string) => {
    const ok = await confirm('Delete Document?', 'This document attachment will be permanently removed.', { confirmText: 'Delete', destructive: true });
    if (!ok) return;
    try {
      await api.del(`/customers/${id}/documents/${docId}`);
      setC((prev: any) => {
        if (!prev) return prev;
        return {
          ...prev,
          documents: (prev.documents || []).filter((d: any) => d.id !== docId),
        };
      });
      if (editingDocId === docId) setEditingDocId(null);
      await load();
      notify('Deleted', 'Document deleted successfully.');
    } catch (e: any) {
      notify('Failed', e?.message || 'Unable to delete');
    }
  };

  const openFile = async (filePath: string) => {
    const token = await tokenStore.get();
    const cleanPath = (filePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
    const url = `${api.base}/api/files/${cleanPath}?token=${encodeURIComponent(token || '')}`;
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

  const isValidityDoc = (d: any) => {
    return (
      d.doc_type === 'validity' ||
      Boolean(d.expiry_date) ||
      ['Contractor Registration', 'DSC Certificate', 'Trade License', 'Labour License', 'Factory License', 'Pollution Certificate', 'EPF/ESIC Certificate', 'GST Certificate', 'Tax Exemption Certificate'].includes(d.category)
    );
  };

  const validityDocs = documents.filter(isValidityDoc);
  const generalDocs = [
    ...documents.filter((d: any) => !isValidityDoc(d)),
    ...legacyAttachments.map((a: any, idx: number) => ({
      id: `legacy-${idx}`,
      name: a.name || 'Attachment',
      file_path: a.path || a.file_path,
      size: a.size || 0,
      size_mb: a.size ? Number((a.size / (1024 * 1024)).toFixed(2)) : undefined,
      description: a.description || a.name || 'General Attachment',
      category: a.category || 'General Attachment',
      remarks: a.remarks || '',
      is_legacy: true,
    })),
  ];

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
            {canDelete ? (
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
          <Row label="TDSC Branch" value={c.branch_name || '—'} />
          <Row label="District" value={c.district || '—'} />
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
                  <Row label="Issued Date" value={formatDscDateTime(c.dsc_issued_date)} />
                  <Row label="Expiry Date" value={formatDscDateTime(c.dsc_expired_date)} />
                </View>
                <View style={[styles.dscBlock, { marginTop: spacing.md }, encWarn && { borderColor: encExpired ? colors.error : colors.warning, borderWidth: 1.5 }]}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={styles.dscHeading}>DSC Encryption</Text>
                    {encDays !== null ? (
                      <View style={{ backgroundColor: encExpired ? '#FEE2E2' : encWarn ? '#FEF3C7' : '#DCFCE7', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 }}>
                        <Text style={{ fontSize: 10, fontWeight: '800', color: encExpired ? colors.error : signWarn ? '#B45309' : '#15803D' }}>
                          {encExpired ? `Expired (${-encDays}d ago)` : encWarn ? `Expiring in ${encDays}d` : `Active (${encDays}d left)`}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  <Row label="Serial No." value={c.encryption_serial_no || '—'} />
                  <Row label="Issued Date" value={formatDscDateTime(c.encryption_issued_date)} />
                  <Row label="Expiry Date" value={formatDscDateTime(c.encryption_expired_date)} />
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

        {/* ========================================================================= */}
        {/* SECTION 1: VALIDITY & COMPLIANCE DOCUMENTS */}
        {/* ========================================================================= */}
        <Card>
          <View style={styles.sectionHeaderRow}>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <Ionicons name="ribbon-outline" size={20} color="#B45309" />
                <Text style={styles.sectionTitle}>1. Validity Documents (वैधता वाले दस्तावेज़)</Text>
                <View style={styles.sectionBadge}>
                  <Text style={styles.sectionBadgeText}>{validityDocs.length} Documents</Text>
                </View>
              </View>
              <Text style={styles.sectionSub}>
                Contractor Registration, DSC Certificate, Trade / Labour Licenses with Issue Date, Expiry Date & Expiry Alerts.
              </Text>
            </View>
            {canEdit && (
              <Pressable
                testID="add-validity-line-btn"
                onPress={() => {
                  setShowAddValidityForm(prev => !prev);
                  if (editingDocId) setEditingDocId(null);
                }}
                style={styles.addBtn}
              >
                <Ionicons name={showAddValidityForm ? "close-circle" : "add-circle"} size={18} color="#FFF" />
                <Text style={styles.addBtnText}>{showAddValidityForm ? "Close Form" : "+ Add New Line"}</Text>
              </Pressable>
            )}
          </View>

          {/* Inline Add Validity Line Form */}
          {showAddValidityForm && (
            <View style={styles.inlineFormCard}>
              <View style={styles.inlineFormHeader}>
                <Ionicons name="create-outline" size={18} color={colors.brandPrimary} />
                <Text style={styles.inlineFormTitle}>Add New Validity Document Line</Text>
              </View>

              {/* Category Picker */}
              <Text style={styles.fieldLabel}>Document Category *</Text>
              <View style={styles.chipRow}>
                {VALIDITY_DOC_CATEGORIES.map(cat => {
                  const sel = validityCategory === cat;
                  return (
                    <Pressable key={cat} onPress={() => setValidityCategory(cat)} style={[styles.catChip, sel && styles.catChipActive]}>
                      <Text style={[styles.catChipText, sel && styles.catChipTextActive]}>{cat}</Text>
                    </Pressable>
                  );
                })}
              </View>

              {/* Row: Doc No & Dates */}
              <View style={styles.formRow}>
                <View style={[styles.formCol, { minWidth: 200 }]}>
                  <Text style={styles.fieldLabel}>Document No *</Text>
                  <TextInput
                    style={styles.textInput}
                    placeholder="e.g. Contractor Reg No, DSC Serial No, License No"
                    value={validityDocNo}
                    onChangeText={setValidityDocNo}
                  />
                </View>
                <View style={[styles.formCol, { minWidth: 150 }]}>
                  <Text style={styles.fieldLabel}>Issued Date (YYYY-MM-DD)</Text>
                  <TextInput
                    style={styles.textInput}
                    placeholder="YYYY-MM-DD"
                    value={validityIssueDate}
                    onChangeText={setValidityIssueDate}
                  />
                </View>
                <View style={[styles.formCol, { minWidth: 200 }]}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={styles.fieldLabel}>Expiry Date *</Text>
                    <View style={styles.quickPresetRow}>
                      <Pressable onPress={() => setQuickExpiry(1)} style={styles.quickPresetBtn}><Text style={styles.quickPresetText}>+1Y</Text></Pressable>
                      <Pressable onPress={() => setQuickExpiry(2)} style={styles.quickPresetBtn}><Text style={styles.quickPresetText}>+2Y</Text></Pressable>
                      <Pressable onPress={() => setQuickExpiry(3)} style={styles.quickPresetBtn}><Text style={styles.quickPresetText}>+3Y</Text></Pressable>
                      <Pressable onPress={() => setQuickExpiry(5)} style={styles.quickPresetBtn}><Text style={styles.quickPresetText}>+5Y</Text></Pressable>
                    </View>
                  </View>
                  <TextInput
                    style={styles.textInput}
                    placeholder="YYYY-MM-DD (e.g. 2027-03-31)"
                    value={validityExpiryDate}
                    onChangeText={setValidityExpiryDate}
                  />
                </View>
              </View>

              {/* Remarks */}
              <Text style={styles.fieldLabel}>Remarks</Text>
              <TextInput
                style={styles.textInput}
                placeholder="Optional notes or department details"
                value={validityRemarks}
                onChangeText={setValidityRemarks}
              />

              {/* Attachment Slot */}
              <Text style={styles.fieldLabel}>Attachment Slot (Max 10 MB file supported) *</Text>
              <Pressable onPress={handlePickValidityFile} style={[styles.slotPickerBox, validityFile && styles.slotPickerBoxActive]}>
                <Ionicons
                  name={validityFile ? "checkmark-circle" : "cloud-upload-outline"}
                  size={24}
                  color={validityFile ? colors.success : colors.brandPrimary}
                />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.slotPickerText, validityFile && { color: colors.onSurface }]}>
                    {validityFile ? validityFile.name : "Click to select PDF, image, scan, or office doc"}
                  </Text>
                  {validityFile && (
                    <Text style={styles.slotVolumeText}>
                      File Volume: <Text style={{ fontWeight: '800', color: colors.brandPrimary }}>{humanSize(validityFile.size)}</Text> (Under 10 MB limit)
                    </Text>
                  )}
                </View>
                <View style={styles.chooseFileBtn}>
                  <Text style={styles.chooseFileBtnText}>{validityFile ? "Change File" : "Choose File"}</Text>
                </View>
              </Pressable>

              {/* Buttons */}
              <View style={styles.formActionRow}>
                <Pressable
                  testID="btn-upload-validity"
                  onPress={submitNewValidityDoc}
                  disabled={uploading}
                  style={[styles.primaryActionBtn, uploading && { opacity: 0.7 }]}
                >
                  {uploading ? (
                    <ActivityIndicator size="small" color="#FFF" />
                  ) : (
                    <>
                      <Ionicons name="cloud-upload" size={16} color="#FFF" />
                      <Text style={styles.primaryActionBtnText}>Upload & Save Line</Text>
                    </>
                  )}
                </Pressable>
                <Pressable onPress={() => setShowAddValidityForm(false)} style={styles.secondaryActionBtn}>
                  <Text style={styles.secondaryActionBtnText}>Cancel</Text>
                </Pressable>
              </View>
            </View>
          )}

          {/* Validity Documents Line List */}
          {validityDocs.length === 0 ? (
            <View style={styles.emptySlot}>
              <Ionicons name="ribbon-outline" size={32} color={colors.muted} />
              <Text style={styles.emptySlotText}>No validity documents added yet.</Text>
              <Text style={styles.muted}>Click "+ Add New Line" to attach Contractor Registration, DSC Certificate, or Licenses with Expiry Dates.</Text>
            </View>
          ) : (
            <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
              {validityDocs.map((doc: any) => {
                const isEditing = editingDocId === doc.id;
                const days = daysUntil(doc.expiry_date);
                const isExpired = days !== null && days < 0;
                const isExpiringSoon = days !== null && days <= 30 && days >= 0;

                if (isEditing) {
                  return (
                    <View key={doc.id} style={styles.inlineEditCard}>
                      <View style={styles.inlineFormHeader}>
                        <Ionicons name="pencil" size={16} color={colors.brandPrimary} />
                        <Text style={styles.inlineFormTitle}>Edit Line: {doc.document_no || doc.name}</Text>
                      </View>

                      {/* Edit Category */}
                      <Text style={styles.fieldLabel}>Category</Text>
                      <View style={styles.chipRow}>
                        {VALIDITY_DOC_CATEGORIES.map(cat => {
                          const sel = editCategory === cat;
                          return (
                            <Pressable key={cat} onPress={() => setEditCategory(cat)} style={[styles.catChip, sel && styles.catChipActive]}>
                              <Text style={[styles.catChipText, sel && styles.catChipTextActive]}>{cat}</Text>
                            </Pressable>
                          );
                        })}
                      </View>

                      {/* Edit Fields */}
                      <View style={styles.formRow}>
                        <View style={[styles.formCol, { minWidth: 180 }]}>
                          <Text style={styles.fieldLabel}>Document No</Text>
                          <TextInput style={styles.textInput} value={editDocNo} onChangeText={setEditDocNo} />
                        </View>
                        <View style={[styles.formCol, { minWidth: 140 }]}>
                          <Text style={styles.fieldLabel}>Issued Date</Text>
                          <TextInput style={styles.textInput} placeholder="YYYY-MM-DD" value={editIssueDate} onChangeText={setEditIssueDate} />
                        </View>
                        <View style={[styles.formCol, { minWidth: 180 }]}>
                          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                            <Text style={styles.fieldLabel}>Expiry Date</Text>
                            <View style={styles.quickPresetRow}>
                              <Pressable onPress={() => setQuickExpiry(1, true)} style={styles.quickPresetBtn}><Text style={styles.quickPresetText}>+1Y</Text></Pressable>
                              <Pressable onPress={() => setQuickExpiry(2, true)} style={styles.quickPresetBtn}><Text style={styles.quickPresetText}>+2Y</Text></Pressable>
                              <Pressable onPress={() => setQuickExpiry(5, true)} style={styles.quickPresetBtn}><Text style={styles.quickPresetText}>+5Y</Text></Pressable>
                            </View>
                          </View>
                          <TextInput style={styles.textInput} placeholder="YYYY-MM-DD" value={editExpiryDate} onChangeText={setEditExpiryDate} />
                        </View>
                      </View>

                      <Text style={styles.fieldLabel}>Remarks</Text>
                      <TextInput style={styles.textInput} value={editRemarks} onChangeText={setEditRemarks} />

                      <Text style={styles.fieldLabel}>Attachment Slot (Replace file - Max 10 MB)</Text>
                      <Pressable onPress={handlePickEditFile} style={styles.slotPickerBox}>
                        <Ionicons name="document-attach" size={20} color={colors.brandPrimary} />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.slotPickerText}>
                            {editFile ? `Selected: ${editFile.name} (${humanSize(editFile.size)})` : `Current: ${doc.name} (${doc.size_mb ? `${doc.size_mb} MB` : humanSize(doc.size || 0)})`}
                          </Text>
                        </View>
                        <View style={styles.chooseFileBtn}>
                          <Text style={styles.chooseFileBtnText}>Replace File</Text>
                        </View>
                      </Pressable>

                      <View style={styles.formActionRow}>
                        <Pressable onPress={() => submitUpdateDoc(doc.id)} disabled={updatingDoc} style={styles.primaryActionBtn}>
                          {updatingDoc ? <ActivityIndicator size="small" color="#FFF" /> : <Text style={styles.primaryActionBtnText}>Update Line</Text>}
                        </Pressable>
                        <Pressable onPress={() => setEditingDocId(null)} style={styles.secondaryActionBtn}>
                          <Text style={styles.secondaryActionBtnText}>Cancel</Text>
                        </Pressable>
                      </View>
                    </View>
                  );
                }

                return (
                  <View key={doc.id} style={styles.docLineCard}>
                    {/* Header Row */}
                    <View style={styles.docLineHeader}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', flex: 1 }}>
                        <View style={styles.valCatBadge}>
                          <Text style={styles.valCatBadgeText}>{doc.category || 'Validity Document'}</Text>
                        </View>
                        <Text style={styles.docNoText}>Doc No: <Text style={{ fontWeight: '800', color: colors.onSurface }}>{doc.document_no || '—'}</Text></Text>
                      </View>
                      {/* Expiry Badge */}
                      {days !== null ? (
                        <View style={[styles.statusBadge, isExpired ? styles.statusBadgeExpired : isExpiringSoon ? styles.statusBadgeWarn : styles.statusBadgeActive]}>
                          <Text style={[styles.statusBadgeText, isExpired ? styles.statusTextExpired : isExpiringSoon ? styles.statusTextWarn : styles.statusTextActive]}>
                            {isExpired ? `Expired (${-days}d ago)` : isExpiringSoon ? `Expiring in ${days}d` : `Active (${days}d left)`}
                          </Text>
                        </View>
                      ) : null}
                    </View>

                    {/* Metadata Grid */}
                    <View style={styles.docLineMetaGrid}>
                      <View style={styles.metaCell}>
                        <Text style={styles.metaCellLabel}>Issued Date</Text>
                        <Text style={styles.metaCellVal}>{doc.issue_date || doc.document_date || '—'}</Text>
                      </View>
                      <View style={styles.metaCell}>
                        <Text style={styles.metaCellLabel}>Expiry Date</Text>
                        <Text style={[styles.metaCellVal, isExpired && { color: colors.error, fontWeight: '800' }]}>{doc.expiry_date || '—'}</Text>
                      </View>
                      <View style={[styles.metaCell, { flex: 2 }]}>
                        <Text style={styles.metaCellLabel}>Remarks</Text>
                        <Text style={styles.metaCellVal} numberOfLines={2}>{doc.remarks || '—'}</Text>
                      </View>
                    </View>

                    {/* Attachment Slot & Action Buttons */}
                    <View style={styles.docLineFooter}>
                      <View style={styles.attachmentSlotPill}>
                        <Ionicons name="document-text" size={16} color={colors.brandPrimary} />
                        <Text style={styles.attachmentSlotName} numberOfLines={1}>{doc.name}</Text>
                        <View style={styles.volumeBadge}>
                          <Text style={styles.volumeBadgeText}>{doc.size_mb ? `${doc.size_mb} MB` : humanSize(doc.size || 0)}</Text>
                        </View>
                        <Text style={styles.maxLimitText}>Max 10 MB</Text>
                      </View>

                      <View style={styles.lineActions}>
                        <Pressable onPress={() => openFile(doc.file_path)} style={styles.actionIconBtn} hitSlop={8} testID={`view-${doc.id}`}>
                          <Ionicons name="eye-outline" size={18} color={colors.brandPrimary} />
                        </Pressable>
                        <Pressable onPress={() => handleDownloadDoc(doc)} style={styles.actionIconBtn} hitSlop={8} testID={`download-${doc.id}`}>
                          <Ionicons name="download-outline" size={18} color="#059669" />
                        </Pressable>
                        {canEdit && (
                          <Pressable onPress={() => startEditDoc(doc)} style={styles.actionIconBtn} hitSlop={8} testID={`edit-${doc.id}`}>
                            <Ionicons name="create-outline" size={18} color="#B45309" />
                          </Pressable>
                        )}
                        {canEdit && (
                          <Pressable onPress={() => removeDoc(doc.id)} style={styles.actionIconBtn} hitSlop={8} testID={`delete-${doc.id}`}>
                            <Ionicons name="trash-outline" size={18} color={colors.error} />
                          </Pressable>
                        )}
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </Card>

        {/* ========================================================================= */}
        {/* SECTION 2: GENERAL CUSTOMER DOCUMENTS */}
        {/* ========================================================================= */}
        <Card>
          <View style={styles.sectionHeaderRow}>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <Ionicons name="folder-open-outline" size={20} color={colors.brandPrimary} />
                <Text style={styles.sectionTitle}>2. General Documents (सामान्य दस्तावेज़)</Text>
                <View style={styles.sectionBadge}>
                  <Text style={styles.sectionBadgeText}>{generalDocs.length} Attachments</Text>
                </View>
              </View>
              <Text style={styles.sectionSub}>
                PAN Card, Aadhar, Bank Statements, BoQ & General attachments without validity requirement (Max 10 MB per file).
              </Text>
            </View>
            {canEdit && (
              <Pressable
                testID="add-general-line-btn"
                onPress={() => {
                  setShowAddGeneralForm(prev => !prev);
                  if (editingDocId) setEditingDocId(null);
                }}
                style={styles.addBtn}
              >
                <Ionicons name={showAddGeneralForm ? "close-circle" : "add-circle"} size={18} color="#FFF" />
                <Text style={styles.addBtnText}>{showAddGeneralForm ? "Close Form" : "+ Add New Line"}</Text>
              </Pressable>
            )}
          </View>

          {/* Inline Add General Line Form */}
          {showAddGeneralForm && (
            <View style={styles.inlineFormCard}>
              <View style={styles.inlineFormHeader}>
                <Ionicons name="create-outline" size={18} color={colors.brandPrimary} />
                <Text style={styles.inlineFormTitle}>Add New General Document Line (Sl No. #{generalDocs.length + 1})</Text>
              </View>

              {/* Category Picker */}
              <Text style={styles.fieldLabel}>Category</Text>
              <View style={styles.chipRow}>
                {GENERAL_DOC_CATEGORIES.map(cat => {
                  const sel = generalCategory === cat;
                  return (
                    <Pressable key={cat} onPress={() => setGeneralCategory(cat)} style={[styles.catChip, sel && styles.catChipActive]}>
                      <Text style={[styles.catChipText, sel && styles.catChipTextActive]}>{cat}</Text>
                    </Pressable>
                  );
                })}
              </View>

              {/* Document Description */}
              <Text style={styles.fieldLabel}>Document Description *</Text>
              <TextInput
                style={styles.textInput}
                placeholder="e.g. Firm PAN Card Copy, Cancelled Cheque, Tender BoQ, Partnership Deed"
                value={generalDescription}
                onChangeText={setGeneralDescription}
              />

              {/* Remarks */}
              <Text style={styles.fieldLabel}>Remarks</Text>
              <TextInput
                style={styles.textInput}
                placeholder="Optional notes or reference information"
                value={generalRemarks}
                onChangeText={setGeneralRemarks}
              />

              {/* Attachment Slot */}
              <Text style={styles.fieldLabel}>Attachment Slot (Max 10 MB file supported) *</Text>
              <Pressable onPress={handlePickGeneralFile} style={[styles.slotPickerBox, generalFile && styles.slotPickerBoxActive]}>
                <Ionicons
                  name={generalFile ? "checkmark-circle" : "cloud-upload-outline"}
                  size={24}
                  color={generalFile ? colors.success : colors.brandPrimary}
                />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.slotPickerText, generalFile && { color: colors.onSurface }]}>
                    {generalFile ? generalFile.name : "Click to select PDF, image, scan, or office document"}
                  </Text>
                  {generalFile && (
                    <Text style={styles.slotVolumeText}>
                      File Volume: <Text style={{ fontWeight: '800', color: colors.brandPrimary }}>{humanSize(generalFile.size)}</Text> (Under 10 MB limit)
                    </Text>
                  )}
                </View>
                <View style={styles.chooseFileBtn}>
                  <Text style={styles.chooseFileBtnText}>{generalFile ? "Change File" : "Choose File"}</Text>
                </View>
              </Pressable>

              {/* Buttons */}
              <View style={styles.formActionRow}>
                <Pressable
                  testID="btn-upload-general"
                  onPress={submitNewGeneralDoc}
                  disabled={uploading}
                  style={[styles.primaryActionBtn, uploading && { opacity: 0.7 }]}
                >
                  {uploading ? (
                    <ActivityIndicator size="small" color="#FFF" />
                  ) : (
                    <>
                      <Ionicons name="cloud-upload" size={16} color="#FFF" />
                      <Text style={styles.primaryActionBtnText}>Upload & Save Line</Text>
                    </>
                  )}
                </Pressable>
                <Pressable onPress={() => setShowAddGeneralForm(false)} style={styles.secondaryActionBtn}>
                  <Text style={styles.secondaryActionBtnText}>Cancel</Text>
                </Pressable>
              </View>
            </View>
          )}

          {/* General Documents Line List */}
          {generalDocs.length === 0 ? (
            <View style={styles.emptySlot}>
              <Ionicons name="folder-open-outline" size={32} color={colors.muted} />
              <Text style={styles.emptySlotText}>No general documents attached yet.</Text>
              <Text style={styles.muted}>Click "+ Add New Line" to upload PAN, Aadhar, Bank statements, Agreements, or BoQ files.</Text>
            </View>
          ) : (
            <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
              {generalDocs.map((doc: any, index: number) => {
                const isEditing = editingDocId === doc.id;
                const slNo = index + 1;

                if (isEditing) {
                  return (
                    <View key={doc.id} style={styles.inlineEditCard}>
                      <View style={styles.inlineFormHeader}>
                        <Ionicons name="pencil" size={16} color={colors.brandPrimary} />
                        <Text style={styles.inlineFormTitle}>Edit Line Sl No. #{slNo}: {doc.description || doc.name}</Text>
                      </View>

                      <Text style={styles.fieldLabel}>Category</Text>
                      <View style={styles.chipRow}>
                        {GENERAL_DOC_CATEGORIES.map(cat => {
                          const sel = editCategory === cat;
                          return (
                            <Pressable key={cat} onPress={() => setEditCategory(cat)} style={[styles.catChip, sel && styles.catChipActive]}>
                              <Text style={[styles.catChipText, sel && styles.catChipTextActive]}>{cat}</Text>
                            </Pressable>
                          );
                        })}
                      </View>

                      <Text style={styles.fieldLabel}>Document Description</Text>
                      <TextInput style={styles.textInput} value={editDescription} onChangeText={setEditDescription} />

                      <Text style={styles.fieldLabel}>Remarks</Text>
                      <TextInput style={styles.textInput} value={editRemarks} onChangeText={setEditRemarks} />

                      <Text style={styles.fieldLabel}>Attachment Slot (Replace file - Max 10 MB)</Text>
                      <Pressable onPress={handlePickEditFile} style={styles.slotPickerBox}>
                        <Ionicons name="document-attach" size={20} color={colors.brandPrimary} />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.slotPickerText}>
                            {editFile ? `Selected: ${editFile.name} (${humanSize(editFile.size)})` : `Current: ${doc.name} (${doc.size_mb ? `${doc.size_mb} MB` : humanSize(doc.size || 0)})`}
                          </Text>
                        </View>
                        <View style={styles.chooseFileBtn}>
                          <Text style={styles.chooseFileBtnText}>Replace File</Text>
                        </View>
                      </Pressable>

                      <View style={styles.formActionRow}>
                        <Pressable onPress={() => submitUpdateDoc(doc.id)} disabled={updatingDoc} style={styles.primaryActionBtn}>
                          {updatingDoc ? <ActivityIndicator size="small" color="#FFF" /> : <Text style={styles.primaryActionBtnText}>Update Line</Text>}
                        </Pressable>
                        <Pressable onPress={() => setEditingDocId(null)} style={styles.secondaryActionBtn}>
                          <Text style={styles.secondaryActionBtnText}>Cancel</Text>
                        </Pressable>
                      </View>
                    </View>
                  );
                }

                return (
                  <View key={doc.id || index} style={styles.docLineCard}>
                    {/* Header Row */}
                    <View style={styles.docLineHeader}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', flex: 1 }}>
                        <View style={styles.slBadge}>
                          <Text style={styles.slBadgeText}>Sl #{slNo}</Text>
                        </View>
                        <Text style={styles.genDescText}>{doc.description || doc.name}</Text>
                        <View style={styles.genCatBadge}>
                          <Text style={styles.genCatBadgeText}>{doc.category || 'General'}</Text>
                        </View>
                      </View>
                    </View>

                    {/* Metadata Grid */}
                    <View style={styles.docLineMetaGrid}>
                      <View style={[styles.metaCell, { flex: 2 }]}>
                        <Text style={styles.metaCellLabel}>Remarks</Text>
                        <Text style={styles.metaCellVal} numberOfLines={2}>{doc.remarks || '—'}</Text>
                      </View>
                    </View>

                    {/* Attachment Slot & Action Buttons */}
                    <View style={styles.docLineFooter}>
                      <View style={styles.attachmentSlotPill}>
                        <Ionicons name="attach" size={16} color="#475569" />
                        <Text style={styles.attachmentSlotName} numberOfLines={1}>{doc.name}</Text>
                        <View style={styles.volumeBadge}>
                          <Text style={styles.volumeBadgeText}>{doc.size_mb ? `${doc.size_mb} MB` : humanSize(doc.size || 0)}</Text>
                        </View>
                        <Text style={styles.maxLimitText}>Max 10 MB</Text>
                      </View>

                      <View style={styles.lineActions}>
                        <Pressable onPress={() => openFile(doc.file_path)} style={styles.actionIconBtn} hitSlop={8} testID={`view-gen-${slNo}`}>
                          <Ionicons name="eye-outline" size={18} color={colors.brandPrimary} />
                        </Pressable>
                        <Pressable onPress={() => handleDownloadDoc(doc)} style={styles.actionIconBtn} hitSlop={8} testID={`download-gen-${slNo}`}>
                          <Ionicons name="download-outline" size={18} color="#059669" />
                        </Pressable>
                        {!doc.is_legacy && canEdit && (
                          <Pressable onPress={() => startEditDoc(doc)} style={styles.actionIconBtn} hitSlop={8} testID={`edit-gen-${slNo}`}>
                            <Ionicons name="create-outline" size={18} color="#B45309" />
                          </Pressable>
                        )}
                        {!doc.is_legacy && canEdit && (
                          <Pressable onPress={() => removeDoc(doc.id)} style={styles.actionIconBtn} hitSlop={8} testID={`delete-gen-${slNo}`}>
                            <Ionicons name="trash-outline" size={18} color={colors.error} />
                          </Pressable>
                        )}
                      </View>
                    </View>
                  </View>
                );
              })}
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

            {/* Modal Tabs */}
            <View style={styles.modalTabsRow}>
              <Pressable
                onPress={() => setModalTab('validity')}
                style={[styles.modalTabBtn, modalTab === 'validity' && styles.modalTabBtnActive]}
              >
                <Ionicons name="ribbon-outline" size={16} color={modalTab === 'validity' ? colors.brandPrimary : colors.muted} />
                <Text style={[styles.modalTabText, modalTab === 'validity' && styles.modalTabTextActive]}>
                  Section 1: Validity Docs
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setModalTab('general')}
                style={[styles.modalTabBtn, modalTab === 'general' && styles.modalTabBtnActive]}
              >
                <Ionicons name="folder-open-outline" size={16} color={modalTab === 'general' ? colors.brandPrimary : colors.muted} />
                <Text style={[styles.modalTabText, modalTab === 'general' && styles.modalTabTextActive]}>
                  Section 2: General Docs
                </Text>
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
              {modalTab === 'validity' ? (
                <>
                  <View style={styles.modalInfoBanner}>
                    <Ionicons name="information-circle" size={18} color="#B45309" />
                    <Text style={styles.modalInfoText}>
                      Validity section is for Contractor Registration, DSC, Licenses where Issue Date, Expiry Date & Expiry Alerts are required.
                    </Text>
                  </View>

                  <Text style={styles.fieldLabel}>Category</Text>
                  <View style={styles.chipRow}>
                    {VALIDITY_DOC_CATEGORIES.map(cat => {
                      const sel = validityCategory === cat;
                      return (
                        <Pressable key={cat} onPress={() => setValidityCategory(cat)} style={[styles.catChip, sel && styles.catChipActive]}>
                          <Text style={[styles.catChipText, sel && styles.catChipTextActive]}>{cat}</Text>
                        </Pressable>
                      );
                    })}
                  </View>

                  <Text style={styles.fieldLabel}>Document No *</Text>
                  <TextInput
                    style={styles.textInput}
                    placeholder="e.g. Contractor Reg No, DSC Serial No, License No"
                    value={validityDocNo}
                    onChangeText={setValidityDocNo}
                  />

                  <View style={styles.formRow}>
                    <View style={styles.formCol}>
                      <Text style={styles.fieldLabel}>Issued Date (YYYY-MM-DD)</Text>
                      <TextInput
                        style={styles.textInput}
                        placeholder="YYYY-MM-DD"
                        value={validityIssueDate}
                        onChangeText={setValidityIssueDate}
                      />
                    </View>
                    <View style={styles.formCol}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Text style={styles.fieldLabel}>Expiry Date *</Text>
                        <View style={styles.quickPresetRow}>
                          <Pressable onPress={() => setQuickExpiry(1)} style={styles.quickPresetBtn}><Text style={styles.quickPresetText}>+1Y</Text></Pressable>
                          <Pressable onPress={() => setQuickExpiry(2)} style={styles.quickPresetBtn}><Text style={styles.quickPresetText}>+2Y</Text></Pressable>
                          <Pressable onPress={() => setQuickExpiry(5)} style={styles.quickPresetBtn}><Text style={styles.quickPresetText}>+5Y</Text></Pressable>
                        </View>
                      </View>
                      <TextInput
                        style={styles.textInput}
                        placeholder="YYYY-MM-DD (e.g. 2027-03-31)"
                        value={validityExpiryDate}
                        onChangeText={setValidityExpiryDate}
                      />
                    </View>
                  </View>

                  <Text style={styles.fieldLabel}>Remarks</Text>
                  <TextInput
                    style={styles.textInput}
                    placeholder="Optional notes"
                    value={validityRemarks}
                    onChangeText={setValidityRemarks}
                  />

                  <Text style={styles.fieldLabel}>Attachment Slot (Max 10 MB) *</Text>
                  <Pressable onPress={handlePickValidityFile} style={[styles.slotPickerBox, validityFile && styles.slotPickerBoxActive]}>
                    <Ionicons name={validityFile ? "checkmark-circle" : "cloud-upload-outline"} size={24} color={validityFile ? colors.success : colors.brandPrimary} />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.slotPickerText, validityFile && { color: colors.onSurface }]}>
                        {validityFile ? validityFile.name : "Choose PDF, Image or Office Doc (Max 10 MB)"}
                      </Text>
                      {validityFile && (
                        <Text style={styles.slotVolumeText}>Volume: {humanSize(validityFile.size)} (Max 10 MB)</Text>
                      )}
                    </View>
                  </Pressable>

                  <PrimaryButton
                    label={uploading ? 'Uploading...' : 'Upload & Save Validity Line'}
                    onPress={submitNewValidityDoc}
                    loading={uploading}
                  />
                </>
              ) : (
                <>
                  <View style={styles.modalInfoBanner}>
                    <Ionicons name="information-circle" size={18} color={colors.brandPrimary} />
                    <Text style={styles.modalInfoText}>
                      General section is for PAN, Aadhar, Bank Statements, BoQ & General attachments without validity/expiry dates.
                    </Text>
                  </View>

                  <Text style={styles.fieldLabel}>Sl No.</Text>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: colors.onSurface, paddingVertical: 4 }}>
                    Line Sl No. #{generalDocs.length + 1}
                  </Text>

                  <Text style={styles.fieldLabel}>Category</Text>
                  <View style={styles.chipRow}>
                    {GENERAL_DOC_CATEGORIES.map(cat => {
                      const sel = generalCategory === cat;
                      return (
                        <Pressable key={cat} onPress={() => setGeneralCategory(cat)} style={[styles.catChip, sel && styles.catChipActive]}>
                          <Text style={[styles.catChipText, sel && styles.catChipTextActive]}>{cat}</Text>
                        </Pressable>
                      );
                    })}
                  </View>

                  <Text style={styles.fieldLabel}>Document Description *</Text>
                  <TextInput
                    style={styles.textInput}
                    placeholder="e.g. Firm PAN Card Copy, Cancelled Cheque, BoQ"
                    value={generalDescription}
                    onChangeText={setGeneralDescription}
                  />

                  <Text style={styles.fieldLabel}>Remarks</Text>
                  <TextInput
                    style={styles.textInput}
                    placeholder="Optional notes"
                    value={generalRemarks}
                    onChangeText={setGeneralRemarks}
                  />

                  <Text style={styles.fieldLabel}>Attachment Slot (Max 10 MB) *</Text>
                  <Pressable onPress={handlePickGeneralFile} style={[styles.slotPickerBox, generalFile && styles.slotPickerBoxActive]}>
                    <Ionicons name={generalFile ? "checkmark-circle" : "cloud-upload-outline"} size={24} color={generalFile ? colors.success : colors.brandPrimary} />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.slotPickerText, generalFile && { color: colors.onSurface }]}>
                        {generalFile ? generalFile.name : "Choose PDF, Image or Office Doc (Max 10 MB)"}
                      </Text>
                      {generalFile && (
                        <Text style={styles.slotVolumeText}>Volume: {humanSize(generalFile.size)} (Max 10 MB)</Text>
                      )}
                    </View>
                  </Pressable>

                  <PrimaryButton
                    label={uploading ? 'Uploading...' : 'Upload & Save General Line'}
                    onPress={submitNewGeneralDoc}
                    loading={uploading}
                  />
                </>
              )}
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
  sectionSub: { color: colors.muted, fontSize: 11, marginTop: 2 },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  sectionBadge: { backgroundColor: '#F1F5F9', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 12, borderWidth: 1, borderColor: '#CBD5E1' },
  sectionBadgeText: { fontSize: 10, fontWeight: '800', color: '#475569' },
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
  emptySlotText: { fontSize: font.sm, fontWeight: '800', color: colors.onSurface },
  docRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  docIconBg: { width: 38, height: 38, borderRadius: 10, backgroundColor: '#EFF6FF', alignItems: 'center', justifyContent: 'center' },
  docName: { color: colors.onSurface, fontWeight: '700', fontSize: font.sm },
  catBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: '#DCFCE7' },
  catBadgeText: { fontSize: 9, fontWeight: '800', color: '#059669' },
  docMeta: { color: colors.muted, fontSize: 11, marginTop: 2 },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.6)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: '#FFF', borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, maxHeight: '88%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  modalTitle: { fontSize: font.lg, fontWeight: '800', color: '#0F172A' },
  modalTabsRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: '#F8FAFC' },
  modalTabBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12 },
  modalTabBtnActive: { borderBottomWidth: 2, borderBottomColor: colors.brandPrimary, backgroundColor: '#FFF' },
  modalTabText: { fontSize: 12, fontWeight: '700', color: colors.muted },
  modalTabTextActive: { color: colors.brandPrimary },
  modalInfoBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#FEF3C7', padding: 10, borderRadius: radius.sm, borderWidth: 1, borderColor: '#FDE68A' },
  modalInfoText: { fontSize: 11, color: '#92400E', flex: 1, lineHeight: 16 },
  filePickerBox: { padding: spacing.lg, borderRadius: radius.md, borderWidth: 2, borderColor: colors.brandPrimary, borderStyle: 'dashed', alignItems: 'center', gap: 6, backgroundColor: '#F8FAFC' },
  filePickerText: { fontSize: font.sm, fontWeight: '700', color: colors.brandPrimary, textAlign: 'center' },
  inputLabel: { fontSize: 11, fontWeight: '700', color: '#475569', marginTop: 4 },
  fieldLabel: { fontSize: 11, fontWeight: '700', color: '#475569', marginTop: 6, marginBottom: 2 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  catChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill, backgroundColor: '#F1F5F9', borderWidth: 1, borderColor: '#CBD5E1' },
  catChipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  catChipText: { fontSize: 11, fontWeight: '700', color: '#475569' },
  catChipTextActive: { color: '#FFF' },
  textInput: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 10, fontSize: font.sm, backgroundColor: '#FFF' },
  errText: { color: colors.error, fontSize: font.sm, textAlign: 'center' },

  // Form & Line layout styles
  inlineFormCard: { marginTop: spacing.md, padding: spacing.md, backgroundColor: '#F8FAFC', borderRadius: radius.md, borderWidth: 1.5, borderColor: '#CBD5E1', gap: 8 },
  inlineFormHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, borderBottomWidth: 1, borderBottomColor: '#E2E8F0', paddingBottom: 6 },
  inlineFormTitle: { fontSize: 13, fontWeight: '800', color: '#0F172A' },
  formRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  formCol: { flex: 1 },
  quickPresetRow: { flexDirection: 'row', gap: 4 },
  quickPresetBtn: { backgroundColor: '#EEF2FF', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, borderWidth: 1, borderColor: '#C7D2FE' },
  quickPresetText: { fontSize: 9, fontWeight: '800', color: '#4338CA' },
  slotPickerBox: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.brandPrimary, borderStyle: 'dashed', backgroundColor: '#EFF6FF' },
  slotPickerBoxActive: { borderColor: colors.success, backgroundColor: '#F0FDF4' },
  slotPickerText: { fontSize: 12, fontWeight: '700', color: colors.brandPrimary },
  slotVolumeText: { fontSize: 11, color: colors.muted, marginTop: 2 },
  chooseFileBtn: { backgroundColor: '#DBEAFE', paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.sm },
  chooseFileBtnText: { fontSize: 11, fontWeight: '800', color: '#1E40AF' },
  formActionRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  primaryActionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: colors.brandPrimary, paddingVertical: 10, borderRadius: radius.md },
  primaryActionBtnText: { color: '#FFF', fontWeight: '800', fontSize: 13 },
  secondaryActionBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: radius.md, backgroundColor: '#E2E8F0', alignItems: 'center', justifyContent: 'center' },
  secondaryActionBtnText: { color: '#334155', fontWeight: '700', fontSize: 13 },

  // Line Card styles
  docLineCard: { padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: '#E2E8F0', backgroundColor: '#FFF', gap: 8 },
  docLineHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 },
  valCatBadge: { backgroundColor: '#FEF3C7', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1, borderColor: '#FDE68A' },
  valCatBadgeText: { fontSize: 10, fontWeight: '800', color: '#B45309' },
  docNoText: { fontSize: 12, color: colors.muted, fontWeight: '600' },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  statusBadgeExpired: { backgroundColor: '#FEE2E2', borderWidth: 1, borderColor: '#FECACA' },
  statusBadgeWarn: { backgroundColor: '#FEF3C7', borderWidth: 1, borderColor: '#FDE68A' },
  statusBadgeActive: { backgroundColor: '#DCFCE7', borderWidth: 1, borderColor: '#BBF7D0' },
  statusBadgeText: { fontSize: 10, fontWeight: '800' },
  statusTextExpired: { color: colors.error },
  statusTextWarn: { color: '#B45309' },
  statusTextActive: { color: '#15803D' },
  docLineMetaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, borderTopWidth: 1, borderTopColor: '#F1F5F9', paddingTop: 6 },
  metaCell: { flex: 1, minWidth: 100 },
  metaCellLabel: { fontSize: 9, fontWeight: '800', color: '#94A3B8', textTransform: 'uppercase' },
  metaCellVal: { fontSize: 11, fontWeight: '600', color: '#1E293B', marginTop: 1 },
  docLineFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, borderTopWidth: 1, borderTopColor: '#F8FAFC', paddingTop: 6 },
  attachmentSlotPill: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1, backgroundColor: '#F8FAFC', paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.sm, borderWidth: 1, borderColor: '#E2E8F0' },
  attachmentSlotName: { fontSize: 11, fontWeight: '700', color: colors.onSurface, flex: 1 },
  volumeBadge: { backgroundColor: '#E2E8F0', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4 },
  volumeBadgeText: { fontSize: 10, fontWeight: '800', color: '#334155' },
  maxLimitText: { fontSize: 9, color: colors.muted, fontWeight: '600' },
  lineActions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  actionIconBtn: { width: 32, height: 32, borderRadius: 6, backgroundColor: '#F1F5F9', alignItems: 'center', justifyContent: 'center' },
  inlineEditCard: { padding: spacing.md, borderRadius: radius.md, borderWidth: 1.5, borderColor: '#F59E0B', backgroundColor: '#FFFBEB', gap: 8 },

  // General Line Specific
  slBadge: { backgroundColor: '#E0E7FF', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, borderWidth: 1, borderColor: '#C7D2FE' },
  slBadgeText: { fontSize: 10, fontWeight: '800', color: '#4338CA' },
  genDescText: { fontSize: 13, fontWeight: '800', color: '#0F172A', flex: 1 },
  genCatBadge: { backgroundColor: '#F1F5F9', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  genCatBadgeText: { fontSize: 9, fontWeight: '700', color: '#64748B' },
});
