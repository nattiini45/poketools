'use client';

import { useState, useMemo, useEffect, type ReactNode } from 'react';
import { useSession } from 'next-auth/react';
import { useDataLocale, useT } from '@/i18n/client';
import { draftLegacyMessages } from '@/i18n/messages/draft/legacy';
import { draftLegacyEvolutionMessages } from '@/i18n/messages/draft/legacy/evolution';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';
import { localizeMove } from '@/lib/pkmn/i18n/names/moves';
import type { EvolutionTracker } from '@/types/evolution';
import type { TeamRole } from '@/types/format-rules';
import { TEAM_ROLE_CATEGORIES } from '@/types/format-rules';
import type { MatchupDexPayload } from '@/lib/evolution/matchup-types';
import MatchupRosterPanel from '@/components/evolution/MatchupRosterPanel';
import MatchupStabMatrix from '@/components/evolution/MatchupStabMatrix';
import MatchupPokemonDetail from '@/components/evolution/MatchupPokemonDetail';

interface MatchupClientProps {
  seasonId: string;
  formatType: string;
  participants: { id: string; name: string }[];
  trackers: EvolutionTracker[];
  bannedMoves: string[];
  /** Server-provided roles (always available on public page) */
  initialRoles: TeamRole[];
  priceByBase: Record<string, number>;
  /** Server-composed types + species + STAB for all season current forms */
  dexPayload: MatchupDexPayload;
}

export default function MatchupClient({
  participants,
  trackers,
  bannedMoves,
  initialRoles,
  priceByBase,
  dexPayload,
}: MatchupClientProps) {
  const t = useT(draftLegacyEvolutionMessages);
  const { status: authStatus } = useSession();
  const [player1, setPlayer1] = useState('');
  const [player2, setPlayer2] = useState('');
  const [roles, setRoles] = useState<TeamRole[]>(initialRoles);
  const [selectedSpecies, setSelectedSpecies] = useState<string | null>(null);
  const [openSections, setOpenSections] = useState({
    rosters: true,
    stabP1: true,
    stabP2: true,
    roles: true,
  });

  const { typeInfo, speciesDetails, stabMultipliers } = dexPayload;

  const p1Trackers = useMemo(
    () => trackers.filter((t) => t.player_id === player1),
    [trackers, player1],
  );
  const p2Trackers = useMemo(
    () => trackers.filter((t) => t.player_id === player2),
    [trackers, player2],
  );

  const p1Name = participants.find((p) => p.id === player1)?.name ?? t('matchup.player1');
  const p2Name = participants.find((p) => p.id === player2)?.name ?? t('matchup.player2');

  const bannedSet = useMemo(
    () => new Set(bannedMoves.map((m) => m.toLowerCase())),
    [bannedMoves],
  );

  // Optional refresh when authenticated (auth-safe: falls back to initialRoles)
  useEffect(() => {
    if (authStatus !== 'authenticated') return;
    let cancelled = false;
    fetch('/api/team-roles')
      .then((res) => res.json())
      .then((json) => {
        if (!cancelled && json.success) setRoles(json.data);
      })
      .catch(() => { /* keep initialRoles */ });
    return () => { cancelled = true; };
  }, [authStatus]);

  const rolesFor = (rosterTrackers: EvolutionTracker[], category: string): { pokemon: string; move: string }[] => {
    const currentForms = new Set(rosterTrackers.map((t) => t.current_form));
    return roles
      .filter((r) =>
        r.category === category &&
        r.is_active &&
        currentForms.has(r.species_form) &&
        !bannedSet.has(r.move_name.toLowerCase()),
      )
      .map((r) => ({ pokemon: r.species_form, move: r.move_name }));
  };

  const toggleSection = (key: keyof typeof openSections) => {
    setOpenSections((s) => ({ ...s, [key]: !s[key] }));
  };

  const detail = selectedSpecies
    ? speciesDetails[selectedSpecies] ?? typeInfo[selectedSpecies] ?? null
    : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-4">
        <PlayerSelect label={t('matchup.yourTrainer')} value={player1} onChange={setPlayer1} participants={participants} />
        <PlayerSelect
          label={t('matchup.opponent')}
          value={player2}
          onChange={setPlayer2}
          participants={participants.filter((p) => p.id !== player1)}
        />
      </div>

      {player1 && player2 && (
        <>
          <CollapsibleSection
            title={t('matchup.rosters')}
            open={openSections.rosters}
            onToggle={() => toggleSection('rosters')}
          >
            <div className="grid gap-6 lg:grid-cols-2">
              <MatchupRosterPanel
                name={p1Name}
                trackers={p1Trackers}
                typeInfo={typeInfo}
                priceByBase={priceByBase}
                roles={roles}
                bannedSet={bannedSet}
                onSelect={setSelectedSpecies}
                selected={selectedSpecies}
              />
              <MatchupRosterPanel
                name={p2Name}
                trackers={p2Trackers}
                typeInfo={typeInfo}
                priceByBase={priceByBase}
                roles={roles}
                bannedSet={bannedSet}
                onSelect={setSelectedSpecies}
                selected={selectedSpecies}
              />
            </div>
          </CollapsibleSection>

          {detail && (
            <MatchupPokemonDetail
              detail={detail}
              roles={roles.filter((r) =>
                r.species_form === selectedSpecies &&
                r.is_active &&
                !bannedSet.has(r.move_name.toLowerCase()),
              )}
              onClose={() => setSelectedSpecies(null)}
            />
          )}

          {p1Trackers.length > 0 && p2Trackers.length > 0 && (
            <>
              <CollapsibleSection
                title={t('matchup.stabTitle', { attacker: p1Name, defender: p2Name })}
                open={openSections.stabP1}
                onToggle={() => toggleSection('stabP1')}
              >
                <MatchupStabMatrix
                  attackers={p1Trackers}
                  defenders={p2Trackers}
                  stabMultipliers={stabMultipliers}
                  typeInfo={typeInfo}
                />
              </CollapsibleSection>
              <CollapsibleSection
                title={t('matchup.stabTitle', { attacker: p2Name, defender: p1Name })}
                open={openSections.stabP2}
                onToggle={() => toggleSection('stabP2')}
              >
                <MatchupStabMatrix
                  attackers={p2Trackers}
                  defenders={p1Trackers}
                  stabMultipliers={stabMultipliers}
                  typeInfo={typeInfo}
                />
              </CollapsibleSection>
            </>
          )}

          <CollapsibleSection
            title={t('matchup.roleComparison')}
            open={openSections.roles}
            onToggle={() => toggleSection('roles')}
          >
            <RoleComparison
              p1Name={p1Name}
              p2Name={p2Name}
              p1Trackers={p1Trackers}
              p2Trackers={p2Trackers}
              rolesFor={rolesFor}
            />
          </CollapsibleSection>
        </>
      )}

      {!player1 && !player2 && (
        <div className="rounded-lg border border-poke-border p-8 text-center text-sm text-poke-text-secondary">
          {t('matchup.selectTwo')}
        </div>
      )}
    </div>
  );
}

