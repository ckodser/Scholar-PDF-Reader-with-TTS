/**
 * AiChat.js
 * Manages the AI chat panel, conversation with the Gemini API,
 * and interaction with the PDF content using native PDF understanding and tabs.
 */

// --- State Management ---
let aiChatState = {
    model: 'gemini-2.5-flash',
    apiKey: null,
    isPanelOpen: false, // Start hidden
    isPanelExpanded: false,
    isAnalyzing: false,
    pdfDataB64: null,
    pdfId: null,
    tabs: [],
    activeTabId: null,
};

// --- Pricing Data (Mirrored from gemini_settings.js for direct access) ---
const GEMINI_MODELS_DATA = {
    'gemini-2.5-pro': {
        pricing: {
            input: {text: 1.25, document: 1.25},
            output: {text: 10.00}
        },
        name: 'Gemini 2.5 Pro',
    },
    'gemini-2.5-flash': {
        pricing: {
            input: {text: 0.30, document: 0.30},
            output: {text: 2.50}
        },
        name: 'Gemini 2.5 Flash',
    },
    'gemini-2.5-flash-lite-preview-06-17': {
        pricing: {
            input: {text: 0.10, document: 0.10},
            output: {text: 0.40}
        },
        name: 'Gemini 2.5 Flash Lite Preview',
    }
};


// --- DOM Element References ---
const dom = {};

function cacheDomElements() {
    dom.chatActivateBtn = document.getElementById('chat-activate-btn');
    dom.aiChatBorder = document.getElementById('ai-chat-border');
    dom.chatPanel = document.getElementById('ai-chat-panel');
    dom.chatCloseBtn = document.getElementById('ai-chat-close-btn');
    dom.chatDeleteBtn = document.getElementById('ai-chat-delete-btn');
    dom.chatResizeBtn = document.getElementById('ai-chat-resize-btn');
    dom.chatMessages = document.getElementById('ai-chat-messages');
    dom.chatInput = document.getElementById('ai-chat-input');
    dom.chatSendBtn = document.getElementById('ai-chat-send-btn');
    dom.processingOverlay = document.getElementById('chat-processing-overlay');
    dom.tabsContainer = document.getElementById('chat-tabs-container');
    dom.newTabBtn = document.getElementById('chat-new-tab-btn');
    dom.headerTitle = document.getElementById('chat-header-title');
}

// --- Utility Functions ---

function getStorage(key) {
    return new Promise((resolve) => chrome.storage.local.get([key], (result) => resolve(result[key])));
}

function setStorage(data) {
    return new Promise((resolve) => chrome.storage.local.set(data, resolve));
}

async function getPdfUrlWithRetry(retries = 10, delay = 500) {
    for (let i = 0; i < retries; i++) {
        if (window.pdfUrl) {
            aiChatState.pdfId = window.pdfUrl;
            return window.pdfUrl;
        }
        await new Promise(resolve => setTimeout(resolve, delay));
    }
    throw new Error("Could not find the PDF URL after multiple attempts.");
}

