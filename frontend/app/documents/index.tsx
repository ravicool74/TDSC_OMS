import React, { useCallback, useMemo, useState, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, FlatList, Pressable, RefreshControl,
  TextInput, ScrollView, Modal, Platform, Linking, ActivityIndicator
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { colors, spacing, radius, font } from '@/src/theme';
import { api, tokenStore } from '@/src/api';
import { Card, EmptyState, ScreenLoader, PrimaryButton, SecondaryButton, Avatar } from '@/src/ui';
import { ScreenHeader } from '@/src/ScreenHeader';
import { useAuth } from '@/src/AuthContext';
import { canWrite, canAction } from '@/src/rbac';
import { confirm, notify } from '@/src/dialog';

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
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';
  const canEdit = user?.role === 'admin' || user?.role === 'manager' || canWrite(user, 'documents') || canAction(user, 'documents', 'edit') || canAction(user, 'documents', 'add');
  const canDelete = isAdmin || canAction(user, 'documents', 'delete');

  const [activeMenu, setActiveMenu] = useState<SubMenu>('forms_and_rules');
  const [folders, setFolders] = useState<any[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Selected open folder state
  const [openFolder, setOpenFolder] = useState<any | null>(null);
  const openFolderRef = useRef<any>(null);
  openFolderRef.current = openFolder;
  const [folderFiles, setFolderFiles] = useState<any[] | null>(null);
  const [subfolders, setSubfolders] = useState<any[]>([]);
  const [breadcrumbs, setBreadcrumbs] = useState<any[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);

  // Search inside open folder
  const [searchFileQuery, setSearchFileQuery] = useState('');

  // Multiple File Selection & Move state
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>([]);
  const [moveModalVisible, setMoveModalVisible] = useState(false);
  const [hierarchyFolders, setHierarchyFolders] = useState<any[]>([]);
  const [targetFolderId, setTargetFolderId] = useState('');
  const [targetFolderSearch, setTargetFolderSearch] = useState('');
  const [loadingHierarchy, setLoadingHierarchy] = useState(false);
  const [movingFiles, setMovingFiles] = useState(false);

  // Batch upload state
  const [batchUploading, setBatchUploading] = useState(false);
  const [batchUploadingFolderId, setBatchUploadingFolderId] = useState<string | null>(null);

  // Folder creation / rename modal
  const [folderModalVisible, setFolderModalVisible] = useState(false);
  const [editingFolder, setEditingFolder] = useState<any | null>(null);
  const [folderParentId, setFolderParentId] = useState<string | null>(null);
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

  // Load Folders (Root level)
  const loadFolders = useCallback(async () => {
    try {
      const data = await api.getDocFolders(activeMenu, searchQuery, 'root');
      setFolders(data || []);
    } catch {
      setFolders([]);
    }
  }, [activeMenu, searchQuery]);

  // Load Files, Subfolders & Breadcrumbs for open folder
  const loadFilesForFolder = useCallback(async (fid: string) => {
    setLoadingFiles(true);
    setSelectedFileIds([]);
    try {
      const res = await api.getFolderFiles(fid);
      setFolderFiles(res.files || []);
      setSubfolders(res.subfolders || []);
      setBreadcrumbs(res.breadcrumbs || []);
      if (res.folder) {
        setOpenFolder((prev: any) => (prev && prev.id === res.folder.id ? { ...prev, ...res.folder } : res.folder));
      }
    } catch (e: any) {
      notify('Error', e?.message || 'Failed to load folder files');
      setFolderFiles([]);
      setSubfolders([]);
      setBreadcrumbs([]);
    } finally {
      setLoadingFiles(false);
    }
  }, []);

  // Filter files by search query inside folder
  const filteredFiles = useMemo(() => {
    if (!folderFiles) return [];
    if (!searchFileQuery.trim()) return folderFiles;
    const q = searchFileQuery.trim().toLowerCase();
    return folderFiles.filter(f =>
      (f.file_description && f.file_description.toLowerCase().includes(q)) ||
      (f.file_name && f.file_name.toLowerCase().includes(q))
    );
  }, [folderFiles, searchFileQuery]);

  // Selection handlers
  const isAllSelected = useMemo(() => {
    if (!filteredFiles.length) return false;
    return filteredFiles.every(f => selectedFileIds.includes(f.id));
  }, [filteredFiles, selectedFileIds]);

  const toggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedFileIds([]);
    } else {
      setSelectedFileIds(filteredFiles.map(f => f.id));
    }
  };

  const toggleSelectRow = (fileId: string) => {
    if (selectedFileIds.includes(fileId)) {
      setSelectedFileIds(selectedFileIds.filter(id => id !== fileId));
    } else {
      setSelectedFileIds([...selectedFileIds, fileId]);
    }
  };

  // Open Move Modal
  const openMoveModal = async () => {
    if (!selectedFileIds.length || !openFolder) return;
    setMoveModalVisible(true);
    setTargetFolderId('');
    setTargetFolderSearch('');
    setLoadingHierarchy(true);
    try {
      const list = await api.getDocFoldersHierarchy(openFolder.category);
      // Exclude current folder
      setHierarchyFolders((list || []).filter(f => f.id !== openFolder.id));
    } catch {
      setHierarchyFolders([]);
    } finally {
      setLoadingHierarchy(false);
    }
  };

  const filteredHierarchyFolders = useMemo(() => {
    if (!targetFolderSearch.trim()) return hierarchyFolders;
    const q = targetFolderSearch.trim().toLowerCase();
    return hierarchyFolders.filter(f =>
      (f.name && f.name.toLowerCase().includes(q)) ||
      (f.path_display && f.path_display.toLowerCase().includes(q))
    );
  }, [hierarchyFolders, targetFolderSearch]);

  const handleConfirmMoveFiles = async () => {
    if (!targetFolderId || !selectedFileIds.length || !openFolder) return;
    setMovingFiles(true);
    try {
      const res = await api.moveDocFiles(selectedFileIds, targetFolderId);
      notify('Success', `${res.moved_count || selectedFileIds.length} file(s) moved to "${res.target_folder_name || 'destination folder'}".`);
      setSelectedFileIds([]);
      setMoveModalVisible(false);
      await loadFilesForFolder(openFolder.id);
    } catch (e: any) {
      notify('Move Error', e?.message || 'Failed to move files');
    } finally {
      setMovingFiles(false);
    }
  };

  // Batch upload multiple files directly into current folder
  const handleBatchUploadForCurrentFolder = async () => {
    if (!openFolder) return;
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        multiple: true,
        copyToCacheDirectory: true,
      });
      if (res.canceled || !res.assets?.length) return;
      const validAssets = res.assets.filter(a => {
        if (a.size && a.size > MAX_FILE_SIZE) {
          notify('File Too Large', `"${a.name}" exceeds 50 MB limit and was skipped.`);
          return false;
        }
        return true;
      });
      if (!validAssets.length) return;
      setBatchUploading(true);
      const result = await api.batchUploadDocFiles(
        openFolder.id,
        validAssets.map(a => ({
          uri: a.uri,
          name: a.name,
          type: a.mimeType || 'application/octet-stream',
        }))
      );
      await loadFilesForFolder(openFolder.id);
      notify('Upload Complete', `${result.count || validAssets.length} file(s) uploaded successfully into "${openFolder.name}".`);
    } catch (e: any) {
      notify('Upload Error', e?.message || 'Failed to upload files.');
    } finally {
      setBatchUploading(false);
    }
  };

  // Batch upload multiple files directly into a specific folder card
  const handleBatchUploadForFolderCard = async (targetFolder: any) => {
    if (!targetFolder) return;
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        multiple: true,
        copyToCacheDirectory: true,
      });
      if (res.canceled || !res.assets?.length) return;
      const validAssets = res.assets.filter(a => {
        if (a.size && a.size > MAX_FILE_SIZE) {
          notify('File Too Large', `"${a.name}" exceeds 50 MB limit and was skipped.`);
          return false;
        }
        return true;
      });
      if (!validAssets.length) return;
      setBatchUploadingFolderId(targetFolder.id);
      const result = await api.batchUploadDocFiles(
        targetFolder.id,
        validAssets.map(a => ({
          uri: a.uri,
          name: a.name,
          type: a.mimeType || 'application/octet-stream',
        }))
      );
      await loadFolders();
      notify('Upload Complete', `${result.count || validAssets.length} file(s) uploaded successfully into "${targetFolder.name}".`);
    } catch (e: any) {
      notify('Upload Error', e?.message || 'Failed to upload files.');
    } finally {
      setBatchUploadingFolderId(null);
    }
  };

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
        notify('Success', `Permissions updated for "${permTarget.title}".`);
        if (openFolder?.id === permTarget.id) {
          setOpenFolder((prev: any) => ({
            ...prev,
            access_type: permAccessType,
            allowed_user_ids: permSelectedUsers,
          }));
        } else {
          await loadFolders();
        }
      } else {
        if (openFolder) {
          await api.updateDocFilePermissions(openFolder.id, permTarget.id, {
            access_type: permAccessType,
            allowed_user_ids: permSelectedUsers,
          });
          notify('Success', 'Document permissions updated.');
          await loadFilesForFolder(openFolder.id);
        }
      }
      setPermModalVisible(false);
    } catch (e: any) {
      notify('Error', e?.message || 'Failed to update permissions.');
    } finally {
      setSavingPerms(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      loadFolders();
      loadUsersList();
    }, [loadFolders, loadUsersList])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    if (openFolderRef.current) {
      await loadFilesForFolder(openFolderRef.current.id);
    } else {
      await loadFolders();
    }
    setRefreshing(false);
  };

  // Open folder handler
  const handleOpenFolder = (fld: any) => {
    setOpenFolder(fld);
    setSearchFileQuery('');
    setSelectedFileIds([]);
    loadFilesForFolder(fld.id);
  };

  // Double click / tap detection for folder cards
  const handleFolderClick = (fld: any) => {
    const now = Date.now();
    const last = lastClickRef.current;
    if (last.id === fld.id && now - last.time < 350) {
      handleOpenFolder(fld);
      lastClickRef.current = { id: '', time: 0 };
    } else {
      lastClickRef.current = { id: fld.id, time: now };
    }
  };

  // Folder Create / Edit modals
  const openCreateFolderModal = (parentId?: string) => {
    setEditingFolder(null);
    setFolderParentId(parentId || null);
    setFolderName('');
    setFolderDesc('');
    setFolderColor(activeMenu === 'forms_and_rules' ? '#f59e0b' : '#3b82f6');
    setFolderModalVisible(true);
  };

  const openRenameFolderModal = (fld: any) => {
    setEditingFolder(fld);
    setFolderParentId(fld.parent_id || null);
    setFolderName(fld.name);
    setFolderDesc(fld.description || '');
    setFolderColor(fld.color || '#3b82f6');
    setFolderModalVisible(true);
  };

  const handleSaveFolder = async () => {
    if (!folderName.trim()) {
      notify('Validation Error', 'Folder name is required.');
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
        notify('Success', 'Folder renamed successfully.');
        if (openFolder?.id === editingFolder.id) {
          setOpenFolder((prev: any) => ({
            ...prev,
            name: folderName.trim(),
            description: folderDesc.trim(),
            color: folderColor,
          }));
        }
      } else {
        await api.createDocFolder({
          name: folderName.trim(),
          category: openFolder ? openFolder.category : activeMenu,
          parent_id: folderParentId || undefined,
          description: folderDesc.trim() || undefined,
          color: folderColor,
        });
        notify('Success', folderParentId ? 'Subfolder created successfully.' : 'New folder created.');
      }
      setFolderModalVisible(false);
      if (openFolder) {
        await loadFilesForFolder(openFolder.id);
      }
      await loadFolders();
    } catch (e: any) {
      notify('Error', e?.message || 'Failed to save folder.');
    } finally {
      setSavingFolder(false);
    }
  };

  const handleDeleteFolder = async (fld: any) => {
    const ok = await confirm(
      'Delete Folder?',
      `Are you sure you want to permanently delete "${fld.name}" and all subfolders and files contained within it?`,
      { confirmText: 'Delete', destructive: true }
    );
    if (!ok) return;
    try {
      await api.deleteDocFolder(fld.id);
      if (openFolder?.id === fld.id) {
        if (breadcrumbs.length > 1) {
          const parentCrumb = breadcrumbs[breadcrumbs.length - 2];
          await handleOpenFolder(parentCrumb);
        } else {
          setOpenFolder(null);
        }
      } else if (openFolder) {
        await loadFilesForFolder(openFolder.id);
      }
      await loadFolders();
      notify('Success', `Folder "${fld.name}" deleted successfully.`);
    } catch (e: any) {
      notify('Error', e?.message || 'Failed to delete folder.');
    }
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
      setEditingRowId(res.id);
      setEditingDescription(res.file_description || '');
    } catch (e: any) {
      notify('Error', e?.message || 'Failed to insert row');
    } finally {
      setAddingRowBelowId(null);
    }
  };

  // Start inline editing
  const handleStartEditRow = (row: any) => {
    setEditingRowId(row.id);
    setEditingDescription(row.file_description || '');
  };

  // Save inline edit (Update)
  const handleUpdateRow = async (rowId: string) => {
    if (!openFolder) return;
    if (!editingDescription.trim()) {
      notify('Validation Error', 'Description cannot be empty');
      return;
    }
    try {
      await api.updateDocFileRow(openFolder.id, rowId, {
        file_description: editingDescription.trim(),
      });
      setEditingRowId(null);
      await loadFilesForFolder(openFolder.id);
    } catch (e: any) {
      notify('Error', e?.message || 'Failed to update row');
    }
  };

  // Delete row
  const handleDeleteRow = async (row: any) => {
    if (!openFolder) return;
    const ok = await confirm(
      'Delete Row?',
      `Delete row Sl. No. ${row.sl_no} ("${row.file_description}")?`,
      { confirmText: 'Delete', destructive: true }
    );
    if (!ok) return;
    try {
      await api.deleteDocFileRow(openFolder.id, row.id);
      await loadFilesForFolder(openFolder.id);
      notify('Success', 'Row deleted successfully.');
    } catch (e: any) {
      notify('Error', e?.message || 'Failed to delete row');
    }
  };

  // Upload File Button for single row
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
        notify('File Too Large', 'Maximum file size allowed is 50 MB.');
        return;
      }
      setUploadingRowId(fileId);
      await api.uploadDocFileAttachment(openFolder.id, fileId, {
        uri: asset.uri,
        name: asset.name,
        type: asset.mimeType || 'application/octet-stream',
      });
      await loadFilesForFolder(openFolder.id);
      notify('Uploaded', `"${asset.name}" attached successfully.`);
    } catch (e: any) {
      notify('Upload Error', e?.message || 'Failed to upload document');
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
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            {!openFolder && canEdit && (
              <Pressable
                testID="create-folder-btn"
                onPress={() => openCreateFolderModal()}
                style={styles.addFolderBtn}
                accessibilityLabel="Create Folder"
              >
                <Ionicons name="add" size={22} color="#fff" />
              </Pressable>
            )}
            {openFolder && canEdit && (
              <Pressable
                onPress={() => openCreateFolderModal(openFolder.id)}
                style={[styles.addFolderBtn, { backgroundColor: colors.brandSecondary }]}
                accessibilityLabel="Create Subfolder"
              >
                <Ionicons name="folder-outline" size={18} color="#fff" />
              </Pressable>
            )}
          </View>
        )}
      />

      {/* Main Tab Navigation: 1. General Documents | 2. 20. Form & Rules */}
      {!openFolder && (
        <View style={styles.tabBar}>
          <Pressable
            testID="tab-general"
            style={[styles.tabItem, activeMenu === 'general' && styles.tabItemActive]}
            onPress={() => {
              setActiveMenu('general');
              setSearchQuery('');
            }}
          >
            <Ionicons
              name="folder-outline"
              size={18}
              color={activeMenu === 'general' ? colors.brandPrimary : colors.muted}
            />
            <Text style={[styles.tabLabel, activeMenu === 'general' && styles.tabLabelActive]}>
              Document Library
            </Text>
          </Pressable>

          <Pressable
            testID="tab-forms-and-rules"
            style={[styles.tabItem, activeMenu === 'forms_and_rules' && styles.tabItemActive]}
            onPress={() => {
              setActiveMenu('forms_and_rules');
              setSearchQuery('');
            }}
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
      {/* 1. ROOT VIEW: FOLDERS LIST                                                */}
      {/* ========================================================================= */}
      {!openFolder && (
        <View style={{ flex: 1 }}>
          {/* Search Bar + Quick Create Button */}
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
                  <Ionicons name="close-circle" size={16} color={colors.muted} />
                </Pressable>
              )}
            </View>

            {canEdit && (
              <Pressable
                testID="create-folder-quick-btn"
                style={styles.newFolderQuickBtn}
                onPress={() => openCreateFolderModal()}
              >
                <Ionicons name="folder-open" size={16} color="#fff" />
                <Text style={styles.newFolderQuickBtnText}>+ Create Folder</Text>
              </Pressable>
            )}
          </View>

          {/* Double Click Hint Banner */}
          <View style={styles.doubleClickHint}>
            <Ionicons name="information-circle-outline" size={16} color={colors.brandPrimary} />
            <Text style={styles.doubleClickHintText}>
              Double-click (or tap) on any folder to open and view the line table with Upload, Edit & "+" options.
            </Text>
          </View>

          {/* Folders List Cards */}
          {folders === null ? (
            <ActivityIndicator size="large" color={colors.brandPrimary} style={{ marginVertical: 40 }} />
          ) : folders.length === 0 ? (
            <EmptyState
              icon="folder-open-outline"
              title="No Folders Found"
              subtitle={searchQuery ? `No folders matching "${searchQuery}"` : "Click '+ Create Folder' to start adding folders to this section."}
              actionLabel={canEdit ? "+ Create First Folder" : undefined}
              onAction={canEdit ? () => openCreateFolderModal() : undefined}
            />
          ) : (
            <FlatList
              data={folders}
              keyExtractor={item => item.id}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
              contentContainerStyle={{ padding: spacing.md, gap: 10, paddingBottom: 100 }}
              renderItem={({ item }) => (
                <Pressable
                  testID={`folder-card-${item.id}`}
                  style={styles.folderCardPressable}
                  onPress={() => handleFolderClick(item)}
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
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
                          <View style={styles.filesCountBadge}>
                            <Ionicons name="document-text-outline" size={11} color={colors.brandPrimary} />
                            <Text style={styles.filesCountText}>{item.files_count ?? 0} Files</Text>
                          </View>

                          {item.subfolders_count ? (
                            <View style={[styles.filesCountBadge, { backgroundColor: '#f0fdf4' }]}>
                              <Ionicons name="folder-outline" size={11} color="#16a34a" />
                              <Text style={[styles.filesCountText, { color: '#16a34a' }]}>{item.subfolders_count} Subs</Text>
                            </View>
                          ) : null}

                          {/* Access Badge for Non-Restricted vs Restricted */}
                          {isAdmin && (
                            item.access_type === 'restricted' ? (
                              <View style={[styles.permBadge, { backgroundColor: '#fef3c7', borderColor: '#fde68a' }]}>
                                <Ionicons name="lock-closed" size={10} color="#d97706" />
                                <Text style={[styles.permBadgeText, { color: '#b45309' }]}>
                                  Restricted ({item.allowed_count ?? item.allowed_user_ids?.length ?? 0})
                                </Text>
                              </View>
                            ) : (
                              <View style={[styles.permBadge, { backgroundColor: '#dcfce7', borderColor: '#bbf7d0' }]}>
                                <Ionicons name="globe-outline" size={10} color="#16a34a" />
                                <Text style={[styles.permBadgeText, { color: '#15803d' }]}>All Users</Text>
                              </View>
                            )
                          )}
                          <Text style={styles.hintOpenText}>Double-click to open</Text>
                        </View>
                      </View>
                    </View>

                    {/* Action Buttons on Folder Card */}
                    <View style={styles.folderActionsContainer}>
                      {canEdit && (
                        <Pressable
                          style={[styles.folderActionIconBtn, { backgroundColor: '#eff6ff' }]}
                          onPress={(e: any) => {
                            e?.stopPropagation?.();
                            handleBatchUploadForFolderCard(item);
                          }}
                          disabled={batchUploadingFolderId === item.id}
                          accessibilityLabel="Upload Multiple Files Directly"
                        >
                          {batchUploadingFolderId === item.id ? (
                            <ActivityIndicator size="small" color={colors.brandPrimary} />
                          ) : (
                            <Ionicons name="cloud-upload-outline" size={16} color={colors.brandPrimary} />
                          )}
                        </Pressable>
                      )}
                      {isAdmin && (
                        <Pressable
                          testID={`folder-perms-${item.id}`}
                          style={[styles.folderActionIconBtn, { backgroundColor: '#f0fdf4' }]}
                          onPress={(e: any) => {
                            e?.stopPropagation?.();
                            openFolderPermissionsModal(item);
                          }}
                          accessibilityLabel="Manage Access Permissions"
                        >
                          <Ionicons name="shield-checkmark" size={16} color="#16a34a" />
                        </Pressable>
                      )}
                      {canEdit && (
                        <Pressable
                          testID={`folder-rename-${item.id}`}
                          style={styles.folderActionIconBtn}
                          onPress={(e: any) => {
                            e?.stopPropagation?.();
                            openRenameFolderModal(item);
                          }}
                          accessibilityLabel="Rename Folder"
                        >
                          <Ionicons name="pencil" size={16} color={colors.brandPrimary} />
                        </Pressable>
                      )}
                      {(canEdit || canDelete) && (
                        <Pressable
                          testID={`folder-delete-${item.id}`}
                          style={[styles.folderActionIconBtn, { backgroundColor: '#fef2f2' }]}
                          onPress={(e: any) => {
                            e?.stopPropagation?.();
                            handleDeleteFolder(item);
                          }}
                          accessibilityLabel="Delete Folder"
                        >
                          <Ionicons name="trash-outline" size={16} color={colors.error} />
                        </Pressable>
                      )}
                      <Pressable
                        testID={`folder-open-${item.id}`}
                        style={[styles.folderActionIconBtn, { backgroundColor: colors.brandPrimary + '15' }]}
                        onPress={(e: any) => {
                          e?.stopPropagation?.();
                          handleOpenFolder(item);
                        }}
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
      {/* 2. OPEN FOLDER: BREADCRUMBS, SUBFOLDERS, SEARCH, SELECTION & TABLE VIEW    */}
      {/* ========================================================================= */}
      {openFolder && (
        <View style={{ flex: 1 }}>
          {/* Breadcrumb Navigation Bar */}
          <View style={styles.breadcrumbBar}>
            <Pressable
              style={styles.breadcrumbItem}
              onPress={() => setOpenFolder(null)}
            >
              <Ionicons name="home" size={14} color={colors.brandPrimary} />
              <Text style={styles.breadcrumbText}>All Folders</Text>
            </Pressable>
            {breadcrumbs.map((crumb, idx) => {
              const isLast = idx === breadcrumbs.length - 1;
              return (
                <View key={crumb.id} style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Ionicons name="chevron-forward" size={13} color={colors.muted} style={{ marginHorizontal: 3 }} />
                  {isLast ? (
                    <Text style={styles.breadcrumbCurrentText} numberOfLines={1}>{crumb.name}</Text>
                  ) : (
                    <Pressable onPress={() => handleOpenFolder(crumb)}>
                      <Text style={styles.breadcrumbText} numberOfLines={1}>{crumb.name}</Text>
                    </Pressable>
                  )}
                </View>
              );
            })}
          </View>

          {/* Folder Info Banner & Action Controls */}
          <View style={styles.openFolderHeader}>
            <Pressable
              style={styles.backToFoldersBtn}
              onPress={() => {
                if (breadcrumbs.length > 1) {
                  handleOpenFolder(breadcrumbs[breadcrumbs.length - 2]);
                } else {
                  setOpenFolder(null);
                }
              }}
            >
              <Ionicons name="arrow-back" size={16} color={colors.brandPrimary} />
              <Text style={styles.backToFoldersText}>
                {breadcrumbs.length > 1 ? "Up Level" : "All Folders"}
              </Text>
            </Pressable>

            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={styles.openFolderName} numberOfLines={1}>📁 {openFolder.name}</Text>
                {canEdit && (
                  <Pressable
                    style={styles.folderHeaderMiniBtn}
                    onPress={() => openRenameFolderModal(openFolder)}
                    accessibilityLabel="Rename Current Folder"
                  >
                    <Ionicons name="pencil" size={13} color={colors.brandPrimary} />
                  </Pressable>
                )}
                {(canEdit || canDelete) && (
                  <Pressable
                    style={[styles.folderHeaderMiniBtn, { backgroundColor: '#fef2f2' }]}
                    onPress={() => handleDeleteFolder(openFolder)}
                    accessibilityLabel="Delete Current Folder"
                  >
                    <Ionicons name="trash-outline" size={13} color={colors.error} />
                  </Pressable>
                )}
              </View>
              <Text style={styles.openFolderSubtitle}>
                {openFolder.category === 'forms_and_rules' ? '20. Form & Rules Table' : 'Document Library'} • {folderFiles?.length || 0} lines {subfolders.length ? `• ${subfolders.length} subfolders` : ''}
              </Text>
            </View>

            {/* Action Buttons in Folder Header */}
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              {canEdit && (
                <Pressable
                  style={styles.headerActionBtnSecondary}
                  onPress={() => openCreateFolderModal(openFolder.id)}
                >
                  <Ionicons name="folder-open-outline" size={14} color={colors.brandPrimary} />
                  <Text style={styles.headerActionBtnSecondaryText}>+ Subfolder</Text>
                </Pressable>
              )}

              {canEdit && (
                <Pressable
                  style={styles.headerActionBtnSecondary}
                  onPress={handleBatchUploadForCurrentFolder}
                  disabled={batchUploading}
                >
                  {batchUploading ? (
                    <ActivityIndicator size="small" color={colors.brandPrimary} />
                  ) : (
                    <Ionicons name="cloud-upload-outline" size={14} color={colors.brandPrimary} />
                  )}
                  <Text style={styles.headerActionBtnSecondaryText}>
                    {batchUploading ? "Uploading…" : "Upload Files"}
                  </Text>
                </Pressable>
              )}

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
          </View>

          {/* Subfolders Shelf / Grid (if any exist) */}
          {subfolders && subfolders.length > 0 && (
            <View style={styles.subfoldersSection}>
              <View style={styles.subfoldersSectionHeader}>
                <Text style={styles.subfoldersSectionTitle}>Subfolders ({subfolders.length})</Text>
                {canEdit && (
                  <Pressable
                    style={styles.createSubfolderSmallBtn}
                    onPress={() => openCreateFolderModal(openFolder.id)}
                  >
                    <Ionicons name="add" size={13} color={colors.brandPrimary} />
                    <Text style={styles.createSubfolderSmallBtnText}>+ New Subfolder</Text>
                  </Pressable>
                )}
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.subfoldersScroll}>
                {subfolders.map((sf: any) => (
                  <Pressable
                    key={sf.id}
                    style={styles.subfolderCard}
                    onPress={() => handleOpenFolder(sf)}
                  >
                    <View style={[styles.subfolderIconBox, { backgroundColor: (sf.color || '#3b82f6') + '20' }]}>
                      <Ionicons name="folder" size={20} color={sf.color || '#3b82f6'} />
                    </View>
                    <View style={{ flex: 1, minWidth: 90 }}>
                      <Text style={styles.subfolderCardTitle} numberOfLines={1}>{sf.name}</Text>
                      <Text style={styles.subfolderCardSubtitle}>
                        {sf.files_count || 0} files {sf.subfolders_count ? `• ${sf.subfolders_count} subs` : ''}
                      </Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      {canEdit && (
                        <Pressable
                          style={[styles.subfolderActionBtn, { backgroundColor: '#eff6ff' }]}
                          onPress={(e) => { e.stopPropagation(); handleBatchUploadForFolderCard(sf); }}
                          accessibilityLabel="Upload to Subfolder"
                        >
                          <Ionicons name="cloud-upload-outline" size={12} color={colors.brandPrimary} />
                        </Pressable>
                      )}
                      {canEdit && (
                        <Pressable
                          style={styles.subfolderActionBtn}
                          onPress={(e) => { e.stopPropagation(); openRenameFolderModal(sf); }}
                          accessibilityLabel="Rename Subfolder"
                        >
                          <Ionicons name="pencil" size={12} color={colors.brandPrimary} />
                        </Pressable>
                      )}
                      {(canEdit || canDelete) && (
                        <Pressable
                          style={[styles.subfolderActionBtn, { backgroundColor: '#fef2f2' }]}
                          onPress={(e) => { e.stopPropagation(); handleDeleteFolder(sf); }}
                          accessibilityLabel="Delete Subfolder"
                        >
                          <Ionicons name="trash-outline" size={12} color={colors.error} />
                        </Pressable>
                      )}
                      <Ionicons name="chevron-forward" size={14} color={colors.muted} />
                    </View>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          )}

          {/* Search files inside this folder */}
          <View style={styles.folderSearchContainer}>
            <View style={styles.folderSearchBox}>
              <Ionicons name="search" size={16} color={colors.muted} />
              <TextInput
                placeholder="Search files in this folder by description or file name…"
                value={searchFileQuery}
                onChangeText={setSearchFileQuery}
                style={styles.folderSearchInput}
                placeholderTextColor={colors.muted}
              />
              {searchFileQuery.length > 0 && (
                <Pressable onPress={() => setSearchFileQuery('')}>
                  <Ionicons name="close-circle" size={16} color={colors.muted} />
                </Pressable>
              )}
            </View>
            {folderFiles && folderFiles.length > 0 && (
              <Text style={styles.folderSearchCountText}>
                {filteredFiles.length} / {folderFiles.length} files
              </Text>
            )}
          </View>

          {/* Multi-Selection Action Toolbar */}
          {selectedFileIds.length > 0 && (
            <View style={styles.selectionBar}>
              <View style={styles.selectionBarLeft}>
                <View style={styles.selectionCountBadge}>
                  <Text style={styles.selectionCountText}>{selectedFileIds.length}</Text>
                </View>
                <Text style={styles.selectionBarTitle}>file(s) selected</Text>
              </View>
              <View style={styles.selectionBarRight}>
                <Pressable
                  style={styles.selectionClearBtn}
                  onPress={() => setSelectedFileIds([])}
                >
                  <Text style={styles.selectionClearBtnText}>Deselect</Text>
                </Pressable>
                {canEdit && (
                  <Pressable
                    style={styles.selectionMoveBtn}
                    onPress={openMoveModal}
                  >
                    <Ionicons name="folder-open" size={14} color="#fff" />
                    <Text style={styles.selectionMoveBtnText}>Move to Folder</Text>
                  </Pressable>
                )}
              </View>
            </View>
          )}

          {/* TABLE HEADER (Select, Sl. No., File Description, Upload file, Edit, Update, Delete, "+") */}
          <View style={styles.tableHeaderRow}>
            {canEdit && (
              <Pressable
                style={styles.colCheck}
                onPress={toggleSelectAll}
                accessibilityLabel="Select All"
              >
                <View style={[styles.selectCheckbox, isAllSelected && styles.selectCheckboxActive]}>
                  {isAllSelected && <Ionicons name="checkmark" size={12} color="#fff" />}
                </View>
              </Pressable>
            )}
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
          ) : filteredFiles.length === 0 ? (
            <EmptyState
              icon="document-attach-outline"
              title={searchFileQuery ? "No matching files" : "Folder is Empty"}
              subtitle={
                searchFileQuery
                  ? `No files matching "${searchFileQuery}"`
                  : canEdit
                  ? "Click '+ Add Row' to insert a line or 'Upload Files' to upload documents directly."
                  : "No documents have been added to this folder yet."
              }
              actionLabel={canEdit && !searchFileQuery ? "+ Add First Row" : undefined}
              onAction={canEdit && !searchFileQuery ? () => handleInsertRowBelow(undefined) : undefined}
            />
          ) : (
            <FlatList
              data={filteredFiles}
              keyExtractor={item => item.id}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
              contentContainerStyle={{ paddingBottom: 120 }}
              renderItem={({ item, index }) => {
                const isEditing = editingRowId === item.id;
                const isUploading = uploadingRowId === item.id;
                const isInsertingBelow = addingRowBelowId === item.id;
                const isRowSelected = selectedFileIds.includes(item.id);

                return (
                  <View style={[
                    styles.tableDataRow,
                    index % 2 === 1 && styles.tableDataRowAlt,
                    isRowSelected && styles.tableDataRowSelected,
                  ]}>
                    {/* Checkbox Column */}
                    {canEdit && (
                      <Pressable
                        style={styles.colCheck}
                        onPress={() => toggleSelectRow(item.id)}
                        accessibilityLabel="Select File"
                      >
                        <View style={[styles.selectCheckbox, isRowSelected && styles.selectCheckboxActive]}>
                          {isRowSelected && <Ionicons name="checkmark" size={12} color="#fff" />}
                        </View>
                      </Pressable>
                    )}

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
                            testID={`download-file-${item.id}`}
                            style={styles.fileAttachedChip}
                            onPress={() => handleOpenFile(item.file_path)}
                            accessibilityLabel="View / Download Document"
                          >
                            <Ionicons name="document-attach" size={14} color={colors.brandPrimary} />
                            <Text style={styles.fileAttachedText} numberOfLines={1}>
                              {item.file_name || 'Download'}
                            </Text>
                          </Pressable>
                          {canEdit && (
                            <Pressable
                              testID={`replace-file-${item.id}`}
                              style={styles.replaceFileBtn}
                              onPress={() => handlePickAndUploadFile(item.id)}
                              accessibilityLabel="Replace Attachment"
                            >
                              <Ionicons name="sync" size={12} color={colors.muted} />
                            </Pressable>
                          )}
                        </View>
                      ) : canEdit ? (
                        <Pressable
                          testID={`upload-file-${item.id}`}
                          style={styles.uploadBtn}
                          onPress={() => handlePickAndUploadFile(item.id)}
                          accessibilityLabel="Upload File"
                        >
                          <Ionicons name="cloud-upload" size={13} color="#fff" />
                          <Text style={styles.uploadBtnText}>Upload file</Text>
                        </Pressable>
                      ) : (
                        <Text style={{ fontSize: 11, color: colors.muted, fontStyle: 'italic' }}>
                          No document
                        </Text>
                      )}
                    </View>

                    {/* 4. Actions (Edit / Update / Delete) Column */}
                    {canEdit && (
                      <View style={styles.colActions}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
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
                            testID={`row-delete-${item.id}`}
                            style={styles.deleteActionBtn}
                            onPress={(e: any) => {
                              e?.stopPropagation?.();
                              handleDeleteRow(item);
                            }}
                            accessibilityLabel="Delete"
                          >
                            <Ionicons name="trash-outline" size={13} color={colors.error} />
                            <Text style={styles.deleteActionBtnText}>Delete</Text>
                          </Pressable>
                        </View>
                      </View>
                    )}

                    {/* 5. "+" Sign in Last Column */}
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
      {/* MODAL 1: CREATE / RENAME FOLDER (OR SUBFOLDER)                            */}
      {/* ========================================================================= */}
      <Modal visible={folderModalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>
                  {editingFolder
                    ? 'Rename Folder'
                    : folderParentId
                    ? 'Create Subfolder'
                    : 'Create New Folder'}
                </Text>
                <Text style={styles.modalSubtitle}>
                  {folderParentId
                    ? `Inside: "${openFolder?.name}"`
                    : activeMenu === 'forms_and_rules'
                    ? '20. Form & Rules Section'
                    : 'Document Library'}
                </Text>
              </View>
              <Pressable onPress={() => setFolderModalVisible(false)} style={styles.modalCloseBtn}>
                <Ionicons name="close" size={20} color={colors.muted} />
              </Pressable>
            </View>

            <View style={{ gap: 12 }}>
              <View>
                <Text style={styles.fieldLabel}>Folder Name *</Text>
                <TextInput
                  placeholder="e.g. Affidavit, Schedule of Rates, CPWD Forms…"
                  value={folderName}
                  onChangeText={setFolderName}
                  style={styles.modalInput}
                  autoFocus
                />
              </View>

              <View>
                <Text style={styles.fieldLabel}>Description (Optional)</Text>
                <TextInput
                  placeholder="Short description or instructions…"
                  value={folderDesc}
                  onChangeText={setFolderDesc}
                  style={[styles.modalInput, { height: 60, textAlignVertical: 'top' }]}
                  multiline
                />
              </View>

              <View>
                <Text style={styles.fieldLabel}>Folder Color Tag</Text>
                <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
                  {['#3b82f6', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#ec4899'].map(c => (
                    <Pressable
                      key={c}
                      style={[
                        styles.colorChoice,
                        { backgroundColor: c },
                        folderColor === c && styles.colorChoiceActive,
                      ]}
                      onPress={() => setFolderColor(c)}
                    >
                      {folderColor === c && <Ionicons name="checkmark" size={16} color="#fff" />}
                    </Pressable>
                  ))}
                </View>
              </View>

              <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
                <View style={{ flex: 1 }}>
                  <SecondaryButton
                    label="Cancel"
                    onPress={() => setFolderModalVisible(false)}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <PrimaryButton
                    label={savingFolder ? "Saving…" : editingFolder ? "Rename" : "Create"}
                    onPress={handleSaveFolder}
                    loading={savingFolder}
                  />
                </View>
              </View>
            </View>
          </View>
        </View>
      </Modal>

      {/* ========================================================================= */}
      {/* MODAL 2: MOVE SELECTED FILES TO ANOTHER FOLDER                            */}
      {/* ========================================================================= */}
      <Modal visible={moveModalVisible} animationType="fade" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxWidth: 520 }]}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>Move {selectedFileIds.length} File(s)</Text>
                <Text style={styles.modalSubtitle}>
                  Select destination folder in {openFolder?.category === 'forms_and_rules' ? '20. Form & Rules' : 'Document Library'}:
                </Text>
              </View>
              <Pressable onPress={() => setMoveModalVisible(false)} style={styles.modalCloseBtn}>
                <Ionicons name="close" size={20} color={colors.muted} />
              </Pressable>
            </View>

            {/* Destination Search */}
            <View style={styles.userSearchInputBox}>
              <Ionicons name="search" size={16} color={colors.muted} />
              <TextInput
                placeholder="Filter destination folders…"
                value={targetFolderSearch}
                onChangeText={setTargetFolderSearch}
                style={styles.userSearchInput}
                placeholderTextColor={colors.muted}
              />
              {targetFolderSearch.length > 0 && (
                <Pressable onPress={() => setTargetFolderSearch('')}>
                  <Ionicons name="close-circle" size={16} color={colors.muted} />
                </Pressable>
              )}
            </View>

            {/* Destination Folders List */}
            <ScrollView style={{ maxHeight: 260, marginTop: 10 }}>
              {loadingHierarchy ? (
                <ActivityIndicator size="small" color={colors.brandPrimary} style={{ marginVertical: 20 }} />
              ) : filteredHierarchyFolders.length === 0 ? (
                <Text style={{ textAlign: 'center', color: colors.muted, padding: 20, fontSize: 13 }}>
                  No other destination folders available.
                </Text>
              ) : (
                filteredHierarchyFolders.map(hf => {
                  const isSelected = targetFolderId === hf.id;
                  return (
                    <Pressable
                      key={hf.id}
                      style={[
                        styles.targetFolderItem,
                        isSelected && styles.targetFolderItemSelected,
                        { paddingLeft: 12 + (hf.depth || 0) * 16 }
                      ]}
                      onPress={() => setTargetFolderId(hf.id)}
                    >
                      <View style={[styles.targetFolderRadio, isSelected && styles.targetFolderRadioSelected]}>
                        {isSelected && <View style={styles.targetFolderRadioInner} />}
                      </View>
                      <Ionicons
                        name={hf.depth > 0 ? "folder-outline" : "folder"}
                        size={18}
                        color={isSelected ? colors.brandPrimary : colors.muted}
                        style={{ marginLeft: 6, marginRight: 6 }}
                      />
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.targetFolderNameText, isSelected && { color: colors.brandPrimary, fontWeight: '700' }]} numberOfLines={1}>
                          {hf.name}
                        </Text>
                        {hf.depth > 0 && (
                          <Text style={styles.targetFolderPathText} numberOfLines={1}>
                            {hf.path_display}
                          </Text>
                        )}
                      </View>
                    </Pressable>
                  );
                })
              )}
            </ScrollView>

            {/* Move Actions */}
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
              <View style={{ flex: 1 }}>
                <SecondaryButton
                  label="Cancel"
                  onPress={() => setMoveModalVisible(false)}
                />
              </View>
              <View style={{ flex: 1 }}>
                <PrimaryButton
                  label={movingFiles ? "Moving…" : "Confirm Move"}
                  onPress={handleConfirmMoveFiles}
                  disabled={!targetFolderId || movingFiles}
                  loading={movingFiles}
                />
              </View>
            </View>
          </View>
        </View>
      </Modal>

      {/* ========================================================================= */}
      {/* MODAL 3: PERMISSIONS MODAL (ADMIN ONLY)                                    */}
      {/* ========================================================================= */}
      <Modal visible={permModalVisible} animationType="fade" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxWidth: 540 }]}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>Manage Access Permissions</Text>
                <Text style={styles.modalSubtitle}>{permTarget?.title}</Text>
              </View>
              <Pressable onPress={() => setPermModalVisible(false)} style={styles.modalCloseBtn}>
                <Ionicons name="close" size={20} color={colors.muted} />
              </Pressable>
            </View>

            <ScrollView style={{ maxHeight: 460 }}>
              {/* Access Mode Selector */}
              <View style={{ marginBottom: 14 }}>
                <Text style={styles.fieldLabel}>Who can view this item?</Text>
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
                        🌐 All Users (सभी यूज़र्स)
                      </Text>
                      <Text style={styles.permTypeDesc}>
                        Visible to all employees, managers, and admins with Document Library access.
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

  // Breadcrumbs Styles
  breadcrumbBar: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    backgroundColor: colors.surfaceSecondary,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  breadcrumbItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  breadcrumbText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.brandPrimary,
  },
  breadcrumbCurrentText: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.onSurface,
    maxWidth: 220,
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
  folderHeaderMiniBtn: {
    width: 24, height: 24, borderRadius: 6,
    backgroundColor: colors.brandPrimary + '15',
    alignItems: 'center', justifyContent: 'center',
  },
  openFolderSubtitle: {
    fontSize: 11,
    color: colors.muted,
    marginTop: 1,
  },
  headerActionBtnSecondary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.brandPrimary + '15',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.md,
  },
  headerActionBtnSecondaryText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.brandPrimary,
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

  // Subfolders Section Styles
  subfoldersSection: {
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
  },
  subfoldersSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  subfoldersSectionTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.onSurface,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  createSubfolderSmallBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  createSubfolderSmallBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.brandPrimary,
  },
  subfoldersScroll: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 2,
  },
  subfolderCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  subfolderIconBox: {
    width: 32, height: 32, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
  },
  subfolderCardTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.onSurface,
  },
  subfolderCardSubtitle: {
    fontSize: 10,
    color: colors.muted,
  },
  subfolderActionBtn: {
    width: 24, height: 24, borderRadius: 6,
    backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center',
  },

  // Folder Search Container
  folderSearchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: 12,
  },
  folderSearchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    height: 36,
    gap: 8,
  },
  folderSearchInput: {
    flex: 1,
    fontSize: 12,
    color: colors.onSurface,
  },
  folderSearchCountText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.muted,
  },

  // Selection Action Toolbar
  selectionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#0f172a',
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  selectionBarLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  selectionCountBadge: {
    backgroundColor: colors.brandPrimary,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  selectionCountText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#fff',
  },
  selectionBarTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#f8fafc',
  },
  selectionBarRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  selectionClearBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: '#334155',
    borderRadius: 6,
  },
  selectionClearBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#f1f5f9',
  },
  selectionMoveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 5,
    backgroundColor: colors.brandPrimary,
    borderRadius: 6,
  },
  selectionMoveBtnText: {
    fontSize: 11,
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
  tableDataRowSelected: {
    backgroundColor: colors.brandPrimary + '10',
  },

  // Column Widths
  colCheck: {
    width: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectCheckbox: {
    width: 18, height: 18, borderRadius: 4,
    borderWidth: 1.5, borderColor: colors.muted,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#fff',
  },
  selectCheckboxActive: {
    backgroundColor: colors.brandPrimary,
    borderColor: colors.brandPrimary,
  },
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
  modalCloseBtn: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surfaceSecondary,
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

  // Target Folder Selection in Move Modal
  targetFolderItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingRight: 10,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  targetFolderItemSelected: {
    borderColor: colors.brandPrimary,
    backgroundColor: colors.brandPrimary + '08',
  },
  targetFolderRadio: {
    width: 16, height: 16, borderRadius: 8,
    borderWidth: 1.5, borderColor: colors.muted,
    alignItems: 'center', justifyContent: 'center',
  },
  targetFolderRadioSelected: {
    borderColor: colors.brandPrimary,
  },
  targetFolderRadioInner: {
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: colors.brandPrimary,
  },
  targetFolderNameText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.onSurface,
  },
  targetFolderPathText: {
    fontSize: 10,
    color: colors.muted,
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
    height: 36,
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
