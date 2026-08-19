import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Ellipse, G, Path, Rect } from 'react-native-svg';

type Props = { size?: number; hardHat?: boolean };

/**
 * Handy-Andy — a friendly SVG mascot.
 *
 * Kept as pure `react-native-svg` so:
 *   - it scales crisply at any size,
 *   - has no external assets (bundle friendly),
 *   - and the exact same geometry can be handed to ViroReact / R3F / a
 *     glTF exporter for an AR version later.
 *
 * All colors are literal instead of theme tokens because the mascot ships as
 * a self-contained brand illustration.
 */
export default function HandyAndy({ size = 64, hardHat = true }: Props) {
  const s = size;
  return (
    <View style={[styles.wrap, { width: s, height: s }]}>
      <Svg width={s} height={s} viewBox="0 0 100 100">
        {/* Body / shirt */}
        <Path d="M22 88 Q22 70 34 66 L66 66 Q78 70 78 88 Z" fill="#eab308" stroke="#a16207" strokeWidth={1.5} />
        {/* Shirt collar V */}
        <Path d="M44 66 L50 76 L56 66 Z" fill="#0a0a0a" />

        {/* Head */}
        <Circle cx={50} cy={44} r={22} fill="#f5cba7" stroke="#c69a6a" strokeWidth={1.2} />

        {/* Ears */}
        <Ellipse cx={28} cy={45} rx={3} ry={5} fill="#f5cba7" stroke="#c69a6a" strokeWidth={1} />
        <Ellipse cx={72} cy={45} rx={3} ry={5} fill="#f5cba7" stroke="#c69a6a" strokeWidth={1} />

        {/* Eyes */}
        <Circle cx={41} cy={44} r={2.5} fill="#0a0a0a" />
        <Circle cx={59} cy={44} r={2.5} fill="#0a0a0a" />
        <Circle cx={41.6} cy={43.3} r={0.8} fill="#ffffff" />
        <Circle cx={59.6} cy={43.3} r={0.8} fill="#ffffff" />

        {/* Cheeks */}
        <Circle cx={35} cy={51} r={2.5} fill="#f8b4a1" opacity={0.6} />
        <Circle cx={65} cy={51} r={2.5} fill="#f8b4a1" opacity={0.6} />

        {/* Smile */}
        <Path d="M42 54 Q50 60 58 54" stroke="#0a0a0a" strokeWidth={2} fill="none" strokeLinecap="round" />

        {/* Mustache */}
        <Path d="M40 52 Q45 50 50 52 Q55 50 60 52" stroke="#7c2d12" strokeWidth={2.2} fill="none" strokeLinecap="round" />

        {hardHat ? (
          <G>
            {/* Hard hat brim */}
            <Ellipse cx={50} cy={28} rx={26} ry={4} fill="#0a0a0a" />
            {/* Hard hat dome */}
            <Path d="M28 28 Q28 12 50 12 Q72 12 72 28 Z" fill="#eab308" stroke="#a16207" strokeWidth={1.5} />
            {/* Center ridge */}
            <Rect x={48.5} y={14} width={3} height={14} fill="#a16207" />
          </G>
        ) : null}

        {/* Left arm hidden behind body; right arm holding hammer */}
        <G>
          <Path d="M76 70 L88 62" stroke="#f5cba7" strokeWidth={5} strokeLinecap="round" />
          {/* Hammer handle */}
          <Rect x={86} y={54} width={2.5} height={12} fill="#7c2d12" rx={1} transform="rotate(30 87.25 60)" />
          {/* Hammer head */}
          <Rect x={82} y={49} width={12} height={5} fill="#71717a" stroke="#3f3f46" strokeWidth={0.8} rx={1} transform="rotate(30 88 51.5)" />
        </G>
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
});
