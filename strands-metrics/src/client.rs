use anyhow::Result;
use chrono::{DateTime, Datelike, Utc};
use http::StatusCode;
use http::header::ACCEPT;
use indicatif::ProgressBar;
use octocrab::{Octocrab, OctocrabBuilder, models};
use rusqlite::{Connection, params};
use serde::Deserialize;
use serde_json::Value;
use std::collections::HashSet;

#[derive(Deserialize, Debug)]
struct SimpleUser {
    login: String,
}

#[derive(Deserialize, Debug)]
struct StarEntry {
    starred_at: Option<DateTime<Utc>>,
    user: Option<SimpleUser>,
}

pub struct GitHubClient<'a> {
    pub gh: Octocrab,
    db: &'a mut Connection,
    pb: ProgressBar,
}

impl<'a> GitHubClient<'a> {
    pub fn new(gh: Octocrab, db: &'a mut Connection, pb: ProgressBar) -> Self {
        Self { gh, db, pb }
    }

    pub async fn check_limits(&self) -> Result<()> {
        let rate = self.gh.ratelimit().get().await?;
        let core = rate.resources.core;

        if core.remaining < 50 {
            let reset = core.reset;
            let now = Utc::now().timestamp() as u64;
            let wait_secs = reset.saturating_sub(now) + 10;
            self.pb
                .set_message(format!("Rate limit low. Sleeping {}s...", wait_secs));
            tokio::time::sleep(tokio::time::Duration::from_secs(wait_secs)).await;
        }
        Ok(())
    }

    pub async fn sync_org(&mut self, org: &str) -> Result<()> {
        self.check_limits().await?;
        let repos = self.fetch_repos(org).await?;
        for repo in repos {
            self.pb.set_message(format!("Syncing {}", repo.name));
            self.sync_repo(org, &repo).await?;
        }
        Ok(())
    }

    pub async fn sweep_org(&mut self, org: &str) -> Result<()> {
        self.check_limits().await?;
        let repos = self.fetch_repos(org).await?;
        for repo in repos {
            self.pb.set_message(format!("Sweeping {}", repo.name));
            self.sweep_repo(org, &repo).await?;
        }
        Ok(())
    }

    async fn fetch_repos(&self, org: &str) -> Result<Vec<models::Repository>> {
        let mut repos = Vec::new();
        let mut page = self.gh.orgs(org).list_repos().per_page(100).send().await?;
        repos.extend(page.items);
        while let Some(next) = page.next {
            self.check_limits().await?;
            page = self.gh.get_page(&Some(next)).await?.unwrap();
            repos.extend(page.items);
        }

        repos.retain(|r| {
            !r.archived.unwrap_or(false)
                && !r.private.unwrap_or(false)
                && !r.name.starts_with("private_")
        });

        Ok(repos)
    }

    async fn sweep_repo(&self, org: &str, repo: &models::Repository) -> Result<()> {
        let mut remote_open_numbers = HashSet::new();
        let route = format!("/repos/{}/{}/issues", org, repo.name);
        let mut page: octocrab::Page<Value> = self
            .gh
            .get(
                &route,
                Some(&serde_json::json!({
                    "state": "open", "per_page": 100
                })),
            )
            .await?;

        loop {
            let next_page = page.next.clone();
            for item in page.items {
                if let Some(num) = item.get("number").and_then(|n| n.as_i64()) {
                    remote_open_numbers.insert(num);
                }
            }
            if let Some(next) = next_page {
                self.check_limits().await?;
                page = self.gh.get_page(&Some(next)).await?.unwrap();
            } else {
                break;
            }
        }

        let mut stmt = self.db.prepare(
            "SELECT number FROM issues WHERE repo = ?1 AND state = 'open' AND closed_at IS NULL AND deleted_at IS NULL"
        )?;
        let local_open_nums: Vec<i64> = stmt
            .query_map(params![repo.name], |row| row.get(0))?
            .collect::<Result<Vec<_>, _>>()?;

        let now = Utc::now().to_rfc3339();

        for local_num in local_open_nums {
            if !remote_open_numbers.contains(&local_num) {
                self.check_limits().await?;
                let issue_route = format!("/repos/{}/{}/issues/{}", org, repo.name, local_num);

                let result: Result<Value, _> = self.gh.get(&issue_route, None::<&()>).await;

                match result {
                    Ok(json) => {
                        let state = json
                            .get("state")
                            .and_then(|s| s.as_str())
                            .unwrap_or("closed");
                        let closed_at = json.get("closed_at").and_then(|s| s.as_str());
                        self.db.execute(
                            "UPDATE issues SET state = ?1, closed_at = ?2 WHERE repo = ?3 AND number = ?4",
                            params![state, closed_at, repo.name, local_num]
                        )?;
                    }
                    Err(e) => {
                        if Self::is_missing_resource(&e) {
                            // Explicit 404/410 means deleted/missing
                            self.db.execute(
                                "UPDATE issues SET state = 'deleted', deleted_at = ?1 WHERE repo = ?2 AND number = ?3",
                                params![now, repo.name, local_num]
                            )?;
                        } else {
                            // Any other error (500, 502, timeout) is a crash.
                            return Err(e.into());
                        }
                    }
                }
            }
        }
        Ok(())
    }

