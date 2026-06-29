import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Modal,
  TextInput,
  Alert,
  ActivityIndicator,
  Switch,
  Platform,
  Linking
} from 'react-native';
import { router } from 'expo-router';
import { GestureHandlerRootView, Swipeable } from 'react-native-gesture-handler';
import { supabase } from '../lib/supabase';
import Colors from '../constants/Colors';

interface EmergencyContact {
  id: string;
  name: string;
  phone: string;
  relationship: string;
  notify_on_sos: boolean;
}

const RELATIONSHIPS = ['Mother', 'Father', 'Sister', 'Brother', 'Friend', 'Partner', 'Other'];

export default function EmergencyContactsScreen() {
  const [contacts, setContacts] = useState<EmergencyContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  // Bottom Sheet/Modal state
  const [modalVisible, setModalVisible] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [relationship, setRelationship] = useState('Friend');
  const [showDropdown, setShowDropdown] = useState(false);
  const [saving, setSaving] = useState(false);

  // Get current user ID
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        setCurrentUserId(data.user.id);
        fetchContacts(data.user.id);
      }
    });
  }, []);

  // Fetch emergency contacts
  const fetchContacts = async (userId: string) => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('emergency_contacts')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      setContacts(data || []);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to load contacts');
    } finally {
      setLoading(false);
    }
  };

  // Toggle notify_on_sos
  const handleToggleNotify = async (contactId: string, currentValue: boolean) => {
    try {
      // Optimistic update
      setContacts((prev) =>
        prev.map((c) => (c.id === contactId ? { ...c, notify_on_sos: !currentValue } : c))
      );

      const { error } = await supabase
        .from('emergency_contacts')
        .update({ notify_on_sos: !currentValue })
        .eq('id', contactId);

      if (error) throw error;
    } catch (err: any) {
      // Revert on error
      setContacts((prev) =>
        prev.map((c) => (c.id === contactId ? { ...c, notify_on_sos: currentValue } : c))
      );
      Alert.alert('Error', err.message || 'Failed to update contact');
    }
  };

  // Validate Indian Phone Number (10 digits)
  const validatePhone = (num: string): boolean => {
    const cleaned = num.replace(/\D/g, '');
    // If it has +91 or 91 prefix, strip it for 10-digit check
    const raw = cleaned.startsWith('91') && cleaned.length > 10 ? cleaned.slice(2) : cleaned;
    return /^[6-9]\d{9}$/.test(raw);
  };

  // Format phone to E.164 (+91 followed by 10 digits)
  const formatPhone = (num: string): string => {
    const cleaned = num.replace(/\D/g, '');
    const raw = cleaned.startsWith('91') && cleaned.length > 10 ? cleaned.slice(2) : cleaned;
    return `+91${raw}`;
  };

  // Add Contact flow
  const handleAddContact = async () => {
    if (!currentUserId) return;
    if (contacts.length >= 5) {
      Alert.alert('Limit Reached', 'You can add up to 5 emergency contacts.');
      return;
    }
    if (!name.trim()) {
      Alert.alert('Error', 'Please enter a contact name.');
      return;
    }
    if (!validatePhone(phone)) {
      Alert.alert('Invalid Phone', 'Please enter a valid 10-digit Indian mobile number.');
      return;
    }

    try {
      setSaving(true);
      const formattedPhone = formatPhone(phone);

      const { data, error } = await supabase
        .from('emergency_contacts')
        .insert({
          user_id: currentUserId,
          name: name.trim(),
          phone: formattedPhone,
          relationship,
          notify_on_sos: true,
        })
        .select()
        .single();

      if (error) throw error;

      setContacts((prev) => [...prev, data]);
      setModalVisible(false);
      resetForm();
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to save contact');
    } finally {
      setSaving(false);
    }
  };

  // Delete Contact flow
  const handleDeleteContact = (contactId: string) => {
    Alert.alert(
      'Delete Contact',
      'Are you sure you want to remove this emergency contact?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              const { error } = await supabase
                .from('emergency_contacts')
                .delete()
                .eq('id', contactId);

              if (error) throw error;
              setContacts((prev) => prev.filter((c) => c.id !== contactId));
            } catch (err: any) {
              Alert.alert('Error', err.message || 'Failed to delete contact');
            }
          },
        },
      ]
    );
  };

  // Test Alert Whatsapp opening
  const handleTestAlert = (contactPhone: string, contactName: string) => {
    const testMessage = `🚨 SafeCircle Safety Test\n\nHi ${contactName}, you have been added as my emergency contact on SafeCircle women safety network.\n\nIn case of danger, a live location tracking link will be sent to you here.\n\n— SafeCircle verification`;
    const cleanedPhone = contactPhone.replace(/\+/g, '');
    const url = `whatsapp://send?phone=${cleanedPhone}&text=${encodeURIComponent(testMessage)}`;
    
    Linking.openURL(url).catch(() => {
      Linking.openURL(`sms:${contactPhone}?body=${encodeURIComponent(testMessage)}`);
    });
  };

  const resetForm = () => {
    setName('');
    setPhone('');
    setRelationship('Friend');
    setShowDropdown(false);
  };

  const renderRightActions = (contactId: string) => {
    return (
      <TouchableOpacity
        onPress={() => handleDeleteContact(contactId)}
        style={styles.deleteActionBtn}
      >
        <Text style={styles.deleteActionText}>🗑️ Delete</Text>
      </TouchableOpacity>
    );
  };

  return (
    <GestureHandlerRootView style={styles.root}>
      <View style={styles.container}>
        {/* HEADER BAR */}
        <View style={styles.headerBar}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backBtnText}>◀ Back</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Emergency Contacts</Text>
          <View style={styles.headerPlaceholder} />
        </View>

        {loading ? (
          <View style={styles.loaderContainer}>
            <ActivityIndicator size="large" color={Colors.primary} />
          </View>
        ) : (
          <View style={styles.innerContent}>
            <View style={styles.instructionsContainer}>
              <Text style={styles.instructionsHeader}>🔒 Your Safety Circle</Text>
              <Text style={styles.instructionsText}>
                Configure up to 5 trusted emergency contacts. In an active SOS event, these contacts receive real-time SMS/WhatsApp messages with your live location.
              </Text>
            </View>

            {contacts.length > 0 ? (
              <FlatList
                data={contacts}
                keyExtractor={(item) => item.id}
                contentContainerStyle={styles.listContainer}
                renderItem={({ item }) => {
                  let swipeableInstance: any = null;
                  return (
                    <Swipeable
                      ref={(ref) => { swipeableInstance = ref; }}
                      renderRightActions={() => renderRightActions(item.id)}
                      onSwipeableOpen={(direction) => {
                        if (direction === 'right') {
                          swipeableInstance?.close();
                          handleDeleteContact(item.id);
                        }
                      }}
                    >
                      <View style={styles.contactCard}>
                        <View style={styles.cardInfo}>
                          <View style={styles.avatarCircle}>
                            <Text style={styles.avatarText}>
                              {item.name.slice(0, 2).toUpperCase()}
                            </Text>
                          </View>
                          <View style={styles.metaInfo}>
                            <View style={styles.nameRow}>
                              <Text style={styles.contactName}>{item.name}</Text>
                              <View style={styles.relTag}>
                                <Text style={styles.relTagText}>{item.relationship}</Text>
                              </View>
                            </View>
                            <Text style={styles.contactPhone}>{item.phone}</Text>
                          </View>
                        </View>

                        <View style={styles.cardActions}>
                          <TouchableOpacity
                            onPress={() => handleTestAlert(item.phone, item.name)}
                            style={styles.testBtn}
                          >
                            <Text style={styles.testBtnText}>📱 TEST</Text>
                          </TouchableOpacity>

                          <View style={styles.toggleContainer}>
                            <Text style={styles.toggleLabel}>Notify</Text>
                            <Switch
                              value={item.notify_on_sos}
                              onValueChange={() => handleToggleNotify(item.id, item.notify_on_sos)}
                              trackColor={{ false: '#2C3E50', true: Colors.safe }}
                              thumbColor="#FFF"
                            />
                          </View>
                        </View>
                      </View>
                    </Swipeable>
                  );
                }}
              />
            ) : (
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyEmoji}>👥</Text>
                <Text style={styles.emptyText}>No emergency contacts added yet.</Text>
                <Text style={styles.emptySubtext}>
                  Click the plus button below to add your first responder!
                </Text>
              </View>
            )}
          </View>
        )}

        {/* ADD CONTACT FAB */}
        <TouchableOpacity
          onPress={() => setModalVisible(true)}
          style={styles.fab}
        >
          <Text style={styles.fabText}>+</Text>
        </TouchableOpacity>

        {/* ADD CONTACT SHEET / MODAL */}
        <Modal
          visible={modalVisible}
          animationType="slide"
          transparent={true}
          onRequestClose={() => setModalVisible(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <Text style={styles.modalHeader}>Add Emergency Contact</Text>

              {/* Name Input */}
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Name</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. Mom"
                  placeholderTextColor={Colors.textMuted}
                  value={name}
                  onChangeText={setName}
                  autoCapitalize="words"
                />
              </View>

              {/* Phone Input */}
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Mobile Number</Text>
                <View style={styles.phoneInputRow}>
                  <View style={styles.prefixBox}>
                    <Text style={styles.prefixText}>+91</Text>
                  </View>
                  <TextInput
                    style={[styles.input, styles.phoneInput]}
                    placeholder="10-digit number"
                    placeholderTextColor={Colors.textMuted}
                    value={phone}
                    onChangeText={setPhone}
                    keyboardType="number-pad"
                    maxLength={10}
                  />
                </View>
              </View>

              {/* Relationship Dropdown */}
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Relationship</Text>
                <TouchableOpacity
                  onPress={() => setShowDropdown(!showDropdown)}
                  style={styles.dropdownSelector}
                >
                  <Text style={styles.dropdownValue}>{relationship}</Text>
                  <Text style={styles.dropdownArrow}>▼</Text>
                </TouchableOpacity>

                {showDropdown && (
                  <View style={styles.dropdownOptions}>
                    {RELATIONSHIPS.map((rel) => (
                      <TouchableOpacity
                        key={rel}
                        onPress={() => {
                          setRelationship(rel);
                          setShowDropdown(false);
                        }}
                        style={styles.dropdownOption}
                      >
                        <Text style={styles.dropdownOptionText}>{rel}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>

              {/* Actions */}
              <View style={styles.sheetActions}>
                <TouchableOpacity
                  onPress={handleAddContact}
                  disabled={saving}
                  style={styles.saveBtn}
                >
                  {saving ? (
                    <ActivityIndicator color="#FFF" />
                  ) : (
                    <Text style={styles.saveBtnText}>Save Contact</Text>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => {
                    setModalVisible(false);
                    resetForm();
                  }}
                  style={styles.cancelBtn}
                >
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </View>
    </GestureHandlerRootView>
  );
}

// ─────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  container: {
    flex: 1,
  },
  headerBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    paddingTop: Platform.OS === 'ios' ? 44 : 10,
    paddingBottom: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderColor: '#2C3E50',
  },
  backBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  backBtnText: {
    color: Colors.accent,
    fontSize: 14,
    fontWeight: 'bold',
  },
  headerTitle: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: 'bold',
  },
  headerPlaceholder: {
    width: 50,
  },
  loaderContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  innerContent: {
    flex: 1,
    padding: 16,
  },
  instructionsContainer: {
    backgroundColor: Colors.surface,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#2C3E50',
    marginBottom: 20,
  },
  instructionsHeader: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 6,
  },
  instructionsText: {
    color: Colors.textMuted,
    fontSize: 12,
    lineHeight: 18,
  },
  listContainer: {
    paddingBottom: 80,
  },
  contactCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    padding: 14,
    borderRadius: 16,
    marginVertical: 6,
    borderWidth: 1,
    borderColor: '#2C3E50',
  },
  cardInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  avatarCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#34495E',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  avatarText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: 'bold',
  },
  metaInfo: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  contactName: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: 'bold',
    marginRight: 8,
  },
  relTag: {
    backgroundColor: '#2C3E50',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  relTagText: {
    color: Colors.accent,
    fontSize: 10,
    fontWeight: 'bold',
  },
  contactPhone: {
    color: Colors.textMuted,
    fontSize: 13,
  },
  cardActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  testBtn: {
    backgroundColor: 'rgba(39, 174, 96, 0.15)',
    borderWidth: 1.5,
    borderColor: '#27AE60',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  testBtnText: {
    color: '#27AE60',
    fontSize: 11,
    fontWeight: 'bold',
  },
  toggleContainer: {
    alignItems: 'center',
  },
  toggleLabel: {
    color: Colors.textMuted,
    fontSize: 9,
    marginBottom: 2,
    textTransform: 'uppercase',
  },
  deleteActionBtn: {
    backgroundColor: Colors.primary,
    width: 80,
    height: '84%',
    marginVertical: 6,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  deleteActionText: {
    color: '#FFF',
    fontWeight: 'bold',
    fontSize: 12,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 60,
  },
  emptyEmoji: {
    fontSize: 64,
    marginBottom: 16,
  },
  emptyText: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 6,
  },
  emptySubtext: {
    color: Colors.textMuted,
    fontSize: 13,
    textAlign: 'center',
    paddingHorizontal: 40,
  },
  fab: {
    position: 'absolute',
    bottom: 24,
    right: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 8,
  },
  fabText: {
    color: '#FFF',
    fontSize: 32,
    fontWeight: 'bold',
    marginTop: -2,
  },
  // Modal Sheet Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    borderWidth: 1,
    borderColor: '#2C3E50',
    maxHeight: '80%',
  },
  modalHeader: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 20,
    textAlign: 'center',
  },
  inputGroup: {
    marginBottom: 16,
  },
  inputLabel: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#0D0D0D',
    borderWidth: 1,
    borderColor: '#2C3E50',
    borderRadius: 12,
    color: Colors.text,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  phoneInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  prefixBox: {
    backgroundColor: '#1E272E',
    borderWidth: 1,
    borderColor: '#2C3E50',
    borderRightWidth: 0,
    borderTopLeftRadius: 12,
    borderBottomLeftRadius: 12,
    paddingHorizontal: 12,
    height: 48,
    justifyContent: 'center',
  },
  prefixText: {
    color: Colors.text,
    fontWeight: 'bold',
    fontSize: 14,
  },
  phoneInput: {
    flex: 1,
    borderTopLeftRadius: 0,
    borderBottomLeftRadius: 0,
    height: 48,
  },
  dropdownSelector: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#0D0D0D',
    borderWidth: 1,
    borderColor: '#2C3E50',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  dropdownValue: {
    color: Colors.text,
    fontSize: 15,
  },
  dropdownArrow: {
    color: Colors.textMuted,
    fontSize: 12,
  },
  dropdownOptions: {
    backgroundColor: '#1E272E',
    borderWidth: 1,
    borderColor: '#2C3E50',
    borderRadius: 12,
    marginTop: 6,
    maxHeight: 180,
    overflow: 'hidden',
  },
  dropdownOption: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#2C3E50',
  },
  dropdownOptionText: {
    color: Colors.text,
    fontSize: 14,
  },
  sheetActions: {
    marginTop: 10,
    gap: 10,
  },
  saveBtn: {
    backgroundColor: Colors.primary,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  saveBtnText: {
    color: '#FFF',
    fontWeight: 'bold',
    fontSize: 15,
  },
  cancelBtn: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  cancelBtnText: {
    color: Colors.textMuted,
    fontSize: 14,
  },
});
