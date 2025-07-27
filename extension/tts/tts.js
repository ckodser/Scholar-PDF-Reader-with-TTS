let ttsState = {
    sentences: [],
    currentSentenceIndex: 0,
    isEnabled: false,
    isSpeaking: false,
    isPaused: false,
    audioCache: new Map(),
    selectedVoiceName: 'en-US-Wavenet-D',
    apiKey: '',
};

// --- Pricing Data (Mirrored from tts_settings.js for direct access) ---
const VOICE_TIER_DATA = {
    'Standard': { price: 4.00 },
    'WaveNet': { price: 16.00 },
    'Neural2': { price: 16.00 },
    'Polyglot': { price: 16.00 },
    'Chirp 3: HD': { price: 30.00 },
    'Instant Custom Voice': { price: 60.00 },
    'Studio': { price: 160.00 }
};

const pdfUrlToTextData = new Map();

// --- Utility Functions (including helpers from settings) ---
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

async function stringToHashAsync(str) {
    const textAsBuffer = new TextEncoder().encode(str);
    const hashBuffer = await crypto.subtle.digest('SHA-256', textAsBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}


/// Use PDF.Js by Mozila
async function getPdfTextData(pdfUrl, pageNum) {
    const cacheKey = `${pdfUrl}-page-${pageNum}`;
    if (pdfUrlToTextData.has(cacheKey)) {
        return pdfUrlToTextData.get(cacheKey);
    }
    try {
        const loadingTask = pdfjsLib.getDocument(pdfUrl);
        const pdf = await loadingTask.promise;
        const page = await pdf.getPage(pageNum);
        const textContent = await page.getTextContent();
        pdfUrlToTextData.set(cacheKey, textContent.items);
        return textContent.items;
    } catch (error) {
        console.error('Error loading PDF with PDF.js:', error);
        return null;
    }
}

async function processPageForTTS(pageElement, pdfUrl, pageNum) {
    if (!ttsState.isEnabled) return;
    const pdfTextItems = await getPdfTextData(pdfUrl, pageNum);
    if (!pdfTextItems || pdfTextItems.length === 0) return;
    const pdfRawText = pdfTextItems.map(item => item.str).join(' ');
    const textContainer = pageElement.querySelector('.gsr-text-ctn');
    if (!textContainer) return;

    const walker = document.createTreeWalker(textContainer, NodeFilter.SHOW_ELEMENT, {
        acceptNode: (node) => {
            const isVisible = node.offsetParent !== null;
            const hasText = node.textContent.trim() !== '';
            const hasNoElementChildren = !node.querySelector('*');
            return (isVisible && hasText && hasNoElementChildren) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        }
    });

    const elements = [];
    while (walker.nextNode()) elements.push(walker.currentNode);
    if (elements.length === 0) return;

    const sentenceStrings = pdfRawText.split(/(?<=[.?!])\s+/).filter(s => s.trim());
    let elementCursor = 0;
    let elementCharCursor = 0;

    sentenceStrings.forEach(sentenceText => {
        sentenceText = sentenceText.trim();
        if (sentenceText.length === 0) return;

        const sentenceElements = new Set();
        for (let i = 0; i < sentenceText.length; i++) {
            if (sentenceText[i] === ' ') continue;
            while (elementCursor < elements.length) {
                if (elementCharCursor < elements[elementCursor].textContent.length) {
                    if (elements[elementCursor].textContent[elementCharCursor] === sentenceText[i]) {
                        sentenceElements.add(elements[elementCursor]);
                        elementCharCursor++;
                        break;
                    }
                    elementCharCursor++;
                } else {
                    elementCursor++;
                    elementCharCursor = 0;
                }
            }
        }

        const sentenceSpans = Array.from(sentenceElements);
        if (sentenceSpans.length > 0) {
            const sentenceIndex = ttsState.sentences.length;
            ttsState.sentences.push({ text: sentenceText, spans: sentenceSpans, index: sentenceIndex });
            sentenceSpans.forEach(span => {
                span.addEventListener('click', (e) => {
                    if (!window.colorPickerManagerInstance.activeTools.isHighlighting && !window.colorPickerManagerInstance.activeTools.isErasing && ttsState.isEnabled) {
                        e.stopPropagation();
                        jumpToSentenceAndPlay(sentenceIndex);
                    }
                });
            });
        }
    });
}


// --- Playback Controls ---
function activateTTS() {
    const isEnabled = !ttsState.isEnabled;
    if (isEnabled) {initializeTTSAfterActivation().then(r => console.log('TTS initialized.'));}
    ttsState.isEnabled = isEnabled;
    document.getElementById('tts-prev-btn').classList.toggle('hidden', !isEnabled);
    document.getElementById('tts-play-btn').classList.toggle('hidden', !isEnabled);
    document.getElementById('tts-pause-btn').classList.toggle('hidden', true); // Always hide initially
    document.getElementById('tts-stop-btn').classList.toggle('hidden', true); // Always hide initially
    document.getElementById('tts-next-btn').classList.toggle('hidden', !isEnabled);
    document.getElementById('tts-activate-btn-text').textContent = isEnabled ? "volume_off" : "volume_up";
    document.getElementById('tts-activate-btn').dataset.tooltip = isEnabled ? "Deactivate TTS" : "Activate TTS";
    if (!isEnabled) stop();
}

function play() {
    if (!ttsState.sentences.length || (ttsState.isSpeaking && !ttsState.isPaused)) return;
    document.getElementById('tts-activate-btn').classList.add('hidden');
    document.getElementById('tts-stop-btn').classList.remove('hidden');

    if (ttsState.isPaused) {
        if (ttsState.apiKey && ttsState.globalAudioElement) ttsState.globalAudioElement.play();
        else window.speechSynthesis.resume();
        ttsState.isPaused = false;
        ttsState.isSpeaking = true;
        updatePlaybackUI();
        return;
    }
    ttsState.isSpeaking = true;
    ttsState.isPaused = false;
    updatePlaybackUI();
    speakSentence();
}

function pause() {
    if (ttsState.isSpeaking && !ttsState.isPaused) {
        if (ttsState.apiKey && ttsState.globalAudioElement) ttsState.globalAudioElement.pause();
        else window.speechSynthesis.pause();
        ttsState.isPaused = true;
        updatePlaybackUI();
    }
}

function stop() {
    document.getElementById('tts-activate-btn').classList.remove('hidden');
    document.getElementById('tts-stop-btn').classList.add('hidden');
    window.speechSynthesis.cancel();
    if (ttsState.globalAudioElement) {
        ttsState.globalAudioElement.pause();
        ttsState.globalAudioElement.src = "";
    }
    ttsState.isSpeaking = false;
    ttsState.isPaused = false;
    ttsState.currentSentenceIndex = 0;
    clearHighlight();
    updatePlaybackUI();
}

function nextSentence() { jumpToSentenceAndPlay(ttsState.currentSentenceIndex + 1); }
function previousSentence() { jumpToSentenceAndPlay(ttsState.currentSentenceIndex - 1); }

function jumpToSentenceAndPlay(index) {
    if (index < 0 || index >= ttsState.sentences.length) return;
    stop();
    ttsState.currentSentenceIndex = index;
    play();
}

// --- Core Speech Logic ---

async function speakSentence() {
    if (ttsState.currentSentenceIndex >= ttsState.sentences.length) {
        stop();
        return;
    }
    const sentence = ttsState.sentences[ttsState.currentSentenceIndex];
    highlightSentence(sentence.spans);

    if (ttsState.apiKey) {
        // Pre-cache next few sentences
        for (let i = 1; i <= 3 && (ttsState.currentSentenceIndex + i) < ttsState.sentences.length; i++) {
            const nextSentence = ttsState.sentences[ttsState.currentSentenceIndex + i];
            speakWithGoogleApi(nextSentence.text, false).catch(e => console.error("Pre-cache failed:", e));
        }
        await speakWithGoogleApi(sentence.text, true);
    } else {
        speakWithBrowserApi(sentence.text);
    }
}

function speakWithBrowserApi(text) {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.onend = () => {
        if (!ttsState.isSpeaking) return;
        ttsState.currentSentenceIndex++;
        speakSentence();
    };
    utterance.onerror = (e) => console.error('Browser TTS Error:', e);
    window.speechSynthesis.speak(utterance);
}

function playAudio(url) {
    if (!ttsState.globalAudioElement) ttsState.globalAudioElement = new Audio();
    ttsState.globalAudioElement.src = url;
    ttsState.globalAudioElement.play();
    ttsState.globalAudioElement.onended = () => {
        if (!ttsState.isSpeaking) return;
        ttsState.currentSentenceIndex++;
        speakSentence();
    };
}

/**
 * Calculates and records the cost of a TTS synthesis request.
 * @param {number} characterCount - The number of characters being synthesized.
 */
async function recordTtsUsage(characterCount) {
    const tierKey = getVoiceTier(ttsState.selectedVoiceName);
    const tierPricing = VOICE_TIER_DATA[tierKey];

    if (!tierPricing) {
        console.error(`Could not find pricing for voice tier: ${tierKey}`);
        return;
    }

    const cost = (characterCount / 1000000) * tierPricing.price;

    try {
        const currentTotal = await getCookie('totalTtsCost') || 0;
        const newTotal = currentTotal + cost;
        chrome.storage.local.set({ totalTtsCost: newTotal });
        console.log(`Recorded TTS cost: $${cost.toFixed(6)}. New total: $${newTotal.toFixed(6)}`);
    } catch (error) {
        console.error("Failed to record TTS usage:", error);
    }
}

/**
 * Splits a string into smaller chunks without breaking words, ensuring no chunk exceeds the maxLength.
 * @param {string} text The text to split.
 * @param {number} maxLength The maximum length of each chunk.
 * @returns {string[]} An array of text chunks.
 */
function splitTextIntoChunks(text, maxLength = 500) {
    if (text.length <= maxLength) {
        return [text];
    }

    const chunks = [];
    const words = text.split(' ');
    let currentChunk = "";

    for (const word of words) {
        // Check if adding the next word (plus a space) would exceed the maxLength.
        if ((currentChunk.length + word.length + 1) > maxLength) {
            // If the current chunk is not empty, push it to the array.
            if (currentChunk.length > 0) {
                chunks.push(currentChunk.trim());
            }
            // Start a new chunk with the current word.
            currentChunk = word;
        } else {
            // Otherwise, add the word to the current chunk.
            currentChunk += (currentChunk.length === 0 ? "" : " ") + word;
        }
    }

    // Push the last remaining chunk.
    if (currentChunk.length > 0) {
        chunks.push(currentChunk.trim());
    }

    return chunks;
}

/**
 * Generates audio from text using Google's Text-to-Speech API.
 * Automatically handles long text by splitting it into chunks and concatenating the audio.
 * @param {string} text The text to synthesize.
 * @param {string} cacheKey A unique key for caching the audio.
 * @returns {Promise<string|null>} A local URL for the generated audio or null on error.
 */
async function generateAudioFromGoogle(text, cacheKey) {
    // Record usage BEFORE making the call
    await recordTtsUsage(text.length);

    // Split the text into manageable chunks for the API.
    const textChunks = splitTextIntoChunks(text);

    // This helper function fetches audio for a single text chunk.
    const fetchAudioChunk = async (chunk) => {
        const response = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${ttsState.apiKey}`, {
            method: 'POST',
            body: JSON.stringify({
                input: { text: chunk },
                voice: { languageCode: ttsState.selectedVoiceName.substring(0, 5), name: ttsState.selectedVoiceName },
                audioConfig: { audioEncoding: 'MP3' }
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`Google TTS Error: ${errorData.error.message}`);
        }

        const data = await response.json();
        // Decode the base64 audio content into a Uint8Array.
        const audioBytes = Uint8Array.from(atob(data.audioContent), c => c.charCodeAt(0));
        return new Blob([audioBytes], { type: 'audio/mp3' });
    };

    try {
        // Process all chunks in parallel and wait for all of them to complete.
        const audioBlobs = await Promise.all(textChunks.map(chunk => fetchAudioChunk(chunk)));

        // Concatenate all the audio blobs into a single blob.
        const concatenatedBlob = new Blob(audioBlobs, { type: 'audio/mp3' });

        // Create a local URL for the final concatenated audio.
        const localUrl = URL.createObjectURL(concatenatedBlob);

        // Cache the final audio URL.
        ttsState.audioCache.set(cacheKey, localUrl);
        return localUrl;

    } catch (error) {
        console.error("Failed to generate concatenated audio:", error);
        stop(); // Stop playback on API error.
        return null;
    }
}

async function speakWithGoogleApi(text, read_aloud) {
    const cacheKey = `${await stringToHashAsync(text)}-${ttsState.selectedVoiceName}`;
    const cachedAudio = ttsState.audioCache.get(cacheKey);

    if (cachedAudio) {
        if (read_aloud) playAudio(cachedAudio);
        return;
    }

    const localUrl = await generateAudioFromGoogle(text, cacheKey);
    if (localUrl && read_aloud) playAudio(localUrl);
}

// --- UI Helper Functions ---
function updatePlaybackUI() {
    document.getElementById('tts-play-btn').classList.toggle('hidden', (ttsState.isSpeaking && !ttsState.isPaused) || !ttsState.isEnabled);
    document.getElementById('tts-pause-btn').classList.toggle('hidden', !ttsState.isSpeaking || ttsState.isPaused);
}
function highlightSentence(spans) {
    clearHighlight();
    spans.forEach(span => span.classList.add('tts-highlight'));
    if (spans[0]) spans[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function clearHighlight() {
    document.querySelectorAll('.tts-highlight').forEach(el => el.classList.remove('tts-highlight'));
}

// --- Initialization ---
async function initializeTTSAfterActivation() {
    console.log('Initializing TTS...');
    document.getElementById('tts-play-btn').addEventListener('click', play);
    document.getElementById('tts-pause-btn').addEventListener('click', pause);
    document.getElementById('tts-stop-btn').addEventListener('click', stop);
    document.getElementById('tts-next-btn').addEventListener('click', nextSentence);
    document.getElementById('tts-prev-btn').addEventListener('click', previousSentence);

    const savedVoice = await getCookie('selectedVoiceName');
    if (savedVoice) ttsState.selectedVoiceName = savedVoice;


        console.log("TTS activated. Processing currently loaded pages...");

        // The global `pdfUrl` is set in annotation.js as `window.pdfUrl`.
        const currentPdfUrl = window.pdfUrl;
        if (!currentPdfUrl) {
            console.error("PDF URL not found. Cannot process pages for TTS.");
            return; // Exit if the URL isn't available
        }

        const allLoadedPages = document.querySelectorAll('.gsr-page');
        const allPagesList = Array.from(allLoadedPages); // Create a static list for correct indexing

        allLoadedPages.forEach(pageElement => {
            let pageNum;

            // Method 1: Use the data attribute if it exists (same as your observer).
            if (pageElement.dataset.pageNumber) {
                pageNum = parseInt(pageElement.dataset.pageNumber, 10);
            } else {
                // Method 2 (Fallback): Find the element's index.
                const pageIndex = allPagesList.indexOf(pageElement);
                if (pageIndex !== -1) {
                    pageNum = pageIndex + 1; // Page numbers are 1-based
                }
            }

            // If a page number was determined, process the page.
            if (pageNum) {
                processPageForTTS(pageElement, currentPdfUrl, pageNum).catch(err => {
                    console.error(`Error processing page ${pageNum} after TTS activation:`, err);
                });
            } else {
                console.warn("Could not determine page number for a loaded page element.", pageElement);
            }
        });

}


// --- Initialization ---
async function initializeTTS() {
    document.getElementById('tts-activate-btn').addEventListener('click', activateTTS);

    ttsState.apiKey = await getCookie('googleTtsApiKey');

    if (ttsState.apiKey) {
        document.getElementById('tts-activate-btn').classList.remove('hidden');
        document.getElementById('tts-border').classList.remove('hidden');
    }
}


document.addEventListener('DOMContentLoaded', initializeTTS);
