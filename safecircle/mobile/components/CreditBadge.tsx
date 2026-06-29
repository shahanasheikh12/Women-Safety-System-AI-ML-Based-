import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Colors from '../constants/Colors';

export type BadgeType =
  | 'Quick Responder'
  | 'Community Hero'
  | 'Silver Shield'
  | 'Gold Champion'
  | 'Recruiter'
  | 'Night Guardian'
  | 'Consistent Protector';

export interface CreditBadgeProps {
  badge: BadgeType;
  earned: boolean;
  progress?: number;
  total?: number;
  size?: 'sm' | 'md' | 'lg';
}

interface BadgeConfig {
  icon: string;
  color: string;
  description: string;
}

const BADGE_CONFIGS: Record<BadgeType, BadgeConfig> = {
  'Quick Responder': {
    icon: '⚡',
    color: '#E74C3C',
    description: 'Accept SOS within 2 min',
  },
  'Community Hero': {
    icon: '🏅',
    color: '#2ECC71',
    description: 'Successful assist',
  },
  'Silver Shield': {
    icon: '🥈',
    color: '#BDC3C7',
    description: '5 successful assists',
  },
  'Gold Champion': {
    icon: '🏆',
    color: '#F1C40F',
    description: '20 successful assists',
  },
  'Recruiter': {
    icon: '🤝',
    color: '#9B59B6',
    description: 'Referred a volunteer',
  },
  'Night Guardian': {
    icon: '🌙',
    color: '#34495E',
    description: '10 night assists',
  },
  'Consistent Protector': {
    icon: '🛡️',
    color: '#3498DB',
    description: '30-day activity streak',
  },
};

export const CreditBadge = React.memo(function CreditBadge({
  badge,
  earned,
  progress = 0,
  total = 1,
  size = 'md',
}: CreditBadgeProps) {
  const config = BADGE_CONFIGS[badge] || { icon: '🛡️', color: '#888', description: '' };

  const isSm = size === 'sm';
  const isLg = size === 'lg';

  // Calculate dimensions based on size
  const cardWidth = isSm ? 70 : isLg ? 110 : 90;
  const iconSize = isSm ? 24 : isLg ? 40 : 32;

  // Calculate progress percentage
  const pct = Math.min(100, Math.max(0, (progress / total) * 100));

  return (
    <View
      style={[
        styles.card,
        { width: cardWidth },
        earned ? styles.cardEarned : styles.cardLocked,
        isSm && styles.cardSm,
      ]}
    >
      {/* Icon Wrapper */}
      <View
        style={[
          styles.iconContainer,
          {
            width: iconSize * 1.5,
            height: iconSize * 1.5,
            borderRadius: (iconSize * 1.5) / 2,
          },
          earned
            ? { backgroundColor: config.color + '20', borderColor: config.color }
            : styles.iconContainerLocked,
        ]}
      >
        <Text
          style={[
            styles.icon,
            { fontSize: iconSize },
            !earned && styles.grayscale,
          ]}
        >
          {config.icon}
        </Text>
      </View>

      {/* Badge Name */}
      {!isSm && (
        <Text
          numberOfLines={2}
          style={[styles.name, earned ? styles.nameEarned : styles.nameLocked]}
        >
          {badge}
        </Text>
      )}

      {/* Progress or Description */}
      {!earned && progress !== undefined && total !== undefined && total > 0 && (
        <View style={styles.progressContainer}>
          <Text style={styles.progressText}>
            {progress}/{total}
          </Text>
          <View style={styles.progressBarBg}>
            <View style={[styles.progressBarFill, { width: `${pct}%`, backgroundColor: config.color }]} />
          </View>
        </View>
      )}

      {earned && isLg && (
        <Text style={styles.descText}>{config.description}</Text>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#1C1C24',
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardSm: {
    paddingVertical: 6,
    paddingHorizontal: 4,
    borderRadius: 8,
  },
  cardEarned: {
    borderColor: '#EF9F27',
    shadowColor: '#EF9F27',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
  },
  cardLocked: {
    borderColor: '#2A2A35',
    opacity: 0.6,
  },
  iconContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    marginBottom: 8,
  },
  iconContainerLocked: {
    backgroundColor: '#2A2A35',
    borderColor: '#444',
  },
  icon: {
    textAlign: 'center',
  },
  grayscale: {
    opacity: 0.5,
  },
  name: {
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 14,
    height: 28,
  },
  nameEarned: {
    color: '#FFF',
  },
  nameLocked: {
    color: '#888',
  },
  progressContainer: {
    width: '100%',
    alignItems: 'center',
    marginTop: 6,
  },
  progressText: {
    fontSize: 9,
    fontWeight: 'bold',
    color: '#888',
    marginBottom: 3,
  },
  progressBarBg: {
    width: '90%',
    height: 4,
    backgroundColor: '#2A2A35',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 2,
  },
  descText: {
    fontSize: 9,
    color: '#EF9F27',
    textAlign: 'center',
    marginTop: 4,
    fontWeight: '500',
  },
});

export default CreditBadge;
