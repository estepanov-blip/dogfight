import { useEffect, useState } from 'react';
import { api } from '../../online/api';
import { CHARACTERS } from '../../online/v03';
import { bindBackButton } from '../../platform/telegram';
import { lookFor } from '../presentation';

interface Props {
  current: string | null;
  online: boolean;
  onSaved: (id: string) => void;
  onBack: () => void;
}

/** DFC-004: eight free fighters, identical combat stats. */
export function FighterScreen({ current, online, onSaved, onBack }: Props) {
  const [sel, setSel] = useState<string>(current ?? 'shiba');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => bindBackButton(onBack), [onBack]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      if (online) await api.setFighter(sel);
      onSaved(sel);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="screen fighters">
      <header className="lab-head">
        <button className="btn btn-ghost" onClick={onBack}>
          ← Меню
        </button>
        <h1>Выбор бойца</h1>
      </header>
      <p className="muted small">
        Все бойцы бесплатны и бьют одинаково — отличается только вид. Выбор действует в новых боях, начатые бои не меняются.
      </p>
      <div className="fighter-grid" role="radiogroup" aria-label="Бойцы">
        {CHARACTERS.map((c) => (
          <button
            key={c.id}
            role="radio"
            aria-checked={sel === c.id}
            className={`fighter-card ${sel === c.id ? 'selected' : ''}`}
            onClick={() => setSel(c.id)}
          >
            <img src={lookFor(c.id, 0).sprite} alt="" />
            <b>{c.name}</b>
            <small>{c.breed}</small>
            <span className="fc-tags">
              <span className="chip-st st-win">бесплатно</span>
              {c.assetStatus === 'placeholder' && <span className="chip-st">временный арт</span>}
            </span>
          </button>
        ))}
      </div>
      {error && <p className="error">{error}</p>}
      <button className="btn btn-primary btn-challenge" onClick={save} disabled={busy}>
        {busy ? 'Сохраняем…' : `Выбрать: ${CHARACTERS.find((c) => c.id === sel)?.name}`}
      </button>
    </div>
  );
}
