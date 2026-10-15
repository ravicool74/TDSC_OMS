import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  Modal,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, font } from '@/src/theme';
import { api } from '@/src/api';
import { Card, ScreenLoader, PrimaryButton, SecondaryButton } from '@/src/ui';
import { ScreenHeader } from '@/src/ScreenHeader';
import { FormInput } from '@/src/forms';
import { useAuth } from '@/src/AuthContext';
import { notify } from '@/src/dialog';
import { FOUR_MENU_STRUCTURE, STANDARD_ACTIONS, ActionKey } from '@/src/rbac';

export default function RolesScreen() {
  const { user: currentUser, refresh: refreshAuth } = useAuth();
  const isSuperAdmin = currentUser?.role === 'super_admin' || currentUser?.role_id === 'super_admin';
  const isAdmin = isSuperAdmin || currentUser?.role === 'admin' || currentUser?.role_id === 'admin';

  const params = useLocalSearchParams<{ view?: string; user_id?: string }>();
  const [activeViewMode, setActiveViewMode] = useState<'roles' | 'users'>(
    params?.view === 'users' || !!params?.user_id ? 'users' : 'roles'
  );

  const [roles, setRoles] = useState<any[] | null>(null);
  const [meta, setMeta] = useState<any | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [busy, setBusy] = useState(false);

  // Staff Users Directory State
  const [staffUsers, setStaffUsers] = useState<any[] | null>(null);
  const [staffSearchQuery, setStaffSearchQuery] = useState('');

  // Individual User Editor State
  const [editingUser, setEditingUser] = useState<any | null>(null);
  const [editingUserPerms, setEditingUserPerms] = useState<any | null>(null);
  const [savingUserPerms, setSavingUserPerms] = useState(false);
  const [resettingUserPerms, setResettingUserPerms] = useState(false);

  // Editor Modal State
  const [editingRole, setEditingRole] = useState<any | null>(null);
  const [activeMenuTab, setActiveMenuTab] = useState<'dashboard' | 'business' | 'task' | 'more' | 'users'>('dashboard');
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [matrix, setMatrix] = useState<any>({});
  const [assignedUsers, setAssignedUsers] = useState<any[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [savingRole, setSavingRole] = useState(false);

  // Assign User to Role Sub-Modal
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [assigningUser, setAssigningUser] = useState(false);

  // Create Role Modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newRoleName, setNewRoleName] = useState('');
  const [newRoleDesc, setNewRoleDesc] = useState('');
  const [cloneFromRoleId, setCloneFromRoleId] = useState<string>('employee');

  const load = useCallback(async () => {
    try {
      const [rData, mData, uData] = await Promise.all([
        api.get<any[]>('/roles'),
        api.get<any>('/roles/meta'),
        api.get<any[]>('/manage-users').catch(() => []),
      ]);
      setRoles(rData);
      setMeta(mData);
      setStaffUsers(uData);
    } catch {
      setRoles([]);
      setStaffUsers([]);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Auto-switch to user tab and open modal if navigated with params
  React.useEffect(() => {
    if (params?.view === 'users' || params?.user_id) {
      setActiveViewMode('users');
      if (params?.user_id) {
        openUserEditor(params.user_id);
      }
    }
  }, [params?.view, params?.user_id]);

  // Open Individual User Customisation Modal
  const openUserEditor = async (userObjOrId: any) => {
    const uid = typeof userObjOrId === 'string' ? userObjOrId : userObjOrId.user_id;
    setBusy(true);
    try {
      const permData = await api.getUserPermissions(uid);
      setEditingUserPerms(permData);
      setEditingUser(permData);
      setEditingRole(null);

      // Clone app_menu_matrix from user or fallback to role defaults
      let userMatrix = permData.app_menu_matrix ? JSON.parse(JSON.stringify(permData.app_menu_matrix)) : {};
      if (!userMatrix.dashboard) userMatrix.dashboard = {};
      if (!userMatrix.business) userMatrix.business = {};
      if (!userMatrix.task) userMatrix.task = {};
      if (!userMatrix.more) userMatrix.more = { operations_services: {}, human_resources: {}, enterprise_administration: {} };
      if (!userMatrix.more.operations_services) userMatrix.more.operations_services = {};
      if (!userMatrix.more.human_resources) userMatrix.more.human_resources = {};
      if (!userMatrix.more.enterprise_administration) userMatrix.more.enterprise_administration = {};

      setMatrix(userMatrix);
      setActiveMenuTab('dashboard');
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to load user permissions');
    } finally {
      setBusy(false);
    }
  };

  // Save User Permissions Matrix
  const saveUserPowers = async () => {
    if (!editingUser) return;
    if (editingUser.role_id === 'super_admin' && !isSuperAdmin) {
      Alert.alert('Permission Denied', 'Only Super Admin can modify Super Admin permissions.');
      return;
    }

    setSavingUserPerms(true);
    try {
      await api.saveUserPermissions(editingUser.user_id, matrix);
      notify(`Custom permissions saved for ${editingUser.name}!`);
      setEditingUser(null);
      setEditingUserPerms(null);
      await load();

      if (currentUser?.user_id === editingUser.user_id) {
        await refreshAuth();
      }
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to save user permissions');
    } finally {
      setSavingUserPerms(false);
    }
  };

  // Reset User Permissions to Role Defaults
  const resetUserPowersToDefault = async (targetUser?: any) => {
    const u = targetUser || editingUser;
    if (!u) return;

    const doReset = async () => {
      setResettingUserPerms(true);
      try {
        await api.resetUserPermissions(u.user_id);
        notify(`Permissions reset to ${u.role_name || u.role_id} defaults for ${u.name}!`);
        if (editingUser?.user_id === u.user_id) {
          setEditingUser(null);
          setEditingUserPerms(null);
        }
        await load();

        if (currentUser?.user_id === u.user_id) {
          await refreshAuth();
        }
      } catch (e: any) {
        Alert.alert('Error', e?.message || 'Failed to reset user permissions');
      } finally {
        setResettingUserPerms(false);
      }
    };

    if (Platform.OS === 'web') {
      if (window.confirm(`Reset ${u.name}'s permissions to default role "${u.role_name || u.role_id}" matrix? Any custom overrides will be removed.`)) {
        await doReset();
      }
    } else {
      Alert.alert(
        'Reset to Role Defaults',
        `Reset ${u.name}'s permissions to default role "${u.role_name || u.role_id}" matrix? Any custom overrides will be removed.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Reset', style: 'destructive', onPress: doReset },
        ]
      );
    }
  };

  // Open Role Matrix Customisation Modal
  const openRoleEditor = async (role: any, initialTab: 'dashboard' | 'business' | 'task' | 'more' | 'users' = 'dashboard') => {
    setEditingUser(null);
    setEditingUserPerms(null);
    setEditingRole(role);
    setEditName(role.name || '');
    setEditDesc(role.description || '');

    // Clone or initialize app_menu_matrix
    let roleMatrix = role.app_menu_matrix ? JSON.parse(JSON.stringify(role.app_menu_matrix)) : {};
    if (!roleMatrix.dashboard) roleMatrix.dashboard = {};
    if (!roleMatrix.business) roleMatrix.business = {};
    if (!roleMatrix.task) roleMatrix.task = {};
    if (!roleMatrix.more) roleMatrix.more = { operations_services: {}, human_resources: {}, enterprise_administration: {} };
    if (!roleMatrix.more.operations_services) roleMatrix.more.operations_services = {};
    if (!roleMatrix.more.human_resources) roleMatrix.more.human_resources = {};
    if (!roleMatrix.more.enterprise_administration) roleMatrix.more.enterprise_administration = {};

    setMatrix(roleMatrix);
    setActiveMenuTab(initialTab);

    // Fetch assigned users
    setLoadingUsers(true);
    try {
      const uList = await api.get<any[]>(`/roles/${role.id || role.role_id}/users`);
      setAssignedUsers(uList);
    } catch {
      setAssignedUsers([]);
    } finally {
      setLoadingUsers(false);
    }
  };

  // Helper to check if a specific action is active for an item
  const isActionActive = (item: any, actKey: ActionKey): boolean => {
    if (!item) return false;
    if (typeof item[actKey] === 'boolean') return item[actKey];
    if (Array.isArray(item.actions)) return item.actions.includes(actKey);
    // Legacy fallback for old records with { view, write }
    if (actKey === 'view' || actKey === 'search') return !!item.view;
    if (['add', 'edit', 'delete', 'share', 'export'].includes(actKey)) return !!item.write;
    return false;
  };

  // Toggle single action on Menu item
  const toggleItemAction = (menuType: 'dashboard' | 'business' | 'task', key: string, actKey: ActionKey) => {
    setMatrix((prev: any) => {
      const copy = JSON.parse(JSON.stringify(prev || {}));
      if (!copy[menuType]) copy[menuType] = {};
      const current = copy[menuType][key] || {};
      const nextActive = !isActionActive(current, actKey);

      const nextActions: Record<string, boolean> = {};
      STANDARD_ACTIONS.forEach(a => {
        nextActions[a.key] = a.key === actKey ? nextActive : isActionActive(current, a.key);
      });

      // Enabling any action auto-enables view
      if (actKey !== 'view' && nextActive) {
        nextActions.view = true;
      }
      // Disabling view turns off all other actions
      if (actKey === 'view' && !nextActive) {
        STANDARD_ACTIONS.forEach(a => { nextActions[a.key] = false; });
      }

      const hasWrite = !!(nextActions.add || nextActions.edit || nextActions.delete);

      copy[menuType][key] = {
        ...nextActions,
        write: hasWrite,
        actions: STANDARD_ACTIONS.filter(a => nextActions[a.key]).map(a => a.key),
      };
      return copy;
    });
  };

  // Toggle single action on More Screen item
  const toggleMoreItemAction = (secKey: string, key: string, actKey: ActionKey) => {
    setMatrix((prev: any) => {
      const copy = JSON.parse(JSON.stringify(prev || {}));
      if (!copy.more) copy.more = {};
      if (!copy.more[secKey]) copy.more[secKey] = {};
      const current = copy.more[secKey][key] || {};
      const nextActive = !isActionActive(current, actKey);

      const nextActions: Record<string, boolean> = {};
      STANDARD_ACTIONS.forEach(a => {
        nextActions[a.key] = a.key === actKey ? nextActive : isActionActive(current, a.key);
      });

      if (actKey !== 'view' && nextActive) {
        nextActions.view = true;
      }
      if (actKey === 'view' && !nextActive) {
        STANDARD_ACTIONS.forEach(a => { nextActions[a.key] = false; });
      }

      const hasWrite = !!(nextActions.add || nextActions.edit || nextActions.delete);

      copy.more[secKey][key] = {
        ...nextActions,
        write: hasWrite,
        actions: STANDARD_ACTIONS.filter(a => nextActions[a.key]).map(a => a.key),
      };
      return copy;
    });
  };

  // Set all actions for an item (All or None)
  const setItemAllActions = (menuType: 'dashboard' | 'business' | 'task', key: string, enableAll: boolean) => {
    setMatrix((prev: any) => {
      const copy = JSON.parse(JSON.stringify(prev || {}));
      if (!copy[menuType]) copy[menuType] = {};
      const nextActions: Record<string, boolean> = {};
      STANDARD_ACTIONS.forEach(a => {
        nextActions[a.key] = enableAll;
      });
      copy[menuType][key] = {
        ...nextActions,
        write: enableAll,
        actions: enableAll ? STANDARD_ACTIONS.map(a => a.key) : [],
      };
      return copy;
    });
  };

  const setItemReadOnly = (menuType: 'dashboard' | 'business' | 'task', key: string) => {
    setMatrix((prev: any) => {
      const copy = JSON.parse(JSON.stringify(prev || {}));
      if (!copy[menuType]) copy[menuType] = {};
      const nextActions: Record<string, boolean> = {
        view: true,
        add: false,
        search: true,
        edit: false,
        delete: false,
        share: false,
        export: false,
      };
      copy[menuType][key] = {
        ...nextActions,
        write: false,
        actions: ['view', 'search'],
      };
      return copy;
    });
  };

  const setMoreItemAllActions = (secKey: string, key: string, enableAll: boolean) => {
    setMatrix((prev: any) => {
      const copy = JSON.parse(JSON.stringify(prev || {}));
      if (!copy.more) copy.more = {};
      if (!copy.more[secKey]) copy.more[secKey] = {};
      const nextActions: Record<string, boolean> = {};
      STANDARD_ACTIONS.forEach(a => {
        nextActions[a.key] = enableAll;
      });
      copy.more[secKey][key] = {
        ...nextActions,
        write: enableAll,
        actions: enableAll ? STANDARD_ACTIONS.map(a => a.key) : [],
      };
      return copy;
    });
  };

  const setMoreItemReadOnly = (secKey: string, key: string) => {
    setMatrix((prev: any) => {
      const copy = JSON.parse(JSON.stringify(prev || {}));
      if (!copy.more) copy.more = {};
      if (!copy.more[secKey]) copy.more[secKey] = {};
      const nextActions: Record<string, boolean> = {
        view: true,
        add: false,
        search: true,
        edit: false,
        delete: false,
        share: false,
        export: false,
      };
      copy.more[secKey][key] = {
        ...nextActions,
        write: false,
        actions: ['view', 'search'],
      };
      return copy;
    });
  };

  // Section Level Quick Action Setters
  const setSectionPowers = (menuType: 'dashboard' | 'business' | 'task', enableAll: boolean, isReadOnly: boolean = false) => {
    const items = FOUR_MENU_STRUCTURE[menuType].items;
    setMatrix((prev: any) => {
      const copy = JSON.parse(JSON.stringify(prev || {}));
      if (!copy[menuType]) copy[menuType] = {};
      items.forEach(it => {
        const nextActions: Record<string, boolean> = {};
        STANDARD_ACTIONS.forEach(a => {
          if (isReadOnly) {
            nextActions[a.key] = (a.key === 'view' || a.key === 'search');
          } else {
            nextActions[a.key] = enableAll;
          }
        });
        copy[menuType][it.key] = {
          ...nextActions,
          write: isReadOnly ? false : enableAll,
          actions: isReadOnly ? ['view', 'search'] : enableAll ? STANDARD_ACTIONS.map(a => a.key) : [],
        };
      });
      return copy;
    });
  };

  const setMoreSectionPowers = (secKey: string, items: any[], enableAll: boolean, isReadOnly: boolean = false) => {
    setMatrix((prev: any) => {
      const copy = JSON.parse(JSON.stringify(prev || {}));
      if (!copy.more) copy.more = {};
      if (!copy.more[secKey]) copy.more[secKey] = {};
      items.forEach(it => {
        const nextActions: Record<string, boolean> = {};
        STANDARD_ACTIONS.forEach(a => {
          if (isReadOnly) {
            nextActions[a.key] = (a.key === 'view' || a.key === 'search');
          } else {
            nextActions[a.key] = enableAll;
          }
        });
        copy.more[secKey][it.key] = {
          ...nextActions,
          write: isReadOnly ? false : enableAll,
          actions: isReadOnly ? ['view', 'search'] : enableAll ? STANDARD_ACTIONS.map(a => a.key) : [],
        };
      });
      return copy;
    });
  };

  // Global Quick Action Setters
  const grantFullPowersAll = () => {
    setSectionPowers('dashboard', true, false);
    setSectionPowers('business', true, false);
    setSectionPowers('task', true, false);
    FOUR_MENU_STRUCTURE.more.sections.forEach(sec => {
      setMoreSectionPowers(sec.section_key, sec.items as any, true, false);
    });
  };

  const setAllReadOnly = () => {
    setSectionPowers('dashboard', false, true);
    setSectionPowers('business', false, true);
    setSectionPowers('task', false, true);
    FOUR_MENU_STRUCTURE.more.sections.forEach(sec => {
      setMoreSectionPowers(sec.section_key, sec.items as any, false, true);
    });
  };

  // Save Role Matrix to Server
  const saveRoleMatrix = async () => {
    if (!editingRole) return;
    if (editingRole.role_id === 'super_admin' && !isSuperAdmin) {
      Alert.alert('Permission Denied', 'Only Super Admin can modify the Super Admin role.');
      return;
    }

    setSavingRole(true);
    try {
      // Derive allowed_menus array from matrix for backwards compatibility
      const derivedAllowedMenus: string[] = [];
      // business
      if (matrix?.business?.customers?.view) derivedAllowedMenus.push('customers');
      if (matrix?.business?.accounts?.view) derivedAllowedMenus.push('sales_invoices', 'accounting_reports', 'cash_bank');
      // task
      if (matrix?.task?.task_followup?.view || matrix?.task?.payment_followup?.view) derivedAllowedMenus.push('tasks');
      // more
      FOUR_MENU_STRUCTURE.more.sections.forEach(sec => {
        sec.items.forEach(it => {
          if (matrix?.more?.[sec.section_key]?.[it.key]?.view) {
            derivedAllowedMenus.push(it.key);
          }
        });
      });

      const payload: any = {
        name: editName.trim() || editingRole.name,
        description: editDesc.trim(),
        app_menu_matrix: matrix,
        allowed_menus: Array.from(new Set(derivedAllowedMenus)),
      };

      await api.put(`/roles/${editingRole.id || editingRole.role_id}`, payload);
      notify(`Role "${payload.name}" powers & matrix saved successfully!`);
      setEditingRole(null);
      await load();

      if (currentUser?.role === editingRole.role_id || currentUser?.role_id === editingRole.role_id) {
        await refreshAuth();
      }
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to save role matrix');
    } finally {
      setSavingRole(false);
    }
  };

  // Assign user to role
  const openAssignUserModal = async () => {
    try {
      const uList = await api.get<any[]>('/manage-users');
      setAllUsers(uList);
      setUserSearchQuery('');
      setShowAssignModal(true);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to load system users');
    }
  };

  const handleAssignUser = async (userToAssign: any) => {
    if (!editingRole) return;
    setAssigningUser(true);
    try {
      await api.post(`/roles/${editingRole.id || editingRole.role_id}/assign-user`, {
        user_id: userToAssign.user_id,
      });
      notify(`${userToAssign.name} assigned to ${editingRole.name}!`);
      setShowAssignModal(false);

      const uList = await api.get<any[]>(`/roles/${editingRole.id || editingRole.role_id}/users`);
      setAssignedUsers(uList);
      await load();
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to assign user');
    } finally {
      setAssigningUser(false);
    }
  };

  const handleRemoveUserFromRole = async (u: any) => {
    if (!editingRole) return;
    const confirmAction = async () => {
      try {
        await api.post(`/roles/${editingRole.id || editingRole.role_id}/remove-user`, {
          user_id: u.user_id,
        });
        notify(`${u.name} removed from ${editingRole.name} (reset to Employee)`);
        const uList = await api.get<any[]>(`/roles/${editingRole.id || editingRole.role_id}/users`);
        setAssignedUsers(uList);
        await load();
      } catch (e: any) {
        Alert.alert('Error', e?.message || 'Failed to remove user from role');
      }
    };

    if (Platform.OS === 'web') {
      if (window.confirm(`Remove ${u.name} from ${editingRole.name}? Role will reset to Employee.`)) {
        await confirmAction();
      }
    } else {
      Alert.alert('Remove User', `Remove ${u.name} from ${editingRole.name}? Role will reset to Employee.`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: confirmAction },
      ]);
    }
  };

  // Delete Custom Role
  const handleDeleteRole = (role: any) => {
    if (role.is_system) {
      Alert.alert('Action Not Allowed', 'System default roles cannot be deleted.');
      return;
    }

    const doDelete = async () => {
      try {
        await api.del(`/roles/${role.id || role.role_id}`);
        notify(`Role "${role.name}" deleted.`);
        await load();
      } catch (e: any) {
        Alert.alert('Error', e?.message || 'Failed to delete role');
      }
    };

    if (Platform.OS === 'web') {
      if (window.confirm(`Delete custom role "${role.name}"?`)) doDelete();
    } else {
      Alert.alert('Delete Role', `Delete custom role "${role.name}"?`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: doDelete },
      ]);
    }
  };

  // Create Custom Role
  const saveCustomRole = async () => {
    if (!newRoleName.trim()) {
      Alert.alert('Validation', 'Role Name is required');
      return;
    }
    setBusy(true);
    try {
      const baseRole = roles?.find(r => r.role_id === cloneFromRoleId) || roles?.find(r => r.role_id === 'employee');
      const clonedMatrix = baseRole?.app_menu_matrix ? JSON.parse(JSON.stringify(baseRole.app_menu_matrix)) : {};
      const clonedPerms = baseRole?.permissions ? JSON.parse(JSON.stringify(baseRole.permissions)) : {};
      const clonedMenus = baseRole?.allowed_menus ? [...baseRole.allowed_menus] : ['tasks', 'attendance_leaves', 'documents'];

      await api.post('/roles', {
        name: newRoleName.trim(),
        description: newRoleDesc.trim(),
        permissions: clonedPerms,
        allowed_menus: clonedMenus,
        app_menu_matrix: clonedMatrix,
      });

      notify(`Custom role "${newRoleName.trim()}" created successfully!`);
      setShowCreateModal(false);
      setNewRoleName('');
      setNewRoleDesc('');
      await load();
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to create role');
    } finally {
      setBusy(false);
    }
  };

  // Filtered Roles
  const filteredRoles = (roles || []).filter(r => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      r.name?.toLowerCase().includes(q) ||
      r.role_id?.toLowerCase().includes(q) ||
      r.description?.toLowerCase().includes(q)
    );
  });

  // Filtered Staff Users
  const filteredStaffUsers = (staffUsers || []).filter(u => {
    if (!staffSearchQuery.trim()) return true;
    const q = staffSearchQuery.trim().toLowerCase();
    return (
      u.name?.toLowerCase().includes(q) ||
      u.email?.toLowerCase().includes(q) ||
      u.username?.toLowerCase().includes(q) ||
      u.mobile?.toLowerCase().includes(q) ||
      u.pan?.toLowerCase().includes(q) ||
      u.aadhar?.toLowerCase().includes(q) ||
      u.employee_code?.toLowerCase().includes(q) ||
      u.branch_name?.toLowerCase().includes(q) ||
      u.post_title?.toLowerCase().includes(q) ||
      u.role_name?.toLowerCase().includes(q) ||
      u.role?.toLowerCase().includes(q) ||
      u.user_id?.toLowerCase().includes(q)
    );
  });

  // Render Granular Action Item Card for Dashboard, Business, Task
  const renderMenuItemCard = (menuType: 'dashboard' | 'business' | 'task', it: any) => {
    const itemState = matrix?.[menuType]?.[it.key] || {};
    const activeCount = STANDARD_ACTIONS.filter(act => isActionActive(itemState, act.key)).length;
    const isViewActive = isActionActive(itemState, 'view');

    return (
      <View key={it.key} style={[styles.itemCard, isViewActive && styles.itemCardActive]}>
        {/* Card Header: Icon, Title, Description, and Active Count Badge */}
        <View style={styles.itemHeader}>
          <View style={[styles.itemIconBg, isViewActive ? { backgroundColor: colors.brandPrimary } : { backgroundColor: '#E2E8F0' }]}>
            <Ionicons name={it.icon as any} size={20} color={isViewActive ? '#FFFFFF' : '#64748B'} />
          </View>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
              <Text style={[styles.itemTitle, isViewActive && styles.itemTitleActive]}>{it.title}</Text>
              <View style={[
                styles.actionCountBadge,
                activeCount === 7 ? styles.actionCountBadgeFull : activeCount > 0 ? styles.actionCountBadgeActive : styles.actionCountBadgeInactive
              ]}>
                <Ionicons
                  name={activeCount === 7 ? 'shield-checkmark' : activeCount > 0 ? 'checkmark-circle' : 'close-circle'}
                  size={12}
                  color={activeCount === 7 ? '#15803D' : activeCount > 0 ? '#0369A1' : '#64748B'}
                />
                <Text style={[
                  styles.actionCountBadgeText,
                  activeCount === 7 ? styles.actionCountTextFull : activeCount > 0 ? styles.actionCountTextActive : styles.actionCountTextInactive
                ]}>
                  {activeCount === 7 ? 'Full Power (7/7)' : activeCount > 0 ? `${activeCount}/7 Actions` : 'No Access (0/7)'}
                </Text>
              </View>
            </View>
            <Text style={styles.itemDesc}>{it.description}</Text>
          </View>
        </View>

        {/* Action Pills Container with Quick Micro-Toggles */}
        <View style={styles.actionPillsContainer}>
          <View style={styles.actionPillsHeader}>
            <Text style={styles.actionPillsLabel}>GRANULAR ACTIONS / RIGHTS:</Text>
            <View style={styles.microBtnRow}>
              <Pressable
                style={styles.itemMicroBtn}
                onPress={() => setItemAllActions(menuType, it.key, true)}
                testID={`btn-${it.key}-all`}
              >
                <Text style={styles.itemMicroBtnText}>All (7)</Text>
              </Pressable>
              <Pressable
                style={styles.itemMicroBtn}
                onPress={() => setItemReadOnly(menuType, it.key)}
                testID={`btn-${it.key}-readonly`}
              >
                <Text style={styles.itemMicroBtnText}>Read-Only</Text>
              </Pressable>
              <Pressable
                style={styles.itemMicroBtn}
                onPress={() => setItemAllActions(menuType, it.key, false)}
                testID={`btn-${it.key}-none`}
              >
                <Text style={styles.itemMicroBtnText}>None</Text>
              </Pressable>
            </View>
          </View>

          {/* 7 Clickable Action Pills: View, Add, Search, Edit, Delete, Share, Export */}
          <View style={styles.actionPillsRow}>
            {STANDARD_ACTIONS.map(act => {
              const active = isActionActive(itemState, act.key);
              return (
                <Pressable
                  key={act.key}
                  style={[
                    styles.actionPill,
                    active
                      ? { backgroundColor: act.activeBg, borderColor: act.activeBorder }
                      : styles.actionPillInactive
                  ]}
                  onPress={() => toggleItemAction(menuType, it.key, act.key)}
                  testID={`btn-${it.key}-${act.key}`}
                >
                  <Ionicons
                    name={act.icon as any}
                    size={14}
                    color={active ? act.activeColor : '#94A3B8'}
                  />
                  <Text
                    style={[
                      styles.actionPillText,
                      active ? { color: act.activeColor, fontWeight: '700' } : styles.actionPillTextInactive
                    ]}
                  >
                    {act.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>
    );
  };

  // Render Granular Action Item Card for More Screen sections
  const renderMoreItemCard = (secKey: string, it: any) => {
    const itemState = matrix?.more?.[secKey]?.[it.key] || {};
    const activeCount = STANDARD_ACTIONS.filter(act => isActionActive(itemState, act.key)).length;
    const isViewActive = isActionActive(itemState, 'view');

    return (
      <View key={it.key} style={[styles.itemCard, isViewActive && styles.itemCardActive]}>
        {/* Card Header: Icon, Title, Description, and Active Count Badge */}
        <View style={styles.itemHeader}>
          <View style={[styles.itemIconBg, isViewActive ? { backgroundColor: colors.brandPrimary } : { backgroundColor: '#E2E8F0' }]}>
            <Ionicons name={it.icon as any} size={18} color={isViewActive ? '#FFFFFF' : '#64748B'} />
          </View>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
              <Text style={[styles.itemTitle, isViewActive && styles.itemTitleActive]}>{it.title}</Text>
              <View style={[
                styles.actionCountBadge,
                activeCount === 7 ? styles.actionCountBadgeFull : activeCount > 0 ? styles.actionCountBadgeActive : styles.actionCountBadgeInactive
              ]}>
                <Ionicons
                  name={activeCount === 7 ? 'shield-checkmark' : activeCount > 0 ? 'checkmark-circle' : 'close-circle'}
                  size={12}
                  color={activeCount === 7 ? '#15803D' : activeCount > 0 ? '#0369A1' : '#64748B'}
                />
                <Text style={[
                  styles.actionCountBadgeText,
                  activeCount === 7 ? styles.actionCountTextFull : activeCount > 0 ? styles.actionCountTextActive : styles.actionCountTextInactive
                ]}>
                  {activeCount === 7 ? 'Full Power (7/7)' : activeCount > 0 ? `${activeCount}/7 Actions` : 'No Access (0/7)'}
                </Text>
              </View>
            </View>
            <Text style={styles.itemDesc}>{it.description}</Text>
          </View>
        </View>

        {/* Action Pills Container with Quick Micro-Toggles */}
        <View style={styles.actionPillsContainer}>
          <View style={styles.actionPillsHeader}>
            <Text style={styles.actionPillsLabel}>GRANULAR ACTIONS / RIGHTS:</Text>
            <View style={styles.microBtnRow}>
              <Pressable
                style={styles.itemMicroBtn}
                onPress={() => setMoreItemAllActions(secKey, it.key, true)}
                testID={`btn-${secKey}-${it.key}-all`}
              >
                <Text style={styles.itemMicroBtnText}>All (7)</Text>
              </Pressable>
              <Pressable
                style={styles.itemMicroBtn}
                onPress={() => setMoreItemReadOnly(secKey, it.key)}
                testID={`btn-${secKey}-${it.key}-readonly`}
              >
                <Text style={styles.itemMicroBtnText}>Read-Only</Text>
              </Pressable>
              <Pressable
                style={styles.itemMicroBtn}
                onPress={() => setMoreItemAllActions(secKey, it.key, false)}
                testID={`btn-${secKey}-${it.key}-none`}
              >
                <Text style={styles.itemMicroBtnText}>None</Text>
              </Pressable>
            </View>
          </View>

          {/* 7 Clickable Action Pills: View, Add, Search, Edit, Delete, Share, Export */}
          <View style={styles.actionPillsRow}>
            {STANDARD_ACTIONS.map(act => {
              const active = isActionActive(itemState, act.key);
              return (
                <Pressable
                  key={act.key}
                  style={[
                    styles.actionPill,
                    active
                      ? { backgroundColor: act.activeBg, borderColor: act.activeBorder }
                      : styles.actionPillInactive
                  ]}
                  onPress={() => toggleMoreItemAction(secKey, it.key, act.key)}
                  testID={`btn-${secKey}-${it.key}-${act.key}`}
                >
                  <Ionicons
                    name={act.icon as any}
                    size={14}
                    color={active ? act.activeColor : '#94A3B8'}
                  />
                  <Text
                    style={[
                      styles.actionPillText,
                      active ? { color: act.activeColor, fontWeight: '700' } : styles.actionPillTextInactive
                    ]}
                  >
                    {act.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>
    );
  };

  if (!isAdmin) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Roles & Permissions (RBAC)" />
        <View style={styles.deniedBox}>
          <Ionicons name="shield-outline" size={64} color={colors.error} />
          <Text style={styles.deniedTitle}>Access Restricted</Text>
          <Text style={styles.deniedText}>
            Only "Admin" and "Super Admin" can configure employee permissions, power assignments, and dashboard menu matrices.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScreenHeader
        title="Roles & Permissions (RBAC)"
        subtitle="Customise 4-Menu Role Matrix & Individual Employee Rights"
        right={
          activeViewMode === 'roles' ? (
            <Pressable onPress={() => setShowCreateModal(true)} style={styles.addButton} testID="btn-add-role">
              <Ionicons name="add" size={24} color={colors.onBrandPrimary} />
            </Pressable>
          ) : null
        }
      />

      {/* Admin Notice Ribbon */}
      <View style={styles.adminBanner}>
        <Ionicons name="shield-checkmark" size={20} color={colors.brandPrimary} />
        <Text style={styles.adminBannerText}>
          <Text style={{ fontWeight: '800' }}>Admin & Super Admin Power Control: </Text>
          {activeViewMode === 'roles'
            ? 'Har employee role ke liye decide karen ki Dashboard, Business, Task, aur More section ke andar kis menu ko View (Dikhna) aur Write (Naya Entry/Edit/Delete Power) dena hai.'
            : 'Individual employee/user ke dashboard me kya dikhega aur unhe kya write powers milenge, use yahan se direct customize karen ya Role Default par reset karen.'}
        </Text>
      </View>

      {/* Top Segmented Mode Switcher */}
      <View style={styles.modeSwitcherContainer}>
        <Pressable
          style={[styles.modeSwitchBtn, activeViewMode === 'roles' && styles.modeSwitchBtnActive]}
          onPress={() => setActiveViewMode('roles')}
          testID="tab-roles-matrix"
        >
          <Ionicons
            name="shield-checkmark"
            size={18}
            color={activeViewMode === 'roles' ? '#FFFFFF' : colors.brandPrimary}
          />
          <Text style={[styles.modeSwitchText, activeViewMode === 'roles' && styles.modeSwitchTextActive]}>
            (1) Roles Matrix {roles ? `(${roles.length})` : ''}
          </Text>
        </Pressable>

        <Pressable
          style={[styles.modeSwitchBtn, activeViewMode === 'users' && styles.modeSwitchBtnActive]}
          onPress={() => setActiveViewMode('users')}
          testID="tab-user-permissions"
        >
          <Ionicons
            name="people"
            size={18}
            color={activeViewMode === 'users' ? '#FFFFFF' : colors.brandPrimary}
          />
          <Text style={[styles.modeSwitchText, activeViewMode === 'users' && styles.modeSwitchTextActive]}>
            (2) User Permissions & Dashboard Menus {staffUsers ? `(${staffUsers.length})` : ''}
          </Text>
        </Pressable>
      </View>

      {/* VIEW MODE 1: ROLES MATRIX */}
      {activeViewMode === 'roles' && (
        <>
          {/* Search Roles Input */}
          <View style={styles.searchBox}>
            <Ionicons name="search" size={18} color={colors.muted} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search roles (e.g. Accountant, Branch Manager, Supervisor)..."
              placeholderTextColor={colors.muted}
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
            {searchQuery ? (
              <Pressable onPress={() => setSearchQuery('')}>
                <Ionicons name="close-circle" size={18} color={colors.muted} />
              </Pressable>
            ) : null}
          </View>

          {roles === null ? (
            <ScreenLoader />
          ) : (
            <FlatList
              data={filteredRoles}
              keyExtractor={item => item.id || item.role_id}
              contentContainerStyle={styles.listContent}
              renderItem={({ item }) => {
                const isSuper = item.role_id === 'super_admin';

                return (
                  <Card style={styles.roleCard}>
                    <View style={styles.cardHeader}>
                      <View style={[styles.roleIcon, isSuper && { backgroundColor: '#FEE2E2' }]}>
                        <Ionicons
                          name={isSuper ? 'shield-sharp' : 'shield-checkmark'}
                          size={24}
                          color={isSuper ? '#DC2626' : colors.brandPrimary}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <Text style={styles.roleName}>{item.name}</Text>
                          {item.is_system ? (
                            <View style={styles.systemBadge}>
                              <Text style={styles.systemBadgeText}>SYSTEM</Text>
                            </View>
                          ) : (
                            <View style={[styles.systemBadge, { backgroundColor: '#E0E7FF' }]}>
                              <Text style={[styles.systemBadgeText, { color: '#4338CA' }]}>CUSTOM</Text>
                            </View>
                          )}
                        </View>
                        <Text style={styles.roleIdText}>Role ID: {item.role_id}</Text>
                        <Text style={styles.roleDesc} numberOfLines={2}>
                          {item.description || 'Employee role with configured power matrix'}
                        </Text>
                      </View>

                      {!item.is_system && (
                        <Pressable onPress={() => handleDeleteRole(item)} style={styles.deleteRoleBtn} hitSlop={8}>
                          <Ionicons name="trash-outline" size={18} color={colors.error} />
                        </Pressable>
                      )}
                    </View>

                    {/* 4 Menu Power Summary Badges */}
                    <View style={styles.fourMenuPillRow}>
                      <View style={styles.menuPill}>
                        <Ionicons name="grid-outline" size={12} color="#0284C7" />
                        <Text style={styles.menuPillText}>Dashboard</Text>
                      </View>
                      <View style={styles.menuPill}>
                        <Ionicons name="briefcase-outline" size={12} color="#059669" />
                        <Text style={styles.menuPillText}>Business</Text>
                      </View>
                      <View style={styles.menuPill}>
                        <Ionicons name="checkmark-done-outline" size={12} color="#7C3AED" />
                        <Text style={styles.menuPillText}>Task</Text>
                      </View>
                      <View style={styles.menuPill}>
                        <Ionicons name="ellipsis-horizontal-circle-outline" size={12} color="#D97706" />
                        <Text style={styles.menuPillText}>More</Text>
                      </View>
                      <Pressable style={styles.usersPill} onPress={() => openRoleEditor(item, 'users')}>
                        <Ionicons name="people" size={12} color="#0F766E" />
                        <Text style={styles.usersPillText}>{item.users_count || 0} Staff</Text>
                      </Pressable>
                    </View>

                    {/* Customise Matrix Action Button */}
                    <Pressable
                      style={styles.customiseBtn}
                      onPress={() => openRoleEditor(item, 'dashboard')}
                      testID={`customise-role-${item.role_id}`}
                    >
                      <Ionicons name="options-outline" size={18} color={colors.onBrandPrimary} />
                      <Text style={styles.customiseBtnText}>Customise 4-Menu Role Matrix (View & Write Powers)</Text>
                    </Pressable>
                  </Card>
                );
              }}
            />
          )}
        </>
      )}

      {/* VIEW MODE 2: USER PERMISSIONS & DASHBOARD MENUS */}
      {activeViewMode === 'users' && (
        <>
          {/* Search Staff Users Input */}
          <View style={styles.searchBox}>
            <Ionicons name="search" size={18} color={colors.muted} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search staff by Name, Mobile, PAN, Aadhar, Email, Branch, Post..."
              placeholderTextColor={colors.muted}
              value={staffSearchQuery}
              onChangeText={setStaffSearchQuery}
            />
            {staffSearchQuery ? (
              <Pressable onPress={() => setStaffSearchQuery('')}>
                <Ionicons name="close-circle" size={18} color={colors.muted} />
              </Pressable>
            ) : null}
          </View>

          {staffUsers === null ? (
            <ScreenLoader />
          ) : filteredStaffUsers.length === 0 ? (
            <Card style={{ margin: spacing.lg, padding: spacing.xl, alignItems: 'center' }}>
              <Ionicons name="search-outline" size={42} color={colors.muted} />
              <Text style={{ marginTop: 8, fontSize: font.sm, fontWeight: '700', color: colors.muted }}>
                No employees matching search criteria
              </Text>
            </Card>
          ) : (
            <FlatList
              data={filteredStaffUsers}
              keyExtractor={item => item.user_id}
              contentContainerStyle={styles.listContent}
              renderItem={({ item }) => {
                const isCustom = item.app_menu_matrix && Object.keys(item.app_menu_matrix).length > 0;
                const isSuper = item.role_id === 'super_admin' || item.role === 'super_admin';

                return (
                  <Card style={styles.roleCard}>
                    <View style={styles.cardHeader}>
                      <View
                        style={[
                          styles.roleIcon,
                          isCustom
                            ? { backgroundColor: '#DCFCE7' }
                            : isSuper
                            ? { backgroundColor: '#FEE2E2' }
                            : { backgroundColor: colors.brandPrimary + '15' },
                        ]}
                      >
                        <Ionicons
                          name={isCustom ? 'flash' : isSuper ? 'shield-sharp' : 'person'}
                          size={22}
                          color={isCustom ? '#16A34A' : isSuper ? '#DC2626' : colors.brandPrimary}
                        />
                      </View>

                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <Text style={styles.roleName}>{item.name}</Text>
                          {isCustom ? (
                            <View style={styles.customBadge}>
                              <Ionicons name="flash" size={10} color="#15803D" />
                              <Text style={styles.customBadgeText}>CUSTOM POWERS SET</Text>
                            </View>
                          ) : (
                            <View style={styles.defaultBadge}>
                              <Text style={styles.defaultBadgeText}>ROLE DEFAULT</Text>
                            </View>
                          )}
                        </View>

                        <Text style={styles.roleIdText}>
                          {item.email} {item.mobile ? `• ${item.mobile}` : ''}
                        </Text>
                        <Text style={styles.roleDesc} numberOfLines={1}>
                          ID: {item.user_id} {item.employee_code ? `• Code: ${item.employee_code}` : ''}
                        </Text>
                      </View>
                    </View>

                    {/* Metadata Badges: Branch, Post, Role, PAN, Aadhar */}
                    <View style={styles.fourMenuPillRow}>
                      <View style={styles.menuPill}>
                        <Ionicons name="business-outline" size={12} color={colors.brandPrimary} />
                        <Text style={styles.menuPillText}>{item.branch_name || 'No Branch'}</Text>
                      </View>
                      <View style={styles.menuPill}>
                        <Ionicons name="briefcase-outline" size={12} color={colors.brandSecondary} />
                        <Text style={styles.menuPillText}>{item.post_title || 'No Post'}</Text>
                      </View>
                      <View style={[styles.menuPill, { backgroundColor: '#EFF6FF', borderColor: '#BFDBFE' }]}>
                        <Ionicons name="shield-checkmark-outline" size={12} color="#2563EB" />
                        <Text style={[styles.menuPillText, { color: '#1D4ED8', fontWeight: '800' }]}>
                          {item.role_name || item.role}
                        </Text>
                      </View>
                      {item.pan ? (
                        <View style={[styles.menuPill, { backgroundColor: '#F0FDF4', borderColor: '#BBF7D0' }]}>
                          <Text style={[styles.menuPillText, { color: '#15803D', fontWeight: '800' }]}>
                            PAN: {item.pan}
                          </Text>
                        </View>
                      ) : null}
                      {item.aadhar ? (
                        <View style={[styles.menuPill, { backgroundColor: '#FAF5FF', borderColor: '#E9D5FF' }]}>
                          <Text style={[styles.menuPillText, { color: '#7E22CE', fontWeight: '700' }]}>
                            Aadhar: {item.aadhar}
                          </Text>
                        </View>
                      ) : null}
                    </View>

                    {/* Actions: Customise Permissions and Optional Reset */}
                    <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
                      <Pressable
                        style={[styles.customiseBtn, { flex: 1 }]}
                        onPress={() => openUserEditor(item)}
                        testID={`btn-customise-user-${item.user_id}`}
                      >
                        <Ionicons name="options-outline" size={16} color={colors.onBrandPrimary} />
                        <Text style={styles.customiseBtnText}>Customise Dashboard Menus & Powers</Text>
                      </Pressable>

                      {isCustom && (
                        <Pressable
                          style={styles.resetBtn}
                          onPress={() => resetUserPowersToDefault(item)}
                          testID={`btn-reset-user-${item.user_id}`}
                        >
                          <Ionicons name="refresh-outline" size={16} color="#DC2626" />
                          <Text style={styles.resetBtnText}>Reset</Text>
                        </Pressable>
                      )}
                    </View>
                  </Card>
                );
              }}
            />
          )}
        </>
      )}

      {/* ========================================================================= */}
      {/* 4-MENU ROLE / USER MATRIX CUSTOMISATION MODAL                             */}
      {/* ========================================================================= */}
      <Modal visible={!!editingRole || !!editingUser} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBox, { height: '94%' }]}>
            {/* Modal Header */}
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <Text style={styles.modalTitle}>
                    {editingUser ? `👤 ${editingUser?.name}` : editingRole?.name}
                  </Text>
                  {editingUser ? (
                    <View style={editingUserPerms?.is_custom ? styles.customBadge : styles.defaultBadge}>
                      <Text style={editingUserPerms?.is_custom ? styles.customBadgeText : styles.defaultBadgeText}>
                        {editingUserPerms?.is_custom ? 'CUSTOM OVERRIDE' : 'ROLE DEFAULT'}
                      </Text>
                    </View>
                  ) : (
                    <View style={styles.systemBadge}>
                      <Text style={styles.systemBadgeText}>{editingRole?.is_system ? 'SYSTEM' : 'CUSTOM'}</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.subText}>
                  {editingUser
                    ? `Role: ${editingUser?.role_name || editingUser?.role_id} • Control Dashboard Menus & Write Powers`
                    : `Role ID: ${editingRole?.role_id} • Control View & Write Powers`}
                </Text>
              </View>
              <Pressable
                onPress={() => {
                  setEditingRole(null);
                  setEditingUser(null);
                  setEditingUserPerms(null);
                }}
                hitSlop={10}
              >
                <Ionicons name="close-circle" size={28} color={colors.muted} />
              </Pressable>
            </View>

            {/* Top 4 Types of Menu Tab Bar */}
            <View style={styles.fourTabBar}>
              <Pressable
                style={[styles.fourTabItem, activeMenuTab === 'dashboard' && styles.fourTabItemActive]}
                onPress={() => setActiveMenuTab('dashboard')}
              >
                <Ionicons name="grid" size={15} color={activeMenuTab === 'dashboard' ? colors.brandPrimary : colors.muted} />
                <Text style={[styles.fourTabLabel, activeMenuTab === 'dashboard' && styles.fourTabLabelActive]}>(i) Dashboard</Text>
              </Pressable>

              <Pressable
                style={[styles.fourTabItem, activeMenuTab === 'business' && styles.fourTabItemActive]}
                onPress={() => setActiveMenuTab('business')}
              >
                <Ionicons name="briefcase" size={15} color={activeMenuTab === 'business' ? colors.brandPrimary : colors.muted} />
                <Text style={[styles.fourTabLabel, activeMenuTab === 'business' && styles.fourTabLabelActive]}>(ii) Business</Text>
              </Pressable>

              <Pressable
                style={[styles.fourTabItem, activeMenuTab === 'task' && styles.fourTabItemActive]}
                onPress={() => setActiveMenuTab('task')}
              >
                <Ionicons name="checkmark-done" size={15} color={activeMenuTab === 'task' ? colors.brandPrimary : colors.muted} />
                <Text style={[styles.fourTabLabel, activeMenuTab === 'task' && styles.fourTabLabelActive]}>(iii) Task</Text>
              </Pressable>

              <Pressable
                style={[styles.fourTabItem, activeMenuTab === 'more' && styles.fourTabItemActive]}
                onPress={() => setActiveMenuTab('more')}
              >
                <Ionicons name="ellipsis-horizontal-circle" size={15} color={activeMenuTab === 'more' ? colors.brandPrimary : colors.muted} />
                <Text style={[styles.fourTabLabel, activeMenuTab === 'more' && styles.fourTabLabelActive]}>(iv) More</Text>
              </Pressable>

              {!editingUser && (
                <Pressable
                  style={[styles.fourTabItem, activeMenuTab === 'users' && styles.fourTabItemActive]}
                  onPress={() => setActiveMenuTab('users')}
                >
                  <Ionicons name="people" size={15} color={activeMenuTab === 'users' ? colors.brandPrimary : colors.muted} />
                  <Text style={[styles.fourTabLabel, activeMenuTab === 'users' && styles.fourTabLabelActive]}>Users ({assignedUsers.length})</Text>
                </Pressable>
              )}
            </View>

            {/* Quick Action Ribbon */}
            {activeMenuTab !== 'users' && (
              <View style={styles.quickBar}>
                <Pressable style={styles.quickPill} onPress={grantFullPowersAll}>
                  <Ionicons name="checkmark-done-circle" size={14} color="#059669" />
                  <Text style={[styles.quickPillText, { color: '#059669' }]}>Full Power (View + Write All)</Text>
                </Pressable>
                <Pressable style={styles.quickPill} onPress={setAllReadOnly}>
                  <Ionicons name="lock-closed" size={14} color="#2563EB" />
                  <Text style={[styles.quickPillText, { color: '#2563EB' }]}>View Only (Read-Only All)</Text>
                </Pressable>
              </View>
            )}

            {/* TAB CONTENTS */}
            <ScrollView contentContainerStyle={styles.tabContentScroll} keyboardShouldPersistTaps="handled">
              {/* (i) DASHBOARD MENU */}
              {activeMenuTab === 'dashboard' && (
                <View style={{ gap: spacing.md }}>
                  <View style={styles.sectionHeadingBox}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.sectionHeadingTitle}>Menu (i) : Dashboard</Text>
                      <Text style={styles.sectionHeadingSub}>Configure rights for Financial Overview, Operations Metrics, Urgent Tenders & Quick Actions</Text>
                    </View>
                    <View style={{ flexDirection: 'row', gap: 6 }}>
                      <Pressable style={styles.miniBtn} onPress={() => setSectionPowers('dashboard', true, false)}>
                        <Text style={styles.miniBtnText}>All Power</Text>
                      </Pressable>
                      <Pressable style={styles.miniBtn} onPress={() => setSectionPowers('dashboard', false, true)}>
                        <Text style={styles.miniBtnText}>Read-Only</Text>
                      </Pressable>
                      <Pressable style={styles.miniBtn} onPress={() => setSectionPowers('dashboard', false, false)}>
                        <Text style={styles.miniBtnText}>Hide All</Text>
                      </Pressable>
                    </View>
                  </View>

                  {FOUR_MENU_STRUCTURE.dashboard.items.map(it => renderMenuItemCard('dashboard', it))}
                </View>
              )}

              {/* (ii) BUSINESS MENU */}
              {activeMenuTab === 'business' && (
                <View style={{ gap: spacing.md }}>
                  <View style={styles.sectionHeadingBox}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.sectionHeadingTitle}>Menu (ii) : Business</Text>
                      <Text style={styles.sectionHeadingSub}>Configure rights for "Customers" (Contractors Database) & "Accounts" (Vyapar Billing)</Text>
                    </View>
                    <View style={{ flexDirection: 'row', gap: 6 }}>
                      <Pressable style={styles.miniBtn} onPress={() => setSectionPowers('business', true, false)}>
                        <Text style={styles.miniBtnText}>All Power</Text>
                      </Pressable>
                      <Pressable style={styles.miniBtn} onPress={() => setSectionPowers('business', false, true)}>
                        <Text style={styles.miniBtnText}>Read-Only</Text>
                      </Pressable>
                      <Pressable style={styles.miniBtn} onPress={() => setSectionPowers('business', false, false)}>
                        <Text style={styles.miniBtnText}>Hide All</Text>
                      </Pressable>
                    </View>
                  </View>

                  {FOUR_MENU_STRUCTURE.business.items.map(it => renderMenuItemCard('business', it))}
                </View>
              )}

              {/* (iii) TASK MENU */}
              {activeMenuTab === 'task' && (
                <View style={{ gap: spacing.md }}>
                  <View style={styles.sectionHeadingBox}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.sectionHeadingTitle}>Menu (iii) : Task</Text>
                      <Text style={styles.sectionHeadingSub}>Configure rights for "Payment Followup" & "Task Follow up" (Client Service Stages)</Text>
                    </View>
                    <View style={{ flexDirection: 'row', gap: 6 }}>
                      <Pressable style={styles.miniBtn} onPress={() => setSectionPowers('task', true, false)}>
                        <Text style={styles.miniBtnText}>All Power</Text>
                      </Pressable>
                      <Pressable style={styles.miniBtn} onPress={() => setSectionPowers('task', false, true)}>
                        <Text style={styles.miniBtnText}>Read-Only</Text>
                      </Pressable>
                      <Pressable style={styles.miniBtn} onPress={() => setSectionPowers('task', false, false)}>
                        <Text style={styles.miniBtnText}>Hide All</Text>
                      </Pressable>
                    </View>
                  </View>

                  {FOUR_MENU_STRUCTURE.task.items.map(it => renderMenuItemCard('task', it))}
                </View>
              )}

              {/* (iv) MORE MENU */}
              {activeMenuTab === 'more' && (
                <View style={{ gap: spacing.lg }}>
                  {FOUR_MENU_STRUCTURE.more.sections.map(sec => (
                    <View key={sec.section_key} style={{ gap: spacing.sm }}>
                      <View style={styles.sectionHeadingBox}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.sectionHeadingTitle}>More : {sec.section_title}</Text>
                        </View>
                        <View style={{ flexDirection: 'row', gap: 6 }}>
                          <Pressable
                            style={styles.miniBtn}
                            onPress={() => setMoreSectionPowers(sec.section_key, sec.items as any, true, false)}
                          >
                            <Text style={styles.miniBtnText}>All Power</Text>
                          </Pressable>
                          <Pressable
                            style={styles.miniBtn}
                            onPress={() => setMoreSectionPowers(sec.section_key, sec.items as any, false, true)}
                          >
                            <Text style={styles.miniBtnText}>Read-Only</Text>
                          </Pressable>
                          <Pressable
                            style={styles.miniBtn}
                            onPress={() => setMoreSectionPowers(sec.section_key, sec.items as any, false, false)}
                          >
                            <Text style={styles.miniBtnText}>Hide All</Text>
                          </Pressable>
                        </View>
                      </View>

                      {sec.items.map(it => renderMoreItemCard(sec.section_key, it))}
                    </View>
                  ))}
                </View>
              )}

              {/* (v) ASSIGNED USERS TAB */}
              {activeMenuTab === 'users' && (
                <View style={{ gap: spacing.md }}>
                  <View style={styles.infoBanner}>
                    <Ionicons name="people" size={20} color="#0D9488" />
                    <Text style={styles.infoBannerText}>
                      These employees currently hold the "{editingRole?.name}" role and inherit this 4-menu power matrix.
                    </Text>
                  </View>

                  <PrimaryButton
                    label="+ Assign Another Staff to this Role"
                    onPress={openAssignUserModal}
                    style={{ alignSelf: 'flex-start' }}
                    testID="btn-assign-user-open"
                  />

                  {loadingUsers ? (
                    <ActivityIndicator size="small" color={colors.brandPrimary} />
                  ) : assignedUsers.length === 0 ? (
                    <Card style={{ padding: spacing.xl, alignItems: 'center' }}>
                      <Ionicons name="person-outline" size={40} color={colors.muted} />
                      <Text style={{ marginTop: 8, color: colors.muted, fontWeight: '600' }}>
                        No staff currently assigned to this role.
                      </Text>
                    </Card>
                  ) : (
                    assignedUsers.map(u => (
                      <Card key={u.user_id} style={styles.userCard}>
                        <View style={styles.userCardRow}>
                          <View style={styles.userAvatar}>
                            <Text style={styles.userAvatarText}>{(u.name || 'U').charAt(0).toUpperCase()}</Text>
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.userCardName}>{u.name}</Text>
                            <Text style={styles.userCardEmail}>{u.email}</Text>
                            <Text style={styles.userCardMeta}>ID: {u.user_id} {u.branch_name ? `• ${u.branch_name}` : ''}</Text>
                          </View>
                          <Pressable style={styles.removeUserBtn} onPress={() => handleRemoveUserFromRole(u)} hitSlop={8}>
                            <Ionicons name="close-circle-outline" size={20} color={colors.error} />
                          </Pressable>
                        </View>
                      </Card>
                    ))
                  )}
                </View>
              )}
            </ScrollView>

            {/* Modal Sticky Footer */}
            <View style={styles.modalFooter}>
              {editingUser ? (
                <>
                  {editingUserPerms?.is_custom ? (
                    <SecondaryButton
                      label="Reset to Defaults"
                      onPress={() => resetUserPowersToDefault()}
                      disabled={resettingUserPerms || savingUserPerms}
                      style={{ flex: 1.2, borderColor: '#EF4444' }}
                      textStyle={{ color: '#DC2626' }}
                      testID="btn-user-reset-perms"
                    />
                  ) : null}
                  <SecondaryButton
                    label="Cancel"
                    onPress={() => {
                      setEditingUser(null);
                      setEditingUserPerms(null);
                    }}
                    style={{ flex: 1 }}
                    testID="btn-cancel-edit-user"
                  />
                  <PrimaryButton
                    label={savingUserPerms ? 'Saving...' : 'Save User Powers & Menus'}
                    onPress={saveUserPowers}
                    disabled={savingUserPerms || resettingUserPerms}
                    loading={savingUserPerms}
                    style={{ flex: 2 }}
                    testID="btn-save-user-powers"
                  />
                </>
              ) : (
                <>
                  <SecondaryButton
                    label="Cancel"
                    onPress={() => setEditingRole(null)}
                    style={{ flex: 1 }}
                    testID="btn-cancel-edit-role"
                  />
                  <PrimaryButton
                    label={savingRole ? 'Saving...' : 'Save 4-Menu Role Matrix'}
                    onPress={saveRoleMatrix}
                    disabled={savingRole}
                    loading={savingRole}
                    style={{ flex: 2 }}
                    testID="btn-save-role-matrix"
                  />
                </>
              )}
            </View>
          </View>
        </View>
      </Modal>

      {/* ========================================================================= */}
      {/* ASSIGN USER PICKER MODAL                                                  */}
      {/* ========================================================================= */}
      <Modal visible={showAssignModal} animationType="fade" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBox, { maxHeight: '80%', padding: spacing.lg }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Assign Staff to {editingRole?.name}</Text>
              <Pressable onPress={() => setShowAssignModal(false)}>
                <Ionicons name="close" size={24} color={colors.muted} />
              </Pressable>
            </View>

            <View style={[styles.searchBox, { marginVertical: spacing.md }]}>
              <Ionicons name="search" size={18} color={colors.muted} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search staff by name, email, or user ID..."
                placeholderTextColor={colors.muted}
                value={userSearchQuery}
                onChangeText={setUserSearchQuery}
              />
            </View>

            <ScrollView style={{ maxHeight: 380 }}>
              {allUsers
                .filter(u => {
                  if (!userSearchQuery) return true;
                  const q = userSearchQuery.toLowerCase();
                  return (
                    u.name?.toLowerCase().includes(q) ||
                    u.email?.toLowerCase().includes(q) ||
                    u.user_id?.toLowerCase().includes(q)
                  );
                })
                .map(u => {
                  const isCurrentRole = u.role_id === editingRole?.role_id || u.role === editingRole?.role_id;
                  return (
                    <Pressable
                      key={u.user_id}
                      style={styles.pickUserItem}
                      onPress={() => handleAssignUser(u)}
                      disabled={assigningUser || isCurrentRole}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.pickUserName}>{u.name}</Text>
                        <Text style={styles.pickUserSub}>{u.email} • ID: {u.user_id}</Text>
                        <Text style={styles.pickUserRole}>Current Role: {u.role_name || u.role}</Text>
                      </View>
                      {isCurrentRole ? (
                        <View style={styles.alreadyAssignedBadge}>
                          <Text style={styles.alreadyAssignedText}>Assigned</Text>
                        </View>
                      ) : (
                        <View style={styles.selectUserBtn}>
                          <Text style={styles.selectUserBtnText}>Assign Power</Text>
                        </View>
                      )}
                    </Pressable>
                  );
                })}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ========================================================================= */}
      {/* CREATE NEW CUSTOM ROLE MODAL                                              */}
      {/* ========================================================================= */}
      <Modal visible={showCreateModal} animationType="slide" transparent>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}
        >
          <View style={styles.modalBox}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Create New Role</Text>
              <Pressable onPress={() => setShowCreateModal(false)}>
                <Ionicons name="close" size={24} color={colors.muted} />
              </Pressable>
            </View>

            <View style={{ padding: spacing.lg, gap: spacing.md }}>
              <FormInput
                label="Role Title *"
                value={newRoleName}
                onChangeText={setNewRoleName}
                placeholder="e.g. Audit Inspector, Tender Specialist, Area Manager"
              />
              <FormInput
                label="Description"
                value={newRoleDesc}
                onChangeText={setNewRoleDesc}
                placeholder="Authority, responsibilities, and operational scope"
              />

              <View style={{ gap: 6 }}>
                <Text style={{ fontSize: font.sm, fontWeight: '700', color: colors.onSurface }}>
                  Clone Initial 4-Menu Matrix From:
                </Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
                  {(roles || []).map(r => (
                    <Pressable
                      key={r.role_id}
                      style={[styles.clonePill, cloneFromRoleId === r.role_id && styles.clonePillActive]}
                      onPress={() => setCloneFromRoleId(r.role_id)}
                    >
                      <Text style={[styles.clonePillText, cloneFromRoleId === r.role_id && styles.clonePillTextActive]}>
                        {r.name}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>

              <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.md }}>
                <SecondaryButton
                  label="Cancel"
                  onPress={() => setShowCreateModal(false)}
                  style={{ flex: 1 }}
                  testID="btn-cancel-create-role"
                />
                <PrimaryButton
                  label={busy ? 'Creating...' : 'Create Role'}
                  onPress={saveCustomRole}
                  disabled={busy}
                  loading={busy}
                  style={{ flex: 1 }}
                  testID="btn-save-new-role"
                />
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surfaceSecondary },
  addButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.brandPrimary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  adminBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#EFF6FF',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: '#BFDBFE',
  },
  adminBannerText: { flex: 1, fontSize: 12, color: '#1E40AF', lineHeight: 18 },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    height: 42,
    gap: 8,
  },
  searchInput: { flex: 1, fontSize: font.sm, color: colors.onSurface },
  listContent: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxxl },
  roleCard: { padding: spacing.md, gap: spacing.sm },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  roleIcon: {
    width: 46,
    height: 46,
    borderRadius: 12,
    backgroundColor: colors.brandPrimary + '15',
    alignItems: 'center',
    justifyContent: 'center',
  },
  roleName: { fontSize: font.base, fontWeight: '800', color: colors.onSurface },
  roleIdText: { fontSize: 11, color: colors.brandSecondary, fontWeight: '700', marginTop: 1 },
  roleDesc: { fontSize: font.xs, color: colors.muted, marginTop: 4, lineHeight: 16 },
  systemBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: '#FEF3C7' },
  systemBadgeText: { fontSize: 9, fontWeight: '800', color: '#D97706' },
  deleteRoleBtn: { padding: 6 },
  fourMenuPillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  menuPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  menuPillText: { fontSize: 10, fontWeight: '700', color: colors.onSurface },
  usersPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.sm,
    backgroundColor: '#CCFBF1',
  },
  usersPillText: { fontSize: 10, fontWeight: '800', color: '#0F766E' },
  customiseBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.brandPrimary,
    paddingVertical: 9,
    borderRadius: radius.md,
    marginTop: 4,
  },
  customiseBtnText: { color: colors.onBrandPrimary, fontSize: 12, fontWeight: '800' },

  // Denied Box
  deniedBox: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl, gap: spacing.md },
  deniedTitle: { fontSize: font.xl, fontWeight: '800', color: colors.error },
  deniedText: { textAlign: 'center', color: colors.muted, lineHeight: 20, maxWidth: 360 },

  // Modal Styles
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  modalBox: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    overflow: 'hidden',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalTitle: { fontSize: font.lg, fontWeight: '800', color: colors.onSurface },
  subText: { fontSize: 11, color: colors.muted, marginTop: 2 },

  // 4 Menu Tab Bar
  fourTabBar: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceSecondary,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  fourTabItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 12,
    borderBottomWidth: 3,
    borderBottomColor: 'transparent',
  },
  fourTabItemActive: {
    borderBottomColor: colors.brandPrimary,
    backgroundColor: colors.surface,
  },
  fourTabLabel: { fontSize: 11, fontWeight: '700', color: colors.muted },
  fourTabLabelActive: { color: colors.brandPrimary, fontWeight: '800' },

  // Quick Bar
  quickBar: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  quickPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  quickPillText: { fontSize: 11, fontWeight: '700' },

  tabContentScroll: { padding: spacing.lg, paddingBottom: spacing.xxxl },

  // Section Heading Box
  sectionHeadingBox: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sectionHeadingTitle: { fontSize: font.sm, fontWeight: '800', color: colors.onSurface },
  sectionHeadingSub: { fontSize: 11, color: colors.muted, marginTop: 2 },
  miniBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  miniBtnText: { fontSize: 10, fontWeight: '700', color: colors.onSurface },

  // Item Cards
  itemCard: {
    padding: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  itemCardActive: {
    backgroundColor: '#F0FDF4',
    borderColor: '#86EFAC',
  },
  itemHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  itemIconBg: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemTitle: { fontSize: font.sm, fontWeight: '700', color: colors.onSurface },
  itemTitleActive: { color: '#166534', fontWeight: '800' },
  itemDesc: { fontSize: 11, color: colors.muted, marginTop: 1 },

  // Power Toggles
  powerToggleRow: { flexDirection: 'row', gap: 8, marginTop: 2 },
  powerToggleBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    borderRadius: radius.sm,
    borderWidth: 1.5,
  },
  powerViewActive: {
    backgroundColor: '#DCFCE7',
    borderColor: '#22C55E',
  },
  powerWriteActive: {
    backgroundColor: '#DBEAFE',
    borderColor: '#3B82F6',
  },
  powerInactive: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
  },
  powerToggleText: { fontSize: 11, fontWeight: '700' },

  // Granular Action Pills & Counters
  actionPillsContainer: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: 8,
  },
  actionPillsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 6,
  },
  actionPillsLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.muted,
    letterSpacing: 0.5,
  },
  microBtnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  itemMicroBtn: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  itemMicroBtnText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.brandPrimary,
  },
  actionPillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  actionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  actionPillInactive: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
  },
  actionPillText: {
    fontSize: 11,
    fontWeight: '700',
  },
  actionPillTextInactive: {
    color: '#94A3B8',
    fontWeight: '500',
  },
  actionCountBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  actionCountBadgeFull: {
    backgroundColor: '#DCFCE7',
    borderColor: '#86EFAC',
  },
  actionCountBadgeActive: {
    backgroundColor: '#E0F2FE',
    borderColor: '#BAE6FD',
  },
  actionCountBadgeInactive: {
    backgroundColor: '#F1F5F9',
    borderColor: '#CBD5E1',
  },
  actionCountBadgeText: {
    fontSize: 10,
    fontWeight: '800',
  },
  actionCountTextFull: {
    color: '#15803D',
  },
  actionCountTextActive: {
    color: '#0369A1',
  },
  actionCountTextInactive: {
    color: '#64748B',
  },

  // Assigned Users
  infoBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: spacing.md,
    backgroundColor: '#F0F9FF',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#BAE6FD',
  },
  infoBannerText: { flex: 1, fontSize: 12, color: '#0369A1', lineHeight: 17 },
  userCard: { padding: spacing.md },
  userCardRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  userAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.brandPrimary + '20',
    alignItems: 'center',
    justifyContent: 'center',
  },
  userAvatarText: { fontSize: font.base, fontWeight: '800', color: colors.brandPrimary },
  userCardName: { fontSize: font.sm, fontWeight: '700', color: colors.onSurface },
  userCardEmail: { fontSize: 11, color: colors.muted },
  userCardMeta: { fontSize: 10, color: colors.brandSecondary, fontWeight: '600', marginTop: 2 },
  removeUserBtn: { padding: 6 },

  // Assign Picker
  pickUserItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  pickUserName: { fontSize: font.sm, fontWeight: '700', color: colors.onSurface },
  pickUserSub: { fontSize: 11, color: colors.muted, marginTop: 1 },
  pickUserRole: { fontSize: 10, color: colors.brandSecondary, fontWeight: '600', marginTop: 2 },
  selectUserBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.sm,
    backgroundColor: colors.brandPrimary,
  },
  selectUserBtnText: { color: '#FFFFFF', fontSize: font.xs, fontWeight: '700' },
  alreadyAssignedBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.sm,
    backgroundColor: '#DCFCE7',
  },
  alreadyAssignedText: { fontSize: 11, fontWeight: '700', color: '#15803D' },

  // Clone Pill
  clonePill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  clonePillActive: {
    backgroundColor: colors.brandPrimary,
    borderColor: colors.brandPrimary,
  },
  clonePillText: { fontSize: 11, fontWeight: '700', color: colors.onSurface },
  clonePillTextActive: { color: '#FFFFFF' },

  // Footer
  modalFooter: {
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },

  // Mode Switcher Tabs
  modeSwitcherContainer: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    gap: 8,
  },
  modeSwitchBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  modeSwitchBtnActive: {
    backgroundColor: colors.brandPrimary,
    borderColor: colors.brandPrimary,
  },
  modeSwitchText: {
    fontSize: font.xs,
    fontWeight: '700',
    color: colors.onSurface,
  },
  modeSwitchTextActive: {
    color: '#FFFFFF',
    fontWeight: '800',
  },

  // User Status Badges
  customBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: '#DCFCE7',
    borderWidth: 1,
    borderColor: '#86EFAC',
  },
  customBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#15803D',
  },
  defaultBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  defaultBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#475569',
  },

  // Reset Button
  resetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: radius.md,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    marginTop: 4,
  },
  resetBtnText: {
    fontSize: font.xs,
    fontWeight: '700',
    color: '#DC2626',
  },
});