    async fn sync_repo(&mut self, org: &str, repo: &models::Repository) -> Result<()> {
        let repo_name = &repo.name;
        let last_sync_key = format!("last_sync_{}_{}", org, repo_name);

        let since: DateTime<Utc> = self
            .db
            .query_row(
                "SELECT value FROM app_state WHERE key = ?1",
                params![last_sync_key],
                |row| {
                    let s: String = row.get(0)?;
                    Ok(DateTime::parse_from_rfc3339(&s)
                        .map(|dt| dt.with_timezone(&Utc))
                        .unwrap_or(Utc::now()))
                },
            )
            .unwrap_or_else(|_| {
                DateTime::parse_from_rfc3339("1970-01-01T00:00:00Z")
                    .unwrap()
                    .with_timezone(&Utc)
            });

        self.sync_pull_requests(org, repo_name, since).await?;
        self.sync_issues(org, repo_name, since).await?;
        self.sync_issue_comments(org, repo_name, since).await?;
        self.sync_pr_comments(org, repo_name, since).await?;
        self.sync_stars(org, repo).await?;
        self.sync_commits(org, repo_name, since).await?;
        self.sync_workflows(org, repo_name, since).await?;

        let now_str = Utc::now().to_rfc3339();
        self.db.execute(
            "INSERT OR REPLACE INTO app_state (key, value) VALUES (?1, ?2)",
            params![last_sync_key, now_str],
        )?;

        Ok(())
    }

    async fn sync_commits(&self, org: &str, repo: &str, since: DateTime<Utc>) -> Result<()> {
        self.check_limits().await?;

        let route = format!("/repos/{}/{}/commits", org, repo);
        let mut page: octocrab::Page<Value> = self
            .gh
            .get(
                &route,
                Some(&serde_json::json!({
                    "since": since.to_rfc3339(), "per_page": 100
                })),
            )
            .await?;

        loop {
            let next_page = page.next.clone();

            // Optimization: Collect SHAs and check in batch locally to avoid DB thrashing
            let mut shas = HashSet::new();
            for item in &page.items {
                if let Some(sha) = item.get("sha").and_then(|s| s.as_str()) {
                    shas.insert(sha.to_string());
                }
            }

            for sha in shas {
                // Check if exists
                let exists: bool = self
                    .db
                    .query_row("SELECT 1 FROM commits WHERE sha = ?1", params![sha], |_| {
                        Ok(true)
                    })
                    .unwrap_or(false);

                if !exists {
                    // We must fetch details to get stats (additions/deletions)
                    // Check limits BEFORE the heavy call
                    self.check_limits().await?;

                    let detail_route = format!("/repos/{}/{}/commits/{}", org, repo, sha);
                    let detail: Value = self.gh.get(&detail_route, None::<&()>).await?;

                    let author = detail
                        .get("commit")
                        .and_then(|c| c.get("author"))
                        .and_then(|a| a.get("name"))
                        .and_then(|n| n.as_str())
                        .unwrap_or("unknown");

                    let date_str = detail
                        .get("commit")
                        .and_then(|c| c.get("author"))
                        .and_then(|a| a.get("date"))
                        .and_then(|d| d.as_str())
                        .unwrap_or("");

                    let stats = detail.get("stats");
                    let adds = stats
                        .and_then(|s| s.get("additions"))
                        .and_then(|v| v.as_i64())
                        .unwrap_or(0);
                    let dels = stats
                        .and_then(|s| s.get("deletions"))
                        .and_then(|v| v.as_i64())
                        .unwrap_or(0);
                    let msg = detail
                        .get("commit")
                        .and_then(|c| c.get("message"))
                        .and_then(|m| m.as_str())
                        .unwrap_or("");

                    self.db.execute(
                        "INSERT OR REPLACE INTO commits (sha, repo, author, date, additions, deletions, message) 
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                        params![sha, repo, author, date_str, adds, dels, msg]
                    )?;
                }
            }

            if let Some(next) = next_page {
                self.check_limits().await?;
                page = self.gh.get_page(&Some(next)).await?.unwrap();
            } else {
                break;
            }
        }
        Ok(())
    }

