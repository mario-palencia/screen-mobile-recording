// Background service worker

// Ensure offscreen document exists
async function setupOffscreenDocument(path) {
  // Check if offscreen document already exists
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [path]
  });

  if (existingContexts.length > 0) {
    return;
  }

  // Create offscreen document
  if (creating) {
    await creating;
  } else {
    creating = chrome.offscreen.createDocument({
      url: path,
      reasons: ['USER_MEDIA'],
      justification: 'Recording screen content',
    });
    await creating;
    creating = null;
  }
}

let creating; // Promise keeper
let isRecording = false;
let recordingTabId = null;
let recordingStartTime = null;
let timerInterval = null;

chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  if (message.type === 'START_RECORDING_REQUEST') {
    const success = await startCapture(message.tabId, message.showNotch, message.showFrame, message.recordMP4, message.recordWebM, message.bgStyle, 'recording', message.recordGif, message.gifMaxWidth, message.gifFps);
    
    if (success) {
      isRecording = true;
      recordingTabId = message.tabId;
      
      // Start Icon Timer
      recordingStartTime = Date.now();
      chrome.action.setBadgeBackgroundColor({ color: '#FF0000' });
      chrome.action.setBadgeText({ text: '0:00' });
      
      // Disable popup so clicking icon fires onClicked
      chrome.action.setPopup({ popup: '' });

      timerInterval = setInterval(() => {
        const diff = Math.floor((Date.now() - recordingStartTime) / 1000);
        const mins = Math.floor(diff / 60);
        const secs = (diff % 60).toString().padStart(2, '0');
        chrome.action.setBadgeText({ text: `${mins}:${secs}` });
      }, 1000);
    }

  } else if (message.type === 'TAKE_SCREENSHOT_REQUEST') {
    startCapture(message.tabId, message.showNotch, message.showFrame, false, false, message.bgStyle, 'screenshot');
  } else if (message.type === 'STOP_RECORDING_REQUEST') {
    stopRecording();
  } else if (message.type === 'GET_RECORDING_STATE') {
    sendResponse({ isRecording });
  } else if (message.type === 'DOWNLOAD_RECORDING') {
    // Handle download from background to avoid offscreen limitations
    chrome.downloads.download({
      url: message.url,
      filename: message.filename
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        console.error('Download failed:', chrome.runtime.lastError);
      } else {
        console.log('Download started, ID:', downloadId);
      }
    });
  } else if (message.type === 'RECORDING_ERROR') {
    console.error('Recording error from offscreen:', message.error);
    stopRecording();
    chrome.action.setBadgeText({ text: 'ERR' });
    chrome.action.setBadgeBackgroundColor({ color: '#FF0000' });
  } else if (message.type === 'GIF_CONVERSION_ERROR') {
    console.warn('GIF conversion failed:', message.error);
  }
});

// Handle Icon Click to Stop
chrome.action.onClicked.addListener((tab) => {
  if (isRecording) {
    stopRecording();
  }
});

function stopRecording() {
  if (!isRecording) return;
  
  chrome.runtime.sendMessage({ target: 'offscreen', type: 'STOP_RECORDING' });
  isRecording = false;
  
  // Clear Timer
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  chrome.action.setBadgeText({ text: '' });
  
  // Re-enable popup
  chrome.action.setPopup({ popup: 'popup.html' });
  recordingTabId = null;
}

// Ensure link forcing script is injected on every page load during recording
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (isRecording && recordingTabId && tabId === recordingTabId && changeInfo.status === 'loading') {
    injectLinkEnforcer(tabId);
  }
});

function injectLinkEnforcer(tabId) {
  chrome.scripting.executeScript({
    target: { tabId: tabId },
    func: () => {
      // Prevent multiple injections
      if (window.__linkEnforcerAttached) return;
      window.__linkEnforcerAttached = true;
      
      window.addEventListener('click', (e) => {
        // Performance check: Fast exit if target is clearly not a link or interactive
        // But we must check ancestors. closest is native and fast.
        const link = e.target.closest('a');
        if (link && link.target === '_blank') {
          link.target = '_self';
        }
      }, false); // Use bubbling phase instead of capture to be less intrusive
    }
  }).catch(() => {});
}

