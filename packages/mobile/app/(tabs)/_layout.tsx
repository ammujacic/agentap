/**
 * Tabs layout
 */

import { Tabs, useRouter } from 'expo-router';
import { TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/Colors';
import { useSessionsStore } from '@agentap-dev/shared';
import { AgentapLogo } from '../../components/icons/AgentapLogo';

export default function TabsLayout() {
  const pendingApprovals = useSessionsStore((s) => s.pendingApprovals.length);
  const router = useRouter();

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.textMuted,
        tabBarStyle: {
          backgroundColor: Colors.background,
          borderTopColor: Colors.border,
        },
        headerStyle: {
          backgroundColor: Colors.background,
        },
        headerTintColor: Colors.text,
        headerLeft: () => <AgentapLogo size={28} showName style={{ marginLeft: 12 }} />,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Machines',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'laptop' : 'laptop-outline'} size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="sessions"
        options={{
          title: 'Sessions',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons
              name={focused ? 'code-slash' : 'code-slash-outline'}
              size={size}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="approvals"
        options={{
          title: 'Approvals',
          headerLeft: () =>
            router.canGoBack() ? (
              <TouchableOpacity onPress={() => router.back()} style={{ marginLeft: 8 }}>
                <Ionicons name="chevron-back" size={24} color={Colors.text} />
              </TouchableOpacity>
            ) : (
              <AgentapLogo size={28} showName style={{ marginLeft: 12 }} />
            ),
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons
              name={focused ? 'shield-checkmark' : 'shield-checkmark-outline'}
              size={size}
              color={color}
            />
          ),
          tabBarBadge: pendingApprovals > 0 ? pendingApprovals : undefined,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'settings' : 'settings-outline'} size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
