# Nucar NH / Dealer Inspire Inventory API Scraper

A lightweight, fast Python client to fetch live vehicle inventory directly from the **CarsCommerce Search & Listings API** used by Dealer Inspire dealership websites (such as [Nucar New Hampshire](https://www.nucarnh.com)).

Unlike traditional web scraping, this directly queries the backend JSON API:
- **No Cloudflare blocks or headless browser required**
- **High throughput:** Up to **250 vehicles per request** (downloads 570 vehicles in under 3 seconds)
- **Exports to both JSON and CSV**

---

## Quick Start

### 1. Requirements
Only Python 3 and `requests` are required:
```bash
pip install requests
```

### 2. Run the Script
```bash
python fetch_inventory.py
```

### 3. Output Files
- `vehicles_tilton.json`: Full nested raw data from the API (options, specs, photos, pricing, dealer metadata).
- `vehicles_tilton.csv`: Flattened spreadsheet (VIN, Stock, Year, Make, Model, Trim, Price, Mileage, Color, Transmission, Engine, Location, URL, Photo).

---

## How to Get / Refresh the API Key & CCID

If the API key rotates in the future, or if you want to scrape **any other dealership website powered by Dealer Inspire**, you can extract the credentials in seconds using either of the following methods:

### Option A: Via Browser Console (Instant)
1. Open the dealership's used/new inventory page in your browser (e.g. `https://www.nucarnh.com/used-vehicles/`).
2. Press `F12` to open Developer Tools, then click the **Console** tab.
3. Paste the following and hit **Enter**:
   ```javascript
   console.log({
     apiUrl: window.SEARCH_SERVICE?.apiUrl,
     ccid: window.SEARCH_SERVICE?.ccid,
     apiKey: window.SEARCH_SERVICE?.apiKey
   });
   ```
4. Copy the `ccid` and `apiKey`.

### Option B: Via Network Tab
1. Open Developer Tools (`F12`) -> **Network** tab -> select **Fetch/XHR**.
2. Type `search` or `carscommerce` into the filter box.
3. Click any pagination button or filter on the webpage.
4. Click on the request `https://websites-search.api.carscommerce.inc/api/v1/listings/<CCID>/search`.
5. Under **Request Headers**, find:
   - `x-api-key: <API_KEY>`
   - The dealership's **CCID** is in the URL path.

### Option C: Automated Python Extractor (Regex on HTML)
If the site doesn't have an aggressive Cloudflare challenge, you can extract it automatically with Python:
```python
import re
import requests

def get_dealer_credentials(page_url: str):
    headers = {"User-Agent": "Mozilla/5.0"}
    html = requests.get(page_url, headers=headers).text
    
    api_key = re.search(r'["\']apiKey["\']\s*:\s*["\']([^"\']+)["\']', html)
    ccid = re.search(r'["\']ccid["\']\s*:\s*["\']?(\d+)["\']?', html)
    api_url = re.search(r'["\']apiUrl["\']\s*:\s*["\'](https?://[^"\']+)["\']', html)
    
    return {
        "apiKey": api_key.group(1) if api_key else None,
        "ccid": ccid.group(1) if ccid else None,
        "apiUrl": api_url.group(1) if api_url else None,
    }

# Example:
# creds = get_dealer_credentials("https://www.nucarnh.com/used-vehicles/")
# print(creds)
```

---

## Configuration & Filtering in `fetch_inventory.py`

In `fetch_inventory.py`, you can customize:

### Target Specific Locations
Dealer Inspire maps locations to the facet `custom_text_10`:
```python
# Specific store:
location = "Nucar Automall of Tilton"

# Or pass None to fetch all vehicles across all Nucar NH locations (~3,895 vehicles):
vehicles = fetch_all_inventory(location=None)
```

### Filter Vehicle Conditions
```python
# Used and Certified Pre-Owned:
vehicle_types = ["Used", "Certified Used"]

# New only:
vehicle_types = ["New"]
```

### Changing Dealership
Update lines 18–19 with the target dealership's credentials:
```python
CCID = "6051356"
API_KEY = "OQa8l7SzMctJyr5bhSG9jYvlGnZUQfgl"
```

---

## API Reference

### 1. Search Listings
- **URL:** `POST https://websites-search.api.carscommerce.inc/api/v1/listings/{CCID}/search`
- **Headers:**
  - `Content-Type: application/json`
  - `x-api-key: {API_KEY}`
- **Payload Schema:**
  ```json
  {
    "page": 1,
    "perPage": 250,
    "filters": {
      "status": ["publish", "modified", "pend-sale"]
    },
    "facetFilters": {
      "custom_text_10": ["Nucar Automall of Tilton"],
      "type_slug": ["Used", "Certified Used"]
    },
    "sort": [
      { "field": "custom_text_2", "order": "asc" },
      { "field": "low_price", "order": "asc" }
    ],
    "requestedFields": ["vin", "stock", "year", "make", "model", "trim", "mileage", "pricing", "vdp_url", "media"]
  }
  ```

### 2. Available Facets & Counts
- **URL:** `POST https://websites-search.api.carscommerce.inc/api/v1/facets/{CCID}/counts`
- **Headers:**
  - `Content-Type: application/json`
  - `x-api-key: {API_KEY}`
- **Payload:**
  ```json
  {
    "filters": [
      { "status": ["publish", "modified", "pend-sale"] }
    ],
    "facets": ["custom_text_10", "type_slug", "make", "model_slug"]
  }
  ```