    async fn sync_workflows(&self, org: &str, repo: &str, since: DateTime<Utc>) -> Result<()> {
        self.check_limits().await?;
        let route = format!("/repos/{}/{}/actions/runs", org, repo);
        let created_filter = format!(">{}", since.format("%Y-%m-%d"));

        let mut page: octocrab::Page<Value> = self
            .gh
            .get(
                &route,
                Some(&serde_json::json!({
                    "created": created_filter, "per_page": 100
                })),
            )
            .await?;

        loop {
            let next_page = page.next.clone();
            for run in page.items {
                let id = run.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
                let name = run.get("name").and_then(|v| v.as_str()).unwrap_or("");
                let head = run
                    .get("head_branch")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let conclusion = run
                    .get("conclusion")
                    .and_then(|v| v.as_str())
                    .unwrap_or("in_progress");
                let created_at = run.get("created_at").and_then(|v| v.as_str()).unwrap_or("");
                let updated_at = run.get("updated_at").and_then(|v| v.as_str()).unwrap_or("");

                let duration = if let (Some(start), Some(end)) = (
                    run.get("created_at").and_then(|v| v.as_str()),
                    run.get("updated_at").and_then(|v| v.as_str()),
                ) {
                    let s = DateTime::parse_from_rfc3339(start).unwrap_or(Utc::now().into());
                    let e = DateTime::parse_from_rfc3339(end).unwrap_or(Utc::now().into());
                    (e - s).num_milliseconds()
                } else {
                    0
                };

                self.db.execute(
                    "INSERT OR REPLACE INTO workflow_runs (id, repo, name, head_branch, conclusion, created_at, updated_at, duration_ms)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                    params![id, repo, name, head, conclusion, created_at, updated_at, duration]
                )?;
            }

            if let Some(next) = next_page {
                self.check_limits().await?;
                page = self.gh.get_page(&Some(next)).await?.unwrap();
            } else {
                break;
            }
        }
        Ok(())
    }

    async fn sync_stars(&mut self, org: &str, repo: &models::Repository) -> Result<()> {
        self.check_limits().await?;
        let token = std::env::var("GITHUB_TOKEN").unwrap_or_default();
        let star_gh = OctocrabBuilder::new()
            .personal_token(token)
            .add_header(ACCEPT, "application/vnd.github.star+json".to_string())
            .build()?;

        let mut remote_users = HashSet::new();

        let route = format!("/repos/{}/{}/stargazers", org, repo.name);
        let mut page: octocrab::Page<StarEntry> = star_gh
            .get(&route, Some(&serde_json::json!({ "per_page": 100 })))
            .await?;

        loop {
            let next_page = page.next.clone();
            for entry in page.items {
                if let (Some(starred_at), Some(user)) = (entry.starred_at, entry.user) {
                    remote_users.insert(user.login.clone());
                    self.db.execute(
                        "INSERT OR REPLACE INTO stargazers (repo, user, starred_at) VALUES (?1, ?2, ?3)",
                        params![repo.name, user.login, starred_at.to_rfc3339()],
                    )?;
                }
            }
            if let Some(next) = next_page {
                self.check_limits().await?;
                page = star_gh.get_page(&Some(next)).await?.unwrap();
            } else {
                break;
            }
        }

        let mut stmt = self
            .db
            .prepare("SELECT user FROM stargazers WHERE repo = ?1")?;
        let rows = stmt.query_map(params![repo.name], |row| row.get::<_, String>(0))?;

        let mut to_delete = Vec::new();
        for local_user in rows {
            let u = local_user?;
            if !remote_users.contains(&u) {
                to_delete.push(u);
            }
        }

        for u in to_delete {
            self.db.execute(
                "DELETE FROM stargazers WHERE repo = ?1 AND user = ?2",
                params![repo.name, u],
            )?;
        }

        Ok(())
    }