function PlayerSelect({
  label,
  value,
  onChange,
  participants,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  participants: { id: string; name: string }[];
}) {
  const t = useT(draftLegacyEvolutionMessages);
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-poke-text-secondary">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-poke-border bg-poke-elevated px-3 py-2 text-sm text-poke-text focus:border-blue-500 focus:outline-none"
      >
        <option value="">{t('matchup.select')}</option>
        {participants.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
    </div>
  );
}

function CollapsibleSection({
  title,
  open,
  onToggle,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-poke-border">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between px-4 py-2 text-sm font-semibold hover:bg-poke-elevated/50"
        aria-expanded={open}
      >
        {title}
        <span className="text-poke-text-muted">{open ? '▾' : '▸'}</span>
      </button>
      {open && <div className="border-t border-poke-border p-4">{children}</div>}
    </div>
  );
}

function RoleComparison({
  p1Name,
  p2Name,
  p1Trackers,
  p2Trackers,
  rolesFor,
}: {
  p1Name: string;
  p2Name: string;
  p1Trackers: EvolutionTracker[];
  p2Trackers: EvolutionTracker[];
  rolesFor: (trackers: EvolutionTracker[], category: string) => { pokemon: string; move: string }[];
}) {
  const t = useT(draftLegacyEvolutionMessages);
  const tLegacy = useT(draftLegacyMessages);
  const dataLocale = useDataLocale();
  const roleLine = (r: { pokemon: string; move: string }) =>
    `${localizeSpecies(r.pokemon, dataLocale)} — ${localizeMove(r.move, dataLocale)}`;
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {TEAM_ROLE_CATEGORIES.map((cat) => {
        const p1Roles = rolesFor(p1Trackers, cat);
        const p2Roles = rolesFor(p2Trackers, cat);
        const missingBoth = p1Roles.length === 0 && p2Roles.length === 0;
        return (
          <div
            key={cat}
            className={`rounded p-2 ${missingBoth ? 'bg-poke-surface/50' : 'bg-poke-elevated'}`}
          >
            <p className="text-xs font-medium text-poke-text-secondary">{tLegacy(`teamRole.${cat}`)}</p>
            <div className="mt-1 grid grid-cols-2 gap-2 text-xs">
              <div>
                <span className="text-blue-400">{p1Name.split(' ')[0]}</span>
                {p1Roles.length === 0 ? (
                  <p className="text-poke-text-secondary italic">{t('matchup.none')}</p>
                ) : (
                  p1Roles.map((r, i) => (
                    <p key={i} className="truncate">{roleLine(r)}</p>
                  ))
                )}
              </div>
              <div>
                <span className="text-red-400">{p2Name.split(' ')[0]}</span>
                {p2Roles.length === 0 ? (
                  <p className="text-poke-text-secondary italic">{t('matchup.none')}</p>
                ) : (
                  p2Roles.map((r, i) => (
                    <p key={i} className="truncate">{roleLine(r)}</p>
                  ))
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
