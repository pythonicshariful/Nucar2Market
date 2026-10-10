// ==UserScript==
// @name         Nucar → Facebook Marketplace Vehicle Poster
// @namespace    https://nucar2market.local
// @version      1.0.0
// @description  Auto-fill Facebook Marketplace vehicle listings from Nucar inventory via Flask server
// @author       Nucar2Market
// @match        https://www.facebook.com/marketplace/create/vehicle*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @connect      127.0.0.1
// @connect      localhost
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // ── CONFIG ────────────────────────────────────────────────────────────
    const FLASK_SERVER = 'http://127.0.0.1:5000';
    const LOCATION_TEXT = 'Tilton, New Hampshire';  // ← Change this to your desired location
    const MAX_IMAGES = 20;        // Maximum photos to upload (Facebook limit is typically 20)
    const FILL_DELAY = 800;       // ms between each field fill
    const IMAGE_DELAY = 2000;     // ms between each image upload
    const LOCATION_WAIT = 2500;   // ms to wait for location dropdown to appear

    // ── STYLES ────────────────────────────────────────────────────────────
    GM_addStyle(`
        #n2m-panel {
            position: fixed;
            top: 0;
            right: 0;
            width: 420px;
            height: 100vh;
            background: #1a1a2e;
            color: #e0e0e0;
            font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
            z-index: 999999;
            box-shadow: -4px 0 20px rgba(0,0,0,0.5);
            display: flex;
            flex-direction: column;
            overflow: hidden;
            transition: transform 0.3s ease;
        }
        #n2m-panel.collapsed {
            transform: translateX(380px);
        }
        #n2m-toggle {
            position: fixed;
            top: 50%;
            right: 420px;
            transform: translateY(-50%);
            width: 30px;
            height: 60px;
            background: #e94560;
            border: none;
            border-radius: 8px 0 0 8px;
            color: white;
            cursor: pointer;
            z-index: 999999;
            font-size: 14px;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: right 0.3s ease;
        }
        #n2m-toggle.collapsed { right: 40px; }
        #n2m-header {
            background: linear-gradient(135deg, #e94560, #0f3460);
            padding: 14px 16px;
            display: flex;
            align-items: center;
            gap: 10px;
        }
        #n2m-header h2 {
            margin: 0;
            font-size: 16px;
            font-weight: 700;
            color: white;
        }
        #n2m-header .badge {
            background: rgba(255,255,255,0.2);
            padding: 2px 8px;
            border-radius: 12px;
            font-size: 11px;
        }
        #n2m-search {
            padding: 10px 16px;
            background: #16213e;
        }
        #n2m-search input {
            width: 100%;
            padding: 8px 12px;
            background: #1a1a2e;
            border: 1px solid #333;
            border-radius: 6px;
            color: #e0e0e0;
            font-size: 13px;
            outline: none;
            box-sizing: border-box;
        }
        #n2m-search input:focus {
            border-color: #e94560;
        }
        #n2m-list {
            flex: 1;
            overflow-y: auto;
            padding: 8px;
        }
        #n2m-list::-webkit-scrollbar { width: 6px; }
        #n2m-list::-webkit-scrollbar-track { background: #1a1a2e; }
        #n2m-list::-webkit-scrollbar-thumb { background: #333; border-radius: 3px; }
        .n2m-card {
            background: #16213e;
            border-radius: 8px;
            padding: 10px;
            margin-bottom: 8px;
            cursor: pointer;
            transition: all 0.2s ease;
            display: flex;
            gap: 10px;
            align-items: center;
        }
        .n2m-card:hover {
            background: #1a2744;
            transform: translateX(-2px);
            box-shadow: 2px 2px 10px rgba(233,69,96,0.2);
        }
        .n2m-card.active {
            border: 1px solid #e94560;
            background: #1c2a4a;
        }
        .n2m-card img {
            width: 70px;
            height: 52px;
            object-fit: cover;
            border-radius: 4px;
            flex-shrink: 0;
        }
        .n2m-card-info {
            flex: 1;
            min-width: 0;
        }
        .n2m-card-title {
            font-size: 13px;
            font-weight: 600;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .n2m-card-meta {
            font-size: 11px;
            color: #888;
            margin-top: 2px;
        }
        .n2m-card-price {
            font-size: 14px;
            font-weight: 700;
            color: #4ecca3;
        }
        #n2m-status {
            padding: 12px 16px;
            background: #16213e;
            border-top: 1px solid #333;
            font-size: 12px;
        }
        #n2m-status .status-text {
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .n2m-btn {
            padding: 8px 16px;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-size: 13px;
            font-weight: 600;
            transition: all 0.2s ease;
        }
        .n2m-btn-fill {
            background: linear-gradient(135deg, #e94560, #c03050);
            color: white;
            width: 100%;
            margin-top: 8px;
        }
        .n2m-btn-fill:hover { transform: scale(1.02); filter: brightness(1.1); }
        .n2m-btn-fill:disabled {
            opacity: 0.5;
            cursor: not-allowed;
            transform: none;
            filter: none;
        }
        .n2m-progress {
            height: 3px;
            background: #333;
            border-radius: 2px;
            margin-top: 8px;
            overflow: hidden;
        }
        .n2m-progress-bar {
            height: 100%;
            background: linear-gradient(90deg, #e94560, #4ecca3);
            border-radius: 2px;
            transition: width 0.3s ease;
            width: 0%;
        }
        .n2m-pagination {
            display: flex;
            justify-content: center;
            align-items: center;
            gap: 8px;
            padding: 8px;
        }
        .n2m-pagination button {
            padding: 4px 10px;
            background: #333;
            border: none;
            border-radius: 4px;
            color: white;
            cursor: pointer;
            font-size: 12px;
        }
        .n2m-pagination button:hover { background: #e94560; }
        .n2m-pagination button:disabled { opacity: 0.3; cursor: not-allowed; }
        .n2m-pagination span { font-size: 12px; color: #888; }
        .spinner {
            display: inline-block;
            width: 12px;
            height: 12px;
            border: 2px solid #555;
            border-top-color: #e94560;
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
    `);

    // ── HELPERS ───────────────────────────────────────────────────────────

    function sleep(ms) {
        return new Promise(r => setTimeout(r, ms));
    }

    /** Fire React-compatible input event */
    function fireInputEvent(el, value) {
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype, 'value'
        )?.set || Object.getOwnPropertyDescriptor(
            window.HTMLTextAreaElement.prototype, 'value'
        )?.set;

        if (nativeInputValueSetter) {
            nativeInputValueSetter.call(el, value);
        } else {
            el.value = value;
        }
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }

    /** Simulate keyboard typing for React forms */
    function simulateTyping(el, text) {
        el.focus();
        el.click();
        // Clear existing value
        fireInputEvent(el, '');
        // Type character by character for React
        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            el.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
            fireInputEvent(el, text.substring(0, i + 1));
            el.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));
        }
    }

    /** Find a label/combobox by its visible text */
    function findFieldByLabel(labelText) {
        const elements = document.querySelectorAll('span, label');
        for (const el of elements) {
            if (el.textContent.trim().toLowerCase() === labelText.toLowerCase()) {
                // Walk up to find the containing label or combobox
                let parent = el.closest('label[role="combobox"]');
                if (parent) return parent;
                parent = el.closest('label');
                if (parent) {
                    const input = parent.querySelector('input, textarea');
                    if (input) return input;
                    return parent;
                }
            }
        }
        return null;
    }

    /** Click a combobox/dropdown, wait for options, then click the desired option */
    async function selectDropdownOption(labelText, optionText) {
        if (!optionText) return false;
        updateStatus(`Selecting ${labelText}: ${optionText}...`);
        const combo = findFieldByLabel(labelText);
        if (!combo) {
            updateStatus(`⚠ Could not find "${labelText}" dropdown`, 'warn');
            return false;
        }

        combo.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await sleep(300);

        // Click to open
        combo.click();
        combo.focus();
        await sleep(700);

        // Look for listbox options
        const options = Array.from(document.querySelectorAll('[role="option"]'));
        let targetOpt = null;

        // 1. First priority: exact case-insensitive match
        for (const opt of options) {
            const text = opt.textContent.trim().toLowerCase();
            if (text === optionText.toLowerCase()) {
                targetOpt = opt;
                break;
            }
        }

        // 2. Second priority: contains match (fallback)
        if (!targetOpt) {
            for (const opt of options) {
                const text = opt.textContent.trim().toLowerCase();
                if (text.includes(optionText.toLowerCase())) {
                    targetOpt = opt;
                    break;
                }
            }
        }

        if (targetOpt) {
            targetOpt.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            targetOpt.click();
            targetOpt.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            const inner = targetOpt.querySelector('span, div');
            if (inner) inner.click();
            await sleep(400);
            updateStatus(`✓ Selected ${labelText}: ${targetOpt.textContent.trim()}`);
            return true;
        }

        // If not found in role=option, try clicking li items
        const lis = Array.from(document.querySelectorAll('ul[role="listbox"] li'));
        for (const li of lis) {
            const text = li.textContent.trim().toLowerCase();
            if (text === optionText.toLowerCase() || text.includes(optionText.toLowerCase())) {
                li.click();
                const divInside = li.querySelector('div[role="none"]');
                if (divInside) divInside.click();
                await sleep(400);
                updateStatus(`✓ Selected ${labelText}: ${li.textContent.trim().substring(0, 30)}`);
                return true;
            }
        }

        updateStatus(`⚠ Option "${optionText}" not found for ${labelText}`, 'warn');
        // Click body to dismiss dropdown if left open
        document.body.click();
        return false;
    }

    /** Fill a text input field */
    async function fillTextField(labelText, value) {
        updateStatus(`Filling ${labelText}...`);
        const input = findFieldByLabel(labelText);
        if (!input) {
            updateStatus(`⚠ Could not find "${labelText}" field`, 'warn');
            return false;
        }

        simulateTyping(input, String(value));
        await sleep(300);
        updateStatus(`✓ Filled ${labelText}: ${String(value).substring(0, 30)}`);
        return true;
    }

    /** Fill the description textarea */
    async function fillDescription(text) {
        updateStatus('Filling Description...');
        const textareas = document.querySelectorAll('textarea');
        let target = null;

        for (const ta of textareas) {
            // Find the description textarea (usually the one that's visible and not tiny)
            if (ta.offsetHeight > 50 || ta.id) {
                target = ta;
                break;
            }
        }

        if (!target && textareas.length > 0) {
            target = textareas[textareas.length - 1];
        }

        if (!target) {
            updateStatus('⚠ Could not find description textarea', 'warn');
            return false;
        }

        target.focus();
        target.click();
        await sleep(200);

        // For React textareas
        const nativeSetter = Object.getOwnPropertyDescriptor(
            window.HTMLTextAreaElement.prototype, 'value'
        )?.set;
        if (nativeSetter) {
            nativeSetter.call(target, text);
        } else {
            target.value = text;
        }
        target.dispatchEvent(new Event('input', { bubbles: true }));
        target.dispatchEvent(new Event('change', { bubbles: true }));

        await sleep(300);
        updateStatus('✓ Filled Description');
        return true;
    }

    /** Upload images via the file input element using the Flask proxy */
    async function uploadImages(imageUrls) {
        const toUpload = (imageUrls || []).slice(0, MAX_IMAGES);
        updateStatus(`Uploading ${toUpload.length} images (max ${MAX_IMAGES})...`);
        setProgress(0);

        // Find the file input (Facebook creates a hidden one for the photo upload area)
        // We need to look for the "Add photos" button area and its associated input
        const fileInputs = document.querySelectorAll('input[type="file"]');
        let fileInput = null;

        for (const fi of fileInputs) {
            if (fi.accept && fi.accept.includes('image')) {
                fileInput = fi;
                break;
            }
        }

        if (!fileInput && fileInputs.length > 0) {
            fileInput = fileInputs[0];
        }

        if (!fileInput) {
            // Try to find and click the "Add photos" button to create the file input
            const addPhotosBtn = document.querySelector('[role="button"]');
            const allBtns = document.querySelectorAll('[role="button"]');
            for (const btn of allBtns) {
                if (btn.textContent.includes('Add photos')) {
                    btn.click();
                    await sleep(500);
                    break;
                }
            }

            // Re-check for file inputs
            const newInputs = document.querySelectorAll('input[type="file"]');
            for (const fi of newInputs) {
                if (fi.accept && fi.accept.includes('image')) {
                    fileInput = fi;
                    break;
                }
            }
            if (!fileInput && newInputs.length > 0) {
                fileInput = newInputs[0];
            }
        }

        if (!fileInput) {
            updateStatus('⚠ Could not find file input for photos', 'warn');
            return false;
        }

        // Download all images via Flask proxy and create File objects
        const files = [];
        for (let i = 0; i < toUpload.length; i++) {
            const url = toUpload[i];
            updateStatus(`Downloading image ${i + 1}/${toUpload.length}...`);
            setProgress(((i) / toUpload.length) * 100);

            try {
                const blob = await new Promise((resolve, reject) => {
                    GM_xmlhttpRequest({
                        method: 'GET',
                        url: `${FLASK_SERVER}/api/proxy-image?url=${encodeURIComponent(url)}`,
                        responseType: 'blob',
                        onload: (resp) => {
                            if (resp.status === 200) {
                                resolve(resp.response);
                            } else {
                                reject(new Error(`HTTP ${resp.status}`));
                            }
                        },
                        onerror: reject,
                        ontimeout: () => reject(new Error('Timeout'))
                    });
                });

                const file = new File([blob], `vehicle_${i + 1}.jpg`, {
                    type: blob.type || 'image/jpeg'
                });
                files.push(file);
            } catch (err) {
                console.warn(`[N2M] Failed to download image ${i + 1}:`, err);
                updateStatus(`⚠ Failed image ${i + 1}, skipping...`, 'warn');
            }
            await sleep(200);
        }

        if (files.length === 0) {
            updateStatus('⚠ No images were downloaded successfully', 'warn');
            return false;
        }

        updateStatus(`Setting ${files.length} files on input...`);

        // Create a DataTransfer to set multiple files
        const dt = new DataTransfer();
        files.forEach(f => dt.items.add(f));

        // Set the files on the input
        fileInput.files = dt.files;

        // Fire change event
        fileInput.dispatchEvent(new Event('change', { bubbles: true }));
        fileInput.dispatchEvent(new Event('input', { bubbles: true }));

        await sleep(1000);
        setProgress(100);
        updateStatus(`✓ Uploaded ${files.length} images`);
        return true;
    }

    /** Fill location and select first suggestion */
    async function fillLocation(locationText) {
        updateStatus(`Setting location: ${locationText}...`);

        const locationInput = findFieldByLabel('Location');
        if (!locationInput) {
            updateStatus('⚠ Could not find Location field', 'warn');
            return false;
        }

        // Clear and type location
        locationInput.focus();
        locationInput.click();
        await sleep(300);

        simulateTyping(locationInput, locationText);
        await sleep(LOCATION_WAIT);

        // Wait for suggestions dropdown
        const listbox = document.querySelector('ul[role="listbox"]');
        if (listbox) {
            const firstOption = listbox.querySelector('li[role="option"]');
            if (firstOption) {
                // Click the first option
                firstOption.click();
                const innerDiv = firstOption.querySelector('div[role="none"]');
                if (innerDiv) innerDiv.click();
                await sleep(500);
                updateStatus(`✓ Selected location: ${firstOption.textContent.substring(0, 40)}`);
                return true;
            }
        }

        updateStatus('⚠ No location suggestions appeared, typed value remains', 'warn');
        return true;
    }

    /** Toggle the "This vehicle has a clean title." checkbox */
    async function setCleanTitle(desiredChecked = true) {
        updateStatus(`Setting Clean Title: ${desiredChecked ? 'ON' : 'OFF'}...`);
        const checkbox = document.querySelector('input[name="title_status"]') ||
                         document.querySelector('input[aria-label="This vehicle has a clean title."]');
        if (!checkbox) {
            updateStatus('⚠ Clean title checkbox not found', 'warn');
            return false;
        }

        checkbox.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await sleep(200);

        const isCurrentlyChecked = checkbox.checked || checkbox.getAttribute('aria-checked') === 'true';
        if (isCurrentlyChecked !== desiredChecked) {
            checkbox.click();
            checkbox.dispatchEvent(new Event('change', { bubbles: true }));
            await sleep(300);
            updateStatus(`✓ Set Clean Title: ${desiredChecked ? 'Checked' : 'Unchecked'}`);
        } else {
            updateStatus(`✓ Clean Title already ${desiredChecked ? 'Checked' : 'Unchecked'}`);
        }
        return true;
    }

    // ── MAIN FILL FUNCTION ────────────────────────────────────────────────

    async function fillVehicleForm(vehicle) {
        const fillBtn = document.getElementById('n2m-fill-btn');
        if (fillBtn) fillBtn.disabled = true;
        setProgress(0);

        try {
            const totalSteps = 15;
            let step = 0;

            // 1. Vehicle Type
            step++;
            setProgress((step / totalSteps) * 100);
            await selectDropdownOption('Vehicle type', 'Car/truck');
            await sleep(FILL_DELAY);

            // 2. Upload Images
            step++;
            setProgress((step / totalSteps) * 100);
            if (vehicle.images && vehicle.images.length > 0) {
                await uploadImages(vehicle.images);
            }
            await sleep(FILL_DELAY);

            // 3. Year
            step++;
            setProgress((step / totalSteps) * 100);
            await selectDropdownOption('Year', String(vehicle.year));
            await sleep(FILL_DELAY);

            // 4. Make
            step++;
            setProgress((step / totalSteps) * 100);
            await fillTextField('Make', vehicle.make);
            await sleep(FILL_DELAY);

            // 5. Model
            step++;
            setProgress((step / totalSteps) * 100);
            await fillTextField('Model', vehicle.model);
            await sleep(FILL_DELAY);

            // 6. Body style
            step++;
            setProgress((step / totalSteps) * 100);
            if (vehicle.body_style) {
                await selectDropdownOption('Body style', vehicle.body_style);
                await sleep(FILL_DELAY);
            }

            // 7. Exterior color
            step++;
            setProgress((step / totalSteps) * 100);
            if (vehicle.exterior_color) {
                await selectDropdownOption('Exterior color', vehicle.exterior_color);
                await sleep(FILL_DELAY);
            }

            // 8. Interior color (optional: falls back to Black if not specified)
            step++;
            setProgress((step / totalSteps) * 100);
            const intColor = vehicle.interior_color || 'Black';
            if (intColor) {
                await selectDropdownOption('Interior color', intColor);
                await sleep(FILL_DELAY);
            }

            // 9. Clean Title (from UI toggle)
            step++;
            setProgress((step / totalSteps) * 100);
            const cleanTitleWanted = document.getElementById('n2m-clean-title-toggle')?.checked ?? true;
            await setCleanTitle(cleanTitleWanted);
            await sleep(FILL_DELAY);

            // 10. Vehicle condition
            step++;
            setProgress((step / totalSteps) * 100);
            if (vehicle.condition) {
                await selectDropdownOption('Vehicle condition', vehicle.condition);
                await sleep(FILL_DELAY);
            }

            // 11. Fuel type
            step++;
            setProgress((step / totalSteps) * 100);
            if (vehicle.fuel_type) {
                await selectDropdownOption('Fuel type', vehicle.fuel_type);
                await sleep(FILL_DELAY);
            }

            // 12. Transmission
            step++;
            setProgress((step / totalSteps) * 100);
            if (vehicle.transmission) {
                await selectDropdownOption('Transmission', vehicle.transmission);
                await sleep(FILL_DELAY);
            }

            // 13. Price
            step++;
            setProgress((step / totalSteps) * 100);
            await fillTextField('Price', vehicle.price);
            await sleep(FILL_DELAY);

            // 14. Location
            step++;
            setProgress((step / totalSteps) * 100);
            await fillLocation(LOCATION_TEXT);
            await sleep(FILL_DELAY);

            // 15. Description
            step++;
            setProgress((step / totalSteps) * 100);
            await fillDescription(vehicle.description);
            await sleep(300);

            setProgress(100);
            updateStatus('✅ All fields filled! Review and submit manually.', 'success');
        } catch (err) {
            console.error('[N2M] Error filling form:', err);
            updateStatus(`❌ Error: ${err.message}`, 'error');
        } finally {
            if (fillBtn) fillBtn.disabled = false;
        }
    }

    // ── UI ─────────────────────────────────────────────────────────────────

    let currentVehicles = [];
    let selectedVehicle = null;
    let currentPage = 1;
    let totalPages = 1;
    let searchTerm = '';
    let searchTimeout = null;

    function createPanel() {
        // Toggle button
        const toggle = document.createElement('button');
        toggle.id = 'n2m-toggle';
        toggle.innerHTML = '◀';
        toggle.addEventListener('click', () => {
            panel.classList.toggle('collapsed');
            toggle.classList.toggle('collapsed');
            toggle.innerHTML = panel.classList.contains('collapsed') ? '▶' : '◀';
        });
        document.body.appendChild(toggle);

        // Main panel
        const panel = document.createElement('div');
        panel.id = 'n2m-panel';
        panel.innerHTML = `
            <div id="n2m-header">
                <h2>🚗 Nucar → Marketplace</h2>
                <span class="badge" id="n2m-count">...</span>
            </div>
            <div id="n2m-search">
                <input type="text" placeholder="Search by make, model, VIN, stock..." id="n2m-search-input" />
            </div>
            <div id="n2m-list"></div>
            <div class="n2m-pagination">
                <button id="n2m-prev" disabled>◀ Prev</button>
                <span id="n2m-page-info">Page 1/1</span>
                <button id="n2m-next" disabled>Next ▶</button>
            </div>
            <div id="n2m-status">
                <div class="status-text" id="n2m-status-text">
                    Connecting to Flask server...
                </div>
                <div style="margin: 8px 0; display: flex; align-items: center; justify-content: space-between; font-size: 12px; background: #1a1a2e; padding: 6px 10px; border-radius: 6px;">
                    <label style="display:flex; align-items:center; gap:8px; cursor:pointer;" title="Check or uncheck 'This vehicle has a clean title.' on Facebook">
                        <input type="checkbox" id="n2m-clean-title-toggle" checked style="accent-color: #e94560; width: 15px; height: 15px; cursor: pointer;" />
                        <span>This vehicle has a clean title</span>
                    </label>
                </div>
                <button class="n2m-btn n2m-btn-fill" id="n2m-fill-btn" disabled>
                    Select a vehicle to fill form
                </button>
                <div class="n2m-progress">
                    <div class="n2m-progress-bar" id="n2m-progress-bar"></div>
                </div>
            </div>
        `;
        document.body.appendChild(panel);

        // Event listeners
        document.getElementById('n2m-search-input').addEventListener('input', (e) => {
            searchTerm = e.target.value;
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                currentPage = 1;
                loadVehicles();
            }, 400);
        });

        document.getElementById('n2m-prev').addEventListener('click', () => {
            if (currentPage > 1) {
                currentPage--;
                loadVehicles();
            }
        });

        document.getElementById('n2m-next').addEventListener('click', () => {
            if (currentPage < totalPages) {
                currentPage++;
                loadVehicles();
            }
        });

        document.getElementById('n2m-fill-btn').addEventListener('click', () => {
            if (selectedVehicle) {
                fillVehicleForm(selectedVehicle);
            }
        });
    }

    function updateStatus(text, type = 'info') {
        const el = document.getElementById('n2m-status-text');
        if (!el) return;

        const colors = {
            info: '#e0e0e0',
            success: '#4ecca3',
            warn: '#ffc107',
            error: '#e94560'
        };

        el.style.color = colors[type] || colors.info;
        el.innerHTML = text;
        console.log(`[N2M] ${text}`);
    }

    function setProgress(pct) {
        const bar = document.getElementById('n2m-progress-bar');
        if (bar) bar.style.width = `${Math.min(100, pct)}%`;
    }

    function renderVehicles() {
        const list = document.getElementById('n2m-list');
        if (!list) return;

        list.innerHTML = '';
        currentVehicles.forEach(v => {
            const card = document.createElement('div');
            card.className = `n2m-card${selectedVehicle?.vin === v.vin ? ' active' : ''}`;
            card.innerHTML = `
                <img src="${v.thumbnail || ''}" alt="${v.make} ${v.model}" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2270%22 height=%2252%22><rect fill=%22%23333%22 width=%2270%22 height=%2252%22/><text fill=%22%23888%22 x=%2210%22 y=%2230%22 font-size=%2210%22>No img</text></svg>'" />
                <div class="n2m-card-info">
                    <div class="n2m-card-title">${v.year} ${v.make} ${v.model} ${v.trim || ''}</div>
                    <div class="n2m-card-meta">
                        VIN: ${v.vin?.substring(v.vin.length - 6) || '?'} · ${v.body_style || v.body_type || ''} · ${v.exterior_color || v.raw_exterior_color || ''} · ${v.mileage?.toLocaleString() || '?'} mi
                    </div>
                </div>
                <div class="n2m-card-price">$${v.price?.toLocaleString() || '0'}</div>
            `;
            card.addEventListener('click', () => {
                selectedVehicle = v;
                const fillBtn = document.getElementById('n2m-fill-btn');
                if (fillBtn) {
                    fillBtn.disabled = false;
                    fillBtn.textContent = `Fill Form: ${v.year} ${v.make} ${v.model}`;
                }
                renderVehicles();
            });
            list.appendChild(card);
        });

        // Update pagination
        document.getElementById('n2m-page-info').textContent = `Page ${currentPage}/${totalPages}`;
        document.getElementById('n2m-prev').disabled = currentPage <= 1;
        document.getElementById('n2m-next').disabled = currentPage >= totalPages;
    }

    function loadVehicles() {
        updateStatus('<span class="spinner"></span> Loading vehicles...');

        const url = `${FLASK_SERVER}/api/vehicles?page=${currentPage}&per_page=30&search=${encodeURIComponent(searchTerm)}`;

        GM_xmlhttpRequest({
            method: 'GET',
            url: url,
            onload: (resp) => {
                try {
                    const data = JSON.parse(resp.responseText);
                    currentVehicles = data.vehicles || [];
                    totalPages = data.total_pages || 1;
                    document.getElementById('n2m-count').textContent = `${data.total} vehicles`;
                    renderVehicles();
                    updateStatus(`Loaded ${currentVehicles.length} vehicles (page ${currentPage}/${totalPages})`);
                } catch (e) {
                    updateStatus('❌ Failed to parse vehicle data', 'error');
                }
            },
            onerror: () => {
                updateStatus('❌ Cannot connect to Flask server (http://127.0.0.1:5000). Is it running?', 'error');
            },
            ontimeout: () => {
                updateStatus('❌ Flask server timeout', 'error');
            }
        });
    }

    // ── INIT ──────────────────────────────────────────────────────────────

    function init() {
        console.log('[N2M] Nucar → Marketplace script loaded');

        // Wait a bit for FB page to fully render
        setTimeout(() => {
            createPanel();
            loadVehicles();
        }, 2000);
    }

    // Run
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        init();
    } else {
        window.addEventListener('DOMContentLoaded', init);
    }

})();
