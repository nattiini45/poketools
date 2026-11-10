/** @vitest-environment jsdom */
/**
 * The local patch in src/components/ui/fluid/accordion.tsx (README, "Local patches"): an uncontrolled accordion with
 * an onValueChange observer still opens, and the observer still hears every change.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { Accordion, AccordionContent, AccordionGroup, AccordionItem, AccordionTrigger } from '../fluid/accordion';

function items() {
  return (
    <AccordionItem value="rules" index={0}>
      <AccordionTrigger>Rules</AccordionTrigger>
      <AccordionContent>Bo3</AccordionContent>
    </AccordionItem>
  );
}

describe('@fluid accordion without a value', () => {
  beforeAll(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });

  it('AccordionGroup opens and reports the change', () => {
    const onValueChange = vi.fn();
    render(<AccordionGroup onValueChange={onValueChange}>{items()}</AccordionGroup>);
    const trigger = screen.getByRole('button', { name: 'Rules' });
    fireEvent.click(trigger);
    expect(onValueChange).toHaveBeenCalledWith('rules');
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
  });

  it('Accordion opens and reports the change', () => {
    const onValueChange = vi.fn();
    render(<Accordion onValueChange={onValueChange}>{items()}</Accordion>);
    const trigger = screen.getByRole('button', { name: 'Rules' });
    fireEvent.click(trigger);
    expect(onValueChange).toHaveBeenCalledWith('rules');
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
  });

  it('a controlled AccordionGroup stays on its value', () => {
    const onValueChange = vi.fn();
    render(
      <AccordionGroup value="" onValueChange={onValueChange}>
        {items()}
      </AccordionGroup>,
    );
    const trigger = screen.getByRole('button', { name: 'Rules' });
    fireEvent.click(trigger);
    expect(onValueChange).toHaveBeenCalledWith('rules');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });
});
