import { Link } from 'react-router-dom'

export default function SiteFooter() {
  return (
    <footer
      style={{
        marginTop: 'auto',
        borderTop: '1px solid var(--border)',
        padding: '1rem',
        display: 'flex',
        justifyContent: 'center',
        gap: '1rem',
        flexWrap: 'wrap',
      }}
    >
      <Link to="/terms">Terms of Service</Link>
      <Link to="/privacy">Privacy Policy</Link>
      <a href="/llms.txt">LLMs</a>
      <a href="/sitemap.xml">Sitemap</a>
    </footer>
  )
}
