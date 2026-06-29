import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { SOSButton } from '../../components/SOSButton';

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(),
  ImpactFeedbackStyle: {
    Heavy: 'heavy',
    Medium: 'medium',
  },
}));

describe('SOSButton Component', () => {
  test('renders correctly', () => {
    const mockOnPress = jest.fn();
    const mockOnLongPress = jest.fn();

    const { getByText } = render(
      <SOSButton onPress={mockOnPress} onLongPress={mockOnLongPress} disabled={false} />
    );

    expect(getByText('SOS')).toBeTruthy();
  });

  test('onPress triggers startCountdown', () => {
    const mockOnPress = jest.fn();
    const mockOnLongPress = jest.fn();

    const { getByText } = render(
      <SOSButton onPress={mockOnPress} onLongPress={mockOnLongPress} disabled={false} />
    );

    const button = getByText('SOS');
    fireEvent.press(button);

    expect(mockOnPress).toHaveBeenCalledTimes(1);
  });

  test('long press triggers silent SOS mode', () => {
    const mockOnPress = jest.fn();
    const mockOnLongPress = jest.fn();

    const { getByText } = render(
      <SOSButton onPress={mockOnPress} onLongPress={mockOnLongPress} disabled={false} />
    );

    const button = getByText('SOS');
    fireEvent(button, 'longPress');

    expect(mockOnLongPress).toHaveBeenCalledTimes(1);
  });

  test('disabled state shows styling and prevents press', () => {
    const mockOnPress = jest.fn();
    const mockOnLongPress = jest.fn();

    const { getByText } = render(
      <SOSButton onPress={mockOnPress} onLongPress={mockOnLongPress} disabled={true} />
    );

    const button = getByText('SOS');
    fireEvent.press(button);

    expect(mockOnPress).not.toHaveBeenCalled();
  });
});
