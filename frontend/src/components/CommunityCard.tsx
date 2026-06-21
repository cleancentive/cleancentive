import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

interface CommunityCardProps {
  to: string
  title: string
  description: string
  tags?: ReactNode
  meta?: ReactNode
}

export function CommunityCard({ to, title, description, tags, meta }: CommunityCardProps) {
  const { t } = useTranslation(['cleanups'])
  return (
    <Link to={to} className="community-card">
      <div className="community-card-content">
        <div className="community-card-title-row">
          <h3>{title}</h3>
          {tags && <span className="community-card-tags">{tags}</span>}
        </div>
        <p className="community-card-description">{description}</p>
        {meta && <div className="community-card-meta">{meta}</div>}
      </div>
      <span className="view-details">{t('card.viewDetails')} &rarr;</span>
    </Link>
  )
}
