"""
Flask Image Proxy Server for Facebook Marketplace Vehicle Uploads.

This server:
1. Loads vehicle data from vehicles_tilton.json
2. Downloads images from remote URLs and caches them locally
3. Serves images as binary blobs for the Tampermonkey script to upload
4. Provides a REST API for the Tampermonkey script to fetch vehicle data & images
5. Tracks posted vehicles and detects sold/removed inventory

Run:  python flask_image_server.py
"""

import os
import sys
import json
import hashlib
import mimetypes
import requests
import io
import time
from datetime import datetime
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
VEHICLE_CSV = os.path.join(os.path.dirname(__file__), "vehicles_tilton.csv")
IMAGE_CACHE_DIR = os.path.join(os.path.dirname(__file__), ".image_cache")
POSTED_DB = os.path.join(os.path.dirname(__file__), "posted_vehicles.json")
CONFIG_FILE = os.path.join(os.path.dirname(__file__), "config.json")
DASHBOARD_FILE = os.path.join(os.path.dirname(__file__), "dashboard.html")
USERSCRIPT_FILE = os.path.join(os.path.dirname(__file__), "tampermonkey_script.user.js")
MAX_IMAGES_PER_VEHICLE = 20

DEFAULT_CONFIG = {
    "fb_location": "Tilton, New Hampshire",
    "clean_title": True,
    "max_images": 20,
    "post_interval_seconds": 300,
    "dealer_store_name": "Nucar Automall of Tilton",
    "auto_publish": True,
}

def load_config():
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                return {**DEFAULT_CONFIG, **json.load(f)}
        except Exception:
            pass
    return DEFAULT_CONFIG.copy()

def save_config(cfg):
    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2)

# ── Load vehicle data ────────────────────────────────────────────────────────
_vehicles = []
_posted = {}  # VIN -> { posted_at, title, price, ... }

def load_vehicles():
    global _vehicles
    print(f"[*] Loading vehicles from {VEHICLE_JSON}...")
    if os.path.exists(VEHICLE_JSON):
        with open(VEHICLE_JSON, "r", encoding="utf-8") as f:
            _vehicles = json.load(f)
        print(f"[OK] Loaded {len(_vehicles)} vehicles.")
    else:
        _vehicles = []
        print(f"[!] Warning: {VEHICLE_JSON} does not exist yet.")


def load_posted():
    """Load the posted vehicles tracking database."""
    global _posted
    if os.path.exists(POSTED_DB):
        with open(POSTED_DB, "r", encoding="utf-8") as f:
            _posted = json.load(f)
        print(f"[OK] Loaded {len(_posted)} posted vehicle records.")
    else:
        _posted = {}
        print("[*] No posted vehicles database found, starting fresh.")


def save_posted():
    """Persist the posted vehicles database to disk."""
    with open(POSTED_DB, "w", encoding="utf-8") as f:
        json.dump(_posted, f, indent=2, ensure_ascii=False)


def get_inventory_vins():
    """Return the set of VINs currently in inventory."""
    return {v.get("vin") for v in _vehicles if v.get("vin")}

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
    desc_raw = extra.get("description_text") or extra.get("description_text_vdp") or ""
    # Strip HTML tags from description
    import re
    desc_cleaned = re.sub(r'<[^>]+>', '\n', desc_raw)
    desc_cleaned = re.sub(r'\n{3,}', '\n\n', desc_cleaned).strip()

    # Build clean specs header
    title_line = f"{v.get('year')} {v.get('make')} {v.get('model')} {v.get('trim', '')}".strip()
    header_parts = [title_line]
    if v.get("mileage"):
        header_parts.append(f"Mileage: {v['mileage']:,} miles")
    if pricing.get("price") or pricing.get("our_price"):
        price_val = pricing.get("price") or pricing.get("our_price")
        header_parts.append(f"Price: ${price_val:,}")
    if v.get("stock"):
        header_parts.append(f"Stock #: {v['stock']}")
    if vin := v.get("vin"):
        header_parts.append(f"VIN: {vin}")
    if mech.get("drivetrain"):
        header_parts.append(f"Drivetrain: {mech['drivetrain']}")
    if mech.get("transmission"):
        header_parts.append(f"Transmission: {mech['transmission']}")
    if mech.get("engine"):
        header_parts.append(f"Engine: {mech['engine']}")

    specs_header = "\n".join(header_parts)
    if desc_cleaned:
        desc = f"{specs_header}\n\n---\n\n{desc_cleaned}"
    else:
        desc = specs_header

    raw_ext_color = extra.get("chrome_exterior_color")
    raw_body = body.get("generic_type") or body.get("type")
    raw_fuel = mech.get("fuel_type")
    raw_trans = mech.get("transmission")

    vin = v.get("vin")
    posted_info = _posted.get(vin)

    return {
        "vin": vin,
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
        "posted": bool(posted_info),
        "posted_at": posted_info.get("posted_at") if posted_info else None,
    }


