use crate::error::{AppError, AppResult};
use serde_json::Value;

pub async fn read() -> AppResult<Value> {
    let unavailable = || AppError::new("Unavailable", "Online count unavailable");
    let endpoint = option_env!("LOL_ONLINE_COUNT_URL")
        .unwrap_or("https://lol-online-count.csie.cc/api/online");
    let url = reqwest::Url::parse(endpoint).map_err(|_| unavailable())?;
    if url.scheme() != "https" || !url.username().is_empty() || url.password().is_some() {
        return Err(unavailable());
    }
    let client = reqwest::Client::builder()
        .user_agent(concat!("LoLAutoAccept/", env!("CARGO_PKG_VERSION")))
        .timeout(std::time::Duration::from_secs(3))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| unavailable())?;
    let mut response = client.get(url).send().await.map_err(|_| unavailable())?;
    if !response.status().is_success() {
        return Err(unavailable());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| unavailable())? {
        if bytes.len() + chunk.len() > 4096 {
            return Err(unavailable());
        }
        bytes.extend_from_slice(&chunk);
    }
    let value: Value = serde_json::from_slice(&bytes).map_err(|_| unavailable())?;
    normalize(value)
}

fn normalize(value: Value) -> AppResult<Value> {
    let unavailable = || AppError::new("Unavailable", "Online count unavailable");
    if value.get("schemaVersion").is_some_and(|v| v != 1)
        || value.get("available").is_some_and(|v| v != true)
        || value["activeUsers"].as_u64().is_none()
        || value["windowMinutes"] != 5
        || !value["updatedAt"].is_string()
    {
        return Err(unavailable());
    }
    Ok(
        serde_json::json!({"activeUsers":value["activeUsers"],"windowMinutes":5,"updatedAt":value["updatedAt"]}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn accepts_legacy_and_additive_v1_but_rejects_unsupported_or_unavailable() {
        let base = json!({"activeUsers":0,"windowMinutes":5,"updatedAt":"2026-11-06T06:00:00Z"});
        assert!(normalize(base.clone()).is_ok());
        let mut versioned = base.clone();
        versioned["schemaVersion"] = json!(1);
        versioned["available"] = json!(true);
        versioned["futureField"] = json!("ignored");
        assert_eq!(normalize(versioned.clone()).unwrap(), base);
        versioned["schemaVersion"] = json!(2);
        assert!(normalize(versioned).is_err());
        for (key, value) in [
            ("available", json!(false)),
            ("activeUsers", json!(-1)),
            ("activeUsers", json!(1.5)),
            ("windowMinutes", json!(30)),
            ("updatedAt", json!(null)),
        ] {
            let mut invalid = base.clone();
            invalid[key] = value;
            assert!(normalize(invalid).is_err());
        }
    }
}
