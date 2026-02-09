import { timeAgo } from '../../utils/timeAgo';

describe('timeAgo', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns "just now" for less than 60 seconds ago', () => {
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now);

    const thirtySecondsAgo = new Date(now - 30 * 1000);
    expect(timeAgo(thirtySecondsAgo)).toBe('just now');
  });

  it('returns "just now" for 0 seconds ago', () => {
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now);

    const justNow = new Date(now);
    expect(timeAgo(justNow)).toBe('just now');
  });

  it('returns minutes ago for 1-59 minutes', () => {
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now);

    const oneMinuteAgo = new Date(now - 60 * 1000);
    expect(timeAgo(oneMinuteAgo)).toBe('1m ago');

    const fiveMinutesAgo = new Date(now - 5 * 60 * 1000);
    expect(timeAgo(fiveMinutesAgo)).toBe('5m ago');

    const fiftyNineMinutesAgo = new Date(now - 59 * 60 * 1000);
    expect(timeAgo(fiftyNineMinutesAgo)).toBe('59m ago');
  });

  it('returns hours ago for 1-23 hours', () => {
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now);

    const oneHourAgo = new Date(now - 60 * 60 * 1000);
    expect(timeAgo(oneHourAgo)).toBe('1h ago');

    const twelveHoursAgo = new Date(now - 12 * 60 * 60 * 1000);
    expect(timeAgo(twelveHoursAgo)).toBe('12h ago');

    const twentyThreeHoursAgo = new Date(now - 23 * 60 * 60 * 1000);
    expect(timeAgo(twentyThreeHoursAgo)).toBe('23h ago');
  });

  it('returns days ago for 24+ hours', () => {
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now);

    const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000);
    expect(timeAgo(oneDayAgo)).toBe('1d ago');

    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
    expect(timeAgo(sevenDaysAgo)).toBe('7d ago');

    const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);
    expect(timeAgo(thirtyDaysAgo)).toBe('30d ago');
  });

  it('handles boundary between "just now" and minutes', () => {
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now);

    // 59 seconds -> just now
    const fiftyNineSeconds = new Date(now - 59 * 1000);
    expect(timeAgo(fiftyNineSeconds)).toBe('just now');

    // 60 seconds -> 1m ago
    const sixtySeconds = new Date(now - 60 * 1000);
    expect(timeAgo(sixtySeconds)).toBe('1m ago');
  });
});
