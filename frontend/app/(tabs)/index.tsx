import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { TextInput, Button, Card, Title, Divider } from 'react-native-paper';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useForm, Controller } from 'react-hook-form';
import NetInfo from '@react-native-community/netinfo';
import { getShopsLocal, saveInvoiceLocal, enqueue, getDefaultQr } from '../../src/storage/local';
import { Api } from '../../src/storage/api';
import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import type { ShopDetails } from '../../src/storage/types';

interface ProductItem {
  name: string;
  quantity: number;
  unit_rate: number;
  discount_percentage: number;
  gst_rate: number;
}

interface CustomerDetails {
  name: string;
  mobile: string;
  address?: string;
  state?: string;
}

interface InvoiceForm {
  customer_name: string;
  customer_mobile: string;
  customer_address: string;
  customer_state: string;
}

export default function CreateInvoice() {
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [qrCodeImage, setQrCodeImage] = useState<string | null>(null);
  const [shopDetails, setShopDetails] = useState<ShopDetails | null>(null);
  const [loading, setLoading] = useState(false);

  const { control, handleSubmit, reset } = useForm<InvoiceForm>();

  // GST rate options
  const gstRates = [5, 12, 18, 28];

  useEffect(() => {
    loadShopDetails();
    ensureDefaultQrLoaded();
  }, []);

  // Ensure shop details refresh when returning to this tab
  useFocusEffect(
    useCallback(() => {
      loadShopDetails();
      ensureDefaultQrLoaded();
    }, [])
  );

  const loadShopDetails = async () => {
    try {
      // Local first
      const local = await getShopsLocal();
      if (local.length > 0) setShopDetails(local[0]);

      // Remote best-effort
      try {
        const shops = await Api.getShops();
        if (shops.length > 0) setShopDetails(shops[0]);
      } catch {}
    } catch (error) {
      console.error('Error loading shop details:', error);
    }
  };

  const ensureDefaultQrLoaded = async () => {
    try {
      if (!qrCodeImage) {
        const def = await getDefaultQr();
        if (def) setQrCodeImage(def);
      }
    } catch {}
  };

  const numberToWordsIndian = (num: number) => {
    const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
    const teens = ['Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
    const convertHundreds = (n: number): string => {
      let r = '';
      if (n >= 100) {
        r += ones[Math.floor(n / 100)] + ' Hundred ';
        n %= 100;
      }
      if (n >= 20) {
        r += tens[Math.floor(n / 10)] + ' ';
        n %= 10;
      } else if (n >= 10) {
        r += teens[n - 10] + ' ';
        n = 0;
      }
      if (n > 0) r += ones[n] + ' ';
      return r.trim();
    };
    const n = Math.max(0, Math.floor(num));
    if (n === 0) return 'Zero Rupees Only';
    if (n < 1000) return convertHundreds(n) + ' Rupees Only';
    if (n < 100000) {
      const thousands = Math.floor(n / 1000);
      const remainder = n % 1000;
      return (convertHundreds(thousands) + ' Thousand ' + (remainder ? convertHundreds(remainder) : '')).trim() + ' Rupees Only';
    }
    const lakhs = Math.floor(n / 100000);
    let remainder = n % 100000;
    let res = convertHundreds(lakhs) + ' Lakh ';
    if (remainder >= 1000) {
      const thousands = Math.floor(remainder / 1000);
      res += convertHundreds(thousands) + ' Thousand ';
      remainder %= 1000;
    }
    if (remainder > 0) res += convertHundreds(remainder) + ' ';
    return res.trim() + ' Rupees Only';
  };

  const addProduct = () => {
    setProducts([
      ...products,
      {
        name: '',
        quantity: 1,
        unit_rate: 0,
        discount_percentage: 0,
        gst_rate: 18,
      },
    ]);
  };

  const updateProduct = (index: number, field: keyof ProductItem, value: any) => {
    const updatedProducts = [...products];
    updatedProducts[index] = { ...updatedProducts[index], [field]: value };
    setProducts(updatedProducts);
  };

  const removeProduct = (index: number) => {
    setProducts(products.filter((_, i) => i !== index));
  };

  const pickQRCode = async () => {
    const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
    
    if (permissionResult.granted === false) {
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

    if (!result.canceled && result.assets[0]) {
      setQrCodeImage(`data:image/jpeg;base64,${result.assets[0].base64}`);
    }
  };

  const takeQRCodePhoto = async () => {
    const permissionResult = await ImagePicker.requestCameraPermissionsAsync();
    
    if (permissionResult.granted === false) {
      Alert.alert('Permission Required', 'Camera permission is required!');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
      base64: true,
    });

    if (!result.canceled && result.assets[0]) {
      setQrCodeImage(`data:image/jpeg;base64,${result.assets[0].base64}`);
    }
  };

  const calculateTotals = () => {
    let totalTaxableValue = 0;
    let totalCGST = 0;
    let totalSGST = 0;

    products.forEach((product) => {
      const discountAmount = (product.quantity * product.unit_rate * product.discount_percentage) / 100;
      const taxableValue = (product.quantity * product.unit_rate) - discountAmount;
      
      const cgstRate = product.gst_rate / 2;
      const sgstRate = product.gst_rate / 2;
      
      const cgstAmount = (taxableValue * cgstRate) / 100;
      const sgstAmount = (taxableValue * sgstRate) / 100;
      
      totalTaxableValue += taxableValue;
      totalCGST += cgstAmount;
      totalSGST += sgstAmount;
    });

    const totalTax = totalCGST + totalSGST;
    const grossTotal = totalTaxableValue + totalTax;
    const finalAmount = Math.round(grossTotal);
    const roundOff = finalAmount - grossTotal;

    return {
      totalTaxableValue: totalTaxableValue.toFixed(2),
      totalCGST: totalCGST.toFixed(2),
      totalSGST: totalSGST.toFixed(2),
      totalTax: totalTax.toFixed(2),
      roundOff: roundOff.toFixed(2),
      finalAmount,
    };
  };

  const onSubmit = async (data: InvoiceForm) => {
    if (!shopDetails) {
      Alert.alert('Error', 'Please set up shop details in Settings first');
      return;
    }

    if (products.length === 0) {
      Alert.alert('Error', 'Please add at least one product');
      return;
    }

    // Validate products
    const invalidProduct = products.find(p => !p.name || p.quantity <= 0 || p.unit_rate <= 0);
    if (invalidProduct) {
      Alert.alert('Error', 'Please fill in all product details correctly');
      return;
    }

    setLoading(true);

    try {
      const t = calculateTotals();
      const invoiceData = {
        shop_details: shopDetails,
        customer_details: {
          name: data.customer_name,
          mobile: data.customer_mobile,
          address: data.customer_address,
          state: data.customer_state,
        },
        products: products,
        reverse_charge: false,
        qr_code_base64: qrCodeImage,
        total_taxable_value: parseFloat(t.totalTaxableValue),
        total_cgst: parseFloat(t.totalCGST),
        total_sgst: parseFloat(t.totalSGST),
        total_tax: parseFloat(t.totalTax),
        round_off: parseFloat(t.roundOff),
        final_amount: t.finalAmount,
        amount_in_words: numberToWordsIndian(t.finalAmount),
      } as const;

      // Save locally first for reliability
      const localSaved = await saveInvoiceLocal({ ...invoiceData });

      const net = await NetInfo.fetch();
      if (net.isConnected) {
        try {
          const remote = await Api.createInvoice(localSaved as any);
          // we could update local with remote id/number if different
          Alert.alert('Success', `Invoice ${remote.invoice_number || ''} created successfully!`, [
            {
              text: 'OK',
              onPress: () => {
                reset();
                setProducts([]);
                setQrCodeImage(null);
              },
            },
          ]);
        } catch (e) {
          await enqueue('invoice.create', localSaved);
          Alert.alert('Saved Offline', 'Invoice will sync when online.');
        }
      } else {
        await enqueue('invoice.create', localSaved);
        Alert.alert('Saved Offline', 'Invoice will sync when online.');
      }
    } catch (error) {
      console.error('Error creating invoice:', error);
      Alert.alert('Error', 'Failed to create invoice. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const totals = calculateTotals();

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.container}
      >
        <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
          <Card style={styles.card}>
            <Card.Content>
              <Title>Customer Details</Title>
              <Controller
                control={control}
                name="customer_name"
                rules={{ required: 'Customer name is required' }}
                render={({ field: { onChange, onBlur, value } }) => (
                  <TextInput
                    label="Customer Name *"
                    value={value}
                    onChangeText={onChange}
                    onBlur={onBlur}
                    style={styles.input}
                    mode="outlined"
                  />
                )}
              />
              
              <Controller
                control={control}
                name="customer_mobile"
                rules={{ required: 'Mobile number is required' }}
                render={({ field: { onChange, onBlur, value } }) => (
                  <TextInput
                    label="Mobile Number *"
                    value={value}
                    onChangeText={onChange}
                    onBlur={onBlur}
                    keyboardType="phone-pad"
                    style={styles.input}
                    mode="outlined"
                  />
                )}
              />
              
              <Controller
                control={control}
                name="customer_address"
                render={({ field: { onChange, onBlur, value } }) => (
                  <TextInput
                    label="Address"
                    value={value}
                    onChangeText={onChange}
                    onBlur={onBlur}
                    multiline
                    numberOfLines={3}
                    style={styles.input}
                    mode="outlined"
                  />
                )}
              />
              
              <Controller
                control={control}
                name="customer_state"
                render={({ field: { onChange, onBlur, value } }) => (
                  <TextInput
                    label="State"
                    value={value}
                    onChangeText={onChange}
                    onBlur={onBlur}
                    style={styles.input}
                    mode="outlined"
                  />
                )}
              />
            </Card.Content>
          </Card>

          <Card style={styles.card}>
            <Card.Content>
              <View style={styles.sectionHeader}>
                <Title>Products</Title>
                <TouchableOpacity onPress={addProduct} style={styles.addButton}>
                  <Ionicons name="add-circle" size={24} color="#2196F3" />
                </TouchableOpacity>
              </View>

              {products.map((product, index) => (
                <Card key={index} style={styles.productCard}>
                  <Card.Content>
                    <View style={styles.productHeader}>
                      <Text style={styles.productTitle}>Product {index + 1}</Text>
                      <TouchableOpacity
                        onPress={() => removeProduct(index)}
                        style={styles.removeButton}
                      >
                        <Ionicons name="trash" size={20} color="#F44336" />
                      </TouchableOpacity>
                    </View>

                    <TextInput
                      label="Product Name *"
                      value={product.name}
                      onChangeText={(value) => updateProduct(index, 'name', value)}
                      style={styles.input}
                      mode="outlined"
                    />

                    <View style={styles.row}>
                      <TextInput
                        label="Quantity *"
                        value={product.quantity.toString()}
                        onChangeText={(value) => updateProduct(index, 'quantity', parseInt(value) || 0)}
                        keyboardType="numeric"
                        style={[styles.input, styles.halfInput]}
                        mode="outlined"
                      />
                      <TextInput
                        label="Unit Rate *"
                        value={product.unit_rate.toString()}
                        onChangeText={(value) => updateProduct(index, 'unit_rate', parseFloat(value) || 0)}
                        keyboardType="numeric"
                        style={[styles.input, styles.halfInput]}
                        mode="outlined"
                      />
                    </View>

                    <View style={styles.row}>
                      <TextInput
                        label="Discount %"
                        value={product.discount_percentage.toString()}
                        onChangeText={(value) => updateProduct(index, 'discount_percentage', parseFloat(value) || 0)}
                        keyboardType="numeric"
                        style={[styles.input, styles.halfInput]}
                        mode="outlined"
                      />
                      <View style={[styles.halfInput, styles.gstPicker]}>
                        <Text style={styles.gstLabel}>GST Rate</Text>
                        <View style={styles.gstButtons}>
                          {gstRates.map((rate) => (
                            <TouchableOpacity
                              key={rate}
                              onPress={() => updateProduct(index, 'gst_rate', rate)}
                              style={[
                                styles.gstButton,
                                product.gst_rate === rate && styles.gstButtonActive,
                              ]}
                            >
                              <Text
                                style={[
                                  styles.gstButtonText,
                                  product.gst_rate === rate && styles.gstButtonTextActive,
                                ]}
                              >
                                {rate}%
                              </Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      </View>
                    </View>
                  </Card.Content>
                </Card>
              ))}

              {products.length === 0 && (
                <View style={styles.emptyState}>
                  <Ionicons name="cube-outline" size={48} color="#CCC" />
                  <Text style={styles.emptyText}>No products added yet</Text>
                  <Text style={styles.emptySubText}>Tap the + button to add products</Text>
                </View>
              )}
            </Card.Content>
          </Card>

          {products.length > 0 && (
            <Card style={styles.card}>
              <Card.Content>
                <Title>Invoice Summary</Title>
                <Divider style={styles.divider} />
                
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Total Taxable Value:</Text>
                  <Text style={styles.summaryValue}>₹{totals.totalTaxableValue}</Text>
                </View>
                
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>CGST:</Text>
                  <Text style={styles.summaryValue}>₹{totals.totalCGST}</Text>
                </View>
                
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>SGST:</Text>
                  <Text style={styles.summaryValue}>₹{totals.totalSGST}</Text>
                </View>
                
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Round Off:</Text>
                  <Text style={styles.summaryValue}>₹{totals.roundOff}</Text>
                </View>
                
                <Divider style={styles.divider} />
                
                <View style={styles.summaryRow}>
                  <Text style={styles.finalAmountLabel}>Final Amount:</Text>
                  <Text style={styles.finalAmountValue}>₹{totals.finalAmount}</Text>
                </View>
              </Card.Content>
            </Card>
          )}

          <Card style={styles.card}>
            <Card.Content>
              <Title>QR Code (Optional)</Title>
              
              {qrCodeImage && (
                <View style={styles.qrPreview}>
                  <Text style={styles.qrLabel}>QR Code Preview:</Text>
                  <View style={styles.qrImageContainer}>
                    <Text style={styles.qrPlaceholder}>QR Code Image Selected</Text>
                  </View>
                </View>
              )}
              
              <View style={styles.qrButtons}>
                <TouchableOpacity onPress={pickQRCode} style={styles.qrButton}>
                  <Ionicons name="images-outline" size={20} color="#2196F3" />
                  <Text style={styles.qrButtonText}>Pick from Gallery</Text>
                </TouchableOpacity>
                
                <TouchableOpacity onPress={takeQRCodePhoto} style={styles.qrButton}>
                  <Ionicons name="camera-outline" size={20} color="#2196F3" />
                  <Text style={styles.qrButtonText}>Take Photo</Text>
                </TouchableOpacity>
              </View>
              
              {qrCodeImage && (
                <TouchableOpacity
                  onPress={() => setQrCodeImage(null)}
                  style={styles.removeQrButton}
                >
                  <Ionicons name="trash-outline" size={16} color="#F44336" />
                  <Text style={styles.removeQrText}>Remove QR Code</Text>
                </TouchableOpacity>
              )}
            </Card.Content>
          </Card>

          <View style={styles.submitContainer}>
            <Button
              mode="contained"
              onPress={handleSubmit(onSubmit)}
              loading={loading}
              disabled={loading || products.length === 0}
              style={styles.submitButton}
            >
              Create Invoice
            </Button>
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
  input: {
    marginBottom: 12,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  addButton: {
    padding: 4,
  },
  productCard: {
    marginBottom: 12,
    backgroundColor: '#FAFAFA',
  },
  productHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  productTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  removeButton: {
    padding: 4,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  halfInput: {
    flex: 0.48,
  },
  gstPicker: {
    marginBottom: 12,
  },
  gstLabel: {
    fontSize: 12,
    color: '#666',
    marginBottom: 8,
  },
  gstButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  gstButton: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#DDD',
    backgroundColor: 'white',
  },
  gstButtonActive: {
    backgroundColor: '#2196F3',
    borderColor: '#2196F3',
  },
  gstButtonText: {
    fontSize: 12,
    color: '#666',
  },
  gstButtonTextActive: {
    color: 'white',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  emptyText: {
    fontSize: 16,
    color: '#666',
    marginTop: 8,
  },
  emptySubText: {
    fontSize: 14,
    color: '#999',
    marginTop: 4,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  summaryLabel: {
    fontSize: 14,
    color: '#666',
  },
  summaryValue: {
    fontSize: 14,
    fontWeight: '500',
    color: '#333',
  },
  finalAmountLabel: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
  },
  finalAmountValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#2196F3',
  },
  divider: {
    marginVertical: 8,
  },
  qrPreview: {
    marginBottom: 16,
  },
  qrLabel: {
    fontSize: 14,
    color: '#666',
    marginBottom: 8,
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
  qrButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  qrButton: {
    flex: 0.48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
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
  removeQrButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
  },
  removeQrText: {
    marginLeft: 4,
    color: '#F44336',
    fontSize: 14,
  },
  submitContainer: {
    marginTop: 16,
    marginBottom: 32,
  },
  submitButton: {
    paddingVertical: 8,
  },
});