# ── Web Dashboard & API Routes ───────────────────────────────────────────────

@app.route("/")
@app.route("/dashboard")
def serve_dashboard():
    """Serve the Web Control Center dashboard."""
    if os.path.exists(DASHBOARD_FILE):
        return send_file(DASHBOARD_FILE)
    return "dashboard.html not found", 404


@app.route("/tampermonkey.user.js")
def serve_userscript():
    """Serve the Tampermonkey userscript for 1-click install/update."""
    if os.path.exists(USERSCRIPT_FILE):
        return send_file(USERSCRIPT_FILE, mimetype="text/javascript")
    return "tampermonkey_script.user.js not found", 404


@app.route("/api/config", methods=["GET", "POST"])
def handle_config():
    """Get or update application configuration."""
    if request.method == "POST":
        data = request.json or {}
        save_config(data)
        return jsonify({"status": "ok", "config": data})
    return jsonify(load_config())


@app.route("/api/sync", methods=["POST"])
def sync_inventory():
    """Trigger a live inventory download directly from CarsCommerce API."""
    try:
        from fetch_inventory import fetch_all_inventory, export_to_csv
        cfg = load_config()
        store_location = cfg.get("dealer_store_name", "Nucar Automall of Tilton")
        print(f"[*] Starting live inventory fetch for '{store_location}'...")
        listings = fetch_all_inventory(location=store_location)
        if listings:
            with open(VEHICLE_JSON, "w", encoding="utf-8") as f:
                json.dump(listings, f, indent=2, ensure_ascii=False)
            export_to_csv(listings, VEHICLE_CSV)
            load_vehicles()
            return jsonify({
                "status": "ok",
                "count": len(listings),
                "synced_at": datetime.now().isoformat()
            })
        else:
            return jsonify({"status": "error", "error": "No listings returned by API"}), 500
    except Exception as e:
        print(f"[X] Sync failed: {e}")
        return jsonify({"status": "error", "error": str(e)}), 500


@app.route("/api/vehicles", methods=["GET"])
def list_vehicles():
    """Return list of all vehicles with filtering and sorting for the dashboard."""
    page = int(request.args.get("page", 1))
    per_page = int(request.args.get("per_page", 24))
    search = request.args.get("search", "").lower().strip()
    status_filter = request.args.get("status", "all").lower().strip()
    body_filter = request.args.get("body_style", "").lower().strip()
    sort_by = request.args.get("sort", "year_desc")

    filtered = _vehicles

    # Status filter
    if status_filter == "posted":
        filtered = [v for v in filtered if v.get("vin") in _posted]
    elif status_filter == "unposted":
        filtered = [v for v in filtered if v.get("vin") not in _posted]

    # Search filter
    if search:
        filtered = [
            v for v in filtered
            if search in f"{v.get('year')} {v.get('make')} {v.get('model')} {v.get('trim')} {v.get('vin')} {v.get('stock')}".lower()
        ]

    # Body style filter
    if body_filter:
        def match_body(v):
            body_details = v.get("body_details") or {}
            b_type = (body_details.get("generic_type") or body_details.get("type") or "").lower()
            return body_filter in b_type or body_filter in map_body_style(b_type).lower()
        filtered = [v for v in filtered if match_body(v)]

    # Sorting
    if sort_by == "year_desc":
        filtered = sorted(filtered, key=lambda v: (v.get("year") or 0), reverse=True)
    elif sort_by == "price_asc":
        filtered = sorted(filtered, key=lambda v: (v.get("pricing") or {}).get("price") or (v.get("pricing") or {}).get("our_price") or 999999)
    elif sort_by == "price_desc":
        filtered = sorted(filtered, key=lambda v: (v.get("pricing") or {}).get("price") or (v.get("pricing") or {}).get("our_price") or 0, reverse=True)
    elif sort_by == "mileage_asc":
        filtered = sorted(filtered, key=lambda v: v.get("mileage") or 999999)

    start = (page - 1) * per_page
    end = start + per_page
    page_vehicles = filtered[start:end]

    return jsonify({
        "total": len(filtered),
        "page": page,
        "per_page": per_page,
        "total_pages": (len(filtered) + per_page - 1) // per_page if filtered else 1,
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
        "posted_count": len(_posted),
    })


