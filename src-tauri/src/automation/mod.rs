use std::collections::HashSet;

use serde_json::Value;

use crate::{
    error::{AppError, AppResult},
    lcu::{LcuService, LcuSnapshot, ReadOperation},
};

pub fn validate_hovercard(queue: &str, tier: &str) -> AppResult<()> {
    if ![
        "RANKED_SOLO_5x5",
        "RANKED_FLEX_SR",
        "RANKED_FLEX_TT",
        "RANKED_TFT",
        "RANKED_TFT_DOUBLE_UP",
        "RANKED_TFT_TURBO",
    ]
    .contains(&queue)
        || ![
            "Iron",
            "Bronze",
            "Silver",
            "Gold",
            "Platinum",
            "Diamond",
            "Emerald",
            "Master",
            "Grandmaster",
            "Challenger",
        ]
        .contains(&tier)
    {
        return Err(AppError::new(
            "InvalidInput",
            "Unsupported hovercard queue or tier",
        ));
    }
    Ok(())
}

pub fn bench_candidates(snapshot: &LcuSnapshot) -> Vec<u32> {
    if snapshot.phase != "ChampSelect" || snapshot.champ_select["benchEnabled"] != true {
        return Vec::new();
    }
    let Some(bench) = snapshot.champ_select["benchChampions"].as_array() else {
        return Vec::new();
    };
    snapshot
        .aram_preferences
        .iter()
        .copied()
        .filter(|id| {
            bench
                .iter()
                .any(|champion| champion["championId"].as_u64() == Some(*id as u64))
        })
        .collect()
}

pub(crate) fn value_text(value: &Value) -> String {
    match value {
        Value::String(value) => value.clone(),
        Value::Number(value) => value.to_string(),
        _ => String::new(),
    }
}

pub async fn ranked_summary(
    service: &LcuService,
    snapshot: &LcuSnapshot,
    settings: &Value,
) -> AppResult<String> {
    let team = snapshot.champ_select["myTeam"]
        .as_array()
        .ok_or_else(|| AppError::new("InvalidInput", "Team information is unavailable"))?;
    if team.is_empty()
        || team.iter().any(|member| {
            let id = value_text(&member["summonerId"]);
            id.is_empty() || id == "0"
        })
    {
        return Err(AppError::new(
            "NotReady",
            "Team player identities are not ready",
        ));
    }
    let english = settings["language"] == "en";
    let mode = settings["showTeammateRankedType"]
        .as_str()
        .unwrap_or("RANKED_BOTH");
    let mut queues = Vec::new();
    if mode != "RANKED_FLEX_SR" {
        queues.push(("RANKED_SOLO_5x5", if english { "Solo/Duo" } else { "單雙" }));
    }
    if mode != "RANKED_SOLO_5x5" {
        queues.push(("RANKED_FLEX_SR", if english { "Flex" } else { "彈性" }));
    }
    let mut players = Vec::new();
    for member in team {
        let id = value_text(&member["summonerId"]);
        if id.is_empty() || id == "0" {
            continue;
        }
        let summoners = service.query(ReadOperation::SummonersById(id)).await?;
        let summoner = summoners
            .as_array()
            .and_then(|v| v.first())
            .ok_or_else(|| AppError::new("InvalidInput", "Player details are unavailable"))?;
        let puuid = summoner["puuid"]
            .as_str()
            .ok_or_else(|| AppError::new("InvalidInput", "Player identifier is unavailable"))?;
        let ranked = service
            .query(ReadOperation::RankedByPuuid(puuid.into()))
            .await?;
        players.push((summoner.clone(), ranked));
    }
    let mut lines = Vec::new();
    for (queue_type, label) in queues {
        lines.push(label.to_owned());
        for (summoner, ranked) in &players {
            if let Some(queue) = ranked["queues"]
                .as_array()
                .and_then(|queues| queues.iter().find(|queue| queue["queueType"] == queue_type))
            {
                lines.push(format!(
                    "{} {} {} {} {} wins:{}",
                    summoner["gameName"]
                        .as_str()
                        .or_else(|| summoner["displayName"].as_str())
                        .unwrap_or("?"),
                    value_text(&queue["tier"]),
                    value_text(&queue["division"]),
                    value_text(&queue["leaguePoints"]),
                    value_text(&queue["miniSeriesProgress"]),
                    value_text(&queue["wins"])
                ));
            }
        }
    }
    Ok(lines.join("\n").trim().into())
}

