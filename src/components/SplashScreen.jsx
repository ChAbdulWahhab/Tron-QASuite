import logoUrl from '../assets/tron-app.png'

export default function SplashScreen({ visible }) {
  if (!visible) return null

  return (
    <div className="tron-splash" role="status" aria-live="polite" aria-label="Loading TRON">
      <div className="tron-splash__inner">
        <img className="tron-splash__logo" src={logoUrl} alt="" width={88} height={88} />
        <div className="tron-splash__brand">TRON QA Suite</div>
        <div className="tron-splash__tagline">Automated Quality Verification</div>
        <div className="tron-splash__bar" aria-hidden>
          <div className="tron-splash__bar-fill" />
        </div>
      </div>
    </div>
  )
}
