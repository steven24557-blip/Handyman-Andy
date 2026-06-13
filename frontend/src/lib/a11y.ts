// WCAG 2.2 AA helpers — touch targets, hitSlop, font scaling guards.
// Use these everywhere instead of redefining inline.

import { Platform } from 'react-native';

/** iOS HIG: 44pt minimum. Material 3: 48dp minimum. We meet the stricter of both per platform. */
export const MIN_TAP_TARGET = Platform.OS === 'android' ? 48 : 44;

/** Default hitSlop for icon-only buttons whose visual size is < MIN_TAP_TARGET. */
export const DEFAULT_HIT_SLOP = { top: 12, bottom: 12, left: 12, right: 12 } as const;

/** Cap dynamic-type scale so layouts don't catastrophically clip at AX5. */
export const TEXT_MAX_SCALE = 2.0;

/** Standard accessibility props bundle for icon-only Pressables. */
export function iconButtonA11y(label: string, hint?: string) {
  return {
    accessible: true,
    accessibilityRole: 'button' as const,
    accessibilityLabel: label,
    accessibilityHint: hint,
    hitSlop: DEFAULT_HIT_SLOP,
  };
}

/** Live-region prop bundle for async status text (polite by default). */
export function liveRegion(level: 'polite' | 'assertive' = 'polite') {
  return {
    accessible: true,
    accessibilityLiveRegion: level,
    accessibilityRole: 'text' as const,
    // iOS equivalent — UIAccessibilityNotification.announcement is handled
    // automatically by React Native when accessibilityLiveRegion is set on
    // Android; iOS will read changes when the element is currently focused.
  };
}
