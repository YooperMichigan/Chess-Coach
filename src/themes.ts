// Visual themes. Board colours are passed to react-chessboard (main board and review boards);
// everything else is CSS in themes.css, scoped by <html data-skin="...">.

export interface Theme {
  id: string;
  name: string;
  board: { light: string; dark: string };
}

export const THEMES: Theme[] = [
  { id: 'classic', name: 'Classic', board: { light: '#f0d9b5', dark: '#b58863' } },
  { id: 'club', name: 'Club Room', board: { light: '#e9d3ae', dark: '#8a5a3b' } },
  { id: 'night', name: 'Night Study', board: { light: '#c9d4df', dark: '#56708d' } },
  { id: 'tournament', name: 'Tournament', board: { light: '#f0f0d4', dark: '#6f9a52' } },
];

export const themeById = (id: string) => THEMES.find((t) => t.id === id) ?? THEMES[0];

/** react-chessboard options for a theme's squares, with coordinates in the opposite square colour. */
export function boardStyle(theme: Theme) {
  return {
    lightSquareStyle: { backgroundColor: theme.board.light },
    darkSquareStyle: { backgroundColor: theme.board.dark },
    lightSquareNotationStyle: { color: theme.board.dark },
    darkSquareNotationStyle: { color: theme.board.light },
  };
}
