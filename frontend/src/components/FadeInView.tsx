// Thin platform-safe animation wrapper. Avoids moti/framer-motion's
// tslib issue on Metro web while keeping the same call-site shape.
//
// Usage:
//   <FadeInView from={{ opacity: 0, translateY: 12 }}
//               animate={{ opacity: 1, translateY: 0 }}
//               transition={{ duration: 320, delay: 60 }}>
//     ...children
//   </FadeInView>

import React, { useEffect, useRef } from 'react';
import { Animated, Easing, ViewProps } from 'react-native';

type State = { opacity?: number; translateY?: number; scale?: number };

type Transition = {
  type?: 'timing' | 'spring';
  duration?: number;
  delay?: number;
  loop?: boolean;
  repeatReverse?: boolean;
};

type Props = ViewProps & {
  from?: State;
  animate?: State;
  transition?: Transition;
  children?: React.ReactNode;
};

export function FadeInView({ from, animate, transition, style, children, ...rest }: Props) {
  const opacity = useRef(new Animated.Value(from?.opacity ?? 1)).current;
  const translateY = useRef(new Animated.Value(from?.translateY ?? 0)).current;
  const scale = useRef(new Animated.Value(from?.scale ?? 1)).current;

  useEffect(() => {
    const duration = transition?.duration ?? 320;
    const delay = transition?.delay ?? 0;
    const easing = Easing.out(Easing.cubic);

    const animations: Animated.CompositeAnimation[] = [];
    if (animate?.opacity !== undefined) {
      animations.push(Animated.timing(opacity, { toValue: animate.opacity, duration, delay, easing, useNativeDriver: true }));
    }
    if (animate?.translateY !== undefined) {
      animations.push(Animated.timing(translateY, { toValue: animate.translateY, duration, delay, easing, useNativeDriver: true }));
    }
    if (animate?.scale !== undefined) {
      animations.push(Animated.timing(scale, { toValue: animate.scale, duration, delay, easing, useNativeDriver: true }));
    }

    if (transition?.loop) {
      // Simple looping fade between from -> animate
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(opacity, { toValue: from?.opacity ?? 0.5, duration: duration, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: animate?.opacity ?? 1, duration: duration, useNativeDriver: true }),
        ]),
        { resetBeforeIteration: true },
      );
      loop.start();
      return () => loop.stop();
    }

    Animated.parallel(animations).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Animated.View
      {...rest}
      style={[style, { opacity, transform: [{ translateY }, { scale }] }]}
    >
      {children}
    </Animated.View>
  );
}

export default FadeInView;
