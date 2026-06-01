import React, { useEffect } from 'react';
import { Tabs, useRouter } from 'expo-router';
import { ClipboardList, Camera, ShieldAlert, Settings as Cog, Calculator } from 'lucide-react-native';
import { useAuth } from '@/src/lib/auth';
import { colors } from '@/src/lib/theme';

export default function TabsLayout() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [user, loading, router]);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textTertiary,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.borderStrong,
          borderTopWidth: 1,
          height: 70,
          paddingBottom: 12,
          paddingTop: 8,
        },
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '900',
          letterSpacing: 1,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'JOBS',
          tabBarIcon: ({ color, size }) => <ClipboardList size={size} color={color} strokeWidth={2.4} />,
        }}
      />
      <Tabs.Screen
        name="diagnostic"
        options={{
          title: 'DIAGNOSE',
          tabBarIcon: ({ color, size }) => <Camera size={size} color={color} strokeWidth={2.4} />,
        }}
      />
      <Tabs.Screen
        name="estimator"
        options={{
          title: 'ESTIMATE',
          tabBarIcon: ({ color, size }) => <Calculator size={size} color={color} strokeWidth={2.4} />,
        }}
      />
      <Tabs.Screen
        name="safety"
        options={{
          title: 'SAFETY',
          tabBarIcon: ({ color, size }) => <ShieldAlert size={size} color={color} strokeWidth={2.4} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'SETTINGS',
          tabBarIcon: ({ color, size }) => <Cog size={size} color={color} strokeWidth={2.4} />,
        }}
      />
    </Tabs>
  );
}
