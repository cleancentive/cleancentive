import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTeamStore } from '../stores/teamStore'
import { useAuthStore } from '../stores/authStore'
import { useAdminStore } from '../stores/adminStore'
import { useConnectivityStore } from '../stores/connectivityStore'
import { useInsightsFilterStore } from '../stores/insightsFilterStore'
import { CommunityList } from './CommunityList'
import { CommunityCard } from './CommunityCard'
import { PartnerSettingsFields } from './PartnerSettingsFields'

export function TeamList() {
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
      title="Teams"
      searchPlaceholder="Search teams..."
      onSearchChange={handleSearch}
      isLoading={isLoading}
      error={error}
      hideSearch={showCreate}
      onClearError={clearError}
      emptyMessage="No teams found"
      isEmpty={teams.filter(t => {
        if (myFilter && t.userRole === null) return false
        if (user?.active_team_id && t.team.id !== user.active_team_id) return false
        return true
      }).length === 0}
      actions={
        user && (
          <button className="primary-button" onClick={handleToggleCreate}>
            {showCreate ? 'Cancel' : 'Create Team'}
          </button>
        )
      }
    >
      {showCreate && (
        <form className="community-create-form" onSubmit={handleCreate}>
          <div className="form-group">
            <label htmlFor="team-name">Name</label>
            <input
              id="team-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Team name"
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="team-description">Description</label>
            <textarea
              id="team-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this team about?"
              rows={10}
            />
          </div>

          {isPlatformAdmin && (
            <details className="partner-settings-collapsible" open={partnerOpen} onToggle={(e) => setPartnerOpen((e.target as HTMLDetailsElement).open)}>
              <summary>Partner Settings</summary>
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
            {isLoading ? 'Creating...' : 'Create'}
          </button>
        </form>
      )}

      {teams.filter(t => {
        if (myFilter && t.userRole === null) return false
        if (user?.active_team_id && t.team.id !== user.active_team_id) return false
        return true
      }).map(({ team, userRole, isPartner }) => {
        const activeTeamId = user?.active_team_id
        return (
          <CommunityCard
            key={team.id}
            to={`/teams/${team.id}`}
            title={team.name}
            description={team.description}
            tags={
              <>
                {isPartner && <span className="badge" style={{ background: 'var(--color-badge-partner)' }}>Partner</span>}
                {userRole && <span className={`badge ${userRole === 'admin' ? 'admin-badge' : ''}`}>{userRole}</span>}
                {activeTeamId === team.id && <span className="badge" style={{ background: 'var(--color-badge-active)' }}>Active</span>}
              </>
            }
          />
        )
      })}
    </CommunityList>
  )
}
