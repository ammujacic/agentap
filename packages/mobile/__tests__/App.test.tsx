import React from 'react';
import { render } from '@testing-library/react-native';
import { Text, View } from 'react-native';

// Simple component for testing
function TestComponent({ message }: { message: string }) {
  return (
    <View testID="container">
      <Text testID="message">{message}</Text>
    </View>
  );
}

describe('Mobile App', () => {
  it('renders correctly', () => {
    const { getByTestId } = render(<TestComponent message="Hello, Agentap!" />);

    expect(getByTestId('container')).toBeTruthy();
    expect(getByTestId('message')).toBeTruthy();
  });

  it('displays the correct message', () => {
    const { getByTestId } = render(<TestComponent message="Test Message" />);

    expect(getByTestId('message').props.children).toBe('Test Message');
  });
});

describe('Utility Functions', () => {
  it('should format dates correctly', () => {
    const date = new Date('2024-01-01T12:00:00Z');
    const formatted = date.toISOString();

    expect(formatted).toContain('2024-01-01');
  });
});
