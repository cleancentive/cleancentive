# Federation & Platform Integration Analysis for Cleancentive

## Context

Cleancentive is a litter-tracking app with Spots, Picks, Cleanups, and ML-based Detection. The plogging/litter-picking ecosystem is fragmented across dozens of platforms, communities, and data standards — none of which currently federate with each other. This analysis maps the landscape and identifies concrete integration paths for data mirroring, event federation, and community reach.

---

## 1. Plogging & Litter-Picking Communities

### Dedicated Platforms (potential data partners)

| Platform | Model | API / Data Access | Integration Path |
|----------|-------|-------------------|------------------|
| **OpenLitterMap** | Open source, open data, blockchain rewards (Littercoin) | CSV dumps now; JSON API in development. GitHub: [OpenLitterMap](https://github.com/OpenLitterMap) | **High priority.** Bidirectional sync: push Spots as OLM contributions, pull community data for map enrichment. Laravel backend — could contribute API client. |
| **Litterati** | Photo-based, AI categorization, 280K+ users in 185+ countries | Open Data portal (CC BY-SA 4.0, last 12 months), Postman API docs (v2.5/v3.0), data also on data.world | **High priority.** Import open data to enrich Cleancentive's map. Explore API partnership for bidirectional contribution. |
| **Stridy** | Non-profit, open-sourced community DB, no ads | Public database (open-sourced), no documented API | Periodic data import from their open DB. Potential partnership for API access. |
| **Marine Debris Tracker** | NOAA/Univ. of Georgia, 2M+ items | Export via web UI, MDMAP API docs | Import marine/coastal litter data. Align categories with MDMAP schema for interop. |
| **Ocean Conservancy TIDES** | World's largest ocean trash dataset | Public download portal at coastalcleanupdata.org | Import for coastal context. Read-only integration. |
| **Plogalong** | Open source (Code for Boston) | GitHub: [codeforboston/plogalong](https://github.com/codeforboston/plogalong) | Community collaboration opportunity. Shared open-source tooling. |
| **WePlog** | 10K+ active users, color-coded street cleanliness map | No public API | Partnership inquiry. Their GIS street-cleanliness model is interesting for hotspot detection. |
| **GO PLOGGING App** | Global, tracks pieces/location/distance | No public API | Low priority — no API path. |

### Organizations (community reach, not data integration)

| Organization | Reach | Opportunity |
|---|---|---|
| **World Cleanup Day / Let's Do It World** | 91M volunteers (2024), 191 countries, UN recognition | Publish Cleancentive cleanups as WCD events. Use their brand for visibility. |
| **Keep Britain Tidy** | UK's largest litter-picking community | Partner for UK-focused cleanups. |
| **Keep America Beautiful** | US national non-profit, TrashDash events | US cleanup event syndication. |
| **Surfers Against Sewage** | Beach cleanup focus, Data HQ platform | Coastal data exchange. |
| **Litter Free India** | 500+ cleanups, 80 cities, 10M participants | Regional partnership for scale. |

### Online Communities (user acquisition & engagement)

| Community | Size | Integration |
|---|---|---|
| **r/DeTrashed** | 146K+ members | Share picks/before-after, community engagement |
| **r/TrashTag** | Viral movement (82K+ #trashtag posts) | Cross-post cleanup results |
| **r/plogging** | Niche but dedicated | Direct audience |
| **Instagram #plogging** | 59K+ posts | Social sharing from app |
| **Facebook groups** | Hundreds of local groups | Cleanup event promotion |

---

## 2. Event & Community Platforms (Federated)

### ActivityPub / Fediverse — the key to open event federation

| Platform | ActivityPub | API | Best For |
|---|---|---|---|
| **Mobilizon** | Full server-to-server federation | GraphQL API, OAuth2, event import endpoint | **Top pick.** Publish cleanups as federated events visible across the Fediverse. Rich location support (Schema.org Place). Relay actor broadcasts to followers. |
| **Gancio** | Native federation (follows Mobilizon, WordPress, other Gancio nodes) | REST API, RSS, iCal, embeddable widgets | Secondary federation node. RSS/iCal export useful for embedding. |
| **Komunumo** | Full Fediverse compatibility | Open source (AGPL), GitHub: [McPringle/komunumo](https://github.com/McPringle/komunumo) | Community member management + federated events. |

**Recommended approach:** Implement Cleancentive as an **ActivityPub actor** that publishes `Event` objects for Cleanups. This makes every cleanup discoverable on Mastodon, Mobilizon, Gancio, and any Fediverse platform — without needing individual integrations.

**ActivityPub Event object** properties map directly to Cleancentive's Cleanup model:
- `name` → Cleanup title
- `startTime` / `endTime` → Cleanup date/time
- `location` (Place with lat/lng) → Cleanup location
- `tag` → Categories (beach, park, river, etc.)
- `image` → Cleanup photo

### Centralized Event Platforms

| Platform | API | Integration Path |
|---|---|---|
| **Meetup.com** | GraphQL API (Feb 2025 update), OAuth2 | Auto-publish cleanups as Meetup events for discovery. |
| **Eventbrite** | REST API, OAuth2 | Publish larger/ticketed cleanups. Draft → add tickets → publish flow. |

---

## 3. Data Mirroring & Standards

### Litter Data Standards

| Standard | Scope | Relevance |
|---|---|---|
| **OSPAR Beach Litter Protocol** | 112 predefined litter item types, standardized categories | Align Cleancentive's detection categories with OSPAR for EU interop. |
| **GESAMP Marine Debris Item List** | Global standard for marine litter monitoring (SDG 14.1.1b) | International reporting compatibility. |
| **PPSR Core** | Citizen science data interoperability standard | Framework for sharing Spot data with research platforms. |
| **GeoJSON** | Standard geospatial encoding | Use as primary export format for Spots/hotspots. |

**Recommendation:** Map Cleancentive's `LitterItem` categories to OSPAR/GESAMP classifications. This enables data exchange with research institutions, municipal governments, and EU platforms.

### Open Data Publishing

| Target | Platform | Format |
|---|---|---|
| **Researchers** | data.world, Zenodo | CSV/GeoJSON with CC license |
| **Municipalities** | CKAN or Socrata portals | Hotspot data via standard APIs |
| **OpenStreetMap** | OSM API with environmental tags | Litter infrastructure (bins, hotspots) |
| **EU-Citizen.Science** | Swagger API, FAIR metadata | Project listing + dataset metadata |

---

## 4. Fitness & Health Integrations (for Plogging)

| Platform | API | Use Case |
|---|---|---|
| **Strava** | REST API v3, OAuth2 | Import plogging routes, track distance while picking. Gamification: "cleaned 2km of trail." |
| **Apple HealthKit** | iOS SDK | Log plogging as workout activity. |
| **Health Connect** (Android) | Android SDK (replaces deprecated Google Fit) | Same as HealthKit for Android. |

---

## 5. Volunteer & Nonprofit Platforms

| Platform | API | Use Case |
|---|---|---|
| **Idealist** (merged with VolunteerMatch) | Listings API, 80K+ opportunities, 180+ countries | Post cleanup volunteer opportunities. Reach millions of potential volunteers. |
| **Points of Light** | No public API | Partnership for visibility. |

---

## 6. Identity & Cross-Platform Auth

**OpenID Connect / OAuth2 Federation** enables:
- Users sign in to Cleancentive and their identity is recognized on partner platforms
- "Log in with Cleancentive" for community sites
- Federated identity with Mobilizon instances

---

## 7. Prioritized Integration Roadmap

### Phase 1: Data Interop (foundation)
1. **GeoJSON export API** for Spots/Picks — universal format for all downstream integrations
2. **OSPAR/GESAMP category mapping** — align detection categories with international standards
3. **Open data portal** — publish anonymized Spot data under CC license (like Litterati does)

### Phase 2: ActivityPub Federation (events)
4. **ActivityPub actor for Cleancentive** — publish Cleanup events to the Fediverse
5. **Mobilizon integration** — bidirectional event sync via GraphQL API
6. **iCal/RSS feeds** — low-effort event syndication for any calendar app

### Phase 3: Platform Partnerships (reach)
7. **OpenLitterMap bidirectional sync** — push Spots, pull community data
8. **Litterati open data import** — enrich Cleancentive's map with 12 months of global data
9. **Meetup/Eventbrite event publishing** — auto-post cleanups for discovery
10. **Idealist volunteer listings** — post cleanup opportunities

### Phase 4: Fitness & Gamification (engagement)
11. **Strava route import** — link plogging routes to picks
12. **HealthKit/Health Connect** — log plogging as exercise
13. **Leaderboards across federated data** — community-wide stats

### Phase 5: Institutional (impact)
14. **Municipal CKAN/Socrata data feeds** — push hotspot data to local governments
15. **EU-Citizen.Science listing** — register as citizen science project
16. **Research data exports** — Zenodo/data.world with DOI for academic use

---

## Key Sources

- [Mobilizon ActivityPub docs](https://docs.mobilizon.org/5.%20Interoperability/1.activity_pub/)
- [Mobilizon GraphQL API](https://docs.mobilizon.org/5.%20Interoperability/3.graphql_api/)
- [OpenLitterMap GitHub](https://github.com/OpenLitterMap)
- [Litterati Open Data](https://www.litterati.org/open-data)
- [OSPAR Litter Monitoring](https://oap.ospar.org/en/versions/555-en-1-0-0-beach-litter-monitoring/)
- [Meetup GraphQL API](https://www.meetup.com/graphql/)
- [Eventbrite API](https://www.eventbrite.com/platform/api)
- [Strava API](https://developers.strava.com/)
- [Idealist API](https://www.idealist.org/en/open-network-api)
- [EU-Citizen.Science](https://citizenscience.eu/swagger/)
- [PPSR Core Standard](https://core.citizenscience.org/)
- [ActivityPub W3C Spec](https://www.w3.org/TR/activitypub/)
- [Gancio](https://gancio.org/)
- [Komunumo](https://github.com/McPringle/komunumo)
- [Marine Debris Tracker](https://www.debristracker.org/)
- [CKAN](https://ckan.org/)
