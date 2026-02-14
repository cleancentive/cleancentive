# Cleancentive Planning Backlog

> Feature list for reimplementing Delitter as Cleancentive
> Features to be specified using [OpenSpec](https://github.com/Fission-AI/OpenSpec)

## Repository Governance & Setup
*Phase 0 - Project scaffolding*

### 0. Project Infrastructure Setup
- Add CONTRIBUTING.md with guidelines
- Add CODEOWNERS file
- Define semantic versioning approach
- add AGENTS.MD
---

## Foundation & Architecture
*Must be completed first - everything else depends on these*

### 1. User Authentication & Authorization System
- Sign up, sign in, password reset
- Magic link authentication (passwordless) vs traditional password 🔎
- JWT or session-based auth (fixing hard-coded secret issue)
- Role-based access control (Admin, Team Lead, Member, Viewer)
- Multi-factor authentication support
- OAuth integration (Google, GitHub) for easier onboarding

### 2. Core Data Model & Persistence Layer ⚠️
*Critical redesign - fixes embedded document anti-pattern*
- Database: PostgreSQL with PostGIS extension (geospatial queries)
- Normalized schema design:
  - users (id, username, email, auth_method)
  - cleanup_reports (id, user_id, location_point, timestamp, notes)
  - litter_items (id, report_id, category, material, brand, weight_grams, image_url)
  - teams (id, name, description, created_by)
  - team_memberships (team_id, user_id, role)
  - organizations (id, name, settings)
- Proper indexing strategy (geospatial B-tree, time-based, foreign keys)
- Migration strategy from old MongoDB schema
- Define backup and restore procedures

### 3. Image Storage & Management ⚠️
*Fixes 16MB document limit issue*
- Object storage: MinIO (self-hosted S3-compatible) or cloud provider (S3, GCS, R2) 🔎
- Define bucket strategy (single vs multi-bucket, public vs private)
- Image compression & resize on upload (multiple sizes: thumbnail, medium, full)
- CDN integration for serving images
- Thumbnail generation (async job)
- Retention and cleanup policies
- Image upload flow: client → API → object storage → DB reference
- CORS configuration for direct uploads (optional optimization)

---

## Core Litter Tracking Features
*Reimplemented from Delitter with improvements*

### 4. Photo Capture & Litter Reporting
- Camera interface with geolocation
- Manual location entry/correction
- Photo metadata (timestamp, location, notes)
- Batch upload support
- Retry logic for failed uploads

### 5. AI-Powered Image Analysis
- Async worker service (separate from API)
- API contract between main API and vision service
- AI provider abstraction layer (switch between providers)
- Integration with vision API (OpenAI GPT-4 Vision, Claude, or self-hosted model) 🔎
- Classify: litter type, material, brand, weight estimate
- Cost management and rate limiting
- Manual classification override
- Training data collection for future custom models
- Background job queue (Celery, BullMQ, or similar)
- Retry logic and dead letter queue

### 6. Interactive Map Visualization
- Map library: MapLibre GL with OpenStreetMap tiles (fully open-source) vs Mapbox 🔎
- Display litter records with clustering (for performance)
- Filter by date range, type, material, team/individual
- Heatmap view for concentration areas
- Area selection tools (draw polygon, radius)
- Export map view as image/PDF
- Offline map tile caching (for PWA)

### 7. History & Timeline View
- Personal cleanup history
- Timeline with filters
- Detailed view of each litter record
- Edit/delete capabilities
- Statistics summary (total items, weight, categories)

---

## Multi-User & Organization Support
*New capability - not in Delitter*

### 8. Teams & Organizations
- Create and manage teams
- Invite members via email/link
- Organization hierarchy (org → teams → members)
- Team profiles with description and goals
- Transfer ownership

### 9. Role-Based Permissions
- Define roles: Admin, Org Admin, Team Lead, Member, Viewer
- Permission model for data access (view/edit own vs team vs all)
- Granular permissions for features
- Audit log for sensitive actions

---

## Social & Community Features
*New capabilities*

### 10. Activity Feed
- Recent cleanups from followed users/teams
- Celebration of milestones
- Trending cleanup locations
- Filter by geographic area or social graph

### 11. Social Interactions
- Comments on cleanup records
- Reactions/kudos system
- Share cleanup records (social media, direct link)
- Follow users or teams

### 12. Challenges & Events
- Create cleanup challenges with goals (weight, count, area)
- Public or team-specific events
- Event calendar
- Progress tracking toward goals
- Leaderboards for challenges

---

## Data Aggregation & Insights
*New - addresses missing feature in Delitter*

### 13. Filtering & Aggregation System
- Multi-dimensional filters: all/team/individual, date, location, type
- Saved filter presets
- Public vs private data visibility controls
- API for programmatic access

### 14. Analytics Dashboard
- Personal impact metrics (total weight, items, time)
- Team/organization aggregate statistics
- Comparison views (me vs team, team vs city)
- Most common litter types and brands
- Temporal trends (cleanups over time)

### 15. Geographic Insights
- Litter hotspot identification
- Neighborhood/city-level aggregation
- Before/after visualization for areas
- Integration with municipal boundaries

---

## Offline Support & Sync
*New - critical for field use*

### 16. Progressive Web App (PWA) Offline Mode
- Service worker for offline functionality
- Cache map tiles for offline areas
- Queue photos and data for upload when online
- Sync conflict resolution
- Offline indicator and status

### 17. Background Sync & Conflict Resolution
- Automatic retry for failed uploads
- Conflict detection (same litter updated offline by multiple users)
- Manual conflict resolution UI
- Data integrity validation

---

## Export & Reporting
*New capability*

### 18. Data Export
- Export personal data (GDPR compliance)
- Export team/org data (CSV, JSON, GeoJSON)
- Photo archive download (ZIP)
- API for custom integrations

### 19. Report Generation
- Pre-built report templates (weekly, monthly, annual)
- Custom date range reports
- Generate PDF/HTML with maps and charts
- Branded reports for organizations
- Schedule automated reports (email delivery)

---

## Administration & Moderation
*New capability*

### 20. Admin Panel
- User management (view, suspend, delete)
- Organization management
- System health monitoring
- Feature flags and configuration

### 21. Content Moderation
- Review flagged content
- Manual image/record approval workflow (optional)
- Ban inappropriate content
- User reporting system

### 22. Cost & Usage Monitoring
- Track AI API usage and costs
- Storage usage by user/org
- Rate limit enforcement
- Budget alerts

---

## Platform & Application Development
*Client applications and public-facing interfaces*

### 30. Mobile Application
- Framework: Expo (React Native) for single codebase iOS/Android 🔎
- Camera capture with geolocation
- Image upload with compression
- Magic link login flow
- Map view integration
- History and profile views
- Offline support (queue uploads)
- Push notifications
- Environment configuration (dev/staging/prod)

### 31. Public Website & Landing Page
- Marketing site with mission, features, call-to-action
- Blog for updates and impact stories
- Documentation portal integration (or separate) 🔎
- Framework: Next.js, Astro, or static site generator
- Connection to app.cleancentive.org
- SEO optimization
- Privacy policy and terms of service pages

### 32. Web Dashboard (Optional)
- Alternative interface for desktop users
- Administrative interface for org managers
- Advanced reporting and analytics views
- Could share codebase with public website or separate 🔎

---

## Non-Functional Requirements

### 33. GitOps & Infrastructure as Code
- **Infrastructure as Code (IaC)**:
  - All infrastructure defined in code (Terraform or Pulumi) 🔎
  - Version controlled infrastructure definitions
  - Separate environments: development, staging, production
  - Infrastructure changes via pull requests
  - State management (Terraform Cloud, S3 backend, or similar)
  
- **Container Orchestration**:
  - Docker Compose for local development
  - Production: Docker Swarm, Kubernetes, or managed container service 🔎
  - All services containerized with multi-stage builds
  - Container registry (Docker Hub, GitHub Container Registry, or self-hosted)
  
- **Service Definitions**:
  - API service (backend)
  - Image analysis worker service
  - PostgreSQL database
  - MinIO object storage (or cloud equivalent)
  - Redis cache (optional)
  - Reverse proxy (Caddy or Nginx)
  
- **GitOps Workflow**:
  - Git as single source of truth
  - Automated deployments on merge to main (staging)
  - Production deployments via tags (semantic versioning)
  - Rollback capability via Git revert
  - Environment-specific configuration via secrets/ConfigMaps

### 34. CI/CD Pipeline
- **Continuous Integration**:
  - GitHub Actions or GitLab CI
  - Automated on every PR:
    - Lint (ESLint, Black, Ruff, Clippy)
    - Unit tests
    - Integration tests
    - Security scanning (Dependabot, Snyk)
    - OpenAPI spec validation
    - Docker image builds (for validation)
  - Code coverage reporting
  - Performance regression tests
  
- **Continuous Deployment**:
  - Staging: auto-deploy on merge to main
  - Production: deploy on version tags (v0.1.0, v0.2.0, etc.)
  - Deployment strategies:
    - Blue-green deployment (zero downtime)
    - Rolling updates
    - Automatic rollback on health check failures
  - Post-deployment smoke tests
  - Deployment notifications (Slack, Discord, email)

### 35. Environment & Configuration Management
- **Environment Strategy**:
  - Local development (Docker Compose)
  - Staging (mirrors production)
  - Production (stable releases only)
  - Feature environments (optional, for long-running features)
  
- **Configuration Management**:
  - Secrets management (GitHub Secrets, HashiCorp Vault, or cloud provider)
  - Environment variables for configuration
  - No secrets in Git repositories
  - Secret rotation procedures
  - Configuration as code (not manual changes)
  
- **Domain Strategy**:
  - cleancentive.org (marketing site)
  - app.cleancentive.org (web application)
  - api.cleancentive.org (API endpoint)
  - staging.cleancentive.org (staging environment)
  - docs.cleancentive.org (documentation)

### 36. Documentation & Knowledge Management
- **Technical Documentation**:
  - MkDocs + Material theme for docs site
  - Deployed to GitHub Pages or docs.cleancentive.org
  - Architecture Decision Records (ADRs) in /docs/adr/
  - API documentation (OpenAPI/Swagger)
  - Contributing guide
  - Development setup guide
  
- **Product Specifications**:
  - `/specs` folder in repository
  - User stories and requirements
  - Non-functional requirements document
  - Roadmap and milestone planning
  
- **Operational Documentation**:
  - Runbooks for common operations
  - Incident response procedures
  - Deployment procedures
  - Backup and restoration guides

### 37. Privacy, Compliance & Data Governance
- **GDPR Compliance**:
  - Right to access (users can download their data)
  - Right to erasure (users can delete all data)
  - Right to rectification (edit profile, cleanup records)
  - Data portability (export in standard formats)
  - Privacy policy and terms of service
  - Cookie consent management
  
- **Data Retention Policy**:
  - User data: retained until account deletion
  - Cleanup reports: configurable retention (default: indefinite)
  - Images: retention tied to reports
  - Logs: rolled over every 30 days (configurable)
  - Backup retention: 30 days
  - Soft delete with recovery period (30 days)
  
- **Privacy Settings**:
  - Public vs private cleanup reports 🔎
  - Anonymous contribution option
  - Location precision control (exact vs approximate)
  - Opt-in for public aggregated statistics
  
- **Data Governance**:
  - Clear data ownership model
  - Data access audit logs
  - Regular privacy impact assessments
  - GDPR data processing agreements (if applicable)

### 38. Sustainability & Cost Management
- **Infrastructure Budget**:
  - Define monthly cost ceiling for first year 🔎
  - Track actual costs vs budget
  - Cost breakdown by service (compute, storage, AI API)
  - Alerts for budget overrun (80%, 100%, 120%)
  
- **Resource Efficiency**:
  - Right-size infrastructure (don't over-provision)
  - Auto-scaling based on demand (if using cloud)
  - Spot instances for non-critical workloads (if applicable)
  - Image compression to reduce storage costs
  - CDN caching to reduce bandwidth
  
- **AI Cost Management**:
  - Rate limiting per user/org tier
  - Cost per image analysis tracked
  - Option to use cheaper models for batch processing
  - Self-hosted model exploration for long-term sustainability
  
- **Sustainability Principles**:
  - Efficient VPS hosting (low overhead)
  - Green hosting provider preference
  - Minimize unnecessary API calls
  - Optimize database queries (reduce compute)

### 39. Disaster Recovery & Business Continuity
- **Backup Strategy**:
  - Database: daily automated backups with 30-day retention
  - Object storage: replicated or versioned
  - Configuration and secrets: backed up securely
  - Backup testing: quarterly restore drills
  
- **High Availability**:
  - Database replication (primary + replica) 🔎
  - Multi-zone deployment for production 🔎
  - Health checks on all services
  - Automatic failover where possible
  
- **Incident Response**:
  - Monitoring and alerting setup
  - On-call rotation (if team grows) 🔎
  - Incident response runbook
  - Post-mortem process for outages

---

## Technical Infrastructure
*Cross-cutting concerns*

### 40. Backend API Service
- Stack choice: FastAPI (Python) vs NestJS (Node.js) vs Actix (Rust) 🔎
- RESTful API design with OpenAPI spec
- JWT authentication with proper secret management
- Request validation and sanitization
- Rate limiting middleware
- CORS configuration
- Async job scheduling integration
- Database connection pooling
- Health check endpoints (/health, /ready)

### 41. API Design & Documentation
- RESTful or GraphQL API 🔎
- OpenAPI/Swagger documentation (auto-generated)
- API versioning strategy (/v1/, /v2/ in path)
- Rate limiting per user/org tier
- Pagination standards
- Error response standards (RFC 7807)
- API client libraries (optional)

### 42. Security Hardening
- Proper JWT secret management (env variables, rotation)
- Database authentication and encryption at rest
- HTTPS enforcement (TLS 1.3)
- Input validation and sanitization
- CSRF protection
- Security headers (CSP, HSTS, X-Frame-Options)
- SQL injection prevention (parameterized queries)
- XSS prevention
- Rate limiting to prevent abuse
- Regular security audits and penetration testing

### 43. Performance & Scalability
- Database query optimization (EXPLAIN ANALYZE)
- Caching strategy (Redis for hot data)
- CDN for static assets and images
- Horizontal scaling architecture (stateless API)
- Database connection pooling
- Async processing for heavy operations
- Load testing and benchmarks
- Performance budgets (API response time <200ms p95)

### 44. Observability
- Structured logging (JSON format)
- Log aggregation (self-hosted: Loki, cloud: CloudWatch, Datadog)
- Error tracking (Sentry or self-hosted alternative)
- Performance monitoring (APM - Application Performance Monitoring)
- User analytics (privacy-respecting: Plausible, Umami)
- Metrics collection (Prometheus)
- Dashboards (Grafana)
- Alerting for critical issues (PagerDuty, Opsgenie, or email)
- Distributed tracing (if microservices architecture)

---

## Quality of Life Improvements

### 45. Notification System
- Email notifications (digest, real-time)
- Push notifications (PWA and mobile app)
- In-app notifications
- Notification preferences and controls
- Email templates and branding

### 46. Onboarding & Help
- First-time user tutorial (interactive walkthrough)
- Contextual help and tooltips
- FAQ and documentation
- Video tutorials
- In-app feedback mechanism

### 47. Accessibility
- WCAG 2.1 AA compliance
- Screen reader support (semantic HTML, ARIA labels)
- Keyboard navigation
- High contrast mode
- Reduced motion support
- Internationalization (i18n) support
- Multiple language support (English first, expand later)

---

## Strategic Decisions ✅

*Decisions made on 14 February 2026*

### Product & Vision

**Q1: Primary Purpose** → Multi-purpose platform
- Serves individual citizens, organizations (schools/scouts), AND advocacy/transparency use cases
- Architecture must support diverse user types and use cases

**Q2: Target Launch** → ASAP ("tomorrow")
- Aggressive timeline - focus on absolute MVP only
- Quick iteration and deployment critical

**Q3: Expected Scale** → TBD (deferred for now)
- Start small, design for growth
- Geographic scope: Start local/regional, expandable to global

**Q16: Cleanup Organization** → Both, individuals primary
- Support both individual and group cleanups
- Individual use case is primary for MVP
- Group features deferred to v0.2+

**Q17: Long-term Vision** → Open-source community tool + advocacy platform
- Strong copyleft license (AGPL) chosen
- Data transparency for policy impact
- Community-driven development

### Technical Architecture Decisions

**Q4: Backend Stack** → NestJS (Node.js/TypeScript)
- Full-stack TypeScript consistency
- Strong ecosystem and developer experience
- Good balance of performance and productivity

**Q5: Mobile Strategy** → PWA only for MVP
- Fastest time to market
- Works across all platforms immediately
- Can evolve to native apps later if needed

**Q6: Map Provider** → MapLibre + OpenStreetMap (fully open-source)
- No vendor lock-in
- Zero licensing costs
- Aligns with open-source mission

**Q7: AI Inference** → Start with OpenAI API, plan for migration
- Begin with OpenAI for speed
- Keep architecture flexible for future self-hosted models
- Abstract AI provider interface from day 1

**Q8: Infrastructure** → Cheap VPS (Hetzner/DigitalOcean)
- Cost-effective for MVP
- $50-100/month budget (Year 1)
- Single server for MVP, scale horizontally later

**Q9: High Availability** → Single DB instance for MVP
- Keep it simple to start
- Add replication when user base grows
- Focus on backups over HA initially

**Q41: API Style** → RESTful API
- Simpler than GraphQL for MVP
- OpenAPI documentation auto-generated
- Versioned endpoints (/v1/)

### Privacy & Legal Decisions

**Q10: Data Privacy** → User configurable (public by default)
- Location & litter stats: Public by default
- Images: Public by default
- Username (if logged in): Public by default
- Users can configure what to disclose

**Q11: GDPR Deletion** → User choice (hard or soft delete)
- Let users choose between:
  - Hard delete: Fully remove all data
  - Soft delete: Anonymize but keep aggregated stats
- Both options GDPR compliant

**Q12: Brand Detection** → Include it (for transparency)
- AI will detect brands in litter photos
- Critical for advocacy/transparency mission
- Document potential legal considerations

**Q13: Location Precision** → Exact GPS coordinates
- Full transparency approach
- Users can see exactly where litter was found
- Enables better hotspot identification

### Scope Decisions

**Q0: License** → AGPL (strong copyleft)
- Ensures derivative works remain open
- Aligns with transparency mission
- Protects against proprietary forks

**Q18: MVP (v0.1) Must-Have Features**:
1. ✅ Photo capture + geolocation
2. ✅ AI-powered image analysis
3. ✅ Map visualization
4. ✅ User authentication

**Q19: Deferred to v0.2+**:
- ❌ Social features (comments, likes, follows)
- ❌ Teams/organizations
- ❌ Advanced analytics and dashboards
- ❌ Offline support
- ❌ Admin panel
- ❌ Export/reporting

### Business & Sustainability

**Q14: Funding Model** → Not relevant for MVP
- Focus on building first
- Consider later: donations, grants, or freemium
- Open-source first, monetization later (if ever)

**Q15: Budget Ceiling** → $50-100/month (Year 1)
- Cheap VPS hosting: ~$20-30/month
- Database: included in VPS
- Object storage (MinIO): self-hosted
- OpenAI API: largest variable cost
- Domain & DNS: ~$20/year

---

## Open Strategic Questions 🔎

*Remaining questions (lower priority)*

### Product & Vision (Answered ✅)

~~1. **Primary Purpose**: Multi-purpose platform~~
~~2. **Target Launch Date**: ASAP~~
~~3. **Expected Scale**: Deferred~~
~~16. **Cleanup Organization**: Both, individuals primary~~
~~17. **Long-term Vision**: Open-source + advocacy~~

### Technical Decisions (Answered ✅)

~~4. **Backend Stack**: NestJS (Node.js/TypeScript)~~
~~5. **Mobile Strategy**: PWA only for MVP~~
~~6. **Map Provider**: MapLibre + OSM~~
~~7. **AI Inference**: OpenAI API → migrate later~~
~~8. **Infrastructure**: Cheap VPS~~
~~9. **Database Replication**: Single instance for MVP~~
~~41. **API Style**: RESTful~~

### Privacy & Legal (Answered ✅)

~~10. **Data Privacy**: User configurable (public default)~~
~~11. **User Data Deletion**: User choice (hard or soft)~~
~~12. **Brand Detection**: Yes, include it~~
~~13. **User Privacy**: Exact GPS coordinates~~

### Business & Sustainability (Answered ✅)

~~14. **Funding Model**: Not relevant for MVP~~
~~15. **Budget Ceiling**: $50-100/month~~

### MVP Scope Definition (Answered ✅)

~~18. **What is Version 0.1?**: Photo + AI + Map + Auth only~~
~~19. **What to defer?**: Everything else~~

### Remaining Open Questions

**Q3a: Expected Scale Details** (can refine later):
- Year 1: Target pilot users?
- Year 2: Growth trajectory?
- Geographic focus initially?

---

## Next Steps

### ✅ Critical Decisions Made
1. **Strategic questions answered** ✅
2. **Tech stack chosen**: NestJS + TypeScript, PostgreSQL + PostGIS ✅
3. **MVP scope defined**: Photo + AI + Map + Auth only ✅
4. **License selected**: AGPL ✅
5. **Infrastructure approach**: Cheap VPS (~$50-100/month) ✅

### Immediate Actions (Phase 0) - TODAY

1. **Initialize OpenSpec** in this repository
   ```bash
   npm install -g @fission-ai/openspec@latest
   cd /Users/matthias/git/cleancentive
   openspec init
   ```

2. **Create GitHub organization** (if not exists)
   - Org name: `cleancentive` or similar
   - Create public repo: `cleancentive` (main project)
   - Create private repo: `cleancentive-private` (secrets, private docs)

3. **Repository setup**
   - Add AGPL-3.0 license
   - Create CONTRIBUTING.md
   - Setup branch protection (main branch)
   - Add issue templates
   - Create GitHub Projects board

4. **Initialize project structure**
   ```bash
   # Create monorepo structure or separate repos
   /backend          # NestJS API
   /frontend         # PWA (React/Vue/Svelte + TypeScript)
   /worker           # Image analysis service
   /infrastructure   # Terraform/Docker configs
   /docs            # MkDocs documentation
   ```

### Streamlined MVP Feature List (v0.1)

Based on decisions, the MVP includes ONLY these features:

**Foundation (Features #1-3):**
- ✅ #1: Authentication (magic link or simple email/password)
- ✅ #2: Data Model (PostgreSQL + PostGIS, users + cleanup_reports tables)
- ✅ #3: Image Storage (MinIO self-hosted on VPS)

**Core Features (Features #4-7):**
- ✅ #4: Photo Capture & Litter Reporting (PWA camera + geolocation)
- ✅ #5: AI Image Analysis (OpenAI API, async worker)
- ✅ #6: Map Visualization (MapLibre + OSM, basic filtering)
- ✅ #7: History View (personal cleanup timeline)

**Infrastructure (Features #33-34, #40-44):**
- ✅ #33: Docker Compose for local dev
- ✅ #34: Basic CI/CD (GitHub Actions: lint, test, build)
- ✅ #40: NestJS API with OpenAPI docs
- ✅ #42: Basic security (HTTPS, auth, input validation)
- ✅ #44: Basic observability (logging, error tracking)

**Deferred to v0.2+:**
- ❌ #8-9: Teams, Organizations, Permissions
- ❌ #10-12: Social features, Activity Feed, Challenges
- ❌ #13-15: Advanced filtering, Analytics, Geographic Insights
- ❌ #16-17: Offline support, Sync
- ❌ #18-22: Export, Reporting, Admin Panel, Moderation
- ❌ #45-47: Notifications, Onboarding, Accessibility

### Phase 1: Foundation (Days 1-3)

**Day 1: Project Setup**
- [ ] Initialize OpenSpec
- [ ] Create GitHub org and repos
- [ ] Setup monorepo structure
- [ ] Add AGPL license and basic docs
- [ ] Initialize NestJS backend project
- [ ] Initialize frontend PWA project (Vite + React/Vue?)
- [ ] Setup Docker Compose (Postgres, MinIO, Redis)

**Day 2: Core Infrastructure**
- [ ] Database schema (users, cleanup_reports, litter_items)
- [ ] Authentication system (JWT or magic link)
- [ ] Image upload to MinIO
- [ ] OpenAPI spec generation
- [ ] Basic CI/CD pipeline

**Day 3: AI Integration**
- [ ] Create image analysis worker
- [ ] OpenAI Vision API integration
- [ ] Job queue setup (BullMQ or similar)
- [ ] Test end-to-end flow

### Phase 2: MVP Features (Days 4-7)

**Day 4-5: Frontend PWA**
- [ ] Camera capture interface
- [ ] Geolocation integration
- [ ] Photo upload flow
- [ ] Authentication UI

**Day 6: Map & History**
- [ ] MapLibre integration
- [ ] Display cleanup markers
- [ ] History/timeline view
- [ ] Basic filtering

**Day 7: Polish & Deploy**
- [ ] Error handling and UX polish
- [ ] Security hardening
- [ ] Deploy to VPS (Hetzner/DO)
- [ ] Setup domain and HTTPS

### Phase 3: Beta Testing (Week 2)

- [ ] User testing with small group
- [ ] Bug fixes and performance optimization
- [ ] Documentation (user guide, API docs)
- [ ] Public announcement

### Infrastructure Setup Checklist

**VPS Setup:**
- [ ] Provision VPS (Hetzner Cloud CX11 ~5€/month or DO Basic Droplet)
- [ ] Install Docker & Docker Compose
- [ ] Install Caddy for HTTPS (auto Let's Encrypt)
- [ ] Configure firewall (ports 80, 443, 22 only)
- [ ] Setup SSH keys and disable password auth

**Services to Deploy:**
- [ ] PostgreSQL 15+ with PostGIS extension
- [ ] MinIO (S3-compatible object storage)
- [ ] Redis (job queue + caching)
- [ ] NestJS API backend
- [ ] Image analysis worker
- [ ] Frontend PWA (static files)
- [ ] Caddy reverse proxy

**Domains:**
- [ ] Register domain (cleancentive.org or similar)
- [ ] Configure DNS:
  - cleancentive.org → marketing/docs (future)
  - app.cleancentive.org → PWA frontend
  - api.cleancentive.org → Backend API

### OpenSpec Workflow
Each feature can be tracked as its own OpenSpec change with:
- `/opsx:new <feature-name>` - Create new change
- `proposal.md` - Why and what we're building
- `specs/` - Detailed requirements and user stories
- `design.md` - Technical approach and architecture
- `tasks.md` - Implementation checklist
- `/opsx:apply` - Implement the change
- `/opsx:archive` - Complete and archive

### Success Metrics for MVP Launch
- [ ] Repository setup complete ✅
- [ ] All strategic questions answered ✅
- [ ] OpenSpec initialized and first change created
- [ ] Backend API functional with health checks
- [ ] PWA can capture photos and upload
- [ ] AI analysis working end-to-end
- [ ] Map displays cleanup locations
- [ ] Deployed to production VPS
- [ ] At least 5 test users successfully using the app

---

## Key Architectural Changes from Delitter

### Problems Being Fixed
1. **Embedded document anti-pattern** → Normalized data model with separate collections
2. **16MB document limit** → Object storage for images
3. **Hard-coded secrets** → Proper configuration management
4. **No MongoDB auth** → Database security
5. **No rate limiting** → Cost and abuse protection
6. **Monolithic Docker container** → Microservices architecture (TBD)
7. **No offline support** → PWA with service workers
8. **No data aggregation** → Analytics and reporting system

### New Capabilities (Deferred to v0.2+)
- Multi-user organizations and teams *(deferred)*
- Social features and community challenges *(deferred)*
- Advanced filtering and reporting *(deferred)*
- Admin tools and moderation *(deferred)*
- Comprehensive observability *(basic in MVP)*
- GitOps and infrastructure as code *(Docker Compose for MVP)*
- Privacy and compliance features *(basic GDPR support in MVP)*
- Offline support *(deferred, PWA only for MVP)*

---

## Summary

**Total Features**: 47 defined features + 1 governance setup
- **MVP (v0.1)**: 8 core features only (#1-7, #40)
- **Deferred to v0.2+**: 39 features

**All Strategic Questions Answered ✅**:
- ✅ Purpose: Multi-purpose platform (individuals + orgs + advocacy)
- ✅ Stack: NestJS/TypeScript, PostgreSQL+PostGIS, PWA
- ✅ Maps: MapLibre + OSM (open-source)
- ✅ AI: OpenAI API (start), migrate later
- ✅ Infrastructure: Cheap VPS ($50-100/month)
- ✅ Privacy: User configurable (public default)
- ✅ License: AGPL-3.0
- ✅ MVP Scope: Photo + AI + Map + Auth ONLY
- ✅ Timeline: ASAP ("tomorrow")

**Technical Debt Eliminated**:
- ✅ Embedded documents → Normalized PostgreSQL schema
- ✅ Images in database → MinIO object storage
- ✅ Hard-coded secrets → Environment variables
- ✅ No MongoDB auth → PostgreSQL with proper auth
- ✅ No rate limiting → API rate limiting
- ✅ Monolithic container → Separate services (API, worker, DB, storage)
- ✅ Manual deployments → Docker Compose + CI/CD
- ✅ No observability → Logging + error tracking

**Key Architecture Shifts**:
- MongoDB → PostgreSQL with PostGIS
- Rust backend → NestJS (TypeScript)
- Embedded images → MinIO object storage
- Mobile-first Svelte → PWA (React/Vue + TypeScript)
- Firebase hosting → Self-hosted VPS
- Supervisord → Docker Compose

**Next Immediate Action**: Initialize OpenSpec and start with Feature #0 (Repository Setup)