import type { TurnRecord } from '../../engine';
import { describeTurn, SYMBOL_IMG } from '../presentation';

export function BattleLog({ log, names, onClose }: { log: TurnRecord[]; names: [string, string]; onClose: () => void }) {
  const items = [...log].reverse();
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <section className="sheet" onClick={(e) => e.stopPropagation()} aria-label="Журнал боя">
        <div className="sheet-head">
          <h2>Журнал боя</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Закрыть">✕</button>
        </div>
        {items.length === 0 && <p className="muted">Пока ни одного удара. Крути!</p>}
        <ol className="log">
          {items.map((r) => (
            <li key={r.index} className={`log-item actor-${r.actor} ${r.combo.triple ? 'triple' : ''}`}>
              <div className="log-top">
                <span className="log-idx">#{r.index}</span>
                <span className={`log-name side-${r.actor}`}>{names[r.actor]}</span>
                {r.isExtraTurn && <span className="chip chip-extra">⚡ доп.</span>}
                {r.forced && <span className="chip chip-debug">debug</span>}
                <span className="log-syms">
                  {r.combo.symbols.map((s, i) => (
                    <img key={i} src={SYMBOL_IMG[s]} alt={s} />
                  ))}
                </span>
                <span className="log-hp">
                  {r.hpAfter[0]} : {r.hpAfter[1]}
                </span>
              </div>
              <div className="log-desc">{describeTurn(r, names)}</div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
