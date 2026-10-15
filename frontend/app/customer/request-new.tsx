import React, { useEffect, useState, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, Platform, Alert, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import { colors, spacing, radius, font, shadow } from '@/src/theme';
import { api } from '@/src/api';
import { useAuth } from '@/src/AuthContext';
import { CustomerLayout } from '@/src/CustomerLayout';
import { Card, PrimaryButton, SecondaryButton, ScreenLoader } from '@/src/ui';
import { notify } from '@/src/dialog';

interface SelectedFile {
  docType: string;
  name: string;
  uri: string;
  size?: number;
  mimeType?: string;
}

export default function NewServiceRequestScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const { user } = useAuth();

  const [services, setServices] = useState<any[]>([]);
  const [profile, setProfile] = useState<any>(null);
  const [selectedServiceId, setSelectedServiceId] = useState<string>((params.service_id as string) || '');
  const [priority, setPriority] = useState<'normal' | 'urgent'>('normal');
  const [remarks, setRemarks] = useState('');
  const [filesMap, setFilesMap] = useState<Record<string, SelectedFile>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Success state modal
  const [createdRequest, setCreatedRequest] = useState<any | null>(null);

  useEffect(() => {
    const init = async () => {
      try {
        const [sList, pData] = await Promise.all([
          api.getServiceCatalogue(),
          api.getCustomerProfile().catch(() => null),
        ]);
        setServices(sList || []);
        setProfile(pData);
        if (!selectedServiceId && sList && sList.length > 0) {
          setSelectedServiceId(sList[0].id || sList[0].code);
        }
      } catch (e: any) {
        notify(e?.message || 'Failed to initialize request form');
      } finally {
        setLoading(false);
      }
    };
    init();
  }, []);

  const activeService = useMemo(() => {
    return services.find((s) => s.id === selectedServiceId || s.code === selectedServiceId) || null;
  }, [services, selectedServiceId]);

  const handlePickFile = async (docType: string) => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'image/jpeg', 'image/png'],
        copyToCacheDirectory: true,
      });

      if (res.canceled || !res.assets?.[0]) return;
      const asset = res.assets[0];

      // Validate max file size (10MB)
      const maxSize = (activeService?.max_file_size_mb || 10) * 1024 * 1024;
      if (asset.size && asset.size > maxSize) {
        const msg = `File is too large (${(asset.size / 1024 / 1024).toFixed(1)} MB). Maximum allowed is ${activeService?.max_file_size_mb || 10} MB.`;
        if (Platform.OS === 'web') window.alert(msg);
        else Alert.alert('File size limit', msg);
        return;
      }

      setFilesMap((prev) => ({
        ...prev,
        [docType]: {
          docType,
          name: asset.name || 'document.pdf',
          uri: asset.uri,
          size: asset.size,
          mimeType: asset.mimeType || 'application/pdf',
        },
      }));
    } catch (e: any) {
      notify(e?.message || 'File selection failed');
    }
  };

  const handleRemoveFile = (docType: string) => {
    setFilesMap((prev) => {
      const next = { ...prev };
      delete next[docType];
      return next;
    });
  };

  const handleSubmit = async () => {
    if (!activeService) {
      setSubmitError('Please select a service');
      return;
    }

    // Check mandatory document presence
    const mandatoryDocs: string[] = activeService.mandatory_docs || [];
    const missingDocs = mandatoryDocs.filter((d) => !filesMap[d]);
    if (missingDocs.length > 0) {
      setSubmitError(`Please attach mandatory document: "${missingDocs[0]}"`);
      return;
    }

    setSubmitError(null);
    setSubmitting(true);

    try {
      // 1. Create Service Request record
      const newReq = await api.createServiceRequest({
        service_id: activeService.id || activeService.code,
        remarks: remarks.trim(),
        priority,
      });

      // 2. Upload any selected attachments
      const reqId = newReq.id || newReq.request_no;
      const fileEntries = Object.values(filesMap);
      for (const f of fileEntries) {
        try {
          await api.uploadServiceRequestDoc(reqId, f.docType, {
            uri: f.uri,
            name: f.name,
            type: f.mimeType,
          });
        } catch (uploadErr: any) {
          console.error(`Failed to upload ${f.docType}:`, uploadErr);
        }
      }

      setCreatedRequest(newReq);
      notify(`Service Request ${newReq.request_no} submitted successfully!`);
    } catch (e: any) {
      setSubmitError(e?.message || 'Failed to submit service request');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <CustomerLayout activeTab="new">
        <ScreenLoader label="Loading service request form..." />
      </CustomerLayout>
    );
  }

  return (
    <CustomerLayout
      activeTab="new"
      title="Apply for Service"
      subtitle="Fill in requirements and upload mandatory documents to initiate processing"
    >
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {/* Customer Identity Banner (Auto-populated) */}
        <View style={styles.customerBanner}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={styles.avatarMini}>
              <Ionicons name="business" size={20} color={colors.brandPrimary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.bannerName}>{profile?.name || user?.name || 'Contractor'}</Text>
              <Text style={styles.bannerSub}>
                Customer User ID: {profile?.numeric_user_id || user?.user_id} • Mobile: {profile?.mobile || '---'}
              </Text>
            </View>
          </View>
        </View>

        {submitError && (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle" size={18} color="#DC2626" />
            <Text style={styles.errorText}>{submitError}</Text>
          </View>
        )}

        {/* 1. Service Selection */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>1. Select Service</Text>
          <Text style={styles.cardSub}>Choose the desired service from our master catalogue:</Text>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.serviceChipsScroll}>
            {services.map((s) => {
              const isSel = s.id === selectedServiceId || s.code === selectedServiceId;
              return (
                <Pressable
                  key={s.id || s.code}
                  style={[styles.serviceSelectChip, isSel && styles.serviceSelectChipActive]}
                  onPress={() => setSelectedServiceId(s.id || s.code)}
                >
                  <Text style={[styles.serviceSelectText, isSel && styles.serviceSelectTextActive]}>
                    {s.name}
                  </Text>
                  {s.rate > 0 && (
                    <Text style={[styles.serviceRateMini, isSel && styles.serviceRateMiniActive]}>
                      ₹{s.rate}
                    </Text>
                  )}
                </Pressable>
              );
            })}
          </ScrollView>

          {activeService && (
            <View style={styles.serviceDetailBox}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={styles.activeServiceName}>{activeService.name}</Text>
                <Text style={styles.activeServiceRate}>
                  {activeService.rate > 0 ? `₹${Number(activeService.rate).toLocaleString('en-IN')}` : 'As Applicable'}
                </Text>
              </View>
              {activeService.description && (
                <Text style={styles.activeServiceDesc}>{activeService.description}</Text>
              )}
            </View>
          )}
        </View>

        {/* 2. Priority & Instructions */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>2. Execution Priority & Instructions</Text>

          <View style={styles.priorityRow}>
            <Pressable
              style={[styles.priorityOpt, priority === 'normal' && styles.priorityOptActive]}
              onPress={() => setPriority('normal')}
            >
              <Ionicons
                name="speedometer-outline"
                size={18}
                color={priority === 'normal' ? colors.brandPrimary : colors.muted}
              />
              <Text style={[styles.priorityText, priority === 'normal' && styles.priorityTextActive]}>
                Normal Priority
              </Text>
            </Pressable>

            <Pressable
              style={[styles.priorityOpt, priority === 'urgent' && styles.priorityOptUrgent]}
              onPress={() => setPriority('urgent')}
            >
              <Ionicons
                name="flame"
                size={18}
                color={priority === 'urgent' ? '#DC2626' : colors.muted}
              />
              <Text style={[styles.priorityText, priority === 'urgent' && styles.priorityTextUrgent]}>
                Urgent / Fast-Track
              </Text>
            </Pressable>
          </View>

          <View style={{ gap: 6 }}>
            <Text style={styles.inputLabel}>Remarks / Special Instructions (Optional)</Text>
            <TextInput
              style={[styles.input, { height: 75, textAlignVertical: 'top' }]}
              placeholder="Any specific note for the Triveni team regarding this request..."
              value={remarks}
              onChangeText={setRemarks}
              multiline
            />
          </View>
        </View>

        {/* 3. Document Checklist & File Upload */}
        <View style={styles.card}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={styles.cardTitle}>3. Document Checklist & Attachments</Text>
            <Text style={styles.fileLimitNote}>Max 10 MB (PDF, JPG, PNG)</Text>
          </View>
          <Text style={styles.cardSub}>
            Please upload the required documents. Mandatory items are marked with an asterisk (*).
          </Text>

          {/* Mandatory Documents List */}
          {(activeService?.mandatory_docs || []).length > 0 && (
            <View style={{ gap: 8 }}>
              <Text style={styles.docGroupHeader}>MANDATORY DOCUMENTS *</Text>
              {(activeService?.mandatory_docs || []).map((doc: string, idx: number) => {
                const attached = filesMap[doc];
                return (
                  <View key={idx} style={[styles.docUploadRow, attached && styles.docUploadRowAttached]}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.docNameText}>
                        * {doc}
                      </Text>
                      {attached ? (
                        <Text style={styles.attachedFileText}>
                          ✓ Attached: {attached.name} {attached.size ? `(${(attached.size / 1024).toFixed(0)} KB)` : ''}
                        </Text>
                      ) : (
                        <Text style={styles.missingDocText}>Not uploaded yet</Text>
                      )}
                    </View>

                    {attached ? (
                      <Pressable style={styles.removeFileBtn} onPress={() => handleRemoveFile(doc)}>
                        <Ionicons name="trash-outline" size={16} color="#DC2626" />
                        <Text style={styles.removeFileText}>Remove</Text>
                      </Pressable>
                    ) : (
                      <Pressable style={styles.uploadBtn} onPress={() => handlePickFile(doc)}>
                        <Ionicons name="cloud-upload-outline" size={16} color={colors.brandPrimary} />
                        <Text style={styles.uploadBtnText}>Upload</Text>
                      </Pressable>
                    )}
                  </View>
                );
              })}
            </View>
          )}

          {/* Optional Documents List */}
          {(activeService?.optional_docs || []).length > 0 && (
            <View style={{ gap: 8, marginTop: spacing.sm }}>
              <Text style={[styles.docGroupHeader, { color: '#64748B' }]}>OPTIONAL DOCUMENTS</Text>
              {(activeService?.optional_docs || []).map((doc: string, idx: number) => {
                const attached = filesMap[doc];
                return (
                  <View key={idx} style={[styles.docUploadRow, attached && styles.docUploadRowAttached]}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.docNameText, { color: '#475569' }]}>{doc}</Text>
                      {attached ? (
                        <Text style={styles.attachedFileText}>
                          ✓ Attached: {attached.name}
                        </Text>
                      ) : (
                        <Text style={styles.missingDocText}>Optional</Text>
                      )}
                    </View>

                    {attached ? (
                      <Pressable style={styles.removeFileBtn} onPress={() => handleRemoveFile(doc)}>
                        <Ionicons name="trash-outline" size={16} color="#DC2626" />
                        <Text style={styles.removeFileText}>Remove</Text>
                      </Pressable>
                    ) : (
                      <Pressable style={styles.uploadBtn} onPress={() => handlePickFile(doc)}>
                        <Ionicons name="cloud-upload-outline" size={16} color={colors.brandPrimary} />
                        <Text style={styles.uploadBtnText}>Upload</Text>
                      </Pressable>
                    )}
                  </View>
                );
              })}
            </View>
          )}

          {/* Generic Supporting Document */}
          <View style={[styles.docUploadRow, filesMap['Additional Documents'] && styles.docUploadRowAttached]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.docNameText, { color: '#475569' }]}>Any Other Supporting Document</Text>
              {filesMap['Additional Documents'] ? (
                <Text style={styles.attachedFileText}>
                  ✓ Attached: {filesMap['Additional Documents'].name}
                </Text>
              ) : (
                <Text style={styles.missingDocText}>Optional additional file</Text>
              )}
            </View>
            {filesMap['Additional Documents'] ? (
              <Pressable style={styles.removeFileBtn} onPress={() => handleRemoveFile('Additional Documents')}>
                <Ionicons name="trash-outline" size={16} color="#DC2626" />
                <Text style={styles.removeFileText}>Remove</Text>
              </Pressable>
            ) : (
              <Pressable style={styles.uploadBtn} onPress={() => handlePickFile('Additional Documents')}>
                <Ionicons name="cloud-upload-outline" size={16} color={colors.brandPrimary} />
                <Text style={styles.uploadBtnText}>Upload</Text>
              </Pressable>
            )}
          </View>
        </View>

        {/* Submit Actions */}
        <View style={styles.submitSection}>
          <PrimaryButton
            title="Submit Service Request"
            icon="paper-plane"
            onPress={handleSubmit}
            loading={submitting}
            style={{ minHeight: 52 }}
          />
        </View>
      </ScrollView>

      {/* Submission Success Modal */}
      {createdRequest && (
        <View style={styles.modalOverlay}>
          <View style={styles.successModalCard}>
            <View style={styles.successIconCircle}>
              <Ionicons name="checkmark-done" size={40} color="#059669" />
            </View>
            <Text style={styles.successTitle}>Request Submitted Successfully!</Text>
            <Text style={styles.successSub}>
              Your service request has been registered with Triveni DSC operations team.
            </Text>

            <View style={styles.reqSummaryBox}>
              <Text style={styles.reqSummaryLabel}>Service Request Number</Text>
              <Text style={styles.reqSummaryNo}>{createdRequest.request_no}</Text>
              <Text style={styles.reqSummaryService}>{createdRequest.service_name}</Text>
            </View>

            <View style={styles.successModalActions}>
              <SecondaryButton
                title="View All Requests"
                onPress={() => {
                  setCreatedRequest(null);
                  router.replace('/customer/requests' as any);
                }}
                style={{ flex: 1 }}
              />
              <PrimaryButton
                title="Track This Request"
                onPress={() => {
                  const id = createdRequest.id || createdRequest.request_no;
                  setCreatedRequest(null);
                  router.replace(`/customer/requests/${id}` as any);
                }}
                style={{ flex: 1 }}
              />
            </View>
          </View>
        </View>
      )}
    </CustomerLayout>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.lg, gap: spacing.lg },
  customerBanner: {
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    borderRadius: radius.md,
    padding: spacing.md,
  },
  avatarMini: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#DBEAFE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bannerName: {
    fontSize: font.base,
    fontWeight: '800',
    color: '#1E3A8A',
  },
  bannerSub: {
    fontSize: font.xs,
    color: '#3B82F6',
    marginTop: 2,
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
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
    ...shadow.card,
  },
  cardTitle: {
    fontSize: font.base + 2,
    fontWeight: '800',
    color: '#0F172A',
  },
  cardSub: {
    fontSize: font.xs + 1,
    color: colors.muted,
    marginTop: -4,
  },
  serviceChipsScroll: {
    maxHeight: 48,
    marginTop: 4,
  },
  serviceSelectChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.md,
    backgroundColor: '#F1F5F9',
    marginRight: 8,
  },
  serviceSelectChipActive: {
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: colors.brandPrimary,
  },
  serviceSelectText: {
    fontSize: font.xs + 1,
    fontWeight: '600',
    color: '#334155',
  },
  serviceSelectTextActive: {
    color: colors.brandPrimary,
    fontWeight: '700',
  },
  serviceRateMini: {
    fontSize: 10,
    fontWeight: '700',
    color: '#059669',
  },
  serviceRateMiniActive: {
    color: '#059669',
  },
  serviceDetailBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: spacing.md,
    gap: 4,
  },
  activeServiceName: {
    fontSize: font.base,
    fontWeight: '800',
    color: '#0F172A',
  },
  activeServiceRate: {
    fontSize: font.base,
    fontWeight: '800',
    color: '#059669',
  },
  activeServiceDesc: {
    fontSize: font.xs,
    color: colors.muted,
    marginTop: 2,
  },
  priorityRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  priorityOpt: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
    borderRadius: radius.md,
    backgroundColor: '#F1F5F9',
  },
  priorityOptActive: {
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: colors.brandPrimary,
  },
  priorityOptUrgent: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#DC2626',
  },
  priorityText: {
    fontSize: font.sm,
    fontWeight: '600',
    color: colors.muted,
  },
  priorityTextActive: {
    color: colors.brandPrimary,
    fontWeight: '700',
  },
  priorityTextUrgent: {
    color: '#DC2626',
    fontWeight: '700',
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
  fileLimitNote: {
    fontSize: font.xs,
    color: colors.muted,
    fontWeight: '600',
  },
  docGroupHeader: {
    fontSize: font.xs,
    fontWeight: '800',
    color: '#DC2626',
    letterSpacing: 0.5,
  },
  docUploadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F8FAFC',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: spacing.md,
    gap: spacing.md,
  },
  docUploadRowAttached: {
    backgroundColor: '#F0FDF4',
    borderColor: '#BBF7D0',
  },
  docNameText: {
    fontSize: font.sm,
    fontWeight: '700',
    color: '#0F172A',
  },
  attachedFileText: {
    fontSize: font.xs,
    color: '#059669',
    fontWeight: '600',
    marginTop: 2,
  },
  missingDocText: {
    fontSize: font.xs,
    color: colors.muted,
    marginTop: 2,
  },
  uploadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.sm,
  },
  uploadBtnText: {
    fontSize: font.xs + 1,
    fontWeight: '700',
    color: colors.brandPrimary,
  },
  removeFileBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FEF2F2',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: radius.sm,
  },
  removeFileText: {
    fontSize: font.xs,
    fontWeight: '700',
    color: '#DC2626',
  },
  submitSection: {
    marginTop: spacing.sm,
    marginBottom: spacing.xxl,
  },
  modalOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
    zIndex: 9999,
  },
  successModalCard: {
    width: '100%',
    maxWidth: 480,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.xxl,
    alignItems: 'center',
    gap: spacing.md,
  },
  successIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#DCFCE7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  successTitle: {
    fontSize: font.xl,
    fontWeight: '800',
    color: '#0F172A',
    textAlign: 'center',
  },
  successSub: {
    fontSize: font.sm,
    color: colors.muted,
    textAlign: 'center',
  },
  reqSummaryBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: spacing.lg,
    alignItems: 'center',
    width: '100%',
    marginVertical: spacing.sm,
  },
  reqSummaryLabel: {
    fontSize: font.xs,
    color: colors.muted,
    textTransform: 'uppercase',
    fontWeight: '700',
  },
  reqSummaryNo: {
    fontSize: font.xxl,
    fontWeight: '800',
    color: colors.brandPrimary,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    marginTop: 4,
  },
  reqSummaryService: {
    fontSize: font.base,
    fontWeight: '700',
    color: '#1E293B',
    marginTop: 4,
  },
  successModalActions: {
    flexDirection: 'row',
    gap: spacing.md,
    width: '100%',
    marginTop: spacing.sm,
  },
});
