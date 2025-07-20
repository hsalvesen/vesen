import { getCompanyLogo } from './companyLogos';
import { experienceContent } from './experienceContent';

interface ExperienceEntry {
  company: string;
  position: string;
  duration: string;
  location: string;
  description: string[];
  skills?: string[];
}

export function formatExperienceWithLogo(entry: ExperienceEntry): string {
  const logo = getCompanyLogo(entry.company);
  const logoLines = logo.split('\n');
  
  // Create the experience info
  const info = [
    `<span style="color: var(--theme-cyan); font-weight: bold;">${entry.company}</span>`,
    `<span style="color: var(--theme-yellow);">${entry.position}</span>`,
    `<span style="color: var(--theme-green);">${entry.duration}</span>`,
    `<span style="color: var(--theme-magenta);">${entry.location}</span>`,
    '',
    ...entry.description.map(desc => `<span style="color: var(--theme-white);">‣ ${desc}</span>`),
  ];
  
  if (entry.skills) {
    info.push('');
    info.push(`<span style="color: var(--theme-blue); font-weight: bold;">Skills:</span> <span style="color: var(--theme-white);">${entry.skills.join(' · ')}</span>`);
  }
  
  // Combine logo and info side by side
  const maxLines = Math.max(logoLines.length, info.length);
  const result: string[] = [];
  
  for (let i = 0; i < maxLines; i++) {
    const logoLine = logoLines[i] || '';
    const infoLine = info[i] || '';
    const paddedLogo = logoLine.padEnd(60); // Adjust padding as needed
    result.push(`${paddedLogo} ${infoLine}`);
  }
  
  return result.join('\n');
}

// New function to format the existing experience.md content with logos
export function formatExperienceContent(): string {
  const content = experienceContent;
  const sections = content.split('---').filter(section => section.trim());
  const formattedSections: string[] = [];
  
  sections.forEach(section => {
    const lines = section.trim().split('\n');
    
    // Extract company name from the section
    let companyName = '';
    for (const line of lines) {
      if (line.includes('ByteDance')) {
        companyName = 'TikTok'; // Use TikTok logo for ByteDance
        break;
      } else if (line.includes('Amazon')) {
        companyName = 'Amazon';
        break;
      } else if (line.includes('Deloitte')) {
        companyName = 'Deloitte';
        break;
      } else if (line.includes('Accenture')) {
        companyName = 'Accenture';
        break;
      }
    }
    
    if (companyName) {
      const logo = getCompanyLogo(companyName);
      const logoLines = logo.split('\n');
      const contentLines = lines;
      
      // Combine logo and content side by side
      const maxLines = Math.max(logoLines.length, contentLines.length);
      const result: string[] = [];
      
      for (let i = 0; i < maxLines; i++) {
        const logoLine = logoLines[i] || '';
        const contentLine = contentLines[i] || '';
        const paddedLogo = logoLine.padEnd(80); // Adjust padding as needed
        result.push(`${paddedLogo} ${contentLine}`);
      }
      
      formattedSections.push(result.join('\n'));
    } else {
      // If no company logo found, just add the section as-is
      formattedSections.push(section.trim());
    }
  });
  
  return formattedSections.join('\n\n---\n\n');
}