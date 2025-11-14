import { get } from 'svelte/store';
import { theme } from '../../stores/theme';
import { history } from '../../stores/history';
import { commandDescriptions } from '../helpTexts';

// Demo state management
// Top-level state object for demo
let demoState = {
  isActive: false,
  currentStep: 0,
  completedSteps: new Set<number>(),
  userInput: '',
  expectedCommand: '',
  pendingSuccessExplanation: '' // ensure property exists in initial type
};

// const demoSteps = [...]
const demoSteps: DemoStep[] = [
  {
    title: "Getting started with the command line",
    description: (_likelyShell: string) =>
      `The terminal provides access to the command line, where you can control your computer by typing commands instead of using a mouse or menus.
      This demo will guide you through the basics of using the command line. The command interpreter language of your system is <span style="color: var(--theme-cyan); font-weight: bold; font-family: monospace;">BASH</span>.`,
    instruction: "Type <span style=\"color: var(--theme-green); font-weight: bold; font-family: monospace;\">help</span> to see all available commands",
    expectedCommand: "help",
    note: "All commands are case-sensitive (lowercase).",
    explanation: "The <span style=\"color: var(--theme-green); font-weight: bold; font-family: monospace;\">help</span> command shows you all available commands, organised by category."
  },
  {
    title: "Applying help flags",
    description: "Each command has inbuilt documentation accessible through help flags. These provide information on syntax, usage, and available arguments.",
    instruction: "Pick any command from <span style=\"color: var(--theme-green); font-weight: bold; font-family: monospace;\">help</span> and add the suffix <span style=\"color: var(--theme-green); font-weight: bold; font-family: monospace;\">--help</span> to see usage and options.",
    expectedCommand: (cmd: string) => {
      const tokens = cmd.trim().split(/\s+/);
      if (tokens.length < 2) return false;
      const commandName = tokens[0];
      const hasHelpFlag = tokens.slice(1).some(t => t === '--help' || t === '-h');
      return !!(commandDescriptions as Record<string, string>)[commandName] && hasHelpFlag;
    },
    note: "Programmers are lazy; the shorthand <span style=\"color: var(--theme-yellow); font-weight: bold; font-family: monospace;\">-h</span> will work just as well.",
    explanation: "Help flags print usage, arguments, and examples; read them before running a command."
  },
  {
    title: "System information",
    description: "Let's learn about your system! The 'fastfetch' command shows detailed system information. Most commands support a '--help' flag to show usage and options — try 'fastfetch --help' now, then run 'fastfetch' to view your system.",
    instruction: "Type 'fastfetch' to see system details",
    expectedCommand: "fastfetch",
    note: "Type: fastfetch",
    explanation: "This command displays your operating system, hardware, and browser information in a neat format."
  },
  {
    title: "File system navigation",
    description: "Terminals use directories (folders) to organise files. Let's explore!",
    instruction: "Type 'ls' to list files and directories",
    expectedCommand: "ls",
    note: "Type: ls",
    explanation: "'ls' stands for 'list' and shows you what's in your current directory."
  },
  {
    title: "Current location",
    description: "It's important to know where you are in the file system.",
    instruction: "Type 'pwd' to see your current directory path",
    expectedCommand: "pwd",
    note: "Type: pwd",
    explanation: "'pwd' means 'print working directory' - it shows your current location."
  },
  {
    title: "Reading files",
    description: "Let's read the contents of a file to learn more about this terminal.",
    instruction: "Type 'cat README.md' to read the README file",
    expectedCommand: "cat README.md",
    note: "Type: cat README.md",
    explanation: "'cat' displays the contents of a file. README.md contains information about this terminal."
  },
  {
    title: "Changing directories",
    description: "You can navigate between directories using the 'cd' command.",
    instruction: "Type 'cd documents' to enter the documents folder",
    expectedCommand: "cd documents",
    note: "Type: cd documents",
    explanation: "'cd' means 'change directory'. Use it to move between folders."
  },
  {
    title: "Going back",
    description: "Use '..' to go back to the parent directory.",
    instruction: "Type 'cd ..' to go back to the previous directory",
    expectedCommand: "cd ..",
    note: "Type: cd ..",
    explanation: "'..' is a special symbol that means 'parent directory' - one level up."
  },
  {
    title: "Creating files",
    description: "You can create new files using the 'touch' command.",
    instruction: "Type 'touch my-first-file.txt' to create a new file",
    expectedCommand: "touch my-first-file.txt",
    note: "Type: touch my-first-file.txt",
    explanation: "'touch' creates an empty file with the name you specify."
  },
  {
    title: "Writing to files",
    description: "Use 'echo' to write text to files or display messages.",
    instruction: "Type 'echo \"Hello Terminal!\" > my-first-file.txt' to write to your file",
    expectedCommand: "echo \"Hello Terminal!\" > my-first-file.txt",
    note: "Type: echo \"Hello Terminal!\" > my-first-file.txt",
    explanation: "'echo' outputs text, and '>' redirects that text into a file."
  },
  {
    title: "Network commands",
    description: "This terminal can interact with the internet! Let's check the weather.",
    instruction: "Type 'weather Sydney' to get weather information",
    expectedCommand: "weather Sydney",
    note: "Type: weather Sydney",
    explanation: "The weather command fetches real-time weather data from online services."
  },
  {
    title: "Customisation",
    description: "You can customise the terminal's appearance with different themes.",
    instruction: "Type 'theme ls' to see available themes",
    expectedCommand: "theme ls",
    note: "Type: theme ls",
    explanation: "Themes change the colours and appearance of your terminal interface."
  },
  {
    title: "Command history",
    description: "The terminal remembers your commands! You can view them anytime.",
    instruction: "Type 'history' to see all commands you've used",
    expectedCommand: "history",
    note: "Type: history",
    explanation: "History shows a numbered list of all commands you've executed in this session."
  },
  {
    title: "Congratulations!",
    description: "You've completed the terminal demo! You now know the basics of command-line interaction.",
    instruction: "Type 'clear' to clear the screen and start exploring on your own",
    expectedCommand: "clear",
    note: "Type: clear",
    explanation: "You're now ready to explore the terminal independently. Remember, you can always use 'help' or '[command] --help' for assistance!"
  }
];

