/**
 * AiChat.js
 * Manages the AI chat panel, conversation with the Gemini API,
 * and interaction with the PDF content using native PDF understanding.
 */

// --- State Management ---
let aiChatState = {
    model: 'gemini-2.5-flash', // Default model
    apiKey: null,
    isPanelOpen: true, // Make the panel open by default
    isPanelExpanded: false,
    isAnalyzing: false,
    pdfDataB64: null, // Will store the base64 encoded PDF data
    conversation: [], // Stores the history of the chat
};

// --- DOM Element References ---
const dom = {};

function cacheDomElements() {
    // This button is no longer the primary way to open the panel, but we keep the reference
    dom.chatActivateBtn = document.getElementById('chat-activate-btn');
    dom.aiChatBorder = document.getElementById('ai-chat-border');
    dom.chatPanel = document.getElementById('ai-chat-panel');
    dom.chatCloseBtn = document.getElementById('ai-chat-close-btn');
    dom.chatResizeBtn = document.getElementById('ai-chat-resize-btn');
    dom.chatMessages = document.getElementById('ai-chat-messages');
    dom.chatInput = document.getElementById('ai-chat-input');
    dom.chatSendBtn = document.getElementById('ai-chat-send-btn');
    dom.processingOverlay = document.getElementById('chat-processing-overlay');
}

// --- Utility Functions ---

function getStorage(key) {
    return new Promise((resolve) => {
        chrome.storage.local.get([key], (result) => {
            resolve(result[key]);
        });
    });
}

/**
 * Polls for the global window.pdfUrl variable with retries.
 * @param {number} retries - The number of times to check for the URL.
 * @param {number} delay - The delay in milliseconds between retries.
 * @returns {Promise<string>} A promise that resolves with the PDF URL.
 */
async function getPdfUrlWithRetry(retries = 10, delay = 500) {
    for (let i = 0; i < retries; i++) {
        if (window.pdfUrl) {
            return window.pdfUrl;
        }
        await new Promise(resolve => setTimeout(resolve, delay));
    }
    throw new Error("Could not find the PDF URL after multiple attempts.");
}


/**
 * Fetches the PDF from its URL and converts it to a base64 string.
 * This relies on `annotation.js` setting `window.pdfUrl`.
 * @returns {Promise<string>} The base64 encoded PDF data.
 */
