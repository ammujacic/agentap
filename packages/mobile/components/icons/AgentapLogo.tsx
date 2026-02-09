import { View, Text, type ViewStyle } from 'react-native';
import Svg, { Defs, LinearGradient, Stop, Path, Rect, Circle } from 'react-native-svg';

interface AgentapLogoProps {
  size?: number;
  showName?: boolean;
  style?: ViewStyle;
}

export function AgentapLogo({ size = 28, showName = true, style }: AgentapLogoProps) {
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 4 }, style]}>
      <Svg width={size} height={size} viewBox="0 0 64 64" fill="none">
        <Defs>
          <LinearGradient id="aiGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%" stopColor="#06b6d4" />
            <Stop offset="50%" stopColor="#3b82f6" />
            <Stop offset="100%" stopColor="#a855f7" />
          </LinearGradient>
          <LinearGradient id="aiGradientLight" x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%" stopColor="#67e8f9" />
            <Stop offset="50%" stopColor="#93c5fd" />
            <Stop offset="100%" stopColor="#c4b5fd" />
          </LinearGradient>
        </Defs>
        {/* Left bracket > */}
        <Path
          d="M8 32 L18 22 M8 32 L18 42"
          stroke="url(#aiGradient)"
          strokeWidth={4}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.7}
        />
        {/* Right bracket < */}
        <Path
          d="M56 32 L46 22 M56 32 L46 42"
          stroke="url(#aiGradient)"
          strokeWidth={4}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.7}
        />
        {/* Agent body */}
        <Rect x={22} y={20} width={20} height={24} rx={5} fill="url(#aiGradient)" />
        {/* Eye */}
        <Circle cx={32} cy={28} r={5} fill="#ffffff" />
        <Circle cx={33} cy={27} r={2} fill="#3b82f6" />
        {/* Terminal prompt line */}
        <Rect x={27} y={37} width={10} height={2} rx={1} fill="url(#aiGradientLight)" />
      </Svg>
      {showName && (
        <Text style={{ color: '#ffffff', fontSize: 16, fontWeight: '700' }}>agentap</Text>
      )}
    </View>
  );
}
