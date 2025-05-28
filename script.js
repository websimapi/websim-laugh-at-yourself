class LaughAtYourselfApp {
    constructor() {
        this.isRecording = false;
        this.mediaRecorder = null;
        this.audioChunks = [];
        this.conversationHistory = this.loadConversationHistory(); // Entries will now include audio
        this.voiceSample = null; // Stores base64 data URL of user's voice for cloning
        this.userSpeakingStyle = this.loadSpeakingStyle();
        this.maxRetries = 3;
        this.baseRetryDelay = 1000; // 1 second
        this.liveRecognition = null;
        this.finalTranscript = '';
        this.lastInterimTranscript = '';

        // Define CORS proxies
        this.corsProxies = [
            { 
                name: 'CodeTabs',
                buildUrl: (targetUrl) => `https://api.codetabs.com/v1/proxy/?quest=${targetUrl}` 
                // Note: targetUrl should NOT be encoded for codetabs quest parameter
            },
            { 
                name: 'CORSProxy.io',
                buildUrl: (targetUrl) => `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`
            },
            { 
                name: 'AllOrigins',
                buildUrl: (targetUrl) => `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`
            },
            {
                name: 'ProxyCors.sh',
                // Prepends the proxy, targetUrl should be a full URL.
                buildUrl: (targetUrl) => `https://proxy.cors.sh/${targetUrl}`
            },
            {
                name: 'ThingProxy',
                // Prepends the proxy, targetUrl should be a full URL.
                buildUrl: (targetUrl) => `https://thingproxy.freeboard.io/fetch/${targetUrl}`
            }
        ];


        this.initializeElements();
        this.checkConsentStatus();
        this.setupEventListeners();
        this.updateConversationCount();
    }

    initializeElements() {
        this.recordBtn = document.getElementById('recordBtn');
        this.recordingIndicator = document.getElementById('recordingIndicator');
        this.messageContainer = document.getElementById('messageContainer');
        this.loadingOverlay = document.getElementById('loadingOverlay');
        this.loadingText = document.getElementById('loadingText');
        this.clearHistoryBtn = document.getElementById('clearHistory');
        this.downloadConversationBtn = document.getElementById('downloadConversationBtn'); // New button
        this.conversationCountEl = document.getElementById('conversationCount');
        this.audioVisualizer = document.getElementById('audioVisualizer');
        this.liveTranscription = document.getElementById('liveTranscription');
        this.transcriptionText = document.getElementById('transcriptionText');
        this.consentModal = document.getElementById('consentModal');
        this.acceptConsentBtn = document.getElementById('acceptConsent');
        this.declineConsentBtn = document.getElementById('declineConsent');
    }

    setupEventListeners() {
        this.recordBtn.addEventListener('click', () => this.toggleRecording());
        this.clearHistoryBtn.addEventListener('click', () => this.clearHistory());
        this.downloadConversationBtn.addEventListener('click', () => this.downloadConversation()); // Listener for download
        this.acceptConsentBtn.addEventListener('click', () => this.handleConsentAccept());
        this.declineConsentBtn.addEventListener('click', () => this.handleConsentDecline());
    }

    checkConsentStatus() {
        const hasConsented = localStorage.getItem('voiceCloneConsent');
        if (hasConsented === 'true') {
            this.consentModal.classList.add('hidden');
        } else {
            this.consentModal.classList.remove('hidden');
            // Disable main app interactions until consent is given
            this.recordBtn.disabled = true;
            this.clearHistoryBtn.disabled = true;
        }
    }

    handleConsentAccept() {
        localStorage.setItem('voiceCloneConsent', 'true');
        this.consentModal.classList.add('hidden');
        this.recordBtn.disabled = false;
        this.clearHistoryBtn.disabled = false;
    }

    handleConsentDecline() {
        alert('Voice cloning features require consent to function. Please refresh the page if you change your mind.');
        // Keep the modal visible and app disabled
    }

    async toggleRecording() {
        // Check consent before allowing recording
        const hasConsented = localStorage.getItem('voiceCloneConsent');
        if (hasConsented !== 'true') {
            alert('Please accept the voice cloning consent agreement first.');
            return;
        }

        if (!this.isRecording) {
            await this.startRecording();
        } else {
            this.stopRecording();
        }
    }

    async startRecording() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            this.mediaRecorder = new MediaRecorder(stream);
            this.audioChunks = [];

            this.mediaRecorder.ondataavailable = (event) => {
                this.audioChunks.push(event.data);
            };

            this.mediaRecorder.onstop = () => {
                this.processRecording();
            };

            this.mediaRecorder.start();
            this.isRecording = true;
            this.updateRecordingUI();
            this.startLiveTranscription();
            this.startAudioVisualization(stream);
        } catch (error) {
            console.error('Error accessing microphone:', error);
            this.addMessage('system', 'Error: Could not access microphone. Please check permissions.');
        }
    }

    stopRecording() {
        if (this.mediaRecorder && this.isRecording) {
            this.mediaRecorder.stop();
            this.mediaRecorder.stream.getTracks().forEach(track => track.stop());
            this.isRecording = false;
            this.updateRecordingUI();
            this.stopLiveTranscription();
            this.stopAudioVisualization();
        }
    }

    updateRecordingUI() {
        if (this.isRecording) {
            this.recordBtn.classList.add('recording');
            this.recordBtn.querySelector('.btn-text').textContent = 'Stop Recording';
            this.recordingIndicator.classList.add('active');
        } else {
            this.recordBtn.classList.remove('recording');
            this.recordBtn.querySelector('.btn-text').textContent = 'Start Recording';
            this.recordingIndicator.classList.remove('active');
        }
    }

    startAudioVisualization(stream) {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const analyser = audioContext.createAnalyser();
        const microphone = audioContext.createMediaStreamSource(stream);
        microphone.connect(analyser);

        analyser.fftSize = 32;
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        const bars = this.audioVisualizer.querySelectorAll('.bar');
        
        const animate = () => {
            if (!this.isRecording) return;
            
            analyser.getByteFrequencyData(dataArray);
            
            bars.forEach((bar, index) => {
                const value = dataArray[index] || 0;
                const height = (value / 255) * 40 + 5;
                bar.style.height = `${height}px`;
                bar.classList.add('active');
            });
            
            requestAnimationFrame(animate);
        };
        
        animate();
    }

    stopAudioVisualization() {
        const bars = this.audioVisualizer.querySelectorAll('.bar');
        bars.forEach(bar => {
            bar.classList.remove('active');
            bar.style.height = '5px';
        });
    }

    async retryWithBackoff(fn, retries = this.maxRetries, delay = this.baseRetryDelay) {
        try {
            return await fn();
        } catch (error) {
            if (retries <= 0) {
                throw error;
            }
            
            console.warn(`Operation failed, retrying in ${delay}ms... (${retries} retries left)`);
            await new Promise(resolve => setTimeout(resolve, delay));
            return this.retryWithBackoff(fn, retries - 1, delay * 2);
        }
    }

    async processRecording() {
        this.showLoading();
        const audioBlob = new Blob(this.audioChunks, { type: 'audio/wav' });
        
        try {
            // Step 1: Convert audio to text (using live transcription result)
            this.setLoadingStep(1);
            const transcription = await this.retryWithBackoff(
                () => this.transcribeAudio(audioBlob) // audioBlob not directly used if live transcript good
            );
            
            if (!transcription.trim()) {
                this.hideLoading();
                this.addMessage('system', 'No speech detected. Try speaking louder or closer to the microphone.');
                return;
            }

            this.addMessage('user', transcription);
            
            // Step 2: Generate AI response
            this.setLoadingStep(2);
            const aiResponse = await this.retryWithBackoff(
                () => this.generateFunnyResponse(transcription)
            );
            this.addMessage('ai', aiResponse);
            
            // Step 3: Generate voice clone and play
            this.setLoadingStep(3);
            // This method now handles TTS call, playback, and returns the URL
            const aiAudioUrl = await this.getAndPlayTTSAudio(aiResponse, audioBlob); 
            
            // Update conversation history with audio data
            this.updateConversationHistory(transcription, audioBlob, aiResponse, aiAudioUrl);
            this.updateSpeakingStyle(transcription);
            
        } catch (error) {
            console.error('Error processing recording:', error);
            let errorMessage = 'Error processing your recording. ';
            
            if (error.message.includes('Failed to fetch') || error.message.includes('network')) {
                errorMessage += 'Network connection issue. Please check your internet and try again.';
            } else if (error.message.includes('quota') || error.message.includes('limit')) {
                errorMessage += 'Service temporarily unavailable. Please try again in a moment.';
            } else if (error.message.includes('Text-to-speech service unavailable')) {
                 errorMessage += 'Could not generate AI voice at this time. Please try again.';
            }
            else {
                errorMessage += 'Please try again.';
            }
            
            this.addMessage('system', errorMessage);
        } finally {
            this.hideLoading();
        }
    }

    async transcribeAudio(audioBlob) {
        // Use the transcript from live recognition (final + last interim)
        const liveTranscript = (this.finalTranscript + this.lastInterimTranscript).trim();
        if (liveTranscript) {
            return liveTranscript;
        }
        
        // If no live transcript available, return error message
        throw new Error('No speech detected during recording');
    }

    async generateFunnyResponse(userInput) {
        try {
            const systemPrompt = `You are a humorous AI designed to make the user laugh. 
            Generate funny responses, jokes, puns, or witty observations based on the user's input. 
            Be playful, witty, and engaging - avoid anything mean or offensive. Adapt to their speaking style to make the humor more personal.
            
            User's speaking style patterns: ${JSON.stringify(this.userSpeakingStyle)}
            
            Recent conversation context: ${this.conversationHistory.slice(-5).map(msg => `${msg.role}: ${msg.content}`).join('\n')}
            
            Respond with humor and personality, keeping it light-hearted and fun. You can use their own words and phrases in a funny way.`;

            const completion = await websim.chat.completions.create({
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userInput }
                ]
            });

            return completion.content;
        } catch (error) {
            if (error.message.includes('network') || error.message.includes('fetch')) {
                throw new Error('Network error generating response');
            }
            throw error;
        }
    }

    async getAndPlayTTSAudio(text, userVoiceSampleBlob) {
        let voiceOptions = { text };
        let ttsResult;

        const attemptTTS = async (options) => {
            // Simplified retry as websim itself might have retries.
            // For more complex retry logic (e.g. specific error codes), expand this.
            return websim.textToSpeech(options);
        };
    
        // Priority: 1. Cached voice sample, 2. Current recording, 3. Default voice
        if (this.voiceSample) {
            voiceOptions.voice_sample = this.voiceSample;
        } else if (userVoiceSampleBlob && userVoiceSampleBlob.size > 0) {
            try {
                const arrayBuffer = await userVoiceSampleBlob.arrayBuffer();
                const uint8Array = new Uint8Array(arrayBuffer);
                const base64 = btoa(String.fromCharCode.apply(null, uint8Array));
                const dataUrl = `data:audio/wav;base64,${base64}`;
                
                voiceOptions.voice_sample = dataUrl;
                this.voiceSample = dataUrl; // Cache for future use
            } catch (voiceError) {
                console.warn('Failed to process user voice sample for cloning, will use default voice:', voiceError);
                // Fall through to use default voice if voice_sample couldn't be set
            }
        }
    
        try {
            if (voiceOptions.voice_sample) {
                // Try with voice sample first
                 ttsResult = await this.retryWithBackoff(() => attemptTTS(voiceOptions), 2, 500); // Fewer retries for custom voice
            } else {
                // If no voice sample, use default voice directly
                voiceOptions.voice = 'en-male';
                ttsResult = await this.retryWithBackoff(() => attemptTTS(voiceOptions));
            }
        } catch (error) {
            console.warn('TTS with preferred voice failed, attempting fallback to default voice:', error);
            try {
                // Explicit fallback to default voice
                const fallbackOptions = { text, voice: 'en-male' };
                ttsResult = await this.retryWithBackoff(() => attemptTTS(fallbackOptions));
            } catch (fallbackError) {
                console.error('TTS fallback to default voice also failed:', fallbackError);
                throw new Error('Text-to-speech service unavailable after fallback.');
            }
        }
    
        if (!ttsResult || !ttsResult.url) {
            throw new Error('Text-to-speech service did not return a valid audio URL.');
        }
    
        const audioUrl = ttsResult.url;
        const audio = new Audio(audioUrl);
        
        await new Promise((resolve, reject) => {
            audio.onloadeddata = () => {
                audio.play().then(resolve).catch(e => {
                    console.error("Error playing audio:", e);
                    reject(new Error('Playback failed: ' + e.message));
                });
            };
            audio.onerror = (e) => {
                // e is an Event, e.target.error might have more details
                console.error("Error loading audio:", e);
                let errorMsg = 'Failed to load audio for playback.';
                if (e.target && e.target.error && e.target.error.message) {
                    errorMsg += ` Details: ${e.target.error.message}`;
                }
                reject(new Error(errorMsg));
            };
            audio.onended = resolve; // Resolve when playback finishes
        });
    
        return audioUrl; // Return the URL for history and download
    }

    addMessage(type, content) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${type}-message`;
        
        const header = document.createElement('div');
        header.className = 'message-header';
        header.textContent = type === 'user' ? 'You said:' : 
                           type === 'ai' ? 'Your AI Comedian:' : 'System:';
        
        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        contentDiv.textContent = content;
        
        messageDiv.appendChild(header);
        messageDiv.appendChild(contentDiv);
        
        // Remove welcome message if it exists
        const welcomeMessage = this.messageContainer.querySelector('.welcome-message');
        if (welcomeMessage) {
            welcomeMessage.remove();
        }
        
        this.messageContainer.appendChild(messageDiv);
        this.messageContainer.scrollTop = this.messageContainer.scrollHeight;
    }

    showLoading() {
        this.loadingOverlay.classList.add('active');
        this.setLoadingStep(0);
    }

    hideLoading() {
        this.loadingOverlay.classList.remove('active');
        document.querySelectorAll('.step').forEach(step => step.classList.remove('active'));
    }

    setLoadingStep(stepNumber) {
        document.querySelectorAll('.step').forEach(step => step.classList.remove('active'));
        
        const messages = [
            'Getting ready...',
            'Listening to your wise words...',
            'Brewing up some giggles...',
            'Getting your voice clone ready to make you laugh...'
        ];
        
        this.loadingText.textContent = messages[stepNumber] || 'Processing...';
        
        if (stepNumber > 0) {
            const step = document.getElementById(`step${stepNumber}`);
            if (step) step.classList.add('active');
        }
    }

    updateConversationHistory(userMessage, userAudioBlob, aiMessage, aiAudioUrl) {
        this.conversationHistory.push(
            { role: 'user', content: userMessage, audio: userAudioBlob },
            { role: 'assistant', content: aiMessage, audio: aiAudioUrl } 
        );
        
        // Keep only last 20 messages (10 pairs) for performance in UI and storage
        if (this.conversationHistory.length > 20) {
            this.conversationHistory = this.conversationHistory.slice(-20);
        }
        
        this.saveConversationHistory();
        this.updateConversationCount();
    }

    updateSpeakingStyle(userInput) {
        // Analyze user's speaking patterns
        const words = userInput.toLowerCase().split(' ');
        const commonPhrases = this.extractPhrases(userInput);
        
        // Update speaking style profile
        words.forEach(word => {
            if (word.length > 3) { // Skip common short words
                this.userSpeakingStyle.commonWords[word] = 
                    (this.userSpeakingStyle.commonWords[word] || 0) + 1;
            }
        });
        
        commonPhrases.forEach(phrase => {
            this.userSpeakingStyle.phrases[phrase] = 
                (this.userSpeakingStyle.phrases[phrase] || 0) + 1;
        });
        
        this.saveSpeakingStyle();
    }

    extractPhrases(text) {
        // Simple phrase extraction (2-3 word combinations)
        const words = text.toLowerCase().split(' ');
        const phrases = [];
        
        for (let i = 0; i < words.length - 1; i++) {
            if (words[i].length > 2 && words[i + 1].length > 2) {
                phrases.push(`${words[i]} ${words[i + 1]}`);
            }
        }
        
        return phrases;
    }

    clearHistory() {
        this.conversationHistory = [];
        this.userSpeakingStyle = { commonWords: {}, phrases: {} };
        this.voiceSample = null; // Clear cached voice sample
        
        this.saveConversationHistory();
        this.saveSpeakingStyle();
        localStorage.removeItem('laughAtYourselfVoiceSample'); // Also clear any persistent sample if used
        
        this.messageContainer.innerHTML = `
            <div class="welcome-message">
                <p> Ready for a good laugh? Hit that mic and say something!</p>
            </div>
        `;
        
        this.updateConversationCount();
    }

    updateConversationCount() {
        const count = Math.floor(this.conversationHistory.length / 2);
        this.conversationCountEl.textContent = count;
    }

    loadConversationHistory() {
        const saved = localStorage.getItem('laughAtYourselfHistory');
        return saved ? JSON.parse(saved) : [];
    }

    saveConversationHistory() {
        localStorage.setItem('laughAtYourselfHistory', JSON.stringify(this.conversationHistory));
    }

    loadSpeakingStyle() {
        const saved = localStorage.getItem('laughAtYourselfStyle');
        return saved ? JSON.parse(saved) : { commonWords: {}, phrases: {} };
    }

    saveSpeakingStyle() {
        localStorage.setItem('laughAtYourselfStyle', JSON.stringify(this.userSpeakingStyle));
    }

    async downloadConversation() {
        if (this.conversationHistory.length === 0) {
            alert("Nothing to download! Start a conversation first.");
            return;
        }

        this.showLoading(); // Show loading overlay during zipping
        this.loadingText.textContent = "Zipping your laughs...";
        document.querySelectorAll('.step').forEach(s => s.style.display = 'none');


        const zip = new JSZip(); // Ensure JSZip is loaded via <script> tag
        let messageIndex = 0; // To number messages 1, 2, 3... for paired entries

        // Add a readme file
        zip.file("conversation_readme.txt", 
            "Laugh At Yourself! - Conversation Archive\n\n" +
            "This archive contains your conversation with the AI comedian.\n" +
            "Files are named with a message index and role (user/ai).\n" +
            "Each message includes:\n" +
            "  - A text file (.txt) with the transcribed/generated text.\n" +
            "  - An audio file (.wav for user, .mp3 or .wav for AI) with the recorded/generated speech.\n\n" +
            "Enjoy reliving the giggles! "
        );

        for (let i = 0; i < this.conversationHistory.length; i++) {
            const entry = this.conversationHistory[i];
            
            // Increment messageIndex for user messages, as they start a pair
            if (entry.role === 'user') {
                messageIndex++;
            }
            
            const paddedIndex = String(messageIndex).padStart(3, '0');
            const prefix = `message_${paddedIndex}_${entry.role}`;

            // Add text content
            zip.file(`${prefix}_text.txt`, entry.content);

            // Add audio content
            if (entry.audio) {
                let audioBlob;
                let audioExtension = 'wav'; // Default for user audio
                let successfullyFetchedAudio = false;

                if (entry.role === 'user' && entry.audio instanceof Blob) {
                    audioBlob = entry.audio;
                    successfullyFetchedAudio = true;
                } else if (entry.role === 'assistant' && typeof entry.audio === 'string') { // AI audio is a URL
                    const audioUrlToFetch = entry.audio;
                    console.log(`Attempting to fetch AI audio: ${audioUrlToFetch}`);

                    // Try CORS proxies
                    for (let proxyIndex = 0; proxyIndex < this.corsProxies.length; proxyIndex++) {
                        const proxy = this.corsProxies[proxyIndex];
                        const proxiedUrl = proxy.buildUrl(audioUrlToFetch);
                        this.loadingText.textContent = `Fetching AI audio via ${proxy.name} (${proxyIndex + 1}/${this.corsProxies.length})...`;
                        
                        try {
                            // Add a timeout to fetch requests for proxies
                            const controller = new AbortController();
                            const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 seconds timeout

                            const response = await fetch(proxiedUrl, { signal: controller.signal });
                            clearTimeout(timeoutId);

                            if (response.ok) {
                                audioBlob = await response.blob();
                                successfullyFetchedAudio = true;
                                console.log(`Successfully fetched via ${proxy.name}: ${audioUrlToFetch}`);
                                break; 
                            } else {
                                console.warn(`Proxy ${proxy.name} returned status ${response.status} for ${audioUrlToFetch} (URL: ${proxiedUrl})`);
                            }
                        } catch (error) {
                            console.warn(`Proxy ${proxy.name} failed for ${audioUrlToFetch} (URL: ${proxiedUrl}):`, error);
                        }
                    }

                    // If all proxies failed, try a direct fetch (might work if not a CORS issue, or CORS policy changed)
                    if (!successfullyFetchedAudio) {
                        this.loadingText.textContent = `Fetching AI audio directly (proxies failed)...`;
                        console.warn(`All proxies failed for ${audioUrlToFetch}. Attempting direct fetch.`);
                        try {
                            const controller = new AbortController();
                            const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 seconds timeout

                            const response = await fetch(audioUrlToFetch, { signal: controller.signal });
                            clearTimeout(timeoutId);

                            if (response.ok) {
                                audioBlob = await response.blob();
                                successfullyFetchedAudio = true;
                                console.log(`Successfully fetched directly: ${audioUrlToFetch}`);
                            } else {
                                throw new Error(`Direct fetch failed with status ${response.statusText} (URL: ${audioUrlToFetch})`);
                            }
                        } catch (directFetchError) {
                            console.error(`Direct fetch also failed for ${audioUrlToFetch}:`, directFetchError);
                        }
                    }
                    
                    if (successfullyFetchedAudio && audioBlob) {
                         // Determine extension from blob type or URL
                        const urlPath = new URL(audioUrlToFetch).pathname;
                        const extFromUrl = urlPath.substring(urlPath.lastIndexOf('.') + 1);
                        if (['mp3', 'wav', 'ogg', 'aac', 'm4a'].includes(extFromUrl.toLowerCase())) {
                             audioExtension = extFromUrl.toLowerCase();
                        } else if (audioBlob.type && audioBlob.type.startsWith('audio/')) {
                             audioExtension = audioBlob.type.split('/')[1];
                             if (audioExtension === 'mpeg') audioExtension = 'mp3'; // common case for mp3
                             else if (audioExtension === 'wave' || audioExtension === 'x-wav') audioExtension = 'wav';
                        } else {
                            audioExtension = 'mp3'; // Fallback for AI audio extension if type unknown
                        }
                    } else {
                        console.error(`Failed to fetch audio for ${prefix} from ${audioUrlToFetch} after all attempts.`);
                        zip.file(`${prefix}_audio_FETCH_ERROR.txt`, `Error fetching audio from: ${audioUrlToFetch}\nAll proxies and direct fetch failed.`);
                        // Continue to next message in history, audioBlob will be undefined for this one.
                    }
                }

                if (successfullyFetchedAudio && audioBlob) {
                    zip.file(`${prefix}_audio.${audioExtension}`, audioBlob);
                }
            }
        }

        try {
            this.loadingText.textContent = "Generating ZIP file...";
            const zipBlob = await zip.generateAsync({ type: "blob" }, (metadata) => {
                this.loadingText.textContent = `Compressing... ${metadata.percent.toFixed(0)}%`;
            });
            
            const link = document.createElement('a');
            link.href = URL.createObjectURL(zipBlob);
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            link.download = `laugh_at_yourself_conversation_${timestamp}.zip`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(link.href);
        } catch (error) {
            console.error("Error generating zip file:", error);
            alert("Failed to generate download. See console for details.");
        } finally {
            this.hideLoading();
            document.querySelectorAll('.step').forEach(s => s.style.display = 'block'); // Restore step display
        }
    }

    startLiveTranscription() {
        if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
            console.warn('Speech recognition not supported');
            return;
        }

        this.liveRecognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
        this.liveRecognition.continuous = true;
        this.liveRecognition.interimResults = true;
        this.liveRecognition.lang = 'en-US';
        
        this.finalTranscript = '';
        this.lastInterimTranscript = '';
        this.liveTranscription.classList.add('active');
        this.transcriptionText.textContent = 'Listening...';

        this.liveRecognition.onresult = (event) => {
            let interimTranscript = '';
            
            for (let i = event.resultIndex; i < event.results.length; i++) {
                const transcript = event.results[i][0].transcript;
                if (event.results[i].isFinal) {
                    this.finalTranscript += transcript + ' ';
                } else {
                    interimTranscript += transcript;
                }
            }
            
            // Store the latest interim transcript
            this.lastInterimTranscript = interimTranscript;
            
            const displayText = this.finalTranscript + interimTranscript;
            this.transcriptionText.textContent = displayText || 'Listening...';
            this.transcriptionText.className = interimTranscript ? 'transcription-text interim' : 'transcription-text';
        };

        this.liveRecognition.onerror = (event) => {
            console.warn('Live transcription error:', event.error);
            if (event.error !== 'no-speech') {
                this.transcriptionText.textContent = 'Transcription error - keep speaking...';
            }
        };

        this.liveRecognition.onend = () => {
            if (this.isRecording) {
                // Restart if still recording
                setTimeout(() => {
                    if (this.isRecording && this.liveRecognition) {
                        this.liveRecognition.start();
                    }
                }, 100);
            }
        };

        this.liveRecognition.start();
    }

    stopLiveTranscription() {
        if (this.liveRecognition) {
            this.liveRecognition.stop();
            this.liveRecognition = null;
        }
        this.liveTranscription.classList.remove('active');
    }
}

// Initialize the app when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new LaughAtYourselfApp();
});