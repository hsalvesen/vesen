import { get } from 'svelte/store';
import { theme } from '../../stores/theme';
import { history } from '../../stores/history';

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

const demoSteps = [
  {
    title: "Welcome to the Terminal!",
    description: "This is a command-line interface where you type commands to interact with the system.",
    instruction: "Type 'help' to see all available commands",
    expectedCommand: "help",
    hint: "Just type: help",
    explanation: "The 'help' command shows you all available commands organised by category."
  },
  {
    title: "System Information",
    description: "Let's learn about your system! The 'fastfetch' command shows detailed system information.",
    instruction: "Type 'fastfetch' to see system details",
    expectedCommand: "fastfetch",
    hint: "Type: fastfetch",
    explanation: "This command displays your operating system, hardware, and browser information in a neat format."
  },
  {
    title: "File System Navigation",
    description: "Terminals use directories (folders) to organise files. Let's explore!",
    instruction: "Type 'ls' to list files and directories",
    expectedCommand: "ls",
    hint: "Type: ls",
    explanation: "'ls' stands for 'list' and shows you what's in your current directory."
  },
  {
    title: "Current Location",
    description: "It's important to know where you are in the file system.",
    instruction: "Type 'pwd' to see your current directory path",
    expectedCommand: "pwd",
    hint: "Type: pwd",
    explanation: "'pwd' means 'print working directory' - it shows your current location."
  },
  {
    title: "Reading Files",
    description: "Let's read the contents of a file to learn more about this terminal.",
    instruction: "Type 'cat README.md' to read the README file",
    expectedCommand: "cat README.md",
    hint: "Type: cat README.md",
    explanation: "'cat' displays the contents of a file. README.md contains information about this terminal."
  },
  {
    title: "Changing Directories",
    description: "You can navigate between directories using the 'cd' command.",
    instruction: "Type 'cd documents' to enter the documents folder",
    expectedCommand: "cd documents",
    hint: "Type: cd documents",
    explanation: "'cd' means 'change directory'. Use it to move between folders."
  },
  {
    title: "Going Back",
    description: "Use '..' to go back to the parent directory.",
    instruction: "Type 'cd ..' to go back to the previous directory",
    expectedCommand: "cd ..",
    hint: "Type: cd ..",
    explanation: "'..' is a special symbol that means 'parent directory' - one level up."
  },
  {
    title: "Creating Files",
    description: "You can create new files using the 'touch' command.",
    instruction: "Type 'touch my-first-file.txt' to create a new file",
    expectedCommand: "touch my-first-file.txt",
    hint: "Type: touch my-first-file.txt",
    explanation: "'touch' creates an empty file with the name you specify."
  },
  {
    title: "Writing to Files",
    description: "Use 'echo' to write text to files or display messages.",
    instruction: "Type 'echo \"Hello Terminal!\" > my-first-file.txt' to write to your file",
    expectedCommand: "echo \"Hello Terminal!\" > my-first-file.txt",
    hint: "Type: echo \"Hello Terminal!\" > my-first-file.txt",
    explanation: "'echo' outputs text, and '>' redirects that text into a file."
  },
  {
    title: "Network Commands",
    description: "This terminal can interact with the internet! Let's check the weather.",
    instruction: "Type 'weather Sydney' to get weather information",
    expectedCommand: "weather Sydney",
    hint: "Type: weather Sydney",
    explanation: "The weather command fetches real-time weather data from online services."
  },
  {
    title: "Customisation",
    description: "You can customise the terminal's appearance with different themes.",
    instruction: "Type 'theme ls' to see available themes",
    expectedCommand: "theme ls",
    hint: "Type: theme ls",
    explanation: "Themes change the colours and appearance of your terminal interface."
  },
  {
    title: "Command History",
    description: "The terminal remembers your commands! You can view them anytime.",
    instruction: "Type 'history' to see all commands you've used",
    expectedCommand: "history",
    hint: "Type: history",
    explanation: "History shows a numbered list of all commands you've executed in this session."
  },
  {
    title: "Getting Help",
    description: "Any command can show detailed help information.",
    instruction: "Type 'ls --help' to see detailed help for the ls command",
    expectedCommand: "ls --help",
    hint: "Type: ls --help",
    explanation: "Adding '--help' to any command shows detailed usage information and examples."
  },
  {
    title: "Congratulations!",
    description: "You've completed the terminal demo! You now know the basics of command-line interaction.",
    instruction: "Type 'clear' to clear the screen and start exploring on your own",
    expectedCommand: "clear",
    hint: "Type: clear",
    explanation: "You're now ready to explore the terminal independently. Remember, you can always use 'help' or '[command] --help' for assistance!"
  }
];