# ── Posting Tracker API ───────────────────────────────────────────────────────

@app.route("/api/track-posted", methods=["POST"])
def track_posted():
    """Mark a vehicle as posted to Facebook Marketplace."""
    data = request.get_json()
    vin = data.get("vin")
    if not vin:
        return jsonify({"error": "Missing 'vin'"}), 400

    _posted[vin] = {
        "posted_at": datetime.now().isoformat(),
        "title": data.get("title", ""),
        "price": data.get("price", 0),
        "year": data.get("year"),
        "make": data.get("make"),
        "model": data.get("model"),
    }
    save_posted()
    print(f"[POSTED] {vin} — {data.get('title', 'Unknown')}")
    return jsonify({"status": "ok", "vin": vin, "total_posted": len(_posted)})


@app.route("/api/untrack-posted", methods=["POST"])
def untrack_posted():
    """Remove a vehicle from the posted tracker (e.g., listing was deleted)."""
    data = request.get_json()
    vin = data.get("vin")
    if not vin:
        return jsonify({"error": "Missing 'vin'"}), 400

    removed = _posted.pop(vin, None)
    if removed:
        save_posted()
        print(f"[UNTRACKED] {vin}")
        return jsonify({"status": "ok", "removed": True})
    return jsonify({"status": "ok", "removed": False})


@app.route("/api/posted", methods=["GET"])
def list_posted():
    """Return all vehicles marked as posted."""
    return jsonify({
        "total": len(_posted),
        "vehicles": _posted,
    })


@app.route("/api/queue", methods=["GET"])
def get_queue():
    """Return vehicles NOT yet posted (the posting queue)."""
    inventory_vins = get_inventory_vins()
    posted_vins = set(_posted.keys())
    unposted_vins = inventory_vins - posted_vins

    queue = []
    for v in _vehicles:
        if v.get("vin") in unposted_vins:
            queue.append(get_vehicle_summary(v))

    return jsonify({
        "total": len(queue),
        "vehicles": queue,
    })


@app.route("/api/sold", methods=["GET"])
def get_sold():
    """Return vehicles that were posted but are no longer in inventory (sold)."""
    inventory_vins = get_inventory_vins()
    posted_vins = set(_posted.keys())
    sold_vins = posted_vins - inventory_vins

    sold = []
    for vin in sold_vins:
        info = _posted[vin].copy()
        info["vin"] = vin
        info["status"] = "sold"
        sold.append(info)

    return jsonify({
        "total": len(sold),
        "vehicles": sold,
    })


