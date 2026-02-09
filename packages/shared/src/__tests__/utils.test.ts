import { describe, it, expect } from 'vitest';

import { hasSystemTags, stripSystemTags, extractSessionTitle } from '../utils';

// Helpers to build tag strings
const tag = (name: string, content: string) => `<${name}>${content}</${name}>`;
const openTag = (name: string) => `<${name}>`;

// Build antml-namespaced tag strings via concatenation to avoid XML parsing
const antmlTag = (suffix: string, content: string) =>
  '<' + 'antml:' + suffix + '>' + content + '</' + 'antml:' + suffix + '>';
const antmlOpen = (suffix: string) => '<' + 'antml:' + suffix + '>';

describe('hasSystemTags', () => {
  describe('returns true for each known tag type', () => {
    it('should detect system-reminder tag', () => {
      expect(hasSystemTags(tag('system-reminder', 'content'))).toBe(true);
    });

    it('should detect ide_opened_file tag', () => {
      expect(hasSystemTags(tag('ide_opened_file', '/path/to/file.ts'))).toBe(true);
    });

    it('should detect ide_selection tag', () => {
      expect(hasSystemTags(tag('ide_selection', 'selected code'))).toBe(true);
    });

    it('should detect ide_context tag', () => {
      expect(hasSystemTags(tag('ide_context', 'context data'))).toBe(true);
    });

    it('should detect gitStatus tag', () => {
      expect(hasSystemTags(tag('gitStatus', 'M file.ts'))).toBe(true);
    });

    it('should detect command-name tag', () => {
      expect(hasSystemTags(tag('command-name', 'build'))).toBe(true);
    });

    it('should detect claudeMd tag', () => {
      expect(hasSystemTags(tag('claudeMd', 'instructions here'))).toBe(true);
    });
  });

  describe('antml:* namespaced tags', () => {
    it('should detect antml:invoke tag', () => {
      expect(hasSystemTags(antmlOpen('invoke name="tool"'))).toBe(true);
    });

    it('should detect antml:function_calls tag', () => {
      expect(hasSystemTags(antmlOpen('function_calls'))).toBe(true);
    });

    it('should detect antml:parameter tag', () => {
      expect(hasSystemTags(antmlTag('parameter', 'value'))).toBe(true);
    });
  });

  describe('returns false for non-system content', () => {
    it('should return false for plain text', () => {
      expect(hasSystemTags('Hello, how are you?')).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(hasSystemTags('')).toBe(false);
    });

    it('should return false for regular HTML tags like <div>', () => {
      expect(hasSystemTags('<div>content</div>')).toBe(false);
    });

    it('should return false for <span> tags', () => {
      expect(hasSystemTags('<span class="bold">text</span>')).toBe(false);
    });

    it('should return false for <p> tags', () => {
      expect(hasSystemTags('<p>paragraph</p>')).toBe(false);
    });

    it('should return false for text that contains tag name substrings', () => {
      expect(hasSystemTags('system-reminder is a tag name')).toBe(false);
    });

    it('should return false for text with angle brackets but no matching tags', () => {
      expect(hasSystemTags('x < y and y > z')).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should detect tag embedded in other text', () => {
      expect(hasSystemTags('before ' + tag('gitStatus', 'status') + ' after')).toBe(true);
    });

    it('should detect opening tag only (no closing tag)', () => {
      expect(hasSystemTags(openTag('system-reminder'))).toBe(true);
    });
  });
});

