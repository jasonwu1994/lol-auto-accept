//! SGP (the League Client's own backend gateway) match-history reads, as upstream
//! Akari does: the summary list carries `challenges` (solo kills, knock-ups...) and
//! supports server-side queue tags, which the LCU list does not.
//!
//! The base URL comes only from the built-in table below, keyed by the server ID the
//! backend derives from the connected client; the frontend never supplies a host.
//! The bearer token is the client's entitlements access token (match history) or its
//! league-session token (the challenges collection counts), read from the LCU per
//! request, sent only to that table's host and never returned to the page.

use crate::error::{AppError, AppResult};

/// Upstream `BUILTIN_SGP_LEAGUE_SERVERS_CONFIG` (2026-07-18).
/// `(server id, match-history base URL, common base URL, region path parameter)`.
/// Match-history reads use the entitlements token; the common host (challenges)
/// uses the league-session token, as upstream's request interceptor does.
const SERVERS: &[(&str, &str, &str, Option<&str>)] = &[
    (
        "TENCENT_HN1",
        "https://hn1-k8s-sgp.lol.qq.com:21019",
        "https://hn1-k8s-sgp.lol.qq.com:21019",
        None,
    ),
    (
        "TENCENT_HN10",
        "https://hn10-k8s-sgp.lol.qq.com:21019",
        "https://hn10-k8s-sgp.lol.qq.com:21019",
        None,
    ),
    (
        "TENCENT_TJ100",
        "https://tj100-sgp.lol.qq.com:21019",
        "https://tj100-sgp.lol.qq.com:21019",
        None,
    ),
    (
        "TENCENT_TJ101",
        "https://tj101-sgp.lol.qq.com:21019",
        "https://tj101-sgp.lol.qq.com:21019",
        None,
    ),
    (
        "TENCENT_NJ100",
        "https://nj100-sgp.lol.qq.com:21019",
        "https://nj100-sgp.lol.qq.com:21019",
        None,
    ),
    (
        "TENCENT_GZ100",
        "https://gz100-sgp.lol.qq.com:21019",
        "https://gz100-sgp.lol.qq.com:21019",
        None,
    ),
    (
        "TENCENT_CQ100",
        "https://cq100-sgp.lol.qq.com:21019",
        "https://cq100-sgp.lol.qq.com:21019",
        None,
    ),
    (
        "TENCENT_BGP2",
        "https://bgp2-k8s-sgp.lol.qq.com:21019",
        "https://bgp2-k8s-sgp.lol.qq.com:21019",
        None,
    ),
    (
        "TENCENT_PBE",
        "https://pbe-sgp.lol.qq.com:21019",
        "https://pbe-sgp.lol.qq.com:21019",
        None,
    ),
    (
        "TENCENT_PREPBE",
        "https://prepbe-sgp.lol.qq.com:21019",
        "https://prepbe-sgp.lol.qq.com:21019",
        None,
    ),
    (
        "TW2",
        "https://apse1-red.pp.sgp.pvp.net",
        "https://tw2-red.lol.sgp.pvp.net",
        None,
    ),
    (
        "SG2",
        "https://apse1-red.pp.sgp.pvp.net",
        "https://sg2-red.lol.sgp.pvp.net",
        None,
    ),
    (
        "PH2",
        "https://apse1-red.pp.sgp.pvp.net",
        "https://ph2-red.lol.sgp.pvp.net",
        None,
    ),
    (
        "VN2",
        "https://apse1-red.pp.sgp.pvp.net",
        "https://vn2-red.lol.sgp.pvp.net",
        None,
    ),
    (
        "PBE",
        "https://usw2-red.pp.sgp.pvp.net",
        "https://pbe-red.lol.sgp.pvp.net",
        Some("PBE1"),
    ),
    (
        "EUW",
        "https://euc1-red.pp.sgp.pvp.net",
        "https://euw-red.lol.sgp.pvp.net",
        Some("EUW1"),
    ),
    (
        "JP",
        "https://apne1-red.pp.sgp.pvp.net",
        "https://jp-red.lol.sgp.pvp.net",
        Some("JP1"),
    ),
    (
        "RU",
        "https://euc1-red.pp.sgp.pvp.net",
        "https://ru-red.lol.sgp.pvp.net",
        None,
    ),
    (
        "BR1",
        "https://usw2-red.pp.sgp.pvp.net",
        "https://br-red.lol.sgp.pvp.net",
        None,
    ),
    (
        "OC1",
        "https://apse1-red.pp.sgp.pvp.net",
        "https://oce-red.lol.sgp.pvp.net",
        None,
    ),
    (
        "TR1",
        "https://euc1-red.pp.sgp.pvp.net",
        "https://tr-red.lol.sgp.pvp.net",
        None,
    ),
    (
        "LA1",
        "https://usw2-red.pp.sgp.pvp.net",
        "https://lan-red.lol.sgp.pvp.net",
        None,
    ),
    (
        "LA2",
        "https://usw2-red.pp.sgp.pvp.net",
        "https://las-red.lol.sgp.pvp.net",
        None,
    ),
    (
        "NA1",
        "https://usw2-red.pp.sgp.pvp.net",
        "https://na-red.lol.sgp.pvp.net",
        None,
    ),
    (
        "TH2",
        "https://apse1-red.pp.sgp.pvp.net",
        "https://th2-red.lol.sgp.pvp.net",
        None,
    ),
    (
        "KR",
        "https://apne1-red.pp.sgp.pvp.net",
        "https://kr-red.lol.sgp.pvp.net",
        None,
    ),
];

