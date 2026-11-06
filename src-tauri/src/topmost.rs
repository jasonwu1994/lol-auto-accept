use serde_json::Value;

#[derive(Default)]
pub struct TopmostPolicy {
    aram_selection: bool,
    pub applied: Option<bool>,
}

impl TopmostPolicy {
    pub fn observe(&mut self, snapshot: &Value) {
        let game = &snapshot["gameflowSession"];
        let selection = &snapshot["champSelectSession"];
        let mode_matches = [
            game.pointer("/gameData/queue/gameMode"),
            game.pointer("/gameData/gameMode"),
            game.pointer("/map/gameMode"),
            selection.get("gameMode"),
        ]
        .iter()
        .flatten()
        .any(|value| {
            value
                .as_str()
                .is_some_and(|mode| matches!(mode, "ARAM" | "KIWI"))
        });
        let queue_matches = [game.pointer("/gameData/queue/id"), selection.get("queueId")]
            .iter()
            .flatten()
            .any(|value| matches!(value.as_u64(), Some(450 | 2400)));
        let map_matches = [
            game.pointer("/map/id"),
            game.pointer("/gameData/queue/mapId"),
            selection.get("mapId"),
        ]
        .iter()
        .flatten()
        .any(|value| value.as_u64() == Some(12));
        self.aram_selection = snapshot["connection"] == "Connected"
            && snapshot["phase"] == "ChampSelect"
            && (mode_matches || queue_matches || map_matches);
    }
    pub fn desired(&self, manual: bool, enabled: bool, visible: bool, minimized: bool) -> bool {
        manual || (enabled && self.aram_selection && visible && !minimized)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn snapshot(phase: &str, game: Value) -> Value {
        json!({"connection":"Connected","phase":phase,"gameflowSession":game})
    }
    #[test]
    fn aram_and_mayhem_are_topmost_only_during_selection() {
        let mut policy = TopmostPolicy::default();
        for game in [
            json!({"gameData":{"queue":{"id":450,"gameMode":"ARAM"}}}),
            json!({"gameData":{"queue":{"id":2400,"gameMode":"KIWI"}}}),
            json!({"map":{"id":12}}),
        ] {
            policy.observe(&snapshot("ChampSelect", game.clone()));
            assert!(policy.desired(false, true, true, false));
            for phase in [
                "None",
                "Lobby",
                "ReadyCheck",
                "GameStart",
                "InProgress",
                "PreEndOfGame",
                "EndOfGame",
            ] {
                policy.observe(&snapshot(phase, game.clone()));
                assert!(!policy.desired(false, true, true, false));
            }
        }
    }
    #[test]
    fn hidden_minimized_disabled_and_other_modes_do_not_get_automatic_topmost() {
        let mut policy = TopmostPolicy::default();
        policy.observe(&snapshot(
            "ChampSelect",
            json!({"gameData":{"queue":{"id":450}}}),
        ));
        assert!(!policy.desired(false, true, false, false));
        assert!(!policy.desired(false, true, true, true));
        assert!(!policy.desired(false, false, true, false));
        policy.observe(&snapshot(
            "ChampSelect",
            json!({"map":{"id":11},"gameData":{"queue":{"id":420,"gameMode":"CLASSIC"}}}),
        ));
        assert!(!policy.desired(false, true, true, false));
        policy.observe(&json!({"connection":"Disconnected","phase":"ChampSelect","gameflowSession":{"map":{"id":12}}}));
        assert!(!policy.desired(false, true, true, false));
    }
    #[test]
    fn automatic_transitions_release_the_window_and_preserve_manual_topmost() {
        let mut policy = TopmostPolicy::default();
        let select = snapshot("ChampSelect", json!({"gameData":{"queue":{"id":2400}}}));
        policy.observe(&select);
        assert!(policy.desired(false, true, true, false));
        assert!(!policy.desired(false, true, false, false));
        assert!(policy.desired(false, true, true, false));
        policy.observe(&snapshot(
            "GameStart",
            json!({"gameData":{"queue":{"id":2400}}}),
        ));
        assert!(!policy.desired(false, true, true, false));
        assert!(policy.desired(true, true, true, false));
    }
}
