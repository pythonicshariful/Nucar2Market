"""
Flask Image Proxy Server for Facebook Marketplace Vehicle Uploads.

This server:
1. Loads vehicle data from vehicles_tilton.json
2. Downloads images from remote URLs and caches them locally
3. Serves images as binary blobs for the Tampermonkey script to upload
4. Provides a REST API for the Tampermonkey script to fetch vehicle data & images

Run:  python flask_image_server.py
"""

import os
import sys
import json
import hashlib
import mimetypes
import requests
import io
from flask import Flask, jsonify, request, send_file
from flask_cors import CORS

try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass

app = Flask(__name__)
CORS(app)  # Allow cross-origin requests from facebook.com

# ── Configuration ────────────────────────────────────────────────────────────
VEHICLE_JSON = os.path.join(os.path.dirname(__file__), "vehicles_tilton.json")
IMAGE_CACHE_DIR = os.path.join(os.path.dirname(__file__), ".image_cache")
MAX_IMAGES_PER_VEHICLE = 20

# ── Load vehicle data ────────────────────────────────────────────────────────
_vehicles = []

def load_vehicles():
    global _vehicles
    print(f"[*] Loading vehicles from {VEHICLE_JSON}...")
    with open(VEHICLE_JSON, "r", encoding="utf-8") as f:
        _vehicles = json.load(f)
    print(f"[OK] Loaded {len(_vehicles)} vehicles.")

def map_body_style(raw):
    """Map inventory body type to Facebook Marketplace body style option."""
    if not raw:
        return None
    r = raw.lower().strip()
    if "suv" in r or "crossover" in r:
        return "SUV"
    if "truck" in r or "bed" in r or "pickup" in r:
        return "Truck"
    if "sedan" in r or "car" in r:
        return "Sedan"
    if "coupe" in r:
        return "Coupe"
    if "convertible" in r or "cabriolet" in r:
        return "Convertible"
    if "hatchback" in r:
        return "Hatchback"
    if "compact" in r:
        return "Small Car"
    if "wagon" in r:
        return "Wagon"
    if "van" in r or "minivan" in r:
        return "Minivan"
    return "Other"


def map_exterior_color(raw):
    """Map raw chrome exterior color to Facebook Marketplace exterior color option."""
    if not raw:
        return None
    r = raw.lower().strip()
    if "off white" in r or "off-white" in r:
        return "Off white"
    if "charcoal" in r:
        return "Charcoal"
    if "silver" in r:
        return "Silver"
    if any(k in r for k in ["gray", "grey", "metal", "granite", "slate", "steel", "anvil", "rhino", "earl", "celestite"]):
        return "Gray"
    if any(k in r for k in ["black", "ebony", "midnight", "onyx", "shadow", "nero", "noir"]):
        return "Black"
    if any(k in r for k in ["white", "summit", "snow", "frost", "pearl", "ice cap", "avalanche", "powder", "chalk", "blizzard", "bianco"]):
        return "White"
    if any(k in r for k in ["blue", "navy", "indigo", "aqua", "stormy sea"]):
        return "Blue"
    if any(k in r for k in ["red", "crimson", "scarlet", "ruby", "rosso"]):
        return "Red"
    if any(k in r for k in ["burgundy", "maroon", "sangria", "cabernet", "bordeaux", "merlot"]):
        return "Burgundy"
    if any(k in r for k in ["green", "olive", "emerald", "moss", "verde", "sage"]):
        return "Green"
    if any(k in r for k in ["brown", "bronze", "copper", "espresso", "chocolate"]):
        return "Brown"
    if "gold" in r:
        return "Gold"
    if any(k in r for k in ["tan", "sand", "dune"]):
        return "Tan"
    if any(k in r for k in ["beige", "cream", "champagne"]):
        return "Beige"
    if any(k in r for k in ["yellow", "solar"]):
        return "Yellow"
    if any(k in r for k in ["orange", "joose", "sun blaze", "tangerine", "sunset"]):
        return "Orange"
    if any(k in r for k in ["purple", "violet", "plum"]):
        return "Purple"
    if any(k in r for k in ["turquoise", "teal", "cyan"]):
        return "Turquoise"
    return None


