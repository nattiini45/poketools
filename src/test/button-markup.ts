/**
 * Buttons in server-rendered markup. The site Button renders the @fluid button (src/components/ui/Button.tsx): the
 * label sits in nested spans, and a loading button keeps it beside a spinner, so tests read each button's text label
 * and state instead of matching `>Label</button>`.
 */
export interface ButtonMarkup {
  html: string;
  label: string;
  disabled: boolean;
  busy: boolean;
}

export function buttonsIn(html: string): ButtonMarkup[] {
  return [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map(([whole, attrs, inner]) => ({
    html: whole,
    label: [...`>${inner}<`.matchAll(/>([^<]*)</g)]
      .map((text) => text[1])
      .join('')
      .trim(),
    disabled: /\sdisabled(=""|\s|$)/.test(attrs),
    busy: /\saria-busy="true"/.test(attrs),
  }));
}

export function buttonLabelled(html: string, label: string): ButtonMarkup | undefined {
  return buttonsIn(html).find((button) => button.label === label);
}
