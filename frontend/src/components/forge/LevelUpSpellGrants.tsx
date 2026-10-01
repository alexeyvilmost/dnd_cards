import {useEffect, useMemo, useState} from 'react';
import type {Spell} from '../../types';
import {createRegistry, type Registry} from '../../engine/registry';
import {createApiResolver} from '../../engine/apiResolver';
import {indexSpells} from '../../engine/spellRefs';
import {levelUpSpellGrantRefs, levelUpSpellGrants, type LevelUpSpellGrant, type LevelUpSpellGrantSnapshot} from '../../character/levelUpPresentation';
import {useSiteSettings} from '../../settings';
import SheetActionLine from '../SheetActionLine';
import {spellDetail} from './ForgeSpellIconGrid';
import './LevelUpSpellGrants.css';

export function spellGrantDetails(entry: LevelUpSpellGrant): string[] {
  const accessLabels = {
    cantrip:'Заговор', known:'Изучено', spellbook:'В книге заклинаний', always_prepared:'Всегда подготовлено',
    innate:'Врождённое заклинание', unavailable:'Доступ зависит от источника', ritual_only:'Только ритуал',
  };
  const details: string[] = entry.access ? [accessLabels[entry.access]] : [];
  const freeuse = entry.grant.freeuse;
  if (freeuse?.atWill) details.push('Без ячейки · неограниченно');
  else if (freeuse) {
    const recharge: Record<string,string> = {short_rest:'короткий отдых', long_rest:'долгий отдых', day:'день'};
    details.push(`Без ячейки · ${entry.freeUses ?? 0} / ${recharge[freeuse.recharge] ?? freeuse.recharge}`);
  }
  if (freeuse?.level != null) details.push(`Уровень бесплатного применения: ${entry.level}`);
  return details;
}

/** Inspectable canonical spell cards. Resolving an automatic grant here never
 * learns or prepares it independently and does not change the Forge draft. */
export default function LevelUpSpellGrants({before, after, spells, loading = false, registry: suppliedRegistry}: {
  before: LevelUpSpellGrantSnapshot | null;
  after: LevelUpSpellGrantSnapshot;
  spells: Spell[];
  loading?: boolean;
  registry?: Registry;
}) {
  const {entityDisplay} = useSiteSettings();
  const registry = useMemo(() => suppliedRegistry ?? createRegistry(createApiResolver()), [suppliedRegistry]);
  const refsKey = JSON.stringify(levelUpSpellGrantRefs(before, after));
  const catalog = useMemo(() => {
    const indexed = indexSpells(spells);
    return new Map([...indexed.byId, ...indexed.bySlug]);
  }, [spells]);
  const [retry, setRetry] = useState(0);
  const [resolved, setResolved] = useState<{refsKey:string; spells:Map<string,Spell>; missing:string[]} | null>(null);
  useEffect(() => {
    if (loading || !before) return;
    let stale = false;
    const refs = JSON.parse(refsKey) as string[];
    const missing = refs.filter(ref => !catalog.has(ref));
    registry.resolveMany<Spell>('spell', missing).then(found => {
      if (stale) return;
      setResolved({refsKey, spells:new Map(missing.flatMap((ref,index) => found[index] ? [[ref,found[index]!]] : [])),
        missing:missing.filter((_,index) => !found[index])});
    }).catch(() => {
      if (!stale) setResolved({refsKey, spells:new Map(), missing});
    });
    return () => {stale = true;};
  }, [before, catalog, loading, refsKey, registry, retry]);
  const missingRefs = (JSON.parse(refsKey) as string[]).some(ref => !catalog.has(ref));
  const pending = loading || !before || (missingRefs && resolved?.refsKey !== refsKey);
  const spellsByRef = new Map([...catalog, ...(resolved?.refsKey === refsKey ? resolved.spells : [])]);
  const unresolved = resolved?.refsKey === refsKey ? resolved.missing : [];
  const grants = !pending && before ? levelUpSpellGrants(before, after, spellsByRef) : [];
  return <div className="forge-block levelup-spell-grants" aria-busy={pending || undefined}>
    <div className="forge-section-h">Получаемые заклинания</div>
    {pending ? <p className="forge-note">Загрузка выдаваемых заклинаний…</p> : <>
      {grants.length ? <div className={`levelup-spell-grant-list levelup-spell-grant-list--${entityDisplay.spells}`}>
        {grants.map(entry => <article key={entry.key} className="levelup-spell-grant">
          <SheetActionLine name={entry.spell.name} imageUrl={entry.spell.image_url} spellRef={entry.spell}
            sourceLabel={entry.grant.source.name} detail={spellDetail(entry.spell)} level={entry.spell.level}
            variant={entityDisplay.spells} inspectMode onActivate={() => undefined}/>
          <div className="levelup-spell-grant-info">
            {entityDisplay.spells === 'icon' && <b>{entry.spell.name}</b>}
            <span className="levelup-spell-grant-source">{entry.grant.source.name}</span>
            {spellGrantDetails(entry).map(detail => <span key={detail}>{detail}</span>)}
            {entry.change === 'changed' && <span className="levelup-spell-grant-change">Условия применения изменятся</span>}
          </div>
        </article>)}
      </div> : !unresolved.length && <p className="forge-note">На этом уровне новых выдаваемых заклинаний нет.</p>}
      {!!unresolved.length && <p className="forge-note" role="status">Часть выдаваемых заклинаний не загрузилась.{' '}
        <button type="button" className="forge-link-btn" onClick={() => {registry.clearCache();setResolved(null);setRetry(value=>value+1);}}>Повторить</button></p>}
    </>}
  </div>;
}
