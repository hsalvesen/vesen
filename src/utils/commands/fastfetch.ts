// fastfetch: the device and browser details beside an OS logo. It loads the first time it runs
// (commands/system.ts), with its logos, which keeps it out of the initial chunk.
import { theme } from '../../stores/theme';
import { GUEST, HOST } from '../../vfs/identity';
import { get } from 'svelte/store';
import { fetchJson, isNetError } from '../../services/net';
import { escapeHtml } from '../../output/escape';
import { cancelledNotice } from '../notice';

// The public IP lookup is a nice-to-have, so it gets a short deadline.
const IP_LOOKUP_TIMEOUT_MS = 4000;

export async function fastfetch(args: string[], signal?: AbortSignal): Promise<string> {
  const currentTheme = get(theme);
  
  return new Promise<string>((resolve, reject) => {
    (async () => {
      try {
        // Only fastfetch draws the logos, so they load with it rather than with the page.
        const { getAppleLogo, getAndroidLogo, getWindowsLogo, getLinuxLogo } = await import('../osLogos');
        const userAgent = navigator.userAgent;
        const platform = navigator.platform;
        const language = navigator.language;
        const screen = window.screen;
        
        // Declare all variables at the top to avoid scoping issues
        let osName = 'Unknown OS';
        let osVersion = '';
        let logoLines: string[] = [];
        let hostName = 'Unknown';
        let kernelVersion = '';
        let architecture = '';
        let isAppleSilicon = false;
        let gpuRenderer = '';
        let appleChipGeneration = '';
        let appleChipModel = '';
        
        // Calculate screen dimensions early
        const screenWidth = screen.width;
        const screenHeight = screen.height;
        const pixelRatio = window.devicePixelRatio || 1;
        const actualWidth = screenWidth * pixelRatio;
        const actualHeight = screenHeight * pixelRatio;
        const aspectRatio = actualWidth / actualHeight;
        
        // Get CPU cores early
        const cpuCores = navigator.hardwareConcurrency || 'Unknown';
        
        // Advanced Mac detection using multiple signals
        const isMac = userAgent.includes('Mac') || platform.includes('Mac');
        
        // Detect Apple Silicon vs Intel using WebGL renderer info
        try {
          const canvas = document.createElement('canvas');
          const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
          if (gl && 'getExtension' in gl) {
            const webglContext = gl as WebGLRenderingContext;
            const debugInfo = webglContext.getExtension('WEBGL_debug_renderer_info');
            if (debugInfo) {
              gpuRenderer = webglContext.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
              
              // Smart Apple Silicon detection - look for Apple GPU patterns
              const appleGpuMatch = gpuRenderer.match(/Apple\s+(M\d+(?:\s+(?:Pro|Max|Ultra))?)/i);
              if (appleGpuMatch) {
                isAppleSilicon = true;
                appleChipModel = appleGpuMatch[1];
                
                // Extract generation number (M1, M2, M3, M4, etc.)
                const generationMatch = appleChipModel.match(/M(\d+)/);
                if (generationMatch) {
                  appleChipGeneration = generationMatch[1];
                }
              } else if (gpuRenderer.includes('Apple')) {
                isAppleSilicon = true;
                appleChipModel = 'Apple Silicon';
              }
            }
          }
        } catch (e) {
          // Fallback detection methods
          isAppleSilicon = navigator.maxTouchPoints > 1 && platform === 'MacIntel';
        }
        
        // Additional Apple Silicon detection methods
        if (!isAppleSilicon && isMac) {
          // Check for Apple Silicon indicators in user agent or other signals
          const hasAppleSiliconIndicators = 
            navigator.maxTouchPoints > 1 || // Touch support on Mac usually indicates Apple Silicon
            (typeof cpuCores === 'number' && cpuCores >= 8 && cpuCores % 2 === 0); // Apple Silicon often has even core counts
          
          if (hasAppleSiliconIndicators) {
            isAppleSilicon = true;
            appleChipModel = 'Apple Silicon';
          }
        }
        
        // Detect OS and extract information
        if (userAgent.includes('iPhone') || userAgent.includes('iPad')) {
          osName = 'iOS';
          logoLines = getAppleLogo();
          const iosMatch = userAgent.match(/OS (\d+_\d+)/);
          osVersion = iosMatch ? iosMatch[1].replace('_', '.') : '';
          architecture = 'arm64';
          kernelVersion = 'Darwin';
          hostName = userAgent.includes('iPhone') ? 'iPhone' : 'iPad';
        } else if (isMac) {
          osName = 'macOS';
          logoLines = getAppleLogo();
          
          // Modern macOS version detection using User-Agent Client Hints
          let detectedVersion = '';
          let detectedName = '';
          
          // Method 1: Try User-Agent Client Hints (modern, accurate method)
          if ((navigator as any).userAgentData) {
            try {
              const userAgentData = (navigator as any).userAgentData;
              
              // Check if we're on macOS
              if (userAgentData.platform === 'macOS') {
                // Request high-entropy values for platform version
                const ua = await userAgentData.getHighEntropyValues(['platformVersion']);
                
                if (ua.platformVersion) {
                  // Extract major version (e.g., "14.0.0" -> 14)
                  const majorVersion = parseInt(ua.platformVersion.split('.')[0]);
                  
                  // Map major version to macOS names
                  const macOSNames: { [key: number]: string } = {
                    11: 'Big Sur',
                    12: 'Monterey', 
                    13: 'Ventura',
                    14: 'Sonoma',
                    15: 'Sequoia',
                    16: 'macOS 16' // Future-proofing
                  };
                  
                  detectedName = macOSNames[majorVersion] || `macOS ${majorVersion}`;
                  detectedVersion = `${majorVersion}.0+`; // Always show + since we don't get patch versions
                  
                  // Validate that Apple Silicon requirements are met
                  if (isAppleSilicon && majorVersion < 11) {
                    // Apple Silicon cannot run macOS < 11, so this is incorrect
                    // Fall back to minimum supported version
                    detectedName = 'Big Sur';
                    detectedVersion = '11.0.0';
                  }
                }
              }
            } catch (error) {
              console.warn('User-Agent Client Hints failed:', error);
              // Fall back to other methods
            }
          }
          
          // Method 2: Fallback for browsers without UA-CH support (like Safari)
          if (!detectedVersion) {
            // For Apple Silicon, we know minimum requirements
            if (isAppleSilicon) {
              // Apple Silicon requires macOS 11.0+
              // Make educated guess based on chip generation and current date
              const currentYear = new Date().getFullYear();
              
              if (appleChipGeneration) {
                const generation = parseInt(appleChipGeneration);
                if (generation >= 4 && currentYear >= 2024) {
                  detectedName = 'Sonoma';
                  detectedVersion = '14.0';
                } else if (generation >= 3) {
                  detectedName = 'Ventura';
                  detectedVersion = '13.0';
                } else if (generation >= 2) {
                  detectedName = 'Monterey';
                  detectedVersion = '12.0';
                } else {
                  detectedName = 'Big Sur';
                  detectedVersion = '11.0';
                }
              } else {
                // Conservative estimate for Apple Silicon
                if (currentYear >= 2024) {
                  detectedName = 'Sonoma';
                  detectedVersion = '14.0';
                } else {
                  detectedName = 'Big Sur';
                  detectedVersion = '11.0';
                }
              }
            } else {
              // Intel Mac - use browser correlation as fallback
              const chromeMatch = userAgent.match(/Chrome\/(\d+)/);
              const safariMatch = userAgent.match(/Version\/(\d+\.\d+)/);
              
              if (chromeMatch) {
                const chromeVersion = parseInt(chromeMatch[1]);
                if (chromeVersion >= 120) {
                  detectedName = 'Sonoma';
                  detectedVersion = '14.0+';
                } else if (chromeVersion >= 110) {
                  detectedName = 'Ventura';
                  detectedVersion = '13.0+';
                } else if (chromeVersion >= 100) {
                  detectedName = 'Monterey';
                  detectedVersion = '12.0+';
                } else {
                  detectedName = 'Big Sur';
                  detectedVersion = '11.0+';
                }
              } else if (safariMatch) {
                const safariVersion = parseFloat(safariMatch[1]);
                if (safariVersion >= 17.0) {
                  detectedName = 'Sonoma';
                  detectedVersion = '14.0+';
                } else if (safariVersion >= 16.0) {
                  detectedName = 'Ventura';
                  detectedVersion = '13.0+';
                } else {
                  detectedName = 'Monterey';
                  detectedVersion = '12.0+';
                }
              } else {
                // Last resort fallback
                detectedName = 'macOS';
                detectedVersion = '12.0+';
              }
            }
          }
          
          // Set the final OS version
          osVersion = `${detectedName} ${detectedVersion}`;
          
          // Determine architecture based on multiple signals
          architecture = isAppleSilicon ? 'arm64' : 'x86_64';
          
          // Estimate kernel version based on macOS version
          if (osVersion.includes('Sequoia')) kernelVersion = 'Darwin 24.0.0';
          else if (osVersion.includes('Sonoma')) kernelVersion = 'Darwin 23.0.0';
          else if (osVersion.includes('Ventura')) kernelVersion = 'Darwin 22.0.0';
          else kernelVersion = 'Darwin';
          
          // Better Mac model detection using multiple signals
          if (isAppleSilicon) {
            // Use screen resolution, core count, and other signals to estimate model
            const cores = typeof cpuCores === 'string' ? parseInt(cpuCores) : cpuCores;
            
            let modelType = 'Mac';
            let screenCategory = '';
            
            // Categorise by screen size/resolution
            if (actualWidth <= 2560) {
              screenCategory = '13-inch';
              modelType = 'MacBook Air';
            } else if (actualWidth <= 2880) {
              screenCategory = '15-inch';
              modelType = 'MacBook Air';
            } else if (actualWidth <= 3024) {
              screenCategory = '14-inch';
              modelType = 'MacBook Pro';
            } else if (actualWidth <= 3456) {
              screenCategory = '16-inch';
              modelType = 'MacBook Pro';
            } else {
              screenCategory = '24-inch';
              modelType = 'iMac';
            }
            
            // Estimate generation based on performance characteristics
            let estimatedGeneration = '';
            if (appleChipGeneration) {
              estimatedGeneration = `M${appleChipGeneration}`;
            } else {
              // Fallback estimation based on core count and other factors
              if (cores >= 12) estimatedGeneration = 'M3/M4';
              else if (cores >= 10) estimatedGeneration = 'M2/M3';
              else estimatedGeneration = 'M1/M2';
            }
            
            // Estimate chip variant based on core count
            let chipVariant = '';
            if (cores >= 16) chipVariant = 'Max/Ultra';
            else if (cores >= 10) chipVariant = 'Pro';
            else chipVariant = 'Base';
            
            hostName = `${modelType} (${screenCategory}, ${estimatedGeneration}${chipVariant !== 'Base' ? ' ' + chipVariant : ''})`;
          } else {
            // Intel Mac patterns
            if (screenWidth >= 2880) {
              hostName = 'MacBook Pro (Intel, 15-16 inch)';
            } else if (screenWidth >= 2560) {
              hostName = 'MacBook Pro (Intel, 13-14 inch)';
            } else if (screenWidth >= 1440) {
              hostName = 'MacBook Air (Intel)';
            } else {
              hostName = 'Mac (Intel)';
            }
          }
        } else if (userAgent.includes('Android')) {
          osName = 'Android';
          logoLines = getAndroidLogo();
          const androidMatch = userAgent.match(/Android (\d+\.?\d*)/);
          osVersion = androidMatch ? androidMatch[1] : '';
          architecture = 'arm64';
          kernelVersion = 'Linux';
          hostName = 'Android Device';
        } else if (userAgent.includes('Win')) {
          osName = 'Windows';
          logoLines = getWindowsLogo();
          if (userAgent.includes('Windows NT 10.0')) {
            osVersion = '11'; // Most modern systems
          } else if (userAgent.includes('Windows NT 6.3')) osVersion = '8.1';
          else if (userAgent.includes('Windows NT 6.1')) osVersion = '7';
          architecture = userAgent.includes('WOW64') || userAgent.includes('Win64') ? 'x86_64' : 'x86';
          kernelVersion = 'NT 10.0';
          hostName = 'Windows PC';
        } else if (userAgent.includes('Linux') || userAgent.includes('X11')) {
          osName = 'Linux';
          logoLines = getLinuxLogo();
          architecture = userAgent.includes('x86_64') ? 'x86_64' : 'x86';
          kernelVersion = 'Linux';
          hostName = 'Linux PC';
        }

        // Dynamic uptime calculation
        const uptime = Math.floor(performance.now() / 1000);
        const uptimeHours = Math.floor(uptime / 3600);
        const uptimeMinutes = Math.floor((uptime % 3600) / 60);
        
        // Intelligent memory estimation
        let memoryUsed = 'Unknown';
        let memoryTotal = 'Unknown';
        let memoryPercentage = '';
        
        const memoryInfo = (performance as any).memory;
        if (memoryInfo) {
          const jsHeapUsed = memoryInfo.usedJSHeapSize;
          const jsHeapTotal = memoryInfo.totalJSHeapSize;
          const jsHeapLimit = memoryInfo.jsHeapSizeLimit;
          
          // Estimate system memory based on JS heap limit and other factors
          let estimatedSystemMemory = 8; // Base assumption
          
          // Use heap limit to estimate system memory
          const heapLimitGB = jsHeapLimit / (1024 * 1024 * 1024);
          if (heapLimitGB > 3.5) estimatedSystemMemory = 16;
          if (heapLimitGB > 7) estimatedSystemMemory = 32;
          
          // Apple Silicon Macs often have specific memory configurations
          if (isAppleSilicon) {
            if (heapLimitGB > 3.5 && heapLimitGB < 7) estimatedSystemMemory = 24; // Common M2 config
            else if (heapLimitGB > 7) estimatedSystemMemory = 32;
          }
          
          // Estimate actual memory usage (JS heap is just a fraction)
          const estimatedUsage = 4 + (jsHeapUsed / (1024 * 1024 * 1024)) * 2; // Base OS + scaled JS usage
          const percentage = Math.round((estimatedUsage / estimatedSystemMemory) * 100);
          
          memoryUsed = `${estimatedUsage.toFixed(2)} GiB`;
          memoryTotal = `${estimatedSystemMemory}.00 GiB`;
          memoryPercentage = ` (${percentage}%)`;
        }

        // Dynamic CPU detection based on patterns, not hardcoded models
        let cpuName = 'Unknown CPU';
        let cpuSpeed = '';
        
        if (osName === 'macOS' && isAppleSilicon) {
          const cores = typeof cpuCores === 'string' ? parseInt(cpuCores) : cpuCores;
          
          if (appleChipModel && appleChipModel !== 'Apple Silicon') {
            // Use detected chip model from GPU renderer
            cpuName = `Apple ${appleChipModel} (${cpuCores})`;
          } else {
            // Fallback: estimate based on core count and generation patterns
            let estimatedModel = 'Apple Silicon';
            
            if (cores <= 8) {
              estimatedModel = 'Apple Silicon (Base)';
            } else if (cores <= 12) {
              estimatedModel = 'Apple Silicon (Pro)';
            } else {
              estimatedModel = 'Apple Silicon (Max/Ultra)';
            }
            
            cpuName = `${estimatedModel} (${cpuCores})`;
          }
          
          // Dynamic speed estimation based on generation
          if (appleChipGeneration) {
            const generation = parseInt(appleChipGeneration);
            // Each generation typically gets faster
            const baseSpeed = 3.0 + (generation - 1) * 0.2; // M1: 3.0, M2: 3.2, M3: 3.4, M4: 3.6, etc.
            cpuSpeed = ` @ ${baseSpeed.toFixed(2)} GHz`;
          } else {
            cpuSpeed = ' @ 3.20 GHz'; // Conservative estimate
          }
        } else if (osName === 'macOS') {
          cpuName = `Intel CPU (${cpuCores})`;
          cpuSpeed = ' @ 2.60 GHz';
        } else {
          cpuName = `${architecture} CPU (${cpuCores})`;
        }

        // Dynamic GPU detection
        let gpuName = gpuRenderer || 'Integrated Graphics';
        if (osName === 'macOS' && isAppleSilicon) {
          if (gpuRenderer && gpuRenderer.includes('Apple')) {
            // Use actual GPU renderer info
            gpuName = `${gpuRenderer} [Integrated]`;
          } else if (appleChipModel && appleChipModel !== 'Apple Silicon') {
            // Estimate GPU based on CPU model
            const cores = typeof cpuCores === 'string' ? parseInt(cpuCores) : cpuCores;
            let gpuCores = Math.max(8, Math.floor(cores * 1.2)); // Rough estimation
            
            if (appleChipGeneration) {
              const generation = parseInt(appleChipGeneration);
              const baseGpuSpeed = 1.2 + (generation - 1) * 0.1; // Progressive improvement
              gpuName = `Apple ${appleChipModel} GPU (${gpuCores}) @ ${baseGpuSpeed.toFixed(2)} GHz [Integrated]`;
            } else {
              gpuName = `Apple ${appleChipModel} GPU [Integrated]`;
            }
          } else {
            gpuName = 'Apple Silicon GPU [Integrated]';
          }
        }

        // Rest of the implementation continues...
        // (Display info, network, battery, etc. - same as before)
        
        // Display information with refresh rate detection
        const displayInfo = `${screen.width}x${screen.height}`;
        const colorDepth = screen.colorDepth;
        
        // Try to detect refresh rate
        let refreshRate = '60 Hz';
        try {
          const mediaDevices = (navigator as any).mediaDevices;
          if (mediaDevices && 'getDisplayMedia' in mediaDevices) {
            // Modern displays often support higher refresh rates
            if (screen.width >= 2560) refreshRate = '120 Hz';
          }
        } catch {
          // Fall back if mediaDevices or property probing fails
          refreshRate = 'Unknown';
        }

        // Network information
        let localIP = 'Unknown';
        try {
          const ipData = await fetchJson<{ ip?: unknown } | null>('https://api.ipify.org?format=json', {
            signal,
            timeoutMs: IP_LOOKUP_TIMEOUT_MS
          });
          localIP = typeof ipData?.ip === 'string' ? ipData.ip : 'Unable to fetch';
        } catch (error) {
          if (signal?.aborted || (isNetError(error) && error.kind === 'abort')) {
            resolve(cancelledNotice('fastfetch'));
            return;
          }
          localIP = 'Unable to fetch';
        }

        // Dynamic battery and power information
        let batteryInfo = 'Unknown';
        let powerAdapter = 'Unknown';
        if ('getBattery' in navigator) {
          try {
            const battery = await (navigator as any).getBattery();
            const level = Math.round(battery.level * 100);
            const charging = battery.charging;
            batteryInfo = `${level}%${charging ? ' [AC connected]' : ''}`;
            
            // Determine power adapter based on detected Mac model
            if (charging) {
              if (hostName.includes('MacBook Air') && hostName.includes('M2')) {
                powerAdapter = '35W Dual USB-C Port Power Adapter';
              } else if (hostName.includes('MacBook Pro (14-inch)')) {
                powerAdapter = '67W USB-C Power Adapter';
              } else if (hostName.includes('MacBook Pro (16-inch)')) {
                powerAdapter = '140W USB-C Power Adapter';
              } else if (isAppleSilicon) {
                powerAdapter = '67W USB-C Power Adapter';
              } else {
                powerAdapter = '85W MagSafe Power Adapter';
              }
            } else {
              powerAdapter = 'Not connected';
            }
          } catch {
            batteryInfo = 'Not available';
            powerAdapter = 'Not available';
          }
        }

        // Dynamic package detection (simulate realistic numbers)
        const packages = 'npm packages in node_modules';
        
        // Shell detection
        const shell = `Vesen Terminal v${__APP_VERSION__}`;
        
        // Theme information
        const wmTheme = currentTheme.name;
        
        // Font detection
        const font = 'System Font';
        
        // Terminal information
        const terminal = 'Vesen Web Terminal';
        
        // Storage estimation
        let diskInfo = 'Unknown';
        if ((navigator as any).storage && 'estimate' in (navigator as any).storage) {
          try {
            const estimate = await navigator.storage.estimate();
            if (estimate.quota && estimate.usage) {
              const totalGB = Math.round(estimate.quota / 1024 / 1024 / 1024);
              const usedGB = Math.round(estimate.usage / 1024 / 1024 / 1024);
              const percentage = Math.round((estimate.usage / estimate.quota) * 100);
              diskInfo = `${usedGB} GiB / ${totalGB} GiB (${percentage}%) - WebStorage`;
            }
          } catch {
            diskInfo = 'Not available';
          }
        }

        // The visitor and the host, as the prompt and /etc/passwd name them (F024).
        const userHost = `${GUEST.name}@${HOST}`;

        // ASCII art colour blocks (now using CSS variables for dynamic themes)
        const colourBlocksAscii = `
<div class="art" aria-hidden="true" style="margin-top: 8px; margin-bottom: 8px;">
<span style="color: var(--theme-black);">███</span><span style="color: var(--theme-red);">███</span><span style="color: var(--theme-green);">███</span><span style="color: var(--theme-yellow);">███</span><span style="color: var(--theme-blue);">███</span><span style="color: var(--theme-purple);">███</span><span style="color: var(--theme-cyan);">███</span><span style="color: var(--theme-white);">███</span>
<span style="color: var(--theme-bright-black);">███</span><span style="color: var(--theme-bright-red);">███</span><span style="color: var(--theme-bright-green);">███</span><span style="color: var(--theme-bright-yellow);">███</span><span style="color: var(--theme-bright-blue);">███</span><span style="color: var(--theme-bright-purple);">███</span><span style="color: var(--theme-bright-cyan);">███</span><span style="color: var(--theme-bright-white);">███</span>
</div><span class="sr-only">The theme's sixteen colours</span>`;

        // Format system information
        const infoData = [
          { label: 'OS', value: `${osName} ${osVersion} ${architecture}` },
          { label: 'Host', value: hostName },
          { label: 'Kernel', value: kernelVersion },
          { label: 'Uptime', value: `${uptimeHours} hours, ${uptimeMinutes} mins` },
          { label: 'Packages', value: packages },
          { label: 'Shell', value: shell },
          { label: 'Display', value: `${displayInfo} @ ${refreshRate}` },
          { label: 'DE', value: osName === 'macOS' ? 'Aqua' : osName === 'Windows' ? 'Windows Shell' : 'Unknown' },
          { label: 'WM', value: osName === 'macOS' ? 'Quartz Compositor' : osName === 'Windows' ? 'Desktop Window Manager' : 'Unknown' },
          { label: 'WM Theme', value: `<span class="current-theme-name">${escapeHtml(wmTheme)}</span>` },
          { label: 'Font', value: font },
          { label: 'Cursor', value: 'Default System Cursor' },
          { label: 'Terminal', value: terminal },
          { label: 'CPU', value: `${cpuName}${cpuSpeed}` },
          { label: 'GPU', value: gpuName },
          { label: 'Memory', value: `${memoryUsed} / ${memoryTotal}${memoryPercentage}` },
          { label: 'Swap', value: 'Not available in browser' },
          { label: 'Disk (/)', value: diskInfo },
          { label: 'Local IP', value: localIP },
          { label: 'Battery', value: batteryInfo },
          { label: 'Power Adapter', value: powerAdapter },
          { label: 'Locale', value: language }
        ];

        // Create HTML structure
        // The logo is art: screen readers hear its name instead of the glyphs.
        const logoHtml = `<div class="art" aria-hidden="true">${logoLines.map(line =>
          `<div style="color: var(--theme-yellow); font-weight: bold;">${line}</div>`
        ).join('')}</div><span class="sr-only">${escapeHtml(`${osName} logo`)}</span>`;
        
        const userHostHtml = `<div style="color: var(--theme-green); font-weight: bold; margin-bottom: 8px;">${userHost}</div>`;
        
        // Values come from the browser (the WebGL renderer, the user agent), so they are text.
        // WM Theme alone is markup, a span the theme store keeps current.
        const infoHtml = infoData.map(({ label, value }) => 
          `<div style="display: flex; margin-bottom: 1px;"><span style="color: var(--theme-cyan); font-weight: bold; width: 140px; display: inline-block;">${label}:</span><span style="color: var(--theme-white);">${label === 'WM Theme' ? value : escapeHtml(value)}</span></div>`
        ).join('');
        
        // The logo and the details side by side where there is room, the details under the logo
        // where there is not: the row wraps, so it follows the screen without measuring it.
        const result = `<div style="display: flex; flex-wrap: wrap; gap: 12px 30px;"><div style="flex-shrink: 0; max-width: 100%;">${logoHtml}${colourBlocksAscii}</div><div style="flex: 1 1 260px; min-width: 0; display: flex; flex-direction: column; justify-content: flex-start;">${userHostHtml}${infoHtml}</div></div>`;
        
        resolve(result);
      } catch (error) {
        if (signal?.aborted) {
          resolve(cancelledNotice('fastfetch'));
        } else {
          // Soft-fail: keep terminal responsive and avoid throwing completely
          resolve(`<span style="color: var(--role-warn);">Fastfetch encountered an issue; some fields may be unavailable.</span>`);
        }
      }
    })();
  });
}
