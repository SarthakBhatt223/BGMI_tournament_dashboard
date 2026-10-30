// Which scene the display shows and its title text. Pure functions of the server snapshot: the
// broadcast mode is decided by the backend (manual controls and the scheduler), never here.
export const DISPLAY_SCENES = ['ambient', 'standings', 'mvp'];

export function sceneOf(state) {
  const mode = state?.broadcast?.mode;
  return DISPLAY_SCENES.includes(mode) ? mode : 'ambient';
}

export function headlineOf(state) {
  return state.broadcast.headlineText || state.event.name;
}

export function subtitleOf(state) {
  return state.broadcast.subtitleText || state.config.branding.tagline;
}
