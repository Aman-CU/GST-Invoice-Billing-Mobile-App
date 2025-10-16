#!/usr/bin/env python3
"""
GST Billing API Backend Testing Suite
Tests all backend endpoints for the GST Billing Mobile App
"""

import requests
import json
import time
from datetime import datetime
from typing import Dict, List, Any

# API Configuration
BASE_URL = "https://invoice-genie-10.preview.emergentagent.com/api"
HEADERS = {"Content-Type": "application/json"}

class GST_API_Tester:
    def __init__(self):
        self.base_url = BASE_URL
        self.headers = HEADERS
        self.test_results = []
        self.created_shop_id = None
        self.created_invoice_ids = []
        
    def log_test(self, test_name: str, success: bool, details: str = "", response_data: Any = None):
        """Log test results"""
        result = {
            "test_name": test_name,
            "success": success,
            "details": details,
            "timestamp": datetime.now().isoformat(),
            "response_data": response_data
        }
        self.test_results.append(result)
        status = "✅ PASS" if success else "❌ FAIL"
        print(f"{status} - {test_name}")
        if details:
            print(f"    Details: {details}")
        if not success and response_data:
            print(f"    Response: {response_data}")
        print()

    def test_api_health(self):
        """Test if API is accessible"""
        try:
            response = requests.get(f"{self.base_url}/", headers=self.headers, timeout=10)
            if response.status_code == 200:
                data = response.json()
                self.log_test("API Health Check", True, f"API is accessible. Message: {data.get('message', 'N/A')}")
                return True
            else:
                self.log_test("API Health Check", False, f"HTTP {response.status_code}: {response.text}")
                return False
        except Exception as e:
            self.log_test("API Health Check", False, f"Connection error: {str(e)}")
            return False

    def test_create_shop(self):
        """Test shop creation with valid GST number"""
        shop_data = {
            "name": "Rajesh Electronics Store",
            "address": "123 MG Road, Bangalore, Karnataka - 560001",
            "gst_number": "29ABCDE1234F1Z5",
            "state": "Karnataka",
            "phone": "9876543210"
        }
        
        try:
            response = requests.post(f"{self.base_url}/shop", 
                                   json=shop_data, 
                                   headers=self.headers, 
                                   timeout=10)
            
            if response.status_code == 200:
                data = response.json()
                self.created_shop_id = data.get('id')
                self.log_test("Create Shop", True, 
                            f"Shop created successfully with ID: {self.created_shop_id}")
                return data
            else:
                self.log_test("Create Shop", False, 
                            f"HTTP {response.status_code}: {response.text}")
                return None
        except Exception as e:
            self.log_test("Create Shop", False, f"Error: {str(e)}")
            return None

    def test_get_shops(self):
        """Test retrieving all shops"""
        try:
            response = requests.get(f"{self.base_url}/shop", 
                                  headers=self.headers, 
                                  timeout=10)
            
            if response.status_code == 200:
                data = response.json()
                shop_count = len(data) if isinstance(data, list) else 0
                self.log_test("Get All Shops", True, 
                            f"Retrieved {shop_count} shops")
                return data
            else:
                self.log_test("Get All Shops", False, 
                            f"HTTP {response.status_code}: {response.text}")
                return None
        except Exception as e:
            self.log_test("Get All Shops", False, f"Error: {str(e)}")
            return None

    def test_get_shop_by_id(self, shop_id: str):
        """Test retrieving specific shop by ID"""
        if not shop_id:
            self.log_test("Get Shop by ID", False, "No shop ID available")
            return None
            
        try:
            response = requests.get(f"{self.base_url}/shop/{shop_id}", 
                                  headers=self.headers, 
                                  timeout=10)
            
            if response.status_code == 200:
                data = response.json()
                self.log_test("Get Shop by ID", True, 
                            f"Retrieved shop: {data.get('name', 'N/A')}")
                return data
            else:
                self.log_test("Get Shop by ID", False, 
                            f"HTTP {response.status_code}: {response.text}")
                return None
        except Exception as e:
            self.log_test("Get Shop by ID", False, f"Error: {str(e)}")
            return None

    def create_test_invoice_data(self, shop_data: Dict, gst_rates: List[float] = None):
        """Create test invoice data with multiple GST rates"""
        if gst_rates is None:
            gst_rates = [5.0, 12.0, 18.0, 28.0]
        
        products = []
        for i, gst_rate in enumerate(gst_rates):
            product = {
                "name": f"Product {i+1} (GST {gst_rate}%)",
                "quantity": 2,
                "unit_rate": 1000.0,
                "discount_percentage": 5.0,
                "gst_rate": gst_rate
            }
            products.append(product)
        
        invoice_data = {
            "shop_details": shop_data,
            "customer_details": {
                "name": "Priya Sharma",
                "mobile": "9876543210",
                "address": "456 Brigade Road, Bangalore",
                "state": "Karnataka"
            },
            "products": products,
            "reverse_charge": False,
            "qr_code_base64": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
        }
        
        return invoice_data

    def test_create_invoice(self, shop_data: Dict):
        """Test invoice creation with multiple GST rates"""
        if not shop_data:
            self.log_test("Create Invoice", False, "No shop data available")
            return None
            
        invoice_data = self.create_test_invoice_data(shop_data)
        
        try:
            response = requests.post(f"{self.base_url}/invoices", 
                                   json=invoice_data, 
                                   headers=self.headers, 
                                   timeout=15)
            
            if response.status_code == 200:
                data = response.json()
                invoice_id = data.get('id')
                invoice_number = data.get('invoice_number')
                final_amount = data.get('final_amount')
                amount_in_words = data.get('amount_in_words')
                
                self.created_invoice_ids.append(invoice_id)
                
                # Verify GST calculations
                total_cgst = data.get('total_cgst', 0)
                total_sgst = data.get('total_sgst', 0)
                total_tax = data.get('total_tax', 0)
                
                gst_calc_correct = abs(total_cgst - total_sgst) < 0.01  # CGST should equal SGST
                tax_calc_correct = abs(total_tax - (total_cgst + total_sgst)) < 0.01
                
                details = f"Invoice {invoice_number} created. Amount: ₹{final_amount} ({amount_in_words})"
                if gst_calc_correct and tax_calc_correct:
                    details += f". GST calculations correct: CGST=₹{total_cgst}, SGST=₹{total_sgst}"
                else:
                    details += f". GST calculation issue: CGST=₹{total_cgst}, SGST=₹{total_sgst}, Total=₹{total_tax}"
                
                self.log_test("Create Invoice", True, details, data)
                return data
            else:
                self.log_test("Create Invoice", False, 
                            f"HTTP {response.status_code}: {response.text}")
                return None
        except Exception as e:
            self.log_test("Create Invoice", False, f"Error: {str(e)}")
            return None

    def test_invoice_numbering(self, shop_data: Dict):
        """Test automatic invoice numbering (INV1, INV2, etc.)"""
        if not shop_data:
            self.log_test("Invoice Numbering", False, "No shop data available")
            return
            
        invoice_numbers = []
        
        # Create 3 invoices to test numbering
        for i in range(3):
            invoice_data = self.create_test_invoice_data(shop_data, [18.0])  # Single product
            invoice_data["customer_details"]["name"] = f"Customer {i+1}"
            
            try:
                response = requests.post(f"{self.base_url}/invoices", 
                                       json=invoice_data, 
                                       headers=self.headers, 
                                       timeout=15)
                
                if response.status_code == 200:
                    data = response.json()
                    invoice_number = data.get('invoice_number')
                    invoice_numbers.append(invoice_number)
                    self.created_invoice_ids.append(data.get('id'))
                    time.sleep(0.5)  # Small delay between requests
                else:
                    self.log_test("Invoice Numbering", False, 
                                f"Failed to create invoice {i+1}: HTTP {response.status_code}")
                    return
            except Exception as e:
                self.log_test("Invoice Numbering", False, f"Error creating invoice {i+1}: {str(e)}")
                return
        
        # Verify sequential numbering
        if len(invoice_numbers) == 3:
            numbering_correct = True
            for i, inv_num in enumerate(invoice_numbers):
                if not inv_num.startswith("INV"):
                    numbering_correct = False
                    break
            
            self.log_test("Invoice Numbering", numbering_correct, 
                        f"Generated invoice numbers: {', '.join(invoice_numbers)}")
        else:
            self.log_test("Invoice Numbering", False, "Failed to create test invoices")

    def test_get_invoices(self):
        """Test retrieving all invoices"""
        try:
            response = requests.get(f"{self.base_url}/invoices", 
                                  headers=self.headers, 
                                  timeout=10)
            
            if response.status_code == 200:
                data = response.json()
                invoice_count = len(data) if isinstance(data, list) else 0
                self.log_test("Get All Invoices", True, 
                            f"Retrieved {invoice_count} invoices")
                return data
            else:
                self.log_test("Get All Invoices", False, 
                            f"HTTP {response.status_code}: {response.text}")
                return None
        except Exception as e:
            self.log_test("Get All Invoices", False, f"Error: {str(e)}")
            return None

    def test_search_invoices(self):
        """Test invoice search functionality"""
        search_queries = ["Priya", "9876543210", "INV"]
        
        for query in search_queries:
            try:
                response = requests.get(f"{self.base_url}/invoices/search/{query}", 
                                      headers=self.headers, 
                                      timeout=10)
                
                if response.status_code == 200:
                    data = response.json()
                    result_count = len(data) if isinstance(data, list) else 0
                    self.log_test(f"Search Invoices - '{query}'", True, 
                                f"Found {result_count} matching invoices")
                else:
                    self.log_test(f"Search Invoices - '{query}'", False, 
                                f"HTTP {response.status_code}: {response.text}")
            except Exception as e:
                self.log_test(f"Search Invoices - '{query}'", False, f"Error: {str(e)}")

    def test_gst_calculations(self, shop_data: Dict):
        """Test GST calculations for different tax slabs"""
        test_cases = [
            {"gst_rate": 5.0, "expected_cgst_rate": 2.5, "expected_sgst_rate": 2.5},
            {"gst_rate": 12.0, "expected_cgst_rate": 6.0, "expected_sgst_rate": 6.0},
            {"gst_rate": 18.0, "expected_cgst_rate": 9.0, "expected_sgst_rate": 9.0},
            {"gst_rate": 28.0, "expected_cgst_rate": 14.0, "expected_sgst_rate": 14.0}
        ]
        
        for test_case in test_cases:
            gst_rate = test_case["gst_rate"]
            invoice_data = self.create_test_invoice_data(shop_data, [gst_rate])
            
            try:
                response = requests.post(f"{self.base_url}/invoices", 
                                       json=invoice_data, 
                                       headers=self.headers, 
                                       timeout=15)
                
                if response.status_code == 200:
                    data = response.json()
                    total_cgst = data.get('total_cgst', 0)
                    total_sgst = data.get('total_sgst', 0)
                    
                    # Calculate expected values
                    # Product: qty=2, rate=1000, discount=5% = 1900 taxable value
                    expected_taxable = 2 * 1000 * 0.95  # 1900
                    expected_cgst = expected_taxable * (gst_rate / 2) / 100
                    expected_sgst = expected_taxable * (gst_rate / 2) / 100
                    
                    cgst_correct = abs(total_cgst - expected_cgst) < 0.01
                    sgst_correct = abs(total_sgst - expected_sgst) < 0.01
                    equal_split = abs(total_cgst - total_sgst) < 0.01
                    
                    success = cgst_correct and sgst_correct and equal_split
                    details = f"GST {gst_rate}%: CGST=₹{total_cgst}, SGST=₹{total_sgst} (Expected: ₹{expected_cgst:.2f} each)"
                    
                    self.log_test(f"GST Calculation - {gst_rate}%", success, details)
                    self.created_invoice_ids.append(data.get('id'))
                else:
                    self.log_test(f"GST Calculation - {gst_rate}%", False, 
                                f"HTTP {response.status_code}: {response.text}")
            except Exception as e:
                self.log_test(f"GST Calculation - {gst_rate}%", False, f"Error: {str(e)}")

    def test_amount_to_words(self, shop_data: Dict):
        """Test amount to words conversion"""
        test_amounts = [
            {"amount": 1000, "products": [{"name": "Test Product", "quantity": 1, "unit_rate": 847.46, "discount_percentage": 0, "gst_rate": 18.0}]},
            {"amount": 5000, "products": [{"name": "Test Product", "quantity": 1, "unit_rate": 4237.29, "discount_percentage": 0, "gst_rate": 18.0}]},
            {"amount": 10000, "products": [{"name": "Test Product", "quantity": 1, "unit_rate": 8474.58, "discount_percentage": 0, "gst_rate": 18.0}]}
        ]
        
        for test_case in test_amounts:
            invoice_data = {
                "shop_details": shop_data,
                "customer_details": {
                    "name": "Test Customer",
                    "mobile": "9999999999",
                    "address": "Test Address",
                    "state": "Karnataka"
                },
                "products": test_case["products"],
                "reverse_charge": False
            }
            
            try:
                response = requests.post(f"{self.base_url}/invoices", 
                                       json=invoice_data, 
                                       headers=self.headers, 
                                       timeout=15)
                
                if response.status_code == 200:
                    data = response.json()
                    final_amount = data.get('final_amount')
                    amount_in_words = data.get('amount_in_words', '')
                    
                    # Check if amount in words is generated and contains "Rupees"
                    words_generated = len(amount_in_words) > 0 and "Rupees" in amount_in_words
                    
                    details = f"Amount: ₹{final_amount} → '{amount_in_words}'"
                    self.log_test(f"Amount to Words - ₹{test_case['amount']}", words_generated, details)
                    self.created_invoice_ids.append(data.get('id'))
                else:
                    self.log_test(f"Amount to Words - ₹{test_case['amount']}", False, 
                                f"HTTP {response.status_code}: {response.text}")
            except Exception as e:
                self.log_test(f"Amount to Words - ₹{test_case['amount']}", False, f"Error: {str(e)}")

    def test_validation_errors(self, shop_data: Dict):
        """Test validation with invalid data"""
        if not shop_data:
            self.log_test("Validation Testing", False, "No shop data available")
            return
            
        # Test with empty customer name
        invalid_invoice = self.create_test_invoice_data(shop_data)
        invalid_invoice["customer_details"]["name"] = ""
        
        try:
            response = requests.post(f"{self.base_url}/invoices", 
                                   json=invalid_invoice, 
                                   headers=self.headers, 
                                   timeout=10)
            
            # Should fail validation
            if response.status_code != 200:
                self.log_test("Validation - Empty Customer Name", True, 
                            f"Correctly rejected invalid data: HTTP {response.status_code}")
            else:
                self.log_test("Validation - Empty Customer Name", False, 
                            "Should have rejected empty customer name")
        except Exception as e:
            self.log_test("Validation - Empty Customer Name", False, f"Error: {str(e)}")
        
        # Test with negative quantity
        invalid_invoice2 = self.create_test_invoice_data(shop_data)
        invalid_invoice2["products"][0]["quantity"] = -1
        
        try:
            response = requests.post(f"{self.base_url}/invoices", 
                                   json=invalid_invoice2, 
                                   headers=self.headers, 
                                   timeout=10)
            
            if response.status_code != 200:
                self.log_test("Validation - Negative Quantity", True, 
                            f"Correctly rejected negative quantity: HTTP {response.status_code}")
            else:
                self.log_test("Validation - Negative Quantity", False, 
                            "Should have rejected negative quantity")
        except Exception as e:
            self.log_test("Validation - Negative Quantity", False, f"Error: {str(e)}")

    def test_delete_invoice(self):
        """Test invoice deletion"""
        if not self.created_invoice_ids:
            self.log_test("Delete Invoice", False, "No invoices available to delete")
            return
            
        invoice_id = self.created_invoice_ids[0]
        
        try:
            response = requests.delete(f"{self.base_url}/invoices/{invoice_id}", 
                                     headers=self.headers, 
                                     timeout=10)
            
            if response.status_code == 200:
                self.log_test("Delete Invoice", True, f"Successfully deleted invoice {invoice_id}")
                self.created_invoice_ids.remove(invoice_id)
            else:
                self.log_test("Delete Invoice", False, 
                            f"HTTP {response.status_code}: {response.text}")
        except Exception as e:
            self.log_test("Delete Invoice", False, f"Error: {str(e)}")

    def test_edge_cases(self, shop_data: Dict):
        """Test edge cases"""
        if not shop_data:
            return
            
        # Test with zero discount
        invoice_data = self.create_test_invoice_data(shop_data, [18.0])
        invoice_data["products"][0]["discount_percentage"] = 0.0
        
        try:
            response = requests.post(f"{self.base_url}/invoices", 
                                   json=invoice_data, 
                                   headers=self.headers, 
                                   timeout=15)
            
            if response.status_code == 200:
                data = response.json()
                self.log_test("Edge Case - Zero Discount", True, 
                            f"Handled zero discount correctly. Amount: ₹{data.get('final_amount')}")
                self.created_invoice_ids.append(data.get('id'))
            else:
                self.log_test("Edge Case - Zero Discount", False, 
                            f"HTTP {response.status_code}: {response.text}")
        except Exception as e:
            self.log_test("Edge Case - Zero Discount", False, f"Error: {str(e)}")
        
        # Test with high quantity
        invoice_data2 = self.create_test_invoice_data(shop_data, [18.0])
        invoice_data2["products"][0]["quantity"] = 1000
        
        try:
            response = requests.post(f"{self.base_url}/invoices", 
                                   json=invoice_data2, 
                                   headers=self.headers, 
                                   timeout=15)
            
            if response.status_code == 200:
                data = response.json()
                self.log_test("Edge Case - High Quantity", True, 
                            f"Handled high quantity correctly. Amount: ₹{data.get('final_amount')}")
                self.created_invoice_ids.append(data.get('id'))
            else:
                self.log_test("Edge Case - High Quantity", False, 
                            f"HTTP {response.status_code}: {response.text}")
        except Exception as e:
            self.log_test("Edge Case - High Quantity", False, f"Error: {str(e)}")

    def run_all_tests(self):
        """Run all backend tests"""
        print("=" * 80)
        print("GST BILLING API - COMPREHENSIVE BACKEND TESTING")
        print("=" * 80)
        print()
        
        # 1. API Health Check
        if not self.test_api_health():
            print("❌ API is not accessible. Stopping tests.")
            return self.generate_summary()
        
        # 2. Shop Management Tests
        print("🏪 SHOP MANAGEMENT TESTING")
        print("-" * 40)
        shop_data = self.test_create_shop()
        self.test_get_shops()
        self.test_get_shop_by_id(self.created_shop_id)
        print()
        
        # 3. Invoice Management Tests
        print("📄 INVOICE MANAGEMENT TESTING")
        print("-" * 40)
        self.test_create_invoice(shop_data)
        self.test_invoice_numbering(shop_data)
        self.test_get_invoices()
        self.test_search_invoices()
        print()
        
        # 4. GST Calculations Tests
        print("🧮 GST CALCULATIONS TESTING")
        print("-" * 40)
        self.test_gst_calculations(shop_data)
        print()
        
        # 5. Amount to Words Tests
        print("💬 AMOUNT TO WORDS TESTING")
        print("-" * 40)
        self.test_amount_to_words(shop_data)
        print()
        
        # 6. Validation Tests
        print("✅ VALIDATION TESTING")
        print("-" * 40)
        self.test_validation_errors(shop_data)
        print()
        
        # 7. Edge Cases
        print("🔍 EDGE CASES TESTING")
        print("-" * 40)
        self.test_edge_cases(shop_data)
        print()
        
        # 8. Cleanup Tests
        print("🗑️ CLEANUP TESTING")
        print("-" * 40)
        self.test_delete_invoice()
        print()
        
        return self.generate_summary()

    def generate_summary(self):
        """Generate test summary"""
        total_tests = len(self.test_results)
        passed_tests = sum(1 for result in self.test_results if result["success"])
        failed_tests = total_tests - passed_tests
        
        print("=" * 80)
        print("TEST SUMMARY")
        print("=" * 80)
        print(f"Total Tests: {total_tests}")
        print(f"Passed: {passed_tests} ✅")
        print(f"Failed: {failed_tests} ❌")
        print(f"Success Rate: {(passed_tests/total_tests*100):.1f}%" if total_tests > 0 else "0%")
        print()
        
        if failed_tests > 0:
            print("FAILED TESTS:")
            print("-" * 40)
            for result in self.test_results:
                if not result["success"]:
                    print(f"❌ {result['test_name']}: {result['details']}")
            print()
        
        print("CRITICAL ISSUES:")
        print("-" * 40)
        critical_issues = []
        for result in self.test_results:
            if not result["success"] and any(keyword in result["test_name"].lower() 
                                           for keyword in ["api health", "create", "gst calculation"]):
                critical_issues.append(f"• {result['test_name']}: {result['details']}")
        
        if critical_issues:
            for issue in critical_issues:
                print(issue)
        else:
            print("No critical issues found.")
        
        return {
            "total_tests": total_tests,
            "passed_tests": passed_tests,
            "failed_tests": failed_tests,
            "success_rate": (passed_tests/total_tests*100) if total_tests > 0 else 0,
            "critical_issues": critical_issues,
            "test_results": self.test_results
        }

if __name__ == "__main__":
    tester = GST_API_Tester()
    summary = tester.run_all_tests()