// demoCommands._demoCheck
export const demoCommands = {
  demo: (args: string[]) => {
    const currentTheme = get(theme);
    return startDemo();
  },

  // Hidden command to check if user input matches demo expectations
  _demoCheck: (args: string[]) => {
    if (!demoState.isActive) return '';
    
    const userCommand = args.join(' ').trim();
    const currentStep = demoSteps[demoState.currentStep];
    
    const expected = currentStep.expectedCommand as string | ((c: string) => boolean);
    const isMatch = typeof expected === 'function' ? expected(userCommand) : userCommand === expected;

    if (isMatch) {
      demoState.completedSteps.add(demoState.currentStep);
      
      // Carry success explanation into next step box (no standalone success box)
      demoState.pendingSuccessExplanation = currentStep.explanation;
      
      const delayMs = 1000; // small invisible pause
      setTimeout(() => {
        const nextHtml = (demoState.currentStep < demoSteps.length - 1)
          ? (() => { demoState.currentStep++; return getCurrentStepDisplay(); })()
          : completeDemo();
        
        history.update(h => {
          if (h.length === 0) return h;
          const last = { ...h[h.length - 1] };
          const outputs = [...last.outputs, nextHtml];
          const newLast = { ...last, outputs };
          return [...h.slice(0, -1), newLast];
        });
      }, delayMs);
      
      return '';
    }
    
    return '';
  },
};

function startDemo(): string {
  demoState = {
    isActive: true,
    currentStep: 0,
    completedSteps: new Set(),
    userInput: '',
    expectedCommand: '',
    pendingSuccessExplanation: '' // include in reinitialisation
  };
  
  return getCurrentStepDisplay();
}

// Demo step type to support dynamic or static descriptions
interface DemoStep {
  title: string;
  description: string | ((likelyShell: string) => string);
  instruction: string;
  expectedCommand: string | ((cmd: string) => boolean);
  note: string;
  explanation: string;
}

