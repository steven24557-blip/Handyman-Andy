import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { HelpCircle, X } from 'lucide-react-native';
import HandyAndy from '@/src/components/HandyAndy';
import { api } from './api';
import { useAuth } from './auth';
import { colors, radius, space } from './theme';

/**
 * MascotContext — controls the friendly floating "Handy-Andy" helper.
 *
 * Design goals:
 *   • **Text-only** guidance. Andy never speaks. Any spoken guidance must
 *     continue to flow through the existing OpenAI-TTS persona system so the
 *     user's chosen voice + personality remain the single audio source.
 *   • **Never interruptive**. Andy only appears when the app explicitly asks
 *     him to (`showTip`) or when the user taps his own icon.
 *   • **Fully dismissible**. Users may permanently disable him via Settings
 *     (server-persisted `show_mascot=false`).
 *   • **AR-ready**. The tip pipeline (`type MascotTip`) is intentionally the
 *     kind of payload we'd hand to a ViroReact character in the future — a
 *     `context` + `body` string is all a 3D Andy would need. Only the render
 *     layer changes.
 */

export type MascotTip = {
  /** Free-form key so `dismiss(context)` can hide the same tip forever. */
  context: string;
  /** Short headline. */
  title?: string;
  /** Body text — the actual advice. Kept short (~2 sentences). */
  body: string;
  /** If true, tip auto-hides after a few seconds. */
  transient?: boolean;
};

type MascotState = {
  enabled: boolean;           // user preference — global on/off
  setEnabled: (v: boolean) => Promise<void>;
  /** Push a contextual tip. If the user already dismissed this `context`
   *  it is silently ignored (unless `force`). */
  showTip: (tip: MascotTip, opts?: { force?: boolean }) => void;
  /** Programmatically hide the current tip without dismissing permanently. */
  hideTip: () => void;
  /** Permanently silence a given context. */
  dismiss: (context: string) => Promise<void>;
  dismissedContexts: string[];
};

const MascotContext = createContext<MascotState | null>(null);

export function MascotProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [enabled, setEnabledState] = useState(true);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [tip, setTip] = useState<MascotTip | null>(null);
  const [expanded, setExpanded] = useState(false);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (!user) { setEnabledState(true); setDismissed([]); return; }
    (async () => {
      try {
        const r = await api.mascotSettings();
        setEnabledState(!!r.show_mascot);
        setDismissed(r.dismissed_contexts || []);
      } catch {}
    })();
  }, [user]);

  const setEnabled = useCallback(async (v: boolean) => {
    setEnabledState(v);
    if (!v) {
      setTip(null);
      setExpanded(false);
    }
    try { await api.setMascotSettings(v); } catch {}
  }, []);

  const dismiss = useCallback(async (context: string) => {
    setDismissed((d) => (d.includes(context) ? d : [...d, context]));
    try { await api.dismissMascot(context); } catch {}
  }, []);

  const showTip = useCallback((next: MascotTip, opts?: { force?: boolean }) => {
    if (!enabled) return;
    if (!opts?.force && dismissed.includes(next.context)) return;
    setTip(next);
    setExpanded(true);
    if (next.transient) {
      setTimeout(() => setExpanded(false), 6500);
    }
  }, [dismissed, enabled]);

  const hideTip = useCallback(() => setExpanded(false), []);

  const value = useMemo<MascotState>(
    () => ({ enabled, setEnabled, showTip, hideTip, dismiss, dismissedContexts: dismissed }),
    [enabled, setEnabled, showTip, hideTip, dismiss, dismissed],
  );

  return (
    <MascotContext.Provider value={value}>
      {children}
      {user && enabled ? (
        <FloatingMascot
          tip={tip}
          expanded={expanded}
          onOpen={() => {
            if (!tip) {
              setTip({
                context: 'help',
                title: 'ASK ANDY',
                body: 'Need a hand? Tap a screen action to see what I can help with, or open the diagnostic tab to run a scan.',
              });
            }
            setExpanded((e) => !e);
          }}
          onClose={() => setExpanded(false)}
          onDismissForever={async () => {
            if (tip) await dismiss(tip.context);
            setExpanded(false);
          }}
          bottomInset={insets.bottom}
        />
      ) : null}
    </MascotContext.Provider>
  );
}

