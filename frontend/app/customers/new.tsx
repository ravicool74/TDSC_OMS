import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Text,
  Pressable,
  Modal,
  TextInput,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, font } from '@/src/theme';
import { ScreenHeader } from '@/src/ScreenHeader';
import { FormInput } from '@/src/forms';
import { PrimaryButton } from '@/src/ui';
import { api } from '@/src/api';
import { useAuth } from '@/src/AuthContext';
import { formatDscDateTime, nowDscDateTime, addYearsDscDateTime } from '@/src/dateUtils';

type F = Record<string, string>;
const initial: F = {
  name: '', address: '', mobile: '', whatsapp: '', alternate_mobile: '', email: '', pan: '', aadhar: '',
  branch_id: '', branch_name: '', district: '', departments: '',
  eproc2_user_id: '', eproc2_password: '', eproc2_email: '',
  railway_user_id: '', railway_password: '', railway_email: '',
  cpp_user_id: '', cpp_password: '', cpp_email: '',
  gst_no: '', gst_password: '', gst_email: '',
  epfo_user_id: '', epfo_password: '', epfo_email: '',
  other_portal_user_id: '', other_portal_password: '', other_portal_email: '',
  dsc_serial_no: '', dsc_issued_date: '', dsc_expired_date: '',
  encryption_serial_no: '', encryption_issued_date: '', encryption_expired_date: '',
  iso_user_id: '', iso_password: '', iso_other_details: '',
  gem_user_id: '', gem_password: '', gem_seller_id: '', gem_email: '',
  pmgsy_user_id: '', pmgsy_password: '', pmgsy_email: '',
  contractor_reg_no: '', registration_class: '', registration_validity: '',
  notes: '',
};

const DEPARTMENTS = ['RWD', 'RCD', 'WRD', 'BCD', 'PHED', 'CPWD', 'Railway', 'NHAI', 'PMGSY', 'Other'];
const REG_CLASSES = ['Class-I', 'Class-II', 'Class-III', 'Class-IV', 'Class A', 'Class B'];
const FIELD_TYPES = [
  { id: 'text', label: 'Text' },
  { id: 'number', label: 'Number' },
  { id: 'date', label: 'Date (YYYY-MM-DD)' },
  { id: 'textarea', label: 'Multiline / Long Text' },
  { id: 'select', label: 'Dropdown / Choice' },
];

interface SectionProps { title: string; icon: any; children: React.ReactNode; defaultOpen?: boolean; testID?: string; }
const Section: React.FC<SectionProps> = ({ title, icon, children, defaultOpen, testID }) => {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <View style={styles.section}>
      <Pressable onPress={() => setOpen(o => !o)} style={styles.sectionHeader} testID={testID}>
        <View style={styles.sectionIcon}><Ionicons name={icon} size={16} color={colors.brandPrimary} /></View>
        <Text style={styles.sectionTitle}>{title}</Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.muted} />
      </Pressable>
      {open ? <View style={{ padding: spacing.md, gap: spacing.md, borderTopWidth: 1, borderTopColor: colors.divider }}>{children}</View> : null}
    </View>
  );
};

