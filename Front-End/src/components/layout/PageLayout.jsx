/** Estructura común de todas las pantallas: encabezado arriba, contenido abajo. */
function PageLayout({ title, children }) {
  return (
    <div className="flex min-h-svh flex-col bg-campo-50">
      <header className="bg-campo-700 px-6 py-4 text-white">
        <h1 className="text-xl font-semibold">{title}</h1>
      </header>
      <main className="flex-1 p-6">{children}</main>
    </div>
  )
}

export default PageLayout
