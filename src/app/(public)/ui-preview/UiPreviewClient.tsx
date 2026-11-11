'use client';

import { useState, type ReactNode } from 'react';
import SiteBadge from '@/components/ui/Badge';
import SiteButton from '@/components/ui/Button';
import SiteCard from '@/components/ui/Card';
import SiteInput from '@/components/ui/Input';
import SiteTextarea from '@/components/ui/Textarea';
import ItemIcon from '@/components/ui/ItemIcon';
import SkewChip from '@/components/ui/SkewChip';
import SkewPlate from '@/components/ui/SkewPlate';
import { Badge } from '@/components/ui/fluid/badge';
import { Banner, BannerDescription, BannerTitle } from '@/components/ui/fluid/banner';
import { Button } from '@/components/ui/fluid/button';
import { Checkbox } from '@/components/ui/fluid/checkbox';
import { Input } from '@/components/ui/fluid/input';
import { RadioGroup, RadioItem } from '@/components/ui/fluid/radio-group';
import { Switch } from '@/components/ui/fluid/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/fluid/table';
import { Tabs, TabsItem } from '@/components/ui/fluid/tabs';
import { Textarea } from '@/components/ui/fluid/textarea';
import { ITEM_ICON_IDS } from '@/lib/pkmn/item-icons';
import { typeClass } from '@/lib/design/type';

const NAV = ['Leagues', 'Tournaments', 'Teams', 'Insights', 'Wiki'];
const TABS = ['Overview', 'Standings', 'Schedule', 'Stats', 'Rules'];

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="space-y-3 rounded-xl border border-hairline bg-surface p-5">
      <h2 className={typeClass('title')}>{title}</h2>
      {children}
    </section>
  );
}