/// Upstream `BUILTIN_SUPPORTED_QUEUES`: queue tags offered in the mode selector.
pub const SUPPORTED_QUEUES: [u32; 17] = [
    420, 440, 430, 450, 480, 1700, 1750, 490, 1900, 900, 2300, 2400, 4210, 4220, 4240, 4250, 4260,
];

pub const MAX_COUNT: u32 = 200;
/// Collect mode scans 1000 games; regular paging may go a little further back.
pub const MAX_START: u32 = 2000;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Server {
    pub id: &'static str,
    pub base: &'static str,
    pub common: &'static str,
    region_path: Option<&'static str>,
}

impl Server {
    pub fn find(server_id: &str) -> Option<Self> {
        SERVERS.iter().find(|(id, _, _, _)| *id == server_id).map(
            |&(id, base, common, region_path)| Self {
                id,
                base,
                common,
                region_path,
            },
        )
    }

    /// Upstream `_getSubId`: the game-ID prefix (`TW2_123...`).
    fn sub_id(&self) -> &'static str {
        if let Some(path) = self.region_path {
            return path;
        }
        self.id.strip_prefix("TENCENT_").unwrap_or(self.id)
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum SgpRead {
    Summary {
        puuid: String,
        start: u32,
        count: u32,
        tag: Option<String>,
    },
    Details(u64),
    /// Upstream `challenges-client` all-player-data (the sidebar's collection counts).
    Collection(String),
}

/// Which client token an SGP read is signed with.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum SgpToken {
    Entitlements,
    LeagueSession,
}

/// Upstream `PlayerChallenges.vue` items, in its order: champions, champion skins,
/// chromas, ward skins, summoner icons, emotes.
pub const COLLECTION_CHALLENGES: [u64; 6] = [505001, 510001, 510011, 504003, 504002, 504004];

/// `ranked`, `normal` or `q_<queue id>`; anything else is rejected.
pub fn valid_tag(tag: &str) -> bool {
    match tag {
        "ranked" | "normal" => true,
        _ => tag.strip_prefix("q_").is_some_and(|id| {
            !id.is_empty() && id.len() <= 5 && id.bytes().all(|b| b.is_ascii_digit())
        }),
    }
}

impl SgpRead {
    pub fn token(&self) -> SgpToken {
        match self {
            Self::Collection(_) => SgpToken::LeagueSession,
            _ => SgpToken::Entitlements,
        }
    }

