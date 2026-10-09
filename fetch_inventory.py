"""
Nucar New Hampshire (Dealer Inspire / CarsCommerce) Inventory API Client.

Directly queries the CarsCommerce Search API used by nucarnh.com:
- Endpoint: https://websites-search.api.carscommerce.inc/api/v1/listings/6051356/search
- Facets:   https://websites-search.api.carscommerce.inc/api/v1/facets/6051356/counts
- Auth:     x-api-key header
"""

import sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
import json
import csv
import time
import requests
from typing import Dict, List, Optional, Any

# ── Credentials ─────────────────────────────────────────────────────────────
# To update credentials or target another Dealer Inspire website:
# Run `console.log(window.SEARCH_SERVICE)` in the browser console on that site.
API_BASE = "https://websites-search.api.carscommerce.inc"
CCID = "6051356"
API_KEY = "OQa8l7SzMctJyr5bhSG9jYvlGnZUQfgl"

HEADERS = {
    "Content-Type": "application/json",
    "x-api-key": API_KEY,
    "Accept": "application/json",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Referer": "https://www.nucarnh.com/",
}

def extract_credentials_from_html(html_text: str) -> Dict[str, Optional[str]]:
    """Helper to extract Search Service credentials from page source HTML."""
    import re
    api_key_match = re.search(r'["\']apiKey["\']\s*:\s*["\']([^"\']+)["\']', html_text)
    ccid_match = re.search(r'["\']ccid["\']\s*:\s*["\']?(\d+)["\']?', html_text)
    api_url_match = re.search(r'["\']apiUrl["\']\s*:\s*["\'](https?://[^"\']+)["\']', html_text)
    return {
        "apiKey": api_key_match.group(1) if api_key_match else None,
        "ccid": ccid_match.group(1) if ccid_match else None,
        "apiUrl": api_url_match.group(1) if api_url_match else None,
    }

REQUESTED_FIELDS = [
    "vin",
    "stock",
    "type",
    "year",
    "make",
    "model",
    "trim",
    "mileage",
    "pricing",
    "payments",
    "vdp_url",
    "media",
    "body_details",
    "mechanical",
    "dealer",
    "extra_fields",
    "history_report",
    "status",
]

def fetch_inventory_page(
    page: int = 1,
    per_page: int = 250,
    location: Optional[str] = "Nucar Automall of Tilton",
    vehicle_types: Optional[List[str]] = None,
    sort: Optional[List[Dict[str, str]]] = None,
) -> Dict[str, Any]:
    """Fetch a single page of vehicle listings."""
    url = f"{API_BASE}/api/v1/listings/{CCID}/search"
    
    facet_filters: Dict[str, List[str]] = {}
    if location:
        facet_filters["custom_text_10"] = [location]
    if vehicle_types:
        facet_filters["type_slug"] = vehicle_types

    payload: Dict[str, Any] = {
        "page": page,
        "perPage": min(per_page, 250),
        "filters": {
            "status": ["publish", "modified", "pend-sale"]
        },
        "requestedFields": REQUESTED_FIELDS,
    }

    if facet_filters:
        payload["facetFilters"] = facet_filters

    if sort:
        payload["sort"] = sort
    else:
        payload["sort"] = [
            {"field": "custom_text_2", "order": "asc"},
            {"field": "low_price", "order": "asc"}
        ]

    resp = requests.post(url, headers=HEADERS, json=payload, timeout=20)
    resp.raise_for_status()
    return resp.json()


def fetch_all_inventory(
    location: Optional[str] = "Nucar Automall of Tilton",
    vehicle_types: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    """Paginate and fetch all vehicles matching the criteria."""
    print(f"[*] Starting inventory fetch for location: '{location or 'ALL'}'...")
    all_listings: List[Dict[str, Any]] = []
    page = 1
    total_expected = None

    while True:
        data = fetch_inventory_page(
            page=page,
            per_page=250,
            location=location,
            vehicle_types=vehicle_types,
        )
        meta = data.get("meta", {}).get("pagination", {})
        if total_expected is None:
            total_expected = meta.get("total", 0)
            print(f"[*] Total matching vehicles: {total_expected}")

        listings = data.get("data", {}).get("listings", [])
        if not listings:
            break

        all_listings.extend(listings)
        print(f"    - Page {page}: fetched {len(listings)} vehicles (total accumulated: {len(all_listings)}/{total_expected})")

        if len(all_listings) >= total_expected or page >= meta.get("total_pages", 1):
            break

        page += 1
        time.sleep(0.3)

    print(f"[✓] Successfully downloaded {len(all_listings)} vehicles.")
    return all_listings


def export_to_csv(listings: List[Dict[str, Any]], filename: str):
    """Export flattened vehicle listings to CSV."""
    if not listings:
        print("[!] No listings to export.")
        return

    fieldnames = [
        "vin", "stock", "year", "make", "model", "trim", "type",
        "price", "msrp", "miles", "exterior_color", "interior_color",
        "transmission", "drivetrain", "engine", "location", "vdp_url", "image_url"
    ]

    with open(filename, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()

        for item in listings:
            pricing = item.get("pricing") or {}
            price = pricing.get("price") or pricing.get("selling_price") or pricing.get("low_price")
            msrp = pricing.get("msrp")

            mileage_val = item.get("mileage")
            miles = mileage_val if isinstance(mileage_val, (int, float)) else (mileage_val or {}).get("miles")

            body = item.get("body_details") or {}
            mech = item.get("mechanical") or {}
            dealer = item.get("dealer") or {}
            media = item.get("media") or {}
            extra = item.get("extra_fields") or {}

            # First image
            images = media.get("images") or []
            first_image = images[0].get("url") if images and isinstance(images[0], dict) else ""

            row = {
                "vin": item.get("vin"),
                "stock": item.get("stock"),
                "year": item.get("year"),
                "make": item.get("make"),
                "model": item.get("model"),
                "trim": item.get("trim"),
                "type": item.get("type"),
                "price": price,
                "msrp": msrp,
                "miles": miles,
                "exterior_color": body.get("exterior_color"),
                "interior_color": body.get("interior_color"),
                "transmission": mech.get("transmission"),
                "drivetrain": mech.get("drivetrain"),
                "engine": mech.get("engine"),
                "location": extra.get("custom_text_10") or dealer.get("name"),
                "vdp_url": item.get("vdp_url"),
                "image_url": first_image,
            }
            writer.writerow(row)

    print(f"[✓] Exported {len(listings)} vehicles to CSV: {filename}")


if __name__ == "__main__":
    location_target = "Nucar Automall of Tilton"
    
    # 1. Fetch all listings for Tilton
    vehicles = fetch_all_inventory(location=location_target)

    # 2. Save full JSON
    json_path = "vehicles_tilton.json"
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(vehicles, f, indent=2, ensure_ascii=False)
    print(f"[✓] Saved raw JSON data to: {json_path}")

    # 3. Save flattened CSV
    csv_path = "vehicles_tilton.csv"
    export_to_csv(vehicles, csv_path)

    # 4. Show top 5 preview
    print("\n=== Sample 5 Vehicles from Tilton ===")
    for v in vehicles[:5]:
        p = (v.get("pricing") or {}).get("price") or (v.get("pricing") or {}).get("selling_price")
        print(f"• {v.get('year')} {v.get('make')} {v.get('model')} {v.get('trim')} | Stock: {v.get('stock')} | VIN: {v.get('vin')} | Price: ${p}")