def map_condition(v):
    """Map vehicle inventory status to Facebook Marketplace condition."""
    v_type = (v.get("type") or "").lower()
    used_status = (v.get("extra_fields") or {}).get("used_status_filter")
    if "new" in v_type or "certified" in v_type:
        return "Excellent"
    if used_status == "Inspected":
        return "Very good"
    if used_status == "As-Is":
        return "Fair"
    return "Good"


def map_fuel_type(raw):
    """Map raw mechanical fuel type to Facebook Marketplace fuel type."""
    if not raw:
        return "Gasoline"
    r = raw.lower().strip()
    if "plug-in" in r:
        return "Plug-in hybrid"
    if "hybrid" in r:
        return "Hybrid"
    if "diesel" in r:
        return "Diesel"
    if "electric" in r:
        return "Electric"
    if "flex" in r:
        return "Flex"
    if "gasoline" in r or "gas" in r:
        return "Gasoline"
    return "Other"


def map_transmission(raw):
    """Map transmission string to Facebook Marketplace transmission option."""
    if not raw:
        return "Automatic transmission"
    if "manual" in raw.lower():
        return "Manual transmission"
    return "Automatic transmission"


def get_vehicle_summary(v):
    """Return a compact summary dict for the control panel."""
    pricing = v.get("pricing") or {}
    media = v.get("media") or {}
    images = media.get("images") or []
    body = v.get("body_details") or {}
    mech = v.get("mechanical") or {}
    extra = v.get("extra_fields") or {}

    # Determine FB vehicle type from body type
    body_type = (body.get("generic_type") or body.get("type") or "").lower()
    fb_vehicle_type = "car_truck"  # default
    if body_type in ("cars", "sedans", "coupes", "suvs", "crossovers",
                     "trucks", "vans", "minivans", "wagons", "hatchbacks",
                     "convertibles"):
        fb_vehicle_type = "car_truck"

    # Build description
    desc = extra.get("description_text") or extra.get("description_text_vdp") or ""
    # Strip HTML tags from description
    import re
    desc = re.sub(r'<[^>]+>', '\n', desc)
    desc = re.sub(r'\n{3,}', '\n\n', desc).strip()

    # If description is empty, build one from available data
    if not desc:
        parts = []
        parts.append(f"{v.get('year')} {v.get('make')} {v.get('model')} {v.get('trim', '')}".strip())
        if mech.get("engine"):
            parts.append(f"Engine: {mech['engine']}")
        if mech.get("transmission"):
            parts.append(f"Transmission: {mech['transmission']}")
        if mech.get("drivetrain"):
            parts.append(f"Drivetrain: {mech['drivetrain']}")
        if v.get("mileage"):
            parts.append(f"Mileage: {v['mileage']:,} miles")
        if mech.get("fuel_type"):
            parts.append(f"Fuel: {mech['fuel_type']}")
        desc = "\n".join(parts)

    raw_ext_color = extra.get("chrome_exterior_color")
    raw_body = body.get("generic_type") or body.get("type")
    raw_fuel = mech.get("fuel_type")
    raw_trans = mech.get("transmission")

    return {
        "vin": v.get("vin"),
        "stock": v.get("stock"),
        "year": v.get("year"),
        "make": v.get("make"),
        "model": v.get("model"),
        "trim": v.get("trim"),
        "type": v.get("type"),
        "price": pricing.get("price") or pricing.get("our_price") or 0,
        "mileage": v.get("mileage"),
        "body_type": raw_body,
        "body_style": map_body_style(raw_body),
        "exterior_color": map_exterior_color(raw_ext_color),
        "raw_exterior_color": raw_ext_color,
        "condition": map_condition(v),
        "fuel_type": map_fuel_type(raw_fuel),
        "raw_fuel_type": raw_fuel,
        "transmission": map_transmission(raw_trans),
        "raw_transmission": raw_trans,
        "fb_vehicle_type": fb_vehicle_type,
        "image_count": len(images),
        "thumbnail": images[0] if images else None,
        "images": images[:MAX_IMAGES_PER_VEHICLE],
        "description": desc,
        "drivetrain": mech.get("drivetrain"),
        "engine": mech.get("engine"),
        "title": extra.get("title") or f"{v.get('year')} {v.get('make')} {v.get('model')}",
    }


