import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';

export function getBaseUrl(): string {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    const host = window.location.hostname;
    const proto = window.location.protocol || 'http:';
    if (host === 'localhost' || host === '127.0.0.1' || host.startsWith('192.168.') || host.startsWith('10.')) {
      return `${proto}//${host}:8000`;
    }
  }
  return (process.env.EXPO_PUBLIC_BACKEND_URL || 'https://tdsc-oms-backend.onrender.com').replace(/\/+$/, '');
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
  const isGet = !opts.method || opts.method.toUpperCase() === 'GET';
  let attempts = isGet ? 3 : 1;
  let lastErr: any = null;

  while (attempts > 0) {
    try {
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
    } catch (err: any) {
      lastErr = err;
      attempts--;
      // Retry on network errors / Failed to fetch for GET requests (handles Render cold start)
      if (isGet && attempts > 0 && (err?.message?.includes('fetch') || err?.name === 'TypeError')) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

export const api = {
  get: <T>(p: string) => request<T>(p),
  post: <T>(p: string, body: any) => request<T>(p, { method: 'POST', body: JSON.stringify(body) }),
  patch: <T>(p: string, body: any) => request<T>(p, { method: 'PATCH', body: JSON.stringify(body) }),
  invoicePdfUrl: async (iid: string) => {
    const token = await tokenStore.get();
    return `${getBaseUrl()}/api/invoices/${iid}/pdf?token=${encodeURIComponent(token || '')}`;
  },
  getInvoiceProfitAnalysis: (iid: string) => request<any>(`/invoices/${iid}/profit-analysis`),
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
  exportContractorsPdf: async (customerIds: string[]) => {
    const token = await tokenStore.get();
    const res = await fetch(`${getBaseUrl()}/api/customers/export-pdf`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token || ''}`,
      },
      body: JSON.stringify({ customer_ids: customerIds }),
    });
    if (!res.ok) {
      let errMsg = 'Failed to generate PDF';
      try {
        const j = await res.json();
        errMsg = j.detail || errMsg;
      } catch {
        errMsg = await res.text() || errMsg;
      }
      throw new Error(errMsg);
    }
    return await res.blob();
  },
  expenseApprovalPdfUrl: async (vid: string) => {
    const token = await tokenStore.get();
    return `${getBaseUrl()}/api/expense-approvals/${vid}/pdf?token=${encodeURIComponent(token || '')}`;
  },
  getExpenseApprovals: (params?: { status?: string; customer_id?: string; q?: string; is_old_accounting?: boolean | string }) => {
    const qry = new URLSearchParams();
    if (params?.status) qry.set('status', params.status);
    if (params?.customer_id) qry.set('customer_id', params.customer_id);
    if (params?.q) qry.set('q', params.q);
    if (params?.is_old_accounting !== undefined) qry.set('is_old_accounting', String(params.is_old_accounting));
    const qs = qry.toString();
    return request<any[]>(`/expense-approvals${qs ? `?${qs}` : ''}`);
  },
  getExpenseApproval: (id: string) => request<any>(`/expense-approvals/${id}`),
  getExpenseApprovalConfig: () => request<any>('/expense-approvals/config'),
  getApproverCandidates: () => request<any[]>('/expense-approvals/approver-candidates'),
  updateExpenseApprovalConfig: (payload: any) =>
    request<any>('/expense-approvals/config', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  getCustomerSaleVouchers: (customerId: string, is_old_accounting?: boolean) => {
    const qs = is_old_accounting !== undefined ? `&is_old_accounting=${is_old_accounting}` : '';
    return request<any[]>(`/expense-approvals/sale-vouchers?customer_id=${encodeURIComponent(customerId)}${qs}`);
  },
  createExpenseApproval: (payload: any) =>
    request<any>('/expense-approvals', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateExpenseApproval: (id: string, payload: any) =>
    request<any>(`/expense-approvals/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  expenseApprovalAction: (
    id: string,
    action: string,
    remarks?: string,
    extra?: { selected_item_ids?: string[]; approved_amount?: number }
  ) =>
    request<any>(`/expense-approvals/${id}/action`, {
      method: 'POST',
      body: JSON.stringify({ action, remarks, ...(extra || {}) }),
    }),
  deleteExpenseApproval: (id: string) =>
    request<any>(`/expense-approvals/${id}`, {
      method: 'DELETE',
    }),
  reopenExpenseApproval: (id: string, remarks?: string) =>
    request<any>(`/expense-approvals/${id}/action`, {
      method: 'POST',
      body: JSON.stringify({ action: 'reopen', remarks: remarks || 'Reopened by Admin' }),
    }),
  put: <T>(p: string, body: any) => request<T>(p, { method: 'PUT', body: JSON.stringify(body) }),
  del: <T>(p: string) => request<T>(p, { method: 'DELETE' }),
  delete: <T>(p: string) => request<T>(p, { method: 'DELETE' }),
  changePassword: (current_password: string, new_password: string) =>
    request<{ ok: boolean; message: string }>('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ current_password, new_password }),
    }),
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
  uploadCustomerDoc: async (
    cid: string,
    file: { uri: string; name: string; type: string },
    category: string,
    docDate?: string,
    expDate?: string,
    remarks?: string,
    docType?: 'validity' | 'general',
    docNo?: string,
    description?: string
  ) => {
    const token = await tokenStore.get();
    const form = new FormData();
    if (Platform.OS === 'web') {
      const blob = await (await fetch(file.uri)).blob();
      form.append('file', blob, file.name);
    } else {
      form.append('file', { uri: file.uri, name: file.name, type: file.type } as any);
    }
    form.append('category', category || 'Other');
    form.append('doc_type', docType || 'validity');
    if (docNo) form.append('document_no', docNo);
    if (docDate) {
      form.append('document_date', docDate);
      form.append('issue_date', docDate);
    }
    if (expDate) form.append('expiry_date', expDate);
    if (remarks) form.append('remarks', remarks);
    if (description) form.append('description', description);
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
  updateCustomerDoc: async (
    cid: string,
    docId: string,
    file?: { uri: string; name: string; type: string } | null,
    category?: string,
    docDate?: string,
    expDate?: string,
    remarks?: string,
    docType?: 'validity' | 'general',
    docNo?: string,
    description?: string
  ) => {
    const token = await tokenStore.get();
    const form = new FormData();
    if (file) {
      if (Platform.OS === 'web') {
        const blob = await (await fetch(file.uri)).blob();
        form.append('file', blob, file.name);
      } else {
        form.append('file', { uri: file.uri, name: file.name, type: file.type } as any);
      }
    }
    if (category !== undefined) form.append('category', category);
    if (docType !== undefined) form.append('doc_type', docType);
    if (docNo !== undefined) form.append('document_no', docNo);
    if (docDate !== undefined) {
      form.append('document_date', docDate);
      form.append('issue_date', docDate);
    }
    if (expDate !== undefined) form.append('expiry_date', expDate);
    if (remarks !== undefined) form.append('remarks', remarks);
    if (description !== undefined) form.append('description', description);
    const res = await fetch(`${getBaseUrl()}/api/customers/${cid}/documents/${docId}`, {
      method: 'PATCH',
      body: form as any,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) throw new Error((data && data.detail) || `Update failed (${res.status})`);
    return data;
  },
  customerDocDownloadUrl: async (cid: string, docId: string) => {
    const token = await tokenStore.get();
    return `${getBaseUrl()}/api/customers/${cid}/documents/${docId}/download?token=${encodeURIComponent(token || '')}`;
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
  getAccountingReportData: async (reportType: string, params?: { from_date?: string; to_date?: string; party_id?: string; category?: string; search?: string; bank_id?: string; accounting_scope?: string }) => {
    const sp = new URLSearchParams({ report_type: reportType });
    if (params?.from_date) sp.append('from_date', params.from_date);
    if (params?.to_date) sp.append('to_date', params.to_date);
    if (params?.party_id) sp.append('party_id', params.party_id);
    if (params?.category) sp.append('category', params.category);
    if (params?.search) sp.append('search', params.search);
    if (params?.bank_id) sp.append('bank_id', params.bank_id);
    if (params?.accounting_scope) sp.append('accounting_scope', params.accounting_scope);
    return request<any>(`/accounting/reports/data?${sp.toString()}`);
  },
  deleteInvoice: (id: string) => request<any>(`/invoices/${id}`, { method: 'DELETE' }),
  deleteIncome: (id: string) => request<any>(`/income/${id}`, { method: 'DELETE' }),
  getCashBankAccounts: () => request<any[]>('/accounting/cash-bank/banks'),
  executeCashBankTransfer: (data: any) => request<any>('/accounting/cash-bank/transfer', { method: 'POST', body: JSON.stringify(data) }),
  getCashSummary: () => request<any>('/accounting/cash-bank/cash-summary'),
  getDayBookInitialBalances: () => request<any>('/system/reports/day-book/initial-balances'),
  saveDayBookInitialBalances: (data: { start_date: string; cash_in_hand: number; accounts: Record<string, number> }) =>
    request<any>('/system/reports/day-book/initial-balances', { method: 'POST', body: JSON.stringify(data) }),
  getCheques: (status?: string) => request<any>(`/accounting/cash-bank/cheques?status=${status || 'all'}`),
  createCheque: (data: any) => request<any>('/accounting/cash-bank/cheques', { method: 'POST', body: JSON.stringify(data) }),
  depositCheque: (chqId: string, data: any) => request<any>(`/accounting/cash-bank/cheques/${chqId}/deposit`, { method: 'POST', body: JSON.stringify(data) }),
  getLoanAccounts: () => request<any>('/accounting/cash-bank/loans'),
  createLoanAccount: (data: any) => request<any>('/accounting/cash-bank/loans', { method: 'POST', body: JSON.stringify(data) }),
  updateCheque: (chqId: string, data: any) => request<any>(`/accounting/cash-bank/cheques/${chqId}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteCheque: (chqId: string) => request<any>(`/accounting/cash-bank/cheques/${chqId}`, { method: 'DELETE' }),
  updateLoanAccount: (loanId: string, data: any) => request<any>(`/accounting/cash-bank/loans/${loanId}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteLoanAccount: (loanId: string) => request<any>(`/accounting/cash-bank/loans/${loanId}`, { method: 'DELETE' }),
  updateContraTransaction: (txId: string, data: any) => request<any>(`/accounting/cash-bank/contra/${txId}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteContraTransaction: (txId: string) => request<any>(`/accounting/cash-bank/contra/${txId}`, { method: 'DELETE' }),
  deleteExpense: (id: string) => request<any>(`/expenses/${id}`, { method: 'DELETE' }),
  getBranches: () => request<any[]>('/branches'),
  getDistricts: () => request<any[]>('/districts'),
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
  getUserPermissions: async (userId: string) => {
    return request<any>(`/manage-users/${userId}/permissions`);
  },
  saveUserPermissions: async (userId: string, matrix: Record<string, any>) => {
    return request<any>(`/manage-users/${userId}/permissions`, {
      method: 'PUT',
      body: JSON.stringify({ app_menu_matrix: matrix }),
    });
  },
  resetUserPermissions: async (userId: string) => {
    return request<any>(`/manage-users/${userId}/reset-permissions`, {
      method: 'POST',
    });
  },
  // Customer Portal & Service Requests
  getServiceCatalogue: async () => {
    return request<any[]>('/services/catalogue');
  },
  getAdminServices: async () => {
    return request<any[]>('/admin/services');
  },
  createAdminService: async (data: any) => {
    return request<any>('/admin/services', { method: 'POST', body: JSON.stringify(data) });
  },
  updateAdminService: async (id: string, data: any) => {
    return request<any>(`/admin/services/${id}`, { method: 'PUT', body: JSON.stringify(data) });
  },
  getCustomerProfile: async () => {
    return request<any>('/customer-portal/profile');
  },
  updateCustomerProfile: async (data: any) => {
    return request<any>('/customer-portal/profile', { method: 'PUT', body: JSON.stringify(data) });
  },
  changeCustomerPassword: async (current_password: string, new_password: string) => {
    return request<any>('/customer-portal/change-password', {
      method: 'POST',
      body: JSON.stringify({ current_password, new_password }),
    });
  },
  getCustomerStats: async () => {
    return request<any>('/customer-portal/stats');
  },
  getCustomerServiceRequests: async (params?: { status?: string; search?: string; page?: number; limit?: number }) => {
    const sp = new URLSearchParams();
    if (params?.status) sp.append('status', params.status);
    if (params?.search) sp.append('search', params.search);
    if (params?.page) sp.append('page', String(params.page));
    if (params?.limit) sp.append('limit', String(params.limit));
    const qs = sp.toString() ? `?${sp.toString()}` : '';
    return request<any>(`/customer-portal/service-requests${qs}`);
  },
  getCustomerServiceRequestDetail: async (id: string) => {
    return request<any>(`/customer-portal/service-requests/${id}`);
  },
  createServiceRequest: async (data: { service_id: string; remarks?: string; custom_form_data?: any; priority?: string }) => {
    return request<any>('/service-requests', { method: 'POST', body: JSON.stringify(data) });
  },
  uploadServiceRequestDoc: async (requestId: string, docType: string, file: { uri: string; name: string; type?: string }, remarks?: string) => {
    const token = await tokenStore.get();
    const form = new FormData();
    if (Platform.OS === 'web') {
      const blob = await (await fetch(file.uri)).blob();
      form.append('file', blob, file.name);
    } else {
      form.append('file', { uri: file.uri, name: file.name, type: file.type || 'application/pdf' } as any);
    }
    form.append('doc_type', docType);
    if (remarks) form.append('remarks', remarks);
    const res = await fetch(`${getBaseUrl()}/api/service-requests/${requestId}/documents`, {
      method: 'POST',
      body: form as any,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) throw new Error((data && data.detail) || `Upload failed (${res.status})`);
    return data;
  },
  serviceRequestDocDownloadUrl: async (requestId: string, docId: string) => {
    const token = await tokenStore.get();
    return `${getBaseUrl()}/api/service-requests/${requestId}/documents/${docId}?token=${encodeURIComponent(token || '')}`;
  },
  getCustomerTenders: async (params?: { category?: string; search?: string }) => {
    const sp = new URLSearchParams();
    if (params?.category) sp.append('category', params.category);
    if (params?.search) sp.append('search', params.search);
    const qs = sp.toString() ? `?${sp.toString()}` : '';
    return request<any>(`/customer-portal/tenders${qs}`);
  },
  requestTenderFilling: async (tenderId: string, notes?: string) => {
    return request<any>(`/customer-portal/tenders/${tenderId}/request`, {
      method: 'POST',
      body: JSON.stringify({ notes }),
    });
  },
  getServiceRequestQueue: async (params?: { status?: string; search?: string; assigned_to?: string; service_id?: string; page?: number; limit?: number }) => {
    const sp = new URLSearchParams();
    if (params?.status) sp.append('status', params.status);
    if (params?.search) sp.append('search', params.search);
    if (params?.assigned_to) sp.append('assigned_to', params.assigned_to);
    if (params?.service_id) sp.append('service_id', params.service_id);
    if (params?.page) sp.append('page', String(params.page));
    if (params?.limit) sp.append('limit', String(params.limit));
    const qs = sp.toString() ? `?${sp.toString()}` : '';
    return request<any>(`/service-requests/queue${qs}`);
  },
  assignServiceRequestToMe: async (requestId: string) => {
    return request<any>(`/service-requests/${requestId}/assign-self`, { method: 'POST', body: JSON.stringify({}) });
  },
  transitionServiceRequest: async (requestId: string, data: { status: string; remarks?: string; internal_notes?: string }) => {
    return request<any>(`/service-requests/${requestId}/transition`, { method: 'POST', body: JSON.stringify(data) });
  },
  reassignServiceRequest: async (requestId: string, data: { new_employee_id: string; reason: string }) => {
    return request<any>(`/service-requests/${requestId}/reassign`, { method: 'POST', body: JSON.stringify(data) });
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

export type UserRole = 'super_admin' | 'admin' | 'manager' | 'branch_manager' | 'accountant' | 'employee' | 'customer' | string;
export interface AppUser {
  user_id: string;
  email: string;
  name: string;
  role: UserRole;
  role_id?: string;
  role_name?: string;
  picture?: string | null;
  phone?: string | null;
  mobile?: string | null;
  department?: string | null;
  designation?: string | null;
  branch_id?: string | null;
  branch_name?: string | null;
  post_id?: string | null;
  post_title?: string | null;
  permissions?: Record<string, string[]>;
  allowed_menus?: string[];
  app_menu_matrix?: Record<string, any>;
  agency_name?: string | null;
  company_name?: string | null;
  numeric_user_id?: string | null;
  customer_id?: string | null;
  must_change_password?: boolean;
}
