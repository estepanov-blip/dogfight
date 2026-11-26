import { useEffect, useState } from 'react';
import { api } from '../../online/api';
import { CHARACTERS, characterById } from '../../online/v03';
import { bindBackButton } from '../../platform/telegram';
import { avatarFor, lookFor } from '../presentation';

interface Props {
  current: string | null;
  online: boolean;
  onSaved: (id: string) => void;
  onBack: () => void;
}

/** DFC-004 + Fighter Pack v0.3: eight free fighters, identical combat stats. */
export function FighterScreen({ current, online, onSaved, onBack }: Props) {
  const [sel, setSel] = useState<string>(characterById(current)?.id ?? 'shiba');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => bindBackButton(onBack), [onBack]);

  const c = characterById(sel) ?? CHARACTERS[0];
  const look = lookFor(c.id, 0);
  const unchanged = c.id === characterById(current)?.id;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      if (online) await api.setFighter(c.id);
      onSaved(c.id);
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

      <div className={`fighter-stage frame-${look.frame}`}>
        <img key={c.id} className="fighter-stage-img" src={look.sprite} alt={c.name} draggable={false} />
        <div className="fighter-stage-name">
          <b>{c.name}</b>
          <small>{c.breed}</small>
        </div>
      </div>

      <div className="fighter-grid" role="radiogroup" aria-label="Бойцы">
        {CHARACTERS.map((x) => (
          <button
            key={x.id}
            role="radio"
            aria-checked={sel === x.id}
            aria-label={`${x.name}, ${x.breed}`}
            className={`fighter-card ${sel === x.id ? 'selected' : ''}`}
            onClick={() => setSel(x.id)}
          >
            <img src={avatarFor(x.id)} alt="" draggable={false} />
            <b>{x.name}</b>
          </button>
        ))}
      </div>

      <p className="muted small fighter-note">
        Все 8 бойцов бесплатны и бьют одинаково — отличается только вид. Можно выбрать того же бойца, что у соперника.
        Выбор действует в новых боях, начатые бои не меняются.
      </p>
      {error && <p className="error">{error}</p>}
      <button className="btn btn-primary btn-challenge" onClick={save} disabled={busy}>
        {busy ? 'Сохраняем…' : unchanged ? `Готово: ${c.name}` : `Выбрать: ${c.name}`}
      </button>
    </div>
  );
}
