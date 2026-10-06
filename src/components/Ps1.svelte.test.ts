import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import Ps1 from './Ps1.svelte';

describe('Ps1', () => {
  it('renders the guest prompt', () => {
    render(Ps1);
    expect(screen.getByText('guest')).toBeInTheDocument();
    expect(screen.getByText('$')).toBeInTheDocument();
  });

  it('names the brand as the host, whatever domain serves the page', () => {
    const { container } = render(Ps1);
    expect(location.hostname).not.toBe('vesen');
    expect(container.textContent?.replace(/\s+/g, '')).toBe('guest@vesen:~$');
  });

  it('is a span, not a heading, so the page keeps one h1', () => {
    const { container } = render(Ps1);
    expect(container.querySelector('h1, h2, h3, [role="heading"]')).toBeNull();
    expect(container.firstElementChild?.localName).toBe('span');
  });

  it('switches to a password prompt', () => {
    render(Ps1, { isPasswordMode: true });
    expect(screen.getByText('Password:')).toBeInTheDocument();
    expect(screen.queryByText('guest')).not.toBeInTheDocument();
  });
});
