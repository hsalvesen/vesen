import packageJson from '../../../package.json';
import { theme } from '../../stores/theme';
import { get } from 'svelte/store';

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
    if (userAgent.includes('Mac')) {
      osName = 'macOS';
      logoLines = [
        "                    'c.",
        "                 ,xNMM.",
        "               .OMMMMo",
        "               OMMM0,",
        "     .;loddo:' loolloddol;.",
        "   cKMMMMMMMMMMNWMMMMMMMMMM0:",
        " .KMMMMMMMMMMMMMMMMMMMMMMMWd.",
        " XMMMMMMMMMMMMMMMMMMMMMMMX.",
        ";MMMMMMMMMMMMMMMMMMMMMMMM:",
        ":MMMMMMMMMMMMMMMMMMMMMMMM:",
        ".MMMMMMMMMMMMMMMMMMMMMMMMX.",
        " kMMMMMMMMMMMMMMMMMMMMMMMMWd.",
        " .XMMMMMMMMMMMMMMMMMMMMMMMMMMk",
        "  .XMMMMMMMMMMMMMMMMMMMMMMMMK.",
        "    kMMMMMMMMMMMMMMMMMMMMMMd",
        "     ;KMMMMMMMWXXWMMMMMMMk.",
        "       .cooc,.    .,coo:."
      ];
    } else if (userAgent.includes('Android')) {
      osName = 'Android';
      logoLines = [
        "           -o         o-",
        "           +hydNNNNdyh+",
        "         +mMMMMMMMMMMMMm+",
        "       `dM{  }mMMMMm{  }Md`",
        "       hMMMMMMMMMMMMMMMMMMh",
        "   ..  yyyyyyyyyyyyyyyyyyyy  ..",
        " .mMMm`MMMMMMMMMMMMMMMMMMMM`mMMm.",
        " :MMMM-MMMMMMMMMMMMMMMMMMMM-MMMM:",
        " :MMMM-MMMMMMMMMMMMMMMMMMMM-MMMM:",
        " :MMMM-MMMMMMMMMMMMMMMMMMMM-MMMM:",
        " :MMMM-MMMMMMMMMMMMMMMMMMMM-MMMM:",
        " -MMMM-MMMMMMMMMMMMMMMMMMMM-MMMM-",
        "  +yy+ MMMMMMMMMMMMMMMMMMMM +yy+",
        "       mMMMMMMMMMMMMMMMMMMm",
        "        `++MMMMh+++hMMMM++`",
        "           MMMMo   oMMMM",
        "           MMMMo   oMMMM",
        "           oNMm-   -mMNo"
      ];
    } else if (userAgent.includes('Win')) {
      osName = 'Windows 11';
      logoLines = [
        "&nbsp;",
        "###############   ###############",
        "###############   ###############",
        "###############   ###############",
        "###############   ###############",
        "###############   ###############",
        "###############   ###############",
        "###############   ###############",
        "&nbsp;",
        "###############   ###############",
        "###############   ###############",
        "###############   ###############",
        "###############   ###############",
        "###############   ###############",
        "###############   ###############",
        "###############   ###############"
      ];
    } else if (userAgent.includes('Linux') || userAgent.includes('X11')) {
      osName = 'Linux';
      logoLines = [
        "                 .88888888:.",
        "                88888888.88888.",
        "              .8888888888888888.",
        "              888888888888888888",
        "              88' _`88'_  `88888",
        "              88 88 88 88  88888",
        "              88_88_::_88_:88888",
        "              88:::,::,:::::8888",
        "              88`:::::::::'`8888",
        "             .88  `::::'    8:88.",
        "            8888            `8:888.",
        "          .8888'             `888888.",
        "         .8888:..  .::.  ...:'8888888:.",
        "        .8888.'     :'     `'::`88:88888",
        "       .8888        '         `.888:8888.",
        "      888:8         .           888:88888",
        "    .888:88        .:           888:88888:",
        "    8888888.       ::           88:888888",
        "    `.::.888.      ::          .88888888",
        "   .::::::.888.    ::         :::`8888'.:.",
        "  ::::::::::.888   '         .::::::::::::",
        "  ::::::::::::.8    '      .:8::::::::::::",
        " .::::::::::::::.        .:888:::::::::::",
        " :::::::::::::::88:.__..:88888::::::::::",
        "  `'.:::::::::::88888888888.88:::::::::",
        "       `':::_:' -- '' -'-' `':_::::'`"
      ];
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
      `<div style="color: ${currentTheme.yellow}; font-weight: bold; font-family: monospace;">${line}</div>`
    ).join('');
    
    const infoHtml = infoData.map(({ label, value }) => 
      `<div style="display: flex; margin-bottom: 2px; font-family: monospace;"><span style="color: ${currentTheme.cyan}; font-weight: bold; width: 120px; display: inline-block;">${label}:</span><span>${value}</span></div>`
    ).join('');
    
    return `
<div style="display: flex; gap: 30px; font-family: monospace; line-height: 1.2;">
  <div style="flex-shrink: 0;">
    ${logoHtml}
  </div>
  <div style="flex: 1; display: flex; flex-direction: column; justify-content: center;">
    ${infoHtml}
  </div>
</div>`;
  },
  
  banner: () => `
██╗    ██╗███████╗██╗      ██████╗ ██████╗ ███╗   ███╗███████╗
██║    ██║██╔════╝██║     ██╔════╝██╔═══██╗████╗ ████║██╔════╝
██║ █╗ ██║█████╗  ██║     ██║     ██║   ██║██╔████╔██║█████╗  
██║███╗██║██╔══╝  ██║     ██║     ██║   ██║██║╚██╔╝██║██╔══╝  
╚███╔███╔╝███████╗███████╗╚██████╗╚██████╔╝██║ ╚═╝ ██║███████╗
 ╚══╝╚══╝ ╚══════╝╚══════╝ ╚═════╝ ╚═════╝ ╚═╝     ╚═╝╚══════╝ v${packageJson.version}

Type 'help' to see list of available commands.
`
};