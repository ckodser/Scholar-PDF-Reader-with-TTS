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
        apiKeyModal: document.getElementById('api-key-modal'),
        showApiKeyModalBtn: document.getElementById('show-api-key-modal-btn'),
        closeApiKeyModalBtn: document.getElementById('close-api-key-modal-btn'),

    };

    // --- State ---
    const state = {
        allVoices: [],
        selectedVoiceName: 'en-US-Wavenet-D', // Default
        apiKey: '',
    };

    // --- Constants ---
    const VOICE_TIER_DATA = {
        'Standard': { name: 'Standard', price: 4.00, desc: 'Basic, robotic-sounding synthesis.', freeTier: '4 million', sku: '9D01-5995-B545' },
        'WaveNet': { name: 'WaveNet', price: 16.00, desc: "High-fidelity, natural-sounding voices.", freeTier: '1 million', sku: 'FEBD-04B6-769B' },
        'Neural2': { name: 'Neural2', price: 16.00, desc: "Google's next-generation high-fidelity voices.", freeTier: '1 million', sku: 'FEBD-04B6-769B' },
        'Polyglot': { name: 'Polyglot', price: 16.00, desc: 'Voices designed to speak multiple languages fluently.', freeTier: '1 million', sku: 'FEBD-04B6-769B' },
        'Chirp 3: HD': { name: 'Chirp 3: HD', price: 30.00, desc: 'High-definition voices for superior audio clarity.', freeTier: '1 million', sku: 'F977-2280-6F1B' },
        'Studio': { name: 'Studio', price: 160.00, desc: 'Highest-quality, most expressive voices.', freeTier: '1 million', sku: '84AB-48C0-F9C3' }
    };

    // --- Utility Functions ---

    function setCookie(key, value) {
        chrome.storage.local.set({ [key]: value });
    }

    function getCookie(key) {
        return new Promise((resolve) => {
            chrome.storage.local.get([key], (result) => {
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
        const codePoints = countryCode.toUpperCase().split('').map(char => 127397 + char.charCodeAt());
        return String.fromCodePoint(...codePoints);
    };

    const showStatus = (message, type = 'info') => {
        elements.status.textContent = message;
        elements.status.className = `status ${type}`;
        elements.status.style.display = 'block';
        setTimeout(() => {
            elements.status.style.display = 'none';
        }, 5000);
    };

    // --- Core Functions ---

    const loadAndDisplayUsage = async () => {
        const totalCost = await getCookie('totalTtsCost') || 0;
        elements.totalUsageDisplay.textContent = `$${parseFloat(totalCost).toFixed(3)}`;
    };

    const loadSettings = async () => {
        const apiKey = await getCookie('googleTtsApiKey');
        const voiceName = await getCookie('selectedVoiceName');
        const language = await getCookie('selectedLanguage');

        if (voiceName) {
            state.selectedVoiceName = voiceName;
        }

        if (apiKey) {
            elements.apiKeyInput.value = apiKey;
            elements.languageSelect.value = language || 'en-US';
            state.apiKey = apiKey;
            await validateApiKey(false);
        }
        loadAndDisplayUsage(); // Initial load
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
            const response = await fetch(`https://texttospeech.googleapis.com/v1/voices?key=${apiKey}`);
            const data = await response.json();
            if (!response.ok || !data.voices) throw new Error(data.error?.message || 'Invalid API Key.');

            if (showAlerts) showStatus('API Key is valid!', 'success');
            state.apiKey = apiKey;
            setCookie('googleTtsApiKey', apiKey);
            state.allVoices = data.voices;
            elements.voiceSelectionContainer.style.display = 'block';
            elements.languageSelectWrapper.style.display = 'block';
            elements.totalUsageContainer.style.display = 'flex';
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
        elements.languageSelectWrapper.style.display = 'none';
        elements.totalUsageContainer.style.display = 'none';
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

                // Check if the currently saved voice is in this tier to expand it by default
                const isExpanded = tiers[tierKey].some(voice => voice.name === state.selectedVoiceName);

                let voiceOptionsHTML = tiers[tierKey].map(voice => `
                    <label class="voice-option">
                        <input type="radio" name="voice-selection" value="${voice.name}" ${voice.name === state.selectedVoiceName ? 'checked' : ''}>
                        <span>${voice.name.split('-').slice(2).join('-')} (${voice.ssmlGender.toLowerCase()})</span>
                    </label>
                `).join('');

                card.innerHTML = `
                    <div class="tier-header tier-toggle ${isExpanded ? 'expanded' : ''}">
                        <div class="tier-header-main">
                            <h4>${tierInfo.name}</h4>
                            <span class="tier-price">$${tierInfo.price.toFixed(2)} / 1M chars</span>
                        </div>
                        <span class="icon tier-icon">expand_more</span>
                    </div>
                    <div class="tier-content ${isExpanded ? '' : 'collapsed'}">
                        <p class="tier-desc">${tierInfo.desc}</p>
                        <div class="tier-details">
                            <span><strong>SKU:</strong> ${tierInfo.sku}</span>
                            <span><strong>Free Tier:</strong> ${tierInfo.freeTier} chars/month</span>
                        </div>
                        <div class="voice-options-grid">${voiceOptionsHTML}</div>
                    </div>
                `;
                elements.voiceTierContainer.appendChild(card);
            }
        });

        // Add event listeners for the new collapsible toggles
        document.querySelectorAll('.tier-toggle').forEach(toggle => {
            toggle.addEventListener('click', () => {
                const content = toggle.nextElementSibling;
                toggle.classList.toggle('expanded');
                content.classList.toggle('collapsed');
            });
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

    elements.showApiKeyModalBtn.addEventListener('click', () => {
        elements.apiKeyModal.classList.remove('hidden');
    });

    elements.closeApiKeyModalBtn.addEventListener('click', () => {
        elements.apiKeyModal.classList.add('hidden');
    });

    elements.apiKeyModal.addEventListener('click', (event) => {
        if (event.target === elements.apiKeyModal) {
            elements.apiKeyModal.classList.add('hidden');
        }
    });

    // --- Initialization ---
    loadSettings();
    // Set an interval to refresh the usage display every 10 seconds
    setInterval(loadAndDisplayUsage, 10000);
});
