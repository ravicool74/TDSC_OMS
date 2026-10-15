import { AppUser } from './api';

export interface SystemMenuItem {
  id: string;
  title: string;
  category: 'Accounting & Billing' | 'Operations' | 'HR & Staff' | 'Administration';
  route: string;
  icon: string;
  description: string;
}

export const FOUR_MENU_STRUCTURE = {
  dashboard: {
    title: 'Dashboard',
    description: 'System dashboard metrics, summaries, and action triggers',
    items: [
      {
        key: 'financial_overview',
        title: 'Financial Overview',
        description: "Today's Sales, To Receive, To Pay metrics and financial summary",
        icon: 'cash-outline',
      },
      {
        key: 'operations_metrics',
        title: 'Operations Metrics',
        description: 'Pending Tasks, Clients, Staff, Branches, Open Tenders, Leave Requests',
        icon: 'speedometer-outline',
      },
      {
        key: 'urgent_tenders',
        title: 'Urgent Tenders',
        description: 'Imminent tender deadlines, earnest deposits, bidding progress',
        icon: 'document-text-outline',
      },
      {
        key: 'quick_actions',
        title: 'Quick Actions',
        description: 'Direct launch tiles (Add Customer, New Task, Sale Invoice, Field GPS, etc.)',
        icon: 'flash-outline',
      },
    ],
  },
  business: {
    title: 'Business',
    description: 'Contractor accounts, customer records, and ledger vouchers',
    items: [
      {
        key: 'customers',
        title: 'Customers',
        description: 'Contractors & Customers Database, PAN/Aadhar KYC, Documents, Export',
        icon: 'people-outline',
      },
      {
        key: 'accounts',
        title: 'Accounts',
        description: 'Sales Invoices, Payments-In, Returns, Estimates, Challans, Purchases, Cash & Bank',
        icon: 'wallet-outline',
      },
    ],
  },
  task: {
    title: 'Task',
    description: 'Operations execution, client workflows, and collection follow-ups',
    items: [
      {
        key: 'payment_followup',
        title: 'Payment Followup',
        description: 'Payment pending tasks, dues tracking, collection reminders, cleared status',
        icon: 'card-outline',
      },
      {
        key: 'task_followup',
        title: 'Task Follow up',
        description: 'Service workflows, stage movement, forward/return, approvals, chat, activity log',
        icon: 'checkmark-done-circle-outline',
      },
    ],
  },
  more: {
    title: 'More',
    description: 'Extended operational services, HR management, and enterprise administration',
    sections: [
      {
        section_key: 'operations_services',
        section_title: 'Operations & Services',
        items: [
          { key: 'customers', title: 'Contractors & Customers Database', icon: 'people', route: '/customers', description: 'Client master and KYC' },
          { key: 'accounting', title: 'Accounting & Invoices', icon: 'wallet', route: '/accounting/menu', description: 'Invoices, vouchers, payments' },
          { key: 'reports', title: 'Financial & Accounting Reports', icon: 'bar-chart', route: '/accounting/reports', description: 'GSTR and financial ledger' },
          { key: 'services', title: 'Service Master & Workflows', icon: 'construct', route: '/services', description: 'Service catalog and stages' },
          { key: 'expiry_alerts', title: 'Document & DSC Expiry Alerts', icon: 'alert-circle', route: '/customers/expiry-alerts', description: 'Validity tracking' },
          { key: 'gps_tracking', title: 'Field Staff GPS Tracking', icon: 'navigate', route: '/gps/tracking', description: 'Live location routes' },
          { key: 'documents', title: 'Document Library', icon: 'folder-open', route: '/documents', description: 'Office central repository' },
          { key: 'tenders', title: 'Tender Management', icon: 'document-text', route: '/tenders', description: 'Live tenders and bids' },
          { key: 'tender_calling', title: 'Tender Calling & Follow-up', icon: 'call', route: '/tenders?tab=calling', description: 'Vendor call records' },
          { key: 'simple_accounts', title: 'Simple Accounts', icon: 'cash', route: '/(tabs)/business', description: 'Simple income/expense' },
        ],
      },
      {
        section_key: 'human_resources',
        section_title: 'Human Resources',
        items: [
          { key: 'employees', title: 'Employees Directory', icon: 'people', route: '/employees', description: 'Staff directory & KYC' },
          { key: 'attendance_leaves', title: 'Attendance & Leaves', icon: 'calendar', route: '/hr', description: 'Punch in/out & leaves' },
          { key: 'payroll', title: 'Payroll & Salary Slips', icon: 'card', route: '/payroll', description: 'Salaries and deductions' },
          { key: 'attendance_settings', title: 'Attendance Settings', icon: 'time', route: '/attendance-settings', description: 'Geofence and timings' },
        ],
      },
      {
        section_key: 'enterprise_administration',
        section_title: 'Enterprise Administration',
        items: [
          { key: 'branches', title: 'Branch Management', icon: 'business', route: '/admin/branches', description: 'Offices and branches' },
          { key: 'posts', title: 'Post / Designations', icon: 'ribbon', route: '/admin/posts', description: 'Office positions' },
          { key: 'users', title: 'System User Directory', icon: 'person-add', route: '/admin/users', description: 'Credentials and accounts' },
          { key: 'roles', title: 'Roles & RBAC Matrix', icon: 'shield-checkmark', route: '/admin/roles', description: 'Access control rights' },
          { key: 'audit_logs', title: 'Security Audit Trail', icon: 'finger-print', route: '/admin/audit-logs', description: 'Security event logs' },
          { key: 'settings', title: 'System Settings & Backup', icon: 'settings', route: '/admin/settings', description: 'System setup and DB' },
        ],
      },
    ],
  },
} as const;