export default function NewCustomer() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ edit_id?: string }>();
  const editId = params?.edit_id || null;
  const isEdit = !!editId;
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [f, setF] = useState<F>(initial);
  const set = (k: string) => (v: string) => setF(p => ({ ...p, [k]: v }));

  // Custom Fields state
  const [customFields, setCustomFields] = useState<any[]>([]);
  const [customValues, setCustomValues] = useState<Record<string, any>>({});
  
  // Admin Add Field Modal state
  const [showAddFieldModal, setShowAddFieldModal] = useState(false);
  const [newFieldLabel, setNewFieldLabel] = useState('');
  const [newFieldType, setNewFieldType] = useState('text');
  const [newFieldOptions, setNewFieldOptions] = useState('');
  const [newFieldPlaceholder, setNewFieldPlaceholder] = useState('');
  const [newFieldRequired, setNewFieldRequired] = useState(false);
  const [addingField, setAddingField] = useState(false);
  const [fieldModalErr, setFieldModalErr] = useState<string | null>(null);

  // TDSC Branch & District selection states
  const [branchesList, setBranchesList] = useState<any[]>([]);
  const [districtsList, setDistrictsList] = useState<any[]>([]);
  const [showBranchModal, setShowBranchModal] = useState(false);
  const [showDistrictModal, setShowDistrictModal] = useState(false);
  const [branchSearch, setBranchSearch] = useState('');
  const [districtSearch, setDistrictSearch] = useState('');

  const loadCustomFields = useCallback(async () => {
    try {
      const list: any = await api.get('/customers/custom-fields');
      setCustomFields(Array.isArray(list) ? list : []);
    } catch {
      // Graceful fallback
    }
  }, []);

  useEffect(() => {
    loadCustomFields();
  }, [loadCustomFields]);

  useEffect(() => {
    (async () => {
      try {
        const b: any = await api.getBranches();
        setBranchesList(Array.isArray(b) ? b : []);
      } catch {}
      try {
        const d: any = await api.getDistricts();
        setDistrictsList(Array.isArray(d) ? d : []);
      } catch {}
    })();
  }, []);

  useEffect(() => {
    if (!editId) return;
    (async () => {
      try {
        const c: any = await api.get(`/customers/${editId}`);
        const next: F = { ...initial };
        Object.keys(initial).forEach(k => { if (c[k] != null) next[k] = String(c[k]); });
        if (c.dsc_issued_date) next.dsc_issued_date = formatDscDateTime(c.dsc_issued_date, c.dsc_issued_date);
        if (c.dsc_expired_date) next.dsc_expired_date = formatDscDateTime(c.dsc_expired_date, c.dsc_expired_date);
        if (c.encryption_issued_date) next.encryption_issued_date = formatDscDateTime(c.encryption_issued_date, c.encryption_issued_date);
        if (c.encryption_expired_date) next.encryption_expired_date = formatDscDateTime(c.encryption_expired_date, c.encryption_expired_date);
        setF(next);
        if (c.custom_fields && typeof c.custom_fields === 'object') {
          setCustomValues(c.custom_fields);
        }
      } catch (e: any) { setErr(e?.message || 'Load failed'); }
    })();
  }, [editId]);

  const toggleDept = (dept: string) => {
    const cur = (f.departments || '').split(',').map(s => s.trim()).filter(Boolean);
    const has = cur.includes(dept);
    const next = has ? cur.filter(d => d !== dept) : [...cur, dept];
    set('departments')(next.join(', '));
  };

  const handleCreateCustomField = async () => {
    if (!newFieldLabel.trim()) {
      setFieldModalErr('Field label is required');
      return;
    }
    setAddingField(true);
    setFieldModalErr(null);
    try {
      const opts = newFieldOptions
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);

      await api.post('/customers/custom-fields', {
        label: newFieldLabel.trim(),
        field_type: newFieldType,
        options: opts,
        placeholder: newFieldPlaceholder.trim() || undefined,
        required: newFieldRequired,
      });

      setShowAddFieldModal(false);
      setNewFieldLabel('');
      setNewFieldType('text');
      setNewFieldOptions('');
      setNewFieldPlaceholder('');
      setNewFieldRequired(false);
      await loadCustomFields();
    } catch (e: any) {
      setFieldModalErr(e?.message || 'Failed to create custom field');
    } finally {
      setAddingField(false);
    }
  };

  const handleDeleteCustomField = (fieldId: string, label: string) => {
    Alert.alert(
      'Delete Field Definition',
      `Are you sure you want to remove the field "${label}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.del(`/customers/custom-fields/${fieldId}`);
              await loadCustomFields();
            } catch (e: any) {
              Alert.alert('Error', e?.message || 'Delete failed');
            }
          }
        }
      ]
    );
  };

  const save = async () => {
    const missing: string[] = [];
    if (!f.name.trim()) missing.push('Contractor Name');
    if (!f.mobile.trim()) missing.push('Mobile No.');
    if (!f.whatsapp.trim()) missing.push('WhatsApp No.');
    if (!f.pan.trim()) missing.push('PAN No.');
    if (!f.aadhar.trim()) missing.push('Aadhar No.');
    if (!f.branch_name.trim()) missing.push('TDSC Branch');
    if (!f.district.trim()) missing.push('District');

    // Check required custom fields
    for (const cf of customFields) {
      if (cf.required) {
        const val = customValues[cf.field_key];
        if (val === undefined || val === null || !String(val).trim()) {
          missing.push(cf.label);
        }
      }
    }

    if (missing.length) { setErr('Required: ' + missing.join(', ')); return; }
    setErr(null); setOk(null); setBusy(true);
    try {
      const body = {
        ...f,
        name: f.name.trim(), mobile: f.mobile.trim(), whatsapp: f.whatsapp.trim(),
        pan: f.pan.trim().toUpperCase(), aadhar: f.aadhar.trim(),
        branch_id: f.branch_id || undefined,
        branch_name: f.branch_name.trim(),
        district: f.district.trim(),
        dsc_issued_date: f.dsc_issued_date ? formatDscDateTime(f.dsc_issued_date, f.dsc_issued_date) : '',
        dsc_expired_date: f.dsc_expired_date ? formatDscDateTime(f.dsc_expired_date, f.dsc_expired_date) : '',
        encryption_issued_date: f.encryption_issued_date ? formatDscDateTime(f.encryption_issued_date, f.encryption_issued_date) : '',
        encryption_expired_date: f.encryption_expired_date ? formatDscDateTime(f.encryption_expired_date, f.encryption_expired_date) : '',
        custom_fields: customValues,
      };
      const saved: any = isEdit ? await api.put(`/customers/${editId}`, body) : await api.post('/customers', body);
      setOk(`${isEdit ? 'Updated' : 'Saved'} ✓ Customer ID: ${saved.customer_code || saved.id}`);
      setTimeout(() => router.replace(`/customers/${saved.id}` as any), 600);
    } catch (e: any) {
      let msg = e?.message || 'Failed';
      try {
        const parsed = typeof msg === 'string' && msg.startsWith('{') ? JSON.parse(msg) : null;
        if (parsed?.message) {
          const existing = parsed.existing || {};
          msg = `${parsed.message}\n\nExisting: ${existing.customer_code || ''} • ${existing.name || ''} • ${existing.mobile || ''}`;
        }
      } catch {}
      setErr(String(msg));
    } finally { setBusy(false); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surfaceSecondary }} testID="new-customer">
      <ScreenHeader title={isEdit ? 'Edit Customer (42 Fields)' : 'Add Customer (42 Fields)'} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={[styles.body, { paddingBottom: Math.max(insets.bottom + 40, spacing.xxxl) }]} keyboardShouldPersistTaps="handled">
          <View style={styles.notice}>
            <Ionicons name="shield-checkmark" size={18} color={colors.brandPrimary} />
            <Text style={styles.noticeText}>
              All portal passwords entered here are AES-256 encrypted in TDSC Secure Vault.
            </Text>
          </View>

          {/* 1. Basic Details */}
          <Section title="Basic Details (Mandatory & Contact)" icon="person" defaultOpen testID="sec-basic">
            <FormInput label="Contractor Name *" value={f.name} onChangeText={set('name')} placeholder="Full name / Firm name" testID="in-name" />
            
            {/* TDSC Branch Dropdown Field */}
            <View style={{ gap: 4 }}>
              <Text style={styles.fieldLabel}>TDSC Branch *</Text>
              <Pressable
                onPress={() => { setBranchSearch(''); setShowBranchModal(true); }}
                style={styles.pickerSelector}
                testID="picker-tdsc-branch"
              >
                <Ionicons name="business-outline" size={18} color={colors.brandPrimary} />
                <Text style={[styles.pickerSelectorText, !f.branch_name && styles.pickerPlaceholder]}>
                  {f.branch_name ? f.branch_name : 'Select TDSC Branch *'}
                </Text>
                <Ionicons name="chevron-down" size={18} color={colors.muted} />
              </Pressable>
            </View>

            {/* District Dropdown Field */}
            <View style={{ gap: 4 }}>
              <Text style={styles.fieldLabel}>District *</Text>
              <Pressable
                onPress={() => { setDistrictSearch(''); setShowDistrictModal(true); }}
                style={styles.pickerSelector}
                testID="picker-district"
              >
                <Ionicons name="location-outline" size={18} color={colors.brandPrimary} />
                <Text style={[styles.pickerSelectorText, !f.district && styles.pickerPlaceholder]}>
                  {f.district ? f.district : 'Select District *'}
                </Text>
                <Ionicons name="chevron-down" size={18} color={colors.muted} />
              </Pressable>
            </View>

            <FormInput label="Full Address" value={f.address} onChangeText={set('address')} placeholder="Office/Residential address" multiline testID="in-address" />
            <FormInput label="Mobile No. *" value={f.mobile} onChangeText={set('mobile')} placeholder="+91 9xxxxxxxxx" keyboardType="phone-pad" testID="in-mobile" />
            <FormInput label="WhatsApp Mobile No. *" value={f.whatsapp} onChangeText={set('whatsapp')} placeholder="+91 9xxxxxxxxx" keyboardType="phone-pad" testID="in-whatsapp" />
            <FormInput label="Alternate Mobile No." value={f.alternate_mobile} onChangeText={set('alternate_mobile')} placeholder="+91 9xxxxxxxxx" keyboardType="phone-pad" testID="in-alt-mobile" />
            <FormInput label="Email ID" value={f.email} onChangeText={set('email')} placeholder="contractor@example.com" keyboardType="email-address" testID="in-email" />
            <FormInput label="PAN No. *" value={f.pan} onChangeText={set('pan')} placeholder="AAAAA0000A" testID="in-pan" />
            <FormInput label="Aadhar No. *" value={f.aadhar} onChangeText={set('aadhar')} placeholder="XXXX XXXX XXXX" keyboardType="number-pad" testID="in-aadhar" />
          </Section>

          {/* 2. Departments & Registration */}
          <Section title="Departments & Contractor Registration" icon="business" defaultOpen testID="sec-dept">
            <Text style={styles.fieldLabel}>Concerned Government Departments</Text>
            <View style={styles.chipRow}>
              {DEPARTMENTS.map(d => {
                const sel = (f.departments || '').includes(d);
                return (
                  <Pressable key={d} onPress={() => toggleDept(d)} style={[styles.chip, sel && styles.chipActive]}>
                    <Text style={[styles.chipText, sel && styles.chipTextActive]}>{d}</Text>
                  </Pressable>
                );
              })}
            </View>
            <FormInput label="Selected Departments" value={f.departments} onChangeText={set('departments')} placeholder="e.g. RWD, RCD, WRD" testID="in-departments" />

            <FormInput label="Contractor Registration No." value={f.contractor_reg_no} onChangeText={set('contractor_reg_no')} placeholder="Reg. number" testID="in-reg-no" />
            
            <Text style={styles.fieldLabel}>Registration Class</Text>
            <View style={styles.chipRow}>
              {REG_CLASSES.map(cls => {
                const sel = f.registration_class === cls;
                return (
                  <Pressable key={cls} onPress={() => set('registration_class')(cls)} style={[styles.chip, sel && styles.chipActive]}>
                    <Text style={[styles.chipText, sel && styles.chipTextActive]}>{cls}</Text>
                  </Pressable>
                );
              })}
            </View>
            <FormInput label="Registration Class (Custom/Selected)" value={f.registration_class} onChangeText={set('registration_class')} placeholder="e.g. Class-I" testID="in-reg-class" />
            <FormInput label="Validity of Registration" value={f.registration_validity} onChangeText={set('registration_validity')} placeholder="YYYY-MM-DD" testID="in-reg-validity" />
          </Section>

          {/* 3. eProc2 Portal */}
          <Section title="eProc2 Portal Credentials" icon="cloud" testID="sec-eproc2">
            <FormInput label="eProc2 User ID" value={f.eproc2_user_id} onChangeText={set('eproc2_user_id')} testID="in-eproc2-uid" />
            <FormInput label="eProc2 Password" value={f.eproc2_password} onChangeText={set('eproc2_password')} secure testID="in-eproc2-pwd" />
            <FormInput label="Concern Email" value={f.eproc2_email} onChangeText={set('eproc2_email')} keyboardType="email-address" testID="in-eproc2-email" />
          </Section>

          {/* 4. Railway Portal */}
          <Section title="Railway (IREPS) Portal" icon="train" testID="sec-railway">
            <FormInput label="Railway User ID" value={f.railway_user_id} onChangeText={set('railway_user_id')} testID="in-railway-uid" />
            <FormInput label="Railway Password" value={f.railway_password} onChangeText={set('railway_password')} secure testID="in-railway-pwd" />
            <FormInput label="Concern Email" value={f.railway_email} onChangeText={set('railway_email')} keyboardType="email-address" testID="in-railway-email" />
          </Section>

          {/* 5. CPP Portal */}
          <Section title="CPP Portal (eProcurement)" icon="link" testID="sec-cpp">
            <FormInput label="CPP User ID" value={f.cpp_user_id} onChangeText={set('cpp_user_id')} testID="in-cpp-uid" />
            <FormInput label="CPP Password" value={f.cpp_password} onChangeText={set('cpp_password')} secure testID="in-cpp-pwd" />
            <FormInput label="Concern Email" value={f.cpp_email} onChangeText={set('cpp_email')} keyboardType="email-address" testID="in-cpp-email" />
          </Section>

          {/* 6. GST Portal */}
          <Section title="GST Portal" icon="receipt" testID="sec-gst">
            <FormInput label="GST No." value={f.gst_no} onChangeText={set('gst_no')} placeholder="22AAAAA0000A1Z5" testID="in-gst-no" />
            <FormInput label="GST Password" value={f.gst_password} onChangeText={set('gst_password')} secure testID="in-gst-pwd" />
            <FormInput label="Concern Email" value={f.gst_email} onChangeText={set('gst_email')} keyboardType="email-address" testID="in-gst-email" />
          </Section>

          {/* 7. EPFO Portal */}
          <Section title="EPFO Portal" icon="briefcase" testID="sec-epfo">
            <FormInput label="EPFO User ID" value={f.epfo_user_id} onChangeText={set('epfo_user_id')} testID="in-epfo-uid" />
            <FormInput label="EPFO Password" value={f.epfo_password} onChangeText={set('epfo_password')} secure testID="in-epfo-pwd" />
            <FormInput label="Concern Email" value={f.epfo_email} onChangeText={set('epfo_email')} keyboardType="email-address" testID="in-epfo-email" />
          </Section>

          {/* 8. Digital Signature Certificate (DSC Signing) */}
          <Section title="Digital Signature (DSC Signing)" icon="ribbon" testID="sec-dsc">
            <FormInput label="DSC Serial No." value={f.dsc_serial_no} onChangeText={set('dsc_serial_no')} placeholder="e.g. 410a0975b0091d98db655f111fc0cf93" testID="in-dsc-sn" />

            <FormInput
              label="DSC Issued Date"
              value={f.dsc_issued_date}
              onChangeText={set('dsc_issued_date')}
              placeholder="e.g. Friday, 10 April, 2026 12:21:10 AM"
              testID="in-dsc-issued"
            />
            <View style={styles.dateHelperRow}>
              <Pressable
                onPress={() => set('dsc_issued_date')(nowDscDateTime())}
                style={styles.dateHelperBtn}
              >
                <Ionicons name="time-outline" size={12} color={colors.brandPrimary} />
                <Text style={styles.dateHelperBtnText}>Current Date & Time</Text>
              </Pressable>
              {f.dsc_issued_date ? (
                <Pressable
                  onPress={() => set('dsc_issued_date')(formatDscDateTime(f.dsc_issued_date, f.dsc_issued_date))}
                  style={styles.dateHelperBtn}
                >
                  <Ionicons name="sparkles-outline" size={12} color={colors.brandPrimary} />
                  <Text style={styles.dateHelperBtnText}>Format</Text>
                </Pressable>
              ) : null}
            </View>

            <FormInput
              label="DSC Expired Date"
              value={f.dsc_expired_date}
              onChangeText={set('dsc_expired_date')}
              placeholder="e.g. Monday, 10 April, 2028 12:21:10 AM"
              testID="in-dsc-exp"
            />
            <View style={styles.dateHelperRow}>
              <Pressable
                onPress={() => set('dsc_expired_date')(addYearsDscDateTime(f.dsc_issued_date, 1))}
                style={styles.dateHelperBtn}
              >
                <Ionicons name="calendar-outline" size={12} color={colors.brandPrimary} />
                <Text style={styles.dateHelperBtnText}>+1 Year</Text>
              </Pressable>
              <Pressable
                onPress={() => set('dsc_expired_date')(addYearsDscDateTime(f.dsc_issued_date, 2))}
                style={styles.dateHelperBtn}
              >
                <Ionicons name="calendar-outline" size={12} color={colors.brandPrimary} />
                <Text style={styles.dateHelperBtnText}>+2 Years (Standard)</Text>
              </Pressable>
              <Pressable
                onPress={() => set('dsc_expired_date')(addYearsDscDateTime(f.dsc_issued_date, 3))}
                style={styles.dateHelperBtn}
              >
                <Ionicons name="calendar-outline" size={12} color={colors.brandPrimary} />
                <Text style={styles.dateHelperBtnText}>+3 Years</Text>
              </Pressable>
              {f.dsc_expired_date ? (
                <Pressable
                  onPress={() => set('dsc_expired_date')(formatDscDateTime(f.dsc_expired_date, f.dsc_expired_date))}
                  style={styles.dateHelperBtn}
                >
                  <Ionicons name="sparkles-outline" size={12} color={colors.brandPrimary} />
                  <Text style={styles.dateHelperBtnText}>Format</Text>
                </Pressable>
              ) : null}
            </View>
          </Section>

          {/* 9. Digital Signature Certificate (DSC Encryption) */}
          <Section title="Digital Signature (DSC Encryption)" icon="key" testID="sec-encryption">
            <FormInput label="Encryption Serial No." value={f.encryption_serial_no} onChangeText={set('encryption_serial_no')} placeholder="e.g. 4cc7590ec82b086620c38da3f165044f" testID="in-enc-sn" />
            {f.dsc_serial_no && !f.encryption_serial_no ? (
              <View style={styles.dateHelperRow}>
                <Pressable
                  onPress={() => set('encryption_serial_no')(f.dsc_serial_no)}
                  style={styles.dateHelperBtn}
                >
                  <Ionicons name="copy-outline" size={12} color={colors.brandPrimary} />
                  <Text style={styles.dateHelperBtnText}>Copy Serial from Signing</Text>
                </Pressable>
              </View>
            ) : null}

            <FormInput
              label="Encryption Issued Date"
              value={f.encryption_issued_date}
              onChangeText={set('encryption_issued_date')}
              placeholder="e.g. Friday, 10 April, 2026 12:20:28 AM"
              testID="in-enc-issued"
            />
            <View style={styles.dateHelperRow}>
              <Pressable
                onPress={() => set('encryption_issued_date')(nowDscDateTime())}
                style={styles.dateHelperBtn}
              >
                <Ionicons name="time-outline" size={12} color={colors.brandPrimary} />
                <Text style={styles.dateHelperBtnText}>Current Date & Time</Text>
              </Pressable>
              {f.dsc_issued_date ? (
                <Pressable
                  onPress={() => set('encryption_issued_date')(f.dsc_issued_date)}
                  style={styles.dateHelperBtn}
                >
                  <Ionicons name="copy-outline" size={12} color={colors.brandPrimary} />
                  <Text style={styles.dateHelperBtnText}>Same as DSC Signing</Text>
                </Pressable>
              ) : null}
              {f.encryption_issued_date ? (
                <Pressable
                  onPress={() => set('encryption_issued_date')(formatDscDateTime(f.encryption_issued_date, f.encryption_issued_date))}
                  style={styles.dateHelperBtn}
                >
                  <Ionicons name="sparkles-outline" size={12} color={colors.brandPrimary} />
                  <Text style={styles.dateHelperBtnText}>Format</Text>
                </Pressable>
              ) : null}
            </View>

            <FormInput
              label="Encryption Expired Date"
              value={f.encryption_expired_date}
              onChangeText={set('encryption_expired_date')}
              placeholder="e.g. Monday, 10 April, 2028 12:20:28 AM"
              testID="in-enc-exp"
            />
            <View style={styles.dateHelperRow}>
              <Pressable
                onPress={() => set('encryption_expired_date')(addYearsDscDateTime(f.encryption_issued_date || f.dsc_issued_date, 1))}
                style={styles.dateHelperBtn}
              >
                <Ionicons name="calendar-outline" size={12} color={colors.brandPrimary} />
                <Text style={styles.dateHelperBtnText}>+1 Year</Text>
              </Pressable>
              <Pressable
                onPress={() => set('encryption_expired_date')(addYearsDscDateTime(f.encryption_issued_date || f.dsc_issued_date, 2))}
                style={styles.dateHelperBtn}
              >
                <Ionicons name="calendar-outline" size={12} color={colors.brandPrimary} />
                <Text style={styles.dateHelperBtnText}>+2 Years (Standard)</Text>
              </Pressable>
              <Pressable
                onPress={() => set('encryption_expired_date')(addYearsDscDateTime(f.encryption_issued_date || f.dsc_issued_date, 3))}
                style={styles.dateHelperBtn}
              >
                <Ionicons name="calendar-outline" size={12} color={colors.brandPrimary} />
                <Text style={styles.dateHelperBtnText}>+3 Years</Text>
              </Pressable>
              {f.dsc_expired_date ? (
                <Pressable
                  onPress={() => set('encryption_expired_date')(f.dsc_expired_date)}
                  style={styles.dateHelperBtn}
                >
                  <Ionicons name="copy-outline" size={12} color={colors.brandPrimary} />
                  <Text style={styles.dateHelperBtnText}>Same as DSC Expiry</Text>
                </Pressable>
              ) : null}
              {f.encryption_expired_date ? (
                <Pressable
                  onPress={() => set('encryption_expired_date')(formatDscDateTime(f.encryption_expired_date, f.encryption_expired_date))}
                  style={styles.dateHelperBtn}
                >
                  <Ionicons name="sparkles-outline" size={12} color={colors.brandPrimary} />
                  <Text style={styles.dateHelperBtnText}>Format</Text>
                </Pressable>
              ) : null}
            </View>
          </Section>

          {/* 10. GeM Portal */}
          <Section title="Government e-Marketplace (GeM)" icon="cart" testID="sec-gem">
            <FormInput label="GeM User ID" value={f.gem_user_id} onChangeText={set('gem_user_id')} testID="in-gem-uid" />
            <FormInput label="GeM Password" value={f.gem_password} onChangeText={set('gem_password')} secure testID="in-gem-pwd" />
            <FormInput label="GeM Seller ID" value={f.gem_seller_id} onChangeText={set('gem_seller_id')} testID="in-gem-seller" />
            <FormInput label="Concern Email" value={f.gem_email} onChangeText={set('gem_email')} keyboardType="email-address" testID="in-gem-email" />
          </Section>

          {/* 11. PMGSY Portal */}
          <Section title="PMGSY Site" icon="construct" testID="sec-pmgsy">
            <FormInput label="PMGSY Site User ID" value={f.pmgsy_user_id} onChangeText={set('pmgsy_user_id')} testID="in-pmgsy-uid" />
            <FormInput label="PMGSY Site Password" value={f.pmgsy_password} onChangeText={set('pmgsy_password')} secure testID="in-pmgsy-pwd" />
            <FormInput label="Concern Email" value={f.pmgsy_email} onChangeText={set('pmgsy_email')} keyboardType="email-address" testID="in-pmgsy-email" />
          </Section>

          {/* 12. ISO Portal */}
          <Section title="ISO Portal" icon="shield-checkmark" testID="sec-iso">
            <FormInput label="ISO User ID" value={f.iso_user_id} onChangeText={set('iso_user_id')} testID="in-iso-uid" />
            <FormInput label="ISO Password" value={f.iso_password} onChangeText={set('iso_password')} secure testID="in-iso-pwd" />
            <FormInput label="Other Details / Scope" value={f.iso_other_details} onChangeText={set('iso_other_details')} multiline testID="in-iso-other" />
          </Section>

          {/* 13. Other Portal & Notes */}
          <Section title="Any Other Portal & Notes" icon="apps" testID="sec-other">
            <FormInput label="Other Portal User ID" value={f.other_portal_user_id} onChangeText={set('other_portal_user_id')} testID="in-other-uid" />
            <FormInput label="Other Portal Password" value={f.other_portal_password} onChangeText={set('other_portal_password')} secure testID="in-other-pwd" />
            <FormInput label="Concern Email" value={f.other_portal_email} onChangeText={set('other_portal_email')} keyboardType="email-address" testID="in-other-email" />
            <FormInput label="Additional Notes" value={f.notes} onChangeText={set('notes')} multiline testID="in-notes" />
          </Section>

          {/* 14. Additional Custom Fields (Dynamic / Admin-Managed) */}
          <Section
            title={`Additional Custom Fields${customFields.length > 0 ? ` (${customFields.length})` : ''}`}
            icon="layers"
            defaultOpen
            testID="sec-custom-fields"
          >
            {isAdmin ? (
              <View style={styles.adminActionRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.adminActionTitle}>Admin Field Customizer</Text>
                  <Text style={styles.adminActionSub}>Define and attach new custom fields to Customer Master</Text>
                </View>
                <Pressable
                  onPress={() => setShowAddFieldModal(true)}
                  style={styles.addFieldBtn}
                  testID="btn-open-add-field"
                >
                  <Ionicons name="add-circle" size={16} color="#FFF" />
                  <Text style={styles.addFieldBtnTxt}>+ Add Field</Text>
                </Pressable>
              </View>
            ) : null}

            {customFields.length === 0 ? (
              <View style={styles.emptyFieldsBox}>
                <Ionicons name="information-circle-outline" size={20} color={colors.muted} />
                <Text style={styles.emptyFieldsText}>
                  {isAdmin
                    ? 'No custom fields defined yet. Click "+ Add Field" above to add new dynamic fields.'
                    : 'No additional custom fields configured.'}
                </Text>
              </View>
            ) : (
              <View style={{ gap: spacing.md }}>
                {customFields.map(cf => {
                  const key = cf.field_key;
                  const val = customValues[key] !== undefined ? String(customValues[key]) : '';
                  const label = `${cf.label}${cf.required ? ' *' : ''}`;

                  return (
                    <View key={cf.id} style={styles.customFieldContainer}>
                      <View style={styles.customFieldHeader}>
                        <View style={styles.fieldTypeBadge}>
                          <Text style={styles.fieldTypeBadgeText}>{cf.field_type.toUpperCase()}</Text>
                        </View>
                        {cf.required ? <Text style={styles.requiredBadge}>REQUIRED</Text> : null}
                        <View style={{ flex: 1 }} />
                        {isAdmin ? (
                          <Pressable
                            onPress={() => handleDeleteCustomField(cf.id, cf.label)}
                            hitSlop={8}
                            style={styles.deleteFieldBtn}
                            testID={`del-cf-${cf.id}`}
                          >
                            <Ionicons name="trash-outline" size={15} color={colors.error} />
                          </Pressable>
                        ) : null}
                      </View>

                      {cf.field_type === 'select' ? (
                        <View style={{ gap: 4 }}>
                          <Text style={styles.fieldLabel}>{label}</Text>
                          <View style={styles.chipRow}>
                            {(cf.options || []).map((opt: string) => {
                              const isSel = val === opt;
                              return (
                                <Pressable
                                  key={opt}
                                  onPress={() => setCustomValues(prev => ({ ...prev, [key]: opt }))}
                                  style={[styles.chip, isSel && styles.chipActive]}
                                >
                                  <Text style={[styles.chipText, isSel && styles.chipTextActive]}>{opt}</Text>
                                </Pressable>
                              );
                            })}
                          </View>
                          {val ? (
                            <Text style={{ fontSize: 11, color: colors.brandPrimary, fontWeight: '700', marginTop: 2 }}>
                              Selected: {val}
                            </Text>
                          ) : null}
                        </View>
                      ) : (
                        <FormInput
                          label={label}
                          value={val}
                          onChangeText={v => setCustomValues(prev => ({ ...prev, [key]: v }))}
                          placeholder={cf.placeholder || `Enter ${cf.label}`}
                          keyboardType={cf.field_type === 'number' ? 'numeric' : 'default'}
                          multiline={cf.field_type === 'textarea'}
                          testID={`in-cf-${key}`}
                        />
                      )}
                    </View>
                  );
                })}
              </View>
            )}
          </Section>

          {err ? <Text style={styles.err} testID="form-error">{err}</Text> : null}
          {ok ? <Text style={styles.ok} testID="form-ok">{ok}</Text> : null}
          <PrimaryButton label={isEdit ? 'Update Customer' : 'Save Customer'} onPress={save} loading={busy} testID="save-btn" />
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Admin Add Field Modal */}
      <Modal
        visible={showAddFieldModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowAddFieldModal(false)}
      >
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
          <View style={styles.modalCard} testID="add-field-modal">
            <View style={styles.modalHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View style={styles.modalHeaderIcon}>
                  <Ionicons name="add" size={18} color="#FFF" />
                </View>
                <div>
                  <Text style={styles.modalTitle}>Add New Field</Text>
                  <Text style={styles.modalSub}>Customer Master Dynamic Field Definition</Text>
                </div>
              </View>
              <Pressable onPress={() => setShowAddFieldModal(false)} hitSlop={10}>
                <Ionicons name="close" size={22} color={colors.onSurface} />
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={styles.modalBody} keyboardShouldPersistTaps="handled">
              <View style={{ gap: 4 }}>
                <Text style={styles.inputLabel}>Field Label / Name *</Text>
                <TextInput
                  value={newFieldLabel}
                  onChangeText={setNewFieldLabel}
                  placeholder="e.g. Labour License No. or Tender Category"
                  placeholderTextColor={colors.muted}
                  style={styles.modalInput}
                  testID="new-field-label-input"
                />
              </View>

              <View style={{ gap: 6 }}>
                <Text style={styles.inputLabel}>Field Type</Text>
                <View style={styles.typeSelectorGrid}>
                  {FIELD_TYPES.map(t => {
                    const sel = newFieldType === t.id;
                    return (
                      <Pressable
                        key={t.id}
                        onPress={() => setNewFieldType(t.id)}
                        style={[styles.typeOption, sel && styles.typeOptionActive]}
                      >
                        <Ionicons
                          name={
                            t.id === 'text'
                              ? 'text'
                              : t.id === 'number'
                              ? 'calculator'
                              : t.id === 'date'
                              ? 'calendar'
                              : t.id === 'textarea'
                              ? 'document-text'
                              : 'list'
                          }
                          size={14}
                          color={sel ? '#FFF' : colors.brandPrimary}
                        />
                        <Text style={[styles.typeOptionText, sel && styles.typeOptionTextActive]}>
                          {t.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              {newFieldType === 'select' ? (
                <View style={{ gap: 4 }}>
                  <Text style={styles.inputLabel}>Dropdown Options (comma-separated) *</Text>
                  <TextInput
                    value={newFieldOptions}
                    onChangeText={setNewFieldOptions}
                    placeholder="e.g. Option 1, Option 2, Option 3"
                    placeholderTextColor={colors.muted}
                    style={styles.modalInput}
                    testID="new-field-options-input"
                  />
                </View>
              ) : null}

              <View style={{ gap: 4 }}>
                <Text style={styles.inputLabel}>Placeholder Hint (Optional)</Text>
                <TextInput
                  value={newFieldPlaceholder}
                  onChangeText={setNewFieldPlaceholder}
                  placeholder="e.g. Enter valid license number"
                  placeholderTextColor={colors.muted}
                  style={styles.modalInput}
                />
              </View>

              {/* Required Toggle */}
              <Pressable
                onPress={() => setNewFieldRequired(r => !r)}
                style={styles.toggleRow}
              >
                <View style={[styles.checkbox, newFieldRequired && styles.checkboxActive]}>
                  {newFieldRequired ? <Ionicons name="checkmark" size={14} color="#FFF" /> : null}
                </View>
                <Text style={styles.toggleLabel}>Mark this field as Mandatory (Required)</Text>
              </Pressable>

              {fieldModalErr ? <Text style={styles.err}>{fieldModalErr}</Text> : null}
            </ScrollView>

            <View style={styles.modalFooter}>
              <Pressable
                onPress={() => setShowAddFieldModal(false)}
                style={styles.cancelBtn}
                disabled={addingField}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </Pressable>

              <Pressable
                onPress={handleCreateCustomField}
                style={[styles.submitBtn, addingField && { opacity: 0.7 }]}
                disabled={addingField}
                testID="submit-create-field-btn"
              >
                {addingField ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <>
                    <Ionicons name="checkmark-circle" size={16} color="#FFF" />
                    <Text style={styles.submitBtnText}>Create Field</Text>
                  </>
                )}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Branch Selection Modal */}
      <Modal visible={showBranchModal} transparent animationType="fade" onRequestClose={() => setShowBranchModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { maxHeight: '80%' }]} testID="branch-select-modal">
            <View style={styles.modalHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View style={styles.modalHeaderIcon}><Ionicons name="business" size={18} color="#FFF" /></View>
                <View>
                  <Text style={styles.modalTitle}>Select TDSC Branch</Text>
                  <Text style={styles.modalSub}>Select operating branch office</Text>
                </View>
              </View>
              <Pressable onPress={() => setShowBranchModal(false)} hitSlop={10}>
                <Ionicons name="close" size={22} color={colors.onSurface} />
              </Pressable>
            </View>
            <View style={{ padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider }}>
              <TextInput
                value={branchSearch}
                onChangeText={setBranchSearch}
                placeholder="Search branch name, code, city..."
                placeholderTextColor={colors.muted}
                style={styles.modalInput}
                autoFocus
              />
            </View>
            <ScrollView contentContainerStyle={{ padding: spacing.md, gap: 6 }}>
              {branchesList
                .filter(b => {
                  const q = branchSearch.trim().toLowerCase();
                  if (!q) return true;
                  return (
                    (b.name && b.name.toLowerCase().includes(q)) ||
                    (b.branch_name && b.branch_name.toLowerCase().includes(q)) ||
                    (b.code && b.code.toLowerCase().includes(q)) ||
                    (b.city && b.city.toLowerCase().includes(q))
                  );
                })
                .map(b => {
                  const bName = b.name || b.branch_name;
                  const isSel = f.branch_name === bName;
                  return (
                    <Pressable
                      key={b.id || b.branch_id || bName}
                      onPress={() => {
                        setF(p => ({ ...p, branch_id: b.id || b.branch_id || '', branch_name: bName }));
                        setShowBranchModal(false);
                      }}
                      style={[styles.pickerItem, isSel && styles.pickerItemActive]}
                    >
                      <Ionicons name="business" size={16} color={isSel ? colors.brandPrimary : colors.muted} />
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.pickerItemTitle, isSel && styles.pickerItemTitleActive]}>{bName}</Text>
                        {(b.code || b.city) ? (
                          <Text style={styles.pickerItemSub}>Code: {b.code || '—'} • {b.city || ''}</Text>
                        ) : null}
                      </View>
                      {isSel ? <Ionicons name="checkmark-circle" size={18} color={colors.brandPrimary} /> : null}
                    </Pressable>
                  );
                })}
              {branchesList.length === 0 ? (
                <Text style={{ textAlign: 'center', color: colors.muted, padding: 20 }}>No branches found</Text>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* District Selection Modal */}
      <Modal visible={showDistrictModal} transparent animationType="fade" onRequestClose={() => setShowDistrictModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { maxHeight: '80%' }]} testID="district-select-modal">
            <View style={styles.modalHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View style={styles.modalHeaderIcon}><Ionicons name="location" size={18} color="#FFF" /></View>
                <View>
                  <Text style={styles.modalTitle}>Select District</Text>
                  <Text style={styles.modalSub}>Select contractor's district</Text>
                </View>
              </View>
              <Pressable onPress={() => setShowDistrictModal(false)} hitSlop={10}>
                <Ionicons name="close" size={22} color={colors.onSurface} />
              </Pressable>
            </View>
            <View style={{ padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider }}>
              <TextInput
                value={districtSearch}
                onChangeText={setDistrictSearch}
                placeholder="Search district name..."
                placeholderTextColor={colors.muted}
                style={styles.modalInput}
                autoFocus
              />
            </View>
            <ScrollView contentContainerStyle={{ padding: spacing.md, gap: 6 }}>
              {districtsList
                .filter(d => {
                  const q = districtSearch.trim().toLowerCase();
                  if (!q) return true;
                  return d.name && d.name.toLowerCase().includes(q);
                })
                .map(d => {
                  const isSel = f.district === d.name;
                  return (
                    <Pressable
                      key={d.id || d.name}
                      onPress={() => {
                        setF(p => ({ ...p, district: d.name }));
                        setShowDistrictModal(false);
                      }}
                      style={[styles.pickerItem, isSel && styles.pickerItemActive]}
                    >
                      <Ionicons name="location-outline" size={16} color={isSel ? colors.brandPrimary : colors.muted} />
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.pickerItemTitle, isSel && styles.pickerItemTitleActive]}>{d.name}</Text>
                        {d.state ? <Text style={styles.pickerItemSub}>{d.state}</Text> : null}
                      </View>
                      {isSel ? <Ionicons name="checkmark-circle" size={18} color={colors.brandPrimary} /> : null}
                    </Pressable>
                  );
                })}
              {districtsList.length === 0 ? (
                <Text style={{ textAlign: 'center', color: colors.muted, padding: 20 }}>No districts found</Text>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxxl },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: spacing.md, borderRadius: radius.md, backgroundColor: '#EFF6FF', borderWidth: 1, borderColor: '#BFDBFE' },
  noticeText: { color: '#1E40AF', fontSize: font.sm, flex: 1, fontWeight: '600' },
  section: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md },
  sectionIcon: { width: 28, height: 28, borderRadius: 8, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center' },
  sectionTitle: { flex: 1, fontSize: font.lg, fontWeight: '700', color: colors.onSurface },
  fieldLabel: { fontSize: font.sm, fontWeight: '700', color: colors.onSurface, marginTop: 4 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginVertical: 4 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: '#F1F5F9', borderWidth: 1, borderColor: '#CBD5E1' },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { fontSize: 11, fontWeight: '700', color: '#475569' },
  chipTextActive: { color: '#FFF' },
  err: { color: colors.error, textAlign: 'center', fontSize: font.base, fontWeight: '600' },
  ok: { color: colors.success, textAlign: 'center', fontWeight: '800', fontSize: font.base },

  // Picker Styles
  pickerSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  pickerSelectorText: {
    flex: 1,
    fontSize: font.base,
    color: colors.onSurface,
    fontWeight: '600',
  },
  pickerPlaceholder: {
    color: colors.muted,
    fontWeight: '400',
  },
  pickerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: radius.md,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  pickerItemActive: {
    backgroundColor: '#EFF6FF',
    borderColor: colors.brandPrimary,
  },
  pickerItemTitle: {
    fontSize: font.sm,
    fontWeight: '700',
    color: colors.onSurface,
  },
  pickerItemTitleActive: {
    color: colors.brandPrimary,
  },
  pickerItemSub: {
    fontSize: 10,
    color: colors.muted,
    marginTop: 2,
  },

  // Custom Field Admin Elements
  adminActionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#F8FAFC', padding: 10, borderRadius: radius.md, borderWidth: 1, borderColor: '#E2E8F0', marginBottom: 4 },
  adminActionTitle: { fontSize: 12, fontWeight: '800', color: colors.onSurface },
  adminActionSub: { fontSize: 10, color: colors.muted },
  addFieldBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.brandPrimary, paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill },
  addFieldBtnTxt: { color: '#FFF', fontSize: 11, fontWeight: '800' },
  emptyFieldsBox: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 14, backgroundColor: '#F8FAFC', borderRadius: radius.md, borderWidth: 1, borderColor: '#E2E8F0', borderStyle: 'dashed' },
  emptyFieldsText: { fontSize: font.sm, color: colors.muted, flex: 1 },
  customFieldContainer: { backgroundColor: '#F8FAFC', padding: 10, borderRadius: radius.md, borderWidth: 1, borderColor: '#E2E8F0', gap: 8 },
  customFieldHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  fieldTypeBadge: { backgroundColor: '#E2E8F0', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  fieldTypeBadgeText: { fontSize: 9, fontWeight: '800', color: '#475569' },
  requiredBadge: { fontSize: 9, fontWeight: '800', color: colors.error, backgroundColor: '#FEE2E2', paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4 },
  deleteFieldBtn: { width: 26, height: 26, borderRadius: 13, backgroundColor: '#FEE2E2', alignItems: 'center', justifyContent: 'center' },

  // Modal styles
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: spacing.lg },
  modalCard: { width: '100%', maxWidth: 480, backgroundColor: colors.surface, borderRadius: radius.xl, overflow: 'hidden', borderWidth: 1, borderColor: colors.border },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.divider },
  modalHeaderIcon: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.brandPrimary, alignItems: 'center', justifyContent: 'center' },
  modalTitle: { fontSize: font.lg, fontWeight: '800', color: colors.onSurface },
  modalSub: { fontSize: 10, color: colors.muted },
  modalBody: { padding: spacing.lg, gap: spacing.md },
  inputLabel: { fontSize: font.sm, fontWeight: '700', color: colors.onSurface },
  modalInput: { backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, fontSize: font.base, color: colors.onSurface },
  typeSelectorGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  typeOption: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 7, borderRadius: radius.md, backgroundColor: '#F1F5F9', borderWidth: 1, borderColor: '#CBD5E1' },
  typeOptionActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  typeOptionText: { fontSize: 11, fontWeight: '700', color: '#334155' },
  typeOptionTextActive: { color: '#FFF' },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  checkbox: { width: 20, height: 20, borderRadius: 4, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFF' },
  checkboxActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  toggleLabel: { fontSize: font.sm, fontWeight: '600', color: colors.onSurface },
  modalFooter: { flexDirection: 'row', gap: 10, padding: spacing.lg, borderTopWidth: 1, borderTopColor: colors.divider },
  cancelBtn: { flex: 1, paddingVertical: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  cancelBtnText: { color: colors.onSurface, fontWeight: '700', fontSize: font.base },
  submitBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: colors.brandPrimary, paddingVertical: 12, borderRadius: radius.md },
  submitBtnText: { color: '#FFF', fontWeight: '800', fontSize: font.base },
  dateHelperRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: -4, marginBottom: 8 },
  dateHelperBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#EFF6FF', paddingHorizontal: 8, paddingVertical: 5, borderRadius: 6, borderWidth: 1, borderColor: '#BFDBFE' },
  dateHelperBtnText: { fontSize: 10, fontWeight: '700', color: colors.brandPrimary },
});
