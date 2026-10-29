export default function EmptyState({ title, children }) {
  return (
    <div className="empty-state">
      {title && <p className="empty-state-title">{title}</p>}
      {children && <p className="empty-state-text">{children}</p>}
    </div>
  );
}
