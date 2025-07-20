import { getCompanyLogo } from './companyLogos';

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