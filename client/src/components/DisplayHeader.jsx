import { describeMatch } from '../utils/formatters.js';
import { headlineOf, subtitleOf } from '../utils/displayScene.js';

// Event title bar shown above the standings and MVP scenes.
export default function DisplayHeader({ state, title }) {
  const subtitle = subtitleOf(state);
  return (
    <header className="display-header">
      <div className="display-brand">
        <span className="display-brand-mark" aria-hidden="true" />
        <div>
          <h1 className="display-title">{headlineOf(state)}</h1>
          {subtitle && <p className="display-subtitle">{subtitle}</p>}
        </div>
      </div>
      <div className="display-header-side">
        <p className="display-section">{title}</p>
        {state.currentMatch && <p className="display-match">{describeMatch(state.currentMatch.match)}</p>}
      </div>
    </header>
  );
}
