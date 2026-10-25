# AutoPostPro compatibility review

Source reviewed read-only: `C:\Users\wavezaza\AppData\Local\AutoPostPro` (the installed Python program and its UI). No executable, license code, Cookie, token, Chrome profile or user configuration was copied.

| Capability | AutoPost Manager TH status |
| --- | --- |
| Multiple named Facebook accounts, Chrome login | Existing unified account workflow; verified Session state, not AutoPostPro's placeholder `logged_in: true`. |
| Group discovery, thumbnails, search and selection | Existing; progressive scroll-and-collect strategy adapted to handle virtualized/lazy-loaded group cards. No stored `joined_groups.json` or image set was available to import. |
| Single Facebook/Discord post with media, notifications and history | Existing. Facebook success requires verified permalink; ambiguous submissions remain uncertain and are not retried automatically. |
| `[date]`, `[time]`, `[rand]` placeholders | Added alongside existing `{date}`, `{time}`, `{emoji}`, `{random:...}` support; expansion happens at send time. |
| Scheduling, saved projects, encrypted session backups | Existing; overdue work requires explicit review. No automatic catch-up from AutoPostPro settings. |
| Link check | Not imported: the source treated a visible comment textbox as proof of availability, which is not a reliable post verification signal. |
| Comment/Share/Like, repeat posting, Discord user-token posting | Remain disabled or unsupported by default. Require separate consent and live verification. No bulk engagement or self-bot adaptation. |
| Delete pending posts | Not imported: destructive remote action and pending approval detection are not validated. |
| License / hardware-ID / external update service | Not imported; specific to the other product. |

Production flags remain in `src/shared/features.ts`. This review and passing local tests do not constitute live Facebook verification.
