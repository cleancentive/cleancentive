import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTeamStore } from '../stores/teamStore'
import { useAuthStore } from '../stores/authStore'
import { useConnectivityStore } from '../stores/connectivityStore'
import { CommunityList } from './CommunityList'
import { CommunityCard } from './CommunityCard'

export function TeamList() {
  const { user } = useAuthStore()
  const { isOnline } = useConnectivityStore()
  const { teams, isLoading, error, searchTeams, createTeam, clearError } = useTeamStore()
  const navigate = useNavigate()

  const [showCreate, setShowCreate] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

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
      setShowCreate(false)
      setName('')
      setDescription('')
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
      isEmpty={teams.length === 0}
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
          <button type="submit" className="primary-button" disabled={isLoading || !isOnline}>
            {isLoading ? 'Creating...' : 'Create'}
          </button>
        </form>
      )}

      {teams.map(({ team, userRole }) => {
        const activeTeamId = (user as any)?.active_team_id
        return (
          <CommunityCard
            key={team.id}
            to={`/teams/${team.id}`}
            title={team.name}
            description={team.description}
            tags={
              <>
                {userRole && <span className={`badge ${userRole === 'admin' ? 'admin-badge' : ''}`}>{userRole}</span>}
                {activeTeamId === team.id && <span className="badge" style={{ background: '#16a34a' }}>Active</span>}
              </>
            }
          />
        )
      })}
    </CommunityList>
  )
}
