// ==UserScript==
// @name         Nucar → Facebook Marketplace Vehicle Poster
// @namespace    https://nucar2market.local
// @version      1.3.1
// @description  Auto-fill & batch-post Facebook Marketplace vehicle listings from Nucar inventory via Flask server
// @author       Nucar2Market
// @match        https://www.facebook.com/marketplace/create/vehicle*
// @match        https://www.facebook.com/marketplace/you/selling*
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
    let LOCATION_TEXT = 'Tilton, New Hampshire';  // Loaded dynamically from Flask /api/config
    let MAX_IMAGES = 20;        // Maximum photos to upload (Facebook limit is typically 20)
    const FILL_DELAY = 800;       // ms between each field fill
    const IMAGE_DELAY = 2000;     // ms between each image upload
    const LOCATION_WAIT = 2500;   // ms to wait for location dropdown to appear
    let POST_INTERVAL = 300000; // ms between auto-posts (default 5 minutes)
    const CREATE_PAGE = 'https://www.facebook.com/marketplace/create/vehicle';

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

    /** Click a button by aria-label or visible text (e.g. "Next" or "Publish") */
    async function clickButtonByAriaLabel(label, timeoutMs = 15000) {
        const startTime = Date.now();
        updateStatus(`Looking for "${label}" button...`);

        // Possible alternate labels for Publish/Next
        const searchLabels = [label];
        if (label.toLowerCase() === 'publish') {
            searchLabels.push('Publish', 'Post', 'Submit', 'Share');
        } else if (label.toLowerCase() === 'next') {
            searchLabels.push('Next', 'Continue');
        }

        while (Date.now() - startTime < timeoutMs) {
            let btn = null;

            // Search by aria-label
            for (const l of searchLabels) {
                btn = document.querySelector(`div[aria-label="${l}"][role="button"], [aria-label="${l}"][role="button"], button[aria-label="${l}"], [aria-label="${l}"]`);
                if (btn && btn.offsetWidth > 0 && btn.offsetHeight > 0) break;
            }

            // Search by textContent
            if (!btn) {
                const candidates = document.querySelectorAll('[role="button"], button, div[tabindex="0"]');
                for (const c of candidates) {
                    if (c.offsetWidth === 0 || c.offsetHeight === 0) continue;
                    const ariaLabel = (c.getAttribute('aria-label') || '').trim();
                    const text = (c.textContent || '').trim();

                    for (const l of searchLabels) {
                        if (ariaLabel.toLowerCase() === l.toLowerCase() || text.toLowerCase() === l.toLowerCase()) {
                            btn = c;
                            break;
                        }
                    }
                    if (btn) break;
                }
            }

            if (btn && btn.offsetWidth > 0 && btn.offsetHeight > 0) {
                const isDisabled = btn.getAttribute('aria-disabled') === 'true' ||
                                   btn.disabled ||
                                   btn.getAttribute('disabled') !== null;

                if (isDisabled) {
                    updateStatus(`⏳ Found "${label}" button, but it is currently disabled. Waiting for Facebook validation / uploads...`);
                    await sleep(1000);
                    continue; // Keep waiting until timeout
                }

                btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
                await sleep(400);

                // Simulate human pointer and mouse sequence for React 18
                try {
                    btn.focus();
                    btn.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, cancelable: true, view: window }));
                    btn.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true, view: window }));
                    btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, view: window, isPrimary: true, button: 0 }));
                    btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window, button: 0 }));
                    await sleep(50);
                    btn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, view: window, isPrimary: true, button: 0 }));
                    btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window, button: 0 }));
                    btn.click();

                    // Also click inner span/div if present
                    const inner = btn.querySelector('span, div[role="none"]');
                    if (inner) inner.click();
                } catch (e) {
                    btn.click();
                }

                updateStatus(`✓ Clicked "${label}" button`, 'success');
                return true;
            }

            await sleep(600);
        }

        updateStatus(`⚠ Could not find active "${label}" button within timeout`, 'warn');
        return false;
    }

    // ── QUEUE STATE ─────────────────────────────────────────────────────────
    let postQueue = [];       // Array of vehicle objects to post
    let queueIndex = 0;       // Current position in queue
    let queueRunning = false; // Is the auto-post queue active?
    let queuePaused = false;  // Is the queue paused waiting for user to publish?

    /** Mark a vehicle as posted in the Flask tracker */
    async function trackPosted(vehicle) {
        return new Promise((resolve) => {
            GM_xmlhttpRequest({
                method: 'POST',
                url: `${FLASK_SERVER}/api/track-posted`,
                headers: { 'Content-Type': 'application/json' },
                data: JSON.stringify({
                    vin: vehicle.vin,
                    title: `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
                    price: vehicle.price,
                    year: vehicle.year,
                    make: vehicle.make,
                    model: vehicle.model,
                }),
                onload: (resp) => {
                    console.log('[N2M] Tracked posted:', resp.responseText);
                    resolve(true);
                },
                onerror: () => resolve(false),
            });
        });
    }

    /** Load the posting queue (unposted vehicles) from Flask */
    async function loadQueue() {
        return new Promise((resolve) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: `${FLASK_SERVER}/api/queue`,
                onload: (resp) => {
                    try {
                        const data = JSON.parse(resp.responseText);
                        resolve(data.vehicles || []);
                    } catch (e) {
                        resolve([]);
                    }
                },
                onerror: () => resolve([]),
            });
        });
    }

    /** Start the auto-post queue */
    async function startQueue() {
        postQueue = await loadQueue();
        if (postQueue.length === 0) {
            updateStatus('✅ No new vehicles to post! All caught up.', 'success');
            return;
        }
        queueIndex = 0;
        queueRunning = true;
        queuePaused = false;
        updateQueueUI();
        updateStatus(`🚀 Queue started: ${postQueue.length} vehicles to post`);

        // Navigate to create page if not already there
        if (!window.location.href.includes('/marketplace/create/vehicle')) {
            window.location.href = CREATE_PAGE;
            // The script will re-init on the new page; store queue in sessionStorage
            sessionStorage.setItem('n2m_queue', JSON.stringify(postQueue));
            sessionStorage.setItem('n2m_queue_index', '0');
            sessionStorage.setItem('n2m_queue_running', 'true');
            return;
        }

        // Start filling the first vehicle
        await processNextInQueue();
    }

    /** Process the next vehicle in the queue */
    async function processNextInQueue() {
        if (!queueRunning || queueIndex >= postQueue.length) {
            queueRunning = false;
            updateStatus(`✅ Queue complete! Posted ${queueIndex} vehicles.`, 'success');
            updateQueueUI();
            sessionStorage.removeItem('n2m_queue');
            sessionStorage.removeItem('n2m_queue_index');
            sessionStorage.removeItem('n2m_queue_running');
            return;
        }

        const vehicle = postQueue[queueIndex];
        selectedVehicle = vehicle;
        updateStatus(`📦 Queue: ${queueIndex + 1}/${postQueue.length} — ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
        renderVehicles();
        updateQueueUI();

        // Fill the form
        await fillVehicleForm(vehicle);

        // Track it as posted
        await trackPosted(vehicle);

        // Now wait for user to review and publish
        queuePaused = true;
        updateStatus(
            `✅ Form filled! Review and click "Publish" on Facebook, then click "Next Vehicle" below.`,
            'success'
        );
        updateQueueUI();
    }

    /** Move to next vehicle after user confirms they published */
    async function advanceQueue() {
        queuePaused = false;
        queueIndex++;

        // Save progress
        sessionStorage.setItem('n2m_queue_index', String(queueIndex));

        if (queueIndex >= postQueue.length) {
            queueRunning = false;
            updateStatus(`🎉 All ${postQueue.length} vehicles posted!`, 'success');
            updateQueueUI();
            sessionStorage.removeItem('n2m_queue');
            sessionStorage.removeItem('n2m_queue_index');
            sessionStorage.removeItem('n2m_queue_running');
            return;
        }

        updateStatus(`⏳ Waiting ${POST_INTERVAL / 1000}s before next post...`);

        // Navigate to fresh create page
        await sleep(2000);
        window.location.href = CREATE_PAGE;
        // On reload, the queue will resume from sessionStorage
    }

    /** Stop the queue */
    function stopQueue() {
        queueRunning = false;
        queuePaused = false;
        postQueue = [];
        queueIndex = 0;
        sessionStorage.removeItem('n2m_queue');
        sessionStorage.removeItem('n2m_queue_index');
        sessionStorage.removeItem('n2m_queue_running');
        updateStatus('Queue stopped.');
        updateQueueUI();
    }

    /** Resume queue from sessionStorage (after page navigation) */
    function resumeQueueIfNeeded() {
        const savedQueue = sessionStorage.getItem('n2m_queue');
        const savedIndex = sessionStorage.getItem('n2m_queue_index');
        const savedRunning = sessionStorage.getItem('n2m_queue_running');

        if (savedQueue && savedRunning === 'true') {
            postQueue = JSON.parse(savedQueue);
            queueIndex = parseInt(savedIndex || '0', 10);
            queueRunning = true;
            queuePaused = false;
            updateQueueUI();

            // Wait for page to fully load, then process next
            setTimeout(async () => {
                updateStatus(`🔄 Resuming queue: vehicle ${queueIndex + 1}/${postQueue.length}`);
                await processNextInQueue();
            }, 4000);
        }
    }

    // ── MAIN FILL FUNCTION ────────────────────────────────────────────────

    async function fillVehicleForm(vehicle) {
        const fillBtn = document.getElementById('n2m-fill-btn');
        if (fillBtn) fillBtn.disabled = true;
        setProgress(0);

        try {
            const totalSteps = 16;
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

            // 13. Mileage
            step++;
            setProgress((step / totalSteps) * 100);
            if (vehicle.mileage !== undefined && vehicle.mileage !== null) {
                let mVal = parseInt(String(vehicle.mileage).replace(/,/g, ''), 10);
                if (isNaN(mVal) || mVal < 300) {
                    // Facebook requirement: "Please add mileage between 300 and 1,000,000"
                    // Brand new vehicles (e.g. 6 or 10 miles) must be set to at least 300 to pass FB validation.
                    mVal = 300;
                    updateStatus(`ℹ Low mileage (${vehicle.mileage} mi); set to FB minimum 300`);
                } else if (mVal > 1000000) {
                    mVal = 1000000;
                }
                await fillTextField('Mileage', mVal);
                await sleep(FILL_DELAY);
            }

            // 14. Price
            step++;
            setProgress((step / totalSteps) * 100);
            await fillTextField('Price', vehicle.price);
            await sleep(FILL_DELAY);

            // 15. Location
            step++;
            setProgress((step / totalSteps) * 100);
            await fillLocation(LOCATION_TEXT);
            await sleep(FILL_DELAY);

            // 16. Description
            step++;
            setProgress((step / totalSteps) * 100);
            await fillDescription(vehicle.description);
            await sleep(300);

            setProgress(100);

            // Save active vehicle info to sessionStorage so we track it when Facebook redirects to /marketplace/you/selling
            sessionStorage.setItem('n2m_posting_vin', vehicle.vin);
            sessionStorage.setItem('n2m_posting_title', `${vehicle.year} ${vehicle.make} ${vehicle.model} ${vehicle.trim || ''}`.trim());
            sessionStorage.setItem('n2m_posting_price', String(vehicle.price || 0));

            const autoPublish = document.getElementById('n2m-auto-publish-toggle')?.checked ?? true;
            if (autoPublish) {
                updateStatus('✅ All fields filled! Auto-publishing in 1.5s...', 'info');
                await sleep(1500);

                // Step A: Click "Next"
                updateStatus('⏳ Clicking "Next" button...');
                const nextClicked = await clickButtonByAriaLabel('Next', 10000);
                if (nextClicked) {
                    updateStatus('⏳ Review step loaded. Waiting for "Publish" button...');
                    await sleep(2500);

                    // Step B: Click "Publish"
                    const publishClicked = await clickButtonByAriaLabel('Publish', 15000);
                    if (publishClicked) {
                        updateStatus('🚀 Clicked "Publish"! Waiting for Facebook confirmation & redirect...', 'success');
                    } else {
                        updateStatus('⚠ "Publish" button not found. Please click Publish manually.', 'warn');
                    }
                } else {
                    updateStatus('⚠ "Next" button not found. Please click Next manually.', 'warn');
                }
            } else {
                updateStatus('✅ All fields filled! Review and submit manually.', 'success');
            }
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
                <div style="margin: 8px 0; display: flex; flex-direction: column; gap: 6px; font-size: 12px; background: #1a1a2e; padding: 8px 10px; border-radius: 6px;">
                    <label style="display:flex; align-items:center; gap:8px; cursor:pointer;" title="Check or uncheck 'This vehicle has a clean title.' on Facebook">
                        <input type="checkbox" id="n2m-clean-title-toggle" checked style="accent-color: #e94560; width: 15px; height: 15px; cursor: pointer;" />
                        <span>This vehicle has a clean title</span>
                    </label>
                    <label style="display:flex; align-items:center; gap:8px; cursor:pointer;" title="Automatically click Next & Publish, confirm success on selling page, and loop to next vehicle">
                        <input type="checkbox" id="n2m-auto-publish-toggle" checked style="accent-color: #4ecca3; width: 15px; height: 15px; cursor: pointer;" />
                        <span style="color:#4ecca3; font-weight:600;">⚡ Auto-Click Next & Publish</span>
                    </label>
                </div>
                <div id="n2m-stats-bar" style="display:flex; gap:6px; margin-bottom:8px; font-size:11px;">
                    <span style="background:#0f3460; padding:3px 8px; border-radius:4px;" id="n2m-stat-total">Total: ...</span>
                    <span style="background:#1b5e20; padding:3px 8px; border-radius:4px;" id="n2m-stat-posted">✅ Posted: 0</span>
                    <span style="background:#b71c1c; padding:3px 8px; border-radius:4px;" id="n2m-stat-unposted">📦 Queue: 0</span>
                    <span style="background:#4a148c; padding:3px 8px; border-radius:4px;" id="n2m-stat-sold">💰 Sold: 0</span>
                </div>
                <button class="n2m-btn n2m-btn-fill" id="n2m-fill-btn" disabled>
                    Select a vehicle to fill form
                </button>
                <div id="n2m-queue-controls" style="display:flex; gap:6px; margin-top:8px;">
                    <button class="n2m-btn" id="n2m-post-all-btn" style="flex:1; background:linear-gradient(135deg, #1b5e20, #2e7d32); color:white; font-size:12px;">
                        🚀 Post All New
                    </button>
                    <button class="n2m-btn" id="n2m-next-btn" style="flex:1; background:linear-gradient(135deg, #0f3460, #1565c0); color:white; font-size:12px; display:none;">
                        ➡️ Next Vehicle
                    </button>
                    <button class="n2m-btn" id="n2m-stop-btn" style="flex:0.5; background:#b71c1c; color:white; font-size:12px; display:none;">
                        ⏹ Stop
                    </button>
                </div>
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

        document.getElementById('n2m-post-all-btn').addEventListener('click', () => {
            startQueue();
        });

        document.getElementById('n2m-next-btn').addEventListener('click', () => {
            advanceQueue();
        });

        document.getElementById('n2m-stop-btn').addEventListener('click', () => {
            stopQueue();
        });

        // Load stats
        loadStats();
    }

    let currentStatusText = 'Idle';
    let currentProgressPct = 0;

    function updateStatus(text, type = 'info') {
        currentStatusText = text;
        const el = document.getElementById('n2m-status-text');
        if (el) {
            const colors = {
                info: '#e0e0e0',
                success: '#4ecca3',
                warn: '#ffc107',
                error: '#e94560'
            };

            el.style.color = colors[type] || colors.info;
            el.innerHTML = text;
        }
        console.log(`[N2M] ${text}`);

        // Forward log to Flask dashboard live terminal
        try {
            GM_xmlhttpRequest({
                method: 'POST',
                url: `${FLASK_SERVER}/api/bot/log`,
                headers: { 'Content-Type': 'application/json' },
                data: JSON.stringify({
                    level: type,
                    message: String(text).replace(/<[^>]+>/g, '')
                })
            });
        } catch (e) {}
    }

    function setProgress(pct) {
        currentProgressPct = pct;
        const bar = document.getElementById('n2m-progress-bar');
        if (bar) bar.style.width = `${Math.min(100, pct)}%`;
    }

    // ── FLASK DASHBOARD COMMAND LISTENER & HEARTBEAT ───────────────────────
    let heartbeatInterval = null;

    function startHeartbeatLoop() {
        if (heartbeatInterval) clearInterval(heartbeatInterval);

        async function sendHeartbeat() {
            try {
                GM_xmlhttpRequest({
                    method: 'POST',
                    url: `${FLASK_SERVER}/api/bot/heartbeat`,
                    headers: { 'Content-Type': 'application/json' },
                    data: JSON.stringify({
                        status: queueRunning ? (queuePaused ? 'waiting_for_publish' : 'filling') : (selectedVehicle ? 'ready' : 'idle'),
                        current_step: String(currentStatusText).replace(/<[^>]+>/g, ''),
                        progress: currentProgressPct,
                        current_vehicle: selectedVehicle ? {
                            vin: selectedVehicle.vin,
                            title: `${selectedVehicle.year} ${selectedVehicle.make} ${selectedVehicle.model}`,
                            price: selectedVehicle.price
                        } : null
                    }),
                    onload: async (resp) => {
                        try {
                            const data = JSON.parse(resp.responseText);
                            if (data.command) {
                                await handleRemoteCommand(data.command);
                            }
                        } catch (e) {}
                    }
                });
            } catch (err) {}
        }

        // Send initial ping, then poll every 1500ms
        sendHeartbeat();
        heartbeatInterval = setInterval(sendHeartbeat, 1500);
    }

    async function handleRemoteCommand(cmd) {
        console.log('[N2M] Received remote command from Dashboard:', cmd);
        updateStatus(`⚡ Received Dashboard Command: ${cmd.type}`, 'info');

        switch (cmd.type) {
            case 'FILL_VEHICLE':
                if (cmd.vin) {
                    let vehicle = currentVehicles.find(v => v.vin === cmd.vin);
                    if (!vehicle) {
                        try {
                            const res = await new Promise(resolve => {
                                GM_xmlhttpRequest({
                                    method: 'GET',
                                    url: `${FLASK_SERVER}/api/vehicle/${cmd.vin}`,
                                    onload: r => resolve(JSON.parse(r.responseText))
                                });
                            });
                            vehicle = res;
                        } catch (e) {}
                    }
                    if (vehicle) {
                        selectedVehicle = vehicle;
                        renderVehicles();
                        await fillVehicleForm(vehicle);
                        await trackPosted(vehicle);
                    }
                }
                break;

            case 'START_QUEUE':
                await startQueue();
                break;

            case 'NEXT_VEHICLE':
                await advanceQueue();
                break;

            case 'STOP_QUEUE':
                stopQueue();
                break;

            default:
                console.warn('[N2M] Unknown command:', cmd);
        }
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
                    <div class="n2m-card-title">
                        ${v.posted ? '<span style="color:#4ecca3; font-size:10px;">✅</span> ' : ''}
                        ${v.year} ${v.make} ${v.model} ${v.trim || ''}
                    </div>
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

    function updateQueueUI() {
        const postAllBtn = document.getElementById('n2m-post-all-btn');
        const nextBtn = document.getElementById('n2m-next-btn');
        const stopBtn = document.getElementById('n2m-stop-btn');

        if (!postAllBtn) return;

        if (queueRunning) {
            postAllBtn.style.display = 'none';
            stopBtn.style.display = 'block';
            nextBtn.style.display = queuePaused ? 'block' : 'none';
            if (queuePaused) {
                nextBtn.textContent = queueIndex + 1 < postQueue.length
                    ? `➡️ Next (${queueIndex + 2}/${postQueue.length})`
                    : '✅ Finish Queue';
            }
        } else {
            postAllBtn.style.display = 'block';
            nextBtn.style.display = 'none';
            stopBtn.style.display = 'none';
        }
    }

    function loadStats() {
        GM_xmlhttpRequest({
            method: 'GET',
            url: `${FLASK_SERVER}/api/stats`,
            onload: (resp) => {
                try {
                    const s = JSON.parse(resp.responseText);
                    const el = (id) => document.getElementById(id);
                    if (el('n2m-stat-total')) el('n2m-stat-total').textContent = `Total: ${s.total_inventory}`;
                    if (el('n2m-stat-posted')) el('n2m-stat-posted').textContent = `✅ Posted: ${s.total_posted}`;
                    if (el('n2m-stat-unposted')) el('n2m-stat-unposted').textContent = `📦 Queue: ${s.total_unposted}`;
                    if (el('n2m-stat-sold')) el('n2m-stat-sold').textContent = `💰 Sold: ${s.total_sold}`;
                    // Update Post All button text
                    const postAllBtn = document.getElementById('n2m-post-all-btn');
                    if (postAllBtn && !queueRunning) {
                        postAllBtn.textContent = `🚀 Post All New (${s.total_unposted})`;
                    }
                    // Also load remote settings
                    loadRemoteConfig();
                } catch (e) {
                    console.warn('[N2M] Failed to load stats:', e);
                }
            },
        });
    }

    function loadRemoteConfig() {
        GM_xmlhttpRequest({
            method: 'GET',
            url: `${FLASK_SERVER}/api/config`,
            onload: (resp) => {
                try {
                    const cfg = JSON.parse(resp.responseText);
                    if (cfg.fb_location) LOCATION_TEXT = cfg.fb_location;
                    if (cfg.max_images) MAX_IMAGES = cfg.max_images;
                    if (cfg.post_interval_seconds) POST_INTERVAL = cfg.post_interval_seconds * 1000;
                    if (cfg.clean_title !== undefined) {
                        const toggle = document.getElementById('n2m-clean-title-toggle');
                        if (toggle) toggle.checked = cfg.clean_title;
                    }
                } catch (e) {}
            }
        });
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

    // ── HANDLE REDIRECT TO /marketplace/you/selling ───────────────────────
    async function handleSellingRedirect() {
        const postingVin = sessionStorage.getItem('n2m_posting_vin');
        const postingTitle = sessionStorage.getItem('n2m_posting_title') || 'Vehicle';
        const postingPrice = sessionStorage.getItem('n2m_posting_price') || 0;
        const isQueue = sessionStorage.getItem('n2m_queue_running') === 'true';

        console.log('[N2M] Detected Facebook Marketplace Selling page. Successful publish!');

        // Create overlay notification banner
        const banner = document.createElement('div');
        banner.style.cssText = `
            position: fixed;
            top: 24px;
            right: 24px;
            z-index: 999999;
            background: linear-gradient(135deg, #10b981, #059669);
            color: white;
            padding: 16px 24px;
            border-radius: 12px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.5);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            font-size: 14px;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 12px;
        `;
        banner.innerHTML = `
            <span style="font-size: 24px;">🎉</span>
            <div>
                <div>Published Successfully!</div>
                <div style="font-size: 12px; font-weight: normal; opacity: 0.9;">${postingTitle} (${postingVin || ''})</div>
                <div id="n2m-redirect-timer" style="font-size: 11px; margin-top: 4px; opacity: 0.85;">Returning to vehicle creator in 3s...</div>
            </div>
        `;
        document.body.appendChild(banner);

        // 1. Mark as posted in Flask
        if (postingVin) {
            await trackPosted({
                vin: postingVin,
                title: postingTitle,
                price: postingPrice
            });

            // Send live log to Flask dashboard
            try {
                GM_xmlhttpRequest({
                    method: 'POST',
                    url: `${FLASK_SERVER}/api/bot/log`,
                    headers: { 'Content-Type': 'application/json' },
                    data: JSON.stringify({
                        level: 'success',
                        message: `🎉 Facebook confirmed listing! Successfully published ${postingTitle} (VIN: ${postingVin})`
                    })
                });
            } catch (e) {}

            sessionStorage.removeItem('n2m_posting_vin');
            sessionStorage.removeItem('n2m_posting_title');
            sessionStorage.removeItem('n2m_posting_price');
        }

        // 2. Check Queue progression
        if (isQueue) {
            const savedQueue = sessionStorage.getItem('n2m_queue');
            let qIdx = parseInt(sessionStorage.getItem('n2m_queue_index') || '0', 10);
            qIdx++;
            sessionStorage.setItem('n2m_queue_index', String(qIdx));

            let queueItems = [];
            try { queueItems = JSON.parse(savedQueue) || []; } catch (e) {}

            if (qIdx < queueItems.length) {
                const nextCar = queueItems[qIdx];
                const nextTitle = nextCar ? `${nextCar.year} ${nextCar.make} ${nextCar.model}` : `Vehicle ${qIdx + 1}`;
                const timerEl = document.getElementById('n2m-redirect-timer');
                if (timerEl) timerEl.textContent = `Queue progress: ${qIdx}/${queueItems.length}. Next up: ${nextTitle}. Loading in 3s...`;

                await sleep(3000);
                window.location.href = CREATE_PAGE;
            } else {
                const timerEl = document.getElementById('n2m-redirect-timer');
                if (timerEl) timerEl.textContent = `All ${queueItems.length} vehicles published! Done.`;
                sessionStorage.removeItem('n2m_queue');
                sessionStorage.removeItem('n2m_queue_index');
                sessionStorage.removeItem('n2m_queue_running');

                try {
                    GM_xmlhttpRequest({
                        method: 'POST',
                        url: `${FLASK_SERVER}/api/bot/log`,
                        headers: { 'Content-Type': 'application/json' },
                        data: JSON.stringify({
                            level: 'success',
                            message: `🏆 All queued vehicles published successfully!`
                        })
                    });
                } catch (e) {}

                await sleep(3500);
                window.location.href = CREATE_PAGE;
            }
        } else {
            // Single post complete, return to create page
            await sleep(3000);
            window.location.href = CREATE_PAGE;
        }
    }

    // ── INIT ──────────────────────────────────────────────────────────────

    function init() {
        const currentUrl = window.location.href;
        console.log('[N2M] Nucar → Marketplace script loaded on:', currentUrl);

        if (currentUrl.includes('/marketplace/you/selling')) {
            setTimeout(handleSellingRedirect, 1000);
            return;
        }

        if (currentUrl.includes('/marketplace/create/vehicle')) {
            setTimeout(() => {
                createPanel();
                loadVehicles();
                startHeartbeatLoop();
                setTimeout(() => resumeQueueIfNeeded(), 2000);
            }, 2000);
        }
    }

    // Run
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        init();
    } else {
        window.addEventListener('DOMContentLoaded', init);
    }

})();
