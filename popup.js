document.addEventListener('DOMContentLoaded', () => {
  const startBtn = document.getElementById('start-btn');
  const screenshotBtn = document.getElementById('screenshot-btn');
  const notchToggle = document.getElementById('notch-toggle');
  const frameToggle = document.getElementById('frame-toggle');
  const mp4Toggle = document.getElementById('mp4-toggle');
  const webmToggle = document.getElementById('webm-toggle');
  const bgStyleSelect = document.getElementById('bg-style');
  const bgColorPicker = document.getElementById('bg-color-picker');
  const gifToggle = document.getElementById('gif-toggle');
  const errorBanner = document.getElementById('error-banner');
  const errorMessage = document.getElementById('error-message');
  const errorDismiss = document.getElementById('error-dismiss');
  
  // Check for recent errors and display them
  chrome.storage.local.get(['lastError', 'lastErrorTime'], (result) => {
    if (result.lastError && result.lastErrorTime) {
      const errorAge = Date.now() - result.lastErrorTime;
      // Show error if it's less than 30 seconds old
      if (errorAge < 30000) {
        errorMessage.textContent = result.lastError;
        errorBanner.style.display = 'flex';
        // Clear the error from storage
        chrome.storage.local.remove(['lastError', 'lastErrorTime']);
      }
    }
  });
  
  // Dismiss error button
  errorDismiss.addEventListener('click', () => {
    errorBanner.style.display = 'none';
  });
  
  // Load saved settings
  chrome.storage.local.get(['showNotch', 'showFrame', 'recordMP4', 'recordWebM', 'bgStyle', 'customBgColor', 'recordGif'], (result) => {
    if (result.showNotch !== undefined) {
      notchToggle.checked = result.showNotch;
    }
    if (result.showFrame !== undefined) {
      frameToggle.checked = result.showFrame;
    }
    mp4Toggle.checked = result.recordMP4 !== undefined ? result.recordMP4 : true;
    webmToggle.checked = result.recordWebM !== undefined ? result.recordWebM : true;
    
    if (result.customBgColor) {
      bgColorPicker.value = result.customBgColor;
    }
    
    if (result.bgStyle) {
      if (result.bgStyle === 'custom' || result.bgStyle.startsWith('#') && !['#00FF00', '#0000FF', '#FFFFFF', '#000000'].includes(result.bgStyle)) {
        bgStyleSelect.value = 'custom';
        bgColorPicker.classList.add('active');
        if (result.bgStyle !== 'custom') {
          bgColorPicker.value = result.bgStyle;
        }
      } else {
        bgStyleSelect.value = result.bgStyle;
      }
    }
    
    gifToggle.checked = result.recordGif !== undefined ? result.recordGif : true;
  });

  // Save settings on change
  notchToggle.addEventListener('change', () => {
    chrome.storage.local.set({ showNotch: notchToggle.checked });
  });
  
  frameToggle.addEventListener('change', () => {
    chrome.storage.local.set({ showFrame: frameToggle.checked });
  });

  mp4Toggle.addEventListener('change', () => {
    chrome.storage.local.set({ recordMP4: mp4Toggle.checked });
  });

  webmToggle.addEventListener('change', () => {
    chrome.storage.local.set({ recordWebM: webmToggle.checked });
  });
  
  bgStyleSelect.addEventListener('change', () => {
    if (bgStyleSelect.value === 'custom') {
      bgColorPicker.classList.add('active');
      chrome.storage.local.set({ bgStyle: bgColorPicker.value });
    } else {
      bgColorPicker.classList.remove('active');
      chrome.storage.local.set({ bgStyle: bgStyleSelect.value });
    }
  });
  
  bgColorPicker.addEventListener('input', () => {
    if (bgStyleSelect.value === 'custom') {
      chrome.storage.local.set({ bgStyle: bgColorPicker.value, customBgColor: bgColorPicker.value });
    }
  });
  
  bgColorPicker.addEventListener('click', () => {
    if (bgStyleSelect.value !== 'custom') {
      bgStyleSelect.value = 'custom';
      bgColorPicker.classList.add('active');
      chrome.storage.local.set({ bgStyle: bgColorPicker.value });
    }
  });

  gifToggle.addEventListener('change', () => {
    chrome.storage.local.set({ recordGif: gifToggle.checked });
  });

  // Check initial state
  chrome.runtime.sendMessage({ type: 'GET_RECORDING_STATE' }, (response) => {
    if (response && response.isRecording) {
      updateUI(true);
    }
  });

  function updateUI(recording) {
    const startBtnText = startBtn.querySelector('span');
    
    if (recording) {
      startBtnText.textContent = 'Stop Recording';
      startBtn.classList.add('recording');
      
      screenshotBtn.disabled = true;
      screenshotBtn.style.opacity = 0.5;
      
      // Disable settings while recording
      notchToggle.disabled = true; 
      frameToggle.disabled = true;
      mp4Toggle.disabled = true;
      webmToggle.disabled = true;
      bgStyleSelect.disabled = true;
      gifToggle.disabled = true;
    } else {
      startBtnText.textContent = 'Start Recording';
      startBtn.classList.remove('recording');
      
      screenshotBtn.disabled = false;
      screenshotBtn.style.opacity = 1;
      
      // Enable settings
      notchToggle.disabled = false;
      frameToggle.disabled = false;
      mp4Toggle.disabled = false;
      webmToggle.disabled = false;
      bgStyleSelect.disabled = false;
      gifToggle.disabled = false;
    }
  }

  // Helper to get the actual background style value
  function getBackgroundStyle() {
    if (bgStyleSelect.value === 'custom') {
      return bgColorPicker.value;
    }
    return bgStyleSelect.value;
  }

  screenshotBtn.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    chrome.runtime.sendMessage({ 
      type: 'TAKE_SCREENSHOT_REQUEST',
      tabId: tab.id,
      showNotch: notchToggle.checked,
      showFrame: frameToggle.checked,
      bgStyle: getBackgroundStyle()
    });
    
    // Close popup immediately after sending message
    window.close();
  });

  startBtn.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    // Validate at least one format is selected (MP4, WebM, or GIF)
    if (!mp4Toggle.checked && !webmToggle.checked && !gifToggle.checked) {
      alert('Please select at least one output format (MP4, WebM, or GIF).');
      return;
    }

    // Get current state to toggle
    chrome.runtime.sendMessage({ type: 'GET_RECORDING_STATE' }, (response) => {
      const isRecording = response ? response.isRecording : false;
      
      if (!isRecording) {
        // Start
        chrome.runtime.sendMessage({ 
          type: 'START_RECORDING_REQUEST',
          tabId: tab.id,
          showNotch: notchToggle.checked,
          showFrame: frameToggle.checked,
          recordMP4: mp4Toggle.checked,
          recordWebM: webmToggle.checked,
          bgStyle: getBackgroundStyle(),
          recordGif: gifToggle.checked,
          gifMaxWidth: 400,
          gifFps: 5
        });
        
        // Close popup after starting recording
        window.close();
      } else {
        // Stop
        chrome.runtime.sendMessage({ 
          type: 'STOP_RECORDING_REQUEST'
        });
        
        // Close popup after stopping recording
        window.close();
      }
    });
  });
});
