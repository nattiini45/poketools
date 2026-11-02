/** @vitest-environment jsdom */
/**
 * Input, Select and Textarea wire their label, hint and error to the control: ids are unique per instance (never
 * derived from the label text), an error sets `aria-invalid` and becomes the control's description, and a caller's
 * `aria-describedby` is kept. The message region is rendered before any error exists so a late error is announced.
 */
import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import Input from '../Input';
import Select from '../Select';
import Textarea from '../Textarea';

const OPTIONS = [
  { value: 'a', label: 'Option A' },
  { value: 'b', label: 'Option B' },
];

describe('field ids', () => {
  it('gives two Inputs with the same label distinct ids, and each label focuses its own input', async () => {
    const user = userEvent.setup();
    render(
      <>
        <Input label="Name" />
        <Input label="Name" />
      </>,
    );
    const [first, second] = screen.getAllByRole('textbox');
    expect(first.id).not.toBe('');
    expect(second.id).not.toBe('');
    expect(first.id).not.toBe(second.id);
    await user.click(screen.getAllByText('Name')[1]);
    expect(document.activeElement).toBe(second);
    await user.click(screen.getAllByText('Name')[0]);
    expect(document.activeElement).toBe(first);
  });

  it('does not derive the id from the label text', () => {
    render(
      <>
        <Input label="Email" />
        <Textarea label="Notes" />
        <Select label="Format" options={OPTIONS} />
      </>,
    );
    for (const el of [screen.getByRole('textbox', { name: 'Email' }), screen.getByRole('textbox', { name: 'Notes' }), screen.getByRole('combobox', { name: 'Format' })]) {
      expect(el.id).not.toBe('');
      expect(['email', 'notes', 'format']).not.toContain(el.id);
    }
  });

  it('gives a control without a label an id', () => {
    render(<Input aria-label="Search" />);
    expect(screen.getByRole('textbox', { name: 'Search' }).id).not.toBe('');
  });

  it('keeps an explicit id', () => {
    render(<Input label="Name" id="custom-id" error="Bad" />);
    const input = screen.getByRole('textbox', { name: 'Name' });
    expect(input.id).toBe('custom-id');
    expect(input.getAttribute('aria-describedby')).toBe('custom-id-error');
  });

  it('forwards refs', () => {
    const ref = createRef<HTMLInputElement>();
    render(<Input ref={ref} label="Name" />);
    expect(ref.current).toBe(screen.getByRole('textbox'));
  });
});

describe.each([
  ['Input', (props: { error?: string; hint?: string; 'aria-describedby'?: string }) => <Input label="Field" {...props} />, 'textbox'],
  ['Textarea', (props: { error?: string; hint?: string; 'aria-describedby'?: string }) => <Textarea label="Field" {...props} />, 'textbox'],
  ['Select', (props: { error?: string; hint?: string; 'aria-describedby'?: string }) => <Select label="Field" options={OPTIONS} {...props} />, 'combobox'],
] as const)('%s messages', (_name, renderField, role) => {
  it('describes the control by its error and marks it invalid', () => {
    render(renderField({ error: 'Required' }));
    const control = screen.getByRole(role, { description: 'Required' });
    expect(control.getAttribute('aria-invalid')).toBe('true');
  });

  it('describes the control by its hint only when there is no error, without aria-invalid', () => {
    render(renderField({ hint: 'Use letters' }));
    const control = screen.getByRole(role, { description: 'Use letters' });
    expect(control.hasAttribute('aria-invalid')).toBe(false);
  });

  it('shows the error instead of the hint when both are given', () => {
    render(renderField({ error: 'Required', hint: 'Use letters' }));
    const control = screen.getByRole(role, { description: 'Required' });
    expect(control.getAttribute('aria-invalid')).toBe('true');
    expect(screen.queryByText('Use letters')).toBeNull();
  });

  it('has no description and no aria-invalid without error or hint', () => {
    render(renderField({}));
    const control = screen.getByRole(role);
    expect(control.hasAttribute('aria-describedby')).toBe(false);
    expect(control.hasAttribute('aria-invalid')).toBe(false);
  });

  it("keeps the caller's aria-describedby and appends its own ids", () => {
    render(
      <>
        <p id="caller-help">Caller help</p>
        {renderField({ error: 'Required', hint: 'Use letters', 'aria-describedby': 'caller-help' })}
      </>,
    );
    const control = screen.getByRole(role);
    const tokens = (control.getAttribute('aria-describedby') ?? '').split(' ');
    expect(tokens[0]).toBe('caller-help');
    expect(tokens).toHaveLength(2);
    expect(screen.getByRole(role, { description: 'Caller help Required' })).toBe(control);
  });

  it('keeps the caller aria-describedby alone when nothing else describes the control', () => {
    render(
      <>
        <p id="caller-help">Caller help</p>
        {renderField({ 'aria-describedby': 'caller-help' })}
      </>,
    );
    expect(screen.getByRole(role).getAttribute('aria-describedby')).toBe('caller-help');
  });

  it('renders the polite live region before an error exists and fills the same node when it appears', () => {
    const { container, rerender } = render(renderField({}));
    const region = container.querySelector('[aria-live="polite"]');
    expect(region).not.toBeNull();
    expect(region?.textContent).toBe('');
    expect(container.querySelector('[role="alert"]')).toBeNull();
    rerender(renderField({ error: 'Required' }));
    expect(container.querySelector('[aria-live="polite"]')).toBe(region);
    expect(region?.textContent).toBe('Required');
  });
});
