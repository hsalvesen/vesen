export function playBeep() {
  try {
    // Create audio context
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    
    // Create oscillator for the beep tone
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    // Connect oscillator to gain node to speakers
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    // Configure the beep sound (200Hz frequency, deeper pitch for error messages)
    oscillator.frequency.setValueAtTime(200, audioContext.currentTime);
    oscillator.type = 'sine';
    
    // Configure volume envelope (quick fade in/out)
    gainNode.gain.setValueAtTime(0, audioContext.currentTime);
    gainNode.gain.linearRampToValueAtTime(0.3, audioContext.currentTime + 0.01);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2);
    
    // Play the beep for 200ms
    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.2);
    
    // Clean up
    oscillator.onended = () => {
      oscillator.disconnect();
      gainNode.disconnect();
    };
    
  } catch (error) {
    // Fallback: use console.beep or do nothing if Web Audio API is not supported
    console.warn('Could not play beep sound:', error);
    
    // Alternative fallback: try to use the system bell character
    try {
      console.log('\x07'); // ASCII bell character
    } catch (e) {
      // Silent fallback
    }
  }
}

/**
 * Alternative beep function using HTML5 Audio with data URL
 * This creates a short beep sound as a backup method
 */
export function playBeepAlt() {
  try {
    // Create a short beep sound using data URL
    const audio = new Audio();
    
    // Generate a simple beep tone using data URL
    const sampleRate = 8000;
    const duration = 0.2; // 200ms
    const frequency = 200; // 200Hz - deeper pitch for error messages
    const samples = sampleRate * duration;
    const buffer = new ArrayBuffer(44 + samples * 2);
    const view = new DataView(buffer);
    
    // WAV header
    const writeString = (offset, string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };
    
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + samples * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, samples * 2, true);
    
    // Generate sine wave
    for (let i = 0; i < samples; i++) {
      const sample = Math.sin(2 * Math.PI * frequency * i / sampleRate);
      const envelope = Math.exp(-i / (sampleRate * 0.1)); // Exponential decay
      const value = Math.round(sample * envelope * 0x7FFF);
      view.setInt16(44 + i * 2, value, true);
    }
    
    // Convert to blob and play
    const blob = new Blob([buffer], { type: 'audio/wav' });
    const url = URL.createObjectURL(blob);
    
    audio.src = url;
    audio.volume = 0.3;
    audio.play().catch(() => {
      // Silent fallback if audio play fails
      URL.revokeObjectURL(url);
    });
    
    // Clean up URL after playing
    audio.onended = () => {
      URL.revokeObjectURL(url);
    };
    
  } catch (error) {
    console.warn('Could not play alternative beep sound:', error);
  }
}