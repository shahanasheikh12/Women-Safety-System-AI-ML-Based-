import React from 'react';
import { render, act } from '@testing-library/react-native';
import { useSOS } from '../hooks/useSOS';
import { supabase } from '../lib/supabase';
import * as Location from 'expo-location';

// ── Mocks ─────────────────────────────────────────────────────
jest.mock('../lib/supabase', () => ({
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

describe('useSOS Hook', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('startCountdown sets countdownActive to true', () => {
    const hookRef = { current: null as any };
    render(<TestComponent hookRef={hookRef} />);

    act(() => {
      hookRef.current.startCountdown(false, 'button');
    });

    expect(hookRef.current.countdownActive).toBe(true);
    expect(hookRef.current.countdownValue).toBe(3);
  });

  test('cancelCountdown resets countdownActive', () => {
    const hookRef = { current: null as any };
    render(<TestComponent hookRef={hookRef} />);

    act(() => {
      hookRef.current.startCountdown(false, 'button');
    });
    expect(hookRef.current.countdownActive).toBe(true);

    act(() => {
      hookRef.current.cancelCountdown();
    });
    expect(hookRef.current.countdownActive).toBe(false);
  });

  test('fireSOS inserts event to Supabase', async () => {
    const hookRef = { current: null as any };
    render(<TestComponent hookRef={hookRef} />);

    await act(async () => {
      await hookRef.current.fireSOS(false, 'button');
    });

    expect(supabase.from).toHaveBeenCalledWith('sos_events');
  });

  test('fireSOS starts location streaming interval', async () => {
    const hookRef = { current: null as any };
    render(<TestComponent hookRef={hookRef} />);

    await act(async () => {
      await hookRef.current.fireSOS(false, 'button');
    });

    // Advance timers to trigger streamOneLocation interval
    await act(async () => {
      jest.advanceTimersByTime(5000);
    });

    expect(Location.getCurrentPositionAsync).toHaveBeenCalled();
  });

  test('fireSOS calls notify-volunteers edge function', async () => {
    const hookRef = { current: null as any };
    render(<TestComponent hookRef={hookRef} />);

    await act(async () => {
      await hookRef.current.fireSOS(false, 'button');
    });

    expect(supabase.functions.invoke).toHaveBeenCalledWith('notify-volunteers', expect.any(Object));
  });

  test('resolveSOS updates Supabase status to resolved', async () => {
    const hookRef = { current: null as any };
    render(<TestComponent hookRef={hookRef} />);

    // Start SOS first to populate event ID
    await act(async () => {
      await hookRef.current.fireSOS(false, 'button');
    });

    await act(async () => {
      await hookRef.current.resolveSOS('safe');
    });

    expect(supabase.from).toHaveBeenCalledWith('sos_events');
    expect(hookRef.current.isSOSActive).toBe(false);
  });

  test('resolveSOS clears streaming interval', async () => {
    const hookRef = { current: null as any };
    render(<TestComponent hookRef={hookRef} />);

    await act(async () => {
      await hookRef.current.fireSOS(false, 'button');
    });

    await act(async () => {
      await hookRef.current.resolveSOS('safe');
    });

    jest.clearAllMocks();
    act(() => {
      jest.advanceTimersByTime(5000);
    });

    expect(Location.getCurrentPositionAsync).not.toHaveBeenCalled();
  });
});
