import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';

export function getBaseUrl(): string {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') {
      return `${window.location.protocol}//${host}:8000`;
    }
  }
  return (process.env.EXPO_PUBLIC_BACKEND_URL || 'http://127.0.0.1:8000').replace(/\/+$/, '');
}

const TOKEN_KEY = 'triveni_session_token';

let inMemoryToken: string | null = null;

export const tokenStore = {
  async get(): Promise<string | null> {
    if (inMemoryToken) return inMemoryToken;
    if (Platform.OS === 'web') {
      const t = typeof window !== 'undefined' ? window.localStorage.getItem(TOKEN_KEY) : null;
      inMemoryToken = t;
      return t;
    }
    const t = await SecureStore.getItemAsync(TOKEN_KEY);
    inMemoryToken = t;
    return t;
  },
  async set(token: string) {
    inMemoryToken = token;
    if (Platform.OS === 'web') {
      window.localStorage.setItem(TOKEN_KEY, token);
    } else {
      await SecureStore.setItemAsync(TOKEN_KEY, token);
    }
  },
  async clear() {
    inMemoryToken = null;
    if (Platform.OS === 'web') {
      window.localStorage.removeItem(TOKEN_KEY);
    } else {
      await SecureStore.deleteItemAsync(TOKEN_KEY);
    }
  },
};

