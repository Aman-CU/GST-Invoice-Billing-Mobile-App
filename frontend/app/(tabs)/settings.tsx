import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Alert,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { TextInput, Button, Card, Title, Divider } from 'react-native-paper';
import { Ionicons } from '@expo/vector-icons';
import { useForm, Controller } from 'react-hook-form';
import { getShopsLocal, saveShopLocal, enqueue, getDefaultQr, setDefaultQr, clearDefaultQr } from '../../src/storage/local';
import { Api } from '../../src/storage/api';
import type { ShopDetails } from '../../src/storage/types';
import * as ImagePicker from 'expo-image-picker';

// Uses shared ShopDetails type from src/storage/types

export default function Settings() {
  const [shopDetails, setShopDetails] = useState<ShopDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);
  const [defaultQr, setDefaultQrState] = useState<string | null>(null);

  const { control, handleSubmit, setValue, reset } = useForm<ShopDetails>();

  useEffect(() => {
    loadShopDetails();
    loadDefaultQr();
  }, []);

  const loadShopDetails = async () => {
    setLoading(true);
    try {
      // 1) Load from local first for instant UI
      const localShops = await getShopsLocal();
      if (localShops.length > 0) {
        const shop = localShops[0];
        setShopDetails(shop);
        setValue('name', shop.name);
        setValue('address', shop.address);
        setValue('gst_number', shop.gst_number);
        setValue('state', shop.state);
        setValue('phone', shop.phone || '');
      }

      // 2) Try remote and reconcile into local
      let shops: ShopDetails[] = [] as any;
      try {
        shops = await Api.getShops();
      } catch (e) {
        // Ignore remote failure, stay offline
      }
      
      if (shops.length > 0) {
        const shop = shops[0];
        setShopDetails(shop);
        
        // Update form values
        setValue('name', shop.name);
        setValue('address', shop.address);
        setValue('gst_number', shop.gst_number);
        setValue('state', shop.state);
        setValue('phone', shop.phone || '');
        // Persist to local
        await saveShopLocal(shop);
      }
    } catch (error) {
      console.error('Error loading shop details:', error);
      // Keep silent if offline and local showed data
    } finally {
      setLoading(false);
    }
  };

  const loadDefaultQr = async () => {
    try {
      const v = await getDefaultQr();
      setDefaultQrState(v);
    } catch {}
  };

  const pickDefaultQr = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission Required', 'Camera roll permission is required!');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
      base64: true,
    });
    if (!result.canceled && result.assets[0]?.base64) {
      const img = `data:image/jpeg;base64,${result.assets[0].base64}`;
      await setDefaultQr(img);
      setDefaultQrState(img);
      Alert.alert('Saved', 'Default QR code updated');
    }
  };

  const captureDefaultQr = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission Required', 'Camera permission is required!');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
      base64: true,
    });
    if (!result.canceled && result.assets[0]?.base64) {
      const img = `data:image/jpeg;base64,${result.assets[0].base64}`;
      await setDefaultQr(img);
      setDefaultQrState(img);
      Alert.alert('Saved', 'Default QR code updated');
    }
  };

  const removeDefaultQr = async () => {
    await clearDefaultQr();
    setDefaultQrState(null);
    Alert.alert('Removed', 'Default QR code cleared');
  };

  const onSubmit = async (data: ShopDetails) => {
    setSaveLoading(true);
    try {
      // Save locally first
      const savedLocal = await saveShopLocal(data);
      setShopDetails(savedLocal);

      // Try remote; if it fails, enqueue for later sync
      try {
        const savedShop = await Api.createShop(savedLocal);
        await saveShopLocal(savedShop);
        Alert.alert('Success', 'Shop details saved successfully!');
      } catch (e) {
        await enqueue('shop.upsert', savedLocal);
        Alert.alert('Saved Offline', 'Will sync when online.');
      }
    } catch (error) {
      console.error('Error saving shop details:', error);
      Alert.alert('Error', 'Failed to save shop details. Please try again.');
    } finally {
      setSaveLoading(false);
    }
  };

  const clearForm = () => {
    Alert.alert(
      'Clear Form',
      'Are you sure you want to clear all shop details?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: () => {
            reset();
            setShopDetails(null);
          },
        },
      ]
    );
  };

  const showAppInfo = () => {
    Alert.alert(
      'GST Billing App',
      'Version 1.0.0\n\nFeatures:\n• Create GST invoices\n• Multiple tax slabs (5%, 12%, 18%, 28%)\n• PDF generation and sharing\n• Offline storage\n• QR code support\n\nBuilt with React Native & Expo',
      [{ text: 'OK' }]
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.container}
      >
        <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
          <Card style={styles.card}>
            <Card.Content>
              <View style={styles.sectionHeader}>
                <Title>Shop Details</Title>
                {shopDetails && (
                  <TouchableOpacity onPress={clearForm} style={styles.clearButton}>
                    <Ionicons name="refresh-outline" size={20} color="#F44336" />
                  </TouchableOpacity>
                )}
              </View>

              {loading ? (
                <View style={styles.loadingContainer}>
                  <Text style={styles.loadingText}>Loading shop details...</Text>
                </View>
              ) : (
                <>
                  <Controller
                    control={control}
                    name="name"
                    rules={{ required: 'Shop name is required' }}
                    render={({ field: { onChange, onBlur, value } }) => (
                      <TextInput
                        label="Shop Name *"
                        value={value}
                        onChangeText={onChange}
                        onBlur={onBlur}
                        style={styles.input}
                        mode="outlined"
                        placeholder="Enter your shop name"
                      />
                    )}
                  />

                  <Controller
                    control={control}
                    name="address"
                    rules={{ required: 'Address is required' }}
                    render={({ field: { onChange, onBlur, value } }) => (
                      <TextInput
                        label="Address *"
                        value={value}
                        onChangeText={onChange}
                        onBlur={onBlur}
                        multiline
                        numberOfLines={3}
                        style={styles.input}
                        mode="outlined"
                        placeholder="Enter your shop address"
                      />
                    )}
                  />

                  <Controller
                    control={control}
                    name="gst_number"
                    rules={{ 
                      pattern: {
                        value: /^$|^[A-Z0-9]{15}$/,
                        message: 'GST must be 15 characters (A–Z, 0–9)'
                      }
                    }}
                    render={({ field: { onChange, onBlur, value } }) => (
                      <TextInput
                        label="GST Number"
                        value={value}
                        onChangeText={(text) => onChange(text.toUpperCase())}
                        onBlur={onBlur}
                        style={styles.input}
                        mode="outlined"
                        placeholder="22AAAAA0000A1Z5"
                        maxLength={15}
                      />
                    )}
                  />

                  <Controller
                    control={control}
                    name="state"
                    rules={{ required: 'State is required' }}
                    render={({ field: { onChange, onBlur, value } }) => (
                      <TextInput
                        label="State *"
                        value={value}
                        onChangeText={onChange}
                        onBlur={onBlur}
                        style={styles.input}
                        mode="outlined"
                        placeholder="Enter your state"
                      />
                    )}
                  />

                  <Controller
                    control={control}
                    name="phone"
                    render={({ field: { onChange, onBlur, value } }) => (
                      <TextInput
                        label="Phone Number"
                        value={value ?? ''}
                        onChangeText={onChange}
                        onBlur={onBlur}
                        keyboardType="phone-pad"
                        style={styles.input}
                        mode="outlined"
                        placeholder="Enter phone number (optional)"
                      />
                    )}
                  />

                  <Button
                    mode="contained"
                    onPress={handleSubmit(onSubmit)}
                    loading={saveLoading}
                    disabled={saveLoading}
                    style={styles.saveButton}
                  >
                    Save Shop Details
                  </Button>
                </>
              )}
            </Card.Content>
          </Card>

          <Card style={styles.card}>
            <Card.Content>
              <Title>Default QR Code</Title>
              <Divider style={styles.divider} />
              {defaultQr ? (
                <View style={styles.qrPreview}>
                  <Text style={styles.infoTitle}>Current QR:</Text>
                  <View style={styles.qrImageContainer}>
                    <Text style={styles.qrPlaceholder}>QR Code Image Saved</Text>
                  </View>
                </View>
              ) : (
                <Text style={styles.gstNote}>No default QR saved. You can pick or capture one.</Text>
              )}
              <View style={styles.qrButtonsRow}>
                <TouchableOpacity onPress={pickDefaultQr} style={styles.qrButton}>
                  <Ionicons name="images-outline" size={20} color="#2196F3" />
                  <Text style={styles.qrButtonText}>Pick</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={captureDefaultQr} style={styles.qrButton}>
                  <Ionicons name="camera-outline" size={20} color="#2196F3" />
                  <Text style={styles.qrButtonText}>Capture</Text>
                </TouchableOpacity>
                {defaultQr && (
                  <TouchableOpacity onPress={removeDefaultQr} style={styles.qrButton}>
                    <Ionicons name="trash-outline" size={20} color="#F44336" />
                    <Text style={styles.removeQrText}>Remove</Text>
                  </TouchableOpacity>
                )}
              </View>
            </Card.Content>
          </Card>

          <Card style={styles.card}>
            <Card.Content>
              <Title>GST Information</Title>
              <Divider style={styles.divider} />
              
              <View style={styles.infoSection}>
                <Text style={styles.infoTitle}>Supported GST Slabs:</Text>
                <View style={styles.gstRatesList}>
                  <View style={styles.gstRate}>
                    <Text style={styles.gstRateText}>5%</Text>
                    <Text style={styles.gstRateDesc}>Essential goods</Text>
                  </View>
                  <View style={styles.gstRate}>
                    <Text style={styles.gstRateText}>12%</Text>
                    <Text style={styles.gstRateDesc}>Processed foods</Text>
                  </View>
                  <View style={styles.gstRate}>
                    <Text style={styles.gstRateText}>18%</Text>
                    <Text style={styles.gstRateDesc}>Most goods & services</Text>
                  </View>
                  <View style={styles.gstRate}>
                    <Text style={styles.gstRateText}>28%</Text>
                    <Text style={styles.gstRateDesc}>Luxury items</Text>
                  </View>
                </View>
                
                <Text style={styles.gstNote}>
                  * GST is split equally between CGST and SGST
                </Text>
              </View>
            </Card.Content>
          </Card>

          <Card style={styles.card}>
            <Card.Content>
              <Title>App Features</Title>
              <Divider style={styles.divider} />
              
              <View style={styles.featuresList}>
                <View style={styles.featureItem}>
                  <Ionicons name="checkmark-circle" size={20} color="#4CAF50" />
                  <Text style={styles.featureText}>Create professional GST invoices</Text>
                </View>
                
                <View style={styles.featureItem}>
                  <Ionicons name="checkmark-circle" size={20} color="#4CAF50" />
                  <Text style={styles.featureText}>Multiple GST rates support</Text>
                </View>
                
                <View style={styles.featureItem}>
                  <Ionicons name="checkmark-circle" size={20} color="#4CAF50" />
                  <Text style={styles.featureText}>Automatic tax calculations</Text>
                </View>
                
                <View style={styles.featureItem}>
                  <Ionicons name="checkmark-circle" size={20} color="#4CAF50" />
                  <Text style={styles.featureText}>PDF generation and sharing</Text>
                </View>
                
                <View style={styles.featureItem}>
                  <Ionicons name="checkmark-circle" size={20} color="#4CAF50" />
                  <Text style={styles.featureText}>QR code integration</Text>
                </View>
                
                <View style={styles.featureItem}>
                  <Ionicons name="checkmark-circle" size={20} color="#4CAF50" />
                  <Text style={styles.featureText}>Offline storage</Text>
                </View>
                
                <View style={styles.featureItem}>
                  <Ionicons name="checkmark-circle" size={20} color="#4CAF50" />
                  <Text style={styles.featureText}>Invoice search and management</Text>
                </View>
              </View>
            </Card.Content>
          </Card>

          <Card style={styles.card}>
            <Card.Content>
              <TouchableOpacity onPress={showAppInfo} style={styles.aboutButton}>
                <Ionicons name="information-circle-outline" size={24} color="#2196F3" />
                <Text style={styles.aboutButtonText}>About App</Text>
                <Ionicons name="chevron-forward" size={20} color="#666" />
              </TouchableOpacity>
            </Card.Content>
          </Card>

          <View style={styles.footer}>
            <Text style={styles.footerText}>GST Billing App v1.0.0</Text>
            <Text style={styles.footerSubText}>Built with React Native & Expo</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },
  scrollView: {
    flex: 1,
    padding: 16,
  },
  card: {
    marginBottom: 16,
    elevation: 4,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  clearButton: {
    padding: 4,
  },
  loadingContainer: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  loadingText: {
    fontSize: 16,
    color: '#666',
  },
  input: {
    marginBottom: 12,
  },
  saveButton: {
    marginTop: 8,
    paddingVertical: 8,
  },
  divider: {
    marginVertical: 12,
  },
  infoSection: {
    marginTop: 8,
  },
  infoTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 12,
  },
  gstRatesList: {
    marginBottom: 16,
  },
  gstRate: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#F8F9FA',
    marginBottom: 6,
    borderRadius: 6,
  },
  gstRateText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#2196F3',
  },
  gstRateDesc: {
    fontSize: 14,
    color: '#666',
  },
  gstNote: {
    fontSize: 12,
    color: '#666',
    fontStyle: 'italic',
    textAlign: 'center',
  },
  featuresList: {
    marginTop: 8,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  featureText: {
    fontSize: 14,
    color: '#333',
    marginLeft: 12,
    flex: 1,
  },
  aboutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
  },
  aboutButtonText: {
    fontSize: 16,
    color: '#2196F3',
    marginLeft: 12,
    flex: 1,
  },
  qrPreview: {
    marginTop: 8,
    marginBottom: 12,
  },
  qrImageContainer: {
    height: 100,
    backgroundColor: '#F0F0F0',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#DDD',
  },
  qrPlaceholder: {
    color: '#666',
    fontSize: 14,
  },
  qrButtonsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  qrButton: {
    flex: 0.32,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2196F3',
    backgroundColor: 'white',
  },
  qrButtonText: {
    marginLeft: 8,
    color: '#2196F3',
    fontSize: 14,
  },
  removeQrText: {
    marginLeft: 8,
    color: '#F44336',
    fontSize: 14,
  },
  footer: {
    alignItems: 'center',
    paddingVertical: 24,
    marginTop: 16,
  },
  footerText: {
    fontSize: 14,
    color: '#666',
    fontWeight: '500',
  },
  footerSubText: {
    fontSize: 12,
    color: '#999',
    marginTop: 4,
  },
});