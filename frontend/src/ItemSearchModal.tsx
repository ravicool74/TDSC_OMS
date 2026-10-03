import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, Modal, Pressable, TextInput, FlatList,
  ActivityIndicator, KeyboardAvoidingView, Platform, Alert, ScrollView
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, font } from './theme';
import { api } from './api';
import { FormInput } from './forms';

export type PickedItem = {
  id: string;
  item_code?: string | null;
  name: string;
  unit: string;
  hsn_sac?: string | null;
  sale_price: number;
  purchase_price: number;
  tax_rate: number;
  is_service: boolean;
  stock: number;
  item_type?: 'passed_on_money' | 'actual_service';
  fee_type?: string | null;
  notes?: string | null;
};

export type PassedOnItemModel = {
  id: string;
  name: string;
  fee_type: string;
  unit: string;
  default_amount: number;
  tax_rate: number;
  description?: string | null;
  is_system?: boolean;
};

export type ServiceModel = {
  id?: string;
  service_id?: string;
  name: string;
  rate: number;
  gst_percent: number;
  sac_hsn?: string | null;
  description?: string | null;
  status?: string;
};

export const ItemSearchModal: React.FC<{
  visible: boolean;
  onClose: () => void;
  onPick: (i: PickedItem) => void;
  title?: string;
}> = ({ visible, onClose, onPick, title = 'Add Item' }) => {
  const [activeTab, setActiveTab] = useState<'passed_on' | 'services' | 'products'>('passed_on');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);

  // Lists
  const [passOnList, setPassOnList] = useState<PassedOnItemModel[]>([]);
  const [servicesList, setServicesList] = useState<ServiceModel[]>([]);
  const [productsList, setProductsList] = useState<PickedItem[]>([]);

  // Modals for CRUD
  const [showPassOnModal, setShowPassOnModal] = useState(false);
  const [editingPassOn, setEditingPassOn] = useState<PassedOnItemModel | null>(null);

  const [showServiceModal, setShowServiceModal] = useState(false);
  const [editingService, setEditingService] = useState<ServiceModel | null>(null);

  const [showProductModal, setShowProductModal] = useState(false);

  // Load data
  const loadAll = async () => {
    setLoading(true);
    try {
      const [poi, srv, itms] = await Promise.all([
        api.get<PassedOnItemModel[]>('/passed-on-items').catch(() => []),
        api.get<ServiceModel[]>('/services').catch(() => []),
        api.get<PickedItem[]>('/items').catch(() => []),
      ]);
      setPassOnList(poi || []);
      setServicesList(srv || []);
      setProductsList(itms || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (visible) {
      setQ('');
      loadAll();
    }
  }, [visible]);

  // Handlers for Passed On Money CRUD
  const handleDeletePassOn = (item: PassedOnItemModel) => {
    const doDelete = async () => {
      try {
        await api.delete(`/passed-on-items/${item.id}`);
        setPassOnList(p => p.filter(x => x.id !== item.id));
      } catch (e: any) {
        Alert.alert('Error', e?.message || 'Failed to delete fee item');
      }
    };
    if (Platform.OS === 'web') {
      if (window.confirm(`Are you sure you want to delete "${item.name}"?`)) {
        doDelete();
      }
    } else {
      Alert.alert('Delete Fee Type', `Are you sure you want to delete "${item.name}"?`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: doDelete },
      ]);
    }
  };

  // Handlers for Actual Service CRUD
  const handleDeleteService = (service: ServiceModel) => {
    const sId = service.service_id || service.id;
    if (!sId) return;
    const doDelete = async () => {
      try {
        await api.delete(`/services/${sId}`);
        setServicesList(p => p.filter(x => (x.service_id || x.id) !== sId));
      } catch (e: any) {
        Alert.alert('Error', e?.message || 'Failed to delete service');
      }
    };
    if (Platform.OS === 'web') {
      if (window.confirm(`Are you sure you want to delete "${service.name}"?`)) {
        doDelete();
      }
    } else {
      Alert.alert('Delete Service', `Are you sure you want to delete "${service.name}"?`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: doDelete },
      ]);
    }
  };

  // Filtered views
  const filteredPassOn = passOnList.filter(x =>
    !q || x.name.toLowerCase().includes(q.toLowerCase()) || (x.description && x.description.toLowerCase().includes(q.toLowerCase()))
  );

  const filteredServices = servicesList.filter(x =>
    !q || x.name.toLowerCase().includes(q.toLowerCase()) || (x.sac_hsn && x.sac_hsn.includes(q)) || (x.description && x.description.toLowerCase().includes(q.toLowerCase()))
  );

  const filteredProducts = productsList.filter(x =>
    !q || x.name.toLowerCase().includes(q.toLowerCase()) || (x.hsn_sac && x.hsn_sac.includes(q))
  );

  return (
    <Modal transparent animationType="slide" visible={visible} onRequestClose={onClose}>
      <SafeAreaView edges={['top']} style={styles.root}>
        {/* Header */}
        <View style={styles.header}>
          <Pressable onPress={onClose} hitSlop={10} style={{ padding: 4 }}>
            <Ionicons name="close" size={24} color="#111827" />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.subtitle}>Select item type to add into sale invoice</Text>
          </View>
          {activeTab === 'passed_on' && (
            <Pressable
              testID="add-passon-btn"
              onPress={() => { setEditingPassOn(null); setShowPassOnModal(true); }}
              style={styles.addBtn}
            >
              <Ionicons name="add" size={18} color="#FFF" />
              <Text style={styles.addBtnTxt}>+ Add Fee Type</Text>
            </Pressable>
          )}
          {activeTab === 'services' && (
            <Pressable
              testID="add-service-btn"
              onPress={() => { setEditingService(null); setShowServiceModal(true); }}
              style={[styles.addBtn, { backgroundColor: '#7C3AED' }]}
            >
              <Ionicons name="add" size={18} color="#FFF" />
              <Text style={styles.addBtnTxt}>+ Add Service</Text>
            </Pressable>
          )}
          {activeTab === 'products' && (
            <Pressable
              testID="add-product-btn"
              onPress={() => setShowProductModal(true)}
              style={[styles.addBtn, { backgroundColor: '#0284C7' }]}
            >
              <Ionicons name="add" size={18} color="#FFF" />
              <Text style={styles.addBtnTxt}>+ Add Product</Text>
            </Pressable>
          )}
        </View>

        {/* Two Main Sections Segmented Tabs */}
        <View style={styles.tabsContainer}>
          <Pressable
            testID="tab-passed-on"
            onPress={() => setActiveTab('passed_on')}
            style={[styles.tab, activeTab === 'passed_on' && styles.tabActivePassOn]}
          >
            <Ionicons
              name="cash"
              size={18}
              color={activeTab === 'passed_on' ? '#0D9488' : colors.muted}
            />
            <View style={{ flexDirection: 'column' }}>
              <Text style={[styles.tabLabel, activeTab === 'passed_on' && styles.tabLabelActivePassOn]}>
                Passed On Money
              </Text>
              <Text style={styles.tabSub}>EMD, BOQ, Tender & Reg Fees (0% GST)</Text>
            </View>
          </Pressable>

          <Pressable
            testID="tab-actual-services"
            onPress={() => setActiveTab('services')}
            style={[styles.tab, activeTab === 'services' && styles.tabActiveService]}
          >
            <Ionicons
              name="construct"
              size={18}
              color={activeTab === 'services' ? '#7C3AED' : colors.muted}
            />
            <View style={{ flexDirection: 'column' }}>
              <Text style={[styles.tabLabel, activeTab === 'services' && styles.tabLabelActiveService]}>
                Actual Service
              </Text>
              <Text style={styles.tabSub}>Admin Decided Services (18% GST)</Text>
            </View>
          </Pressable>

          <Pressable
            testID="tab-products"
            onPress={() => setActiveTab('products')}
            style={[styles.tabSmall, activeTab === 'products' && styles.tabActiveProduct]}
          >
            <Ionicons
              name="cube"
              size={16}
              color={activeTab === 'products' ? '#0284C7' : colors.muted}
            />
            <Text style={[styles.tabSmallLabel, activeTab === 'products' && styles.tabSmallLabelActive]}>
              Products
            </Text>
          </Pressable>
        </View>

        {/* Search Bar */}
        <View style={styles.searchWrap}>
          <Ionicons name="search" size={18} color={colors.muted} />
          <TextInput
            testID="item-search-input"
            autoFocus
            placeholder={
              activeTab === 'passed_on'
                ? 'Search Passed On Fee (EMD, Cost of BOQ, Tender Fee...)'
                : activeTab === 'services'
                ? 'Search Actual Service (DSC, E-Tender, GST, GeM, SBD...)'
                : 'Search inventory product / token...'
            }
            placeholderTextColor={colors.muted}
            value={q}
            onChangeText={setQ}
            style={styles.searchInput}
          />
          {q ? (
            <Pressable onPress={() => setQ('')} hitSlop={10}>
              <Ionicons name="close-circle" size={18} color={colors.muted} />
            </Pressable>
          ) : null}
        </View>

        {loading ? (
          <View style={{ padding: spacing.xxl, alignItems: 'center' }}>
            <ActivityIndicator color={colors.brandPrimary} size="large" />
            <Text style={{ marginTop: 8, color: colors.muted }}>Loading items...</Text>
          </View>
        ) : (
          <View style={{ flex: 1 }}>
            {/* SECTION 1: PASSED ON MONEY */}
            {activeTab === 'passed_on' && (
              <FlatList
                data={filteredPassOn}
                keyExtractor={i => i.id}
                contentContainerStyle={{ padding: spacing.md, gap: 10, paddingBottom: 40 }}
                ListEmptyComponent={
                  <View style={styles.empty}>
                    <Ionicons name="repeat-outline" size={44} color={colors.muted} />
                    <Text style={styles.emptyTxt}>{q ? 'No matching fee type found' : 'No Passed On Fee items configured'}</Text>
                    <Pressable
                      onPress={() => { setEditingPassOn(null); setShowPassOnModal(true); }}
                      style={[styles.emptyBtn, { backgroundColor: '#0D9488' }]}
                    >
                      <Text style={styles.emptyBtnTxt}>+ Add Fee Type</Text>
                    </Pressable>
                  </View>
                }
                renderItem={({ item }) => (
                  <View style={styles.card}>
                    <Pressable
                      testID={`passon-pick-${item.id}`}
                      onPress={() => {
                        onPick({
                          id: item.id,
                          name: item.name,
                          unit: item.unit || 'LOT',
                          sale_price: item.default_amount || 0,
                          purchase_price: 0,
                          tax_rate: 0, // Passed on money is pass-through / reimbursement
                          is_service: true,
                          stock: 999,
                          item_type: 'passed_on_money',
                          fee_type: item.fee_type || item.name,
                          notes: item.description || null,
                        });
                        onClose();
                      }}
                      style={styles.cardMain}
                    >
                      <View style={[styles.avatar, { backgroundColor: '#CCFBF1' }]}>
                        <Ionicons name="repeat" size={22} color="#0D9488" />
                      </View>
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Text style={styles.cardName}>{item.name}</Text>
                          <View style={styles.passOnBadge}>
                            <Text style={styles.passOnBadgeTxt}>Passed On Money</Text>
                          </View>
                        </View>
                        <Text style={styles.cardMeta}>
                          Unit: {item.unit || 'LOT'} • 0% GST (Reimbursement)
                        </Text>
                        {item.description ? (
                          <Text style={styles.cardDesc} numberOfLines={2}>{item.description}</Text>
                        ) : null}
                      </View>
                      <View style={{ alignItems: 'flex-end', marginLeft: 8 }}>
                        <Text style={styles.priceTxt}>
                          {item.default_amount > 0 ? `₹${item.default_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : 'Custom Amt'}
                        </Text>
                        <Text style={styles.selectHint}>Tap to Select</Text>
                      </View>
                    </Pressable>

                    {/* Action buttons: Edit and Delete */}
                    <View style={styles.cardActions}>
                      <Pressable
                        testID={`passon-edit-${item.id}`}
                        onPress={() => { setEditingPassOn(item); setShowPassOnModal(true); }}
                        style={styles.actionBtn}
                      >
                        <Ionicons name="pencil" size={16} color="#0D9488" />
                        <Text style={[styles.actionBtnTxt, { color: '#0D9488' }]}>Edit</Text>
                      </Pressable>
                      <Pressable
                        testID={`passon-delete-${item.id}`}
                        onPress={() => handleDeletePassOn(item)}
                        style={styles.actionBtn}
                      >
                        <Ionicons name="trash-outline" size={16} color="#DC2626" />
                        <Text style={[styles.actionBtnTxt, { color: '#DC2626' }]}>Delete</Text>
                      </Pressable>
                    </View>
                  </View>
                )}
              />
            )}

            {/* SECTION 2: ACTUAL SERVICES (Admin Decided) */}
            {activeTab === 'services' && (
              <FlatList
                data={filteredServices}
                keyExtractor={i => i.service_id || i.id || i.name}
                contentContainerStyle={{ padding: spacing.md, gap: 10, paddingBottom: 40 }}
                ListEmptyComponent={
                  <View style={styles.empty}>
                    <Ionicons name="construct-outline" size={44} color={colors.muted} />
                    <Text style={styles.emptyTxt}>{q ? 'No matching service found' : 'No Services configured'}</Text>
                    <Pressable
                      onPress={() => { setEditingService(null); setShowServiceModal(true); }}
                      style={[styles.emptyBtn, { backgroundColor: '#7C3AED' }]}
                    >
                      <Text style={styles.emptyBtnTxt}>+ Add New Service</Text>
                    </Pressable>
                  </View>
                }
                renderItem={({ item }) => (
                  <View style={styles.card}>
                    <Pressable
                      testID={`service-pick-${item.service_id || item.id}`}
                      onPress={() => {
                        onPick({
                          id: item.service_id || item.id || `srv-${Date.now()}`,
                          name: item.name,
                          unit: 'JOB',
                          hsn_sac: item.sac_hsn || '998313',
                          sale_price: item.rate || 0,
                          purchase_price: 0,
                          tax_rate: item.gst_percent !== undefined ? item.gst_percent : 18,
                          is_service: true,
                          stock: 999,
                          item_type: 'actual_service',
                          notes: item.description || null,
                        });
                        onClose();
                      }}
                      style={styles.cardMain}
                    >
                      <View style={[styles.avatar, { backgroundColor: '#EDE9FE' }]}>
                        <Ionicons name="construct" size={20} color="#7C3AED" />
                      </View>
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Text style={styles.cardName}>{item.name}</Text>
                          <View style={styles.serviceBadge}>
                            <Text style={styles.serviceBadgeTxt}>Actual Service</Text>
                          </View>
                        </View>
                        <Text style={styles.cardMeta}>
                          SAC: {item.sac_hsn || '998313'} • GST {item.gst_percent || 18}%
                        </Text>
                        {item.description ? (
                          <Text style={styles.cardDesc} numberOfLines={2}>{item.description}</Text>
                        ) : null}
                      </View>
                      <View style={{ alignItems: 'flex-end', marginLeft: 8 }}>
                        <Text style={[styles.priceTxt, { color: '#7C3AED' }]}>
                          ₹{Number(item.rate || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </Text>
                        <Text style={styles.selectHint}>Tap to Select</Text>
                      </View>
                    </Pressable>

                    {/* Action buttons: Edit and Delete */}
                    <View style={styles.cardActions}>
                      <Pressable
                        testID={`service-edit-${item.service_id || item.id}`}
                        onPress={() => { setEditingService(item); setShowServiceModal(true); }}
                        style={styles.actionBtn}
                      >
                        <Ionicons name="pencil" size={16} color="#7C3AED" />
                        <Text style={[styles.actionBtnTxt, { color: '#7C3AED' }]}>Edit</Text>
                      </Pressable>
                      <Pressable
                        testID={`service-delete-${item.service_id || item.id}`}
                        onPress={() => handleDeleteService(item)}
                        style={styles.actionBtn}
                      >
                        <Ionicons name="trash-outline" size={16} color="#DC2626" />
                        <Text style={[styles.actionBtnTxt, { color: '#DC2626' }]}>Delete</Text>
                      </Pressable>
                    </View>
                  </View>
                )}
              />
            )}

            {/* SECTION 3: PRODUCTS */}
            {activeTab === 'products' && (
              <FlatList
                data={filteredProducts}
                keyExtractor={i => i.id}
                contentContainerStyle={{ padding: spacing.md, gap: 10, paddingBottom: 40 }}
                ListEmptyComponent={
                  <View style={styles.empty}>
                    <Ionicons name="cube-outline" size={44} color={colors.muted} />
                    <Text style={styles.emptyTxt}>{q ? 'No products found' : 'No items yet'}</Text>
                    <Pressable
                      onPress={() => setShowProductModal(true)}
                      style={[styles.emptyBtn, { backgroundColor: '#0284C7' }]}
                    >
                      <Text style={styles.emptyBtnTxt}>+ Add New Product</Text>
                    </Pressable>
                  </View>
                }
                renderItem={({ item }) => (
                  <Pressable
                    testID={`item-${item.id}`}
                    onPress={() => {
                      onPick({ ...item, item_type: 'actual_service' });
                      onClose();
                    }}
                    style={styles.card}
                  >
                    <View style={styles.cardMain}>
                      <View style={[styles.avatar, { backgroundColor: '#DBEAFE' }]}>
                        <Ionicons name="cube" size={20} color="#0284C7" />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.cardName}>{item.name}</Text>
                        <Text style={styles.cardMeta}>
                          {item.item_code || '—'} • HSN: {item.hsn_sac || '—'} • GST {item.tax_rate}%
                        </Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={styles.priceTxt}>
                          ₹{Number(item.sale_price || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </Text>
                        <Text style={styles.stockTxt}>Stock: {item.stock}</Text>
                      </View>
                    </View>
                  </Pressable>
                )}
              />
            )}
          </View>
        )}
      </SafeAreaView>

      {/* Modal: Add / Edit Passed On Fee Item */}
      {showPassOnModal && (
        <PassOnItemModal
          visible={showPassOnModal}
          initial={editingPassOn}
          onClose={() => setShowPassOnModal(false)}
          onSaved={(saved) => {
            setShowPassOnModal(false);
            setPassOnList(p => {
              const idx = p.findIndex(x => x.id === saved.id);
              if (idx >= 0) {
                const next = [...p];
                next[idx] = saved;
                return next;
              }
              return [...p, saved];
            });
          }}
        />
      )}

      {/* Modal: Add / Edit Actual Service */}
      {showServiceModal && (
        <ServiceEditModal
          visible={showServiceModal}
          initial={editingService}
          onClose={() => setShowServiceModal(false)}
          onSaved={(saved) => {
            setShowServiceModal(false);
            setServicesList(p => {
              const sId = saved.service_id || saved.id;
              const idx = p.findIndex(x => (x.service_id || x.id) === sId);
              if (idx >= 0) {
                const next = [...p];
                next[idx] = saved;
                return next;
              }
              return [...p, saved];
            });
          }}
        />
      )}

      {/* Modal: Add New Product */}
      {showProductModal && (
        <AddProductModal
          visible={showProductModal}
          initialName={q}
          onClose={() => setShowProductModal(false)}
          onCreated={(item) => {
            setShowProductModal(false);
            setProductsList(p => [...p, item]);
            onPick(item);
            onClose();
          }}
        />
      )}
    </Modal>
  );
};

// =========================================================================
// SUB-MODAL 1: ADD / EDIT PASSED ON FEE ITEM
// =========================================================================
const PassOnItemModal: React.FC<{
  visible: boolean;
  initial: PassedOnItemModel | null;
  onClose: () => void;
  onSaved: (item: PassedOnItemModel) => void;
}> = ({ visible, initial, onClose, onSaved }) => {
  const [name, setName] = useState(initial?.name || '');
  const [feeType, setFeeType] = useState(initial?.fee_type || 'Other Fee');
  const [amount, setAmount] = useState(initial?.default_amount ? String(initial.default_amount) : '');
  const [desc, setDesc] = useState(initial?.description || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setName(initial?.name || '');
      setFeeType(initial?.fee_type || 'Other Fee');
      setAmount(initial?.default_amount ? String(initial.default_amount) : '');
      setDesc(initial?.description || '');
      setErr(null);
    }
  }, [visible, initial]);

  const save = async () => {
    const cleanName = name.trim();
    if (!cleanName) {
      setErr('Fee Item Name is required');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      if (initial?.id) {
        // Edit
        const updated = await api.patch<PassedOnItemModel>(`/passed-on-items/${initial.id}`, {
          name: cleanName,
          fee_type: feeType || cleanName,
          default_amount: parseFloat(amount) || 0,
          description: desc.trim() || null,
        });
        onSaved(updated);
      } else {
        // Create
        const created = await api.post<PassedOnItemModel>('/passed-on-items', {
          name: cleanName,
          fee_type: feeType || cleanName,
          default_amount: parseFloat(amount) || 0,
          unit: 'LOT',
          tax_rate: 0,
          description: desc.trim() || null,
        });
        onSaved(created);
      }
    } catch (e: any) {
      setErr(e?.message || 'Failed to save fee item');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.sheet}>
            <View style={styles.sheetHead}>
              <View>
                <Text style={styles.sheetTitle}>
                  {initial ? 'Edit Passed On Fee Type' : 'Add Passed On Fee Type'}
                </Text>
                <Text style={{ color: '#0D9488', fontSize: font.sm, fontWeight: '600' }}>
                  Client reimbursement funds (EMD, BOQ, Tender Fee, etc.)
                </Text>
              </View>
              <Pressable onPress={onClose} hitSlop={10}><Ionicons name="close" size={24} color="#111827" /></Pressable>
            </View>

            <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
              <FormInput
                label="Fee Type Name *"
                placeholder="e.g. EMD, Cost of BOQ, Tender Fee, Registration Fee"
                value={name}
                onChangeText={setName}
                testID="passon-name-input"
              />

              <FormInput
                label="Default Amount (₹) (Optional)"
                placeholder="0.00 (or enter dynamically in invoice)"
                value={amount}
                onChangeText={setAmount}
                keyboardType="numeric"
                testID="passon-amount-input"
              />

              <FormInput
                label="Description / Purpose"
                placeholder="Details about authority, portal or document requirement"
                value={desc}
                onChangeText={setDesc}
                multiline
                testID="passon-desc-input"
              />

              {err ? <Text style={{ color: colors.error, fontWeight: '600' }}>{err}</Text> : null}

              <Pressable
                testID="passon-save-btn"
                onPress={save}
                disabled={busy}
                style={[styles.saveBtn, { backgroundColor: '#0D9488' }, busy && { opacity: 0.6 }]}
              >
                <Text style={styles.saveBtnTxt}>{busy ? 'Saving...' : initial ? 'Update Fee Type' : 'Save Fee Type'}</Text>
              </Pressable>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
};

// =========================================================================
// SUB-MODAL 2: ADD / EDIT ACTUAL SERVICE (Admin Decided)
// =========================================================================
const ServiceEditModal: React.FC<{
  visible: boolean;
  initial: ServiceModel | null;
  onClose: () => void;
  onSaved: (item: ServiceModel) => void;
}> = ({ visible, initial, onClose, onSaved }) => {
  const [name, setName] = useState(initial?.name || '');
  const [rate, setRate] = useState(initial?.rate ? String(initial.rate) : '');
  const [gst, setGst] = useState(initial?.gst_percent !== undefined ? String(initial.gst_percent) : '18');
  const [sac, setSac] = useState(initial?.sac_hsn || '998313');
  const [desc, setDesc] = useState(initial?.description || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setName(initial?.name || '');
      setRate(initial?.rate ? String(initial.rate) : '');
      setGst(initial?.gst_percent !== undefined ? String(initial.gst_percent) : '18');
      setSac(initial?.sac_hsn || '998313');
      setDesc(initial?.description || '');
      setErr(null);
    }
  }, [visible, initial]);

  const save = async () => {
    const cleanName = name.trim();
    if (!cleanName || !rate) {
      setErr('Service Name and Rate are required');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const sId = initial?.service_id || initial?.id;
      if (sId) {
        // Edit service
        const updated = await api.patch<ServiceModel>(`/services/${sId}`, {
          name: cleanName,
          rate: parseFloat(rate) || 0,
          gst_percent: parseFloat(gst) || 18,
          sac_hsn: sac.trim() || '998313',
          description: desc.trim() || null,
        });
        onSaved(updated);
      } else {
        // Create service
        const created = await api.post<ServiceModel>('/services', {
          name: cleanName,
          rate: parseFloat(rate) || 0,
          gst_percent: parseFloat(gst) || 18,
          sac_hsn: sac.trim() || '998313',
          description: desc.trim() || null,
          status: 'active',
        });
        onSaved(created);
      }
    } catch (e: any) {
      setErr(e?.message || 'Failed to save service');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.sheet}>
            <View style={styles.sheetHead}>
              <View>
                <Text style={styles.sheetTitle}>
                  {initial ? 'Edit Actual Service' : 'Add New Actual Service'}
                </Text>
                <Text style={{ color: '#7C3AED', fontSize: font.sm, fontWeight: '600' }}>
                  Decided & Managed by Admin (DSC, Tender, GeM, GST, etc.)
                </Text>
              </View>
              <Pressable onPress={onClose} hitSlop={10}><Ionicons name="close" size={24} color="#111827" /></Pressable>
            </View>

            <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
              <FormInput
                label="Service Name *"
                placeholder="e.g. Digital Signature Class 3, E-Tender Service"
                value={name}
                onChangeText={setName}
                testID="service-name-input"
              />

              <FormInput
                label="Service Rate (₹) *"
                placeholder="2500"
                value={rate}
                onChangeText={setRate}
                keyboardType="numeric"
                testID="service-rate-input"
              />

              <View style={{ flexDirection: 'row', gap: 12 }}>
                <View style={{ flex: 1 }}>
                  <FormInput
                    label="GST Rate (%)"
                    placeholder="18"
                    value={gst}
                    onChangeText={setGst}
                    keyboardType="numeric"
                    testID="service-gst-input"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <FormInput
                    label="SAC Code"
                    placeholder="998313"
                    value={sac}
                    onChangeText={setSac}
                    testID="service-sac-input"
                  />
                </View>
              </View>

              <FormInput
                label="Description"
                placeholder="Scope of work, deliverables and terms"
                value={desc}
                onChangeText={setDesc}
                multiline
                testID="service-desc-input"
              />

              {err ? <Text style={{ color: colors.error, fontWeight: '600' }}>{err}</Text> : null}

              <Pressable
                testID="service-save-btn"
                onPress={save}
                disabled={busy}
                style={[styles.saveBtn, { backgroundColor: '#7C3AED' }, busy && { opacity: 0.6 }]}
              >
                <Text style={styles.saveBtnTxt}>{busy ? 'Saving...' : initial ? 'Update Service' : 'Save Service'}</Text>
              </Pressable>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
};

// =========================================================================
// SUB-MODAL 3: ADD NEW PRODUCT
// =========================================================================
const AddProductModal: React.FC<{
  visible: boolean;
  initialName?: string;
  onClose: () => void;
  onCreated: (i: PickedItem) => void;
}> = ({ visible, initialName, onClose, onCreated }) => {
  const [f, setF] = useState({ name: initialName || '', unit: 'PCS', hsn_sac: '', sale_price: '', tax_rate: '18', is_service: false });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (visible) setF(p => ({ ...p, name: initialName || '' }));
  }, [visible, initialName]);

  const save = async () => {
    if (!f.name.trim() || !f.sale_price) {
      setErr('Name and sale price required');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const r = await api.post<PickedItem>('/items', {
        name: f.name.trim(),
        unit: f.unit || 'PCS',
        hsn_sac: f.hsn_sac || null,
        sale_price: parseFloat(f.sale_price) || 0,
        purchase_price: 0,
        tax_rate: parseFloat(f.tax_rate) || 0,
        is_service: f.is_service,
        stock: 0,
        low_stock_alert: 0,
      });
      onCreated(r);
    } catch (e: any) {
      setErr(e?.message || 'Failed to save product');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.sheet}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>Add New Product</Text>
              <Pressable onPress={onClose}><Ionicons name="close" size={22} color="#111827" /></Pressable>
            </View>
            <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
              <FormInput label="Item Name *" value={f.name} onChangeText={v => setF(p => ({ ...p, name: v }))} />
              <FormInput label="Unit" value={f.unit} onChangeText={v => setF(p => ({ ...p, unit: v.toUpperCase() }))} />
              <FormInput label="HSN/SAC" value={f.hsn_sac} onChangeText={v => setF(p => ({ ...p, hsn_sac: v }))} />
              <FormInput label="Sale Price (₹) *" value={f.sale_price} onChangeText={v => setF(p => ({ ...p, sale_price: v }))} keyboardType="numeric" />
              <FormInput label="GST Rate (%)" value={f.tax_rate} onChangeText={v => setF(p => ({ ...p, tax_rate: v }))} keyboardType="numeric" />
              {err ? <Text style={{ color: colors.error }}>{err}</Text> : null}
              <Pressable onPress={save} disabled={busy} style={[styles.saveBtn, busy && { opacity: 0.6 }]}>
                <Text style={styles.saveBtnTxt}>{busy ? 'Saving…' : 'Save Product'}</Text>
              </Pressable>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
};

// =========================================================================
// STYLES
// =========================================================================
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F8FAFC' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: '#FFF',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: { fontSize: font.lg, fontWeight: '800', color: '#111827' },
  subtitle: { fontSize: font.xs, color: colors.muted },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#0D9488',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.md,
  },
  addBtnTxt: { color: '#FFF', fontWeight: '700', fontSize: font.sm },

  // Tabs
  tabsContainer: {
    flexDirection: 'row',
    backgroundColor: '#FFF',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tab: {
    flex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
  },
  tabSmall: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
  },
  tabActivePassOn: {
    borderColor: '#0D9488',
    backgroundColor: '#F0FDFA',
  },
  tabActiveService: {
    borderColor: '#7C3AED',
    backgroundColor: '#F5F3FF',
  },
  tabActiveProduct: {
    borderColor: '#0284C7',
    backgroundColor: '#F0F9FF',
  },
  tabLabel: { fontSize: font.sm, fontWeight: '700', color: '#334155' },
  tabLabelActivePassOn: { color: '#0D9488' },
  tabLabelActiveService: { color: '#7C3AED' },
  tabSub: { fontSize: 10, color: colors.muted },
  tabSmallLabel: { fontSize: font.xs, fontWeight: '700', color: '#64748B' },
  tabSmallLabelActive: { color: '#0284C7' },

  // Search
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    margin: spacing.md,
    marginBottom: spacing.xs,
    paddingHorizontal: spacing.md,
    backgroundColor: '#FFF',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    height: 44,
  },
  searchInput: { flex: 1, color: '#111827', fontSize: font.sm },

  // List Cards
  card: {
    backgroundColor: '#FFF',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowRadius: 4,
    elevation: 1,
  },
  cardMain: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    gap: 12,
  },
  avatar: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  cardName: { color: '#0F172A', fontWeight: '700', fontSize: font.base },
  cardMeta: { color: '#64748B', fontSize: font.xs, marginTop: 2 },
  cardDesc: { color: '#94A3B8', fontSize: 11, marginTop: 2 },
  priceTxt: { color: '#0F172A', fontWeight: '800', fontSize: font.base },
  selectHint: { color: colors.brandPrimary, fontSize: 10, fontWeight: '700', marginTop: 2 },
  stockTxt: { color: '#059669', fontSize: 11, fontWeight: '600' },

  // Badges
  passOnBadge: {
    backgroundColor: '#CCFBF1',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  passOnBadgeTxt: { color: '#0F766E', fontSize: 10, fontWeight: '800' },

  serviceBadge: {
    backgroundColor: '#EDE9FE',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  serviceBadgeTxt: { color: '#6D28D9', fontSize: 10, fontWeight: '800' },

  // Card Actions (Edit, Delete)
  cardActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    backgroundColor: '#FAFAFA',
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.sm,
  },
  actionBtnTxt: { fontSize: 12, fontWeight: '700' },

  // Empty state
  empty: { alignItems: 'center', padding: spacing.xxl, gap: 8 },
  emptyTxt: { color: colors.muted, fontSize: font.sm },
  emptyBtn: { marginTop: 8, paddingHorizontal: 16, paddingVertical: 9, borderRadius: radius.md },
  emptyBtnTxt: { color: '#FFF', fontWeight: '700', fontSize: font.sm },

  // Sheet Modal
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#FFF',
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    maxHeight: '90%',
  },
  sheetHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  sheetTitle: { fontSize: font.lg, fontWeight: '800', color: '#111827' },
  saveBtn: {
    backgroundColor: colors.brandPrimary,
    padding: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
    marginTop: 8,
  },
  saveBtnTxt: { color: '#FFF', fontWeight: '800', fontSize: font.base },
});
