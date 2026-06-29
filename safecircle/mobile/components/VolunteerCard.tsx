import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import Colors from '../constants/Colors';
import { supabase } from '../lib/supabase';

export type VolunteerStatus = 'notified' | 'accepted' | 'en_route' | 'arrived' | 'declined' | 'completed';

interface VolunteerCardProps {
  volunteerId: string;
  name: string;
  tier: number; // 1, 2, 3
  trustScore: number; // 0 to 100
  status: VolunteerStatus;
  eta: number | null; // minutes
}

export function VolunteerCard({
  volunteerId,
  name,
  tier,
  trustScore,
  status,
  eta,
}: VolunteerCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [phone, setPhone] = useState<string | null>(null);
  const [loadingPhone, setLoadingPhone] = useState(false);

  // Verification badges: 🔵 (tier 1) 🟢 (tier 2) 🥇 (tier 3)
  const getTierBadge = (t: number) => {
    switch (t) {
      case 3:
        return '🥇 Tier 3';
      case 2:
        return '🟢 Tier 2';
      case 1:
      default:
        return '🔵 Tier 1';
    }
  };

  // Convert trust score 0-100 to 1-5 stars
  const renderStars = (score: number) => {
    const starCount = Math.max(1, Math.min(5, Math.round(score / 20)));
    return '⭐'.repeat(starCount);
  };

  const getStatusTextAndColor = (s: VolunteerStatus) => {
    switch (s) {
      case 'accepted':
      case 'en_route':
        return { text: 'Coming', bg: '#2980B9', textCol: '#FFFFFF' };
      case 'arrived':
        return { text: 'Arrived', bg: Colors.safe, textCol: '#FFFFFF' };
      case 'declined':
        return { text: 'Declined', bg: '#7F8C8D', textCol: '#FFFFFF' };
      case 'completed':
        return { text: 'Completed', bg: '#27AE60', textCol: '#FFFFFF' };
      case 'notified':
      default:
        return { text: 'Notified', bg: Colors.warning, textCol: '#FFFFFF' };
    }
  };

  const statusConfig = getStatusTextAndColor(status);
  const canViewPhone = status === 'accepted' || status === 'en_route' || status === 'arrived';

  const handlePressCard = async () => {
    if (!canViewPhone) return;

    const nextExpanded = !expanded;
    setExpanded(nextExpanded);

    if (nextExpanded && !phone && !loadingPhone) {
      try {
        setLoadingPhone(true);
        const { data, error } = await supabase
          .from('users')
          .select('phone')
          .eq('id', volunteerId)
          .single();

        if (!error && data) {
          setPhone(data.phone);
        }
      } catch (err) {
        console.error('[VolunteerCard] Phone fetch failed:', err);
      } finally {
        setLoadingPhone(false);
      }
    }
  };

  return (
    <TouchableOpacity
      activeOpacity={canViewPhone ? 0.7 : 1}
      onPress={handlePressCard}
      style={[styles.card, expanded && styles.cardExpanded]}
    >
      <View style={styles.header}>
        <View style={styles.leftCol}>
          <Text style={styles.name}>{name}</Text>
          <View style={styles.badgeRow}>
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{getTierBadge(tier)}</Text>
            </View>
            <Text style={styles.stars}>{renderStars(trustScore)}</Text>
          </View>
        </View>

        <View style={styles.rightCol}>
          <View style={[styles.statusChip, { backgroundColor: statusConfig.bg }]}>
            <Text style={[styles.statusText, { color: statusConfig.textCol }]}>
              {statusConfig.text}
            </Text>
          </View>
          {eta !== null && (
            <Text style={styles.etaText}>
              🕒 {eta} min
            </Text>
          )}
        </View>
      </View>

      {expanded && canViewPhone && (
        <View style={styles.detailsContainer}>
          <View style={styles.separator} />
          {loadingPhone ? (
            <ActivityIndicator size="small" color={Colors.accent} style={styles.loader} />
          ) : (
            <View style={styles.phoneSection}>
              <Text style={styles.phoneLabel}>📞 Contact Responder:</Text>
              <Text style={styles.phoneNumber}>{phone || 'Not available'}</Text>
            </View>
          )}
        </View>
      )}
      
      {canViewPhone && !expanded && (
        <View style={styles.tapToExpandRow}>
          <Text style={styles.tapToExpandText}>▼ Tap to see contact details</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    padding: 14,
    borderRadius: 12,
    marginVertical: 6,
    borderWidth: 1,
    borderColor: '#2C3E50',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
  cardExpanded: {
    borderColor: Colors.accent,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  leftCol: {
    flex: 1,
  },
  rightCol: {
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  name: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  badge: {
    backgroundColor: '#2C3E50',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    marginRight: 8,
  },
  badgeText: {
    color: '#ECF0F1',
    fontSize: 11,
    fontWeight: '600',
  },
  stars: {
    fontSize: 12,
  },
  statusChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    marginBottom: 4,
  },
  statusText: {
    fontSize: 11,
    fontWeight: 'bold',
    textTransform: 'uppercase',
  },
  etaText: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '500',
  },
  detailsContainer: {
    marginTop: 10,
  },
  separator: {
    height: 1,
    backgroundColor: '#2C3E50',
    marginVertical: 8,
  },
  loader: {
    marginVertical: 6,
    alignSelf: 'flex-start',
  },
  phoneSection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  phoneLabel: {
    color: Colors.textMuted,
    fontSize: 13,
  },
  phoneNumber: {
    color: Colors.accent,
    fontSize: 14,
    fontWeight: 'bold',
  },
  tapToExpandRow: {
    marginTop: 8,
    alignItems: 'center',
  },
  tapToExpandText: {
    color: Colors.textMuted,
    fontSize: 10,
    fontStyle: 'italic',
  },
});

export default VolunteerCard;
