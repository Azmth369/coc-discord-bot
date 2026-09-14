import 'dotenv/config';

const base = 'https://api.clashofclans.com/v1';
const token = process.env.COC_API_TOKEN;
if (!token) throw new Error('COC_API_TOKEN is required');

function encodeTag(tag) {
  return encodeURIComponent(tag.startsWith('#') ? tag : `#${tag}`);
}

export async function cocGet(path) {
  const res = await fetch(`${base}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`CoC API ${res.status}: ${body}`);
  }
  return res.json();
}

export const getClan = () => cocGet(`/clans/${encodeTag(process.env.COC_CLAN_TAG)}`);
export const getCurrentWar = () => cocGet(`/clans/${encodeTag(process.env.COC_CLAN_TAG)}/currentwar`);
export const getWarLog = () => cocGet(`/clans/${encodeTag(process.env.COC_CLAN_TAG)}/warlog`);
export const getCapitalRaids = () => cocGet(`/clans/${encodeTag(process.env.COC_CLAN_TAG)}/capitalraidseasons`);
export const getPlayer = (tag) => cocGet(`/players/${encodeTag(tag)}`);
