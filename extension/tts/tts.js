let ttsState = {
    sentences: [],
    currentSentenceIndex: 0,
    isEnabled: false,
    isSpeaking: false,
    isPaused: false,
    audioCache: new Map(),
    // We'll get these from cookies/storage later
    selectedVoiceName: 'en-US-Wavenet-D',
    apiKey: '',
};

const pdfUrlToTextData = new Map();

/// Use PDF.Js by Mozila

/**
 * Fetches and parses a PDF page using PDF.js, returning its text content.
 * Caches results to avoid re-fetching the same PDF.
 *
 * @param {string} pdfUrl - The URL of the PDF.
 * @param {number} pageNum - The 1-based page number.
 * @returns {Promise<Array<Object>>} A promise that resolves with an array of PDF.js text items.
 */
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





/**
 * Processes a rendered page to extract sentences for TTS.
 * This version uses a corrected TreeWalker filter.
 *
 * @param {HTMLElement} pageElement The .gsr-page element containing the content.
 */
async function processPageForTTS(pageElement, pdfUrl, pageNum) {
    console.log(`Processing Page ${pageNum} for URL: ${pdfUrl}`);

    // --- 1. Get Text Data from PDF.js (from cache or by fetching) ---
    const pdfTextItems = await getPdfTextData(pdfUrl, pageNum);
    if (!pdfTextItems || pdfTextItems.length === 0) {
        console.log(`No text data from PDF.js for page ${pageNum}.`);
        return;
    }
     const pdfRawText = pdfTextItems.map(item => item.str).join(' ');


    const textContainer = pageElement.querySelector('.gsr-text-ctn');
    if (!textContainer) {
        console.error("Could not find '.gsr-text-ctn' in page element:", pageElement);
        return;
    }

    // --- 1. Collect all text-containing elements with a corrected filter ---
    const walker = document.createTreeWalker(textContainer, NodeFilter.SHOW_ELEMENT, {
        acceptNode: (node) => {
            // We accept a node if it's visible and contains text, but has no other ELEMENT children.
            // This correctly finds the "lowest-level" spans/divs that hold the actual text.
            const isVisible = node.offsetParent !== null;
            const hasText = node.textContent.trim() !== '';
            const hasNoElementChildren = !node.querySelector('*'); // Check if it has any element children

            if (isVisible && hasText && hasNoElementChildren) {
                return NodeFilter.FILTER_ACCEPT;
            }
            return NodeFilter.FILTER_REJECT;
        }
    });

    const elements = [];
    while (walker.nextNode()) {
        elements.push(walker.currentNode);
    }

    // Your check is perfect here.
    if (elements.length === 0) {
        console.log('No text elements found on this page, skipping...');
        return;
    }



    // --- 3. Split the full text into sentences ---
    const sentenceStrings = pdfRawText.split(/(?<=[.?!])\s+/).filter(s => s.trim());

    // --- 4. Map sentence strings back to the original elements ---
    let elementCursor = 0;
    let elementCharCursor = 0;
    sentenceStrings.forEach(sentenceText => {
        sentenceText = sentenceText.trim();
        if (sentenceText.length === 0) return;

        console.log(`Sentence Text: ${sentenceText}`);
        const sentenceElements = new Set();

        for (let i = 0; i < sentenceText.length; i++) {
            if (sentenceText[i] === ' ') {continue;}
            let jumping = '';
            while (elementCursor < elements.length) {
                if (elementCharCursor < elements[elementCursor].textContent.length){
                    jumping = jumping + elements[elementCursor].textContent[elementCharCursor];
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
            const newSentence = {
                text: sentenceText,
                spans: sentenceSpans,
                index: sentenceIndex
            };
            ttsState.sentences.push(newSentence);

            // --- 5. DEBUGGING: Log and highlight the found sentence ---
            console.log(`%c[TTS Sentence ${sentenceIndex}]:`, 'color: blue; font-weight: bold;', sentenceText);
            // debugHighlight(sentenceSpans);


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


/**
 * DEBUGGING HELPER: Applies a random background color to a set of elements.
 * @param {HTMLElement[]} elements - The array of elements to highlight.
 */
function debugHighlight(elements) {
    // Generate a random, light, semi-transparent color for highlighting
    const r = Math.floor(Math.random() * 155) + 100; // 100-255
    const g = Math.floor(Math.random() * 155) + 100; // 100-255
    const b = Math.floor(Math.random() * 155) + 100; // 100-255
    const randomColor = `rgba(${r}, ${g}, ${b}, 0.5)`;

    elements.forEach(el => {
        el.style.backgroundColor = randomColor;
        el.style.cursor = 'pointer'; // Make it obvious it's clickable
    });
}


// --- Playback Controls ---
function activateTTS() {
    const btnPrev = document.getElementById('tts-prev-btn');
    const btnPlay = document.getElementById('tts-play-btn');
    const btnPause = document.getElementById('tts-pause-btn');
    const btnStop = document.getElementById('tts-stop-btn');
    const btnNext = document.getElementById('tts-next-btn');
    const activateText = document.getElementById('tts-activate-btn-text');
    const ttsActivateBtn = document.getElementById('tts-activate-btn');
    if(ttsState.isEnabled){
        // Deactivate
        ttsState.isEnabled = false;

        btnPrev.classList.toggle('hidden', true);
        btnPlay.classList.toggle('hidden', true);
        btnPause.classList.toggle('hidden', true);
        btnStop.classList.toggle('hidden', true);
        btnNext.classList.toggle('hidden', true);
        activateText.textContent = "volume_up";
        ttsActivateBtn.dataset.tooltip = "Activate TTS";
    }else {
        //Activate
        ttsState.isEnabled = true;

        btnPrev.classList.toggle('hidden', false);
        btnPlay.classList.toggle('hidden', false);
        btnPause.classList.toggle('hidden', true);
        btnStop.classList.toggle('hidden', true);
        btnNext.classList.toggle('hidden', false);
        activateText.textContent = "volume_off";
        ttsActivateBtn.dataset.tooltip = "Deactivate TTS";
    }
}


function play() {
    if (!ttsState.sentences.length || (ttsState.isSpeaking && !ttsState.isPaused)) return;

    const btnActivate = document.getElementById('tts-activate-btn');
    const btnStop = document.getElementById('tts-stop-btn');
    btnActivate.classList.toggle('hidden', true);
    btnStop.classList.toggle('hidden', false);

    if (ttsState.isPaused) {
        // Resume logic here (for both Google API and browser)
        if (ttsState.apiKey && ttsState.globalAudioElement) {
            ttsState.globalAudioElement.play();
        } else {
            window.speechSynthesis.resume();
        }
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
        if (ttsState.apiKey && ttsState.globalAudioElement) {
            ttsState.globalAudioElement.pause();
        } else {
            window.speechSynthesis.pause();
        }
        ttsState.isPaused = true;
        updatePlaybackUI();
    }
}

function stop() {
    const btnActivate = document.getElementById('tts-activate-btn');
    const btnStop = document.getElementById('tts-stop-btn');
    btnActivate.classList.toggle('hidden', false);
    btnStop.classList.toggle('hidden', true);

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

function nextSentence() {
    jumpToSentenceAndPlay(ttsState.currentSentenceIndex + 1);
}

function previousSentence() {
    jumpToSentenceAndPlay(ttsState.currentSentenceIndex - 1);
}

function jumpToSentenceAndPlay(index) {
    if (index < 0 || index >= ttsState.sentences.length) return;
    stop(); // Stop current playback
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
    const textToSpeak = sentence.text; // Add filtering logic here if needed

    highlightSentence(sentence.spans);

    if (ttsState.apiKey) {
        const preCachePromises = [];
        for(let i = 1; i <= 3 && i+ttsState.currentSentenceIndex<ttsState.sentences.length; i++) {
            if (ttsState.sentences[ttsState.currentSentenceIndex + i]) {
                preCachePromises.push(
                    speakWithGoogleApi(ttsState.sentences[ttsState.currentSentenceIndex + i].text, false)
                );
            }
        }

        // Handle any potential errors from the pre-caching calls
        // This removes the "floating promise" warning
        Promise.all(preCachePromises).catch(error => {
            console.error("Failed to pre-cache a sentence:", error);
        });


        await speakWithGoogleApi(textToSpeak, true);
    } else {
        console.log('Using browser TTS', ttsState.apiKey);
        speakWithBrowserApi(textToSpeak);
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

async function generateAudioFromGoogle(text, cacheKey) {
    try {
        const response = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${ttsState.apiKey}`, {
            method: 'POST',
            body: JSON.stringify({
                input: {text: text},
                voice: {languageCode: ttsState.selectedVoiceName.substring(0, 5), name: ttsState.selectedVoiceName},
                audioConfig: {audioEncoding: 'MP3'}
            })
        });

        if (!response.ok) throw new Error(`Google TTS Error: ${(await response.json()).error.message}`);

        const data = await response.json();
        const audioBlob = new Blob([Uint8Array.from(atob(data.audioContent), c => c.charCodeAt(0))], {type: 'audio/mp3'});
        const localUrl = URL.createObjectURL(audioBlob);

        ttsState.audioCache.set(cacheKey, localUrl); // Cache for this session
        // For persistence, you could save this to chrome.storage.local
        return localUrl;
    } catch (error) {
        console.error(error);
        return null;
    }
}

async function speakWithGoogleApi(text, read_aloud) {
    // This is the key part adapted for a client-side extension
    console.log('Using Google API for TTS');
    const cacheKey = `${await stringToHashAsync(text)}-${ttsState.selectedVoiceName}`;
    const cachedAudio = ttsState.audioCache.get(cacheKey);

    if (cachedAudio) {
        if (read_aloud) {
            playAudio(cachedAudio);
        }
        return;
    }

    // Fetch from Google TTS API
    const localUrl = await generateAudioFromGoogle(text, cacheKey);
    if (localUrl && read_aloud) playAudio(localUrl);
}

// --- UI Helper Functions (can be in a separate tts_ui.js) ---

function updatePlaybackUI() {
    const playBtn = document.getElementById('tts-play-btn');
    const pauseBtn = document.getElementById('tts-pause-btn');

    playBtn.classList.toggle('hidden', ttsState.isSpeaking && !ttsState.isPaused);
    pauseBtn.classList.toggle('hidden', !ttsState.isSpeaking || ttsState.isPaused);
}

function highlightSentence(spans) {
    clearHighlight();
    spans.forEach(span => span.classList.add('tts-highlight'));
    spans[0].scrollIntoView({behavior: 'smooth', block: 'center'});
}

function clearHighlight() {
    document.querySelectorAll('.tts-highlight').forEach(el => el.classList.remove('tts-highlight'));
}

/**
 * Hashes a string using the fast and non-blocking Web Crypto API (SHA-256).
 * This is the recommended replacement for the slow, synchronous JavaScript loop.
 *
 * @param {string} str The string to hash.
 * @returns {Promise<string>} A promise that resolves with the hex string representation of the hash.
 */
async function stringToHashAsync(str) {
    // 1. Encode the string into a byte array.
    const textAsBuffer = new TextEncoder().encode(str);

    // 2. Use the Web Crypto API to hash the byte array.
    const hashBuffer = await crypto.subtle.digest('SHA-256', textAsBuffer);

    // 3. Convert the resulting ArrayBuffer to a hexadecimal string.
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    return hashHex;
}


async function initializeTTS() {
    console.log('Initializing TTS...');

    document.getElementById('tts-play-btn').addEventListener('click', play);
    document.getElementById('tts-pause-btn').addEventListener('click', pause);
    document.getElementById('tts-stop-btn').addEventListener('click', stop);
    document.getElementById('tts-next-btn').addEventListener('click', nextSentence);
    document.getElementById('tts-prev-btn').addEventListener('click', previousSentence);
    document.getElementById('tts-activate-btn').addEventListener('click', activateTTS);
    // Your tts_settings.js saves to cookies, so we can read from there.
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

    ttsState.apiKey = await getCookie('googleTtsApiKey');
    console.log('Google TTS API key:', ttsState.apiKey);
    const savedVoice = await getCookie('selectedVoiceName');
    if (savedVoice) ttsState.selectedVoiceName = savedVoice;
    if (ttsState.apiKey){
        const btnActivate = document.getElementById('tts-activate-btn');
        btnActivate.classList.toggle('hidden', false);

        const ttsBorder = document.getElementById('tts-border');
        ttsBorder.classList.toggle('hidden', false);
    }
}

document.addEventListener('DOMContentLoaded', initializeTTS);