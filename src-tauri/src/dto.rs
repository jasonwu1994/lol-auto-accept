use serde_json::Value;
pub fn public_value(mut value: Value) -> Value {
    fn visit(value: &mut Value) {
        match value {
            Value::Object(object) => {
                for (key, value) in object {
                    if matches!(key.as_str(), "gameId" | "summonerId" | "accountId")
                        && value.is_number()
                    {
                        *value = Value::String(value.to_string());
                    } else {
                        visit(value);
                    }
                }
            }
            Value::Array(values) => values.iter_mut().for_each(visit),
            _ => {}
        }
    }
    visit(&mut value);
    value
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn identifiers_preserve_all_u64_bits_but_champion_and_group_ids_remain_numeric() {
        let value: Value = serde_json::from_str(r#"{"gameId":18446744073709551615,"players":[{"summonerId":9007199254740993,"championId":1,"teamParticipantId":2}]}"#).unwrap();
        let value = public_value(value);
        assert_eq!(value["gameId"], "18446744073709551615");
        assert_eq!(value["players"][0]["summonerId"], "9007199254740993");
        assert_eq!(value["players"][0]["championId"], 1);
        assert_eq!(value["players"][0]["teamParticipantId"], 2);
    }
}
