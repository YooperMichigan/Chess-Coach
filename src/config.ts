// Central app settings. Stage 3+ will add coach settings and model IDs here.

export type EngineStrength =
  | { kind: 'skill'; level: number } // Stockfish "Skill Level" 0-20
  | { kind: 'elo'; elo: number }; // UCI_LimitStrength + UCI_Elo (1320-3190)

export interface StrengthPreset {
  label: string;
  strength: EngineStrength;
}

// UCI_Elo bottoms out at 1320, so the weakest presets use Skill Level instead.
export const STRENGTH_PRESETS: StrengthPreset[] = [
  { label: 'Beginner (Skill 0)', strength: { kind: 'skill', level: 0 } },
  { label: 'Novice (Skill 3)', strength: { kind: 'skill', level: 3 } },
  { label: 'Casual (Skill 6)', strength: { kind: 'skill', level: 6 } },
  { label: 'Elo 1320', strength: { kind: 'elo', elo: 1320 } },
  { label: 'Elo 1500', strength: { kind: 'elo', elo: 1500 } },
  { label: 'Elo 1800', strength: { kind: 'elo', elo: 1800 } },
  { label: 'Elo 2100', strength: { kind: 'elo', elo: 2100 } },
  { label: 'Elo 2500', strength: { kind: 'elo', elo: 2500 } },
  { label: 'Full strength', strength: { kind: 'skill', level: 20 } },
];

export const DEFAULT_PRESET_INDEX = 4; // Elo 1500

// How long the engine thinks before playing its move.
export const ENGINE_MOVE_TIME_MS = 800;

// Relative to the app's base URL so the build works from any path, not just the site root.
export const STOCKFISH_WORKER_URL = `${import.meta.env.BASE_URL}stockfish/stockfish-19-lite-single.js`;
