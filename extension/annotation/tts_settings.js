/**
 * tts_settings.js
 * Handles all logic for the settings page, including API key validation,
 * voice selection, and loading/saving settings.
 */
document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const elements = {
        apiKeyInput: document.getElementById('api-key-input'),
        validateKeyBtn: document.getElementById('validate-key-btn'),
        clearKeyBtn: document.getElementById('clear-key-btn'),
        totalUsageDisplay: document.getElementById('total-usage'),
        voiceSelectionContainer: document.getElementById('voice-selection-container'),
        languageSelect: document.getElementById('language-select'),
        languageSelectLabel: document.getElementById('language-select-label'),
        languageSelectWrapper: document.getElementById('language-select-wrapper'),
        saveVoiceBtnContainer: document.getElementById('save-voice-btn-container'),
        totalUsageContainer: document.getElementById('total-usage-container'),
        voiceTierContainer: document.getElementById('voice-tier-container'),
        saveVoiceBtn: document.getElementById('save-voice-btn'),
        status: document.getElementById('status'),
    };

    // --- State ---
    const state = {
        allVoices: [],
        selectedVoiceName: 'en-US-Wavenet-D', // Default
        apiKey: '',
    };

    // --- Constants ---
    const VOICE_TIER_DATA = {
        'Standard': {
            name: 'Standard',
            price: 4.00,
            desc: 'Basic, robotic-sounding synthesis.',
            freeTier: '4 million',
            sku: '9D01-5995-B545'
        },
        'WaveNet': {
            name: 'WaveNet',
            price: 16.00,
            desc: "High-fidelity, natural-sounding voices.",
            freeTier: '1 million',
            sku: 'FEBD-04B6-769B'
        },
        'Neural2': {
            name: 'Neural2',
            price: 16.00,
            desc: "Google's next-generation high-fidelity voices.",
            freeTier: '1 million',
            sku: 'FEBD-04B6-769B'
        },
        'Polyglot': {
            name: 'Polyglot',
            price: 16.00,
            desc: 'Voices designed to speak multiple languages fluently.',
            freeTier: '1 million',
            sku: 'FEBD-04B6-769B'
        },
        'Chirp 3: HD': {
            name: 'Chirp 3: HD',
            price: 30.00,
            desc: 'High-definition voices for superior audio clarity.',
            freeTier: '1 million',
            sku: 'F977-2280-6F1B'
        },
        'Instant Custom Voice': {
            name: 'Instant Custom Voice',
            price: 60.00,
            desc: 'Create a unique voice from audio samples.',
            freeTier: 'N/A',
            sku: 'A247-37D7-C094'
        },
        'Studio': {
            name: 'Studio',
            price: 160.00,
            desc: 'Highest-quality, most expressive voices.',
            freeTier: '1 million',
            sku: '84AB-48C0-F9C3'
        }
    };

    // --- Utility Functions ---

    /**
     * Saves a value to the extension's local storage.
     * @param {string} key The key to save the data under.
     * @param {any} value The value to save.
     */
    function setCookie(key, value) {
        chrome.storage.local.set({ [key]: value }, () => {
            console.log(`Setting saved: ${key} =`, value);
        });
    }

    /**
     * Retrieves a setting from chrome.storage.local using a modern async/await pattern.
     * This is the recommended replacement for a synchronous getCookie() function.
     *
     * @param {string} key The key of the setting you want to retrieve.
     * @returns {Promise<any>} A promise that resolves with the stored value, or undefined if not found.
     */
    function getCookie(key) {
        return new Promise((resolve) => {
            chrome.storage.local.get([key], (result) => {
                console.log(`Retrieved: ${key} =`, result[key]);
                resolve(result[key]);
            });
        });
    }

    const getVoiceTier = (voiceName) => {
        if (voiceName.includes('Studio')) return 'Studio';
        if (voiceName.includes('Neural2')) return 'Neural2';
        if (voiceName.includes('Wavenet')) return 'WaveNet';
        if (voiceName.includes('Polyglot')) return 'Polyglot';
        if (voiceName.includes('Chirp')) return 'Chirp 3: HD';
        return 'Standard';
    };

    const getFlagEmoji = (countryCode) => {
        if (!countryCode) return '🌐';
        const codePoints = countryCode
            .toUpperCase()
            .split('')
            .map(char => 127397 + char.charCodeAt());
        return String.fromCodePoint(...codePoints);
    };

    const showStatus = (message, type = 'info') => {
        elements.status.textContent = message;
        elements.status.className = type; // 'success', 'error', or 'info'
        // Automatically hide after 5 seconds
        setTimeout(() => {
            elements.status.className = '';
        }, 5000);
    };

    // --- Core Functions ---

    const loadSettings = async () => {
        const apiKey = await getCookie('googleTtsApiKey');
        const voiceName = await getCookie('selectedVoiceName');
        const language = await getCookie('selectedLanguage');
        const totalUsage = await getCookie('totalApiCost') || 0;

        if (voiceName) {
            state.selectedVoiceName = voiceName;
        }

        elements.totalUsageDisplay.textContent = `$${parseFloat(totalUsage).toFixed(6)}`;

        if (apiKey) {
            elements.apiKeyInput.value = apiKey;
            elements.languageSelect.value = language || 'en-US';
            state.apiKey = apiKey;
            await validateApiKey(false); // Validate without showing initial status message
        }
    };

    const validateApiKey = async (showAlerts = true) => {
        const apiKey = elements.apiKeyInput.value.trim();
        if (!apiKey) {
            if (showAlerts) showStatus('Please enter an API key.', 'error');
            return;
        }
        if (showAlerts) showStatus('Validating key...', 'success');
        elements.validateKeyBtn.disabled = true;

        try {
            console.log('Validating API Key...', apiKey);
            const response = await fetch(`https://texttospeech.googleapis.com/v1/voices?key=${apiKey}`);
            const data = await response.json();
            if (!response.ok || !data.voices) throw new Error(data.error?.message || 'Invalid API Key.');

            if (showAlerts) showStatus('API Key is valid!', 'success');
            state.apiKey = apiKey;
            setCookie('googleTtsApiKey', apiKey);
            state.allVoices = data.voices;
            elements.voiceSelectionContainer.style.display = 'block';
            await populateLanguageSelector();
            renderVoiceTiers();
        } catch (error) {
            if (showAlerts) showStatus(`Error: ${error.message}`, 'error');
            elements.voiceSelectionContainer.style.display = 'none';
        } finally {
            elements.validateKeyBtn.disabled = false;
        }
    };

    const clearApiKey = () => {
        elements.apiKeyInput.value = '';
        state.apiKey = '';
        chrome.storage.local.remove('googleTtsApiKey');
        elements.voiceSelectionContainer.style.display = 'none';
        state.allVoices = [];
        showStatus('API Key removed.', 'success');
    };

    const populateLanguageSelector = async () => {
        const languageMap = new Map();
        state.allVoices.forEach(voice => {
            voice.languageCodes.forEach(code => {
                if (!languageMap.has(code)) {
                    try {
                        const langName = new Intl.DisplayNames(['en'], { type: 'language' }).of(code.split('-')[0]);
                        languageMap.set(code, { name: langName, code: code });
                    } catch (e) {
                        languageMap.set(code, { name: code, code: code });
                    }
                }
            });
        });

        elements.languageSelectWrapper.style.display = 'block';
        elements.languageSelectLabel.style.display = 'block';
        elements.saveVoiceBtnContainer.style.display = 'flex';
        elements.totalUsageContainer.style.display = 'flex';

        const sortedLanguages = [...languageMap.values()].sort((a, b) => a.name.localeCompare(b.name));
        elements.languageSelect.innerHTML = '';
        sortedLanguages.forEach(({ name, code }) => {
            const option = document.createElement('option');
            const countryCode = code.split('-')[1] || '';
            option.value = code;
            option.textContent = `${getFlagEmoji(countryCode)} ${name} (${code})`;
            elements.languageSelect.appendChild(option);
        });

        elements.languageSelect.value = await getCookie('selectedLanguage') || 'en-US';
    };

    const renderVoiceTiers = () => {
        const selectedLang = elements.languageSelect.value;
        const voicesForLang = state.allVoices.filter(v => v.languageCodes.includes(selectedLang));
        const tiers = {};
        voicesForLang.forEach(voice => {
            const tierKey = getVoiceTier(voice.name);
            if (!tiers[tierKey]) tiers[tierKey] = [];
            tiers[tierKey].push(voice);
        });

        elements.voiceTierContainer.innerHTML = '';
        Object.keys(VOICE_TIER_DATA).forEach(tierKey => {
            if (tiers[tierKey] && tiers[tierKey].length > 0) {
                const tierInfo = VOICE_TIER_DATA[tierKey];
                const card = document.createElement('div');
                card.className = 'voice-tier-card';
                let voiceOptionsHTML = tiers[tierKey].map(voice => `
                    <div>
                        <label class="voice-option">
                            <input type="radio" name="voice-selection" value="${voice.name}" ${voice.name === state.selectedVoiceName ? 'checked' : ''}>
                            <span>${voice.name} (${voice.ssmlGender.toLowerCase()})</span>
                        </label>
                    </div>
                    <label class="voice-option">
                        <input type="radio" name="voice-selection" value="${voice.name}" ${voice.name === state.selectedVoiceName ? 'checked' : ''}>
                        <span>${voice.name.split('-').slice(2).join('-')} (${voice.ssmlGender.toLowerCase()})</span>
                    </label>
                `).join('');

                card.innerHTML = `
                    <div class="tier-header">
                        <h4>${tierInfo.name}</h4>
                        <span class="tier-price">$${tierInfo.price.toFixed(2)} / 1M chars</span>
                    </div>
                    <p class="tier-desc">${tierInfo.desc}</p>
                    <div class="tier-details">
                        <span><strong>SKU:</strong> ${tierInfo.sku}</span>
                        <span><strong>Free Tier:</strong> ${tierInfo.freeTier} chars/month</span>
                    </div>
                    <div class="voice-options-grid">${voiceOptionsHTML}</div>
                `;
                elements.voiceTierContainer.appendChild(card);
            }
        });
    };

    const saveVoiceSelection = () => {
        const selectedRadio = document.querySelector('input[name="voice-selection"]:checked');
        if (selectedRadio) {
            state.selectedVoiceName = selectedRadio.value;
            setCookie('selectedVoiceName', state.selectedVoiceName);
            setCookie('selectedLanguage', elements.languageSelect.value);
            showStatus(`Voice set to ${state.selectedVoiceName}.`, 'success');
        } else {
            showStatus('Please select a voice first.', 'error');
        }
    };

    // --- Event Listeners ---
    elements.validateKeyBtn.addEventListener('click', () => validateApiKey(true));
    elements.clearKeyBtn.addEventListener('click', clearApiKey);
    elements.saveVoiceBtn.addEventListener('click', saveVoiceSelection);
    elements.languageSelect.addEventListener('change', renderVoiceTiers);

    // --- Initialization ---
    loadSettings();
});
