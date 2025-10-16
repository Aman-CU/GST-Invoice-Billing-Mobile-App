import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Alert,
  RefreshControl,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Card, Searchbar } from 'react-native-paper';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system';
import * as FSLegacy from 'expo-file-system/legacy';
import NetInfo from '@react-native-community/netinfo';
import { getInvoicesLocal, deleteInvoiceLocal, enqueue, saveInvoiceLocal } from '../../src/storage/local';
import { Api } from '../../src/storage/api';
import type { Invoice as InvoiceT } from '../../src/storage/types';

type UIInvoice = Omit<
  InvoiceT,
  | 'id'
  | 'invoice_number'
  | 'final_amount'
  | 'created_at'
  | 'total_taxable_value'
  | 'total_cgst'
  | 'total_sgst'
  | 'amount_in_words'
> & {
  id: string;
  invoice_number: string;
  final_amount: number;
  created_at: string;
  total_taxable_value: number;
  total_cgst: number;
  total_sgst: number;
  amount_in_words: string;
};

const isUIInvoice = (i: InvoiceT): i is UIInvoice =>
  typeof i.id === 'string' &&
  typeof i.invoice_number === 'string' &&
  typeof i.final_amount === 'number' &&
  typeof i.created_at === 'string' &&
  typeof i.total_taxable_value === 'number' &&
  typeof i.total_cgst === 'number' &&
  typeof i.total_sgst === 'number' &&
  typeof i.amount_in_words === 'string';

