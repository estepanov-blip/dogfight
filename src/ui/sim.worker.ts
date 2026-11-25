/// <reference lib="webworker" />
import { BALANCE, simulate, type SimulationOptions } from '../engine';

self.onmessage = (e: MessageEvent<SimulationOptions>) => {
  try {
    const report = simulate(BALANCE, e.data);
    (self as unknown as Worker).postMessage({ ok: true, report });
  } catch (err) {
    (self as unknown as Worker).postMessage({ ok: false, error: String(err) });
  }
};
