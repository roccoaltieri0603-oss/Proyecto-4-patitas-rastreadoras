/** Caja blanca con borde. Sirve para cada lote del ranking, paneles, etc. */
function Card({ title, children, className = '' }) {
  return (
    <section className={`rounded-xl border border-campo-100 bg-white p-4 shadow-sm ${className}`}>
      {title && <h2 className="mb-2 text-lg font-semibold text-campo-900">{title}</h2>}
      {children}
    </section>
  )
}

export default Card
