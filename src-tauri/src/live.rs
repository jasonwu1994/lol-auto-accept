use crate::error::{AppError, AppResult};
use serde_json::{Value, json};

fn players(data: &Value) -> AppResult<Value> {
    let all = data["allPlayers"].as_array().ok_or_else(unavailable)?;
    Ok(Value::Array(all.iter().take(20).map(|player| {
        let riot_name = player["riotIdGameName"].as_str().unwrap_or("");
        let hidden = player["riotId"].as_str().is_some_and(|id| id.split('#').next().unwrap_or("").trim().is_empty())
            && riot_name.trim().is_empty();
        json!({
            "championKey": player["rawChampionName"].as_str().unwrap_or("").strip_prefix("game_character_displayname_").unwrap_or(""),
            "team": player["team"].as_str().unwrap_or(""),
            "nameHidden": hidden
        })
    }).collect()))
}

fn unavailable() -> AppError {
    AppError::new("Unavailable", "Live player data is unavailable")
}

pub async fn read_players() -> AppResult<Value> {
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .tls_danger_accept_invalid_certs(true)
        .timeout(std::time::Duration::from_secs(2))
        .build()
        .map_err(|_| unavailable())?;
    // This fixed loopback endpoint carries no LCU credentials.
    let mut response = client
        .get("https://127.0.0.1:2999/liveclientdata/allgamedata")
        .send()
        .await
        .map_err(|_| unavailable())?;
    if !response.status().is_success() {
        return Err(unavailable());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| unavailable())? {
        if bytes.len() + chunk.len() > 4 * 1024 * 1024 {
            return Err(unavailable());
        }
        bytes.extend_from_slice(&chunk);
    }
    players(&serde_json::from_slice(&bytes).map_err(|_| unavailable())?)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn exposes_only_champion_team_and_name_visibility() {
        let result = players(&json!({"allPlayers":[
            {"rawChampionName":"game_character_displayname_Syndra","team":"CHAOS","riotId":"#","riotIdGameName":"","items":[1]},
            {"rawChampionName":"game_character_displayname_Leona","team":"ORDER","riotId":"Visible#TAG","riotIdGameName":"Visible"}
        ]})).unwrap();
        assert_eq!(
            result[0],
            json!({"championKey":"Syndra","team":"CHAOS","nameHidden":true})
        );
        assert_eq!(result[1]["nameHidden"], false);
        assert!(players(&json!({})).is_err());
    }
}