export default function UiPreviewClient() {
  const [nav, setNav] = useState(0);
  const [tab, setTab] = useState(1);
  const [fluidTab, setFluidTab] = useState(0);
  const [checked, setChecked] = useState(true);
  const [on, setOn] = useState(true);
  const [radio, setRadio] = useState('swiss');

  return (
    <div className="space-y-6" data-ui-preview>
      <h1 className={typeClass('display')}>UI primitives</h1>

      <Section id="type" title="Type roles">
        {(['display', 'title', 'subtitle', 'body', 'caption', 'micro'] as const).map((role) => (
          <p key={role} className={typeClass(role)}>
            {role}: Sakura Cup, round 5 of 6
          </p>
        ))}
      </Section>

      <Section id="item-icons" title="Item icons">
        <div className="flex flex-wrap items-end gap-3">
          {ITEM_ICON_IDS.map((id) => (
            <span key={id} className="inline-flex flex-col items-center gap-1 text-micro text-fg-muted">
              <ItemIcon item={id} size={48} />
              {id}
            </span>
          ))}
        </div>
        <div className="flex items-end gap-3">
          {([24, 48, 72, 96] as const).map((size) => (
            <ItemIcon key={size} item="poke-ball" size={size} />
          ))}
          {([24, 48, 72, 96] as const).map((size) => (
            <ItemIcon key={size} item="ability-shield" size={size} />
          ))}
        </div>
      </Section>

      <Section id="plates" title="Skewed plates">
        <nav className="flex flex-wrap gap-1" aria-label="Preview nav">
          {NAV.map((label, i) => (
            <button key={label} type="button" onClick={() => setNav(i)} aria-current={nav === i ? 'page' : undefined}>
              <SkewPlate variant="nav" active={nav === i} glideId="preview-nav">
                {label}
              </SkewPlate>
            </button>
          ))}
        </nav>
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Preview tabs">
          {TABS.map((label, i) => (
            <button key={label} type="button" role="tab" aria-selected={tab === i} onClick={() => setTab(i)}>
              <SkewPlate variant="tab" active={tab === i} glideId="preview-tab">
                {label}
              </SkewPlate>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button">
            <SkewPlate variant="button">Submit result</SkewPlate>
          </button>
          <button type="button">
            <SkewPlate variant="button" tone="secondary">
              View bracket
            </SkewPlate>
          </button>
          {([1, 2, 3, 4] as const).map((tier) => (
            <SkewPlate key={tier} variant="rank" tier={tier}>
              {tier}
            </SkewPlate>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(['neutral', 'accent', 'live', 'win', 'loss', 'tier-1', 'tier-2', 'tier-3', 'tier-4'] as const).map((tone) => (
            <SkewChip key={tone} tone={tone}>
              {tone}
            </SkewChip>
          ))}
        </div>
      </Section>

      <Section id="fluid-controls" title="@fluid controls">
        <div className="flex flex-wrap items-center gap-2">
          {(['primary', 'secondary', 'tertiary', 'ghost', 'destructive'] as const).map((variant) => (
            <Button key={variant} variant={variant}>
              {variant}
            </Button>
          ))}
          <Button size="compact">compact</Button>
        </div>
        <div className="grid max-w-md gap-3">
          <Input placeholder="Search leagues" aria-label="Search leagues" />
          <Textarea placeholder="Match notes" aria-label="Match notes" />
          <label className="inline-flex items-center gap-2 text-body">
            <Checkbox checked={checked} onCheckedChange={setChecked} />
            Auto-confirm results
          </label>
          <Switch label="Show standings" checked={on} onToggle={() => setOn((v) => !v)} />
          <RadioGroup value={radio} onValueChange={setRadio} aria-label="Format">
            <RadioItem index={0} value="swiss" label="Swiss" />
            <RadioItem index={1} value="round-robin" label="Round robin" />
          </RadioGroup>
        </div>
        <Tabs selectedIndex={fluidTab} onSelect={setFluidTab} idPrefix="preview-fluid-tabs">
          {TABS.slice(0, 3).map((label, i) => (
            <TabsItem key={label} index={i} label={label} />
          ))}
        </Tabs>
        <div className="flex flex-wrap gap-2">
          <Badge>Active</Badge>
          <Badge variant="dot">Upcoming</Badge>
        </div>
        <Banner status="info">
          <BannerTitle>Round 5 is open</BannerTitle>
          <BannerDescription>Submit your result by Sunday, 18:00.</BannerDescription>
        </Banner>
      </Section>

      <Section id="site-primitives" title="Site primitives on @fluid">
        <div className="flex flex-wrap items-center gap-2">
          {(['primary', 'secondary', 'ghost', 'danger', 'success'] as const).map((variant) => (
            <SiteButton key={variant} variant={variant}>
              {variant}
            </SiteButton>
          ))}
          <SiteButton size="sm">sm</SiteButton>
          <SiteButton loading>loading</SiteButton>
          <SiteButton disabled>disabled</SiteButton>
        </div>
        <div className="flex flex-wrap gap-2">
          {(['default', 'accent', 'red', 'blue', 'green', 'yellow', 'purple', 'gray'] as const).map((variant) => (
            <SiteBadge key={variant} variant={variant}>
              {variant}
            </SiteBadge>
          ))}
          <SiteBadge size="md">md</SiteBadge>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {(['default', 'elevated', 'outlined', 'muted'] as const).map((variant) => (
            <SiteCard key={variant} variant={variant} hover={variant === 'default'}>
              <p className={typeClass('subtitle')}>{variant}</p>
              <p className="text-caption text-fg-muted">Sakura Cup, round 5 of 6</p>
            </SiteCard>
          ))}
        </div>
        <div className="grid max-w-md gap-3">
          <SiteInput label="League name" hint="Shown on the league page" placeholder="Sakura Cup" />
          <SiteInput label="Start date" type="date" />
          <SiteInput label="Showdown name" error="This name is already taken" defaultValue="ash" />
          <SiteTextarea label="Rules note" placeholder="Bo3, no Tera" />
        </div>
      </Section>

      <Section id="fluid-table" title="@fluid table">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>#</TableHead>
              <TableHead>Trainer</TableHead>
              <TableHead>W</TableHead>
              <TableHead>L</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {[
              ['Ash', 3, 0],
              ['Brock', 2, 1],
              ['Misty', 1, 2],
            ].map(([name, w, l], i) => (
              <TableRow key={String(name)}>
                <TableCell>
                  <SkewPlate variant="rank" tier={(i + 1) as 1 | 2 | 3}>
                    {i + 1}
                  </SkewPlate>
                </TableCell>
                <TableCell>{name}</TableCell>
                <TableCell>{w}</TableCell>
                <TableCell>{l}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>
    </div>
  );
}