export const SYSTEM_MENUS: SystemMenuItem[] = [
  // Accounting & Billing
  { id: 'sales_invoices', title: 'Sale Invoices', category: 'Accounting & Billing', route: '/accounting/invoices', icon: 'receipt', description: 'Create and manage sales tax invoices' },
  { id: 'payments_in', title: 'Payments-In (Receipts)', category: 'Accounting & Billing', route: '/accounting/income', icon: 'wallet', description: 'Client payments and money receipts' },
  { id: 'sale_returns', title: 'Sale Return / Credit Note', category: 'Accounting & Billing', route: '/accounting/sale-returns', icon: 'refresh-circle', description: 'Sales returns, credit notes, refunds' },
  { id: 'estimates', title: 'Estimates / Quotations', category: 'Accounting & Billing', route: '/accounting/estimates', icon: 'document-text', description: 'Price estimates and client quotations' },
  { id: 'proforma', title: 'Proforma Invoices', category: 'Accounting & Billing', route: '/accounting/proforma', icon: 'newspaper', description: 'Proforma invoices prior to final billing' },
  { id: 'challans', title: 'Delivery Challans', category: 'Accounting & Billing', route: '/accounting/delivery-challans', icon: 'car', description: 'Material delivery challans and dispatch notes' },
  { id: 'purchases', title: 'Purchase Bills', category: 'Accounting & Billing', route: '/accounting/purchases', icon: 'cart', description: 'Vendor invoices and inward bills' },
  { id: 'cash_bank', title: 'Cash & Bank Accounts', category: 'Accounting & Billing', route: '/accounting/banking', icon: 'cash', description: 'Bank ledger and cash-in-hand accounts' },
  { id: 'accounting_reports', title: 'Financial Reports', category: 'Accounting & Billing', route: '/accounting/reports', icon: 'bar-chart', description: 'GSTR, Profit & Loss, ledger summaries' },

  // Operations & Services
  { id: 'customers', title: 'Contractors & Customers Database', category: 'Operations', route: '/customers', icon: 'people', description: 'Contractors, DSC holders, and client accounts' },
  { id: 'tasks', title: 'Task Management & Operations', category: 'Operations', route: '/(tabs)/tasks', icon: 'checkmark-done', description: 'Client workflow tasks, stages, execution' },
  { id: 'services', title: 'Service Master & Workflows', category: 'Operations', route: '/services', icon: 'construct', description: 'Service definitions, rate card, workflow stages' },
  { id: 'tenders', title: 'Tender Management', category: 'Operations', route: '/tenders', icon: 'document-text', description: 'Live tenders, bidding documents, deadlines' },
  { id: 'tender_calling', title: 'Tender Calling & Follow-up', category: 'Operations', route: '/tenders?tab=calling', icon: 'call', description: 'Telecalling logs, vendor bids, client followups' },
  { id: 'documents', title: 'Document Library', category: 'Operations', route: '/documents', icon: 'folder-open', description: 'Central file store and office documents' },
  { id: 'expiry_alerts', title: 'Document & DSC Expiry Alerts', category: 'Operations', route: '/customers/expiry-alerts', icon: 'alert-circle', description: 'Validity alerts for DSC, licences, registrations' },

  // HR & Staff
  { id: 'employees', title: 'Employees Directory', category: 'HR & Staff', route: '/employees', icon: 'people', description: 'Staff profile directory, KYC, bank details' },
  { id: 'attendance_leaves', title: 'Staff Attendance & Leaves', category: 'HR & Staff', route: '/hr', icon: 'calendar', description: 'Daily punch in/out and staff leave requests' },
  { id: 'payroll', title: 'Payroll & Salary Slips', category: 'HR & Staff', route: '/payroll', icon: 'card', description: 'Salary generation, payslips, deductions' },
  { id: 'gps_tracking', title: 'Field Staff GPS Tracking', category: 'HR & Staff', route: '/gps/tracking', icon: 'navigate', description: 'Live field staff location and routes' },

  // Administration
  { id: 'branches', title: 'Branch Management', category: 'Administration', route: '/admin/branches', icon: 'business', description: 'Offices and branches directory' },
  { id: 'posts', title: 'Post & Designations', category: 'Administration', route: '/admin/posts', icon: 'ribbon', description: 'Designations and office positions' },
  { id: 'user_management', title: 'User Directory & Access', category: 'Administration', route: '/admin/users', icon: 'person-add', description: 'System user accounts, credentials, status' },
  { id: 'roles_permissions', title: 'Roles & RBAC Matrix', category: 'Administration', route: '/admin/roles', icon: 'shield-checkmark', description: 'Access control matrix and menu permissions' },
  { id: 'audit_logs', title: 'Security Audit Trail', category: 'Administration', route: '/admin/audit-logs', icon: 'finger-print', description: 'Immutable security and audit event logs' },
  { id: 'settings', title: 'System Settings & Backup', category: 'Administration', route: '/admin/settings', icon: 'settings', description: 'System config, company profile, database backup' },
];

