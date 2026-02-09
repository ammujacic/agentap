import { Colors, AgentColors } from '../../constants/Colors';

describe('Colors', () => {
  it('has primary color defined', () => {
    expect(Colors.primary).toBeDefined();
    expect(typeof Colors.primary).toBe('string');
  });

  it('has background colors defined', () => {
    expect(Colors.background).toBeDefined();
    expect(Colors.backgroundSecondary).toBeDefined();
    expect(Colors.backgroundTertiary).toBeDefined();
  });

  it('has text colors defined', () => {
    expect(Colors.text).toBeDefined();
    expect(Colors.textSecondary).toBeDefined();
    expect(Colors.textMuted).toBeDefined();
  });

  it('has status colors defined', () => {
    expect(Colors.success).toBeDefined();
    expect(Colors.warning).toBeDefined();
    expect(Colors.error).toBeDefined();
    expect(Colors.info).toBeDefined();
  });

  it('has UI colors defined', () => {
    expect(Colors.border).toBeDefined();
    expect(Colors.card).toBeDefined();
    expect(Colors.overlay).toBeDefined();
  });

  it('has gradient colors defined', () => {
    expect(Colors.gradientStart).toBeDefined();
    expect(Colors.gradientEnd).toBeDefined();
  });

  it('has agent-specific colors defined', () => {
    expect(Colors.claudeCode).toBeDefined();
    expect(Colors.codex).toBeDefined();
    expect(Colors.aider).toBeDefined();
    expect(Colors.opencode).toBeDefined();
  });

  it('uses valid hex color format for primary colors', () => {
    const hexRegex = /^#[0-9a-fA-F]{6}$/;
    expect(Colors.primary).toMatch(hexRegex);
    expect(Colors.secondary).toMatch(hexRegex);
    expect(Colors.background).toMatch(hexRegex);
  });
});

describe('AgentColors', () => {
  it('has a "claude-code" key', () => {
    expect(AgentColors['claude-code']).toBeDefined();
  });

  it('maps claude-code to Colors.claudeCode', () => {
    expect(AgentColors['claude-code']).toBe(Colors.claudeCode);
  });

  it('has entries for all supported agents', () => {
    expect(AgentColors['codex']).toBe(Colors.codex);
    expect(AgentColors['aider']).toBe(Colors.aider);
    expect(AgentColors['opencode']).toBe(Colors.opencode);
  });

  it('all values are strings', () => {
    for (const [key, value] of Object.entries(AgentColors)) {
      expect(typeof value).toBe('string');
    }
  });
});
