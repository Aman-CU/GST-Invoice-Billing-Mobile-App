from fastapi import FastAPI, APIRouter, HTTPException
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional
import uuid
from datetime import datetime


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Create the main app without a prefix
app = FastAPI()

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")


# GST Billing Models
class ShopDetails(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    address: str
    gst_number: str
    state: str
    phone: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)

class ShopDetailsCreate(BaseModel):
    name: str
    address: str
    gst_number: str
    state: str
    phone: Optional[str] = None

class CustomerDetails(BaseModel):
    name: str
    mobile: str
    address: Optional[str] = None
    state: Optional[str] = None

class ProductItem(BaseModel):
    name: str
    quantity: int
    unit_rate: float
    discount_percentage: float = 0.0
    gst_rate: float = 18.0  # Default 18% (9% CGST + 9% SGST)

class InvoiceCreate(BaseModel):
    shop_details: ShopDetails
    customer_details: CustomerDetails
    products: List[ProductItem]
    reverse_charge: bool = False
    qr_code_base64: Optional[str] = None

class Invoice(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    invoice_number: str
    shop_details: ShopDetails
    customer_details: CustomerDetails
    products: List[ProductItem]
    reverse_charge: bool = False
    qr_code_base64: Optional[str] = None
    
    # Calculated fields
    total_taxable_value: float = 0.0
    total_cgst: float = 0.0
    total_sgst: float = 0.0
    total_tax: float = 0.0
    round_off: float = 0.0
    final_amount: float = 0.0
    amount_in_words: str = ""
    
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

# Utility function to calculate invoice totals
def calculate_invoice_totals(products: List[ProductItem]) -> dict:
    total_taxable_value = 0.0
    total_cgst = 0.0
    total_sgst = 0.0
    
    for product in products:
        # Calculate discount
        discount_amount = (product.quantity * product.unit_rate * product.discount_percentage) / 100
        taxable_value = (product.quantity * product.unit_rate) - discount_amount
        
        # Calculate CGST and SGST (half of GST rate each)
        cgst_rate = product.gst_rate / 2
        sgst_rate = product.gst_rate / 2
        
        cgst_amount = (taxable_value * cgst_rate) / 100
        sgst_amount = (taxable_value * sgst_rate) / 100
        
        total_taxable_value += taxable_value
        total_cgst += cgst_amount
        total_sgst += sgst_amount
    
    total_tax = total_cgst + total_sgst
    gross_total = total_taxable_value + total_tax
    final_amount = round(gross_total)
    round_off = final_amount - gross_total
    
    return {
        "total_taxable_value": round(total_taxable_value, 2),
        "total_cgst": round(total_cgst, 2),
        "total_sgst": round(total_sgst, 2),
        "total_tax": round(total_tax, 2),
        "round_off": round(round_off, 2),
        "final_amount": final_amount
    }

# Number to words conversion
def number_to_words(num):
    """Convert number to words for Indian currency"""
    try:
        num = int(num)
        if num == 0:
            return "Zero Rupees Only"
        
        def convert_hundreds(n):
            ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"]
            teens = ["Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", 
                    "Sixteen", "Seventeen", "Eighteen", "Nineteen"]
            tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"]
            
            result = ""
            if n >= 100:
                result += ones[n // 100] + " Hundred "
                n %= 100
            
            if n >= 20:
                result += tens[n // 10] + " "
                n %= 10
            elif n >= 10:
                result += teens[n - 10] + " "
                n = 0
            
            if n > 0:
                result += ones[n] + " "
            
            return result.strip()
        
        if num < 1000:
            return convert_hundreds(num) + " Rupees Only"
        elif num < 100000:
            thousands = num // 1000
            remainder = num % 1000
            result = convert_hundreds(thousands) + " Thousand "
            if remainder > 0:
                result += convert_hundreds(remainder) + " "
            return result.strip() + " Rupees Only"
        else:
            lakhs = num // 100000
            remainder = num % 100000
            result = convert_hundreds(lakhs) + " Lakh "
            if remainder >= 1000:
                thousands = remainder // 1000
                result += convert_hundreds(thousands) + " Thousand "
                remainder %= 1000
            if remainder > 0:
                result += convert_hundreds(remainder) + " "
            return result.strip() + " Rupees Only"
    except:
        return "Amount calculation error"

# Routes
@api_router.get("/")
async def root():
    return {"message": "GST Billing API"}

# Shop management
@api_router.post("/shop", response_model=ShopDetails)
async def create_shop(shop: ShopDetailsCreate):
    shop_dict = shop.dict()
    shop_obj = ShopDetails(**shop_dict)
    await db.shops.insert_one(shop_obj.dict())
    return shop_obj

@api_router.get("/shop", response_model=List[ShopDetails])
async def get_shops():
    shops = await db.shops.find().to_list(100)
    return [ShopDetails(**shop) for shop in shops]

@api_router.get("/shop/{shop_id}", response_model=ShopDetails)
async def get_shop(shop_id: str):
    shop = await db.shops.find_one({"id": shop_id})
    if not shop:
        raise HTTPException(status_code=404, detail="Shop not found")
    return ShopDetails(**shop)

# Invoice management
@api_router.post("/invoices", response_model=Invoice)
async def create_invoice(invoice_data: InvoiceCreate):
    # Get next invoice number
    last_invoice = await db.invoices.find_one(sort=[("invoice_number", -1)])
    if last_invoice:
        # Extract number from last invoice (e.g., "INV123" -> 123)
        last_num = int(last_invoice["invoice_number"].replace("INV", ""))
        next_num = last_num + 1
    else:
        next_num = 1
    
    invoice_number = f"INV{next_num}"
    
    # Calculate totals
    totals = calculate_invoice_totals(invoice_data.products)
    amount_in_words = number_to_words(totals["final_amount"])
    
    # Create invoice object
    invoice_dict = invoice_data.dict()
    invoice_dict["invoice_number"] = invoice_number
    invoice_dict.update(totals)
    invoice_dict["amount_in_words"] = amount_in_words
    
    invoice_obj = Invoice(**invoice_dict)
    await db.invoices.insert_one(invoice_obj.dict())
    
    return invoice_obj

@api_router.get("/invoices", response_model=List[Invoice])
async def get_invoices(skip: int = 0, limit: int = 100):
    invoices = await db.invoices.find().sort("created_at", -1).skip(skip).limit(limit).to_list(limit)
    return [Invoice(**invoice) for invoice in invoices]

@api_router.get("/invoices/{invoice_id}", response_model=Invoice)
async def get_invoice(invoice_id: str):
    invoice = await db.invoices.find_one({"id": invoice_id})
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    return Invoice(**invoice)

@api_router.delete("/invoices/{invoice_id}")
async def delete_invoice(invoice_id: str):
    result = await db.invoices.delete_one({"id": invoice_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Invoice not found")
    return {"message": "Invoice deleted successfully"}

# Search invoices
@api_router.get("/invoices/search/{query}")
async def search_invoices(query: str):
    invoices = await db.invoices.find({
        "$or": [
            {"customer_details.name": {"$regex": query, "$options": "i"}},
            {"customer_details.mobile": {"$regex": query, "$options": "i"}},
            {"invoice_number": {"$regex": query, "$options": "i"}}
        ]
    }).sort("created_at", -1).to_list(100)
    return [Invoice(**invoice) for invoice in invoices]

# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
