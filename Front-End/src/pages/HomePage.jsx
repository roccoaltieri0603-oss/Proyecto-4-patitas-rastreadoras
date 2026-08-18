import PageLayout from '../components/layout/PageLayout'
import Card from '../components/ui/Card'
import Button from '../components/ui/Button'

function HomePage() {
  return (
    <PageLayout title="Pastoreo Inteligente">
      <Card title="Mapa de lotes">
        <p className="text-campo-900">Acá va a ir el mapa satelital con los lotes del campo.</p>
        <Button className="mt-4">Dibujar lote</Button>
      </Card>
    </PageLayout>
  )
}

export default HomePage
