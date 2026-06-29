import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Dimensions,
  Platform,
  SafeAreaView,
} from 'react-native';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Colors from '../constants/Colors';

const { width, height } = Dimensions.get('window');

interface Slide {
  id: number;
  title: string;
  body: string;
  art: string;
  gradient: string[];
}

const SLIDES: Slide[] = [
  {
    id: 1,
    title: "Help shouldn't take 15 minutes",
    body: "When you're in danger, every second matters. Police arrive in 10-15 minutes. SafeCircle activates help in under 3.",
    art: "🚶‍♀️🌃🚨",
    gradient: ['#1A0B2E', '#0D0518'],
  },
  {
    id: 2,
    title: "Your circle of safety",
    body: "Verified volunteers within 2km get instantly notified when you press SOS. Real people, real help near you.",
    art: "🛡️ 👥 ⚡",
    gradient: ['#0B1B2E', '#050D18'],
  },
  {
    id: 3,
    title: "You can save lives too",
    body: "Join as a volunteer. Get notified when someone nearby needs help. Earn credits, premium badges, and make your community safe.",
    art: "🏅 💰 🤝",
    gradient: ['#0B2E1D', '#05180D'],
  },
  {
    id: 4,
    title: "Your safety, your privacy",
    body: "Your identity is protected. Emergency contacts only. Location shared only during active SOS and fully deleted after 30 days.",
    art: "🔒 🛡️ ✨",
    gradient: ['#1E1E1E', '#0D0D0D'],
  },
];

export default function OnboardingScreen() {
  const [activeIndex, setActiveIndex] = useState(0);
  const scrollViewRef = useRef<ScrollView>(null);

  // ── Web-compatible scroll handler ──────────────────────────
  const handleScroll = (event: any) => {
    const xOffset = event.nativeEvent.contentOffset.x;
    const index = Math.round(xOffset / width);
    if (index !== activeIndex && index >= 0 && index < SLIDES.length) {
      setActiveIndex(index);
    }
  };

  const goToSlide = (index: number) => {
    scrollViewRef.current?.scrollTo({ x: index * width, animated: true });
    setActiveIndex(index);
  };

  const handleNext = async () => {
    if (activeIndex < SLIDES.length - 1) {
      goToSlide(activeIndex + 1);
    } else {
      await completeOnboarding();
    }
  };

  const handleSkip = async () => {
    await completeOnboarding();
  };

  const completeOnboarding = async () => {
    try {
      // Soft haptics fallback (web ignores)
      try {
        const Haptics = require('expo-haptics');
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      } catch (_) {}

      await AsyncStorage.setItem('has_seen_onboarding', 'true');
      router.replace('/(auth)/login');
    } catch (err) {
      console.error('Failed to save onboarding flag:', err);
      router.replace('/(auth)/login');
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Skip Button — shown on all slides except last */}
      {activeIndex < SLIDES.length - 1 && (
        <TouchableOpacity style={styles.skipButton} onPress={handleSkip}>
          <Text style={styles.skipText}>Skip</Text>
        </TouchableOpacity>
      )}

      {/* Slide Carousel */}
      <ScrollView
        ref={scrollViewRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        style={styles.carousel}
        // Web fix: use onMomentumScrollEnd for more reliable index tracking
        onMomentumScrollEnd={handleScroll}
      >
        {SLIDES.map((slide) => (
          <View key={slide.id} style={[styles.slide, { backgroundColor: slide.gradient[1] }]}>
            {/* Visual Art */}
            <View style={styles.artContainer}>
              <Text style={styles.artText}>{slide.art}</Text>
            </View>

            {/* Tier Badges on Slide 2 */}
            {slide.id === 2 && (
              <View style={styles.badgeRow}>
                <View style={[styles.miniBadge, { borderColor: '#E74C3C' }]}>
                  <Text style={styles.miniBadgeText}>🛡️ Shield Tier</Text>
                </View>
                <View style={[styles.miniBadge, { borderColor: '#3498DB' }]}>
                  <Text style={styles.miniBadgeText}>⚡ Fast Responder</Text>
                </View>
                <View style={[styles.miniBadge, { borderColor: '#2ECC71' }]}>
                  <Text style={styles.miniBadgeText}>⭐ Top Rated</Text>
                </View>
              </View>
            )}

            {/* Content Card */}
            <View style={styles.card}>
              <Text style={styles.title}>{slide.title}</Text>
              <Text style={styles.body}>{slide.body}</Text>
            </View>
          </View>
        ))}
      </ScrollView>

      {/* Footer */}
      <View style={styles.footer}>
        {/* Page dots — tappable for web */}
        <View style={styles.dotsRow}>
          {SLIDES.map((_, idx) => (
            <TouchableOpacity key={idx} onPress={() => goToSlide(idx)}>
              <View
                style={[
                  styles.dot,
                  activeIndex === idx ? styles.activeDot : styles.inactiveDot,
                ]}
              />
            </TouchableOpacity>
          ))}
        </View>

        {/* Next / Get Started button */}
        <TouchableOpacity
          style={[
            styles.actionButton,
            activeIndex === SLIDES.length - 1 ? styles.startBtn : styles.nextBtn,
          ]}
          onPress={handleNext}
        >
          <Text style={styles.actionBtnText}>
            {activeIndex === SLIDES.length - 1 ? '🚀 Get Started' : 'Next →'}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0D0D0D',
  },
  skipButton: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 60 : 30,
    right: 24,
    zIndex: 99,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  skipText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '600',
  },
  carousel: {
    flex: 1,
  },
  slide: {
    width: width,
    height: height,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  artContainer: {
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 40,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  artText: {
    fontSize: 72,
    textAlign: 'center',
  },
  badgeRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 20,
    justifyContent: 'center',
    flexWrap: 'wrap',
  },
  miniBadge: {
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 4,
    paddingHorizontal: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  miniBadgeText: {
    color: '#FFF',
    fontSize: 11,
    fontWeight: '700',
  },
  card: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    padding: 24,
    width: '100%',
    maxWidth: 380,
    alignItems: 'center',
  },
  title: {
    color: '#FFF',
    fontSize: 22,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 16,
  },
  body: {
    color: '#94A3B8',
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
  },
  footer: {
    position: 'absolute',
    bottom: Platform.OS === 'ios' ? 50 : 30,
    left: 24,
    right: 24,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    zIndex: 99,
  },
  dotsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  dot: {
    height: 8,
    borderRadius: 4,
  },
  activeDot: {
    width: 24,
    backgroundColor: Colors.primary,
  },
  inactiveDot: {
    width: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
  },
  actionButton: {
    borderRadius: 24,
    paddingVertical: 14,
    paddingHorizontal: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nextBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  startBtn: {
    backgroundColor: Colors.primary,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 6,
  },
  actionBtnText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '700',
  },
});
