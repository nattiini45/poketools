'use client';

import { Select, SelectContent, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@ui-sdk/react/select';
import { useDataLocale, useFormatter, useT } from '@/i18n/client';
import { teamComparisonMessages } from '@/i18n/messages/team-comparison';
import PokemonSprite from '@/components/shared/PokemonSprite';
import PkmnName from '@/components/shared/PkmnName';
import { localizeName } from '@/lib/pkmn/i18n/names';
import type { ComparisonRoster, StabHit, TeamComparisonData } from '@/lib/team-comparison';
import styles from './team-comparison.module.css';

export default function TeamComparison({ data, opponentName, onLeagueChange }: {
  data: TeamComparisonData;
  opponentName: string;
  onLeagueChange(id: string): void;
}) {
  const t = useT(teamComparisonMessages);
  const f = useFormatter();
  const dl = useDataLocale();
  const missingTypes = [...data.mine.pokemon, ...data.theirs.pokemon].some((pokemon) => pokemon.types.length === 0);

  function roster(team: ComparisonRoster, title: string) {
    return <section className={styles.roster}>
      <h3 className="font-heading text-lg font-bold">{title}</h3>
      {team.hidden ? <p className="text-fg-muted">{t('hidden')}</p> : team.pokemon.length === 0 ? <p className="text-fg-muted">{t('emptyRoster')}</p> :
        <ul className={styles.pokemon}>
          {team.pokemon.map((pokemon) => <li key={pokemon.species}>
            <PokemonSprite name={pokemon.species} size={48} />
            <div><span className="font-semibold"><PkmnName kind="species" name={pokemon.species} /></span>
              <p className="text-sm text-fg-muted">{pokemon.types.length === 0 ? t('unknown') : f.list(pokemon.types.map((type) => localizeName('type', type, dl)))}</p>
            </div>
          </li>)}
        </ul>}
    </section>;
  }

  function hits(entries: StabHit[], title: string) {
    return <section className={styles.coverage}>
      <h3 className="font-heading font-bold">{title}</h3>
      {data.mine.hidden || data.theirs.hidden || !data.mine.pokemon.length || !data.theirs.pokemon.length ?
        <p className="text-sm text-fg-muted">{t('unavailable')}</p> : <>
          {missingTypes && <p className="mt-3 text-sm text-fg-muted">{t('partial')}</p>}
          {entries.length === 0 ? !missingTypes && <p className="text-sm text-fg-muted">{t('emptyHits')}</p> :
            <ul className="mt-3 space-y-2 text-sm">{entries.map((hit) => <li key={`${hit.attacker}:${hit.defender}:${hit.type}`}>
            {t('hit', { attacker: localizeName('species', hit.attacker, dl), defender: localizeName('species', hit.defender, dl), type: localizeName('type', hit.type, dl), multiplier: f.number(hit.multiplier) })}
          </li>)}</ul>}
        </>}
    </section>;
  }

  if (!data.leagueId) return <p className="py-6 text-fg-muted">{t('noLeague')}</p>;
  return <div className="space-y-5">
    <Select value={data.leagueId} onValueChange={(id) => { if (typeof id === 'string') onLeagueChange(id); }} items={data.leagues.map((league) => ({ value: league.id, label: league.name }))}>
      <SelectLabel className="mb-1 block text-sm font-semibold">{t('league')}</SelectLabel>
      <SelectTrigger className={styles.control}><SelectValue /></SelectTrigger>
      <SelectContent className={styles.options}>
        {data.leagues.map((league) => <SelectItem key={league.id} value={league.id} className={styles.option}>{league.name}</SelectItem>)}
      </SelectContent>
    </Select>
    <div className={styles.columns}>{roster(data.mine, t('mine'))}{roster(data.theirs, t('theirs', { name: opponentName }))}</div>
    <p className="text-sm text-fg-muted">{t('note')}</p>
    <div className={styles.columns}>{hits(data.myHits, t('myHits'))}{hits(data.theirHits, t('theirHits'))}</div>
  </div>;
}