    async fn sync_pull_requests(&self, org: &str, repo: &str, since: DateTime<Utc>) -> Result<()> {
        self.check_limits().await?;
        let mut page = self
            .gh
            .pulls(org, repo)
            .list()
            .state(octocrab::params::State::All)
            .sort(octocrab::params::pulls::Sort::Updated)
            .direction(octocrab::params::Direction::Descending)
            .per_page(100)
            .send()
            .await?;

        let mut keep_fetching = true;
        loop {
            let next_page = page.next;
            for pr in page.items {
                if let Some(updated) = pr.updated_at
                    && updated < since
                {
                    keep_fetching = false;
                    break;
                }

                let json = serde_json::to_string(&pr)?;
                let pr_id = pr.id.0 as i64;
                let pr_number = pr.number as i64;
                let state_str = match pr.state {
                    Some(models::IssueState::Open) => "open",
                    Some(models::IssueState::Closed) => "closed",
                    _ => "unknown",
                };

                self.db.execute(
                    "INSERT OR REPLACE INTO pull_requests 
                    (id, repo, number, state, author, title, created_at, updated_at, merged_at, closed_at, data) 
                    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                    params![
                        pr_id, repo, pr_number, state_str,
                        pr.user.as_ref().map(|u| u.login.clone()).unwrap_or_default(),
                        pr.title.unwrap_or_default(),
                        pr.created_at.map(|d| d.to_rfc3339()).unwrap_or_default(),
                        pr.updated_at.map(|d| d.to_rfc3339()).unwrap_or_default(),
                        pr.merged_at.map(|t| t.to_rfc3339()),
                        pr.closed_at.map(|t| t.to_rfc3339()),
                        json
                    ],
                )?;

                if pr.updated_at.is_some_and(|t| t >= since) {
                    self.sync_reviews(org, repo, pr.number).await?;
                }
            }

            if !keep_fetching {
                break;
            }
            if let Some(next) = next_page {
                self.check_limits().await?;
                page = self.gh.get_page(&Some(next)).await?.unwrap();
            } else {
                break;
            }
        }
        Ok(())
    }

