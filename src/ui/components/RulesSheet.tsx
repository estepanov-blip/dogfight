import { BALANCE, SYMBOL_IDS, totalWeight, type EffectValues } from '../../engine';
import { SYMBOL_IMG, SYMBOL_NAME } from '../presentation';

function effectText(e: Partial<EffectValues>): string {
  const p: string[] = [];
  if (e.damage) p.push(`−${e.damage} HP`);
  if (e.shield) p.push(e.shield >= BALANCE.hp ? 'блок 100%' : `щит ${e.shield}`);
  if (e.heal) p.push(`+${e.heal} HP`);
  if (e.extra) p.push(`+${e.extra} ход`);
  if (e.selfDamage) p.push(`себе −${e.selfDamage}`);
  return p.join(', ') || '0';
}

/** All numbers come from docs/balance.json via BALANCE. */
export function RulesSheet({ onClose }: { onClose: () => void }) {
  const total = totalWeight(BALANCE);
  const r = BALANCE.rules;
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <section className="sheet" onClick={(e) => e.stopPropagation()} aria-label="Правила">
        <div className="sheet-head">
          <h2>Как бить</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Закрыть">✕</button>
        </div>
        <p className="muted">
          У каждого {BALANCE.hp} HP. Три барабана, каждый выпадает независимо. Тройка заменяет обычные эффекты.
        </p>
        <table className="rules-table">
          <thead>
            <tr>
              <th />
              <th>Символ</th>
              <th>Шанс</th>
              <th>Эффект</th>
              <th>Тройка</th>
            </tr>
          </thead>
          <tbody>
            {SYMBOL_IDS.map((id) => (
              <tr key={id}>
                <td>
                  <img src={SYMBOL_IMG[id]} alt="" />
                </td>
                <td>{SYMBOL_NAME[id]}</td>
                <td>{Math.round((BALANCE.symbols[id].weight / total) * 100)}%</td>
                <td>{effectText(BALANCE.symbols[id])}</td>
                <td>{effectText(BALANCE.triples[id])}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <ul className="rules-list">
          <li>Эффекты символов складываются, лечение — не выше {BALANCE.hp} HP.</li>
          <li>Щит поглощает следующий входящий удар и исчезает после него или перед твоим следующим ходом.</li>
          <li>
            Молнии вне тройки дают максимум {r.maxExtraPerMixedSpin} доп. ход за спин; подряд — не больше{' '}
            {r.maxExtraTurnsInRow} доп. ходов.
          </li>
          <li>Урон и самоурон применяются одновременно: двойной нокаут — ничья.</li>
          <li>Лимит — {r.maxSpins} вращений на бой, затем победа по HP или ничья.</li>
        </ul>
      </section>
    </div>
  );
}
