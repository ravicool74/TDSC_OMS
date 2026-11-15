import React, { useCallback, useMemo, useState, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, FlatList, Pressable, RefreshControl,
  TextInput, ScrollView, Modal, Alert, Platform, Linking, ActivityIndicator
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { colors, spacing, radius, font } from '@/src/theme';
import { api, tokenStore } from '@/src/api';
import { Card, EmptyState, ScreenLoader, PrimaryButton, SecondaryButton, Avatar } from '@/src/ui';
import { ScreenHeader } from '@/src/ScreenHeader';
import { useAuth } from '@/src/AuthContext';

type SubMenu = 'general' | 'forms_and_rules';

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
const formatBytes = (bytes?: number) => {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export default function DocumentLibraryScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const canEdit = user?.role === 'admin' || user?.role === 'manager';

  const [activeMenu, setActiveMenu] = useState<SubMenu>('forms_and_rules');
  const [folders, setFolders] = useState<any[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Selected open folder state
  const [openFolder, setOpenFolder] = useState<any | null>(null);
  const openFolderRef = useRef<any>(null);
  openFolderRef.current = openFolder;
  const [folderFiles, setFolderFiles] = useState<any[] | null>(null);
  const [loadingFiles, setLoadingFiles] = useState(false);

  // Folder creation / rename modal
  const [folderModalVisible, setFolderModalVisible] = useState(false);
  const [editingFolder, setEditingFolder] = useState<any | null>(null);
  const [folderName, setFolderName] = useState('');
  const [folderDesc, setFolderDesc] = useState('');
  const [folderColor, setFolderColor] = useState('#3b82f6');
  const [savingFolder, setSavingFolder] = useState(false);

  // Permissions modal state
  const [permModalVisible, setPermModalVisible] = useState(false);
  const [permTarget, setPermTarget] = useState<{
    type: 'folder' | 'file';
    id: string;
    title: string;
    access_type: 'all' | 'restricted';
    allowed_user_ids: string[];
  } | null>(null);
  const [permAccessType, setPermAccessType] = useState<'all' | 'restricted'>('all');
  const [permSelectedUsers, setPermSelectedUsers] = useState<string[]>([]);
  const [usersList, setUsersList] = useState<any[]>([]);
  const [userSearch, setUserSearch] = useState('');
  const [savingPerms, setSavingPerms] = useState(false);

  // Inline row editing state inside opened folder
  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  const [editingDescription, setEditingDescription] = useState('');
  const [uploadingRowId, setUploadingRowId] = useState<string | null>(null);
  const [addingRowBelowId, setAddingRowBelowId] = useState<string | null>(null);

  // Double click detection ref
  const lastClickRef = useRef<{ id: string; time: number }>({ id: '', time: 0 });

  // Load Folders
  const loadFolders = useCallback(async () => {
    try {
      const data = await api.getDocFolders(activeMenu, searchQuery);
      setFolders(data || []);
    } catch {
      setFolders([]);
    }
  }, [activeMenu, searchQuery]);

  // Load Files for open folder
  const loadFilesForFolder = useCallback(async (fid: string) => {
    setLoadingFiles(true);
    try {
      const res = await api.getFolderFiles(fid);
      setFolderFiles(res.files || []);
      if (res.folder) {
        setOpenFolder((prev: any) => (prev && prev.id === res.folder.id ? { ...prev, ...res.folder } : res.folder));
      }
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to load folder files');
      setFolderFiles([]);
    } finally {
      setLoadingFiles(false);
    }
  }, []);

  // Load Users List for permissions modal (Admin/Manager)
  const loadUsersList = useCallback(async () => {
    if (isAdmin || canEdit) {
      try {
        const list = await api.getDocUsersList();
        setUsersList(list || []);
      } catch {
        setUsersList([]);
      }
    }
  }, [isAdmin, canEdit]);

  const filteredUsersList = useMemo(() => {
    if (!userSearch.trim()) return usersList;
    const q = userSearch.trim().toLowerCase();
    return usersList.filter(u =>
      (u.name && u.name.toLowerCase().includes(q)) ||
      (u.email && u.email.toLowerCase().includes(q)) ||
      (u.role && u.role.toLowerCase().includes(q)) ||
      (u.branch_name && u.branch_name.toLowerCase().includes(q))
    );
  }, [usersList, userSearch]);

  const openFolderPermissionsModal = (fld: any) => {
    setPermTarget({
      type: 'folder',
      id: fld.id,
      title: `Folder: ${fld.name}`,
      access_type: fld.access_type || 'all',
      allowed_user_ids: fld.allowed_user_ids || [],
    });
    setPermAccessType(fld.access_type === 'restricted' ? 'restricted' : 'all');
    setPermSelectedUsers(fld.allowed_user_ids || []);
    setUserSearch('');
    setPermModalVisible(true);
  };

  const openFilePermissionsModal = (fl: any) => {
    setPermTarget({
      type: 'file',
      id: fl.id,
      title: `Line ${fl.sl_no}: ${fl.file_description}`,
      access_type: fl.access_type || 'all',
      allowed_user_ids: fl.allowed_user_ids || [],
    });
    setPermAccessType(fl.access_type === 'restricted' ? 'restricted' : 'all');
    setPermSelectedUsers(fl.allowed_user_ids || []);
    setUserSearch('');
    setPermModalVisible(true);
  };

  const handleSavePermissions = async () => {
    if (!permTarget) return;
    setSavingPerms(true);
    try {
      if (permTarget.type === 'folder') {
        await api.updateDocFolderPermissions(permTarget.id, {
          access_type: permAccessType,
          allowed_user_ids: permSelectedUsers,
        });
        Alert.alert('Success', `Permissions updated for "${permTarget.title}".`);
        await loadFolders();
        if (openFolder?.id === permTarget.id) {
          setOpenFolder((prev: any) => ({
            ...prev,
            access_type: permAccessType,
            allowed_user_ids: permSelectedUsers,
            allowed_count: permSelectedUsers.length,
          }));
        }
      } else {
        if (openFolder) {
          await api.updateDocFilePermissions(openFolder.id, permTarget.id, {
            access_type: permAccessType,
            allowed_user_ids: permSelectedUsers,
          });
          Alert.alert('Success', 'Document permissions updated.');
          await loadFilesForFolder(openFolder.id);
        }
      }
      setPermModalVisible(false);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to update permissions.');
    } finally {
      setSavingPerms(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      loadUsersList();
      if (openFolderRef.current) {
        loadFilesForFolder(openFolderRef.current.id);
      } else {
        loadFolders();
      }
    }, [loadFolders, loadFilesForFolder, loadUsersList])
  );

  useEffect(() => {
    if (!openFolder) {
      loadFolders();
    }
  }, [activeMenu, searchQuery, loadFolders, openFolder]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadUsersList();
    if (openFolder) {
      await loadFilesForFolder(openFolder.id);
    } else {
      await loadFolders();
    }
    setRefreshing(false);
  };

  // --- Folder Management Actions ---
  const handleOpenFolder = (folder: any) => {
    setOpenFolder(folder);
    setEditingRowId(null);
    loadFilesForFolder(folder.id);
  };

  // Double click or single click handler for folders
  const handleFolderClick = (folder: any) => {
    const now = Date.now();
    const prev = lastClickRef.current;
    if (prev.id === folder.id && (now - prev.time) < 400) {
      // Double click detected!
      handleOpenFolder(folder);
      lastClickRef.current = { id: '', time: 0 };
    } else {
      lastClickRef.current = { id: folder.id, time: now };
      // Also allow direct tap opening on touch devices
      if (Platform.OS !== 'web') {
        handleOpenFolder(folder);
      }
    }
  };

  const openCreateFolderModal = () => {
    setEditingFolder(null);
    setFolderName('');
    setFolderDesc('');
    setFolderColor(activeMenu === 'forms_and_rules' ? '#f59e0b' : '#3b82f6');
    setFolderModalVisible(true);
  };

  const openRenameFolderModal = (fld: any) => {
    setEditingFolder(fld);
    setFolderName(fld.name);
    setFolderDesc(fld.description || '');
    setFolderColor(fld.color || '#3b82f6');
    setFolderModalVisible(true);
  };

  const handleSaveFolder = async () => {
    if (!folderName.trim()) {
      Alert.alert('Validation Error', 'Folder name is required.');
      return;
    }
    setSavingFolder(true);
    try {
      if (editingFolder) {
        await api.updateDocFolder(editingFolder.id, {
          name: folderName.trim(),
          description: folderDesc.trim() || undefined,
          color: folderColor,
        });
        Alert.alert('Success', 'Folder renamed successfully.');
      } else {
        await api.createDocFolder({
          name: folderName.trim(),
          category: activeMenu,
          description: folderDesc.trim() || undefined,
          color: folderColor,
        });
        Alert.alert('Success', 'New folder created.');
      }
      setFolderModalVisible(false);
      await loadFolders();
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to save folder.');
    } finally {
      setSavingFolder(false);
    }
  };

  const handleDeleteFolder = (fld: any) => {
    Alert.alert(
      'Delete Folder?',
      `Are you sure you want to permanently delete "${fld.name}" and all files contained within it?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.deleteDocFolder(fld.id);
              if (openFolder?.id === fld.id) setOpenFolder(null);
              await loadFolders();
            } catch (e: any) {
              Alert.alert('Error', e?.message || 'Failed to delete folder.');
            }
          },
        },
      ]
    );
  };

  // --- Line Table Actions inside Open Folder ---

  // '+' Button: Insert new field below
  const handleInsertRowBelow = async (afterRowId?: string) => {
    if (!openFolder) return;
    setAddingRowBelowId(afterRowId || 'top');
    try {
      const res = await api.createDocFileRow(openFolder.id, {
        file_description: 'New Document / Form Entry',
        insert_after_id: afterRowId,
      });
      await loadFilesForFolder(openFolder.id);
      // Auto-focus the newly added row for editing
      setEditingRowId(res.id);
      setEditingDescription(res.file_description || '');
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to insert new row');
    } finally {
      setAddingRowBelowId(null);
    }
  };

  // Edit Button: Enter edit mode
  const handleStartEditRow = (file: any) => {
    setEditingRowId(file.id);
    setEditingDescription(file.file_description || '');
  };

  // Update Button: Save changes
  const handleUpdateRow = async (fileId: string) => {
    if (!openFolder) return;
    try {
      await api.updateDocFileRow(openFolder.id, fileId, {
        file_description: editingDescription.trim() || 'Untitled File',
      });
      setEditingRowId(null);
      await loadFilesForFolder(openFolder.id);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to update row');
    }
  };

  // Delete Row Button
  const handleDeleteRow = (file: any) => {
    if (!openFolder) return;
    Alert.alert(
      'Delete Row?',
      `Delete row Sl. No. ${file.sl_no} ("${file.file_description}")?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.deleteDocFileRow(openFolder.id, file.id);
              await loadFilesForFolder(openFolder.id);
            } catch (e: any) {
              Alert.alert('Error', e?.message || 'Failed to delete row');
            }
          },
        },
      ]
    );
  };

  // Upload File Button
  const handlePickAndUploadFile = async (fileId: string) => {
    if (!openFolder) return;
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
      });
      if (res.canceled || !res.assets?.length) return;
      const asset = res.assets[0];
      if (asset.size && asset.size > MAX_FILE_SIZE) {
        Alert.alert('File Too Large', 'Maximum file size allowed is 50 MB.');
        return;
      }
      setUploadingRowId(fileId);
      await api.uploadDocFileAttachment(openFolder.id, fileId, {
        uri: asset.uri,
        name: asset.name,
        type: asset.mimeType || 'application/octet-stream',
      });
      await loadFilesForFolder(openFolder.id);
      Alert.alert('Uploaded', `"${asset.name}" attached successfully.`);
    } catch (e: any) {
      Alert.alert('Upload Error', e?.message || 'Failed to upload document');
    } finally {
      setUploadingRowId(null);
    }
  };

  // Open / View Downloaded File
  const handleOpenFile = async (filePath: string) => {
    const token = await tokenStore.get();
    const url = `${api.base}/api/files/${filePath}?token=${encodeURIComponent(token || '')}`;
    if (Platform.OS === 'web') {
      window.open(url, '_blank');
    } else {
      Linking.openURL(url);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surfaceSecondary }} testID="document-library-screen">
      <ScreenHeader
        title={openFolder ? openFolder.name : "Document Library"}
        right={(
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {!openFolder && canEdit && (
              <Pressable
                testID="create-folder-btn"
                onPress={openCreateFolderModal}
                style={styles.addFolderBtn}
              >
                <Ionicons name="add" size={22} color="#fff" />
              </Pressable>
            )}
          </View>
        )}
      />

      {/* --- SUB-MENUS TAB BAR (Only when viewing folders root) --- */}
      {!openFolder && (
        <View style={styles.tabBar}>
          <Pressable
            testID="tab-general-docs"
            style={[styles.tabItem, activeMenu === 'general' && styles.tabItemActive]}
            onPress={() => { setActiveMenu('general'); setOpenFolder(null); }}
          >
            <Ionicons
              name="folder"
              size={18}
              color={activeMenu === 'general' ? colors.brandPrimary : colors.muted}
            />
            <Text style={[styles.tabLabel, activeMenu === 'general' && styles.tabLabelActive]}>
              Document Library
            </Text>
          </Pressable>

          <Pressable
            testID="tab-forms-rules"
            style={[styles.tabItem, activeMenu === 'forms_and_rules' && styles.tabItemActive]}
            onPress={() => { setActiveMenu('forms_and_rules'); setOpenFolder(null); }}
          >
            <Ionicons
              name="document-text"
              size={18}
              color={activeMenu === 'forms_and_rules' ? colors.brandPrimary : colors.muted}
            />
            <Text style={[styles.tabLabel, activeMenu === 'forms_and_rules' && styles.tabLabelActive]}>
              20. Form & Rules
            </Text>
          </Pressable>
        </View>
      )}

      {/* ========================================================================= */}
      {/* 1. FOLDERS LIST VIEW (Root)                                               */}
      {/* ========================================================================= */}
      {!openFolder && (
        <View style={{ flex: 1 }}>
          {/* Search & Action Bar */}
          <View style={styles.searchBarContainer}>
            <View style={styles.searchBox}>
              <Ionicons name="search" size={18} color={colors.muted} />
              <TextInput
                placeholder="Search folders by name…"
                value={searchQuery}
                onChangeText={setSearchQuery}
                style={styles.searchInput}
                placeholderTextColor={colors.muted}
              />
              {searchQuery.length > 0 && (
                <Pressable onPress={() => setSearchQuery('')}>
                  <Ionicons name="close-circle" size={18} color={colors.muted} />
                </Pressable>
              )}
            </View>

            {canEdit && (
              <Pressable
                testID="new-folder-action-btn"
                style={styles.newFolderQuickBtn}
                onPress={openCreateFolderModal}
              >
                <Ionicons name="folder-outline" size={16} color="#fff" />
                <Text style={styles.newFolderQuickBtnText}>+ Create Folder</Text>
              </Pressable>
            )}
          </View>

          {/* Double-Click Hint Banner */}
          <View style={styles.doubleClickHint}>
            <Ionicons name="information-circle-outline" size={16} color={colors.brandPrimary} />
            <Text style={styles.doubleClickHintText}>
              Double-click (or tap) on any folder to open and view the line table with Upload, Edit & "+" options.
            </Text>
          </View>

          {/* Folders Grid / List */}
          {folders === null ? (
            <ScreenLoader />
          ) : folders.length === 0 ? (
            <EmptyState
              icon="folder-open-outline"
              title="No Folders Available"
              subtitle={canEdit ? `Create your first folder in ${activeMenu === 'forms_and_rules' ? '20. Form & Rules' : 'Document Library'} by clicking the '+' button.` : "No folders have been assigned to your profile yet."}
              actionLabel={canEdit ? "+ Create Folder" : undefined}
              onAction={canEdit ? openCreateFolderModal : undefined}
            />
          ) : (
            <FlatList
              data={folders}
              keyExtractor={item => item.id}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
              contentContainerStyle={{ padding: spacing.md, gap: spacing.md, paddingBottom: 100 }}
              renderItem={({ item }) => (
                <Pressable
                  testID={`folder-${item.id}`}
                  onPress={() => handleFolderClick(item)}
                  style={styles.folderCardPressable}
                >
                  <Card style={styles.folderCard}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 }}>
                      <View style={[styles.folderIconBox, { backgroundColor: (item.color || '#3b82f6') + '20' }]}>
                        <Ionicons name="folder" size={28} color={item.color || '#3b82f6'} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.folderTitle} numberOfLines={1}>{item.name}</Text>
                        {item.description ? (
                          <Text style={styles.folderDesc} numberOfLines={1}>{item.description}</Text>
                        ) : null}
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                          <View style={styles.filesCountBadge}>
                            <Ionicons name="document-outline" size={11} color={colors.brandPrimary} />
                            <Text style={styles.filesCountText}>{item.files_count || 0} Files</Text>
                          </View>

                          {/* Access Badge */}
                          {item.access_type === 'restricted' ? (
                            <View style={[styles.permBadge, { backgroundColor: '#fef3c7', borderColor: '#fde68a' }]}>
                              <Ionicons name="lock-closed" size={10} color="#d97706" />
                              <Text style={[styles.permBadgeText, { color: '#b45309' }]}>
                                Restricted ({item.allowed_count ?? item.allowed_user_ids?.length ?? 0} Users)
                              </Text>
                            </View>
                          ) : (
                            <View style={[styles.permBadge, { backgroundColor: '#dcfce7', borderColor: '#bbf7d0' }]}>
                              <Ionicons name="globe-outline" size={10} color="#16a34a" />
                              <Text style={[styles.permBadgeText, { color: '#15803d' }]}>All Users</Text>
                            </View>
                          )}

                          <Text style={styles.hintOpenText}>Double-click to open</Text>
                        </View>
                      </View>
                    </View>

                    {/* Actions Menu (Permissions, Rename, Delete, Open) */}
                    <View style={styles.folderActionsContainer}>
                      {isAdmin && (
                        <Pressable
                          testID={`folder-perms-${item.id}`}
                          style={[styles.folderActionIconBtn, { backgroundColor: '#f0fdf4' }]}
                          onPress={() => openFolderPermissionsModal(item)}
                          accessibilityLabel="Manage Access Permissions"
                        >
                          <Ionicons name="shield-checkmark" size={16} color="#16a34a" />
                        </Pressable>
                      )}
                      {canEdit && (
                        <Pressable
                          style={styles.folderActionIconBtn}
                          onPress={() => openRenameFolderModal(item)}
                          accessibilityLabel="Rename Folder"
                        >
                          <Ionicons name="pencil" size={16} color={colors.brandPrimary} />
                        </Pressable>
                      )}
                      {canEdit && (
                        <Pressable
                          style={styles.folderActionIconBtn}
                          onPress={() => handleDeleteFolder(item)}
                          accessibilityLabel="Delete Folder"
                        >
                          <Ionicons name="trash-outline" size={16} color={colors.error} />
                        </Pressable>
                      )}
                      <Pressable
                        testID={`folder-open-${item.id}`}
                        style={[styles.folderActionIconBtn, { backgroundColor: colors.brandPrimary + '15' }]}
                        onPress={() => handleOpenFolder(item)}
                        accessibilityLabel="Open Folder"
                      >
                        <Ionicons name="arrow-forward" size={16} color={colors.brandPrimary} />
                      </Pressable>
                    </View>
                  </Card>
                </Pressable>
              )}
            />
          )}
        </View>
      )}

      {/* ========================================================================= */}
      {/* 2. OPEN FOLDER: LINE-BY-LINE SPREADSHEET TABLE VIEW                       */}
      {/* ========================================================================= */}
      {openFolder && (
        <View style={{ flex: 1 }}>
          {/* Breadcrumb & Folder Info Banner */}
          <View style={styles.openFolderHeader}>
            <Pressable
              style={styles.backToFoldersBtn}
              onPress={() => setOpenFolder(null)}
            >
              <Ionicons name="arrow-back" size={18} color={colors.brandPrimary} />
              <Text style={styles.backToFoldersText}>All Folders</Text>
            </Pressable>

            <View style={{ flex: 1 }}>
              <Text style={styles.openFolderName} numberOfLines={1}>📁 {openFolder.name}</Text>
              <Text style={styles.openFolderSubtitle}>
                {openFolder.category === 'forms_and_rules' ? '20. Form & Rules Table' : 'Document Library'} • {folderFiles?.length || 0} lines
              </Text>
            </View>

            {canEdit && (
              <Pressable
                style={styles.addFirstLineBtn}
                onPress={() => handleInsertRowBelow(undefined)}
              >
                <Ionicons name="add" size={16} color="#fff" />
                <Text style={styles.addFirstLineBtnText}>Add Row</Text>
              </Pressable>
            )}
          </View>

          {/* TABLE HEADER (Sl. No., File Description, Upload file, Edit, Update, Delete, "+") */}
          <View style={styles.tableHeaderRow}>
            <View style={styles.colSlNo}>
              <Text style={styles.tableHeaderText}>Sl. No.</Text>
            </View>
            <View style={styles.colDesc}>
              <Text style={styles.tableHeaderText}>File Description</Text>
            </View>
            <View style={styles.colUpload}>
              <Text style={styles.tableHeaderText}>{canEdit ? 'Upload File' : 'Attachment'}</Text>
            </View>
            {canEdit && (
              <View style={styles.colActions}>
                <Text style={styles.tableHeaderText}>Actions (Edit / Update / Delete)</Text>
              </View>
            )}
            {canEdit && (
              <View style={styles.colAdd}>
                <Text style={styles.tableHeaderText}>“+”</Text>
              </View>
            )}
          </View>

          {/* TABLE CONTENT */}
          {loadingFiles ? (
            <ActivityIndicator size="large" color={colors.brandPrimary} style={{ marginVertical: 40 }} />
          ) : folderFiles === null || folderFiles.length === 0 ? (
            <EmptyState
              icon="document-attach-outline"
              title="Folder is Empty"
              subtitle={canEdit ? "Click '+ Add Row' to insert the first line with Sl. No., File Description, Upload, and Edit options." : "No documents have been added to this folder yet."}
              actionLabel={canEdit ? "+ Add First Row" : undefined}
              onAction={canEdit ? () => handleInsertRowBelow(undefined) : undefined}
            />
          ) : (
            <FlatList
              data={folderFiles}
              keyExtractor={item => item.id}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
              contentContainerStyle={{ paddingBottom: 100 }}
              renderItem={({ item, index }) => {
                const isEditing = editingRowId === item.id;
                const isUploading = uploadingRowId === item.id;
                const isInsertingBelow = addingRowBelowId === item.id;

                return (
                  <View style={[styles.tableDataRow, index % 2 === 1 && styles.tableDataRowAlt]}>
                    {/* 1. Sl. No. Column */}
                    <View style={styles.colSlNo}>
                      <View style={styles.slNoBadge}>
                        <Text style={styles.slNoText}>{item.sl_no}</Text>
                      </View>
                    </View>

                    {/* 2. File Description Column */}
                    <View style={styles.colDesc}>
                      {isEditing ? (
                        <TextInput
                          value={editingDescription}
                          onChangeText={setEditingDescription}
                          style={styles.inlineDescInput}
                          placeholder="Enter file description / name of rule…"
                          autoFocus
                          multiline
                        />
                      ) : (
                        <View>
                          <Text style={styles.rowDescText}>{item.file_description}</Text>
                          {item.file_name && (
                            <Text style={styles.rowMetaText}>
                              📄 {item.file_name} {item.file_size ? `(${formatBytes(item.file_size)})` : ''}
                            </Text>
                          )}
                          {/* Row Access Badge for Admin */}
                          {isAdmin && (
                            <Pressable
                              onPress={() => openFilePermissionsModal(item)}
                              style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }}
                            >
                              {item.access_type === 'restricted' ? (
                                <View style={[styles.rowPermBadge, { backgroundColor: '#fef3c7', borderColor: '#fde68a' }]}>
                                  <Ionicons name="lock-closed" size={9} color="#d97706" />
                                  <Text style={[styles.rowPermBadgeText, { color: '#b45309' }]}>
                                    Restricted ({item.allowed_count ?? item.allowed_user_ids?.length ?? 0} Users)
                                  </Text>
                                </View>
                              ) : (
                                <View style={[styles.rowPermBadge, { backgroundColor: '#dcfce7', borderColor: '#bbf7d0' }]}>
                                  <Ionicons name="globe-outline" size={9} color="#16a34a" />
                                  <Text style={[styles.rowPermBadgeText, { color: '#15803d' }]}>All Users</Text>
                                </View>
                              )}
                            </Pressable>
                          )}
                        </View>
                      )}
                    </View>

                    {/* 3. Upload File Column */}
                    <View style={styles.colUpload}>
                      {isUploading ? (
                        <ActivityIndicator size="small" color={colors.brandPrimary} />
                      ) : item.file_path ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                          <Pressable
                            style={styles.fileAttachedChip}
                            onPress={() => handleOpenFile(item.file_path)}
                            accessibilityLabel="Preview / Download Document"
                          >
                            <Ionicons name="document-text" size={14} color={colors.brandPrimary} />
                            <Text style={styles.fileAttachedText} numberOfLines={1}>
                              View File
                            </Text>
                          </Pressable>
                          {canEdit && (
                            <Pressable
                              onPress={() => handlePickAndUploadFile(item.id)}
                              style={styles.replaceFileBtn}
                              accessibilityLabel="Replace File"
                            >
                              <Ionicons name="cloud-upload" size={14} color={colors.muted} />
                            </Pressable>
                          )}
                        </View>
                      ) : canEdit ? (
                        <Pressable
                          style={styles.uploadBtn}
                          onPress={() => handlePickAndUploadFile(item.id)}
                        >
                          <Ionicons name="cloud-upload-outline" size={14} color="#fff" />
                          <Text style={styles.uploadBtnText}>Upload file</Text>
                        </Pressable>
                      ) : (
                        <Text style={{ fontSize: 11, color: colors.muted }}>No file</Text>
                      )}
                    </View>

                    {/* 4. Edit, 5. Update, 6. Delete Column (Only for canEdit) */}
                    {canEdit && (
                      <View style={styles.colActions}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                          {isAdmin && (
                            <Pressable
                              testID={`row-perms-${item.id}`}
                              style={styles.permActionBtn}
                              onPress={() => openFilePermissionsModal(item)}
                              accessibilityLabel="User Permissions"
                            >
                              <Ionicons name="shield-checkmark" size={13} color="#16a34a" />
                            </Pressable>
                          )}
                          {isEditing ? (
                            <Pressable
                              style={styles.updateActionBtn}
                              onPress={() => handleUpdateRow(item.id)}
                              accessibilityLabel="Update (Save)"
                            >
                              <Ionicons name="checkmark" size={13} color="#fff" />
                              <Text style={styles.updateActionBtnText}>Update</Text>
                            </Pressable>
                          ) : (
                            <Pressable
                              style={styles.editActionBtn}
                              onPress={() => handleStartEditRow(item)}
                              accessibilityLabel="Edit"
                            >
                              <Ionicons name="pencil" size={13} color={colors.brandPrimary} />
                              <Text style={styles.editActionBtnText}>Edit</Text>
                            </Pressable>
                          )}

                          <Pressable
                            style={styles.deleteActionBtn}
                            onPress={() => handleDeleteRow(item)}
                            accessibilityLabel="Delete"
                          >
                            <Ionicons name="trash-outline" size={13} color={colors.error} />
                            <Text style={styles.deleteActionBtnText}>Delete</Text>
                          </Pressable>
                        </View>
                      </View>
                    )}

                    {/* 7. "+" Sign in Last Column (Insert New Field Below - Only for canEdit) */}
                    {canEdit && (
                      <View style={styles.colAdd}>
                        <Pressable
                          testID={`add-row-below-${item.id}`}
                          style={[styles.plusRowBtn, isInsertingBelow && { opacity: 0.5 }]}
                          onPress={() => handleInsertRowBelow(item.id)}
                          accessibilityLabel="Click to insert new field below"
                        >
                          {isInsertingBelow ? (
                            <ActivityIndicator size="small" color="#fff" />
                          ) : (
                            <Ionicons name="add" size={18} color="#fff" />
                          )}
                        </Pressable>
                      </View>
                    )}
                  </View>
                );
              }}
            />
          )}
        </View>
      )}

      {/* ========================================================================= */}
      {/* MODAL 1: CREATE / RENAME FOLDER                                           */}
      {/* ========================================================================= */}
      <Modal visible={folderModalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>
                  {editingFolder ? 'Rename Folder' : 'Create New Folder'}
                </Text>
                <Text style={styles.modalSubtitle}>
                  {activeMenu === 'forms_and_rules' ? 'Category: 20. Form & Rules' : 'Category: Document Library'}
                </Text>
              </View>
              <Pressable onPress={() => setFolderModalVisible(false)}>
                <Ionicons name="close" size={24} color={colors.onSurface} />
              </Pressable>
            </View>

            <ScrollView style={{ maxHeight: 380 }} contentContainerStyle={{ gap: 12 }}>
              <View>
                <Text style={styles.fieldLabel}>Folder Name *</Text>
                <TextInput
                  placeholder="e.g. CPWD Forms & Formats, Bihar SOR 2026…"
                  value={folderName}
                  onChangeText={setFolderName}
                  style={styles.modalInput}
                  placeholderTextColor={colors.muted}
                  autoFocus
                />
              </View>

              <View>
                <Text style={styles.fieldLabel}>Short Description</Text>
                <TextInput
                  placeholder="e.g. Standard tender forms, contract conditions, circulars…"
                  value={folderDesc}
                  onChangeText={setFolderDesc}
                  style={styles.modalInput}
                  placeholderTextColor={colors.muted}
                />
              </View>

              <View>
                <Text style={styles.fieldLabel}>Folder Color Tag</Text>
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
                  {['#3b82f6', '#f59e0b', '#10b981', '#8b5cf6', '#ef4444', '#06b6d4'].map(color => (
                    <Pressable
                      key={color}
                      style={[
                        styles.colorChoice,
                        { backgroundColor: color },
                        folderColor === color && styles.colorChoiceActive,
                      ]}
                      onPress={() => setFolderColor(color)}
                    >
                      {folderColor === color && <Ionicons name="checkmark" size={16} color="#fff" />}
                    </Pressable>
                  ))}
                </View>
              </View>

              <View style={{ marginTop: 8 }}>
                <PrimaryButton
                  label={savingFolder ? "Saving…" : editingFolder ? "Save Rename" : "Create Folder"}
                  onPress={handleSaveFolder}
                  loading={savingFolder}
                />
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ========================================================================= */}
      {/* MODAL 2: MANAGE ACCESS PERMISSIONS (Admin only)                           */}
      {/* ========================================================================= */}
      <Modal visible={permModalVisible} animationType="fade" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxWidth: 520, width: '100%', maxHeight: '90%' }]}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Ionicons name="shield-checkmark" size={20} color={colors.brandPrimary} />
                  <Text style={styles.modalTitle}>Manage Access Permissions</Text>
                </View>
                <Text style={styles.modalSubtitle} numberOfLines={1}>
                  {permTarget?.title}
                </Text>
              </View>
              <Pressable testID="perm-modal-close-btn" onPress={() => setPermModalVisible(false)} hitSlop={8}>
                <Ionicons name="close" size={24} color={colors.onSurface} />
              </Pressable>
            </View>

            <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 14 }}>
              {/* Access Type Switcher */}
              <View>
                <Text style={styles.fieldLabel}>Who can view this document?</Text>
                <View style={styles.permTypeContainer}>
                  <Pressable
                    testID="perm-option-all"
                    style={[
                      styles.permTypeOption,
                      permAccessType === 'all' && styles.permTypeOptionActive,
                    ]}
                    onPress={() => setPermAccessType('all')}
                  >
                    <Ionicons
                      name="globe-outline"
                      size={20}
                      color={permAccessType === 'all' ? colors.brandPrimary : colors.muted}
                    />
                    <View style={{ flex: 1 }}>
                      <Text
                        style={[
                          styles.permTypeTitle,
                          permAccessType === 'all' && styles.permTypeTitleActive,
                        ]}
                      >
                        🌐 All Users (सभी कर्मचारी)
                      </Text>
                      <Text style={styles.permTypeDesc}>
                        Every employee and staff member can view and download.
                      </Text>
                    </View>
                    {permAccessType === 'all' && (
                      <Ionicons name="checkmark-circle" size={18} color={colors.brandPrimary} />
                    )}
                  </Pressable>

                  <Pressable
                    testID="perm-option-restricted"
                    style={[
                      styles.permTypeOption,
                      permAccessType === 'restricted' && styles.permTypeOptionActive,
                    ]}
                    onPress={() => setPermAccessType('restricted')}
                  >
                    <Ionicons
                      name="lock-closed-outline"
                      size={20}
                      color={permAccessType === 'restricted' ? '#d97706' : colors.muted}
                    />
                    <View style={{ flex: 1 }}>
                      <Text
                        style={[
                          styles.permTypeTitle,
                          permAccessType === 'restricted' && { color: '#b45309' },
                        ]}
                      >
                        🔒 Specific Users Only (चयनित यूज़र्स)
                      </Text>
                      <Text style={styles.permTypeDesc}>
                        Visible only to selected employees. Hidden from everyone else.
                      </Text>
                    </View>
                    {permAccessType === 'restricted' && (
                      <Ionicons name="checkmark-circle" size={18} color="#d97706" />
                    )}
                  </Pressable>
                </View>
              </View>

              {/* User Selection Checklist (Shown when restricted) */}
              {permAccessType === 'restricted' && (
                <View style={styles.userSelectorBox}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <Text style={styles.fieldLabel}>
                      Select Permitted Users ({permSelectedUsers.length} selected)
                    </Text>
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <Pressable
                        onPress={() => setPermSelectedUsers(usersList.map(u => u.user_id))}
                        style={styles.quickSelectBtn}
                      >
                        <Text style={styles.quickSelectText}>Select All</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => setPermSelectedUsers([])}
                        style={styles.quickSelectBtn}
                      >
                        <Text style={styles.quickSelectText}>Clear All</Text>
                      </Pressable>
                    </View>
                  </View>

                  {/* User Search Input */}
                  <View style={styles.userSearchInputBox}>
                    <Ionicons name="search" size={16} color={colors.muted} />
                    <TextInput
                      placeholder="Search by name, email, or role…"
                      value={userSearch}
                      onChangeText={setUserSearch}
                      style={styles.userSearchInput}
                      placeholderTextColor={colors.muted}
                    />
                    {userSearch.length > 0 && (
                      <Pressable onPress={() => setUserSearch('')}>
                        <Ionicons name="close-circle" size={16} color={colors.muted} />
                      </Pressable>
                    )}
                  </View>

                  {/* Users List with Checkboxes */}
                  <ScrollView style={{ maxHeight: 220, marginTop: 8 }}>
                    {filteredUsersList.length === 0 ? (
                      <Text style={{ textAlign: 'center', color: colors.muted, padding: 16, fontSize: 12 }}>
                        No users found matching "{userSearch}"
                      </Text>
                    ) : (
                      filteredUsersList.map(u => {
                        const isSelected = permSelectedUsers.includes(u.user_id);
                        return (
                          <Pressable
                            key={u.user_id}
                            style={[
                              styles.userItemRow,
                              isSelected && styles.userItemRowSelected,
                            ]}
                            onPress={() => {
                              if (isSelected) {
                                setPermSelectedUsers(permSelectedUsers.filter(id => id !== u.user_id));
                              } else {
                                setPermSelectedUsers([...permSelectedUsers, u.user_id]);
                              }
                            }}
                          >
                            <View style={[styles.userCheckbox, isSelected && styles.userCheckboxSelected]}>
                              {isSelected && <Ionicons name="checkmark" size={14} color="#fff" />}
                            </View>
                            <Avatar name={u.name || u.email || 'U'} size={32} />
                            <View style={{ flex: 1, marginLeft: 8 }}>
                              <Text style={styles.userNameText}>{u.name}</Text>
                              <Text style={styles.userEmailText}>{u.email}</Text>
                            </View>
                            <View style={[styles.userRoleBadge, { backgroundColor: u.role === 'admin' ? '#dbeafe' : u.role === 'manager' ? '#fef3c7' : '#f1f5f9' }]}>
                              <Text style={[styles.userRoleText, { color: u.role === 'admin' ? '#1d4ed8' : u.role === 'manager' ? '#b45309' : '#475569' }]}>
                                {u.role.toUpperCase()}
                              </Text>
                            </View>
                          </Pressable>
                        );
                      })
                    )}
                  </ScrollView>
                </View>
              )}

              {/* Modal Action Buttons */}
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
                <View style={{ flex: 1 }}>
                  <SecondaryButton
                    label="Cancel"
                    onPress={() => setPermModalVisible(false)}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <PrimaryButton
                    label={savingPerms ? "Saving…" : "Save Permissions"}
                    onPress={handleSavePermissions}
                    loading={savingPerms}
                  />
                </View>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  addFolderBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.brandPrimary,
    alignItems: 'center', justifyContent: 'center',
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: spacing.sm,
  },
  tabItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderBottomWidth: 3,
    borderBottomColor: 'transparent',
  },
  tabItemActive: {
    borderBottomColor: colors.brandPrimary,
  },
  tabLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.muted,
  },
  tabLabelActive: {
    color: colors.brandPrimary,
    fontWeight: '800',
  },
  searchBarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  searchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    height: 40,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    color: colors.onSurface,
  },
  newFolderQuickBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.brandPrimary,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: radius.md,
  },
  newFolderQuickBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#fff',
  },
  doubleClickHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.brandPrimary + '10',
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.brandPrimary + '20',
  },
  doubleClickHintText: {
    fontSize: 11,
    color: colors.brandPrimary,
    fontWeight: '600',
    flex: 1,
  },
  folderCardPressable: {
    borderRadius: radius.lg,
  },
  folderCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
    borderRadius: radius.lg,
  },
  folderIconBox: {
    width: 48, height: 48, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  folderTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.onSurface,
  },
  folderDesc: {
    fontSize: 11,
    color: colors.muted,
    marginTop: 2,
  },
  filesCountBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.brandPrimary + '12',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  filesCountText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.brandPrimary,
  },
  hintOpenText: {
    fontSize: 10,
    color: colors.muted,
    fontStyle: 'italic',
  },
  folderActionsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  folderActionIconBtn: {
    width: 32, height: 32, borderRadius: 8,
    backgroundColor: colors.surfaceSecondary,
    alignItems: 'center', justifyContent: 'center',
  },

  // Open Folder Header & Table Styles
  openFolderHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backToFoldersBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.brandPrimary + '15',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.md,
  },
  backToFoldersText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.brandPrimary,
  },
  openFolderName: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.onSurface,
  },
  openFolderSubtitle: {
    fontSize: 11,
    color: colors.muted,
    marginTop: 1,
  },
  addFirstLineBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.brandPrimary,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.md,
  },
  addFirstLineBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#fff',
  },

  // Line Table Layout
  tableHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e293b',
    paddingVertical: 10,
    paddingHorizontal: spacing.sm,
  },
  tableHeaderText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#f8fafc',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  tableDataRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    paddingVertical: 10,
    paddingHorizontal: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tableDataRowAlt: {
    backgroundColor: '#f8fafc',
  },

  // Column Widths
  colSlNo: {
    width: 60,
    alignItems: 'center',
    justifyContent: 'center',
  },
  colDesc: {
    flex: 2,
    paddingHorizontal: 8,
  },
  colUpload: {
    width: 140,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  colActions: {
    width: 170,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  colAdd: {
    width: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },

  slNoBadge: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: colors.brandPrimary + '15',
    alignItems: 'center', justifyContent: 'center',
  },
  slNoText: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.brandPrimary,
  },
  rowDescText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.onSurface,
    lineHeight: 18,
  },
  rowMetaText: {
    fontSize: 10,
    color: colors.muted,
    marginTop: 2,
  },
  inlineDescInput: {
    backgroundColor: '#fff',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
    fontSize: 13,
    color: colors.onSurface,
    borderWidth: 1.5,
    borderColor: colors.brandPrimary,
  },
  uploadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.brandSecondary,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
  },
  uploadBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#fff',
  },
  fileAttachedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.brandPrimary + '12',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.brandPrimary + '30',
  },
  fileAttachedText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.brandPrimary,
    maxWidth: 70,
  },
  replaceFileBtn: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: colors.surfaceSecondary,
    alignItems: 'center', justifyContent: 'center',
  },
  editActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.brandPrimary + '15',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
  },
  editActionBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.brandPrimary,
  },
  updateActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.success,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
  },
  updateActionBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#fff',
  },
  deleteActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.error + '15',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
  },
  deleteActionBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.error,
  },
  plusRowBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: colors.success,
    alignItems: 'center', justifyContent: 'center',
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 2,
  },

  // Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: '#00000070',
    justifyContent: 'center',
    padding: spacing.md,
  },
  modalContent: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.onSurface,
  },
  modalSubtitle: {
    fontSize: 11,
    color: colors.muted,
    marginTop: 2,
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  modalInput: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: 13,
    color: colors.onSurface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  colorChoice: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
  },
  colorChoiceActive: {
    borderWidth: 2,
    borderColor: '#000',
  },

  // Permissions Badges & Modal Styles
  permBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
  },
  permBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  rowPermBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    alignSelf: 'flex-start',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
    borderWidth: 1,
  },
  rowPermBadgeText: {
    fontSize: 9,
    fontWeight: '700',
  },
  permActionBtn: {
    width: 26, height: 26, borderRadius: 6,
    backgroundColor: '#dcfce7',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#bbf7d0',
  },
  permTypeContainer: {
    gap: 8,
    marginTop: 4,
  },
  permTypeOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSecondary,
  },
  permTypeOptionActive: {
    borderColor: colors.brandPrimary,
    backgroundColor: colors.brandPrimary + '08',
  },
  permTypeTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.onSurface,
  },
  permTypeTitleActive: {
    color: colors.brandPrimary,
  },
  permTypeDesc: {
    fontSize: 11,
    color: colors.muted,
    marginTop: 2,
  },
  userSelectorBox: {
    marginTop: 6,
    padding: 10,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  quickSelectBtn: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: colors.surface,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  quickSelectText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.brandPrimary,
  },
  userSearchInputBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    paddingHorizontal: 8,
    height: 34,
    gap: 6,
    borderWidth: 1,
    borderColor: colors.border,
  },
  userSearchInput: {
    flex: 1,
    fontSize: 12,
    color: colors.onSurface,
  },
  userItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  userItemRowSelected: {
    borderColor: colors.brandPrimary,
    backgroundColor: colors.brandPrimary + '08',
  },
  userCheckbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: colors.muted,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  userCheckboxSelected: {
    backgroundColor: colors.brandPrimary,
    borderColor: colors.brandPrimary,
  },
  userNameText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.onSurface,
  },
  userEmailText: {
    fontSize: 10,
    color: colors.muted,
  },
  userRoleBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  userRoleText: {
    fontSize: 9,
    fontWeight: '800',
  },
});