async function startCapture(tabId, showNotch = true, showFrame = true, recordMP4 = true, recordWebM = true, bgStyle = 'transparent', mode = 'recording', recordGif = true, gifMaxWidth = 400, gifFps = 5) {
  try {
    // 1. Get tab info/dimensions via scripting
    let dimensions;
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: () => {
          return {
            width: window.innerWidth,
            height: window.innerHeight,
            devicePixelRatio: window.devicePixelRatio
          };
        }
      });
      dimensions = results[0].result;
      console.log('Detected dimensions:', dimensions);
    } catch (scriptErr) {
      console.error('Cannot access this page:', scriptErr);
      showProtectedPageError();
      return false;
    }
    
    // 2. Get Media Stream ID OR Screenshot
    if (mode === 'screenshot') {
      try {
        let windowId = chrome.windows.WINDOW_ID_CURRENT;
        try {
          const tab = await chrome.tabs.get(tabId);
          if (tab && tab.windowId) {
            windowId = tab.windowId;
          }
        } catch (e) {
          console.warn('Could not get tab info', e);
        }

        const screenshotUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
        console.log('Screenshot captured, setting up offscreen document');
        
        const existingContexts = await chrome.runtime.getContexts({
          contextTypes: ['OFFSCREEN_DOCUMENT']
        });
        
        if (existingContexts.length > 0) {
          await chrome.offscreen.closeDocument();
        }
        
        await setupOffscreenDocument('offscreen.html');
        
        setTimeout(() => {
          chrome.runtime.sendMessage({
            target: 'offscreen',
            type: 'PROCESS_SCREENSHOT',
            data: {
              screenshotUrl: screenshotUrl,
              width: dimensions.width,
              height: dimensions.height,
              devicePixelRatio: dimensions.devicePixelRatio,
              showNotch: showNotch,
              showFrame: showFrame,
              bgStyle: bgStyle
            }
          });
        }, 100);
        return true;
      } catch (captureErr) {
        console.error('Screenshot capture failed:', captureErr);
        showProtectedPageError();
        return false;
      }
    }

    // 3. For recording mode, get stream ID
    let streamId;
    try {
      streamId = await chrome.tabCapture.getMediaStreamId({
        targetTabId: tabId
      });
    } catch (captureErr) {
      console.error('Cannot capture this tab:', captureErr);
      showProtectedPageError();
      return false;
    }

    // 4. Setup Offscreen Doc
    const existingContexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT']
    });
    
    if (existingContexts.length > 0) {
      await chrome.offscreen.closeDocument();
    }
    
    await setupOffscreenDocument('offscreen.html');

    // 5. Send start message to offscreen
    setTimeout(() => {
      chrome.runtime.sendMessage({
        target: 'offscreen',
        type: 'START_RECORDING',
        data: {
          streamId: streamId,
          width: dimensions.width,
          height: dimensions.height,
          devicePixelRatio: dimensions.devicePixelRatio,
          showNotch: showNotch,
          showFrame: showFrame,
          recordMP4: recordMP4,
          recordWebM: recordWebM,
          bgStyle: bgStyle,
          mode: mode,
          recordGif: recordGif,
          gifMaxWidth: gifMaxWidth,
          gifFps: gifFps
        }
      });
      
      if (mode === 'recording') {
        injectLinkEnforcer(tabId);
      }
      
    }, 500);

    return true;

  } catch (err) {
    console.error('Error starting capture:', err);
    showProtectedPageError();
    return false;
  }
}

function showProtectedPageError() {
  chrome.action.setBadgeText({ text: '!' });
  chrome.action.setBadgeBackgroundColor({ color: '#FF6B6B' });
  
  // Save error message to storage for popup to display
  chrome.storage.local.set({ 
    lastError: 'This page is protected by Chrome and cannot be recorded or captured. Try on a regular website.',
    lastErrorTime: Date.now()
  });
  
  // Clear badge after 3 seconds
  setTimeout(() => {
    chrome.action.setBadgeText({ text: '' });
  }, 3000);
}
