chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  if (message.target !== 'offscreen') return;

  if (message.type === 'START_RECORDING') {
    startRecording(message.data);
  } else if (message.type === 'STOP_RECORDING') {
    stopRecording();
  }
});

// Notify background that offscreen is ready to receive messages
chrome.runtime.sendMessage({ type: 'OFFSCREEN_LOADED', target: 'background' });

let recorders = []; // Array of MediaRecorder instances
let sourceVideo;
let processCanvas;
let processContext;
let animationId;
let stream;
let canvasStream;
let cleanupTimeout;
let gifRecordRequested = false;
let gifMaxWidth = 400;
let gifFps = 5;
let gifFrames = [];
let gifFrameInterval = null;
let gifCanvasWidth = 0;
let gifCanvasHeight = 0;

async function startRecording(data) {
  // Cancel any pending cleanup from previous session
  if (cleanupTimeout) {
    clearTimeout(cleanupTimeout);
    cleanupTimeout = null;
  }
  
  // Ensure previous stream is fully stopped
  stopRecording();
  if (stream) {
    stream.getTracks().forEach(track => track.stop());
  }
  if (sourceVideo && sourceVideo.srcObject) {
    sourceVideo.srcObject = null;
  }
  
    const { streamId, width, height, devicePixelRatio, showNotch, showFrame, recordMP4, recordWebM, bgStyle, mode, recordGif, gifMaxWidth: gifW, gifFps: gifF } = data;
    console.log('Starting capture with bgStyle:', bgStyle, 'Mode:', mode, 'recordGif:', recordGif);
    gifRecordRequested = recordGif === true;
    gifMaxWidth = typeof gifW === 'number' ? gifW : 400;
    gifFps = typeof gifF === 'number' ? gifF : 5;
    console.log('GIF settings - requested:', gifRecordRequested, 'maxWidth:', gifMaxWidth, 'fps:', gifFps);

    let dpr = devicePixelRatio || 1;
    const screenLogicalW = width;
    const screenLogicalH = height;
    const bezel = showFrame ? 20 : 0;
    const cornerRadius = showFrame ? 55 : 0;
    const homeIndicatorW = Math.round(screenLogicalW * 0.35);
    const homeIndicatorH = Math.round(5 * (dpr/3));
    const frameLogicalW = screenLogicalW + (bezel * 2);
    const frameLogicalH = screenLogicalH + (bezel * 2);
  
    const statusDiv = document.getElementById('status');
    statusDiv.textContent = 'Starting recording...';

    // Helper canvas for color sampling
    const colorCanvas = new OffscreenCanvas(1, 1);
    const colorCtx = colorCanvas.getContext('2d', { willReadFrequently: true });
    
    // Abstracted Draw Logic to handle both Video and Image sources
    const renderFrame = (source) => {
      // Logic adapted from original draw function
      if (!source) return;
      
      // Safety check for dimensions
      let sourceWidth = 0;
      let sourceHeight = 0;
      
      if (source instanceof HTMLVideoElement) {
        if (source.readyState < 2) return; // Wait for metadata at least
        sourceWidth = source.videoWidth;
        sourceHeight = source.videoHeight;
      } else {
         return;
      }

      if (!sourceWidth || !sourceHeight) return;
      
      // Calculate crop area based on aspect ratio matching
      // The source includes DevTools UI (toolbar at top)
      // We need to exclude that and crop to match the mobile viewport proportions
      const scale = dpr;
      const screenW = screenLogicalW * scale;
      const screenH = screenLogicalH * scale;
      const statusBarH = 44 * scale;  // iOS standard status bar height
      
      // Estimate DevTools UI to exclude (minimal values to capture more content)
      const devToolsTopBar = 50;   // pixels to skip at top
      const devToolsBottomBar = 40;  // pixels to skip at bottom
      
      // Effective source area (excluding DevTools UI)
      const effectiveSourceH = sourceHeight - devToolsTopBar - devToolsBottomBar;
      const effectiveSourceY = devToolsTopBar;
      
      // Calculate the destination aspect ratio (using FULL screen height now)
      const destRatio = screenW / screenH;
      
      // Calculate how much of the effective source we need (crop horizontally)
      const sourceUsedH = effectiveSourceH;
      // Reduce width by 8% to leave lateral margins (frame won't clip text)
      const sourceUsedW = effectiveSourceH * destRatio * 0.92;
      const sourceStartX = Math.max(0, (sourceWidth - sourceUsedW) / 2);  // center crop
      const sourceStartY = effectiveSourceY;
      
      // Debug logging
      if (!window._logged) {
        console.log('=== DIMENSIONS DEBUG ===');
        console.log('Source (video):', sourceWidth, 'x', sourceHeight, 'ratio:', (sourceWidth/sourceHeight).toFixed(3));
        console.log('Effective source (excl DevTools):', sourceUsedW.toFixed(0), 'x', effectiveSourceH, 'starting at Y:', effectiveSourceY);
        console.log('Screen logical:', screenLogicalW, 'x', screenLogicalH);
        console.log('DPR:', dpr);
        console.log('Dest area:', screenW, 'x', screenH, 'ratio:', (screenW/screenH).toFixed(3));
        console.log('--- SOURCE CROP ---');
        console.log('Source used:', sourceUsedW.toFixed(0), 'x', sourceUsedH, '(centered)');
        console.log('Crop start:', sourceStartX.toFixed(0), ',', sourceStartY);
        window._logged = true;
      }
      
      // --- Sample Background Color from top center of the used source area ---
      const sampleX = sourceStartX + (sourceUsedW / 2);
      const sampleY = sourceStartY;
      colorCtx.drawImage(source, sampleX, sampleY, 1, 1, 0, 0, 1, 1);
      const [r, g, b] = colorCtx.getImageData(0, 0, 1, 1).data;
      const navColor = `rgb(${r}, ${g}, ${b})`;
      
      const ctx = processContext;
      
      const frameW = frameLogicalW * scale;
      const frameH = frameLogicalH * scale;
      const bezelSize = bezel * scale;
      const radius = cornerRadius * scale;
      
      // Clear the entire canvas explicitly
      ctx.globalAlpha = 1.0;
      ctx.globalCompositeOperation = 'source-over';
      
      if (bgStyle && bgStyle !== 'transparent' && bgStyle !== 'transparent-force') {
          // Fill with solid color
          ctx.fillStyle = bgStyle;
          ctx.fillRect(0, 0, processCanvas.width, processCanvas.height);
      } else {
          // Transparent clearing
          // Use destination-out for 'transparent-force' to be extra aggressive
          if (bgStyle === 'transparent-force') {
              ctx.globalCompositeOperation = 'destination-out';
              ctx.fillStyle = '#000000';
              ctx.fillRect(0, 0, processCanvas.width, processCanvas.height);
              ctx.globalCompositeOperation = 'source-over';
          } else {
              ctx.clearRect(0, 0, processCanvas.width, processCanvas.height);
          }
      }

      // --- Botones Laterales (Silver) ---
      if (showFrame) {
        ctx.fillStyle = '#D1D1D6';
        roundRect(ctx, -2*scale, 100*scale, 6*scale, 20*scale, 2*scale);
        roundRect(ctx, -2*scale, 140*scale, 6*scale, 45*scale, 2*scale);
        roundRect(ctx, -2*scale, 200*scale, 6*scale, 45*scale, 2*scale);
        roundRect(ctx, frameW - 4*scale, 160*scale, 6*scale, 70*scale, 2*scale);
        ctx.fill();
        
        // --- Marco Exterior (Chasis Metálico Silver) ---
        const grad = ctx.createLinearGradient(0, 0, frameW, 0);
        grad.addColorStop(0, '#8E8E93');
        grad.addColorStop(0.05, '#E5E5EA');
        grad.addColorStop(0.2, '#D1D1D6');
        grad.addColorStop(0.8, '#D1D1D6');
        grad.addColorStop(0.95, '#E5E5EA');
        grad.addColorStop(1, '#8E8E93');
        
        ctx.fillStyle = grad;
        roundRect(ctx, 0, 0, frameW, frameH, radius + bezelSize/2); 
        ctx.fill();
        
        // --- Bisel Negro Interno ---
        const rimWidth = 3.5 * scale;
        ctx.fillStyle = '#000000'; 
        roundRect(
          ctx, 
          rimWidth, 
          rimWidth, 
          frameW - (rimWidth * 2), 
          frameH - (rimWidth * 2), 
          radius
        ); 
        ctx.fill();
      } else {
        ctx.clearRect(0, 0, frameW, frameH);
      }
      
      // --- Pantalla ---
      ctx.save();
      ctx.translate(bezelSize, bezelSize);
      
      const innerRadius = radius - (showFrame ? (bezelSize - (3.5 * scale)) : 0); 
      
      roundRect(ctx, 0, 0, screenW, screenH, showFrame ? innerRadius : 0);
      ctx.clip();
      
      // 1. Dibujar Video/Imagen PRIMERO (ocupa toda la pantalla)
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      
      // Draw the cropped source area, scaled to fill the ENTIRE screen (not below status bar)
      // This way the web content is visible even behind the status bar (like real iOS)
      ctx.drawImage(
        source, 
        sourceStartX, sourceStartY, sourceUsedW, sourceUsedH,  // source crop
        0, 0, screenW, screenH                                  // destination: full screen
      );
      
      // 2. Dibujar Fondo de Barra Superior (semi-transparente para no tapar contenido)
      ctx.fillStyle = navColor;
      ctx.globalAlpha = 0.85;  // Semi-transparent
      ctx.fillRect(0, 0, screenW, statusBarH);
      ctx.globalAlpha = 1.0;
      
      // --- Barra de Estado (Status Bar) ---
      const now = new Date();
      const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
      
      const textY = statusBarH * 0.65;
      
      ctx.fillStyle = '#FFFFFF';
      ctx.font = `600 ${15 * scale}px -apple-system, BlinkMacSystemFont, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(timeStr, 50 * scale, textY); 
      
      const iconY = textY - (11 * scale);
      const rightMargin = screenW - (25 * scale);
      
      drawBattery(ctx, rightMargin - (25*scale), iconY, 22*scale, 11*scale);
      drawWifi(ctx, rightMargin - (55*scale), iconY - (2*scale), 16*scale);
      drawSignal(ctx, rightMargin - (80*scale), iconY, 17*scale, 11*scale);

      ctx.restore();
      
      // --- Dynamic Island / Notch ---
      if (showNotch) {
        const notchW = screenW * 0.3;
        const notchH = 35 * scale;
        const notchX = (frameW - notchW) / 2;
        const notchY = bezelSize + (12 * scale);
        
        ctx.fillStyle = '#000000';
        roundRect(ctx, notchX, notchY, notchW, notchH, notchH/2);
        ctx.fill();
        
        ctx.fillStyle = '#1A1A1A';
        ctx.beginPath();
        ctx.arc(notchX + notchW - (12*scale), notchY + notchH/2, 6*scale, 0, Math.PI*2);
        ctx.fill();
      }

      // --- Home Indicator ---
      const hiW = homeIndicatorW * scale;
      const hiH = homeIndicatorH * scale;
      const hiX = (frameW - hiW) / 2;
      const hiY = frameH - bezelSize - (8 * scale);
      
      ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
      roundRect(ctx, hiX, hiY, hiW, hiH, hiH/2);
      ctx.fill();
    };

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId
        }
      }
    });

    sourceVideo = document.getElementById('sourceVideo');
    sourceVideo.srcObject = stream;
    await sourceVideo.play();

    processCanvas = document.getElementById('processCanvas');
    // Ensure canvas is transparent at DOM level
    processCanvas.style.background = 'transparent';
    processContext = processCanvas.getContext('2d', { alpha: true });

    // Important: Fill with transparent first
    processContext.clearRect(0, 0, processCanvas.width, processCanvas.height);

    // Force even dimensions for video encoding stability
    processCanvas.width = (Math.ceil(frameLogicalW * dpr) + 1) & ~1;
    processCanvas.height = (Math.ceil(frameLogicalH * dpr) + 1) & ~1;

    // --- Drawing Functions ---
    function roundRect(ctx, x, y, w, h, r) {
      if (w < 2 * r) r = w / 2;
      if (h < 2 * r) r = h / 2;
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }

    function drawSignal(ctx, x, y, w, h) {
        const gap = w * 0.2;
        const barW = (w - (3 * gap)) / 4;
        for (let i = 0; i < 4; i++) {
            const barH = h * (0.4 + (0.2 * i));
            ctx.fillStyle = '#FFFFFF';
            roundRect(ctx, x + (i * (barW + gap)), y + (h - barH), barW, barH, 1);
            ctx.fill();
        }
    }

    function drawWifi(ctx, x, y, size) {
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 2.5;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.arc(x + size/2, y + size, size * 0.9, Math.PI * 1.25, Math.PI * 1.75);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x + size/2, y + size, size * 0.6, Math.PI * 1.25, Math.PI * 1.75);
        ctx.stroke();
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.arc(x + size/2, y + size * 0.9, size * 0.15, 0, Math.PI * 2);
        ctx.fill();
    }

    function drawBattery(ctx, x, y, w, h) {
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 2;
        roundRect(ctx, x, y, w, h, h/3);
        ctx.stroke();
        ctx.fillStyle = '#FFFFFF';
        roundRect(ctx, x + 2, y + 2, w - 4, h - 4, h/4);
        ctx.fill();
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.arc(x + w + 2, y + h/2, h/4, Math.PI * 0.5, Math.PI * 1.5, true);
        ctx.fill();
    }

    const draw = () => {
      renderFrame(sourceVideo);
    };
    
    // Draw first frame immediately before starting intervals
    draw();
    
    // Start drawing loop for Video
    animationId = setInterval(draw, 1000 / 30);
    
    canvasStream = processCanvas.captureStream(30);
    
    // --- GIF Frame Capture Setup ---
    gifFrames = [];
    if (gifRecordRequested) {
      const srcW = processCanvas.width;
      const srcH = processCanvas.height;
      gifCanvasWidth = Math.min(gifMaxWidth, srcW);
      gifCanvasHeight = Math.round(gifCanvasWidth * srcH / srcW);
      gifCanvasWidth = (gifCanvasWidth + 1) & ~1;
      gifCanvasHeight = (gifCanvasHeight + 1) & ~1;
      
      const gifCanvas = document.createElement('canvas');
      gifCanvas.width = gifCanvasWidth;
      gifCanvas.height = gifCanvasHeight;
      const gifCtx = gifCanvas.getContext('2d', { willReadFrequently: true });
      
      const captureGifFrame = () => {
        gifCtx.drawImage(processCanvas, 0, 0, gifCanvasWidth, gifCanvasHeight);
        const imageData = gifCtx.getImageData(0, 0, gifCanvasWidth, gifCanvasHeight);
        gifFrames.push(new Uint8Array(imageData.data));
      };
      
      // Start GIF capture after a short delay to ensure canvas has content
      setTimeout(() => {
        captureGifFrame();
        gifFrameInterval = setInterval(captureGifFrame, Math.round(1000 / gifFps));
        console.log('GIF frame capture started:', gifCanvasWidth, 'x', gifCanvasHeight, '@', gifFps, 'fps');
      }, 100);
    }
    
    // --- Recorder Setup ---
    recorders = [];

    // 1. MP4 Recorder (Default/Standard)
    if (recordMP4) {
      let mimeType = 'video/mp4'; 
      // Check for MP4 support explicitly
      if (!MediaRecorder.isTypeSupported(mimeType)) {
          console.warn('MP4 not supported, falling back to WebM (h264)');
          mimeType = 'video/webm;codecs=h264';
      }
      createAndStartRecorder(canvasStream, mimeType, 'mp4');
    }

    // 2. WebM Recorder (Transparent)
    if (recordWebM) {
      // Prefer VP9 for alpha channel support
      let mimeType = 'video/webm;codecs=vp9'; 
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'video/webm;codecs=vp8';
      }
      
      // Separate stream for WebM to avoid conflict with MP4 recorder if possible, 
      // though sharing *should* work. 
      // The issue might be sharing the SAME stream track for two recorders with different codecs?
      // Let's create a new capture stream for the second recorder to be safe.
      const webmStream = processCanvas.captureStream(30);
      
      if (MediaRecorder.isTypeSupported(mimeType)) {
          createAndStartRecorder(webmStream, mimeType, 'webm');
      } else {
          console.error("WebM with VP9/VP8 not supported");
      }
    }

    statusDiv.textContent = 'Recording...';

  } catch (err) {
    console.error('Error starting recording:', err);
    statusDiv.textContent = 'Error: ' + err.message;
    chrome.runtime.sendMessage({ type: 'RECORDING_ERROR', error: err.message });
  }
}

async function convertToGif(frames) {
  console.log('convertToGif called with', frames.length, 'frames');
  const statusDiv = document.getElementById('status');
  try {
    if (statusDiv) statusDiv.textContent = 'Converting to GIF...';
    if (!frames || frames.length === 0) {
      throw new Error('No frames captured for GIF');
    }
    if (!window.gifenc) {
      throw new Error('gifenc library not loaded');
    }
    console.log('gifenc loaded, processing', frames.length, 'frames at', gifCanvasWidth, 'x', gifCanvasHeight);
    const { GIFEncoder, quantize, applyPalette } = window.gifenc;
    const gif = GIFEncoder();
    const delayMs = Math.round(1000 / gifFps);
    let palette = null;
    for (let i = 0; i < frames.length; i++) {
      const data = frames[i];
      if (!palette) {
        palette = quantize(data, 256);
      }
      const index = applyPalette(data, palette);
      gif.writeFrame(index, gifCanvasWidth, gifCanvasHeight, { palette, delay: delayMs });
    }
    gif.finish();
    const bytes = gif.bytes();
    const gifBlob = new Blob([bytes], { type: 'image/gif' });
    const gifUrl = URL.createObjectURL(gifBlob);
    const gifFilename = `mobile-recording-${new Date().toISOString().replace(/:/g, '-').split('.')[0]}.gif`;
    console.log('GIF conversion complete, size:', gifBlob.size, 'filename:', gifFilename);
    chrome.runtime.sendMessage({
      type: 'DOWNLOAD_RECORDING',
      url: gifUrl,
      filename: gifFilename
    });
    setTimeout(() => URL.revokeObjectURL(gifUrl), 10000);
  } catch (err) {
    console.error('convertToGif error:', err);
    chrome.runtime.sendMessage({ type: 'GIF_CONVERSION_ERROR', error: err.message });
  }
  if (statusDiv) statusDiv.textContent = 'Idle';
}

function createAndStartRecorder(stream, mimeType, extension) {
  try {
    const recorder = new MediaRecorder(stream, { 
      mimeType: mimeType
    });
    
    // Safety check: if onstop never fires, we might have an issue.
    recorder.onerror = (e) => {
        console.error(`Recorder error for ${extension}:`, e);
        chrome.runtime.sendMessage({ type: 'RECORDING_ERROR', error: `Recorder error: ${e.error ? e.error.message : 'Unknown'}` });
    };
    
    const chunks = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        chunks.push(e.data);
      }
    };

    recorder.onstop = () => {
      // Sometimes onstop fires before ondataavailable for the last chunk
      // We should be careful, but usually it's fine.
      
      if (chunks.length === 0) {
        console.error(`No data chunks recorded for ${extension}`);
        chrome.runtime.sendMessage({ type: 'RECORDING_ERROR', error: `No data recorded for ${extension}` });
        return;
      }
      // Use a more generic type for the Blob to improve player compatibility
      const blobType = extension === 'mp4' && mimeType === 'video/mp4' ? 'video/mp4' : 'video/webm';
      const blob = new Blob(chunks, { type: blobType });
      console.log(`Finalizing ${extension} recording: ${blob.size} bytes`);
      
      const url = URL.createObjectURL(blob);
      
      chrome.runtime.sendMessage({
        type: 'DOWNLOAD_RECORDING',
        url: url,
        filename: `mobile-recording-${new Date().toISOString().replace(/:/g, '-').split('.')[0]}.${extension}`
      });
      
      // Cleanup this specific URL later
      setTimeout(() => URL.revokeObjectURL(url), 10000);

      // Convert to GIF once (use captured frames from gifFrames array)
      console.log('Checking gifFrames.length:', gifFrames.length);
      if (gifFrames.length > 0) {
        console.log('Starting GIF conversion with', gifFrames.length, 'frames...');
        const framesToConvert = gifFrames.slice();
        gifFrames = [];
        convertToGif(framesToConvert).catch((err) => {
          console.error('GIF conversion failed:', err);
          chrome.runtime.sendMessage({ type: 'GIF_CONVERSION_ERROR', error: err.message });
        });
      }
      
      // Check if all recorders are finished to do global cleanup
      checkCleanup();
    };

    recorder.start(); // Removed timeslice to prevent chunk fragmentation issues
    recorders.push(recorder);
    console.log(`Started recorder for ${extension} (${mimeType})`);
  } catch (e) {
    console.error(`Failed to create recorder for ${extension}:`, e);
  }
}

function stopRecording() {
  if (gifFrameInterval) {
    clearInterval(gifFrameInterval);
    gifFrameInterval = null;
    console.log('GIF frame capture stopped, total frames:', gifFrames.length);
  }
  
  if (recorders.length > 0) {
    recorders.forEach(recorder => {
      if (recorder.state !== 'inactive') {
        recorder.stop();
      }
    });
  } else {
    // If no recorders (maybe error occurred), just cleanup immediately
    performCleanup();
  }
}

function checkCleanup() {
  // If all recorders are inactive, perform global cleanup
  const allStopped = recorders.every(r => r.state === 'inactive');
  if (allStopped) {
    // Give a small buffer for downloads to trigger
    cleanupTimeout = setTimeout(performCleanup, 1000);
  }
}

function performCleanup() {
  if (animationId) clearInterval(animationId);
  if (stream) stream.getTracks().forEach(track => track.stop());
  if (canvasStream) canvasStream.getTracks().forEach(track => track.stop());
  // We need to stop the tracks of any other streams created manually
  // This is a bit of a leak if we don't track them, but for now the GC should handle it eventually 
  // or we can add them to a list.
  
  if (sourceVideo) sourceVideo.srcObject = null;
  
  const statusDiv = document.getElementById('status');
  if (statusDiv) statusDiv.textContent = 'Idle';
  
  recorders = [];
  cleanupTimeout = null;
}
