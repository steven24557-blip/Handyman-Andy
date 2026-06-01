import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import FadeInView from './FadeInView';
import { CircleDashed, Clock, AlertTriangle, CheckCircle2 } from 'lucide-react-native';
import { colors, radius, space, statusLabel } from '../lib/theme';

type Props = { status: string; size?: 'sm' | 'md' };

const ICONS: Record<string, any> = {
  open: CircleDashed,
  in_progress: Clock,
  emergent: AlertTriangle,
  closed: CheckCircle2,
};

export default function StatusBadge({ status, size = 'md' }: Props) {
  const s = (status || 'open').toLowerCase();
  const Icon = ICONS[s] || CircleDashed;
  const color = (colors.status as any)[s] || colors.status.open;
  const px = size === 'sm' ? 6 : 8;
  const py = size === 'sm' ? 3 : 5;
  const iconSize = size === 'sm' ? 12 : 14;
  const fontSize = size === 'sm' ? 10 : 11;

  const badge = (
    <View
      testID={`status-badge-${s}`}
      style={[styles.badge, { borderColor: color, paddingHorizontal: px, paddingVertical: py }]}
    >
      <Icon size={iconSize} color={color} strokeWidth={2.5} />
      <Text style={[styles.label, { color, fontSize }]}>{statusLabel[s] || s.toUpperCase()}</Text>
    </View>
  );

  if (s === 'emergent') {
    return (
      <FadeInView
        from={{ opacity: 0.6 }}
        animate={{ opacity: 1 }}
        transition={{ type: 'timing', duration: 700, loop: true, repeatReverse: true }}
      >
        {badge}
      </FadeInView>
    );
  }
  return badge;
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    borderWidth: 1.5,
    borderRadius: radius.sm,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  label: {
    fontWeight: '900',
    letterSpacing: 1,
  },
});