pub async fn recent_summary(
    service: &LcuService,
    snapshot: &LcuSnapshot,
    settings: &Value,
) -> AppResult<String> {
    if !snapshot.lobby_members["players"].is_object() {
        return Err(AppError::new("Unsupported", "Lobby membership is unknown"));
    }
    if !snapshot.champ_select["myTeam"]
        .as_array()
        .is_some_and(|team| !team.is_empty())
    {
        return Err(AppError::new(
            "NotReady",
            "Team player identities are not ready",
        ));
    }
    if recent_teammates(snapshot).is_empty() {
        return Ok(String::new());
    }
    let count = settings["recentTeammateCheckGameCount"]
        .as_u64()
        .unwrap_or(20)
        .clamp(1, 100) as u32;
    let (games, champions) = service.recent_games(snapshot, count).await?;
    Ok(format_recent_summary(snapshot, &games, &champions))
}

// Champion-select summaries skip concealed identities. In-game encounters use
// the gameflow roster and can resolve these players after selection ends.
fn recent_teammates(snapshot: &LcuSnapshot) -> Vec<&str> {
    let owner = snapshot.current_summoner["puuid"].as_str().unwrap_or("");
    snapshot.champ_select["myTeam"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|player| {
            player["nameVisibilityType"] != "HIDDEN"
                && player["isNameObfuscated"] != true
                && player["nameHidden"] != true
        })
        .filter_map(|player| player["puuid"].as_str())
        .filter(|id| {
            !id.is_empty()
                && *id != "00000000-0000-0000-0000-000000000000"
                && *id != owner
                && snapshot.lobby_members["players"].get(*id).is_none()
        })
        .collect()
}

pub fn filter_recent_players(snapshot: &LcuSnapshot, games: &[Value]) -> Vec<Value> {
    let owner = snapshot.current_summoner["puuid"].as_str().unwrap_or("");
    let lobby: HashSet<&str> = snapshot.lobby_members["players"]
        .as_object()
        .map(|players| players.keys().map(String::as_str).collect())
        .unwrap_or_default();
    let team = recent_teammates(snapshot);
    let mut result = Vec::new();
    for (index, wrapper) in games.iter().enumerate() {
        let data = &wrapper["data"];
        let Some(identities) = data["participantIdentities"].as_array() else {
            continue;
        };
        let Some(participants) = data["participants"].as_array() else {
            continue;
        };
        let matched = identities.iter().any(|identity| {
            identity["player"]["puuid"]
                .as_str()
                .is_some_and(|id| team.contains(&id))
                && participants
                    .iter()
                    .any(|participant| participant["participantId"] == identity["participantId"])
        });
        if !matched {
            continue;
        }
        let mut selected = Vec::new();
        let mut seen = HashSet::new();
        for id in team
            .iter()
            .copied()
            .chain(lobby.iter().copied().filter(|id| *id != owner))
            .chain(std::iter::once(owner))
        {
            if id.is_empty() || !seen.insert(id) {
                continue;
            }
            let Some(identity) = identities
                .iter()
                .find(|identity| identity["player"]["puuid"].as_str() == Some(id))
            else {
                continue;
            };
            if let Some(participant) = participants
                .iter()
                .find(|p| p["participantId"] == identity["participantId"])
            {
                let mut participant = participant.clone();
                participant["player"] = identity["player"].clone();
                selected.push(participant);
            }
        }
        let mut game = data.clone();
        game["participants"] = Value::Array(selected);
        if let Some(object) = game.as_object_mut() {
            object.remove("participantIdentities");
        }
        game["gameIndex"] = Value::from(index);
        result.push(game);
    }
    result
}