async function fetchAndEncodePdf() {
    if (aiChatState.pdfDataB64) return aiChatState.pdfDataB64;
    const url = await getPdfUrlWithRetry();
    console.log(`Fetching PDF from: ${url}`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch PDF: ${response.statusText}`);
    const arrayBuffer = await response.arrayBuffer();
    const toBase64 = (buffer) => {
        let binary = '';
        const bytes = new Uint8Array(buffer);
        bytes.forEach((byte) => binary += String.fromCharCode(byte));
        return window.btoa(binary);
    };
    aiChatState.pdfDataB64 = toBase64(arrayBuffer);
    return aiChatState.pdfDataB64;
}

// --- UI Rendering and Manipulation ---

async function toggleChatPanel() {
    aiChatState.isPanelOpen = !aiChatState.isPanelOpen;
    dom.chatPanel.classList.toggle('hidden', !aiChatState.isPanelOpen);
    if (aiChatState.isPanelOpen && aiChatState.tabs.length === 0) {
        await createNewTab();
    }
    dom.chatDeleteBtn.classList.toggle('hidden', !aiChatState.isPanelExpanded);
}

function toggleChatSize() {
    aiChatState.isPanelExpanded = !aiChatState.isPanelExpanded;
    dom.chatPanel.classList.toggle('expanded', aiChatState.isPanelExpanded);
    dom.chatResizeBtn.querySelector('.material-symbols-outlined').textContent = aiChatState.isPanelExpanded ? 'close_fullscreen' : 'open_in_full';
    dom.chatDeleteBtn.classList.toggle('hidden', !aiChatState.isPanelExpanded);
}

/**
 * Deletes all messages for the CURRENT PDF from both the UI and storage.
 */
async function deleteAllMessages() {
    if (!aiChatState.pdfId) {
        console.warn("Cannot delete messages without a PDF ID.");
        return;
    }

    // Reset the local state
    aiChatState.tabs = [];

    try {
        // Remove the history for this specific PDF from storage
        const storageKey = `chatHistory_${aiChatState.pdfId}`;
        await new Promise((resolve) => chrome.storage.local.remove(storageKey, resolve));
        console.log(`Deleted chat history from storage for key: ${storageKey}`);
    } catch (error) {
        console.error("Failed to delete conversations from storage:", error);
    }

    // Create a new blank tab for the user to start over
    await createNewTab(); // This function already handles rendering and saving the new empty state
    console.log('All messages for this PDF have been deleted.');
}

function renderMessage(sender, text) {
    const messageWrapper = document.createElement('div');
    messageWrapper.className = `chat-message ${sender}`;

    const messageContent = document.createElement('div');
    messageContent.className = 'message-content';

    // Check if sender is 'ai' and if the marked OBJECT is available.
    if (sender === 'ai' && typeof marked === 'object') {
        // Call the .parse() method on the marked object.
        messageContent.innerHTML = marked.parse(text);
    } else {
        // For user messages or if marked is not available, just set text content.
        messageContent.textContent = text;
    }

    messageWrapper.appendChild(messageContent);
    dom.chatMessages.appendChild(messageWrapper);
    dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
}

function renderTabs() {
    while (dom.tabsContainer.firstChild && dom.tabsContainer.firstChild.id !== 'chat-new-tab-btn') {
        dom.tabsContainer.removeChild(dom.tabsContainer.firstChild);
    }
    aiChatState.tabs.forEach(tab => {
        const tabButton = document.createElement('button');
        tabButton.className = `chat-tab ${tab.id === aiChatState.activeTabId ? 'active' : ''}`;
        tabButton.textContent = tab.name;
        tabButton.dataset.tabId = tab.id;
        tabButton.title = tab.name;
        tabButton.addEventListener('click', () => switchTab(tab.id));
        dom.tabsContainer.insertBefore(tabButton, dom.newTabBtn);
    });
}

function renderActiveTabMessages() {
    dom.chatMessages.innerHTML = '';
    const activeTab = aiChatState.tabs.find(t => t.id === aiChatState.activeTabId);
    if (activeTab) {
        activeTab.conversation.forEach(msg => {
            renderMessage(msg.role === 'model' ? 'ai' : 'user', msg.parts[0].text);
        });
    }
}

// --- Tab and Conversation Logic ---

async function createNewTab() {
    const tabId = `tab-${Date.now()}`;
    const newTab = {
        id: tabId,
        name: `Chat ${aiChatState.tabs.length + 1}`,
        conversation: [],
        isInitialized: false,
        isThinking: false,
    };
    aiChatState.tabs.push(newTab);
    await saveConversations();
    await switchTab(tabId); // Await the switch, which also handles saving.
}

async function switchTab(tabId) {
    if (aiChatState.activeTabId === tabId) return; // No action if already active

    aiChatState.activeTabId = tabId;
    renderTabs();
    renderActiveTabMessages();
    const activeTab = aiChatState.tabs.find(t => t.id === tabId);
    if (activeTab && !activeTab.isInitialized) {
        await preparePdfForConversation();
    }
    if (activeTab && activeTab.isThinking) {
        activeTab.thinkingIndicator = await showThinkingIndicator();
        dom.chatSendBtn.disabled = true;
    } else {
        dom.chatSendBtn.disabled = false;
    }

}


async function preparePdfForConversation() {
    const activeTab = aiChatState.tabs.find(t => t.id === aiChatState.activeTabId);
    if (!activeTab || activeTab.isInitialized) return;

    aiChatState.isAnalyzing = true;
    dom.processingOverlay.classList.remove('hidden');
    dom.processingOverlay.querySelector('p').textContent = 'Preparing PDF for this chat...';
    try {
        await fetchAndEncodePdf();
        activeTab.isInitialized = true;
    } catch (error) {
        console.error("Error preparing PDF:", error);
        renderMessage('ai', `Sorry, an error occurred: ${error.message}`);
    } finally {
        aiChatState.isAnalyzing = false;
        dom.processingOverlay.classList.add('hidden');
    }
}

async function showThinkingIndicator() {
    const activeTab = aiChatState.tabs.find(t => t.id === aiChatState.activeTabId);
    if (!activeTab) return;
    const thinkingMessage = document.createElement('div');
    thinkingMessage.className = 'chat-message ai thinking-indicator';
    thinkingMessage.innerHTML = `<div class="message-content">Thinking...</div>`;
    dom.chatMessages.appendChild(thinkingMessage);
    dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
    return thinkingMessage;
}

async function handleSendMessage() {
    const userInput = dom.chatInput.value.trim();
    const activeTab = aiChatState.tabs.find(t => t.id === aiChatState.activeTabId);
    if (!userInput || activeTab.isThinking || !activeTab) return;

    renderMessage('user', userInput);

    let userMessageParts;
    if (activeTab.conversation.length === 0 && aiChatState.pdfDataB64) {
        userMessageParts = [
            {text: userInput},
            {inlineData: {mimeType: 'application/pdf', data: aiChatState.pdfDataB64}}
        ];
    } else {
        userMessageParts = [{text: userInput}];
    }

    activeTab.conversation.push({role: 'user', parts: userMessageParts});
    dom.chatInput.value = '';
    dom.chatSendBtn.disabled = true;
    activeTab.isThinking = true;
    await saveConversations();
    activeTab.thinkingIndicator = await showThinkingIndicator();

    try {
        const responseData = await callGeminiAPI(activeTab.conversation);
        const responseText = responseData.candidates[0].content.parts[0].text;

        activeTab.conversation.push({role: 'model', parts: [{text: responseText}]});

        // Record usage after a successful call

        await recordGeminiUsage(responseData);
        await saveConversations();

        if (aiChatState.activeTabId === activeTab.id) {
            activeTab.thinkingIndicator.remove();
            renderMessage('ai', responseText);
        }
    } catch (error) {
        console.error("Error sending message:", error);
        if (aiChatState.activeTabId === activeTab.id) {
            activeTab.thinkingIndicator.remove();
            renderMessage('ai', `Sorry, an error occurred: ${error.message}`);
        }
    } finally {
        activeTab.isThinking = false;
        if (aiChatState.activeTabId === activeTab.id) {
            dom.chatSendBtn.disabled = false;
        }
    }
}

async function callGeminiAPI(history) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${aiChatState.model}:generateContent?key=${aiChatState.apiKey}`;
    const payload = {contents: history};
    const response = await fetch(url, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok || !data.candidates) {
        throw new Error(data.error?.message || 'Unknown API error.');
    }
    return data;
}

/**
 * Calculates the cost of a Gemini API call and adds it to the total in storage.
 * @param {object} responseData The full response object from the Gemini API.
 */
async function recordGeminiUsage(responseData) {
    if (!responseData.usageMetadata) {
        console.warn("No usageMetadata found in response. Cannot calculate cost.");
        return;
    }

    const {usageMetadata} = responseData;
    const modelUsed = aiChatState.model; // Or responseData.modelVersion if you want to be precise
    const modelPricing = GEMINI_MODELS_DATA[modelUsed]?.pricing;

    if (!modelPricing) {
        console.error(`Pricing not found for model: ${modelUsed}`);
        return;
    }

    let inputCost = 0;
    // The API now provides promptTokensDetails, which is more accurate.
    if (usageMetadata.promptTokensDetails) {
        usageMetadata.promptTokensDetails.forEach(detail => {
            const modality = detail.modality.toLowerCase();
            const price = modelPricing.input[modality];
            if (price !== undefined) {
                inputCost += (detail.tokenCount / 1000000) * price;
            } else {
                console.warn(`No input price defined for modality: ${modality}`);
            }
        });
    } else {
        // Fallback to promptTokenCount if details are not available
        const price = modelPricing.input.text; // Assume text if no details
        inputCost = (usageMetadata.promptTokenCount / 1000000) * price;
    }


    const outputCost = (usageMetadata.candidatesTokenCount / 1000000) * modelPricing.output.text;

    const callCost = inputCost + outputCost;

    try {
        const currentTotal = await getStorage('totalGeminiCost') || 0;
        const newTotal = currentTotal + callCost;
        chrome.storage.local.set({totalGeminiCost: newTotal});
        console.log(`Recorded Gemini cost: $${callCost.toFixed(6)}. New total: $${newTotal.toFixed(6)}`);
    } catch (error) {
        console.error("Failed to record Gemini usage:", error);
    }
}

/**
 * Saves the current state of conversations for the active PDF to chrome.storage
 * under a unique key, after removing all PDF data to keep storage small.
 */
async function saveConversations() {
    if (!aiChatState.pdfId) {
        console.warn("Cannot save conversations without a PDF ID.");
        return;
    }
    try {
        const storageKey = `chatHistory_${aiChatState.pdfId}`;
        console.log(`Saving conversations to key: ${storageKey}`);
        logTabs()
        // Create a deep copy to avoid modifying the live state.
        const tabsForStorage = JSON.parse(JSON.stringify(aiChatState.tabs));

        // Strip out any inline PDF data from all conversations before saving.
        tabsForStorage.forEach(tab => {
            if (tab.conversation) {
                tab.conversation.forEach(message => {
                    // Check all user messages and filter out the PDF data part.
                    if (message.role === 'user' && message.parts.length > 1) {
                        message.parts = message.parts.filter(part => !part.inlineData);
                    }
                });
            }
        });

        const dataToSave = {
            tabs: tabsForStorage, // Save the cleaned tabs
            activeTabId: aiChatState.activeTabId,
            lastUpdated: new Date().toISOString()
        };

        await setStorage({ [storageKey]: dataToSave });

    } catch (error) {
        console.error("Error saving conversations:", error);
    }
}

function logTabs() {
    for (let i = 0; i < aiChatState.tabs.length; i++) {
        console.log("conversation ", i);
        let tab = aiChatState.tabs[i];
        if (tab.conversation && tab.conversation.length > 0) {
            for (let j = 0; j < tab.conversation.length; j++) {
                if(tab.conversation[j].parts.length > 1){
                    console.log("message", j, "PDF", tab.conversation[j].parts[1].inlineData.data.length)
                }

                console.log("message", j, tab.conversation[j].parts[0].text)
            }
        }
    }
}

/**
 * Loads conversations from storage and re-attaches the PDF encoding to the
 * first message of each conversation tab.
 */
async function loadConversations() {
    try {
        const pdfId = await getPdfUrlWithRetry();
        if (!pdfId) return;

        const storageKey = `chatHistory_${pdfId}`;
        console.log(`Loading conversations from key: ${storageKey}`);

        const pdfHistory = await getStorage(storageKey);

        if (pdfHistory && pdfHistory.tabs && pdfHistory.tabs.length > 0) {
            // First, fetch and encode the PDF data for this session.
            const pdfDataB64 = await fetchAndEncodePdf();
            console.log('PDF encoded, re-attaching to conversations...');

            // Now, iterate through the loaded tabs and re-insert the PDF data.
            pdfHistory.tabs.forEach(tab => {
                // The PDF is only attached to the very first message of a conversation.
                if (tab.conversation && tab.conversation.length > 0) {
                    const firstMessage = tab.conversation[0];
                    if (firstMessage.role === 'user') {
                         // Add the PDF data back to the first message's 'parts' array.
                         firstMessage.parts.push({
                            inlineData: {
                                mimeType: 'application/pdf',
                                data: pdfDataB64
                            }
                        });
                    }
                }
            });

            // With the tabs fully reconstructed, update the main state.
            aiChatState.tabs = pdfHistory.tabs.map(tab => ({
                ...tab,
                isThinking: false,
            }));
            aiChatState.activeTabId = pdfHistory.activeTabId || pdfHistory.tabs[0].id;

            console.log(`Loaded and rehydrated ${aiChatState.tabs.length} chat tabs.`);
            logTabs()
        } else {
            console.log('No saved conversations found for this PDF.');
        }
    } catch (error) {
        console.error("Error loading conversations:", error);
    }
}

// --- Initialization ---

async function initializeAiChat() {
    console.log('Initializing AI Chat...');
    cacheDomElements();

    await loadConversations();

    aiChatState.apiKey = await getStorage('geminiApiKey');
    const savedModel = await getStorage('selectedGeminiModel');
    if (savedModel) aiChatState.model = savedModel;

    if (aiChatState.apiKey) {
        dom.chatActivateBtn.classList.remove('hidden');
        dom.aiChatBorder.classList.remove('hidden');
        if (dom.headerTitle) {
            const modelData = GEMINI_MODELS_DATA[aiChatState.model];
            dom.headerTitle.textContent = modelData ? modelData.name : aiChatState.model;
        }
    } else {
        dom.chatPanel.classList.add('hidden');
        dom.chatActivateBtn.classList.add('hidden');
        dom.aiChatBorder.classList.add('hidden');
    }

    renderTabs();
    renderActiveTabMessages();

    dom.chatActivateBtn.addEventListener('click', toggleChatPanel);
    dom.chatCloseBtn.addEventListener('click', toggleChatPanel);
    dom.chatResizeBtn.addEventListener('click', toggleChatSize);
    dom.newTabBtn.addEventListener('click', createNewTab);
    dom.chatSendBtn.addEventListener('click', handleSendMessage);
    dom.chatDeleteBtn.addEventListener('click', deleteAllMessages)
    dom.chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    });
}

document.addEventListener('DOMContentLoaded', initializeAiChat);
