// Design tokens (mirrored from /app/design_guidelines.json — kept type-safe).
export const colors = {
  background: '#09090b',
  surface: '#18181b',
  surfaceElevated: '#27272a',
  primary: '#EAB308',
  primaryDark: '#ca8a04',
  primaryMuted: 'rgba(234, 179, 8, 0.18)',
  textPrimary: '#ffffff',
  textSecondary: '#a1a1aa',
  textTertiary: '#71717a',
  border: '#27272a',
  borderStrong: '#3f3f46',
  borderFocus: '#EAB308',
  status: {
    open: '#3b82f6',
    in_progress: '#EAB308',
    emergent: '#ef4444',
    closed: '#22c55e',
  },
  scrim: 'rgba(0, 0, 0, 0.7)',
  danger: '#ef4444',
  success: '#22c55e',
} as const;

export const space = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 } as const;
export const radius = { none: 0, sm: 4, md: 8, lg: 12, pill: 9999 } as const;

export const text = {
  h1: { fontSize: 32, fontWeight: '900', letterSpacing: 1.5, color: colors.textPrimary },
  h2: { fontSize: 24, fontWeight: '800', letterSpacing: 1.2, color: colors.textPrimary },
  h3: { fontSize: 18, fontWeight: '700', letterSpacing: 1.0, color: colors.textPrimary },
  body: { fontSize: 15, fontWeight: '400', lineHeight: 22, color: colors.textPrimary },
  bodyDim: { fontSize: 14, fontWeight: '400', lineHeight: 20, color: colors.textSecondary },
  caption: { fontSize: 12, fontWeight: '700', letterSpacing: 0.8, color: colors.textTertiary },
} as const;

export const statusLabel: Record<string, string> = {
  open: 'OPEN',
  in_progress: 'IN PROGRESS',
  emergent: 'EMERGENT',
  closed: 'CLOSED',
};