export function useMascot() {
  const ctx = useContext(MascotContext);
  if (!ctx) throw new Error('useMascot outside provider');
  return ctx;
}

// ============================================================
// Floating mascot UI
// ============================================================
function FloatingMascot({
  tip, expanded, onOpen, onClose, onDismissForever, bottomInset,
}: {
  tip: MascotTip | null;
  expanded: boolean;
  onOpen: () => void;
  onClose: () => void;
  onDismissForever: () => void | Promise<void>;
  bottomInset: number;
}) {
  // Small bounce on new tip
  const anim = React.useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(anim, { toValue: expanded ? 1 : 0, useNativeDriver: true, damping: 15 }).start();
  }, [anim, expanded]);

  const scale = anim.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1] });
  const opacity = anim;

  // Tab bar height on the primary layout is ~60. Sit above it so we never
  // occlude a tab icon.
  const bottom = Math.max(bottomInset, 12) + 72;

  return (
    <View pointerEvents="box-none" style={[styles.hostLayer, { bottom }]}>
      {expanded && tip ? (
        <Animated.View
          testID="mascot-bubble"
          style={[styles.bubble, { opacity, transform: [{ scale }] }]}
          accessibilityRole="alert"
          accessibilityLabel={`Handy-Andy tip. ${tip.title || ''} ${tip.body}`}
        >
          <View style={styles.bubbleHead}>
            {tip.title ? <Text style={styles.bubbleTitle}>{tip.title}</Text> : <Text style={styles.bubbleTitle}>HANDY-ANDY</Text>}
            <Pressable
              testID="mascot-close"
              onPress={onClose}
              hitSlop={12}
              accessibilityLabel="Close tip"
            >
              <X size={16} color={colors.textSecondary} />
            </Pressable>
          </View>
          <Text style={styles.bubbleBody}>{tip.body}</Text>
          <Pressable
            testID="mascot-dismiss-forever"
            onPress={onDismissForever}
            hitSlop={8}
            style={styles.dismissRow}
            accessibilityLabel="Don't show this tip again"
          >
            <Text style={styles.dismissText}>Don&apos;t show again</Text>
          </Pressable>
          <View style={styles.bubbleTail} />
        </Animated.View>
      ) : null}

      <Pressable
        testID="mascot-fab"
        onPress={onOpen}
        style={({ pressed }) => [styles.fab, pressed && { transform: [{ scale: 0.94 }] }]}
        accessibilityRole="button"
        accessibilityLabel={expanded ? 'Close Handy-Andy tip' : 'Open Handy-Andy helper'}
        accessibilityHint="Provides contextual tips for the current screen."
      >
        {expanded ? (
          <HelpCircle size={26} color={colors.primary} />
        ) : (
          <HandyAndy size={44} />
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  hostLayer: {
    position: 'absolute', right: 12,
    alignItems: 'flex-end', gap: 8,
    zIndex: 1000,
  },
  fab: {
    width: 60, height: 60, borderRadius: 30,
    backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
    // shadow (iOS)
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.35, shadowRadius: 6,
    // elevation (Android)
    elevation: 8,
  },
  bubble: {
    maxWidth: 280, backgroundColor: colors.surface,
    borderRadius: radius.md, borderWidth: 2, borderColor: colors.primary,
    padding: space.md, gap: 6,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.35, shadowRadius: 6,
    elevation: 8,
  },
  bubbleHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  bubbleTitle: { color: colors.primary, fontSize: 11, fontWeight: '900', letterSpacing: 1.5 },
  bubbleBody: { color: colors.textPrimary, fontSize: 13, lineHeight: 19 },
  dismissRow: { paddingTop: 4 },
  dismissText: { color: colors.textTertiary, fontSize: 11, fontWeight: '700', textDecorationLine: 'underline' },
  bubbleTail: {
    position: 'absolute', right: 24, bottom: -8,
    width: 14, height: 14, backgroundColor: colors.surface,
    borderRightWidth: 2, borderBottomWidth: 2, borderColor: colors.primary,
    transform: [{ rotate: '45deg' }],
  },
});
