// A bordered panel with an optional title bar. `actions` renders on the right of the title.
export default function Panel({ title, actions, className = '', children }) {
  return (
    <section className={`panel ${className}`}>
      {(title || actions) && (
        <div className="panel-head">
          {title && <h2>{title}</h2>}
          {actions && <div className="panel-actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}