export const MENU_CATEGORIES = [
  'Accounting & Billing',
  'Operations',
  'HR & Staff',
  'Administration',
] as const;

export const STANDARD_ACTIONS = [
  { key: 'view', label: 'View', icon: 'eye-outline', activeColor: '#059669', activeBg: '#DCFCE7', activeBorder: '#86EFAC' },
  { key: 'add', label: 'Add', icon: 'add-circle-outline', activeColor: '#2563EB', activeBg: '#DBEAFE', activeBorder: '#93C5FD' },
  { key: 'search', label: 'Search', icon: 'search-outline', activeColor: '#0891B2', activeBg: '#CFFAFE', activeBorder: '#A5F3FC' },
  { key: 'edit', label: 'Edit', icon: 'create-outline', activeColor: '#D97706', activeBg: '#FEF3C7', activeBorder: '#FDE68A' },
  { key: 'delete', label: 'Delete', icon: 'trash-outline', activeColor: '#DC2626', activeBg: '#FEE2E2', activeBorder: '#FCA5A5' },
  { key: 'share', label: 'Share', icon: 'share-social-outline', activeColor: '#7C3AED', activeBg: '#EDE9FE', activeBorder: '#DDD6FE' },
  { key: 'export', label: 'Export', icon: 'download-outline', activeColor: '#0D9488', activeBg: '#CCFBF1', activeBorder: '#99F6E4' },
] as const;

export type ActionKey = typeof STANDARD_ACTIONS[number]['key'];

/**
 * Checks whether user has VIEW power for a menu item.
 */
export function canView(user: AppUser | null | undefined, menuType: string, subKey?: string, nestedKey?: string): boolean {
  if (!user) return false;
  if (user.role === 'super_admin' || user.role_id === 'super_admin') return true;

  const matrix = user.app_menu_matrix;
  if (matrix && matrix[menuType]) {
    if (nestedKey && matrix[menuType][subKey || '']) {
      const item = matrix[menuType][subKey || ''][nestedKey];
      if (item && typeof item.view === 'boolean') return item.view;
    }
    if (subKey) {
      const item = matrix[menuType][subKey];
      if (item && typeof item.view === 'boolean') return item.view;
      if (item && typeof item === 'object') {
        return Object.values(item).some((v: any) => v?.view === true);
      }
    }
    return Object.values(matrix[menuType]).some((val: any) =>
      val?.view === true || (typeof val === 'object' && Object.values(val).some((v: any) => v?.view === true))
    );
  }

  // Fallback to allowed_menus if app_menu_matrix not yet configured
  if (subKey) {
    return isMenuAllowed(user, subKey);
  }
  return true;
}

