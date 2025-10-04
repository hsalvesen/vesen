import { get } from 'svelte/store';
import { theme } from '../../stores/theme';
import { history } from '../../stores/history';

// Demo state management
let demoState = {
  isActive: false,
  currentStep: 0,
  completedSteps: new Set<number>(),
  userInput: '',
  expectedCommand: ''
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
      const subcommand = args[0].toLowerCase();
      
      switch (subcommand) {
        case 'start':
          return startDemo();
        case 'next':
          return nextStep();
        case 'prev':
        case 'previous':
          return previousStep();
        case 'reset':
          return resetDemo();
        case 'status':
          return getDemoStatus();
        case 'skip':
          return skipStep();
        case 'stop':
          return stopDemo();
        default:
          return getDemoHelp();
      }
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
      
      const currentTheme = get(theme);
      let response = `<div style="background: linear-gradient(135deg, ${currentTheme.green}20, ${currentTheme.cyan}20); border-left: 4px solid ${currentTheme.green}; padding: 12px; margin: 8px 0; border-radius: 4px;">`;
      response += `<span style="color: ${currentTheme.green}; font-weight: bold;">Success!</span> `;
      response += `<span style="color: ${currentTheme.white};">${currentStep.explanation}</span>`;
      response += `</div>`;
      
      // Auto-advance to next step
      if (demoState.currentStep < demoSteps.length - 1) {
        demoState.currentStep++;
        response += '\n\n' + getCurrentStepDisplay();
      } else {
        response += '\n\n' + completeDemo();
      }
      
      return response;
    }
    
    return '';
  }
};

function startDemo(): string {
  demoState = {
    isActive: true,
    currentStep: 0,
    completedSteps: new Set(),
    userInput: '',
    expectedCommand: ''
  };
  
  const currentTheme = get(theme);
  
  let output = `<div style="background: linear-gradient(135deg, ${currentTheme.cyan}30, ${currentTheme.purple}30); border: 2px solid ${currentTheme.cyan}; padding: 20px; margin: 10px 0; border-radius: 8px; text-align: center;">`;
  output += `<span style="color: ${currentTheme.cyan}; font-size: 1.2em; font-weight: bold;">Welcome to Terminal Demo!</span><br><br>`;
  output += `<span style="color: ${currentTheme.white};">This interactive guide will teach you how to use the command line.</span><br>`;
  output += `<span style="color: ${currentTheme.yellow};">Follow the instructions step by step, and don't worry about making mistakes!</span>`;
  output += `</div>`;
  
  output += '\n\n' + getCurrentStepDisplay();
  
  return output;
}

