export default function Placeholder({ title }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '40vh', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: '2.5rem' }}>🚧</div>
      <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#1A1D1E' }}>{title}</div>
      <div style={{ fontSize: '0.875rem', color: 'rgba(26,29,30,0.4)', fontWeight: 500 }}>Раздел в разработке</div>
    </div>
  )
}