async function fetchAndEncodePdf() {
    const url = await getPdfUrlWithRetry();

    console.log(`Fetching PDF from: ${url}`);
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to fetch PDF: ${response.statusText}`);
    }
    const arrayBuffer = await response.arrayBuffer();

    // Base64 encoding function for browser environment
    const toBase64 = (buffer) => {
        let binary = '';
        const bytes = new Uint8Array(buffer);
        for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return window.btoa(binary);
    };

    return toBase64(arrayBuffer);
}


// --- UI Rendering and Manipulation ---

/**
 * Toggles the visibility of the chat panel. Now primarily used for closing.
 */
function toggleChatPanel() {
    aiChatState.isPanelOpen = !aiChatState.isPanelOpen;
    dom.chatPanel.classList.toggle('hidden', !aiChatState.isPanelOpen);
    // Also hide/show the activate button accordingly
    dom.chatActivateBtn.classList.toggle('hidden', aiChatState.isPanelOpen);
    dom.aiChatBorder.classList.toggle('hidden', aiChatState.isPanelOpen);
}

/**
 * Toggles the size of the chat panel between sidebar and centered mode.
 */
function toggleChatSize() {
    aiChatState.isPanelExpanded = !aiChatState.isPanelExpanded;
    dom.chatPanel.classList.toggle('expanded', aiChatState.isPanelExpanded);
    const icon = dom.chatResizeBtn.querySelector('.material-symbols-outlined');
    icon.textContent = aiChatState.isPanelExpanded ? 'close_fullscreen' : 'open_in_full';
}

/**
 * Renders a message in the chat window.
 * @param {'user' | 'ai'} sender - Who sent the message.
 * @param {string} text - The message content.
 */
function renderMessage(sender, text) {
    const messageWrapper = document.createElement('div');
    messageWrapper.className = `chat-message ${sender}`;

    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.innerHTML = `<span class="material-symbols-outlined">${sender === 'user' ? 'person' : 'auto_awesome'}</span>`;

    const messageContent = document.createElement('div');
    messageContent.className = 'message-content';
    messageContent.textContent = text;

    messageWrapper.appendChild(avatar);
    messageWrapper.appendChild(messageContent);
    dom.chatMessages.appendChild(messageWrapper);

    // Scroll to the latest message
    dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
}


// --- API and Conversation Logic ---

/**
 * Prepares the PDF data when the chat is first opened.
 */
async function preparePdfForConversation() {
    aiChatState.isAnalyzing = true;
    dom.processingOverlay.classList.remove('hidden');
    dom.processingOverlay.querySelector('p').textContent = 'Preparing PDF...';

    try {
        aiChatState.pdfDataB64 = await fetchAndEncodePdf();
    } catch (error) {
        console.error("Error preparing PDF:", error);
        renderMessage('ai', `Sorry, an error occurred while loading the PDF: ${error.message}`);
    } finally {
        aiChatState.isAnalyzing = false;
        dom.processingOverlay.classList.add('hidden');
    }
}

/**
 * Handles sending a user's message and getting the AI's response.
 */
async function handleSendMessage() {
    const userInput = dom.chatInput.value.trim();
    if (!userInput || aiChatState.isAnalyzing) return;

    renderMessage('user', userInput);

    let userMessageParts;
    // If this is the first message, the content needs to include the PDF data.
    if (aiChatState.conversation.length === 0 && aiChatState.pdfDataB64) {
        userMessageParts = [
            { text: userInput },
            {
                inlineData: {
                    mimeType: 'application/pdf',
                    data: aiChatState.pdfDataB64
                }
            }
        ];
        // We can now clear the PDF data from memory as it will be part of the conversation history
        aiChatState.pdfDataB64 = null;
    } else {
        userMessageParts = [{ text: userInput }];
    }

    aiChatState.conversation.push({ role: 'user', parts: userMessageParts });
    dom.chatInput.value = '';
    dom.chatSendBtn.disabled = true;

    // Show a "thinking" indicator
    const thinkingMessage = document.createElement('div');
    thinkingMessage.className = 'chat-message ai';
    thinkingMessage.innerHTML = `<div class="avatar"><div class="loader"></div></div><div class="message-content"><i>Thinking...</i></div>`;
    dom.chatMessages.appendChild(thinkingMessage);
    dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;

    try {
        const responseText = await callGeminiAPI(aiChatState.conversation);
        aiChatState.conversation.push({ role: 'model', parts: [{ text: responseText }] });

        thinkingMessage.remove();
        renderMessage('ai', responseText);

    } catch (error) {
        console.error("Error sending message:", error);
        thinkingMessage.remove();
        renderMessage('ai', `Sorry, I encountered an error: ${error.message}`);
    } finally {
        dom.chatSendBtn.disabled = false;
    }
}


/**
 * Core function to call the Gemini API.
 * @param {Array} history - The full conversation history.
 * @returns {Promise<string>} The text response from the model.
 */
async function callGeminiAPI(history) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${aiChatState.model}:generateContent?key=${aiChatState.apiKey}`;

    const payload = {
        contents: history,
        // Optional: Add safety settings or generation config if needed
    };

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!response.ok || !data.candidates) {
        const errorMsg = data.error?.message || 'Unknown API error.';
        throw new Error(errorMsg);
    }

    return data.candidates[0].content.parts[0].text;
}


// --- Initialization ---

async function initializeAiChat() {
    console.log('Initializing AI Chat...');
    cacheDomElements();

    // Load settings from storage
    aiChatState.apiKey = await getStorage('geminiApiKey');
    const savedModel = await getStorage('selectedGeminiModel');
    if (savedModel) {
        aiChatState.model = savedModel;
    }

    // Only proceed if an API key is configured
    if (aiChatState.apiKey) {
        // Ensure panel is visible and start analysis
        dom.chatPanel.classList.remove('hidden');
        preparePdfForConversation();
    } else {
        // If no API key, hide the panel and the toolbar button
        dom.chatPanel.classList.add('hidden');
        dom.chatActivateBtn.classList.add('hidden');
        dom.aiChatBorder.classList.add('hidden');
    }

    // Setup event listeners
    // The activate button is now for re-opening the chat after closing it
    dom.chatActivateBtn.addEventListener('click', toggleChatPanel);
    dom.chatCloseBtn.addEventListener('click', toggleChatPanel);
    dom.chatResizeBtn.addEventListener('click', toggleChatSize);
    dom.chatSendBtn.addEventListener('click', handleSendMessage);
    dom.chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    });
}

document.addEventListener('DOMContentLoaded', initializeAiChat);