function getCurrentStepDisplay(): string {
  if (!demoState.isActive || demoState.currentStep >= demoSteps.length) {
    return '';
  }
  
  const currentTheme = get(theme);
  const step = demoSteps[demoState.currentStep];
  const stepNumber = demoState.currentStep + 1;
  const totalSteps = demoSteps.length;
  
  let output = `<div style="background: ${currentTheme.black}; border: 1px solid ${currentTheme.cyan}; padding: 16px; margin: 8px 0; border-radius: 6px;">`;
  
  // Progress bar
  const progress = Math.round((stepNumber / totalSteps) * 100);
  const progressBar = '█'.repeat(Math.floor(progress / 5)) + '░'.repeat(20 - Math.floor(progress / 5));
  output += `<div style="margin-bottom: 12px;">`;
  output += `<span style="color: ${currentTheme.cyan}; font-weight: bold;">Step ${stepNumber}/${totalSteps}</span> `;
  output += `<span style="color: ${currentTheme.green};">[${progressBar}]</span> `;
  output += `<span style="color: ${currentTheme.yellow};">${progress}%</span>`;
  output += `</div>`;
  
  // Step content
  output += `<div style="margin-bottom: 12px;">`;
  output += `<span style="color: ${currentTheme.purple}; font-weight: bold; font-size: 1.1em;">${step.title}</span><br>`;
  output += `<span style="color: ${currentTheme.white};">${step.description}</span>`;
  output += `</div>`;
  
  // Instruction
  output += `<div style="background: ${currentTheme.cyan}20; padding: 8px; border-radius: 4px; margin: 8px 0;">`;
  output += `<span style="color: ${currentTheme.cyan}; font-weight: bold;">Your task:</span> `;
  output += `<span style="color: ${currentTheme.white};">${step.instruction}</span>`;
  output += `</div>`;
  
  // Hint
  output += `<div style="background: ${currentTheme.yellow}20; padding: 6px; border-radius: 4px;">`;
  output += `<span style="color: ${currentTheme.yellow}; font-weight: bold;">Hint:</span> `;
  output += `<span style="color: ${currentTheme.white}; font-family: monospace;">${step.hint}</span>`;
  output += `</div>`;
  
  output += `</div>`;
  
  // Demo controls
  output += `<div style="margin-top: 8px; font-size: 0.9em; color: ${currentTheme.brightBlack};">`;
  output += `<span style="color: ${currentTheme.cyan};">Demo controls:</span> `;
  output += `<span style="color: ${currentTheme.white};">demo next</span> | `;
  output += `<span style="color: ${currentTheme.white};">demo prev</span> | `;
  output += `<span style="color: ${currentTheme.white};">demo skip</span> | `;
  output += `<span style="color: ${currentTheme.white};">demo stop</span>`;
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

function resetDemo(): string {
  demoState = {
    isActive: true,
    currentStep: 0,
    completedSteps: new Set(),
    userInput: '',
    expectedCommand: ''
  };
  
  return "Demo reset! Starting from the beginning.\n\n" + getCurrentStepDisplay();
}

function stopDemo(): string {
  const currentTheme = get(theme);
  demoState.isActive = false;
  
  return `<span style="color: ${currentTheme.red};">Demo stopped.</span> You can restart anytime with <span style="color: ${currentTheme.cyan}; font-weight: bold;">demo</span>`;
}

function completeDemo(): string {
  const currentTheme = get(theme);
  demoState.isActive = false;
  
  let output = `<div style="background: linear-gradient(135deg, ${currentTheme.green}30, ${currentTheme.cyan}30); border: 2px solid ${currentTheme.green}; padding: 20px; margin: 10px 0; border-radius: 8px; text-align: center;">`;
  output += `<span style="color: ${currentTheme.green}; font-size: 1.3em; font-weight: bold;">🎉 Congratulations!</span><br><br>`;
  output += `<span style="color: ${currentTheme.white};">You've completed the terminal demo!</span><br>`;
  output += `<span style="color: ${currentTheme.cyan};">You're now ready to explore the terminal on your own.</span><br><br>`;
  output += `<span style="color: ${currentTheme.yellow};">Remember: Use 'help' to see all commands, or '[command] --help' for detailed help.</span>`;
  output += `</div>`;
  
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
  
  // Removed original intro text before command list
  let output = `<span style="color: ${currentTheme.yellow}; font-weight: bold;">Commands:</span>\n`;
  output += `  <span style="color: ${currentTheme.green};">demo</span>         - Begin the interactive demo\n`;
  output += `  <span style="color: ${currentTheme.green};">demo next</span>     - Go to the next step\n`;
  output += `  <span style="color: ${currentTheme.green};">demo prev</span>     - Go to the previous step\n`;
  output += `  <span style="color: ${currentTheme.green};">demo skip</span>     - Skip the current step\n`;
  output += `  <span style="color: ${currentTheme.green};">demo reset</span>    - Restart from the beginning\n`;
  output += `  <span style="color: ${currentTheme.green};">demo status</span>   - Show current progress\n`;
  output += `  <span style="color: ${currentTheme.green};">demo stop</span>     - Stop the demo\n\n`;
  
  output += `<span style="color: ${currentTheme.purple}; font-weight: bold;">What you'll learn:</span>\n`;
  output += `  • Basic terminal navigation and commands\n`;
  output += `  • File system operations (ls, cd, pwd, cat)\n`;
  output += `  • Creating and editing files (touch, echo)\n`;
  output += `  • Network commands (weather, curl)\n`;
  output += `  • System information (fastfetch, whoami)\n`;
  output += `  • Customisation and help systems\n\n`;
  
  output += `<span style="color: ${currentTheme.cyan};">Perfect for beginners who are new to command-line interfaces!</span>`;
  
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