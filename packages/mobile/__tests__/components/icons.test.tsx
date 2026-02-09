import React from 'react';
import { render } from '@testing-library/react-native';
import { AgentapLogo } from '../../components/icons/AgentapLogo';
import { ClaudeCodeIcon } from '../../components/icons/ClaudeCodeIcon';

describe('AgentapLogo', () => {
  it('renders with default props', () => {
    const { toJSON } = render(<AgentapLogo />);
    expect(toJSON()).toBeTruthy();
  });

  it('shows "agentap" text when showName is true (default)', () => {
    const { getByText } = render(<AgentapLogo />);
    expect(getByText('agentap')).toBeTruthy();
  });

  it('does not show text when showName is false', () => {
    const { queryByText } = render(<AgentapLogo showName={false} />);
    expect(queryByText('agentap')).toBeNull();
  });

  it('accepts a custom size prop', () => {
    const { toJSON } = render(<AgentapLogo size={48} />);
    const tree = toJSON();
    expect(tree).toBeTruthy();
  });

  it('accepts a custom style prop', () => {
    const customStyle = { marginTop: 10 };
    const { toJSON } = render(<AgentapLogo style={customStyle} />);
    expect(toJSON()).toBeTruthy();
  });

  it('renders SVG elements (mocked as Views)', () => {
    const { getByTestId } = render(<AgentapLogo />);
    // The react-native-svg mock renders Svg as a View with testID="svg-Svg"
    expect(getByTestId('svg-Svg')).toBeTruthy();
  });
});

describe('ClaudeCodeIcon', () => {
  it('renders with default props', () => {
    const { toJSON } = render(<ClaudeCodeIcon />);
    expect(toJSON()).toBeTruthy();
  });

  it('renders SVG element', () => {
    const { getByTestId } = render(<ClaudeCodeIcon />);
    expect(getByTestId('svg-Svg')).toBeTruthy();
  });

  it('accepts a custom size prop', () => {
    const { toJSON } = render(<ClaudeCodeIcon size={32} />);
    expect(toJSON()).toBeTruthy();
  });

  it('accepts a custom color prop', () => {
    const { toJSON } = render(<ClaudeCodeIcon color="#ff0000" />);
    expect(toJSON()).toBeTruthy();
  });

  it('renders Path element with the provided color', () => {
    const { getByTestId } = render(<ClaudeCodeIcon color="#00ff00" />);
    const pathElement = getByTestId('svg-Path');
    expect(pathElement.props.fill).toBe('#00ff00');
  });

  it('uses default color when no color prop is given', () => {
    const { getByTestId } = render(<ClaudeCodeIcon />);
    const pathElement = getByTestId('svg-Path');
    expect(pathElement.props.fill).toBe('#D97757');
  });
});