export const demoCommands = {
  demo: (args: string[]) => {
    const currentTheme = get(theme);
    
    if (args.length > 0) {
      // No subcommands anymore; show simplified help
      return getDemoHelp();
    }
    
    // Start demo immediately when running `demo` without args
    return startDemo();
  },

  // Hidden command to check if user input matches demo expectations
  _demoCheck: (args: string[]) => {
    if (!demoState.isActive) return '';
    
    const userCommand = args.join(' ').trim();
    const currentStep = demoSteps[demoState.currentStep];
    
    if (userCommand === currentStep.expectedCommand) {
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

function getCurrentStepDisplay(): string {
  if (!demoState.isActive || demoState.currentStep >= demoSteps.length) {
    return '';
  }
  
  const currentTheme = get(theme);
  const step = demoSteps[demoState.currentStep];
  const stepNumber = demoState.currentStep + 1;
  const totalSteps = demoSteps.length;

  // Main step container with dynamic theme colors
  let output = `<div style="position: relative; border: 2px solid var(--theme-cyan); padding: 20px; margin: 10px 0; border-radius: 8px;">`;
  output += `<div style="position: absolute; inset: 0; background: linear-gradient(135deg, var(--theme-cyan), var(--theme-purple)); opacity: 0.18; border-radius: 8px;"></div>`;
  output += `<div style="position: relative;">`;

  // Welcome text (step 1 only), above progress
  if (stepNumber === 1) {
    output += `<div style="margin-bottom: 12px;">`;
    output += `<span style="color: var(--theme-cyan); font-weight: bold;">Welcome to Terminal Demo</span><br>`;
    output += `<span style="color: var(--theme-white);">This interactive guide will teach you how to use the command line.</span><br>`;
    output += `<span style="color: var(--theme-yellow);">Follow the instructions step by step, and don't worry about making mistakes!</span>`;
    output += `</div>`;
  }

  // Progress bar
  const progress = Math.round((stepNumber / totalSteps) * 100);
  const progressBar = '█'.repeat(Math.floor(progress / 5)) + '░'.repeat(20 - Math.floor(progress / 5));
  output += `<div style="margin-bottom: 12px;">`;
  output += `<span style="color: var(--theme-cyan); font-weight: bold;">Step ${stepNumber}/${totalSteps}</span> `;
  output += `<span style="color: var(--theme-green);">[${progressBar}]</span> `;
  output += `<span style="color: var(--theme-yellow);">${progress}%</span>`;
  output += `</div>`;

  // Success message carried into the next step box
  if (demoState.pendingSuccessExplanation) {
    output += `<div style="position: relative; padding: 6px 10px; margin: 6px 0 12px 0; border-radius: 4px; border-left: 4px solid var(--theme-green);">`;
    output += `<div style="position: absolute; inset: 0; background: linear-gradient(135deg, var(--theme-green), var(--theme-cyan)); opacity: 0.12; border-radius: 4px;"></div>`;
    output += `<div style="position: relative;"><span style="color: var(--theme-green); font-weight: bold;">Success!</span> <span style="color: var(--theme-white);">${demoState.pendingSuccessExplanation}</span></div>`;
    output += `</div>`;
    demoState.pendingSuccessExplanation = '';
  }

  // Step content (skip title/description for step 1)
  if (stepNumber !== 1) {
    output += `<div style="margin-bottom: 12px;">`;
    output += `<span style="color: var(--theme-purple); font-weight: bold; font-size: 1.05em;">${step.title}</span><br>`;
    output += `<span style="color: var(--theme-white);">${step.description}</span>`;
    output += `</div>`;
  }

  // Instruction block (dynamic color via overlay)
  output += `<div style="position: relative; padding: 8px; border-radius: 4px; margin: 8px 0;">`;
  output += `<div style="position: absolute; inset: 0; background: var(--theme-cyan); opacity: 0.12; border-radius: 4px;"></div>`;
  output += `<div style="position: relative;"><span style="color: var(--theme-cyan); font-weight: bold;">Your task:</span> <span style="color: var(--theme-white);">${step.instruction}</span></div>`;
  output += `</div>`;

  // Hint block (dynamic color via overlay)
  output += `<div style="position: relative; padding: 6px; border-radius: 4px;">`;
  output += `<div style="position: absolute; inset: 0; background: var(--theme-yellow); opacity: 0.12; border-radius: 4px;"></div>`;
  output += `<div style="position: relative;"><span style="color: var(--theme-yellow); font-weight: bold;">Hint:</span> <span style="color: var(--theme-white); font-family: monospace;">${step.hint}</span></div>`;
  output += `</div>`;

  // Close inner and outer containers
  output += `</div></div>`;

  // Ctrl+C tip with theme variables
  output += `<div style="position: relative; border-left: 4px solid var(--theme-purple); padding: 8px 10px; border-radius: 4px; margin-top: 8px; margin-bottom: 8px;">`;
  output += `<div style="position: absolute; inset: 0; background: var(--theme-purple); opacity: 0.12; border-radius: 4px;"></div>`;
  output += `<div style="position: relative;"><span style="color: var(--theme-cyan); font-weight: bold;">Tip</span> <span style="color: var(--theme-white);">Press</span>: <span style="color: var(--theme-cyan); font-weight: bold; font-family: monospace;">Ctrl</span><span style="color: var(--theme-white);">+</span><span style="color: var(--theme-cyan); font-weight: bold; font-family: monospace;">C</span><span style="color: var(--theme-white);"> to stop the demo at any time.</span></div>`;
  output += `</div>`;

  return output;
}

function nextStep(): string {
  if (!demoState.isActive) {
    return "No demo is currently active. Use 'demo' to begin.";
  }
  
  if (demoState.currentStep < demoSteps.length - 1) {
    demoState.currentStep++;
    return getCurrentStepDisplay();
  } else {
    return completeDemo();
  }
}

function previousStep(): string {
  if (!demoState.isActive) {
    return "No demo is currently active. Use 'demo' to begin.";
  }
  
  if (demoState.currentStep > 0) {
    demoState.currentStep--;
    return getCurrentStepDisplay();
  } else {
    return "You're already at the first step!";
  }
}

function skipStep(): string {
  if (!demoState.isActive) {
    return "No demo is currently active. Use 'demo' to begin.";
  }
  
  const currentTheme = get(theme);
  demoState.completedSteps.add(demoState.currentStep);
  
  let output = `<span style="color: ${currentTheme.yellow};">⏭️ Step skipped!</span>\n\n`;
  
  if (demoState.currentStep < demoSteps.length - 1) {
    demoState.currentStep++;
    output += getCurrentStepDisplay();
  } else {
    output += completeDemo();
  }
  
  return output;
}

export function stopDemoViaInterrupt(): string {
  const currentTheme = get(theme);
  demoState.isActive = false;
  return `<div style="position: relative; border-left: 4px solid var(--theme-red); padding: 8px 10px; margin: 6px 0; border-radius: 4px;">
    <div style="position: absolute; inset: 0; background: var(--theme-red); opacity: 0.12; border-radius: 4px;"></div>
    <div style="position: relative; white-space: nowrap;">
      <span style="color: var(--theme-red); font-weight: bold;">Demo interrupted</span>
      <span style="color: var(--theme-white);"> (</span>
      <span style="color: var(--theme-cyan); font-weight: bold; font-family: monospace;">Ctrl</span>
      <span style="color: var(--theme-white);">+</span>
      <span style="color: var(--theme-cyan); font-weight: bold; font-family: monospace;">C</span>
      <span style="color: var(--theme-white);">). Restart with </span>
      <span style="color: var(--theme-cyan); font-weight: bold; font-family: monospace;">demo</span>
    </div>
  </div>`;
}

function completeDemo(): string {
  const currentTheme = get(theme);
  demoState.isActive = false;

  let output = `<div style="position: relative; border: 2px solid var(--theme-green); padding: 20px; margin: 10px 0; border-radius: 8px; text-align: center;">`;
  output += `<div style="position: absolute; inset: 0; background: linear-gradient(135deg, var(--theme-green), var(--theme-cyan)); opacity: 0.18; border-radius: 8px;"></div>`;
  output += `<div style="position: relative;">`;
  output += `<span style="color: var(--theme-green); font-size: 1.3em; font-weight: bold;">🎉 Congratulations!</span><br><br>`;
  output += `<span style="color: var(--theme-white);">You've completed the terminal demo!</span><br>`;
  output += `<span style="color: var(--theme-cyan);">You're now ready to explore the terminal on your own.</span><br><br>`;
  output += `<span style="color: var(--theme-yellow);">Remember: Use 'help' to see all commands, or '[command] --help' for detailed help.</span>`;
  output += `</div></div>`;

  return output;
}

function getDemoStatus(): string {
  const currentTheme = get(theme);
  
  if (!demoState.isActive) {
    return `<span style="color: ${currentTheme.red};">No demo is currently active.</span> Use <span style="color: ${currentTheme.cyan}; font-weight: bold;">demo</span> to begin.`;
  }
  
  const completedCount = demoState.completedSteps.size;
  const totalSteps = demoSteps.length;
  const currentStep = demoState.currentStep + 1;
  
  let output = `<span style="color: ${currentTheme.cyan}; font-weight: bold;">Demo Status:</span>\n`;
  output += `<span style="color: ${currentTheme.white};">Current Step: ${currentStep}/${totalSteps}</span>\n`;
  output += `<span style="color: ${currentTheme.green};">Completed Steps: ${completedCount}</span>\n`;
  output += `<span style="color: ${currentTheme.yellow};">Progress: ${Math.round((completedCount / totalSteps) * 100)}%</span>`;
  
  return output;
}

function getDemoHelp(): string {
  const currentTheme = get(theme);

  let output = `<span style="color: var(--theme-yellow); font-weight: bold;">Usage:</span> demo\n`;
  output += `<span style="color: var(--theme-cyan); font-weight: bold;">Tip:</span> <span style="color: var(--theme-white);">Press</span>: <span style="color: var(--theme-cyan); font-weight: bold; font-family: monospace;">Ctrl</span><span style="color: var(--theme-white);">+</span><span style="color: var(--theme-cyan); font-weight: bold; font-family: monospace;">C</span><span style="color: var(--theme-white);"> to stop the demo at any time.</span>\n\n`;
  output += `<span style="color: var(--theme-purple); font-weight: bold;">What you'll learn:</span>\n`;
  output += `  • Basic terminal navigation and commands\n`;
  output += `  • File system operations (ls, cd, pwd, cat)\n`;
  output += `  • Creating and editing files (touch, echo)\n`;
  output += `  • Network commands (weather, curl)\n`;
  output += `  • System information (fastfetch, whoami)\n`;
  output += `  • Customisation and help systems\n\n`;
  output += `<span style="color: var(--theme-cyan);">Perfect for beginners who are new to command-line interfaces!</span>`;

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