@app.route("/api/refresh-inventory", methods=["POST"])
def refresh_inventory():
    """Re-fetch inventory from the JSON file (after running fetch_inventory.py)."""
    try:
        old_count = len(_vehicles)
        load_vehicles()
        new_count = len(_vehicles)

        # Detect sold vehicles
        inventory_vins = get_inventory_vins()
        posted_vins = set(_posted.keys())
        sold_vins = posted_vins - inventory_vins
        new_vins = inventory_vins - posted_vins

        return jsonify({
            "status": "ok",
            "old_count": old_count,
            "new_count": new_count,
            "new_vehicles": len(new_vins),
            "sold_vehicles": len(sold_vins),
            "sold_vins": list(sold_vins),
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/stats", methods=["GET"])
def get_stats():
    """Return overall statistics."""
    inventory_vins = get_inventory_vins()
    posted_vins = set(_posted.keys())
    return jsonify({
        "total_inventory": len(inventory_vins),
        "total_posted": len(posted_vins),
        "total_unposted": len(inventory_vins - posted_vins),
        "total_sold": len(posted_vins - inventory_vins),
    })


# ── Tampermonkey Bot Command & Control Broker ─────────────────────────────────

_bot_state = {
    "connected": False,
    "last_seen": 0,
    "status": "idle",       # "idle", "filling", "waiting_for_publish", "error", etc.
    "current_step": "",
    "current_vehicle": None,
    "progress": 0,
}
_pending_commands = []       # list of command dicts
_bot_logs = []               # list of { id, time, level, message }
_log_seq = 0

def add_bot_log(level, message):
    global _log_seq, _bot_logs
    _log_seq += 1
    timestamp = datetime.now().strftime("%H:%M:%S")
    entry = {
        "id": _log_seq,
        "time": timestamp,
        "level": level,
        "message": message
    }
    _bot_logs.append(entry)
    if len(_bot_logs) > 300:
        _bot_logs = _bot_logs[-300:]
    return entry


@app.route("/api/bot/heartbeat", methods=["POST"])
def bot_heartbeat():
    """
    Heartbeat ping from Tampermonkey running on Facebook.
    Updates bot status and returns any pending command.
    """
    global _bot_state, _pending_commands
    data = request.json or {}
    _bot_state["last_seen"] = time.time()
    _bot_state["connected"] = True
    _bot_state["status"] = data.get("status", _bot_state["status"])
    _bot_state["current_step"] = data.get("current_step", "")
    _bot_state["current_vehicle"] = data.get("current_vehicle")
    _bot_state["progress"] = data.get("progress", 0)

    # Pop next command if any
    next_cmd = _pending_commands.pop(0) if _pending_commands else None
    if next_cmd:
        add_bot_log("info", f"[Command Dispatched to FB] {next_cmd.get('type')}")

    return jsonify({
        "status": "ok",
        "command": next_cmd
    })


@app.route("/api/bot/command", methods=["POST"])
def send_bot_command():
    """
    Receive command from Flask Dashboard to be sent to Tampermonkey.
    Body: { type: "FILL_VEHICLE", vin: "..." } or { type: "START_QUEUE" }, etc.
    """
    global _pending_commands
    cmd = request.json or {}
    cmd_type = cmd.get("type", "UNKNOWN")
    _pending_commands.append(cmd)
    add_bot_log("info", f"[Dashboard] Queued command: {cmd_type}")
    return jsonify({"status": "ok", "queued": cmd})


@app.route("/api/bot/log", methods=["POST"])
def receive_bot_log():
    """Receive live console log message from Tampermonkey."""
    data = request.json or {}
    level = data.get("level", "info")
    message = data.get("message", "")
    entry = add_bot_log(level, message)
    return jsonify({"status": "ok", "entry": entry})


@app.route("/api/bot/logs", methods=["GET"])
def get_bot_logs():
    """Return logs and current state for the dashboard live console."""
    since_id = int(request.args.get("since_id", 0))
    is_connected = (time.time() - _bot_state["last_seen"]) < 5.0

    new_logs = [log for log in _bot_logs if log["id"] > since_id]
    return jsonify({
        "connected": is_connected,
        "bot_state": {
            **_bot_state,
            "connected": is_connected
        },
        "logs": new_logs,
        "total_logs": len(_bot_logs),
        "last_id": _bot_logs[-1]["id"] if _bot_logs else 0
    })


@app.route("/api/bot/clear-logs", methods=["POST"])
def clear_bot_logs():
    global _bot_logs
    _bot_logs = []
    add_bot_log("info", "Console logs cleared.")
    return jsonify({"status": "ok"})


# ── Main ──────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    load_vehicles()
    load_posted()
    print("\n" + "="*60)
    print("  Nucar -> Facebook Marketplace Image Proxy Server")
    print(f"  Vehicles loaded: {len(_vehicles)}")
    print(f"  Posted tracked:  {len(_posted)}")
    print(f"  Server: http://127.0.0.1:5000")
    print("="*60 + "\n")
    app.run(host="127.0.0.1", port=5000, debug=False)
