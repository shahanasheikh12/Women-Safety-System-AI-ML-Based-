import React from 'react';
import { render, act } from '@testing-library/react-native';
import { useSOS } from '../../hooks/useSOS';
import { supabase } from '../../lib/supabase';
import * as Location from 'expo-location';

// ── Mocks ─────────────────────────────────────────────────────
jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: { user: { id: 'mock-user-123' } },
        error: null,
      }),
    },
    from: jest.fn().mockReturnValue({
      insert: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({
            data: { id: 'mock-sos-event-456' },
            error: null,
          }),
        }),
      }),
      update: jest.fn().mockReturnValue({
        eq: jest.fn().mockResolvedValue({ data: null, error: null }),
      }),
    }),
    functions: {
      invoke: jest.fn().mockResolvedValue({ data: null, error: null }),
    },
  },
}));

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  getCurrentPositionAsync: jest.fn().mockResolvedValue({
    coords: {
      latitude: 12.9716,
      longitude: 77.5946,
      accuracy: 10,
    },
  }),
  Accuracy: {
    High: 4,
    Balanced: 3,
  },
}));

jest.mock('expo-av', () => ({
  Audio: {
    Sound: {
      createAsync: jest.fn().mockResolvedValue({
        sound: {
          unloadAsync: jest.fn().mockResolvedValue(null),
          stopAsync: jest.fn().mockResolvedValue(null),
        },
      }),
    },
    setAudioModeAsync: jest.fn().mockResolvedValue(null),
  },
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue('true'),
  setItem: jest.fn().mockResolvedValue(null),
}));

jest.mock('expo-router', () => ({
  router: {
    push: jest.fn(),
    replace: jest.fn(),
  },
}));

// Test helper component to expose hook values
interface TestComponentProps {
  hookRef: { current: ReturnType<typeof useSOS> | null };
}
function TestComponent({ hookRef }: TestComponentProps) {
  hookRef.current = useSOS();
  return null;
}

describe('SOS Integration Flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('Full SOS lifecycle: Countdown -> Fire -> Stream -> Resolve', async () => {
    const hookRef = { current: null as any };
    render(<TestComponent hookRef={hookRef} />);

    // 1. Start Countdown
    act(() => {
      hookRef.current.startCountdown(false, 'button');
    });
    expect(hookRef.current.countdownActive).toBe(true);
    expect(hookRef.current.isSOSActive).toBe(false);

    // 2. Advance countdown past 3 seconds
    await act(async () => {
      jest.advanceTimersByTime(3000);
    });
    expect(hookRef.current.countdownActive).toBe(false);
    expect(hookRef.current.isSOSActive).toBe(true);
    expect(hookRef.current.sosEventId).toBe('mock-sos-event-456');

    // 3. Location streaming begins
    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    expect(Location.getCurrentPositionAsync).toHaveBeenCalled();

    // 4. Resolve SOS
    await act(async () => {
      await hookRef.current.resolveSOS('safe');
    });
    expect(hookRef.current.isSOSActive).toBe(false);
    expect(hookRef.current.sosEventId).toBeNull();
  });
});