    async fn sync_reviews(&self, org: &str, repo: &str, pr_number: u64) -> Result<()> {
        let mut page = self
            .gh
            .pulls(org, repo)
            .list_reviews(pr_number)
            .per_page(100)
            .send()
            .await?;
        loop {
            let next_page = page.next;
            for review in page.items {
                let json = serde_json::to_string(&review)?;
                let review_id = review.id.0 as i64;
                let pr_num = pr_number as i64;
                let state_str = review.state.map_or_else(
                    || "UNKNOWN".to_string(),
                    |s| format!("{:?}", s).to_uppercase(),
                );

                self.db.execute(
                    "INSERT OR REPLACE INTO pr_reviews (id, repo, pr_number, state, author, submitted_at, data)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    params![
                        review_id, repo, pr_num, state_str,
                        review.user.as_ref().map(|u| u.login.clone()).unwrap_or_default(),
                        review.submitted_at.map(|t| t.to_rfc3339()).unwrap_or_default(),
                        json
                    ],
                )?;
            }
            if let Some(next) = next_page {
                self.check_limits().await?;
                page = self.gh.get_page(&Some(next)).await?.unwrap();
            } else {
                break;
            }
        }
        Ok(())
    }

    async fn sync_issues(&self, org: &str, repo: &str, since: DateTime<Utc>) -> Result<()> {
        self.check_limits().await?;
        let route = format!("/repos/{}/{}/issues", org, repo);

        // GitHub's /issues endpoint rejects very old "since" dates (returns 0 items).
        // This appears to work for our use case.
        let use_since_filter = since.year() >= 2010;

        let mut page: octocrab::Page<Value> = if use_since_filter {
            self.gh.get(&route, Some(&serde_json::json!({
                "state": "all", "sort": "updated", "direction": "desc", "since": since.to_rfc3339(), "per_page": 100
            }))).await?
        } else {
            // First sync: don't pass since parameter to avoid GitHub API bug
            self.gh
                .get(
                    &route,
                    Some(&serde_json::json!({
                        "state": "all", "sort": "updated", "direction": "desc", "per_page": 100
                    })),
                )
                .await?
        };

        let mut keep_fetching = true;
        loop {
            let next_page = page.next.clone();
            for issue in page.items {
                let updated_at_str = issue
                    .get("updated_at")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let updated_at = DateTime::parse_from_rfc3339(updated_at_str)
                    .map_or_else(|_| Utc::now(), |dt| dt.with_timezone(&Utc));

                if updated_at < since {
                    keep_fetching = false;
                    break;
                }
                if issue.get("pull_request").is_some() {
                    continue;
                }

                let json = serde_json::to_string(&issue)?;
                let id = issue.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
                let number = issue.get("number").and_then(|v| v.as_i64()).unwrap_or(0);
                let state = issue
                    .get("state")
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown");
                let author = issue
                    .get("user")
                    .and_then(|u| u.get("login"))
                    .and_then(|l| l.as_str())
                    .unwrap_or("unknown");
                let title = issue.get("title").and_then(|v| v.as_str()).unwrap_or("");
                let created = issue
                    .get("created_at")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let closed = issue.get("closed_at").and_then(|v| v.as_str());

                self.db.execute(
                    "INSERT OR REPLACE INTO issues 
                    (id, repo, number, state, author, title, created_at, updated_at, closed_at, data) 
                    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                    params![id, repo, number, state, author, title, created, updated_at_str, closed, json],
                )?;
            }
            if !keep_fetching {
                break;
            }
            if let Some(next) = next_page {
                self.check_limits().await?;
                page = self.gh.get_page(&Some(next)).await?.unwrap();
            } else {
                break;
            }
        }
        Ok(())
    }

    async fn sync_issue_comments(&self, org: &str, repo: &str, since: DateTime<Utc>) -> Result<()> {
        self.check_limits().await?;
        let route = format!("/repos/{}/{}/issues/comments", org, repo);
        let mut page: octocrab::Page<Value> = self.gh.get(&route, Some(&serde_json::json!({
                "sort": "updated", "direction": "desc", "since": since.to_rfc3339(), "per_page": 100
            }))).await?;

        let mut keep_fetching = true;
        loop {
            let next_page = page.next.clone();
            for comment in page.items {
                let updated_at_str = comment
                    .get("updated_at")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let updated_at = DateTime::parse_from_rfc3339(updated_at_str)
                    .map_or_else(|_| Utc::now(), |dt| dt.with_timezone(&Utc));

                if updated_at < since {
                    keep_fetching = false;
                    break;
                }
                let issue_url = comment
                    .get("issue_url")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let issue_number: i64 = issue_url
                    .split('/')
                    .next_back()
                    .unwrap_or("0")
                    .parse()
                    .unwrap_or(0);
                let id = comment.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
                let author = comment
                    .get("user")
                    .and_then(|u| u.get("login"))
                    .and_then(|l| l.as_str())
                    .unwrap_or("unknown");
                let created = comment
                    .get("created_at")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let json = serde_json::to_string(&comment)?;

                self.db.execute(
                    "INSERT OR REPLACE INTO issue_comments (id, repo, issue_number, author, created_at, updated_at, data)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    params![id, repo, issue_number, author, created, updated_at_str, json],
                )?;
            }
            if !keep_fetching {
                break;
            }
            if let Some(next) = next_page {
                self.check_limits().await?;
                page = self.gh.get_page(&Some(next)).await?.unwrap();
            } else {
                break;
            }
        }
        Ok(())
    }

    async fn sync_pr_comments(&self, org: &str, repo: &str, since: DateTime<Utc>) -> Result<()> {
        self.check_limits().await?;
        let route = format!("/repos/{}/{}/pulls/comments", org, repo);
        let mut page: octocrab::Page<Value> = self.gh.get(&route, Some(&serde_json::json!({
                "sort": "updated", "direction": "desc", "since": since.to_rfc3339(), "per_page": 100
            }))).await?;

        let mut keep_fetching = true;
        loop {
            let next_page = page.next.clone();
            for comment in page.items {
                let updated_at_str = comment
                    .get("updated_at")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let updated_at = DateTime::parse_from_rfc3339(updated_at_str)
                    .map_or_else(|_| Utc::now(), |dt| dt.with_timezone(&Utc));

                if updated_at < since {
                    keep_fetching = false;
                    break;
                }
                let pull_url = comment
                    .get("pull_request_url")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let pr_number: i64 = pull_url
                    .split('/')
                    .next_back()
                    .unwrap_or("0")
                    .parse()
                    .unwrap_or(0);
                let id = comment.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
                let author = comment
                    .get("user")
                    .and_then(|u| u.get("login"))
                    .and_then(|l| l.as_str())
                    .unwrap_or("unknown");
                let created = comment
                    .get("created_at")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let json = serde_json::to_string(&comment)?;

                self.db.execute(
                    "INSERT OR REPLACE INTO pr_review_comments (id, repo, pr_number, author, created_at, updated_at, data)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    params![id, repo, pr_number, author, created, updated_at_str, json],
                )?;
            }
            if !keep_fetching {
                break;
            }
            if let Some(next) = next_page {
                self.check_limits().await?;
                page = self.gh.get_page(&Some(next)).await?.unwrap();
            } else {
                break;
            }
        }
        Ok(())
    }

    fn is_missing_resource(err: &octocrab::Error) -> bool {
        match err {
            octocrab::Error::GitHub { source, .. } => {
                source.status_code == StatusCode::NOT_FOUND
                    || source.status_code == StatusCode::GONE
                    || source.message.eq_ignore_ascii_case("Not Found")
                    || source.message.eq_ignore_ascii_case("Not Found.")
            }
            _ => false,
        }
    }
}
