function Section({ title, subtitle, children, actions }) {
  const hasHeader = Boolean(title) || Boolean(subtitle) || Boolean(actions)
  return (
    <section className="card">
      {hasHeader ? (
        <div className="card-header">
          <div>
            {title ? <h2>{title}</h2> : null}
            {subtitle ? <p className="muted">{subtitle}</p> : null}
          </div>
          {actions ? <div className="card-actions">{actions}</div> : null}
        </div>
      ) : null}
      <div className="card-body">{children}</div>
    </section>
  )
}

export default Section
