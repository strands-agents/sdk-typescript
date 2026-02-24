use anyhow::Result;
use chrono::{DateTime, Duration, Utc};
use rusqlite::{Connection, params};

pub fn compute_metrics(conn: &Connection) -> Result<()> {
    // Smart detect of dirty window
    let last_metric_date: Option<String> = conn
        .query_row("SELECT max(date) FROM daily_metrics", [], |row| row.get(0))
        .ok();

    let start_date = match last_metric_date {
        Some(d) => DateTime::parse_from_str(&d, "%Y-%m-%d").map_or_else(
            |_| Utc::now(),
            |dt| dt.with_timezone(&Utc) - Duration::days(3),
        ),
        None => DateTime::parse_from_rfc3339("2010-01-01T00:00:00Z")
            .unwrap()
            .with_timezone(&Utc),
    };

    let start_date_str = start_date.format("%Y-%m-%d").to_string();

    // Clear out the dirty window so we can recompute
    conn.execute(
        "DELETE FROM daily_metrics WHERE date >= ?1",
        params![start_date_str],
    )?;

    // PERFORMANCE OPTIMIZATION: Calculate response times ONCE in a temp table
    // Calculating this inside the daily loop was O(N^2) and incredibly slow.
    conn.execute(
        "CREATE TEMP TABLE IF NOT EXISTS temp_response_times AS
         SELECT 
            parent.repo,
            date(parent.created_at) as created_date,
            (julianday(MIN(activity.activity_at)) - julianday(parent.created_at)) * 24 as hours_to_response
         FROM (
            SELECT id, repo, number, author, created_at FROM issues
            UNION ALL
            SELECT id, repo, number, author, created_at FROM pull_requests
         ) as parent
         JOIN (
            SELECT repo, issue_number as ref_number, author, created_at as activity_at FROM issue_comments
            UNION ALL
            SELECT repo, pr_number as ref_number, author, submitted_at as activity_at FROM pr_reviews
            UNION ALL
            SELECT repo, pr_number as ref_number, author, created_at as activity_at FROM pr_review_comments
         ) as activity 
         ON parent.repo = activity.repo 
            AND parent.number = activity.ref_number 
            AND activity.activity_at > parent.created_at
            AND activity.author != parent.author
         GROUP BY parent.repo, parent.number",
        [],
    )?;

    let now = Utc::now();
    let num_days = (now - start_date).num_days();

    for i in 0..=num_days {
        let date = start_date + Duration::days(i);
        let date_str = date.format("%Y-%m-%d").to_string();

        conn.execute(
            "INSERT OR IGNORE INTO daily_metrics (date, repo)
             SELECT DISTINCT ?1, repo FROM (
                 SELECT repo FROM pull_requests
                 UNION SELECT repo FROM issues
                 UNION SELECT repo FROM stargazers
                 UNION SELECT repo FROM commits
             )",
            params![date_str],
        )?;

        conn.execute(
            "UPDATE daily_metrics 
             SET prs_opened = (SELECT count(*) FROM pull_requests WHERE repo = daily_metrics.repo AND date(created_at) = date(daily_metrics.date)),
                 prs_merged = (SELECT count(*) FROM pull_requests WHERE repo = daily_metrics.repo AND merged_at IS NOT NULL AND date(merged_at) = date(daily_metrics.date)),
                 issues_opened = (SELECT count(*) FROM issues WHERE repo = daily_metrics.repo AND date(created_at) = date(daily_metrics.date)),
                 issues_closed = (SELECT count(*) FROM issues WHERE repo = daily_metrics.repo AND closed_at IS NOT NULL AND date(closed_at) = date(daily_metrics.date))
             WHERE date = ?1",
            params![date_str],
        )?;

        conn.execute(
            "UPDATE daily_metrics 
             SET churn_additions = (SELECT COALESCE(SUM(additions), 0) FROM commits WHERE repo = daily_metrics.repo AND date(date) = date(daily_metrics.date)),
                 churn_deletions = (SELECT COALESCE(SUM(deletions), 0) FROM commits WHERE repo = daily_metrics.repo AND date(date) = date(daily_metrics.date))
             WHERE date = ?1",
            params![date_str],
        )?;

        conn.execute(
            "UPDATE daily_metrics
             SET ci_failures = (SELECT count(*) FROM workflow_runs WHERE repo = daily_metrics.repo AND conclusion = 'failure' AND date(created_at) = date(daily_metrics.date)),
                 ci_runs = (SELECT count(*) FROM workflow_runs WHERE repo = daily_metrics.repo AND date(created_at) = date(daily_metrics.date))
             WHERE date = ?1",
            params![date_str],
        )?;

        conn.execute(
            "UPDATE daily_metrics
             SET stars = (
                 SELECT count(*) FROM stargazers
                 WHERE repo = daily_metrics.repo AND date(starred_at) <= date(daily_metrics.date)
             )
             WHERE date = ?1",
            params![date_str],
        )?;

        // Open items snapshot (combined issues + PRs for backward compatibility)
        conn.execute(
            "UPDATE daily_metrics
             SET open_items_count = (
                 (SELECT count(*) FROM issues WHERE repo = daily_metrics.repo AND date(created_at) <= date(daily_metrics.date) AND (closed_at IS NULL OR date(closed_at) > date(daily_metrics.date)))
                 +
                 (SELECT count(*) FROM pull_requests WHERE repo = daily_metrics.repo AND date(created_at) <= date(daily_metrics.date) AND (closed_at IS NULL OR date(closed_at) > date(daily_metrics.date)))
             )
             WHERE date = ?1",
            params![date_str]
        )?;

        // Open issues count (just issues, no PRs)
        conn.execute(
            "UPDATE daily_metrics
             SET open_issues_count = (
                 SELECT count(*) FROM issues WHERE repo = daily_metrics.repo AND date(created_at) <= date(daily_metrics.date) AND (closed_at IS NULL OR date(closed_at) > date(daily_metrics.date))
             )
             WHERE date = ?1",
            params![date_str]
        )?;

        // Open PRs count
        conn.execute(
            "UPDATE daily_metrics
             SET open_prs_count = (
                 SELECT count(*) FROM pull_requests WHERE repo = daily_metrics.repo AND date(created_at) <= date(daily_metrics.date) AND (closed_at IS NULL OR date(closed_at) > date(daily_metrics.date))
             )
             WHERE date = ?1",
            params![date_str]
        )?;

        // Response time stats - Optimized to use Temp Table
        conn.execute(
            "UPDATE daily_metrics
             SET time_to_first_response = (
                SELECT AVG(hours_to_response)
                FROM temp_response_times
                WHERE repo = daily_metrics.repo 
                  AND created_date = date(daily_metrics.date)
             )
             WHERE date = ?1",
            params![date_str],
        )?;

        conn.execute(
            "UPDATE daily_metrics
             SET avg_issue_resolution_time = (
                 SELECT AVG((julianday(closed_at) - julianday(created_at)) * 24)
                 FROM issues
                 WHERE repo = daily_metrics.repo
                   AND closed_at IS NOT NULL
                   AND date(closed_at) = date(daily_metrics.date)
             )
             WHERE date = ?1",
            params![date_str],
        )?;

        conn.execute(
            "UPDATE daily_metrics
             SET avg_pr_resolution_time = (
                 SELECT AVG((julianday(COALESCE(merged_at, closed_at)) - julianday(created_at)) * 24)
                 FROM pull_requests
                 WHERE repo = daily_metrics.repo
                   AND (merged_at IS NOT NULL OR closed_at IS NOT NULL)
                   AND date(COALESCE(merged_at, closed_at)) = date(daily_metrics.date)
             )
             WHERE date = ?1",
             params![date_str],
        )?;

        // Internal vs external merge times
        conn.execute(
             "UPDATE daily_metrics
              SET time_to_merge_internal = (
                 SELECT AVG((julianday(merged_at) - julianday(created_at)) * 24)
                 FROM pull_requests
                 WHERE repo = daily_metrics.repo
                   AND merged_at IS NOT NULL
                   AND date(merged_at) = date(daily_metrics.date)
                   AND json_extract(data, '$.author_association') IN ('OWNER', 'MEMBER', 'COLLABORATOR')
              )
              WHERE date = ?1",
             params![date_str],
        )?;

        conn.execute(
             "UPDATE daily_metrics
              SET time_to_merge_external = (
                 SELECT AVG((julianday(merged_at) - julianday(created_at)) * 24)
                 FROM pull_requests
                 WHERE repo = daily_metrics.repo
                   AND merged_at IS NOT NULL
                   AND date(merged_at) = date(daily_metrics.date)
                   AND json_extract(data, '$.author_association') NOT IN ('OWNER', 'MEMBER', 'COLLABORATOR')
              )
              WHERE date = ?1",
             params![date_str],
        )?;
    }

    // Cleanup temp table
    conn.execute("DROP TABLE IF EXISTS temp_response_times", [])?;

    Ok(())
}
