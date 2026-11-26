import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BALANCE, createBattle, takeTurn, type SymbolId } from '../../engine';
import { avatarFor, captionFor, FIGHTER_AVATARS, FIGHTER_SPRITES, floatsFor, lookFor, posesFor } from '../presentation';
import { CHARACTERS, RETIRED_FIGHTERS } from '../../online/v03';
import { FighterScreen } from '../screens/FighterScreen';
import { BattleScreen } from '../screens/BattleScreen';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const rec = (s: SymbolId[], hp: [number, number] = [100, 100]) => {
  const b = createBattle(BALANCE, { seed: 1 });
  const st = { ...b, fighters: [{ hp: hp[0], shield: 0 }, { hp: hp[1], shield: 0 }] as typeof b.fighters };
  return takeTurn(st, BALANCE, { forced: s }).record;
};

describe('presentation mapping', () => {
  it('captions', () => {
    expect(captionFor(rec(['punch', 'punch', 'heal'])).text).toBe('ПРОПУСТИЛ!');
    expect(captionFor(rec(['punch', 'critical', 'heal'])).text).toBe('КРИТ!');
    expect(captionFor(rec(['critical', 'critical', 'critical'])).text).toBe('СУПЕРУДАР!');
    expect(captionFor(rec(['punch', 'punch', 'punch'])).text).toBe('КОМБО x3!');
    expect(captionFor(rec(['heal', 'miss', 'miss'], [50, 100])).text).toBe('ХИЛ!');
    expect(captionFor(rec(['miss', 'miss', 'miss'])).text).toBe('САМОУДАР!');
    expect(captionFor(rec(['block', 'miss', 'miss'])).kind).toBe('block');
  });
  it('poses and floating numbers', () => {
    expect(posesFor(rec(['critical', 'punch', 'miss']))).toEqual({ actor: 'crit', target: 'hitHard' });
    expect(posesFor(rec(['punch', 'miss', 'miss']))).toEqual({ actor: 'punch', target: 'hit' });
    expect(posesFor(rec(['miss', 'miss', 'miss'])).actor).toBe('self');
    const f = floatsFor(rec(['punch', 'heal', 'block'], [50, 100]));
    expect(f.map((x) => x.kind).sort()).toEqual(['dmg', 'heal', 'shield']);
  });
});

describe('Fighter Pack v0.3', () => {
  it('every fighter has its own sprite and avatar; both corners; right corner mirrored', () => {
    const sprites = new Set<string>();
    const avatars = new Set<string>();
    for (const c of CHARACTERS) {
      expect(FIGHTER_SPRITES[c.assetKey]).toBeTruthy();
      expect(FIGHTER_AVATARS[c.assetKey]).toBeTruthy();
      const l = lookFor(c.id, 0);
      const r = lookFor(c.id, 1);
      expect(l.sprite).toBe(FIGHTER_SPRITES[c.assetKey]);
      expect(r.sprite).toBe(l.sprite); // mirror match: same art on both sides
      expect([l.flip, r.flip]).toEqual([false, true]);
      expect([l.corner, r.corner]).toEqual(['red', 'blue']);
      expect(l.frame).toBe(c.frame);
      expect(l.breed).toBe(c.name);
      sprites.add(l.sprite);
      avatars.add(avatarFor(c.id));
    }
    expect(sprites.size).toBe(8);
    expect(avatars.size).toBe(8);
  });
  it('retired placeholder ids render as their replacement; unknown ids keep the v0.2 look', () => {
    for (const [old, now] of Object.entries(RETIRED_FIGHTERS)) expect(lookFor(old, 1)).toEqual(lookFor(now, 1));
    expect(lookFor('nope', 0).breed).toBe('Сиба');
    expect(lookFor(undefined, 1).breed).toBe('Буль');
  });
  it('picker lists all eight, maps a retired current id, saves the selection', () => {
    const onSaved = vi.fn();
    render(<FighterScreen current="kolbasa" online={false} onSaved={onSaved} onBack={() => {}} />);
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(8);
    expect(screen.getByRole('radio', { name: /Бокс/ }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('radio', { name: /Пух/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать: Пух' }));
    return vi.waitFor(() => expect(onSaved).toHaveBeenCalledWith('pushok'));
  });
});

describe('BattleScreen', () => {
  it('blocks repeated clicks while a spin is animating', () => {
    vi.useFakeTimers();
    render(<BattleScreen mode="local" seed={7} debug={false} onExit={() => {}} />);
    const btn = screen.getByRole('button', { name: /крутить/i });
    act(() => {
      fireEvent.click(btn);
      fireEvent.click(btn);
      fireEvent.click(btn);
    });
    expect(screen.getByRole('button', { name: /Журнал \(1\)/ })).toBeTruthy();
    expect((screen.getByRole('button', { name: /Крутим/ }) as HTMLButtonElement).disabled).toBe(true);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    const again = screen.getByRole('button', { name: /крутить/i }) as HTMLButtonElement;
    expect(again.disabled).toBe(false);
    act(() => {
      fireEvent.click(again);
    });
    expect(screen.getByRole('button', { name: /Журнал \(2\)/ })).toBeTruthy();
  });

  it('bot spins by itself and the fight reaches a result with rematch', () => {
    vi.useFakeTimers();
    render(<BattleScreen mode="bot" seed={3} debug={false} onExit={() => {}} />);
    for (let i = 0; i < 60 && !screen.queryByRole('dialog'); i++) {
      const b = screen.queryByRole('button', { name: /^⟳ крутить$/i }) as HTMLButtonElement | null;
      act(() => {
        if (b && !b.disabled) fireEvent.click(b);
        vi.advanceTimersByTime(4000);
      });
    }
    expect(screen.getByRole('dialog')).toBeTruthy();
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /Реванш/ }));
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getAllByText('100 HP').length).toBe(2);
  });
});