/**
 * Checks whether user has WRITE power (Add, Edit, Delete, Update, Save) for a menu item.
 */
export function canWrite(user: AppUser | null | undefined, menuType: string, subKey?: string, nestedKey?: string): boolean {
  if (!user) return false;
  if (user.role === 'super_admin' || user.role_id === 'super_admin') return true;
  if (user.role === 'admin' && (!user.app_menu_matrix || Object.keys(user.app_menu_matrix).length === 0)) return true;

  const matrix = user.app_menu_matrix;
  if (matrix && matrix[menuType]) {
    let item = matrix[menuType][subKey || ''];
    if (nestedKey && item) {
      item = item[nestedKey];
    }
    if (item) {
      if (typeof item.write === 'boolean') return item.write;
      if (item.add || item.edit || item.delete) return true;
      if (Array.isArray(item.actions)) {
        return item.actions.some((a: string) => ['add', 'edit', 'delete'].includes(a));
      }
    }
  }

  if (user.role === 'admin' || user.role === 'manager' || user.role === 'branch_manager') return true;
  return false;
}

/**
 * Checks whether user has permission for a specific granular action:
 * 'view' | 'add' | 'search' | 'edit' | 'delete' | 'share' | 'export'
 */
export function canAction(
  user: AppUser | null | undefined,
  menuType: string,
  subKey: string,
  action: ActionKey,
  nestedKey?: string
): boolean {
  if (!user) return false;
  if (user.role === 'super_admin' || user.role_id === 'super_admin') return true;
  if (user.role === 'admin' && (!user.app_menu_matrix || Object.keys(user.app_menu_matrix).length === 0)) return true;

  const matrix = user.app_menu_matrix;
  if (matrix && matrix[menuType]) {
    let item = matrix[menuType][subKey];
    if (nestedKey && item) {
      item = item[nestedKey];
    }
    if (item) {
      if (typeof item[action] === 'boolean') return item[action];
      if (Array.isArray(item.actions)) return item.actions.includes(action);
      // Legacy fallback
      if (action === 'view') return !!item.view;
      if (action === 'search') return !!item.view;
      if (['add', 'edit', 'delete', 'share', 'export'].includes(action)) return !!item.write;
    }
  }

  // Fallbacks
  if (user.role === 'admin') return true;
  if (action === 'view' || action === 'search') return true;
  return false;
}

/**
 * Legacy check for allowed_menus array
 */
export function isMenuAllowed(user: AppUser | null | undefined, menuId: string): boolean {
  if (!user) return false;
  if (user.role === 'super_admin' || user.role_id === 'super_admin') return true;

  if (Array.isArray(user.allowed_menus) && user.allowed_menus.length > 0) {
    return user.allowed_menus.includes(menuId);
  }

  if (user.role === 'admin' || user.role_id === 'admin') return true;

  if (menuId === 'tasks' || menuId === 'attendance_leaves' || menuId === 'documents') {
    return true;
  }
  return false;
}

/**
 * Checks whether a specific module action is permitted for the user.
 */
export function hasPermission(user: AppUser | null | undefined, module: string, action: string): boolean {
  if (!user) return false;
  if (user.role === 'super_admin' || user.role_id === 'super_admin') return true;
  if (user.role === 'admin' && (!user.permissions || Object.keys(user.permissions).length === 0)) return true;

  const modulePerms = user.permissions?.[module];
  if (!modulePerms) return false;
  return modulePerms.includes(action);
}

/**
 * Checks whether user has Admin or Super Admin privileges.
 */
export function canManageRoles(user: AppUser | null | undefined): boolean {
  if (!user) return false;
  return user.role === 'super_admin' || user.role === 'admin' || user.role_id === 'super_admin' || user.role_id === 'admin';
}
