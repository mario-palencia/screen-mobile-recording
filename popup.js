document.addEventListener('DOMContentLoaded', () => {
  const startBtn = document.getElementById('start-btn');
  const screenshotBtn = document.getElementById('screenshot-btn');
  const notchToggle = document.getElementById('notch-toggle');
  const frameToggle = document.getElementById('frame-toggle');
  const mp4Toggle = document.getElementById('mp4-toggle');
  const webmToggle = document.getElementById('webm-toggle');
  const bgStyleSelect = document.getElementById('bg-style');
  const gifToggle = document.getElementById('gif-toggle');
  const devtoolsToggle = document.getElementById('devtools-toggle');
  
  // Load saved settings
  chrome.storage.local.get(['showNotch', 'showFrame', 'recordMP4', 'recordWebM', 'bgStyle', 'recordGif', 'openDevTools'], (result) => {
    if (result.showNotch !== undefined) {
      notchToggle.checked = result.showNotch;
    }
    if (result.showFrame !== undefined) {
      frameToggle.checked = result.showFrame;
    }
    // Default to true if not set
    mp4Toggle.checked = result.recordMP4 !== undefined ? result.recordMP4 : true;
    webmToggle.checked = result.recordWebM !== undefined ? result.recordWebM : true;
    
    if (result.bgStyle) {
        bgStyleSelect.value = result.bgStyle;
    }
    gifToggle.checked = result.recordGif !== undefined ? result.recordGif : true;
    
    if (result.openDevTools !== undefined) {
      devtoolsToggle.checked = result.openDevTools;
    }
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
      chrome.storage.local.set({ bgStyle: bgStyleSelect.value });
  });

  gifToggle.addEventListener('change', () => {
    chrome.storage.local.set({ recordGif: gifToggle.checked });
  });
  
  devtoolsToggle.addEventListener('change', () => {
    chrome.storage.local.set({ openDevTools: devtoolsToggle.checked });
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
      devtoolsToggle.disabled = true;
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
      devtoolsToggle.disabled = false;
    }
  }

  screenshotBtn.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    // Show visual feedback
    screenshotBtn.style.opacity = '0.5';
    screenshotBtn.querySelector('span').textContent = 'Capturing...';
    
    chrome.runtime.sendMessage({ 
      type: 'TAKE_SCREENSHOT_REQUEST',
      tabId: tab.id,
      showNotch: notchToggle.checked,
      showFrame: frameToggle.checked,
      bgStyle: bgStyleSelect.value
    });
    
    // Reset button after a delay (popup may close before this)
    setTimeout(() => {
      screenshotBtn.style.opacity = '1';
      screenshotBtn.querySelector('span').textContent = 'Screenshot';
    }, 1000);
  });

  startBtn.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    // Validate at least one format is selected
    if (!mp4Toggle.checked && !webmToggle.checked) {
      alert('Please select at least one output format (MP4 or WebM).');
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
          bgStyle: bgStyleSelect.value,
          recordGif: gifToggle.checked,
          gifMaxWidth: 400,
          gifFps: 5
        });
        
        // Handle DevTools auto-open if enabled
        if (devtoolsToggle.checked) {
            console.log('DevTools auto-open requested (placeholder)');
            // Note: Programmatically opening DevTools requires specific API usage or user gesture
            // which might be limited. For now, we store the preference.
        }
        
        updateUI(true);
      } else {

        // Stop
        chrome.runtime.sendMessage({ 
          type: 'STOP_RECORDING_REQUEST'
        });
        updateUI(false);
      }
    });
  });
});
