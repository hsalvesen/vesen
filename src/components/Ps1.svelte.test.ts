import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import Ps1 from './Ps1.svelte';

describe('Ps1', () => {
  it('renders the guest prompt', () => {
    render(Ps1);
    expect(screen.getByText('guest')).toBeInTheDocument();
    expect(screen.getByText('$')).toBeInTheDocument();
  });

  it('switches to a password prompt', () => {
    render(Ps1, { isPasswordMode: true });
    expect(screen.getByText('Password:')).toBeInTheDocument();
    expect(screen.queryByText('guest')).not.toBeInTheDocument();
  });
});
