// The legacy poweroff, the last legacy command in this file: the file commands are specs in
// src/commands/files and src/commands/text now. Deleted when poweroff becomes the Shutdown app.

export const fileSystemCommands = {
  poweroff: (args: string[]) => {

    // Check for help flag
    const hasHelpFlag = args.includes('--help') || args.includes('-h');
    
    if (hasHelpFlag) {
      return `<span style="color: var(--theme-cyan); font-weight: bold;">poweroff</span> - End terminal session<br><span style="color: var(--theme-yellow); font-weight: bold;">Usage:</span> poweroff<br><br><span style="color: var(--theme-cyan); font-weight: bold;">Description:</span> Attempts to close the window, then triggers shutdown sequence.`;
    }
    
    // Disable all inputs immediately to prevent further commands
    // Hide the entire input section (prompt + input) immediately
    const inputContainers = document.querySelectorAll('.flex.flex-row.items-center.gap-1');
    inputContainers.forEach(container => {
      const containerElement = container as HTMLElement;
      // Check if this container has both Ps1 and Input components
      if (containerElement.querySelector('h1') && containerElement.querySelector('input')) {
        containerElement.style.display = 'none';
      }
    });
    
    // Also disable inputs as backup
    const inputs = document.querySelectorAll('input');
    inputs.forEach(input => {
      (input as HTMLInputElement).disabled = true;
    });
    
    // Function to trigger shutdown sequence
    const triggerShutdown = () => {
      setTimeout(() => {
        document.body.style.transition = 'all 2s ease-out';
        document.body.style.opacity = '0';
        document.body.style.transform = 'scale(0.8)';
        
        setTimeout(() => {
          document.body.innerHTML = `
            <div style="
              display: flex;
              justify-content: center;
              align-items: center;
              height: 100vh;
              background: #000;
              color: #fff;
              font-size: 24px;
              text-align: center;
            ">
              <div>
                <div style="margin-bottom: 20px;">🔌</div>
                <div>System Shutdown Complete</div>
                <div style="font-size: 14px; margin-top: 10px; opacity: 0.7;">It is now safe to close this tab</div>
              </div>
            </div>
          `;
        }, 2000);
      }, 1000);
    };
    
    // Try to close the window (only works if opened by JavaScript)
    window.close();
    
    // Check if window is still open after a brief delay (fallback to shutdown)
    setTimeout(() => {
      try {
        // If we can still access the document, the window didn't close
        if (document && document.body) {
          triggerShutdown();
        }
      } catch (e) {
        // Window was closed successfully, do nothing
      }
    }, 100);
    
    // Return immediate feedback
    return `<span style="color: var(--role-warn);">Terminating session...</span>`;
  }
  
};