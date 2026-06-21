import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useTeamStore } from '../stores/teamStore'
import { useAuthStore } from '../stores/authStore'
import { useAdminStore } from '../stores/adminStore'
import { useConnectivityStore } from '../stores/connectivityStore'
import { useInsightsFilterStore } from '../stores/insightsFilterStore'
import { CommunityList } from './CommunityList'
import { CommunityCard } from './CommunityCard'
import { PartnerSettingsFields } from './PartnerSettingsFields'
import { ProfileHintBanner } from './ProfileHintBanner'

export function TeamList() {
  const { t } = useTranslation(['teams', 'common'])
  const { user } = useAuthStore()
  const { isAdmin: isPlatformAdmin } = useAdminStore()
  const { isOnline } = useConnectivityStore()
  const { teams, isLoading, error, searchTeams, createTeam, updateEmailPatterns, updateCustomCss, clearError } = useTeamStore()
  const { myFilter } = useInsightsFilterStore()
  const navigate = useNavigate()

  const [showCreate, setShowCreate] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [patterns, setPatterns] = useState('')
  const [customCss, setCustomCss] = useState('')
  const [partnerOpen, setPartnerOpen] = useState(false)

  useEffect(() => {
    searchTeams()
  }, [searchTeams])

  const handleSearch = (q: string) => {
    setSearchQuery(q)
    searchTeams(q)
  }

  const handleToggleCreate = () => {
    if (!showCreate) {
      setName(searchQuery)
    }
    setShowCreate(!showCreate)
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    const team = await createTeam(name.trim(), description.trim())
    if (team) {
      const patternLines = patterns.split('\n').map(l => l.trim()).filter(Boolean)
      if (patternLines.length > 0) {
        await updateEmailPatterns(team.id, patternLines)
      }
      if (customCss.trim()) {
        await updateCustomCss(team.id, customCss.trim())
      }
      setShowCreate(false)
      setName('')
      setDescription('')
      setPatterns('')
      setCustomCss('')
      setPartnerOpen(false)
      navigate(`/teams/${team.id}`)
    }
  }

  return (
    <CommunityList
      title={t('list.title')}
      searchPlaceholder={t('list.searchPlaceholder')}
      onSearchChange={handleSearch}
      isLoading={isLoading}
      error={error}
      hideSearch={showCreate}
      onClearError={clearError}
      emptyMessage={t('list.empty')}
      isEmpty={teams.filter(t => {
        if (myFilter && t.userRole === null) return false
        if (user?.active_team_id && t.team.id !== user.active_team_id) return false
        return true
      }).length === 0}
      actions={
        user && (
          <button className="primary-button" onClick={handleToggleCreate}>
            {showCreate ? t('common:actions.cancel') : t('list.create')}
          </button>
        )
      }
    >
      {showCreate && (
        <form className="community-create-form" onSubmit={handleCreate}>
          <ProfileHintBanner surface="team-create" />
          <div className="form-group">
            <label htmlFor="team-name">{t('list.createForm.nameLabel')}</label>
            <input
              id="team-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('list.createForm.namePlaceholder')}
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="team-description">{t('list.createForm.descriptionLabel')}</label>
            <textarea
              id="team-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('list.createForm.descriptionPlaceholder')}
              rows={10}
            />
          </div>

          {isPlatformAdmin && (
            <details className="partner-settings-collapsible" open={partnerOpen} onToggle={(e) => setPartnerOpen((e.target as HTMLDetailsElement).open)}>
              <summary>{t('list.createForm.partnerSettings')}</summary>
              <div className="partner-settings-body">
                <PartnerSettingsFields
                  patterns={patterns}
                  onPatternsChange={setPatterns}
                  customCss={customCss}
                  onCustomCssChange={setCustomCss}
                  onNameSuggestion={(n) => { if (!name.trim()) setName(n) }}
                  onDescriptionSuggestion={(d) => { if (!description.trim()) setDescription(d) }}
                />
              </div>
            </details>
          )}

          <button type="submit" className="primary-button" disabled={isLoading || !isOnline}>
            {isLoading ? t('list.createForm.creating') : t('list.createForm.submit')}
          </button>
        </form>
      )}

      {teams.filter(t => {
        if (myFilter && t.userRole === null) return false
        if (user?.active_team_id && t.team.id !== user.active_team_id) return false
        return true
      }).map(({ team, userRole, isPartner, systemKey, membershipManagedBy }) => {
        const activeTeamId = user?.active_team_id
        const isStewardsTeam = systemKey === 'stewards' || membershipManagedBy === 'steward-role'
        return (
          <CommunityCard
            key={team.id}
            to={`/teams/${team.id}`}
            title={team.name}
            description={team.description}
            tags={
              <>
                {isStewardsTeam && <span className="badge steward-badge">{t('list.badges.stewards')}</span>}
                {!isStewardsTeam && membershipManagedBy && <span className="badge">{t('list.badges.managed')}</span>}
                {isPartner && <span className="badge" style={{ background: 'var(--color-badge-partner)' }}>{t('list.badges.partner')}</span>}
                {team.is_unlisted && <span className="badge">{t('list.badges.unlisted')}</span>}
                {userRole && <span className={`badge ${userRole === 'admin' ? 'admin-badge' : ''}`}>{t(`roles.${userRole}`, { defaultValue: userRole })}</span>}
                {activeTeamId === team.id && <span className="badge" style={{ background: 'var(--color-badge-active)' }}>{t('list.badges.active')}</span>}
              </>
            }
          />
        )
      })}
    </CommunityList>
  )
}