# ── API Routes ────────────────────────────────────────────────────────────────

@app.route("/api/vehicles", methods=["GET"])
def list_vehicles():
    """Return list of all vehicles with summary data for the control panel."""
    page = int(request.args.get("page", 1))
    per_page = int(request.args.get("per_page", 50))
    search = request.args.get("search", "").lower()

    filtered = _vehicles
    if search:
        filtered = [
            v for v in _vehicles
            if search in f"{v.get('year')} {v.get('make')} {v.get('model')} {v.get('trim')} {v.get('vin')} {v.get('stock')}".lower()
        ]

    start = (page - 1) * per_page
    end = start + per_page
    page_vehicles = filtered[start:end]

    return jsonify({
        "total": len(filtered),
        "page": page,
        "per_page": per_page,
        "total_pages": (len(filtered) + per_page - 1) // per_page,
        "vehicles": [get_vehicle_summary(v) for v in page_vehicles]
    })


@app.route("/api/vehicle/<vin>", methods=["GET"])
def get_vehicle(vin):
    """Return full vehicle data by VIN."""
    for v in _vehicles:
        if v.get("vin") == vin:
            return jsonify(get_vehicle_summary(v))
    return jsonify({"error": "Vehicle not found"}), 404


@app.route("/api/proxy-image", methods=["GET"])
def proxy_image():
    """
    Download an image from a remote URL and serve it as a binary file.
    This is the key endpoint - it lets the Tampermonkey script fetch images
    that would otherwise be blocked by CORS.

    Query params:
      - url: The remote image URL to proxy
    """
    image_url = request.args.get("url")
    if not image_url:
        return jsonify({"error": "Missing 'url' parameter"}), 400

    # Create cache directory
    os.makedirs(IMAGE_CACHE_DIR, exist_ok=True)

    # Generate cache key from URL
    url_hash = hashlib.md5(image_url.encode()).hexdigest()
    ext = os.path.splitext(image_url.split("?")[0])[1] or ".jpg"
    cache_path = os.path.join(IMAGE_CACHE_DIR, f"{url_hash}{ext}")

    # Download if not cached
    if not os.path.exists(cache_path):
        try:
            print(f"  [->] Downloading: {image_url[:80]}...")
            resp = requests.get(image_url, timeout=30, stream=True, headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
            })
            resp.raise_for_status()
            with open(cache_path, "wb") as f:
                for chunk in resp.iter_content(8192):
                    f.write(chunk)
            print(f"  [OK] Cached: {cache_path}")
        except Exception as e:
            print(f"  [X] Failed to download {image_url}: {e}")
            return jsonify({"error": str(e)}), 500

    # Determine MIME type
    mime = mimetypes.guess_type(cache_path)[0] or "image/jpeg"

    return send_file(
        cache_path,
        mimetype=mime,
        as_attachment=False,
        download_name=f"vehicle_image{ext}"
    )


@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({
        "status": "ok",
        "total_vehicles": len(_vehicles),
    })


# ── Main ──────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    load_vehicles()
    print("\n" + "="*60)
    print("  Nucar -> Facebook Marketplace Image Proxy Server")
    print(f"  Vehicles loaded: {len(_vehicles)}")
    print(f"  Server: http://127.0.0.1:5000")
    print("="*60 + "\n")
    app.run(host="127.0.0.1", port=5000, debug=False)
