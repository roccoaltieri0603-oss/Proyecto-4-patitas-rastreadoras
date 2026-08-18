/**
 * Botón reutilizable. Toda la app usa este, no <button> suelto,
 * así el estilo se cambia en un solo lugar.
 */
const VARIANTS = {
  primary: 'bg-campo-600 text-white hover:bg-campo-700',
  secondary: 'bg-campo-100 text-campo-900 hover:bg-campo-50',
}

function Button({ variant = 'primary', className = '', ...props }) {
  return (
    <button
      className={`rounded-lg px-4 py-2 font-medium transition-colors disabled:opacity-50 ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  )
}

export default Button
