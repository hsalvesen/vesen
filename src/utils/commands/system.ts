import packageJson from '../../../package.json';
import { theme } from '../../stores/theme';
import { get } from 'svelte/store';
import { getAppleLogo, getAndroidLogo, getWindowsLogo, getLinuxLogo } from '../osLogos';
import { isMobileDevice } from '../mobile';

export const systemCommands = {
  whoami: () => {
    const currentTheme = get(theme);
    window.open('https://www.linkedin.com/in/harrysalvesen/');
    return `<span style="color: ${currentTheme.cyan};">Opening developer's LinkedIn profile...</span>`;
  },
  
  // Add the new commands:
  uname: (args: string[]) => {
    const sysInfo = getSystemInfo();
    const flags = args.join(' ');
    
    if (flags.includes('-a') || flags.includes('--all')) {
      return `Linux ${window.location.hostname} 5.15.0-vesen #1 SMP PREEMPT ${new Date().toDateString()} ${sysInfo.platform} GNU/Linux`;
    } else if (flags.includes('-s') || flags.includes('--kernel-name')) {
      return 'Linux';
    } else if (flags.includes('-n') || flags.includes('--nodename')) {
      return window.location.hostname;
    } else if (flags.includes('-r') || flags.includes('--kernel-release')) {
      return '5.15.0-vesen';
    } else if (flags.includes('-m') || flags.includes('--machine')) {
      return sysInfo.platform;
    } else {
      return 'Linux';
    }
  },
  
  uptime: () => {
    const uptime = Math.floor((Date.now() - performance.timeOrigin) / 1000);
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = uptime % 60;
    
    const loadAvg1 = (Math.random() * 2).toFixed(2);
    const loadAvg5 = (Math.random() * 2).toFixed(2);
    const loadAvg15 = (Math.random() * 2).toFixed(2);
    
    return `up ${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}, 1 user, load average: ${loadAvg1}, ${loadAvg5}, ${loadAvg15}`;
  },
  
  fastfetch: async (args: string[], abortController?: AbortController) => {
    const currentTheme = get(theme);
    
    return new Promise<string>((resolve, reject) => {
      (async () => {
        try {
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
                    detectedVersion = `${majorVersion}.0.0`;
                    
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
          if ('getDisplayMedia' in navigator.mediaDevices) {
            // Modern displays often support higher refresh rates
            if (screen.width >= 2560) refreshRate = '120 Hz';
          }
          
          // Network information
          let localIP = 'Unknown';
          try {
            const ipResponse = await fetch('https://api.ipify.org?format=json', {
              signal: abortController?.signal
            });
            const ipData = await ipResponse.json();
            localIP = ipData.ip;
          } catch (error) {
            if (error instanceof Error && error.name === 'AbortError') {
              resolve(`<span style="color: ${currentTheme.yellow};">Fastfetch request cancelled</span>`);
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
          const shell = `Vesen Terminal v${packageJson.version}`;
          
          // Theme information
          const wmTheme = currentTheme.name;
          
          // Font detection
          const font = 'System Font';
          
          // Terminal information
          const terminal = 'Vesen Web Terminal';
          
          // Storage estimation
          let diskInfo = 'Unknown';
          if ('storage' in navigator && 'estimate' in navigator.storage) {
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

          // Dynamic username/hostname
          const username = 'user';
          const hostname = window.location.hostname || 'localhost';
          const userHost = `${username}@${hostname}`;

          // ASCII art colour blocks
          const colourBlocksAscii = `
<div style="font-family: monospace; line-height: 1; margin-top: 8px; margin-bottom: 8px;">
<span style="color: ${currentTheme.black};">███</span><span style="color: ${currentTheme.red};">███</span><span style="color: ${currentTheme.green};">███</span><span style="color: ${currentTheme.yellow};">███</span><span style="color: ${currentTheme.blue};">███</span><span style="color: ${currentTheme.purple};">███</span><span style="color: ${currentTheme.cyan};">███</span><span style="color: ${currentTheme.white};">███</span>
<span style="color: ${currentTheme.brightBlack};">███</span><span style="color: ${currentTheme.brightRed};">███</span><span style="color: ${currentTheme.brightGreen};">███</span><span style="color: ${currentTheme.brightYellow};">███</span><span style="color: ${currentTheme.brightBlue};">███</span><span style="color: ${currentTheme.brightPurple};">███</span><span style="color: ${currentTheme.brightCyan};">███</span><span style="color: ${currentTheme.brightWhite};">███</span>
</div>`;

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
            { label: 'WM Theme', value: wmTheme },
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
          const logoHtml = logoLines.map(line => 
            `<div style="color: var(--theme-yellow); font-weight: bold; font-family: monospace; white-space: pre;">${line}</div>`
          ).join('');
          
          const userHostHtml = `<div style="color: var(--theme-green); font-weight: bold; font-family: monospace; margin-bottom: 8px;">${userHost}</div>`;
          
          const infoHtml = infoData.map(({ label, value }) => 
            `<div style="display: flex; margin-bottom: 1px; font-family: monospace; font-size: 14px;"><span style="color: var(--theme-cyan); font-weight: bold; width: 140px; display: inline-block;">${label}:</span><span style="color: var(--theme-white);">${value}</span></div>`
          ).join('');
          
          const isMobile = isMobileDevice();
          const result = `<br><div style="display: flex; ${isMobile ? 'flex-direction: column;' : 'gap: 30px;'} font-family: monospace; line-height: 1.3;"><div style="${isMobile ? 'margin-bottom: 12px;' : 'flex-shrink: 0;'}">${logoHtml}${colourBlocksAscii}</div><div style="${isMobile ? '' : 'flex: 1; display: flex; flex-direction: column; justify-content: flex-start;'}">${userHostHtml}${infoHtml}</div></div><br>`;
          
          resolve(result);
        } catch (error) {
          if (error instanceof Error && error.name === 'AbortError') {
            resolve(`<span style="color: ${currentTheme.yellow};">Fastfetch request cancelled</span>`);
          } else {
            reject(error);
          }
        }
      })();
    });
  },

  banner: () => {
    const currentTheme = get(theme);
    const isMobile = window.innerWidth < 768; // Tailwind's md breakpoint
    
    if (isMobile) {
      // Compact mobile version
      return `
██╗  ██╗███████╗██╗     ██╗      ██████╗ 
██║  ██║██╔════╝██║     ██║     ██╔═══██╗
███████║█████╗  ██║     ██║     ██║   ██║
██╔══██║██╔══╝  ██║     ██║     ██║   ██║
██║  ██║███████╗███████╗███████╗╚██████╔╝
╚═╝  ╚═╝╚═══════╝╚══════╝╚══════╝ ╚═════╝ v${packageJson.version}

Type <span style="color: var(--theme-cyan); ">help</span> for commands.
Type <span style="color: var(--theme-cyan); ">cat README.md</span> to learn more.
`;
    }
    
    // Full desktop version
    return `
██╗    ██╗███████╗██╗      ██████╗ ██████╗ ███╗   ███╗███████╗
██║    ██║██╔════╝██║     ██╔════╝██╔═══██╗████╗ ████║██╔════╝
██║ █╗ ██║█████╗  ██║     ██║     ██║   ██║██╔████╔██║█████╗  
██║███╗██║██╔══╝  ██║     ██║     ██║   ██║██║╚██╔╝██║██╔══╝  
╚███╔███╔╝███████╗███████╗╚██████╗╚██████╔╝██║ ╚═╝ ██║███████╗
 ╚══╝╚══╝ ╚══════╝╚══════╝ ╚═════╝ ╚═════╝ ╚═╝     ╚═╝╚══════╝ v${packageJson.version}

Type <span style="color: var(--theme-cyan); ">help</span> to see list of available commands.
Type <span style="color: var(--theme-cyan); ">cat README.md</span> to learn more about this terminal.
`;
  }
};

// Add this helper function at the top of the file if not already present:
function getSystemInfo() {
  const navigator = window.navigator;
  const screen = window.screen;
  
  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    language: navigator.language,
    cookieEnabled: navigator.cookieEnabled,
    onLine: navigator.onLine,
    screenWidth: screen.width,
    screenHeight: screen.height,
    colorDepth: screen.colorDepth,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    memory: (navigator as any).deviceMemory || 'unknown',
    cores: navigator.hardwareConcurrency || 'unknown'
  };
}