function getCurrentStepDisplay(): string {
  if (!demoState.isActive || demoState.currentStep >= demoSteps.length) {
    return '';
  }
  
  const currentTheme = get(theme);
  const step = demoSteps[demoState.currentStep];
  const stepNumber = demoState.currentStep + 1;
  const totalSteps = demoSteps.length;

  // Main step container with dynamic theme colours
  let output = `<div style="position: relative; border: 2px solid var(--theme-cyan); padding: 16px; margin: 8px 0; border-radius: 8px;">`;
  output += `<div style="position: absolute; inset: 0; background: linear-gradient(135deg, var(--theme-cyan), var(--theme-purple)); opacity: 0.06; border-radius: 8px;"></div>`;
  output += `<div style="position: relative; white-space: normal; overflow-wrap: anywhere; word-break: break-word;">`;

  // Success message carried into the next step box
  if (demoState.pendingSuccessExplanation) {
    output += `<div style="position: relative; padding: 6px 10px; margin: 6px 0 12px 0; border-radius: 4px; border-left: 4px solid var(--theme-green);">`;
    output += `<div style="position: absolute; inset: 0; background: linear-gradient(135deg, var(--theme-green), var(--theme-cyan)); opacity: 0.08; border-radius: 4px;"></div>`;
    output += `<div style="position: relative; white-space: normal; overflow-wrap: anywhere; word-break: break-word;"><span style="color: var(--theme-green); font-weight: bold;">Success!</span> <span style="color: var(--theme-white);">${demoState.pendingSuccessExplanation}</span></div>`;
    output += `</div>`;
    demoState.pendingSuccessExplanation = '';
  }

  // Compute likely shell for function-based descriptions
  const platform = typeof navigator !== 'undefined'
    ? (navigator.platform || navigator.userAgent || '')
    : '';
  const likelyShell = /Mac|iPhone|iPad|iPod/i.test(platform) ? 'zsh' : 'bash';

  // Step header
  output += `<div style="margin-bottom: 8px;">`;
  output += `<span style="color: var(--theme-cyan); font-weight: bold; font-size: 1.05em;">${step.title}</span>`;
  output += `</div>`;

  // Collapsible details for description (single assignment)
  const descriptionText = typeof step.description === 'function'
    ? step.description(likelyShell)
    : step.description;
  output += `<details style="margin: 6px 0;">`;
  output += `<summary style="color: var(--theme-cyan); font-weight: bold; cursor: pointer;">Details</summary>`;
  output += `<div style="color: var(--theme-white); margin-top: 4px;">${descriptionText}</div>`;
  output += `</details>`;

  // Instruction block
  output += `<div style="position: relative; padding: 8px; border-radius: 4px; margin: 8px 0;">`;
  output += `<div style="position: absolute; inset: 0; background: var(--theme-cyan); opacity: 0.08; border-radius: 4px;"></div>`;
  output += `<div style="position: relative; white-space: normal; overflow-wrap: anywhere; word-break: break-word;"><span style="color: var(--theme-cyan); font-weight: bold;">Task:</span> <span style="color: var(--theme-white);">${step.instruction}</span></div>`;
  output += `</div>`;

  // Hint (collapsible)
  output += `<details style="margin: 6px 0;">`;
  output += `<summary style="color: var(--theme-yellow); font-weight: bold; cursor: pointer;">Hint</summary>`;
  output += `<div style="position: relative; padding: 6px; border-radius: 4px; margin-top: 4px;">`;
  output += `<div style="position: absolute; inset: 0; background: var(--theme-yellow); opacity: 0.08; border-radius: 4px;"></div>`;
  output += `<div style="position: relative; white-space: normal; overflow-wrap: anywhere; word-break: break-word;"><span style="color: var(--theme-white); font-family: monospace;">${step.note}</span></div>`;
  output += `</div>`;
  output += `</details>`;

  // Progress bar (single declaration)
  const progress = Math.round((stepNumber / totalSteps) * 100);
  output += `<div style="display: flex; align-items: center; gap: 8px; margin-top: 8px;">`;
  output += `<span style="color: var(--theme-cyan); font-weight: bold;">Step ${stepNumber}/${totalSteps}</span>`;
  output += `<div style="flex: 1; height: 6px; background: var(--theme-brightBlack); border-radius: 4px; overflow: hidden;">`;
  output += `<div style="width: ${progress}%; height: 100%; background: var(--theme-green);"></div>`;
  output += `</div>`;
  output += `<span style="color: var(--theme-yellow);">${progress}%</span>`;
  output += `</div>`;

  // Close inner and outer containers
  output += `</div></div>`;

  // Demo tip
  output += `<div style="position: relative; border-left: 4px solid var(--theme-purple); padding: 8px 10px; border-radius: 4px; margin-top: 12px; margin-bottom: 20px;">`;
  output += `<div style="position: absolute; inset: 0; background: var(--theme-purple); opacity: 0.12; border-radius: 4px;"></div>`;
  output += `<div style="position: relative;"><span style="color: var(--theme-white);">Type </span><span style="color: var(--theme-cyan); font-weight: bold; font-family: monospace;">exit</span><span style="color: var(--theme-white);"> or press </span><span style="color: var(--theme-cyan); font-weight: bold; font-family: monospace;">Ctrl</span><span style="color: var(--theme-white);"> + </span><span style="color: var(--theme-cyan); font-weight: bold; font-family: monospace;">C</span><span style="color: var(--theme-white);"> to stop the demo at any time.</span></div>`;
  output += `</div>`;

  return output;
}