async function request<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const token = await tokenStore.get();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(opts.headers as Record<string, string> | undefined),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${getBaseUrl()}/api${path}`, { ...opts, headers });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    let msg: string;
    if (data && data.detail !== undefined) {
      msg = typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail);
    } else if (data && data.message) {
      msg = String(data.message);
    } else {
      msg = `Request failed (${res.status})`;
    }
    throw new Error(msg);
  }
  return data as T;
}

export const api = {
  get: <T>(p: string) => request<T>(p),
  post: <T>(p: string, body: any) => request<T>(p, { method: 'POST', body: JSON.stringify(body) }),
  patch: <T>(p: string, body: any) => request<T>(p, { method: 'PATCH', body: JSON.stringify(body) }),
  invoicePdfUrl: async (iid: string) => {
    const token = await tokenStore.get();
    return `${getBaseUrl()}/api/invoices/${iid}/pdf?token=${encodeURIComponent(token || '')}`;
  },
  incomePdfUrl: async (iid: string) => {
    const token = await tokenStore.get();
    return `${getBaseUrl()}/api/income/${iid}/pdf?token=${encodeURIComponent(token || '')}`;
  },
  customerPdfUrl: async (cid: string) => {
    const token = await tokenStore.get();
    return `${getBaseUrl()}/api/customers/${cid}/pdf?token=${encodeURIComponent(token || '')}`;
  },
  expensePdfUrl: async (eid: string) => {
    const token = await tokenStore.get();
    return `${getBaseUrl()}/api/expenses/${eid}/pdf?token=${encodeURIComponent(token || '')}`;
  },
  put: <T>(p: string, body: any) => request<T>(p, { method: 'PUT', body: JSON.stringify(body) }),
  del: <T>(p: string) => request<T>(p, { method: 'DELETE' }),
  get base() {
    return getBaseUrl();
  },
  uploadTenderFile: async (tid: string, file: { uri: string; name: string; type: string }) => {
    const token = await tokenStore.get();
    const form = new FormData();
    if (Platform.OS === 'web') {
      const blob = await (await fetch(file.uri)).blob();
      form.append('file', blob, file.name);
    } else {
      form.append('file', { uri: file.uri, name: file.name, type: file.type } as any);
    }
    const res = await fetch(`${getBaseUrl()}/api/tenders/${tid}/upload`, {
      method: 'POST',
      body: form as any,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error(`Upload failed (${res.status})`);
    return res.json();
  },
  uploadCustomerFile: async (cid: string, file: { uri: string; name: string; type: string }) => {
    const token = await tokenStore.get();
    const form = new FormData();
    if (Platform.OS === 'web') {
      const blob = await (await fetch(file.uri)).blob();
      form.append('file', blob, file.name);
    } else {
      form.append('file', { uri: file.uri, name: file.name, type: file.type } as any);
    }
    const res = await fetch(`${getBaseUrl()}/api/customers/${cid}/attachments`, {
      method: 'POST',
      body: form as any,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) throw new Error((data && data.detail) || `Upload failed (${res.status})`);
    return data;
  },
  // Generic voucher attachment upload. kind: 'invoices' | 'expenses' | 'income'
  uploadVoucherFile: async (kind: 'invoices' | 'expenses' | 'income', oid: string, file: { uri: string; name: string; type: string }) => {
    const token = await tokenStore.get();
    const form = new FormData();
    if (Platform.OS === 'web') {
      const blob = await (await fetch(file.uri)).blob();
      form.append('file', blob, file.name);
    } else {
      form.append('file', { uri: file.uri, name: file.name, type: file.type } as any);
    }
    const res = await fetch(`${getBaseUrl()}/api/${kind}/${oid}/attachments`, {
      method: 'POST',
      body: form as any,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const detail = data && data.detail;
      const msg = typeof detail === 'string' ? detail : detail ? JSON.stringify(detail) : `Upload failed (${res.status})`;
      throw new Error(msg);
    }
    return data;
  },
  deleteVoucherFile: async (kind: 'invoices' | 'expenses' | 'income', oid: string, path: string) => {
    const token = await tokenStore.get();
    const res = await fetch(`${getBaseUrl()}/api/${kind}/${oid}/attachments?path=${encodeURIComponent(path)}`, {
      method: 'DELETE',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) throw new Error((data && data.detail) || `Delete failed (${res.status})`);
    return data;
  },
  uploadInvoiceSignature: async (file: { uri: string; name: string; type: string }) => {
    const token = await tokenStore.get();
    const form = new FormData();
    if (Platform.OS === 'web') {
      const blob = await (await fetch(file.uri)).blob();
      form.append('file', blob, file.name);
    } else {
      form.append('file', { uri: file.uri, name: file.name, type: file.type } as any);
    }
    const res = await fetch(`${getBaseUrl()}/api/invoices/upload-signature`, {
      method: 'POST',
      body: form as any,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) throw new Error((data && data.detail) || `Upload signature failed (${res.status})`);
    return data as { signature_url: string; file_id: string };
  },
  uploadEmployeePhoto: async (eid: string, file: { uri: string; name: string; type: string }) => {
    const token = await tokenStore.get();
    const form = new FormData();
    if (Platform.OS === 'web') {
      const blob = await (await fetch(file.uri)).blob();
      form.append('file', blob, file.name);
    } else {
      form.append('file', { uri: file.uri, name: file.name, type: file.type } as any);
    }
    const res = await fetch(`${getBaseUrl()}/api/employees/${eid}/photo`, {
      method: 'POST',
      body: form as any,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) throw new Error((data && data.detail) || `Upload failed (${res.status})`);
    return data;
  },
  uploadTaskFile: async (tid: string, file: { uri: string; name: string; type: string }) => {
    const token = await tokenStore.get();
    const form = new FormData();
    if (Platform.OS === 'web') {
      const blob = await (await fetch(file.uri)).blob();
      form.append('file', blob, file.name);
    } else {
      form.append('file', { uri: file.uri, name: file.name, type: file.type } as any);
    }
    const res = await fetch(`${getBaseUrl()}/api/tasks/${tid}/attachments`, {
      method: 'POST',
      body: form as any,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) throw new Error((data && data.detail) || `Upload failed (${res.status})`);
    return data;
  },
  getTaskChat: async (tid: string) => {
    return request<any[]>(`/tasks/${tid}/chat`);
  },
  sendTaskChatMessage: async (tid: string, message: string, attachment?: any) => {
    return request<any>(`/tasks/${tid}/chat`, {
      method: 'POST',
      body: JSON.stringify({ message, attachment }),
    });
  },
  getTaskChatParticipants: async (tid: string) => {
    return request<{ task_id: string; chat_participants: string[]; users: any[]; assignee_id?: string; assignee_name?: string }>(`/tasks/${tid}/chat/participants`);
  },
  updateTaskChatParticipants: async (tid: string, participantIds: string[]) => {
    return request<any>(`/tasks/${tid}/chat/participants`, {
      method: 'PUT',
      body: JSON.stringify({ participant_ids: participantIds }),
    });
  },
  getServiceWorkflows: async () => {
    return request<any[]>('/service-workflows');
  },
  getServiceWorkflow: async (serviceNameOrId: string) => {
    return request<any>(`/service-workflows/${encodeURIComponent(serviceNameOrId)}`);
  },
  saveServiceWorkflow: async (payload: { service_id?: string; service_name: string; stages: any[] }) => {
    return request<any>('/service-workflows', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  createPunch: async (payload: { type: 'in' | 'out'; lat?: number; lng?: number; accuracy?: number; place_name?: string; selfie: { uri: string; name: string; type: string } }) => {
    const token = await tokenStore.get();
    const form = new FormData();
    form.append('type', payload.type);
    if (payload.lat != null) form.append('lat', String(payload.lat));
    if (payload.lng != null) form.append('lng', String(payload.lng));
    if (payload.accuracy != null) form.append('accuracy', String(payload.accuracy));
    if (payload.place_name) form.append('place_name', payload.place_name);
    if (Platform.OS === 'web') {
      let blob: Blob;
      if (payload.selfie.uri.startsWith('data:')) {
        const parts = payload.selfie.uri.split(',');
        const mime = parts[0].match(/:(.*?);/)?.[1] || 'image/jpeg';
        const binaryStr = atob(parts[1]);
        const len = binaryStr.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          bytes[i] = binaryStr.charCodeAt(i);
        }
        blob = new Blob([bytes], { type: mime });
      } else {
        blob = await (await fetch(payload.selfie.uri)).blob();
      }
      form.append('selfie', blob, payload.selfie.name);
    } else {
      form.append('selfie', { uri: payload.selfie.uri, name: payload.selfie.name, type: payload.selfie.type } as any);
    }
    const res = await fetch(`${getBaseUrl()}/api/punches`, {
      method: 'POST',
      body: form as any,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) throw new Error((data && data.detail) || `Punch failed (${res.status})`);
    return data;
  },
  uploadTenderSlot: async (tid: string, slot: 'nit-copy' | 'boq' | 'documents', file: { uri: string; name: string; type: string }) => {
    const token = await tokenStore.get();
    const form = new FormData();
    if (Platform.OS === 'web') {
      const blob = await (await fetch(file.uri)).blob();
      form.append('file', blob, file.name);
    } else {
      form.append('file', { uri: file.uri, name: file.name, type: file.type } as any);
    }
    const res = await fetch(`${getBaseUrl()}/api/tenders/${tid}/${slot}`, {
      method: 'POST',
      body: form as any,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) throw new Error((data && data.detail) || `Upload failed (${res.status})`);
    return data;
  },
  revealCredential: async (cid: string, field: string) => {
    return request<{ field: string; value: string; customer_code?: string; customer_name?: string }>(
      `/customers/${cid}/credentials/reveal`,
      { method: 'POST', body: JSON.stringify({ field }) }
    );
  },
  uploadCustomerDoc: async (cid: string, file: { uri: string; name: string; type: string }, category: string, docDate?: string, expDate?: string, remarks?: string) => {
    const token = await tokenStore.get();
    const form = new FormData();
    if (Platform.OS === 'web') {
      const blob = await (await fetch(file.uri)).blob();
      form.append('file', blob, file.name);
    } else {
      form.append('file', { uri: file.uri, name: file.name, type: file.type } as any);
    }
    form.append('category', category);
    if (docDate) form.append('document_date', docDate);
    if (expDate) form.append('expiry_date', expDate);
    if (remarks) form.append('remarks', remarks);
    const res = await fetch(`${getBaseUrl()}/api/customers/${cid}/documents`, {
      method: 'POST',
      body: form as any,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) throw new Error((data && data.detail) || `Upload failed (${res.status})`);
    return data;
  },
  uploadUserDoc: async (uid: string, file: { uri: string; name: string; type: string }, docType: string, remarks?: string) => {
    const token = await tokenStore.get();
    const form = new FormData();
    if (Platform.OS === 'web') {
      const blob = await (await fetch(file.uri)).blob();
      form.append('file', blob, file.name);
    } else {
      form.append('file', { uri: file.uri, name: file.name, type: file.type } as any);
    }
    form.append('doc_type', docType);
    if (remarks) form.append('remarks', remarks);
    const res = await fetch(`${getBaseUrl()}/api/manage-users/${uid}/documents`, {
      method: 'POST',
      body: form as any,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) throw new Error((data && data.detail) || `Upload failed (${res.status})`);
    return data;
  },
  getExpiryAlerts: async () => {
    return request<any>('/customers/document-expiry-alerts');
  },
  globalSearch: async (q: string) => {
    return request<any>(`/system/search?q=${encodeURIComponent(q)}`);
  },
  getSystemStats: async () => {
    return request<any>('/system/stats');
  },
  getLeaveCategories: async () => {
    return request<any[]>('/leave-categories');
  },
  createLeaveCategory: async (data: any) => {
    return request<any>('/leave-categories', { method: 'POST', body: JSON.stringify(data) });
  },
  updateLeaveCategory: async (cid: string, data: any) => {
    return request<any>(`/leave-categories/${cid}`, { method: 'PATCH', body: JSON.stringify(data) });
  },
  deleteLeaveCategory: async (cid: string) => {
    return request<any>(`/leave-categories/${cid}`, { method: 'DELETE' });
  },
  getLeaveBalances: async (userId?: string) => {
    return request<any>(userId ? `/leaves/balances?user_id=${encodeURIComponent(userId)}` : '/leaves/balances');
  },
  cancelLeave: async (lid: string) => {
    return request<any>(`/leaves/${lid}`, { method: 'DELETE' });
  },
  getAllPunchesToday: async (date?: string) => {
    return request<any[]>(date ? `/punches/all-today?date=${encodeURIComponent(date)}` : '/punches/all-today');
  },
  // Tender Management Module (3 Sub-menus)
  getTendersList: async (params?: Record<string, string>) => {
    let q = '';
    if (params) {
      const sp = new URLSearchParams();
      Object.entries(params).forEach(([k, v]) => { if (v) sp.append(k, v); });
      const s = sp.toString();
      if (s) q = `?${s}`;
    }
    return request<any[]>(`/tender-mgmt/tenders${q}`);
  },
  createTenderItem: async (data: any) => {
    return request<any>('/tender-mgmt/tenders', { method: 'POST', body: JSON.stringify(data) });
  },
  updateTenderItem: async (tid: string, data: any) => {
    return request<any>(`/tender-mgmt/tenders/${tid}`, { method: 'PATCH', body: JSON.stringify(data) });
  },
  deleteTenderItem: async (tid: string) => {
    return request<any>(`/tender-mgmt/tenders/${tid}`, { method: 'DELETE' });
  },
  getTenderSources: async () => {
    return request<any[]>('/tender-mgmt/sources');
  },
  addTenderSource: async (data: any) => {
    return request<any>('/tender-mgmt/sources', { method: 'POST', body: JSON.stringify(data) });
  },
  deleteTenderSource: async (sid: string) => {
    return request<any>(`/tender-mgmt/sources/${sid}`, { method: 'DELETE' });
  },
  collectTendersFromSource: async (sid: string, customUrl?: string) => {
    return request<any>(`/tender-mgmt/sources/${sid}/collect${customUrl ? `?custom_url=${encodeURIComponent(customUrl)}` : ''}`, { method: 'POST' });
  },
  getContractors: async (params?: Record<string, string>) => {
    let q = '';
    if (params) {
      const sp = new URLSearchParams();
      Object.entries(params).forEach(([k, v]) => { if (v) sp.append(k, v); });
      const s = sp.toString();
      if (s) q = `?${s}`;
    }
    return request<any[]>(`/tender-mgmt/contractors${q}`);
  },
  syncContractorsFromCustomers: async () => {
    return request<any>('/tender-mgmt/contractors/sync-customers', { method: 'POST' });
  },
  createContractor: async (data: any) => {
    return request<any>('/tender-mgmt/contractors', { method: 'POST', body: JSON.stringify(data) });
  },
  updateContractor: async (cid: string, data: any) => {
    return request<any>(`/tender-mgmt/contractors/${cid}`, { method: 'PATCH', body: JSON.stringify(data) });
  },
  deleteContractor: async (cid: string) => {
    return request<any>(`/tender-mgmt/contractors/${cid}`, { method: 'DELETE' });
  },
  getTenderMappings: async () => {
    return request<any>('/tender-mgmt/mappings');
  },
  updateTenderMappings: async (data: any) => {
    return request<any>('/tender-mgmt/mappings', { method: 'POST', body: JSON.stringify(data) });
  },
  getContractorSubscriptions: async (params?: Record<string, string>) => {
    let q = '';
    if (params) {
      const sp = new URLSearchParams();
      Object.entries(params).forEach(([k, v]) => { if (v) sp.append(k, v); });
      const s = sp.toString();
      if (s) q = `?${s}`;
    }
    return request<any[]>(`/tender-mgmt/subscriptions${q}`);
  },
  saveContractorSubscription: async (data: any) => {
    return request<any>('/tender-mgmt/subscriptions', { method: 'POST', body: JSON.stringify(data) });
  },
  deleteContractorSubscription: async (sid: string) => {
    return request<any>(`/tender-mgmt/subscriptions/${sid}`, { method: 'DELETE' });
  },
  getMatchingContractorsForTender: async (tid: string) => {
    return request<any>(`/tender-mgmt/match/tender/${tid}`);
  },
  // Document Library & Forms and Rules
  getDocFolders: async (category?: string, search?: string) => {
    const sp = new URLSearchParams();
    if (category) sp.append('category', category);
    if (search) sp.append('search', search);
    const q = sp.toString();
    return request<any[]>(`/document-library/folders${q ? `?${q}` : ''}`);
  },
  createDocFolder: async (data: { name: string; category?: string; description?: string; color?: string; icon?: string }) => {
    return request<any>('/document-library/folders', { method: 'POST', body: JSON.stringify(data) });
  },
  updateDocFolder: async (fid: string, data: { name?: string; description?: string; color?: string; icon?: string }) => {
    return request<any>(`/document-library/folders/${fid}`, { method: 'PATCH', body: JSON.stringify(data) });
  },
  deleteDocFolder: async (fid: string) => {
    return request<any>(`/document-library/folders/${fid}`, { method: 'DELETE' });
  },
  getFolderFiles: async (fid: string) => {
    return request<{ folder: any; files: any[] }>(`/document-library/folders/${fid}/files`);
  },
  createDocFileRow: async (fid: string, data: { file_description: string; sl_no?: number; insert_after_id?: string }) => {
    return request<any>(`/document-library/folders/${fid}/files`, { method: 'POST', body: JSON.stringify(data) });
  },
  updateDocFileRow: async (fid: string, fileId: string, data: { file_description?: string; sl_no?: number }) => {
    return request<any>(`/document-library/folders/${fid}/files/${fileId}`, { method: 'PATCH', body: JSON.stringify(data) });
  },
  deleteDocFileRow: async (fid: string, fileId: string) => {
    return request<any>(`/document-library/folders/${fid}/files/${fileId}`, { method: 'DELETE' });
  },
  uploadDocFileAttachment: async (fid: string, fileId: string, file: { uri: string; name: string; type: string }) => {
    const token = await tokenStore.get();
    const form = new FormData();
    if (Platform.OS === 'web') {
      const blob = await (await fetch(file.uri)).blob();
      form.append('file', blob, file.name);
    } else {
      form.append('file', { uri: file.uri, name: file.name, type: file.type } as any);
    }
    const res = await fetch(`${getBaseUrl()}/api/document-library/folders/${fid}/files/${fileId}/upload`, {
      method: 'POST',
      body: form as any,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) throw new Error((data && data.detail) || `Upload failed (${res.status})`);
    return data;
  },
  getDocUsersList: async () => {
    return request<any[]>('/document-library/users-list');
  },
  updateDocFolderPermissions: async (fid: string, data: { access_type: string; allowed_user_ids: string[] }) => {
    return request<any>(`/document-library/folders/${fid}/permissions`, { method: 'PATCH', body: JSON.stringify(data) });
  },
  updateDocFilePermissions: async (fid: string, fileId: string, data: { access_type: string; allowed_user_ids: string[] }) => {
    return request<any>(`/document-library/folders/${fid}/files/${fileId}/permissions`, { method: 'PATCH', body: JSON.stringify(data) });
  },

  // Tender Calling & Follow-up API
  getTenderCalls: async (section: string = 'calling_day', params?: { call_date?: string; employee_id?: string; status?: string; search?: string }) => {
    const q = new URLSearchParams();
    q.append('section', section);
    if (params?.call_date) q.append('call_date', params.call_date);
    if (params?.employee_id) q.append('employee_id', params.employee_id);
    if (params?.status) q.append('status', params.status);
    if (params?.search) q.append('search', params.search);
    return request<any[]>(`/tender-mgmt/calls?${q.toString()}`);
  },
  createTenderCall: async (data: any) => {
    return request<any>('/tender-mgmt/calls', { method: 'POST', body: JSON.stringify(data) });
  },
  updateTenderCall: async (id: string, data: any) => {
    return request<any>(`/tender-mgmt/calls/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  },
  deleteTenderCall: async (id: string) => {
    return request<any>(`/tender-mgmt/calls/${id}`, { method: 'DELETE' });
  },
  uploadCallRecording: async (id: string, file: { uri: string; name: string; type: string }) => {
    const token = await tokenStore.get();
    const form = new FormData();
    if (Platform.OS === 'web') {
      const blob = await (await fetch(file.uri)).blob();
      form.append('file', blob, file.name);
    } else {
      form.append('file', { uri: file.uri, name: file.name, type: file.type } as any);
    }
    const res = await fetch(`${getBaseUrl()}/api/tender-mgmt/calls/${id}/recording`, {
      method: 'POST',
      body: form as any,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) throw new Error((data && data.detail) || `Upload failed (${res.status})`);
    return data;
  },
  deleteCallRecording: async (id: string) => {
    return request<any>(`/tender-mgmt/calls/${id}/recording`, { method: 'DELETE' });
  },
  getTenderCallsAnalytics: async () => {
    return request<any>('/tender-mgmt/calls/metrics/analytics');
  },
  assignCallWork: async (id: string, data: { assignee_id: string; assignee_name: string; deadline?: string; instructions?: string; estimated_amount?: number }) => {
    return request<any>(`/tender-mgmt/calls/${id}/assign-work`, { method: 'POST', body: JSON.stringify(data) });
  },
  createCallBill: async (id: string, data: { amount: number; description?: string; invoice_date?: string; due_date?: string; tax_rate?: number }) => {
    return request<any>(`/tender-mgmt/calls/${id}/create-bill`, { method: 'POST', body: JSON.stringify(data) });
  },
  getAccountingReportsCatalog: async () => {
    return request<any>('/accounting/reports/catalog');
  },
  getAccountingReportsSummary: async () => {
    return request<any>('/accounting/reports/summary');
  },
  getAccountingReportData: async (reportType: string, params?: { from_date?: string; to_date?: string; party_id?: string; category?: string; search?: string }) => {
    const sp = new URLSearchParams({ report_type: reportType });
    if (params?.from_date) sp.append('from_date', params.from_date);
    if (params?.to_date) sp.append('to_date', params.to_date);
    if (params?.party_id) sp.append('party_id', params.party_id);
    if (params?.category) sp.append('category', params.category);
    if (params?.search) sp.append('search', params.search);
    return request<any>(`/accounting/reports/data?${sp.toString()}`);
  },
  getCashBankAccounts: () => request<any[]>('/accounting/cash-bank/banks'),
  executeCashBankTransfer: (data: any) => request<any>('/accounting/cash-bank/transfer', { method: 'POST', body: JSON.stringify(data) }),
  getCashSummary: () => request<any>('/accounting/cash-bank/cash-summary'),
  getCheques: (status?: string) => request<any>(`/accounting/cash-bank/cheques?status=${status || 'all'}`),
  depositCheque: (chqId: string, data: any) => request<any>(`/accounting/cash-bank/cheques/${chqId}/deposit`, { method: 'POST', body: JSON.stringify(data) }),
  getLoanAccounts: () => request<any>('/accounting/cash-bank/loans'),
  createLoanAccount: (data: any) => request<any>('/accounting/cash-bank/loans', { method: 'POST', body: JSON.stringify(data) }),
  uploadCashBankAttachment: async (file: { uri: string; name: string; type?: string }) => {
    const token = await tokenStore.get();
    const form = new FormData();
    if (Platform.OS === 'web') {
      const blob = await (await fetch(file.uri)).blob();
      form.append('file', blob, file.name);
    } else {
      form.append('file', { uri: file.uri, name: file.name, type: file.type || 'image/jpeg' } as any);
    }
    const res = await fetch(`${getBaseUrl()}/api/accounting/cash-bank/upload-attachment`, {
      method: 'POST',
      body: form as any,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error(`Upload failed (${res.status})`);
    return res.json();
  },
};

export const captureSelfie = async (): Promise<{ uri: string; name: string; type: string } | null> => {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) throw new Error('Camera permission is required for face verification');
  const res = await ImagePicker.launchCameraAsync({
    cameraType: ImagePicker.CameraType.front,
    quality: 0.6,
    allowsEditing: false,
    mediaTypes: ['images'],
  });
  if (res.canceled || !res.assets?.[0]) return null;
  const a = res.assets[0];
  return { uri: a.uri, name: a.fileName || 'selfie.jpg', type: a.mimeType || 'image/jpeg' };
};

export const getCurrentLocation = async (): Promise<{ lat: number; lng: number; accuracy?: number }> => {
  if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.geolocation) {
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        pos => {
          resolve({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy || undefined,
          });
        },
        () => {
          // Fallback location if permission denied or no GPS chip on desktop
          resolve({ lat: 25.5941, lng: 85.1376, accuracy: 50 });
        },
        { enableHighAccuracy: false, timeout: 4000, maximumAge: 60000 }
      );
    });
  }
  const perm = await Location.requestForegroundPermissionsAsync();
  if (!perm.granted) throw new Error('Location permission is required for punch-in');
  const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  return { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy || undefined };
};

export type UserRole = 'admin' | 'manager' | 'employee';
export interface AppUser {
  user_id: string;
  email: string;
  name: string;
  role: UserRole;
  picture?: string | null;
  phone?: string | null;
  department?: string | null;
  designation?: string | null;
}
