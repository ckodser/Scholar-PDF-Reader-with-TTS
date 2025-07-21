/**
 * gemini_settings.js
 * Handles all logic for the Gemini settings section on the settings page,
 * including API key validation, model selection with pricing, and saving settings.
 */
document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const elements = {
        apiKeyInput: document.getElementById('ai-chat-api-key-input'),
        validateKeyBtn: document.getElementById('ai-chat-validate-key-btn'),
        clearKeyBtn: document.getElementById('ai-chat-clear-key-btn'),
        modelSelectionContainer: document.getElementById('gemini-model-selection-container'),
        saveModelBtn: document.getElementById('save-gemini-model-btn'),
        status: document.getElementById('status'), // Re-using the general status element
        geminiUsageContainer: document.getElementById('total-gemini-usage-container'),
        totalUsageDisplay: document.getElementById('total-usage-gemini'),
    };

    // --- State ---
    const state = {
        apiKey: '',
        selectedModel: 'gemini-2.5-flash', // A sensible default
    };

    // --- Constants ---
    // Pricing based on per 1 million tokens.
    // This structure now supports different prices for different input modalities.
    const GEMINI_MODELS_DATA = {
        'gemini-2.5-pro': {
            name: 'Gemini 2.5 Pro',
            desc: 'Most capable model for highly complex tasks. Larger context window.',
            pricing: {
                input: {
                    text: 1.25, // Price per 1M tokens for text
                    document: 1.25 // Placeholder price for documents
                },
                output: {
                    text: 10.00 // Price per 1M tokens for text output
                }
            }
        },
        'gemini-2.5-flash': {
            name: 'Gemini 2.5 Flash',
            desc: 'Fast and cost-effective model for multi-modal reasoning.',
            pricing: {
                input: {
                    text: 0.30, // Price per 1M tokens for text
                    document: 0.30 // XX - Using your requested placeholder price for documents
                },
                output: {
                    text: 2.50 // Price per 1M tokens for text output
                }
            }
        },
        'gemini-2.5-flash-lite-preview-06-17': {
            name: 'Gemini 2.5 Flash-Lite (Preview)',
            desc: 'A lighter, faster preview model for quick tasks.',
            pricing: {
                input: {
                    text: 0.10,
                    document: 0.10 // Placeholder price for documents
                },
                output: {
                    text: 0.40
                }
            }
        }
    };


    // --- Utility Functions ---

    /**
     * Saves a value to the extension's local storage.
     * @param {string} key The key to save the data under.
     * @param {any} value The value to save.
     */
    function setStorage(key, value) {
        chrome.storage.local.set({ [key]: value }, () => {
            console.log(`Gemini setting saved: ${key} =`, value);
        });
    }

    /**
     * Retrieves a setting from chrome.storage.local.
     * @param {string} key The key of the setting to retrieve.
     * @returns {Promise<any>} A promise that resolves with the stored value.
     */
    function getStorage(key) {
        return new Promise((resolve) => {
            chrome.storage.local.get([key], (result) => {
                resolve(result[key]);
            });
        });
    }

    /**
     * Shows a status message to the user.
     * @param {string} message The message to display.
     * @param {'success' | 'error'} type The type of message.
     */
    function showStatus(message, type = 'success') {
        elements.status.textContent = message;
        elements.status.className = `status ${type}`;
        elements.status.style.display = 'block';

        setTimeout(() => {
            elements.status.style.display = 'none';
        }, 5000);
    }


    // --- Core Functions ---

    /**
     * Loads and displays the total usage cost from storage.
     */
    const loadAndDisplayUsage = async () => {
        const totalCost = await getStorage('totalGeminiCost') || 0;
        elements.totalUsageDisplay.textContent = `$${parseFloat(totalCost).toFixed(3)}`;
    };

    /**
     * Loads saved settings from storage when the page loads.
     */
    const loadSettings = async () => {
        const apiKey = await getStorage('geminiApiKey');
        const model = await getStorage('selectedGeminiModel');

        if (model) {
            state.selectedModel = model;
        }

        if (apiKey) {
            elements.apiKeyInput.value = apiKey;
            state.apiKey = apiKey;
            await validateApiKey(false); // Validate on load without showing status
        }
        loadAndDisplayUsage(); // Initial load
    };

    /**
     * Validates the provided Gemini API key by making a cheap, 1-token generation call.
     * @param {boolean} showAlerts - Whether to show status messages to the user.
     */
    const validateApiKey = async (showAlerts = true) => {
        const apiKey = elements.apiKeyInput.value.trim();
        if (!apiKey) {
            if (showAlerts) showStatus('Please enter a Gemini API key.', 'error');
            return;
        }

        if (showAlerts) showStatus('Validating key...', 'success');
        elements.validateKeyBtn.disabled = true;

        const validationModel = 'gemini-2.5-flash';
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${validationModel}:generateContent?key=${apiKey}`;

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
                    generationConfig: { maxOutputTokens: 1 }
                }),
            });

            const data = await response.json();

            if (response.ok && data.candidates) {
                if (showAlerts) showStatus('Gemini API Key is valid!', 'success');
                state.apiKey = apiKey;
                setStorage('geminiApiKey', apiKey);

                elements.modelSelectionContainer.style.display = 'block';
                elements.geminiUsageContainer.style.display = 'block';
                renderModelSelection();
            } else {
                const error = data.error?.message || 'Invalid API Key or insufficient permissions.';
                throw new Error(error);
            }
        } catch (error) {
            console.error('Gemini API Key validation error:', error);
            if (showAlerts) showStatus(`Validation Error: ${error.message}`, 'error');
            elements.modelSelectionContainer.style.display = 'none';
            elements.geminiUsageContainer.style.display = 'none';
        } finally {
            elements.validateKeyBtn.disabled = false;
        }
    };

    /**
     * Clears the API key from the input and storage.
     */
    const clearApiKey = () => {
        elements.apiKeyInput.value = '';
        state.apiKey = '';
        chrome.storage.local.remove('geminiApiKey');
        elements.modelSelectionContainer.style.display = 'none';
        elements.geminiUsageContainer.style.display = 'none';
        showStatus('Gemini API Key removed.', 'success');
    };

    /**
     * Renders the list of available Gemini models for selection.
     */
    const renderModelSelection = () => {
        const container = elements.modelSelectionContainer.querySelector('#gemini-model-tier-container');
        container.innerHTML = ''; // Clear previous content

        Object.keys(GEMINI_MODELS_DATA).forEach(modelKey => {
            const modelInfo = GEMINI_MODELS_DATA[modelKey];
            const card = document.createElement('div');
            card.className = 'voice-tier-card';

            // Build pricing details string
            const inputPricingText = Object.entries(modelInfo.pricing.input)
                .map(([modality, price]) => `<strong>${modality.charAt(0).toUpperCase() + modality.slice(1)}:</strong> $${price.toFixed(2)}`)
                .join(', ');
            const outputPricingText = `<strong>Text:</strong> $${modelInfo.pricing.output.text.toFixed(2)}`;

            card.innerHTML = `
                <div class="tier-header">
                    <h4>${modelInfo.name}</h4>
                </div>
                <p class="tier-desc">${modelInfo.desc}</p>
                <div class="tier-details">
                    <span><strong>Input:</strong> ${inputPricingText} / 1M tokens</span>
                    <span><strong>Output:</strong> ${outputPricingText} / 1M tokens</span>
                </div>
                <div class="mt-3">
                    <label class="voice-option">
                        <input type="radio" name="gemini-model-selection" value="${modelKey}" ${modelKey === state.selectedModel ? 'checked' : ''}>
                        <span>Select ${modelInfo.name}</span>
                    </label>
                </div>
            `;
            container.appendChild(card);
        });
    };

    /**
     * Saves the user's chosen Gemini model to storage.
     */
    const saveModelSelection = () => {
        const selectedRadio = document.querySelector('input[name="gemini-model-selection"]:checked');
        if (selectedRadio) {
            state.selectedModel = selectedRadio.value;
            setStorage('selectedGeminiModel', state.selectedModel);
            showStatus(`Model set to ${GEMINI_MODELS_DATA[state.selectedModel].name}.`, 'success');
        } else {
            showStatus('Please select a model first.', 'error');
        }
    };


    // --- Event Listeners ---
    elements.validateKeyBtn.addEventListener('click', () => validateApiKey(true));
    elements.clearKeyBtn.addEventListener('click', clearApiKey);
    elements.saveModelBtn.addEventListener('click', saveModelSelection);


    // --- Initialization ---
    loadSettings();
    // Set an interval to refresh the usage display every 10 seconds
    setInterval(loadAndDisplayUsage, 10000);
});
