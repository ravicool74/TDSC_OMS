export const colors = {
  background: '#F8FAFC',
  surface: '#FFFFFF',
  onSurface: '#09090B',
  surfaceSecondary: '#F4F4F5',
  onSurfaceSecondary: '#18181B',
  surfaceTertiary: '#E4E4E7',
  onSurfaceTertiary: '#27272A',
  surfaceInverse: '#09090B',
  onSurfaceInverse: '#FFFFFF',
  brand: '#0A5CFF',
  brandPrimary: '#0A5CFF',
  onBrandPrimary: '#FFFFFF',
  brandSecondary: '#2563EB',
  brandTertiary: '#DBEAFE',
  onBrandTertiary: '#1D4ED8',
  success: '#10B981',
  onSuccess: '#FFFFFF',
  warning: '#F59E0B',
  onWarning: '#FFFFFF',
  error: '#EF4444',
  onError: '#FFFFFF',
  info: '#3B82F6',
  border: '#E4E4E7',
  borderStrong: '#D4D4D8',
  divider: '#F4F4F5',
  muted: '#71717A',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
};

export const radius = { sm: 6, md: 12, lg: 20, xl: 24, pill: 999, full: 9999 };

export const font = {
  xs: 11,
  sm: 12,
  md: 14,
  base: 14,
  lg: 16,
  xl: 20,
  xxl: 24,
  display: 30,
};

export const shadow = {
  xs: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
    elevation: 1,
  },
  sm: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  md: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  lg: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 4,
  },
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
};

export const shadows = shadow;

export const roleColor = (role: string) => {
  if (role === 'admin') return colors.error;
  if (role === 'manager') return colors.brandPrimary;
  return colors.success;
};
