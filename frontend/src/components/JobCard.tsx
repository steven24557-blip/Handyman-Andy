import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MapPin, Wrench, ChevronRight } from 'lucide-react-native';
import { colors, radius, space, text } from '../lib/theme';
import StatusBadge from './StatusBadge';

type Job = {
  job_id: string;
  title: string;
  description?: string;
  status: string;
  location?: string;
  bom?: any[];
};

export default function JobCard({ job, onPress }: { job: Job; onPress: () => void }) {
  const status = (job.status || 'open').toLowerCase();
  const borderColor = (colors.status as any)[status] || colors.status.open;
  const isEmergent = status === 'emergent';
  return (
    <Pressable
      testID={`job-card-${job.job_id}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        {
          borderLeftColor: borderColor,
          borderStyle: status === 'open' ? 'dashed' : 'solid',
          backgroundColor: isEmergent ? 'rgba(239,68,68,0.08)' : colors.surface,
          transform: [{ scale: pressed ? 0.985 : 1 }],
        },
      ]}
    >
      <View style={styles.headRow}>
        <StatusBadge status={status} size="sm" />
        <ChevronRight size={18} color={colors.textTertiary} />
      </View>
      <Text style={styles.title} numberOfLines={2}>{job.title}</Text>
      {!!job.description && (
        <Text style={styles.desc} numberOfLines={2}>{job.description}</Text>
      )}
      <View style={styles.metaRow}>
        {!!job.location && (
          <View style={styles.meta}>
            <MapPin size={12} color={colors.textTertiary} />
            <Text style={styles.metaText} numberOfLines={1}>{job.location}</Text>
          </View>
        )}
        <View style={styles.meta}>
          <Wrench size={12} color={colors.textTertiary} />
          <Text style={styles.metaText}>{(job.bom?.length || 0)} parts</Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: space.md,
    paddingLeft: space.md + 4,
    borderLeftWidth: 4,
    borderWidth: 1,
    borderColor: colors.border,
    gap: space.sm,
  },
  headRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { ...(text.h3 as any), fontSize: 16, letterSpacing: 0.5, textTransform: 'none' },
  desc: { ...(text.bodyDim as any) },
  metaRow: { flexDirection: 'row', gap: space.md, alignItems: 'center', marginTop: 2 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 },
  metaText: { color: colors.textTertiary, fontSize: 11, fontWeight: '600', letterSpacing: 0.4 },
});