export function stopDemoViaInterrupt(): string {
  const currentTheme = get(theme);
  demoState.isActive = false;
  return `<div style="position: relative; border-left: 4px solid var(--theme-yellow); padding: 8px 10px; border-radius: 4px; margin: 6px 0; margin-bottom: 20px;"><div style="position: absolute; inset: 0; background: var(--theme-yellow); opacity: 0.08; border-radius: 4px;"></div><div style="position: relative;"><span style="color: var(--theme-white);">Demo interrupted. Restart with </span><span style="color: var(--theme-yellow); font-weight: bold; font-family: monospace;">demo</span></div></div>`;
}

function completeDemo(): string {
  const currentTheme = get(theme);
  demoState.isActive = false;

  let output = `<div style="position: relative; border: 2px solid var(--theme-green); padding: 20px; margin: 10px 0; border-radius: 8px; text-align: center;">`;
  output += `<div style="position: absolute; inset: 0; background: linear-gradient(135deg, var(--theme-green), var(--theme-cyan)); opacity: 0.18; border-radius: 8px;"></div>`;
  output += `<div style="position: relative;">`;
  output += `<span style="color: var(--theme-green); font-size: 1.3em; font-weight: bold;">Congratulations!</span><br><br>`;
  output += `<span style="color: var(--theme-white);">You've completed the terminal demo!</span><br>`;
  output += `<span style="color: var(--theme-cyan);">You're now ready to explore the terminal on your own.</span><br><br>`;
  output += `<span style="color: var(--theme-yellow);">Remember: Use 'help' to see all commands, or '[command] --help' for detailed help.</span>`;
  output += `</div></div>`;

  return output;
}

function getDemoStatus(): string {
  const currentTheme = get(theme);
  
  const completedCount = demoState.completedSteps.size;
  const totalSteps = demoSteps.length;
  const currentStep = demoState.currentStep + 1;
  
  let output = `<span style="color: ${currentTheme.cyan}; font-weight: bold;">Demo Status:</span>\n`;
  output += `<span style="color: ${currentTheme.white};">Current Step: ${currentStep}/${totalSteps}</span>\n`;
  output += `<span style="color: ${currentTheme.green};">Completed Steps: ${completedCount}</span>\n`;
  output += `<span style="color: ${currentTheme.yellow};">Progress: ${Math.round((completedCount / totalSteps) * 100)}%</span>`;
  
  return output;
}

// Export function to check if demo is active (for integration with main command processor)
export function isDemoActive(): boolean {
  return demoState.isActive;
}

// Export function to process demo commands (for integration)
export function processDemoCommand(command: string): string {
  return demoCommands._demoCheck([command]);
}

function renderCountdownHtml(seconds: number): string {
  const currentTheme = get(theme);
  return `<div style="position: relative; border-left: 4px solid var(--theme-cyan); padding: 10px; margin: 8px 0; border-radius: 4px;">
    <div style="position: absolute; inset: 0; background: var(--theme-cyan); opacity: 0.12; border-radius: 4px;"></div>
    <div style="position: relative;"><span style="color: var(--theme-cyan); font-weight: bold;">Next step in ${seconds}s...</span></div>
  </div>`;
}
