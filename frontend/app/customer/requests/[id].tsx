import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, RefreshControl, Platform, Modal, Linking, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import { colors, spacing, radius, font, shadow } from '@/src/theme';
import { api } from '@/src/api';
import { CustomerLayout } from '@/src/CustomerLayout';
import { Card, StatusBadge, ScreenLoader, PrimaryButton, SecondaryButton } from '@/src/ui';
import { notify } from '@/src/dialog';

export default function CustomerRequestDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [request, setRequest] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Additional doc upload state
  const [uploadModal, setUploadModal] = useState(false);
  const [docType, setDocType] = useState('Supporting Document');
  const [selectedFile, setSelectedFile] = useState<any | null>(null);
  const [uploading, setUploading] = useState(false);

  const loadDetail = async () => {
    if (!id) return;
    try {
      const data = await api.getCustomerServiceRequestDetail(id);
      setRequest(data);
    } catch (e: any) {
      notify(e?.message || 'Failed to fetch request detail');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadDetail();
  }, [id]);

  const onRefresh = () => {
    setRefreshing(true);
    loadDetail();
  };

  const handleDownloadDoc = async (docId: string, fileName: string) => {
    try {
      const url = await api.serviceRequestDocDownloadUrl(request.id || request.request_no, docId);
      if (Platform.OS === 'web') {
        window.open(url, '_blank');
      } else {
        await Linking.openURL(url);
      }
    } catch (e: any) {
      notify(e?.message || 'Failed to download document');
    }
  };

  const handlePickAdditionalFile = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'image/jpeg', 'image/png'],
        copyToCacheDirectory: true,
      });
      if (res.canceled || !res.assets?.[0]) return;
      const asset = res.assets[0];
      if (asset.size && asset.size > 10 * 1024 * 1024) {
        notify('File is larger than 10 MB limit');
        return;
      }
      setSelectedFile(asset);
    } catch (e: any) {
      notify(e?.message || 'File selection failed');
    }
  };

  const handleUploadAdditionalDoc = async () => {
    if (!selectedFile) {
      notify('Please select a file to upload');
      return;
    }
    setUploading(true);
    try {
      await api.uploadServiceRequestDoc(request.id || request.request_no, docType, {
        uri: selectedFile.uri,
        name: selectedFile.name || 'document.pdf',
        type: selectedFile.mimeType,
      });
      notify('Document uploaded successfully!');
      setUploadModal(false);
      setSelectedFile(null);
      loadDetail();
    } catch (e: any) {
      notify(e?.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  if (loading) {
    return (
      <CustomerLayout activeTab="requests">
        <ScreenLoader label="Loading service request details..." />
      </CustomerLayout>
    );
  }

  if (!request) {
    return (
      <CustomerLayout activeTab="requests">
        <View style={styles.notFoundWrap}>
          <Ionicons name="alert-circle" size={48} color={colors.error} />
          <Text style={styles.notFoundTitle}>Service Request Not Found</Text>
          <SecondaryButton title="← Back to My Requests" onPress={() => router.replace('/customer/requests' as any)} />
        </View>
      </CustomerLayout>
    );
  }

  const timeline: any[] = request.workflow_history || [];
  const documents: any[] = request.documents || [];
  const completedDocs: any[] = request.completed_documents || [];
  const isTerminal = ['COMPLETED', 'REJECTED', 'CANCELLED'].includes(request.status);

  return (
    <CustomerLayout
      activeTab="requests"
      title={request.request_no}
      subtitle={`Service: ${request.service_name}`}
      rightAction={
        <SecondaryButton
          title="← All Requests"
          onPress={() => router.push('/customer/requests' as any)}
          style={{ height: 40, paddingHorizontal: 16 }}
        />
      }
    >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Header Summary Card */}
        <View style={styles.card}>
          <View style={styles.headerRow}>
            <View style={{ flex: 1 }}>
              <View style={styles.refRow}>
                <Text style={styles.reqNoText}>{request.request_no}</Text>
                <StatusBadge status={request.status} />
                {request.priority === 'urgent' && (
                  <View style={styles.urgentBadge}>
                    <Text style={styles.urgentBadgeText}>URGENT</Text>
                  </View>
                )}
              </View>
              <Text style={styles.serviceTitle}>{request.service_name}</Text>
            </View>
          </View>

          <View style={styles.metaGrid}>
            <View style={styles.metaItem}>
              <Text style={styles.metaLabel}>Submission Date</Text>
              <Text style={styles.metaValue}>
                {new Date(request.created_at).toLocaleDateString('en-IN', {
                  day: '2-digit',
                  month: 'short',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </Text>
            </View>

            <View style={styles.metaItem}>
              <Text style={styles.metaLabel}>Assigned Employee</Text>
              <Text style={styles.metaValue}>
                {request.assigned_to_name ? `👤 ${request.assigned_to_name}` : 'Pending assignment'}
              </Text>
            </View>

            <View style={styles.metaItem}>
              <Text style={styles.metaLabel}>Last Updated</Text>
              <Text style={styles.metaValue}>
                {request.updated_at
                  ? new Date(request.updated_at).toLocaleDateString('en-IN', {
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })
                  : '---'}
              </Text>
            </View>
          </View>

          {request.remarks ? (
            <View style={styles.instructionsBox}>
              <Text style={styles.instructionsLabel}>Your Initial Remarks / Instructions:</Text>
              <Text style={styles.instructionsText}>{request.remarks}</Text>
            </View>
          ) : null}

          {request.customer_remarks ? (
            <View style={styles.customerRemarksBox}>
              <Text style={styles.customerRemarksLabel}>Staff Note to You:</Text>
              <Text style={styles.customerRemarksText}>{request.customer_remarks}</Text>
            </View>
          ) : null}
        </View>

        {/* Completed Service Deliverables (If Completed / Delivered) */}
        {completedDocs.length > 0 && (
          <View style={[styles.card, { borderColor: '#86EFAC', backgroundColor: '#F0FDF4' }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Ionicons name="trophy" size={22} color="#059669" />
              <View>
                <Text style={[styles.cardTitle, { color: '#065F46' }]}>Completed Service Deliverables</Text>
                <Text style={[styles.cardSub, { color: '#047857' }]}>
                  Official certificates and completed documents ready for download:
                </Text>
              </View>
            </View>

            <View style={{ gap: 8, marginTop: 4 }}>
              {completedDocs.map((doc, idx) => (
                <View key={doc.doc_id || idx} style={styles.completedDocRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.completedDocName}>{doc.file_name || 'Certificate.pdf'}</Text>
                    <Text style={styles.completedDocMeta}>
                      Delivered: {doc.uploaded_at ? new Date(doc.uploaded_at).toLocaleDateString('en-IN') : 'Recent'}
                      {doc.size ? ` • ${(doc.size / 1024).toFixed(0)} KB` : ''}
                    </Text>
                  </View>
                  <Pressable
                    style={styles.downloadDeliverableBtn}
                    onPress={() => handleDownloadDoc(doc.doc_id, doc.file_name)}
                  >
                    <Ionicons name="download-outline" size={16} color="#FFFFFF" />
                    <Text style={styles.downloadDeliverableText}>Download</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Workflow Timeline Section */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Complete Workflow History & Timeline</Text>
          <Text style={styles.cardSub}>Step-by-step audit trace of this service request:</Text>

          <View style={styles.timelineContainer}>
            {timeline.length === 0 ? (
              <View style={styles.timelineItem}>
                <View style={[styles.timelineDot, { backgroundColor: colors.brandPrimary }]} />
                <View style={styles.timelineContent}>
                  <Text style={styles.timelineStatus}>SUBMITTED</Text>
                  <Text style={styles.timelineTime}>
                    {new Date(request.created_at).toLocaleString('en-IN')}
                  </Text>
                  <Text style={styles.timelineDesc}>Service request received in queue.</Text>
                </View>
              </View>
            ) : (
              timeline.map((step, idx) => {
                const isLast = idx === timeline.length - 1;
                const dateStr = step.timestamp || step.created_at || step.time;
                return (
                  <View key={idx} style={styles.timelineItem}>
                    <View style={styles.timelineLineWrapper}>
                      <View
                        style={[
                          styles.timelineDot,
                          isLast ? { backgroundColor: colors.brandPrimary } : { backgroundColor: '#94A3B8' },
                        ]}
                      />
                      {!isLast && <View style={styles.timelineVerticalLine} />}
                    </View>

                    <View style={styles.timelineContent}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <Text style={styles.timelineStatus}>{step.status || step.action}</Text>
                        <Text style={styles.timelineTime}>
                          {dateStr ? new Date(dateStr).toLocaleString('en-IN') : ''}
                        </Text>
                      </View>
                      <Text style={styles.timelineActor}>
                        Updated by: {step.actor_name || step.by || 'Operations Team'}
                      </Text>
                      {step.remarks ? (
                        <Text style={styles.timelineDesc}>{step.remarks}</Text>
                      ) : null}
                    </View>
                  </View>
                );
              })
            )}
          </View>
        </View>

        {/* Uploaded Documents Section */}
        <View style={styles.card}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <View>
              <Text style={styles.cardTitle}>Uploaded Documents ({documents.length})</Text>
              <Text style={styles.cardSub}>Attachments submitted with this request:</Text>
            </View>

            {!isTerminal && (
              <Pressable style={styles.addDocBtn} onPress={() => setUploadModal(true)}>
                <Ionicons name="add" size={16} color={colors.brandPrimary} />
                <Text style={styles.addDocBtnText}>Add Document</Text>
              </Pressable>
            )}
          </View>

          {documents.length === 0 ? (
            <View style={styles.emptyDocBox}>
              <Text style={styles.emptyDocText}>No documents attached to this request.</Text>
            </View>
          ) : (
            <View style={{ gap: 8, marginTop: 4 }}>
              {documents.map((doc, idx) => (
                <View key={doc.doc_id || idx} style={styles.docRow}>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Ionicons name="document-text" size={18} color="#3B82F6" />
                      <Text style={styles.docName}>{doc.file_name || 'document.pdf'}</Text>
                    </View>
                    <Text style={styles.docMeta}>
                      Type: {doc.doc_type || 'General'}
                      {doc.size ? ` • ${(doc.size / 1024).toFixed(0)} KB` : ''}
                    </Text>
                  </View>

                  <Pressable
                    style={styles.downloadBtn}
                    onPress={() => handleDownloadDoc(doc.doc_id, doc.file_name)}
                  >
                    <Ionicons name="eye-outline" size={16} color="#334155" />
                    <Text style={styles.downloadBtnText}>View / Download</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>

      {/* Add Additional Document Modal */}
      <Modal visible={uploadModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add Additional Document</Text>
              <Pressable onPress={() => setUploadModal(false)}>
                <Ionicons name="close" size={24} color={colors.muted} />
              </Pressable>
            </View>

            <View style={{ gap: spacing.md }}>
              <View style={{ gap: 4 }}>
                <Text style={styles.metaLabel}>Document Label / Type</Text>
                <Pressable
                  style={styles.pickFileBox}
                  onPress={handlePickAdditionalFile}
                >
                  <Ionicons name="cloud-upload" size={32} color={colors.brandPrimary} />
                  <Text style={styles.pickFileTitle}>
                    {selectedFile ? selectedFile.name : 'Click to select file (PDF, JPG, PNG)'}
                  </Text>
                  <Text style={styles.pickFileSub}>Max file size: 10 MB</Text>
                </Pressable>
              </View>
            </View>

            <View style={styles.modalActions}>
              <SecondaryButton title="Cancel" onPress={() => setUploadModal(false)} style={{ flex: 1 }} />
              <PrimaryButton
                title="Upload Document"
                onPress={handleUploadAdditionalDoc}
                loading={uploading}
                style={{ flex: 1 }}
              />
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
  notFoundWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.md,
  },
  notFoundTitle: {
    fontSize: font.lg,
    fontWeight: '700',
    color: '#0F172A',
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
    marginTop: -2,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  refRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
    flexWrap: 'wrap',
  },
  reqNoText: {
    fontSize: font.sm,
    fontWeight: '800',
    color: colors.brandPrimary,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  urgentBadge: {
    backgroundColor: '#FEE2E2',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  urgentBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#DC2626',
  },
  serviceTitle: {
    fontSize: font.xl,
    fontWeight: '800',
    color: '#0F172A',
  },
  metaGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    backgroundColor: '#F8FAFC',
    padding: spacing.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  metaItem: {
    flex: 1,
    minWidth: 140,
  },
  metaLabel: {
    fontSize: font.xs,
    color: colors.muted,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  metaValue: {
    fontSize: font.sm,
    fontWeight: '700',
    color: '#1E293B',
    marginTop: 2,
  },
  instructionsBox: {
    backgroundColor: '#F1F5F9',
    padding: spacing.md,
    borderRadius: radius.sm,
    gap: 2,
  },
  instructionsLabel: {
    fontSize: font.xs,
    fontWeight: '700',
    color: '#475569',
  },
  instructionsText: {
    fontSize: font.sm,
    color: '#1E293B',
  },
  customerRemarksBox: {
    backgroundColor: '#FEF9C3',
    borderWidth: 1,
    borderColor: '#FEF08A',
    padding: spacing.md,
    borderRadius: radius.sm,
    gap: 2,
  },
  customerRemarksLabel: {
    fontSize: font.xs,
    fontWeight: '700',
    color: '#854D0E',
  },
  customerRemarksText: {
    fontSize: font.sm,
    color: '#713F12',
  },
  completedDocRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.md,
  },
  completedDocName: {
    fontSize: font.sm,
    fontWeight: '800',
    color: '#065F46',
  },
  completedDocMeta: {
    fontSize: font.xs,
    color: '#047857',
    marginTop: 2,
  },
  downloadDeliverableBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#059669',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.md,
  },
  downloadDeliverableText: {
    color: '#FFFFFF',
    fontSize: font.xs + 1,
    fontWeight: '700',
  },
  timelineContainer: {
    paddingLeft: spacing.sm,
    marginTop: 4,
  },
  timelineItem: {
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: 56,
  },
  timelineLineWrapper: {
    alignItems: 'center',
    width: 20,
  },
  timelineDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginTop: 4,
  },
  timelineVerticalLine: {
    width: 2,
    flex: 1,
    backgroundColor: '#CBD5E1',
    marginVertical: 2,
  },
  timelineContent: {
    flex: 1,
    paddingBottom: spacing.md,
    gap: 2,
  },
  timelineStatus: {
    fontSize: font.sm,
    fontWeight: '800',
    color: '#0F172A',
  },
  timelineTime: {
    fontSize: font.xs,
    color: colors.muted,
  },
  timelineActor: {
    fontSize: font.xs,
    color: '#475569',
    fontWeight: '600',
  },
  timelineDesc: {
    fontSize: font.sm,
    color: '#334155',
    marginTop: 2,
  },
  addDocBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.sm,
  },
  addDocBtnText: {
    fontSize: font.xs,
    fontWeight: '700',
    color: colors.brandPrimary,
  },
  emptyDocBox: {
    padding: spacing.md,
    alignItems: 'center',
  },
  emptyDocText: {
    fontSize: font.sm,
    color: colors.muted,
  },
  docRow: {
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
  docName: {
    fontSize: font.sm,
    fontWeight: '700',
    color: '#1E293B',
  },
  docMeta: {
    fontSize: font.xs,
    color: colors.muted,
    marginTop: 2,
  },
  downloadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.md,
  },
  downloadBtnText: {
    fontSize: font.xs + 1,
    fontWeight: '700',
    color: '#334155',
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
    maxWidth: 480,
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
  pickFileBox: {
    borderWidth: 2,
    borderColor: '#BFDBFE',
    borderStyle: 'dashed',
    borderRadius: radius.md,
    backgroundColor: '#EFF6FF',
    padding: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  pickFileTitle: {
    fontSize: font.sm,
    fontWeight: '700',
    color: '#1E40AF',
    textAlign: 'center',
  },
  pickFileSub: {
    fontSize: font.xs,
    color: colors.muted,
  },
  modalActions: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
});