describe('stripSystemTags', () => {
  describe('strips paired tags', () => {
    it('should strip a single paired system-reminder tag', () => {
      const input = tag('system-reminder', 'You are an AI assistant');
      expect(stripSystemTags(input)).toBe('');
    });

    it('should strip paired ide_opened_file tag', () => {
      const input = tag('ide_opened_file', '/src/index.ts');
      expect(stripSystemTags(input)).toBe('');
    });

    it('should strip paired gitStatus tag', () => {
      const input = tag('gitStatus', 'M src/app.ts\n?? new-file.ts');
      expect(stripSystemTags(input)).toBe('');
    });

    it('should strip paired claudeMd tag', () => {
      const input = tag('claudeMd', '# Project\nSome instructions');
      expect(stripSystemTags(input)).toBe('');
    });

    it('should strip paired antml:* tags', () => {
      const input = antmlTag('function_calls', 'call data');
      expect(stripSystemTags(input)).toBe('');
    });
  });

  describe('strips orphaned/truncated opening tags', () => {
    it('should strip an orphaned opening tag with trailing content', () => {
      const input = openTag('ide_opened_file') + 'The user opened a file...';
      expect(stripSystemTags(input)).toBe('');
    });

    it('should strip an orphaned system-reminder at the end', () => {
      const input = 'User question here ' + openTag('system-reminder') + 'injected context';
      expect(stripSystemTags(input)).toBe('User question here');
    });

    it('should strip orphaned antml: tag', () => {
      const input = 'Hello ' + antmlOpen('invoke') + 'leftover data';
      expect(stripSystemTags(input)).toBe('Hello');
    });
  });

  describe('preserves user text', () => {
    it('should preserve plain user text with no tags', () => {
      expect(stripSystemTags('Fix the login bug')).toBe('Fix the login bug');
    });

    it('should preserve user text around stripped tags', () => {
      const input = 'Fix the bug ' + tag('system-reminder', 'context') + ' in the login form';
      expect(stripSystemTags(input)).toBe('Fix the bug  in the login form');
    });

    it('should preserve regular HTML tags', () => {
      expect(stripSystemTags('<div>hello</div>')).toBe('<div>hello</div>');
    });

    it('should not strip unknown tag names', () => {
      expect(stripSystemTags('<custom>data</custom>')).toBe('<custom>data</custom>');
    });
  });

  describe('handles mixed content', () => {
    it('should strip multiple different system tags from mixed content', () => {
      const input =
        tag('system-reminder', 'Be helpful') +
        '\nFix the tests\n' +
        tag('gitStatus', 'M tests/app.test.ts');
      expect(stripSystemTags(input)).toBe('Fix the tests');
    });

    it('should handle tags interspersed with user text', () => {
      const input =
        tag('claudeMd', '# Instructions') +
        ' Refactor utils ' +
        tag('ide_context', 'file context') +
        ' and add tests';
      expect(stripSystemTags(input)).toBe('Refactor utils  and add tests');
    });

    it('should handle paired tags followed by an orphaned tag', () => {
      const input =
        tag('system-reminder', 'context') +
        ' Do the thing ' +
        openTag('ide_opened_file') +
        'leftover';
      expect(stripSystemTags(input)).toBe('Do the thing');
    });
  });

  describe('returns empty string for all-tags input', () => {
    it('should return empty when input is only system tags', () => {
      const input =
        tag('system-reminder', 'context') +
        tag('gitStatus', 'M file.ts') +
        tag('claudeMd', '# Instructions');
      expect(stripSystemTags(input)).toBe('');
    });
  });

  describe('trims whitespace', () => {
    it('should trim leading whitespace after tag removal', () => {
      const input = tag('system-reminder', 'context') + '   Hello';
      expect(stripSystemTags(input)).toBe('Hello');
    });

    it('should trim trailing whitespace after tag removal', () => {
      const input = 'Hello   ' + tag('gitStatus', 'status');
      expect(stripSystemTags(input)).toBe('Hello');
    });

    it('should trim whitespace on both sides', () => {
      const input =
        '  ' + tag('system-reminder', 'x') + '  Hello world  ' + tag('claudeMd', 'y') + '  ';
      expect(stripSystemTags(input)).toBe('Hello world');
    });

    it('should return empty string for whitespace-only after stripping', () => {
      const input = '   ' + tag('system-reminder', 'content') + '   ';
      expect(stripSystemTags(input)).toBe('');
    });
  });

  describe('edge cases', () => {
    it('should handle empty string', () => {
      expect(stripSystemTags('')).toBe('');
    });

    it('should handle multiline content inside tags', () => {
      const input = tag('system-reminder', 'line1\nline2\nline3\n');
      expect(stripSystemTags(input)).toBe('');
    });

    it('should handle nested-looking content inside tags', () => {
      const input = tag('system-reminder', 'Some <b>bold</b> text inside');
      expect(stripSystemTags(input)).toBe('');
    });
  });
});

describe('extractSessionTitle', () => {
  it('should extract a clean title from tagged text', () => {
    const input = tag('system-reminder', 'You are helpful') + ' Fix the authentication bug';
    expect(extractSessionTitle(input)).toBe('Fix the authentication bug');
  });

  it('should extract title from text with multiple system tags', () => {
    const input =
      tag('claudeMd', '# Project') + ' Refactor the utils module ' + tag('gitStatus', 'M utils.ts');
    expect(extractSessionTitle(input)).toBe('Refactor the utils module');
  });

  it('should return null when input is entirely system tags', () => {
    const input = tag('system-reminder', 'Be helpful') + tag('claudeMd', '# Instructions');
    expect(extractSessionTitle(input)).toBeNull();
  });

  it('should return null for empty string', () => {
    expect(extractSessionTitle('')).toBeNull();
  });

  it('should return null for whitespace-only after stripping', () => {
    const input = '   ' + tag('system-reminder', 'content') + '   ';
    expect(extractSessionTitle(input)).toBeNull();
  });

  it('should truncate text longer than 100 characters with ellipsis', () => {
    const longText = 'A'.repeat(150);
    expect(extractSessionTitle(longText)).toBe('A'.repeat(100) + '...');
  });

  it('should truncate at exactly 100 characters boundary', () => {
    const exactly101 = 'B'.repeat(101);
    const result = extractSessionTitle(exactly101);
    expect(result).toBe('B'.repeat(100) + '...');
    expect(result!.length).toBe(103); // 100 chars + '...'
  });

  it('should return full text when exactly 100 characters', () => {
    const exactly100 = 'C'.repeat(100);
    expect(extractSessionTitle(exactly100)).toBe(exactly100);
  });

  it('should return full text when under 100 characters', () => {
    const shortText = 'Fix the login bug';
    expect(extractSessionTitle(shortText)).toBe('Fix the login bug');
  });

  it('should return full text for 99 characters', () => {
    const text99 = 'D'.repeat(99);
    expect(extractSessionTitle(text99)).toBe(text99);
  });

  it('should truncate long text remaining after tag stripping (with space)', () => {
    const longUserText = 'X'.repeat(200);
    const input = tag('system-reminder', 'context') + ' ' + longUserText;
    // After stripping the tag, trimming leaves 200 X's which exceeds 100
    expect(extractSessionTitle(input)).toBe('X'.repeat(100) + '...');
  });

  it('should truncate long text remaining after tag stripping (no space)', () => {
    const longUserText = 'Y'.repeat(200);
    const input = tag('system-reminder', 'context') + longUserText;
    const result = extractSessionTitle(input);
    expect(result).toBe('Y'.repeat(100) + '...');
  });

  it('should handle plain text with no tags', () => {
    expect(extractSessionTitle('Hello world')).toBe('Hello world');
  });

  it('should handle text with orphaned tag after user content', () => {
    const input = 'My question ' + openTag('ide_opened_file') + 'leftover';
    expect(extractSessionTitle(input)).toBe('My question');
  });
});