export default function SavedInvoices() {
  const [invoices, setInvoices] = useState<UIInvoice[]>([]);
  const [filteredInvoices, setFilteredInvoices] = useState<UIInvoice[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const loadInvoices = async () => {
    setLoading(true);
    try {
      // 1) Local first
      const localRaw = await getInvoicesLocal();
      const local = localRaw.filter(isUIInvoice);
      setInvoices(local);
      setFilteredInvoices(local);

      // 2) Try remote
      try {
        const remoteRaw = await Api.getInvoices();
        // Persist remote copies locally for consistency
        for (const inv of remoteRaw) {
          await saveInvoiceLocal(inv);
        }
        // Reload from local so products are hydrated from invoice_items
        const mergedLocalRaw = await getInvoicesLocal();
        const mergedLocal = mergedLocalRaw.filter(isUIInvoice);
        setInvoices(mergedLocal);
        setFilteredInvoices(mergedLocal);
      } catch (e) {
        // stay with local if offline or error
      }
    } catch (error) {
      console.error('Error loading invoices:', error);
      Alert.alert('Error', 'Failed to load invoices');
    } finally {
      setLoading(false);
    }
  };

  const downloadInvoice = async (invoice: UIInvoice) => {
    try {
      const html = generateInvoiceHTML(invoice);
      const { uri } = await Print.printToFileAsync({ html });
      const fileName = `Invoice_${invoice.invoice_number || invoice.id}.pdf`;
      const FS = FileSystem as unknown as { documentDirectory?: string | null; cacheDirectory?: string | null };
      const FSL = FSLegacy as unknown as { documentDirectory?: string | null; cacheDirectory?: string | null; copyAsync: (args: { from: string; to: string }) => Promise<void> };

      let baseDir = FSL.documentDirectory ?? FS.documentDirectory ?? FSL.cacheDirectory ?? FS.cacheDirectory ?? null;

      if (!baseDir) {
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(uri, {
            mimeType: 'application/pdf',
            dialogTitle: `Share Invoice ${invoice.invoice_number}`,
            UTI: 'com.adobe.pdf',
          });
          return;
        }
        Alert.alert('Error', 'No writable directory available to save the file.');
        return;
      }

      if (!baseDir.endsWith('/')) baseDir += '/';
      const destUri = baseDir + fileName;

      await FSL.copyAsync({ from: uri, to: destUri });
      Alert.alert('Downloaded', `Saved to: ${destUri}`);
    } catch (error) {
      console.error('Error downloading invoice:', error);
      Alert.alert('Error', 'Failed to download invoice');
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadInvoices();
    setRefreshing(false);
  };

  useFocusEffect(
    useCallback(() => {
      loadInvoices();
    }, [])
  );

  const handleSearch = (query: string) => {
    setSearchQuery(query);
    if (query.trim() === '') {
      setFilteredInvoices(invoices);
    } else {
      const filtered = invoices.filter(
        (invoice) =>
          invoice.customer_details.name.toLowerCase().includes(query.toLowerCase()) ||
          invoice.customer_details.mobile.includes(query) ||
          invoice.invoice_number.toLowerCase().includes(query.toLowerCase())
      );
      setFilteredInvoices(filtered);
    }
  };

  const deleteInvoice = async (invoiceId: string, invoiceNumber: string) => {
    Alert.alert(
      'Delete Invoice',
      `Are you sure you want to delete invoice ${invoiceNumber}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              // Delete locally first for instant UX
              await deleteInvoiceLocal(invoiceId);
              setInvoices((prev) => prev.filter((i) => i.id !== invoiceId));
              setFilteredInvoices((prev) => prev.filter((i) => i.id !== invoiceId));

              const net = await NetInfo.fetch();
              if (net.isConnected) {
                try {
                  await Api.deleteInvoice(invoiceId);
                  Alert.alert('Success', 'Invoice deleted successfully');
                } catch (e) {
                  await enqueue('invoice.delete', { id: invoiceId });
                  Alert.alert('Deleted Offline', 'Will sync when online.');
                }
              } else {
                await enqueue('invoice.delete', { id: invoiceId });
                Alert.alert('Deleted Offline', 'Will sync when online.');
              }
            } catch (error) {
              console.error('Error deleting invoice:', error);
              Alert.alert('Error', 'Failed to delete invoice');
            }
          },
        },
      ]
    );
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

  const generateInvoiceHTML = (invoice: UIInvoice) => {
    const safeProducts = invoice.products || [];
    let totalQty = 0;
    let totalDiscountAmt = 0;
    let totalTaxable = 0;
    let totalCGST = 0;
    let totalSGST = 0;
    let totalOverall = 0;

    const productRows = safeProducts
      .map((product, index) => {
        const discountAmount = (product.quantity * product.unit_rate * product.discount_percentage) / 100;
        const taxableValue = (product.quantity * product.unit_rate) - discountAmount;
        const cgstAmount = (taxableValue * (product.gst_rate / 2)) / 100;
        const sgstAmount = (taxableValue * (product.gst_rate / 2)) / 100;
        const total = taxableValue + cgstAmount + sgstAmount;

        totalQty += product.quantity;
        totalDiscountAmt += discountAmount;
        totalTaxable += taxableValue;
        totalCGST += cgstAmount;
        totalSGST += sgstAmount;
        totalOverall += total;

        return `
          <tr>
            <td style="border: 1px solid #000; padding: 8px; text-align: center;">${index + 1}</td>
            <td style="border: 1px solid #000; padding: 8px;">${product.name}</td>
            <td style="border: 1px solid #000; padding: 8px; text-align: center;">${product.quantity}</td>
            <td style="border: 1px solid #000; padding: 8px; text-align: right;">₹${product.unit_rate.toFixed(2)}</td>
            <td style="border: 1px solid #000; padding: 8px; text-align: right;">${product.discount_percentage}% (₹${discountAmount.toFixed(2)})</td>
            <td style="border: 1px solid #000; padding: 8px; text-align: right;">₹${taxableValue.toFixed(2)}</td>
            <td style="border: 1px solid #000; padding: 8px; text-align: right;">${(product.gst_rate / 2).toFixed(2)}% ₹${cgstAmount.toFixed(2)}</td>
            <td style="border: 1px solid #000; padding: 8px; text-align: right;">${(product.gst_rate / 2).toFixed(2)}% ₹${sgstAmount.toFixed(2)}</td>
            <td style="border: 1px solid #000; padding: 8px; text-align: right; font-weight: bold;">₹${total.toFixed(2)}</td>
          </tr>
        `;
      })
      .join('');

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; font-size: 12px; margin: 20px; }
          .header { text-align: center; margin-bottom: 20px; }
          .shop-name { font-size: 18px; font-weight: bold; }
          .invoice-title { font-size: 16px; font-weight: bold; margin: 10px 0; }
          .details-table { width: 100%; margin-bottom: 0px; }
          .details-table td { padding: 5px; }
          .products-table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
          .products-table th, .products-table td { border: 1px solid #000; padding: 8px; text-align: left; }
          .products-table th { background-color: #f0f0f0; font-weight: bold; }
          .totals { margin-top: 20px; }
          .totals-row { display: flex; justify-content: space-between; padding: 5px 0; }
          .final-amount { font-weight: bold; font-size: 14px; }
          .qr-code { text-align: center; margin: 20px 0; }
          .footer { margin-top: 30px; }
          .signature { text-align: right; margin-top: 30px; }
          .box { border: 1px solid #000; border-radius: 6px; padding: 12px; margin: 12px 0; }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="shop-name">${invoice.shop_details.name}</div>
          <div>${invoice.shop_details.address}</div>
          <div>Phone: ${invoice.shop_details.phone || 'N/A'}</div>
          <div class="invoice-title">TAX INVOICE</div>
        </div>

        <div class="box">
        <table class="details-table">
          <tr>
            <td><strong>Invoice No:</strong> ${invoice.invoice_number}</td>
            <td><strong>Date:</strong> ${new Date(invoice.created_at).toLocaleDateString()}</td>
          </tr>
          <tr>
            <td><strong>GST No:</strong> ${invoice.shop_details.gst_number}</td>
            <td><strong>State:</strong> ${invoice.shop_details.state}</td>
          </tr>
        </table>

        <table class="details-table">
          <tr><td colspan="2"><strong>Customer Details:</strong></td></tr>
          <tr>
            <td><strong>Name:</strong> ${invoice.customer_details.name}</td>
            <td><strong>Mobile:</strong> ${invoice.customer_details.mobile}</td>
          </tr>
          ${invoice.customer_details.address ? `<tr><td colspan="2"><strong>Address:</strong> ${invoice.customer_details.address}</td></tr>` : ''}
          ${invoice.customer_details.state ? `<tr><td><strong>State:</strong> ${invoice.customer_details.state}</td><td></td></tr>` : ''}
        </table>
        </div>

        <table class="products-table">
          <thead>
            <tr>
              <th>Sr.No</th>
              <th>Product Name</th>
              <th>Qty</th>
              <th>Unit Rate</th>
              <th>Discount</th>
              <th>Taxable Value</th>
              <th>CGST</th>
              <th>SGST</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            ${productRows}
            <tr>
              <td colspan="2" style="border: 1px solid #000; padding: 8px; font-weight: bold; background-color: #f0f8ff;">Total</td>
              <td style="border: 1px solid #000; padding: 8px; text-align: center; font-weight: bold; background-color: #f0f8ff;">${totalQty}</td>
              <td style="border: 1px solid #000; padding: 8px; text-align: right; background-color: #f0f8ff;">&nbsp;</td>
              <td style="border: 1px solid #000; padding: 8px; text-align: right; font-weight: bold; background-color: #f0f8ff;">₹${totalDiscountAmt.toFixed(2)}</td>
              <td style="border: 1px solid #000; padding: 8px; text-align: right; font-weight: bold; background-color: #f0f8ff;">₹${totalTaxable.toFixed(2)}</td>
              <td style="border: 1px solid #000; padding: 8px; text-align: right; font-weight: bold; background-color: #f0f8ff;">₹${totalCGST.toFixed(2)}</td>
              <td style="border: 1px solid #000; padding: 8px; text-align: right; font-weight: bold; background-color: #f0f8ff;">₹${totalSGST.toFixed(2)}</td>
              <td style="border: 1px solid #000; padding: 8px; text-align: right; font-weight: bold; background-color: #f0f8ff;">₹${totalOverall.toFixed(2)}</td>
            </tr>
          </tbody>
        </table>
        <div class="box totals">
          <div class="totals-row">
            <span>Total Before Tax:</span>
            <span>₹${invoice.total_taxable_value.toFixed(2)}</span>
          </div>
          <div class="totals-row">
            <span>Add: CGST:</span>
            <span>₹${invoice.total_cgst.toFixed(2)}</span>
          </div>
          <div class="totals-row">
            <span>Add: SGST:</span>
            <span>₹${invoice.total_sgst.toFixed(2)}</span>
          </div>
          <div class="totals-row final-amount">
            <span>Final Amount:</span>
            <span>₹${invoice.final_amount}</span>
          </div>
          <div class="totals-row">
            <span><strong>Amount in Words:</strong></span>
            <span>${invoice.amount_in_words || numberToWordsIndian(invoice.final_amount)}</span>
          </div>
        </div>

        ${invoice.qr_code_base64 ? `
        <div class="qr-code">
          <img src="${invoice.qr_code_base64}" alt="QR Code" style="width: 100px; height: 100px;" />
        </div>
        ` : ''}

        <div class="footer">
          <p><strong>Terms and Conditions:</strong></p>
          <p>1. This is an electronically generated document.</p>
          <p>2. All disputes are subject to seller city jurisdiction.</p>
          
          <div class="signature">
            <p>For, ${invoice.shop_details.name}</p>
            <br><br>
            <p>Authorised Signatory</p>
          </div>
        </div>
      </body>
      </html>
    `;
  };

  const shareInvoice = async (invoice: UIInvoice) => {
    try {
      const html = generateInvoiceHTML(invoice);
      const { uri } = await Print.printToFileAsync({ html });
      
      const shareOptions = {
        mimeType: 'application/pdf',
        dialogTitle: `Share Invoice ${invoice.invoice_number}`,
        UTI: 'com.adobe.pdf',
      };
      
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, shareOptions);
      } else {
        Alert.alert('Error', 'Sharing is not available on this device');
      }
    } catch (error) {
      console.error('Error sharing invoice:', error);
      Alert.alert('Error', 'Failed to generate or share PDF');
    }
  };

  const printInvoice = async (invoice: UIInvoice) => {
    try {
      const html = generateInvoiceHTML(invoice);
      await Print.printAsync({ html });
    } catch (error) {
      //console.error('Error printing invoice:', error);
      //Alert.alert('Error', 'Failed to print invoice');
    }
  };

  const renderInvoiceItem = ({ item }: { item: UIInvoice }) => (
    <Card style={styles.invoiceCard}>
      <Card.Content>
        <View style={styles.cardHeader}>
          <Text style={styles.invoiceNumber}>{item.invoice_number}</Text>
          <Text style={styles.invoiceDate}>
            {new Date(item.created_at).toLocaleDateString()}
          </Text>
        </View>
        
        <Text style={styles.customerName}>{item.customer_details.name}</Text>
        <Text style={styles.customerMobile}>{item.customer_details.mobile}</Text>
        
        <View style={styles.amountRow}>
          <Text style={styles.amountLabel}>Amount:</Text>
          <Text style={styles.amount}>₹{item.final_amount}</Text>
        </View>
        
        <View style={styles.actionButtons}>
          <TouchableOpacity
            style={[styles.actionButton, styles.printButton]}
            onPress={() => printInvoice(item)}
          >
            <Ionicons name="print-outline" size={16} color="white" />
            <Text style={styles.actionButtonText}>Print</Text>
          </TouchableOpacity>
          
          <TouchableOpacity
            style={[styles.actionButton, styles.downloadButton]}
            onPress={() => downloadInvoice(item)}
          >
            <Ionicons name="download-outline" size={16} color="white" />
          </TouchableOpacity>
          
          <TouchableOpacity
            style={[styles.actionButton, styles.shareButton]}
            onPress={() => shareInvoice(item)}
          >
            <Ionicons name="share-outline" size={16} color="white" />
            <Text style={styles.actionButtonText}>Share</Text>
          </TouchableOpacity>
          
          <TouchableOpacity
            style={[styles.actionButton, styles.deleteButton]}
            onPress={() => deleteInvoice(item.id, item.invoice_number)}
          >
            <Ionicons name="trash-outline" size={16} color="white" />
            <Text style={styles.actionButtonText}>Delete</Text>
          </TouchableOpacity>
        </View>
      </Card.Content>
    </Card>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.searchContainer}>
        <Searchbar
          placeholder="Search invoices..."
          onChangeText={handleSearch}
          value={searchQuery}
          style={styles.searchbar}
        />
      </View>

      {loading && invoices.length === 0 ? (
        <View style={styles.centerContainer}>
          <Text style={styles.loadingText}>Loading invoices...</Text>
        </View>
      ) : filteredInvoices.length === 0 ? (
        <View style={styles.centerContainer}>
          <Ionicons name="document-outline" size={64} color="#CCC" />
          <Text style={styles.emptyText}>
            {searchQuery ? 'No invoices found' : 'No invoices created yet'}
          </Text>
          <Text style={styles.emptySubText}>
            {searchQuery ? 'Try a different search term' : 'Create your first invoice in the Create tab'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={filteredInvoices}
          renderItem={renderInvoiceItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContainer}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },
  searchContainer: {
    padding: 16,
    paddingBottom: 8,
  },
  searchbar: {
    elevation: 4,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  loadingText: {
    fontSize: 16,
    color: '#666',
  },
  emptyText: {
    fontSize: 18,
    color: '#666',
    marginTop: 16,
    textAlign: 'center',
  },
  emptySubText: {
    fontSize: 14,
    color: '#999',
    marginTop: 8,
    textAlign: 'center',
  },
  listContainer: {
    padding: 16,
    paddingTop: 8,
  },
  invoiceCard: {
    marginBottom: 12,
    elevation: 4,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  invoiceNumber: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#2196F3',
  },
  invoiceDate: {
    fontSize: 14,
    color: '#666',
  },
  customerName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 4,
  },
  customerMobile: {
    fontSize: 14,
    color: '#666',
    marginBottom: 12,
  },
  amountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  amountLabel: {
    fontSize: 14,
    color: '#666',
  },
  amount: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#4CAF50',
  },
  actionButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
    marginHorizontal: 2,
  },
  printButton: {
    backgroundColor: '#4CAF50',
  },
  shareButton: {
    backgroundColor: '#2196F3',
  },
  downloadButton: {
    backgroundColor: '#6C63FF',
  },
  deleteButton: {
    backgroundColor: '#F44336',
  },
  actionButtonText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '500',
    marginLeft: 4,
  },
});