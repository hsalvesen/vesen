import packageJson from '../../../package.json';
import { theme } from '../../stores/theme';
import { get } from 'svelte/store';
import { getAppleLogo, getAndroidLogo, getWindowsLogo, getLinuxLogo } from '../osLogos';

const hostname = window.location.hostname;

export const systemCommands = {
  hostname: () => hostname,
  
  whoami: () => {
    window.open('https://www.linkedin.com/in/harrysalvesen/');
    return 'Opening LinkedIn profile...';
  },
  
  date: () => new Date().toLocaleString(),
  
  neofetch: async () => {
    const currentTheme = get(theme);
    const userAgent = navigator.userAgent;
    let osName = 'Unknown OS';
    let logoLines: string[] = [];
    
    // Fetch user's public IP address
    let userIP = 'Unknown';
    try {
      const ipResponse = await fetch('https://api.ipify.org?format=json');
      const ipData = await ipResponse.json();
      userIP = ipData.ip;
    } catch (error) {
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
    const infoData = [
      { label: 'Host', value: hostname },
      { label: 'OS', value: osName },
      { label: 'Packages', value: packages },
      { label: 'Resolution', value: resolution },
      { label: 'Shell', value: `VESEN Terminal v${packageJson.version}` },
      { label: 'Theme', value: currentTheme.name },
      { label: 'IP', value: userIP },
      { label: 'License', value: packageJson.license },
      { label: 'Version', value: packageJson.version },
      { label: 'Repo', value: packageJson.repository.url },
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
    
    return `<div style="display: flex; gap: 30px; font-family: monospace; line-height: 1.2;">
  <div style="flex-shrink: 0;">
    ${logoHtml}
  </div>
  <div style="flex: 1; display: flex; flex-direction: column; justify-content: center;">
    ${infoHtml}
  </div>
</div>`;
  },
  
  banner: () => {
    const currentTheme = get(theme);
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