    /// JSON body of a POST read; `None` means GET.
    pub fn body(&self) -> Option<&'static str> {
        match self {
            // The friends list; upstream sends none.
            Self::Collection(_) => Some("[]"),
            _ => None,
        }
    }

    pub fn url(&self, server: &Server) -> AppResult<String> {
        Ok(match self {
            Self::Summary {
                puuid,
                start,
                count,
                tag,
            } => {
                crate::lcu::validate_identifier(puuid)?;
                if *count == 0 || *count > MAX_COUNT || *start > MAX_START {
                    return Err(AppError::new(
                        "InvalidInput",
                        "History page is out of range",
                    ));
                }
                let mut url = format!(
                    "{}/match-history-query/v1/products/lol/player/{puuid}/SUMMARY?startIndex={start}&count={count}",
                    server.base
                );
                if let Some(tag) = tag {
                    if !valid_tag(tag) {
                        return Err(AppError::new("InvalidInput", "Unknown queue tag"));
                    }
                    url.push_str("&tag=");
                    url.push_str(tag);
                }
                url
            }
            Self::Details(id) => {
                if *id == 0 {
                    return Err(AppError::new(
                        "InvalidInput",
                        "A numeric identifier is required",
                    ));
                }
                format!(
                    "{}/match-history-query/v1/products/lol/{}_{id}/DETAILS",
                    server.base,
                    server.sub_id()
                )
            }
            Self::Collection(puuid) => {
                crate::lcu::validate_identifier(puuid)?;
                // The trailing slash before the query is upstream's and is kept.
                format!(
                    "{}/challenges-client/v2/all-player-data/?puuid={puuid}",
                    server.common
                )
            }
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn urls_use_only_the_builtin_host_and_validated_parts() {
        let tw = Server::find("TW2").unwrap();
        let summary = SgpRead::Summary {
            puuid: "abc-123".into(),
            start: 20,
            count: 20,
            tag: Some("q_450".into()),
        };
        assert_eq!(
            summary.url(&tw).unwrap(),
            "https://apse1-red.pp.sgp.pvp.net/match-history-query/v1/products/lol/player/abc-123/SUMMARY?startIndex=20&count=20&tag=q_450"
        );
        assert_eq!(
            SgpRead::Details(42).url(&tw).unwrap(),
            "https://apse1-red.pp.sgp.pvp.net/match-history-query/v1/products/lol/TW2_42/DETAILS"
        );
        let euw = Server::find("EUW").unwrap();
        assert!(
            SgpRead::Details(1)
                .url(&euw)
                .unwrap()
                .ends_with("/EUW1_1/DETAILS")
        );
        let hn1 = Server::find("TENCENT_HN1").unwrap();
        assert!(
            SgpRead::Details(1)
                .url(&hn1)
                .unwrap()
                .ends_with("/HN1_1/DETAILS")
        );
        assert!(Server::find("XX").is_none());
        let collection = SgpRead::Collection("abc-123".into());
        assert_eq!(
            collection.url(&tw).unwrap(),
            "https://tw2-red.lol.sgp.pvp.net/challenges-client/v2/all-player-data/?puuid=abc-123"
        );
        assert_eq!(collection.token(), SgpToken::LeagueSession);
        assert_eq!(collection.body(), Some("[]"));
        assert_eq!(SgpRead::Details(1).token(), SgpToken::Entitlements);
        assert!(
            SgpRead::Collection("x".into())
                .url(&hn1)
                .unwrap()
                .starts_with("https://hn1-k8s-sgp.lol.qq.com:21019/challenges-client/")
        );
    }

    #[test]
    fn bad_inputs_are_rejected() {
        let tw = Server::find("TW2").unwrap();
        let page = |puuid: &str, start, count, tag: Option<&str>| SgpRead::Summary {
            puuid: puuid.into(),
            start,
            count,
            tag: tag.map(Into::into),
        };
        assert!(page("../x", 0, 20, None).url(&tw).is_err());
        assert!(page("p", 0, 0, None).url(&tw).is_err());
        assert!(page("p", 0, 201, None).url(&tw).is_err());
        assert!(page("p", 2001, 20, None).url(&tw).is_err());
        assert!(page("p", 0, 20, Some("q_1&x=1")).url(&tw).is_err());
        assert!(page("p", 0, 20, Some("q_")).url(&tw).is_err());
        assert!(page("p", 0, 20, Some("ranked")).url(&tw).is_ok());
        assert!(SgpRead::Details(0).url(&tw).is_err());
        assert!(SgpRead::Collection("a&b=1".into()).url(&tw).is_err());
    }
}