pub fn format_recent_summary(snapshot: &LcuSnapshot, games: &[Value], champions: &Value) -> String {
    let mut lines = Vec::new();
    for game in filter_recent_players(snapshot, games) {
        // Keep the server's explicit timestamp, avoiding locale-dependent ambiguous dates.
        lines.push(format!(
            "Game {} {}",
            game["gameIndex"].as_u64().unwrap_or(0) + 1,
            value_text(&game["gameCreationDate"]).replace('/', "|")
        ));
        for participant in game["participants"].as_array().into_iter().flatten() {
            let champion_id = value_text(&participant["championId"]);
            let name = champions
                .as_array()
                .into_iter()
                .flatten()
                .find(|c| value_text(&c["key"]) == champion_id)
                .and_then(|c| c["name"].as_str())
                .unwrap_or(&champion_id);
            let stats = &participant["stats"];
            lines.push(format!(
                "{} {} {}|{}|{} Dmg:{} {}",
                participant["player"]["gameName"].as_str().unwrap_or(""),
                name,
                value_text(&stats["kills"]),
                value_text(&stats["deaths"]),
                value_text(&stats["assists"]),
                value_text(&stats["totalDamageDealtToChampions"]),
                if stats["win"] == true { "Win" } else { "Lose" }
            ));
        }
    }
    lines.join("\n").trim().into()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn bench_obeys_priority_and_requires_active_bench() {
        let mut snapshot = LcuSnapshot {
            phase: "ChampSelect".into(),
            aram_preferences: vec![3, 2, 1],
            champ_select: json!({"benchEnabled":true,"benchChampions":[{"championId":1},{"championId":2}]}),
            ..Default::default()
        };
        assert_eq!(bench_candidates(&snapshot).first().copied(), Some(2));
        snapshot.phase = "InProgress".into();
        assert_eq!(bench_candidates(&snapshot).first().copied(), None);
        snapshot.phase = "ChampSelect".into();
        snapshot.champ_select["benchEnabled"] = Value::Bool(false);
        assert_eq!(bench_candidates(&snapshot).first().copied(), None);
    }
    #[test]
    fn rejects_arbitrary_hovercard_values() {
        assert!(validate_hovercard("RANKED_SOLO_5x5", "Challenger").is_ok());
        assert!(validate_hovercard("../other", "Challenger").is_err());
        assert!(validate_hovercard("RANKED_SOLO_5x5", "invented").is_err());
    }
    #[test]
    fn recent_players_is_separate_from_current_premade_grouping() {
        let snapshot = LcuSnapshot {
            current_summoner: json!({"puuid":"owner"}),
            lobby_members: json!({"players":{"friend":{}}}),
            champ_select: json!({"myTeam":[{"puuid":"owner"},{"puuid":"friend"},{"puuid":"other"},{"teamParticipantId":1}]}),
            ..Default::default()
        };
        let game = json!({"data":{"gameCreationDate":"2026-01-01T00:00:00Z","participantIdentities":[
            {"participantId":1,"player":{"puuid":"owner"}},{"participantId":2,"player":{"puuid":"friend"}},{"participantId":3,"player":{"puuid":"other"}}],
            "participants":[{"participantId":1},{"participantId":2},{"participantId":3}]}});
        let results = filter_recent_players(&snapshot, std::slice::from_ref(&game));
        assert_eq!(results.len(), 1);
        assert_eq!(results[0]["participants"].as_array().unwrap().len(), 3);
        let mut no_other = game;
        no_other["data"]["participantIdentities"]
            .as_array_mut()
            .unwrap()
            .pop();
        assert!(filter_recent_players(&snapshot, &[no_other]).is_empty());
    }
    #[test]
    fn recent_summary_matches_visible_players_but_skips_hidden_champ_select_players() {
        let snapshot = LcuSnapshot {
            champ_select: json!({"myTeam":[{"puuid":"visible"}, {},
                {"puuid":"hidden","nameVisibilityType":"HIDDEN"}]}),
            ..Default::default()
        };
        let game = |id: &str| {
            json!({"data":{"participantIdentities":[
            {"participantId":1,"player":{"puuid":id}}],"participants":[{"participantId":1}]}})
        };
        assert_eq!(
            filter_recent_players(&snapshot, &[game("visible")]).len(),
            1
        );
        assert!(filter_recent_players(&snapshot, &[game("hidden")]).is_empty());
    }

    #[test]
    fn unknown_players_do_not_match_missing_historical_identities() {
        let snapshot = LcuSnapshot {
            champ_select: json!({"myTeam":[{}, {"puuid":""}]}),
            ..Default::default()
        };
        let games = vec![
            json!({"data":{"participantIdentities":[{"participantId":1,"player":{}}],"participants":[{"participantId":1}]}}),
        ];
        assert!(filter_recent_players(&snapshot, &games).is_empty());
    }
}
