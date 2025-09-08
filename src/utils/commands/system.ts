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
  
  neofetch: async (args: string[], abortController?: AbortController) => {
    const currentTheme = get(theme);
    
    // Return a Promise that resolves only when the operation is complete
    return new Promise<string>((resolve, reject) => {
      // Perform the actual neofetch operation
      (async () => {
        try {
          const userAgent = navigator.userAgent;
          let osName = 'Unknown OS';
          let logoLines: string[] = [];
          
          // Fetch user's public IP address
           let userIP = 'Unknown';
           try {
             const ipResponse = await fetch('https://api.ipify.org?format=json', {
               signal: abortController?.signal
             });
             const ipData = await ipResponse.json();
             userIP = ipData.ip;
           } catch (error) {
             if (error instanceof Error && error.name === 'AbortError') {
               resolve(`<span style="color: ${currentTheme.yellow};">Neofetch request cancelled</span>`);
               return;
             }
             userIP = 'Unable to fetch';
           }
      
           // Detect OS and set logo
           if (userAgent.includes('iPhone') || userAgent.includes('iPad') || (userAgent.includes('Mac') && userAgent.includes('Mobile'))) {
             osName = 'iOS';
             logoLines = getAppleLogo();
           } else if (userAgent.includes('Mac')) {
             osName = 'macOS';
             logoLines = getAppleLogo();
           } else if (userAgent.includes('Android')) {
             osName = 'Android';
             logoLines = getAndroidLogo();
           } else if (userAgent.includes('Win')) {
             osName = 'Windows 11';
             logoLines = getWindowsLogo();
           } else if (userAgent.includes('Linux') || userAgent.includes('X11')) {
             osName = 'Linux';
             logoLines = getLinuxLogo();
           }
           
           const resolution = `${screen.width}x${screen.height}`;
           const uptime = Math.floor(performance.now() / 1000 / 60);
           const packages = '23 (npm)';
           
           // System information with labels and values
           const isMobile = isMobileDevice();
           const repoUrl = isMobile ? 'github.com/hsalvesen/vesen' : packageJson.repository.url;
           
           const infoData = [
             { label: 'Host', value: window.location.hostname },
             { label: 'OS', value: osName },
             { label: 'Packages', value: packages },
             { label: 'Resolution', value: resolution },
             { label: 'Shell', value: `Vesen Terminal v${packageJson.version}` },
             { label: 'Theme', value: currentTheme.name },
             { label: 'IP', value: userIP },
             { label: 'License', value: packageJson.license },
             { label: 'Version', value: packageJson.version },
             { label: 'Repo', value: repoUrl },
             { label: 'Uptime', value: uptime < 60 ? 'less than a minute' : Math.floor(uptime / 60) + ' hours' },
             { label: 'Author', value: `Has Salvesen (${packageJson.author.email})` }
           ];
           
           // Create HTML structure with CSS styling and fixed width for perfect alignment
           const logoHtml = logoLines.map(line => 
             `<div style="color: var(--theme-yellow); font-weight: bold; font-family: monospace;">${line}</div>`
           ).join('');
           
           const infoHtml = infoData.map(({ label, value }) => 
             `<div style="display: flex; margin-bottom: 2px; font-family: monospace;"><span style="color: var(--theme-cyan); font-weight: bold; width: 120px; display: inline-block;">${label}:</span><span>${value}</span></div>`
           ).join('');
           
           const result = `<br><div style="display: flex; ${isMobile ? 'flex-direction: column;' : 'gap: 30px;'} font-family: monospace; line-height: 1.2;"><div style="${isMobile ? 'margin-bottom: 8px;' : 'flex-shrink: 0;'}">${logoHtml}</div><div style="${isMobile ? '' : 'flex: 1; display: flex; flex-direction: column; justify-content: center;'}">${infoHtml}</div></div><br>`;
           
           resolve(result);
         } catch (error) {
           if (error instanceof Error && error.name === 'AbortError') {
             resolve(`<span style="color: ${currentTheme.yellow};">Neofetch request cancelled</span>`);
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
╚═╝  ╚═╝╚══════╝╚══════╝╚══════╝ ╚═════╝ v${packageJson.version}

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