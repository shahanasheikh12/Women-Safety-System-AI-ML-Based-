import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  SafeAreaView,
  StatusBar,
  LayoutAnimation,
  Platform,
} from 'react-native';
import { router } from 'expo-router';
import { supabase } from '../lib/supabase';
import Colors from '../constants/Colors';

interface Transaction {
  id: string;
  amount: number;
  reason: string;
  created_at: string;
}

interface GroupedTransactions {
  day: string;
  data: Transaction[];
}

export default function CreditsHistoryScreen() {
  const [balance, setBalance] = useState<number>(0);
  const [allTransactions, setAllTransactions] = useState<Transaction[]>([]);
  const [filteredTransactions, setFilteredTransactions] = useState<GroupedTransactions[]>([]);
  const [activeTab, setActiveTab] = useState<'all' | 'earned' | 'spent' | 'bonuses'>('all');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Summary Stats
  const [totalEarned, setTotalEarned] = useState(0);
  const [totalSpent, setTotalSpent] = useState(0);

  // FAQ state
  const [faqExpanded, setFaqExpanded] = useState<Record<string, boolean>>({});

  const toggleFaq = (key: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setFaqExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const fetchCreditData = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // 1. Fetch current balance
      const { data: userData, error: userErr } = await supabase
        .from('users')
        .select('credits')
        .eq('id', user.id)
        .single();

      if (userErr) throw userErr;
      setBalance(userData?.credits ?? 0);

      // 2. Fetch transactions
      const { data: txData, error: txErr } = await supabase
        .from('credit_transactions')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (txErr) throw txErr;

      const txs = (txData ?? []) as Transaction[];
      setAllTransactions(txs);

      // Calculate summaries
      let earnedSum = 0;
      let spentSum = 0;
      txs.forEach((t) => {
        if (t.amount > 0) earnedSum += t.amount;
        else spentSum += Math.abs(t.amount);
      });
      setTotalEarned(earnedSum);
      setTotalSpent(spentSum);
    } catch (err) {
      console.error('[CreditsHistory] fetchCreditData error:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchCreditData();
  }, [fetchCreditData]);

  // Apply tab filters and group transactions by day
  useEffect(() => {
    let list = [...allTransactions];

    if (activeTab === 'earned') {
      list = list.filter((t) => t.amount > 0);
    } else if (activeTab === 'spent') {
      list = list.filter((t) => t.amount < 0);
    } else if (activeTab === 'bonuses') {
      list = list.filter(
        (t) =>
          t.amount > 0 &&
          (t.reason.toLowerCase().includes('badge') ||
            t.reason.toLowerCase().includes('bonus') ||
            t.reason.toLowerCase().includes('welcome') ||
            t.reason.toLowerCase().includes('referral') ||
            t.reason.toLowerCase().includes('referred'))
      );
    }

    // Group by day
    const groups: Record<string, Transaction[]> = {};
    list.forEach((tx) => {
      const date = new Date(tx.created_at);
      let dayKey = '';
      const today = new Date();
      const yesterday = new Date();
      yesterday.setDate(today.getDate() - 1);

      if (date.toDateString() === today.toDateString()) {
        dayKey = 'Today';
      } else if (date.toDateString() === yesterday.toDateString()) {
        dayKey = 'Yesterday';
      } else {
        dayKey = date.toLocaleDateString('en-IN', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        });
      }

      if (!groups[dayKey]) groups[dayKey] = [];
      groups[dayKey].push(tx);
    });

    const grouped = Object.keys(groups).map((day) => ({
      day,
      data: groups[day],
    }));

    setFilteredTransactions(grouped);
  }, [allTransactions, activeTab]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchCreditData();
  };

  const getTransactionIcon = (reason: string, amount: number) => {
    const r = reason.toLowerCase();
    if (r.includes('badge') || r.includes('gold') || r.includes('silver')) return '🏆';
    if (r.includes('welcome') || r.includes('bonus')) return '🎁';
    if (r.includes('referred') || r.includes('referral')) return '🤝';
    if (r.includes('false report') || r.includes('penalty')) return '⚠️';
    if (amount > 0) return '⚡'; // assist completion
    return '🪙';
  };

  const formatTime = (isoString: string) => {
    return new Date(isoString).toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  };

  const renderTransactionItem = ({ item }: { item: Transaction }) => {
    const isPositive = item.amount > 0;
    return (
      <View style={styles.txRow}>
        <View style={styles.txIconBg}>
          <Text style={styles.txIcon}>{getTransactionIcon(item.reason, item.amount)}</Text>
        </View>
        <View style={styles.txDetails}>
          <Text style={styles.txReason}>{item.reason}</Text>
          <Text style={styles.txTime}>{formatTime(item.created_at)}</Text>
        </View>
        <Text style={[styles.txAmount, isPositive ? styles.amountPositive : styles.amountNegative]}>
          {isPositive ? `+${item.amount}` : item.amount}
        </Text>
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#EF9F27" />
        <Text style={styles.loadingText}>Loading history...</Text>
      </View>
    );
  }

  const faqItems = [
    {
      q: 'How do I earn SafeCircle credits?',
      a: 'Credits are rewarded for safety actions: completing a volunteer assist (+50), accepting an SOS within 2 minutes (+10), verifying your Aadhaar identity (+50), and referring a verified volunteer (+30).',
    },
    {
      q: 'Can credits be lost or penalized?',
      a: 'Yes. Repeatedly triggering false alarms or reporting false emergencies will result in credit penalties (-100 credits) to ensure platform integrity.',
    },
    {
      q: 'What can I use credits for?',
      a: 'Credits increase your leaderboard rank, unlock community verified badges, and are priority-weighted so your alerts reach more helpers. Partner discounts will also be introduced soon.',
    },
  ];

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" />
      <View style={styles.container}>
        {/* Back header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Text style={styles.backButtonText}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Credits Ledger</Text>
          <View style={{ width: 60 }} />
        </View>

        {/* Large Balance Display */}
        <View style={styles.balanceContainer}>
          <Text style={styles.coinIcon}>🪙</Text>
          <Text style={styles.balanceVal}>{balance}</Text>
          <Text style={styles.balanceLabel}>Current Balance</Text>
        </View>

        {/* Summary Stats cards */}
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statVal}>+{totalEarned}</Text>
            <Text style={styles.statLabel}>Total Earned</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={[styles.statVal, { color: '#E74C3C' }]}>-{totalSpent}</Text>
            <Text style={styles.statLabel}>Total Spent</Text>
          </View>
        </View>

        {/* Filter Tabs */}
        <View style={styles.tabsRow}>
          {(['all', 'earned', 'spent', 'bonuses'] as const).map((tab) => (
            <TouchableOpacity
              key={tab}
              onPress={() => setActiveTab(tab)}
              style={[styles.tabButton, activeTab === tab && styles.tabButtonActive]}
            >
              <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Transaction History list */}
        <FlatList
          data={filteredTransactions}
          keyExtractor={(item) => item.day}
          refreshing={refreshing}
          onRefresh={onRefresh}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>No transactions found for this filter</Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={styles.dayGroup}>
              <Text style={styles.dayHeader}>{item.day}</Text>
              <FlatList
                data={item.data}
                keyExtractor={(tx) => tx.id}
                renderItem={renderTransactionItem}
                scrollEnabled={false}
              />
            </View>
          )}
          ListFooterComponent={
            <View style={styles.faqSection}>
              <Text style={styles.faqHeader}>💡 FAQ & Guidelines</Text>
              {faqItems.map((item, idx) => {
                const isOpen = !!faqExpanded[idx];
                return (
                  <View key={idx} style={styles.faqItem}>
                    <TouchableOpacity onPress={() => toggleFaq(String(idx))} style={styles.faqQ}>
                      <Text style={styles.faqQText}>{item.q}</Text>
                      <Text style={styles.faqChevron}>{isOpen ? '▼' : '►'}</Text>
                    </TouchableOpacity>
                    {isOpen && (
                      <View style={styles.faqA}>
                        <Text style={styles.faqAText}>{item.a}</Text>
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          }
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#0F0F14',
  },
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#0F0F14',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    color: '#888',
    fontSize: 14,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: '#2A2A35',
  },
  backButton: {
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  backButtonText: {
    color: '#EF9F27',
    fontSize: 14,
    fontWeight: '600',
  },
  headerTitle: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
  balanceContainer: {
    alignItems: 'center',
    paddingVertical: 24,
    backgroundColor: '#161622',
    margin: 16,
    borderRadius: 16,
    borderWidth: 0.5,
    borderColor: '#EF9F2733',
  },
  coinIcon: {
    fontSize: 36,
    marginBottom: 6,
  },
  balanceVal: {
    fontSize: 38,
    fontWeight: 'bold',
    color: '#EF9F27',
  },
  balanceLabel: {
    fontSize: 11,
    color: '#888',
    marginTop: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.05,
  },
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 12,
    marginBottom: 16,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#1C1C24',
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    borderWidth: 0.5,
    borderColor: '#2A2A35',
  },
  statVal: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#2ECC71',
  },
  statLabel: {
    fontSize: 10,
    color: '#888',
    marginTop: 2,
  },
  tabsRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    marginBottom: 12,
    gap: 8,
  },
  tabButton: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#1C1C24',
    alignItems: 'center',
    borderWidth: 0.5,
    borderColor: '#2A2A35',
  },
  tabButtonActive: {
    backgroundColor: '#EF9F2720',
    borderColor: '#EF9F27',
  },
  tabText: {
    fontSize: 11,
    color: '#888',
    fontWeight: '600',
  },
  tabTextActive: {
    color: '#EF9F27',
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingBottom: 24,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  emptyText: {
    color: '#888',
    fontSize: 13,
  },
  dayGroup: {
    marginBottom: 16,
    paddingHorizontal: 16,
  },
  dayHeader: {
    fontSize: 12,
    color: '#EF9F27',
    fontWeight: 'bold',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.05,
  },
  txRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1C1C24',
    borderRadius: 10,
    padding: 12,
    marginBottom: 6,
    borderWidth: 0.5,
    borderColor: '#2A2A35',
  },
  txIconBg: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#0F0F14',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  txIcon: {
    fontSize: 18,
  },
  txDetails: {
    flex: 1,
  },
  txReason: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FFF',
  },
  txTime: {
    fontSize: 10,
    color: '#888',
    marginTop: 2,
  },
  txAmount: {
    fontSize: 14,
    fontWeight: 'bold',
  },
  amountPositive: {
    color: '#2ECC71',
  },
  amountNegative: {
    color: '#E74C3C',
  },
  faqSection: {
    marginTop: 12,
    paddingHorizontal: 16,
    borderTopWidth: 0.5,
    borderTopColor: '#2A2A35',
    paddingTop: 24,
  },
  faqHeader: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  faqItem: {
    backgroundColor: '#1C1C24',
    borderRadius: 8,
    marginBottom: 8,
    borderWidth: 0.5,
    borderColor: '#2A2A35',
    overflow: 'hidden',
  },
  faqQ: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
  },
  faqQText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FFF',
    flex: 1,
  },
  faqChevron: {
    fontSize: 10,
    color: '#EF9F27',
    marginLeft: 8,
  },
  faqA: {
    padding: 12,
    backgroundColor: '#161620',
    borderTopWidth: 0.5,
    borderTopColor: '#2A2A35',
  },
  faqAText: {
    fontSize: 12,
    color: '#888',
    lineHeight: 18,
  },
});
