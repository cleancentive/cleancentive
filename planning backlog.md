# Cleancentive Planning Backlog

> Feature list for reimplementing Delitter as Cleancentive
> Features to be specified using [OpenSpec](https://github.com/Fission-AI/OpenSpec)

## Foundation & Architecture
*Must be completed first - everything else depends on these*

### 1. User Authentication & Authorization System
- Sign up, sign in, password reset
- JWT or session-based auth (fixing hard-coded secret issue)
- Role-based access control (Admin, Team Lead, Member)
- Multi-factor authentication support

### 2. Core Data Model & Persistence Layer ⚠️
*Critical redesign - fixes embedded document anti-pattern*
- Separate collections for Users, Litter Records, Teams, Organizations
- Proper indexing strategy (geospatial, time-based)
- Database choice evaluation (PostgreSQL with PostGIS vs MongoDB properly normalized vs hybrid)
- Migration strategy from old schema

### 3. Image Storage & Management ⚠️
*Fixes 16MB document limit issue*
- Object storage integration (S3, GCS, or CloudFlare R2)
- Image compression & resize on upload
- CDN integration for serving images
- Thumbnail generation
- Retention and cleanup policies

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
- Integration with vision API (OpenAI, Claude, or custom model)
- Classify: litter type, material, brand, weight estimate
- Cost management and rate limiting
- Manual classification override
- Training data collection for future custom models

### 6. Interactive Map Visualization
- Display litter records with clustering
- Filter by date range, type, material, team/individual
- Heatmap view for concentration areas
- Area selection tools
- Export map view as image/PDF

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

## Technical Infrastructure
*Cross-cutting concerns*

### 23. API Design & Documentation
- RESTful or GraphQL API
- OpenAPI/Swagger documentation
- API versioning strategy
- Rate limiting per user/org tier

### 24. Security Hardening
- Proper JWT secret management (env variables, rotation)
- Database authentication and encryption
- HTTPS enforcement
- Input validation and sanitization
- CSRF protection
- Security headers

### 25. Performance & Scalability
- Database query optimization
- Caching strategy (Redis)
- CDN for static assets
- Horizontal scaling architecture
- Load testing and benchmarks

### 26. Observability
- Structured logging
- Error tracking (Sentry)
- Performance monitoring (APM)
- User analytics (privacy-respecting)
- Alerting for critical issues

---

## Quality of Life Improvements

### 27. Notification System
- Email notifications (digest, real-time)
- Push notifications (PWA)
- In-app notifications
- Notification preferences

### 28. Onboarding & Help
- First-time user tutorial
- Contextual help and tooltips
- FAQ and documentation
- Video tutorials

### 29. Accessibility
- WCAG 2.1 AA compliance
- Screen reader support
- Keyboard navigation
- High contrast mode
- Internationalization (i18n) support

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

### New Capabilities
- Multi-user organizations and teams
- Social features and community challenges
- Advanced filtering and reporting
- Admin tools and moderation
- Comprehensive observability

---

## Next Steps

1. Initialize OpenSpec in this repository
2. Prioritize features (start with Foundation #1-3)
3. Create OpenSpec changes for each feature
4. Specify → Design → Implement iteratively

Each feature can be tracked as its own OpenSpec change with:
- `proposal.md` - Why and what we're building
- `specs/` - Detailed requirements
- `design.md` - Technical approach
- `tasks.md` - Implementation checklist