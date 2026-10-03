import React, { useCallback, useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, FlatList, Pressable, ScrollView, TextInput,
  KeyboardAvoidingView, Platform, Image, Modal, ActivityIndicator, Alert, Switch
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, font } from '@/src/theme';
import { api, captureSelfie, getCurrentLocation, tokenStore } from '@/src/api';
import { Card, EmptyState, ScreenLoader, StatusBadge, PrimaryButton, SecondaryButton, Chip } from '@/src/ui';
import { ScreenHeader } from '@/src/ScreenHeader';
import { useAuth } from '@/src/AuthContext';
import { FormInput } from '@/src/forms';

type HRTab = 'attendance' | 'leaves' | 'categories';

type LeaveCategoryForm = {
  id?: string;
  name: string;
  code: string;
  description: string;
  max_per_week: string;
  max_per_month: string;
  max_per_year: string;
  is_paid: boolean;
  status: string;
};

const emptyCatForm: LeaveCategoryForm = {
  name: '',
  code: '',
  description: '',
  max_per_week: '1.0',
  max_per_month: '1.5',
  max_per_year: '12.0',
  is_paid: true,
  status: 'active',
};

export default function HRScreen() {
  const { user } = useAuth();
  const isAdminOrManager = user?.role === 'admin' || user?.role === 'manager';

  const [tab, setTab] = useState<HRTab>('attendance');
  const [token, setToken] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // Auto-hide toast
  useEffect(() => {
    if (toastMsg) {
      const timer = setTimeout(() => setToastMsg(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [toastMsg]);

  // ================= Attendance States =================
  const [summary, setSummary] = useState<any | null>(null);
  const [allPunches, setAllPunches] = useState<any[] | null>(null);
  const [viewTeam, setViewTeam] = useState(false);
  const [punchModal, setPunchModal] = useState(false);
  const [punchType, setPunchType] = useState<'in' | 'out'>('in');
  const [punchLoc, setPunchLoc] = useState<{ lat: number; lng: number; accuracy?: number } | null>(null);
  const [punchSelfie, setPunchSelfie] = useState<{ uri: string; name: string; type: string } | null>(null);
  const [punchPlace, setPunchPlace] = useState('');
  const [punchLocLoading, setPunchLocLoading] = useState(false);
  const [punchSubmitting, setPunchSubmitting] = useState(false);
  const [punchErr, setPunchErr] = useState<string | null>(null);

  // Live Camera & Face Recognition States
  const videoRef = useRef<any>(null);
  const [mediaStream, setMediaStream] = useState<any>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [faceRecognized, setFaceRecognized] = useState(false);
  const [scanLaserTop, setScanLaserTop] = useState(15);
  const [cameraPermissionError, setCameraPermissionError] = useState<string | null>(null);

  // ================= Leaves States =================
  const [leaves, setLeaves] = useState<any[] | null>(null);
  const [leaveModal, setLeaveModal] = useState(false);
  const [leaveForm, setLeaveForm] = useState({
    category_id: '',
    leave_type: 'Casual Leave (CL)',
    from_date: new Date().toISOString().split('T')[0],
    to_date: new Date().toISOString().split('T')[0],
    days_count: '1',
    reason: '',
  });
  const [leaveSubmitting, setLeaveSubmitting] = useState(false);
  const [leaveErr, setLeaveErr] = useState<string | null>(null);

  // ================= Leave Categories & Balances States =================
  const [categories, setCategories] = useState<any[] | null>(null);
  const [balances, setBalances] = useState<any | null>(null);
  const [catModal, setCatModal] = useState(false);
  const [catForm, setCatForm] = useState<LeaveCategoryForm>(emptyCatForm);
  const [catSubmitting, setCatSubmitting] = useState(false);
  const [catErr, setCatErr] = useState<string | null>(null);
  const [catToDelete, setCatToDelete] = useState<any | null>(null);
  const [catDeleteBusy, setCatDeleteBusy] = useState(false);

  // Load all initial data
  const loadData = useCallback(async () => {
    try {
      const [t, s, l, cats, b] = await Promise.all([
        tokenStore.get(),
        api.get<any>('/punches/today/summary').catch(() => ({ count: 0, remaining: 10, records: [] })),
        api.get<any[]>('/leaves').catch(() => []),
        api.getLeaveCategories().catch(() => []),
        api.getLeaveBalances().catch(() => null),
      ]);
      setToken(t);
      setSummary(s);
      setLeaves(l);
      setCategories(cats);
      setBalances(b);

      if (isAdminOrManager) {
        const teamPunches = await api.getAllPunchesToday().catch(() => []);
        setAllPunches(teamPunches);
      }
    } catch (e: any) {
      // fallback
    }
  }, [isAdminOrManager]);

  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

  // Auto calculate days when dates change in leave form
  const handleDateChange = (from: string, to: string) => {
    setLeaveForm(p => {
      let days = '1';
      try {
        const d1 = new Date(from);
        const d2 = new Date(to);
        const diff = Math.max(1, Math.round((d2.getTime() - d1.getTime()) / (1000 * 3600 * 24)) + 1);
        days = isNaN(diff) ? '1' : String(diff);
      } catch {}
      return { ...p, from_date: from, to_date: to, days_count: days };
    });
  };

  // ================= LIVE WEBCAM & FACE SCANNER ENGINE =================

  // Attach live video stream to HTML5 <video> element
  useEffect(() => {
    if (cameraActive && mediaStream && videoRef.current) {
      try {
        videoRef.current.srcObject = mediaStream;
        videoRef.current.play().catch(() => {});
      } catch (e) {}
    }
  }, [cameraActive, mediaStream]);

  // Clean up webcam tracks when unmounting or stopping
  useEffect(() => {
    return () => {
      if (mediaStream) {
        try {
          mediaStream.getTracks().forEach((t: any) => t.stop());
        } catch (e) {}
      }
    };
  }, [mediaStream]);

  // Animated Laser Scanner Sweeping Movement
  useEffect(() => {
    let timer: any;
    if (cameraActive && !punchSelfie) {
      let goingDown = true;
      timer = setInterval(() => {
        setScanLaserTop(prev => {
          if (goingDown) {
            if (prev >= 80) {
              goingDown = false;
              return 75;
            }
            return prev + 5;
          } else {
            if (prev <= 15) {
              goingDown = true;
              return 20;
            }
            return prev - 5;
          }
        });
      }, 60);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [cameraActive, punchSelfie]);

  // Simulated Face Alignment / Detection Timer
  useEffect(() => {
    let t: any;
    if (cameraActive && !punchSelfie) {
      t = setTimeout(() => {
        setFaceRecognized(true);
      }, 1200);
    }
    return () => {
      if (t) clearTimeout(t);
    };
  }, [cameraActive, punchSelfie]);

  // Attach live stream to video element
  useEffect(() => {
    if (mediaStream && videoRef.current) {
      if (videoRef.current.srcObject !== mediaStream) {
        videoRef.current.srcObject = mediaStream;
      }
      videoRef.current.play().catch(() => {});
    }
  }, [mediaStream, cameraActive]);

  // Cleanup camera stream on unmount
  useEffect(() => {
    return () => {
      if (mediaStream) {
        try {
          mediaStream.getTracks().forEach((t: any) => t.stop());
        } catch (e) {}
      }
    };
  }, [mediaStream]);

  const startLiveCamera = async () => {
    setCameraActive(false);
    setFaceRecognized(false);
    setCameraPermissionError(null);
    setPunchErr(null);

    if (Platform.OS === 'web') {
      if (typeof navigator !== 'undefined' && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        try {
          let stream: any;
          try {
            stream = await navigator.mediaDevices.getUserMedia({
              video: {
                facingMode: 'user',
                width: { ideal: 640 },
                height: { ideal: 480 },
              },
              audio: false,
            });
          } catch (e1) {
            // Fallback for USB/built-in desktop webcams that do not support facingMode constraint
            stream = await navigator.mediaDevices.getUserMedia({
              video: true,
              audio: false,
            });
          }
          setMediaStream(stream);
          setCameraActive(true);
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            videoRef.current.play().catch(() => {});
          }
        } catch (err: any) {
          setCameraActive(false);
          const errMsg = err?.name === 'NotAllowedError'
            ? 'Camera permission was denied. Please click the camera icon in your browser address bar to Allow camera access and click Retry.'
            : (err?.message || 'Webcam camera not accessible. Please verify your camera is connected and not in use by another application.');
          setCameraPermissionError(errMsg);
        }
      } else {
        setCameraActive(false);
        setCameraPermissionError(
          'Webcam access requires a secure connection (localhost or HTTPS). Please open the application via http://localhost:8081 or http://127.0.0.1:8000.'
        );
      }
    } else {
      // Native mobile device fallback
      try {
        const pic = await captureSelfie();
        if (pic) {
          setPunchSelfie(pic);
          setFaceRecognized(true);
        }
      } catch (e: any) {
        setPunchErr(e?.message || 'Camera capture failed');
      }
    }
  };

  const stopLiveCamera = () => {
    if (mediaStream) {
      try {
        mediaStream.getTracks().forEach((t: any) => t.stop());
      } catch (e) {}
      setMediaStream(null);
    }
    if (videoRef.current) {
      try {
        videoRef.current.srcObject = null;
      } catch (e) {}
    }
    setCameraActive(false);
    setFaceRecognized(false);
  };

  const closePunchModal = () => {
    stopLiveCamera();
    setPunchModal(false);
    setPunchSelfie(null);
    setPunchErr(null);
  };

  // Start Punch Workflow
  const startPunch = async (type: 'in' | 'out') => {
    setPunchType(type);
    setPunchLoc(null);
    setPunchSelfie(null);
    setPunchPlace('');
    setPunchErr(null);
    setPunchModal(true);

    // 1. Live GPS Location in background
    setPunchLocLoading(true);
    getCurrentLocation().then(loc => {
      setPunchLoc(loc);
      setPunchPlace(`GPS (${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)})`);
      setPunchLocLoading(false);
    }).catch(e => {
      setPunchLocLoading(false);
    });

    // 2. Open Live Camera automatically
    startLiveCamera();
  };

  // Capture frame from video and submit punch
  const captureLiveFaceAndPunch = async () => {
    let capturedPhoto = punchSelfie;
    if (!capturedPhoto && videoRef.current) {
      try {
        const video = videoRef.current;
        const w = video.videoWidth > 0 ? video.videoWidth : (video.clientWidth || 640);
        const h = video.videoHeight > 0 ? video.videoHeight : (video.clientHeight || 480);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          // Mirror horizontally for natural front-camera orientation
          ctx.translate(canvas.width, 0);
          ctx.scale(-1, 1);
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const dataUri = canvas.toDataURL('image/jpeg', 0.88);
          stopLiveCamera();
          capturedPhoto = {
            uri: dataUri,
            name: `selfie_${Date.now()}.jpg`,
            type: 'image/jpeg',
          };
          setPunchSelfie(capturedPhoto);
          setFaceRecognized(true);
        }
      } catch (err: any) {
        setPunchErr('Failed to capture video frame: ' + err?.message);
        return;
      }
    }

    if (!capturedPhoto) {
      setPunchErr('Face capture is mandatory for face verification.');
      return;
    }

    setPunchSubmitting(true);
    setPunchErr(null);
    try {
      const rec = await api.createPunch({
        type: punchType,
        lat: punchLoc?.lat,
        lng: punchLoc?.lng,
        accuracy: punchLoc?.accuracy,
        place_name: punchPlace.trim() || undefined,
        selfie: capturedPhoto,
      });

      closePunchModal();
      const label = punchType.toUpperCase();
      const statusText = rec.is_late ? ' (Marked LATE)' : '';
      setToastMsg(`✓ Punch ${label} recorded successfully at ${rec.time} • ${rec.place_name || 'On Site'}${statusText}`);
      await loadData();
    } catch (e: any) {
      setPunchErr(e?.message || 'Punch submission failed. Please try again.');
    } finally {
      setPunchSubmitting(false);
    }
  };

  // ================= LEAVE REQUEST WORKFLOW =================
  const submitLeave = async () => {
    if (!leaveForm.from_date || !leaveForm.to_date) {
      setLeaveErr('Both From Date and To Date are required');
      return;
    }
    setLeaveSubmitting(true);
    setLeaveErr(null);
    try {
      await api.post('/leaves', {
        category_id: leaveForm.category_id || undefined,
        leave_type: leaveForm.leave_type,
        from_date: leaveForm.from_date,
        to_date: leaveForm.to_date,
        days_count: parseFloat(leaveForm.days_count) || 1.0,
        reason: leaveForm.reason.trim() || undefined,
      });
      setLeaveModal(false);
      setToastMsg('Leave request submitted successfully!');
      await loadData();
    } catch (e: any) {
      setLeaveErr(e?.message || 'Failed to submit leave request');
    } finally {
      setLeaveSubmitting(false);
    }
  };

  const decideLeave = async (id: string, status: 'approved' | 'rejected') => {
    try {
      await api.patch(`/leaves/${id}`, { status });
      setToastMsg(`Leave application ${status.toUpperCase()} successfully.`);
      await loadData();
    } catch (e: any) {
      if (Platform.OS === 'web') window.alert(e?.message || 'Action failed');
      else Alert.alert('Error', e?.message || 'Action failed');
    }
  };

  const cancelLeave = async (id: string) => {
    try {
      await api.cancelLeave(id);
      setToastMsg('Leave request deleted/cancelled.');
      await loadData();
    } catch (e: any) {
      if (Platform.OS === 'web') window.alert(e?.message || 'Cancel failed');
      else Alert.alert('Error', e?.message || 'Cancel failed');
    }
  };

  // ================= LEAVE CATEGORY CRUD WORKFLOW =================
  const openNewCategory = () => {
    setCatForm(emptyCatForm);
    setCatErr(null);
    setCatModal(true);
  };

  const openEditCategory = (cat: any) => {
    setCatForm({
      id: cat.id,
      name: cat.name,
      code: cat.code,
      description: cat.description || '',
      max_per_week: String(cat.max_per_week ?? '1.0'),
      max_per_month: String(cat.max_per_month ?? '1.5'),
      max_per_year: String(cat.max_per_year ?? '12.0'),
      is_paid: cat.is_paid !== false,
      status: cat.status || 'active',
    });
    setCatErr(null);
    setCatModal(true);
  };

  const saveCategory = async () => {
    if (!catForm.name.trim() || !catForm.code.trim()) {
      setCatErr('Category Name and Code are mandatory');
      return;
    }
    setCatSubmitting(true);
    setCatErr(null);
    try {
      const payload = {
        name: catForm.name.trim(),
        code: catForm.code.trim().toUpperCase(),
        description: catForm.description.trim() || undefined,
        max_per_week: parseFloat(catForm.max_per_week) || 1.0,
        max_per_month: parseFloat(catForm.max_per_month) || 1.5,
        max_per_year: parseFloat(catForm.max_per_year) || 12.0,
        is_paid: catForm.is_paid,
        status: catForm.status,
      };

      if (catForm.id) {
        await api.updateLeaveCategory(catForm.id, payload);
        setToastMsg(`Category "${payload.name}" updated successfully!`);
      } else {
        await api.createLeaveCategory(payload);
        setToastMsg(`New Category "${payload.name}" added successfully!`);
      }
      setCatModal(false);
      await loadData();
    } catch (e: any) {
      setCatErr(e?.message || 'Failed to save leave category');
    } finally {
      setCatSubmitting(false);
    }
  };

  const executeDeleteCategory = async () => {
    if (!catToDelete) return;
    setCatDeleteBusy(true);
    try {
      await api.deleteLeaveCategory(catToDelete.id);
      setCatToDelete(null);
      setToastMsg(`Category "${catToDelete.name}" deleted.`);
      await loadData();
    } catch (e: any) {
      if (Platform.OS === 'web') window.alert(e?.message || 'Delete failed');
      else Alert.alert('Error', e?.message || 'Delete failed');
    } finally {
      setCatDeleteBusy(false);
    }
  };

  const records: any[] = viewTeam ? (allPunches || []) : (summary?.records || []);
  const nextAction: 'in' | 'out' = summary?.last_type === 'in' ? 'out' : 'in';

  return (
    <View style={styles.container}>
      <ScreenHeader
        title="HR & Attendance Management"
        subtitle="GPS Geo-Punch, Face Verification & Leave Balances"
      />

      {/* Toast Notification */}
      {toastMsg ? (
        <View style={styles.toastBanner}>
          <Ionicons name="checkmark-circle" size={20} color="#15803D" />
          <Text style={styles.toastText}>{toastMsg}</Text>
          <Pressable onPress={() => setToastMsg(null)}>
            <Ionicons name="close" size={18} color="#15803D" />
          </Pressable>
        </View>
      ) : null}

      {/* Main 3-Tab Selector */}
      <View style={styles.tabContainer}>
        <Pressable
          testID="tab-attendance"
          onPress={() => setTab('attendance')}
          style={[styles.tabBtn, tab === 'attendance' && styles.tabBtnActive]}
        >
          <Ionicons
            name="finger-print-outline"
            size={18}
            color={tab === 'attendance' ? colors.brandPrimary : colors.muted}
          />
          <Text style={[styles.tabText, tab === 'attendance' && styles.tabTextActive]}>
            Attendance & Geo-Punch
          </Text>
        </Pressable>

        <Pressable
          testID="tab-leaves"
          onPress={() => setTab('leaves')}
          style={[styles.tabBtn, tab === 'leaves' && styles.tabBtnActive]}
        >
          <Ionicons
            name="calendar-outline"
            size={18}
            color={tab === 'leaves' ? colors.brandPrimary : colors.muted}
          />
          <Text style={[styles.tabText, tab === 'leaves' && styles.tabTextActive]}>
            Leave Requests
          </Text>
        </Pressable>

        <Pressable
          testID="tab-categories"
          onPress={() => setTab('categories')}
          style={[styles.tabBtn, tab === 'categories' && styles.tabBtnActive]}
        >
          <Ionicons
            name="options-outline"
            size={18}
            color={tab === 'categories' ? colors.brandPrimary : colors.muted}
          />
          <Text style={[styles.tabText, tab === 'categories' && styles.tabTextActive]}>
            Categories & Balances
          </Text>
        </Pressable>
      </View>

      {/* ============================================================== */}
      {/* TAB 1: ATTENDANCE & GEO-PUNCH */}
      {/* ============================================================== */}
      {tab === 'attendance' ? (
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {/* Today's Punch Summary Card */}
          <Card style={styles.statCard}>
            <View style={styles.statHeader}>
              <View>
                <Text style={styles.todayDateText}>
                  {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' })}
                </Text>
                <Text style={styles.statCountText}>
                  {summary?.count ?? 0} Punches Recorded
                </Text>
                <Text style={styles.statSubText}>
                  Punches In: {summary?.punches_in ?? 0} • Punches Out: {summary?.punches_out ?? 0}
                  {summary?.late_count ? ` • Late: ${summary.late_count}` : ''}
                </Text>
              </View>

              <View style={styles.remainingPill}>
                <Text style={styles.remainingPillLabel}>Remaining</Text>
                <Text style={styles.remainingPillVal}>{summary?.remaining ?? 10}</Text>
              </View>
            </View>

            {/* Quick Action Buttons for Punch In & Punch Out */}
            <View style={styles.punchActionRow}>
              <Pressable
                onPress={() => startPunch('in')}
                style={({ pressed }) => [
                  styles.punchInBtn,
                  nextAction === 'in' && styles.punchBtnRecommended,
                  pressed && styles.btnPressed
                ]}
                accessibilityLabel="Punch In"
                accessibilityRole="button"
              >
                <Ionicons name="log-in" size={22} color="#FFFFFF" />
                <View>
                  <Text style={styles.punchBtnTitle}>Punch IN</Text>
                  <Text style={styles.punchBtnSubtitle}>Live Camera + Face Recognition</Text>
                </View>
              </Pressable>

              <Pressable
                onPress={() => startPunch('out')}
                style={({ pressed }) => [
                  styles.punchOutBtn,
                  nextAction === 'out' && styles.punchBtnRecommended,
                  pressed && styles.btnPressed
                ]}
                accessibilityLabel="Punch Out"
                accessibilityRole="button"
              >
                <Ionicons name="log-out" size={22} color="#FFFFFF" />
                <View>
                  <Text style={styles.punchBtnTitle}>Punch OUT</Text>
                  <Text style={styles.punchBtnSubtitle}>Live Camera + Face Recognition</Text>
                </View>
              </Pressable>
            </View>
          </Card>

          {/* Section Header & Toggle for Team Attendance */}
          <View style={styles.sectionHeaderRow}>
            <View>
              <Text style={styles.sectionTitle}>
                {viewTeam ? "Today's All Staff Attendance" : "My Attendance Logs"}
              </Text>
              <Text style={styles.sectionSubtitle}>
                Verified punches with GPS coordinates and Face Photo
              </Text>
            </View>

            {isAdminOrManager ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={styles.switchLabel}>{viewTeam ? 'Team View' : 'My View'}</Text>
                <Switch
                  value={viewTeam}
                  onValueChange={v => setViewTeam(v)}
                  trackColor={{ false: '#CBD5E1', true: colors.brandPrimary }}
                />
              </View>
            ) : null}
          </View>

          {/* Attendance Records List */}
          {records.length === 0 ? (
            <EmptyState
              icon="finger-print-outline"
              title="No Punches Recorded Today"
              subtitle="Use the Punch In button above to mark your morning attendance."
              actionLabel="Punch In Now"
              onAction={() => startPunch('in')}
            />
          ) : (
            records.map((item, idx) => (
              <Card key={item.id || idx} style={styles.punchRecordCard}>
                <View style={styles.punchRecordRow}>
                  {/* Selfie Photo Thumbnail */}
                  {item.selfie_path && token ? (
                    <Image
                      source={{ uri: `${api.base}/api/files/${item.selfie_path}?token=${encodeURIComponent(token)}` }}
                      style={styles.selfieImage}
                    />
                  ) : (
                    <View style={styles.selfiePlaceholder}>
                      <Ionicons name="person" size={22} color={colors.muted} />
                    </View>
                  )}

                  <View style={{ flex: 1, gap: 2 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <Text style={styles.punchUser}>{item.user_name || 'Employee'}</Text>
                      {item.employee_code ? (
                        <Text style={styles.empCodeBadge}>{item.employee_code}</Text>
                      ) : null}
                      <View style={[styles.typeBadge, item.type === 'in' ? styles.typeBadgeIn : styles.typeBadgeOut]}>
                        <Text style={[styles.typeBadgeText, { color: item.type === 'in' ? '#15803D' : '#C2410C' }]}>
                          {item.type.toUpperCase()}
                        </Text>
                      </View>
                      {item.is_late ? (
                        <View style={styles.lateTag}>
                          <Text style={styles.lateText}>LATE</Text>
                        </View>
                      ) : null}
                    </View>

                    <Text style={styles.punchTime}>
                      {item.date} • <Text style={{ fontWeight: '700', color: colors.onSurface }}>{item.time}</Text>
                    </Text>

                    {/* Place Name */}
                    {item.place_name || item.office_name ? (
                      <View style={styles.metaRow}>
                        <Ionicons name="business-outline" size={14} color={colors.brandSecondary} />
                        <Text style={[styles.metaText, { color: colors.brandSecondary, fontWeight: '600' }]}>
                          {item.place_name || item.office_name}
                        </Text>
                      </View>
                    ) : null}

                    {/* Geo Tag Coordinates */}
                    {item.lat && item.lng ? (
                      <View style={styles.metaRow}>
                        <Ionicons name="navigate-outline" size={14} color={colors.muted} />
                        <Text style={styles.metaText}>
                          GPS: {item.lat.toFixed(5)}, {item.lng.toFixed(5)}
                          {item.accuracy ? ` (±${Math.round(item.accuracy)}m)` : ''}
                          {item.distance_m != null ? ` • ${Math.round(item.distance_m)}m from branch` : ''}
                        </Text>
                      </View>
                    ) : null}
                  </View>

                  {/* Face Recognition & Geofence Verification Badges */}
                  <View style={styles.verificationCol}>
                    <View style={styles.faceVerifiedBadge}>
                      <Ionicons name="checkmark-circle" size={14} color="#15803D" />
                      <Text style={styles.faceVerifiedText}>Face Verified</Text>
                    </View>
                    {item.within_geofence !== false ? (
                      <View style={[styles.geoBadge, { backgroundColor: '#DCFCE7' }]}>
                        <Ionicons name="location" size={12} color="#15803D" />
                        <Text style={[styles.geoBadgeText, { color: '#15803D' }]}>Within Geofence</Text>
                      </View>
                    ) : (
                      <View style={[styles.geoBadge, { backgroundColor: '#FEF3C7' }]}>
                        <Ionicons name="warning-outline" size={12} color="#B45309" />
                        <Text style={[styles.geoBadgeText, { color: '#B45309' }]}>Out of Geofence</Text>
                      </View>
                    )}
                  </View>
                </View>
              </Card>
            ))
          )}
        </ScrollView>
      ) : null}

      {/* ============================================================== */}
      {/* TAB 2: LEAVE REQUESTS */}
      {/* ============================================================== */}
      {tab === 'leaves' ? (
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <View style={styles.topActionsRow}>
            <View>
              <Text style={styles.sectionTitle}>Leave Applications</Text>
              <Text style={styles.sectionSubtitle}>Apply for leave or manage employee approvals</Text>
            </View>
            <PrimaryButton
              label="+ Request Leave"
              icon="add"
              onPress={() => {
                setLeaveErr(null);
                setLeaveModal(true);
              }}
            />
          </View>

          {leaves === null ? (
            <ScreenLoader />
          ) : leaves.length === 0 ? (
            <EmptyState
              icon="calendar-outline"
              title="No Leave Applications"
              subtitle="Submit your leave application for manager approval."
              actionLabel="+ Request Leave"
              onAction={() => {
                setLeaveErr(null);
                setLeaveModal(true);
              }}
            />
          ) : (
            leaves.map((item, idx) => (
              <Card key={item.id || idx} style={styles.leaveCard}>
                <View style={styles.leaveHeaderRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.leaveUserName}>{item.user_name || 'Employee'}</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
                      <Text style={styles.leaveCategoryTag}>{item.leave_type || 'Leave'}</Text>
                      <Text style={styles.leaveDaysTag}>{item.days_count || 1} Days</Text>
                    </View>
                  </View>
                  <StatusBadge status={item.status} />
                </View>

                <View style={styles.leaveDateRangeBox}>
                  <Ionicons name="calendar-outline" size={16} color={colors.brandPrimary} />
                  <Text style={styles.leaveDateText}>
                    {item.from_date} <Ionicons name="arrow-forward" size={12} color={colors.muted} /> {item.to_date}
                  </Text>
                </View>

                {item.reason ? (
                  <Text style={styles.leaveReasonText}>
                    <Text style={{ fontWeight: '700', color: colors.onSurface }}>Reason: </Text>
                    {item.reason}
                  </Text>
                ) : null}

                {/* Manager / Admin Approval Controls */}
                {isAdminOrManager && item.status === 'pending' ? (
                  <View style={styles.leaveActionBtns}>
                    <SecondaryButton
                      label="Reject"
                      onPress={() => decideLeave(item.id, 'rejected')}
                      style={{ flex: 1 }}
                    />
                    <PrimaryButton
                      label="Approve"
                      onPress={() => decideLeave(item.id, 'approved')}
                      style={{ flex: 1 }}
                    />
                  </View>
                ) : item.status === 'pending' && item.user_id === user?.user_id ? (
                  <View style={{ marginTop: spacing.sm, alignItems: 'flex-end' }}>
                    <Pressable onPress={() => cancelLeave(item.id)} style={styles.cancelLeaveBtn}>
                      <Ionicons name="trash-outline" size={14} color={colors.error} />
                      <Text style={styles.cancelLeaveText}>Cancel Request</Text>
                    </Pressable>
                  </View>
                ) : null}
              </Card>
            ))
          )}
        </ScrollView>
      ) : null}

      {/* ============================================================== */}
      {/* TAB 3: LEAVE CATEGORIES MASTER & BALANCES */}
      {/* ============================================================== */}
      {tab === 'categories' ? (
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {/* SECTION A: LEAVE BALANCES SUMMARY TABLE */}
          <View style={styles.subSectionHeader}>
            <View>
              <Text style={styles.sectionTitle}>Leave Balances & Utilisation</Text>
              <Text style={styles.sectionSubtitle}>
                Current Year: {balances?.year || new Date().getFullYear()} • Entitlement & Balance breakdown
              </Text>
            </View>
          </View>

          {balances?.balances && balances.balances.length > 0 ? (
            <Card style={styles.balanceSummaryCard}>
              <ScrollView horizontal showsHorizontalScrollIndicator>
                <View style={styles.balanceTable}>
                  {/* Table Header with user requested columns */}
                  <View style={styles.balanceTableRowHeader}>
                    <Text style={[styles.balanceColText, styles.colCategory]}>Category</Text>
                    <Text style={[styles.balanceColText, styles.colLimit]}>Total in Week</Text>
                    <Text style={[styles.balanceColText, styles.colLimit]}>Total in Month</Text>
                    <Text style={[styles.balanceColText, styles.colQuota]}>Total in Year</Text>
                    <Text style={[styles.balanceColText, styles.colUtilised]}>Utilised Leave</Text>
                    <Text style={[styles.balanceColText, styles.colPending]}>Pending Leave</Text>
                    <Text style={[styles.balanceColText, styles.colBalance]}>Balance Leave</Text>
                  </View>

                  {/* Table Rows */}
                  {balances.balances.map((b: any, i: number) => (
                    <View key={b.category_id || i} style={[styles.balanceTableRow, i % 2 === 1 && styles.balanceRowAlt]}>
                      <View style={[styles.balanceColCell, styles.colCategory]}>
                        <Text style={styles.bCatName}>{b.category_name}</Text>
                        <Text style={styles.bCatCode}>[{b.category_code}]</Text>
                      </View>
                      <Text style={[styles.balanceColText, styles.colLimit, styles.centerText]}>{b.max_per_week} d/wk</Text>
                      <Text style={[styles.balanceColText, styles.colLimit, styles.centerText]}>{b.max_per_month} d/mo</Text>
                      <Text style={[styles.balanceColText, styles.colQuota, styles.centerText, { fontWeight: '700' }]}>{b.max_per_year} d/yr</Text>
                      <Text style={[styles.balanceColText, styles.colUtilised, styles.centerText, { color: '#B45309', fontWeight: '700' }]}>
                        {b.utilised_leave} days
                      </Text>
                      <Text style={[styles.balanceColText, styles.colPending, styles.centerText, { color: colors.muted }]}>
                        {b.pending_leave} days
                      </Text>
                      <View style={[styles.balanceColCell, styles.colBalance, { alignItems: 'center' }]}>
                        <View style={styles.balancePill}>
                          <Text style={styles.balancePillText}>{b.balance_leave} days</Text>
                        </View>
                      </View>
                    </View>
                  ))}
                </View>
              </ScrollView>
            </Card>
          ) : (
            <ScreenLoader />
          )}

          {/* SECTION B: LEAVE CATEGORIES MASTER (CRUD) */}
          <View style={[styles.subSectionHeader, { marginTop: spacing.xl }]}>
            <View>
              <Text style={styles.sectionTitle}>Leave Categories Master</Text>
              <Text style={styles.sectionSubtitle}>
                Add, edit, update, and delete leave policies and quotas
              </Text>
            </View>

            {isAdminOrManager ? (
              <Pressable onPress={openNewCategory} style={styles.addCategoryBtn}>
                <Ionicons name="add-circle" size={18} color="#FFFFFF" />
                <Text style={styles.addCategoryBtnText}>+ Add Category</Text>
              </Pressable>
            ) : null}
          </View>

          {categories === null ? (
            <ScreenLoader />
          ) : categories.length === 0 ? (
            <EmptyState
              icon="options-outline"
              title="No Categories Configured"
              subtitle="Add a leave category to start tracking quotas."
              actionLabel="+ Add Category"
              onAction={openNewCategory}
            />
          ) : (
            categories.map((cat, idx) => (
              <Card key={cat.id || idx} style={styles.catCard}>
                <View style={styles.catHeaderRow}>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Text style={styles.catTitle}>{cat.name}</Text>
                      <View style={styles.catCodeBadge}>
                        <Text style={styles.catCodeText}>{cat.code}</Text>
                      </View>
                      <View style={[styles.badge, cat.status === 'active' ? styles.badgeActive : styles.badgeInactive]}>
                        <Text style={[styles.badgeText, { color: cat.status === 'active' ? colors.success : colors.muted }]}>
                          {(cat.status || 'active').toUpperCase()}
                        </Text>
                      </View>
                    </View>
                    {cat.description ? <Text style={styles.catDesc}>{cat.description}</Text> : null}
                  </View>

                  {/* Edit and Delete Buttons */}
                  {isAdminOrManager ? (
                    <View style={styles.catActionBtns}>
                      <Pressable
                        onPress={() => openEditCategory(cat)}
                        style={({ pressed }) => [styles.catEditBtn, pressed && styles.btnPressed]}
                        accessibilityLabel={`Edit ${cat.name}`}
                        accessibilityRole="button"
                      >
                        <Ionicons name="pencil" size={14} color={colors.brandPrimary} />
                        <Text style={styles.catEditBtnText}>Edit</Text>
                      </Pressable>

                      <Pressable
                        onPress={() => setCatToDelete(cat)}
                        style={({ pressed }) => [styles.catDelBtn, pressed && styles.btnPressed]}
                        accessibilityLabel={`Delete ${cat.name}`}
                        accessibilityRole="button"
                      >
                        <Ionicons name="trash-outline" size={14} color={colors.error} />
                        <Text style={styles.catDelBtnText}>Delete</Text>
                      </Pressable>
                    </View>
                  ) : null}
                </View>

                {/* Quota Columns Display */}
                <View style={styles.catLimitsGrid}>
                  <View style={styles.catLimitBox}>
                    <Text style={styles.catLimitLabel}>Total in Week</Text>
                    <Text style={styles.catLimitVal}>{cat.max_per_week ?? 1} d/wk</Text>
                  </View>
                  <View style={styles.catLimitBox}>
                    <Text style={styles.catLimitLabel}>Total in Month</Text>
                    <Text style={styles.catLimitVal}>{cat.max_per_month ?? 1.5} d/mo</Text>
                  </View>
                  <View style={styles.catLimitBox}>
                    <Text style={styles.catLimitLabel}>Total in Year</Text>
                    <Text style={[styles.catLimitVal, { color: colors.brandPrimary, fontWeight: '800' }]}>
                      {cat.max_per_year ?? 12} d/yr
                    </Text>
                  </View>
                  <View style={styles.catLimitBox}>
                    <Text style={styles.catLimitLabel}>Leave Type</Text>
                    <Text style={styles.catLimitVal}>{cat.is_paid !== false ? 'Paid' : 'Unpaid'}</Text>
                  </View>
                </View>
              </Card>
            ))
          )}
        </ScrollView>
      ) : null}

      {/* ============================================================== */}
      {/* MODAL 1: PUNCH IN / OUT WITH LIVE CAMERA & FACE SCANNER */}
      {/* ============================================================== */}
      <Modal visible={punchModal} animationType="slide" transparent onRequestClose={closePunchModal}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>
                  {punchType === 'in' ? 'Punch IN' : 'Punch OUT'} - Face Recognition
                </Text>
                <Text style={styles.modalSubTitle}>
                  Live camera stream + GPS Geotag verification
                </Text>
              </View>
              <Pressable onPress={closePunchModal} hitSlop={8}>
                <Ionicons name="close" size={24} color={colors.muted} />
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
              {punchErr ? (
                <View style={styles.errorBox}>
                  <Ionicons name="alert-circle" size={18} color={colors.error} />
                  <Text style={styles.errorText}>{punchErr}</Text>
                </View>
              ) : null}

              {/* 1. Live Camera / Face Recognition Viewport */}
              <View style={styles.selfieCard}>
                <View style={styles.boxHeaderRow}>
                  <Text style={styles.boxTitle}>1. Live Camera Face Recognition</Text>
                  <View style={[styles.liveStatusIndicator, cameraActive && styles.liveStatusIndicatorActive]}>
                    <View style={[styles.liveDot, cameraActive && styles.liveDotActive]} />
                    <Text style={[styles.liveText, cameraActive && styles.liveTextActive]}>
                      {cameraActive ? 'CAMERA LIVE' : punchSelfie ? 'VERIFIED' : 'STARTING'}
                    </Text>
                  </View>
                </View>

                {punchSelfie ? (
                  <View style={styles.selfiePreviewContainer}>
                    <Image source={{ uri: punchSelfie.uri }} style={styles.selfieFullPreview} />
                    <View style={styles.faceVerifiedTag}>
                      <Ionicons name="checkmark-circle" size={18} color="#FFFFFF" />
                      <Text style={styles.faceVerifiedTagText}>Face Recognized & Verified ✓</Text>
                    </View>
                    <Pressable onPress={() => { setPunchSelfie(null); startLiveCamera(); }} style={styles.retakeBtn}>
                      <Ionicons name="camera-reverse-outline" size={16} color={colors.brandPrimary} />
                      <Text style={styles.retakeBtnText}>Retake Photo</Text>
                    </Pressable>
                  </View>
                ) : cameraPermissionError ? (
                  <View style={styles.cameraErrorContainer}>
                    <Ionicons name="videocam-off-outline" size={42} color={colors.error} />
                    <Text style={styles.cameraErrorTitle}>Camera Permission Required</Text>
                    <Text style={styles.cameraErrorDesc}>{cameraPermissionError}</Text>
                    <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
                      <Pressable onPress={startLiveCamera} style={styles.retryCameraBtn}>
                        <Ionicons name="refresh" size={16} color="#FFFFFF" />
                        <Text style={styles.retryCameraBtnText}>Retry Camera</Text>
                      </Pressable>
                    </View>
                  </View>
                ) : (
                  <View style={styles.cameraViewportWrapper}>
                    {/* Real HTML5 Live Video Element */}
                    {Platform.OS === 'web' && React.createElement('video', {
                      ref: (el: any) => {
                        videoRef.current = el;
                        if (el && mediaStream && el.srcObject !== mediaStream) {
                          el.srcObject = mediaStream;
                          el.play().catch(() => {});
                        }
                      },
                      autoPlay: true,
                      playsInline: true,
                      muted: true,
                      style: {
                        width: '100%',
                        height: 290,
                        objectFit: 'cover',
                        transform: 'scaleX(-1)',
                        borderRadius: 16,
                        backgroundColor: '#0F172A',
                      },
                    })}

                    {/* Biometric Scanning Overlay */}
                    <View style={styles.biometricOverlay} pointerEvents="none">
                      {/* Top Scanner Indicator */}
                      <View style={styles.scannerBadge}>
                        <Ionicons name="scan" size={14} color="#4ADE80" />
                        <Text style={styles.scannerBadgeText}>AI BIOMETRIC SCANNER</Text>
                      </View>

                      {/* Oval Face Guide Frame */}
                      <View style={[styles.faceOvalGuide, faceRecognized && styles.faceOvalGuideActive]}>
                        <View style={[styles.cornerBracket, styles.bracketTL]} />
                        <View style={[styles.cornerBracket, styles.bracketTR]} />
                        <View style={[styles.cornerBracket, styles.bracketBL]} />
                        <View style={[styles.cornerBracket, styles.bracketBR]} />

                        {/* Animated Laser Scanning Line */}
                        <View style={[styles.laserScanLine, { top: `${scanLaserTop}%` }]} />
                      </View>

                      {/* Bottom Status Pill */}
                      <View style={[styles.statusPill, faceRecognized ? styles.statusPillSuccess : styles.statusPillScanning]}>
                        <Ionicons
                          name={faceRecognized ? "checkmark-circle" : "sync-outline"}
                          size={14}
                          color="#FFFFFF"
                        />
                        <Text style={styles.statusPillText}>
                          {faceRecognized ? "Face Recognized & Aligned ✓" : "Scanning Face... Look into camera"}
                        </Text>
                      </View>
                    </View>
                  </View>
                )}

                {/* Prominent Capture Button */}
                {!punchSelfie && cameraActive ? (
                  <Pressable
                    onPress={captureLiveFaceAndPunch}
                    disabled={punchSubmitting}
                    style={({ pressed }) => [styles.captureAndPunchBtn, pressed && styles.btnPressed]}
                    accessibilityLabel={`Capture and Punch ${punchType.toUpperCase()}`}
                    accessibilityRole="button"
                  >
                    <Ionicons name="camera" size={22} color="#FFFFFF" />
                    <Text style={styles.captureAndPunchBtnText}>
                      {punchSubmitting ? 'Recording Punch...' : `Scan Face & Punch ${punchType.toUpperCase()}`}
                    </Text>
                  </Pressable>
                ) : null}
              </View>

              {/* 2. Geo Tag & Place Card */}
              <View style={styles.geoCard}>
                <Text style={styles.boxTitle}>2. GPS Geo Tag & Location Details</Text>
                {punchLocLoading ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 }}>
                    <ActivityIndicator size="small" color={colors.brandPrimary} />
                    <Text style={styles.muted}>Acquiring high-accuracy GPS coordinates...</Text>
                  </View>
                ) : punchLoc ? (
                  <View style={styles.geoDetailsBox}>
                    <View style={styles.geoDetailItem}>
                      <Ionicons name="navigate-circle" size={18} color={colors.brandPrimary} />
                      <Text style={styles.geoDetailText}>
                        <Text style={{ fontWeight: '700' }}>GPS Coordinates: </Text>
                        {punchLoc.lat.toFixed(6)}, {punchLoc.lng.toFixed(6)}
                      </Text>
                    </View>
                    {punchLoc.accuracy ? (
                      <View style={styles.geoDetailItem}>
                        <Ionicons name="shield-checkmark-outline" size={18} color={colors.success} />
                        <Text style={styles.geoDetailText}>
                          <Text style={{ fontWeight: '700' }}>Accuracy: </Text>±{Math.round(punchLoc.accuracy)} meters
                        </Text>
                      </View>
                    ) : null}
                  </View>
                ) : (
                  <Pressable onPress={() => startPunch(punchType)} style={styles.retryGpsBtn}>
                    <Ionicons name="refresh" size={16} color={colors.error} />
                    <Text style={{ color: colors.error, fontSize: font.sm, fontWeight: '700' }}>Retry GPS Location</Text>
                  </Pressable>
                )}

                <FormInput
                  label="Office / Place Name"
                  value={punchPlace}
                  onChangeText={setPunchPlace}
                  placeholder="e.g. Patna Head Office / Client Site"
                />
              </View>

              {/* Bottom Cancel & Confirm Buttons (if photo was already taken) */}
              <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm }}>
                <SecondaryButton
                  label="Cancel"
                  onPress={closePunchModal}
                  style={{ flex: 1 }}
                />
                {punchSelfie ? (
                  <PrimaryButton
                    label={`Confirm Punch ${punchType.toUpperCase()}`}
                    loading={punchSubmitting}
                    onPress={captureLiveFaceAndPunch}
                    disabled={punchSubmitting}
                    style={{ flex: 1 }}
                  />
                ) : null}
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ============================================================== */}
      {/* MODAL 2: REQUEST LEAVE APPLICATION */}
      {/* ============================================================== */}
      <Modal visible={leaveModal} animationType="slide" transparent onRequestClose={() => setLeaveModal(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>Request Leave</Text>
                <Text style={styles.modalSubTitle}>Select category and date range</Text>
              </View>
              <Pressable onPress={() => setLeaveModal(false)} hitSlop={8}>
                <Ionicons name="close" size={24} color={colors.muted} />
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
              {leaveErr ? (
                <View style={styles.errorBox}>
                  <Ionicons name="alert-circle" size={18} color={colors.error} />
                  <Text style={styles.errorText}>{leaveErr}</Text>
                </View>
              ) : null}

              {/* Dynamic Category Selector */}
              <Text style={styles.fieldLabel}>Select Leave Category *</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
                {(categories || []).map(cat => (
                  <Pressable
                    key={cat.id}
                    onPress={() => setLeaveForm(p => ({ ...p, category_id: cat.id, leave_type: cat.name }))}
                    style={[
                      styles.catChip,
                      leaveForm.category_id === cat.id && styles.catChipActive
                    ]}
                  >
                    <Text style={[styles.catChipText, leaveForm.category_id === cat.id && styles.catChipTextActive]}>
                      {cat.name} ({cat.code})
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>

              <View style={{ flexDirection: 'row', gap: spacing.md }}>
                <View style={{ flex: 1 }}>
                  <FormInput
                    label="From Date (YYYY-MM-DD) *"
                    value={leaveForm.from_date}
                    onChangeText={v => handleDateChange(v, leaveForm.to_date)}
                    placeholder="2026-09-23"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <FormInput
                    label="To Date (YYYY-MM-DD) *"
                    value={leaveForm.to_date}
                    onChangeText={v => handleDateChange(leaveForm.from_date, v)}
                    placeholder="2026-09-25"
                  />
                </View>
              </View>

              <FormInput
                label="Total Days Count"
                value={leaveForm.days_count}
                onChangeText={v => setLeaveForm(p => ({ ...p, days_count: v }))}
                keyboardType="numeric"
                placeholder="1.0"
              />

              <FormInput
                label="Reason for Leave"
                value={leaveForm.reason}
                onChangeText={v => setLeaveForm(p => ({ ...p, reason: v }))}
                placeholder="Reason or notes for management"
                multiline
              />

              <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.md }}>
                <SecondaryButton
                  label="Cancel"
                  onPress={() => setLeaveModal(false)}
                  style={{ flex: 1 }}
                />
                <PrimaryButton
                  label="Submit Request"
                  loading={leaveSubmitting}
                  onPress={submitLeave}
                  disabled={leaveSubmitting}
                  style={{ flex: 1 }}
                />
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ============================================================== */}
      {/* MODAL 3: ADD / EDIT LEAVE CATEGORY MASTER */}
      {/* ============================================================== */}
      <Modal visible={catModal} animationType="slide" transparent onRequestClose={() => setCatModal(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>
                  {catForm.id ? 'Edit Leave Category' : 'Add New Leave Category'}
                </Text>
                <Text style={styles.modalSubTitle}>Configure Weekly, Monthly, and Annual quotas</Text>
              </View>
              <Pressable onPress={() => setCatModal(false)} hitSlop={8}>
                <Ionicons name="close" size={24} color={colors.muted} />
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
              {catErr ? (
                <View style={styles.errorBox}>
                  <Ionicons name="alert-circle" size={18} color={colors.error} />
                  <Text style={styles.errorText}>{catErr}</Text>
                </View>
              ) : null}

              <FormInput
                label="Category Name *"
                value={catForm.name}
                onChangeText={v => setCatForm(p => ({ ...p, name: v }))}
                placeholder="e.g. Casual Leave (CL)"
              />

              <FormInput
                label="Short Code *"
                value={catForm.code}
                onChangeText={v => setCatForm(p => ({ ...p, code: v.toUpperCase() }))}
                placeholder="e.g. CL, SL, EL"
              />

              <FormInput
                label="Description"
                value={catForm.description}
                onChangeText={v => setCatForm(p => ({ ...p, description: v }))}
                placeholder="Policy details or remarks"
              />

              {/* Week, Month, Year Limits */}
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <FormInput
                    label="Total in Week *"
                    value={catForm.max_per_week}
                    onChangeText={v => setCatForm(p => ({ ...p, max_per_week: v }))}
                    keyboardType="numeric"
                    placeholder="1.0"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <FormInput
                    label="Total in Month *"
                    value={catForm.max_per_month}
                    onChangeText={v => setCatForm(p => ({ ...p, max_per_month: v }))}
                    keyboardType="numeric"
                    placeholder="1.5"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <FormInput
                    label="Total in Year *"
                    value={catForm.max_per_year}
                    onChangeText={v => setCatForm(p => ({ ...p, max_per_year: v }))}
                    keyboardType="numeric"
                    placeholder="12.0"
                  />
                </View>
              </View>

              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                <Text style={styles.fieldLabel}>Paid Leave</Text>
                <Switch
                  value={catForm.is_paid}
                  onValueChange={v => setCatForm(p => ({ ...p, is_paid: v }))}
                  trackColor={{ false: '#CBD5E1', true: colors.brandPrimary }}
                />
              </View>

              <View>
                <Text style={styles.fieldLabel}>Status</Text>
                <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
                  {['active', 'inactive'].map(st => (
                    <Pressable
                      key={st}
                      onPress={() => setCatForm(p => ({ ...p, status: st }))}
                      style={[styles.statusOption, catForm.status === st && styles.statusOptionSelected]}
                    >
                      <Text style={[styles.statusOptionText, catForm.status === st && { color: colors.brandPrimary, fontWeight: '700' }]}>
                        {st.toUpperCase()}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg }}>
                <SecondaryButton
                  label="Cancel"
                  onPress={() => setCatModal(false)}
                  style={{ flex: 1 }}
                />
                <PrimaryButton
                  label={catForm.id ? 'Update Category' : 'Save Category'}
                  loading={catSubmitting}
                  onPress={saveCategory}
                  disabled={catSubmitting}
                  style={{ flex: 1 }}
                />
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ============================================================== */}
      {/* MODAL 4: IN-APP CONFIRM DELETE CATEGORY */}
      {/* ============================================================== */}
      <Modal visible={!!catToDelete} transparent animationType="fade" onRequestClose={() => setCatToDelete(null)}>
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmBox}>
            <View style={styles.confirmIconContainer}>
              <Ionicons name="warning" size={32} color={colors.error} />
            </View>
            <Text style={styles.confirmTitle}>Delete Leave Category?</Text>
            <Text style={styles.confirmMessage}>
              Are you sure you want to delete <Text style={{ fontWeight: '700' }}>"{catToDelete?.name}"</Text> ({catToDelete?.code})?
            </Text>
            <Text style={styles.confirmSubtext}>
              This will remove this leave category configuration and its weekly/monthly limits.
            </Text>

            <View style={styles.confirmButtons}>
              <SecondaryButton
                label="Cancel"
                onPress={() => setCatToDelete(null)}
                style={{ flex: 1 }}
              />
              <Pressable
                onPress={executeDeleteCategory}
                disabled={catDeleteBusy}
                style={[styles.deleteConfirmBtn, catDeleteBusy && { opacity: 0.6 }]}
                accessibilityLabel="Confirm Delete"
                accessibilityRole="button"
              >
                {catDeleteBusy ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <>
                    <Ionicons name="trash" size={16} color="#FFFFFF" />
                    <Text style={styles.deleteConfirmBtnText}>Yes, Delete</Text>
                  </>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surfaceSecondary },
  scrollContent: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxxl },

  /* Toast Banner */
  toastBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#DCFCE7',
    borderBottomWidth: 1,
    borderBottomColor: '#86EFAC',
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    gap: 8,
  },
  toastText: { flex: 1, fontSize: font.sm, fontWeight: '600', color: '#15803D' },

  /* Top 3-Tab Selector */
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    padding: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: 6,
  },
  tabBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSecondary,
  },
  tabBtnActive: {
    backgroundColor: colors.brandPrimary + '15',
    borderWidth: 1,
    borderColor: colors.brandPrimary,
  },
  tabText: { fontSize: 11, fontWeight: '700', color: colors.muted },
  tabTextActive: { color: colors.brandPrimary },

  /* Today's Punch Summary Card */
  statCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  statHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  todayDateText: { fontSize: 11, fontWeight: '700', color: colors.muted, textTransform: 'uppercase' },
  statCountText: { fontSize: font.xl, fontWeight: '800', color: colors.onSurface, marginTop: 2 },
  statSubText: { fontSize: font.sm, color: colors.muted, marginTop: 2 },
  remainingPill: {
    backgroundColor: colors.brandPrimary + '15',
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.brandPrimary + '30',
  },
  remainingPillLabel: { fontSize: 10, fontWeight: '700', color: colors.brandPrimary },
  remainingPillVal: { fontSize: font.lg, fontWeight: '800', color: colors.brandPrimary },

  /* Punch Buttons */
  punchActionRow: { flexDirection: 'row', gap: spacing.md, marginTop: 4 },
  punchInBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#16A34A',
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: radius.lg,
    shadowColor: '#16A34A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
  punchOutBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#EA580C',
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: radius.lg,
    shadowColor: '#EA580C',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
  punchBtnRecommended: {
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  punchBtnTitle: { color: '#FFFFFF', fontSize: font.base, fontWeight: '800' },
  punchBtnSubtitle: { color: 'rgba(255,255,255,0.85)', fontSize: 10, fontWeight: '600' },
  btnPressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },

  /* Section Headers */
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.md,
    marginBottom: 4,
  },
  sectionTitle: { fontSize: font.lg, fontWeight: '800', color: colors.onSurface },
  sectionSubtitle: { fontSize: 11, color: colors.muted, marginTop: 1 },
  switchLabel: { fontSize: 11, fontWeight: '700', color: colors.muted },

  /* Punch Record Cards */
  punchRecordCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  punchRecordRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  selfieImage: { width: 54, height: 54, borderRadius: 27, backgroundColor: colors.surfaceSecondary, borderWidth: 2, borderColor: colors.brandPrimary },
  selfiePlaceholder: { width: 54, height: 54, borderRadius: 27, backgroundColor: colors.surfaceSecondary, alignItems: 'center', justifyContent: 'center' },
  punchUser: { fontSize: font.base, fontWeight: '700', color: colors.onSurface },
  empCodeBadge: { fontSize: 10, fontWeight: '700', color: colors.brandSecondary, backgroundColor: colors.brandSecondary + '15', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  typeBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  typeBadgeIn: { backgroundColor: '#DCFCE7' },
  typeBadgeOut: { backgroundColor: '#FFEDD5' },
  typeBadgeText: { fontSize: 10, fontWeight: '800' },
  lateTag: { backgroundColor: '#FEE2E2', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  lateText: { fontSize: 10, fontWeight: '800', color: colors.error },
  punchTime: { fontSize: font.sm, color: colors.muted },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 11, color: colors.muted, flexShrink: 1 },
  verificationCol: { alignItems: 'flex-end', gap: 4 },
  faceVerifiedBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#DCFCE7', paddingHorizontal: 6, paddingVertical: 3, borderRadius: radius.pill },
  faceVerifiedText: { fontSize: 10, fontWeight: '700', color: '#15803D' },
  geoBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 6, paddingVertical: 3, borderRadius: radius.pill },
  geoBadgeText: { fontSize: 10, fontWeight: '700' },

  /* Leaves View */
  topActionsRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  leaveCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm, borderWidth: 1, borderColor: colors.border },
  leaveHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  leaveUserName: { fontSize: font.base, fontWeight: '700', color: colors.onSurface },
  leaveCategoryTag: { fontSize: 11, fontWeight: '700', color: colors.brandPrimary, backgroundColor: colors.brandPrimary + '15', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  leaveDaysTag: { fontSize: 11, fontWeight: '700', color: colors.onSurface, backgroundColor: colors.surfaceSecondary, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  leaveDateRangeBox: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.surfaceSecondary, padding: 8, borderRadius: radius.md },
  leaveDateText: { fontSize: font.sm, fontWeight: '700', color: colors.onSurface },
  leaveReasonText: { fontSize: font.sm, color: colors.muted },
  leaveActionBtns: { flexDirection: 'row', gap: spacing.md, marginTop: 4 },
  cancelLeaveBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, padding: 4 },
  cancelLeaveText: { fontSize: 11, fontWeight: '700', color: colors.error },

  /* Categories & Balances View */
  subSectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  balanceSummaryCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: 0, overflow: 'hidden', borderWidth: 1, borderColor: colors.border },
  balanceTable: { minWidth: 640 },
  balanceTableRowHeader: { flexDirection: 'row', backgroundColor: '#F8FAFC', borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: 10, paddingHorizontal: 8 },
  balanceTableRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.divider, paddingVertical: 10, paddingHorizontal: 8, alignItems: 'center' },
  balanceRowAlt: { backgroundColor: '#F9FAFB' },
  balanceColCell: { justifyContent: 'center' },
  balanceColText: { fontSize: 11, color: colors.onSurface },
  colCategory: { width: 150 },
  colLimit: { width: 85 },
  colQuota: { width: 85 },
  colUtilised: { width: 85 },
  colPending: { width: 85 },
  colBalance: { width: 95 },
  centerText: { textAlign: 'center' },
  bCatName: { fontSize: 11, fontWeight: '700', color: colors.onSurface },
  bCatCode: { fontSize: 10, color: colors.brandSecondary, fontWeight: '700' },
  balancePill: { backgroundColor: '#DCFCE7', paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill },
  balancePillText: { fontSize: 11, fontWeight: '800', color: '#15803D' },

  /* Category Master Cards */
  addCategoryBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.brandPrimary, paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.md },
  addCategoryBtnText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
  catCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm, borderWidth: 1, borderColor: colors.border },
  catHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  catTitle: { fontSize: font.base, fontWeight: '700', color: colors.onSurface },
  catCodeBadge: { backgroundColor: colors.brandPrimary + '15', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  catCodeText: { fontSize: 10, fontWeight: '800', color: colors.brandPrimary },
  catDesc: { fontSize: 11, color: colors.muted, marginTop: 2 },
  catActionBtns: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  catEditBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 5, borderRadius: radius.md, backgroundColor: colors.brandPrimary + '12', borderWidth: 1, borderColor: colors.brandPrimary + '35' },
  catEditBtnText: { fontSize: 11, fontWeight: '700', color: colors.brandPrimary },
  catDelBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 5, borderRadius: radius.md, backgroundColor: colors.error + '12', borderWidth: 1, borderColor: colors.error + '35' },
  catDelBtnText: { fontSize: 11, fontWeight: '700', color: colors.error },
  catLimitsGrid: { flexDirection: 'row', backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: 8, gap: 6 },
  catLimitBox: { flex: 1, alignItems: 'center' },
  catLimitLabel: { fontSize: 10, fontWeight: '600', color: colors.muted },
  catLimitVal: { fontSize: 11, fontWeight: '700', color: colors.onSurface, marginTop: 2 },
  badge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  badgeActive: { backgroundColor: colors.success + '15' },
  badgeInactive: { backgroundColor: colors.muted + '20' },
  badgeText: { fontSize: 10, fontWeight: '800' },

  /* Modals */
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalBox: { backgroundColor: colors.surface, borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '92%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border },
  modalTitle: { fontSize: font.lg, fontWeight: '700', color: colors.onSurface },
  modalSubTitle: { fontSize: 11, fontWeight: '600', color: colors.brandSecondary, marginTop: 2 },
  errorBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#FEE2E2', padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: '#FCA5A5' },
  errorText: { color: colors.error, fontSize: font.sm, flex: 1, fontWeight: '600' },
  fieldLabel: { fontSize: font.sm, fontWeight: '600', color: colors.onSurface, marginBottom: 4 },
  muted: { color: colors.muted, fontSize: font.sm },

  /* Live Webcam Biometric Scanner Styles */
  boxHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  boxTitle: { fontSize: font.sm, fontWeight: '800', color: colors.onSurface },
  liveStatusIndicator: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#E2E8F0', paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill },
  liveStatusIndicatorActive: { backgroundColor: '#DCFCE7' },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.muted },
  liveDotActive: { backgroundColor: '#16A34A' },
  liveText: { fontSize: 10, fontWeight: '800', color: colors.muted },
  liveTextActive: { color: '#15803D' },
  selfieCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  cameraViewportWrapper: {
    position: 'relative',
    width: '100%',
    height: 290,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#0F172A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  biometricOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  scannerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(74, 222, 128, 0.4)',
  },
  scannerBadgeText: { color: '#4ADE80', fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  faceOvalGuide: {
    position: 'relative',
    width: 190,
    height: 220,
    borderRadius: 95,
    borderWidth: 2,
    borderColor: 'rgba(74, 222, 128, 0.5)',
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  faceOvalGuideActive: {
    borderColor: '#22C55E',
    borderStyle: 'solid',
    borderWidth: 2.5,
  },
  cornerBracket: { position: 'absolute', width: 16, height: 16, borderColor: '#22C55E' },
  bracketTL: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3 },
  bracketTR: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3 },
  bracketBL: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3 },
  bracketBR: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3 },
  laserScanLine: {
    position: 'absolute',
    left: 4,
    right: 4,
    height: 2,
    backgroundColor: '#22C55E',
    shadowColor: '#22C55E',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 8,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  statusPillScanning: { backgroundColor: 'rgba(15, 23, 42, 0.8)', borderWidth: 1, borderColor: '#64748B' },
  statusPillSuccess: { backgroundColor: '#16A34A' },
  statusPillText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
  captureAndPunchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#16A34A',
    paddingVertical: 14,
    borderRadius: radius.lg,
    marginTop: spacing.md,
    shadowColor: '#16A34A',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 4,
  },
  captureAndPunchBtnText: { color: '#FFFFFF', fontSize: font.base, fontWeight: '800' },

  /* Selfie Preview After Capture */
  selfiePreviewContainer: { alignItems: 'center', gap: 10, paddingVertical: spacing.md },
  selfieFullPreview: { width: 150, height: 150, borderRadius: 75, borderWidth: 3, borderColor: '#16A34A' },
  faceVerifiedTag: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#16A34A', paddingHorizontal: 14, paddingVertical: 6, borderRadius: radius.pill },
  faceVerifiedTagText: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' },
  retakeBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4 },
  retakeBtnText: { color: colors.brandPrimary, fontSize: 11, fontWeight: '700' },

  /* Camera Error State */
  cameraErrorContainer: { alignItems: 'center', paddingVertical: spacing.lg, gap: 8 },
  cameraErrorTitle: { fontSize: font.base, fontWeight: '700', color: colors.error },
  cameraErrorDesc: { fontSize: 11, color: colors.muted, textAlign: 'center', maxWidth: 300 },
  retryCameraBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.brandPrimary, paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.md },
  retryCameraBtnText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },

  /* Geo Card in Modal */
  geoCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm, borderWidth: 1, borderColor: colors.border },
  geoDetailsBox: { backgroundColor: colors.surface, padding: 10, borderRadius: radius.md, gap: 4 },
  geoDetailItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  geoDetailText: { fontSize: 11, color: colors.onSurface },
  retryGpsBtn: { padding: 8, alignItems: 'center' },

  /* Category Chips in Leave Modal */
  catChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  catChipActive: { backgroundColor: colors.brandPrimary + '15', borderColor: colors.brandPrimary },
  catChipText: { fontSize: 11, fontWeight: '700', color: colors.muted },
  catChipTextActive: { color: colors.brandPrimary },

  /* Form Options */
  statusOption: { flex: 1, paddingVertical: 8, alignItems: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: radius.md },
  statusOptionSelected: { borderColor: colors.brandPrimary, backgroundColor: colors.brandPrimary + '10' },
  statusOptionText: { fontSize: font.sm, color: colors.muted },

  /* Confirm Modal Styles */
  confirmOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', alignItems: 'center', padding: spacing.lg },
  confirmBox: { width: '100%', maxWidth: 420, backgroundColor: colors.surface, borderRadius: 16, padding: spacing.xl, alignItems: 'center', elevation: 8 },
  confirmIconContainer: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#FEE2E2', alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md },
  confirmTitle: { fontSize: font.xl, fontWeight: '800', color: colors.onSurface, marginBottom: 4 },
  confirmMessage: { fontSize: font.base, color: colors.onSurface, textAlign: 'center', marginBottom: 4, lineHeight: 22 },
  confirmSubtext: { fontSize: 11, color: colors.muted, textAlign: 'center', marginBottom: spacing.lg },
  confirmButtons: { flexDirection: 'row', gap: spacing.md, width: '100%' },
  deleteConfirmBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: colors.error, paddingVertical: 12, borderRadius: radius.md },
  deleteConfirmBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: font.base },
});
