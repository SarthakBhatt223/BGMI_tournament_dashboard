// Horizontal admin navigation. Scrolls sideways on narrow screens instead of wrapping.
export default function TopNav({ tabs, activeTab, onSelect }) {
  return (
    <nav className="tab-bar" aria-label="Admin sections">
      {tabs.map(([id, label]) => (
        <button
          key={id}
          type="button"
          className={activeTab === id ? 'tab-active' : 'tab'}
          aria-current={activeTab === id ? 'page' : undefined}
          onClick={() => onSelect(id)}
        >
          {label}
        </button>
      ))}
    </nav>
  );
}
